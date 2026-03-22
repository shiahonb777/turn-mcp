import { ServerResponse } from 'http';
import { Logger } from './config.js';

const logger = new Logger('SSEManager');
const KEEPALIVE_INTERVAL_MS = 30_000;

export class SseManager {
  private readonly clients = new Set<ServerResponse>();
  private keepaliveTimer: NodeJS.Timeout | null = null;

  constructor() {
    this.keepaliveTimer = setInterval(() => {
      for (const res of this.clients) {
        try {
          res.write(':keepalive\n\n');
        } catch {
          this.removeClient(res);
        }
      }
    }, KEEPALIVE_INTERVAL_MS);
    if (typeof this.keepaliveTimer.unref === 'function') {
      this.keepaliveTimer.unref();
    }
  }

  addClient(res: ServerResponse): void {
    this.clients.add(res);
    res.on('close', () => this.removeClient(res));
    logger.info(`SSE client connected (total=${this.clients.size})`);
  }

  private removeClient(res: ServerResponse): void {
    if (this.clients.delete(res)) {
      logger.info(`SSE client disconnected (total=${this.clients.size})`);
    }
  }

  broadcast(event: { type: string; [key: string]: unknown }): void {
    if (this.clients.size === 0) {
      return;
    }
    const payload = `event: ${event.type}\ndata: ${JSON.stringify(event)}\n\n`;
    for (const res of this.clients) {
      try {
        res.write(payload);
      } catch {
        this.removeClient(res);
      }
    }
  }

  get clientCount(): number {
    return this.clients.size;
  }

  destroy(): void {
    if (this.keepaliveTimer) {
      clearInterval(this.keepaliveTimer);
      this.keepaliveTimer = null;
    }
    for (const res of this.clients) {
      try {
        res.end();
      } catch {
        // ignore
      }
    }
    this.clients.clear();
  }
}
