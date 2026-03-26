import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { Transport } from '@modelcontextprotocol/sdk/shared/transport.js';
import { CallToolRequestSchema, ListToolsRequestSchema } from '@modelcontextprotocol/sdk/types.js';
import { APP_CONFIG, runtimeConfig, Logger } from './config.js';
import { WaitStore } from './wait-store.js';

interface TurnArgs {
  context: string;
  question?: string;
  timeoutSeconds?: number;
  options?: string[];
  agentName?: string;
}

const logger = new Logger('TurnMcpServer');

const TURN_INPUT_SCHEMA = {
  type: 'object',
  properties: {
    context: {
      type: 'string',
      description: 'Current progress summary (required) / 当前进度摘要（必填，尽量简洁）',
    },
    question: {
      type: 'string',
      description: 'Question for the user (optional) / 你希望用户回答的问题（可选）',
    },
    timeoutSeconds: {
      type: 'integer',
      minimum: 10,
      maximum: 3600,
      description: 'Per-call timeout in seconds (optional) / 本次等待超时时间（秒，可选）',
    },
    options: {
      type: 'array',
      items: { type: 'string', maxLength: 200 },
      maxItems: 10,
      description: 'Predefined reply choices shown as buttons (optional) / 预设回复选项，显示为按钮（可选）',
    },
    agentName: {
      type: 'string',
      maxLength: 100,
      description: 'Label identifying the calling agent or tool (optional) / 标识调用方的名称（可选）',
    },
  },
  required: ['context'],
  additionalProperties: false,
} as const;

export class TurnWaitMcpServer {
  private readonly server: Server;

  constructor(
    private readonly waitStore: WaitStore,
    private readonly getSessionId: () => string
  ) {
    this.server = new Server(
      { name: APP_CONFIG.name, version: APP_CONFIG.version },
      { capabilities: { tools: {} } }
    );
    this.setupHandlers();
  }

  async connect(transport: Transport): Promise<void> {
    await this.server.connect(transport);
  }

  async close(): Promise<void> {
    await this.server.close();
  }

  private setupHandlers(): void {
    this.server.setRequestHandler(ListToolsRequestSchema, async () => {
      return {
        tools: APP_CONFIG.toolNames.map((name) => ({
          name,
          description:
            'Pause execution and wait for human input via browser console. Use for approvals, clarifications, or branch decisions.\n暂停执行并等待用户输入（通过浏览器控制台回复）。适用于审批、澄清、分支决策等卡点。',
          inputSchema: TURN_INPUT_SCHEMA,
        })),
      };
    });

    this.server.setRequestHandler(
      CallToolRequestSchema,
      async (request: { params: { name: string; arguments?: Record<string, unknown> } }) => {
        if (!APP_CONFIG.toolNames.includes(request.params.name as (typeof APP_CONFIG.toolNames)[number])) {
          return {
            content: [{ type: 'text' as const, text: `Unknown tool: ${request.params.name}` }],
            isError: true,
          };
        }

        const parsed = this.parseArgs(request.params.arguments);
        if (!parsed.ok) {
          return {
            content: [{ type: 'text' as const, text: parsed.error }],
            isError: true,
          };
        }

        const effectiveTimeout = runtimeConfig.timeoutEnabled
          ? (parsed.args.timeoutSeconds || runtimeConfig.defaultTimeoutSeconds)
          : 0;
        const timeoutMs = effectiveTimeout * 1000;
        const sessionId = this.getSessionId();
        const resolution = await this.waitStore.waitForResponse({
          sessionId,
          context: parsed.args.context,
          question: parsed.args.question,
          options: parsed.args.options,
          agentName: parsed.args.agentName,
          timeoutMs,
        });

        if (resolution.kind === 'timeout') {
          return {
            content: [
              {
                type: 'text' as const,
                text: '[timeout] User did not respond before timeout. Call turn.wait again when ready.',
              },
            ],
          };
        }

        if (resolution.kind === 'canceled') {
          return {
            content: [
              {
                type: 'text' as const,
                text: '[canceled] User canceled this waiting request in web console.',
              },
            ],
          };
        }

        if (resolution.kind === 'interrupted') {
          return {
            content: [
              {
                type: 'text' as const,
                text: '[interrupted] The server was restarted while this wait was pending. Please call turn.wait again to resume.',
              },
            ],
          };
        }

        if (resolution.kind === 'busy') {
          return {
            content: [
              {
                type: 'text' as const,
                text: `[busy] Maximum concurrent waits (${APP_CONFIG.maxConcurrentWaitsPerSession}) reached for this session. Active wait IDs: ${resolution.activeWaitIds.join(', ')}`,
              },
            ],
          };
        }

        logger.info(`Resolved wait response for session=${sessionId}, len=${resolution.text.length}`);
        return {
          content: [{ type: 'text' as const, text: resolution.text }],
        };
      }
    );
  }

  private parseArgs(
    raw: Record<string, unknown> | undefined
  ): { ok: true; args: TurnArgs } | { ok: false; error: string } {
    const context = raw?.context;
    if (typeof context !== 'string' || context.trim().length === 0) {
      return { ok: false, error: 'Invalid args: "context" must be a non-empty string.' };
    }

    const question = raw?.question;
    if (question !== undefined && typeof question !== 'string') {
      return { ok: false, error: 'Invalid args: "question" must be a string when provided.' };
    }

    const timeoutSeconds = raw?.timeoutSeconds;
    if (timeoutSeconds !== undefined) {
      if (!Number.isInteger(timeoutSeconds) || Number(timeoutSeconds) < 10 || Number(timeoutSeconds) > 3600) {
        return { ok: false, error: 'Invalid args: "timeoutSeconds" must be an integer between 10 and 3600.' };
      }
    }

    const options = raw?.options;
    if (options !== undefined) {
      if (
        !Array.isArray(options) ||
        options.length > 10 ||
        !options.every((o) => typeof o === 'string' && o.trim().length > 0 && o.length <= 200)
      ) {
        return { ok: false, error: 'Invalid args: "options" must be an array of up to 10 non-empty strings (max 200 chars each).' };
      }
    }

    const agentName = raw?.agentName;
    if (agentName !== undefined) {
      if (typeof agentName !== 'string' || agentName.length > 100) {
        return { ok: false, error: 'Invalid args: "agentName" must be a string of at most 100 chars when provided.' };
      }
    }

    return {
      ok: true,
      args: {
        context: context.trim(),
        question: typeof question === 'string' ? question.trim() : undefined,
        timeoutSeconds: typeof timeoutSeconds === 'number' ? timeoutSeconds : undefined,
        options: Array.isArray(options) ? options.map((o) => String(o).trim()).filter(Boolean) : undefined,
        agentName: typeof agentName === 'string' ? agentName.trim() || undefined : undefined,
      },
    };
  }
}
