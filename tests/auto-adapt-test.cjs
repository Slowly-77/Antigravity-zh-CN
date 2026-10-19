'use strict';
const fs=require('fs'),path=require('path'),os=require('os'),assert=require('assert/strict'),crypto=require('crypto');
const {readArchive,build,checkTarget}=require('../build_localized');
const {validate,inspectRenderer,selectResult}=require('../check_compatibility');
const root=path.dirname(__dirname),temp=fs.mkdtempSync(path.join(os.tmpdir(),'ag-adapt-test-'));
const hash=b=>crypto.createHash('sha256').update(b).digest('hex');
let count=0;const check=(label,run)=>{run();count++;console.log('PASS '+label)};
function fixture(file,changes={}) {
  const base=readArchive((process.env.AG_TEST_BASE_ASAR || path.join(process.env.LOCALAPPDATA,'Programs/antigravity/resources/app.asar')));let offset=0;const chunks=[];
  for(const [name,entry] of base.entries){if(entry.unpacked||entry.link)continue;const originalBytes=name==='dist/preload.js' ? Buffer.from(base.get(name).toString().split('// Localization and chat layout extensions.')[0].trimEnd()) : base.get(name);const bytes=Buffer.from(changes[name]??originalBytes);entry.offset=String(offset);entry.size=bytes.length;
    if(entry.integrity){entry.integrity.hash=hash(bytes);entry.integrity.blocks=[];for(let n=0;n<bytes.length;n+=entry.integrity.blockSize)entry.integrity.blocks.push(hash(bytes.subarray(n,n+entry.integrity.blockSize)));}
    chunks.push(bytes);offset+=bytes.length;}
  const json=Buffer.from(JSON.stringify(base.header)),payload=4+Math.ceil(json.length/4)*4,pickle=Buffer.alloc(payload+4),size=Buffer.alloc(8);
  pickle.writeUInt32LE(payload,0);pickle.writeUInt32LE(json.length,4);json.copy(pickle,8);size.writeUInt32LE(4,0);size.writeUInt32LE(pickle.length,4);fs.writeFileSync(file,Buffer.concat([size,pickle,...chunks]));
}
const original=readArchive((process.env.AG_TEST_BASE_ASAR || path.join(process.env.LOCALAPPDATA,'Programs/antigravity/resources/app.asar')));
const pkg=JSON.parse(original.get('package.json'));pkg.version='2.99.7';
const target=path.join(temp,'future.asar'),out=path.join(temp,'app_localized.asar');
fixture(target,{'package.json':JSON.stringify(pkg),'dist/main.js':original.get('dist/main.js').toString()+'\n// New upstream implementation retained.\n'});
check('future version accepted with unchanged native contract',()=>assert.equal(build(target,temp).version,'2.99.7'));
check('new upstream files preserved rather than replaced by old base',()=>assert.equal(readArchive(out).get('dist/main.js').toString(),readArchive(target).get('dist/main.js').toString()));
check('exact current input passes preinstall check',()=>checkTarget(target,temp));
const first=fs.readFileSync(out);fs.copyFileSync(out,target);
check('repeat install replaces extension without duplication',()=>{build(target,temp);assert.deepEqual(fs.readFileSync(out),first);assert.equal(readArchive(out).get('dist/preload.js').toString().split('// Localization and chat layout extensions.').length,2)});
fixture(target,{'package.json':JSON.stringify(pkg),'dist/main.js':'// different same-version upstream'});
check('same-version update during installation is rejected',()=>assert.throws(()=>checkTarget(target,temp),/构建后发生变化/));
fixture(target,{'dist/preload.js':original.get('dist/preload.js').toString().split('// Localization and chat layout extensions.')[0].trimEnd()+'\n// changed native bridge'});
check('changed native contract rejected without replacing output',()=>{assert.throws(()=>build(target,temp),/原生 preload/);assert.deepEqual(fs.readFileSync(out),first)});
const bad=path.join(temp,'broken.asar');fs.writeFileSync(bad,Buffer.alloc(4));
check('truncated archive rejected',()=>assert.throws(()=>readArchive(bad),/资源包头/));
const checks=Object.fromEntries(['composer','editor','modelSelector','state','historyPaging','trajectory','quota','permissions','conversation'].map(k=>[k,true]));
check('complete live renderer contract accepted',()=>validate({checks,busy:false,installed:true},true));
check('missing paging interface rejected',()=>assert.throws(()=>validate({checks:{...checks,historyPaging:false}}),/historyPaging/));
check('empty interface report rejected',()=>assert.throws(()=>validate({checks:{}}),/接口/));
check('active generation blocks restart',()=>assert.throws(()=>validate({checks,busy:true}),/正在执行/));
check('missing installed UI rejected after restart',()=>assert.throws(()=>validate({checks,installed:false},true),/尚未加载/));
const state={};const provider={getState:()=>state};
const trigger={closest:()=>({querySelector:()=>({})}),__reactFiber$test:{memoizedProps:{value:{cascadeContext:{state:{agentStateProvider:provider}},getCascadeTrajectory(){},retrieveUserQuotaSummary(){}}}}};
const document={querySelector:s=>s.includes('model-selector')?trigger:{}};
const home=require('vm').runInNewContext('('+inspectRenderer.toString()+')()',{document});
check('homepage defers history checks until a conversation exists',()=>{validate(home,true);assert.equal(home.deferred.includes('historyPaging'),true)});
state.conversationId='sample';
const conversation=require('vm').runInNewContext('('+inspectRenderer.toString()+')()',{document});
check('real conversation still requires pagination API',()=>assert.throws(()=>validate(conversation),/historyPaging/));
check('blank startup page is not reported as incompatible',()=>assert.throws(()=>validate({page:{blank:true},checks:{}}),/空白页/));
check('ready chat selected after blank window',()=>assert.equal(selectResult([{page:{blank:true},checks:{}},{checks,installed:true}]).installed,true));
check('busy secondary chat still blocks restart',()=>assert.throws(()=>validate(selectResult([{checks,busy:false},{checks:{composer:true},busy:true}])),/正在执行/));
console.log(`PASS ${count} automatic adaptation checks; fixtures: ${temp}`);
