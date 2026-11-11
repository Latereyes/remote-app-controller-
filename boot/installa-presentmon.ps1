<#
  FPS dei giochi nell'app: scarica PresentMon (Intel, gratuito, firmato) in tools\PresentMon.exe e dà all'utente
  il permesso di leggere gli eventi dei frame senza essere amministratore (gruppo «Performance Log Users»).
  Va lanciato una volta, come amministratore; poi serve uscire dall'account o riavviare il PC.

    powershell -ExecutionPolicy Bypass -File installa-presentmon.ps1
    powershell -ExecutionPolicy Bypass -File installa-presentmon.ps1 -Versione v2.6.0
    powershell -ExecutionPolicy Bypass -File installa-presentmon.ps1 -Disattiva

  L'agent accende PresentMon solo mentre il pannello gioco è aperto nell'app e lo chiude dopo un minuto.
#>
param(
  [string]$Versione = 'latest',
  [string]$Utente = $env:USERNAME,
  [switch]$Disattiva
)
$ErrorActionPreference = 'Stop'

$principal = [Security.Principal.WindowsPrincipal][Security.Principal.WindowsIdentity]::GetCurrent()
if (-not $principal.IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)) {
  Write-Host 'Serve PowerShell come amministratore (tasto destro > Esegui come amministratore).' -ForegroundColor Red
  exit 1
}

$radice = Split-Path -Parent $PSScriptRoot
$cartella = Join-Path $radice 'tools'
$exe = Join-Path $cartella 'PresentMon.exe'
$gruppo = 'S-1-5-32-559' # Performance Log Users, con lo stesso SID in ogni lingua di Windows

if ($Disattiva) {
  Remove-LocalGroupMember -SID $gruppo -Member $Utente -ErrorAction SilentlyContinue
  Remove-Item $exe -ErrorAction SilentlyContinue
  Write-Host 'PresentMon tolto: l''app non mostrerà più gli FPS.'
  exit 0
}

# 1. Download dalla release ufficiale su GitHub (solo l'eseguibile da riga di comando, non l'msi)
New-Item -ItemType Directory -Force -Path $cartella | Out-Null
[Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12
$api = if ($Versione -eq 'latest') { 'https://api.github.com/repos/GameTechDev/PresentMon/releases/latest' }
       else { "https://api.github.com/repos/GameTechDev/PresentMon/releases/tags/$Versione" }
$rel = Invoke-RestMethod -Uri $api -Headers @{ 'User-Agent' = 'pc-remoto' }
$asset = $rel.assets | Where-Object { $_.name -match '^PresentMon-[\d.]+-x64\.exe$' } | Select-Object -First 1
if (-not $asset) {
  Write-Host "Nella release $($rel.tag_name) non trovo PresentMon-<versione>-x64.exe." -ForegroundColor Red
  exit 1
}
Write-Host "Scarico $($asset.name) ($($rel.tag_name))..."
$tmp = "$exe.nuovo"
Invoke-WebRequest -Uri $asset.browser_download_url -OutFile $tmp -UseBasicParsing
$firma = Get-AuthenticodeSignature $tmp
if ($firma.Status -ne 'Valid' -or $firma.SignerCertificate.Subject -notmatch 'O=Intel Corporation') {
  Remove-Item $tmp -ErrorAction SilentlyContinue
  Write-Host "Firma non valida ($($firma.Status)): file scartato." -ForegroundColor Red
  exit 1
}
# Se l'agent lo sta usando, prima lo si chiude
Get-Process PresentMon -ErrorAction SilentlyContinue | Stop-Process -Force -ErrorAction SilentlyContinue
Move-Item -Force $tmp $exe
Write-Host "PresentMon in $exe (firmato da Intel)."

# 2. Permesso di leggere gli eventi dei frame senza amministratore: l'agent gira come utente normale
$dentro = Get-LocalGroupMember -SID $gruppo -ErrorAction SilentlyContinue | Where-Object { $_.Name -match "\\$([regex]::Escape($Utente))$" }
if ($dentro) {
  Write-Host "$Utente è già nel gruppo Performance Log Users."
} else {
  Add-LocalGroupMember -SID $gruppo -Member $Utente
  Write-Host "$Utente aggiunto al gruppo Performance Log Users." -ForegroundColor Green
  Write-Host 'Il permesso vale dal prossimo accesso: esci dall''account o riavvia il PC.' -ForegroundColor Yellow
}

# 3. Prova di 3 secondi (qui come amministratore): deve stampare l'intestazione del CSV
Write-Host 'Prova di 3 secondi...'
$prova = & $exe --output_stdout --stop_existing_session --session_name PCRemotoProva --timed 3 --terminate_after_timed --v1_metrics 2>&1 | Select-Object -First 3
$prova | ForEach-Object { Write-Host "  $_" }
if (($prova -join "`n") -match 'Application') { Write-Host 'PresentMon funziona.' -ForegroundColor Green }
else { Write-Host 'PresentMon non ha stampato l''intestazione: guarda il messaggio qui sopra.' -ForegroundColor Yellow }
