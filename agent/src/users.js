import fs from 'node:fs';
import path from 'node:path';
import { randomBytes, scrypt, timingSafeEqual, createHash } from 'node:crypto';
import { promisify } from 'node:util';

const scryptAsync = promisify(scrypt);
const sha = (s) => createHash('sha256').update(String(s)).digest('hex');

export const ADMIN_NAME = 'Andrea';
const SESSION_DAYS = 180;
const MIN_PASSWORD = 8;
const DUMMY_HASH = `scrypt$${'A'.repeat(22)}$${'A'.repeat(43)}`;

class HttpError extends Error {
  constructor(status, message) { super(message); this.status = status; }
}

/** Hash della password: scrypt con sale casuale, "scrypt$<sale>$<hash>". La password non si salva mai. */
export async function hashPassword(password) {
  const salt = randomBytes(16);
  const hash = await scryptAsync(String(password), salt, 32);
  return `scrypt$${salt.toString('base64url')}$${hash.toString('base64url')}`;
}

export async function checkPassword(password, stored) {
  const [kind, salt, hash] = String(stored || '').split('$');
  if (kind !== 'scrypt' || !salt || !hash) return false;
  const want = Buffer.from(hash, 'base64url');
  const got = await scryptAsync(String(password), Buffer.from(salt, 'base64url'), want.length);
  return timingSafeEqual(got, want);
}

function validPassword(p) {
  if (typeof p !== 'string' || p.length < MIN_PASSWORD) throw new HttpError(400, `la password deve avere almeno ${MIN_PASSWORD} caratteri`);
  return p;
}

function validName(n) {
  const name = typeof n === 'string' ? n.trim() : '';
  if (!/^[\p{L}\p{N} ._-]{2,32}$/u.test(name)) throw new HttpError(400, 'nome non valido (da 2 a 32 lettere, numeri, spazi, punto, trattino)');
  return name;
}

/**
 * Utenti dell'app Android, in users.json accanto a config.json.
 * Andrea è l'amministratore: vede tutto e decide quali app può avviare ogni altro utente.
 * Al primo avvio Andrea non ha password: la sceglie dall'app (con il token dell'agent) o dal PC stesso.
 * Le sessioni si salvano solo come hash del token, così chi legge il file non può entrare.
 */
export class UserStore {
  #file;
  #data;
  #now;

  constructor(file, { now = Date.now } = {}) {
    this.#file = file;
    this.#now = now;
    this.#data = { users: [], sessions: [] };
    try { this.#data = { users: [], sessions: [], ...JSON.parse(fs.readFileSync(file, 'utf8')) }; } catch (e) {
      if (e.code !== 'ENOENT') throw new Error(`${path.basename(file)} non valido: ${e.message}`);
    }
    if (!this.#data.users.some((u) => u.role === 'admin')) {
      this.#data.users.unshift({ name: ADMIN_NAME, role: 'admin', apps: [], password: null, createdAt: this.#now() });
      this.#save();
    }
  }

  #save() {
    const tmp = `${this.#file}.tmp`;
    fs.writeFileSync(tmp, JSON.stringify(this.#data, null, 2) + '\n');
    fs.renameSync(tmp, this.#file);
  }

  #find(name) {
    const key = String(name || '').trim().toLowerCase();
    return this.#data.users.find((u) => u.name.toLowerCase() === key) || null;
  }

  #get(name) {
    const u = this.#find(name);
    if (!u) throw new HttpError(404, 'utente sconosciuto');
    return u;
  }

  #view(u) { return { name: u.name, role: u.role, apps: u.role === 'admin' ? null : [...u.apps] }; }

  #newSession(u) {
    const token = randomBytes(32).toString('base64url');
    const now = this.#now();
    this.#data.sessions = this.#data.sessions.filter((s) => s.expiresAt > now);
    this.#data.sessions.push({ id: sha(token), user: u.name, expiresAt: now + SESSION_DAYS * 86400000 });
    this.#save();
    return { token, user: this.#view(u) };
  }

  #dropSessions(name) {
    this.#data.sessions = this.#data.sessions.filter((s) => s.user.toLowerCase() !== name.toLowerCase());
  }

  /** L'amministratore deve ancora scegliere la password. */
  needsSetup() { return this.#data.users.some((u) => u.role === 'admin' && !u.password); }

  /** Primo avvio: password dell'amministratore, solo se non ce n'è ancora una. */
  async setup(password) {
    const admin = this.#data.users.find((u) => u.role === 'admin' && !u.password);
    if (!admin) throw new HttpError(409, 'la password dell\'amministratore è già impostata');
    admin.password = await hashPassword(validPassword(password));
    return this.#newSession(admin);
  }

  /** Nome e password giusti → { token, user }; altrimenti null. */
  async login(name, password) {
    const u = this.#find(name);
    // Anche con un nome sbagliato si calcola un hash, così il tempo di risposta non dice se l'utente esiste
    const ok = await checkPassword(password ?? '', u?.password || DUMMY_HASH);
    return u?.password && ok ? this.#newSession(u) : null;
  }

  /** Utente del token di sessione, o null se il token non vale (sconosciuto o scaduto). */
  verify(token) {
    if (!token) return null;
    const id = sha(token);
    const s = this.#data.sessions.find((x) => x.id === id && x.expiresAt > this.#now());
    const u = s && this.#find(s.user);
    return u ? this.#view(u) : null;
  }

  logout(token) {
    const id = sha(token);
    this.#data.sessions = this.#data.sessions.filter((s) => s.id !== id);
    this.#save();
    return { ok: true };
  }

  list() { return this.#data.users.map((u) => ({ ...this.#view(u), hasPassword: !!u.password })); }

  async create({ name, password, apps = [] } = {}) {
    const n = validName(name);
    if (this.#find(n)) throw new HttpError(409, `esiste già un utente "${n}"`);
    const u = { name: n, role: 'user', apps: this.#apps(apps), password: await hashPassword(validPassword(password)), createdAt: this.#now() };
    this.#data.users.push(u);
    this.#save();
    return this.#view(u);
  }

  /** Cambia le app abilitate e/o la password. Con una password nuova l'utente deve rientrare. */
  async update(name, { password, apps } = {}) {
    const u = this.#get(name);
    if (apps !== undefined) {
      if (u.role === 'admin') throw new HttpError(400, 'l\'amministratore può già avviare tutte le app');
      u.apps = this.#apps(apps);
    }
    if (password !== undefined) {
      u.password = await hashPassword(validPassword(password));
      this.#dropSessions(u.name);
    }
    this.#save();
    return this.#view(u);
  }

  remove(name) {
    const u = this.#get(name);
    if (u.role === 'admin') throw new HttpError(400, 'l\'amministratore non si può eliminare');
    this.#data.users = this.#data.users.filter((x) => x !== u);
    this.#dropSessions(u.name);
    this.#save();
    return { ok: true };
  }

  #apps(list) {
    if (!Array.isArray(list) || list.some((a) => typeof a !== 'string' || !/^[a-z0-9-]+$/.test(a))) {
      throw new HttpError(400, '"apps" deve essere un elenco di id di app');
    }
    return [...new Set(list)];
  }
}
