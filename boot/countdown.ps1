<#
  Countdown all'accesso (Windows PowerShell 5.1).
  Se entro "seconds" nessuno usa mouse, tastiera o controller Xbox, il PC passa in modalità server:
  avvia l'agent (se non è già acceso) e le app in "serverApps" di boot.json.
  Se qualcuno lo usa, resta in modalità Xbox e non avvia niente.
  Anche una connessione da Moonlight (log di Sunshine) conta come uso. Se Sunshine è installato, il countdown
  aspetta che sia pronto e poi lascia altri "sunshineGraceSeconds" per collegarsi: dopo un Wake-on-LAN
  la Deck vede il PC solo quando Sunshine ha finito di avviarsi.

  -Seconds N  sovrascrive boot.json
  -NoGui      niente finestra (per i test)
  -DryRun     non avvia niente e non scrive file: stampa solo la decisione
  -Force      riparte anche se dopo l'ultima accensione la modalità è già stata decisa
#>
param(
  [int]$Seconds = 0,
  [switch]$NoGui,
  [switch]$DryRun,
  [switch]$Force
)

$ErrorActionPreference = 'Stop'
$here = Split-Path -Parent $MyInvocation.MyCommand.Path
$root = Split-Path -Parent $here

$cfg = @{
  seconds = 30; serverApps = @('ollama', 'comfy'); agentAlways = $true
  sunshineLog = 'C:\Program Files\Sunshine\config\sunshine.log'; sunshineGraceSeconds = 45; sunshineWaitMax = 120
}
$cfgPath = Join-Path $here 'boot.json'
if (Test-Path $cfgPath) {
  (Get-Content $cfgPath -Raw | ConvertFrom-Json).psobject.Properties | ForEach-Object { $cfg[$_.Name] = $_.Value }
}
if ($Seconds -gt 0) { $cfg.seconds = $Seconds }

$logFile = Join-Path $here 'boot.log'
function Write-Log([string]$msg) {
  $line = '{0} {1}' -f (Get-Date -Format 'yyyy-MM-dd HH:mm:ss'), $msg
  Write-Output $line
  if (-not $DryRun) { Add-Content -Path $logFile -Value $line -Encoding UTF8 }
}

# Il countdown può partire da più punti (accesso, avvio della modalità Xbox): una volta per accensione basta
$modeFile = Join-Path $here 'mode.txt'
if (-not $Force -and -not $DryRun -and (Test-Path $modeFile)) {
  $boot = (Get-CimInstance Win32_OperatingSystem).LastBootUpTime
  if ((Get-Item $modeFile).LastWriteTime -gt $boot) {
    Write-Output 'Modalità già decisa dopo l''ultima accensione: esco'
    exit 0
  }
}

Add-Type -TypeDefinition @'
using System;
using System.Runtime.InteropServices;

public static class UserInput {
  [StructLayout(LayoutKind.Sequential)]
  struct LASTINPUTINFO { public uint cbSize; public uint dwTime; }
  [DllImport("user32.dll")]
  static extern bool GetLastInputInfo(ref LASTINPUTINFO info);

  // Ultimo input di mouse o tastiera (tick di sistema)
  public static uint LastInputTick() {
    var info = new LASTINPUTINFO();
    info.cbSize = (uint)Marshal.SizeOf(info);
    GetLastInputInfo(ref info);
    return info.dwTime;
  }

  [StructLayout(LayoutKind.Sequential)]
  struct XINPUT_STATE {
    public uint dwPacketNumber; public ushort wButtons; public byte bLeftTrigger; public byte bRightTrigger;
    public short sThumbLX; public short sThumbLY; public short sThumbRX; public short sThumbRY;
  }
  [DllImport("xinput1_4.dll")]
  static extern uint XInputGetState(uint index, out XINPUT_STATE state);

  static readonly int[][] last = new int[4][];

  // true se un controller Xbox ha un tasto premuto o leve/grilletti mossi oltre la zona morta
  // rispetto alla lettura precedente (il controller non aggiorna GetLastInputInfo).
  public static bool GamepadActivity() {
    bool active = false;
    for (uint i = 0; i < 4; i++) {
      XINPUT_STATE s;
      try { if (XInputGetState(i, out s) != 0) { last[i] = null; continue; } }
      catch (Exception) { return false; }   // xinput non disponibile
      var now = new int[] { s.wButtons, s.bLeftTrigger, s.bRightTrigger, s.sThumbLX, s.sThumbLY, s.sThumbRX, s.sThumbRY };
      var prev = last[i];
      last[i] = now;
      if (s.wButtons != 0) { active = true; continue; }
      if (prev == null) continue;
      if (prev[0] != now[0]) active = true;
      if (Math.Abs(prev[1] - now[1]) > 30 || Math.Abs(prev[2] - now[2]) > 30) active = true;
      for (int k = 3; k < 7; k++) if (Math.Abs(prev[k] - now[k]) > 8000) active = true;
    }
    return active;
  }
}
'@

$startTick = [UserInput]::LastInputTick()
[void][UserInput]::GamepadActivity()   # prima lettura di riferimento
$countdownStart = Get-Date
$deadline = $countdownStart.AddSeconds($cfg.seconds)

$bootTime = (Get-CimInstance Win32_OperatingSystem).LastBootUpTime
$useSunshine = [bool](Get-Service SunshineService -ErrorAction SilentlyContinue)
$script:sunshineReady = -not $useSunshine
$script:nextSunshineCheck = [datetime]::MinValue

# Orario della prima riga del log di Sunshine che contiene $text, scritta dopo $after ($null se non c'è)
function Find-SunshineLine([string]$text, [datetime]$after) {
  $pattern = '^\[(\d{4}-\d\d-\d\d \d\d:\d\d:\d\d)\.\d+\]: .*' + [regex]::Escape($text)
  foreach ($line in (Get-Content $cfg.sunshineLog -ErrorAction SilentlyContinue)) {
    if ($line -match $pattern) {
      $t = [datetime]::ParseExact($Matches[1], 'yyyy-MM-dd HH:mm:ss', [Globalization.CultureInfo]::InvariantCulture)
      if ($t -ge $after) { return $t }
    }
  }
  return $null
}

# Una volta al secondo: true se Moonlight si è collegato; finché Sunshine non è pronto la scadenza slitta
function Test-Sunshine {
  if (-not $useSunshine -or (Get-Date) -lt $script:nextSunshineCheck) { return $false }
  $script:nextSunshineCheck = (Get-Date).AddSeconds(1)
  if (Find-SunshineLine 'CLIENT CONNECTED' $countdownStart) { $script:activity = 'Moonlight'; return $true }
  if (-not $script:sunshineReady) {
    $ready = Find-SunshineLine 'Registered Sunshine mDNS service' $bootTime
    if ($ready) {
      $script:sunshineReady = $true
      $script:deadline = $countdownStart.AddSeconds($cfg.seconds)
      $until = $ready.AddSeconds($cfg.sunshineGraceSeconds)
      if ($until -gt $script:deadline) { $script:deadline = $until }
    } elseif ((Get-Date) -lt $countdownStart.AddSeconds($cfg.sunshineWaitMax)) {
      $script:deadline = [datetime]::MaxValue
    } else {
      # Out-Host: l'output di Write-Log finirebbe nel valore restituito
      Write-Log "Sunshine non pronto dopo $($cfg.sunshineWaitMax) s: proseguo senza aspettarlo" | Out-Host
      $script:sunshineReady = $true
      $script:deadline = (Get-Date).AddSeconds($cfg.seconds)
    }
  }
  return $false
}

$script:activity = ''
function Test-UserPresent {
  if ([UserInput]::LastInputTick() -ne $startTick) { $script:activity = 'mouse o tastiera'; return $true }
  if ([UserInput]::GamepadActivity()) { $script:activity = 'controller'; return $true }
  if (Test-Sunshine) { return $true }
  return $false
}

function Get-AgentConfig {
  $path = Join-Path $root 'agent\config.json'
  if (Test-Path $path) { return Get-Content $path -Raw | ConvertFrom-Json }
  return $null
}

function Test-Agent([int]$port) {
  try { Invoke-RestMethod -Uri "http://127.0.0.1:$port/api/health" -TimeoutSec 2 | Out-Null; return $true } catch { return $false }
}

function Set-Mode([string]$mode) {
  if (-not $DryRun) { Set-Content -Path $modeFile -Value $mode -Encoding ASCII }
}

function Enter-ServerMode {
  Write-Log 'Nessuna attività: passo in modalità server'
  Set-Mode 'server'
  if ($DryRun) { return }
  $agent = Get-AgentConfig
  $port = 7070
  if ($agent -and $agent.port) { $port = [int]$agent.port }
  if (-not (Test-Agent $port)) {
    & (Join-Path $here 'start-agent.ps1')
    for ($i = 0; $i -lt 30 -and -not (Test-Agent $port); $i++) { Start-Sleep -Seconds 2 }
  }
  if (-not (Test-Agent $port)) { Write-Log "L'agent non risponde sulla porta $port"; return }
  if (-not $agent) { Write-Log 'agent\config.json non trovato: non avvio le app'; return }
  $headers = @{ Authorization = "Bearer $($agent.token)" }
  foreach ($id in $cfg.serverApps) {
    try {
      Invoke-RestMethod -Method Post -Uri "http://127.0.0.1:$port/api/apps/$id/start" -Headers $headers -TimeoutSec 10 | Out-Null
      Write-Log "Avvio richiesto: $id"
    } catch {
      Write-Log "Avvio di $id non riuscito: $($_.Exception.Message)"
    }
  }
}

function Enter-XboxMode {
  Write-Log "Attività rilevata ($script:activity): resto in modalità Xbox"
  Set-Mode 'xbox'
}

if ($NoGui) {
  $present = $false
  while ((Get-Date) -lt $deadline) {
    if (Test-UserPresent) { $present = $true; break }
    Start-Sleep -Milliseconds 50
  }
  if ($present) { Enter-XboxMode } else { Enter-ServerMode }
  exit 0
}

Add-Type -AssemblyName System.Windows.Forms
Add-Type -AssemblyName System.Drawing

$form = New-Object System.Windows.Forms.Form
$form.FormBorderStyle = 'None'
$form.TopMost = $true
$form.ShowInTaskbar = $false
$form.StartPosition = 'Manual'
$form.BackColor = [System.Drawing.Color]::FromArgb(24, 30, 44)
$form.Opacity = 0.92
$form.Size = New-Object System.Drawing.Size(560, 150)
$screen = [System.Windows.Forms.Screen]::PrimaryScreen.WorkingArea
$form.Location = New-Object System.Drawing.Point(($screen.Left + ($screen.Width - 560) / 2), ($screen.Top + 60))

$label = New-Object System.Windows.Forms.Label
$label.Dock = 'Fill'
$label.TextAlign = 'MiddleCenter'
$label.ForeColor = [System.Drawing.Color]::White
$label.Font = New-Object System.Drawing.Font('Segoe UI', 15)
$form.Controls.Add($label)

$script:result = 'server'
$timer = New-Object System.Windows.Forms.Timer
$timer.Interval = 50
$timer.Add_Tick({
  if (Test-UserPresent) { $script:result = 'xbox'; $timer.Stop(); $form.Close(); return }
  if (-not $script:sunshineReady) {
    $label.Text = "Aspetto Sunshine prima del countdown`nMuovi il mouse, premi un tasto o collegati con Moonlight per restare in modalità Xbox"
    return
  }
  $left = [math]::Ceiling(($deadline - (Get-Date)).TotalSeconds)
  if ($left -le 0) { $timer.Stop(); $form.Close(); return }
  $label.Text = "Modalità server tra $left s`nMuovi il mouse, premi un tasto, usa il controller o Moonlight per restare in modalità Xbox"
})
$form.Add_Shown({ $timer.Start() })
[void]$form.ShowDialog()

if ($script:result -eq 'xbox') { Enter-XboxMode } else { Enter-ServerMode }
