const assert = require('node:assert/strict');
const { bootstrapApp } = require('./ui-test-harness');

const UI_STATE_STORAGE = 'turn-mcp-web-universal.uiState';

function readUiState(localStorage) {
  const raw = localStorage.getItem(UI_STATE_STORAGE);
  assert.equal(typeof raw, 'string');
  return JSON.parse(raw);
}

async function testHistoryNextAdvancesOffset() {
  const scenario = await bootstrapApp({
    requireApiKey: false,
    hasApiKey: false,
    historyOffset: 0,
    historyTotal: 100,
  });
  await scenario.dispatchEvent('historyNextBtn', 'click');
  const state = readUiState(scenario.localStorage);
  assert.equal(state.historyOffset, 20);
}
async function testHistoryPagerDisabledStatesAtStartAndBoundary() {
  const firstPageScenario = await bootstrapApp({
    requireApiKey: false,
    hasApiKey: false,
    historyOffset: 0,
    historyTotal: 100,
  });
  assert.equal(firstPageScenario.elementsById.historyPrevBtn.disabled, true);
  assert.equal(firstPageScenario.elementsById.historyNextBtn.disabled, false);

  const lastPageScenario = await bootstrapApp({
    requireApiKey: false,
    hasApiKey: false,
    historyOffset: 80,
    historyTotal: 100,
  });
  assert.equal(lastPageScenario.elementsById.historyPrevBtn.disabled, false);
  assert.equal(lastPageScenario.elementsById.historyNextBtn.disabled, true);
}

async function testHistoryNextStopsAtBoundary() {
  const scenario = await bootstrapApp({
    requireApiKey: false,
    hasApiKey: false,
    historyOffset: 80,
    historyTotal: 100,
  });
  const before = readUiState(scenario.localStorage);
  await scenario.dispatchEvent('historyNextBtn', 'click');
  const after = readUiState(scenario.localStorage);
  assert.equal(after.historyOffset, before.historyOffset);
}

async function testEventsPrevDecreasesOffset() {
  const scenario = await bootstrapApp({
    requireApiKey: false,
    hasApiKey: false,
    eventsOffset: 40,
    eventsTotal: 100,
  });
  await scenario.dispatchEvent('eventsPrevBtn', 'click');
  const state = readUiState(scenario.localStorage);
  assert.equal(state.eventsOffset, 20);
}

async function testEventsPrevClampsToZero() {
  const scenario = await bootstrapApp({
    requireApiKey: false,
    hasApiKey: false,
    eventsOffset: 0,
    eventsTotal: 100,
  });
  await scenario.dispatchEvent('eventsPrevBtn', 'click');
  const state = readUiState(scenario.localStorage);
  assert.equal(state.eventsOffset, 0);
}
async function testEventsPagerDisabledStatesAtStartAndBoundary() {
  const firstPageScenario = await bootstrapApp({
    requireApiKey: false,
    hasApiKey: false,
    eventsOffset: 0,
    eventsTotal: 100,
  });
  assert.equal(firstPageScenario.elementsById.eventsPrevBtn.disabled, true);
  assert.equal(firstPageScenario.elementsById.eventsNextBtn.disabled, false);

  const lastPageScenario = await bootstrapApp({
    requireApiKey: false,
    hasApiKey: false,
    eventsOffset: 80,
    eventsTotal: 100,
  });
  assert.equal(lastPageScenario.elementsById.eventsPrevBtn.disabled, false);
  assert.equal(lastPageScenario.elementsById.eventsNextBtn.disabled, true);
}

async function testEventsNextAdvancesAndThenStopsAtBoundary() {
  const scenario = await bootstrapApp({
    requireApiKey: false,
    hasApiKey: false,
    eventsOffset: 60,
    eventsTotal: 100,
  });
  await scenario.dispatchEvent('eventsNextBtn', 'click');
  let state = readUiState(scenario.localStorage);
  assert.equal(state.eventsOffset, 80);
  assert.equal(scenario.elementsById.eventsNextBtn.disabled, true);
  await scenario.dispatchEvent('eventsNextBtn', 'click');
  state = readUiState(scenario.localStorage);
  assert.equal(state.eventsOffset, 80);
}

async function main() {
  await testHistoryNextAdvancesOffset();
  await testHistoryPagerDisabledStatesAtStartAndBoundary();
  await testHistoryNextStopsAtBoundary();
  await testEventsPrevDecreasesOffset();
  await testEventsPrevClampsToZero();
  await testEventsPagerDisabledStatesAtStartAndBoundary();
  await testEventsNextAdvancesAndThenStopsAtBoundary();
  process.stdout.write('ok - ui pagination interactions\n');
}

main().catch((error) => {
  process.stderr.write(`${error && error.stack ? error.stack : String(error)}\n`);
  process.exit(1);
});
