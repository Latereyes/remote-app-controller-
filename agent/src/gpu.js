import { EventEmitter } from 'node:events';
import { randomBytes } from 'node:crypto';

/** Priorità delle richieste: più basso = prima. Si accettano anche i nomi. */
export const PRIORITY = { high: 0, normal: 1, low: 2 };
const parsePriority = (p) => (typeof p === 'number' ? Math.max(0, Math.min(2, Math.round(p))) : PRIORITY[p] ?? PRIORITY.normal);
const WHO = new Set(['ollama', 'comfy', 'none']);

class HttpError extends Error {
  constructor(status, message) { super(message); this.status = status; }
}

/**
 * Arbitro della GPU condivisa da tutte le app del PC (ChatBz, LocalAI, ...).
 * Ollama e ComfyUI non stanno insieme nei 16 GB: un solo lavoro alla volta ha la GPU (il "permesso"),
 * e quando cambia chi la usa l'altro viene scaricato. Il passaggio è pigro, come negli arbitri delle app:
 * ComfyUI resta carico finché non serve di nuovo Ollama, e viceversa.
 *
 * Le app chiedono un biglietto, aspettano il proprio turno (prima la priorità, poi l'ordine di arrivo),
 * rinnovano il permesso mentre lavorano e lo restituiscono alla fine. Un'app che si blocca o si chiude
 * perde il permesso dopo `leaseMs` senza rinnovi; un biglietto che nessuno ricontrolla scade dopo `ticketMs`.
 */
export class GpuArbiter extends EventEmitter {
  owner = null;       // 'ollama' | 'comfy' | null (sconosciuto)
  active = null;      // biglietto che ha la GPU
  #queue = [];
  #seq = 0;
  #pumping = false;
  #unload;
  #opts;

  constructor({ unload, leaseMs = 60000, ticketMs = 45000, now = Date.now, log = console.log } = {}) {
    super();
    this.#unload = unload;
    this.#opts = { leaseMs, ticketMs, now, log };
  }

  #view(t) {
    if (!t) return null;
    return { id: t.id, app: t.app, who: t.who, label: t.label, priority: t.priority, phase: t.phase, since: t.grantedAt || t.createdAt };
  }

  state() {
    return { owner: this.owner, active: this.#view(this.active), queue: this.#queue.map((t) => this.#view(t)) };
  }

  /** La GPU è libera e nessuno aspetta (le app la usano per i lavori in sottofondo). */
  idle() { return !this.active && !this.#queue.length; }

  #emit() { this.emit('state', this.state()); }

  /** Nuovo biglietto in coda. */
  request({ who = 'none', app = 'sconosciuta', label = '', priority } = {}) {
    if (!WHO.has(who)) throw new HttpError(400, `"who" deve essere ollama, comfy o none (non ${JSON.stringify(who)})`);
    const now = this.#opts.now();
    const t = {
      id: randomBytes(9).toString('base64url'),
      who, app: String(app).slice(0, 40), label: String(label).slice(0, 120),
      priority: parsePriority(priority), seq: ++this.#seq,
      createdAt: now, seenAt: now, grantedAt: null, expiresAt: null, phase: 'waiting', waiters: new Set(),
    };
    this.#queue.push(t);
    this.#queue.sort((a, b) => a.priority - b.priority || a.seq - b.seq);
    this.#emit();
    this.#pump();
    return t.id;
  }

  #find(id) {
    if (this.active?.id === id) return this.active;
    const t = this.#queue.find((x) => x.id === id);
    if (!t) throw new HttpError(404, 'biglietto sconosciuto o scaduto');
    return t;
  }

  /** Risposta per l'app: permesso concesso oppure posizione in coda e chi sta usando la GPU. */
  #status(t) {
    if (t.phase === 'granted') return { status: 'granted', lease: t.id, owner: this.owner, expiresInMs: t.expiresAt - this.#opts.now() };
    return {
      status: 'waiting', ticket: t.id,
      position: t === this.active ? 0 : this.#queue.indexOf(t) + 1,
      active: this.#view(this.active),
    };
  }

  /** Attende fino a `ms` che il biglietto ottenga la GPU (attesa lunga: l'app richiama finché non tocca a lei). */
  async wait(id, ms = 20000) {
    const t = this.#find(id);
    t.seenAt = this.#opts.now();
    if (t.phase !== 'granted') {
      await new Promise((resolve) => {
        const timer = setTimeout(done, Math.max(0, ms));
        function done() { clearTimeout(timer); t.waiters.delete(done); resolve(); }
        t.waiters.add(done);
      });
      t.seenAt = this.#opts.now();
    }
    return this.#status(t);
  }

  renew(id) {
    const t = this.#find(id);
    if (t.phase !== 'granted') throw new HttpError(409, 'il biglietto non ha ancora la GPU');
    t.expiresAt = this.#opts.now() + this.#opts.leaseMs;
    return { ok: true, expiresInMs: this.#opts.leaseMs };
  }

  /** Restituisce la GPU (o rinuncia al biglietto in coda). */
  release(id) {
    if (this.active?.id === id) {
      this.#finish(this.active);
    } else {
      const i = this.#queue.findIndex((x) => x.id === id);
      if (i < 0) return { ok: false };
      const [t] = this.#queue.splice(i, 1);
      for (const w of t.waiters) w();
      this.#emit();
    }
    return { ok: true };
  }

  #finish(t) {
    if (this.active !== t) return;
    this.active = null;
    for (const w of t.waiters) w();
    this.#emit();
    this.#pump();
  }

  /** Scade i permessi non rinnovati e i biglietti abbandonati (da chiamare periodicamente). */
  sweep() {
    const now = this.#opts.now();
    const a = this.active;
    if (a?.phase === 'granted' && a.expiresAt < now) {
      this.#opts.log(`[gpu] ${a.app} non ha rinnovato il permesso ("${a.label}"): GPU ripresa`);
      this.#finish(a);
    }
    const stale = this.#queue.filter((t) => now - t.seenAt > this.#opts.ticketMs);
    if (stale.length) {
      this.#queue = this.#queue.filter((t) => !stale.includes(t));
      this.#emit();
      this.#pump();
    }
  }

  async #pump() {
    if (this.#pumping || this.active || !this.#queue.length) return;
    this.#pumping = true;
    try {
      const t = this.#queue.shift();
      this.active = t;
      if (t.who !== 'none' && t.who !== this.owner) {
        t.phase = 'switching';
        this.#emit();
        try {
          // Libera la VRAM dall'altro: ComfyUI se tocca a Ollama, Ollama se tocca a ComfyUI
          if (t.who === 'comfy') await this.#unload.ollama();
          else await this.#unload.comfy();
        } catch (e) {
          this.#opts.log(`[gpu] passaggio a ${t.who}: ${e.message}`);
        }
        this.owner = t.who;
      }
      if (this.active === t) {   // nel frattempo l'app potrebbe aver rinunciato
        t.phase = 'granted';
        t.grantedAt = this.#opts.now();
        t.expiresAt = t.grantedAt + this.#opts.leaseMs;
        this.#emit();
        for (const w of t.waiters) w();
      }
    } finally {
      this.#pumping = false;
    }
    if (!this.active) this.#pump();
  }

  /** Libera tutta la VRAM al proprio turno (pulsante dell'app Android). */
  async free({ priority = 'high' } = {}) {
    const id = this.request({ who: 'none', app: 'agent', label: 'Libera VRAM', priority });
    try {
      while ((await this.wait(id, 20000)).status !== 'granted');
      const result = {};
      result.ollama = await this.#unload.ollama().catch((e) => ({ error: e.message }));
      result.comfy = await this.#unload.comfy().catch((e) => ({ error: e.message }));
      this.owner = null;
      return result;
    } finally {
      this.release(id);
    }
  }
}
