import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { readBootConfig, sunshineStatus } from './sunshine.js';

const execFileP = promisify(execFile);

/** CSV con virgolette (come lo scrive MultiMonitorTool /scomma) → righe di oggetti per intestazione. */
export function parseCsv(text) {
  const rows = [];
  let row = [], field = '', quoted = false;
  const src = (text || '').replace(/^\uFEFF/, '');
  for (let i = 0; i < src.length; i++) {
    const c = src[i];
    if (quoted) {
      if (c === '"' && src[i + 1] === '"') { field += '"'; i++; }
      else if (c === '"') quoted = false;
      else field += c;
    } else if (c === '"') quoted = true;
    else if (c === ',') { row.push(field); field = ''; }
    else if (c === '\n' || c === '\r') {
      if (c === '\r' && src[i + 1] === '\n') i++;
      row.push(field); field = '';
      if (row.some((x) => x !== '')) rows.push(row);
      row = [];
    } else field += c;
  }
  row.push(field);
  if (row.some((x) => x !== '')) rows.push(row);
  const [head, ...body] = rows;
  if (!head) return [];
  return body.map((r) => Object.fromEntries(head.map((h, i) => [h.trim(), (r[i] ?? '').trim()])));
}

const yes = (v) => /^(yes|sì|si|true)$/i.test(v || '');

/**
 * Schermi da MultiMonitorTool, con quello che sta guardando Moonlight.
 * `stream` è sunshineStatus(): durante lo stream lo schermo di Moonlight è quello di output_name
 * (con ensure_only_display è anche l'unico attivo), altrimenti il principale.
 */
export function describeDisplays(rows, { virtualDisplay = 'MTT1337', stream = null } = {}) {
  const list = rows.map((r) => {
    const text = [r['Monitor ID'], r['Monitor Name'], r['Monitor String'], r['Short Monitor ID']].join(' ');
    return {
      name: r.Name || '',                                   // \\.\DISPLAY1
      monitor: r['Monitor Name'] || r['Monitor String'] || r['Monitor ID'] || r.Name || 'Schermo',
      monitorId: r['Monitor ID'] || null,
      active: yes(r.Active),
      primary: yes(r.Primary),
      disconnected: yes(r.Disconnected),
      resolution: r.Resolution || null,
      hz: Number.parseInt(r.Frequency, 10) || null,
      virtual: !!virtualDisplay && text.toLowerCase().includes(String(virtualDisplay).toLowerCase()),
      moonlight: false,
    };
  });
  if (stream?.streaming) {
    const active = list.filter((d) => d.active);
    const wanted = (stream.outputName || '').toLowerCase();
    const byName = wanted && active.find((d) => [d.name, d.monitor, d.monitorId].some((x) => (x || '').toLowerCase().includes(wanted)));
    // «VDD» in sunshine.conf è lo schermo virtuale («VDD by MTT»)
    const byVirtual = /vdd|virtual/.test(wanted) && active.find((d) => d.virtual);
    const seen = byName || byVirtual || (stream.onlyDisplay && active.length === 1 ? active[0] : null) || active.find((d) => d.primary);
    if (seen) seen.moonlight = true;
  }
  return list;
}

/** Lettura degli schermi sul PC (solo Windows, con MultiMonitorTool), con 3 s di cache. */
export function createDisplays({ bootDir, exec = execFileP, platform = process.platform } = {}) {
  let cache = null;
  return async function displays() {
    if (cache && Date.now() - cache.at < 3000) return cache.value;
    const boot = readBootConfig(bootDir);
    const stream = sunshineStatus(bootDir);
    const tool = boot.multiMonitorTool || 'C:\\tools\\MultiMonitorTool.exe';
    let value;
    if (platform !== 'win32') value = { available: false, reason: 'solo su Windows', displays: [], stream };
    else if (!fs.existsSync(tool)) value = { available: false, reason: `MultiMonitorTool non trovato (${tool})`, displays: [], stream };
    else {
      const csv = path.join(os.tmpdir(), `rac-schermi-${process.pid}.csv`);
      try {
        fs.rmSync(csv, { force: true });
        await exec(tool, ['/scomma', csv], { timeout: 8000, windowsHide: true });
        const rows = parseCsv(fs.readFileSync(csv, 'utf8'));
        value = { available: true, displays: describeDisplays(rows, { virtualDisplay: boot.virtualDisplay || 'MTT1337', stream }), stream };
      } catch (e) {
        value = { available: false, reason: `MultiMonitorTool non risponde: ${e.message}`, displays: [], stream };
      } finally {
        fs.rmSync(csv, { force: true });
      }
    }
    cache = { at: Date.now(), value };
    return value;
  };
}
