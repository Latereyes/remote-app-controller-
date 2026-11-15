import { spawn } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { killTree } from './proc.js';

const isWin = process.platform === 'win32';

/**
 * Shell di base: PowerShell che legge i comandi da stdin (niente finestra, niente console vera).
 * Senza una console i programmi interattivi (che chiedono conferme a schermo) non funzionano:
 * per quelli c'è -Confirm:$false o il tasto «Chiudi» che termina la shell.
 */
export const DEFAULT_SHELL = isWin
  ? ['powershell.exe', '-NoLogo', '-NoProfile', '-NoExit', '-ExecutionPolicy', 'Bypass', '-Command', '-']
  : ['sh', '-i'];
// Primo comando: output in UTF-8 (altrimenti le lettere accentate arrivano storte)
const WIN_INIT = '[Console]::OutputEncoding = [Text.Encoding]::UTF8; $OutputEncoding = [Text.Encoding]::UTF8; $ProgressPreference = "SilentlyContinue"';

/**
 * Terminali remoti per l'amministratore: una shell per sessione, output conservato in memoria
 * (ultimi 256 KB) e letto a pezzi dall'app con `since`. Le sessioni ferme si chiudono da sole.
 */
export class TerminalManager {
  constructor({ shell = DEFAULT_SHELL, cwd = process.env.USERPROFILE || process.env.HOME || process.cwd(), idleMs = 15 * 60000, max = 3, log = console.log } = {}) {
    this.shell = shell;
    this.cwd = cwd;
    this.idleMs = idleMs;
    this.max = max;
    this.log = log;
    this.sessions = new Map();
    this.timer = setInterval(() => this.sweep(), 30000);
    this.timer.unref();
  }

  open(who = 'app') {
    this.sweep();
    if ([...this.sessions.values()].filter((s) => s.alive).length >= this.max) {
      throw Object.assign(new Error(`al massimo ${this.max} terminali aperti`), { status: 409 });
    }
    const id = randomBytes(9).toString('base64url');
    const [cmd, ...args] = this.shell;
    const child = spawn(cmd, args, { cwd: this.cwd, stdio: ['pipe', 'pipe', 'pipe'], windowsHide: true, env: { ...process.env, TERM: 'dumb' } });
    const s = { id, who, child, buf: '', base: 0, alive: true, exitCode: null, used: Date.now(), waiters: new Set() };
    const push = (chunk) => {
      s.buf += chunk.toString('utf8');
      const extra = s.buf.length - 262144;
      if (extra > 0) { s.buf = s.buf.slice(extra); s.base += extra; }
      this.wake(s);
    };
    child.stdout.on('data', push);
    child.stderr.on('data', push);
    child.on('error', (e) => { push(Buffer.from(`\n[errore: ${e.message}]\n`)); s.alive = false; this.wake(s); });
    child.on('exit', (code) => { s.alive = false; s.exitCode = code; push(Buffer.from(`\n[terminale chiuso${code != null ? `, codice ${code}` : ''}]\n`)); });
    child.stdin.on('error', () => {});
    if (isWin && cmd.toLowerCase().includes('powershell')) child.stdin.write(`${WIN_INIT}\n`);
    this.sessions.set(id, s);
    this.log(`[terminale] aperto da ${who}`);
    return { id, shell: cmd, cwd: this.cwd };
  }

  get(id) {
    const s = this.sessions.get(id);
    if (!s) throw Object.assign(new Error('terminale chiuso o scaduto'), { status: 404 });
    return s;
  }

  wake(s) { for (const w of s.waiters) w(); s.waiters.clear(); }

  /** Un comando (una riga). Viene scritto nel log dell'agent: chi entra nel terminale lascia traccia. */
  input(id, line) {
    const s = this.get(id);
    if (!s.alive) throw Object.assign(new Error('terminale chiuso'), { status: 410 });
    const text = String(line ?? '').replace(/\r?\n$/, '');
    if (text.length > 8000) throw Object.assign(new Error('comando troppo lungo'), { status: 413 });
    s.used = Date.now();
    this.log(`[terminale] ${s.who}> ${text}`);
    s.child.stdin.write(`${text}\n`);
    return { ok: true };
  }

  /** Output dalla posizione `since`; se non c'è niente di nuovo aspetta fino a `waitMs`. */
  async read(id, since = 0, waitMs = 0) {
    const s = this.get(id);
    s.used = Date.now();
    const end = () => s.base + s.buf.length;
    if (since >= end() && s.alive && waitMs > 0) {
      await new Promise((resolve) => {
        const t = setTimeout(done, Math.min(waitMs, 25000));
        function done() { clearTimeout(t); s.waiters.delete(done); resolve(); }
        s.waiters.add(done);
      });
    }
    const from = Math.max(since, s.base);
    return { text: s.buf.slice(from - s.base), next: end(), alive: s.alive, exitCode: s.exitCode, cut: since < s.base };
  }

  async close(id) {
    const s = this.get(id);
    this.sessions.delete(id);
    if (s.alive && s.child.pid) await killTree(s.child.pid);
    this.wake(s);
    this.log(`[terminale] chiuso da ${s.who}`);
    return { ok: true };
  }

  list() {
    return [...this.sessions.values()].map((s) => ({ id: s.id, who: s.who, alive: s.alive, idleSec: Math.round((Date.now() - s.used) / 1000) }));
  }

  /** Chiude i terminali non usati da `idleMs` e dimentica quelli già finiti. */
  sweep() {
    for (const s of this.sessions.values()) {
      if (Date.now() - s.used > this.idleMs) this.close(s.id).catch(() => {});
    }
  }

  async closeAll() {
    clearInterval(this.timer);
    for (const id of [...this.sessions.keys()]) await this.close(id).catch(() => {});
  }
}
