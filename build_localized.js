'use strict';
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const vm = require('vm');
const root = __dirname;
const hash = data => crypto.createHash('sha256').update(data).digest('hex');

// Preserve upstream files and archive metadata; replace only explicit UI patches.
function readArchive(file) {
  const data = fs.readFileSync(file);
  if (data.length < 16 || data.readUInt32LE(12) > data.length - 16) throw Error('资源包头损坏');
  const header = JSON.parse(data.subarray(16, 16 + data.readUInt32LE(12)));
  const start = 8 + data.readUInt32LE(4);
  const entries = new Map();
  function walk(node, prefix = '') {
    for (const [name, value] of Object.entries(node.files || {})) {
      if (!name || name === '.' || name === '..' || /[\\/:]/.test(name)) throw Error('资源包包含异常路径');
      const key = prefix + name;
      if (value.files) walk(value, key + '/');
      else entries.set(key, value);
    }
  }
  walk(header);
  const get = name => {
    const entry = entries.get(name);
    if (!entry || entry.unpacked || entry.link) throw Error('Cannot read packed entry: ' + name);
    const offset = Number(entry.offset);
    if (!Number.isSafeInteger(offset) || offset < 0 || !Number.isSafeInteger(entry.size) || entry.size < 0 || start + offset + entry.size > data.length) throw Error('资源文件边界无效：' + name);
    return data.subarray(start + Number(entry.offset), start + Number(entry.offset) + entry.size);
  };
  return { data, header, entries, get };
}

const marker = '// Localization and chat layout extensions.';
const defaultTarget = () => path.join(process.env.LOCALAPPDATA, 'Programs/antigravity/resources/app.asar');
function build(baseFile = defaultTarget(), outputDir = root) {
  const base = readArchive(baseFile);
  const dictionary = JSON.parse(fs.readFileSync(path.join(root, 'src/dictionary.json'), 'utf8'));
  const rows = fs.readFileSync(path.join(root, 'src/additions.tsv'), 'utf8').trim().split(/\r?\n/);
  for (const row of rows) {
    const pair = row.split('\t');
    if (pair.length !== 2 || !pair[0] || !pair[1]) throw Error('Invalid dictionary row: ' + row);
    dictionary[pair[0]] = pair[1];
  }
  let source = fs.readFileSync(path.join(root, 'src/preload.template.js'), 'utf8');
  const boundary = source.indexOf(marker);
  if (boundary < 0 || source.indexOf(marker, boundary + 1) >= 0) throw Error('补丁边界不唯一');
  const compatibility = JSON.parse(fs.readFileSync(path.join(root, 'src/compatibility.json'), 'utf8'));
  const installedPreload = base.get('dist/preload.js').toString('utf8');
  const parts = installedPreload.split(marker);
  if (parts.length > 2 || (parts.length === 2 && !parts[1].includes('[Antigravity-i18n]'))) throw Error('已有补丁格式未知，未覆盖');
  const native = parts[0].trimEnd();
  if (!compatibility.nativePreloadSha256.includes(hash(Buffer.from(native)))) throw Error('新版原生 preload 接口发生变化，需要人工适配；未覆盖客户端。');
  source = native + '\n\n' + source.slice(boundary);
  if (source.split('/* DICTIONARY */ {}').length !== 2) throw Error('Dictionary marker missing or repeated');
  source = source.replace('/* DICTIONARY */ {}', () => JSON.stringify(dictionary, null, 2));
  const layoutCode = fs.readFileSync(path.join(root, 'src/chat-layout.js'), 'utf8');
  const layoutCss = fs.readFileSync(path.join(root, 'src/chat-layout.css'), 'utf8');
  source = source.replace('/* CHAT_LAYOUT_RUNTIME */', () => layoutCode);
  source = source.replace('/* CONTEXT_METER_RUNTIME */', () => fs.readFileSync(path.join(root, 'src/context-meter.js'), 'utf8'));
  source = source.replace('/* HISTORY_NAVIGATION_RUNTIME */', () => fs.readFileSync(path.join(root, 'src/history-navigation.js'), 'utf8'));
  source = source.replace('/* CHAT_LAYOUT_CSS */ ""', () => JSON.stringify(layoutCss));
  new vm.Script(source, { filename: 'preload.js' });
  const replacement = Buffer.from(source);
  const replacements = new Map([['dist/preload.js', replacement]]);
  const nativeText = {
    'dist/menu.js': [["label: 'New Window'", "label: '新建窗口'"], ["label: 'Docs'", "label: '文档'"], ["label: 'Connect to WSL'", "label: '连接到 WSL'"], ["label: 'Reopen Locally'", "label: '在本机重新打开'"]],
    'dist/updater.js': [['"Check for Updates"','"检查更新"'], ['"Checking for Updates..."','"正在检查更新……"'], ['"Downloading Update..."','"正在下载更新……"'], ['"Restart to Update"','"重启以更新"'], ["title: 'Check for Updates'","title: '检查更新'"], ["message: 'No updates available'","message: '当前已是最新版本'"]]
  };
  for (const [name, pairs] of Object.entries(nativeText)) {
    if (!base.entries.has(name) || base.entries.get(name).unpacked) continue;
    const before = base.get(name).toString('utf8');
    let after = before;
    for (const [english,chinese] of pairs) after = after.split(english).join(chinese);
    if (after !== before) { new vm.Script(after,{filename:name}); replacements.set(name,Buffer.from(after)); }
  }
  const chunks = [];
  let offset = 0;
  for (const [name, entry] of base.entries) {
    if (entry.unpacked || entry.link) continue;
    const bytes = replacements.get(name) || base.get(name);
    entry.offset = String(offset);
    entry.size = bytes.length;
    if (replacements.has(name) && entry.integrity) {
      if (entry.integrity.algorithm !== 'SHA256') throw Error('Unsupported archive integrity');
      const blockSize = entry.integrity.blockSize;
      if (!(blockSize > 0)) throw Error('Invalid integrity block size');
      entry.integrity.hash = hash(bytes);
      entry.integrity.blocks = [];
      for (let i = 0; i < bytes.length; i += blockSize) entry.integrity.blocks.push(hash(bytes.subarray(i, i + blockSize)));
    }
    chunks.push(bytes);
    offset += bytes.length;
  }
  const json = Buffer.from(JSON.stringify(base.header));
  const payloadLength = 4 + Math.ceil(json.length / 4) * 4;
  const pickle = Buffer.alloc(4 + payloadLength);
  pickle.writeUInt32LE(payloadLength, 0);
  pickle.writeUInt32LE(json.length, 4);
  json.copy(pickle, 8);
  const size = Buffer.alloc(8);
  size.writeUInt32LE(4, 0);
  size.writeUInt32LE(pickle.length, 4);
  const output = path.join(outputDir, 'app_localized.asar');
  const temp = output + '.building';
  fs.writeFileSync(temp, Buffer.concat([size, pickle, ...chunks]));
  const built = readArchive(temp);
  const original = readArchive(baseFile);
  let unchanged = 0, unpacked = 0;
  for (const [name, entry] of original.entries) {
    const target = built.entries.get(name);
    if (!target) throw Error('Archive entry lost: ' + name);
    if (entry.unpacked || entry.link) {
      if (JSON.stringify(entry) !== JSON.stringify(target)) throw Error('Unpacked metadata changed: ' + name);
      unpacked++;
    } else if (!replacements.has(name)) {
      if (!original.get(name).equals(built.get(name))) throw Error('Unexpected file change: ' + name);
      unchanged++;
    }
  }
  if (!built.get('dist/preload.js').equals(replacement)) throw Error('Preload verification failed');
  for (const [name, bytes] of replacements) if (!built.get(name).equals(bytes)) throw Error('补丁文件校验失败：' + name);
  fs.renameSync(temp, output);
  const manifest = {
    version: JSON.parse(original.get('package.json')).version,
    sha256: hash(fs.readFileSync(output)),
    baseSha256: hash(original.data),
    nativePreloadSha256: hash(Buffer.from(native)),
    replacesExistingPatch: parts.length === 2,
    dictionaryEntries: Object.keys(dictionary).length,
    addedOrUpdatedEntries: rows.length,
    changedFiles: Array.from(replacements.keys()), unchangedPackedFiles: unchanged, preservedUnpackedEntries: unpacked
  };
  fs.writeFileSync(path.join(outputDir, 'build-manifest.json'), JSON.stringify(manifest, null, 2) + '\n');
  console.log(JSON.stringify(manifest, null, 2));
  return manifest;
}
function checkTarget(target, outputDir = root) {
  const installed = readArchive(target);
  const manifest = JSON.parse(fs.readFileSync(path.join(outputDir, 'build-manifest.json')));
  const version = JSON.parse(installed.get('package.json')).version;
  if (version !== manifest.version || hash(installed.data) !== manifest.baseSha256) throw Error('客户端在构建后发生变化，未覆盖；请重新运行一键汉化。');
  if (hash(fs.readFileSync(path.join(outputDir, 'app_localized.asar'))) !== manifest.sha256) throw Error('资源包校验失败');
  console.log('客户端版本及源文件校验通过：' + version);
  return manifest;
}
if (require.main === module) {
  try {
    if (process.argv[2] === '--check-target') checkTarget(process.argv[3]);
    else if (!process.argv[2] || process.argv[2] === '--target') build(process.argv[3] || defaultTarget());
    else throw Error('未知参数');
  } catch (error) { console.error(error.message); process.exitCode = 1; }
}
module.exports = { readArchive, build, checkTarget };
