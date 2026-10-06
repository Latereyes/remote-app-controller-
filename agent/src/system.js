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
export function createSystem(config, { exec = execFileP, delayMs = 1500 } = {}) {
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

  /** Libera la VRAM: scarica i modelli di Ollama e chiede a ComfyUI di liberare la memoria. */
  async function freeGpu() {
    const result = { ollama: [], comfy: false };
    for (const m of (await ollamaLoaded()) || []) {
      try {
        await getJson(`${config.ollamaUrl}/api/generate`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ model: m.name, keep_alive: 0 }),
          timeout: 15000,
        });
        result.ollama.push(m.name);
      } catch {}
    }
    try {
      const res = await fetch(`${config.comfyUrl}/free`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ unload_models: true, free_memory: true }),
        signal: AbortSignal.timeout(10000),
      });
      await res.body?.cancel();
      result.comfy = res.ok;
    } catch {}
    return result;
  }

  /** Spegne, riavvia o sospende il PC poco dopo aver risposto, così l'app riceve la conferma. */
  function power(action) {
    const cmd = config.power[action];
    if (!cmd) throw Object.assign(new Error(`azione sconosciuta: ${action}`), { status: 404 });
    setTimeout(() => exec(cmd[0], cmd.slice(1)).catch((e) => console.error(`[power] ${action}: ${e.message}`)), delayMs);
    return { action, inMs: delayMs };
  }

  return { info, gpu, ollamaLoaded, freeGpu, power };
}
