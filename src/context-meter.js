function installContextMeter(createHistoryNavigation = window.installHistoryNavigation) {
  if (window.__agContextMeterInstalled) return;
  window.__agContextMeterInstalled = true;
  const records = new Map();
  let opened = null, pending = false;
  const quota = {service:null, groups:null, nextRead:0, loading:false, failed:false, updatedAt:0};
  const positive = value => Number.isFinite(Number(value)) && Number(value) > 0 ? Number(value) : null;
  const number = value => Math.round(value).toLocaleString('zh-CN');
  // A stalled local RPC must not permanently lock the meter's loading flag.
  function readWithTimeout(read) {
    let timer;
    return Promise.race([
      Promise.resolve().then(read),
      new Promise((_, reject) => { timer = setTimeout(() => reject(Error('Meter read timed out')), 8000); })
    ]).finally(() => clearTimeout(timer));
  }

  function findBindings(trigger) {
    let provider = null, service = null, selectedModel = null, settingsModal = null;
    const key = Object.keys(trigger).find(key => key.startsWith('__reactFiber$'));
    let fiber = key && trigger[key];
    for (let depth = 0; fiber && depth < 320; depth++, fiber = fiber.return) {
      const props = fiber.memoizedProps;
      const context = props?.cascadeContext || props?.value?.cascadeContext;
      const candidate = context?.state?.agentStateProvider;
      if (!provider && typeof candidate?.getState === 'function') provider = candidate;
      if (!service && typeof props?.value?.getCascadeTrajectory === 'function') service = props.value;
      if (!selectedModel && props?.value?.selectedModel) selectedModel = props.value.selectedModel;
      if (!settingsModal && typeof props?.value?.triggerShowSettingsModal === 'function') settingsModal = props.value;
    }
    return {provider, service, selectedModel, settingsModal};
  }

  function prepareComposer(record, bindings) {
    const footer = record.trigger.closest('[class*="@container/input-footer"]');
    if (!footer) return;
    const add = (node, name) => { if (node && !node.classList.contains(name)) node.classList.add(name); };
    add(footer, 'ag-composer-footer');
    const left = footer.firstElementChild, right = footer.lastElementChild;
    if (left === right || !left.contains(record.trigger)) return;
    add(left, 'ag-composer-flat');
    add(right, 'ag-composer-flat');
    let modelGroup = record.trigger.parentElement;
    while (modelGroup.parentElement !== left && modelGroup.parentElement?.parentElement !== left) modelGroup = modelGroup.parentElement;
    // Flatten only the known footer wrappers, retaining React's DOM ownership.
    if (modelGroup.parentElement !== left) add(modelGroup.parentElement, 'ag-composer-flat');
    add(modelGroup, 'ag-composer-models');
    const attach = Array.from(left.children).find(node => node.tagName === 'BUTTON');
    add(attach, 'ag-composer-attach');
    const native = footer.querySelector('[data-testid="permissions-selector-trigger"]');
    if (native) {
      let slot = native;
      while (slot.parentElement !== right && slot.parentElement !== left && slot.parentElement !== footer) slot = slot.parentElement;
      add(slot, 'ag-composer-permissions');
      const label = Array.from(native.children).find(node => node.tagName === 'SPAN' && !node.hasAttribute('data-icon'));
      const names = {Turbo:'完全访问', '极速模式':'完全访问', Default:'默认权限', '默认':'默认权限', 'Request Review':'逐次确认', '请求审查':'逐次确认', '请求人工确认':'逐次确认'};
      if (label && names[label.textContent]) label.textContent = names[label.textContent];
      const full = label?.textContent === '完全访问';
      if (native.classList.contains('ag-permission-full') !== full) native.classList.toggle('ag-permission-full', full);
      record.permissionFallback?.remove();
      record.permissionFallback = null;
    } else if (attach && bindings.settingsModal) {
      // If the app has not rendered its selector, open its own settings instead
      // of inventing a permission mode or changing feature flags.
      if (!record.permissionFallback) {
        const button = document.createElement('button');
        button.type = 'button'; button.className = 'ag-permission-fallback ag-composer-permissions';
        button.textContent = '权限设置'; button.setAttribute('aria-label', '打开权限设置');
        button.addEventListener('click', () => findBindings(record.trigger).settingsModal?.triggerShowSettingsModal({targetScreen:'General', targetSection:'agent-permissions'}));
        record.permissionFallback = button;
      }
      if (attach.nextElementSibling !== record.permissionFallback) attach.after(record.permissionFallback);
    }
    for (const node of right.children) if (!node.classList.contains('ag-composer-permissions')) add(node, 'ag-composer-send');
  }

  function cacheHit(usage) {
    const count = value => value != null && value !== '' && Number.isFinite(Number(value)) && Number(value) >= 0 ? Number(value) : null;
    const input = count(usage?.inputTokens), read = count(usage?.cacheReadTokens);
    const write = count(usage?.cacheWriteTokens ?? 0);
    if (input === null || read === null || write === null) return null;
    // ModelUsageStats separates uncached input, cache reads and cache writes.
    const total = input + read + write;
    return total > 0 ? read / total : null;
  }

  function readSpeed(entries) {
    const seconds = duration => Number(duration?.seconds || 0) + Number(duration?.nanos || 0) / 1e9;
    for (let i = (entries?.length || 0) - 1; i >= 0; i--) {
      const entry = entries[i].metadata;
      if (entry?.case !== 'chatModel') continue;
      const value = entry.value, rawTokens = value.usage?.outputTokens;
      const tokens = rawTokens != null && rawTokens !== '' && Number.isFinite(Number(rawTokens)) && Number(rawTokens) >= 0 ? Number(rawTokens) : null;
      const duration = seconds(value.timeToFirstToken) + seconds(value.streamingDuration);
      if (tokens !== null && Number.isFinite(duration) && duration > 0) return {rate:tokens / duration, tokens, duration, cacheHit:cacheHit(value.usage)};
    }
    return null;
  }

  function averageSpeed(entries, steps = []) {
    let tokens = 0, duration = 0;
    for (const entry of entries || []) {
      // FULL snapshots can include the request still generating. Only aggregate
      // completed samples, including when the agent is waiting or running tools.
      if (entry.stepIndices?.some(index => steps[index]?.step?.case === 'plannerResponse' && steps[index].status !== 3)) continue;
      const sample = readSpeed([entry]);
      if (sample) { tokens += sample.tokens; duration += sample.duration; }
    }
    return duration > 0 ? {rate:tokens / duration, tokens, duration} : null;
  }

  const timestamp = value => Number(value?.seconds || 0) * 1000 + Number(value?.nanos || 0) / 1e6;
  function stepSpeed(step) {
    if (!step || step.status !== 3) return null;
    const tokens = positive(step.metadata?.modelUsage?.outputTokens);
    const start = timestamp(step.metadata?.createdAt), end = timestamp(step.metadata?.finishedGeneratingAt);
    const duration = (end - start) / 1000;
    return tokens && start > 0 && duration > 0 ? {rate:tokens / duration, tokens, duration, cacheHit:cacheHit(step.metadata.modelUsage)} : null;
  }

  function liveSpeed(record, state) {
    const step = state?.trajectorySlice?.stepsInSlice?.findLast(step => step.step?.case === 'plannerResponse');
    const active = [2,4].includes(state?.status) && step && [1,2,8].includes(step.status) && !timestamp(step.metadata?.finishedGeneratingAt);
    if (!active) { record.stream = null; return null; }
    const value = step.step.value;
    const info = step.metadata?.sourceTrajectoryStepInfo;
    const key = [info?.trajectoryId, info?.stepIndex, timestamp(step.metadata?.createdAt), step.metadata?.stepGenerationVersion].join(':');
    const now = Date.now();
    const reported = positive(step.metadata?.modelUsage?.outputTokens);
    // This is deliberately an estimate when the provider has no streaming token count.
    // Count one copy of thought text and do not include tool output or previous replies.
    const output = (value.rawThinking || value.thinking || '') + (value.response || '');
    const wide = output.match(/[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Hangul}]/gu)?.length || 0;
    const tokens = reported ?? Math.ceil(wide + (output.length - wide) / 4);
    const created = timestamp(step.metadata?.createdAt);
    if (!record.stream || record.stream.key !== key) record.stream = {key, start:created > 0 && created <= now ? created : now, baseline:created > 0 && created <= now ? 0 : tokens};
    const duration = Math.max(0, (now - record.stream.start) / 1000);
    const measured = Math.max(0, tokens - record.stream.baseline);
    return {rate:duration >= .5 ? measured / duration : 0, tokens:measured, duration, estimated:reported === null, live:true, cacheHit:cacheHit(step.metadata?.modelUsage)};
  }

  function refreshQuota(service) {
    if (typeof service?.retrieveUserQuotaSummary !== 'function') return;
    if (quota.service !== service) Object.assign(quota, {service, groups:null, nextRead:0, loading:false, failed:false, updatedAt:0, request:null});
    if (quota.loading || Date.now() < quota.nextRead) return;
    const request = quota.request = {};
    quota.loading = true; quota.nextRead = Date.now() + 60000;
    readWithTimeout(() => service.retrieveUserQuotaSummary({})).then(response => {
      if (quota.request !== request) return;
      quota.groups = response?.response?.groups || [];
      quota.failed = false; quota.updatedAt = Date.now();
    }).catch(() => {
      if (quota.request === request) { quota.failed = true; quota.nextRead = Date.now() + 30000; }
    }).finally(() => {
      if (quota.request === request) quota.loading = false;
      schedule();
    });
  }

  function quotaBucket(model, windowName) {
    const label = model?.label || '';
    const prefix = /gemini/i.test(label) ? 'gemini-' : /claude|gpt/i.test(label) ? '3p-' : null;
    if (!prefix || model?.isCustom || quota.failed || Date.now() - quota.updatedAt > 90000) return null;
    const groups = quota.groups?.filter(group => group.buckets?.some(bucket => bucket.bucketId?.startsWith(prefix))) || [];
    if (groups.length !== 1) return null;
    return groups[0].buckets.find(bucket => bucket.window === windowName) || null;
  }

  function renderMetrics(record, bindings) {
    const box = record.trigger.closest('[data-testid="agent-input-box"]');
    if (!box) return;
    if (!record.strip) {
      record.strip = document.createElement('div');
      record.strip.className = 'ag-usage-strip';
      record.strip.setAttribute('aria-label', '生成速度、缓存命中与模型剩余额度');
      record.speedLabel = document.createElement('span');
      record.fiveHourLabel = document.createElement('span');
      record.weeklyLabel = document.createElement('span');
      for (const node of [record.fiveHourLabel, record.weeklyLabel]) {
        node.className = 'ag-quota-item';
        const value = document.createElement('span');
        const ring = document.createElement('span');
        ring.className = 'ag-quota-ring';
        ring.setAttribute('aria-hidden', 'true');
        node.append(value, ring);
      }
      record.speedLabel.className = 'ag-speed-group';
      record.liveLabel = document.createElement('span');
      record.cacheLabel = document.createElement('span');
      record.speedLabel.append(record.liveLabel, record.cacheLabel);
      record.strip.append(record.speedLabel, record.fiveHourLabel, record.weeklyLabel);
    }
    if (box.firstElementChild !== record.strip) box.prepend(record.strip);
    const text = (node, value) => { if (node.textContent !== value) node.textContent = value; };
    const speed = record.liveSpeed || record.speed;
    const live = record.liveSpeed, average = record.average;
    const displayed = live || average;
    text(record.liveLabel, `⚡ ${displayed ? displayed.rate.toFixed(1) : '—'} tok/s`);
    record.liveLabel.dataset.mode = live ? 'live' : 'average';
    text(record.cacheLabel, ` · 缓存命中 ${speed?.cacheHit != null ? Math.round(speed.cacheHit * 100) + '%' : '—'}`);
    record.speedLabel.title = '实时速度每半秒更新，按本次回答截至当前的输出量和耗时计算，实时计数缺失时按文本估算；停止输出后显示会话平均。会话平均为全部已完成模型请求的输出总量 ÷ 请求总耗时，包含首字等待，不含工具执行耗时。';
    refreshQuota(bindings.service);
    for (const [windowName, label, node] of [['5h','5h',record.fiveHourLabel],['weekly','7d',record.weeklyLabel]]) {
      const bucket = quotaBucket(bindings.selectedModel, windowName);
      const remaining = bucket?.remaining?.case === 'remainingFraction' ? bucket.remaining.value : null;
      const valid = typeof remaining === 'number' && Number.isFinite(remaining) && remaining >= 0 && remaining <= 1;
      text(node.firstElementChild, `${label} ${valid ? (remaining * 100).toFixed(1) + '%' : '—'}`);
      node.style.setProperty('--ag-quota-fill', valid ? (remaining * 100) + '%' : '0%');
      node.dataset.level = !valid ? 'unknown' : remaining <= .2 ? 'high' : 'normal';
      node.setAttribute('aria-label', `${label}额度剩余 ${valid ? (remaining * 100).toFixed(1) + '%' : '未知'}`);
    }
  }

  function readUsage(entries) {
    if (!Array.isArray(entries)) return null;
    const latest = entries.findLast(entry => entry.metadata?.case === 'chatModel');
    const metadata = latest?.metadata?.value;
    if (!metadata) return null;
    const windowMetadata = metadata.chatStartMetadata?.contextWindowMetadata;
    const capacity = positive(windowMetadata?.maxContextTokens);
    const reported = positive(windowMetadata?.estimatedTokensUsed);
    if (reported !== null) return {used:reported, capacity};
    // Match the client's context inspector estimate, using the entire latest prompt
    // rather than summing tokens from multiple requests or only the visible steps.
    let used = 0, hasContent = false;
    const estimate = value => {
      if (!value) return;
      hasContent = true;
      used += Math.round(String(value).length / 3.5);
    };
    if (metadata.promptSections?.length) metadata.promptSections.forEach(section => estimate(section.content));
    else estimate(metadata.systemPrompt);
    for (const tool of metadata.tools || []) estimate(JSON.stringify(typeof tool.toJson === 'function' ? tool.toJson() : tool));
    for (const message of metadata.messagePrompts || []) {
      const tokens = positive(message.numTokens);
      if (tokens !== null) { used += tokens; hasContent = true; }
      else estimate((message.thinking || '') + (message.prompt || ''));
    }
    return {used:hasContent ? used : null, capacity};
  }

  function usageFor(record, bindings) {
    const {provider, service} = bindings;
    const state = provider?.getState();
    const slice = state?.trajectorySlice;
    const conversation = state?.conversationId || slice?.conversationId;
    // Paging to old turns must not replace the latest context and speed readout.
    const end = slice?.stepsSlice?.endIndexExclusive;
    const latestPage = !end || end >= slice?.totalStepsLength;
    const usage = latestPage ? readUsage(slice?.generatorMetadatasInSlice) : null;
    if (record.conversation !== conversation) {
      record.conversation = conversation;
      record.cachedUsage = null; record.requestKey = null; record.request = null; record.loading = false;
      record.speed = null; record.average = null; record.averageKey = null; record.nextRead = 0;
      record.stream = null; record.liveSpeed = null;
      record.history?.reset(conversation);
    }
    const wasLive = !!record.liveSpeed;
    record.liveSpeed = liveSpeed(record, state);
    if (wasLive && !record.liveSpeed && ![2,4].includes(state?.status)) { record.nextRead = 0; record.requestKey = null; }
    const lastResponse = slice?.stepsInSlice?.findLast(step => step.step?.case === 'plannerResponse');
    const speed = latestPage ? stepSpeed(lastResponse) || readSpeed(slice?.generatorMetadatasInSlice) : null;
    if (speed) record.speed = speed;
    const averageKey = [conversation, slice?.trajectoryId, slice?.totalGeneratorMetadataLength, slice?.totalStepsLength].join(':');
    const busy = [2,4].includes(state?.status);
    if (record.wasBusy && !busy) {
      record.nextRead = 0; record.requestKey = null;
      quota.nextRead = Math.min(quota.nextRead, Date.now() + 1000);
    }
    record.wasBusy = busy;
    if (usage?.used != null && usage?.capacity != null && speed && (busy || record.averageKey === averageKey) && (!record.history || record.history.hasIndex(conversation))) return usage;
    // PROD_UI omits prompt details. Use the same read-only FULL request as the
    // built-in inspector; keep aggregates and short navigation captions in memory.
    // Tool steps do not change model usage. During generation, read at most once
    // a minute; live speed comes from the subscribed state, not FULL history.
    const key = [conversation, slice?.trajectoryId, slice?.totalGeneratorMetadataLength, busy ? 'busy' : slice?.totalStepsLength, busy].join(':');
    if (conversation && service && !record.loading && record.requestKey !== key && Date.now() >= (record.nextRead || 0)) {
      const request = record.request = {};
      record.loading = true; record.requestKey = key; record.nextRead = Date.now() + (busy ? 60000 : 15000);
      readWithTimeout(() => service.getCascadeTrajectory({cascadeId:conversation, verbosity:3})).then(response => {
        if (record.request === request && record.conversation === conversation) {
          record.cachedUsage = readUsage(response?.trajectory?.generatorMetadata);
          record.speed = readSpeed(response?.trajectory?.generatorMetadata) || record.speed;
          // Recompute from one full snapshot, even while tools/retries are busy.
          // Never sum a visible page or add snapshots together: both double count history.
          record.average = averageSpeed(response?.trajectory?.generatorMetadata, response?.trajectory?.steps);
          record.averageKey = averageKey;
          record.history?.ingest(response?.trajectory?.steps, conversation);
        }
      }).catch(() => {
        if (record.request === request) { record.requestKey = null; record.nextRead = Date.now() + 30000; }
      }).finally(() => {
        if (record.request === request) record.loading = false;
        schedule();
      });
    }
    return record.cachedUsage || usage;
  }

  function close() {
    if (!opened) return;
    opened.panel.hidden = true;
    opened.button.setAttribute('aria-expanded', 'false');
    opened = null;
  }
  function position(record) {
    const bounds = record.button.getBoundingClientRect();
    const panel = record.panel;
    panel.style.left = Math.max(8, Math.min(innerWidth - panel.offsetWidth - 8, bounds.left)) + 'px';
    panel.style.top = Math.max(8, bounds.top - panel.offsetHeight - 10) + 'px';
  }
  function render(record) {
    let usage, bindings;
    try {
      bindings = findBindings(record.trigger);
      if (record.provider !== bindings.provider) {
        record.subscription?.dispose();
        record.provider = bindings.provider;
        record.subscription = bindings.provider?.onDidChange?.(schedule);
      }
      usage = usageFor(record, bindings);
    } catch { usage = null; }
    if (bindings) { prepareComposer(record, bindings); renderMetrics(record, bindings); record.history?.update(bindings); }
    const used = usage?.used, capacity = usage?.capacity;
    const available = used != null && capacity != null;
    const percent = available ? used / capacity * 100 : null;
    const label = available ? `上下文窗口：约已用 ${Math.round(percent)}%，上次请求` : '上下文窗口：暂无完整用量数据';
    record.button.setAttribute('aria-label', label);
    record.button.style.setProperty('--ag-context-fill', available ? Math.min(100, percent) + '%' : '0%');
    record.button.dataset.level = !available ? 'unknown' : percent >= 90 ? 'high' : percent >= 75 ? 'medium' : 'normal';
    const compact = value => value >= 1000 ? Math.round(value / 1000) + 'k' : number(value);
    const summary = available ? `${Math.round(percent)}% 已用` : '暂无数据';
    const count = used != null && capacity != null ? `已用 ${compact(used)} 标记，共 ${compact(capacity)}` : '等待用量数据';
    const signature = [summary, count].join('\n');
    if (record.signature !== signature) {
      record.summary.textContent = summary;
      record.count.textContent = count;
      record.signature = signature;
    }
    if (opened === record) position(record);
  }
  function create(trigger) {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'ag-context-meter';
    button.setAttribute('aria-expanded', 'false');
    button.setAttribute('aria-haspopup', 'dialog');
    button.setAttribute('data-no-scroll-jump', '');
    const ring = document.createElement('span');
    ring.className = 'ag-context-ring';
    ring.setAttribute('aria-hidden', 'true');
    button.append(ring);
    const panel = document.createElement('div');
    panel.className = 'ag-context-panel';
    panel.hidden = true;
    panel.setAttribute('role', 'dialog');
    panel.setAttribute('aria-label', '上下文窗口');
    const title = document.createElement('strong');
    title.textContent = '背景信息窗口：';
    const summary = document.createElement('div'), count = document.createElement('div');
    count.className = 'ag-context-count';
    panel.append(title, summary, count);
    document.body.append(panel);
    const record = {trigger, button, panel, summary, count};
    record.history = typeof createHistoryNavigation === 'function' ? createHistoryNavigation(trigger) : null;
    button.addEventListener('click', event => {
      event.stopPropagation();
      if (opened === record) { close(); return; }
      close(); opened = record;
      panel.hidden = false;
      button.setAttribute('aria-expanded', 'true');
      render(record);
    });
    records.set(trigger, record);
    return record;
  }
  function scan() {
    pending = false;
    for (const [trigger, record] of records) if (!trigger.isConnected) {
      record.request = null;
      if (opened === record) close();
      record.subscription?.dispose();
      record.history?.dispose();
      record.button.remove(); record.panel.remove(); record.strip?.remove(); record.permissionFallback?.remove(); records.delete(trigger);
    }
    document.querySelectorAll('[data-testid="model-selector-trigger"]').forEach(trigger => {
      const record = records.get(trigger) || create(trigger);
      trigger.parentElement.classList.add('ag-context-model-row');
      if (trigger.previousElementSibling !== record.button) trigger.before(record.button);
      render(record);
    });
  }
  function schedule() {
    if (!pending) { pending = true; setTimeout(scan, 16); }
  }
  document.addEventListener('pointerdown', event => {
    if (opened && !opened.panel.contains(event.target) && !opened.button.contains(event.target)) close();
  }, true);
  document.addEventListener('keydown', event => {
    if (event.key === 'Escape' && opened) { const button = opened.button; close(); button.focus({preventScroll:true}); }
  });
  window.addEventListener('resize', () => { if (opened) position(opened); });
  const ownUI = '.ag-usage-strip, .ag-context-panel, .ag-history-rail, .ag-history-preview';
  new MutationObserver(mutations => {
    if (mutations.some(m => !(m.target.nodeType === 1 ? m.target : m.target.parentElement)?.closest(ownUI))) schedule();
  }).observe(document.body, {childList:true, subtree:true});
  document.addEventListener('visibilitychange', () => {
    if (!document.hidden) { quota.nextRead = 0; schedule(); }
  });
  setInterval(() => { if (!document.hidden) schedule(); }, 500);
  scan();
}
