# Turn MCP

[中文](./README.md) | English

A VSCode/Windsurf extension that implements AI conversation "checkpoint" functionality through the MCP protocol, enabling multi-turn interactions within a single API request.

## Bilibili Profile

<div align="center">
  <div style="max-width: 320px; width: 100%; padding: 12px 12px 14px; border-radius: 14px; background: linear-gradient(135deg, #fff7f0, #f1f7ff); box-shadow: 0 8px 20px rgba(0,0,0,0.07); border: 1px solid #efe8ff;">
    <p style="margin: 0 0 8px; font-weight: 800; font-size: 16px; letter-spacing: 0.1px; color: #1f2937;">🎬 Bilibili · shiaho</p>
    <a href="https://b23.tv/4AS5vB4" target="_blank" rel="noreferrer noopener" style="text-decoration: none; color: inherit;">
      <img src="./images/b站首页.png" alt="Bilibili Profile - shiaho" style="width: 80%; max-width: 260px; margin: 2px auto 6px; display: block; border-radius: 12px; border: 1px solid #ececec;" />
    </a>
    <p style="margin: 6px 0 3px; color: #374151; font-size: 12px;">295 Followers · 2 Posts · 1098 Likes</p>
    <p style="margin: 4px 0 0; font-size: 11px; color: #4b5563;">Author's Bilibili profile</p>
    <p style="margin: 8px 0 0;">
      <a href="https://b23.tv/4AS5vB4" target="_blank" rel="noreferrer noopener" style="display: inline-block; padding: 6px 11px; border-radius: 999px; background: #ff6aa2; color: #fff; font-weight: 700; font-size: 11px; text-decoration: none; box-shadow: 0 6px 14px rgba(255,106,162,0.2);">
        🔗 Visit Profile
      </a>
    </p>
  </div>
</div>

## Features

- **Multi-turn Dialogue**: Multiple interactions within a single API request
- **Task Queue**: Message queuing, drag-and-drop reordering, double-click to recover
- **Quick Insert**: `@web`, `@file:`, `@directory:`, `@codeContext:`, `@rules:`
- **Image Support**: File selection and clipboard paste
- **State Persistence**: Preserves input content when switching views
- **One-click Setup**: Auto-configure MCP server and Rules

## How It Works

```
User Request → AI Processing → Call turn tool → Wait for Input → User Submit → AI Continues → ...
```

1. AI calls the `turn` tool during processing
2. MCP server blocks waiting, IDE extension detects waiting state
3. User inputs new prompt in the extension panel and submits
4. MCP server receives input, returns to AI for continued processing
5. The entire process completes within **one API request**

## Installation

### Option 1: From Source

```bash
git clone https://github.com/Shiahonb777/turn-mcp.git
cd turn-mcp
npm install
npm run compile
```

Then press F5 in VSCode/Windsurf to start debug mode.

### Option 2: Install VSIX

```bash
npm run package
```

This generates `turn-mcp-1.0.0.vsix`, install via "Install from VSIX" in VSCode/Windsurf.

## Configuration

### One-click Setup (Recommended)

After installation, click the **⚡ One-click Setup** button in the Turn MCP sidebar panel to automatically:
- Configure MCP server
- Inject Rules prompt

### Manual Configuration

Edit `~/.codeium/windsurf/mcp_config.json`:

```json
{
  "mcpServers": {
    "turn-mcp": {
      "command": "node",
      "args": ["<extension-path>/dist/mcp-server.js"]
    }
  }
}
```

## Usage

### Basic Operations

1. **Open Extension**: Click the Turn MCP icon in the activity bar
2. **Wait for Checkpoint**: Panel shows waiting state when AI calls `turn` tool
3. **Input Prompt**: Enter content in the text area
4. **Submit**: Click "Submit" button or press `Ctrl+Enter`
5. **Continue Dialogue**: AI receives input and continues processing

### Quick Features

Click the **+** button at the bottom-left of the input box:

| Feature | Description |
|---------|-------------|
| 📷 Image | Select image file to attach |
| @web | Insert `@web` marker |
| @file: | Open file picker, insert file path |
| @directory: | Open folder picker, insert directory path |
| @codeContext: | Insert current editor file and selected lines |
| @rules: | Select and insert rule type |

### Task Queue

- **Double-click**: Recover task from queue to input box
- **Drag**: Reorder tasks
- **Expand**: Click ▼ to view full content

### Other Operations

- **Paste Image**: `Ctrl+V` to paste clipboard image directly in input box
- **Clear Waiting**: Click "✕ Clear" button in the waiting indicator

## AI Usage Guide

`turn` tool parameters:
- **`context`** (required): Current progress summary
- **`question`** (optional): Question to ask the user

Example scenarios:
- After creating a new file → Call `turn` to ask if continue
- After completing a feature → Call `turn` to report progress
- When facing multiple options → Call `turn` to let user choose

## Development

```bash
npm install      # Install dependencies
npm run compile  # Compile
npm run watch    # Watch mode
npm run bundle   # Bundle MCP server
npm run package  # Package VSIX
```

## Tech Stack

- **TypeScript** - Primary language
- **VSCode Extension API** - Extension framework
- **@modelcontextprotocol/sdk** - MCP protocol
- **File System IPC** - Inter-process communication

## License

MIT
