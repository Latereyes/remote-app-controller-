import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseNvidiaSmi, createSystem } from '../src/system.js';
import { parseNetstat } from '../src/proc.js';

test('parseNvidiaSmi', () => {
  assert.deepEqual(parseNvidiaSmi('NVIDIA GeForce RTX 4070 Ti SUPER, 10240, 16376, 61, 97\r\n'), [
    { name: 'NVIDIA GeForce RTX 4070 Ti SUPER', memUsedMiB: 10240, memTotalMiB: 16376, tempC: 61, utilPct: 97 },
  ]);
  assert.equal(parseNvidiaSmi('GPU, 1, 2, [N/A], 3')[0].tempC, null);
});

test('parseNetstat trova il PID in ascolto sulla porta', () => {
  const out = [
    '  Proto  Local Address          Foreign Address        State           PID',
    '  TCP    0.0.0.0:3000           0.0.0.0:0              LISTENING       1111',
    '  TCP    127.0.0.1:31000        127.0.0.1:3100         ESTABLISHED     2222',
    '  TCP    0.0.0.0:3100           0.0.0.0:0              LISTENING       3333',
  ].join('\r\n');
  assert.equal(parseNetstat(out, 3100), 3333);
  assert.equal(parseNetstat(out, 8188), null);
});

test('gpu() restituisce null se nvidia-smi manca', async () => {
  const sys = createSystem({ ollamaUrl: 'http://127.0.0.1:1', comfyUrl: 'http://127.0.0.1:1', power: {} }, { exec: async () => { throw new Error('ENOENT'); } });
  assert.equal(await sys.gpu(), null);
  assert.equal(await sys.ollamaLoaded(), null);
});

test('power esegue il comando configurato dopo la risposta', async () => {
  const ran = [];
  const sys = createSystem({ power: { shutdown: ['shutdown', '/s', '/t', '5'] } }, { exec: async (...a) => ran.push(a), delayMs: 10 });
  assert.deepEqual(sys.power('shutdown'), { action: 'shutdown', inMs: 10 });
  assert.equal(ran.length, 0);
  await new Promise((r) => setTimeout(r, 50));
  assert.deepEqual(ran, [['shutdown', ['/s', '/t', '5']]]);
  assert.throws(() => sys.power('formatta'), /sconosciuta/);
});
