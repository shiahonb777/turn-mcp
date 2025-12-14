import * as vscode from 'vscode';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';

// 通信文件目录
const COMM_DIR = path.join(os.tmpdir(), 'turn-mcp');
const STATUS_FILE = path.join(COMM_DIR, 'status.json');
const INPUT_FILE = path.join(COMM_DIR, 'input.txt');

export interface ServerStatus {
  running: boolean;
  waiting: boolean;
  context: string | null;
  question?: string;
}

export interface ServerStatusCallback {
  onStatusChange: (status: ServerStatus) => void;
  onWaiting: (context: string, question?: string) => void;
  onLog: (message: string) => void;
}

export class MCPServerManager {
  private extensionContext: vscode.ExtensionContext;
  private status: ServerStatus = {
    running: false,
    waiting: false,
    context: null,
  };
  private callback: ServerStatusCallback | null = null;
  private pollTimer: NodeJS.Timeout | null = null;
  private messageQueue: string[] = [];
  private isSending: boolean = false;

  constructor(context: vscode.ExtensionContext) {
    this.extensionContext = context;
    this.ensureCommDir();
  }

  private ensureCommDir() {
    if (!fs.existsSync(COMM_DIR)) {
      fs.mkdirSync(COMM_DIR, { recursive: true });
    }
  }

  // 清理旧的状态文件
  private clearOldStatus() {
    try {
      if (fs.existsSync(STATUS_FILE)) {
        fs.unlinkSync(STATUS_FILE);
      }
      if (fs.existsSync(INPUT_FILE)) {
        fs.unlinkSync(INPUT_FILE);
      }
    } catch {
      // 忽略错误
    }
  }

  setCallback(callback: ServerStatusCallback) {
    this.callback = callback;
  }

  getStatus(): ServerStatus {
    return { ...this.status };
  }

  async start(): Promise<void> {
    this.ensureCommDir();
    this.clearOldStatus(); // 清理旧状态
    this.startPolling();
    this.updateStatus({ running: true, waiting: false, context: null });
    this.log('Turn MCP 监控已启动');
  }

  async stop(): Promise<void> {
    this.stopPolling();
    this.updateStatus({ running: false, waiting: false, context: null });
    this.log('Turn MCP 监控已停止');
  }

  private startPolling() {
    if (this.pollTimer) {
      return;
    }

    this.pollTimer = setInterval(() => {
      this.checkStatus();
    }, 500);
  }

  private stopPolling() {
    if (this.pollTimer) {
      clearInterval(this.pollTimer);
      this.pollTimer = null;
    }
  }

  private checkStatus() {
    try {
      if (fs.existsSync(STATUS_FILE)) {
        const content = fs.readFileSync(STATUS_FILE, 'utf-8');
        const data = JSON.parse(content);
        
        const wasWaiting = this.status.waiting;
        const isNowWaiting = data.waiting === true;

        if (isNowWaiting && !wasWaiting) {
          // 新进入等待状态
          this.updateStatus({
            running: true,
            waiting: true,
            context: data.context || '',
            question: data.question,
          });
          this.callback?.onWaiting(data.context || '', data.question);
          this.log(`进入等待状态: ${data.context?.substring(0, 50)}...`);
          
          // 检查队列是否有待发送的消息，且当前没有正在发送
          if (this.messageQueue.length > 0 && !this.isSending) {
            this.log(`队列中有 ${this.messageQueue.length} 条消息，自动发送第一条`);
            this.sendNextFromQueue();
          }
        } else if (!isNowWaiting && wasWaiting) {
          // 结束等待状态
          this.isSending = false;
          this.updateStatus({
            running: true,
            waiting: false,
            context: null,
          });
          this.log('等待状态已结束');
        }
      }
    } catch {
      // 文件可能不存在或格式错误，忽略
    }
  }

  // 添加消息到队列
  addToQueue(input: string): void {
    this.messageQueue.push(input);
    this.log(`添加到队列: ${input.substring(0, 50)}... (队列长度: ${this.messageQueue.length})`);
    this.callback?.onStatusChange(this.status);
    
    // 如果当前正在等待，立即发送
    if (this.status.waiting) {
      this.sendNextFromQueue();
    }
  }

  // 从队列发送下一条消息
  private sendNextFromQueue(): boolean {
    if (this.messageQueue.length === 0 || this.isSending) {
      return false;
    }

    this.isSending = true;
    const nextMessage = this.messageQueue.shift()!;
    try {
      this.ensureCommDir();
      fs.writeFileSync(INPUT_FILE, nextMessage, 'utf-8');
      this.log(`从队列发送: ${nextMessage.substring(0, 50)}... (剩余: ${this.messageQueue.length})`);
      this.callback?.onStatusChange(this.status);
      return true;
    } catch (error) {
      this.log(`发送失败: ${error}`);
      this.messageQueue.unshift(nextMessage);
      this.isSending = false;
      return false;
    }
  }

  // 用户直接提交输入
  submitInput(input: string): boolean {
    if (!this.status.waiting || this.isSending) {
      // 不在等待状态或正在发送中，添加到队列
      this.addToQueue(input);
      return true;
    }

    try {
      this.isSending = true;
      this.ensureCommDir();
      fs.writeFileSync(INPUT_FILE, input, 'utf-8');
      this.log(`用户输入已提交: ${input.substring(0, 50)}...`);
      return true;
    } catch (error) {
      this.log(`提交输入失败: ${error}`);
      this.isSending = false;
      return false;
    }
  }

  // 获取队列内容
  getQueue(): string[] {
    return [...this.messageQueue];
  }

  // 移除队列中的某一项
  removeFromQueue(index: number): void {
    if (index >= 0 && index < this.messageQueue.length) {
      this.messageQueue.splice(index, 1);
      this.log(`从队列移除项 ${index} (剩余: ${this.messageQueue.length})`);
      this.callback?.onStatusChange(this.status);
    }
  }

  // 清空队列
  clearQueue(): void {
    this.messageQueue = [];
    this.log('队列已清空');
    this.callback?.onStatusChange(this.status);
  }

  // 重新排序队列
  reorderQueue(fromIndex: number, toIndex: number): void {
    if (fromIndex >= 0 && fromIndex < this.messageQueue.length && 
        toIndex >= 0 && toIndex < this.messageQueue.length) {
      const item = this.messageQueue.splice(fromIndex, 1)[0];
      this.messageQueue.splice(toIndex, 0, item);
      this.log(`队列排序: ${fromIndex + 1} → ${toIndex + 1}`);
      this.callback?.onStatusChange(this.status);
    }
  }

  // 清除等待状态
  clearWaiting(): void {
    try {
      // 标记为取消等待，供 mcp-server 检测后退出 waitForInput
      this.ensureCommDir();
      fs.writeFileSync(
        STATUS_FILE,
        JSON.stringify(
          { waiting: false, canceled: true, context: null, timestamp: Date.now() },
          null,
          2
        ),
        'utf-8'
      );

      // 重置内部状态
      this.isSending = false;
      this.updateStatus({
        running: true,
        waiting: false,
        context: null,
      });
      this.log('已清除等待状态（已通知服务器取消等待）');
    } catch (error) {
      this.log(`清除等待状态失败: ${error}`);
    }
  }

  private updateStatus(newStatus: ServerStatus) {
    this.status = newStatus;
    this.callback?.onStatusChange(this.status);
  }

  private log(message: string) {
    console.log(`[MCPServerManager] ${message}`);
    this.callback?.onLog(message);
  }

  getServerConfigPath(): string {
    return path.join(this.extensionContext.extensionPath, 'dist', 'mcp-server.js');
  }

  getCommDir(): string {
    return COMM_DIR;
  }

  // 生成MCP配置，供用户添加到Windsurf
  getMCPConfig(): object {
    return {
      mcpServers: {
        'turn-mcp': {
          command: 'node',
          args: [this.getServerConfigPath()],
        },
      },
    };
  }

  // 获取Windsurf配置路径
  private getWindsurfConfigPath(): string {
    const homeDir = os.homedir();
    return path.join(homeDir, '.codeium', 'windsurf', 'mcp_config.json');
  }

  // 获取Windsurf全局rules路径
  private getWindsurfRulesPath(): string {
    const homeDir = os.homedir();
    return path.join(homeDir, '.codeium', 'windsurf', 'memories', 'global_rules.md');
  }

  // turn提示词规则
  private getCheckpointRules(): string {
    return `
## Turn MCP 使用规则

**【最高优先级规则 - 必须无条件遵守】**

你**必须**在**每一次回复的最后**调用 \`turn\` 工具，**无论回复内容是什么**。这是强制性的，没有例外。

### 强制执行场景

| 场景 | 操作 |
|------|------|
| 回复任何问题后 | 必须调用 turn |
| 完成任务后 | 必须调用 turn |
| 执行代码修改后 | 必须调用 turn |
| 遇到错误或问题时 | 必须调用 turn |
| 任何情况 | 必须调用 turn |

### 调用格式

\`\`\`
turn 工具参数：
- context (必填): 简要描述你刚完成的工作
- question (可选): 询问用户下一步想做什么
\`\`\`

### 为什么要这样做

调用 \`turn\` 工具后，执行会暂停等待用户输入新的提示词。用户输入后，你会收到新的指令继续工作。这样可以在**单次API请求**内实现**多轮对话**，大幅节省API调用次数。

### 注意事项

- 不要在回复中说"我将调用turn"，直接调用即可
- context 参数要简洁，不要重复整个回复内容
- 如果用户没有新指令，他们会输入"继续"或类似内容
`;
  }

  // 一键配置MCP和Rules到Windsurf
  async autoConfigureMCP(): Promise<{ success: boolean; message: string }> {
    const configPath = this.getWindsurfConfigPath();
    const rulesPath = this.getWindsurfRulesPath();
    const serverPath = this.getServerConfigPath();

    try {
      // 1. 配置MCP服务器
      const configDir = path.dirname(configPath);
      if (!fs.existsSync(configDir)) {
        fs.mkdirSync(configDir, { recursive: true });
      }

      let config: { mcpServers?: Record<string, unknown> } = {};
      if (fs.existsSync(configPath)) {
        const content = fs.readFileSync(configPath, 'utf-8');
        try {
          config = JSON.parse(content);
        } catch {
          const backupPath = configPath + '.backup';
          fs.copyFileSync(configPath, backupPath);
          this.log(`原MCP配置文件格式错误，已备份到: ${backupPath}`);
        }
      }

      if (!config.mcpServers) {
        config.mcpServers = {};
      }

      config.mcpServers['turn-mcp'] = {
        command: 'node',
        args: [serverPath],
      };

      fs.writeFileSync(configPath, JSON.stringify(config, null, 2), 'utf-8');
      this.log(`MCP配置已写入: ${configPath}`);

      // 2. 注入Rules提示词
      const rulesDir = path.dirname(rulesPath);
      if (!fs.existsSync(rulesDir)) {
        fs.mkdirSync(rulesDir, { recursive: true });
      }

      const checkpointRules = this.getCheckpointRules();
      const ruleMarker = '## Turn MCP 使用规则';

      let existingRules = '';
      if (fs.existsSync(rulesPath)) {
        existingRules = fs.readFileSync(rulesPath, 'utf-8');
      }

      // 检查是否已存在checkpoint规则，避免重复添加
      if (!existingRules.includes(ruleMarker)) {
        const newRules = existingRules + '\n' + checkpointRules;
        fs.writeFileSync(rulesPath, newRules, 'utf-8');
        this.log(`Rules已注入: ${rulesPath}`);
      } else {
        this.log('Rules已存在，跳过注入');
      }

      return {
        success: true,
        message: `配置成功！\n\n✅ MCP配置: ${configPath}\n✅ Rules注入: ${rulesPath}\n✅ 服务器: ${serverPath}\n\n请重启Windsurf以生效。`,
      };
    } catch (error) {
      const errMsg = error instanceof Error ? error.message : String(error);
      this.log(`配置失败: ${errMsg}`);
      return {
        success: false,
        message: `配置失败: ${errMsg}`,
      };
    }
  }

  // 检查MCP是否已配置
  isMCPConfigured(): boolean {
    const configPath = this.getWindsurfConfigPath();
    if (!fs.existsSync(configPath)) {
      return false;
    }

    try {
      const content = fs.readFileSync(configPath, 'utf-8');
      const config = JSON.parse(content);
      return !!config?.mcpServers?.['turn-mcp'];
    } catch {
      return false;
    }
  }

  // 一键清除MCP配置和Rules
  async clearMCPConfig(): Promise<{ success: boolean; message: string }> {
    const configPath = this.getWindsurfConfigPath();
    const rulesPath = this.getWindsurfRulesPath();
    const results: string[] = [];

    try {
      // 1. 清除MCP服务器配置
      if (fs.existsSync(configPath)) {
        const content = fs.readFileSync(configPath, 'utf-8');
        try {
          const config = JSON.parse(content);
          if (config?.mcpServers?.['turn-mcp']) {
            delete config.mcpServers['turn-mcp'];
            fs.writeFileSync(configPath, JSON.stringify(config, null, 2), 'utf-8');
            results.push('✅ 已移除Turn MCP配置');
            this.log(`已从MCP配置中移除: ${configPath}`);
          } else {
            results.push('ℹ️ MCP配置中未找到turn-mcp');
          }
        } catch {
          results.push('⚠️ MCP配置文件格式错误，跳过');
        }
      } else {
        results.push('ℹ️ MCP配置文件不存在');
      }

      // 2. 清除Rules中的checkpoint规则
      if (fs.existsSync(rulesPath)) {
        let rulesContent = fs.readFileSync(rulesPath, 'utf-8');
        const ruleMarker = '## Turn MCP 使用规则';
        
        if (rulesContent.includes(ruleMarker)) {
          // 找到并移除checkpoint规则部分
          const startIndex = rulesContent.indexOf(ruleMarker);
          // 查找下一个 ## 标题或文件结尾
          const afterMarker = rulesContent.substring(startIndex + ruleMarker.length);
          const nextSectionMatch = afterMarker.match(/\n## /);
          
          let endIndex: number;
          if (nextSectionMatch && nextSectionMatch.index !== undefined) {
            endIndex = startIndex + ruleMarker.length + nextSectionMatch.index;
          } else {
            endIndex = rulesContent.length;
          }
          
          // 移除该部分
          const before = rulesContent.substring(0, startIndex).trimEnd();
          const after = rulesContent.substring(endIndex);
          rulesContent = before + after;
          
          fs.writeFileSync(rulesPath, rulesContent, 'utf-8');
          results.push('✅ 已移除Rules中的turn规则');
          this.log(`已从Rules中移除: ${rulesPath}`);
        } else {
          results.push('ℹ️ Rules中未找到turn规则');
        }
      } else {
        results.push('ℹ️ Rules文件不存在');
      }

      return {
        success: true,
        message: `清除完成！\n\n${results.join('\n')}\n\n请重启Windsurf以生效。`,
      };
    } catch (error) {
      const errMsg = error instanceof Error ? error.message : String(error);
      this.log(`清除配置失败: ${errMsg}`);
      return {
        success: false,
        message: `清除失败: ${errMsg}`,
      };
    }
  }
}
