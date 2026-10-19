'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { readArchive } = require('./build_localized');
const { mergeRules } = require('./patch_title_generator');
const archive = readArchive(path.join(__dirname, 'app_localized.asar'));
let source = archive.get('dist/preload.js').toString();
source = source.slice(source.indexOf('(function () {'));
const end = source.lastIndexOf('})();');
source = source.slice(0, end) + 'globalThis.testAPI = { translateText, translateNode, translateElement };\n' + source.slice(end);
const context = { Node: {ELEMENT_NODE:1,TEXT_NODE:3}, document:{readyState:'loading',addEventListener(){}}, console };
vm.runInNewContext(source, context);
const api = context.testAPI;
let checks = 0;
function equal(actual, expected) { assert.equal(actual, expected); checks++; }
function element(tag='DIV', attrs={}, parent=null) {
  const el = {nodeType:1,tagName:tag,attrs,parentElement:parent,children:[],classList:{contains:c=>(attrs.class||'').split(' ').includes(c)},
    getAttribute:k=>attrs[k]??null,setAttribute:(k,v)=>{attrs[k]=v;},
    closest(selector) {
      for(let n=this;n;n=n.parentElement) for(const s of selector.split(',').map(s=>s.trim())) {
        if (s.startsWith('.')) { if(n.classList.contains(s.slice(1))) return n; }
        else if(s.startsWith('[')) { const m=s.match(/^\[([^=]+)="([^"]+)"\]$/); if(m&&n.getAttribute(m[1])===m[2]) return n; }
        else if(n.tagName.toLowerCase()===s) return n;
      }
      return null;
    }
  };
  Object.defineProperty(el,'firstChild',{get:()=>el.children[0]||null});
  Object.defineProperty(el,'textContent',{get:()=>el.children.map(n=>n.nodeValue??n.textContent).join('')});
  if(parent) append(parent,el);
  return el;
}
function append(parent,child) { const prev=parent.children.at(-1);if(prev)prev.nextSibling=child;parent.children.push(child);return child; }
function text(value,parent) {return append(parent,{nodeType:3,nodeValue:value,parentElement:parent,nextSibling:null});}
for(const [en,zh] of Object.entries({'Conversation Name':'会话名称','Conversation ID':'会话 ID','Project Name':'项目名称','Split':'拆分视图','Split Right':'向右拆分','Thinking...':'正在思考……','Thought for 15s':'思考耗时 15 秒','Thinking for 12s':'思考耗时 12 秒','Worked for 1h 2m 3s':'用时 1 小时 2 分 3 秒','16d':'16天前','  conversation   name  ':'  会话名称  ','Search skills…':'搜索技能……'})) equal(api.translateText(en),zh);
equal(api.translateText('Inherit Global'),'继承全局设置');
equal(api.translateText('Show 2 breakdowns'),'展开 2 项明细');
equal(api.translateText('Hide 2 breakdowns'),'收起 2 项明细');
const settings = element('DIV',{role:'dialog'});
const tokenCount=text('918 / 20,000 tokens (4.6%)',element('SPAN',{},settings));api.translateNode(tokenCount);equal(tokenCount.nodeValue,'918 / 20,000 标记 (4.6%)');
const skillName = text('generative_ui',element('SPAN',{'data-tooltip-id':':sample:-name'},settings));
api.translateNode(skillName);equal(skillName.nodeValue,'交互界面生成');
const codeName=text('generative_ui',element('CODE',{},settings));api.translateNode(codeName);equal(codeName.nodeValue,'generative_ui');
const sourcePreview=text('# Global Agent Rules\nKeep original source.',element('DIV',{class:'line-clamp-2'},settings));
api.translateNode(sourcePreview);equal(sourcePreview.nodeValue,'# 全局智能体规则\nKeep original source.');
const outsidePreview=text('# Global Agent Rules\nKeep original source.',element('DIV',{class:'line-clamp-2'}));
api.translateNode(outsidePreview);equal(outsidePreview.nodeValue,'# Global Agent Rules\nKeep original source.');
equal(api.translateText('Turbo mode'),'完全访问模式');
equal(api.translateText('Learn more about Turbo Mode'),'了解完全访问模式');
equal(api.translateText('C:\\Work\\Split.js'),'C:\\Work\\Split.js');
equal(api.translateText('const name = "Conversation Name";'),'const name = "Conversation Name";');
equal(api.translateText('Gemini 3.8 Flash'),'Gemini 3.8 Flash');
equal(api.translateText('Select project, current: No Project'),'选择项目，当前：无项目');
for(const container of [element('PRE'),element('DIV',{class:'monaco-editor'}),element('DIV',{contenteditable:'true'}),element('DIV',{class:'xterm'}),element('DIV',{translate:'no'})]) {
  const span=element('SPAN',{},container), node=text('Split',span);
  api.translateNode(container);equal(node.nodeValue,'Split');
  api.translateNode(node);equal(node.nodeValue,'Split');
}
equal(api.translateText('User cancelled agent execution.'),'用户已取消执行。');
const toolLabel=element('BUTTON',{'data-testid':'tool-group-collapsible'}), toolText=text('Ran Get-Content "$env:APPDATA"',element('SPAN',{},toolLabel));
api.translateNode(toolLabel);equal(toolText.nodeValue,'已运行 Get-Content "$env:APPDATA"');
const prose=text('Ran Get-Content',element('DIV'));api.translateNode(prose);equal(prose.nodeValue,'Ran Get-Content');
const menu=element('DIV',{role:'menu'}),label=text('Conversation Name',menu);
api.translateNode(menu);equal(label.nodeValue,'会话名称');
label.nodeValue='Project Name';api.translateNode(label);equal(label.nodeValue,'项目名称');
const button=element('BUTTON',{'title':'Conversation Name','aria-label':'Split','placeholder':'Search skills…'});
api.translateElement(button);equal(button.attrs.title,'会话名称');equal(button.attrs['aria-label'],'拆分视图');equal(button.attrs.placeholder,'搜索技能……');
button.attrs.title='Project Name';api.translateElement(button);equal(button.attrs.title,'项目名称');
const timer=element('BUTTON',{'data-testid':'thinking-collapsible-trigger'}),span=element('SPAN',{},timer);
text('Thinking for ',span);const number=text('12',span);text('s',span);api.translateNode(timer);equal(timer.textContent,'已思考 12 秒');
number.nodeValue='13';api.translateNode(number);equal(timer.textContent,'已思考 13 秒');
const instruction=element('SPAN');text('Type',instruction);text(' ',instruction);text('/',element('CODE',{},instruction));text(' ',instruction);text('and select',instruction);text(' ',instruction);text('plan',element('CODE',{},instruction));text(' ',instruction);text('to have the agent generate a plan.',instruction);
api.translateNode(instruction);equal(instruction.textContent,'输入 / 并选择 plan 让智能体生成计划。');
const before='# My Rules\n\n## Important\nDo not delete my files.\n';
const merged=mergeRules(before);equal(merged.startsWith(before),true);equal(mergeRules(merged),merged);
const legacy='# Global Agent Rules\n\n## 语言偏好、思考链与会话命名规范 (Language, Thinking Process & Naming)\n- old instruction\n\n## Windows / PowerShell\nKEEP EXACTLY\n';
const migrated=mergeRules(legacy);equal(migrated.endsWith('## Windows / PowerShell\nKEEP EXACTLY\n'),true);equal(migrated.includes('old instruction'),false);equal(mergeRules(migrated),migrated);
assert.throws(()=>mergeRules('<!-- antigravity-zh-display:start -->'));checks++;
for (const [mode, label] of [['default','默认权限'],['turbo','完全访问'],['request_review','逐次确认']]) {
  const option=element('BUTTON',{'data-testid':'permissions-preset-option-'+mode});
  const value=text({default:'Default',turbo:'Turbo',request_review:'Request Review'}[mode],element('SPAN',{},option));
  api.translateNode(option);equal(value.nodeValue,label);
}
const permissions=element('BUTTON',{'data-testid':'permissions-selector-trigger','aria-label':'Agent permissions preset selector, current: Turbo'});
api.translateElement(permissions);equal(permissions.attrs['aria-label'],'权限设置，当前：完全访问');
console.log(`PASS ${checks} assertions: UI terms, dynamic timer, attributes, protected code/editor, preserved and idempotent rules.`);
