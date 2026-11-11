# Prova sul PC: monitor, terminale, Claude remoto, modalità gioco

Data: 11 novembre 2026. Branch `claude/project-thread-jltnvf` (parte da `claude/project-thread-w2pwz7`, quello già sul PC).

Ordine: prima l'agent sul PC, poi l'APK. Un'app nuova con l'agent vecchio funziona, ma senza i pannelli nuovi.

## 1. Aggiornare l'agent sul PC

PowerShell in `C:\AI\remote-app-controller`:

```powershell
git fetch origin claude/project-thread-jltnvf
git checkout claude/project-thread-jltnvf
cd agent; npm test          # deve finire con "fail 0"
```

Riavvio dell'agent: chiudi il processo `node server.js` (Gestione attività, o `Stop-Process` sul PID in ascolto sulla 7070) e rilancia `powershell -File ..\boot\start-agent.ps1`.

Facoltativo in `agent/config.json` (senza queste righe valgono i valori di base):

```json
"terminal": { "enabled": true, "cwd": "%USERPROFILE%" },
"claude":   { "enabled": true, "command": "claude", "cwd": "C:\\AI", "name": "PC di casa", "approvals": true, "approvalTimeoutSec": 600 }
```

Prova veloce dal PC (con il token di `config.json`):

```powershell
$h = @{ Authorization = "Bearer <token>" }
irm http://127.0.0.1:7070/api/displays -Headers $h | ConvertTo-Json -Depth 5
irm http://127.0.0.1:7070/api/gaming   -Headers $h | ConvertTo-Json -Depth 5
irm http://127.0.0.1:7070/api/claude   -Headers $h
```

## 2. Installare l'APK

Dal Pixel: release **android-latest** della repository, `PC-Remoto.apk`, installa sopra la versione attuale. Alla prima pressione di «Avvia Claude» l'app chiede il permesso per le notifiche: consentilo.

## 3. Cosa provare

| # | Prova | Risultato atteso |
|---|---|---|
| 1 | Pannello **Monitor** con la TV accesa | TV «acceso», schermo virtuale «spento» o assente |
| 2 | Collegati con Moonlight dalla Deck | sul monitor che trasmette compare **MOONLIGHT**; in alto «in stream con Moonlight» |
| 3 | TV spenta, avvio dal Deck | resta acceso solo «VDD by MTT (virtuale)» con MOONLIGHT |
| 4 | Apri un gioco Steam e guarda **Modalità gioco** | nome del gioco, carico GPU, temperatura, watt, frequenze, VRAM, encoder, CPU, RAM; si aggiorna ogni 2 s |
| 5 | **Terminale** → `nvidia-smi` o i tasti rapidi | output nella schermata; le lettere accentate si leggono bene |
| 6 | Terminale col telefono sul Wi-Fi di casa **senza** Tailscale (indirizzo 192.168.1.x) | errore «solo attraverso Tailscale» |
| 7 | **Avvia Claude** | sul PC si apre la finestra «Claude remoto»; nell'app Claude compare la sessione «PC di casa» |
| 8 | Dall'app Claude chiedi un comando PowerShell che vuole il permesso | in PC Remoto arriva il pannello **Permessi richiesti** e una notifica con Consenti / Rifiuta; la risposta sblocca Claude |
| 9 | Nessuna risposta per 10 minuti | la domanda torna nel terminale e nell'app Claude come sempre |
| 10 | **Chiudi** nel pannello Claude | la finestra sul PC si chiude, la notifica fissa sparisce entro 15 s |

Script PowerShell che vogliono un permesso possono chiederlo allo stesso modo:

```powershell
powershell -File C:\AI\remote-app-controller\agent\claude\chiedi-permesso.ps1 -Titolo "Riavvio ComfyUI?" -Dettaglio "Serve per i nodi nuovi"
$LASTEXITCODE   # 0 consentito, 1 rifiutato, 2 nessuna risposta
```

## Cose da sapere

- **Prima volta di Claude in `C:\AI`**: se Claude chiede «Trust this folder?» o di accettare il controllo remoto, va risposto una volta nella finestra sul PC (con Moonlight o davanti al PC). Dopo non lo chiede più.
- **Sicurezza**: terminale, Claude e permessi sono solo per Andrea (amministratore) e solo da indirizzi Tailscale (100.64.0.0/10) o dal PC stesso. Ogni comando del terminale finisce in `agent/agent.log`. Il terminale si chiude da solo dopo 15 minuti senza uso.
- **Terminale senza console vera**: i programmi che chiedono conferme a schermo non funzionano (usa `-Confirm:$false`, `-Force`). Per fermare un comando bloccato c'è il tasto ↻ in alto, che chiude e riapre la shell.
- **FPS**: non ci sono. Servirebbe PresentMon sul PC; se lo vuoi si aggiunge.
- **Gioco in corso**: si legge da Steam (registro, `RunningAppID`). Giochi fuori da Steam non hanno il nome, ma con Moonlight collegato il pannello compare lo stesso.
- In modalità Xbox l'avvio di Claude apre la finestra sul desktop, dietro la schermata Xbox: Claude funziona lo stesso.

## Se qualcosa non va

Mandami queste righe:

```powershell
Get-Content C:\AI\remote-app-controller\agent\agent.log -Tail 50
Get-Content C:\AI\remote-app-controller\agent\agent-errori.log -Tail 30
& 'C:\tools\MultiMonitorTool.exe' /scomma $env:TEMP\m.csv; Get-Content $env:TEMP\m.csv
nvidia-smi --query-gpu=name,utilization.encoder,clocks_throttle_reasons.active --format=csv
```
