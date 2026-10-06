import fs from 'node:fs';
import path from 'node:path';
import { randomBytes } from 'node:crypto';

/** Espande le variabili in stile Windows (%USERPROFILE%), senza distinguere maiuscole e minuscole. */
export function expandEnv(value, env = process.env) {
  if (typeof value !== 'string') return value;
  return value.replace(/%([^%]+)%/g, (match, key) => {
    const found = Object.keys(env).find((k) => k.toLowerCase() === key.toLowerCase());
    return found ? env[found] : match;
  });
}

const DEFAULT_POWER = {
  shutdown: ['shutdown', '/s', '/t', '5'],
  restart: ['shutdown', '/r', '/t', '5'],
  sleep: ['rundll32.exe', 'powrprof.dll,SetSuspendState', '0,1,0'],
};

/** Valida la configurazione e la porta in forma pronta per l'uso (percorsi espansi e risolti). */
export function normalize(raw, env = process.env) {
  if (typeof raw.token !== 'string' || raw.token.length < 16) {
    throw new Error('token mancante o troppo corto in config.json (servono almeno 16 caratteri)');
  }
  const ids = new Set();
  const apps = (raw.apps || []).map((a) => {
    if (!a.id || !/^[a-z0-9-]+$/.test(a.id)) throw new Error(`app con id non valido: ${JSON.stringify(a.id)} (solo a-z, 0-9, -)`);
    if (ids.has(a.id)) throw new Error(`app duplicata: ${a.id}`);
    ids.add(a.id);
    if (!a.command) throw new Error(`app ${a.id}: manca "command"`);
    if (!a.health) throw new Error(`app ${a.id}: manca "health" (URL che risponde quando l'app è pronta)`);
    const cwd = expandEnv(a.cwd || '', env) || process.cwd();
    let command = expandEnv(a.command, env);
    // Un percorso relativo ("venv\Scripts\python.exe", "start.bat") è relativo alla cartella dell'app
    if (/[\\/]/.test(command) || /\.(bat|cmd)$/i.test(command)) {
      if (!path.isAbsolute(command)) command = path.resolve(cwd, command);
    }
    return {
      id: a.id,
      name: a.name || a.id,
      command,
      args: (a.args || []).map((x) => expandEnv(String(x), env)),
      cwd,
      env: Object.fromEntries(Object.entries(a.env || {}).map(([k, v]) => [k, expandEnv(String(v), env)])),
      health: a.health,
      port: a.port ?? null,
      openUrl: a.openUrl ?? null,
      requires: a.requires || [],
      processNames: a.processNames || [],
      stop: a.stop || null,
      autostart: !!a.autostart,
      startTimeoutSec: Number(a.startTimeoutSec || 120),
    };
  });
  for (const a of apps) {
    for (const dep of a.requires) if (!ids.has(dep)) throw new Error(`app ${a.id}: dipende da "${dep}" che non esiste`);
  }
  return {
    host: raw.host || '0.0.0.0',
    port: Number(raw.port || 7070),
    token: raw.token,
    ollamaUrl: raw.ollamaUrl || 'http://127.0.0.1:11434',
    comfyUrl: raw.comfyUrl || 'http://127.0.0.1:8188',
    apps,
    power: { ...DEFAULT_POWER, ...(raw.power || {}) },
  };
}

/**
 * Legge config.json; al primo avvio lo crea dall'esempio con un token casuale.
 * Restituisce { config, created }.
 */
export function loadConfig(file, examplePath) {
  let created = false;
  if (!fs.existsSync(file)) {
    const example = JSON.parse(fs.readFileSync(examplePath, 'utf8'));
    example.token = randomBytes(24).toString('base64url');
    fs.writeFileSync(file, JSON.stringify(example, null, 2) + '\n');
    created = true;
  }
  const raw = JSON.parse(fs.readFileSync(file, 'utf8'));
  return { config: normalize(raw), created };
}
