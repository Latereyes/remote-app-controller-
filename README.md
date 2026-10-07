# Remote app controller

Accendere e gestire da fuori casa il PC con la GPU: un telefono vecchio in casa lo sveglia con Wake-on-LAN, il PC passa in modalità server se nessuno lo usa, e un'app Android avvia e ferma Ollama, ComfyUI, ChatBz e LocalAI. Tutto passa da una VPN privata (Tailscale), senza porte aperte sul router.

| Cartella | Cosa fa | Stato |
|---|---|---|
| `agent/` | servizio sul PC: API con token per avviare, fermare e controllare le app | ✅ prima versione |
| `boot/` | countdown di 30 s all'accensione e passaggio in modalità server | ✅ prima versione |
| `relay/` | relay Wake-on-LAN sul telefono vecchio (Termux) | ✅ prima versione |
| `android/` | app di gestione (Kotlin + Compose) | ✅ prima versione |

## Agent

Richiede Node.js 22 (lo stesso di ChatBz), nessuna dipendenza da installare.

```bat
cd agent
avvia-agent.bat
```

Al primo avvio crea `agent/config.json` dall'esempio e stampa il **token** da inserire nell'app. In `config.json` vanno controllati i percorsi delle app:

| App | Comando | Cartella (da verificare) |
|---|---|---|
| Ollama | `ollama serve` (se è già accesa dalla tray, viene solo rilevata) | — |
| ComfyUI | `venv\Scripts\python.exe main.py` + argomenti di Stability Matrix | `C:\IA\Packages\ComfyUI` |
| ChatBz | `start.bat` | `%USERPROFILE%\Documents\NEW CHATBZ\ChatBz2` |
| LocalAI | `start.bat` | `%USERPROFILE%\Documents\LocalAI` |

Ogni app ha un URL `health`: se risponde, l'app è considerata accesa (anche se l'ha avviata qualcun altro). `requires` avvia prima le dipendenze (ChatBz e LocalAI accendono Ollama e ComfyUI). `stop.url` è la chiusura gentile; se manca o non basta, l'agent chiude il processo con tutti i figli.

### API

Tutte le rotte tranne `/api/health` vogliono `Authorization: Bearer <token>`. Dopo 10 token sbagliati in un minuto lo stesso indirizzo riceve 429.

| Rotta | |
|---|---|
| `GET /api/health` | l'agent è acceso (senza token) |
| `GET /api/apps` | stato di tutte le app: `stopped`, `starting`, `running`, `stopping` |
| `GET /api/apps/:id` | stato di un'app |
| `POST /api/apps/:id/start` | avvio in background (risponde subito); con `?wait=1` aspetta che sia pronta |
| `POST /api/apps/:id/stop` | chiusura gentile, poi forzata |
| `GET /api/apps/:id/logs?lines=200` | ultime righe di output (solo app avviate dall'agent) |
| `GET /api/system` | PC, RAM, GPU (`nvidia-smi`) e modelli caricati in Ollama |
| `GET /api/gpu` | arbitro della GPU: chi la sta usando (app, lavoro), cosa c'è in coda, motore caricato |
| `POST /api/gpu/free` | al suo turno scarica i modelli di Ollama e libera la VRAM di ComfyUI |
| `POST /api/gpu/acquire` | chiede la GPU: `{ who: "ollama"\|"comfy"\|"none", app, label, priority: "high"\|"normal"\|"low" }`, poi `{ ticket }` finché non risponde `granted` |
| `POST /api/gpu/leases/:id/renew` · `release` | rinnova (entro 60 s) o restituisce il permesso; `release` su un biglietto in coda vi rinuncia |
| `POST /api/system/shutdown` · `restart` · `sleep` | alimentazione (parte dopo 1,5 s) |

Nota: `sleep` usa `SetSuspendState`, che iberna se l'ibernazione è attiva (`powercfg /h off` per avere la sospensione vera).

### Arbitro della GPU

Ollama e ComfyUI non stanno insieme nei 16 GB della scheda, e ChatBz e LocalAI li usano entrambi. L'agent fa da arbitro unico: ogni lavoro delle due app chiede il permesso, ne lavora **uno alla volta**, e quando tocca all'altro motore l'agent scarica i modelli di Ollama o svuota ComfyUI (solo quando serve: due immagini di fila non ricaricano niente). In coda passa prima la priorità (`high` la chat, `normal` le generazioni, `low` i lavori in sottofondo come il social di ChatBz), poi l'ordine di arrivo. Un lavoro già partito non viene interrotto.

Le rotte `/api/gpu*` funzionano anche **senza token, ma solo dal PC stesso** (127.0.0.1): ChatBz e LocalAI non vanno configurati. Un'app che si blocca perde il permesso dopo 60 s senza rinnovi; se l'agent è spento, le app tornano al loro arbitro interno. `/api/system` include lo stato dell'arbitro in `arbiter`.

### Test

```bash
cd agent && npm test
```

I test girano su Linux e Windows in GitHub Actions, con un'app finta al posto di quelle vere.

## App Android

L'APK si compila in GitHub Actions a ogni modifica di `android/` e finisce nella release **android-latest** (pagina *Releases* della repository): dal telefono si scarica `PC-Remoto.apk` e si installa consentendo le fonti sconosciute. Gli aggiornamenti si installano sopra la versione precedente, perché ogni build è firmata con la stessa chiave (`android/app/signing.keystore`, chiave per uso personale, non da Play Store).

Cosa fa:
- mostra se il PC è acceso, spento o in accensione, e lo accende tramite il relay del telefono di casa (`POST /wake`);
- elenca Ollama, ComfyUI, ChatBz e LocalAI con il loro stato, li avvia e li ferma, mostra i log e apre ChatBz o LocalAI nel browser;
- mostra VRAM, carico e temperatura della GPU e i modelli Ollama in memoria, con il pulsante "Libera VRAM";
- spegne, riavvia o sospende il PC (con conferma).

Al primo avvio chiede l'indirizzo dell'agent (es. `pc-casa:7070` con Tailscale) e il token, più indirizzo e token del relay. Lo stato si aggiorna ogni 5 secondi solo mentre l'app è aperta.

## Relay Wake-on-LAN (telefono vecchio)

Il pacchetto Wake-on-LAN è broadcast e non attraversa la VPN: lo manda il telefono vecchio, che sta in casa sulla stessa rete del PC. Serve Python su Termux, nessuna libreria esterna.

1. Installa **Termux** e **Termux:Boot** da F-Droid (non dal Play Store) e **Tailscale**; apri Termux:Boot una volta.
2. In Termux:
   ```sh
   pkg install -y python git
   git clone -b claude/project-thread-gwlfoj https://github.com/Latereyes/remote-app-controller- ~/remote-app-controller
   cd ~/remote-app-controller/relay && python wol_relay.py
   ```
   Il primo avvio crea `relay.json` e stampa il **token** per l'app. Ferma con Ctrl+C.
3. In `relay.json` imposta `mac` (MAC della scheda di rete cablata del PC), `broadcast` (es. `192.168.1.255`) e `pc_host` (IP del PC in casa).
4. Avvio automatico: `mkdir -p ~/.termux/boot && cp start-relay.sh ~/.termux/boot/`, poi riavvia il telefono.
5. Nelle impostazioni Android togli Termux e Tailscale dall'ottimizzazione della batteria e tieni il telefono in carica.

| Rotta | |
|---|---|
| `GET /health` | il relay è acceso (senza token) |
| `POST /wake` | manda il magic packet (3 volte, porte 9 e 7) |
| `GET /status` | il PC risponde sulla porta dell'agent? |

Test: `cd relay && python3 -m unittest -v`.

## Countdown e modalità server (`boot/`)

All'accesso automatico (modalità Xbox) compare in alto una finestra con un countdown di 30 secondi. Mouse, tastiera o controller Xbox lo interrompono e il PC resta in modalità Xbox. Se nessuno tocca niente, il PC passa in modalità server: si assicura che l'agent sia acceso e avvia le app in `serverApps` (di base Ollama e ComfyUI). La modalità scelta finisce in `boot/mode.txt`, e l'app la mostra.

Impostazioni in `boot/boot.json`: `seconds`, `serverApps`, `agentAlways` (se `true` l'agent parte a ogni accesso, così il PC si controlla anche in modalità Xbox).

Installazione (PowerShell nella cartella `boot`):

```powershell
powershell -ExecutionPolicy Bypass -File install.ps1            # registra le attività all'accesso
powershell -ExecutionPolicy Bypass -File countdown.ps1 -Seconds 10 -Force   # prova subito
powershell -ExecutionPolicy Bypass -File install.ps1 -Uninstall # rimuove tutto
```

Il registro è in `boot/boot.log`, quello dell'agent in `agent/agent.log`.

In modalità Xbox le attività "all'accesso" possono non partire. In quel caso basta richiamare `boot\avvia-tutto.bat` da uno script che parte con la modalità Xbox, per esempio aggiungendo `call "C:\AI\remote-app-controller\boot\avvia-tutto.bat"`. Si può chiamare più volte: il countdown decide una sola volta per accensione (`countdown.ps1 -Force` per riprovarlo a mano).
