import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { createServer, tokenMatches } from '../src/http.js';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { GpuArbiter } from '../src/gpu.js';
import { UserStore } from '../src/users.js';

const token = 'segreto-segreto-123';
let server, base;
const calls = [];

before(async () => {
  const full = (id, state = 'stopped') => ({ id, name: id, state, managed: false, pid: null, port: 1, openUrl: null, requires: [], lastError: null });
  const apps = {
    ids: () => ['demo', 'chatbz'],
    list: async () => [full('demo'), full('chatbz')],
    status: async (id) => { if (!['demo', 'chatbz'].includes(id)) throw Object.assign(new Error('app sconosciuta'), { status: 404 }); return full(id); },
    start: async (id) => { calls.push(['start', id]); return full(id, 'running'); },
    stop: async (id) => { calls.push(['stop', id]); return { id, state: 'stopped' }; },
    logs: () => ['riga'],
  };
  const system = {
    info: async () => ({ hostname: 'pc' }),
    power: (a) => { calls.push(['power', a]); return { action: a }; },
  };
  const gpu = new GpuArbiter({ unload: { ollama: async () => ['gemma'], comfy: async () => true }, log: () => {} });
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'agent-http-'));
  const users = new UserStore(path.join(dir, 'users.json'));
  server = createServer({ config: { token, relay: { url: 'http://relay:8765', token: 'r' } }, apps, system, gpu, users, getMode: () => 'server', log: () => {} });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  base = `http://127.0.0.1:${server.address().port}`;
});
after(() => server.close());

const call = (path, { method = 'GET', auth = token, body } = {}) =>
  fetch(base + path, { method, headers: auth ? { Authorization: `Bearer ${auth}` } : {}, body: body && JSON.stringify(body) });

test('tokenMatches', () => {
  assert.equal(tokenMatches(`Bearer ${token}`, token), true);
  assert.equal(tokenMatches('Bearer altro', token), false);
  assert.equal(tokenMatches(undefined, token), false);
  assert.equal(tokenMatches(token, token), false);
});

test('health è pubblico, il resto vuole il token', async () => {
  const health = await call('/api/health', { auth: null });
  assert.equal(health.status, 200);
  assert.equal((await health.json()).mode, 'server');
  assert.equal((await call('/api/apps', { auth: null })).status, 401);
  assert.equal((await call('/api/apps', { auth: 'sbagliato' })).status, 401);
  const res = await call('/api/apps');
  assert.equal(res.status, 200);
  assert.deepEqual((await res.json()).map((a) => a.id), ['demo', 'chatbz']);
});

test('rotte delle app, del sistema e dell\'alimentazione', async () => {
  assert.equal((await call('/api/apps/nessuna')).status, 404);
  assert.deepEqual(await (await call('/api/apps/demo/logs')).json(), { lines: ['riga'] });
  assert.equal((await (await call('/api/apps/demo/start', { method: 'POST' })).json()).accepted, true);
  assert.equal((await (await call('/api/apps/demo/start?wait=1', { method: 'POST' })).json()).state, 'running');
  assert.equal((await call('/api/apps/demo/stop', { method: 'POST' })).status, 200);
  assert.equal((await call('/api/apps/demo/stop')).status, 405);
  const sys = await (await call('/api/system')).json();
  assert.equal(sys.hostname, 'pc');
  assert.equal(sys.arbiter.active, null);
  assert.equal((await call('/api/system/shutdown', { method: 'POST' })).status, 200);
  assert.equal((await call('/api/system/formatta', { method: 'POST' })).status, 404);
  assert.deepEqual(calls.at(-1), ['power', 'shutdown']);
});

test('arbitro della GPU: dal PC stesso senza token', async () => {
  const post = (path, body) => call(path, { method: 'POST', auth: null, body }).then((r) => r.json());
  assert.equal((await call('/api/gpu', { auth: null })).status, 200);
  assert.equal((await call('/api/gpu', { auth: 'sbagliato' })).status, 401);

  const a = await post('/api/gpu/acquire', { who: 'ollama', app: 'chatbz', label: 'Risposta' });
  assert.equal(a.status, 'granted');
  const b = await post('/api/gpu/acquire', { who: 'comfy', app: 'localai', label: 'Immagine', waitMs: 10 });
  assert.equal(b.status, 'waiting');
  assert.equal(b.active, undefined);
  assert.equal((await post(`/api/gpu/leases/${a.lease}/renew`)).ok, true);
  assert.equal((await post(`/api/gpu/leases/${a.lease}/release`)).ok, true);
  const b2 = await post('/api/gpu/acquire', { ticket: b.ticket });
  assert.equal(b2.status, 'granted');
  assert.equal(b2.owner, 'comfy');
  await post(`/api/gpu/leases/${b.ticket}/release`);
  assert.deepEqual(await post('/api/gpu/free'), { ollama: ['gemma'], comfy: true });
  assert.equal((await call('/api/gpu/acquire', { method: 'POST', auth: null, body: { who: 'sd' } })).status, 400);
  assert.equal((await call('/api/gpu/leases/nessuno/renew', { method: 'POST', auth: null })).status, 404);
});

const post = (p, body, auth) => call(p, { method: 'POST', auth, body });

test('primo accesso: Andrea sceglie la password, poi entra con nome e password', async () => {
  assert.deepEqual(await (await call('/api/auth/status', { auth: null })).json(), { setup: true });
  // Senza il token dell'agent (o dal PC stesso) la password non si imposta
  assert.equal((await post('/api/auth/setup', { password: 'password-andrea' }, 'sbagliato')).status, 401);
  assert.equal((await post('/api/auth/setup', { password: 'corta' })).status, 400);
  const setup = await (await post('/api/auth/setup', { password: 'password-andrea' })).json();
  assert.equal(setup.user.name, 'Andrea');
  assert.equal(setup.user.role, 'admin');
  assert.equal((await post('/api/auth/setup', { password: 'un-altra-ancora' })).status, 409);
  assert.deepEqual(await (await call('/api/auth/status', { auth: null })).json(), { setup: false });

  assert.equal((await post('/api/auth/login', { name: 'Andrea', password: 'sbagliata!' }, null)).status, 401);
  const login = await (await post('/api/auth/login', { name: 'andrea', password: 'password-andrea' }, null)).json();
  assert.equal(login.user.name, 'Andrea');
  assert.equal(login.user.relay.url, 'http://relay:8765');
  const me = await (await call('/api/me', { auth: login.token })).json();
  assert.equal(me.role, 'admin');
  assert.equal((await call('/api/system', { auth: login.token })).status, 200);
  assert.equal((await post('/api/auth/logout', {}, login.token)).status, 200);
  assert.equal((await call('/api/me', { auth: login.token })).status, 401);
});

test('utente normale: solo le app abilitate, senza dati tecnici', async () => {
  const admin = (await (await post('/api/auth/login', { name: 'Andrea', password: 'password-andrea' }, null)).json()).token;
  assert.equal((await post('/api/users', { name: 'Giulia', password: 'password-giulia', apps: ['nessuna'] }, admin)).status, 400);
  const created = await (await post('/api/users', { name: 'Giulia', password: 'password-giulia', apps: ['chatbz'] }, admin)).json();
  assert.deepEqual(created, { name: 'Giulia', role: 'user', apps: ['chatbz'] });
  assert.equal((await post('/api/users', { name: 'giulia', password: 'password-giulia' }, admin)).status, 409);

  const g = (await (await post('/api/auth/login', { name: 'Giulia', password: 'password-giulia' }, null)).json()).token;
  const list = await (await call('/api/apps', { auth: g })).json();
  assert.deepEqual(list, [{ id: 'chatbz', name: 'chatbz', state: 'stopped', openUrl: null }]);
  assert.equal((await call('/api/apps/demo', { auth: g })).status, 404);
  assert.equal((await post('/api/apps/demo/start', {}, g)).status, 404);
  const started = await (await post('/api/apps/chatbz/start', {}, g)).json();
  assert.equal(started.accepted, true);
  assert.equal(started.port, undefined);
  assert.deepEqual(calls.at(-1), ['start', 'chatbz']);
  for (const [method, p] of [['POST', '/api/apps/chatbz/stop'], ['GET', '/api/apps/chatbz/logs'], ['GET', '/api/system'],
    ['POST', '/api/system/shutdown'], ['GET', '/api/gpu'], ['POST', '/api/gpu/free'], ['GET', '/api/users']]) {
    assert.equal((await call(p, { method, auth: g })).status, 403, `${method} ${p}`);
  }

  // L'amministratore abilita un'altra app; con una password nuova la vecchia sessione non vale più
  assert.deepEqual((await (await post('/api/users/Giulia', { apps: ['chatbz', 'demo'] }, admin)).json()).apps, ['chatbz', 'demo']);
  assert.equal((await (await call('/api/apps', { auth: g })).json()).length, 2);
  await post('/api/users/Giulia', { password: 'nuova-password' }, admin);
  assert.equal((await call('/api/apps', { auth: g })).status, 401);
  assert.equal((await post('/api/users/Andrea', { apps: [] }, admin)).status, 400);
  assert.equal((await call('/api/users/Andrea', { method: 'DELETE', auth: admin })).status, 400);
  assert.equal((await call('/api/users/Giulia', { method: 'DELETE', auth: admin })).status, 200);
  assert.deepEqual((await (await call('/api/users', { auth: admin })).json()).map((u) => u.name), ['Andrea']);
});

test('dopo 10 token sbagliati in un minuto risponde 429', async () => {
  for (let i = 0; i < 10; i++) await call('/api/apps', { auth: 'no' });
  assert.equal((await call('/api/apps', { auth: 'no' })).status, 429);
  assert.equal((await call('/api/apps')).status, 429);
  assert.equal((await call('/api/gpu', { auth: null })).status, 200);   // le app sul PC continuano a funzionare
});
