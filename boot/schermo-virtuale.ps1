<#
  Schermo virtuale all'accensione (Windows PowerShell 5.1).
  Se all'accesso nessuno schermo è attivo (TV spenta), accende lo schermo virtuale (Virtual Display Driver, MTT1337)
  e lo rende principale: senza almeno uno schermo attivo Sunshine non trova l'encoder e Moonlight risponde 503
  (prova sul PC 2026-11-08 14:22: «No display devices are active at the moment!»).
  Con la TV accesa non fa niente: a scegliere lo schermo durante lo stream ci pensa Sunshine (ensure_only_display).
  Lo lancia countdown.ps1 a ogni accesso, prima di decidere tra modalità server e Xbox.

  -DryRun  stampa solo cosa farebbe
#>
param([switch]$DryRun)

$ErrorActionPreference = 'Stop'
$here = Split-Path -Parent $MyInvocation.MyCommand.Path

$cfg = @{ multiMonitorTool = 'C:\tools\MultiMonitorTool.exe'; virtualDisplay = 'MTT1337'; virtualDisplayHwId = 'Root\MttVDD' }
$cfgPath = Join-Path $here 'boot.json'
if (Test-Path $cfgPath) {
  (Get-Content $cfgPath -Raw | ConvertFrom-Json).psobject.Properties | ForEach-Object { $cfg[$_.Name] = $_.Value }
}

$logFile = Join-Path $here 'boot.log'
function Write-Log([string]$msg) {
  $line = '{0} [schermo] {1}' -f (Get-Date -Format 'yyyy-MM-dd HH:mm:ss'), $msg
  Write-Output $line
  if (-not $DryRun) { Add-Content -Path $logFile -Value $line -Encoding UTF8 }
}

$mmt = $cfg.multiMonitorTool
if (-not (Test-Path $mmt)) { Write-Log "MultiMonitorTool non trovato ($mmt): non controllo gli schermi"; exit 0 }

# Elenco degli schermi da MultiMonitorTool (CSV): Monitor ID, Active, Name...
function Get-Monitors {
  $csv = Join-Path $env:TEMP 'rac-schermi.csv'
  Remove-Item $csv -ErrorAction SilentlyContinue
  Start-Process -FilePath $mmt -ArgumentList '/scomma', "`"$csv`"" -Wait -WindowStyle Hidden
  if (-not (Test-Path $csv)) { return @() }
  return @(Import-Csv $csv)
}
$isActive = { param($m) $m.Active -match '^(Yes|Sì|Si)$' }
$isVirtual = { param($m) ($m.'Monitor ID' + ' ' + $m.'Monitor Name' + ' ' + $m.'Monitor String') -match [regex]::Escape($cfg.virtualDisplay) }

# Gli schermi compaiono qualche secondo dopo l'accesso: riprovo per 20 s prima di dire che non ce n'è nessuno
$monitors = @()
for ($i = 0; $i -lt 10; $i++) {
  $monitors = Get-Monitors
  if (@($monitors | Where-Object { & $isActive $_ }).Count) { break }
  Start-Sleep -Seconds 2
}
$active = @($monitors | Where-Object { & $isActive $_ })
if ($active.Count) {
  Write-Log ('Schermo attivo: {0}' -f (($active | ForEach-Object { $_.'Monitor Name' + ' ' + $_.Name }) -join ', '))
  exit 0
}

$vdd = $monitors | Where-Object { & $isVirtual $_ } | Select-Object -First 1
Write-Log 'Nessuno schermo attivo (TV spenta?): accendo lo schermo virtuale'
if ($DryRun) { exit 0 }

if ($vdd) {
  $id = $vdd.'Monitor ID'
  Start-Process -FilePath $mmt -ArgumentList '/enable', "`"$id`"" -Wait -WindowStyle Hidden
  Start-Sleep -Seconds 2
  Start-Process -FilePath $mmt -ArgumentList '/SetPrimary', "`"$id`"" -Wait -WindowStyle Hidden
  Start-Sleep -Seconds 2
}
if (@(Get-Monitors | Where-Object { & $isActive $_ }).Count) { Write-Log 'Schermo virtuale acceso'; exit 0 }

# Ultimo tentativo: spegnere e riaccendere il driver (serve l'amministratore)
$admin = ([Security.Principal.WindowsPrincipal][Security.Principal.WindowsIdentity]::GetCurrent()).IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)
if (-not $admin) { Write-Log 'Schermo virtuale non acceso, e senza amministratore non posso riavviare il driver'; exit 1 }
try {
  $dev = Get-PnpDevice | Where-Object { $_.HardwareID -contains $cfg.virtualDisplayHwId } | Select-Object -First 1
  if (-not $dev) { Write-Log "Driver $($cfg.virtualDisplayHwId) non trovato"; exit 1 }
  Disable-PnpDevice -InstanceId $dev.InstanceId -Confirm:$false
  Start-Sleep -Seconds 2
  Enable-PnpDevice -InstanceId $dev.InstanceId -Confirm:$false
  Start-Sleep -Seconds 3
} catch { Write-Log "Riavvio del driver non riuscito: $($_.Exception.Message)"; exit 1 }
if (@(Get-Monitors | Where-Object { & $isActive $_ }).Count) { Write-Log 'Schermo virtuale acceso (driver riavviato)'; exit 0 }
Write-Log 'Schermo virtuale ancora spento: Moonlight non potrà collegarsi'
exit 1
