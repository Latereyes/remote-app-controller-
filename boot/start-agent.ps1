<#
  Avvia l'agent senza finestra, se non risponde già. Usato dall'attività pianificata e dal countdown.
#>
$ErrorActionPreference = 'Stop'
$here = Split-Path -Parent $MyInvocation.MyCommand.Path
$agentDir = Join-Path (Split-Path -Parent $here) 'agent'

$port = 7070
$cfgPath = Join-Path $agentDir 'config.json'
if (Test-Path $cfgPath) {
  $cfg = Get-Content $cfgPath -Raw | ConvertFrom-Json
  if ($cfg.port) { $port = [int]$cfg.port }
}

try {
  Invoke-RestMethod -Uri "http://127.0.0.1:$port/api/health" -TimeoutSec 2 | Out-Null
  exit 0   # già acceso
} catch {}

$node = (Get-Command node -ErrorAction Stop).Source
Start-Process -FilePath $node -ArgumentList 'server.js' -WorkingDirectory $agentDir -WindowStyle Hidden `
  -RedirectStandardOutput (Join-Path $agentDir 'agent.log') -RedirectStandardError (Join-Path $agentDir 'agent-errori.log')
