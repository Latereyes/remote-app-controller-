import os from 'node:os';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

const execFileP = promisify(execFile);

/** Righe di `nvidia-smi --format=csv,noheader,nounits` → schede video. */
export function parseNvidiaSmi(text) {
  return text.split(/\r?\n/).filter((l) => l.trim()).map((line) => {
    const [name, used, total, temp, util] = line.split(',').map((s) => s.trim());
    const num = (s) => (Number.isFinite(Number(s)) ? Number(s) : null);
    return { name, memUsedMiB: num(used), memTotalMiB: num(total), tempC: num(temp), utilPct: num(util) };
  });
}

async function getJson(url, init = {}) {
  const res = await fetch(url, { ...init, signal: AbortSignal.timeout(init.timeout || 3000) });
  if (!res.ok) throw new Error(`${url}: HTTP ${res.status}`);
  return res.json();
}

/** Informazioni sul PC, VRAM e alimentazione. `exec` è sostituibile nei test. */
export function createSystem(config, { exec = execFileP, delayMs = 1500, pollMs = 500 } = {}) {
  async function gpu() {
    try {
      const { stdout } = await exec('nvidia-smi', ['--query-gpu=name,memory.used,memory.total,temperature.gpu,utilization.gpu', '--format=csv,noheader,nounits']);
      return parseNvidiaSmi(stdout);
    } catch {
      return null;
    }
  }

  /** Modelli che Ollama tiene in memoria in questo momento, oppure null se Ollama è spento. */
  async function ollamaLoaded() {
    try {
      const { models = [] } = await getJson(`${config.ollamaUrl}/api/ps`);
      return models.map((m) => ({ name: m.name, sizeVramMiB: Math.round((m.size_vram || 0) / 1048576), expiresAt: m.expires_at }));
    } catch {
      return null;
    }
  }

  async function info() {
    const [gpus, loaded] = await Promise.all([gpu(), ollamaLoaded()]);
    return {
      hostname: os.hostname(),
      platform: process.platform,
      uptimeSec: Math.round(os.uptime()),
      agentUptimeSec: Math.round(process.uptime()),
      memory: { totalMiB: Math.round(os.totalmem() / 1048576), freeMiB: Math.round(os.freemem() / 1048576) },
      load: os.loadavg(),
      gpu: gpus,
      ollamaModels: loaded,
    };
  }

  const pause = (ms) => new Promise((r) => setTimeout(r, ms));

  /** Scarica i modelli di Ollama e aspetta che escano davvero dalla VRAM. Restituisce i nomi scaricati. */
  async function unloadOllama({ timeoutMs = 15000 } = {}) {
    const names = ((await ollamaLoaded()) || []).map((m) => m.name);
    for (const model of names) {
      await getJson(`${config.ollamaUrl}/api/generate`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ model, keep_alive: 0 }),
        timeout: 15000,
      }).catch(() => {});
    }
    const t0 = Date.now();
    while (names.length && Date.now() - t0 < timeoutMs && ((await ollamaLoaded()) || []).length) await pause(pollMs);
    return names;
  }

  /** Chiede a ComfyUI di liberare la VRAM e aspetta che sia libera per l'80%. false se ComfyUI è spento. */
  async function freeComfy({ timeoutMs = 12000 } = {}) {
    try {
      const res = await fetch(`${config.comfyUrl}/free`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ unload_models: true, free_memory: true }),
        signal: AbortSignal.timeout(10000),
      });
      await res.body?.cancel();
      if (!res.ok) return false;
    } catch {
      return false;
    }
    const t0 = Date.now();
    while (Date.now() - t0 < timeoutMs) {
      try {
        const dev = (await getJson(`${config.comfyUrl}/system_stats`)).devices?.[0];
        if (dev && dev.vram_free / dev.vram_total > 0.8) break;
      } catch { break; }
      await pause(pollMs);
    }
    return true;
  }

  /** Spegne, riavvia o sospende il PC poco dopo aver risposto, così l'app riceve la conferma. */
  function power(action) {
    const cmd = config.power[action];
    if (!cmd) throw Object.assign(new Error(`azione sconosciuta: ${action}`), { status: 404 });
    setTimeout(() => exec(cmd[0], cmd.slice(1)).catch((e) => console.error(`[power] ${action}: ${e.message}`)), delayMs);
    return { action, inMs: delayMs };
  }

  return { info, gpu, ollamaLoaded, unloadOllama, freeComfy, power };
}
