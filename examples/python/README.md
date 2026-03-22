# Python Examples

All examples require the turn-mcp-web server to be running:

```bash
npx turn-mcp-web
# or: node dist/server.js
```

| File | Framework | Description |
|---|---|---|
| `plain_asyncio.py` | None | Minimal async example, zero AI framework dependencies |
| `langchain_tool.py` | LangChain | `@tool` decorator for human approval checkpoints |
| `langgraph_checkpoint.py` | LangGraph | Human-approval node in a StateGraph workflow |

## Quick Start

```bash
# From the repo root:
pip install ./python-client

# Run any example:
python examples/python/plain_asyncio.py
```

Open `http://127.0.0.1:3737/` to respond to the agent.
