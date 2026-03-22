const assert = require('node:assert/strict');
const { bootstrapApp } = require('./ui-test-harness');

const UI_STATE_STORAGE = 'turn-mcp-web-universal.uiState';

function readUiState(localStorage) {
  const raw = localStorage.getItem(UI_STATE_STORAGE);
  assert.equal(typeof raw, 'string');
  return JSON.parse(raw);
}

async function testEventsGroupLimitEnterPersistsAndPreventsDefault() {
  const scenario = await bootstrapApp({
    requireApiKey: false,
    hasApiKey: false,
    eventsOffset: 40,
  });
  const groupLimitInput = scenario.getElementByIdStrict('eventsGroupLimit');
  groupLimitInput.value = '7';
  const event = await scenario.dispatchEvent('eventsGroupLimit', 'keydown', { key: 'Enter' });
  assert.equal(event.defaultPrevented, true);
  const state = readUiState(scenario.localStorage);
  assert.equal(state.eventsFilters.groupLimit, 7);
  assert.equal(state.eventsOffset, 0);
}

async function testEventsGroupLimitNonEnterDoesNotApply() {
  const scenario = await bootstrapApp({
    requireApiKey: false,
    hasApiKey: false,
    eventsOffset: 40,
  });
  const baselineState = readUiState(scenario.localStorage);
  const groupLimitInput = scenario.getElementByIdStrict('eventsGroupLimit');
  groupLimitInput.value = '9';
  const event = await scenario.dispatchEvent('eventsGroupLimit', 'keydown', { key: 'Escape' });
  assert.equal(event.defaultPrevented, false);
  const state = readUiState(scenario.localStorage);
  assert.equal(state.eventsFilters.groupLimit, baselineState.eventsFilters.groupLimit);
  assert.equal(state.eventsOffset, baselineState.eventsOffset);
}

async function testEventsTypeChangePersistsAndResetsOffset() {
  const scenario = await bootstrapApp({
    requireApiKey: false,
    hasApiKey: false,
    eventsOffset: 60,
  });
  const typeSelect = scenario.getElementByIdStrict('eventsTypeFilter');
  typeSelect.value = 'wait_created';
  await scenario.dispatchEvent('eventsTypeFilter', 'change');
  const state = readUiState(scenario.localStorage);
  assert.equal(state.eventsFilters.type, 'wait_created');
  assert.equal(state.eventsOffset, 0);
}

async function main() {
  await testEventsGroupLimitEnterPersistsAndPreventsDefault();
  await testEventsGroupLimitNonEnterDoesNotApply();
  await testEventsTypeChangePersistsAndResetsOffset();
  process.stdout.write('ok - ui events filter interactions\n');
}

main().catch((error) => {
  process.stderr.write(`${error && error.stack ? error.stack : String(error)}\n`);
  process.exit(1);
});
