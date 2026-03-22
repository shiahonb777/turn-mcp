# turn-mcp-web

One model API request, unlimited conversations and interactions. A vulnerability in the MCP protocol can amplify resource usage in API billing model schemes. AI agents call `turn.wait` to pause execution

[![License: MIT](https://img.shields.io/badge/license-MIT-blue.svg)](LICENSE)
[![Node.js](https://img.shields.io/badge/node-%3E%3D18.17-brightgreen)](https://nodejs.org)

[中文文档](./README.zh-CN.md)

---

## Quick Start

Each script checks for Node.js, installs dependencies, and builds the project on the first run, then starts the server and opens the browser.

**macOS** — double-click `start.command`

**Windows** — double-click `start.bat`

**Linux**
```bash
bash start.sh
```

**From source**
```bash
npm install
npm run build
npm start
```

Browser console → `http://127.0.0.1:3737/`  
MCP endpoint → `http://127.0.0.1:3737/mcp`

---

## MCP Client Setup

### Streamable HTTP

For IDE-based clients (Cursor, Windsurf, Claude Code, VS Code Copilot, Antigravity). Add to the client’s MCP config file:

```json
{
  "mcpServers": {
    "turn-mcp-web": {
      "url": "http://127.0.0.1:3737/mcp"
    }
  }
}
```

> Windsurf uses `"serverUrl"` instead of `"url"`.

### stdio

For clients that spawn MCP servers as child processes (Claude Desktop, Cline, Continue). The process also binds the browser console on HTTP so you can still reply via `http://127.0.0.1:3737/`.

```json
{
  "mcpServers": {
    "turn-mcp-web": {
      "command": "node",
      "args": ["/path/to/turn-mcp-web-universal/dist/server-stdio.js"]
    }
  }
}
```

---

## Python Client

For Python agent frameworks that don’t use MCP (LangChain, LangGraph, AutoGen, plain scripts). The client calls the long-poll REST endpoint `POST /api/waits/create-and-wait` and blocks until the operator replies in the browser console.

```bash
pip install ./python-client
```

```python
from turn_mcp_client import TurnMcpClient, TurnMcpTimeout, TurnMcpCanceled

client = TurnMcpClient("http://127.0.0.1:3737")
reply = client.wait(
    context="About to drop table `old_users` (32 rows, no FK references).",
    question="Proceed with DROP TABLE?",
    options=["Yes", "No", "Show migration first"],
)
```

Async variant and LangChain / LangGraph integration examples: [`python-client/README.md`](./python-client/README.md)

---

## Features

- MCP tool `turn.wait` with aliases `turn_wait`, `turn`
- Dual transport: Streamable HTTP and stdio
- Browser console: view, reply, cancel, extend pending waits
- Session sidebar: active sessions above, history below (read-only preview)
- SSE real-time push with exponential backoff reconnect
- Desktop and sound notifications, title-bar flash
- Quick reply templates, agent-defined option buttons
- Session naming (stored in browser localStorage)
- History persistence (optional JSONL)
- Webhook: HMAC-SHA256 signing, automatic retry (×3), Slack format
- API key auth: operator / viewer roles
- Per-IP rate limiting (sliding window)
- Structured event log (optional JSONL)
- One-click auto-configure for 8 MCP clients + system-wide shell/registry
- i18n: English and Chinese, runtime-switchable
- PWA: installable, Service Worker background notifications

---

## Environment Variables

| Variable | Default | Description |
|---|---|---|
| `TURN_MCP_HTTP_HOST` | `127.0.0.1` | Bind host |
| `TURN_MCP_HTTP_PORT` | `3737` | Bind port |
| `TURN_MCP_HTTP_PATH` | `/mcp` | MCP endpoint path |
| `TURN_MCP_DEFAULT_TIMEOUT_SECONDS` | `600` | Default wait timeout (0–3600) |
| `TURN_MCP_API_KEY` | — | Operator key |
| `TURN_MCP_VIEWER_API_KEY` | — | Viewer key (read-only) |
| `TURN_MCP_REQUIRE_API_KEY` | auto | Enable auth (auto if any key is set) |
| `TURN_MCP_EVENT_LOG_FILE` | — | Event log JSONL path |
| `TURN_MCP_HISTORY_FILE` | — | History JSONL path |
| `TURN_MCP_WEBHOOK_URL` | — | Webhook target URL |
| `TURN_MCP_WEBHOOK_EVENTS` | `wait_created` | Comma-separated event types |
| `TURN_MCP_WEBHOOK_SECRET` | — | HMAC-SHA256 signing secret |
| `TURN_MCP_WEBHOOK_FORMAT` | `json` | `json` or `slack` |
| `TURN_MCP_RATE_LIMIT_MAX` | `120` | Max requests per IP per window |
| `TURN_MCP_RATE_LIMIT_WINDOW_SECONDS` | `60` | Rate-limit window (seconds) |
| `TURN_MCP_MAX_CONCURRENT_WAITS_PER_SESSION` | `10` | Max concurrent waits per session |
| `TURN_MCP_REINFORCEMENT_SUFFIX` | *(built-in)* | Text appended to every reply |

---

## Authentication

Auth is disabled by default. Set `TURN_MCP_API_KEY` (and optionally `TURN_MCP_VIEWER_API_KEY`) to enable it. Pass the key on every request via either header:

```
x-turn-mcp-api-key: <key>
Authorization: Bearer <key>
```

Two roles are supported:

- `operator` — full access: call MCP tools, submit replies, cancel waits, read event log
- `viewer` — read-only: inspect pending waits and session history, subscribe to SSE

---

## Webhook Security (HMAC)

When `TURN_MCP_WEBHOOK_SECRET` is set, every outbound webhook POST is signed with HMAC-SHA256. The signature is sent in the `x-turn-mcp-signature` header as `sha256=<hex>`. Verify it on the receiving end to ensure the payload has not been tampered with.

```python
import hmac, hashlib

def verify(body: bytes, header: str, secret: str) -> bool:
    expected = "sha256=" + hmac.new(secret.encode(), body, hashlib.sha256).hexdigest()
    return hmac.compare_digest(expected, header)
```

---

## API

All endpoints return JSON. Error responses include an `error` string field. Paginated endpoints return `total`, `count`, and `pagination.hasMore`.

| Method | Path | Auth | Description |
|---|---|---|---|
| GET | `/api/public-config` | none | Public config |
| GET | `/api/auth-check` | viewer+ | Current role |
| GET | `/api/waits` | viewer+ | Pending waits |
| GET | `/api/waits/:id` | viewer+ | Single pending wait |
| GET | `/api/history` | viewer+ | Completed history |
| GET | `/api/history/timeline` | viewer+ | Session timeline |
| GET | `/api/sessions` | viewer+ | All sessions summary |
| POST | `/api/waits/:id/respond` | operator | Submit reply |
| POST | `/api/waits/:id/cancel` | operator | Cancel wait |
| POST | `/api/waits/:id/extend` | operator | Extend timeout |
| POST | `/api/waits/cancel-all` | operator | Cancel all pending |
| POST | `/api/waits/create-and-wait` | operator | Long-poll: create and wait for reply |
| POST | `/api/settings` | operator | Update runtime settings |
| POST | `/api/auto-configure` | operator | Write client config files |
| POST | `/api/auto-unconfigure` | operator | Remove from client config files |
| GET | `/api/stream` | viewer+ | SSE event stream |
| GET | `/api/events` | operator | Event log |
| GET | `/healthz` | none | Health check |

---

## Testing

`test:unit` runs directly against the compiled `dist/` output and requires no running server. `test:ui` starts a real server on a temporary port and tests browser interactions end-to-end.

```bash
npm test               # unit tests + UI integration tests
npm run test:unit      # WaitStore unit tests only
npm run test:ui        # UI integration tests
```

---

## Docker

Set `TURN_MCP_HTTP_HOST=0.0.0.0` when running inside a container so the port is accessible from the host. Mount a volume to `/app/logs` if you want history and event log files to survive container restarts.

```bash
docker build -t turn-mcp-web .
docker run --rm -p 3737:3737 \
  -e TURN_MCP_HTTP_HOST=0.0.0.0 \
  -e TURN_MCP_API_KEY=your_key \
  -e TURN_MCP_HISTORY_FILE=/app/logs/history.jsonl \
  -v "$(pwd)/logs:/app/logs" \
  turn-mcp-web
```

Alternatively, use the included Compose file:

```bash
docker compose up --build
```

---

## Architecture

The entire stack runs in a single `node dist/server.js` process. `wait-store.ts` is the core: it keeps pending waits as in-memory Promises and resolves them when the operator replies via the REST API. SSE pushes events to the browser in real time. History is optionally persisted to JSONL files so it survives restarts.

```
src/
  server.ts              HTTP entry: MCP + REST API + static files
  server-stdio.ts        stdio entrypoint (for IDE clients)
  auto-configure.ts      Write/remove client config files
  turn-mcp-server.ts     MCP tool implementation
  wait-store.ts          In-memory wait state machine (Promise-based)
  event-log.ts           Structured event logger
  sse-manager.ts         SSE broadcast manager
  history-persistence.ts JSONL history persistence
  webhook.ts             Outbound webhook (HMAC, retry, Slack)
  config.ts              Environment config + Logger

public/
  app.js                 Browser console (vanilla JS)
  styles.css             UI design system
  i18n.js                EN/ZH runtime switcher
  sw.js                  Service Worker (PWA)

python-client/           pip install turn-mcp-client
examples/python/         LangChain, LangGraph integration examples
```

---

## Agent Usage Guide

Before deploying turn-mcp-web with an AI agent, share the skill document with the agent so it knows when and how to call `turn.wait`, what context to provide, and what rules to follow.

- English: [`SKILL.md`](./SKILL.md)
- 中文: [`SKILL.zh-CN.md`](./SKILL.zh-CN.md)

Paste the document into the agent’s system prompt, or reference it with `@SKILL.md` in clients that support file context.

---

## License

MIT
