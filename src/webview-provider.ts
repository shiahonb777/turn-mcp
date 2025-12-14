import * as vscode from 'vscode';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { MCPServerManager } from './server-manager';

export class CheckpointViewProvider implements vscode.WebviewViewProvider {
  private _view?: vscode.WebviewView;
  private extensionUri: vscode.Uri;
  private serverManager: MCPServerManager;
  private logs: string[] = [];

  constructor(extensionUri: vscode.Uri, serverManager: MCPServerManager) {
    this.extensionUri = extensionUri;
    this.serverManager = serverManager;

    // 设置服务器回调
    this.serverManager.setCallback({
      onStatusChange: () => this.updateStatus(),
      onWaiting: (context, question) => this.showWaitingState(context, question),
      onLog: (message) => this.addLog(message),
    });
  }

  resolveWebviewView(webviewView: vscode.WebviewView) {
    this._view = webviewView;

    webviewView.webview.options = {
      enableScripts: true,
      localResourceRoots: [this.extensionUri],
    };

    // 保持 webview 在隐藏时的状态
    webviewView.onDidChangeVisibility(() => {
      if (webviewView.visible) {
        this.updateStatus();
      }
    });

    webviewView.webview.html = this.getHtmlContent();

    webviewView.webview.onDidReceiveMessage((message) => {
      switch (message.command) {
        case 'submit':
          this.handleSubmit(message.text);
          break;
        case 'autoConfig':
          vscode.commands.executeCommand('turn-mcp.autoConfig');
          break;
        case 'clearConfig':
          vscode.commands.executeCommand('turn-mcp.clearConfig');
          break;
        case 'selectImage':
          this.selectImageFile();
          break;
        case 'removeFromQueue':
          this.serverManager.removeFromQueue(message.index);
          break;
        case 'clearQueue':
          this.serverManager.clearQueue();
          break;
        case 'clearWaiting':
          this.serverManager.clearWaiting();
          break;
        case 'reorderQueue':
          this.serverManager.reorderQueue(message.fromIndex, message.toIndex);
          break;
        case 'copyLogs':
          this.copyLogs();
          break;
        case 'clearLogs':
          this.clearLogs();
          break;
        case 'getStatus':
          this.updateStatus();
          break;
        case 'selectFile':
          this.selectFile();
          break;
        case 'selectDirectory':
          this.selectDirectory();
          break;
        case 'getCodeContext':
          this.getCodeContext();
          break;
        case 'insertRules':
          this.insertRules();
          break;
        case 'pasteImage':
          this.handlePasteImage(message.data, message.type);
          break;
        case 'openUrl':
          if (message.url) {
            vscode.env.openExternal(vscode.Uri.parse(message.url));
          }
          break;
      }
    });

    this.updateStatus();
  }

  private handleSubmit(text: string) {
    if (text.trim()) {
      this.serverManager.submitInput(text);
      this.addLog(`已提交: ${text.substring(0, 50)}...`);
    }
  }

  private async selectImageFile() {
    const result = await vscode.window.showOpenDialog({
      canSelectMany: false,
      filters: {
        'Images': ['png', 'jpg', 'jpeg', 'gif', 'bmp', 'webp', 'svg'],
      },
      title: '选择图片',
    });

    if (result && result.length > 0) {
      const filePath = result[0].fsPath;
      this._view?.webview.postMessage({
        command: 'fileSelected',
        filePath,
      });
      this.addLog(`已附加图片: ${filePath}`);
    }
  }

  private async selectFile() {
    const result = await vscode.window.showOpenDialog({
      canSelectMany: false,
      canSelectFolders: false,
      title: '选择文件',
    });

    if (result && result.length > 0) {
      const filePath = result[0].fsPath;
      this._view?.webview.postMessage({
        command: 'insertText',
        text: `@file: ${filePath} `,
      });
      this.addLog(`已选择文件: ${filePath}`);
    }
  }

  private async selectDirectory() {
    const result = await vscode.window.showOpenDialog({
      canSelectMany: false,
      canSelectFolders: true,
      canSelectFiles: false,
      title: '选择目录',
    });

    if (result && result.length > 0) {
      const dirPath = result[0].fsPath;
      this._view?.webview.postMessage({
        command: 'insertText',
        text: `@directory: ${dirPath} `,
      });
      this.addLog(`已选择目录: ${dirPath}`);
    }
  }

  private getCodeContext() {
    const editor = vscode.window.activeTextEditor;
    if (editor) {
      const filePath = editor.document.uri.fsPath;
      const selection = editor.selection;
      let text = `@codeContext: ${filePath}`;
      if (!selection.isEmpty) {
        text += `:${selection.start.line + 1}-${selection.end.line + 1}`;
      }
      this._view?.webview.postMessage({
        command: 'insertText',
        text: text + ' ',
      });
      this.addLog(`代码上下文: ${filePath}`);
    } else {
      vscode.window.showWarningMessage('请先打开一个文件');
    }
  }

  private async insertRules() {
    const rules = ['全局规则', '项目规则', '代码风格', '命名规范', '注释规范'];
    const selected = await vscode.window.showQuickPick(rules, {
      placeHolder: '选择规则类型',
    });
    if (selected) {
      this._view?.webview.postMessage({
        command: 'insertText',
        text: `@rules: ${selected} `,
      });
      this.addLog(`已选择规则: ${selected}`);
    }
  }

  private async handlePasteImage(base64Data: string, mimeType: string) {
    try {
      const ext = mimeType.split('/')[1] || 'png';
      const fileName = `paste_${Date.now()}.${ext}`;
      const tempDir = path.join(os.tmpdir(), 'turn-mcp-images');
      
      if (!fs.existsSync(tempDir)) {
        fs.mkdirSync(tempDir, { recursive: true });
      }
      
      const filePath = path.join(tempDir, fileName);
      const base64Content = base64Data.replace(/^data:image\/\w+;base64,/, '');
      const buffer = Buffer.from(base64Content, 'base64');
      fs.writeFileSync(filePath, buffer);
      
      this._view?.webview.postMessage({
        command: 'fileSelected',
        filePath,
      });
      this.addLog(`已粘贴图片: ${fileName}`);
    } catch (error) {
      this.addLog(`粘贴图片失败: ${error}`);
    }
  }

  updateStatus() {
    if (this._view) {
      const status = this.serverManager.getStatus();
      const queue = this.serverManager.getQueue();
      this._view.webview.postMessage({
        command: 'updateStatus',
        status,
        queue,
        logs: this.logs.slice(-20), // 最近20条日志
      });
    }
  }

  private showWaitingState(context: string, question?: string) {
    if (this._view) {
      const displayText = question ? `${context}\n\n❓ ${question}` : context;
      this._view.webview.postMessage({
        command: 'showWaiting',
        context: displayText,
      });
      // 聚焦到面板
      this._view.show(true);
    }
  }

  private addLog(message: string) {
    const timestamp = new Date().toLocaleTimeString();
    this.logs.push(`[${timestamp}] ${message}`);
    if (this.logs.length > 100) {
      this.logs.shift();
    }
    this.updateStatus();
  }

  private copyLogs() {
    const logsText = this.logs.join('\n');
    vscode.env.clipboard.writeText(logsText);
    vscode.window.showInformationMessage('日志已复制到剪贴板');
  }

  private clearLogs() {
    this.logs = [];
    this.updateStatus();
  }

  private getHtmlContent(): string {
    return `<!DOCTYPE html>
<html lang="zh-CN">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Turn MCP</title>
  <style>
    * {
      box-sizing: border-box;
      margin: 0;
      padding: 0;
    }
    body {
      font-family: var(--vscode-font-family);
      font-size: var(--vscode-font-size);
      color: var(--vscode-foreground);
      background: var(--vscode-sideBar-background);
      padding: 12px;
      min-height: 100vh;
    }
    .header {
      display: flex;
      align-items: center;
      gap: 8px;
      margin-bottom: 16px;
      padding-bottom: 12px;
      border-bottom: 1px solid var(--vscode-widget-border);
    }
    .status-dot {
      width: 10px;
      height: 10px;
      border-radius: 50%;
      background: var(--vscode-errorForeground);
    }
    .status-dot.running {
      background: var(--vscode-testing-iconPassed);
    }
    .status-dot.waiting {
      background: var(--vscode-editorWarning-foreground);
      animation: pulse 1.5s infinite;
    }
    @keyframes pulse {
      0%, 100% { opacity: 1; }
      50% { opacity: 0.4; }
    }
    .status-text {
      flex: 1;
      font-weight: 500;
    }
    .btn {
      padding: 6px 12px;
      border: none;
      border-radius: 4px;
      cursor: pointer;
      font-size: 12px;
      background: var(--vscode-button-background);
      color: var(--vscode-button-foreground);
    }
    .btn:hover {
      background: var(--vscode-button-hoverBackground);
    }
    .btn-secondary {
      background: var(--vscode-button-secondaryBackground);
      color: var(--vscode-button-secondaryForeground);
    }
    .btn-secondary:hover {
      background: var(--vscode-button-secondaryHoverBackground);
    }
    .section {
      margin-bottom: 16px;
    }
    .section-title {
      font-size: 11px;
      text-transform: uppercase;
      color: var(--vscode-descriptionForeground);
      margin-bottom: 8px;
      letter-spacing: 0.5px;
    }
    .context-box {
      background: var(--vscode-input-background);
      border: 1px solid var(--vscode-input-border);
      border-radius: 4px;
      padding: 12px;
      margin-bottom: 12px;
      white-space: pre-wrap;
      max-height: 150px;
      overflow-y: auto;
      font-size: 13px;
      line-height: 1.5;
    }
    .waiting-indicator {
      display: none;
      background: var(--vscode-inputValidation-warningBackground);
      border: 1px solid var(--vscode-inputValidation-warningBorder);
      border-radius: 4px;
      padding: 12px;
      margin-bottom: 12px;
    }
    .waiting-indicator.show {
      display: block;
    }
    .input-area {
      display: flex;
      flex-direction: column;
      gap: 8px;
    }
    textarea {
      width: 100%;
      min-height: 80px;
      padding: 10px;
      border: 1px solid var(--vscode-input-border);
      border-radius: 4px;
      background: var(--vscode-input-background);
      color: var(--vscode-input-foreground);
      font-family: inherit;
      font-size: 13px;
      resize: vertical;
    }
    textarea:focus {
      outline: none;
      border-color: var(--vscode-focusBorder);
    }
    textarea::placeholder {
      color: var(--vscode-input-placeholderForeground);
    }
    .logs {
      background: var(--vscode-terminal-background);
      border: 1px solid var(--vscode-widget-border);
      border-radius: 4px;
      padding: 8px;
      max-height: 120px;
      overflow-y: auto;
      font-family: var(--vscode-editor-font-family);
      font-size: 11px;
      line-height: 1.4;
    }
    .log-entry {
      color: var(--vscode-terminal-foreground);
      opacity: 0.8;
      cursor: pointer;
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
    }
    .log-entry:hover {
      opacity: 1;
    }
    .log-entry.expanded {
      white-space: pre-wrap;
      word-break: break-all;
    }
    .config-section {
      margin-top: 14px;
      padding: 12px;
      border: 1px solid var(--vscode-widget-border);
      border-radius: 8px;
      font-size: 11px;
      color: var(--vscode-descriptionForeground);
      margin-bottom: 8px;
    }
    .config-hint {
      font-size: 11px;
      color: var(--vscode-descriptionForeground);
      margin-bottom: 8px;
    }
    .hidden {
      display: none !important;
    }
    .btn-row {
      display: flex;
      gap: 8px;
    }
    .btn-row .btn {
      flex: 1;
    }
    .attached-files {
      display: flex;
      flex-wrap: wrap;
      gap: 4px;
      margin-bottom: 8px;
    }
    .attached-file {
      display: inline-flex;
      align-items: center;
      gap: 4px;
      padding: 4px 8px;
      background: var(--vscode-badge-background);
      color: var(--vscode-badge-foreground);
      border-radius: 4px;
      font-size: 11px;
    }
    .attached-file .remove {
      cursor: pointer;
      opacity: 0.7;
    }
    .attached-file .remove:hover {
      opacity: 1;
    }
    .queue-list {
      display: flex;
      flex-direction: column;
      gap: 4px;
    }
    .queue-item {
      display: flex;
      align-items: center;
      gap: 8px;
      padding: 8px;
      background: var(--vscode-input-background);
      border: 1px solid var(--vscode-input-border);
      border-radius: 4px;
      font-size: 12px;
      cursor: pointer;
      user-select: none;
    }
    .queue-item:hover {
      background: var(--vscode-list-hoverBackground);
    }
    .queue-item.dragging {
      opacity: 0.5;
      border: 1px dashed var(--vscode-focusBorder);
    }
    .queue-item .index {
      color: var(--vscode-descriptionForeground);
      font-weight: bold;
      min-width: 20px;
    }
    .queue-item .content {
      flex: 1;
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
    }
    .queue-item.expanded .content {
      white-space: pre-wrap;
      word-break: break-all;
    }
    .queue-item .expand-btn {
      cursor: pointer;
      opacity: 0.5;
      padding: 2px 4px;
      font-size: 10px;
    }
    .queue-item .expand-btn:hover {
      opacity: 1;
    }
    .queue-item .actions {
      display: flex;
      align-items: center;
      gap: 4px;
    }
    .queue-item .drag-handle {
      cursor: grab;
      opacity: 0.5;
      padding: 2px 4px;
      font-size: 10px;
    }
    .queue-item .drag-handle:hover {
      opacity: 1;
    }
    .queue-item .remove {
      cursor: pointer;
      opacity: 0.7;
      padding: 2px 6px;
    }
    .queue-item .remove:hover {
      opacity: 1;
    }
    .btn-small {
      padding: 2px 8px;
      border: none;
      border-radius: 3px;
      cursor: pointer;
      font-size: 10px;
      background: var(--vscode-button-secondaryBackground);
      color: var(--vscode-button-secondaryForeground);
      margin-left: 8px;
    }
    .btn-small:hover {
      background: var(--vscode-button-secondaryHoverBackground);
    }
    /* 输入框容器 */
    .input-wrapper {
      position: relative;
      width: 100%;
    }
    .input-wrapper textarea {
      width: 100%;
      padding-bottom: 32px;
    }
    .plus-menu-container {
      position: absolute;
      left: 6px;
      bottom: 6px;
    }
    .plus-btn {
      width: 24px;
      height: 24px;
      border: none;
      border-radius: 4px;
      background: var(--vscode-button-secondaryBackground);
      color: var(--vscode-foreground);
      cursor: pointer;
      font-size: 16px;
      display: flex;
      align-items: center;
      justify-content: center;
      transition: background 0.15s;
      opacity: 0.7;
    }
    .plus-btn:hover {
      background: var(--vscode-button-secondaryHoverBackground);
      opacity: 1;
    }
    .plus-menu {
      position: absolute;
      bottom: 30px;
      left: 0;
      background: var(--vscode-menu-background);
      border: 1px solid var(--vscode-menu-border);
      border-radius: 6px;
      box-shadow: 0 4px 12px rgba(0,0,0,0.3);
      min-width: 50px;
      display: none;
      z-index: 100;
      overflow: visible;
    }
    .plus-menu.show {
      display: block;
    }
    .menu-item {
      padding: 8px 12px;
      cursor: pointer;
      display: flex;
      align-items: center;
      gap: 8px;
      font-size: 12px;
      color: var(--vscode-menu-foreground);
    }
    .menu-item:hover {
      background: var(--vscode-list-hoverBackground);
    }
    .menu-item .icon {
      width: 16px;
      text-align: center;
    }
    .submenu-container {
      position: relative;
    }
    .submenu {
      position: absolute;
      left: 100%;
      top: 0;
      background: var(--vscode-menu-background);
      border: 1px solid var(--vscode-menu-border);
      border-radius: 6px;
      box-shadow: 0 4px 12px rgba(0,0,0,0.3);
      min-width: 140px;
      display: none;
      z-index: 101;
      margin-left: 4px;
      white-space: nowrap;
    }
    .submenu-container.open .submenu {
      display: block;
    }
    .menu-item.has-submenu::after {
      content: '›';
      margin-left: auto;
      opacity: 0.6;
      font-size: 12px;
    }
    .menu-icon {
      width: 20px;
      height: 20px;
      display: flex;
      align-items: center;
      justify-content: center;
    }
    .menu-icon svg {
      width: 16px;
      height: 16px;
      fill: currentColor;
    }
    .at-symbol {
      font-size: 16px;
      font-weight: bold;
    }
    .action-row {
      display: flex;
      justify-content: flex-end;
      margin-top: 8px;
    }
    .footer {
      margin-top: 16px;
      padding: 10px 12px 12px;
      border-top: 1px solid var(--vscode-widget-border);
      font-size: 12px;
      color: var(--vscode-foreground);
      line-height: 1.6;
    }
    .footer .link-row {
      display: flex;
      flex-wrap: wrap;
      gap: 8px;
      align-items: center;
      margin-top: 6px;
    }
    .footer .btn-mini {
      padding: 4px 8px;
      border-radius: 6px;
      border: 1px solid var(--vscode-button-border, transparent);
      background: var(--vscode-button-secondaryBackground);
      color: var(--vscode-button-secondaryForeground);
      cursor: pointer;
      font-size: 11px;
    }
    .footer .btn-mini:hover {
      background: var(--vscode-button-secondaryHoverBackground);
    }
  </style>
</head>
<body>
  <div class="header">
    <div class="status-dot" id="statusDot"></div>
    <span class="status-text" id="statusText">监控中</span>
  </div>

  <div class="waiting-indicator" id="waitingIndicator">
    <div class="section-title">⏳ 等待输入中... <button class="btn-small" onclick="clearWaiting()">✕ 清除</button></div>
    <div class="context-box" id="contextBox">等待上下文...</div>
  </div>

  <div class="section" id="queueSection" style="display:none">
    <div class="section-title">
      📋 任务队列 <span id="queueCount"></span>
      <button class="btn-small" onclick="clearQueue()">清空</button>
    </div>
    <div class="queue-list" id="queueList"></div>
  </div>

  <div class="section">
    <div class="section-title">输入提示词</div>
    <div class="input-area">
      <div class="input-wrapper">
        <textarea 
          id="inputText" 
          placeholder="输入提示词，Ctrl+Enter 提交..."
        ></textarea>
        <div class="plus-menu-container">
          <button class="plus-btn" onclick="togglePlusMenu(event)">+</button>
          <div class="plus-menu" id="plusMenu">
            <div class="menu-item" onclick="selectImage(); closePlusMenu();">
              <span class="menu-icon"><svg viewBox="0 0 24 24"><path d="M21 19V5c0-1.1-.9-2-2-2H5c-1.1 0-2 .9-2 2v14c0 1.1.9 2 2 2h14c1.1 0 2-.9 2-2zM8.5 13.5l2.5 3.01L14.5 12l4.5 6H5l3.5-4.5z"/></svg></span>
            </div>
            <div class="submenu-container" id="atSubmenu" onclick="toggleAtSubmenu(event)">
              <div class="menu-item has-submenu">
                <span class="at-symbol">@</span>
              </div>
              <div class="submenu">
                <div class="menu-item" onclick="insertAtText('@web '); closePlusMenu();">@web</div>
                <div class="menu-item" onclick="doAction('getCodeContext'); closePlusMenu();">@codeContext:</div>
                <div class="menu-item" onclick="doAction('selectFile'); closePlusMenu();">@file:</div>
                <div class="menu-item" onclick="doAction('selectDirectory'); closePlusMenu();">@directory:</div>
                <div class="menu-item" onclick="doAction('insertRules'); closePlusMenu();">@rules:</div>
              </div>
            </div>
          </div>
        </div>
      </div>
      <div class="attached-files" id="attachedFiles"></div>
      <div class="action-row">
        <button class="btn" onclick="submitInput()">提交 (Ctrl+Enter)</button>
      </div>
    </div>
  </div>

  <div class="section">
    <div class="section-title">
      日志
      <button class="btn-small" onclick="copyLogs()">复制</button>
      <button class="btn-small" onclick="clearLogs()">清空</button>
    </div>
    <div class="logs" id="logs"></div>
  </div>

  <div class="config-section">
    <div class="section-title">MCP 配置</div>
    <div class="config-hint">
      配置或清除 Windsurf 中的 Turn MCP
    </div>
    <div class="btn-row">
      <button class="btn" onclick="autoConfig()">⚡ 一键配置</button>
      <button class="btn btn-secondary" onclick="clearConfig()">🗑️ 清除配置</button>
    </div>
  </div>

  <div class="footer">
    <div>开源地址：</div>
    <div class="link-row">
      <button class="btn-mini" onclick="openExternal('https://github.com/shiahonb777/turn-mcp')">GitHub</button>
      <button class="btn-mini" onclick="openExternal('https://gitee.com/ashiahonb777/turn-mcp')">Gitee（国内直连）</button>
      <button class="btn-mini" onclick="openExternal('https://shiaho.sbs/')">个人站点</button>
    </div>
    <div style="margin-top: 8px;">检查更新 / 下载 VSIX：</div>
    <div class="link-row">
      <button class="btn-mini" onclick="openExternal('https://github.com/shiahonb777/turn-mcp/releases/download/turn-mcp-1.0.0.vsix/turn-mcp-1.0.0.vsix')">GitHub 下载</button>
      <button class="btn-mini" onclick="openExternal('https://gitee.com/ashiahonb777/turn-mcp/releases/download/turn-mcp-1.0.0.vsix/turn-mcp-1.0.0.vsix')">Gitee 直连</button>
    </div>
  </div>

  <script>
    const vscode = acquireVsCodeApi();
    let isRunning = false;
    let isWaiting = false;

    // 恢复之前保存的状态
    const previousState = vscode.getState() || {};
    
    // 初始化
    vscode.postMessage({ command: 'getStatus' });
    
    // 恢复输入框内容
    setTimeout(() => {
      const input = document.getElementById('inputText');
      if (previousState.inputText) {
        input.value = previousState.inputText;
      }
    }, 100);

    // 保存输入框内容
    function saveState() {
      const input = document.getElementById('inputText');
      vscode.setState({ inputText: input.value });
    }

    // 监听输入变化保存状态
    document.addEventListener('DOMContentLoaded', () => {
      const input = document.getElementById('inputText');
      input.addEventListener('input', saveState);
    });

    // 监听消息
    window.addEventListener('message', event => {
      const message = event.data;
      switch (message.command) {
        case 'updateStatus':
          updateUI(message.status, message.queue || [], message.logs);
          break;
        case 'showWaiting':
          showWaiting(message.context);
          break;
        case 'fileSelected':
          addAttachedFile(message.filePath);
          break;
        case 'insertText':
          insertAtText(message.text);
          break;
      }
    });

    function updateUI(status, queue, logs) {
      isRunning = status.running;
      isWaiting = status.waiting;

      const dot = document.getElementById('statusDot');
      const text = document.getElementById('statusText');
      const indicator = document.getElementById('waitingIndicator');

      dot.className = 'status-dot';
      if (isWaiting) {
        dot.classList.add('waiting');
        text.textContent = '等待用户输入...';
      } else if (isRunning) {
        dot.classList.add('running');
        text.textContent = queue.length > 0 ? '监控中 (队列: ' + queue.length + ')' : '监控中';
      } else {
        text.textContent = '未运行';
      }

      if (isWaiting && status.context) {
        indicator.classList.add('show');
        document.getElementById('contextBox').textContent = status.context;
      } else {
        indicator.classList.remove('show');
      }

      // 更新队列显示
      updateQueueUI(queue);

      // 更新日志
      const logsEl = document.getElementById('logs');
      logsEl.innerHTML = logs.map((log, index) => {
        const needExpand = log.length > 60;
        const preview = needExpand ? log.substring(0, 60) + '...' : log;
        return '<div class="log-entry" data-full="' + escapeHtml(log).replace(/"/g, '&quot;') + '" data-preview="' + escapeHtml(preview).replace(/"/g, '&quot;') + '" onclick="toggleLogExpand(this)">' + escapeHtml(preview) + '</div>';
      }).join('');
      logsEl.scrollTop = logsEl.scrollHeight;
    }

    function updateQueueUI(queue) {
      const section = document.getElementById('queueSection');
      const list = document.getElementById('queueList');
      const count = document.getElementById('queueCount');
      
      if (queue.length === 0) {
        section.style.display = 'none';
        return;
      }
      
      section.style.display = 'block';
      count.textContent = '(' + queue.length + ')';
      
      list.innerHTML = queue.map((item, index) => {
        const needExpand = item.length > 50;
        const preview = needExpand ? item.substring(0, 50) + '...' : item;
        return '<div class="queue-item" draggable="true" data-index="' + index + '" data-content="' + escapeHtml(item).replace(/"/g, '&quot;') + '" data-preview="' + escapeHtml(preview).replace(/"/g, '&quot;') + '" ondblclick="recoverToInput(' + index + ')" ondragstart="handleDragStart(event, ' + index + ')" ondragover="handleDragOver(event)" ondrop="handleDrop(event, ' + index + ')" ondragend="handleDragEnd(event)">' +
          '<span class="index">#' + (index + 1) + '</span>' +
          '<span class="content">' + escapeHtml(preview) + '</span>' +
          '<span class="actions">' +
            (needExpand ? '<span class="expand-btn" onclick="event.stopPropagation(); toggleQueueExpand(' + index + ')" title="展开/收起">▼</span>' : '') +
            '<span class="drag-handle" title="拖拽排序">≡</span>' +
            '<span class="remove" onclick="event.stopPropagation(); removeFromQueue(' + index + ')" title="删除">✕</span>' +
          '</span>' +
          '</div>';
      }).join('');
    }

    function removeFromQueue(index) {
      vscode.postMessage({ command: 'removeFromQueue', index });
    }

    function recoverToInput(index) {
      const item = document.querySelector('.queue-item[data-index="' + index + '"]');
      if (item) {
        const content = item.getAttribute('data-content');
        const input = document.getElementById('inputText');
        input.value = content;
        input.focus();
        vscode.postMessage({ command: 'removeFromQueue', index });
      }
    }

    let draggedIndex = null;

    function handleDragStart(e, index) {
      draggedIndex = index;
      e.target.classList.add('dragging');
      e.dataTransfer.effectAllowed = 'move';
    }

    function handleDragOver(e) {
      e.preventDefault();
      e.dataTransfer.dropEffect = 'move';
    }

    function handleDrop(e, targetIndex) {
      e.preventDefault();
      if (draggedIndex !== null && draggedIndex !== targetIndex) {
        vscode.postMessage({ command: 'reorderQueue', fromIndex: draggedIndex, toIndex: targetIndex });
      }
    }

    function handleDragEnd(e) {
      e.target.classList.remove('dragging');
      draggedIndex = null;
    }

    function toggleQueueExpand(index) {
      const item = document.querySelector('.queue-item[data-index="' + index + '"]');
      if (item) {
        const content = item.querySelector('.content');
        const btn = item.querySelector('.expand-btn');
        if (item.classList.contains('expanded')) {
          item.classList.remove('expanded');
          content.textContent = item.getAttribute('data-preview');
          btn.textContent = '▼';
        } else {
          item.classList.add('expanded');
          content.textContent = item.getAttribute('data-content');
          btn.textContent = '▲';
        }
      }
    }

    function toggleLogExpand(el) {
      if (el.classList.contains('expanded')) {
        el.classList.remove('expanded');
        el.textContent = el.getAttribute('data-preview');
      } else {
        el.classList.add('expanded');
        el.textContent = el.getAttribute('data-full');
      }
    }

    function clearQueue() {
      vscode.postMessage({ command: 'clearQueue' });
    }

    function clearWaiting() {
      vscode.postMessage({ command: 'clearWaiting' });
    }

    function copyLogs() {
      vscode.postMessage({ command: 'copyLogs' });
    }

    function clearLogs() {
      vscode.postMessage({ command: 'clearLogs' });
    }

    function openExternal(url) {
      if (!url) return;
      vscode.postMessage({ command: 'openUrl', url });
    }

    function showWaiting(context) {
      isWaiting = true;
      const indicator = document.getElementById('waitingIndicator');
      indicator.classList.add('show');
      document.getElementById('contextBox').textContent = context;
      document.getElementById('inputText').focus();
    }

    let attachedFiles = []; // { path: string }

    function submitInput() {
      const input = document.getElementById('inputText');
      let text = input.value.trim();
      
      // 附加图片文件路径，让 AI 用 read_file 工具查看
      if (attachedFiles.length > 0) {
        const imagePaths = attachedFiles.map((f, i) => {
          return '[图片' + (i + 1) + ']: ' + f.path;
        }).join('\\n');
        text = text + '\\n\\n[附加图片 - 请使用 read_file 工具查看]:\\n' + imagePaths;
      }
      
      if (text) {
        vscode.postMessage({ command: 'submit', text });
        input.value = '';
        attachedFiles = [];
        updateAttachedFilesUI();
        saveState();
      }
    }

    function selectImage() {
      vscode.postMessage({ command: 'selectImage' });
    }

    function togglePlusMenu(e) {
      e.stopPropagation();
      const menu = document.getElementById('plusMenu');
      menu.classList.toggle('show');
    }

    function closePlusMenu() {
      document.getElementById('plusMenu').classList.remove('show');
      document.getElementById('atSubmenu').classList.remove('open');
    }

    function toggleAtSubmenu(e) {
      e.stopPropagation();
      document.getElementById('atSubmenu').classList.toggle('open');
    }

    function insertAtText(text) {
      const input = document.getElementById('inputText');
      const start = input.selectionStart;
      const end = input.selectionEnd;
      const value = input.value;
      input.value = value.substring(0, start) + text + value.substring(end);
      input.selectionStart = input.selectionEnd = start + text.length;
      input.focus();
    }

    function doAction(action) {
      vscode.postMessage({ command: action });
    }

    // 点击其他地方关闭菜单
    document.addEventListener('click', () => closePlusMenu());

    function addAttachedFile(filePath) {
      attachedFiles.push({ path: filePath });
      updateAttachedFilesUI();
    }

    function removeAttachedFile(index) {
      attachedFiles.splice(index, 1);
      updateAttachedFilesUI();
    }

    function updateAttachedFilesUI() {
      const container = document.getElementById('attachedFiles');
      if (attachedFiles.length === 0) {
        container.innerHTML = '';
        return;
      }
      container.innerHTML = attachedFiles.map((file, index) => {
        const fileName = file.path.split(/[\\\\/]/).pop();
        return '<div class="attached-file">' +
          '<span>📷 ' + escapeHtml(fileName) + '</span>' +
          '<span class="remove" onclick="removeAttachedFile(' + index + ')">✕</span>' +
          '</div>';
      }).join('');
    }

    function autoConfig() {
      vscode.postMessage({ command: 'autoConfig' });
    }

    function clearConfig() {
      vscode.postMessage({ command: 'clearConfig' });
    }

    function escapeHtml(text) {
      const div = document.createElement('div');
      div.textContent = text;
      return div.innerHTML;
    }

    // 快捷键
    document.getElementById('inputText').addEventListener('keydown', e => {
      if (e.ctrlKey && e.key === 'Enter') {
        e.preventDefault();
        submitInput();
      }
    });

    // 图片粘贴
    document.getElementById('inputText').addEventListener('paste', e => {
      const items = e.clipboardData?.items;
      if (!items) return;
      
      for (let i = 0; i < items.length; i++) {
        if (items[i].type.indexOf('image') !== -1) {
          e.preventDefault();
          const blob = items[i].getAsFile();
          if (blob) {
            const reader = new FileReader();
            reader.onload = function(event) {
              const base64 = event.target.result;
              vscode.postMessage({ 
                command: 'pasteImage', 
                data: base64,
                type: blob.type
              });
            };
            reader.readAsDataURL(blob);
          }
          break;
        }
      }
    });
  </script>
</body>
</html>`;
  }
}
