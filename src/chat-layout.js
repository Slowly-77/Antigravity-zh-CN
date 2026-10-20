function installChatLayout() {
  const selector = '[data-testid="user-input-step"]';
  const messages = new Map();
  let pending = false;
  let nextId = 0;
  let releaseScrollAnchor = () => {};
  const addClass = (node, value) => { if (!node.classList.contains(value)) node.classList.add(value); };
  const setAttr = (node, name, value) => { if (node.getAttribute(name) !== value) node.setAttribute(name, value); };
  const resize = new ResizeObserver(() => schedule());

  function preserveMessagePosition(step) {
    releaseScrollAnchor();
    let viewport = step.parentElement;
    while (viewport && !/auto|scroll/.test(getComputedStyle(viewport).overflowY)) viewport = viewport.parentElement;
    viewport ||= document.scrollingElement;
    if (!viewport) return () => {};
    const viewportTop = viewport === document.scrollingElement ? 0 : viewport.getBoundingClientRect().top + viewport.clientTop;
    const targetTop = Math.max(viewportTop + 16, step.getBoundingClientRect().top);
    const oldAnchor = viewport.style.getPropertyValue('overflow-anchor');
    const oldPriority = viewport.style.getPropertyPriority('overflow-anchor');
    viewport.style.setProperty('overflow-anchor', 'none', 'important');
    let active = true, frame = 0, remaining = 6;
    const stop = () => {
      if (!active) return;
      active = false;
      cancelAnimationFrame(frame);
      if (oldAnchor) viewport.style.setProperty('overflow-anchor', oldAnchor, oldPriority);
      else viewport.style.removeProperty('overflow-anchor');
      for (const type of ['wheel', 'touchstart', 'pointerdown', 'keydown']) window.removeEventListener(type, stop, true);
    };
    releaseScrollAnchor = stop;
    for (const type of ['wheel', 'touchstart', 'pointerdown', 'keydown']) window.addEventListener(type, stop, {capture:true, passive:true});
    // The app's ResizeObserver can follow the bottom after the height change.
    // Restore this message through those layout frames, then release immediately.
    const restore = () => {
      if (!active || !step.isConnected) { stop(); return; }
      const delta = step.getBoundingClientRect().top - targetTop;
      if (Math.abs(delta) > 1) viewport.scrollTo({top:viewport.scrollTop + delta, behavior:'instant'});
      if (--remaining > 0) frame = requestAnimationFrame(restore);
      else stop();
    };
    return restore;
  }

  function update(record) {
    const { step, content, button, foldContent } = record;
    const limit = parseFloat(getComputedStyle(step).getPropertyValue('--ag-collapsed-height')) || 224;
    const long = !record.mediaOnly && foldContent.scrollHeight > limit + 2;
    if (!foldContent.id) foldContent.id = 'ag-message-content-' + (++nextId);
    setAttr(button, 'aria-controls', foldContent.id);
    setAttr(step, 'data-ag-long', String(long));
    setAttr(step, 'data-ag-expanded', String(record.expanded));
    button.hidden = !long;
    const label = record.expanded ? '收起' : '展开全文';
    if (button.textContent !== label) button.textContent = label;
    setAttr(button, 'aria-expanded', String(record.expanded));
    setAttr(button, 'aria-label', record.expanded ? '收起长消息' : '展开长消息全文');
    // React can change its own scroll mode; the visible state belongs to this toggle.
    if (content.scrollTop) content.scrollTop = 0;
    if (foldContent.scrollTop) foldContent.scrollTop = 0;
  }

  function prepare(step) {
    const candidates = Array.from(step.querySelectorAll('.bg-card'));
    const card = candidates.find(node => Array.from(node.children).some(child =>
      child.classList.contains('flex-1') && (/max-h-\[/.test(child.className) || child.classList.contains('ag-message-content'))));
    if (!card) return;
    const content = Array.from(card.children).find(child => child.classList.contains('flex-1'));
    if (!content) return;
    const actions = Array.from(card.children).find(child => child.classList.contains('user-input-buttons-container'));
    addClass(step, 'ag-message-layout');
    addClass(card, 'ag-message-card');
    addClass(content, 'ag-message-content');
    const media = Array.from(content.children).find(child => child.classList.contains('flex-wrap') && child.querySelector('img, video'));
    const messageText = Array.from(content.children).find(child => child.classList.contains('whitespace-pre-wrap'));
    const separated = !!media;
    if (content.classList.contains('ag-message-separated') !== separated) content.classList.toggle('ag-message-separated', separated);
    if (separated) {
      addClass(media, 'ag-message-media');
      if (messageText) addClass(messageText, 'ag-message-text');
      setAttr(step, 'data-ag-has-text', String(!!messageText?.textContent.trim()));
    } else if (messageText?.classList.contains('ag-message-text')) {
      messageText.classList.remove('ag-message-text');
    }
    const foldContent = separated && messageText ? messageText : content;
    if (card.parentElement.classList.contains('bg-card-border')) addClass(card.parentElement, 'ag-message-border');
    const article = step.closest('[role="article"]');
    if (article) addClass(article, 'ag-user-turn');
    if (actions) addClass(actions, 'ag-message-actions');
    const old = messages.get(step);
    if (old && old.content === content && old.button.parentElement === card) {
      if (actions) addClass(actions, 'ag-message-actions');
      old.foldContent = foldContent;
      old.mediaOnly = separated && !messageText;
      update(old);
      return;
    }
    if (old) {
      resize.unobserve(old.content);
      old.content.removeEventListener('click', old.blockNativeClick, true);
      old.button.remove();
    }
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'ag-message-toggle';
    button.setAttribute('data-no-scroll-jump', '');
    if (!content.id) content.id = 'ag-message-content-' + (++nextId);
    button.setAttribute('aria-controls', content.id);
    const record = { step, content, foldContent, mediaOnly:separated && !messageText, button, expanded: old?.expanded ?? false };
    // Leave links, media and text selection intact; prevent the native click-to-expand
    // handler from switching to its nested scroller and jumping to the last line.
    record.blockNativeClick = event => {
      if (!event.target.closest('button, a, input, textarea, video, audio, [role="button"]')) event.stopPropagation();
    };
    content.addEventListener('click', record.blockNativeClick, true);
    button.addEventListener('click', event => {
      event.stopPropagation();
      const restorePosition = preserveMessagePosition(step);
      record.expanded = !record.expanded;
      update(record);
      restorePosition();
    });
    card.appendChild(button);
    messages.set(step, record);
    resize.observe(content);
    update(record);
  }

  function prepareAssistantLayout() {
    const box = document.querySelector('[data-testid="agent-input-box"]');
    if (box) addClass(box, 'ag-chat-composer');
    document.querySelectorAll('[data-turn-content="latest"]').forEach(turn => {
      const viewport = turn.closest('[data-testid="autoscroll-viewport"]');
      if (viewport) addClass(viewport, 'ag-chat-viewport');
    });
    document.querySelectorAll('[role="article"][data-quotable="true"]').forEach(article => {
      addClass(article, 'ag-assistant-turn');
      addClass(article.parentElement, 'ag-chat-turn');
      article.querySelectorAll('[data-testid="worked-for-collapsible"]').forEach(button => addClass(button.parentElement, 'ag-worked-section'));
      article.querySelectorAll('[data-testid="thinking-collapsible-trigger"]').forEach(button => {
        if (button.closest('.ag-worked-section')) return;
        const section = button.parentElement, segment = section.parentElement;
        if (Array.from(segment.children).some(node => node.matches('[data-testid="planner-response-text"]'))) {
          addClass(section, 'ag-worked-section');
          addClass(segment, 'ag-response-segment');
        }
      });
      // Only style response markdown, leaving tool panels and embedded editors intact.
      const bodies = new Set([...article.children, ...article.querySelectorAll('[data-testid="planner-response-text"]')]);
      for (const child of bodies) {
        if (!child.classList.contains('px-2') || !child.classList.contains('py-1')) continue;
        const markdown = Array.from(child.children).find(n => n.classList.contains('md-divider-spacing'));
        if (markdown) { addClass(child, 'ag-response-body'); addClass(markdown, 'ag-response-markdown'); }
      }
      const actions = article.nextElementSibling;
      if (actions?.classList.contains('pt-3')) addClass(actions, 'ag-assistant-actions');
      if (box) {
        let page = article.parentElement;
        while (page && !page.contains(box)) page = page.parentElement;
        if (page && page !== document.body && !page.querySelector('nav')) addClass(page, 'ag-chat-page');
      }
    });
  }

  function scan() {
    pending = false;
    for (const [step, record] of messages) if (!step.isConnected) {
      resize.unobserve(record.content);
      messages.delete(step);
    }
    document.querySelectorAll(selector).forEach(prepare);
    prepareAssistantLayout();
  }
  function schedule() {
    if (!pending) { pending = true; setTimeout(scan, 16); }
  }
  const observer = new MutationObserver(mutations => {
    if (mutations.some(m => {
      const element = m.target.nodeType === 1 ? m.target : m.target.parentElement;
      // Updating speed and quota must not rescan and measure the whole chat.
      if (element?.closest('.ag-usage-strip, .ag-context-panel, .ag-history-rail, .ag-history-preview')) return false;
      return m.type === 'childList' || m.target.parentElement?.closest(selector);
    })) schedule();
  });
  observer.observe(document.body, {childList:true, subtree:true, characterData:true, attributes:true, attributeFilter:['class','style']});
  window.addEventListener('resize', schedule, {passive:true});
  scan();
}
