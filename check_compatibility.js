'use strict';
const fs = require('fs');
const path = require('path');

// Inspect the running renderer without sending prompts or changing application state.
function inspectRenderer() {
  const trigger = document.querySelector('[data-testid="model-selector-trigger"]');
  let fiber = trigger?.[Object.keys(trigger).find(key => key.startsWith('__reactFiber$'))];
  let provider, service;
  for (let depth = 0; fiber && depth < 320; depth++, fiber = fiber.return) {
    const props = fiber.memoizedProps;
    const context = props?.cascadeContext || props?.value?.cascadeContext;
    provider ||= context?.state?.agentStateProvider;
    if (typeof props?.value?.getCascadeTrajectory === 'function') service ||= props.value;
  }
  const state = provider?.getState?.();
  const box = trigger?.closest('[data-testid="agent-input-box"]');
  const checks = {
    composer: !!box,
    editor: !!box?.querySelector('[contenteditable="true"]'),
    modelSelector: !!trigger,
    state: typeof provider?.getState === 'function',
    historyPaging: !state?.conversationId || typeof provider?.requestPageUpdate === 'function',
    trajectory: typeof service?.getCascadeTrajectory === 'function',
    quota: typeof service?.retrieveUserQuotaSummary === 'function',
    permissions: !!box?.querySelector('[data-testid="permissions-selector-trigger"]'),
    conversation: !state?.conversationId || !!document.querySelector('[data-testid="autoscroll-viewport"]')
  };
  return {page: {blank: !document.body?.textContent?.trim() && !document.querySelector('[data-testid]'), ready: document.readyState}, checks, deferred:state?.conversationId ? [] : ['historyPaging','conversationLayout'], busy: [2,4].includes(state?.status), installed: !!document.querySelector('.ag-usage-strip')};
}

function validate(result, installed = false) {
  if (result?.page?.blank) throw Error('客户端聊天页面尚未加载（空白页），不是已确认的接口不兼容；请检查客户端启动或本机页面连接');
  const missing = ['composer','editor','modelSelector','state','historyPaging','trajectory','quota','permissions','conversation'].filter(key => result?.checks?.[key] !== true);
  if (!result?.checks || missing.length) throw Error('界面接口不兼容或页面尚未就绪：' + missing.join(', '));
  if (result.busy) throw Error('客户端正在执行任务，请等任务结束后再运行一键汉化。');
  if (installed && !result.installed) throw Error('重启后的页面尚未加载补丁');
  return result;
}

function selectResult(results) {
  const valid = results.filter(Boolean);
  const best = valid.sort((a,b) => Object.values(b.checks || {}).filter(Boolean).length - Object.values(a.checks || {}).filter(Boolean).length)[0];
  if (!best) throw Error('本机客户端页面尚未就绪');
  return {...best, busy:valid.some(result => result.busy)};
}

async function inspect() {
  const port = fs.readFileSync(path.join(process.env.APPDATA,'Antigravity/DevToolsActivePort'),'utf8').split('\n')[0].trim();
  if (!/^\d+$/.test(port)) throw Error('调试端口无效');
  const tabs = await (await fetch('http://127.0.0.1:' + port + '/json/list', {signal:AbortSignal.timeout(3000)})).json();
  const targets = tabs.filter(t => t.type === 'page' && /^https:\/\/127\.0\.0\.1:/.test(t.url) && /^ws:\/\/127\.0\.0\.1:\d+\//.test(t.webSocketDebuggerUrl));
  if (!targets.length) throw Error('本机客户端页面尚未就绪');
  const results = await Promise.allSettled(targets.map(inspectTarget));
  return selectResult(results.filter(r => r.status === 'fulfilled').map(r => r.value));
}

function inspectTarget(target) {
  return new Promise((resolve,reject) => {
    const socket = new WebSocket(target.webSocketDebuggerUrl);
    const timer = setTimeout(() => finish(Error('读取界面超时')),3000);
    let done = false;
    function finish(error,value) { if(done)return;done=true;clearTimeout(timer);socket.close();error?reject(error):resolve(value); }
    socket.onopen = () => socket.send(JSON.stringify({id:1,method:'Runtime.evaluate',params:{expression:'('+inspectRenderer.toString()+')()',returnByValue:true}}));
    socket.onerror = () => finish(Error('无法连接客户端检查端口'));
    socket.onmessage = event => {
      const message = JSON.parse(event.data);
      if (message.id !== 1) return;
      const value = message.result?.result?.value;
      finish(value ? null : Error('无法读取界面接口'),value);
    };
  });
}

async function main() {
  const deadline = Date.now() + 60000;
  let error;
  do {
    try { const result = validate(await inspect(), process.argv.includes('--installed')); console.log(JSON.stringify(result)); return; }
    catch(e) { error=e; if(e.message.includes('正在执行'))break; }
    await new Promise(resolve=>setTimeout(resolve,500));
  } while(Date.now()<deadline);
  throw Error(error.message + '。已等待 60 秒；请确认聊天页面能正常打开。');
}
if(require.main===module) main().catch(error=>{console.error(error.message);process.exitCode=1;});
module.exports={inspectRenderer,validate,selectResult};
