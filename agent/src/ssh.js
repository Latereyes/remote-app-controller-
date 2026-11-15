import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

const execFileP = promisify(execFile);

/** Stato del servizio da «sc query sshd»: installed / running. */
export function parseScQuery(text) {
  if (!text || /1060|does not exist|non esiste/i.test(text)) return { installed: false, running: false };
  // «STATE» o «STATO» secondo la lingua di Windows: conta solo «4 RUNNING»
  return { installed: true, running: /:\s*4\s+RUNNING/i.test(text) };
}

/** Porta da sshd_config (riga «Port N» non commentata), di base 22. */
export function parsePort(conf) {
  const m = /^\s*Port\s+(\d+)/mi.exec(conf || '');
  return m ? Number(m[1]) : 22;
}

/**
 * Server SSH di Windows (boot/installa-ssh.ps1): l'app lo usa per aprire il client SSH del telefono
 * con l'utente e la porta giusti. Il terminale vero passa da lì, con la chiave del telefono.
 */
export function createSsh({ exec = execFileP, platform = process.platform, programData = process.env.ProgramData || 'C:\\ProgramData' } = {}) {
  return async function ssh() {
    const user = os.userInfo().username;
    if (platform !== 'win32') return { installed: false, running: false, user, port: 22 };
    let state;
    try { state = parseScQuery((await exec('sc', ['query', 'sshd'], { timeout: 5000, windowsHide: true })).stdout); }
    catch (e) { state = parseScQuery(`${e.stdout || ''}${e.message}`); }
    let port = 22;
    try { port = parsePort(fs.readFileSync(path.join(programData, 'ssh', 'sshd_config'), 'utf8')); } catch { /* di base */ }
    return { ...state, user, port };
  };
}
