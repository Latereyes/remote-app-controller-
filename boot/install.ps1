<#
  Registra le attività pianificate all'accesso dell'utente (quello dell'accesso automatico in modalità Xbox):
  - RemoteAppController-Agent: avvia l'agent (solo se "agentAlways" è true in boot.json)
  - RemoteAppController-Countdown: countdown di 30 s, 10 s dopo l'accesso
  Uso:  powershell -ExecutionPolicy Bypass -File install.ps1           (installa o aggiorna)
        powershell -ExecutionPolicy Bypass -File install.ps1 -Uninstall
#>
param([switch]$Uninstall)

$ErrorActionPreference = 'Stop'
$here = Split-Path -Parent $MyInvocation.MyCommand.Path
$names = @('RemoteAppController-Agent', 'RemoteAppController-Countdown')

foreach ($n in $names) {
  if (Get-ScheduledTask -TaskName $n -ErrorAction SilentlyContinue) { Unregister-ScheduledTask -TaskName $n -Confirm:$false }
}
if ($Uninstall) { Write-Output 'Attività rimosse.'; exit 0 }

$cfg = Get-Content (Join-Path $here 'boot.json') -Raw | ConvertFrom-Json
$user = "$env:USERDOMAIN\$env:USERNAME"
$ps = Join-Path $env:WINDIR 'System32\WindowsPowerShell\v1.0\powershell.exe'
$principal = New-ScheduledTaskPrincipal -UserId $user -LogonType Interactive -RunLevel Limited
$settings = New-ScheduledTaskSettingsSet -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries -ExecutionTimeLimit (New-TimeSpan -Minutes 10)

function Add-Task([string]$name, [string]$script, [string]$delay) {
  $action = New-ScheduledTaskAction -Execute $ps -WorkingDirectory $here `
    -Argument "-NoProfile -WindowStyle Hidden -ExecutionPolicy Bypass -File `"$(Join-Path $here $script)`""
  $trigger = New-ScheduledTaskTrigger -AtLogOn -User $user
  if ($delay) { $trigger.Delay = $delay }
  Register-ScheduledTask -TaskName $name -Action $action -Trigger $trigger -Principal $principal -Settings $settings | Out-Null
  Write-Output "Registrata: $name"
}

if ($cfg.agentAlways) { Add-Task 'RemoteAppController-Agent' 'start-agent.ps1' $null }
Add-Task 'RemoteAppController-Countdown' 'countdown.ps1' 'PT10S'
Write-Output "Fatto. Al prossimo accesso parte il countdown di $($cfg.seconds) s."
