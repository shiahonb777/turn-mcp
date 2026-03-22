/**
 * Unit tests for WaitStore (tests/wait-store.test.js)
 *
 * Requires the project to be compiled first: npm run build
 * Run: node ./tests/wait-store.test.js
 */

'use strict';

// Patch APP_CONFIG before requiring dist so we control limits
process.env.TURN_MCP_WAIT_HISTORY_MAX_ITEMS = '10';
process.env.TURN_MCP_MAX_USER_MESSAGE_CHARS = '1000';
process.env.TURN_MCP_DEFAULT_TIMEOUT_SECONDS = '600';
process.env.TURN_MCP_REINFORCEMENT_SUFFIX = '[TEST_SUFFIX]';
// Set max concurrent to 2 so busy tests are fast (not needing 10 waits to trigger)
process.env.TURN_MCP_MAX_CONCURRENT_WAITS_PER_SESSION = '2';

const path = require('path');
const { WaitStore } = require(path.join(__dirname, '../dist/wait-store.js'));

// ─── Minimal test harness ────────────────────────────────────────────────────
let passed = 0;
let failed = 0;
const errors = [];

async function test(name, fn) {
  try {
    await fn();
    console.log('  ✓', name);
    passed++;
  } catch (err) {
    console.error('  ✗', name);
    console.error('   ', err.message);
    errors.push({ name, err });
    failed++;
  }
}

function assert(condition, message) {
  if (!condition) throw new Error(message || 'Assertion failed');
}

function assertEqual(actual, expected, message) {
  if (actual !== expected) {
    throw new Error(`${message || 'assertEqual'}: expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`);
  }
}

/**
 * WaitStore uses timer.unref() so its timers don't keep the event loop alive.
 * In tests we need a ref'd keepalive timer alongside unref'd waits.
 */
function withKeepAlive(promise, extraMs) {
  return new Promise((resolve, reject) => {
    const guard = setTimeout(() => reject(new Error('Test keepalive guard expired')), (extraMs || 200) + 1000);
    promise.then((val) => { clearTimeout(guard); resolve(val); }).catch((err) => { clearTimeout(guard); reject(err); });
  });
}

// ─── Tests ──────────────────────────────────────────────────────────────────

(async () => {

console.log('\nWaitStore unit tests\n');

// --- respond workflow --------------------------------------------------------
await test('respond: resolves with "message" and appends reinforcement suffix', async () => {
  const events = [];
  const store = new WaitStore((e) => events.push(e));

  const promise = store.waitForResponse({
    sessionId: 'sess-1',
    context: 'Doing something',
    timeoutMs: 5000,
  });

  // Store should show one pending wait
  const pending = store.listPendingWaits();
  assert(pending.length === 1, 'Expected 1 pending wait');
  assertEqual(pending[0].sessionId, 'sess-1');
  assert(pending[0].expiresAt > Date.now(), 'expiresAt should be in the future');

  const result = store.respond(pending[0].id, 'hello');
  assert(result.ok, 'respond should succeed');

  const resolution = await promise;
  assertEqual(resolution.kind, 'message');
  assert(resolution.text.startsWith('hello'), 'text should start with user message');
  assert(resolution.text.includes('[TEST_SUFFIX]'), 'text should include reinforcement suffix');
  assertEqual(store.listPendingWaits().length, 0, 'No pending waits after respond');
});

// --- empty message still gets suffix ----------------------------------------
await test('respond: empty message still returns reinforcement suffix', async () => {
  const store = new WaitStore();
  const promise = store.waitForResponse({ sessionId: 'sess-x', context: 'ctx', timeoutMs: 5000 });
  const [wait] = store.listPendingWaits();
  store.respond(wait.id, '   ');
  const resolution = await promise;
  assertEqual(resolution.kind, 'message');
  assertEqual(resolution.text, '[TEST_SUFFIX]', 'Empty trimmed message → only suffix');
});

// --- cancel -----------------------------------------------------------------
await test('cancel: resolves with "canceled"', async () => {
  const store = new WaitStore();
  const promise = store.waitForResponse({ sessionId: 's2', context: 'ctx', timeoutMs: 5000 });
  const [wait] = store.listPendingWaits();
  const result = store.cancel(wait.id);
  assert(result.ok, 'cancel should succeed');
  const resolution = await promise;
  assertEqual(resolution.kind, 'canceled');
  assertEqual(store.listPendingWaits().length, 0);
});

// --- cancel non-existent ----------------------------------------------------
await test('cancel: returns error for unknown id', () => {
  const store = new WaitStore();
  const result = store.cancel('does-not-exist');
  assert(!result.ok, 'cancel unknown should fail');
  assertEqual(result.reason, 'wait-not-found');
});

// --- respond non-existent ---------------------------------------------------
await test('respond: returns error for unknown id', () => {
  const store = new WaitStore();
  const result = store.respond('does-not-exist', 'hi');
  assert(!result.ok, 'respond unknown should fail');
  assertEqual(result.reason, 'wait-not-found');
});

// --- timeout ----------------------------------------------------------------
await test('timeout: resolves with "timeout" after timeoutMs', async () => {
  const store = new WaitStore();
  const promise = store.waitForResponse({ sessionId: 's3', context: 'ctx', timeoutMs: 50 });
  const resolution = await withKeepAlive(promise, 50);
  assertEqual(resolution.kind, 'timeout');
  assertEqual(store.listPendingWaits().length, 0);
});

// --- no-timeout mode (timeoutMs=0) ------------------------------------------
await test('no-timeout: expiresAt is 0 when timeoutMs=0', async () => {
  const store = new WaitStore();
  store.waitForResponse({ sessionId: 'notimeout', context: 'ctx', timeoutMs: 0 });
  const [wait] = store.listPendingWaits();
  assertEqual(wait.expiresAt, 0, 'expiresAt should be 0 for no-timeout waits');
  store.cancel(wait.id);
});

// --- busy: max concurrent waits per session (limit=2 in test env) -----------
await test('busy: (maxConcurrent+1)th wait on same session returns busy', async () => {
  const store = new WaitStore();
  // Fill up to the max (2 in test env)
  store.waitForResponse({ sessionId: 'sess-busy', context: 'ctx1', timeoutMs: 5000 });
  store.waitForResponse({ sessionId: 'sess-busy', context: 'ctx2', timeoutMs: 5000 });
  // Third wait on same session — should immediately resolve as busy
  const busy = await store.waitForResponse({ sessionId: 'sess-busy', context: 'ctx3', timeoutMs: 5000 });
  assertEqual(busy.kind, 'busy');
  assert(busy.activeWaitIds && busy.activeWaitIds.length === 2, 'activeWaitIds should have 2 entries');
  // Clean up both active waits
  store.cancelAll();
});

// --- multi-wait: multiple concurrent waits per session are allowed -----------
await test('multi-wait: up to maxConcurrent waits can be active per session', async () => {
  const store = new WaitStore();
  store.waitForResponse({ sessionId: 'mw1', context: 'A', timeoutMs: 5000 });
  store.waitForResponse({ sessionId: 'mw1', context: 'B', timeoutMs: 5000 });
  assertEqual(store.listPendingWaits().length, 2, 'Both waits in same session should be pending');
  const summaries = store.listSessionSummaries();
  const mw1 = summaries.find(s => s.sessionId === 'mw1');
  assert(mw1 && mw1.pendingWaits && mw1.pendingWaits.length === 2, 'SessionSummary should expose pendingWaits array');
  store.cancelAll();
  assertEqual(store.listPendingWaits().length, 0);
});

// --- different sessions can wait concurrently --------------------------------
await test('concurrent: different sessions can have independent waits', async () => {
  const store = new WaitStore();
  // Each session can have up to maxConcurrent (2) waits
  store.waitForResponse({ sessionId: 'c1', context: 'ctx1a', timeoutMs: 5000 });
  store.waitForResponse({ sessionId: 'c1', context: 'ctx1b', timeoutMs: 5000 });
  store.waitForResponse({ sessionId: 'c2', context: 'ctx2a', timeoutMs: 5000 });
  assertEqual(store.listPendingWaits().length, 3, 'All 3 waits should be pending');
  store.cancelAll();
  assertEqual(store.listPendingWaits().length, 0, 'All waits should be gone after cancelAll');
});

// --- history ----------------------------------------------------------------
await test('history: completed waits appear in history', async () => {
  const store = new WaitStore();
  const p = store.waitForResponse({ sessionId: 'h1', context: 'doing X', question: 'proceed?', timeoutMs: 5000 });
  const [wait] = store.listPendingWaits();
  store.respond(wait.id, 'yes');
  await p;

  const { items, total } = store.queryHistory();
  assertEqual(total, 1, 'history should have 1 item');
  assertEqual(items[0].resolution, 'message');
  assertEqual(items[0].sessionId, 'h1');
  assertEqual(items[0].userMessage, 'yes');
});

// --- queryHistory filters ----------------------------------------------------
await test('queryHistory: filter by resolution', async () => {
  const store = new WaitStore();

  // message resolution
  const p1 = store.waitForResponse({ sessionId: 'f1', context: 'A', timeoutMs: 5000 });
  store.respond(store.listPendingWaits()[0].id, 'ok');
  await p1;

  // timeout resolution
  await withKeepAlive(store.waitForResponse({ sessionId: 'f2', context: 'B', timeoutMs: 30 }), 30);

  // canceled resolution
  const p3 = store.waitForResponse({ sessionId: 'f3', context: 'C', timeoutMs: 5000 });
  store.cancel(store.listPendingWaits()[0].id);
  await p3;

  assertEqual(store.queryHistory({ resolution: 'message' }).total, 1, '1 message resolution');
  assertEqual(store.queryHistory({ resolution: 'timeout' }).total, 1, '1 timeout resolution');
  assertEqual(store.queryHistory({ resolution: 'canceled' }).total, 1, '1 canceled resolution');
  assertEqual(store.queryHistory().total, 3, '3 total');
});

// --- queryHistory keyword ---------------------------------------------------
await test('queryHistory: keyword filter matches context', async () => {
  const store = new WaitStore();
  const p = store.waitForResponse({ sessionId: 'kw1', context: 'deploying to production', timeoutMs: 5000 });
  store.respond(store.listPendingWaits()[0].id, 'go');
  await p;

  assertEqual(store.queryHistory({ keyword: 'production' }).total, 1, 'keyword match');
  assertEqual(store.queryHistory({ keyword: 'staging' }).total, 0, 'no match for staging');
});

// --- listSessionTimeline ----------------------------------------------------
await test('listSessionTimeline: returns items in chronological order', async () => {
  const store = new WaitStore();
  const sess = 'timeline-sess';
  for (let i = 0; i < 3; i++) {
    const p = store.waitForResponse({ sessionId: sess, context: `step ${i}`, timeoutMs: 5000 });
    store.respond(store.listPendingWaits()[0].id, `reply ${i}`);
    await p;
  }
  const timeline = store.listSessionTimeline(sess);
  assertEqual(timeline.length, 3);
  // Should be oldest-first (chronological)
  for (let i = 1; i < timeline.length; i++) {
    assert(timeline[i].createdAt >= timeline[i - 1].createdAt, 'timeline should be ordered');
  }
});

// --- extend -----------------------------------------------------------------
await test('extend: increases expiresAt', async () => {
  const store = new WaitStore();
  store.waitForResponse({ sessionId: 'ext1', context: 'ctx', timeoutMs: 5000 });
  const [wait] = store.listPendingWaits();
  const before = wait.expiresAt;
  const result = store.extend(wait.id, 300);
  assert(result.ok, 'extend should succeed');
  assert(result.newExpiresAt > before, 'newExpiresAt should be greater');
  store.cancel(wait.id);
});

// --- extend validation ------------------------------------------------------
await test('extend: rejects invalid seconds (< 30)', () => {
  const store = new WaitStore();
  store.waitForResponse({ sessionId: 'extv1', context: 'ctx', timeoutMs: 5000 });
  const [wait] = store.listPendingWaits();
  const result = store.extend(wait.id, 10);
  assert(!result.ok, 'should reject seconds < 30');
  store.cancel(wait.id);
});

// --- historyCount -----------------------------------------------------------
await test('historyCount: returns correct count', async () => {
  const store = new WaitStore();
  assertEqual(store.historyCount(), 0);
  const p = store.waitForResponse({ sessionId: 'hc1', context: 'ctx', timeoutMs: 5000 });
  store.respond(store.listPendingWaits()[0].id, 'hi');
  await p;
  assertEqual(store.historyCount(), 1);
});

// --- cancelAll --------------------------------------------------------------
await test('cancelAll: cancels all pending waits and returns count', async () => {
  const store = new WaitStore();
  store.waitForResponse({ sessionId: 'ca1', context: 'A', timeoutMs: 5000 });
  store.waitForResponse({ sessionId: 'ca2', context: 'B', timeoutMs: 5000 });
  store.waitForResponse({ sessionId: 'ca3', context: 'C', timeoutMs: 5000 });
  assertEqual(store.listPendingWaits().length, 3);
  const count = store.cancelAll();
  assertEqual(count, 3, 'cancelAll should return 3');
  assertEqual(store.listPendingWaits().length, 0);
});

// --- message too long -------------------------------------------------------
await test('respond: rejects message exceeding maxUserMessageChars', () => {
  const store = new WaitStore();
  store.waitForResponse({ sessionId: 'ml1', context: 'ctx', timeoutMs: 5000 });
  const [wait] = store.listPendingWaits();
  const result = store.respond(wait.id, 'x'.repeat(1001));
  assert(!result.ok, 'should reject too-long message');
  assert(result.reason.includes('message-too-long'), 'reason should mention message-too-long');
  store.cancel(wait.id);
});

// ─── Summary ─────────────────────────────────────────────────────────────────
console.log(`\n${passed} passed, ${failed} failed\n`);
if (failed > 0) {
  process.exit(1);
}

})().catch((err) => { console.error(err); process.exit(1); });
