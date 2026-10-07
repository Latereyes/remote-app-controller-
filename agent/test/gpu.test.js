import { test } from 'node:test';
import assert from 'node:assert/strict';
import { GpuArbiter } from '../src/gpu.js';

function arbiter(opts = {}) {
  const unloads = [];
  const gpu = new GpuArbiter({
    unload: { ollama: async () => unloads.push('ollama'), comfy: async () => unloads.push('comfy') },
    log: () => {}, ...opts,
  });
  return { gpu, unloads };
}

const grant = async (gpu, id) => (await gpu.wait(id, 1000)).status;

test('un lavoro alla volta; chi cambia motore scarica l\'altro', async () => {
  const { gpu, unloads } = arbiter();
  const a = gpu.request({ who: 'ollama', app: 'chatbz', label: 'Risposta' });
  assert.equal(await grant(gpu, a), 'granted');
  assert.deepEqual(unloads, ['comfy']);   // all'avvio non si sa chi c'è: si libera ComfyUI

  const b = gpu.request({ who: 'comfy', app: 'localai', label: 'Immagine' });
  const waiting = await gpu.wait(b, 10);
  assert.equal(waiting.status, 'waiting');
  assert.equal(waiting.position, 1);
  assert.equal(waiting.active.app, 'chatbz');

  gpu.release(a);
  assert.equal(await grant(gpu, b), 'granted');
  assert.deepEqual(unloads, ['comfy', 'ollama']);
  assert.equal(gpu.owner, 'comfy');

  gpu.release(b);
  const c = gpu.request({ who: 'comfy', app: 'chatbz' });
  assert.equal(await grant(gpu, c), 'granted');
  assert.deepEqual(unloads, ['comfy', 'ollama']);   // ComfyUI è già caricato: niente scambio
  gpu.release(c);
  assert.equal(gpu.idle(), true);
});

test('la priorità alta passa davanti ai lavori in sottofondo', async () => {
  const { gpu } = arbiter();
  const first = gpu.request({ who: 'ollama', app: 'chatbz', label: 'in corso' });
  await grant(gpu, first);
  const low = gpu.request({ who: 'comfy', app: 'chatbz', label: 'post social', priority: 'low' });
  const high = gpu.request({ who: 'ollama', app: 'localai', label: 'chat', priority: 'high' });
  assert.deepEqual(gpu.state().queue.map((t) => t.label), ['chat', 'post social']);
  gpu.release(first);
  assert.equal(await grant(gpu, high), 'granted');
  assert.equal((await gpu.wait(low, 10)).status, 'waiting');
});

test('permesso non rinnovato e biglietti abbandonati scadono', async () => {
  let now = 1000;
  const { gpu } = arbiter({ now: () => now, leaseMs: 100, ticketMs: 50 });
  const a = gpu.request({ who: 'none', app: 'bloccata' });
  await grant(gpu, a);
  const gone = gpu.request({ who: 'none', app: 'chiusa' });
  const b = gpu.request({ who: 'none', app: 'viva' });
  now += 60;
  gpu.renew(a);
  await gpu.wait(b, 0);   // "viva" ricontrolla, "chiusa" no
  gpu.sweep();
  assert.equal(gpu.state().active.app, 'bloccata');
  assert.deepEqual(gpu.state().queue.map((t) => t.app), ['viva']);
  await assert.rejects(gpu.wait(gone, 0), /scaduto/);
  now += 101;
  gpu.sweep();
  assert.equal(await grant(gpu, b), 'granted');
  assert.throws(() => gpu.renew(a), /scaduto/);
});

test('rinuncia durante il passaggio: la GPU passa al successivo', async () => {
  let unblock;
  const gpu = new GpuArbiter({ unload: { ollama: () => new Promise((r) => { unblock = r; }), comfy: async () => {} }, log: () => {} });
  const a = gpu.request({ who: 'comfy', app: 'a' });
  const b = gpu.request({ who: 'none', app: 'b' });
  assert.equal(gpu.state().active.phase, 'switching');
  gpu.release(a);
  unblock();
  assert.equal(await grant(gpu, b), 'granted');
});

test('free aspetta il proprio turno e scarica tutto', async () => {
  const { gpu, unloads } = arbiter();
  const a = gpu.request({ who: 'ollama', app: 'chatbz' });
  await grant(gpu, a);
  const freeing = gpu.free();
  await new Promise((r) => setTimeout(r, 10));
  assert.deepEqual(unloads, ['comfy']);
  gpu.release(a);
  await freeing;
  assert.deepEqual(unloads, ['comfy', 'ollama', 'comfy']);
  assert.equal(gpu.owner, null);
  assert.equal(gpu.idle(), true);
});

test('who non valido', () => {
  const { gpu } = arbiter();
  assert.throws(() => gpu.request({ who: 'stable-diffusion' }), /who/);
});
