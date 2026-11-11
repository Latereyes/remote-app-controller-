import fs from 'node:fs';
import path from 'node:path';

/** Impostazioni di boot/boot.json (con il BOM che lascia PowerShell), o {} se manca. */
export function readBootConfig(bootDir) {
  try { return JSON.parse(fs.readFileSync(path.join(bootDir, 'boot.json'), 'utf8').replace(/^\uFEFF/, '')); } catch { return {}; }
}

export const DEFAULT_SUNSHINE_LOG = 'C:\\Program Files\\Sunshine\\config\\sunshine.log';

/** Ultimi `bytes` di un file di testo, oppure null se non si legge. */
export function tail(file, bytes = 512 * 1024) {
  let fd;
  try {
    fd = fs.openSync(file, 'r');
    const size = fs.fstatSync(fd).size;
    const len = Math.min(size, bytes);
    const buf = Buffer.alloc(len);
    fs.readSync(fd, buf, 0, len, size - len);
    return buf.toString('utf8');
  } catch {
    return null;
  } finally {
    if (fd !== undefined) fs.closeSync(fd);
  }
}

const stamp = (line) => {
  const m = /^\[(\d{4}-\d{2}-\d{2}) (\d{2}:\d{2}:\d{2})/.exec(line);
  return m ? `${m[1]}T${m[2]}` : null;
};

/**
 * Stato dello stream dal log di Sunshine: l'ultima riga CLIENT CONNECTED o CLIENT DISCONNECTED decide.
 * Righe tipo «[2026-11-08 14:22:01.123]: Info: CLIENT CONNECTED».
 */
export function parseSunshineLog(text) {
  if (text == null) return { available: false, streaming: false, since: null };
  let streaming = false;
  let since = null;
  for (const line of text.split(/\r?\n/)) {
    if (/CLIENT DISCONNECTED/i.test(line)) { streaming = false; since = stamp(line); }
    else if (/CLIENT CONNECTED/i.test(line)) { streaming = true; since = stamp(line); }
  }
  return { available: true, streaming, since };
}

/** Chiavi «nome = valore» di sunshine.conf (output_name, dd_configuration_option...). */
export function parseSunshineConf(text) {
  const out = {};
  for (const line of (text || '').split(/\r?\n/)) {
    const m = /^\s*([A-Za-z0-9_]+)\s*=\s*(.*?)\s*$/.exec(line);
    if (m && !line.trim().startsWith('#')) out[m[1]] = m[2];
  }
  return out;
}

/** Sunshine/Moonlight: { available, streaming, since, outputName, onlyDisplay }. */
export function sunshineStatus(bootDir) {
  const boot = readBootConfig(bootDir);
  const log = boot.sunshineLog || DEFAULT_SUNSHINE_LOG;
  const state = parseSunshineLog(tail(log));
  let conf = {};
  try { conf = parseSunshineConf(fs.readFileSync(path.join(path.dirname(log), 'sunshine.conf'), 'utf8')); } catch { /* niente conf */ }
  return {
    ...state,
    outputName: conf.output_name || null,
    // ensure_only_display: durante lo stream Sunshine lascia acceso solo lo schermo di output_name
    onlyDisplay: /only_display/i.test(conf.dd_configuration_option || ''),
  };
}
