import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { fileURLToPath } from 'node:url';
import { loadConfig } from './src/config.js';
import { AppManager } from './src/apps.js';
import { createSystem } from './src/system.js';
import { createServer } from './src/http.js';
import { GpuArbiter } from './src/gpu.js';

const root = path.dirname(fileURLToPath(import.meta.url));
const configFile = process.env.AGENT_CONFIG ? path.resolve(process.env.AGENT_CONFIG) : path.join(root, 'config.json');

let config, created;
try {
  ({ config, created } = loadConfig(configFile, path.join(root, 'config.example.json')));
} catch (e) {
  console.error(`\n  ⚠ Configurazione non valida (${configFile}): ${e.message}\n`);
  process.exit(1);
}

const apps = new AppManager(config.apps);
const system = createSystem(config);
// Modalità scelta dal countdown all'accensione (boot/mode.txt): "server", "xbox" o null
const modeFile = path.join(root, '..', 'boot', 'mode.txt');
const getMode = () => { try { return fs.readFileSync(modeFile, 'utf8').trim() || null; } catch { return null; } };
// Arbitro della GPU per ChatBz, LocalAI e l'app Android: un lavoro alla volta, l'altro motore scaricato
const gpu = new GpuArbiter({ unload: { ollama: () => system.unloadOllama(), comfy: () => system.freeComfy() } });
setInterval(() => gpu.sweep(), 5000).unref();
let lastGpuLog = null;
gpu.on('state', (s) => {
  const key = s.active && s.active.phase === 'granted' ? `${s.active.app}: ${s.active.label}` : null;
  if (key && key !== lastGpuLog) console.log(`  [gpu] ${key} (${s.owner || '-'}${s.queue.length ? `, ${s.queue.length} in coda` : ''})`);
  lastGpuLog = key;
});
const server = createServer({ config, apps, system, gpu, getMode });

server.listen(config.port, config.host, () => {
  const ips = Object.values(os.networkInterfaces()).flat().filter((i) => i?.family === 'IPv4' && !i.internal).map((i) => i.address);
  console.log('\n  Remote app controller: agent pronto');
  for (const ip of ips) console.log(`  → http://${ip}:${config.port}`);
  console.log(`  App: ${config.apps.map((a) => a.name).join(', ')}`);
  if (created) {
    console.log(`\n  Primo avvio: ho creato ${configFile}`);
    console.log(`  Token per l'app Android: ${config.token}`);
    console.log('  Controlla i percorsi delle app in config.json.\n');
  }
  for (const a of config.apps.filter((x) => x.autostart)) {
    apps.start(a.id).catch((e) => console.error(`  ⚠ avvio automatico di ${a.name}: ${e.message}`));
  }
});

server.on('error', (e) => {
  if (e.code === 'EADDRINUSE') console.error(`\n  ⚠ La porta ${config.port} è già in uso: l'agent è probabilmente già avviato.\n`);
  else console.error(e);
  process.exit(1);
});
