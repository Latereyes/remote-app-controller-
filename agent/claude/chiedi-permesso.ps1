<#
  Chiede un permesso all'app PC Remoto da uno script PowerShell sul PC e aspetta la risposta.
  Esce con 0 se Andrea consente, 1 se rifiuta, 2 se nessuno risponde o l'agent è spento.

    powershell -File chiedi-permesso.ps1 -Titolo "Riavvio ComfyUI?" -Dettaglio "Serve per i nodi nuovi"
    if ($LASTEXITCODE -eq 0) { ... }
#>
param(
  [Parameter(Mandatory)][string]$Titolo,
  [string]$Dettaglio = '',
  [int]$Secondi = 600,
  [int]$Porta = 7070
)
$ErrorActionPreference = 'Stop'
$base = "http://127.0.0.1:$Porta"
try {
  $body = @{ source = 'PowerShell'; title = $Titolo; detail = $Dettaglio; timeoutSec = $Secondi } | ConvertTo-Json
  $req = Invoke-RestMethod -Method Post -Uri "$base/api/approvals/ask" -Body ([Text.Encoding]::UTF8.GetBytes($body)) -ContentType 'application/json; charset=utf-8'
  $fine = (Get-Date).AddSeconds($Secondi)
  $stato = $req.state
  while ($stato -eq 'pending' -and (Get-Date) -lt $fine) {
    $stato = (Invoke-RestMethod -Uri "$base/api/approvals/$($req.id)/wait?ms=20000" -TimeoutSec 30).state
  }
} catch {
  Write-Warning "Agent non raggiungibile: $($_.Exception.Message)"
  exit 2
}
switch ($stato) { 'allow' { exit 0 } 'deny' { exit 1 } default { exit 2 } }
