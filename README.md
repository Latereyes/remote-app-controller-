# Remote app controller

Accendere e gestire da fuori casa il PC con la GPU: un telefono vecchio in casa lo sveglia con Wake-on-LAN, il PC passa in modalità server se nessuno lo usa, e un'app Android avvia e ferma Ollama, ComfyUI, ChatBz e LocalAI. Tutto passa da una VPN privata (Tailscale), senza porte aperte sul router.

| Cartella | Cosa fa | Stato |
|---|---|---|
| `agent/` | servizio sul PC: API con token per avviare, fermare e controllare le app | ✅ prima versione |
| `boot/` | countdown di 30 s all'accensione e passaggio in modalità server | da fare |
| `relay/` | relay Wake-on-LAN sul telefono vecchio (Termux) | da fare |
| `android/` | app di gestione | da fare |

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
| ComfyUI | `venv\Scripts\python.exe main.py --listen 127.0.0.1 --port 8188` | `C:\AI\Stability Matrix\Packages\ComfyUI` |
| ChatBz | `start.bat` | `%USERPROFILE%\Documents\Chat-Bz` |
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
| `POST /api/gpu/free` | scarica i modelli di Ollama e libera la VRAM di ComfyUI |
| `POST /api/system/shutdown` · `restart` · `sleep` | alimentazione (parte dopo 1,5 s) |

Nota: `sleep` usa `SetSuspendState`, che iberna se l'ibernazione è attiva (`powercfg /h off` per avere la sospensione vera).

### Test

```bash
cd agent && npm test
```

I test girano su Linux e Windows in GitHub Actions, con un'app finta al posto di quelle vere.
