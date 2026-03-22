#!/usr/bin/env node
import { randomUUID, timingSafeEqual, createHash } from 'crypto';
import { existsSync, readFileSync } from 'fs';
import { createServer, IncomingMessage, ServerResponse } from 'http';
import * as path from 'path';
import { gzipSync } from 'zlib';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import { isInitializeRequest } from '@modelcontextprotocol/sdk/types.js';
import { APP_CONFIG, runtimeConfig, loadSettings, saveSettings, Logger, setStdioMode } from './config.js';

// Detect --stdio mode BEFORE any logging so Logger is configured first
const STDIO_MODE = process.argv.includes('--stdio');
if (STDIO_MODE) {
  setStdioMode(true);
}
import { EventLogger } from './event-log.js';
import { JsonlHistoryPersistence } from './history-persistence.js';
import { SseManager } from './sse-manager.js';
import { TurnWaitMcpServer } from './turn-mcp-server.js';
import { WaitStore } from './wait-store.js';
import { WebhookNotifier } from './webhook.js';

// Load persisted settings before starting server
loadSettings();

// ===== Rate Limiter =====
class RateLimiter {
  private readonly windows = new Map<string, number[]>();
  private readonly maxRequests: number;
  private readonly windowMs: number;

  constructor(maxRequests: number, windowSeconds: number) {
    this.maxRequests = maxRequests;
    this.windowMs = windowSeconds * 1000;
    // Periodic cleanup to avoid memory growth
    const timer = setInterval(() => {
      const cutoff = Date.now() - this.windowMs;
      for (const [ip, times] of this.windows) {
        const trimmed = times.filter((t) => t > cutoff);
        if (trimmed.length === 0) this.windows.delete(ip);
        else this.windows.set(ip, trimmed);
      }
    }, Math.max(this.windowMs, 60_000));
    if (typeof timer.unref === 'function') timer.unref();
  }

  /** Returns true if the request is allowed, false if rate-limited. */
  check(ip: string): boolean {
    if (this.maxRequests <= 0) return true; // disabled
    const now = Date.now();
    const cutoff = now - this.windowMs;
    const times = (this.windows.get(ip) || []).filter((t) => t > cutoff);
    times.push(now);
    this.windows.set(ip, times);
    return times.length <= this.maxRequests;
  }
}

const rateLimiter = new RateLimiter(APP_CONFIG.rateLimitMax, APP_CONFIG.rateLimitWindowSeconds);

const logger = new Logger('MainServer');
const eventLogger = new EventLogger();
const sseManager = new SseManager();
let webhookNotifier: WebhookNotifier | null = runtimeConfig.webhookUrl
  ? new WebhookNotifier(runtimeConfig.webhookUrl, runtimeConfig.webhookEvents)
  : null;

function updateWebhookNotifier(): void {
  webhookNotifier = runtimeConfig.webhookUrl
    ? new WebhookNotifier(runtimeConfig.webhookUrl, runtimeConfig.webhookEvents)
    : null;
}
const historyPersistence = APP_CONFIG.historyFile ? new JsonlHistoryPersistence(APP_CONFIG.historyFile) : undefined;
const waitStore = new WaitStore((event) => {
  eventLogger.log(event.type, event);
  sseManager.broadcast(event);
  webhookNotifier?.notify(event);
}, historyPersistence);
const publicDir = path.resolve(__dirname, '../public');

const STATIC_ALLOWED = ['index.html', 'app.js', 'styles.css', 'i18n.js', 'manifest.json', 'sw.js'] as const;
const staticCache = new Map<string, Buffer>();
const staticCacheGzip = new Map<string, Buffer>();
const staticCacheEtag = new Map<string, string>();
for (const fileName of STATIC_ALLOWED) {
  const fullPath = path.join(publicDir, fileName);
  if (existsSync(fullPath)) {
    const content = readFileSync(fullPath);
    staticCache.set(fileName, content);
    staticCacheGzip.set(fileName, gzipSync(content, { level: 9 }));
    staticCacheEtag.set(fileName, '"' + createHash('sha256').update(content).digest('hex').slice(0, 16) + '"');
  }
}

interface SessionContext {
  transport: StreamableHTTPServerTransport;
  server: TurnWaitMcpServer;
  sessionRef: { id: string | null };
  lastActivityAt: number;
}

const sessions = new Map<string, SessionContext>();

const SESSION_IDLE_TIMEOUT_MS = 30 * 60 * 1000; // 30 minutes
const SESSION_CLEANUP_INTERVAL_MS = 5 * 60 * 1000; // check every 5 minutes

const sessionCleanupTimer = setInterval(() => {
  const now = Date.now();
  for (const [sid, ctx] of sessions) {
    if (now - ctx.lastActivityAt > SESSION_IDLE_TIMEOUT_MS) {
      logger.info(`Reaping idle MCP session: ${sid} (idle ${Math.floor((now - ctx.lastActivityAt) / 1000)}s)`);
      eventLogger.log('mcp_session_reaped', { sessionId: sid });
      sessions.delete(sid);
      ctx.transport.close().catch((err) => logger.error('reap transport.close', err));
      ctx.server.close().catch((err) => logger.error('reap server.close', err));
    }
  }
}, SESSION_CLEANUP_INTERVAL_MS);
if (typeof sessionCleanupTimer.unref === 'function') {
  sessionCleanupTimer.unref();
}

function applyCorsHeaders(res: ServerResponse): void {
  res.setHeader('access-control-allow-origin', '*');
  res.setHeader('access-control-allow-headers', 'content-type,mcp-session-id,x-turn-mcp-api-key,authorization');
  res.setHeader('access-control-allow-methods', 'POST,GET,DELETE,OPTIONS');
}

function sendJson(res: ServerResponse, statusCode: number, payload: unknown): void {
  if (res.headersSent) {
    return;
  }
  applyCorsHeaders(res);
  res.statusCode = statusCode;
  res.setHeader('content-type', 'application/json; charset=utf-8');
  res.end(JSON.stringify(payload));
}

function sendJsonRpcError(res: ServerResponse, statusCode: number, message: string): void {
  sendJson(res, statusCode, {
    jsonrpc: '2.0',
    error: {
      code: -32000,
      message,
    },
    id: null,
  });
}

function getSessionIdFromHeader(req: IncomingMessage): string | undefined {
  const raw = req.headers['mcp-session-id'];
  if (Array.isArray(raw)) {
    return raw[0];
  }
  return raw || undefined;
}

function getHeaderString(req: IncomingMessage, name: string): string | undefined {
  const raw = req.headers[name];
  if (Array.isArray(raw)) {
    return raw[0];
  }
  return raw || undefined;
}

function extractApiKey(req: IncomingMessage): string | undefined {
  const fromCustom = getHeaderString(req, 'x-turn-mcp-api-key');
  if (fromCustom && fromCustom.trim()) {
    return fromCustom.trim();
  }

  const auth = getHeaderString(req, 'authorization');
  if (auth && auth.toLowerCase().startsWith('bearer ')) {
    return auth.slice('bearer '.length).trim();
  }
  return undefined;
}

type ApiRole = 'none' | 'viewer' | 'operator';

function safeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) {
    return false;
  }
  return timingSafeEqual(Buffer.from(a), Buffer.from(b));
}

function resolveRequestRole(req: IncomingMessage): ApiRole {
  if (!APP_CONFIG.requireApiKey) {
    return 'operator';
  }
  const incoming = extractApiKey(req);
  if (!incoming) {
    return 'none';
  }
  if (APP_CONFIG.operatorApiKey && safeEqual(incoming, APP_CONFIG.operatorApiKey)) {
    return 'operator';
  }
  if (APP_CONFIG.viewerApiKey && safeEqual(incoming, APP_CONFIG.viewerApiKey)) {
    return 'viewer';
  }
  return 'none';
}

function hasRequiredRole(role: ApiRole, required: Exclude<ApiRole, 'none'>): boolean {
  if (required === 'viewer') {
    return role === 'viewer' || role === 'operator';
  }
  return role === 'operator';
}

function rejectUnauthorized(
  req: IncomingMessage,
  res: ServerResponse,
  target: 'mcp' | 'api',
  path: string,
  requiredRole: Exclude<ApiRole, 'none'>,
  asJsonRpc: boolean
): boolean {
  const role = resolveRequestRole(req);
  if (hasRequiredRole(role, requiredRole)) {
    return true;
  }
  eventLogger.log('auth_reject', {
    target,
    method: req.method || null,
    path,
    remote: req.socket.remoteAddress || null,
    requiredRole,
    actualRole: role,
  });
  if (asJsonRpc) {
    sendJsonRpcError(res, 401, 'Unauthorized: missing or invalid API key.');
  } else {
    sendJson(res, 401, { error: `Unauthorized: requires role "${requiredRole}".` });
  }
  return false;
}
function ensureAuthorizedMcp(req: IncomingMessage, res: ServerResponse): boolean {
  return rejectUnauthorized(req, res, 'mcp', req.url || '', 'operator', true);
}

function ensureAuthorizedApi(
  req: IncomingMessage,
  res: ServerResponse,
  pathname: string,
  requiredRole: Exclude<ApiRole, 'none'>
): boolean {
  return rejectUnauthorized(req, res, 'api', pathname, requiredRole, false);
}

async function readJsonBody(req: IncomingMessage): Promise<unknown> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    let totalBytes = 0;
    let settled = false;
    let tooLarge = false;

    const safeReject = (error: Error): void => {
      if (settled) {
        return;
      }
      settled = true;
      reject(error);
    };

    const safeResolve = (value: unknown): void => {
      if (settled) {
        return;
      }
      settled = true;
      resolve(value);
    };

    req.on('data', (chunk: Buffer) => {
      if (tooLarge) {
        return;
      }
      totalBytes += chunk.length;
      if (totalBytes > APP_CONFIG.maxBodyBytes) {
        tooLarge = true;
        safeReject(new Error(`Request body too large. Limit: ${APP_CONFIG.maxBodyBytes} bytes.`));
        return;
      }
      chunks.push(chunk);
    });

    req.on('end', () => {
      if (tooLarge) {
        return;
      }
      try {
        const raw = Buffer.concat(chunks).toString('utf-8').trim();
        if (!raw) {
          safeResolve(undefined);
          return;
        }
        safeResolve(JSON.parse(raw));
      } catch (error) {
        safeReject(error instanceof Error ? error : new Error(String(error)));
      }
    });

    req.on('aborted', () => safeReject(new Error('Request aborted.')));
    req.on('error', (error) => safeReject(error instanceof Error ? error : new Error(String(error))));
  });
}

async function getOrCreateSession(req: IncomingMessage, body: unknown): Promise<SessionContext> {
  const sessionId = getSessionIdFromHeader(req);
  if (sessionId) {
    const existing = sessions.get(sessionId);
    if (!existing) {
      throw new Error(`Invalid session: ${sessionId}`);
    }
    return existing;
  }

  if (!isInitializeRequest(body)) {
    throw new Error('No valid session ID provided.');
  }

  const sessionRef: { id: string | null } = { id: null };
  const mcpServer = new TurnWaitMcpServer(waitStore, () => sessionRef.id || 'pending-session');
  let transport: StreamableHTTPServerTransport;
  transport = new StreamableHTTPServerTransport({
    sessionIdGenerator: () => randomUUID(),
    onsessioninitialized: (newSessionId) => {
      sessionRef.id = newSessionId;
      sessions.set(newSessionId, {
        transport,
        server: mcpServer,
        sessionRef,
        lastActivityAt: Date.now(),
      });
      logger.info(`MCP session initialized: ${newSessionId}`);
      eventLogger.log('mcp_session_initialized', { sessionId: newSessionId });
    },
  });

  transport.onclose = () => {
    const sid = sessionRef.id || transport.sessionId || undefined;
    if (sid) {
      sessions.delete(sid);
      logger.info(`MCP session closed: ${sid}`);
      eventLogger.log('mcp_session_closed', { sessionId: sid });
    }
    mcpServer.close().catch((error) => logger.error('close mcp server', error));
  };

  await mcpServer.connect(transport);
  return {
    transport,
    server: mcpServer,
    sessionRef,
    lastActivityAt: Date.now(),
  };
}

async function handleMcpRequest(req: IncomingMessage, res: ServerResponse): Promise<void> {
  if (req.method === 'OPTIONS') {
    applyCorsHeaders(res);
    res.statusCode = 204;
    res.end();
    return;
  }

  if (!ensureAuthorizedMcp(req, res)) {
    return;
  }

  if (req.method === 'POST') {
    const contentType = req.headers['content-type'];
    if (typeof contentType === 'string' && !contentType.includes('application/json')) {
      throw new Error(`Unsupported content-type: ${contentType}`);
    }

    const body = await readJsonBody(req);
    const context = await getOrCreateSession(req, body);
    context.lastActivityAt = Date.now();
    await context.transport.handleRequest(req, res, body);
    return;
  }

  if (req.method === 'GET' || req.method === 'DELETE') {
    const sessionId = getSessionIdFromHeader(req);
    if (!sessionId) {
      throw new Error('Missing session ID.');
    }
    const context = sessions.get(sessionId);
    if (!context) {
      throw new Error(`Invalid session: ${sessionId}`);
    }
    context.lastActivityAt = Date.now();
    await context.transport.handleRequest(req, res);
    return;
  }

  sendJsonRpcError(res, 405, `Method not allowed: ${req.method}`);
}

function parseWaitApiPath(pathname: string): { id: string; action: 'respond' | 'cancel' | 'extend' } | null {
  const segs = pathname.split('/').filter(Boolean);
  if (segs.length !== 4 || segs[0] !== 'api' || segs[1] !== 'waits') {
    return null;
  }
  const [_, __, id, action] = segs;
  if (!id) {
    return null;
  }
  if (action !== 'respond' && action !== 'cancel' && action !== 'extend') {
    return null;
  }
  return { id, action };
}

function parseHistoryResolution(
  value: string | null
): 'message' | 'timeout' | 'canceled' | undefined {
  if (!value) {
    return undefined;
  }
  if (value === 'message' || value === 'timeout' || value === 'canceled') {
    return value;
  }
  return undefined;
}

async function handleApiRequest(req: IncomingMessage, res: ServerResponse, pathname: string): Promise<void> {
  if (req.method === 'OPTIONS') {
    applyCorsHeaders(res);
    res.statusCode = 204;
    res.end();
    return;
  }

  if (req.method === 'GET' && pathname === '/api/public-config') {
    sendJson(res, 200, {
      requireApiKey: APP_CONFIG.requireApiKey,
      hasOperatorApiKeyConfigured: Boolean(APP_CONFIG.operatorApiKey),
      hasViewerApiKeyConfigured: Boolean(APP_CONFIG.viewerApiKey),
      mcpPath: APP_CONFIG.mcpPath,
      eventLogEnabled: eventLogger.isFileEnabled(),
      waitHistoryMaxItems: APP_CONFIG.waitHistoryMaxItems,
      timeoutEnabled: runtimeConfig.timeoutEnabled,
      defaultTimeoutSeconds: runtimeConfig.defaultTimeoutSeconds,
    });
    return;
  }

  if (pathname === '/api/settings' && req.method === 'POST') {
    if (!ensureAuthorizedApi(req, res, pathname, 'operator')) {
      return;
    }
    const body = await readJsonBody(req) as Record<string, unknown> | undefined;
    if (body && typeof body.timeoutEnabled === 'boolean') {
      runtimeConfig.timeoutEnabled = body.timeoutEnabled;
    }
    if (body && typeof body.defaultTimeoutSeconds === 'number') {
      const val = Math.floor(body.defaultTimeoutSeconds);
      if (val >= 0 && val <= 3600) {
        runtimeConfig.defaultTimeoutSeconds = val;
      }
    }
    let webhookChanged = false;
    if (body && typeof body.webhookUrl === 'string') {
      const newUrl = body.webhookUrl.trim();
      if (newUrl !== runtimeConfig.webhookUrl) {
        runtimeConfig.webhookUrl = newUrl;
        webhookChanged = true;
      }
    }
    if (body && typeof body.webhookEvents === 'string') {
      const newEvents = body.webhookEvents.trim();
      if (newEvents !== runtimeConfig.webhookEvents) {
        runtimeConfig.webhookEvents = newEvents;
        webhookChanged = true;
      }
    }
    if (webhookChanged) updateWebhookNotifier();
    saveSettings();
    eventLogger.log('settings_updated', {
      timeoutEnabled: runtimeConfig.timeoutEnabled,
      defaultTimeoutSeconds: runtimeConfig.defaultTimeoutSeconds,
      webhookUrl: runtimeConfig.webhookUrl,
    });
    sendJson(res, 200, {
      ok: true,
      timeoutEnabled: runtimeConfig.timeoutEnabled,
      defaultTimeoutSeconds: runtimeConfig.defaultTimeoutSeconds,
      webhookUrl: runtimeConfig.webhookUrl,
      webhookEvents: runtimeConfig.webhookEvents,
    });
    return;
  }

  if (req.method === 'GET' && pathname === '/api/history') {
    if (!ensureAuthorizedApi(req, res, pathname, 'viewer')) {
      return;
    }
    const requestUrl = new URL(req.url || '/api/history', `http://${req.headers.host || APP_CONFIG.httpHost}`);
    const limitRaw = requestUrl.searchParams.get('limit');
    const offsetRaw = requestUrl.searchParams.get('offset');
    const limit = Number(limitRaw || 100);
    const offset = Number(offsetRaw || 0);
    const sessionId = (requestUrl.searchParams.get('sessionId') || '').trim() || undefined;
    const resolution = parseHistoryResolution(requestUrl.searchParams.get('resolution'));
    const keyword = (requestUrl.searchParams.get('q') || '').trim() || undefined;
    const historyQuery = {
      limit,
      offset,
      sessionId,
      resolution,
      keyword,
    };
    const { items: history, total } = waitStore.queryHistory(historyQuery);
    const safeLimit = Number.isInteger(limit) ? Math.max(1, Math.min(1000, limit)) : 100;
    const safeOffset = Number.isInteger(offset) ? Math.max(0, offset) : 0;
    sendJson(res, 200, {
      count: history.length,
      total,
      history,
      maxStored: APP_CONFIG.waitHistoryMaxItems,
      filters: {
        limit: safeLimit,
        offset: safeOffset,
        sessionId: sessionId || null,
        resolution: resolution || null,
        q: keyword || null,
      },
      pagination: {
        limit: safeLimit,
        offset: safeOffset,
        hasMore: safeOffset + history.length < total,
      },
    });
    return;
  }
  if (req.method === 'GET' && pathname === '/api/auth-check') {
    if (!ensureAuthorizedApi(req, res, pathname, 'viewer')) {
      return;
    }
    sendJson(res, 200, { role: resolveRequestRole(req) });
    return;
  }

  if (req.method === 'GET' && pathname === '/api/history/timeline') {
    if (!ensureAuthorizedApi(req, res, pathname, 'viewer')) {
      return;
    }
    const requestUrl = new URL(req.url || '/api/history/timeline', `http://${req.headers.host || APP_CONFIG.httpHost}`);
    const sessionId = (requestUrl.searchParams.get('sessionId') || '').trim();
    if (!sessionId) {
      sendJson(res, 400, { error: 'Missing required query param: sessionId' });
      return;
    }
    const timeline = waitStore.listSessionTimeline(sessionId);
    sendJson(res, 200, { sessionId, count: timeline.length, timeline });
    return;
  }

  if (req.method === 'GET' && pathname === '/api/stream') {
    // EventSource cannot send custom headers, so accept token via query param
    const streamUrl = new URL(req.url || '/api/stream', `http://${req.headers.host || APP_CONFIG.httpHost}`);
    const queryToken = (streamUrl.searchParams.get('token') || '').trim();
    if (queryToken && !extractApiKey(req)) {
      // Inject the query token as a header for auth resolution
      (req.headers as Record<string, string>)['x-turn-mcp-api-key'] = queryToken;
    }
    if (!ensureAuthorizedApi(req, res, pathname, 'viewer')) {
      return;
    }
    applyCorsHeaders(res);
    res.writeHead(200, {
      'content-type': 'text/event-stream',
      'cache-control': 'no-cache',
      'connection': 'keep-alive',
    });
    res.write(':connected\n\n');
    sseManager.addClient(res);
    return;
  }

  if (req.method === 'GET' && pathname === '/api/events') {
    if (!ensureAuthorizedApi(req, res, pathname, 'operator')) {
      return;
    }
    const requestUrl = new URL(req.url || '/api/events', `http://${req.headers.host || APP_CONFIG.httpHost}`);
    const limitRaw = requestUrl.searchParams.get('limit');
    const offsetRaw = requestUrl.searchParams.get('offset');
    const typeRaw = requestUrl.searchParams.get('type');
    const limit = Number(limitRaw || 200);
    const offset = Number(offsetRaw || 0);
    const type = (typeRaw || '').trim() || undefined;
    const eventQuery = eventLogger.query(limit, offset, type);
    sendJson(res, 200, {
      enabled: eventLogger.isFileEnabled(),
      count: eventQuery.events.length,
      total: eventQuery.total,
      events: eventQuery.events,
      availableTypes: eventQuery.availableTypes,
      typeCounts: eventQuery.typeCounts,
      filters: {
        type: eventQuery.filterType,
      },
      pagination: {
        limit: eventQuery.limit,
        offset: eventQuery.offset,
        hasMore: eventQuery.hasMore,
      },
    });
    return;
  }

  if (req.method === 'GET' && pathname === '/api/sessions') {
    if (!ensureAuthorizedApi(req, res, pathname, 'viewer')) {
      return;
    }
    const summaries = waitStore.listSessionSummaries();
    sendJson(res, 200, {
      sessions: summaries,
      count: summaries.length,
      reinforcementSuffix: APP_CONFIG.reinforcementSuffix,
      webhookUrl: runtimeConfig.webhookUrl,
      webhookEvents: runtimeConfig.webhookEvents,
    });
    return;
  }

  if (!ensureAuthorizedApi(req, res, pathname, 'viewer')) {
    return;
  }

  if (req.method === 'GET' && pathname === '/api/waits') {
    const now = Date.now();
    const waits = waitStore.listPendingWaits().map((w) => ({
      ...w,
      remainingSeconds: w.expiresAt <= 0 ? -1 : Math.max(0, Math.floor((w.expiresAt - now) / 1000)),
    }));
    sendJson(res, 200, {
      waits,
      count: waits.length,
      reinforcementSuffix: APP_CONFIG.reinforcementSuffix,
    });
    return;
  }

  // Long-poll: create a wait and block until the human responds
  if (req.method === 'POST' && pathname === '/api/waits/create-and-wait') {
    if (!ensureAuthorizedApi(req, res, pathname, 'operator')) return;
    const body = await readJsonBody(req) as Record<string, unknown> | undefined;
    const context = body?.context;
    if (typeof context !== 'string' || !context.trim()) {
      sendJson(res, 400, { error: 'Missing required field: "context" (string).' });
      return;
    }
    const sessionId =
      (typeof body?.sessionId === 'string' && body.sessionId.trim())
        ? body.sessionId.trim()
        : `rest-${randomUUID().slice(0, 12)}`;
    const rawTimeout = typeof body?.timeoutSeconds === 'number' ? body.timeoutSeconds : runtimeConfig.defaultTimeoutSeconds;
    const effectiveTimeout = runtimeConfig.timeoutEnabled ? Math.max(0, Math.min(3600, Math.floor(rawTimeout))) : 0;
    const timeoutMs = effectiveTimeout * 1000;
    // Disable socket idle timeout for long-poll connections
    req.socket.setTimeout(0);
    const resolution = await waitStore.waitForResponse({
      sessionId,
      context: context.trim(),
      question: typeof body?.question === 'string' ? body.question.trim() || undefined : undefined,
      options: Array.isArray(body?.options)
        ? (body.options as unknown[]).filter((o): o is string => typeof o === 'string' && o.trim().length > 0)
        : undefined,
      agentName: typeof body?.agentName === 'string' ? body.agentName.trim() || undefined : undefined,
      timeoutMs,
    });
    if (resolution.kind === 'busy') {
      sendJson(res, 409, { error: 'busy', activeWaitIds: resolution.activeWaitIds });
      return;
    }
    if (resolution.kind === 'timeout') {
      sendJson(res, 200, { ok: true, resolution: 'timeout', message: null, sessionId });
      return;
    }
    if (resolution.kind === 'canceled') {
      sendJson(res, 200, { ok: true, resolution: 'canceled', message: null, sessionId });
      return;
    }
    sendJson(res, 200, { ok: true, resolution: 'message', message: resolution.text, sessionId });
    return;
  }

  // Cancel all pending waits
  if (req.method === 'POST' && pathname === '/api/waits/cancel-all') {
    if (!ensureAuthorizedApi(req, res, pathname, 'operator')) return;
    const count = waitStore.cancelAll();
    eventLogger.log('waits_cancel_all', { count });
    sendJson(res, 200, { ok: true, canceled: count });
    return;
  }

  // Get single pending wait (full context)
  if (req.method === 'GET' && /^\/api\/waits\/[^/]+$/.test(pathname)) {
    const waitId = pathname.slice('/api/waits/'.length);
    const wait = waitStore.getPendingWait(waitId);
    if (!wait) { sendJson(res, 404, { error: 'wait-not-found' }); return; }
    sendJson(res, 200, { wait });
    return;
  }

  const detail = parseWaitApiPath(pathname);
  if (!detail || req.method !== 'POST') {
    sendJson(res, 404, { error: 'Not found' });
    return;
  }

  if (!ensureAuthorizedApi(req, res, pathname, 'operator')) {
    return;
  }

  if (detail.action === 'cancel') {
    const result = waitStore.cancel(detail.id);
    if (!result.ok) {
      sendJson(res, 404, { error: result.reason });
      return;
    }
    sendJson(res, 200, { ok: true });
    return;
  }

  if (detail.action === 'extend') {
    const extBody = await readJsonBody(req);
    const seconds = (extBody as { seconds?: unknown } | undefined)?.seconds;
    if (typeof seconds !== 'number' || !Number.isInteger(seconds)) {
      sendJson(res, 400, { error: 'Invalid payload: "seconds" must be an integer.' });
      return;
    }
    const result = waitStore.extend(detail.id, seconds);
    if (!result.ok) {
      const statusCode = result.reason === 'wait-not-found' ? 404 : 400;
      sendJson(res, statusCode, { error: result.reason });
      return;
    }
    sendJson(res, 200, { ok: true, newExpiresAt: result.newExpiresAt });
    return;
  }

  const body = await readJsonBody(req);
  const message = (body as { message?: unknown } | undefined)?.message;
  if (typeof message !== 'string') {
    sendJson(res, 400, { error: 'Invalid payload: "message" must be string.' });
    return;
  }

  const result = waitStore.respond(detail.id, message);
  if (!result.ok) {
    const statusCode = result.reason === 'wait-not-found' ? 404 : 400;
    sendJson(res, statusCode, { error: result.reason });
    return;
  }
  sendJson(res, 200, { ok: true });
}

function getContentTypeByExt(fileName: string): string {
  if (fileName.endsWith('.html')) {
    return 'text/html; charset=utf-8';
  }
  if (fileName.endsWith('.js')) {
    return 'application/javascript; charset=utf-8';
  }
  if (fileName.endsWith('.css')) {
    return 'text/css; charset=utf-8';
  }
  return 'application/octet-stream';
}

function serveStatic(req: IncomingMessage, res: ServerResponse, pathname: string): void {
  if (req.method !== 'GET') {
    sendJson(res, 404, { error: 'Not found' });
    return;
  }

  const fileName = pathname === '/' ? 'index.html' : pathname.slice(1);
  const content = staticCache.get(fileName);
  if (!content) {
    sendJson(res, 404, { error: 'Not found' });
    return;
  }

  applyCorsHeaders(res);
  res.setHeader('content-type', getContentTypeByExt(fileName));
  res.setHeader('cache-control', 'no-cache');

  // ETag / 304 support
  const etag = staticCacheEtag.get(fileName);
  if (etag) {
    res.setHeader('etag', etag);
    if (getHeaderString(req, 'if-none-match') === etag) {
      res.statusCode = 304;
      res.end();
      return;
    }
  }

  // Gzip support
  const gzipped = staticCacheGzip.get(fileName);
  if (gzipped && (getHeaderString(req, 'accept-encoding') || '').includes('gzip')) {
    res.setHeader('content-encoding', 'gzip');
    res.setHeader('vary', 'accept-encoding');
    res.statusCode = 200;
    res.end(gzipped);
  } else {
    res.statusCode = 200;
    res.end(content);
  }
}

const httpServer = createServer((req, res) => {
  const requestUrl = new URL(req.url || '/', `http://${req.headers.host || APP_CONFIG.httpHost}`);
  const pathname = requestUrl.pathname;

  if (pathname === '/healthz') {
    sendJson(res, 200, {
      ok: true,
      name: APP_CONFIG.name,
      version: APP_CONFIG.version,
      activeSessions: sessions.size,
      pendingWaits: waitStore.listPendingWaits().length,
      historyCount: waitStore.historyCount(),
      requireApiKey: APP_CONFIG.requireApiKey,
      hasOperatorApiKeyConfigured: Boolean(APP_CONFIG.operatorApiKey),
      hasViewerApiKeyConfigured: Boolean(APP_CONFIG.viewerApiKey),
    });
    return;
  }

  if (pathname === APP_CONFIG.mcpPath) {
    handleMcpRequest(req, res).catch((error) => {
      logger.error('handleMcpRequest', error);
      sendJsonRpcError(res, 400, error instanceof Error ? error.message : String(error));
    });
    return;
  }

  if (pathname.startsWith('/api/')) {
    const ip = req.socket.remoteAddress || 'unknown';
    if (!rateLimiter.check(ip)) {
      sendJson(res, 429, { error: 'Too many requests. Please slow down.' });
      return;
    }
    handleApiRequest(req, res, pathname).catch((error) => {
      logger.error('handleApiRequest', error);
      sendJson(res, 500, { error: error instanceof Error ? error.message : String(error) });
    });
    return;
  }

  serveStatic(req, res, pathname);
});

async function closeAllSessions(): Promise<void> {
  const closing = Array.from(sessions.values()).map(async ({ transport, server }) => {
    try {
      await transport.close();
    } catch (error) {
      logger.error('transport.close', error);
    }
    try {
      await server.close();
    } catch (error) {
      logger.error('server.close', error);
    }
  });
  await Promise.allSettled(closing);
  sessions.clear();
}

httpServer.listen(APP_CONFIG.httpPort, APP_CONFIG.httpHost, () => {
  logger.info(`Web console: http://${APP_CONFIG.httpHost}:${APP_CONFIG.httpPort}/`);
  if (!STDIO_MODE) {
    logger.info(`MCP endpoint: http://${APP_CONFIG.httpHost}:${APP_CONFIG.httpPort}${APP_CONFIG.mcpPath}`);
  }
  logger.info(`Reinforcement suffix enabled: ${APP_CONFIG.reinforcementSuffix}`);
  logger.info(`API key auth: ${APP_CONFIG.requireApiKey ? 'enabled' : 'disabled'}`);
  logger.info(
    `API key roles: operator=${APP_CONFIG.operatorApiKey ? 'set' : 'unset'}, viewer=${APP_CONFIG.viewerApiKey ? 'set' : 'unset'}`
  );
  logger.info(`Rate limiting: ${APP_CONFIG.rateLimitMax > 0 ? `${APP_CONFIG.rateLimitMax} req/${APP_CONFIG.rateLimitWindowSeconds}s` : 'disabled'}`);
  eventLogger.log('server_started', {
    host: APP_CONFIG.httpHost,
    port: APP_CONFIG.httpPort,
    mcpPath: APP_CONFIG.mcpPath,
    requireApiKey: APP_CONFIG.requireApiKey,
    operatorKeyConfigured: Boolean(APP_CONFIG.operatorApiKey),
    viewerKeyConfigured: Boolean(APP_CONFIG.viewerApiKey),
    eventLogFileEnabled: Boolean(APP_CONFIG.eventLogFile),
    stdioMode: STDIO_MODE,
  });

  // --stdio mode: also attach MCP to stdio transport (for Claude Desktop, Cline, etc.)
  if (STDIO_MODE) {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const { StdioServerTransport } = require('@modelcontextprotocol/sdk/server/stdio.js') as
      typeof import('@modelcontextprotocol/sdk/server/stdio.js');
    const stdioMcpServer = new TurnWaitMcpServer(waitStore, () => 'stdio-0');
    const stdioTransport = new StdioServerTransport();
    stdioTransport.onclose = () => {
      logger.info('Stdio MCP transport closed — shutting down');
      shutdown().catch(() => process.exit(0));
    };
    stdioMcpServer.connect(stdioTransport).then(() => {
      logger.info('Stdio MCP transport connected (stdout reserved for MCP protocol)');
      logger.info(`Web console available at: http://${APP_CONFIG.httpHost}:${APP_CONFIG.httpPort}/`);
    }).catch((err: unknown) => {
      logger.error('stdio transport connect', err);
    });
  }
});

async function shutdown(): Promise<void> {
  logger.info('Shutting down...');
  eventLogger.log('server_stopping', {});
  await closeAllSessions();
  clearInterval(sessionCleanupTimer);
  sseManager.destroy();
  httpServer.close((error) => {
    if (error) {
      logger.error('httpServer.close', error);
      process.exit(1);
      return;
    }
    process.exit(0);
  });
}

process.on('SIGINT', () => {
  shutdown().catch((error) => {
    logger.error('shutdown', error);
    process.exit(1);
  });
});

process.on('SIGTERM', () => {
  shutdown().catch((error) => {
    logger.error('shutdown', error);
    process.exit(1);
  });
});
