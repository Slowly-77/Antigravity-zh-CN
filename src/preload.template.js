// Localization and chat layout extensions.
(function () {
  'use strict';

  const DICT = /* DICTIONARY */ {};

  const normalizedDictionary = new Map(Object.entries(DICT).map(([key, value]) => [normalize(key), value]));
  function normalize(text) {
    return text.replace(/\s+/g, ' ').replace(/[‘’]/g, "'").replace(/[“”]/g, '"').replace(/…/g, '...').trim().toLowerCase();
  }
  const REGEX_RULES = [
    { pattern: /^Show (\d+) breakdowns?$/i, replacement: '展开 $1 项明细' },
    { pattern: /^Hide (\d+) breakdowns?$/i, replacement: '收起 $1 项明细' },
    { pattern: /^Select project, current: (.*)$/i, replacement: (_, name) => '选择项目，当前：' + (normalizedDictionary.get(normalize(name)) ?? name) },
    { pattern: /^(\d+)\s*(s|m|h|d|w|mo|yr)$/i, replacement: (_, n, unit) => n + ({s:'秒前',m:'分钟前',h:'小时前',d:'天前',w:'周前',mo:'个月前',yr:'年前'})[unit.toLowerCase()] },
    { pattern: /^(Thought|Thinking|Worked) for ((?:\d+(?:\.\d+)?\s*(?:ms|s|m|h)\s*)+)$/i, replacement: (_, kind, duration) => (kind.toLowerCase()==='worked'?'用时 ':'思考耗时 ') + duration.replace(/(\d+(?:\.\d+)?)\s*(ms|s|m|h)/g, (_, n, u) => n+' '+({ms:'毫秒',s:'秒',m:'分',h:'小时'})[u]+' ').replace(/\s+/g, ' ').trim() },
    { pattern: /^(\d+)\s+of\s+(\d+)$/i, replacement: '$1 / $2' },
    { pattern: /^(\d+)\s+(seconds?|minutes?|hours?|days?|weeks?)\s+ago$/i, replacement: (_, n, unit) => n + ' ' + ({second:'秒',minute:'分钟',hour:'小时',day:'天',week:'周'})[unit.toLowerCase().replace(/s$/, '')] + '前' },
    { pattern: /^Show (\d+) more(?: results?)?$/i, replacement: '再显示 $1 项' },
    { pattern: /^(\d+) tools? enabled$/i, replacement: '已启用 $1 个工具' },
    { pattern: /^Worked for (\d+)s$/i, replacement: '用时 $1 秒' },
    { pattern: /^Worked for (\d+)m$/i, replacement: '用时 $1 分钟' },
    { pattern: /^Worked for (\d+)m (\d+)s$/i, replacement: '用时 $1 分 $2 秒' },
    { pattern: /^Thought for (\d+)s$/i, replacement: '用时 $1 秒' },
    { pattern: /^Thought for (\d+)m$/i, replacement: '用时 $1 分钟' },
    { pattern: /^Thought for (\d+)m (\d+)s$/i, replacement: '用时 $1 分 $2 秒' },
    { pattern: /^(\d+)s ago$/i, replacement: '$1 秒前' },
    { pattern: /^(\d+)m ago$/i, replacement: '$1 分钟前' },
    { pattern: /^(\d+)h ago$/i, replacement: '$1 小时前' },
    { pattern: /^(\d+)d ago$/i, replacement: '$1 天前' },
    { pattern: /^just now$/i, replacement: '刚刚' },
    { pattern: /^No more older messages, showing (\d+) of (\d+)$/i, replacement: '已无更早消息（当前显示第 $1 / $2 条）' },
    { pattern: /^Showing (\d+) of (\d+)$/i, replacement: '正在显示 $1 / $2 条' },
    { pattern: /^Load older messages, showing (\d+) of (\d+)$/i, replacement: '加载更早消息（当前显示第 $1 / $2 条）' },
    { pattern: /^(\d+)\s+files?\s+changed$/i, replacement: '$1 个文件已变更' },
    { pattern: /^Select model, current: (.*)$/i, replacement: '选择模型，当前：$1' },
    { pattern: /^Send feedback as\s+(.+)$/i, replacement: '以 $1 身份提交反馈' },
    { pattern: /^Check (.*) in asar finished$/i, replacement: '$1 检查完成' },
    { pattern: /^Pack (.*) asar finished$/i, replacement: '$1 打包完成' },
    { pattern: /^No agents running$/i, replacement: '无运行中的智能体' },
    { pattern: /^(\d+) agents? running$/i, replacement: '$1 个智能体运行中' },
    { pattern: /^Exploring files?,\s*running commands?,\s*editing artifacts?$/i, replacement: '正在浏览文件、执行命令、编辑成果文件' },
    { pattern: /^Allow reading this (?:URL|url)\??$/i, replacement: '是否允许读取此 URL？' },
    { pattern: /^Allow reading these (?:URLs|urls)\??$/i, replacement: '是否允许读取这些 URL？' },
    { pattern: /^Allow reading this file\??$/i, replacement: '是否允许读取此文件？' },
    { pattern: /^Allow reading these files\??$/i, replacement: '是否允许读取这些文件？' },
    { pattern: /^Allow writing to this file\??$/i, replacement: '是否允许写入此文件？' },
    { pattern: /^Allow writing to these files\??$/i, replacement: '是否允许写入这些文件？' },
    { pattern: /^Allow editing this file\??$/i, replacement: '是否允许编辑此文件？' },
    { pattern: /^Allow editing these files\??$/i, replacement: '是否允许编辑这些文件？' },
    { pattern: /^Allow (?:running|executing) this command\??$/i, replacement: '是否允许执行此命令？' },
    { pattern: /^Allow (?:running|executing) these commands\??$/i, replacement: '是否允许执行这些命令？' },
    { pattern: /^Yes,\s*and always allow (?:in|for) this conversation$/i, replacement: '是，且在此对话中始终允许' },
    { pattern: /^Yes,\s*and always allow (?:when not in a project|outside of projects?)$/i, replacement: '是，且在非项目状态下始终允许' },
    { pattern: /^Yes,\s*and always allow (?:in|for) this project$/i, replacement: '是，且在此项目中始终允许' },
    { pattern: /^Yes,\s*and always allow (?:in|for) this workspace$/i, replacement: '是，且在此工作区中始终允许' },
    { pattern: /^Yes,\s*and always allow$/i, replacement: '是，且始终允许' },
    { pattern: /^No\s*\((?:tell the agent what to do instead|tell the agent)\)$/i, replacement: '否（指导智能体改做其他操作）' },
    { pattern: /^\((?:tell the agent what to do instead|tell the agent)\)$/i, replacement: '（指导智能体改做其他操作）' },
    { pattern: /^tell the agent what to do instead$/i, replacement: '指导智能体改做其他操作' }
  ];

  const IGNORE_TAGS = new Set(['SCRIPT', 'STYLE', 'CODE', 'PRE', 'NOSCRIPT']);
  const IGNORE_CLASSES = ['monaco-editor', 'prism-code', 'token', 'katex', 'hljs', 'markdown-code'];

  function isIgnored(node) {
    if (!node || node.nodeType !== Node.ELEMENT_NODE) return false;
    if (IGNORE_TAGS.has(node.tagName)) return true;
    // Incremental mutations can start inside a code block or editable field.
    if (node.closest('pre, code, script, style, noscript, textarea, [contenteditable="true"], .monaco-editor, .terminal, .xterm, .prism-code, .katex, .hljs, .markdown-code, [translate="no"], .notranslate')) return true;
    if (node.classList) {
      for (const cls of IGNORE_CLASSES) {
        if (node.classList.contains(cls)) return true;
      }
    }
    return false;
  }

  function translateQuotaText(s) {
    if (!s) return null;

    // 1. Resets in 动态倒计时 (例: Resets in 5d 7h, Resets in 3h 55m, Resets in <1m)
    if (/^Resets in\s+/i.test(s)) {
      var rest = s.replace(/^Resets in\s+/i, '').trim();
      if (rest === '<1m') return '将在 1 分钟内重置';
      var trans = rest
        .replace(/(\d+)\s*d\b/gi, '$1 天 ')
        .replace(/(\d+)\s*h\b/gi, '$1 小时 ')
        .replace(/(\d+)\s*m\b/gi, '$1 分钟 ')
        .replace(/(\d+)\s*s\b/gi, '$1 秒')
        .replace(/\s+/g, ' ')
        .trim();
      return trans ? ('将在 ' + trans + '后重置') : '重置中';
    }

    // 2. You have used some of your / reached ... limit 气泡提示
    if (/You have (used some of|reached|exhausted) your (.+?) limit,?\s*it will fully refresh in (.+?)\.?$/i.test(s)) {
      return s.replace(/You have (used some of|reached|exhausted) your (.+?) limit,?\s*it will fully refresh in (.+?)\.?$/i, function(m, state, limitType, timePart) {
        var t = timePart
          .replace(/(\d+)\s*days?/gi, '$1 天')
          .replace(/(\d+)\s*hours?/gi, '$1 小时')
          .replace(/(\d+)\s*minutes?/gi, '$1 分钟')
          .replace(/(\d+)\s*seconds?/gi, '$1 秒')
          .replace(/,\s*/g, ' ')
          .replace(/\s+/g, ' ')
          .trim();
        var lt = limitType.toLowerCase().trim();
        if (lt === 'weekly') lt = '每周';
        else if (lt === 'five hour' || lt === '5 hour' || lt === '5-hour') lt = '五小时';
        else if (lt === 'daily') lt = '每日';
        else if (lt === 'hourly') lt = '每小时';
        else if (lt === 'monthly') lt = '每月';
        else if (lt === 'rate') lt = '速率';
        var verb = /reached|exhausted/i.test(state) ? '已达到' : '已使用部分';
        return '您' + verb + lt + '额度限制，将在 ' + t + '后完全刷新。';
      });
    }

    return null;
  }

  function translateText(text) {
    if (!text || text.length < 1) return text;
    var trimmed = text.trim();
    if (!trimmed) return text;

    const translation = normalizedDictionary.get(normalize(trimmed));
    if (translation !== undefined) return text.replace(trimmed, () => translation);

    // 额度与刷新倒计时专用匹配
    var quotaTrans = translateQuotaText(trimmed);
    if (quotaTrans) {
      return text.replace(trimmed, quotaTrans);
    }

    // 正则列表匹配
    for (var i = 0; i < REGEX_RULES.length; i++) {
      var rule = REGEX_RULES[i];
      if (rule.pattern.test(trimmed)) {
        return text.replace(trimmed, trimmed.replace(rule.pattern, rule.replacement));
      }
    }

    return text;
  }

  const permissionLabels = {Turbo:'完全访问', '极速模式':'完全访问', Default:'默认权限', '默认':'默认权限', 'Request Review':'逐次确认', '请求审查':'逐次确认', '请求人工确认':'逐次确认'};
  function translateElement(el) {
    if (!el || el.nodeType !== Node.ELEMENT_NODE) return;
    if (isIgnored(el)) return;

    for (const attr of ['placeholder', 'title', 'aria-label', 'aria-description', 'data-tooltip-content']) {
      const value = el.getAttribute(attr);
      if (value) {
        const translated = el.getAttribute('data-testid') === 'permissions-selector-trigger' && attr === 'aria-label' && value.startsWith('Agent permissions preset selector, current: ')
          ? '权限设置，当前：' + (permissionLabels[value.slice(44)] || translateText(value.slice(44))) : translateText(value);
        if (translated !== value) el.setAttribute(attr, translated);
      }
    }
  }

  function translateNode(node) {
    if (!node) return;

    if (node.nodeType === Node.TEXT_NODE) {
      if (node.parentElement && isIgnored(node.parentElement)) return;
      var original = node.nodeValue;
      // React renders the running timer as three sibling text nodes.
      const timer = node.parentElement?.closest('[data-testid="thinking-collapsible-trigger"]');
      const isTypeInstruction = original.trim() === 'Type' && /and select/.test(node.parentElement.textContent);
      var translated = isTypeInstruction ? original.replace('Type', '输入') : timer && original === 's' && /(?:Thinking for|已思考)\s*\d+\s*s/.test(timer.textContent)
        ? ' 秒' : translateText(original);
      if (node.parentElement?.closest('[data-testid="tool-group-collapsible"]') && /^Ran\s/.test(original)) {
        translated = original.replace(/^Ran\s+/, '已运行 ');
      }
      if (node.parentElement?.closest('[data-testid="permissions-selector-trigger"], [data-testid="permissions-preset-option-default"], [data-testid="permissions-preset-option-turbo"], [data-testid="permissions-preset-option-request_review"]')) {
        const label = permissionLabels[original.trim()];
        if (label) translated = original.replace(original.trim(), label);
      }
      // Labels and rule previews in settings are presentation only; identifiers
      // and source files remain untouched for loading and copying.
      if (node.parentElement?.closest('[role="dialog"]')) {
        if (/^\(?[\d,.]+\s/.test(original) && /\btokens\b/.test(original)) translated = translated.replace(/\btokens\b/g, '标记');
        const names = {'generative_ui':'交互界面生成','migrate-workflows':'迁移工作流','permissioned-github':'GitHub 授权操作','plugin':'插件管理','ui-plugin-navigation':'插件面板导航','user_global':'用户全局规则','windows-powershell':'Windows 与 PowerShell 规则'};
        if (node.parentElement.getAttribute('data-tooltip-id')?.endsWith('-name') && names[original.trim()]) translated = names[original.trim()];
        if (node.parentElement.classList.contains('line-clamp-2')) {
          translated = translated.replace(/^# Global Agent Rules/, '# 全局智能体规则').replace(/^# Windows & PowerShell Execution Guidelines/, '# Windows 与 PowerShell 执行规范').replace(/## Windows \/ PowerShell/g, '## Windows 与 PowerShell');
        }
        if (node.parentElement.closest('button') && /breakdowns?/.test(node.parentElement.closest('button').textContent)) {
          if (/^Show\s*$/.test(original)) translated = '展开 ';
          if (/^Hide\s*$/.test(original)) translated = '收起 ';
          if (/^\s*breakdowns?$/.test(original)) translated = ' 项明细';
        }
      }
      if (translated !== original) {
        node.nodeValue = translated;
      }
    } else if (node.nodeType === Node.ELEMENT_NODE) {
      if (isIgnored(node)) return;
      translateElement(node);
      for (var child = node.firstChild; child; child = child.nextSibling) {
        translateNode(child);
      }
    }
  }

  /* CHAT_LAYOUT_RUNTIME */
  /* CONTEXT_METER_RUNTIME */
  /* HISTORY_NAVIGATION_RUNTIME */

  function initObserver() {
    if (!document.body) {
      setTimeout(initObserver, 50);
      return;
    }

    translateNode(document.body);

    try {
      var style = document.createElement('style');
      style.id = 'antigravity-zh-cn-style';
      style.textContent = /* CHAT_LAYOUT_CSS */ "";
      document.head.appendChild(style);
      installChatLayout();
      // Read the renderer's own provider in its world; no Node API is exposed.
      electron_1.webFrame.executeJavaScript('(' + installContextMeter.toString() + ')(' + installHistoryNavigation.toString() + ')')
        .catch(() => console.warn('[Antigravity-i18n] Context meter unavailable'));
    } catch (e) {}

    var isPending = false;
    var pendingNodes = new Set();

    var processPending = function () {
      isPending = false;
      var nodes = Array.from(pendingNodes);
      pendingNodes.clear();
      for (var i = 0; i < nodes.length; i++) {
        try {
          translateNode(nodes[i]);
        } catch (e) {}
      }
    };

    var observer = new MutationObserver(function (mutations) {
      for (var i = 0; i < mutations.length; i++) {
        var m = mutations[i];
        if (m.type === 'childList') {
          for (var j = 0; j < m.addedNodes.length; j++) {
            pendingNodes.add(m.addedNodes[j]);
          }
        } else if (m.type === 'characterData') {
          pendingNodes.add(m.target);
        } else if (m.type === 'attributes') {
          if (m.target && m.target.nodeType === Node.ELEMENT_NODE) {
            translateElement(m.target);
          }
        }
      }

      if (!isPending && pendingNodes.size > 0) {
        isPending = true;
        // Background windows suspend animation frames but still need localization.
        setTimeout(processPending, 16);
      }
    });

    observer.observe(document.body, {
      childList: true,
      subtree: true,
      characterData: true,
      attributes: true,
      attributeFilter: ['placeholder', 'title', 'aria-label', 'aria-description', 'data-tooltip-content']
    });

    console.log('[Antigravity-i18n] 全面汉化扩展已就绪。');
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', initObserver);
  } else {
    initObserver();
  }
})();
