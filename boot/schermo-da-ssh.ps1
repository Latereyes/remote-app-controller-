<#
  Esegue schermo-pc.ps1 da ssh. Una sessione ssh non ha lo schermo del PC, quindi questo script
  lo fa girare nella sessione di chi ha fatto l'accesso al PC (con un'attività pianificata temporanea)
  e stampa qui il risultato. Funziona se lo stesso utente dell'ssh ha fatto l'accesso al PC
  (anche con il monitor nero). Non servono i permessi di amministratore.

  Uso (da ssh, in PowerShell, nella cartella del progetto):
    powershell -ExecutionPolicy Bypass -File boot\schermo-da-ssh.ps1 -Elenco   (mostra gli schermi, non cambia niente)
    powershell -ExecutionPolicy Bypass -File boot\schermo-da-ssh.ps1           (riporta l'immagine sul monitor)
#>
param([switch]$Elenco, [switch]$DryRun)

$ErrorActionPreference = 'Stop'
$here = Split-Path -Parent $MyInvocation.MyCommand.Path
$script = Join-Path $here 'schermo-pc.ps1'
$out = Join-Path $env:TEMP 'schermo-da-ssh.txt'
$name = 'RemoteAppController-Schermo'

# Chi ha fatto l'accesso al PC (davanti allo schermo, non da ssh)?
$consoleUser = (Get-CimInstance Win32_ComputerSystem).UserName
if (-not $consoleUser) {
  Write-Output 'Nessuno ha fatto l''accesso al PC: non c''è uno schermo da cambiare.'
  exit 1
}
# Nome completo dell'account (es. LATEREYES-PC\andre): in ssh $env:USERDOMAIN può non essere quello giusto
$me = [System.Security.Principal.WindowsIdentity]::GetCurrent().Name
if ($consoleUser -ne $me -and ($consoleUser -split '\\')[-1] -ne ($me -split '\\')[-1]) {
  Write-Output "Al PC ha fatto l'accesso $consoleUser, non $($me): entra in ssh con quell'utente."
  exit 1
}

$extra = @()
if ($Elenco) { $extra += '-Elenco' }
if ($DryRun) { $extra += '-DryRun' }
$q = { param($s) "'" + ($s -replace "'", "''") + "'" }
$cmd = "& $(& $q $script) $($extra -join ' ') *> $(& $q $out); exit `$LASTEXITCODE"
$ps = Join-Path $env:WINDIR 'System32\WindowsPowerShell\v1.0\powershell.exe'

Remove-Item $out -ErrorAction SilentlyContinue
$action = New-ScheduledTaskAction -Execute $ps -WorkingDirectory $here `
  -Argument "-NoProfile -WindowStyle Hidden -ExecutionPolicy Bypass -Command `"$cmd`""
$principal = New-ScheduledTaskPrincipal -UserId $consoleUser -LogonType Interactive -RunLevel Limited
Register-ScheduledTask -TaskName $name -Action $action -Principal $principal -Force | Out-Null
try {
  Start-ScheduledTask -TaskName $name
  $deadline = (Get-Date).AddSeconds(45)
  do {
    Start-Sleep -Milliseconds 500
    $state = (Get-ScheduledTask -TaskName $name).State
  } while ($state -eq 'Running' -and (Get-Date) -lt $deadline)
  Start-Sleep -Milliseconds 300

  if (Test-Path $out) { Get-Content $out | ForEach-Object { Write-Output $_ } }
  else { Write-Output 'Lo script non ha scritto niente: forse non è partito nella sessione del PC.' }
  if ($state -eq 'Running') { Write-Output 'Lo script è ancora in esecuzione dopo 45 s.'; exit 1 }
  $code = (Get-ScheduledTaskInfo -TaskName $name).LastTaskResult
  exit $code
} finally {
  Unregister-ScheduledTask -TaskName $name -Confirm:$false -ErrorAction SilentlyContinue
}
