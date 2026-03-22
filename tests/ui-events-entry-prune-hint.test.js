const assert = require('node:assert/strict');
const { bootstrapApp } = require('./ui-test-harness');
const UI_STATE_STORAGE = 'turn-mcp-web-universal.uiState';

async function testHintShownAfterPrune() {
  const { elementsById } = await bootstrapApp({
    requireApiKey: false,
    hasApiKey: false,
    entryCount: 605,
  });
  assert.match(elementsById.eventsEntryMemoryHint.textContent, /详情记忆达到上限（600）/);
  assert.match(elementsById.eventsEntryMemoryHint.textContent, /已自动清理最早 5 条记录/);
}

async function testHintClearedWhenEventsSectionHiddenByNoApiKey() {
  const { elementsById } = await bootstrapApp({
    requireApiKey: true,
    hasApiKey: false,
    entryCount: 605,
  });
  assert.equal(elementsById.eventsEntryMemoryHint.textContent, '');
}

async function testNoHintWhenNoPruneHappens() {
  const { elementsById } = await bootstrapApp({
    requireApiKey: false,
    hasApiKey: false,
    entryCount: 600,
  });
  assert.equal(elementsById.eventsEntryMemoryHint.textContent, '');
}

async function testHintClearedWhenEventsResetClicked() {
  const scenario = await bootstrapApp({
    requireApiKey: false,
    hasApiKey: false,
    entryCount: 605,
  });
  assert.match(scenario.elementsById.eventsEntryMemoryHint.textContent, /详情记忆达到上限（600）/);
  await scenario.dispatchEvent('eventsResetBtn', 'click');
  assert.equal(scenario.elementsById.eventsEntryMemoryHint.textContent, '');
  const stateRaw = scenario.localStorage.getItem(UI_STATE_STORAGE);
  assert.equal(typeof stateRaw, 'string');
  const parsedState = JSON.parse(stateRaw);
  assert.deepEqual(parsedState.eventsFilters.entryOpenByKey, {});
}

async function testHintClearsAfterTimeoutOnAutoRefreshInterval() {
  const scenario = await bootstrapApp({
    requireApiKey: false,
    hasApiKey: false,
    entryCount: 605,
  });
  assert.match(scenario.elementsById.eventsEntryMemoryHint.textContent, /详情记忆达到上限（600）/);
  scenario.advanceTime(10001);
  await scenario.runIntervals();
  assert.equal(scenario.elementsById.eventsEntryMemoryHint.textContent, '');
}

async function main() {
  await testHintShownAfterPrune();
  await testHintClearedWhenEventsSectionHiddenByNoApiKey();
  await testNoHintWhenNoPruneHappens();
  await testHintClearedWhenEventsResetClicked();
  await testHintClearsAfterTimeoutOnAutoRefreshInterval();
  process.stdout.write('ok - ui prune hint smoke\n');
}

main().catch((error) => {
  process.stderr.write(`${error && error.stack ? error.stack : String(error)}\n`);
  process.exit(1);
});
