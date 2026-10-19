function installHistoryNavigation(trigger) {
  let conversation, indexed = false, entries = new Map(), buttons = new Map();
  let viewport = null, bindings = null, pending = null, frame = 0, disposed = false;
  const rail = document.createElement('nav');
  rail.className = 'ag-history-rail'; rail.hidden = true;
  rail.setAttribute('aria-label', '历史消息定位');
  const preview = document.createElement('div');
  preview.className = 'ag-history-preview'; preview.hidden = true;
  preview.setAttribute('role', 'tooltip');
  document.body.append(rail, preview);

  function reset(id) {
    conversation = id; indexed = false; entries.clear(); buttons.clear(); pending = null;
    rail.replaceChildren(); rail.removeAttribute('aria-busy'); rail.hidden = true; preview.hidden = true;
  }
  function ingest(steps, id, offset = 0, complete = true) {
    if (id !== conversation || !Array.isArray(steps)) return;
    if (complete) { entries.clear(); indexed = true; }
    steps.forEach((step, position) => {
      if (step.step?.case !== 'userInput') return;
      const index = step.metadata?.sourceTrajectoryStepInfo?.stepIndex ?? offset + position;
      const value = step.step.value;
      const text = value.query || value.items?.filter(item => item.chunk?.case === 'text').map(item => item.chunk.value).join(' ') || '';
      entries.set(index, {index, text:String(text).replace(/\s+/g, ' ').trim().slice(0, 140) || (value.media?.length ? '图片或文件' : '提问')});
    });
  }
  function nodes() {
    const result = new Map();
    for (const node of viewport?.querySelectorAll('[data-testid="user-input-step"]') || []) {
      let fiber = node[Object.keys(node).find(key => key.startsWith('__reactFiber$'))];
      for (let depth = 0; fiber && depth < 24; depth++, fiber = fiber.return) {
        const props = fiber.memoizedProps;
        const index = props?.userStepIndex ?? props?.userStep?.metadata?.sourceTrajectoryStepInfo?.stepIndex;
        if (Number.isInteger(index)) { result.set(index, node); break; }
      }
    }
    return result;
  }
  function showPreview(button, text) {
    preview.textContent = text; preview.hidden = false;
    const r = button.getBoundingClientRect();
    preview.style.left = Math.min(innerWidth - preview.offsetWidth - 8, r.right + 8) + 'px';
    preview.style.top = Math.max(8, Math.min(innerHeight - preview.offsetHeight - 8, r.top - 8)) + 'px';
  }
  function failJump() {
    pending = null; rail.removeAttribute('aria-busy');
    const button = rail.querySelector(':focus') || rail.firstElementChild;
    if (button) showPreview(button, '暂时无法定位，请重试');
  }
  function advanceJump() {
    const job = pending;
    if (!job || job.conversation !== conversation) return;
    const node = nodes().get(job.index);
    if (!node) { if (Date.now() > job.deadline) failJump(); return; }
    // The native resize follower may run after page replacement. Hold the target
    // for a few layout frames, then relinquish scrolling to the user immediately.
    const settle = () => {
      if (pending !== job || !viewport) return;
      if (!node.isConnected) { job.frames = 0; schedule(); return; }
      viewport.scrollTo({top:viewport.scrollTop + node.getBoundingClientRect().top - viewport.getBoundingClientRect().top - 24, behavior:'instant'});
      if (++job.frames < 6) requestAnimationFrame(settle);
      else { pending = null; rail.removeAttribute('aria-busy'); schedule(); }
    };
    if (!job.frames) { job.frames = 1; settle(); }
  }
  async function jump(index) {
    if (!viewport || !bindings?.provider) return;
    preview.hidden = true;
    const job = {index, conversation, deadline:Date.now() + 8000, frames:0};
    pending = job; rail.setAttribute('aria-busy', 'true');
    if (nodes().has(index)) { advanceJump(); return; }
    try {
      const total = bindings.provider.getState()?.trajectorySlice?.totalStepsLength;
      if (typeof bindings.provider.requestPageUpdate !== 'function' || !Number.isFinite(total)) throw Error('Page loading unavailable');
      await bindings.provider.requestPageUpdate({$typeName:'exa.jetski_cortex_pb.Slice', startIndex:Math.max(0,index - 12), endIndexExclusive:Math.min(total,index + 80)});
      if (pending === job) schedule();
    } catch { if (pending === job) failJump(); }
  }
  function schedule() {
    if (!disposed && !frame) frame = requestAnimationFrame(() => { frame = 0; paint(); });
  }
  function paint() {
    if (!viewport?.isConnected || !trigger.isConnected) { rail.hidden = true; return; }
    const ordered = Array.from(entries.values()).sort((a,b) => a.index - b.index);
    rail.hidden = ordered.length < 2;
    if (rail.hidden) return;
    const bounds = viewport.getBoundingClientRect();
    const height = Math.min(ordered.length * 12, bounds.height * .7, 560);
    const narrow = bounds.width < 900;
    rail.style.width = (narrow ? 16 : 28) + 'px';
    rail.style.left = Math.max(4, bounds.left + (narrow ? 2 : 12)) + 'px';
    rail.style.top = bounds.top + (bounds.height - height) / 2 + 'px';
    rail.style.height = height + 'px';
    const rendered = nodes();
    let active, previousTop = -Infinity, firstIndex, firstTop = Infinity;
    for (const [index, node] of rendered) {
      const top = node.getBoundingClientRect().top - bounds.top - 24;
      if (top < firstTop) { firstTop = top; firstIndex = index; }
      if (top <= 1 && top > previousTop) { previousTop = top; active = index; }
    }
    active ??= firstIndex;
    for (const [index, button] of buttons) if (!entries.has(index)) { button.remove(); buttons.delete(index); }
    ordered.forEach((entry, position) => {
      let button = buttons.get(entry.index);
      if (!button) {
        button = document.createElement('button'); button.type = 'button';
        button.dataset.stepIndex = entry.index;
        button.addEventListener('click', () => jump(entry.index));
        button.addEventListener('pointerenter', () => showPreview(button, entries.get(entry.index)?.text || '提问'));
        button.addEventListener('pointerleave', () => { preview.hidden = true; });
        button.addEventListener('focus', () => showPreview(button, entries.get(entry.index)?.text || '提问'));
        button.addEventListener('blur', () => { preview.hidden = true; });
        button.addEventListener('keydown', event => {
          const list = Array.from(rail.children), n = list.indexOf(button);
          const next = event.key === 'ArrowDown' ? n + 1 : event.key === 'ArrowUp' ? n - 1 : event.key === 'Home' ? 0 : event.key === 'End' ? list.length - 1 : null;
          if (next !== null) { event.preventDefault(); list[Math.max(0,Math.min(list.length-1,next))]?.focus({preventScroll:true}); }
          if (event.key === 'Escape') { preview.hidden = true; trigger.focus({preventScroll:true}); }
        });
        buttons.set(entry.index, button);
      }
      button.setAttribute('aria-label', `第 ${position + 1} 条提问：${entry.text}`);
      if (entry.index === active) button.setAttribute('aria-current', 'true'); else button.removeAttribute('aria-current');
      if (rail.children[position] !== button) rail.insertBefore(button, rail.children[position] || null);
    });
    advanceJump();
  }
  function cancelJump(event) {
    if (rail.contains(event.target)) return;
    pending = null; rail.removeAttribute('aria-busy'); preview.hidden = true;
  }
  for (const type of ['wheel','touchstart','pointerdown','keydown']) window.addEventListener(type, cancelJump, {capture:true,passive:true});
  window.addEventListener('resize', schedule, {passive:true});
  return {
    reset, ingest,
    hasIndex: id => !viewport || (indexed && id === conversation),
    update(next) {
      bindings = next;
      let page = trigger.parentElement, candidate;
      while (page && !(candidate = page.querySelector('[data-testid="autoscroll-viewport"]'))) page = page.parentElement;
      if (candidate !== viewport) {
        viewport?.removeEventListener('scroll', schedule); viewport = candidate;
        viewport?.addEventListener('scroll', schedule, {passive:true});
      }
      const state = next.provider?.getState(), slice = state?.trajectorySlice;
      const id = state?.conversationId || slice?.conversationId;
      if (id !== conversation) reset(id);
      const start = slice?.stepsSlice?.startIndex || 0;
      ingest(slice?.stepsInSlice, id, start < 0 ? Math.max(0,(slice.totalStepsLength || 0) + start) : start, false);
      paint();
    },
    dispose() {
      disposed = true; pending = null; cancelAnimationFrame(frame);
      viewport?.removeEventListener('scroll', schedule); window.removeEventListener('resize', schedule);
      for (const type of ['wheel','touchstart','pointerdown','keydown']) window.removeEventListener(type, cancelJump, true);
      rail.remove(); preview.remove(); entries.clear(); buttons.clear();
    }
  };
}
