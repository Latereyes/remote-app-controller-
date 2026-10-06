import { test } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import { expandEnv, normalize } from '../src/config.js';

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const token = 'x'.repeat(20);

test('expandEnv sostituisce %VAR% senza badare alle maiuscole', () => {
  assert.equal(expandEnv('%userprofile%\\Documents', { USERPROFILE: 'C:\\Users\\andrea' }), 'C:\\Users\\andrea\\Documents');
  assert.equal(expandEnv('%NON_ESISTE%\\x', {}), '%NON_ESISTE%\\x');
});

test('normalize rifiuta token corti, id doppi e dipendenze inesistenti', () => {
  const app = { id: 'a', command: 'x', health: 'http://h' };
  assert.throws(() => normalize({ token: 'corto', apps: [] }), /token/);
  assert.throws(() => normalize({ token, apps: [app, app] }), /duplicata/);
  assert.throws(() => normalize({ token, apps: [{ ...app, requires: ['b'] }] }), /non esiste/);
  assert.throws(() => normalize({ token, apps: [{ ...app, id: 'A B' }] }), /id non valido/);
});

test('normalize risolve i comandi relativi nella cartella dell\'app', () => {
  const cfg = normalize({ token, apps: [
    { id: 'bat', command: 'start.bat', cwd: '/srv/app', health: 'http://h' },
    { id: 'path', command: 'not-a-path', cwd: '/srv/app', health: 'http://h' },
  ] });
  assert.equal(cfg.apps[0].command, path.resolve('/srv/app', 'start.bat'));
  assert.equal(cfg.apps[1].command, 'not-a-path');
  assert.equal(cfg.port, 7070);
  assert.deepEqual(cfg.power.shutdown, ['shutdown', '/s', '/t', '5']);
});

test('config.example.json è valido', () => {
  const raw = JSON.parse(fs.readFileSync(path.join(root, 'config.example.json'), 'utf8'));
  const cfg = normalize({ ...raw, token }, { USERPROFILE: 'C:\\Users\\andrea' });
  assert.deepEqual(cfg.apps.map((a) => a.id), ['ollama', 'comfy', 'chatbz', 'localai']);
  assert.deepEqual(cfg.apps.find((a) => a.id === 'chatbz').requires, ['ollama', 'comfy']);
});
