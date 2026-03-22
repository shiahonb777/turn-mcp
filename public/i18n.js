/* i18n — lightweight EN/ZH switcher */
(function (root) {
  'use strict';

  var LANG_KEY = 'turn-mcp-web.lang';
  var supported = ['en', 'zh'];

  var en = {
    // Connection
    'conn.connecting': 'Connecting',
    'conn.live': 'Live',
    'conn.polling': 'Polling',
    'conn.disconnected': 'Disconnected',

    // Welcome
    'welcome.title': 'Turn MCP Web Console',
    'welcome.subtitle': 'Waiting for AI agent to call turn.wait ...',

    // Sessions
    'sessions.empty': 'No sessions yet. Start your AI agent and it will appear here.',
    'sessions.waiting': 'Waiting for reply',
    'sessions.interactions': 'interactions',
    'sessions.prior': 'prior',
    'sessions.more': 'Showing {shown} of {total} sessions',
    'sessions.filter': 'Filter sessions...',
    'sessions.cancelAll': 'Cancel all',
    'sessions.noMatch': 'No matching sessions',

    // Chat
    'chat.you': 'You',
    'chat.agent': 'Agent',
    'chat.showMore': 'Show more',
    'chat.showLess': 'Show less',
    'chat.timeout': 'Timed out',
    'chat.canceled': 'Canceled',
    'chat.waitingReply': 'Waiting for your reply...',
    'chat.noMessages': 'No messages in this session yet.',
    'chat.loading': 'Loading...',
    'chat.expired': 'Expired',
    'chat.noTimeout': '∞',
    'chat.error': 'Error: {error}',
    'chat.confirmCancel': 'Cancel this wait? The agent will receive a [canceled] status.',

    // Buttons
    'btn.send': 'Send',
    'btn.copy': 'Copy',
    'btn.copied': 'Copied!',
    'btn.extend': 'Extend 5min',
    'btn.cancelWait': 'Cancel',
    'btn.save': 'Save',
    'btn.clear': 'Clear',
    'btn.add': 'Add',
    'btn.delete': 'Delete',
    'btn.resetDefault': 'Reset Default',

    // Settings
    'settings.title': 'Settings',
    'settings.webhook': 'Webhook URL',
    'settings.auth': 'API Key',
    'settings.timeout': 'Timeout',
    'settings.timeoutEnable': 'Enable wait timeout',
    'settings.timeoutOn': 'Waits will timeout after the default period.',
    'settings.timeoutOff': 'Waits will never timeout — waiting indefinitely until you reply.',
    'settings.templates': 'Quick Reply Templates',
    'settings.reinforcement': 'Reinforcement Suffix (auto-appended)',
    'settings.guide': 'MCP Setup Guide',

    // Auth
    'auth.saved': 'API Key saved.',
    'auth.required': 'API Key auth is enabled. Please enter a key.',
    'auth.enterKey': 'Please enter your API Key.',
    'auth.cleared': 'API Key cleared.',
    'auth.role': 'Current role: {role}',
    'auth.fail': 'Auth failed: {error}',

    // Placeholders
    'ph.apiKey': 'Enter API Key',
    'ph.replyInput': 'Type your reply... (Ctrl+Enter to send)',
    'ph.newTemplate': 'New template content',
    'ph.webhookUrl': 'https://...',

    // Error
    'error.title': 'Error',

    // Confirm modal
    'confirm.ok': 'Confirm',
    'confirm.cancel': 'Cancel',

    // Session naming
    'session.namePlaceholder': 'Name this session…',

    // Multi-wait
    'sessions.waitingMulti': 'pending waits',
    'chat.multiWaitHint': '{n} waits pending — replying to the oldest first',

    // Templates
    'tpl.continue': 'Continue',
    'tpl.proceed': 'Proceed with your suggestion',
    'tpl.pause': 'Pause, I will reply later',

    // Time
    'time.justNow': 'just now',
    'time.minsAgo': '{n} min ago',
    'time.hrsAgo': '{n} hr ago',
    'time.daysAgo': '{n}d ago',

    // Notification
    'notif.title': 'Turn MCP: New task',
    'notif.newTask': 'New task — Turn MCP',
    'notif.session': 'Session: ',

    // Options & context
    'chat.options': 'Choose an option',
    'chat.loadFullContext': 'Load full context',

    // Tutorial
    'tutorial.summaryLabel': 'Setup Guide',
    'tutorial.heading': 'Streamable HTTP Integration',
    'tutorial.intro': 'Add the following to your IDE\'s MCP config:',
    'tutorial.editWindsurf': 'Edit <code>~/.codeium/windsurf/mcp_config.json</code>:',
    'tutorial.editCursor': 'Edit <code>~/.cursor/mcp.json</code>:',
    'tutorial.editClaude': 'Claude Desktop config:',
    'tutorial.authHeading': 'With API Key',
    'tutorial.authIntro': 'Add headers to the config:',
    'tutorial.notesHeading': 'Notes',
    'tutorial.note1': 'Restart your IDE after modifying the config.',
    'tutorial.note2': 'Make sure the Turn MCP server is running.',
    'tutorial.note3': 'The server default port is 3737.',
  };

  var zh = {
    'conn.connecting': '连接中',
    'conn.live': '实时',
    'conn.polling': '轮询',
    'conn.disconnected': '断开',

    'welcome.title': 'Turn MCP 控制台',
    'welcome.subtitle': '等待 AI Agent 调用 turn.wait ...',

    'sessions.empty': '暂无会话。启动 AI Agent 后会自动出现在这里。',
    'sessions.waiting': '等待回复中',
    'sessions.interactions': '次交互',
    'sessions.prior': '次历史',
    'sessions.more': '显示前 {shown} 个，共 {total} 个',
    'sessions.filter': '筛选会话...',
    'sessions.cancelAll': '取消全部',
    'sessions.noMatch': '无匹配会话',

    'chat.you': '你',
    'chat.agent': 'Agent',
    'chat.showMore': '展开',
    'chat.showLess': '收起',
    'chat.timeout': '已超时',
    'chat.canceled': '已取消',
    'chat.waitingReply': '等待你的回复...',
    'chat.noMessages': '该会话暂无消息。',
    'chat.loading': '加载中...',
    'chat.expired': '已过期',
    'chat.noTimeout': '∞',
    'chat.error': '操作失败：{error}',
    'chat.confirmCancel': '确认取消此等待？Agent 将收到 [canceled] 状态。',

    'btn.send': '发送',
    'btn.copy': '复制',
    'btn.copied': '已复制！',
    'btn.extend': '延长 5 分钟',
    'btn.cancelWait': '取消',
    'btn.save': '保存',
    'btn.clear': '清空',
    'btn.add': '添加',
    'btn.delete': '删除',
    'btn.resetDefault': '重置默认',

    'settings.title': '设置',
    'settings.webhook': 'Webhook 地址',
    'settings.auth': 'API 密钥',
    'settings.timeout': '超时设置',
    'settings.timeoutEnable': '启用等待超时',
    'settings.timeoutOn': '等待将在默认时间后超时。',
    'settings.timeoutOff': '等待永不超时 — 一直等待直到你回复。',
    'settings.templates': '快捷回复模板',
    'settings.reinforcement': '强化提示后缀（自动追加）',
    'settings.guide': 'MCP 配置教程',

    'auth.saved': '密钥已保存。',
    'auth.required': '已启用密钥鉴权，请先输入密钥。',
    'auth.enterKey': '请输入密钥。',
    'auth.cleared': '密钥已清空。',
    'auth.role': '当前角色：{role}',
    'auth.fail': '鉴权失败：{error}',

    'ph.apiKey': '输入 API Key',
    'ph.replyInput': '输入回复内容... (Ctrl+Enter 发送)',
    'ph.newTemplate': '新模板内容',
    'ph.webhookUrl': 'https://...',

    'error.title': '操作失败',

    'confirm.ok': '确认',
    'confirm.cancel': '取消',

    'session.namePlaceholder': '给这个会话命名…',

    'sessions.waitingMulti': '个等待任务',
    'chat.multiWaitHint': '共 {n} 个等待任务，按时间顺序优先回复最早的',

    'tpl.continue': '继续',
    'tpl.proceed': '按你的建议执行',
    'tpl.pause': '暂停，我稍后回复',

    'time.justNow': '刚才',
    'time.minsAgo': '{n} 分钟前',
    'time.hrsAgo': '{n} 小时前',
    'time.daysAgo': '{n} 天前',

    'notif.title': 'Turn MCP：新任务',
    'notif.newTask': '新任务 — Turn MCP',
    'notif.session': '会话：',
    'chat.options': '选择一个选项',
    'chat.loadFullContext': '加载完整上下文',

    'tutorial.summaryLabel': '接入指南',
    'tutorial.heading': 'Streamable HTTP 接入',
    'tutorial.intro': '在 IDE 的 MCP 配置中添加：',
    'tutorial.editWindsurf': '编辑 <code>~/.codeium/windsurf/mcp_config.json</code>：',
    'tutorial.editCursor': '编辑 <code>~/.cursor/mcp.json</code>：',
    'tutorial.editClaude': 'Claude Desktop 配置：',
    'tutorial.authHeading': '带 API Key',
    'tutorial.authIntro': '在配置中添加 headers：',
    'tutorial.notesHeading': '注意事项',
    'tutorial.note1': '修改配置后需重启 IDE。',
    'tutorial.note2': '确保 Turn MCP 服务器已启动。',
    'tutorial.note3': '默认端口为 3737。',
  };

  var langs = { en: en, zh: zh };

  function detectLang() {
    try {
      var saved = localStorage.getItem(LANG_KEY);
      if (saved && supported.indexOf(saved) >= 0) return saved;
    } catch (e) {}
    var nav = (typeof navigator !== 'undefined' && navigator.language || 'en').toLowerCase();
    if (nav.startsWith('zh')) return 'zh';
    return 'en';
  }

  var currentLang = detectLang();

  function translate(key, params) {
    var dict = langs[currentLang] || en;
    var text = dict[key] || en[key] || key;
    if (params && typeof params === 'object') {
      Object.keys(params).forEach(function (k) {
        text = text.replace(new RegExp('\\{' + k + '\\}', 'g'), String(params[k]));
      });
    }
    return text;
  }

  function setLang(lang) {
    if (supported.indexOf(lang) < 0) return;
    currentLang = lang;
    try { localStorage.setItem(LANG_KEY, lang); } catch (e) {}
  }

  function getLang() { return currentLang; }

  var api = { t: translate, setLang: setLang, getLang: getLang };

  if (typeof root !== 'undefined') root.i18n = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof window !== 'undefined' ? window : this);
