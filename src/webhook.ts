import { createHmac } from 'crypto';
import * as http from 'http';
import * as https from 'https';
import { APP_CONFIG, Logger } from './config.js';

const logger = new Logger('Webhook');
const TIMEOUT_MS = 5_000;
const MAX_RETRIES = 3;
const RETRY_BASE_MS = 1_000;

function buildSlackPayload(event: { type: string; [key: string]: unknown }): string {
  const ts = new Date().toISOString();
  const fields: Array<{ type: string; text: { type: string; text: string } }> = [
    { type: 'mrkdwn', text: { type: 'mrkdwn', text: `*Event:* \`${event.type}\`` } },
    { type: 'mrkdwn', text: { type: 'mrkdwn', text: `*Time:* ${ts}` } },
  ];
  if (event.sessionId) fields.push({ type: 'mrkdwn', text: { type: 'mrkdwn', text: `*Session:* \`${String(event.sessionId).slice(0, 20)}\`` } });
  if (event.context) fields.push({ type: 'mrkdwn', text: { type: 'mrkdwn', text: `*Context:* ${String(event.context).slice(0, 200)}` } });
  if (event.question) fields.push({ type: 'mrkdwn', text: { type: 'mrkdwn', text: `*Question:* ${String(event.question).slice(0, 200)}` } });

  return JSON.stringify({
    text: `Turn MCP: \`${event.type}\``,
    blocks: [
      { type: 'section', fields: fields.map(f => f.text) },
    ],
  });
}

export class WebhookNotifier {
  private readonly url: string;
  private readonly events: Set<string>;
  private readonly secret: string;
  private readonly format: 'json' | 'slack';

  constructor(url: string, eventsFilter: string) {
    this.url = url;
    const parsed = eventsFilter
      .split(',')
      .map((s) => s.trim())
      .filter((s) => s.length > 0);
    this.events = new Set(parsed.length > 0 ? parsed : ['wait_created']);
    this.secret = APP_CONFIG.webhookSecret;
    this.format = APP_CONFIG.webhookFormat;
    logger.info(`Webhook enabled: ${url} (events: ${Array.from(this.events).join(',')}, format: ${this.format}, hmac: ${this.secret ? 'yes' : 'no'})`);
  }

  notify(event: { type: string; [key: string]: unknown }): void {
    if (!this.events.has(event.type)) {
      return;
    }

    const payload = this.format === 'slack'
      ? buildSlackPayload(event)
      : JSON.stringify({ type: event.type, ts: new Date().toISOString(), data: event });

    this.sendWithRetry(payload, event.type, 0);
  }

  private sendWithRetry(payload: string, eventType: string, attempt: number): void {
    const urlObj = new URL(this.url);
    const isHttps = urlObj.protocol === 'https:';
    const byteLen = Buffer.byteLength(payload);

    const headers: Record<string, string | number> = {
      'content-type': 'application/json',
      'content-length': byteLen,
      'x-turn-mcp-event': eventType,
    };

    if (this.secret) {
      const sig = createHmac('sha256', this.secret).update(payload).digest('hex');
      headers['x-turn-mcp-signature'] = `sha256=${sig}`;
    }

    const options: http.RequestOptions = {
      hostname: urlObj.hostname,
      port: urlObj.port || (isHttps ? 443 : 80),
      path: urlObj.pathname + urlObj.search,
      method: 'POST',
      headers,
      timeout: TIMEOUT_MS,
    };

    const retry = (reason: string): void => {
      if (attempt < MAX_RETRIES) {
        const delay = RETRY_BASE_MS * Math.pow(2, attempt);
        logger.warn(`Webhook ${eventType} ${reason}, retry ${attempt + 1}/${MAX_RETRIES} in ${delay}ms`);
        setTimeout(() => this.sendWithRetry(payload, eventType, attempt + 1), delay);
      } else {
        logger.error(`webhook ${eventType} failed after ${MAX_RETRIES + 1} attempts`, new Error(reason));
      }
    };

    const transport = isHttps ? https : http;
    const req = transport.request(options, (res) => {
      res.resume();
      logger.info(`Webhook ${eventType} -> ${res.statusCode} (attempt ${attempt + 1})`);
      if (res.statusCode && res.statusCode >= 500) {
        retry(`HTTP ${res.statusCode}`);
      }
    });

    req.on('error', (err) => retry(err.message));
    req.on('timeout', () => { req.destroy(); retry('timeout'); });

    req.write(payload);
    req.end();
  }
}
