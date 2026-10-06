import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { createServer, tokenMatches } from '../src/http.js';

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
    freeGpu: async () => ({ ollama: [], comfy: true }),
    power: (a) => { calls.push(['power', a]); return { action: a }; },
  };
  server = createServer({ config: { token }, apps, system, log: () => {} });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  base = `http://127.0.0.1:${server.address().port}`;
});
after(() => server.close());

const call = (path, { method = 'GET', auth = token } = {}) =>
  fetch(base + path, { method, headers: auth ? { Authorization: `Bearer ${auth}` } : {} });

test('tokenMatches', () => {
  assert.equal(tokenMatches(`Bearer ${token}`, token), true);
  assert.equal(tokenMatches('Bearer altro', token), false);
  assert.equal(tokenMatches(undefined, token), false);
  assert.equal(tokenMatches(token, token), false);
});

test('health è pubblico, il resto vuole il token', async () => {
  assert.equal((await call('/api/health', { auth: null })).status, 200);
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
  assert.deepEqual(await (await call('/api/system')).json(), { hostname: 'pc' });
  assert.equal((await call('/api/system/shutdown', { method: 'POST' })).status, 200);
  assert.equal((await call('/api/system/formatta', { method: 'POST' })).status, 404);
  assert.deepEqual(calls.at(-1), ['power', 'shutdown']);
});

test('dopo 10 token sbagliati in un minuto risponde 429', async () => {
  for (let i = 0; i < 10; i++) await call('/api/apps', { auth: 'no' });
  assert.equal((await call('/api/apps', { auth: 'no' })).status, 429);
  assert.equal((await call('/api/apps')).status, 429);
});
