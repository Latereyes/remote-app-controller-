import { spawn, execFile } from 'node:child_process';
import { promisify } from 'node:util';

const execFileP = promisify(execFile);
const isWin = process.platform === 'win32';

const quoteForCmd = (s) => (/[\s"&()<>^|]/.test(s) ? `"${s}"` : s);

/**
 * Avvia il processo di un'app senza finestra, con stdout e stderr in pipe.
 * I .bat/.cmd passano da cmd.exe; su Linux/macOS il processo ha un suo gruppo, così si chiude con tutti i figli.
 */
export function spawnApp(app, extraEnv = {}) {
  const env = { ...process.env, ...app.env, ...extraEnv };
  const opts = { cwd: app.cwd, env, stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true };
  if (isWin && /\.(bat|cmd)$/i.test(app.command)) {
    const line = [app.command, ...app.args].map(quoteForCmd).join(' ');
    return spawn(process.env.ComSpec || 'cmd.exe', ['/d', '/s', '/c', `"${line}"`], { ...opts, windowsVerbatimArguments: true });
  }
  return spawn(app.command, app.args, { ...opts, detached: !isWin });
}

/** Chiude un processo e tutti i suoi figli (su Windows: taskkill /T /F). */
export async function killTree(pid) {
  if (isWin) {
    await execFileP('taskkill', ['/PID', String(pid), '/T', '/F']).catch(() => {});
    return;
  }
  try { process.kill(-pid, 'SIGTERM'); } catch { try { process.kill(pid, 'SIGTERM'); } catch {} }
}

/** Chiude i processi con questi nomi (es. "ollama.exe"), utile per app avviate fuori dall'agent. */
export async function killByName(names) {
  for (const name of names) {
    if (isWin) await execFileP('taskkill', ['/IM', name, '/T', '/F']).catch(() => {});
    else await execFileP('pkill', ['-x', name]).catch(() => {});
  }
}

/** PID del processo in ascolto su una porta TCP (solo Windows, via netstat), oppure null. */
export async function pidOnPort(port) {
  if (!isWin || !port) return null;
  try {
    const { stdout } = await execFileP('netstat', ['-ano', '-p', 'tcp']);
    return parseNetstat(stdout, port);
  } catch {
    return null;
  }
}

export function parseNetstat(text, port) {
  for (const line of text.split(/\r?\n/)) {
    const cols = line.trim().split(/\s+/);
    if (cols.length < 5 || cols[0] !== 'TCP' || !/LISTEN/i.test(cols[3])) continue;
    if (cols[1].endsWith(`:${port}`)) {
      const pid = Number(cols[4]);
      if (pid > 0) return pid;
    }
  }
  return null;
}

/** true se l'URL risponde (qualsiasi risposta HTTP: anche un 401 vuol dire che il server è su). */
export async function probe(url, timeoutMs = 2000) {
  try {
    const res = await fetch(url, { signal: AbortSignal.timeout(timeoutMs) });
    await res.body?.cancel();
    return true;
  } catch {
    return false;
  }
}

export const processTools = { spawnApp, killTree, killByName, pidOnPort, probe };
