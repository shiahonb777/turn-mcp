# turn-mcp-web

一次模型 API 请求，实现无限次对话与交互。一个 MCP 协议漏洞，可以放大计费 API 模型方案中资源的使用。AI Agent 调用

[![License: MIT](https://img.shields.io/badge/license-MIT-blue.svg)](LICENSE)
[![Node.js](https://img.shields.io/badge/node-%3E%3D18.17-brightgreen)](https://nodejs.org)

[English](./README.md)

**使用流程：** 打开项目文件夹并启动服务器 → 在浏览器控制台配置对应 AI 工具的 MCP 接入文件 → 在自己的 AI 工具中将 [`SKILL.md`](./SKILL.md) 发给 AI → AI 调用 `turn.wait` 后回到浏览器回复，循环进行无限次对话。

---

## 快速开始

各脚本首次运行时自动检测 Node.js、安装依赖并构建项目，随后启动服务器并打开浏览器。

**macOS** — 双击 `start.command`

**Windows** — 双击 `start.bat`

**Linux**
```bash
bash start.sh
```

**源码构建**
```bash
npm install
npm run build
npm start
```

浏览器控制台 → `http://127.0.0.1:3737/`  
MCP 端点 → `http://127.0.0.1:3737/mcp`

---

## MCP 客户端配置

### Streamable HTTP

适用于 IDE 内置客户端（Cursor、Windsurf、Claude Code、VS Code Copilot、Antigravity）。添加到对应客户端的 MCP 配置文件：

```json
{
  "mcpServers": {
    "turn-mcp-web": {
      "url": "http://127.0.0.1:3737/mcp"
    }
  }
}
```

> Windsurf 使用 `"serverUrl"` 代替 `"url"`。

### stdio（Claude Desktop、Cline、Continue）

适用于以子进程方式启动 MCP 服务的客户端。运行后 HTTP 端口仍可用，可通过 `http://127.0.0.1:3737/` 回复。

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

## Python 客户端

适用于不使用 MCP 的 Python Agent 框架（LangChain、LangGraph、AutoGen、普通脚本）。客户端调用长轮询端点 `POST /api/waits/create-and-wait`，阻塞直至操作员在浏览器控制台回复。

```bash
pip install ./python-client
```

```python
from turn_mcp_client import TurnMcpClient, TurnMcpTimeout, TurnMcpCanceled

client = TurnMcpClient("http://127.0.0.1:3737")
reply = client.wait(
    context="计划删除表 `old_users`（32 行，无外键引用）。",
    question="确认执行 DROP TABLE？",
    options=["是，执行", "否，停止", "先显示迁移计划"],
)
```

异步支持与 LangChain/LangGraph 集成示例：[`python-client/README.md`](./python-client/README.md)

---

## 功能列表

- MCP 工具 `turn.wait`（别名：`turn_wait`、`turn`）
- 双传输层：Streamable HTTP 与 stdio
- 浏览器控制台：查看、回复、取消、延长超时
- 侧边栏：上方显示活跃会话，下方显示历史会话（只读预览）
- SSE 实时推送，指数退避重连
- 桌面通知、声音提醒、标题栏闪烁
- 快捷回复模板、Agent 预设选项按钮
- 会话命名（存储于 localStorage）
- 历史持久化（可选 JSONL）
- Webhook：HMAC-SHA256 签名、自动重试（×3）、Slack 格式
- API 鉴权：operator / viewer 角色
- 每 IP 速率限制（滑动窗口）
- 结构化事件日志（可选 JSONL）
- 一键自动配置 8 个 MCP 客户端 + 系统级 Shell/注册表
- i18n：中英双语，运行时切换
- PWA：可安装，Service Worker 后台通知

---

## 环境变量

| 变量 | 默认值 | 说明 |
|---|---|---|
| `TURN_MCP_HTTP_HOST` | `127.0.0.1` | 绑定 IP |
| `TURN_MCP_HTTP_PORT` | `3737` | 绑定端口 |
| `TURN_MCP_HTTP_PATH` | `/mcp` | MCP 端点路径 |
| `TURN_MCP_DEFAULT_TIMEOUT_SECONDS` | `600` | 默认超时（0–3600）|
| `TURN_MCP_API_KEY` | — | operator 密钥 |
| `TURN_MCP_VIEWER_API_KEY` | — | viewer 密钥（只读）|
| `TURN_MCP_REQUIRE_API_KEY` | auto | 启用鉴权（有密钥时自动启用）|
| `TURN_MCP_EVENT_LOG_FILE` | — | 事件日志 JSONL 路径 |
| `TURN_MCP_HISTORY_FILE` | — | 历史 JSONL 路径 |
| `TURN_MCP_WEBHOOK_URL` | — | Webhook 目标 URL |
| `TURN_MCP_WEBHOOK_EVENTS` | `wait_created` | 订阅事件类型（逗号分隔）|
| `TURN_MCP_WEBHOOK_SECRET` | — | HMAC-SHA256 签名密钥 |
| `TURN_MCP_WEBHOOK_FORMAT` | `json` | `json` 或 `slack` |
| `TURN_MCP_RATE_LIMIT_MAX` | `120` | 每 IP 最大请求数 |
| `TURN_MCP_RATE_LIMIT_WINDOW_SECONDS` | `60` | 限流窗口（秒）|
| `TURN_MCP_MAX_CONCURRENT_WAITS_PER_SESSION` | `10` | 每 session 最大并发等待数 |
| `TURN_MCP_REINFORCEMENT_SUFFIX` | （内置）| 每次回复自动追加的内容 |

---

## 鉴权

鉴权默认关闭。设置 `TURN_MCP_API_KEY`（可选设置 `TURN_MCP_VIEWER_API_KEY`）即可开启。每个请求通过以下任一方式传递密钥：

```
x-turn-mcp-api-key: <key>
Authorization: Bearer <key>
```

支持两种角色：

- `operator` — 完整访问：调用 MCP 工具、提交回复、取消等待、读取事件日志
- `viewer` — 只读：查看等待任务、会话历史、订阅 SSE

---

## Webhook 安全（HMAC）

设置 `TURN_MCP_WEBHOOK_SECRET` 后，每次外发的 webhook POST 均用 HMAC-SHA256 签名，签名通过 `x-turn-mcp-signature` 请求头以 `sha256=<hex>` 格式发送。在接收端验证以确保 payload 未被篡改。

```python
import hmac, hashlib

def verify(body: bytes, header: str, secret: str) -> bool:
    expected = "sha256=" + hmac.new(secret.encode(), body, hashlib.sha256).hexdigest()
    return hmac.compare_digest(expected, header)
```

---

## API

所有端点返回 JSON。错误响应包含 `error` 字符串字段。分页端点返回 `total`、`count` 和 `pagination.hasMore`。

| 方法 | 路径 | 鉴权 | 说明 |
|---|---|---|---|
| GET | `/api/public-config` | 无 | 公开配置 |
| GET | `/api/auth-check` | viewer+ | 当前角色 |
| GET | `/api/waits` | viewer+ | 待处理等待 |
| GET | `/api/waits/:id` | viewer+ | 单条等待 |
| GET | `/api/history` | viewer+ | 历史记录 |
| GET | `/api/history/timeline` | viewer+ | Session 时间线 |
| GET | `/api/sessions` | viewer+ | 全部 session 摘要 |
| POST | `/api/waits/:id/respond` | operator | 提交回复 |
| POST | `/api/waits/:id/cancel` | operator | 取消等待 |
| POST | `/api/waits/:id/extend` | operator | 延长超时 |
| POST | `/api/waits/cancel-all` | operator | 取消全部 |
| POST | `/api/waits/create-and-wait` | operator | 长轮询：创建并等待回复 |
| POST | `/api/settings` | operator | 更新运行时设置 |
| POST | `/api/auto-configure` | operator | 写入客户端配置文件 |
| POST | `/api/auto-unconfigure` | operator | 从客户端配置文件中移除 |
| GET | `/api/stream` | viewer+ | SSE 实时事件流 |
| GET | `/api/events` | operator | 事件日志 |
| GET | `/healthz` | 无 | 健康检查 |

---

## 测试

`test:unit` 直接对编译后的 `dist/` 运行，无需启动服务器。`test:ui` 在临时端口启动真实服务器，端到端测试浏览器交互。

```bash
npm test               # 单元测试 + UI 集成测试
npm run test:unit      # 仅 WaitStore 单元测试
npm run test:ui        # UI 集成测试
```

---

## Docker

在容器内运行时需要设置 `TURN_MCP_HTTP_HOST=0.0.0.0` 以便宿主机访问端口。挂载卷到 `/app/logs` 可使历史和事件日志在容器重启后保留。

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

## 架构

整个栈运行在单个 `node dist/server.js` 进程中。`wait-store.ts` 是核心：将待处理的等待保存为内存 Promise，当操作员通过 REST API 回复时解析。SSE 实时将事件推送到浏览器。历史记录可选地持久化到 JSONL 文件以在重启后恢复。

```
src/
  server.ts              HTTP 入口：MCP + REST API + 静态文件
  server-stdio.ts        stdio 入口（供 IDE 客户端使用）
  auto-configure.ts      写入/移除客户端配置文件
  turn-mcp-server.ts     MCP 工具实现
  wait-store.ts          内存状态机（基于 Promise）
  event-log.ts           结构化事件日志
  sse-manager.ts         SSE 广播管理器
  history-persistence.ts JSONL 历史持久化
  webhook.ts             外发 Webhook（HMAC、重试、Slack）
  config.ts              环境配置 + Logger

public/
  app.js                 浏览器控制台（Vanilla JS）
  styles.css             UI 设计系统
  i18n.js                中英双语切换器
  sw.js                  Service Worker（PWA）

python-client/           pip install turn-mcp-client
examples/python/         LangChain、LangGraph 集成示例
```

---

## 许可证

MIT
