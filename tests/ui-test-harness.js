const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const APP_JS_PATH = path.resolve(__dirname, '../public/app.js');
const APP_JS_SOURCE = fs.readFileSync(APP_JS_PATH, 'utf8');
const I18N_JS_PATH = path.resolve(__dirname, '../public/i18n.js');
const I18N_JS_SOURCE = fs.readFileSync(I18N_JS_PATH, 'utf8');
const UI_STATE_STORAGE = 'turn-mcp-web-universal.uiState';
const API_KEY_STORAGE = 'turn-mcp-web-universal.apiKey';

class HTMLElement {
  constructor(tagName = 'div', id = '') {
    this.tagName = String(tagName).toUpperCase();
    this.id = id;
    this.value = '';
    this.checked = false;
    this.textContent = '';
    this._innerHTML = '';
    this.children = [];
    this.attributes = {};
    this.listeners = {};
    this.disabled = false;
    this.open = false;
    this.classList = {
      _set: new Set(),
      add: (...tokens) => tokens.forEach((token) => this.classList._set.add(String(token))),
      remove: (...tokens) => tokens.forEach((token) => this.classList._set.delete(String(token))),
      contains: (token) => this.classList._set.has(String(token)),
    };
  }

  set innerHTML(value) {
    this._innerHTML = String(value);
    this.children = [];
  }

  get innerHTML() {
    return this._innerHTML;
  }

  addEventListener(type, handler) {
    if (!this.listeners[type]) {
      this.listeners[type] = [];
    }
    this.listeners[type].push(handler);
  }

  appendChild(child) {
    this.children.push(child);
    return child;
  }

  get options() {
    return this.children;
  }

  querySelector() {
    return null;
  }

  querySelectorAll() {
    return [];
  }

  closest() {
    return null;
  }

  setAttribute(name, value) {
    this.attributes[name] = String(value);
  }

  getAttribute(name) {
    return this.attributes[name] ?? null;
  }
}

class HTMLButtonElement extends HTMLElement {}
class HTMLDetailsElement extends HTMLElement {}
class HTMLOptionElement extends HTMLElement {}

const REQUIRED_ELEMENT_IDS = [
  'waitsContainer',
  'summaryText',
  'reinforcementText',
  'refreshBtn',
  'authCard',
  'authHint',
  'apiKeyInput',
  'saveApiKeyBtn',
  'clearApiKeyBtn',
  'historyContainer',
  'eventsCard',
  'eventsContainer',
  'historySessionFilter',
  'historyResolutionFilter',
  'historyKeywordFilter',
  'historyApplyBtn',
  'historyResetBtn',
  'historyFilterMeta',
  'historyPrevBtn',
  'historyNextBtn',
  'historyPageMeta',
  'eventsPrevBtn',
  'eventsNextBtn',
  'eventsPageMeta',
  'eventsTypeFilter',
  'eventsGroupToggle',
  'eventsGroupLimit',
  'eventsGroupExpandMode',
  'eventsEntryExpandMode',
  'eventsEntryOpenMaxItems',
  'eventsApplyBtn',
  'eventsResetBtn',
  'eventsFilterMeta',
  'eventsEntryMemoryHint',
  'mcpServerUrl',
  'mcpTutorialContent',
  'timelineBackBtn',
  'timelineSessionLabel',
  'timelineBackRow',
  'notifToggleBtn',
  'soundToggleBtn',
  'templateManagerContent',
];

function createLocalStorage(initial = {}) {
  const storage = new Map(Object.entries(initial));
  return {
    getItem(key) {
      return storage.has(key) ? storage.get(key) : null;
    },
    setItem(key, value) {
      storage.set(String(key), String(value));
    },
    removeItem(key) {
      storage.delete(String(key));
    },
  };
}

function createDocument() {
  const elementsById = {};
  for (const id of REQUIRED_ELEMENT_IDS) {
    elementsById[id] = id.endsWith('Btn') ? new HTMLButtonElement('button', id) : new HTMLElement('div', id);
  }
  return {
    elementsById,
    document: {
      getElementById(id) {
        return elementsById[id] || null;
      },
      createElement(tag) {
        const tagName = String(tag).toLowerCase();
        if (tagName === 'button') {
          return new HTMLButtonElement('button');
        }
        if (tagName === 'details') {
          return new HTMLDetailsElement('details');
        }
        if (tagName === 'option') {
          return new HTMLOptionElement('option');
        }
        return new HTMLElement(tagName);
      },
    },
  };
}

function createFetch({ requireApiKey = false, historyTotal = 0, eventsTotal = 0, authRole = 'operator' } = {}) {
  return async function fetch(url) {
    if (url === '/api/public-config') {
      return {
        ok: true,
        status: 200,
        json: async () => ({ requireApiKey, waitHistoryMaxItems: 500 }),
      };
    }
    if (url === '/api/waits') {
      return {
        ok: true,
        status: 200,
        json: async () => ({ count: 0, waits: [], reinforcementSuffix: '' }),
      };
    }
    if (String(url).startsWith('/api/history')) {
      const queryString = String(url).split('?')[1] || '';
      const params = new URLSearchParams(queryString);
      const rawOffset = Number(params.get('offset') || 0);
      const offset = Number.isInteger(rawOffset) && rawOffset >= 0 ? rawOffset : 0;
      return {
        ok: true,
        status: 200,
        json: async () => ({
          history: [],
          filters: {
            sessionId: params.get('sessionId') || '',
            resolution: params.get('resolution') || '',
            q: params.get('q') || '',
          },
          total: historyTotal,
          count: historyTotal,
          pagination: { offset },
        }),
      };
    }
    if (String(url).startsWith('/api/events')) {
      const queryString = String(url).split('?')[1] || '';
      const params = new URLSearchParams(queryString);
      const rawOffset = Number(params.get('offset') || 0);
      const offset = Number.isInteger(rawOffset) && rawOffset >= 0 ? rawOffset : 0;
      const type = (params.get('type') || '').trim();
      return {
        ok: true,
        status: 200,
        json: async () => ({
          enabled: true,
          events: [],
          filters: { type },
          availableTypes: [],
          typeCounts: {},
          total: eventsTotal,
          count: eventsTotal,
          pagination: { offset },
        }),
      };
    }
    if (url === '/api/auth-check') {
      return {
        ok: true,
        status: 200,
        json: async () => ({ role: authRole }),
      };
    }
    return {
      ok: false,
      status: 404,
      json: async () => ({ error: 'not-found' }),
    };
  };
}

function createPersistedUiState({
  entryCount = 0,
  entryOpenMaxItems = 600,
  historyOffset = 0,
  eventsOffset = 0,
  historyFilters = {},
  eventsFilters = {},
} = {}) {
  const entryOpenByKey = {};
  for (let i = 0; i < entryCount; i += 1) {
    entryOpenByKey[`entry_${i}`] = i % 2 === 0;
  }
  const providedEntryOpenByKey =
    eventsFilters &&
    typeof eventsFilters === 'object' &&
    !Array.isArray(eventsFilters) &&
    eventsFilters.entryOpenByKey &&
    typeof eventsFilters.entryOpenByKey === 'object' &&
    !Array.isArray(eventsFilters.entryOpenByKey)
      ? eventsFilters.entryOpenByKey
      : null;
  const mergedEntryOpenByKey = providedEntryOpenByKey || entryOpenByKey;
  return JSON.stringify({
    historyOffset,
    eventsOffset,
    historyFilters: { sessionId: '', resolution: '', q: '', ...historyFilters },
    eventsFilters: {
      type: '',
      groupByType: false,
      groupLimit: 3,
      groupExpandMode: 'first',
      entryExpandMode: 'open',
      entryOpenMaxItems,
      groupOpenByType: {},
      entryOpenByKey: mergedEntryOpenByKey,
      ...eventsFilters,
    },
  });
}

function createFakeDate(nowMs = Date.now()) {
  let currentNow = Number.isInteger(nowMs) ? nowMs : Date.now();
  class FakeDate extends Date {
    constructor(...args) {
      if (args.length === 0) {
        super(currentNow);
        return;
      }
      super(...args);
    }
    static now() {
      return currentNow;
    }
  }
  return {
    FakeDate,
    advanceTime(ms) {
      currentNow += ms;
      return currentNow;
    },
  };
}

async function flushTicks(turns = 5) {
  for (let i = 0; i < turns; i += 1) {
    await new Promise((resolve) => setTimeout(resolve, 0));
  }
}

async function bootstrapApp({
  requireApiKey = false,
  hasApiKey = false,
  authRole = 'operator',
  historyTotal = 0,
  eventsTotal = 0,
  entryCount = 0,
  entryOpenMaxItems = 600,
  historyOffset = 0,
  eventsOffset = 0,
  historyFilters = {},
  eventsFilters = {},
  nowMs = Date.now(),
} = {}) {
  const { document, elementsById } = createDocument();
  const localStorage = createLocalStorage({
    [UI_STATE_STORAGE]: createPersistedUiState({
      entryCount,
      entryOpenMaxItems,
      historyOffset,
      eventsOffset,
      historyFilters,
      eventsFilters,
    }),
    ...(hasApiKey ? { [API_KEY_STORAGE]: 'operator-key' } : {}),
  });
  const fakeDate = createFakeDate(nowMs);
  const fetch = createFetch({ requireApiKey, historyTotal, eventsTotal, authRole });
  const intervalCallbacks = [];
  const context = {
    console,
    document,
    localStorage,
    fetch,
    setInterval: (callback) => {
      intervalCallbacks.push(callback);
      return intervalCallbacks.length;
    },
    clearInterval: () => {},
    alert: () => {},
    URLSearchParams,
    Date: fakeDate.FakeDate,
    JSON,
    Math,
    Number,
    String,
    Boolean,
    Object,
    Array,
    Set,
    Map,
    encodeURIComponent,
    decodeURIComponent,
    HTMLElement,
    HTMLButtonElement,
    HTMLDetailsElement,
    EventSource: class FakeEventSource {
      constructor() { this.readyState = 0; }
      close() { this.readyState = 2; }
      addEventListener() {}
    },
    Notification: Object.assign(
      function FakeNotification() {},
      { permission: 'default', requestPermission: async () => 'granted' }
    ),
    AudioContext: class FakeAudioContext {
      createOscillator() { return { type: '', frequency: { value: 0 }, connect() {}, start() {}, stop() {} }; }
      createGain() { return { gain: { value: 0 }, connect() {} }; }
      get destination() { return null; }
      get currentTime() { return 0; }
    },
    window: {
      addEventListener() {},
      location: { origin: 'http://127.0.0.1:3737', href: 'http://127.0.0.1:3737/' },
    },
    setTimeout,
    clearTimeout,
  };
  context.window.AudioContext = context.AudioContext;
  context.window.webkitAudioContext = context.AudioContext;
  context.globalThis = context;
  vm.createContext(context);
  // Load i18n first, then set language to zh for test compatibility
  vm.runInContext(I18N_JS_SOURCE, context, { filename: I18N_JS_PATH });
  // i18n IIFE attaches to window; propagate to global scope for app.js
  if (!context.i18n && context.window && context.window.i18n) {
    context.i18n = context.window.i18n;
  }
  if (context.i18n) { context.i18n.setLang('zh'); }
  vm.runInContext(APP_JS_SOURCE, context, { filename: APP_JS_PATH });
  await flushTicks(6);
  function getElementByIdStrict(elementId) {
    const element = elementsById[elementId];
    if (!element) {
      throw new Error(`Unknown test element id: ${String(elementId)}`);
    }
    return element;
  }
  return {
    context,
    elementsById,
    localStorage,
    getElementByIdStrict,
    async dispatchEvent(elementId, type, eventOverrides = {}) {
      const element = getElementByIdStrict(elementId);
      const handlers = Array.isArray(element.listeners?.[type]) ? element.listeners[type] : [];
      const event = {
        type,
        target: element,
        currentTarget: element,
        defaultPrevented: false,
        preventDefault() {
          this.defaultPrevented = true;
        },
        stopPropagation() {},
        ...eventOverrides,
      };
      for (const handler of handlers) {
        const result = handler(event);
        if (result && typeof result.then === 'function') {
          await result;
        }
      }
      await flushTicks(3);
      return event;
    },
    async runIntervals() {
      for (const callback of intervalCallbacks) {
        const result = callback();
        if (result && typeof result.then === 'function') {
          await result;
        }
      }
      await flushTicks(2);
    },
    advanceTime: fakeDate.advanceTime,
    flushTicks,
  };
}

module.exports = {
  bootstrapApp,
};
