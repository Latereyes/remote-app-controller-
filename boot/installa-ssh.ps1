<#
  Terminale vero del PC dal telefono: accende il server SSH di Windows (OpenSSH) con l'accesso solo a chiave
  e aperto solo agli indirizzi Tailscale (100.64.0.0/10). Va lanciato una volta, come amministratore.

    powershell -ExecutionPolicy Bypass -File installa-ssh.ps1 -ChiavePubblica "ssh-ed25519 AAAA... telefono"
    powershell -ExecutionPolicy Bypass -File installa-ssh.ps1 -FileChiave C:\Users\andre\Downloads\pixel.pub
    powershell -ExecutionPolicy Bypass -File installa-ssh.ps1 -Disattiva

  La chiave si crea sul telefono (Termius, JuiceSSH, ConnectBot o Termux con ssh-keygen -t ed25519):
  qui va solo la parte pubblica, la riga che comincia con «ssh-ed25519» o «ssh-rsa».
  Si può rilanciare per aggiungere altre chiavi: quelle già presenti non si duplicano.
#>
param(
  [string]$ChiavePubblica = '',
  [string]$FileChiave = '',
  [string]$Reti = '100.64.0.0/10',
  [switch]$Disattiva
)
$ErrorActionPreference = 'Stop'

$principal = [Security.Principal.WindowsPrincipal][Security.Principal.WindowsIdentity]::GetCurrent()
if (-not $principal.IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)) {
  Write-Host 'Serve PowerShell come amministratore (tasto destro > Esegui come amministratore).' -ForegroundColor Red
  exit 1
}

$regola = 'PC Remoto SSH (solo Tailscale)'
if ($Disattiva) {
  Stop-Service sshd -ErrorAction SilentlyContinue
  Set-Service sshd -StartupType Disabled -ErrorAction SilentlyContinue
  Remove-NetFirewallRule -DisplayName $regola -ErrorAction SilentlyContinue
  Write-Host 'SSH spento e disattivato. Le chiavi restano salvate per la prossima volta.'
  exit 0
}

if ($FileChiave) { $ChiavePubblica = (Get-Content $FileChiave -Raw).Trim() }
$ChiavePubblica = $ChiavePubblica.Trim()
if ($ChiavePubblica -and $ChiavePubblica -notmatch '^(ssh-ed25519|ssh-rsa|ecdsa-sha2-nistp\d+) [A-Za-z0-9+/=]+') {
  Write-Host 'La chiave non sembra una chiave pubblica SSH (deve cominciare con ssh-ed25519, ssh-rsa o ecdsa-...).' -ForegroundColor Red
  exit 1
}

# 1. OpenSSH Server (componente facoltativo di Windows)
$cap = Get-WindowsCapability -Online -Name 'OpenSSH.Server*' | Select-Object -First 1
if ($cap.State -ne 'Installed') {
  Write-Host 'Installo OpenSSH Server (qualche minuto)...'
  Add-WindowsCapability -Online -Name $cap.Name | Out-Null
}
Set-Service sshd -StartupType Automatic
Start-Service sshd   # al primo avvio crea C:\ProgramData\ssh\sshd_config e le chiavi del PC

# 2. Solo chiavi, niente password: anche chi conosce la password di Windows non entra senza la chiave del telefono
$conf = Join-Path $env:ProgramData 'ssh\sshd_config'
$righe = Get-Content $conf
function Set-Opzione([string]$nome, [string]$valore) {
  $trovata = $false
  $script:righe = foreach ($r in $script:righe) {
    if ($r -match "^\s*#?\s*$nome\s") { if (-not $trovata) { $trovata = $true; "$nome $valore" } }
    else { $r }
  }
  # Prima di eventuali blocchi «Match», che valgono fino alla fine del file
  if (-not $trovata) {
    $i = [Array]::FindIndex([string[]]$script:righe, [Predicate[string]]{ param($x) $x -match '^\s*Match\s' })
    if ($i -lt 0) { $script:righe += "$nome $valore" } else { $script:righe = $script:righe[0..($i - 1)] + "$nome $valore" + $script:righe[$i..($script:righe.Count - 1)] }
  }
}
Set-Opzione 'PubkeyAuthentication' 'yes'
Set-Opzione 'PasswordAuthentication' 'no'
Set-Opzione 'KbdInteractiveAuthentication' 'no'
Set-Content -Path $conf -Value $righe -Encoding ascii

# 3. Chiave del telefono: per gli amministratori Windows la legge da administrators_authorized_keys
$io = [Security.Principal.WindowsIdentity]::GetCurrent().User.Value
$admin = [bool](Get-LocalGroupMember -SID 'S-1-5-32-544' -ErrorAction SilentlyContinue | Where-Object { $_.SID.Value -eq $io })
$chiavi = if ($admin) { Join-Path $env:ProgramData 'ssh\administrators_authorized_keys' } else { Join-Path $env:USERPROFILE '.ssh\authorized_keys' }
if ($ChiavePubblica) {
  New-Item -ItemType Directory -Force -Path (Split-Path $chiavi) | Out-Null
  $gia = if (Test-Path $chiavi) { Get-Content $chiavi } else { @() }
  $corpo = ($ChiavePubblica -split '\s+')[1]
  if ($gia | Where-Object { $_ -match [regex]::Escape($corpo) }) { Write-Host 'Chiave già presente.' }
  else { Add-Content -Path $chiavi -Value $ChiavePubblica -Encoding ascii; Write-Host 'Chiave del telefono aggiunta.' }
  # sshd ignora il file se qualcun altro può scriverlo
  if ($admin) { icacls $chiavi /inheritance:r /grant '*S-1-5-32-544:F' /grant '*S-1-5-18:F' | Out-Null }
}
if (-not (Test-Path $chiavi) -or -not (Get-Content $chiavi | Where-Object { $_.Trim() })) {
  Write-Host 'Attenzione: nessuna chiave salvata, quindi per ora nessuno può entrare. Rilancia con -ChiavePubblica.' -ForegroundColor Yellow
}

# 4. Si apre in PowerShell invece che in cmd
New-ItemProperty -Path 'HKLM:\SOFTWARE\OpenSSH' -Name DefaultShell -PropertyType String -Force `
  -Value (Join-Path $env:SystemRoot 'System32\WindowsPowerShell\v1.0\powershell.exe') | Out-Null

# 5. Firewall: la porta 22 solo da Tailscale (la regola di Windows la apre a tutta la rete)
Get-NetFirewallRule -Name 'OpenSSH-Server-In-TCP' -ErrorAction SilentlyContinue | Disable-NetFirewallRule
Remove-NetFirewallRule -DisplayName $regola -ErrorAction SilentlyContinue
New-NetFirewallRule -DisplayName $regola -Direction Inbound -Protocol TCP -LocalPort 22 -RemoteAddress ($Reti -split ',') -Action Allow -Profile Any | Out-Null

Restart-Service sshd
$utente = $env:USERNAME
$ts = (Get-NetIPAddress -AddressFamily IPv4 -ErrorAction SilentlyContinue | Where-Object { $_.IPAddress -like '100.*' } | Select-Object -First 1).IPAddress
Write-Host ''
Write-Host 'SSH pronto.' -ForegroundColor Green
Write-Host "Dal telefono (con Tailscale acceso):  ssh $utente@$(if ($ts) { $ts } else { '<indirizzo Tailscale del PC>' })"
Write-Host 'Nell''app PC Remoto: pannello «Terminale» > «Apri SSH».'
