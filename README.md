# turn-mcp-web

Self-hosted MCP server and browser console that provides a `turn.wait` human-in-the-loop checkpoint for AI agents.

[![License: MIT](https://img.shields.io/badge/license-MIT-blue.svg)](LICENSE)
[![Node.js](https://img.shields.io/badge/node-%3E%3D18.17-brightgreen)](https://nodejs.org)

[中文文档](./README.zh-CN.md)

---

## Quick Start

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

### stdio (Claude Desktop, Cline, Continue)
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

Async support and LangChain/LangGraph examples: [`python-client/README.md`](./python-client/README.md)

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

Pass key via `x-turn-mcp-api-key` header or `Authorization: Bearer <key>`.

- `operator` — full access (MCP + reply/cancel + event log)
- `viewer` — read-only (view waits and history)

---

## Webhook Security (HMAC)

When `TURN_MCP_WEBHOOK_SECRET` is set, every outbound webhook POST includes  
`x-turn-mcp-signature: sha256=<hex>`.

```python
import hmac, hashlib

def verify(body: bytes, header: str, secret: str) -> bool:
    expected = "sha256=" + hmac.new(secret.encode(), body, hashlib.sha256).hexdigest()
    return hmac.compare_digest(expected, header)
```

---

## API

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

```bash
npm test               # unit tests + UI integration tests
npm run test:unit      # WaitStore unit tests only
npm run test:ui        # UI integration tests
```

---

## Docker

```bash
docker build -t turn-mcp-web .
docker run --rm -p 3737:3737 \
  -e TURN_MCP_HTTP_HOST=0.0.0.0 \
  -e TURN_MCP_API_KEY=your_key \
  turn-mcp-web
```

```bash
docker compose up --build
```

---

## Architecture

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

## License

MIT
