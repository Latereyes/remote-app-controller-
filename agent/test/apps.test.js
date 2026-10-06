import { test } from 'node:test';
import assert from 'node:assert/strict';
import { AppManager } from '../src/apps.js';
import { freePort, fakeApp } from './helpers.js';

const opts = { pollMs: 100, stopTimeoutMs: 5000 };

test('avvia, mostra i log e ferma un\'app', async () => {
  const port = await freePort();
  const m = new AppManager([fakeApp('demo', port, { env: { PORT: String(port), DELAY_MS: '300' } })], opts);
  assert.equal((await m.status('demo')).state, 'stopped');

  const started = await m.start('demo');
  assert.equal(started.state, 'running');
  assert.equal(started.managed, true);
  assert.ok(started.pid > 0);
  assert.ok(m.logs('demo').some((l) => l.endsWith(`pronto su ${port}`)), 'log senza codici colore');

  const stopped = await m.stop('demo');
  assert.equal(stopped.state, 'stopped');
});

test('avvia prima le dipendenze', async () => {
  const [p1, p2] = [await freePort(), await freePort()];
  const m = new AppManager([fakeApp('base', p1), fakeApp('top', p2, { requires: ['base'] })], opts);
  await m.start('top');
  assert.equal((await m.status('base')).state, 'running');
  assert.equal((await m.status('top')).state, 'running');
  await m.stop('top');
  await m.stop('base');
});

test('chiusura gentile con il token passato all\'avvio', async () => {
  const port = await freePort();
  const m = new AppManager([fakeApp('gentile', port, { stop: { url: `http://127.0.0.1:${port}/shutdown` } })], opts);
  await m.start('gentile');
  await m.stop('gentile');
  assert.ok(m.logs('gentile').some((l) => l.includes('chiusura gentile')));
  assert.ok(m.logs('gentile').some((l) => l.includes('terminata (codice 0)')));
});

test('un\'app che si chiude subito dà errore con il codice di uscita', async () => {
  const port = await freePort();
  const m = new AppManager([fakeApp('rotta', port, { args: ['-e', 'process.exit(3)'] })], opts);
  await assert.rejects(m.start('rotta'), /codice 3/);
  assert.equal((await m.status('rotta')).state, 'stopped');
});

test('app sconosciuta → 404, dipendenze circolari → 400', async () => {
  const m = new AppManager([
    fakeApp('a', 1, { requires: ['b'] }),
    fakeApp('b', 2, { requires: ['a'] }),
  ], opts);
  await assert.rejects(m.status('x'), (e) => e.status === 404);
  await assert.rejects(m.start('a'), (e) => e.status === 400);
});

test('app esterna: si ferma per nome del processo, senza toccare l\'agent', async () => {
  let up = true;
  const killed = [];
  const tools = {
    probe: async () => up,
    killByName: async (names) => { killed.push(...names); up = false; },
    killTree: async () => { throw new Error('non deve chiudere per PID'); },
    pidOnPort: async () => null,
    spawnApp: () => { throw new Error('non deve avviare'); },
  };
  const m = new AppManager([fakeApp('ollama', 11434, { processNames: ['ollama.exe'] })], { ...opts, tools });
  const s = await m.start('ollama');
  assert.equal(s.state, 'running');
  assert.equal(s.managed, false);
  await m.stop('ollama');
  assert.deepEqual(killed, ['ollama.exe']);
});

test('app esterna senza nomi: chiude il PID sulla porta, ma mai il proprio', async () => {
  let up = true;
  const tree = [];
  const tools = {
    probe: async () => up,
    killByName: async () => {},
    killTree: async (pid) => { tree.push(pid); up = false; },
    pidOnPort: async () => 4242,
    spawnApp: () => null,
  };
  await new AppManager([fakeApp('x', 1)], { ...opts, tools }).stop('x');
  assert.deepEqual(tree, [4242]);

  up = true;
  tree.length = 0;
  const self = new AppManager([fakeApp('x', 1)], { ...opts, stopTimeoutMs: 300, tools: { ...tools, pidOnPort: async () => 99 }, selfPid: 99 });
  await assert.rejects(self.stop('x'), /risponde ancora/);
  assert.deepEqual(tree, []);
});
