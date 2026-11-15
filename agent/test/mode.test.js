import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createModeControl } from '../src/mode.js';

const setup = (mode, boot) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'agent-mode-'));
  if (mode) fs.writeFileSync(path.join(dir, 'mode.txt'), mode);
  if (boot) fs.writeFileSync(path.join(dir, 'boot.json'), JSON.stringify(boot));
  const stops = [];
  const apps = { ids: () => ['ollama', 'comfy', 'chatbz'], stop: async (id) => { stops.push(id); } };
  return { dir, stops, mode: createModeControl({ bootDir: dir, apps, log: () => {} }) };
};

test('per giocare prima del countdown: resta la richiesta per il countdown', async () => {
  const { dir, stops, mode } = setup(null);
  assert.equal(mode.get(), null);
  const r = await mode.requestGame('Andrea');
  assert.deepEqual(r, { mode: null, stopped: [], waiting: true });
  assert.match(fs.readFileSync(path.join(dir, 'game.txt'), 'utf8'), /Andrea/);
  assert.deepEqual(stops, []);
});

test('per giocare in modalità server: chiude le app del countdown e passa a Xbox', async () => {
  const { stops, mode } = setup('server', { serverApps: ['ollama', 'comfy', 'sconosciuta'] });
  const r = await mode.requestGame('Andrea');
  assert.deepEqual(r, { mode: 'xbox', stopped: ['ollama', 'comfy'], waiting: false });
  assert.deepEqual(stops, ['ollama', 'comfy']);
  assert.equal(mode.get(), 'xbox');
});

test('per giocare già in modalità Xbox: non chiude niente', async () => {
  const { stops, mode } = setup('xbox');
  assert.equal((await mode.requestGame()).mode, 'xbox');
  assert.deepEqual(stops, []);
});
