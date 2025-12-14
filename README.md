# Turn MCP

中文 | [English](./README_EN.md)

一个 VSCode/Windsurf 插件，通过 MCP 协议实现 AI 对话“卡点”功能，单次请求内支持多轮交互，节省 API 请求次数。

<div align="center" style="margin: 6px 0 18px;">
  <p style="margin: 0 0 6px; font-size: 14px; color: #374151;">MCP 协议让 AI 在一次 API 内完成多轮交互</p>
  <p style="margin: 0 0 10px;">
    <a href="https://github.com/shiahonb777/turn-mcp" target="_blank" rel="noreferrer noopener" style="text-decoration: none; margin-right: 6px;">
      <img alt="GitHub Stars" src="https://img.shields.io/github/stars/shiahonb777/turn-mcp?style=social" />
    </a>
    <a href="https://github.com/shiahonb777/turn-mcp/blob/main/LICENSE" target="_blank" rel="noreferrer noopener" style="text-decoration: none;">
      <img alt="License" src="https://img.shields.io/badge/License-MIT-blue" />
    </a>
  </p>
  <p style="margin: 0; font-size: 14px; color: #1f2937;">
    链接：
    <a href="https://github.com/shiahonb777/turn-mcp" target="_blank" rel="noreferrer noopener">GitHub</a> |
    <a href="https://gitee.com/ashiahonb777/turn-mcp" target="_blank" rel="noreferrer noopener">Gitee（国内直连）</a> |
    <a href="https://shiaho.sbs/" target="_blank" rel="noreferrer noopener">官网</a>
  </p>
</div>

## B站首页

<div align="center">
  <div style="max-width: 170px; width: 100%; padding: 8px 8px 10px; border-radius: 12px; background: linear-gradient(135deg, #fff7f0, #f1f7ff); box-shadow: 0 6px 14px rgba(0,0,0,0.06); border: 1px solid #efe8ff;">
    <p style="margin: 0 0 6px; font-weight: 800; font-size: 12px; letter-spacing: 0.05px; color: #1f2937;">🎬 B站 · shiaho</p>
    <a href="https://b23.tv/4AS5vB4" target="_blank" rel="noreferrer noopener" style="text-decoration: none; color: inherit;">
      <img src="./images/b站首页.png" alt="B站主页 - shiaho" style="width: 75%; max-width: 140px; margin: 2px auto 4px; display: block; border-radius: 10px; border: 1px solid #ececec;" />
    </a>
    <p style="margin: 4px 0 2px; color: #374151; font-size: 10px;">295 粉丝 · 2 投稿 · 1098 获赞</p>
    <p style="margin: 2px 0 0; font-size: 10px; color: #4b5563;">作者 B 站主页</p>
    <p style="margin: 6px 0 0;">
      <a href="https://b23.tv/4AS5vB4" target="_blank" rel="noreferrer noopener" style="display: inline-block; padding: 5px 9px; border-radius: 999px; background: #ff6aa2; color: #fff; font-weight: 700; font-size: 10px; text-decoration: none; box-shadow: 0 5px 12px rgba(255,106,162,0.18);">
        🔗 访问主页
      </a>
    </p>
  </div>
</div>

## 功能特性

- **多轮对话**：单次 API 请求内实现多轮交互
- **任务队列**：支持消息排队、拖拽排序、双击回收
- **快捷插入**：`@web`、`@file:`、`@directory:`、`@codeContext:`、`@rules:`
- **图片支持**：支持选择图片和剪贴板粘贴图片
- **状态持久化**：切换视图时保持输入内容
- **一键配置**：自动配置 MCP 服务器和 Rules

## 工作原理

```
用户请求 → AI处理 → 调用turn工具 → 等待用户输入 → 用户提交 → AI继续处理 → ...
```

1. AI 在处理过程中调用 `turn` 工具
2. MCP 服务器阻塞等待，IDE 插件检测到等待状态
3. 用户在插件面板输入新的提示词并提交
4. MCP 服务器收到输入，返回给 AI 继续处理
5. 整个过程在 **一次 API 请求** 内完成

## 安装

### 方式一：从源码安装

```bash
git clone https://github.com/Shiahonb777/turn-mcp.git
cd turn-mcp
npm install
npm run compile
```

然后在 VSCode/Windsurf 中按 F5 启动调试模式。

### 方式二：安装 VSIX

```bash
npm run package
```

生成 `turn-mcp-1.0.0.vsix`，在 VSCode/Windsurf 中选择 "从 VSIX 安装"。

## 配置

### 一键配置（推荐）

安装插件后，点击侧边栏 Turn MCP 面板中的 **⚡ 一键配置** 按钮，自动完成：
- MCP 服务器配置
- Rules 提示词注入

### 手动配置

编辑 `~/.codeium/windsurf/mcp_config.json`：

```json
{
  "mcpServers": {
    "turn-mcp": {
      "command": "node",
      "args": ["<插件安装路径>/dist/mcp-server.js"]
    }
  }
}
```

## 使用方法

### 基本操作

1. **启动插件**：点击活动栏的 Turn MCP 图标打开面板
2. **等待卡点**：当 AI 调用 `turn` 工具时，面板显示等待状态
3. **输入提示词**：在文本框中输入内容
4. **提交**：点击"提交"按钮或按 `Ctrl+Enter`
5. **继续对话**：AI 收到输入后继续处理

### 快捷功能

点击输入框左下角的 **+** 按钮：

| 功能 | 说明 |
|------|------|
| 📷 图片 | 选择图片文件附加 |
| @web | 插入 `@web` 标记 |
| @file: | 打开文件选择器，插入文件路径 |
| @directory: | 打开目录选择器，插入目录路径 |
| @codeContext: | 插入当前编辑器文件和选中行号 |
| @rules: | 选择并插入规则类型 |

### 任务队列

- **双击**：将队列中的任务回收到输入框
- **拖拽**：调整任务顺序
- **展开**：点击 ▼ 查看完整内容

### 其他操作

- **粘贴图片**：在输入框中直接 `Ctrl+V` 粘贴剪贴板图片
- **清除等待**：点击等待状态指示器中的"✕ 清除"按钮

## AI 使用指南

`turn` 工具参数：
- **`context`** (必填): 当前进度摘要
- **`question`** (可选): 询问用户的问题

示例场景：
- 创建新文件后 → 调用 `turn` 询问是否继续
- 完成功能模块后 → 调用 `turn` 汇报进度
- 遇到多个方案时 → 调用 `turn` 让用户选择

## 开发

```bash
npm install      # 安装依赖
npm run compile  # 编译
npm run watch    # 监听模式
npm run bundle   # 打包 MCP 服务器
npm run package  # 打包 VSIX
```

## 技术栈

- **TypeScript** - 主语言
- **VSCode Extension API** - 插件框架
- **@modelcontextprotocol/sdk** - MCP 协议
- **文件系统 IPC** - 进程间通信

## 许可证

MIT
