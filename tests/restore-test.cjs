'use strict';
const fs=require('fs'),os=require('os'),path=require('path'),cp=require('child_process'),crypto=require('crypto'),assert=require('assert/strict');
const temp=fs.mkdtempSync(path.join(os.tmpdir(),'ag-restore-test-'));
const hash=s=>crypto.createHash('sha256').update(s).digest('hex');
for(const scenario of ['success','changed-client','corrupt-backup']) {
  const dir=path.join(temp,scenario),resources=path.join(dir,'local/Programs/antigravity/resources'),backup=path.join(dir,'backups/install-test');
  fs.mkdirSync(resources,{recursive:true});fs.mkdirSync(backup,{recursive:true});
  const current=scenario==='changed-client'?'updated':'patched';
  fs.writeFileSync(path.join(resources,'app.asar'),current);
  fs.writeFileSync(path.join(backup,'app.asar'),scenario==='corrupt-backup'?'corrupt':'original');
  fs.writeFileSync(path.join(backup,'install-record.json'),JSON.stringify({installedHash:hash('patched'),beforeHash:hash('original')}));
  fs.copyFileSync(path.join(__dirname,'../restore.ps1'),path.join(dir,'restore.ps1'));
  fs.writeFileSync(path.join(dir,'driver.ps1'),`$env:LOCALAPPDATA = Join-Path $PSScriptRoot 'local'
function Get-Process { @() }
function Start-Process { }
& (Join-Path $PSScriptRoot 'restore.ps1')
exit $LASTEXITCODE
`);
  const result=cp.spawnSync('powershell.exe',['-NoProfile','-ExecutionPolicy','Bypass','-File',path.join(dir,'driver.ps1')],{encoding:'utf8',windowsHide:true,timeout:10000});
  assert.equal(result.status,scenario==='success'?0:1,result.stdout+'\n'+result.stderr);
  assert.equal(fs.readFileSync(path.join(resources,'app.asar'),'utf8'),scenario==='success'?'original':current);
  console.log('PASS restore '+scenario);
}
