import { test } from 'node:test';
import assert from 'node:assert/strict';
import { screenAction, createScreenWatch } from '../src/screenwatch.js';

const tv = (active) => ({ monitor: 'LG TV', active, virtual: false });
const vdd = (active) => ({ monitor: 'VDD by MTT', active, virtual: true });
const info = (displays, streaming = false) => ({ available: true, displays, stream: { streaming } });

test('screenAction: TV accesa insieme allo schermo virtuale → solo la TV', () => {
  assert.equal(screenAction(info([vdd(true), tv(true)])), 'physical');
  assert.equal(screenAction(info([vdd(true), tv(true)], true)), null, 'durante lo stream decide Sunshine');
  assert.equal(screenAction(info([vdd(false), tv(true)])), null, 'già a posto');
  assert.equal(screenAction(info([vdd(true), tv(false)])), null, 'TV spenta: lo schermo virtuale serve a Moonlight');
});

test('screenAction: nessuno schermo acceso → schermo virtuale', () => {
  assert.equal(screenAction(info([vdd(false), tv(false)])), 'virtual');
  assert.equal(screenAction(info([tv(false)])), null, 'senza schermo virtuale non c\'è niente da accendere');
  assert.equal(screenAction({ available: false, displays: [] }), null);
});

test('il controllo agisce solo se la situazione si ripete due volte, e si ferma dopo un errore', async () => {
  let state = info([vdd(true), tv(true)]);
  let t = 0;
  const ran = [];
  let fail = false;
  const w = createScreenWatch({
    displays: async () => state,
    run: async (k) => { ran.push(k); if (fail) throw new Error('no'); },
    log: () => {},
    now: () => t,
    retryMs: 1000,
  });
  assert.equal(await w.check(), null);
  assert.equal(await w.check(), 'physical');
  assert.deepEqual(ran, ['physical']);

  state = info([vdd(true), tv(true)], true);   // stream: niente
  assert.equal(await w.check(), null);
  assert.equal(await w.check(), null);

  state = info([vdd(false), tv(false)]);
  fail = true;
  await w.check();
  assert.equal(await w.check(), 'virtual');
  assert.equal(await w.check(), null, 'in pausa dopo l\'errore');
  t = 2000;
  assert.equal(await w.check(), null);
  assert.equal(await w.check(), 'virtual');
  assert.deepEqual(ran, ['physical', 'virtual', 'virtual']);
});

test('spento da boot.json', async () => {
  const w = createScreenWatch({ displays: async () => info([vdd(true), tv(true)]), run: async () => assert.fail(), enabled: () => false });
  assert.equal(await w.check(), null);
  assert.equal(await w.check(), null);
});
