/* === Turn MCP Web Console — Chat UI === */

// ===== i18n =====
var t = (typeof i18n !== 'undefined' && i18n.t) ? i18n.t : function (k) { return k; };

function applyStaticI18n() {
  if (typeof document === 'undefined') return;
  document.querySelectorAll('[data-i18n]').forEach(function (el) {
    el.textContent = t(el.getAttribute('data-i18n'));
  });
  document.querySelectorAll('[data-i18n-ph]').forEach(function (el) {
    el.placeholder = t(el.getAttribute('data-i18n-ph'));
  });
}
applyStaticI18n();

// ===== DOM refs =====
var $sessionList = document.getElementById('sessionList');
var $welcomeView = document.getElementById('welcomeView');
var $chatView = document.getElementById('chatView');
var $chatMessages = document.getElementById('chatMessages');
var $chatInputArea = document.getElementById('chatInputArea');
var $chatSessionId = document.getElementById('chatSessionId');
var $chatSessionMeta = document.getElementById('chatSessionMeta');
var $pendingContext = document.getElementById('pendingContext');
var $quickReplyBar = document.getElementById('quickReplyBar');
var $replyInput = document.getElementById('replyInput');
var $sendBtn = document.getElementById('sendBtn');
var $extendBtn = document.getElementById('extendBtn');
var $cancelBtn = document.getElementById('cancelBtn');
var $waitCountdown = document.getElementById('waitCountdown');
var $settingsView = document.getElementById('settingsView');
var $authHint = document.getElementById('authHint');
var $apiKeyInput = document.getElementById('apiKeyInput');
var $reinforcementText = document.getElementById('reinforcementText');
var $mcpEndpointUrl = document.getElementById('mcpEndpointUrl');
var $setupGuideContent = document.getElementById('setupGuideContent');
var $sessionFilter = document.getElementById('sessionFilter');
var $webhookUrlInput = document.getElementById('webhookUrlInput');

// ===== Constants =====
var API_KEY_STORAGE = 'turn-mcp-web.apiKey';
var NOTIF_STORAGE = 'turn-mcp-web.notif';
var TEMPLATES_STORAGE = 'turn-mcp-web.templates';
var SESSION_NAMES_KEY = 'turn-mcp-web.sessionNames';
var REFRESH_INTERVAL = 15000;
var REFRESH_INTERVAL_FAST = 1500;
var FALLBACK_POLL_INTERVAL = 5000; // poll interval when SSE disconnected
var SESSION_LIST_MAX = 100; // max sessions shown in sidebar
var SSE_BACKOFF_BASE = 1500;    // first reconnect delay (ms)
var SSE_BACKOFF_MAX = 30000;    // max reconnect delay (ms)
var DEFAULT_TEMPLATES = null; // initialized after i18n

function getDefaultTemplates() {
  return [t('tpl.continue'), t('tpl.proceed'), t('tpl.pause')];
}

// ===== State =====
var requireApiKey = false;
var apiKey = localStorage.getItem(API_KEY_STORAGE) || '';
var currentRole = 'none';
var reinforcementSuffix = '';
var serverTimeoutEnabled = true;
var webhookUrl = '';
var webhookEvents = '';

// Session state
var sessionMap = new Map(); // Map<sessionId, {sessionId, status, lastActivity, pendingWaits?, pendingWait?, interactionCount}>
var selectedSessionId = null;
var sessionTimeline = []; // timeline items for selected session
var sessionPendingWaits = []; // all pending waits for selected session (may be >1)
var sessionPendingWait = null; // first pending wait (compat alias)

// Session names (localStorage)
var sessionNames = {};
try { sessionNames = JSON.parse(localStorage.getItem(SESSION_NAMES_KEY) || '{}'); } catch (e) {}
function getSessionName(id) { return sessionNames[id] || ''; }
function setSessionName(id, name) {
  if (name && name.trim()) sessionNames[id] = name.trim();
  else delete sessionNames[id];
  try { localStorage.setItem(SESSION_NAMES_KEY, JSON.stringify(sessionNames)); } catch (e) {}
}

function sessionsArray() {
  return Array.from(sessionMap.values()).sort(function (a, b) {
    if (a.status === 'pending' && b.status !== 'pending') return -1;
    if (a.status !== 'pending' && b.status === 'pending') return 1;
    return b.lastActivity - a.lastActivity;
  });
}

// SSE
var sseConnected = false;
var sseEverConnected = false; // tracks reconnects to trigger resync
var sseReconnectTimer = null;
var sseReconnectDelay = SSE_BACKOFF_BASE;

// Timeline cache
var timelineCache = new Map(); // Map<sessionId, WaitHistoryItem[]>

// Notification
var notifSettings = { desktop: true, sound: true };
try {
  var saved = JSON.parse(localStorage.getItem(NOTIF_STORAGE) || 'null');
  if (saved && typeof saved === 'object') {
    notifSettings.desktop = saved.desktop !== false;
    notifSettings.sound = saved.sound !== false;
  }
} catch (e) {}

// Templates
var replyTemplates = null;
try {
  var savedTpl = JSON.parse(localStorage.getItem(TEMPLATES_STORAGE) || 'null');
  if (Array.isArray(savedTpl) && savedTpl.length > 0) {
    replyTemplates = savedTpl.filter(function (s) { return typeof s === 'string' && s.trim(); });
  }
} catch (e) {}

function getTemplates() {
  return replyTemplates || getDefaultTemplates();
}

function saveTemplates() {
  try { localStorage.setItem(TEMPLATES_STORAGE, JSON.stringify(replyTemplates || getDefaultTemplates())); } catch (e) {}
}

// ===== Utilities =====
function esc(text) {
  return String(text).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

function formatTime(ms) {
  return new Date(ms).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
}

function formatDateTime(ms) {
  return new Date(ms).toLocaleString();
}

function shortId(id) {
  if (!id) return '';
  return id.length > 12 ? id.slice(0, 8) + '…' : id;
}

// ===== API =====
async function apiRequest(url, method, body) {
  var headers = {};
  if (body !== undefined) headers['content-type'] = 'application/json';
  if (apiKey) headers['x-turn-mcp-api-key'] = apiKey;
  var res = await fetch(url, {
    method: method || 'GET',
    headers: Object.keys(headers).length > 0 ? headers : undefined,
    body: body ? JSON.stringify(body) : undefined,
  });
  var data = await res.json().catch(function () { return {}; });
  if (!res.ok) throw new Error(data.error || 'HTTP ' + res.status);
  return data;
}

// ===== SVG Icon Helpers =====
function svgIcon(paths, size) {
  size = size || 18;
  return '<svg class="ui-icon" width="' + size + '" height="' + size + '" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' + paths + '</svg>';
}

var ICONS = {
  bellOn: svgIcon('<path d="M6 8a6 6 0 0 1 12 0c0 7 3 9 3 9H3s3-2 3-9"/><path d="M10.3 21a1.94 1.94 0 0 0 3.4 0"/>'),
  bellOff: svgIcon('<path d="M6 8a6 6 0 0 1 12 0c0 7 3 9 3 9H3s3-2 3-9"/><path d="M10.3 21a1.94 1.94 0 0 0 3.4 0"/><line x1="1" y1="1" x2="23" y2="23"/>'),
  soundOn: svgIcon('<polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5"/><path d="M15.54 8.46a5 5 0 0 1 0 7.07"/><path d="M19.07 4.93a10 10 0 0 1 0 14.14"/>'),
  soundOff: svgIcon('<polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5"/><line x1="23" y1="9" x2="17" y2="15"/><line x1="17" y1="9" x2="23" y2="15"/>'),
  globe: svgIcon('<circle cx="12" cy="12" r="10"/><line x1="2" y1="12" x2="22" y2="12"/><path d="M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z"/>'),
  clock: svgIcon('<circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/>', 14),
  xCircle: svgIcon('<circle cx="12" cy="12" r="10"/><path d="m15 9-6 6"/><path d="m9 9 6 6"/>', 14),
  loader: svgIcon('<path d="M12 2v4"/><path d="M12 18v4"/><path d="m4.93 4.93 2.83 2.83"/><path d="m16.24 16.24 2.83 2.83"/><path d="M2 12h4"/><path d="M18 12h4"/><path d="m4.93 19.07 2.83-2.83"/><path d="m16.24 7.76 2.83-2.83"/>', 16),
  send: svgIcon('<path d="m22 2-7 20-4-9-9-4z"/><path d="m22 2-11 11"/>', 16),
  copy: svgIcon('<rect x="9" y="9" width="13" height="13" rx="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/>', 13),
};

// ===== Error Toast =====
function showErrorToast(message) {
  if (!$toastContainer) return;
  var timeStr = new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  var toast = document.createElement('div');
  toast.className = 'toast toast-error';
  toast.innerHTML =
    '<div class="toast-icon">' +
      svgIcon('<circle cx="12" cy="12" r="10"/><path d="m15 9-6 6"/><path d="m9 9 6 6"/>') +
    '</div>' +
    '<div class="toast-body">' +
      '<div class="toast-title">' + esc(t('error.title')) + '</div>' +
      (message ? '<div class="toast-subtitle">' + esc(message) + '</div>' : '') +
    '</div>' +
    '<span class="toast-time">' + esc(timeStr) + '</span>';
  $toastContainer.appendChild(toast);
  toast._dismissTimer = setTimeout(function () { dismissToast(toast); }, 5000);
}

// ===== Confirm Modal =====
function showConfirm(message, onConfirm) {
  var modal = document.getElementById('confirmModal');
  var msgEl = document.getElementById('confirmMsg');
  var okBtn = document.getElementById('confirmOk');
  var cancelEl = document.getElementById('confirmCancel');
  if (!modal || !msgEl || !okBtn || !cancelEl) {
    // Fallback if modal not present in DOM
    if (window.confirm(message)) onConfirm();
    return;
  }
  msgEl.textContent = message;
  modal.classList.remove('hidden');
  function cleanup() {
    modal.classList.add('hidden');
    okBtn.removeEventListener('click', handleOk);
    cancelEl.removeEventListener('click', handleCancel);
    modal.removeEventListener('click', handleBackdrop);
  }
  function handleOk() { cleanup(); onConfirm(); }
  function handleCancel() { cleanup(); }
  function handleBackdrop(e) { if (e.target === modal) cleanup(); }
  okBtn.addEventListener('click', handleOk);
  cancelEl.addEventListener('click', handleCancel);
  modal.addEventListener('click', handleBackdrop);
}

// ===== Session Naming =====
function renderSessionNameInHeader(sessionId) {
  var nameEl = document.getElementById('chatSessionName');
  var idEl = document.getElementById('chatSessionId');
  if (!nameEl || !idEl) return;
  var name = getSessionName(sessionId);
  if (name) {
    nameEl.textContent = name;
    nameEl.classList.remove('hidden');
    idEl.style.opacity = '0.4';
    idEl.style.fontSize = '11px';
  } else {
    nameEl.classList.add('hidden');
    idEl.style.opacity = '';
    idEl.style.fontSize = '';
  }
}

function startEditSessionName(sessionId) {
  var nameEl = document.getElementById('chatSessionName');
  var idEl = document.getElementById('chatSessionId');
  var editBtn = document.getElementById('editNameBtn');
  if (!nameEl) return;
  var current = getSessionName(sessionId);
  var input = document.createElement('input');
  input.className = 'session-name-input text-input';
  input.value = current;
  input.placeholder = t('session.namePlaceholder');
  input.maxLength = 40;
  var headerInfo = document.querySelector('.chat-header-info');
  if (!headerInfo) return;
  if (editBtn) editBtn.classList.add('hidden');
  headerInfo.appendChild(input);
  input.focus();
  input.select();
  function commit() {
    setSessionName(sessionId, input.value);
    if (input.parentNode) input.parentNode.removeChild(input);
    if (editBtn) editBtn.classList.remove('hidden');
    renderSessionNameInHeader(sessionId);
    renderSessionList();
  }
  input.addEventListener('blur', commit);
  input.addEventListener('keydown', function (e) {
    if (e.key === 'Enter') { e.preventDefault(); input.blur(); }
    if (e.key === 'Escape') { input.value = current; input.blur(); }
  });
}

// ===== Copy Code =====
function copyCode(btn) {
  var wrap = btn.closest('.code-wrap');
  if (!wrap) return;
  var codeEl = wrap.querySelector('code') || wrap.querySelector('pre');
  var text = codeEl ? (codeEl.textContent || '') : '';
  navigator.clipboard.writeText(text).then(function () {
    btn.setAttribute('data-copied', '1');
    btn.title = t('btn.copied');
    setTimeout(function () { btn.removeAttribute('data-copied'); btn.title = t('btn.copy'); }, 2000);
  }).catch(function () {});
}

function codeWrap(preContent) {
  return '<div class="code-wrap"><button class="copy-btn" onclick="copyCode(this)" title="' + t('btn.copy') + '">' + ICONS.copy + '</button>' + preContent + '</div>';
}

// ===== Syntax Highlighter (micro) =====
function syntaxHighlight(code, lang) {
  var l = (lang || '').toLowerCase();
  var LANGS = ['json','python','javascript','js','typescript','ts','bash','shell','sh'];
  if (LANGS.indexOf(l) < 0) return esc(code);
  var parts = [];
  var s = code;
  function extract(re, cls) {
    s = s.replace(re, function(m) {
      var idx = parts.length;
      parts.push('<span class="tok-' + cls + '">' + esc(m) + '</span>');
      return '\x01' + idx + '\x02';
    });
  }
  if (l === 'json') {
    extract(/"(?:[^"\\]|\\.)*"(?=\s*:)/g, 'key');
    extract(/"(?:[^"\\]|\\.)*"/g, 'str');
    extract(/\b-?\d+\.?\d*(?:[eE][+-]?\d+)?\b/g, 'num');
    extract(/\b(?:true|false|null)\b/g, 'kw');
  } else if (l === 'python') {
    extract(/#[^\n]*/g, 'cmt');
    extract(/"""[\s\S]*?"""|'''[\s\S]*?'''|"(?:[^"\\]|\\.)*"|'(?:[^'\\]|\\.)*'/g, 'str');
    extract(/\b(?:def|class|import|from|return|if|elif|else|for|while|with|as|in|not|and|or|is|None|True|False|pass|break|continue|raise|try|except|finally|lambda|yield|global|nonlocal|del|assert|async|await)\b/g, 'kw');
    extract(/\b\d+\.?\d*(?:[eE][+-]?\d+)?\b/g, 'num');
  } else if (l === 'javascript' || l === 'js' || l === 'typescript' || l === 'ts') {
    extract(/\/\/[^\n]*/g, 'cmt');
    extract(/`(?:[^`\\]|\\.)*`|"(?:[^"\\]|\\.)*"|'(?:[^'\\]|\\.)*'/g, 'str');
    extract(/\b(?:const|let|var|function|return|if|else|for|while|do|switch|case|break|continue|new|class|extends|import|export|default|typeof|instanceof|in|of|void|delete|throw|try|catch|finally|async|await|true|false|null|undefined|this|super|yield|from|as|static)\b/g, 'kw');
    extract(/\b\d+\.?\d*(?:[eE][+-]?\d+)?\b/g, 'num');
  } else {
    extract(/#[^\n]*/g, 'cmt');
    extract(/"(?:[^"\\]|\\.)*"|'[^']*'/g, 'str');
    extract(/\b(?:if|then|else|elif|fi|for|do|done|while|case|esac|in|function|return|exit|echo|export|source|local|readonly)\b/g, 'kw');
  }
  return s.replace(/\x01(\d+)\x02|[^\x01\x02]+|[\x01\x02]/g, function(m, idx) {
    if (idx !== undefined) return parts[parseInt(idx, 10)];
    return esc(m);
  });
}

// ===== Micro Markdown Renderer =====
function microMd(text) {
  if (!text) return '';
  text = String(text);
  // Extract fenced code blocks before escaping
  var blocks = [];
  text = text.replace(/```(\w*)\r?\n?([\s\S]*?)```/g, function (_, lang, code) {
    var i = blocks.length;
    blocks.push({ lang: lang || '', code: code.trimEnd() });
    return '\x02' + i + '\x03';
  });
  // HTML-escape remaining text
  text = text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  // Inline markup
  text = text.replace(/`([^`\n]{1,300})`/g, '<code>$1</code>');
  text = text.replace(/\*\*([^*\n]{1,300})\*\*/g, '<strong>$1</strong>');
  text = text.replace(/\*([^*\n]{1,300})\*/g, '<em>$1</em>');
  // Process line by line
  var lines = text.split('\n');
  var out = '';
  var inUl = false, inOl = false;
  var tableRows = [];
  function cl() {
    if (inUl) { out += '</ul>'; inUl = false; }
    if (inOl) { out += '</ol>'; inOl = false; }
  }
  function flushTable() {
    if (tableRows.length === 0) return;
    var hasSep = tableRows.some(function(r) {
      return r.split('|').slice(1,-1).every(function(c) { return /^[-: ]+$/.test(c.trim()); });
    });
    out += '<table class="md-table"><tbody>';
    var isFirst = true;
    tableRows.forEach(function(row) {
      var cells = row.split('|').slice(1,-1).map(function(c) { return c.trim(); });
      if (cells.every(function(c) { return /^[-: ]+$/.test(c); })) { isFirst = false; return; }
      var tag = (hasSep && isFirst) ? 'th' : 'td';
      out += '<tr>' + cells.map(function(c) { return '<'+tag+'>'+c+'</'+tag+'>'; }).join('') + '</tr>';
      if (isFirst) isFirst = false;
    });
    out += '</tbody></table>';
    tableRows = [];
  }
  lines.forEach(function (line) {
    var cm = line.match(/^\x02(\d+)\x03$/);
    if (cm) {
      cl();
      if (tableRows.length > 0) flushTable();
      var b = blocks[+cm[1]];
      var sc = syntaxHighlight(b.code, b.lang);
      out += codeWrap('<pre><code>' + sc + '</code></pre>');
      return;
    }
    var tblRow = /^\|.+\|$/.test(line);
    if (!tblRow && tableRows.length > 0) flushTable();
    if (tblRow) { cl(); tableRows.push(line); return; }
    var hm = line.match(/^(#{1,3})\s+(.*)/);
    if (hm) { cl(); out += '<h' + hm[1].length + ' class="md-h">' + hm[2] + '</h' + hm[1].length + '>'; return; }
    if (/^(-{3,}|\*{3,})$/.test(line.trim())) { cl(); out += '<hr class="md-hr">'; return; }
    var ulm = line.match(/^[-*+]\s+(.*)/);
    if (ulm) {
      if (inOl) { out += '</ol>'; inOl = false; }
      if (!inUl) { out += '<ul>'; inUl = true; }
      out += '<li>' + ulm[1] + '</li>'; return;
    }
    var olm = line.match(/^\d+[.)]\s+(.*)/);
    if (olm) {
      if (inUl) { out += '</ul>'; inUl = false; }
      if (!inOl) { out += '<ol>'; inOl = true; }
      out += '<li>' + olm[1] + '</li>'; return;
    }
    cl();
    if (!line.trim()) { out += '<div class="md-gap"></div>'; return; }
    out += '<p>' + line + '</p>';
  });
  cl();
  flushTable();
  return out;
}

// ===== Relative Time =====
function relativeTime(ms) {
  var diff = Date.now() - ms;
  if (diff < 90000) return t('time.justNow');
  if (diff < 3600000) return t('time.minsAgo', { n: Math.floor(diff / 60000) });
  if (diff < 86400000) return t('time.hrsAgo', { n: Math.floor(diff / 3600000) });
  return t('time.daysAgo', { n: Math.floor(diff / 86400000) });
}

// ===== Context Expand Toggle =====
function toggleExpand(btn) {
  var ctx = btn.previousElementSibling;
  // Skip over other buttons (e.g. load-full-context button)
  while (ctx && ctx.tagName === 'BUTTON') ctx = ctx.previousElementSibling;
  if (!ctx) return;
  var expanded = ctx.classList.toggle('expanded');
  btn.textContent = expanded ? t('chat.showLess') : t('chat.showMore');
}

function buildContextHtml(text, waitId) {
  if (!text) return '';
  var md = microMd(text);
  var isLong = text.length > 500;
  var isTruncated = Boolean(waitId) && text.length >= 5000;
  if (isLong || isTruncated) {
    var ctxClass = 'msg-context md-content' + (isLong ? ' collapsible' : '');
    var html = '<div class="' + ctxClass + '">' + md + '</div>';
    if (isTruncated) {
      html += '<button class="expand-btn" onclick="loadFullContext(this,\'' + esc(waitId) + '\')">' + t('chat.loadFullContext') + '</button>';
    }
    if (isLong) {
      html += '<button class="expand-btn" onclick="toggleExpand(this)">' + t('chat.showMore') + '</button>';
    }
    return html;
  }
  return '<div class="msg-context md-content">' + md + '</div>';
}

async function loadFullContext(btn, waitId) {
  try {
    btn.disabled = true;
    btn.textContent = t('chat.loading');
    var data = await apiRequest('/api/waits/' + encodeURIComponent(waitId));
    if (data.wait && data.wait.context) {
      var ctx = btn.previousElementSibling;
      while (ctx && ctx.tagName === 'BUTTON') ctx = ctx.previousElementSibling;
      if (ctx) {
        ctx.innerHTML = microMd(data.wait.context);
        ctx.classList.remove('collapsible');
        ctx.classList.remove('expanded');
      }
      // Remove expand button following this one (if any)
      var next = btn.nextElementSibling;
      if (next && next.classList.contains('expand-btn')) next.parentNode.removeChild(next);
      btn.parentNode.removeChild(btn);
    }
  } catch (e) {
    btn.disabled = false;
    btn.textContent = t('chat.loadFullContext');
  }
}

// ===== Notification & Sound =====
if (typeof Notification !== 'undefined' && Notification.permission === 'default') {
  Notification.requestPermission().catch(function () {});
}

function playChime() {
  try {
    var ctx = new (window.AudioContext || window.webkitAudioContext)();
    var now = ctx.currentTime;

    // Two-tone chime: C6 → E6 (Apple-like)
    var notes = [1047, 1319];
    var durations = [0.12, 0.18];
    var delays = [0, 0.1];

    notes.forEach(function (freq, i) {
      var osc = ctx.createOscillator();
      var gain = ctx.createGain();
      osc.type = 'sine';
      osc.frequency.value = freq;
      gain.gain.setValueAtTime(0, now + delays[i]);
      gain.gain.linearRampToValueAtTime(0.18, now + delays[i] + 0.015);
      gain.gain.exponentialRampToValueAtTime(0.001, now + delays[i] + durations[i]);
      osc.connect(gain);
      gain.connect(ctx.destination);
      osc.start(now + delays[i]);
      osc.stop(now + delays[i] + durations[i] + 0.05);
    });
  } catch (e) {}
}

// ===== In-App Toast Notifications =====
var $toastContainer = document.getElementById('toastContainer');
var toastDismissTimer = null;

function showToast(title, subtitle, sessionId) {
  if (!$toastContainer) return;
  var now = new Date();
  var timeStr = now.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });

  var toast = document.createElement('div');
  toast.className = 'toast';
  toast.innerHTML =
    '<div class="toast-icon">' +
      svgIcon('<path d="M6 8a6 6 0 0 1 12 0c0 7 3 9 3 9H3s3-2 3-9"/><path d="M10.3 21a1.94 1.94 0 0 0 3.4 0"/>') +
    '</div>' +
    '<div class="toast-body">' +
      '<div class="toast-title">' + esc(title) + '</div>' +
      (subtitle ? '<div class="toast-subtitle">' + esc(subtitle) + '</div>' : '') +
    '</div>' +
    '<span class="toast-time">' + esc(timeStr) + '</span>';

  if (sessionId) {
    toast.addEventListener('click', function () {
      dismissToast(toast);
      selectSession(sessionId);
    });
  }

  $toastContainer.appendChild(toast);

  // Auto-dismiss after 4.5s
  var timer = setTimeout(function () { dismissToast(toast); }, 4500);
  toast._dismissTimer = timer;
}

function dismissToast(el) {
  if (!el || !el.parentNode) return;
  if (el._dismissTimer) clearTimeout(el._dismissTimer);
  el.classList.add('toast-exiting');
  setTimeout(function () {
    if (el.parentNode) el.parentNode.removeChild(el);
  }, 320);
}

var titleFlashTimer = null;
var ORIGINAL_TITLE = document.title || 'Turn MCP Web Console';
var pendingNewWaits = 0;

function startTitleFlash() {
  if (titleFlashTimer) return;
  var toggle = false;
  titleFlashTimer = setInterval(function () {
    toggle = !toggle;
    document.title = toggle ? '(' + pendingNewWaits + ') ' + t('notif.newTask') : ORIGINAL_TITLE;
  }, 1000);
}

function stopTitleFlash() {
  if (titleFlashTimer) { clearInterval(titleFlashTimer); titleFlashTimer = null; }
  document.title = ORIGINAL_TITLE;
  pendingNewWaits = 0;
}

document.addEventListener('visibilitychange', function () { if (!document.hidden) stopTitleFlash(); });
window.addEventListener('focus', function () { stopTitleFlash(); });

function onNewWaitCreated(data) {
  // In-app toast (always show)
  var sid = data?.sessionId || '';
  var notifBody = sid ? t('notif.session') + shortId(sid) : '';
  showToast(
    t('notif.title'),
    notifBody,
    sid
  );

  // Desktop notification
  if (notifSettings.desktop && typeof Notification !== 'undefined' && Notification.permission === 'granted') {
    try { new Notification(t('notif.title'), { body: notifBody, tag: 'turn-mcp-wait' }); } catch (e) {}
  }
  // Service Worker notification
  if (typeof navigator !== 'undefined' && navigator.serviceWorker && navigator.serviceWorker.controller) {
    navigator.serviceWorker.controller.postMessage({
      type: 'WAIT_CREATED',
      data: data,
      notifTitle: t('notif.title'),
      notifBody: notifBody,
    });
  }
  // Sound
  if (notifSettings.sound) playChime();
  // Title flash when hidden
  if (document.hidden) { pendingNewWaits++; startTitleFlash(); }
}

function updateNotifButtons() {
  var nb = document.getElementById('notifToggleBtn');
  var sb = document.getElementById('soundToggleBtn');
  if (nb) nb.innerHTML = notifSettings.desktop ? ICONS.bellOn : ICONS.bellOff;
  if (sb) sb.innerHTML = notifSettings.sound ? ICONS.soundOn : ICONS.soundOff;
}

function updateLangButton() {
  var lb = document.getElementById('langToggleBtn');
  if (!lb) return;
  var lang = (typeof i18n !== 'undefined') ? i18n.getLang() : 'en';
  var label = lang === 'zh' ? 'EN' : '中';
  lb.innerHTML = ICONS.globe + ' <span>' + label + '</span>';
}

updateNotifButtons();
updateLangButton();

// ===== Connection status =====
function updateConnStatus(state) {
  var el = document.getElementById('connStatus');
  if (!el) return;
  el.className = 'conn-status ' + state;
  var labels = { connecting: t('conn.connecting'), live: t('conn.live'), polling: t('conn.polling'), disconnected: t('conn.disconnected') };
  el.textContent = labels[state] || labels.connecting;
}

// ===== Auth =====
async function loadPublicConfig() {
  var data = await fetch('/api/public-config').then(function (r) { return r.json(); }).catch(function () { return {}; });
  requireApiKey = Boolean(data.requireApiKey);

  var authSection = document.getElementById('authSection');
  if (authSection) {
    if (!requireApiKey) authSection.classList.add('hidden');
    else authSection.classList.remove('hidden');
  }

  if (!requireApiKey) {
    currentRole = 'operator';
    if ($authHint) $authHint.textContent = '';
  } else {
    if ($authHint) $authHint.textContent = apiKey ? t('auth.saved') : t('auth.required');
  }

  serverTimeoutEnabled = data.timeoutEnabled !== false;
  var $timeoutToggle = document.getElementById('timeoutToggle');
  if ($timeoutToggle) $timeoutToggle.checked = serverTimeoutEnabled;
  updateTimeoutHint();

  var mcpUrl = window.location.origin + (data.mcpPath || '/mcp');
  if ($mcpEndpointUrl) $mcpEndpointUrl.textContent = mcpUrl;
  renderSetupGuide(mcpUrl, requireApiKey);
}

async function refreshAuthRole() {
  if (!requireApiKey) { currentRole = 'operator'; return; }
  if (!apiKey) { currentRole = 'none'; return; }
  try {
    var info = await apiRequest('/api/auth-check');
    currentRole = String(info.role || 'none');
    if ($authHint) $authHint.textContent = t('auth.role', { role: currentRole });
  } catch (e) {
    currentRole = 'none';
    if ($authHint) $authHint.textContent = t('auth.fail', { error: e.message });
  }
}

// ===== Session Management =====
async function loadSessions() {
  if (requireApiKey && !apiKey) {
    sessionMap = new Map();
    return;
  }
  await refreshAuthRole();

  var data = await apiRequest('/api/sessions');
  reinforcementSuffix = data.reinforcementSuffix || '';
  if ($reinforcementText) $reinforcementText.textContent = reinforcementSuffix;
  webhookUrl = data.webhookUrl || '';
  webhookEvents = data.webhookEvents || '';
  if ($webhookUrlInput && document.activeElement !== $webhookUrlInput) $webhookUrlInput.value = webhookUrl;

  var newMap = new Map();
  (data.sessions || []).forEach(function (s) {
    newMap.set(s.sessionId, {
      sessionId: s.sessionId,
      status: s.status,
      lastActivity: s.lastActivity,
      pendingWaits: s.pendingWaits || (s.pendingWait ? [s.pendingWait] : []),
      pendingWait: s.pendingWait || null, // compat
      interactionCount: s.interactionCount,
    });
  });
  sessionMap = newMap;
}

async function loadSessionChat(sessionId) {
  sessionTimeline = [];
  sessionPendingWaits = [];
  sessionPendingWait = null;

  var session = sessionMap.get(sessionId);
  if (session && session.pendingWaits && session.pendingWaits.length > 0) {
    sessionPendingWaits = session.pendingWaits.slice(); // oldest-first (API already sorts by createdAt)
    sessionPendingWait = sessionPendingWaits[0];
  }

  // Use cached timeline if available (cache invalidated on wait_resolved)
  if (timelineCache.has(sessionId)) {
    sessionTimeline = timelineCache.get(sessionId);
    return;
  }

  // Fetch and cache timeline
  try {
    var data = await apiRequest('/api/history/timeline?sessionId=' + encodeURIComponent(sessionId));
    sessionTimeline = data.timeline || [];
    timelineCache.set(sessionId, sessionTimeline);
  } catch (e) {
    sessionTimeline = [];
  }
}

// ===== Rendering: Session List =====
function renderSessionList() {
  var allSessions = sessionsArray();

  // Show/hide cancel-all button based on pending sessions
  var hasPending = allSessions.some(function (s) { return s.status === 'pending'; });
  var $cancelAll = document.getElementById('cancelAllBtn');
  if ($cancelAll) {
    if (hasPending) $cancelAll.classList.remove('hidden');
    else $cancelAll.classList.add('hidden');
  }

  // Filter by search input
  var filterVal = ($sessionFilter ? $sessionFilter.value.trim().toLowerCase() : '');
  var arr = filterVal
    ? allSessions.filter(function (s) { return s.sessionId.toLowerCase().includes(filterVal); })
    : allSessions;

  if (arr.length === 0) {
    $sessionList.innerHTML = '<div class="session-list-empty">' +
      esc(filterVal ? t('sessions.noMatch') : t('sessions.empty')) + '</div>';
    return;
  }

  var total = arr.length;
  if (arr.length > SESSION_LIST_MAX) arr = arr.slice(0, SESSION_LIST_MAX);

  $sessionList.innerHTML = arr.map(function (s) {
    var isActive = s.sessionId === selectedSessionId;
  var dotClass = s.status === 'pending' ? 'pending' : s.status === 'timeout' ? 'timeout' : s.status === 'canceled' ? 'canceled' : 'completed';
    var firstPending = s.pendingWaits && s.pendingWaits[0];
    var pendingCount = (s.pendingWaits || []).length;
    var statusText = s.status === 'pending'
      ? (pendingCount > 1 ? pendingCount + ' ' + t('sessions.waitingMulti') : t('sessions.waiting'))
      : s.interactionCount + ' ' + t('sessions.interactions');
    var customName = getSessionName(s.sessionId);
    var displayId = customName ? esc(customName) : esc(shortId(s.sessionId));
    var agentBadge = (firstPending && firstPending.agentName) ? ' <span class="agent-name-badge">' + esc(firstPending.agentName) + '</span>' : '';
    var multiPendingBadge = pendingCount > 1 ? ' <span class="multi-pending-badge">' + pendingCount + '</span>' : '';
    return '<div class="session-item' + (isActive ? ' active' : '') + '" data-session-id="' + esc(s.sessionId) + '">' +
      '<div class="session-item-header">' +
        '<span class="session-dot ' + dotClass + '"></span>' +
        '<span class="session-id">' + displayId + '</span>' +
        agentBadge + multiPendingBadge +
      '</div>' +
      '<div class="session-meta">' + esc(statusText) + ' · ' + esc(relativeTime(s.lastActivity)) + '</div>' +
    '</div>';
  }).join('');

  if (total > SESSION_LIST_MAX) {
    $sessionList.innerHTML += '<div class="session-list-empty" style="font-size:11px">' + esc(t('sessions.more', { shown: SESSION_LIST_MAX, total: total })) + '</div>';
  }
}

// ===== Rendering: Chat Messages =====
function renderChatMessages() {
  var html = '';

  // Render completed timeline items
  sessionTimeline.forEach(function (item) {
    // Agent message (context + question)
    html += '<div class="msg msg-agent">' +
      '<div class="msg-label"><span class="badge badge-agent">' + t('chat.agent') + '</span>' +
      (item.agentName ? ' <span class="agent-name-badge">' + esc(item.agentName) + '</span>' : '') +
      ' ' + esc(formatTime(item.createdAt)) + '</div>' +
      buildContextHtml(item.context || '') +
      (item.question ? '<div class="msg-question md-content">' + microMd(item.question) + '</div>' : '') +
    '</div>';

    // User reply or resolution
    if (item.resolution === 'message' && item.userMessage) {
      html += '<div class="msg msg-user">' +
        '<div class="msg-label"><span class="badge badge-you">' + t('chat.you') + '</span> ' + esc(formatTime(item.resolvedAt)) + '</div>' +
        esc(item.userMessage) +
      '</div>';
    } else if (item.resolution === 'timeout') {
      html += '<div class="msg msg-system">' + ICONS.clock + ' ' + t('chat.timeout') + '</div>';
    } else if (item.resolution === 'canceled') {
      html += '<div class="msg msg-system">' + ICONS.xCircle + ' ' + t('chat.canceled') + '</div>';
    }
  });

  // Pending wait(s) — may be multiple when parallel agents call turn.wait
  sessionPendingWaits.forEach(function (pw, idx) {
    html += '<div class="msg msg-agent" data-wait-id="' + esc(pw.id) + '">' +
      '<div class="msg-label"><span class="badge badge-agent">' + t('chat.agent') + '</span>' +
      (pw.agentName ? ' <span class="agent-name-badge">' + esc(pw.agentName) + '</span>' : '') +
      ' ' + esc(formatTime(pw.createdAt)) + '</div>' +
      buildContextHtml(pw.context || '', pw.id) +
      (pw.question ? '<div class="msg-question md-content">' + microMd(pw.question) + '</div>' : '') +
    '</div>';
    if (idx === 0) {
      html += '<div class="msg-pending">' + ICONS.loader + ' ' + t('chat.waitingReply') + '</div>';
    }
  });

  if (!html) {
    html = '<div class="msg msg-system">' + t('chat.noMessages') + '</div>';
  }

  $chatMessages.innerHTML = html;

  // Auto-scroll to bottom
  $chatMessages.scrollTop = $chatMessages.scrollHeight;
}

// ===== Rendering: Input Area =====
function renderInputArea() {
  if (sessionPendingWaits.length === 0) {
    $chatInputArea.classList.add('hidden');
    return;
  }
  $chatInputArea.classList.remove('hidden');
  // Input area always responds to the FIRST (oldest) pending wait
  var pw = sessionPendingWaits[0];
  sessionPendingWait = pw; // keep compat alias in sync

  // Show multi-wait count hint if more than one
  $pendingContext.textContent = pw.question || '';

  var multiHint = document.getElementById('multiWaitHint');
  if (multiHint) {
    if (sessionPendingWaits.length > 1) {
      multiHint.textContent = t('chat.multiWaitHint', { n: sessionPendingWaits.length });
      multiHint.classList.remove('hidden');
    } else {
      multiHint.classList.add('hidden');
    }
  }

  // Option buttons or quick reply templates
  if (pw.options && pw.options.length > 0) {
    $quickReplyBar.innerHTML = '<span class="options-label">' + esc(t('chat.options')) + '</span>' +
      pw.options.map(function (opt) {
        return '<button class="option-btn" data-opt="' + esc(opt) + '">' + esc(opt) + '</button>';
      }).join('');
  } else {
    var templates = getTemplates();
    $quickReplyBar.innerHTML = templates.map(function (tpl) {
      return '<button class="quick-reply-btn" data-tpl="' + esc(tpl) + '">' + esc(tpl) + '</button>';
    }).join('');
  }

  var canWrite = currentRole === 'operator';
  $sendBtn.disabled = !canWrite;
  $cancelBtn.disabled = !canWrite;
  $replyInput.disabled = !canWrite;

  if (pw.expiresAt <= 0) {
    $extendBtn.classList.add('hidden');
  } else {
    $extendBtn.classList.remove('hidden');
    $extendBtn.disabled = !canWrite;
  }
}

// ===== Rendering: Countdown =====
var countdownTimer = null;

function startCountdown() {
  if (countdownTimer) clearInterval(countdownTimer);
  countdownTimer = setInterval(function () {
    if (!sessionPendingWait) {
      $waitCountdown.textContent = '';
      return;
    }
    // expiresAt <= 0 means no timeout
    if (sessionPendingWait.expiresAt <= 0) {
      $waitCountdown.textContent = t('chat.noTimeout');
      $waitCountdown.classList.remove('expired');
      return;
    }
    var remaining = Math.max(0, Math.floor((sessionPendingWait.expiresAt - Date.now()) / 1000));
    if (remaining <= 0) {
      $waitCountdown.textContent = t('chat.expired');
      $waitCountdown.classList.add('expired');
    } else {
      var min = Math.floor(remaining / 60);
      var sec = remaining % 60;
      $waitCountdown.textContent = min + ':' + (sec < 10 ? '0' : '') + sec;
      $waitCountdown.classList.remove('expired');
    }
  }, 1000);
}
startCountdown();

// ===== View Management =====
function showWelcome() {
  $welcomeView.classList.remove('hidden');
  $chatView.classList.add('hidden');
  $settingsView.classList.add('hidden');
}

function showChat() {
  $welcomeView.classList.add('hidden');
  $chatView.classList.remove('hidden');
  $settingsView.classList.add('hidden');
}

function showSettings() {
  $settingsView.classList.remove('hidden');
}

function hideSettings() {
  $settingsView.classList.add('hidden');
}

async function selectSession(sessionId) {
  selectedSessionId = sessionId;
  showChat();
  renderSessionList();

  // Update header
  $chatSessionId.textContent = sessionId;
  renderSessionNameInHeader(sessionId);
  var session = sessionMap.get(sessionId);
  var pendingCount = session ? (session.pendingWaits || []).length : 0;
  var meta = session ? (session.interactionCount + ' ' + t('sessions.interactions')) : '';
  if (session && session.status === 'pending') {
    meta = (pendingCount > 1 ? pendingCount + ' ' + t('sessions.waitingMulti') : t('sessions.waiting')) +
      (session.interactionCount > 0 ? ' · ' + session.interactionCount + ' ' + t('sessions.prior') : '');
  }
  $chatSessionMeta.textContent = meta;

  // Load and render chat
  $chatMessages.innerHTML = '<div class="msg msg-system">' + t('chat.loading') + '</div>';
  await loadSessionChat(sessionId);
  renderChatMessages();
  renderInputArea();
}

// ===== Initial Load / Fallback Poll =====
async function initialLoad() {
  try {
    await loadSessions();
    renderSessionList();

    // Auto-select first active session if nothing is selected
    if (!selectedSessionId && sessionMap.size > 0) {
      var arr = sessionsArray();
      var activeSession = arr.find(function (s) { return s.status === 'pending'; });
      if (activeSession) {
        await selectSession(activeSession.sessionId);
        return;
      }
    }

    // If a session is selected, refresh its chat
    if (selectedSessionId) {
      if (!sessionMap.has(selectedSessionId)) {
        selectedSessionId = null;
        showWelcome();
        return;
      }
      await loadSessionChat(selectedSessionId);
      renderChatMessages();
      renderInputArea();
    }

    // Show welcome if no sessions
    if (sessionMap.size === 0 && !selectedSessionId) {
      showWelcome();
    }
  } catch (e) {
    // Silently fail, retry on next poll
  }
}

async function fallbackPoll() {
  try {
    await loadSessions();
    renderSessionList();
    if (selectedSessionId && !sessionMap.has(selectedSessionId)) {
      selectedSessionId = null;
      showWelcome();
    }
  } catch (e) {}
}

// ===== Actions =====
async function sendReply() {
  if (sessionPendingWaits.length === 0) return;
  var message = ($replyInput.value || '').trim();
  var waitSnapshot = sessionPendingWaits[0]; // always reply to oldest pending
  try {
    await apiRequest('/api/waits/' + encodeURIComponent(waitSnapshot.id) + '/respond', 'POST', { message: message });
    $replyInput.value = '';
    var optimisticItem = {
      id: waitSnapshot.id,
      sessionId: waitSnapshot.sessionId,
      context: waitSnapshot.context || '',
      question: waitSnapshot.question,
      createdAt: waitSnapshot.createdAt,
      expiresAt: waitSnapshot.expiresAt,
      resolvedAt: Date.now(),
      resolution: 'message',
      userMessage: message,
      finalMessageLength: message.length,
    };
    sessionTimeline = sessionTimeline.concat([optimisticItem]);
    sessionPendingWaits = sessionPendingWaits.filter(function (w) { return w.id !== waitSnapshot.id; });
    sessionPendingWait = sessionPendingWaits[0] || null;
    renderChatMessages();
    renderInputArea();
  } catch (e) {
    showErrorToast(e.message);
  }
}

async function extendWait() {
  if (sessionPendingWaits.length === 0) return;
  var pw = sessionPendingWaits[0];
  try {
    var extResult = await apiRequest('/api/waits/' + encodeURIComponent(pw.id) + '/extend', 'POST', { seconds: 300 });
    if (extResult && extResult.newExpiresAt) {
      sessionPendingWaits[0].expiresAt = extResult.newExpiresAt;
      sessionPendingWait = sessionPendingWaits[0];
      renderInputArea();
    }
  } catch (e) {
    showErrorToast(e.message);
  }
}

async function cancelWait() {
  if (sessionPendingWaits.length === 0) return;
  var pw = sessionPendingWaits[0];
  showConfirm(t('chat.confirmCancel'), async function () {
    try {
      await apiRequest('/api/waits/' + encodeURIComponent(pw.id) + '/cancel', 'POST');
      sessionPendingWaits = sessionPendingWaits.filter(function (w) { return w.id !== pw.id; });
      sessionPendingWait = sessionPendingWaits[0] || null;
      renderChatMessages();
      renderInputArea();
    } catch (e) {
      showErrorToast(e.message);
    }
  });
}

async function cancelAllWaits() {
// Session list click
$sessionList.addEventListener('click', function (e) {
  var item = e.target.closest('.session-item');
  if (!item) return;
  var sid = item.getAttribute('data-session-id');
  if (sid) selectSession(sid);
});

// Send button
$sendBtn.addEventListener('click', function () { sendReply(); });

// Extend / Cancel
$extendBtn.addEventListener('click', function () { extendWait(); });
$cancelBtn.addEventListener('click', function () { cancelWait(); });

// Ctrl+Enter to send
$replyInput.addEventListener('keydown', function (e) {
  if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) {
    e.preventDefault();
    sendReply();
  }
});

// Quick reply / option button click
$quickReplyBar.addEventListener('click', function (e) {
  var optBtn = e.target.closest('.option-btn');
  if (optBtn) {
    var opt = optBtn.getAttribute('data-opt');
    if (opt) { $replyInput.value = opt; sendReply(); }
    return;
  }
  var btn = e.target.closest('.quick-reply-btn');
  if (!btn) return;
  var tpl = btn.getAttribute('data-tpl');
  if (tpl) {
    $replyInput.value = tpl;
    $replyInput.focus();
  }
});

// Edit session name
document.getElementById('editNameBtn')?.addEventListener('click', function () {
  if (selectedSessionId) startEditSessionName(selectedSessionId);
});

// Back button (mobile)
document.getElementById('backBtn').addEventListener('click', function () {
  selectedSessionId = null;
  showWelcome();
  renderSessionList();
  // Mobile: show sidebar
  var sidebar = document.getElementById('sidebar');
  if (sidebar) sidebar.classList.remove('sidebar-hidden');
});

// Settings toggle
document.getElementById('settingsToggleBtn').addEventListener('click', function () {
  if ($settingsView.classList.contains('hidden')) showSettings();
  else hideSettings();
});
document.getElementById('closeSettingsBtn').addEventListener('click', function () { hideSettings(); });

// Auth
document.getElementById('saveApiKeyBtn').addEventListener('click', function () {
  apiKey = ($apiKeyInput.value || '').trim();
  if (apiKey) localStorage.setItem(API_KEY_STORAGE, apiKey);
  else localStorage.removeItem(API_KEY_STORAGE);
  if ($authHint) $authHint.textContent = apiKey ? t('auth.saved') : t('auth.enterKey');
  initialLoad();
});
document.getElementById('clearApiKeyBtn').addEventListener('click', function () {
  apiKey = '';
  $apiKeyInput.value = '';
  localStorage.removeItem(API_KEY_STORAGE);
  if ($authHint) $authHint.textContent = t('auth.cleared');
  currentRole = 'none';
  initialLoad();
});

// Notification toggles
document.getElementById('notifToggleBtn').addEventListener('click', function () {
  notifSettings.desktop = !notifSettings.desktop;
  try { localStorage.setItem(NOTIF_STORAGE, JSON.stringify(notifSettings)); } catch (e) {}
  updateNotifButtons();
  if (notifSettings.desktop && typeof Notification !== 'undefined' && Notification.permission === 'default') {
    Notification.requestPermission().catch(function () {});
  }
});
document.getElementById('soundToggleBtn').addEventListener('click', function () {
  notifSettings.sound = !notifSettings.sound;
  try { localStorage.setItem(NOTIF_STORAGE, JSON.stringify(notifSettings)); } catch (e) {}
  updateNotifButtons();
});

// Timeout toggle
function updateTimeoutHint() {
  var $hint = document.getElementById('timeoutHint');
  if ($hint) $hint.textContent = serverTimeoutEnabled ? t('settings.timeoutOn') : t('settings.timeoutOff');
}

document.getElementById('timeoutToggle').addEventListener('change', async function () {
  var enabled = this.checked;
  try {
    await apiRequest('/api/settings', 'POST', { timeoutEnabled: enabled });
    serverTimeoutEnabled = enabled;
  } catch (e) {
    this.checked = !enabled; // revert
  }
  updateTimeoutHint();
});

// Language toggle
document.getElementById('langToggleBtn').addEventListener('click', function () {
  if (typeof i18n === 'undefined') return;
  var next = i18n.getLang() === 'en' ? 'zh' : 'en';
  i18n.setLang(next);
  t = i18n.t;
  updateLangButton();
  applyStaticI18n();
  replyTemplates = null; // reset to get translated defaults
  initialLoad();
});

// ===== Template Manager (in settings) =====
function renderTemplateManager() {
  var container = document.getElementById('templateManager');
  if (!container) return;
  var templates = getTemplates();
  var html = '<div class="template-list">';
  templates.forEach(function (tpl, idx) {
    html += '<div class="template-list-item">' +
      '<span>' + esc(tpl) + '</span>' +
      '<button class="btn-sm warning" data-tpl-delete="' + idx + '">' + t('btn.delete') + '</button>' +
    '</div>';
  });
  html += '</div>' +
    '<div class="settings-row" style="margin-top:8px">' +
      '<input id="newTplInput" class="text-input" type="text" placeholder="' + esc(t('ph.newTemplate')) + '" />' +
      '<button id="addTplBtn" class="btn primary">' + t('btn.add') + '</button>' +
      '<button id="resetTplBtn" class="btn secondary">' + t('btn.resetDefault') + '</button>' +
    '</div>';
  container.innerHTML = html;
}

document.getElementById('templateManager')?.addEventListener('click', function (e) {
  var target = e.target;
  if (!(target instanceof HTMLElement)) return;
  var delIdx = target.getAttribute('data-tpl-delete');
  if (delIdx !== null) {
    var templates = getTemplates().slice();
    templates.splice(Number(delIdx), 1);
    replyTemplates = templates;
    saveTemplates();
    renderTemplateManager();
    return;
  }
  if (target.id === 'addTplBtn') {
    var input = document.getElementById('newTplInput');
    var val = (input && input.value || '').trim();
    if (val) {
      replyTemplates = getTemplates().slice();
      if (!replyTemplates.includes(val)) replyTemplates.push(val);
      saveTemplates();
      renderTemplateManager();
    }
    if (input) input.value = '';
    return;
  }
  if (target.id === 'resetTplBtn') {
    replyTemplates = null;
    try { localStorage.removeItem(TEMPLATES_STORAGE); } catch (e) {}
    renderTemplateManager();
    return;
  }
});

// ===== Setup Guide =====
function buildGuideHtml(url, hasAuth) {
  var windsurfSnippet = JSON.stringify({ mcpServers: { 'turn-mcp-web': { serverUrl: url } } }, null, 2);
  var cursorSnippet = JSON.stringify({ mcpServers: { 'turn-mcp-web': { url: url } } }, null, 2);
  var claudeSnippet = JSON.stringify({ mcpServers: { 'turn-mcp-web': { url: url } } }, null, 2);

  var html = '<h4>' + t('tutorial.heading') + '</h4>' +
    '<p>' + t('tutorial.intro') + '</p>' +
    '<div class="guide-cols">' +
    '<div class="guide-block"><h5>Windsurf</h5><p>' + t('tutorial.editWindsurf') + '</p>' + codeWrap('<pre>' + esc(windsurfSnippet) + '</pre>') + '</div>' +
      '<div class="guide-block"><h5>Cursor</h5><p>' + t('tutorial.editCursor') + '</p>' + codeWrap('<pre>' + esc(cursorSnippet) + '</pre>') + '</div>' +
      '<div class="guide-block"><h5>Claude Desktop</h5><p>' + t('tutorial.editClaude') + '</p>' + codeWrap('<pre>' + esc(claudeSnippet) + '</pre>') + '</div>' +
    '</div>';

  if (hasAuth) {
    var authSnippet = JSON.stringify({ mcpServers: { 'turn-mcp-web': { url: url, headers: { 'x-turn-mcp-api-key': '<YOUR_API_KEY>' } } } }, null, 2);
    html += '<h5>' + t('tutorial.authHeading') + '</h5><p>' + t('tutorial.authIntro') + '</p>' + codeWrap('<pre>' + esc(authSnippet) + '</pre>');
  }

  html += '<h5>' + t('tutorial.notesHeading') + '</h5><ul>' +
    '<li>' + t('tutorial.note1') + '</li>' +
    '<li>' + t('tutorial.note2') + '</li>' +
    '<li>' + t('tutorial.note3') + '</li></ul>';
  return html;
}

function renderSetupGuide(url, hasAuth) {
  var html = buildGuideHtml(url, hasAuth);
  // Welcome page guide
  if ($setupGuideContent) $setupGuideContent.innerHTML = html;
  // Settings panel guide
  var $settingsGuide = document.getElementById('settingsGuideContent');
  var $settingsMcpUrl = document.getElementById('settingsMcpUrl');
  if ($settingsGuide) $settingsGuide.innerHTML = html;
  if ($settingsMcpUrl) $settingsMcpUrl.textContent = url;
}

// ===== SSE =====
var pollTimer = null;

function adjustPolling(fast) {
  if (pollTimer) clearInterval(pollTimer);
  pollTimer = setInterval(fallbackPoll, fast ? FALLBACK_POLL_INTERVAL : REFRESH_INTERVAL);
}

function connectSSE() {
  if (typeof EventSource === 'undefined') return;
  var url = '/api/stream';
  if (apiKey) url += '?token=' + encodeURIComponent(apiKey);
  var source = new EventSource(url);

  source.onopen = function () {
    sseReconnectDelay = SSE_BACKOFF_BASE; // reset backoff on successful connect
    if (sseEverConnected) {
      // Reconnected after a gap — resync any missed events
      initialLoad();
    }
    sseEverConnected = true;
    sseConnected = true;
    if (pollTimer) { clearInterval(pollTimer); pollTimer = null; }
    updateConnStatus('live');
  };

  source.addEventListener('wait_created', function (evt) {
    var data = null;
    try { data = JSON.parse(evt.data); } catch (e) {}
    if (!data || !data.sessionId) return;

    onNewWaitCreated(data);

    var newWait = {
      id: data.waitId,
      sessionId: data.sessionId,
      context: data.context || '',
      question: data.question,
      options: data.options || null,
      agentName: data.agentName || null,
      createdAt: data.createdAt,
      expiresAt: data.expiresAt,
    };

    var entry = sessionMap.get(data.sessionId) || {
      sessionId: data.sessionId, status: 'completed', lastActivity: 0,
      pendingWaits: [], pendingWait: null, interactionCount: 0
    };
    entry.status = 'pending';
    entry.pendingWaits = entry.pendingWaits || [];
    // Avoid duplicates on reconnect
    if (!entry.pendingWaits.some(function(w) { return w.id === newWait.id; })) {
      entry.pendingWaits.push(newWait);
    }
    entry.pendingWait = entry.pendingWaits[0];
    entry.lastActivity = Math.max(entry.lastActivity || 0, data.createdAt);
    sessionMap.set(data.sessionId, entry);
    renderSessionList();

    if (!selectedSessionId) {
      selectSession(data.sessionId);
      return;
    }
    if (selectedSessionId === data.sessionId) {
      if (!sessionPendingWaits.some(function(w) { return w.id === newWait.id; })) {
        sessionPendingWaits.push(newWait);
        sessionPendingWait = sessionPendingWaits[0];
      }
      renderChatMessages();
      renderInputArea();
    }
  });

  source.addEventListener('wait_resolved', function (evt) {
    var data = null;
    try { data = JSON.parse(evt.data); } catch (e) {}
    if (!data || !data.sessionId) return;

    var entry = sessionMap.get(data.sessionId);
    if (entry) {
      entry.pendingWaits = (entry.pendingWaits || []).filter(function (w) { return w.id !== data.waitId; });
      entry.pendingWait = entry.pendingWaits[0] || null;
      if (entry.pendingWaits.length === 0) entry.status = data.resolution || 'completed';
      entry.interactionCount = (entry.interactionCount || 0) + 1;
      sessionMap.set(data.sessionId, entry);
    }
    timelineCache.delete(data.sessionId);
    renderSessionList();

    if (selectedSessionId === data.sessionId) {
      sessionPendingWaits = sessionPendingWaits.filter(function (w) { return w.id !== data.waitId; });
      sessionPendingWait = sessionPendingWaits[0] || null;
      apiRequest('/api/history/timeline?sessionId=' + encodeURIComponent(data.sessionId))
        .then(function (res) {
          sessionTimeline = res.timeline || [];
          timelineCache.set(data.sessionId, sessionTimeline);
          renderChatMessages();
          renderInputArea();
        })
        .catch(function () {});
    }
  });

  // Wait extended — patch expiresAt directly, no API call
  source.addEventListener('wait_extended', function (evt) {
    var data = null;
    try { data = JSON.parse(evt.data); } catch (e) {}
    if (!data || !data.sessionId) return;

    if (selectedSessionId === data.sessionId && sessionPendingWait) {
      sessionPendingWait.expiresAt = data.newExpiresAt;
      renderInputArea();
    }
  });

  source.onerror = function () {
    sseConnected = false;
    updateConnStatus('polling');
    source.close();
    if (sseReconnectTimer) clearTimeout(sseReconnectTimer);
    sseReconnectTimer = setTimeout(function () {
      sseReconnectDelay = Math.min(sseReconnectDelay * 2, SSE_BACKOFF_MAX);
      connectSSE();
    }, sseReconnectDelay);
    adjustPolling(true);
  };
}

// ===== Cancel All Waits =====
async function cancelAllWaits() {
  try {
    var result = await apiRequest('/api/waits/cancel-all', 'POST');
    if (result && result.canceled > 0) {
      await initialLoad();
    }
  } catch (e) {
    showErrorToast(e.message);
  }
}

document.getElementById('cancelAllBtn').addEventListener
  cancelAllWaits();
});

// Session filter
if ($sessionFilter) {
  $sessionFilter.addEventListener('input', function () { renderSessionList(); });
}

// Webhook settings
document.getElementById('saveWebhookBtn')?.addEventListener('click', async function () {
  var url = ($webhookUrlInput ? $webhookUrlInput.value.trim() : '');
  try {
    await apiRequest('/api/settings', 'POST', { webhookUrl: url });
    webhookUrl = url;
  } catch (e) {
    alert(t('chat.error', { error: e.message }));
  }
});
document.getElementById('clearWebhookBtn')?.addEventListener('click', async function () {
  try {
    await apiRequest('/api/settings', 'POST', { webhookUrl: '' });
    webhookUrl = '';
    if ($webhookUrlInput) $webhookUrlInput.value = '';
  } catch (e) {
    alert(t('chat.error', { error: e.message }));
  }
});

// ===== Init =====
$apiKeyInput.value = apiKey;
renderTemplateManager();

loadPublicConfig()
  .then(function () { return initialLoad(); })
  .then(function () {
    // Smooth reveal — fade out loading overlay, show app
    document.body.classList.remove('not-ready');
    var overlay = document.getElementById('loadingOverlay');
    if (overlay) {
      overlay.classList.add('loaded');
      setTimeout(function () { if (overlay.parentNode) overlay.parentNode.removeChild(overlay); }, 800);
    }
    connectSSE();
  })
  .catch(function () {
    // Still reveal UI on error so user can see connection status
    document.body.classList.remove('not-ready');
    var overlay = document.getElementById('loadingOverlay');
    if (overlay) {
      overlay.classList.add('loaded');
      setTimeout(function () { if (overlay.parentNode) overlay.parentNode.removeChild(overlay); }, 800);
    }
    updateConnStatus('disconnected');
  });

// Service worker
if (typeof navigator !== 'undefined' && 'serviceWorker' in navigator) {
  navigator.serviceWorker.register('/sw.js').catch(function () {});
}
