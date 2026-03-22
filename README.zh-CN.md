# turn-mcp-web

> **自托管 MCP 服务 + 浏览器控制台** — 给 AI Agent 加一个 `turn.wait` 检查点：暂停、问人、继续。

[![License: MIT](https://img.shields.io/badge/license-MIT-blue.svg)](LICENSE)
[![Node.js](https://img.shields.io/badge/node-%3E%3D18.17-brightgreen)](https://nodejs.org)
[![npm](https://img.shields.io/badge/npm-turn--mcp--web-red)](https://www.npmjs.com/package/turn-mcp-web)

[English README](./README.md)

> **在这里放截图或 GIF 演示** — 录制控制台响应 AI Agent 的过程，是本项目最高 ROI 的推广动作。

## 为什么选 turn-mcp-web？

| | turn-mcp-web | HumanLayer |
|---|---|---|
| 完全自托管，无云依赖 | ✅ | ❌ (SaaS) |
| MCP 原生（`turn.wait` 工具）| ✅ | 部分支持 |
| 浏览器控制台（无需 Slack）| ✅ | ❌ |
| Python 客户端（REST 长轮询）| ✅ | ✅ |
| stdio 传输层（Claude Desktop）| ✅ | ❌ |
| Slack / 邮件通知 | Webhook | 原生支持 |
| 零 npm 运行时依赖 | ✅ | ❌ |
| 中英双语 i18n | ✅ | ❌ |

## 快速开始

```bash
npx turn-mcp-web
```

或从源码运行：

```bash
npm install && npm run build && npm start
```

浏览器控制台 → `http://127.0.0.1:3737/`
MCP 端点 → `http://127.0.0.1:3737/mcp`

## MCP 客户端配置

### Streamable HTTP（Cursor、Windsurf、Claude Code 等）

```json
{
  "mcpServers": {
    "turn-mcp-web": {
      "url": "http://127.0.0.1:3737/mcp"
    }
  }
}
```

Windsurf 使用 `"serverUrl"` 代替 `"url"`。

### stdio（Claude Desktop、Cline、Continue 等）

stdio 模式在 **stdin/stdout** 上运行 MCP 传输层，同时 HTTP 端口的浏览器控制台仍然可用。

```json
{
  "mcpServers": {
    "turn-mcp-web": {
      "command": "npx",
      "args": ["turn-mcp-web-stdio"]
    }
  }
}
```

Agent 通过 stdio 连接 MCP 的同时，人类可以在 `http://127.0.0.1:3737/` 使用浏览器控制台回复。

## Python 客户端

适用于不通过 MCP 的 Python AI 框架（LangChain、CrewAI、AutoGen、普通 Python 脚本）：

```bash
pip install ./python-client
```

```python
from turn_mcp_client import TurnMcpClient, TurnMcpTimeout

client = TurnMcpClient("http://127.0.0.1:3737")

reply = client.wait(
    context="计划删除表 `old_users`（32 行，无外键引用）。",
    question="确认执行 DROP TABLE？",
    options=["是，执行", "否，停止", "先显示迁移计划"],
)
print(reply)
```

支持 `await client.async_wait(...)` 和 LangChain `@tool` 集成。
详见 [`python-client/README.md`](./python-client/README.md) 和 [`examples/python/`](./examples/python/)。

## 功能列表

- **MCP 工具**：`turn.wait`（别名：`turn_wait`、`turn`）
- **双传输层**：Streamable HTTP + stdio（`--stdio` 标志）
- **Python 客户端**：`pip install turn-mcp-client`
- **多并发 wait**：同一 session 最多 10 个并发等待（可配置）
- **浏览器控制台**：查看、回复、取消、延长超时
- **会话命名**：为 session 设置可读名称（保存到 localStorage）
- **SSE 实时推送**：空闲时零轮询，断线重连指数退避
- **桌面通知 + 声音**：新等待到达时提示
- **快捷回复模板**：预设或自定义
- **历史持久化**：可选 JSONL 存储，重启后自动恢复
- **Webhook**：HMAC-SHA256 签名、自动重试（3×）、Slack 格式支持
- **API 鉴权**：operator/viewer 角色模型
- **速率限制**：每 IP 滑动窗口
- **事件日志**：结构化 JSONL 日志
- **i18n**：中英双语，浏览器内切换
- **PWA**：可安装，屏幕锁定时 Service Worker 提醒

## 环境变量

| 变量 | 默认 | 说明 |
|---|---|---|
| `TURN_MCP_HTTP_HOST` | `127.0.0.1` | 绑定 IP |
| `TURN_MCP_HTTP_PORT` | `3737` | 绑定端口 |
| `TURN_MCP_DEFAULT_TIMEOUT_SECONDS` | `600` | 默认超时（0–3600）|
| `TURN_MCP_API_KEY` | — | operator 密钥 |
| `TURN_MCP_VIEWER_API_KEY` | — | viewer 密钥 |
| `TURN_MCP_REQUIRE_API_KEY` | auto | 启用鉴权 |
| `TURN_MCP_EVENT_LOG_FILE` | — | 事件日志 JSONL 路径 |
| `TURN_MCP_HISTORY_FILE` | — | 历史持久化 JSONL 路径 |
| `TURN_MCP_WEBHOOK_URL` | — | Webhook URL |
| `TURN_MCP_WEBHOOK_EVENTS` | `wait_created` | 订阅事件类型 |
| `TURN_MCP_WEBHOOK_SECRET` | — | HMAC-SHA256 签名密钥 |
| `TURN_MCP_WEBHOOK_FORMAT` | `json` | `json` 或 `slack` |
| `TURN_MCP_RATE_LIMIT_MAX` | `120` | 每 IP 最大请求数 |
| `TURN_MCP_RATE_LIMIT_WINDOW_SECONDS` | `60` | 限流窗口（秒）|
| `TURN_MCP_MAX_CONCURRENT_WAITS_PER_SESSION` | `10` | 每 session 最大并发等待数 |
| `TURN_MCP_REINFORCEMENT_SUFFIX` | （内置）| 每次回复自动追加的内容 |

## Slack 通知

```bash
TURN_MCP_WEBHOOK_URL=https://hooks.slack.com/services/... \
TURN_MCP_WEBHOOK_FORMAT=slack \
npm start
```

## 鉴权方式

启用 `TURN_MCP_REQUIRE_API_KEY=true` 时：

- 通过 `x-turn-mcp-api-key` 或 `Authorization: Bearer <key>` 传递密钥
- **operator**：完整访问（MCP + 回复/取消 + 事件日志）
- **viewer**：只读（查看等待任务和历史）

## 测试

```bash
npm test              # 单元测试 + 集成测试
npm run test:unit     # 仅运行 WaitStore 单元测试（无需启动服务器）
npm run test:ui       # UI 集成测试
```

## Docker

```bash
docker build -t turn-mcp-web .
docker run --rm -p 3737:3737 \
  -e TURN_MCP_HTTP_HOST=0.0.0.0 \
  -e TURN_MCP_API_KEY=your_key \
  turn-mcp-web
```

或使用 Docker Compose：

```bash
docker compose up --build
```

## 参与贡献

请查阅 [CONTRIBUTING.md](./CONTRIBUTING.md)。

## 许可证

MIT
