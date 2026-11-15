#!/usr/bin/env node
/**
 * Hook PermissionRequest di Claude Code: invece di aspettare solo nel terminale, manda la richiesta
 * all'agent (e quindi all'app PC Remoto) e aspetta Consenti o Rifiuta.
 * Se l'agent non risponde o nessuno decide entro il tempo, esce senza dire niente:
 * Claude torna a chiedere come sempre (terminale e app Claude). Nessuna dipendenza.
 *
 *   node permesso.js --agent http://127.0.0.1:7070 --timeout 600
 */
const arg = (name, fallback) => {
  const i = process.argv.indexOf(`--${name}`);
  return i > 0 && process.argv[i + 1] ? process.argv[i + 1] : fallback;
};
const agent = arg('agent', 'http://127.0.0.1:7070');
const timeoutSec = Number(arg('timeout', '600'));

/** Titolo breve e dettaglio leggibili sul telefono, da tool_name e tool_input. */
export function describe(input) {
  const tool = input.tool_name || 'strumento';
  const t = input.tool_input || {};
  const short = (s, n = 120) => { const x = String(s ?? '').replace(/\s+/g, ' ').trim(); return x.length > n ? `${x.slice(0, n - 1)}…` : x; };
  if (t.command) return { tool, title: `${tool}: ${short(t.command)}`, detail: String(t.command) + (t.description ? `\n\n${t.description}` : '') };
  if (t.file_path) return { tool, title: `${tool}: ${short(t.file_path)}`, detail: JSON.stringify(t, null, 2).slice(0, 4000) };
  if (t.url) return { tool, title: `${tool}: ${short(t.url)}`, detail: JSON.stringify(t, null, 2).slice(0, 4000) };
  return { tool, title: `Claude vuole usare ${tool}`, detail: JSON.stringify(t, null, 2).slice(0, 4000) };
}

async function post(path, body) {
  const res = await fetch(agent + path, {
    method: body === undefined ? 'GET' : 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
    signal: AbortSignal.timeout(30000),
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.json();
}

async function main() {
  let raw = '';
  for await (const c of process.stdin) raw += c;
  const input = JSON.parse(raw || '{}');
  const d = describe(input);
  const req = await post('/api/approvals/ask', { source: 'Claude', ...d, cwd: input.cwd, timeoutSec });
  const end = Date.now() + timeoutSec * 1000;
  let state = req.state;
  while (state === 'pending' && Date.now() < end) {
    state = (await post(`/api/approvals/${req.id}/wait?ms=20000`)).state;
  }
  if (state === 'allow' || state === 'deny') {
    const decision = state === 'allow'
      ? { behavior: 'allow' }
      : { behavior: 'deny', message: 'Rifiutato da Andrea dall\'app PC Remoto' };
    process.stdout.write(JSON.stringify({ hookSpecificOutput: { hookEventName: 'PermissionRequest', decision } }));
  }
}

// Avviato come script (non importato dai test)
if (process.argv[1] && import.meta.url.endsWith(process.argv[1].replace(/\\/g, '/').split('/').pop())) {
  main().catch(() => process.exit(0));
}
