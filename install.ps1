param([switch]$NoRestart)
$ErrorActionPreference = 'Stop'
[Console]::OutputEncoding = [System.Text.Encoding]::UTF8
$installDir = Join-Path $env:LOCALAPPDATA 'Programs\antigravity'
$targetAsar = Join-Path $installDir 'resources\app.asar'
$exePath = Join-Path $installDir 'Antigravity.exe'
$sourceAsar = Join-Path $PSScriptRoot 'app_localized.asar'
function Get-ArchiveHash([string]$ArchivePath) {
    $algorithm = [System.Security.Cryptography.SHA256]::Create()
    $stream = [System.IO.File]::OpenRead($ArchivePath)
    try { return [System.BitConverter]::ToString($algorithm.ComputeHash($stream)).Replace('-', '') }
    finally { $stream.Dispose(); $algorithm.Dispose() }
}
# Launch through cmd start so the client never keeps this console window open.
function Start-ClientDetached { Start-Process -FilePath 'cmd.exe' -ArgumentList ('/c start "" "{0}"' -f $exePath) -WindowStyle Hidden }
try {
    if (-not (Test-Path -LiteralPath $targetAsar)) { throw '未找到 Antigravity 安装文件。' }
    $nodeCommand = Get-Command node -ErrorAction Stop
    Write-Host '[1/5] 从当前客户端生成补丁并检查兼容性……'
    & $nodeCommand.Source (Join-Path $PSScriptRoot 'build_localized.js') --target $targetAsar
    if ($LASTEXITCODE -ne 0) { throw '构建失败，未修改客户端。' }
    & $nodeCommand.Source (Join-Path $PSScriptRoot 'build_localized.js') --check-target $targetAsar
    if ($LASTEXITCODE -ne 0) { throw '版本或文件校验失败，未修改客户端。' }
    & $nodeCommand.Source (Join-Path $PSScriptRoot 'test_localized.js')
    if ($LASTEXITCODE -ne 0) { throw '汉化自检失败，未修改客户端。' }
    $appRunning = @(Get-Process -Name Antigravity -ErrorAction SilentlyContinue | Where-Object { $_.Path -eq $exePath })
    # A hidden window has no main window handle, so step 3 could not close it normally.
    if ($appRunning.Count -eq 0) { Start-ClientDetached }
    & $nodeCommand.Source (Join-Path $PSScriptRoot 'check_compatibility.js')
    if ($LASTEXITCODE -ne 0) { throw '界面兼容性检查未通过，未修改客户端。' }
    Write-Host '[2/5] 备份当前客户端资源……'
    $stamp = Get-Date -Format 'yyyyMMdd-HHmmss-fff'
    $backupDir = Join-Path $PSScriptRoot "backups\install-$stamp"
    New-Item -ItemType Directory -Path $backupDir | Out-Null
    Copy-Item -LiteralPath $targetAsar -Destination (Join-Path $backupDir 'app.asar')
    $beforeHash = (Get-ArchiveHash $targetAsar)
    if ((Get-ArchiveHash (Join-Path $backupDir 'app.asar')) -ne $beforeHash) { throw '备份校验失败。' }
    $buildInfo = Get-Content -LiteralPath (Join-Path $PSScriptRoot 'build-manifest.json') -Raw | ConvertFrom-Json
    @{ version = $buildInfo.version; beforeHash = $beforeHash; installedHash = (Get-ArchiveHash $sourceAsar) } |
        ConvertTo-Json | Set-Content -LiteralPath (Join-Path $backupDir 'install-record.json') -Encoding UTF8
    Write-Host '[3/5] 正常退出客户端以释放资源文件……'
    $processes = @(Get-Process -Name Antigravity -ErrorAction SilentlyContinue | Where-Object { $_.Path -eq $exePath })
    foreach ($appProcess in $processes) {
        if ($appProcess.MainWindowHandle -ne 0) { $null = $appProcess.CloseMainWindow() }
    }
    $deadline = (Get-Date).AddSeconds(15)
    do {
        $running = @(Get-Process -Name Antigravity -ErrorAction SilentlyContinue | Where-Object { $_.Path -eq $exePath })
        if ($running.Count -eq 0) { break }
        Start-Sleep -Milliseconds 300
    } while ((Get-Date) -lt $deadline)
    if ($running.Count -gt 0) { throw '客户端尚未退出（可能有托盘或未保存提示）。请正常退出后重新运行；未强制终止进程。' }
    # A downloaded client update can install on quit. Never overwrite a newer version.
    $updateDeadline = (Get-Date).AddSeconds(30)
    do {
        $updating = @(Get-Process -Name 'Antigravity-x64','Antigravity-arm64' -ErrorAction SilentlyContinue)
        if ($updating.Count -eq 0) { break }
        Start-Sleep -Milliseconds 500
    } while ((Get-Date) -lt $updateDeadline)
    if ($updating.Count -gt 0) { throw '客户端正在自动更新，未覆盖资源。更新完成后请重新核对补丁版本。' }
    & $nodeCommand.Source (Join-Path $PSScriptRoot 'build_localized.js') --check-target $targetAsar
    if ($LASTEXITCODE -ne 0) { throw '退出时客户端自动更新了资源，未覆盖新版；重新运行一键汉化即可重新检查适配。' }
    Write-Host '[4/5] 安装并核对汉化文件……'
    $stagedAsar = Join-Path $installDir 'resources\app.asar.zh-installing'
    Copy-Item -LiteralPath $sourceAsar -Destination $stagedAsar -Force
    if ((Get-ArchiveHash $stagedAsar) -ne (Get-ArchiveHash $sourceAsar)) { throw '临时安装文件校验失败，未替换客户端。' }
    [System.IO.File]::Replace($stagedAsar, $targetAsar, [NullString]::Value)
    $didInstall = $true
    if ((Get-ArchiveHash $targetAsar) -ne (Get-ArchiveHash $sourceAsar)) {
        throw '安装后校验失败。'
    }
    if (-not $NoRestart) {
        Start-ClientDetached
        & $nodeCommand.Source (Join-Path $PSScriptRoot 'check_compatibility.js') --installed
        if ($LASTEXITCODE -ne 0) { throw '重启后验证失败。' }
    }
    & $nodeCommand.Source (Join-Path $PSScriptRoot 'patch_title_generator.js')
    if ($LASTEXITCODE -ne 0) { throw '界面补丁已安装，但中文显示规则写入失败，请查看错误。' }
    Write-Host '[5/5] 文件安装完成。'
    if ($NoRestart) { Write-Host '已跳过重启和运行验证。' }
    Write-Host "安装前备份：$backupDir"
    Write-Host '思考摘要已设置中文偏好，实际语言仍取决于模型；历史英文内容不会被改写。'
    Write-Host '窗口将在 2 秒后自动关闭……' -ForegroundColor Gray
} catch {
    $failureMessage = $_.Exception.Message
    if ($didInstall -and $backupDir) {
        try {
            $rollbackProcesses = @(Get-Process -Name Antigravity -ErrorAction SilentlyContinue | Where-Object { $_.Path -eq $exePath })
            foreach ($rollbackProcess in $rollbackProcesses) { if ($rollbackProcess.MainWindowHandle -ne 0) { $null = $rollbackProcess.CloseMainWindow() } }
            $rollbackDeadline = (Get-Date).AddSeconds(15)
            do {
                $rollbackRunning = @(Get-Process -Name Antigravity -ErrorAction SilentlyContinue | Where-Object { $_.Path -eq $exePath })
                if ($rollbackRunning.Count -eq 0) { break }
                Start-Sleep -Milliseconds 300
            } while ((Get-Date) -lt $rollbackDeadline)
            if ($rollbackRunning.Count -gt 0) { throw '客户端未退出，未强制覆盖。' }
            if ((Get-ArchiveHash $targetAsar) -ne (Get-ArchiveHash $sourceAsar)) { throw '客户端文件已再次变化，未覆盖。' }
            Copy-Item -LiteralPath (Join-Path $backupDir 'app.asar') -Destination $stagedAsar -Force
            if ((Get-ArchiveHash $stagedAsar) -ne $beforeHash) { throw '恢复文件校验失败。' }
            [System.IO.File]::Replace($stagedAsar, $targetAsar, [NullString]::Value)
            if ((Get-ArchiveHash $targetAsar) -ne $beforeHash) { throw '恢复后校验失败。' }
            Write-Host '已自动恢复安装前资源。'
            if (-not $NoRestart) { Start-ClientDetached }
        } catch { Write-Host ('自动恢复未完成：' + $_.Exception.Message + ' 备份：' + $backupDir) -ForegroundColor Red }
    }
    Write-Host "安装未完成：$failureMessage" -ForegroundColor Red
    Write-Host '窗口保留以便查看错误。'
    exit 1
}
