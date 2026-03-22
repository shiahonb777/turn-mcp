const assert = require('node:assert/strict');
const { bootstrapApp } = require('./ui-test-harness');

const UI_STATE_STORAGE = 'turn-mcp-web-universal.uiState';

function readUiState(localStorage) {
  const raw = localStorage.getItem(UI_STATE_STORAGE);
  assert.equal(typeof raw, 'string');
  return JSON.parse(raw);
}

async function testHistorySessionEnterPersistsAndResetsOffset() {
  const scenario = await bootstrapApp({
    requireApiKey: false,
    hasApiKey: false,
    historyOffset: 80,
  });
  const sessionInput = scenario.getElementByIdStrict('historySessionFilter');
  sessionInput.value = 'sess_enter_test';
  const event = await scenario.dispatchEvent('historySessionFilter', 'keydown', { key: 'Enter' });
  assert.equal(event.defaultPrevented, true);
  const state = readUiState(scenario.localStorage);
  assert.equal(state.historyFilters.sessionId, 'sess_enter_test');
  assert.equal(state.historyOffset, 0);
}

async function testHistoryKeywordNonEnterDoesNotApply() {
  const scenario = await bootstrapApp({
    requireApiKey: false,
    hasApiKey: false,
    historyOffset: 35,
  });
  const baselineState = readUiState(scenario.localStorage);
  const keywordInput = scenario.getElementByIdStrict('historyKeywordFilter');
  keywordInput.value = 'keyword_non_enter';
  const event = await scenario.dispatchEvent('historyKeywordFilter', 'keydown', { key: 'Escape' });
  assert.equal(event.defaultPrevented, false);
  const state = readUiState(scenario.localStorage);
  assert.equal(state.historyFilters.q, baselineState.historyFilters.q);
  assert.equal(state.historyOffset, baselineState.historyOffset);
}

async function testHistoryResolutionChangePersistsAndResetsOffset() {
  const scenario = await bootstrapApp({
    requireApiKey: false,
    hasApiKey: false,
    historyOffset: 45,
  });
  const resolutionSelect = scenario.getElementByIdStrict('historyResolutionFilter');
  resolutionSelect.value = 'timeout';
  await scenario.dispatchEvent('historyResolutionFilter', 'change');
  const state = readUiState(scenario.localStorage);
  assert.equal(state.historyFilters.resolution, 'timeout');
  assert.equal(state.historyOffset, 0);
}

async function testHistoryResetClearsFiltersAndOffset() {
  const scenario = await bootstrapApp({
    requireApiKey: false,
    hasApiKey: false,
    historyOffset: 120,
    historyFilters: {
      sessionId: 'sess_before_reset',
      resolution: 'canceled',
      q: 'q_before_reset',
    },
  });
  const stateBeforeReset = readUiState(scenario.localStorage);
  assert.equal(stateBeforeReset.historyFilters.sessionId, 'sess_before_reset');
  assert.equal(stateBeforeReset.historyFilters.resolution, 'canceled');
  assert.equal(stateBeforeReset.historyFilters.q, 'q_before_reset');
  await scenario.dispatchEvent('historyResetBtn', 'click');
  const stateAfterReset = readUiState(scenario.localStorage);
  assert.equal(stateAfterReset.historyFilters.sessionId, '');
  assert.equal(stateAfterReset.historyFilters.resolution, '');
  assert.equal(stateAfterReset.historyFilters.q, '');
  assert.equal(stateAfterReset.historyOffset, 0);
}

async function main() {
  await testHistorySessionEnterPersistsAndResetsOffset();
  await testHistoryKeywordNonEnterDoesNotApply();
  await testHistoryResolutionChangePersistsAndResetsOffset();
  await testHistoryResetClearsFiltersAndOffset();
  process.stdout.write('ok - ui history filter interactions\n');
}

main().catch((error) => {
  process.stderr.write(`${error && error.stack ? error.stack : String(error)}\n`);
  process.exit(1);
});
