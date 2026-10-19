param([string]$BackupDirectory)
$ErrorActionPreference = 'Stop'
[Console]::OutputEncoding = [System.Text.Encoding]::UTF8
$installDir = Join-Path $env:LOCALAPPDATA 'Programs\antigravity'
$target = Join-Path $installDir 'resources\app.asar'
$exePath = Join-Path $installDir 'Antigravity.exe'
function Get-ArchiveHash([string]$File) {
    $algorithm = [Security.Cryptography.SHA256]::Create()
    $stream = [IO.File]::OpenRead($File)
    try { return [BitConverter]::ToString($algorithm.ComputeHash($stream)).Replace('-', '') }
    finally { $stream.Dispose(); $algorithm.Dispose() }
}
try {
    $currentHash = Get-ArchiveHash $target
    if ($BackupDirectory) { $candidates = @(Get-Item -LiteralPath $BackupDirectory) }
    else { $candidates = @(Get-ChildItem -LiteralPath (Join-Path $PSScriptRoot 'backups') -Directory | Sort-Object Name -Descending) }
    $chosen = $null
    foreach ($candidate in $candidates) {
        $recordPath = Join-Path $candidate.FullName 'install-record.json'
        if (-not (Test-Path -LiteralPath $recordPath)) { continue }
        $record = Get-Content -LiteralPath $recordPath -Raw | ConvertFrom-Json
        if ($record.installedHash -eq $currentHash) { $chosen = $candidate; break }
    }
    if (-not $chosen) { throw '没有与当前客户端匹配的安装备份。更新后的客户端不能用旧备份覆盖。' }
    $backup = Join-Path $chosen.FullName 'app.asar'
    if ((Get-ArchiveHash $backup) -ne $record.beforeHash) { throw '备份校验失败，未修改客户端。' }
    $processes = @(Get-Process -Name Antigravity -ErrorAction SilentlyContinue | Where-Object { $_.Path -eq $exePath })
    foreach ($appProcess in $processes) { if ($appProcess.MainWindowHandle -ne 0) { $null = $appProcess.CloseMainWindow() } }
    $deadline = (Get-Date).AddSeconds(15)
    do {
        $running = @(Get-Process -Name Antigravity -ErrorAction SilentlyContinue | Where-Object { $_.Path -eq $exePath })
        if ($running.Count -eq 0) { break }
        Start-Sleep -Milliseconds 300
    } while ((Get-Date) -lt $deadline)
    if ($running.Count -gt 0) { throw '客户端尚未退出。请正常退出后重试，未强制结束进程。' }
    if (@(Get-Process -Name 'Antigravity-x64','Antigravity-arm64' -ErrorAction SilentlyContinue).Count -gt 0) { throw '客户端正在更新，未覆盖。' }
    if ((Get-ArchiveHash $target) -ne $currentHash) { throw '客户端文件已变化，未覆盖。' }
    $staged = Join-Path $installDir 'resources\app.asar.zh-restoring'
    Copy-Item -LiteralPath $backup -Destination $staged -Force
    if ((Get-ArchiveHash $staged) -ne $record.beforeHash) { throw '临时还原文件校验失败。' }
    [IO.File]::Replace($staged, $target, [NullString]::Value)
    if ((Get-ArchiveHash $target) -ne $record.beforeHash) { throw '还原后校验失败。' }
    Start-Process -FilePath 'cmd.exe' -ArgumentList ('/c start "" "{0}"' -f $exePath) -WindowStyle Hidden
    Write-Host '已恢复本次安装前的界面资源。中文交流偏好和会话记录未改动。'
} catch {
    Write-Host ('还原未完成：' + $_.Exception.Message) -ForegroundColor Red
    exit 1
}
