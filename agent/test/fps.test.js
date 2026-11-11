import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { EventEmitter } from 'node:events';
import { parseHeader, parseRow, frameStats, pickGame, findPresentMon, createFps, ARG_SETS } from '../src/fps.js';

const V1 = 'Application,ProcessID,SwapChainAddress,Runtime,SyncInterval,PresentFlags,AllowsTearing,PresentMode,Dropped,TimeInSeconds,MsInPresentAPI,MsBetweenPresents,MsBetweenDisplayChange,MsUntilRenderComplete,MsUntilDisplayed';
const row = (app, pid, ms, disp = ms) => `${app},${pid},0x1,DXGI,0,0,1,Hardware: Independent Flip,0,1.0,0.1,${ms},${disp},2.0,3.0`;

test('intestazione e righe di PresentMon (1.x, 2.x con --v1_metrics e metriche nuove)', () => {
  const h = parseHeader('﻿' + V1);
  assert.ok(h);
  const r = parseRow(row('Cyberpunk2077.exe', 1234, '8.33', '16.67'), h);
  assert.deepEqual(r, { app: 'Cyberpunk2077.exe', pid: 1234, ms: 8.33, displayMs: 16.67, mode: 'Hardware: Independent Flip' });
  // Frame non mostrato: MsBetweenDisplayChange vale 0 o NA
  assert.equal(parseRow(row('a.exe', 1, '8', 'NA'), h).displayMs, null);
  assert.equal(parseRow('a.exe,1,0x1', h), null);
  // PresentMon 2.x senza --v1_metrics
  const h2 = parseHeader('Application,ProcessID,SwapChainAddress,PresentRuntime,SyncInterval,PresentFlags,AllowsTearing,PresentMode,FrameType,CPUStartTime,FrameTime,CPUBusy,CPUWait,GPULatency,GPUTime,GPUBusy,GPUWait,DisplayLatency,DisplayedTime');
  assert.equal(parseRow('g.exe,9,0x1,DXGI,0,0,0,Composed: Flip,Application,1,6.94,1,1,1,1,1,1,1,13.88', h2).ms, 6.94);
  assert.equal(parseHeader('Avvio della traccia...'), null);
});

test('FPS medi, 1% low e scelta del gioco', () => {
  const times = [...Array(99).fill(10), 50];
  const s = frameStats(times);
  assert.equal(s.fps, Math.round(1000 / (1040 / 100)));
  assert.equal(s.low1, 20);
  assert.equal(s.worstMs, 50);
  assert.equal(frameStats([]), null);
  const m = new Map([['dwm.exe', { times: Array(200).fill(4) }], ['Game.exe', { times: Array(100).fill(8) }], ['msedge.exe', { times: Array(300).fill(4) }]]);
  assert.equal(pickGame(m)[0], 'Game.exe');
  assert.equal(pickGame(new Map([['dwm.exe', { times: [1] }]])), null);
});

test('PresentMon cercato in tools\\', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'pm-'));
  assert.equal(findPresentMon(null, dir), null);
  fs.writeFileSync(path.join(dir, 'PresentMon-2.3.0-x64.exe'), '');
  assert.equal(findPresentMon(null, dir), path.join(dir, 'PresentMon-2.3.0-x64.exe'));
  fs.writeFileSync(path.join(dir, 'PresentMon.exe'), '');
  assert.equal(findPresentMon(null, dir), path.join(dir, 'PresentMon.exe'));
  assert.equal(findPresentMon(path.join(dir, 'manca.exe'), dir), null);
  assert.equal(findPresentMon(null, path.join(dir, 'non-esiste')), null);
});

function fakeChild() {
  const c = new EventEmitter();
  c.stdout = new EventEmitter();
  c.stderr = new EventEmitter();
  c.pid = 42;
  c.killed = false;
  c.kill = () => { c.killed = true; };
  return c;
}

test('PresentMon parte quando si guarda, legge gli FPS, si chiude da solo e gestisce gli errori', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'pm-'));
  fs.writeFileSync(path.join(dir, 'PresentMon.exe'), '');
  let t = 1000;
  const spawned = [];
  const fps = createFps({ toolsDir: dir, platform: 'win32', now: () => t, idleMs: 60000, retryMs: 30000,
    spawn: (file, args) => { const c = fakeChild(); spawned.push({ file, args, c }); return c; } });
  try {
    assert.equal(createFps({ toolsDir: dir, platform: 'linux' }).read().available, false);
    let r = fps.read();
    assert.equal(spawned.length, 1);
    assert.deepEqual(spawned[0].args, ARG_SETS[0]);
    assert.equal(r.game, null);
    const out = spawned[0].c.stdout;
    out.emit('data', Buffer.from(`${V1}\r\n`));
    // 60 frame a 16,67 ms del gioco, rumore del desktop; riga spezzata a metà fra due pezzi
    const lines = Array.from({ length: 60 }, () => row('Game.exe', 77, '16.667', '16.667')).join('\r\n') + '\r\n' + row('dwm.exe', 5, '4', '4');
    out.emit('data', Buffer.from(lines.slice(0, 100)));
    out.emit('data', Buffer.from(lines.slice(100) + '\r\n'));
    t += 2000;
    r = fps.read();
    assert.equal(r.game.process, 'Game.exe');
    assert.equal(r.fps, 60);
    assert.equal(r.displayedFps, 60);
    assert.equal(r.low1, 60);
    // I frame più vecchi della finestra (3 s) spariscono
    t += 4000;
    assert.equal(fps.read().game, null);
    // Un minuto senza richieste: PresentMon si chiude
    t += 61000;
    fps.sweep();
    assert.equal(spawned[0].c.killed, true);
    assert.equal(fps.running, false);
    // Si riapre il pannello: riparte
    fps.read();
    assert.equal(spawned.length, 2);
  } finally {
    fps.close();
  }
  assert.equal(spawned[1].c.killed, true);

  // Opzione sconosciuta: si riprova con meno opzioni; accesso negato: messaggio chiaro e niente riavvii continui
  const s2 = [];
  const f2 = createFps({ toolsDir: dir, platform: 'win32', now: () => t,
    spawn: (file, args) => { const c = fakeChild(); s2.push({ args, c }); return c; } });
  try {
    f2.read();
    s2[0].c.stderr.emit('data', Buffer.from('error: unrecognized argument --no_console_stats'));
    s2[0].c.emit('exit', 1);
    f2.read();
    assert.deepEqual(s2[1].args, ARG_SETS[1]);
    s2[1].c.stderr.emit('data', Buffer.from('error: failed to start trace session (access denied).'));
    s2[1].c.emit('exit', 5);
    const r = f2.read();
    assert.equal(r.available, false);
    assert.match(r.reason, /permessi/);
    assert.equal(s2.length, 2);
    t += 31000;
    f2.read();
    assert.equal(s2.length, 3);
  } finally {
    f2.close();
  }
});
