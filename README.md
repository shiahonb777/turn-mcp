# turn-mcp-web

> **Self-hosted MCP server + browser console** that gives AI agents a `turn.wait` checkpoint — pause, ask a human, resume.

[![License: MIT](https://img.shields.io/badge/license-MIT-blue.svg)](LICENSE)
[![Node.js](https://img.shields.io/badge/node-%3E%3D18.17-brightgreen)](https://nodejs.org)
[![npm](https://img.shields.io/badge/npm-turn--mcp--web-red)](https://www.npmjs.com/package/turn-mcp-web)

[中文文档](./README.zh-CN.md)

> **Add a screenshot or GIF demo here** — recording the console responding to an AI agent is the highest-ROI marketing action for this project.

## Why turn-mcp-web?

| | turn-mcp-web | HumanLayer |
|---|---|---|
| Self-hosted, zero cloud dependency | ✅ | ❌ (SaaS) |
| MCP-native (`turn.wait` tool) | ✅ | partial |
| Browser console (no Slack required) | ✅ | ❌ |
| Python client (REST long-poll) | ✅ | ✅ |
| stdio transport (Claude Desktop) | ✅ | ❌ |
| Slack / email notifications | webhook | native |
| Zero runtime npm dependencies | ✅ | ❌ |
| i18n (EN + ZH) | ✅ | ❌ |

## Quick Start

### Option A — Double-click to launch (no terminal needed)

**macOS / Linux** — double-click `start.sh`, or:
```bash
bash start.sh
```

**Windows** — double-click `start.bat`

The script automatically installs dependencies, builds the project (first run only), and opens the browser.

> **Prerequisite:** [Node.js >= 18](https://nodejs.org) must be installed.
> macOS: `brew install node` &nbsp;|&nbsp; Windows: `winget install OpenJS.NodeJS`

### Option B — npm commands

```bash
npm install && npm run build && npm start
```

Browser console → `http://127.0.0.1:3737/`  
MCP endpoint → `http://127.0.0.1:3737/mcp`

## MCP Client Setup

### Streamable HTTP (Cursor, Windsurf, Claude Code, …)

```json
{
  "mcpServers": {
    "turn-mcp-web": {
      "url": "http://127.0.0.1:3737/mcp"
    }
  }
}
```

For Windsurf use `"serverUrl"` instead of `"url"`.

### stdio (Claude Desktop, Cline, Continue, …)

Stdio mode starts the MCP transport on **stdin/stdout** while the web console remains available on HTTP.

```json
{
  "mcpServers": {
    "turn-mcp-web": {
      "command": "npx",
      "args": ["turn-mcp-web", "--stdio"]
    }
  }
}
```

The web console is still available at `http://127.0.0.1:3737/` while the agent talks MCP over stdio.

## Python Client

For AI frameworks that don't use MCP (LangChain, CrewAI, AutoGen, plain Python scripts):

```bash
pip install ./python-client
```

```python
from turn_mcp_client import TurnMcpClient, TurnMcpTimeout

client = TurnMcpClient("http://127.0.0.1:3737")

reply = client.wait(
    context="Planning to drop table `old_users` (32 rows, no FK references).",
    question="Proceed with DROP TABLE?",
    options=["Yes, proceed", "No, stop", "Show migration plan first"],
)
print(reply)
```

Also supports `await client.async_wait(...)` and LangChain `@tool` integration. See [`python-client/README.md`](./python-client/README.md).

## Features

- **MCP Tool**: `turn.wait` (aliases: `turn_wait`, `turn`)
- **Dual transport**: Streamable HTTP + stdio (`--stdio` flag)
- **Python client**: `pip install turn-mcp-client` for non-MCP workflows
- **Browser Console**: view, reply, cancel, and extend pending wait tasks
- **REST API**: list waits, submit replies, cancel, extend timeout, long-poll create-and-wait
- **SSE Real-time Push**: zero polling when idle, exponential backoff reconnect
- **Desktop & Sound Notifications**: desktop notification, beep, title-bar flash on new wait
- **Quick Reply Templates**: preset or custom one-click replies
- **Session Timeline**: per-session aggregated interaction history (including user replies)
- **History Persistence**: optional JSONL file storage, auto-restore on restart
- **Webhook Notifications**: POST to external URL, configurable events, HMAC-SHA256 signing, automatic retry (3×)
- **Slack Webhook Format**: `TURN_MCP_WEBHOOK_FORMAT=slack` for native Slack Incoming Webhook payloads
- **Reinforcement Suffix**: auto-appended to every web reply (configurable)
- **API Key Auth**: operator/viewer role-based access control
- **Rate Limiting**: per-IP sliding window (configurable)
- **Event Log**: structured JSONL event log with type filtering, grouping, and pagination
- **i18n**: English (default) and Chinese, switchable in the browser
- **PWA**: installable, Service Worker notifications when the screen is locked

## Environment Variables

| Variable | Default | Description |
|---|---|---|
| `TURN_MCP_HTTP_HOST` | `127.0.0.1` | Bind host |
| `TURN_MCP_HTTP_PORT` | `3737` | Bind port |
| `TURN_MCP_HTTP_PATH` | `/mcp` | MCP endpoint path |
| `TURN_MCP_DEFAULT_TIMEOUT_SECONDS` | `600` | Default wait timeout (0–3600) |
| `TURN_MCP_API_KEY` | — | Operator key (read/write + MCP) |
| `TURN_MCP_VIEWER_API_KEY` | — | Viewer key (read-only) |
| `TURN_MCP_REQUIRE_API_KEY` | auto | Enable auth (auto if any key set) |
| `TURN_MCP_EVENT_LOG_FILE` | — | Event log JSONL path |
| `TURN_MCP_HISTORY_FILE` | — | History persistence JSONL path |
| `TURN_MCP_WEBHOOK_URL` | — | Webhook target URL |
| `TURN_MCP_WEBHOOK_EVENTS` | `wait_created` | Comma-separated event types |
| `TURN_MCP_WEBHOOK_SECRET` | — | HMAC-SHA256 signing secret |
| `TURN_MCP_WEBHOOK_FORMAT` | `json` | `json` or `slack` |
| `TURN_MCP_RATE_LIMIT_MAX` | `120` | Max API requests per IP per window |
| `TURN_MCP_RATE_LIMIT_WINDOW_SECONDS` | `60` | Rate-limit window in seconds |
| `TURN_MCP_REINFORCEMENT_SUFFIX` | *(built-in)* | Text appended to every reply |

## Authentication

When `TURN_MCP_REQUIRE_API_KEY=true`:

- Pass via `x-turn-mcp-api-key` header or `Authorization: Bearer <key>`.
- **operator** role: full access (MCP + reply/cancel + event log).
- **viewer** role: read-only (view waits and history).

## Webhook Security (HMAC)

When `TURN_MCP_WEBHOOK_SECRET` is set, every outbound webhook POST includes an
`x-turn-mcp-signature: sha256=<hex>` header. Verify it on the receiving end:

```python
import hmac, hashlib

def verify(body: bytes, header: str, secret: str) -> bool:
    expected = 'sha256=' + hmac.new(secret.encode(), body, hashlib.sha256).hexdigest()
    return hmac.compare_digest(expected, header)
```

## Slack Notifications

Point `TURN_MCP_WEBHOOK_URL` at a Slack Incoming Webhook URL and set `TURN_MCP_WEBHOOK_FORMAT=slack`:

```bash
TURN_MCP_WEBHOOK_URL=https://hooks.slack.com/services/... \
TURN_MCP_WEBHOOK_FORMAT=slack \
npm start
```

## API Overview

| Method | Path | Auth | Description |
|---|---|---|---|
| GET | `/api/public-config` | none | Public config |
| GET | `/api/auth-check` | viewer+ | Current role |
| GET | `/api/waits` | viewer+ | Pending waits |
| GET | `/api/waits/:id` | viewer+ | Single pending wait |
| GET | `/api/history` | viewer+ | Completed history (filter, paginate) |
| GET | `/api/history/timeline` | viewer+ | Session timeline |
| GET | `/api/sessions` | viewer+ | All sessions summary |
| POST | `/api/waits/:id/respond` | operator | Submit reply |
| POST | `/api/waits/:id/cancel` | operator | Cancel wait |
| POST | `/api/waits/:id/extend` | operator | Extend timeout |
| POST | `/api/waits/cancel-all` | operator | Cancel all pending waits |
| POST | `/api/waits/create-and-wait` | operator | Create wait + long-poll for reply |
| POST | `/api/settings` | operator | Update runtime settings |
| GET | `/api/stream` | viewer+ | SSE event stream |
| GET | `/api/events` | operator | Event log (filter, paginate) |
| GET | `/healthz` | none | Health check |

## Testing

```bash
npm test              # unit tests + integration tests
npm run test:unit     # WaitStore unit tests only
npm run test:ui       # UI integration tests
```

## Docker

```bash
docker build -t turn-mcp-web .
docker run --rm -p 3737:3737 \
  -e TURN_MCP_HTTP_HOST=0.0.0.0 \
  -e TURN_MCP_API_KEY=your_operator_key \
  turn-mcp-web
```

Or via Docker Compose:

```bash
docker compose up --build
```

## Architecture

```
src/
  server.ts          — HTTP entry: MCP + REST API + static files + rate limiter
  turn-mcp-server.ts — MCP tool (turn.wait / turn_wait / turn)
  wait-store.ts      — In-memory wait state machine (Promise-based)
  event-log.ts       — Structured event logger (in-memory + JSONL)
  sse-manager.ts     — SSE broadcast manager
  history-persistence.ts — JSONL history persistence
  webhook.ts         — Outbound webhook (HMAC, retry, Slack format)
  config.ts          — All env-var config + Logger
public/
  app.js             — Browser console (vanilla JS, SSE, micro-markdown)
  styles.css         — "Liquid Obsidian" design system
  i18n.js            — EN/ZH switcher
  sw.js              — Service Worker (PWA + background notifications)
python-client/
  turn_mcp_client/   — pip install turn-mcp-client
```

## License

MIT
