import { randomBytes } from 'node:crypto';
import { processTools } from './proc.js';

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const ANSI = /\x1b\[[0-9;?]*[A-Za-z]/g;

class HttpError extends Error {
  constructor(status, message) { super(message); this.status = status; }
}

/**
 * Gestisce le app del PC: stato (dal controllo di salute), avvio con le dipendenze, arresto, log.
 * Un'app può essere "gestita" (avviata dall'agent, con PID e log) oppure "esterna"
 * (già accesa per conto suo, es. Ollama dalla tray): in quel caso si vede che è su ma non ci sono log.
 */
export class AppManager {
  #apps;
  #st = new Map();
  #tools;
  #opts;

  constructor(apps, { tools = processTools, logLines = 500, pollMs = 1000, stopTimeoutMs = 15000, selfPid = process.pid } = {}) {
    this.#apps = new Map(apps.map((a) => [a.id, a]));
    this.#tools = tools;
    this.#opts = { logLines, pollMs, stopTimeoutMs, selfPid };
    for (const a of apps) this.#st.set(a.id, { child: null, logs: [], startedAt: null, phase: null, lastError: null, exitCode: null, controlToken: null });
  }

  #app(id) {
    const app = this.#apps.get(id);
    if (!app) throw new HttpError(404, `app sconosciuta: ${id}`);
    return app;
  }

  ids() { return [...this.#apps.keys()]; }

  async status(id) {
    const app = this.#app(id);
    const st = this.#st.get(id);
    const healthy = await this.#tools.probe(app.health);
    const managed = !!st.child;
    let state;
    if (st.phase === 'stopping') state = 'stopping';
    else if (healthy) state = 'running';
    else if (managed || st.phase === 'starting') state = 'starting';
    else state = 'stopped';
    return {
      id: app.id,
      name: app.name,
      state,
      managed,
      pid: st.child?.pid ?? null,
      port: app.port,
      openUrl: app.openUrl,
      requires: app.requires,
      startedAt: st.startedAt,
      exitCode: st.exitCode,
      lastError: st.lastError,
    };
  }

  list() { return Promise.all(this.ids().map((id) => this.status(id))); }

  logs(id, lines = 200) {
    this.#app(id);
    return this.#st.get(id).logs.slice(-Math.max(1, Math.min(lines, this.#opts.logLines)));
  }

  #log(st, chunk) {
    const text = chunk.toString('utf8').replace(ANSI, '');
    for (const line of text.split(/\r?\n/)) {
      if (!line.trim()) continue;
      st.logs.push(`${new Date().toISOString().slice(11, 19)} ${line}`);
    }
    if (st.logs.length > this.#opts.logLines) st.logs.splice(0, st.logs.length - this.#opts.logLines);
  }

  async waitFor(id, wantUp, timeoutMs) {
    const app = this.#app(id);
    const end = Date.now() + timeoutMs;
    while (Date.now() < end) {
      if ((await this.#tools.probe(app.health)) === wantUp) return true;
      if (wantUp && !this.#st.get(id).child && this.#st.get(id).exitCode !== null) return false; // è già uscita
      await sleep(this.#opts.pollMs);
    }
    return false;
  }

  /**
   * Avvia l'app (prima le sue dipendenze) e aspetta che risponda.
   * Se è già accesa non fa nulla. Lancia un errore se non parte entro startTimeoutSec.
   */
  async start(id, chain = []) {
    const app = this.#app(id);
    if (chain.includes(id)) throw new HttpError(400, `dipendenze circolari: ${[...chain, id].join(' → ')}`);
    const st = this.#st.get(id);
    for (const dep of app.requires) await this.start(dep, [...chain, id]);

    if (await this.#tools.probe(app.health)) return this.status(id);
    if (!st.child) {
      st.phase = 'starting';
      st.lastError = null;
      st.exitCode = null;
      st.controlToken = randomBytes(18).toString('base64url');
      let child;
      try {
        child = this.#tools.spawnApp(app, { CONTROL_TOKEN: st.controlToken });
      } catch (e) {
        st.phase = null;
        st.lastError = e.message;
        throw new HttpError(500, `impossibile avviare ${app.name}: ${e.message}`);
      }
      st.child = child;
      st.startedAt = Date.now();
      st.logs.push(`--- avvio ${app.name}: ${app.command} ${app.args.join(' ')}`);
      child.stdout?.on('data', (c) => this.#log(st, c));
      child.stderr?.on('data', (c) => this.#log(st, c));
      child.on('error', (e) => { st.lastError = e.message; this.#log(st, `errore: ${e.message}`); });
      child.on('exit', (code) => {
        if (st.child !== child) return;
        st.child = null;
        st.exitCode = code;
        st.logs.push(`--- ${app.name} terminata (codice ${code})`);
      });
    }
    const ok = await this.waitFor(id, true, app.startTimeoutSec * 1000);
    st.phase = null;
    if (!ok) {
      st.lastError = st.lastError || (st.child ? `non risponde dopo ${app.startTimeoutSec} s` : `si è chiusa subito (codice ${st.exitCode})`);
      throw new HttpError(504, `${app.name}: ${st.lastError}`);
    }
    return this.status(id);
  }

  /**
   * Ferma l'app: prima la richiesta di chiusura gentile (se configurata), poi chiude il processo.
   * Per le app esterne usa i nomi dei processi o, in mancanza, il PID in ascolto sulla porta.
   */
  async stop(id) {
    const app = this.#app(id);
    const st = this.#st.get(id);
    st.phase = 'stopping';
    try {
      if (app.stop?.url && (await this.#tools.probe(app.health))) {
        try {
          const res = await fetch(app.stop.url, {
            method: app.stop.method || 'POST',
            headers: st.controlToken ? { 'X-Control-Token': st.controlToken } : {},
            signal: AbortSignal.timeout(5000),
          });
          await res.body?.cancel();
          if (res.ok) await this.waitFor(id, false, this.#opts.stopTimeoutMs);
        } catch {}
      }
      if (await this.#tools.probe(app.health) || st.child) {
        if (st.child) await this.#tools.killTree(st.child.pid);
        else if (app.processNames.length) await this.#tools.killByName(app.processNames);
        else {
          const pid = await this.#tools.pidOnPort(app.port);
          if (pid && pid !== this.#opts.selfPid) await this.#tools.killTree(pid);
        }
      }
      const down = await this.waitFor(id, false, this.#opts.stopTimeoutMs);
      if (!down) {
        st.lastError = 'risponde ancora dopo la chiusura';
        throw new HttpError(500, `${app.name}: ${st.lastError}`);
      }
      // Il processo può uscire un attimo dopo aver chiuso la porta: aspetto l'evento di uscita
      for (let t = 0; st.child && t < 3000; t += 50) await sleep(50);
      st.phase = null;
      return await this.status(id);
    } finally {
      st.phase = null;
    }
  }
}

export { HttpError };
