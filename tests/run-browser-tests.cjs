const fs=require('fs'),cp=require('child_process'),path=require('path');
(async()=>{
 const testName=process.argv[2] || 'composer-scroll-test';
 if(!/^[a-z-]+$/.test(testName))throw Error('Invalid test name');
 const root=__dirname; const profile=path.join(require('os').tmpdir(),'antigravity-localization-browser-tests'); fs.mkdirSync(profile,{recursive:true}); if(fs.existsSync(profile+'/DevToolsActivePort'))fs.unlinkSync(profile+'/DevToolsActivePort');
 const proc=cp.spawn('C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',['--headless','--disable-gpu','--no-first-run','--remote-debugging-port=0','--user-data-dir='+profile,'--allow-file-access-from-files','about:blank'],{windowsHide:true,stdio:'ignore'});
 let ws;try {
  let port;
  for(let i=0;i<70;i++){try{port=Number(fs.readFileSync(profile+'/DevToolsActivePort','utf8').split('\n')[0]);if(port)break;}catch{}await new Promise(r=>setTimeout(r,100));}
  const targets=await (await fetch('http://127.0.0.1:'+port+'/json/list')).json();const target=targets.find(t=>t.type==='page');
  ws=new WebSocket(target.webSocketDebuggerUrl);await new Promise((r,j)=>{ws.onopen=r;ws.onerror=j;});let id=0;const pending=new Map();
  ws.onmessage=e=>{const m=JSON.parse(e.data);if(m.id){const p=pending.get(m.id);if(p){pending.delete(m.id);m.error?p.reject(m.error):p.resolve(m.result);}}};
  const send=(method,params={})=>new Promise((resolve,reject)=>{const n=++id;pending.set(n,{resolve,reject});ws.send(JSON.stringify({id:n,method,params}));});
  await send('Emulation.setDeviceMetricsOverride',{width:1100,height:900,deviceScaleFactor:1,mobile:false});
  await send('Page.navigate',{url:'file:///'+root+'/'+testName+'.html'});
  let answer;
  for(let i=0;i<80;i++){await new Promise(r=>setTimeout(r,100));answer=await send('Runtime.evaluate',{expression:'document.getElementById("result")?.textContent',returnByValue:true});if(answer.result.value)break;}
  console.log(answer.result.value||'TIMEOUT');fs.writeFileSync(root+'/'+testName+'-report.json',answer.result.value||'{}');
  const shot=await send('Page.captureScreenshot',{format:'png'});fs.writeFileSync(root+'/'+testName+'.png',Buffer.from(shot.data,'base64'));
  if(!JSON.parse(answer.result.value || '{}').ok)process.exitCode=1;
  await send('Browser.close');ws.close();
 }finally{if(ws?.readyState===1)ws.close();if(proc.exitCode===null)proc.kill();}
})().catch(e=>{console.error(e);process.exitCode=1});
