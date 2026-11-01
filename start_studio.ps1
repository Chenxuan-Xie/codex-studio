param(
    [switch]$NoBrowser
)

$ErrorActionPreference = "Stop"
$root = Split-Path -Parent $MyInvocation.MyCommand.Path
$python = (Get-Command python).Source
$server = Join-Path $root "server.py"
$config = Join-Path $root "config.json"
$logDir = Join-Path $root "data"
if (-not (Test-Path $config)) {
    Write-Host "config.json not found. Copy config.example.json to config.json and edit paths."
    exit 1
}
New-Item -ItemType Directory -Force -Path $logDir | Out-Null

$running = $false
try {
    $resp = Invoke-RestMethod "http://127.0.0.1:7788/api/bootstrap" -TimeoutSec 2
    if ($resp.projects) { $running = $true }
} catch {
    $running = $false
}

if (-not $running) {
    $out = Join-Path $logDir "server.out.log"
    $err = Join-Path $logDir "server.err.log"
    $p = Start-Process -FilePath $python `
        -ArgumentList $server `
        -WorkingDirectory $root `
        -WindowStyle Hidden -PassThru `
        -RedirectStandardOutput $out -RedirectStandardError $err
    Write-Host "Codex Studio started, PID=$($p.Id)"
    Start-Sleep -Seconds 2
} else {
    Write-Host "Codex Studio is already running."
}

if (-not $NoBrowser) {
    Start-Process "http://127.0.0.1:7788"
}
