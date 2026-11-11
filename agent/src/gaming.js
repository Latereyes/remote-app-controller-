import os from 'node:os';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { sunshineStatus } from './sunshine.js';

const execFileP = promisify(execFile);

// Campi di nvidia-smi per il pannello gioco; se il driver non ne conosce uno, si riprova con quelli di base
export const FULL_FIELDS = ['name', 'utilization.gpu', 'utilization.memory', 'temperature.gpu', 'power.draw', 'power.limit',
  'clocks.gr', 'clocks.max.gr', 'clocks.mem', 'fan.speed', 'memory.used', 'memory.total', 'pstate',
  'utilization.encoder', 'utilization.decoder', 'clocks_throttle_reasons.active'];
export const BASE_FIELDS = FULL_FIELDS.slice(0, 13);

// Motivi per cui la scheda va più piano del massimo (maschera di clocks_throttle_reasons.active)
const THROTTLE = [
  [0x1, 'a riposo'], [0x4, 'limite di potenza'], [0x8, 'rallentamento hardware'],
  [0x20, 'temperatura'], [0x40, 'temperatura (hardware)'], [0x80, 'freno di potenza'],
];

export function throttleLabels(hex) {
  const n = Number.parseInt(String(hex || '').replace(/^0x/i, ''), 16);
  if (!Number.isFinite(n) || n === 0) return [];
  return THROTTLE.filter(([bit]) => n & bit).map(([, label]) => label);
}

/** Una riga CSV di nvidia-smi con i campi indicati → oggetto con numeri (null per «[N/A]»). */
export function parseGpuLine(line, fields) {
  const cols = line.split(',').map((s) => s.trim());
  const v = Object.fromEntries(fields.map((f, i) => [f, cols[i]]));
  const num = (k) => { const x = Number.parseFloat(v[k]); return Number.isFinite(x) ? x : null; };
  const int = (k) => { const x = num(k); return x == null ? null : Math.round(x); };
  return {
    name: v.name,
    utilPct: int('utilization.gpu'),
    memUtilPct: int('utilization.memory'),
    tempC: int('temperature.gpu'),
    powerW: num('power.draw'),
    powerLimitW: num('power.limit'),
    clockMHz: int('clocks.gr'),
    clockMaxMHz: int('clocks.max.gr'),
    memClockMHz: int('clocks.mem'),
    fanPct: int('fan.speed'),
    memUsedMiB: int('memory.used'),
    memTotalMiB: int('memory.total'),
    pstate: v.pstate && v.pstate !== '[N/A]' ? v.pstate : null,
    encoderPct: int('utilization.encoder'),
    decoderPct: int('utilization.decoder'),
    throttle: throttleLabels(v['clocks_throttle_reasons.active']),
  };
}

/** Uso della CPU in % tra due letture di os.cpus(). */
export function cpuPercent(a, b) {
  let idle = 0, total = 0;
  b.forEach((c, i) => {
    const p = a[i]?.times;
    if (!p) return;
    const t = c.times;
    const d = (k) => t[k] - p[k];
    idle += d('idle');
    total += d('user') + d('nice') + d('sys') + d('idle') + d('irq');
  });
  return total > 0 ? Math.round(100 * (1 - idle / total)) : null;
}

/** Valore di «reg query»: «    RunningAppID    REG_DWORD    0x4c8f6» → "0x4c8f6". */
export function parseRegValue(text, name) {
  const m = new RegExp(`^\\s*${name}\\s+REG_\\w+\\s+(.*)$`, 'mi').exec(text || '');
  return m ? m[1].trim() : null;
}

/** Dati per il pannello «gioco»: GPU dettagliata, CPU, RAM, gioco di Steam aperto, stream di Moonlight. */
export function createGaming({ bootDir, exec = execFileP, platform = process.platform } = {}) {
  let fields = FULL_FIELDS;
  let lastCpu = os.cpus();

  async function gpu() {
    for (;;) {
      try {
        const { stdout } = await exec('nvidia-smi', [`--query-gpu=${fields.join(',')}`, '--format=csv,noheader,nounits'], { timeout: 8000, windowsHide: true });
        return stdout.split(/\r?\n/).filter((l) => l.trim()).map((l) => parseGpuLine(l, fields));
      } catch (e) {
        // Campo sconosciuto a questo driver: si torna ai campi di base una volta per tutte
        if (fields !== BASE_FIELDS && /not a valid field|invalid/i.test(`${e.stdout || ''}${e.stderr || ''}${e.message}`)) { fields = BASE_FIELDS; continue; }
        return null;
      }
    }
  }

  /** Gioco di Steam in corso dal registro (RunningAppID), con il nome se Steam lo ha salvato. */
  async function steamGame() {
    if (platform !== 'win32') return null;
    try {
      const { stdout } = await exec('reg', ['query', 'HKCU\\Software\\Valve\\Steam', '/v', 'RunningAppID'], { timeout: 4000, windowsHide: true });
      const id = Number.parseInt(parseRegValue(stdout, 'RunningAppID') || '0', 16);
      if (!id) return null;
      let name = null;
      try {
        const r = await exec('reg', ['query', `HKCU\\Software\\Valve\\Steam\\Apps\\${id}`, '/v', 'Name'], { timeout: 4000, windowsHide: true });
        name = parseRegValue(r.stdout, 'Name');
      } catch { /* senza nome */ }
      return { appId: id, name: name || `Gioco Steam ${id}` };
    } catch {
      return null;
    }
  }

  return async function gaming() {
    const [gpus, game] = await Promise.all([gpu(), steamGame()]);
    const now = os.cpus();
    const cpuPct = cpuPercent(lastCpu, now);
    lastCpu = now;
    const stream = sunshineStatus(bootDir);
    return {
      active: !!game || stream.streaming,
      game,
      stream,
      cpuPct,
      cpuModel: now[0]?.model?.trim() || null,
      cpuThreads: now.length,
      memory: { totalMiB: Math.round(os.totalmem() / 1048576), freeMiB: Math.round(os.freemem() / 1048576) },
      gpu: gpus,
    };
  };
}
