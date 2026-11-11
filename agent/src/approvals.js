import { EventEmitter } from 'node:events';
import { randomBytes } from 'node:crypto';

/**
 * Richieste di autorizzazione dal PC verso l'app: Claude (hook PermissionRequest) o uno script PowerShell
 * chiedono «posso?», l'app mostra la richiesta e Andrea risponde Consenti o Rifiuta.
 * Una richiesta senza risposta scade dopo `timeoutMs`: chi l'ha fatta torna al suo comportamento normale
 * (per Claude: la domanda resta nel terminale e nell'app Claude).
 */
export class ApprovalQueue extends EventEmitter {
  constructor({ timeoutMs = 10 * 60000, keep = 50, log = console.log } = {}) {
    super();
    this.timeoutMs = timeoutMs;
    this.keep = keep;
    this.log = log;
    this.items = new Map();
  }

  ask({ source = 'PC', title, detail = '', tool = null, cwd = null, timeoutSec } = {}) {
    if (!title) throw Object.assign(new Error('manca "title"'), { status: 400 });
    this.sweep();
    const id = randomBytes(9).toString('base64url');
    const ms = Math.min(Math.max(Number(timeoutSec) * 1000 || this.timeoutMs, 5000), 60 * 60000);
    const item = {
      id,
      source: String(source).slice(0, 40),
      title: String(title).slice(0, 200),
      detail: String(detail).slice(0, 4000),
      tool: tool ? String(tool).slice(0, 80) : null,
      cwd: cwd ? String(cwd).slice(0, 300) : null,
      state: 'pending',
      by: null,
      createdAt: Date.now(),
      expiresAt: Date.now() + ms,
    };
    this.items.set(id, item);
    this.log(`[permessi] ${item.source}: ${item.title}`);
    this.emit('change');
    return this.view(item);
  }

  view(i) { return { ...i }; }

  get(id) {
    this.sweep();
    const i = this.items.get(id);
    if (!i) throw Object.assign(new Error('richiesta sconosciuta'), { status: 404 });
    return i;
  }

  pending() {
    this.sweep();
    return [...this.items.values()].filter((i) => i.state === 'pending').map((i) => this.view(i));
  }

  decide(id, allow, by = 'app') {
    const i = this.get(id);
    if (i.state !== 'pending') throw Object.assign(new Error(`richiesta già ${i.state === 'expired' ? 'scaduta' : 'decisa'}`), { status: 409 });
    i.state = allow ? 'allow' : 'deny';
    i.by = by;
    this.log(`[permessi] ${allow ? 'consentito' : 'rifiutato'} da ${by}: ${i.title}`);
    this.emit('change');
    this.emit(`done:${id}`);
    return this.view(i);
  }

  /** Aspetta la risposta fino a `waitMs` e restituisce la richiesta (state: pending | allow | deny | expired). */
  async wait(id, waitMs = 20000) {
    const i = this.get(id);
    if (i.state === 'pending') {
      const ms = Math.max(0, Math.min(waitMs, 25000, i.expiresAt - Date.now()));
      await new Promise((resolve) => {
        const done = () => { clearTimeout(t); this.off(`done:${id}`, done); resolve(); };
        const t = setTimeout(done, ms);
        this.on(`done:${id}`, done);
      });
    }
    this.sweep();
    return this.view(i);
  }

  /** Scadenze e pulizia: tiene solo le ultime `keep` richieste già chiuse. */
  sweep() {
    const now = Date.now();
    for (const i of this.items.values()) {
      if (i.state === 'pending' && now >= i.expiresAt) { i.state = 'expired'; this.emit(`done:${i.id}`); this.emit('change'); }
    }
    const closed = [...this.items.values()].filter((i) => i.state !== 'pending');
    for (const i of closed.slice(0, Math.max(0, closed.length - this.keep))) this.items.delete(i.id);
  }
}
