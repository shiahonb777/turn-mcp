import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from '@modelcontextprotocol/sdk/types.js';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';

// 通信文件目录
const COMM_DIR = path.join(os.tmpdir(), 'turn-mcp');
const STATUS_FILE = path.join(COMM_DIR, 'status.json');
const INPUT_FILE = path.join(COMM_DIR, 'input.txt');

interface StatusData {
  waiting: boolean;
  context: string;
  question?: string;
  timestamp: number;
}

function ensureCommDir() {
  if (!fs.existsSync(COMM_DIR)) {
    fs.mkdirSync(COMM_DIR, { recursive: true });
  }
}

function writeStatus(data: StatusData) {
  ensureCommDir();
  fs.writeFileSync(STATUS_FILE, JSON.stringify(data, null, 2));
}

function clearInput() {
  if (fs.existsSync(INPUT_FILE)) {
    fs.unlinkSync(INPUT_FILE);
  }
}

function readInput(): string | null {
  if (fs.existsSync(INPUT_FILE)) {
    const content = fs.readFileSync(INPUT_FILE, 'utf-8').trim();
    if (content) {
      return content;
    }
  }
  return null;
}

function readStatus(): any | null {
  if (fs.existsSync(STATUS_FILE)) {
    try {
      const content = fs.readFileSync(STATUS_FILE, 'utf-8');
      return JSON.parse(content);
    } catch {
      return null;
    }
  }
  return null;
}

class CheckpointMCPServer {
  private server: Server;

  constructor() {
    this.server = new Server(
      {
        name: 'turn-mcp',
        version: '1.0.0',
      },
      {
        capabilities: {
          tools: {},
        },
      }
    );

    this.setupHandlers();
    ensureCommDir();
  }

  private setupHandlers() {
    this.server.setRequestHandler(ListToolsRequestSchema, async () => {
      return {
        tools: [
          {
            name: 'turn',
            description: '暂停执行并等待用户输入新的提示词。调用此工具后会阻塞等待，直到用户通过VSCode插件提供输入。这允许在单次API请求中实现多轮对话交互。每次需要用户确认或输入时请调用此工具。',
            inputSchema: {
              type: 'object',
              properties: {
                context: {
                  type: 'string',
                  description: '当前对话的上下文摘要，让用户了解你已完成的工作',
                },
                question: {
                  type: 'string',
                  description: '询问用户下一步想要做什么',
                },
              },
              required: ['context'],
              additionalProperties: false,
            },
          },
        ],
      };
    });

    this.server.setRequestHandler(CallToolRequestSchema, async (request: { params: { name: string; arguments?: Record<string, unknown> } }) => {
      if (request.params.name === 'turn') {
        const args = request.params.arguments as {
          context: string;
          question?: string;
        };

        // 写入等待状态
        writeStatus({
          waiting: true,
          context: args.context,
          question: args.question,
          timestamp: Date.now(),
        });

        // 清空之前的输入
        clearInput();

        console.error(`[Turn] 等待用户输入...`);
        console.error(`上下文: ${args.context}`);
        if (args.question) {
          console.error(`问题: ${args.question}`);
        }

        // 轮询等待用户输入
        const userInput = await this.waitForInput();

        // 更新状态为非等待
        writeStatus({
          waiting: false,
          context: '',
          timestamp: Date.now(),
        });

        console.error(`[Turn] 收到用户输入: ${userInput.substring(0, 100)}...`);

        // 立即返回，不做额外处理
        return {
          content: [
            {
              type: 'text',
              text: userInput,
            },
          ],
        };
      }

      return {
        content: [
          {
            type: 'text' as const,
            text: `未知工具: ${request.params.name}`,
          },
        ],
        isError: true,
      };
    });
  }

  private async waitForInput(): Promise<string> {
    return new Promise((resolve) => {
      let heartbeatCount = 0;
      const checkInterval = setInterval(() => {
        const status = readStatus();
        // 用户主动清除等待时退出
        if (status?.canceled) {
          clearInterval(checkInterval);
          clearInput();
          resolve('[canceled]');
          return;
        }

        const input = readInput();
        if (input) {
          clearInterval(checkInterval);
          clearInput();
          resolve(input);
        } else {
          // 心跳日志，每10秒输出一次
          heartbeatCount++;
          if (heartbeatCount % 20 === 0) {
            console.error(`[Turn] 仍在等待用户输入... (${heartbeatCount / 2}秒)`);
          }
        }
      }, 500); // 每500ms检查一次
    });
  }

  async start(): Promise<void> {
    const transport = new StdioServerTransport();
    await this.server.connect(transport);
    console.error('[Turn MCP] 服务器已启动');
  }
}

// 启动服务器
const server = new CheckpointMCPServer();
server.start().catch(console.error);
