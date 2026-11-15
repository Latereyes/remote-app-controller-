# Prova sul PC: FPS dei giochi, app in due gruppi, Japonika

Data: 11 novembre 2026. Branch `claude/project-thread-pl819v` (parte da `claude/project-thread-jltnvf`, quello già sul PC).

Ordine: prima l'agent sul PC, poi l'APK. L'APK nuovo con l'agent vecchio funziona: le app si dividono lo stesso nei due gruppi, ma niente FPS né Japonika.

## 1. Aggiornare l'agent

PowerShell in `C:\AI\remote-app-controller`:

```powershell
git fetch origin claude/project-thread-pl819v
git checkout claude/project-thread-pl819v
cd agent; npm test          # deve finire con "fail 0"
```

Aggiungi Japonika in fondo a `"apps"` in `agent/config.json` (il file vero, non l'esempio):

```json
{
  "id": "japonika",
  "name": "Japonika",
  "kind": "app",
  "command": "node",
  "args": ["server.mjs"],
  "cwd": "C:\\AI\\JAPONIKA\\app",
  "health": "http://127.0.0.1:8765/",
  "port": 8765,
  "openUrl": "https://<nome-pc>.<tailnet>.ts.net:8445/",
  "startTimeoutSec": 30
}
```

`openUrl` è l'indirizzo che `tailscale serve` già pubblica (lo vedi con `tailscale serve status`) per Japonika (8445 → 127.0.0.1:8765); il server di Japonika ascolta solo sul PC, quindi dal telefono si passa sempre da lì. Japonika non dipende da Ollama: il tutor lo usa se è acceso, il resto funziona senza.

Facoltativo: `"kind": "engine"` su Ollama e ComfyUI e `"kind": "app"` sulle altre (senza, l'agent li riconosce dall'id).

Riavvio dell'agent: chiudi `node server.js` (PID in ascolto sulla 7070) e rilancia `powershell -File ..\boot\start-agent.ps1`.

## 2. Installare PresentMon (una volta)

PowerShell **come amministratore** in `C:\AI\remote-app-controller\boot`:

```powershell
powershell -ExecutionPolicy Bypass -File installa-presentmon.ps1
```

Fa tre cose: scarica PresentMon (Intel, l'eseguibile firmato dalla release ufficiale su GitHub) in `tools\PresentMon.exe`, controlla la firma, e mette l'utente nel gruppo **Performance Log Users**: senza, l'agent (che gira come utente normale) non può leggere i frame. Alla fine fa una prova di 3 secondi e deve dire «PresentMon funziona».

Poi **esci dall'account o riavvia il PC**: il permesso del gruppo vale dal prossimo accesso.

PresentMon non resta acceso: l'agent lo avvia solo quando c'è un gioco di Steam aperto, uno stream di Moonlight o il PC è in modalità Xbox, e lo chiude dopo un minuto che nessuno guarda il pannello gioco. Per toglierlo: `installa-presentmon.ps1 -Disattiva`.

## 3. Prove

Prova veloce dal PC (con il token di `config.json`):

```powershell
$h = @{ Authorization = "Bearer <token>" }
(irm http://127.0.0.1:7070/api/apps -Headers $h) | ft id, kind, state
(irm http://127.0.0.1:7070/api/gaming -Headers $h).fps
```

| Prova | Cosa deve succedere |
|---|---|
| Elenco app | `japonika` con `kind` = `app` e stato `running` se è già accesa; `ollama` e `comfy` con `engine`. |
| App, gruppi | Nell'app: in alto «MOTORI AI» con Ollama e ComfyUI in schede blu col bordo e l'etichetta «MOTORE GPU»; sotto «APP» con ChatBz (rosa), LocalAI (verde), Japonika (arancio, sigla 日), ognuna con una striscia del suo colore. |
| Japonika, Ferma | La scheda passa a «ferma» e la 8765 non risponde più (`irm http://127.0.0.1:8765/` dà errore). |
| Japonika, Avvia | Torna «attiva» in pochi secondi; **Apri** apre Japonika nel browser del telefono (con Tailscale acceso). **Log** mostra la riga «Japonika companion su http://127.0.0.1:8765». |
| FPS senza gioco | Pannello gioco in modalità Xbox: «Misuro gli FPS…»; fuori dalla modalità Xbox e senza giochi: «Gli FPS si misurano appena parte un gioco». |
| FPS in gioco | Apri un gioco di Steam: entro 2-3 s il numero grande degli FPS (verde da 60, giallo da 30, rosso sotto), «1% low», ms per frame e il nome del processo (`Gioco.exe`). Con V-Sync o limite del monitor compare anche «N mostrati». |
| FPS senza permessi | Se non hai rifatto l'accesso dopo lo script: «FPS non disponibili: PresentMon non ha i permessi…». |

Se il numero degli FPS indica il processo sbagliato (un overlay, un launcher), scrivimi il nome che compare: va aggiunto alla lista dei processi che non sono giochi in `agent/src/fps.js` (`NOT_GAMES`).
