const assert = require('node:assert/strict');
const { bootstrapApp } = require('./ui-test-harness');

const UI_STATE_STORAGE = 'turn-mcp-web-universal.uiState';

function readUiState(localStorage) {
  const raw = localStorage.getItem(UI_STATE_STORAGE);
  assert.equal(typeof raw, 'string');
  return JSON.parse(raw);
}

async function testEventsHiddenWhenApiKeyRequiredButMissing() {
  const scenario = await bootstrapApp({
    requireApiKey: true,
    hasApiKey: false,
    eventsOffset: 0,
    eventsTotal: 100,
    entryCount: 605,
  });
  assert.equal(scenario.elementsById.summaryText.textContent, '等待密钥');
  assert.equal(scenario.elementsById.eventsCard.classList.contains('hidden'), true);
  assert.equal(scenario.elementsById.eventsEntryMemoryHint.textContent, '');
  assert.equal(scenario.elementsById.eventsPrevBtn.disabled, true);
  assert.equal(scenario.elementsById.eventsNextBtn.disabled, true);
}

async function testViewerRoleHidesEventsButKeepsHistoryAccessible() {
  const scenario = await bootstrapApp({
    requireApiKey: true,
    hasApiKey: true,
    authRole: 'viewer',
    historyTotal: 100,
    eventsTotal: 100,
    historyOffset: 0,
    eventsOffset: 0,
  });
  assert.match(scenario.elementsById.summaryText.textContent, /当前角色：viewer/);
  assert.equal(scenario.elementsById.eventsCard.classList.contains('hidden'), true);
  assert.equal(scenario.elementsById.eventsPrevBtn.disabled, true);
  assert.equal(scenario.elementsById.eventsNextBtn.disabled, true);
  assert.equal(scenario.elementsById.historyNextBtn.disabled, false);
  await scenario.dispatchEvent('historyNextBtn', 'click');
  const state = readUiState(scenario.localStorage);
  assert.equal(state.historyOffset, 20);
}

async function testOperatorRoleShowsEventsAndAllowsPaging() {
  const scenario = await bootstrapApp({
    requireApiKey: true,
    hasApiKey: true,
    authRole: 'operator',
    eventsTotal: 100,
    eventsOffset: 0,
  });
  assert.match(scenario.elementsById.summaryText.textContent, /当前角色：operator/);
  assert.equal(scenario.elementsById.eventsCard.classList.contains('hidden'), false);
  assert.equal(scenario.elementsById.eventsPrevBtn.disabled, true);
  assert.equal(scenario.elementsById.eventsNextBtn.disabled, false);
  await scenario.dispatchEvent('eventsNextBtn', 'click');
  const state = readUiState(scenario.localStorage);
  assert.equal(state.eventsOffset, 20);
}

async function main() {
  await testEventsHiddenWhenApiKeyRequiredButMissing();
  await testViewerRoleHidesEventsButKeepsHistoryAccessible();
  await testOperatorRoleShowsEventsAndAllowsPaging();
  process.stdout.write('ok - ui events auth visibility\n');
}

main().catch((error) => {
  process.stderr.write(`${error && error.stack ? error.stack : String(error)}\n`);
  process.exit(1);
});
