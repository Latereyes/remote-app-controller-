import fs from 'node:fs';
import path from 'node:path';
import { spawn as nodeSpawn } from 'node:child_process';

/**
 * FPS dei giochi con PresentMon (Intel, gratuito): legge gli eventi di presentazione dei frame di Windows (ETW).
 * PresentMon gira solo mentre qualcuno guarda il pannello gioco: parte alla prima richiesta e si chiude
 * dopo un minuto senza richieste, così a PC fermo non costa nulla.
 * Serve l'amministratore o il gruppo «Performance Log Users» (boot/installa-presentmon.ps1).
 */

// Processi che disegnano frame ma non sono giochi (desktop, browser, overlay, streaming)
export const NOT_GAMES = new Set([
  'dwm.exe', 'explorer.exe', 'steam.exe', 'steamwebhelper.exe', 'gameoverlayui.exe', 'msedge.exe', 'msedgewebview2.exe',
  'chrome.exe', 'firefox.exe', 'opera.exe', 'brave.exe', 'sunshine.exe', 'discord.exe', 'claude.exe', 'code.exe',
  'applicationframehost.exe', 'searchhost.exe', 'shellexperiencehost.exe', 'startmenuexperiencehost.exe',
  'textinputhost.exe', 'widgets.exe', 'gamebar.exe', 'gamebarftserver.exe', 'xboxpcapp.exe', 'xboxpcappft.exe',
  'nvidia overlay.exe', 'nvidia app.exe', 'nvcontainer.exe', 'lockapp.exe', 'systemsettings.exe', 'presentmon.exe',
  'windowsterminal.exe', 'conhost.exe', 'multimonitortool.exe', 'electron.exe',
]);

// Nomi delle colonne nelle versioni di PresentMon: 1.x e 2.x con --v1_metrics, poi le metriche nuove della 2.x
const FRAME_COLS = ['MsBetweenPresents', 'FrameTime', 'MsBetweenAppStart'];
const DISPLAY_COLS = ['MsBetweenDisplayChange', 'DisplayedTime'];

// Opzioni da provare in ordine: se una versione non ne conosce una, si riparte con la serie successiva
export const ARG_SETS = [
  ['--output_stdout', '--stop_existing_session', '--session_name', 'PCRemotoFPS', '--no_console_stats', '--v1_metrics'],
  ['--output_stdout', '--stop_existing_session', '--session_name', 'PCRemotoFPS'],
  ['--output_stdout', '--stop_existing_session'],
];

/** Divide una riga CSV di PresentMon (niente virgolette nei campi che ci servono, ma si gestiscono lo stesso). */
export function splitCsv(line) {
  const out = [];
  let cur = '', q = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (q) {
      if (ch === '"' && line[i + 1] === '"') { cur += '"'; i++; } else if (ch === '"') q = false; else cur += ch;
    } else if (ch === '"') q = true;
    else if (ch === ',') { out.push(cur); cur = ''; } else cur += ch;
  }
  out.push(cur);
  return out.map((s) => s.trim());
}

/** Dall'intestazione CSV: posizione delle colonne che servono, oppure null se la riga non è un'intestazione. */
export function parseHeader(line) {
  const cols = splitCsv(line.replace(/^﻿/, ''));
  const idx = (names) => names.map((n) => cols.indexOf(n)).find((i) => i >= 0) ?? -1;
  const app = cols.indexOf('Application');
  const frame = idx(FRAME_COLS);
  if (app < 0 || frame < 0) return null;
  return { app, pid: cols.indexOf('ProcessID'), frame, display: idx(DISPLAY_COLS), mode: cols.indexOf('PresentMode'), dropped: cols.indexOf('Dropped') };
}

/** Una riga di dati → { app, pid, ms, displayMs, mode } oppure null. */
export function parseRow(line, h) {
  const c = splitCsv(line);
  if (c.length <= h.frame) return null;
  const ms = Number.parseFloat(c[h.frame]);
  if (!Number.isFinite(ms) || ms <= 0 || ms > 5000) return null;
  const d = h.display >= 0 ? Number.parseFloat(c[h.display]) : NaN;
  return {
    app: c[h.app],
    pid: h.pid >= 0 ? Number(c[h.pid]) || null : null,
    ms,
    displayMs: Number.isFinite(d) && d > 0 ? d : null,
    mode: h.mode >= 0 ? c[h.mode] || null : null,
  };
}

/** Statistiche di un insieme di tempi di frame (ms): FPS medi, «1% low», tempo medio. */
export function frameStats(times) {
  if (!times.length) return null;
  const sum = times.reduce((a, b) => a + b, 0);
  const avg = sum / times.length;
  const sorted = [...times].sort((a, b) => b - a);
  // 1% low: FPS medio dell'1% dei frame più lenti (almeno un frame)
  const slow = sorted.slice(0, Math.max(1, Math.floor(times.length / 100)));
  const slowAvg = slow.reduce((a, b) => a + b, 0) / slow.length;
  return {
    fps: Math.round(1000 / avg),
    low1: Math.round(1000 / slowAvg),
    frameTimeMs: Math.round(avg * 100) / 100,
    worstMs: Math.round(sorted[0] * 10) / 10,
  };
}

/** Il gioco fra i processi che presentano frame: quello con più frame nella finestra, esclusi desktop e browser. */
export function pickGame(perApp) {
  let best = null;
  for (const [name, s] of perApp) {
    if (NOT_GAMES.has(name.toLowerCase())) continue;
    if (!best || s.times.length > best[1].times.length) best = [name, s];
  }
  return best;
}

/** Percorso di PresentMon: quello di config.json, altrimenti tools\PresentMon*.exe accanto all'agent. */
export function findPresentMon(configured, toolsDir) {
  if (configured) return fs.existsSync(configured) ? configured : null;
  try {
    const names = fs.readdirSync(toolsDir).filter((n) => /^presentmon.*\.exe$/i.test(n)).sort();
    const exact = names.find((n) => n.toLowerCase() === 'presentmon.exe');
    if (!names.length) return null;
    return path.join(toolsDir, exact || names[names.length - 1]);
  } catch {
    return null;
  }
}

export function createFps({ exe = null, toolsDir, spawn = nodeSpawn, windowMs = 3000, idleMs = 60000,
  retryMs = 30000, platform = process.platform, now = () => Date.now() } = {}) {
  let child = null;
  let header = null;
  let buf = '';
  let errTail = '';
  let argSet = 0;
  let lastUse = 0;
  let lastFail = 0;
  let reason = null;
  let startedAt = null;
  const perApp = new Map(); // nome processo → { pid, times: [ms], disp: [ms], at: [t], mode }

  function onLine(line) {
    if (!line.trim()) return;
    if (!header) { header = parseHeader(line); return; }
    const r = parseRow(line, header);
    if (!r) { const h = parseHeader(line); if (h) header = h; return; }
    let s = perApp.get(r.app);
    if (!s) perApp.set(r.app, (s = { pid: r.pid, times: [], disp: [], at: [], mode: null }));
    const t = now();
    s.times.push(r.ms); s.at.push(t); if (r.displayMs) s.disp.push([t, r.displayMs]);
    s.pid = r.pid; s.mode = r.mode || s.mode;
  }

  function trim() {
    const from = now() - windowMs;
    for (const [name, s] of perApp) {
      let k = 0;
      while (k < s.at.length && s.at[k] < from) k++;
      if (k) { s.at.splice(0, k); s.times.splice(0, k); }
      while (s.disp.length && s.disp[0][0] < from) s.disp.shift();
      if (!s.at.length) perApp.delete(name);
    }
  }

  function stop() {
    if (!child) return;
    const c = child;
    child = null;
    try { c.kill(); } catch { /* già chiuso */ }
  }

  function start(file) {
    header = null; buf = ''; errTail = ''; perApp.clear();
    const c = spawn(file, ARG_SETS[argSet], { stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true });
    child = c;
    startedAt = now();
    reason = null;
    c.stdout?.on('data', (d) => {
      buf += d.toString('utf8');
      const lines = buf.split(/\r?\n/);
      buf = lines.pop();
      lines.forEach(onLine);
    });
    c.stderr?.on('data', (d) => { errTail = (errTail + d.toString('utf8')).slice(-2000); });
    c.on('error', (e) => {
      if (child !== c) return;
      child = null;
      reason = `PresentMon non parte: ${e.message}`;
      lastFail = now();
    });
    c.on('exit', (code) => {
      if (child !== c) return; // chiuso da noi
      child = null;
      const text = errTail.toLowerCase();
      if (/access.*denied|accesso negato|administrator|amministrat|performance log users/.test(text)) {
        reason = 'PresentMon non ha i permessi: esegui boot\\installa-presentmon.ps1 come amministratore e riavvia il PC';
      } else if (/unrecognized|unknown|invalid|not recognized|unexpected/.test(text) && argSet < ARG_SETS.length - 1) {
        argSet++; // questa versione non conosce un'opzione: si riprova subito con meno opzioni
        return;
      } else {
        reason = `PresentMon si è chiuso (codice ${code})${errTail.trim() ? `: ${errTail.trim().split(/\r?\n/).pop()}` : ''}`;
      }
      lastFail = now();
    });
  }

  // Si chiude da solo quando nessuno guarda più
  const sweep = () => { if (child && now() - lastUse > idleMs) stop(); };
  const timer = setInterval(sweep, 5000);
  timer.unref?.();

  /** Stato degli FPS per /api/gaming. Avvia PresentMon se serve. */
  function read() {
    lastUse = now();
    if (platform !== 'win32') return { available: false, reason: 'solo su Windows' };
    const file = findPresentMon(exe, toolsDir);
    if (!file) return { available: false, reason: 'PresentMon non installato: esegui boot\\installa-presentmon.ps1' };
    if (!child && (!lastFail || now() - lastFail > retryMs)) start(file);
    if (!child) return { available: false, reason: reason || 'PresentMon non parte' };
    trim();
    const warming = now() - startedAt < 1500;
    const best = pickGame(perApp);
    if (!best) return { available: true, running: true, warming, game: null };
    const [name, s] = best;
    const stats = frameStats(s.times);
    const disp = s.disp.map(([, ms]) => ms);
    const shown = disp.length ? frameStats(disp) : null;
    const others = [...perApp].filter(([n]) => n !== name && !NOT_GAMES.has(n.toLowerCase()))
      .map(([n, x]) => ({ process: n, fps: frameStats(x.times).fps })).slice(0, 3);
    return {
      available: true,
      running: true,
      warming,
      game: { process: name, pid: s.pid, presentMode: s.mode },
      ...stats,
      displayedFps: shown?.fps ?? null,
      others,
    };
  }

  return { read, stop, sweep, get running() { return !!child; }, close() { clearInterval(timer); stop(); } };
}
