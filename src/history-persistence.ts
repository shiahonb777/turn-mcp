import { appendFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'fs';
import * as path from 'path';
import { Logger } from './config.js';
import type { WaitHistoryItem } from './wait-store.js';

const logger = new Logger('HistoryPersistence');

export interface HistoryPersistence {
  load(): WaitHistoryItem[];
  append(item: WaitHistoryItem): void;
  rewrite(items: WaitHistoryItem[]): void;
}

export class JsonlHistoryPersistence implements HistoryPersistence {
  constructor(private readonly filePath: string) {
    const dir = path.dirname(filePath);
    if (!existsSync(dir)) {
      mkdirSync(dir, { recursive: true });
    }
    logger.info(`History persistence enabled: ${filePath}`);
  }

  load(): WaitHistoryItem[] {
    if (!existsSync(this.filePath)) {
      return [];
    }
    try {
      const raw = readFileSync(this.filePath, 'utf-8');
      const lines = raw.split(/\r?\n/).filter((l) => l.trim().length > 0);
      const items: WaitHistoryItem[] = [];
      for (const line of lines) {
        try {
          const item = JSON.parse(line) as WaitHistoryItem;
          if (item && typeof item.id === 'string' && typeof item.resolvedAt === 'number') {
            items.push(item);
          }
        } catch {
          // skip malformed lines
        }
      }
      logger.info(`Loaded ${items.length} history items from file`);
      return items;
    } catch (error) {
      logger.error('load history file', error);
      return [];
    }
  }

  append(item: WaitHistoryItem): void {
    try {
      appendFileSync(this.filePath, JSON.stringify(item) + '\n', 'utf-8');
    } catch (error) {
      logger.error('append history', error);
    }
  }

  rewrite(items: WaitHistoryItem[]): void {
    try {
      const content = items.map((item) => JSON.stringify(item)).join('\n') + (items.length > 0 ? '\n' : '');
      writeFileSync(this.filePath, content, 'utf-8');
      logger.info(`Rewrote history file with ${items.length} items`);
    } catch (error) {
      logger.error('rewrite history', error);
    }
  }
}
