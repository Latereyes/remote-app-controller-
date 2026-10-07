import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { createServer, tokenMatches } from '../src/http.js';
import { GpuArbiter } from '../src/gpu.js';

const token = 'segreto-segreto-123';
let server, base;
const calls = [];

before(async () => {
  const apps = {
    list: async () => [{ id: 'demo', state: 'stopped' }],
    status: async (id) => { if (id !== 'demo') throw Object.assign(new Error('app sconosciuta'), { status: 404 }); return { id, state: 'stopped' }; },
    start: async (id) => { calls.push(['start', id]); return { id, state: 'running' }; },
    stop: async (id) => { calls.push(['stop', id]); return { id, state: 'stopped' }; },
    logs: () => ['riga'],
  };
  const system = {
    info: async () => ({ hostname: 'pc' }),
    power: (a) => { calls.push(['power', a]); return { action: a }; },
  };
  const gpu = new GpuArbiter({ unload: { ollama: async () => ['gemma'], comfy: async () => true }, log: () => {} });
  server = createServer({ config: { token }, apps, system, gpu, getMode: () => 'server', log: () => {} });
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
  assert.deepEqual(await res.json(), [{ id: 'demo', state: 'stopped' }]);
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
  assert.equal(b.active.app, 'chatbz');
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

test('dopo 10 token sbagliati in un minuto risponde 429', async () => {
  for (let i = 0; i < 10; i++) await call('/api/apps', { auth: 'no' });
  assert.equal((await call('/api/apps', { auth: 'no' })).status, 429);
  assert.equal((await call('/api/apps')).status, 429);
  assert.equal((await call('/api/gpu', { auth: null })).status, 200);   // le app sul PC continuano a funzionare
});
