import { APP_CONFIG } from './config.js';
import type { HistoryPersistence } from './history-persistence.js';

export interface WaitSummary {
  id: string;
  sessionId: string;
  context: string;
  question?: string;
  options?: string[];
  agentName?: string;
  createdAt: number;
  expiresAt: number;
}

export interface WaitHistoryItem extends WaitSummary {
  resolvedAt: number;
  resolution: 'message' | 'timeout' | 'canceled' | 'interrupted';
  finalMessageLength: number;
  userMessage?: string;
}

export interface WaitHistoryQuery {
  limit?: number;
  offset?: number;
  sessionId?: string;
  resolution?: WaitHistoryItem['resolution'];
  keyword?: string;
}

export interface SessionSummary {
  sessionId: string;
  interactionCount: number;
  lastActivity: number;
  status: 'pending' | 'message' | 'timeout' | 'canceled' | 'interrupted' | 'completed';
  /** All currently-pending waits for this session (may be > 1). */
  pendingWaits?: WaitSummary[];
  /** @deprecated Use pendingWaits[0]. Kept for backward-compat. */
  pendingWait?: WaitSummary;
}

export type WaitResolution =
  | { kind: 'message'; text: string }
  | { kind: 'timeout' }
  | { kind: 'canceled' }
  | { kind: 'interrupted' }
  | { kind: 'busy'; activeWaitIds: string[] };

export type WaitStoreEvent =
  | {
      type: 'wait_created';
      waitId: string;
      sessionId: string;
      context: string;
      question?: string;
      options?: string[];
      agentName?: string;
      contextLength: number;
      hasQuestion: boolean;
      timeoutMs: number;
      createdAt: number;
      expiresAt: number;
    }
  | {
      type: 'wait_busy';
      sessionId: string;
      activeWaitIds: string[];
      contextLength: number;
    }
  | {
      type: 'wait_responded';
      waitId: string;
      sessionId: string;
      userMessageLength: number;
      finalMessageLength: number;
    }
  | {
      type: 'wait_canceled';
      waitId: string;
      sessionId: string;
    }
  | {
      type: 'wait_timeout';
      waitId: string;
      sessionId: string;
    }
  | {
      type: 'wait_resolved';
      waitId: string;
      sessionId: string;
      resolution: 'message' | 'timeout' | 'canceled';
    }
  | {
      type: 'wait_extended';
      waitId: string;
      sessionId: string;
      additionalSeconds: number;
      newExpiresAt: number;
    };

interface InternalWait {
  summary: WaitSummary;
  resolve: (resolution: WaitResolution) => void;
  timeoutTimer: NodeJS.Timeout | null;
  userMessage?: string;
}

export class WaitStore {
  private readonly waits = new Map<string, InternalWait>();
  /** Maps sessionId → Set of active waitIds (replaces old single-wait-per-session limit). */
  private readonly sessionActiveWaits = new Map<string, Set<string>>();
  private readonly history: WaitHistoryItem[] = [];
  private readonly persistence?: HistoryPersistence;

  constructor(onEvent?: (event: WaitStoreEvent) => void, persistence?: HistoryPersistence);
  constructor(private readonly onEvent?: (event: WaitStoreEvent) => void, persistenceArg?: HistoryPersistence) {
    this.persistence = persistenceArg;
    if (this.persistence) {
      const loaded = this.persistence.load();
      // Sort newest-first (same order as in-memory history)
      loaded.sort((a, b) => b.resolvedAt - a.resolvedAt);
      const maxItems = APP_CONFIG.waitHistoryMaxItems;
      const trimmed = loaded.length > maxItems ? loaded.slice(0, maxItems) : loaded;
      this.history.push(...trimmed);
      if (loaded.length > maxItems) {
        this.persistence.rewrite(trimmed);
      }
    }
  }

  waitForResponse(input: {
    sessionId: string;
    context: string;
    question?: string;
    options?: string[];
    agentName?: string;
    timeoutMs: number;
  }): Promise<WaitResolution> {
    const activeSet = this.sessionActiveWaits.get(input.sessionId);
    if (activeSet && activeSet.size >= APP_CONFIG.maxConcurrentWaitsPerSession) {
      const activeWaitIds = Array.from(activeSet);
      this.emit({
        type: 'wait_busy',
        sessionId: input.sessionId,
        activeWaitIds,
        contextLength: input.context.length,
      });
      return Promise.resolve({ kind: 'busy', activeWaitIds });
    }

    const noTimeout = input.timeoutMs <= 0;
    const waitId = this.createWaitId();
    const now = Date.now();
    const summary: WaitSummary = {
      id: waitId,
      sessionId: input.sessionId,
      context: input.context,
      question: input.question,
      options: input.options,
      agentName: input.agentName,
      createdAt: now,
      expiresAt: noTimeout ? 0 : now + input.timeoutMs,
    };
    this.emit({
      type: 'wait_created',
      waitId,
      sessionId: input.sessionId,
      context: input.context.slice(0, 5000),
      question: input.question || undefined,
      options: input.options,
      agentName: input.agentName,
      contextLength: input.context.length,
      hasQuestion: Boolean(input.question && input.question.trim().length > 0),
      timeoutMs: input.timeoutMs,
      createdAt: summary.createdAt,
      expiresAt: summary.expiresAt,
    });

    return new Promise<WaitResolution>((outerResolve) => {
      let finished = false;
        const finish = (resolution: WaitResolution): void => {
        if (finished) {
          return;
        }
        finished = true;
        const state = this.waits.get(waitId);
        if (state) {
          if (state.timeoutTimer) clearTimeout(state.timeoutTimer);
          this.waits.delete(waitId);
        }
        const activeSet = this.sessionActiveWaits.get(input.sessionId);
        if (activeSet) {
          activeSet.delete(waitId);
          if (activeSet.size === 0) this.sessionActiveWaits.delete(input.sessionId);
        }
        if (resolution.kind === 'message' || resolution.kind === 'timeout' || resolution.kind === 'canceled') {
          const userMsg = state?.userMessage;
          this.pushHistory({
            ...summary,
            resolvedAt: Date.now(),
            resolution: resolution.kind,
            finalMessageLength: resolution.kind === 'message' ? resolution.text.length : 0,
            userMessage: resolution.kind === 'message' ? (userMsg || '') : undefined,
          });
          this.emit({
            type: 'wait_resolved',
            waitId,
            sessionId: input.sessionId,
            resolution: resolution.kind,
          });
        }
        outerResolve(resolution);
      };

      let timeoutTimer: NodeJS.Timeout | null = null;
      if (!noTimeout) {
        timeoutTimer = setTimeout(() => {
          this.emit({
            type: 'wait_timeout',
            waitId,
            sessionId: input.sessionId,
          });
          finish({ kind: 'timeout' });
        }, input.timeoutMs);
        if (typeof timeoutTimer.unref === 'function') {
          timeoutTimer.unref();
        }
      }

      this.waits.set(waitId, {
        summary,
        resolve: finish,
        timeoutTimer,
      });
      const existing = this.sessionActiveWaits.get(input.sessionId) ?? new Set<string>();
      existing.add(waitId);
      this.sessionActiveWaits.set(input.sessionId, existing);
    });
  }

  listPendingWaits(): WaitSummary[] {
    return Array.from(this.waits.values())
      .map((v) => v.summary)
      .sort((a, b) => a.createdAt - b.createdAt);
  }

  listHistory(query: WaitHistoryQuery = {}): WaitHistoryItem[] {
    const rawLimit = query.limit;
    const safeLimit = Number.isInteger(rawLimit) ? Math.max(1, Math.min(1000, rawLimit as number)) : 100;
    const rawOffset = query.offset;
    const safeOffset = Number.isInteger(rawOffset) ? Math.max(0, rawOffset as number) : 0;
    const filtered = this.filterHistory(query);
    return filtered.slice(safeOffset, safeOffset + safeLimit);
  }

  countHistory(query: WaitHistoryQuery = {}): number {
    return this.filterHistory(query).length;
  }

  queryHistory(query: WaitHistoryQuery = {}): { items: WaitHistoryItem[]; total: number } {
    const rawLimit = query.limit;
    const safeLimit = Number.isInteger(rawLimit) ? Math.max(1, Math.min(1000, rawLimit as number)) : 100;
    const rawOffset = query.offset;
    const safeOffset = Number.isInteger(rawOffset) ? Math.max(0, rawOffset as number) : 0;
    const filtered = this.filterHistory(query);
    return {
      items: filtered.slice(safeOffset, safeOffset + safeLimit),
      total: filtered.length,
    };
  }

  private filterHistory(query: WaitHistoryQuery): WaitHistoryItem[] {
    const sessionFilter = (query.sessionId || '').trim();
    const resolutionFilter = query.resolution;
    const keywordFilter = (query.keyword || '').trim().toLowerCase();
    return this.history.filter((item) => {
      if (sessionFilter && !item.sessionId.includes(sessionFilter)) {
        return false;
      }
      if (resolutionFilter && item.resolution !== resolutionFilter) {
        return false;
      }
      if (keywordFilter) {
        const haystack = `${item.context}\n${item.question || ''}`.toLowerCase();
        if (!haystack.includes(keywordFilter)) {
          return false;
        }
      }
      return true;
    });
  }

  historyCount(): number {
    return this.history.length;
  }

  listSessionTimeline(sessionId: string): WaitHistoryItem[] {
    return this.history
      .filter((item) => item.sessionId === sessionId)
      .sort((a, b) => a.createdAt - b.createdAt);
  }

  listSessionSummaries(): SessionSummary[] {
    const map = new Map<string, SessionSummary>();
    // Seed with active pending waits (group by sessionId)
    for (const wait of this.waits.values()) {
      const s = wait.summary;
      const existing = map.get(s.sessionId);
      if (existing) {
        existing.pendingWaits!.push(s);
        if (s.createdAt > existing.lastActivity) existing.lastActivity = s.createdAt;
      } else {
        map.set(s.sessionId, {
          sessionId: s.sessionId,
          interactionCount: 0,
          lastActivity: s.createdAt,
          status: 'pending',
          pendingWaits: [s],
          pendingWait: s, // compat
        });
      }
    }
    // Merge history (stored newest-first; first encounter per session = most recent status)
    for (const h of this.history) {
      const t = h.resolvedAt || h.createdAt;
      const existing = map.get(h.sessionId);
      if (existing) {
        existing.interactionCount++;
        if (t > existing.lastActivity) existing.lastActivity = t;
        // Keep pendingWait compat field in sync
        if (existing.pendingWaits && existing.pendingWaits.length > 0) {
          existing.pendingWait = existing.pendingWaits[0];
        }
      } else {
        map.set(h.sessionId, {
          sessionId: h.sessionId,
          interactionCount: 1,
          lastActivity: t,
          status: h.resolution,
        });
      }
    }
    return Array.from(map.values());
  }

  respond(waitId: string, userMessage: string): { ok: true } | { ok: false; reason: string } {
    const state = this.waits.get(waitId);
    if (!state) {
      return { ok: false, reason: 'wait-not-found' };
    }
    const trimmed = userMessage.trim();
    if (trimmed.length > APP_CONFIG.maxUserMessageChars) {
      return { ok: false, reason: `message-too-long(max=${APP_CONFIG.maxUserMessageChars})` };
    }
    const finalText = trimmed ? `${trimmed}\n\n${APP_CONFIG.reinforcementSuffix}` : APP_CONFIG.reinforcementSuffix;
    // Store raw user message (without reinforcement suffix) for timeline display
    state.userMessage = trimmed;
    this.emit({
      type: 'wait_responded',
      waitId,
      sessionId: state.summary.sessionId,
      userMessageLength: trimmed.length,
      finalMessageLength: finalText.length,
    });
    state.resolve({ kind: 'message', text: finalText });
    return { ok: true };
  }

  extend(waitId: string, additionalSeconds: number): { ok: true; newExpiresAt: number } | { ok: false; reason: string } {
    if (!Number.isInteger(additionalSeconds) || additionalSeconds < 30 || additionalSeconds > 3600) {
      return { ok: false, reason: 'invalid-seconds(range=30-3600)' };
    }
    const state = this.waits.get(waitId);
    if (!state) {
      return { ok: false, reason: 'wait-not-found' };
    }
    if (state.timeoutTimer) clearTimeout(state.timeoutTimer);
    const additionalMs = additionalSeconds * 1000;
    state.summary.expiresAt = Math.max(state.summary.expiresAt, Date.now()) + additionalMs;
    const newTimer = setTimeout(() => {
      this.emit({ type: 'wait_timeout', waitId, sessionId: state.summary.sessionId });
      state.resolve({ kind: 'timeout' });
    }, state.summary.expiresAt - Date.now());
    if (typeof newTimer.unref === 'function') {
      newTimer.unref();
    }
    state.timeoutTimer = newTimer;
    this.emit({
      type: 'wait_extended',
      waitId,
      sessionId: state.summary.sessionId,
      additionalSeconds,
      newExpiresAt: state.summary.expiresAt,
    });
    return { ok: true, newExpiresAt: state.summary.expiresAt };
  }

  cancelAll(): number {
    let count = 0;
    for (const [waitId] of Array.from(this.waits)) {
      if (this.cancel(waitId).ok) count++;
    }
    return count;
  }

  getPendingWait(waitId: string): WaitSummary | undefined {
    return this.waits.get(waitId)?.summary;
  }

  cancel(waitId: string): { ok: true } | { ok: false; reason: string } {
    const state = this.waits.get(waitId);
    if (!state) {
      return { ok: false, reason: 'wait-not-found' };
    }
    this.emit({
      type: 'wait_canceled',
      waitId,
      sessionId: state.summary.sessionId,
    });
    state.resolve({ kind: 'canceled' });
    return { ok: true };
  }

  private createWaitId(): string {
    return `wait_${Date.now()}_${Math.random().toString(36).slice(2, 10)}`;
  }

  private pushHistory(item: WaitHistoryItem): void {
    this.history.unshift(item);
    this.persistence?.append(item);
    if (this.history.length > APP_CONFIG.waitHistoryMaxItems) {
      this.history.length = APP_CONFIG.waitHistoryMaxItems;
      this.persistence?.rewrite(this.history);
    }
  }

  /**
   * Called during graceful shutdown: saves all in-flight pending waits
   * to history with resolution='interrupted' so they appear in the browser
   * console after the server restarts.
   */
  shutdownPersist(): void {
    const now = Date.now();
    for (const [, state] of this.waits) {
      const { summary } = state;
      if (state.timeoutTimer) clearTimeout(state.timeoutTimer);
      this.pushHistory({
        ...summary,
        resolvedAt: now,
        resolution: 'interrupted',
        finalMessageLength: 0,
      });
    }
    this.waits.clear();
    this.sessionActiveWaits.clear();
  }

  private emit(event: WaitStoreEvent): void {
    try {
      this.onEvent?.(event);
    } catch {
      // ignore observer errors
    }
  }
}
