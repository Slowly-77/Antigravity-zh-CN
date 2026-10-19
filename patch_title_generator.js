'use strict';
// Keep this filename for existing launchers; do not rename chats or patch executables.
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const START = '<!-- antigravity-zh-display:start -->';
const END = '<!-- antigravity-zh-display:end -->';
const RULES = `${START}
## 中文显示与交流偏好
- 默认使用简体中文回复；用户明确要求其他语言时遵从用户要求。
- 展示给用户的思考摘要、思考过程说明、进度说明、计划、任务清单、工具调用意图与结果摘要，均使用自然的简体中文，包括这些内容的小标题。避免仅正文中文、思考摘要和小标题仍为英文。
- 此规则只规定可见内容的语言，不要求披露隐藏的内部推理。若模型仅提供简短思考摘要，则用中文展示该摘要。
- 自动生成的新会话标题优先用简洁中文；不改写用户已有的标题。
- 代码、命令、文件路径、网址、变量名、错误原文、品牌名和必要的技术标识保持原样，必要时另加中文解释。
${END}`;
function mergeRules(existing) {
  if (existing.includes(START) !== existing.includes(END)) throw Error('中文规则标记不完整，请检查 AGENTS.md');
  const managed = new RegExp(START + '[\\s\\S]*?' + END);
  if (managed.test(existing)) return existing.replace(managed, () => RULES);
  const legacy = /^## 语言偏好、思考链与会话命名规范 \(Language, Thinking Process & Naming\)\r?\n[\s\S]*?(?=^## |$(?![\s\S]))/m;
  if (legacy.test(existing)) return existing.replace(legacy, () => RULES + '\n\n');
  return existing + (existing && !existing.endsWith('\n') ? '\n' : '') + '\n' + RULES + '\n';
}
function applyRules(file = path.join(process.env.USERPROFILE, '.gemini/config/AGENTS.md')) {
  const existing = fs.existsSync(file) ? fs.readFileSync(file, 'utf8') : '';
  const next = mergeRules(existing);
  if (next === existing) return console.log('中文显示规则已存在，无需重复写入。');
  fs.mkdirSync(path.dirname(file), { recursive: true });
  if (existing) {
    const hash = crypto.createHash('sha256').update(existing).digest('hex').slice(0, 12);
    const backup = file + '.pre-zh-display-' + hash + '.bak';
    if (!fs.existsSync(backup)) fs.copyFileSync(file, backup);
  }
  fs.writeFileSync(file, next, 'utf8');
  console.log('已更新中文思考摘要与交流规则，其他规则保留。');
}
if (require.main === module) applyRules();
module.exports = { mergeRules, applyRules, START, END };
