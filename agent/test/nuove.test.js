import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { parseCsv, describeDisplays } from '../src/displays.js';
import { parseSunshineLog, parseSunshineConf, sunshineStatus } from '../src/sunshine.js';
import { parseGpuLine, FULL_FIELDS, BASE_FIELDS, throttleLabels, cpuPercent, parseRegValue, createGaming } from '../src/gaming.js';
import { ApprovalQueue } from '../src/approvals.js';
import { TerminalManager } from '../src/terminal.js';
import { hookSettings, claudeArgs, createClaude } from '../src/claude.js';
import { describe as describeHook } from '../claude/permesso.js';
import { inNets } from '../src/http.js';

const quiet = () => {};

test('CSV di MultiMonitorTool e schermo di Moonlight', () => {
  const csv = '\uFEFFResolution,Active,Disconnected,Primary,Frequency,Name,Monitor ID,Monitor Name,Monitor String\r\n'
    + '3840 X 2160,No,No,No,60,\\\\.\\DISPLAY1,MONITOR\\GSMC0A0\\{x},LG TV SSCR2,"LG, TV"\r\n'
    + '1920 X 1080,Yes,No,Yes,60,\\\\.\\DISPLAY2,MONITOR\\MTT1337\\{y},VDD by MTT,VDD by MTT\r\n';
  const rows = parseCsv(csv);
  assert.equal(rows.length, 2);
  assert.equal(rows[0]['Monitor String'], 'LG, TV');
  const idle = describeDisplays(rows, { stream: { streaming: false } });
  assert.deepEqual(idle.map((d) => [d.active, d.virtual, d.moonlight]), [[false, false, false], [true, true, false]]);
  assert.equal(idle[1].hz, 60);
  const live = describeDisplays(rows, { stream: { streaming: true, outputName: 'VDD', onlyDisplay: true } });
  assert.equal(live.find((d) => d.moonlight).name, '\\\\.\\DISPLAY2');
  // Senza output_name: il principale fra quelli attivi
  const prim = describeDisplays(rows, { stream: { streaming: true, outputName: null } });
  assert.equal(prim.find((d) => d.moonlight).monitor, 'VDD by MTT');
});

test('log e configurazione di Sunshine', () => {
  const log = '[2026-11-08 14:00:00.000]: Info: Registered Sunshine mDNS service\n'
    + '[2026-11-08 14:22:01.123]: Info: CLIENT CONNECTED\n';
  assert.deepEqual(parseSunshineLog(log), { available: true, streaming: true, since: '2026-11-08T14:22:01' });
  assert.equal(parseSunshineLog(log + '[2026-11-08 15:00:00.000]: Info: CLIENT DISCONNECTED\n').streaming, false);
  assert.equal(parseSunshineLog(null).available, false);
  const conf = parseSunshineConf('# commento\noutput_name = VDD\ndd_configuration_option = ensure_only_display\n');
  assert.equal(conf.output_name, 'VDD');
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sun-'));
  fs.writeFileSync(path.join(dir, 'sunshine.log'), log);
  fs.writeFileSync(path.join(dir, 'sunshine.conf'), 'output_name = VDD\ndd_configuration_option = ensure_only_display\n');
  fs.writeFileSync(path.join(dir, 'boot.json'), '\uFEFF' + JSON.stringify({ sunshineLog: path.join(dir, 'sunshine.log') }));
  assert.deepEqual(sunshineStatus(dir), { available: true, streaming: true, since: '2026-11-08T14:22:01', outputName: 'VDD', onlyDisplay: true });
});

test('dati di gioco: nvidia-smi, CPU, Steam', async () => {
  const g = parseGpuLine('NVIDIA GeForce RTX 4070 Ti SUPER, 97, 40, 71, 265.32, 285.00, 2745, 3105, 10501, 55, 9000, 16376, P2, 12, 0, 0x0000000000000004', FULL_FIELDS);
  assert.equal(g.utilPct, 97);
  assert.equal(g.powerW, 265.32);
  assert.equal(g.encoderPct, 12);
  assert.deepEqual(g.throttle, ['limite di potenza']);
  assert.equal(parseGpuLine('X, [N/A], 1, 2, [N/A], 3, 4, 5, 6, 7, 8, 9, P8', BASE_FIELDS).utilPct, null);
  assert.deepEqual(throttleLabels('0x0'), []);
  const t = (idle, user) => ({ times: { user, nice: 0, sys: 0, idle, irq: 0 } });
  assert.equal(cpuPercent([t(100, 100)], [t(150, 250)]), 75);
  assert.equal(parseRegValue('\r\nHKEY_CURRENT_USER\\Software\\Valve\\Steam\r\n    RunningAppID    REG_DWORD    0x4c8f6\r\n', 'RunningAppID'), '0x4c8f6');

  // Driver che non conosce un campo: si torna ai campi di base
  const calls = [];
  const exec = async (cmd, args) => {
    calls.push([cmd, args[0] || '']);
    if (cmd === 'nvidia-smi' && args[0].includes('encoder')) throw Object.assign(new Error('exit 2'), { stdout: 'Field "utilization.encoder" is not a valid field to query.' });
    if (cmd === 'nvidia-smi') return { stdout: 'RTX, 50, 10, 60, 100, 285, 2000, 3105, 10501, 30, 4000, 16376, P2\n' };
    if (args[3] === 'RunningAppID') return { stdout: '    RunningAppID    REG_DWORD    0x4c8f6\n' };
    return { stdout: '    Name    REG_SZ    Cyberpunk 2077\n' };
  };
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'gioco-'));
  const gaming = createGaming({ bootDir: dir, exec, platform: 'win32' });
  const d = await gaming();
  assert.equal(d.gpu[0].utilPct, 50);
  assert.equal(d.gpu[0].encoderPct, null);
  assert.deepEqual(d.game, { appId: 0x4c8f6, name: 'Cyberpunk 2077' });
  assert.equal(d.active, true);
  await gaming();
  assert.equal(calls.filter(([c, a]) => c === 'nvidia-smi' && a.includes('encoder')).length, 1, 'il campo sconosciuto non si riprova');
  assert.equal(d.fps, null, 'senza PresentMon configurato niente FPS');
  // FPS: PresentMon si legge solo quando si gioca
  let reads = 0;
  const fps = { read: () => { reads++; return { available: true, running: true, fps: 60 }; } };
  assert.equal((await createGaming({ bootDir: dir, exec, platform: 'win32', fps })()).fps.fps, 60);
  // Cartella di boot isolata: senza, sunshineStatus legge il vero log di Sunshine del PC (prova sul PC 2026-11-11: stream in corso)
  const idleDir = fs.mkdtempSync(path.join(os.tmpdir(), 'gioco-'));
  fs.writeFileSync(path.join(idleDir, 'boot.json'), JSON.stringify({ sunshineLog: path.join(idleDir, 'manca.log')}));
  const idleExec = async (cmd, args) => (cmd === 'nvidia-smi' ? exec(cmd, args) : { stdout: '    RunningAppID    REG_DWORD    0x0\n' });
  const idle = await createGaming({ bootDir: idleDir, exec: idleExec, platform: 'win32', fps })();
  assert.equal(idle.active, false);
  assert.equal(idle.fps.idle, true);
  assert.equal(reads, 1);
  await createGaming({ bootDir: idleDir, exec: idleExec, platform: 'win32', fps, getMode: () => 'xbox' })();
  assert.equal(reads, 2, 'in modalità Xbox si misura anche senza Steam');
});

test('permessi: chiedi, aspetta, decidi, scadenza', async () => {
  const q = new ApprovalQueue({ log: quiet });
  const a = q.ask({ source: 'Claude', title: 'PowerShell: Remove-Item x', detail: 'Remove-Item x' });
  assert.equal(q.pending().length, 1);
  const waiting = q.wait(a.id, 5000);
  q.decide(a.id, true, 'Andrea');
  assert.equal((await waiting).state, 'allow');
  assert.equal((await waiting).by, 'Andrea');
  assert.throws(() => q.decide(a.id, false), /già decisa/);
  assert.equal(q.pending().length, 0);
  const b = q.ask({ title: 'x', timeoutSec: 0.001 });
  const t0 = Date.now();
  // Scadenza minima 5 s: con un tempo così corto si usa quella
  assert.ok(b.expiresAt - t0 >= 4900);
  q.items.get(b.id).expiresAt = Date.now() - 1;
  assert.equal((await q.wait(b.id, 1000)).state, 'expired');
  assert.throws(() => q.ask({}), /title/);
});

test('terminale: comando, output, chiusura', { skip: process.platform === 'win32' }, async () => {
  const t = new TerminalManager({ shell: ['sh'], cwd: os.tmpdir(), max: 1, log: quiet });
  const { id } = t.open('Andrea');
  assert.throws(() => t.open('altro'), /al massimo 1/);
  t.input(id, 'echo ciao-$((2+3))');
  let out = '', next = 0;
  for (let i = 0; i < 20 && !out.includes('ciao-5'); i++) {
    const r = await t.read(id, next, 2000);
    out += r.text; next = r.next;
  }
  assert.match(out, /ciao-5/);
  assert.equal((await t.read(id, next, 0)).text, '');
  await t.close(id);
  await assert.rejects(() => t.read(id), /chiuso o scaduto/);
  await t.closeAll();
});

test('Claude: impostazioni dell\'hook, comando, avvio e chiusura', async () => {
  const s = hookSettings({ node: 'C:\\Program Files\\nodejs\\node.exe', script: 'C:\\AI\\rac\\agent\\claude\\permesso.js', agentUrl: 'http://127.0.0.1:7070', timeoutSec: 600 });
  const h = s.hooks.PermissionRequest[0].hooks[0];
  assert.equal(h.command, '"C:/Program Files/nodejs/node.exe" "C:/AI/rac/agent/claude/permesso.js" --agent http://127.0.0.1:7070 --timeout 600');
  assert.equal(h.timeout, 630);
  assert.deepEqual(claudeArgs({ name: 'PC di casa', settingsFile: 'C:\\AI\\x.json' }), ['--remote-control', 'PC di casa', '--settings', 'C:/AI/x.json']);

  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'claude-'));
  const launched = [];
  const config = { port: 7070, claude: { command: 'claude', cwd: dir, name: 'PC', args: [], approvals: true, approvalTimeoutSec: 60 } };
  const approvals = new ApprovalQueue({ log: quiet });
  const c = createClaude({ config, stateDir: dir, approvals, log: quiet, launch: async (o) => { launched.push(o); return process.pid; } });
  assert.equal(c.status().running, false);
  const st = await c.start('Andrea');
  assert.equal(st.running, true);
  assert.equal(st.by, 'Andrea');
  assert.ok(fs.existsSync(path.join(dir, 'claude-impostazioni.json')));
  assert.equal(launched[0].args.at(-2), '--settings');
  assert.equal((await c.start()).already, true);
  approvals.ask({ source: 'Claude', title: 't' });
  assert.equal(c.status().pending, 1);
  // stop: il file di stato sparisce (il PID finto è il nostro, non lo uccidiamo)
  fs.writeFileSync(path.join(dir, 'claude-stato.json'), JSON.stringify({ pid: 999999, startedAt: 1 }));
  assert.equal((await c.stop()).running, false);
  config.claude.cwd = path.join(dir, 'manca');
  await assert.rejects(() => c.start(), /inesistente/);
});

test('hook di Claude: descrizione della richiesta', () => {
  assert.deepEqual(describeHook({ tool_name: 'PowerShell', tool_input: { command: 'Get-Process', description: 'elenco' } }),
    { tool: 'PowerShell', title: 'PowerShell: Get-Process', detail: 'Get-Process\n\nelenco' });
  assert.equal(describeHook({ tool_name: 'Write', tool_input: { file_path: 'C:\\a.txt', content: 'x' } }).title, 'Write: C:\\a.txt');
  assert.equal(describeHook({ tool_name: 'mcp__x' }).title, 'Claude vuole usare mcp__x');
});

test('reti fidate (Tailscale)', () => {
  const nets = ['100.64.0.0/10', 'fd7a:115c:a1e0::/48'];
  assert.equal(inNets('100.125.7.114', nets), true);
  assert.equal(inNets('::ffff:100.119.155.55', nets), true);
  assert.equal(inNets('192.168.1.5', nets), false);
  assert.equal(inNets('100.128.0.1', nets), false);
  assert.equal(inNets('fd7a:115c:a1e0:ab12::1', nets), true);
  assert.equal(inNets('nonsense', nets), false);
});

test('rotte nuove: permessi dal PC senza token, decisione dall\'app, terminale e Claude', async () => {
  const { createServer } = await import('../src/http.js');
  const { UserStore } = await import('../src/users.js');
  const { GpuArbiter } = await import('../src/gpu.js');
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'rotte-'));
  const token = 'segreto-segreto-123';
  const approvals = new ApprovalQueue({ log: quiet });
  const terminals = new TerminalManager({ shell: process.platform === 'win32' ? ['cmd.exe', '/q'] : ['sh'], cwd: os.tmpdir(), log: quiet });
  const server = createServer({
    config: { token }, log: quiet,
    apps: { ids: () => [], list: async () => [] }, system: {}, users: new UserStore(path.join(dir, 'users.json')),
    gpu: new GpuArbiter({ unload: { ollama: async () => [], comfy: async () => true }, log: quiet }),
    approvals, terminals,
    displays: async () => ({ available: false, displays: [] }),
    gaming: async () => ({ active: false }),
    claude: { status: () => ({ running: false }), start: async (who) => ({ running: true, by: who }), stop: async () => ({ running: false }) },
  });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  const base = `http://127.0.0.1:${server.address().port}`;
  const call = (p, { method = 'GET', auth = token, body } = {}) =>
    fetch(base + p, { method, headers: auth ? { Authorization: `Bearer ${auth}` } : {}, body: body && JSON.stringify(body) }).then(async (r) => ({ status: r.status, body: await r.json() }));
  try {
    const ask = await call('/api/approvals/ask', { method: 'POST', auth: null, body: { source: 'Claude', title: 'Bash: ls' } });
    assert.equal(ask.status, 200);
    assert.equal((await call('/api/approvals', { auth: null })).status, 401, 'l\'elenco vuole il token');
    const list = await call('/api/approvals');
    assert.equal(list.body.length, 1);
    assert.equal((await call(`/api/approvals/${ask.body.id}/decide`, { method: 'POST', body: {} })).status, 400);
    const dec = await call(`/api/approvals/${ask.body.id}/decide`, { method: 'POST', body: { allow: false } });
    assert.equal(dec.body.state, 'deny');
    assert.equal((await call(`/api/approvals/${ask.body.id}/wait?ms=10`, { auth: null })).body.state, 'deny');

    assert.equal((await call('/api/displays')).body.available, false);
    assert.equal((await call('/api/gaming')).body.active, false);
    assert.equal((await call('/api/claude/start', { method: 'POST' })).body.by, 'agent');

    const open = await call('/api/terminal', { method: 'POST' });
    assert.equal(open.status, 200);
    assert.equal((await call(`/api/terminal/${open.body.id}/input`, { method: 'POST', body: { line: 'echo ok-terminale' } })).status, 200);
    let text = '', next = 0;
    for (let i = 0; i < 20 && !text.includes('ok-terminale'); i++) {
      const r = await call(`/api/terminal/${open.body.id}?since=${next}&wait=2000`);
      text += r.body.text; next = r.body.next;
    }
    assert.match(text, /ok-terminale/);
    assert.equal((await call(`/api/terminal/${open.body.id}`, { method: 'DELETE' })).status, 200);
    assert.equal((await call(`/api/terminal/${open.body.id}`)).status, 404);
  } finally {
    await terminals.closeAll();
    server.close();
  }
});

test('SSH: stato del servizio e porta', async () => {
  const { parseScQuery, parsePort, createSsh } = await import('../src/ssh.js');
  assert.deepEqual(parseScQuery('SERVICE_NAME: sshd\r\n        STATE              : 4  RUNNING\r\n'), { installed: true, running: true });
  assert.deepEqual(parseScQuery('        STATE              : 1  STOPPED\r\n'), { installed: true, running: false });
  assert.deepEqual(parseScQuery('[SC] OpenService FAILED 1060:'), { installed: false, running: false });
  assert.equal(parsePort('#Port 22\nPort 2222\n'), 2222);
  assert.equal(parsePort('#Port 22\n'), 22);
  const ssh = createSsh({ platform: 'win32', programData: os.tmpdir(), exec: async () => { throw Object.assign(new Error('exit 1060'), { stdout: '[SC] OpenService FAILED 1060' }); } });
  assert.equal((await ssh()).installed, false);
});
