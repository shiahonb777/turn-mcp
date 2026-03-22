"""
TurnMcpClient — synchronous Python client for turn-mcp-web.

Calls the long-poll REST endpoint POST /api/waits/create-and-wait
and blocks until a human replies in the browser console.

Usage::

    from turn_mcp_client import TurnMcpClient, TurnMcpTimeout, TurnMcpCanceled

    client = TurnMcpClient("http://127.0.0.1:3737")

    try:
        reply = client.wait(
            context="I have analysed the schema and plan to drop the old_users table.",
            question="Should I proceed?",
            options=["Yes, proceed", "No, stop"],
        )
        print("Human replied:", reply)
    except TurnMcpTimeout:
        print("Nobody responded in time.")
    except TurnMcpCanceled:
        print("Wait was canceled.")
"""

from __future__ import annotations

import json
import os
import urllib.error
import urllib.request
import uuid
from typing import List, Optional


class TurnMcpError(Exception):
    """Base exception for all turn-mcp-client errors."""


class TurnMcpTimeout(TurnMcpError):
    """Raised when the human did not respond before the timeout."""


class TurnMcpCanceled(TurnMcpError):
    """Raised when the operator canceled the wait via the web console."""


class TurnMcpClient:
    """
    Synchronous client for the turn-mcp-web human-in-the-loop server.

    Parameters
    ----------
    base_url:
        Base URL of the turn-mcp-web server (default: ``http://127.0.0.1:3737``).
        Also read from the ``TURN_MCP_URL`` environment variable if not passed.
    api_key:
        Operator API key (required when the server has auth enabled).
        Also read from the ``TURN_MCP_API_KEY`` environment variable.
    default_timeout_seconds:
        Server-side wait timeout used when *timeout_seconds* is not passed to
        :meth:`wait`. Set to ``0`` to disable timeout (wait indefinitely).
    """

    def __init__(
        self,
        base_url: Optional[str] = None,
        api_key: Optional[str] = None,
        default_timeout_seconds: int = 600,
    ) -> None:
        self.base_url = (base_url or os.environ.get("TURN_MCP_URL", "http://127.0.0.1:3737")).rstrip("/")
        self.api_key = api_key or os.environ.get("TURN_MCP_API_KEY", "")
        self.default_timeout_seconds = default_timeout_seconds

    # ------------------------------------------------------------------
    # Public API
    # ------------------------------------------------------------------

    def wait(
        self,
        context: str,
        question: Optional[str] = None,
        options: Optional[List[str]] = None,
        agent_name: Optional[str] = None,
        session_id: Optional[str] = None,
        timeout_seconds: Optional[int] = None,
    ) -> str:
        """
        Pause execution and wait for a human reply via the Turn MCP web console.

        Parameters
        ----------
        context:
            Current task summary shown to the human operator (required).
        question:
            Optional question displayed prominently to the human.
        options:
            Optional list of pre-defined reply choices shown as buttons.
        agent_name:
            Label identifying the calling agent (shown in the UI).
        session_id:
            Logical session identifier. Calls sharing the same *session_id*
            appear as a single conversation thread in the web console.
            Auto-generated if omitted.
        timeout_seconds:
            Override the server-side wait timeout for this call only.

        Returns
        -------
        str
            The human's reply message (may include the server-side
            reinforcement suffix appended by the server).

        Raises
        ------
        TurnMcpTimeout
            If the wait expired without a human response.
        TurnMcpCanceled
            If the operator canceled the wait from the web console.
        TurnMcpError
            On HTTP errors or unexpected server responses.
        """
        payload: dict = {
            "context": context,
            "sessionId": session_id or f"py-{uuid.uuid4().hex[:12]}",
        }
        effective_timeout = timeout_seconds if timeout_seconds is not None else self.default_timeout_seconds
        payload["timeoutSeconds"] = effective_timeout

        if question:
            payload["question"] = question
        if options:
            payload["options"] = options
        if agent_name:
            payload["agentName"] = agent_name

        encoded = json.dumps(payload).encode("utf-8")
        req = urllib.request.Request(
            f"{self.base_url}/api/waits/create-and-wait",
            data=encoded,
            headers={"Content-Type": "application/json"},
            method="POST",
        )
        if self.api_key:
            req.add_header("x-turn-mcp-api-key", self.api_key)

        # HTTP timeout must be longer than the server-side wait timeout
        http_timeout = (effective_timeout + 60) if effective_timeout > 0 else None

        try:
            with urllib.request.urlopen(req, timeout=http_timeout) as resp:
                body = json.loads(resp.read().decode("utf-8"))
        except urllib.error.HTTPError as exc:
            raw = exc.read() if exc.fp else b"{}"
            try:
                body = json.loads(raw.decode("utf-8"))
            except Exception:
                body = {}
            raise TurnMcpError(body.get("error", f"HTTP {exc.code}")) from exc
        except OSError as exc:
            raise TurnMcpError(f"Connection error: {exc}") from exc

        resolution = body.get("resolution")
        if resolution == "timeout":
            raise TurnMcpTimeout("Wait timed out — the human did not respond in time.")
        if resolution == "canceled":
            raise TurnMcpCanceled("Wait was canceled by the operator.")
        if resolution == "message":
            message = body.get("message")
            if not isinstance(message, str):
                raise TurnMcpError("Server returned an unexpected response format.")
            return message

        raise TurnMcpError(f"Unexpected resolution from server: {resolution!r}")

    # ------------------------------------------------------------------
    # Async variant (requires Python 3.8+ asyncio, no extra dependencies)
    # ------------------------------------------------------------------

    async def async_wait(
        self,
        context: str,
        question: Optional[str] = None,
        options: Optional[List[str]] = None,
        agent_name: Optional[str] = None,
        session_id: Optional[str] = None,
        timeout_seconds: Optional[int] = None,
    ) -> str:
        """
        Async version of :meth:`wait`. Runs the blocking HTTP call in a
        thread pool so it does not block the event loop.

        Requires Python 3.9+ for ``asyncio.to_thread``; falls back to
        ``loop.run_in_executor`` on older versions.
        """
        import asyncio
        import functools

        fn = functools.partial(
            self.wait,
            context,
            question=question,
            options=options,
            agent_name=agent_name,
            session_id=session_id,
            timeout_seconds=timeout_seconds,
        )
        try:
            return await asyncio.to_thread(fn)  # type: ignore[attr-defined]
        except AttributeError:
            loop = asyncio.get_event_loop()
            return await loop.run_in_executor(None, fn)
