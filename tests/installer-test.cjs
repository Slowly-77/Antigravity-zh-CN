'use strict';
const fs=require('fs'),os=require('os'),path=require('path'),cp=require('child_process'),assert=require('assert/strict');
const temp=fs.mkdtempSync(path.join(os.tmpdir(),'ag-installer-test-'));
const installer=fs.readFileSync(path.join(__dirname,'../install.ps1'));
let count=0;
for(const scenario of ['success','incompatible','postcheck-failure','update-race']) {
  const dir=path.join(temp,scenario),resources=path.join(dir,'local/Programs/antigravity/resources');fs.mkdirSync(resources,{recursive:true});
  const target=path.join(resources,'app.asar');fs.writeFileSync(target,'original');fs.writeFileSync(path.join(dir,'install.ps1'),installer);fs.writeFileSync(path.join(dir,'build-manifest.json'),JSON.stringify({version:'test'}));
  fs.writeFileSync(path.join(dir,'node-stub.ps1'),`$global:LASTEXITCODE = 0
$name = Split-Path -Leaf $args[0]
if ($name -eq 'build_localized.js' -and $args[1] -eq '--target') { [IO.File]::WriteAllText((Join-Path $PSScriptRoot 'app_localized.asar'), 'patched') }
if ($name -eq 'build_localized.js' -and $args[1] -eq '--check-target') {
  $global:checksSeen++
  if ($env:AG_TEST_CASE -eq 'update-race' -and $global:checksSeen -eq 2) { [IO.File]::WriteAllText($args[2], 'new-update'); $global:LASTEXITCODE = 1 }
}
if ($name -eq 'check_compatibility.js') {
  if ($env:AG_TEST_CASE -eq 'incompatible' -or ($env:AG_TEST_CASE -eq 'postcheck-failure' -and $args -contains '--installed')) { $global:LASTEXITCODE = 1 }
}
`);
  fs.writeFileSync(path.join(dir,'driver.ps1'),`$env:LOCALAPPDATA = Join-Path $PSScriptRoot 'local'
$env:AG_TEST_CASE = '${scenario}'
function Get-Command { param($Name) [pscustomobject]@{Source=(Join-Path $PSScriptRoot 'node-stub.ps1')} }
function Get-Process { @() }
function Start-Process { }
& (Join-Path $PSScriptRoot 'install.ps1')
exit $LASTEXITCODE
`);
  const result=cp.spawnSync('powershell.exe',['-NoProfile','-ExecutionPolicy','Bypass','-File',path.join(dir,'driver.ps1')],{encoding:'utf8',windowsHide:true,timeout:10000});
  const expected=scenario==='success'?'patched':scenario==='update-race'?'new-update':'original';
  assert.equal(fs.readFileSync(target,'utf8'),expected,result.stdout+'\n'+result.stderr);
  assert.equal(result.status,scenario==='success'?0:1,result.stdout+'\n'+result.stderr);
  if(scenario==='postcheck-failure')assert.match(result.stdout,/已自动恢复/);
  count++;console.log('PASS installer '+scenario);
}
console.log(`PASS ${count} isolated PowerShell 5.1 installer checks; fixtures: ${temp}`);
