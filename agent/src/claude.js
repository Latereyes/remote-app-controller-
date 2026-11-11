import fs from 'node:fs';
import path from 'node:path';
import { execFile, spawn } from 'node:child_process';
import { promisify } from 'node:util';
import { fileURLToPath } from 'node:url';
import { killTree } from './proc.js';

const execFileP = promisify(execFile);
const here = path.dirname(fileURLToPath(import.meta.url));
export const HOOK_SCRIPT = path.join(here, '..', 'claude', 'permesso.js');

const slash = (p) => p.replace(/\\/g, '/');
const psQuote = (s) => `'${String(s).replace(/'/g, "''")}'`;

/** Impostazioni per Claude con l'hook che manda le richieste di permesso all'app (claude --settings <file>). */
export function hookSettings({ node = process.execPath, script = HOOK_SCRIPT, agentUrl, timeoutSec }) {
  // Barre in avanti: il comando dell'hook funziona così sia in Git Bash sia in PowerShell
  const command = `"${slash(node)}" "${slash(script)}" --agent ${agentUrl} --timeout ${timeoutSec}`;
  return { hooks: { PermissionRequest: [{ matcher: '*', hooks: [{ type: 'command', command, timeout: timeoutSec + 30 }] }] } };
}

/** Riga di comando di Claude: sessione interattiva con il controllo remoto acceso. */
export function claudeArgs({ name, settingsFile, extra = [] }) {
  const args = ['--remote-control', name];
  if (settingsFile) args.push('--settings', slash(settingsFile));
  return [...args, ...extra];
}

const quoteCmd = (s) => (/[\s"&()<>^|]/.test(s) || s === '' ? `"${s.replace(/"/g, '""')}"` : s);

/**
 * Su Windows Claude si apre in una finestra del terminale vera (cmd /k), sul desktop del PC:
 * serve una console perché Claude chiede conferme (fiducia nella cartella) la prima volta.
 * Restituisce il PID di cmd.exe, che si chiude con tutti i figli.
 */
async function launchWindows({ command, args, cwd, title }) {
  const line = `title ${title} & ${[command, ...args].map(quoteCmd).join(' ')}`;
  const ps = `(Start-Process -FilePath 'cmd.exe' -ArgumentList '/k', ${psQuote(line)} -WorkingDirectory ${psQuote(cwd)} -PassThru).Id`;
  const { stdout } = await execFileP('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', ps], { timeout: 15000, windowsHide: true });
  const pid = Number.parseInt(stdout.trim(), 10);
  if (!pid) throw new Error('la finestra di Claude non si è aperta');
  return pid;
}

/** Fuori da Windows (test): processo staccato senza finestra. */
async function launchOther({ command, args, cwd }) {
  const child = spawn(command, args, { cwd, stdio: 'ignore', detached: true });
  child.unref();
  await new Promise((resolve, reject) => { child.once('spawn', resolve); child.once('error', reject); });
  return child.pid;
}

const alive = (pid) => {
  if (!pid) return false;
  try { process.kill(pid, 0); return true; } catch (e) { return e.code === 'EPERM'; }
};

/**
 * «Claude sul PC»: avvia Claude Code con il controllo remoto (si usa dall'app Claude o da claude.ai/code)
 * e, se `approvals` è acceso, con l'hook che chiede i permessi all'app PC Remoto.
 * Lo stato (PID) sta in un file, così sopravvive a un riavvio dell'agent.
 */
export function createClaude({ config, stateDir, approvals, launch = process.platform === 'win32' ? launchWindows : launchOther, log = console.log }) {
  const c = config.claude;
  const stateFile = path.join(stateDir, 'claude-stato.json');
  const settingsFile = path.join(stateDir, 'claude-impostazioni.json');
  const read = () => { try { return JSON.parse(fs.readFileSync(stateFile, 'utf8')); } catch { return null; } };

  function status() {
    const s = read();
    const running = !!s && alive(s.pid);
    return {
      running,
      pid: running ? s.pid : null,
      startedAt: running ? s.startedAt : null,
      by: running ? s.by : null,
      name: c.name,
      cwd: c.cwd,
      approvals: c.approvals,
      pending: approvals ? approvals.pending().filter((a) => a.source === 'Claude').length : 0,
    };
  }

  async function start(who = 'app') {
    const now = status();
    if (now.running) return { ...now, already: true };
    if (!fs.existsSync(c.cwd)) throw Object.assign(new Error(`cartella di Claude inesistente: ${c.cwd}`), { status: 400 });
    let settings = null;
    if (c.approvals) {
      fs.writeFileSync(settingsFile, JSON.stringify(hookSettings({ agentUrl: `http://127.0.0.1:${config.port}`, timeoutSec: c.approvalTimeoutSec }), null, 2));
      settings = settingsFile;
    }
    const args = claudeArgs({ name: c.name, settingsFile: settings, extra: c.args });
    const pid = await launch({ command: c.command, args, cwd: c.cwd, title: 'Claude remoto' });
    fs.writeFileSync(stateFile, JSON.stringify({ pid, startedAt: Date.now(), by: who }));
    log(`[claude] avviato da ${who} in ${c.cwd} (PID ${pid})`);
    return status();
  }

  async function stop(who = 'app') {
    const s = read();
    if (s && alive(s.pid)) await killTree(s.pid);
    fs.rmSync(stateFile, { force: true });
    log(`[claude] chiuso da ${who}`);
    return status();
  }

  return { status, start, stop };
}
