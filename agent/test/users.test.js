import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { UserStore, hashPassword, checkPassword } from '../src/users.js';

const tmpFile = () => path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'agent-users-')), 'users.json');

test('le password si salvano solo come hash', async () => {
  const h = await hashPassword('password-segreta');
  assert.match(h, /^scrypt\$/);
  assert.equal(await checkPassword('password-segreta', h), true);
  assert.equal(await checkPassword('password-sbagliata', h), false);
  assert.equal(await checkPassword('x', 'rotto'), false);
});

test('Andrea amministratore senza password al primo avvio; utenti e sessioni sopravvivono al riavvio', async () => {
  const file = tmpFile();
  const store = new UserStore(file);
  assert.equal(store.needsSetup(), true);
  assert.deepEqual(store.list(), [{ name: 'Andrea', role: 'admin', apps: null, hasPassword: false }]);
  assert.equal(await store.login('Andrea', ''), null);   // senza password non si entra

  const { token } = await store.setup('password-andrea');
  await store.create({ name: 'Giulia', password: 'password-giulia', apps: ['chatbz'] });
  const giulia = await store.login('GIULIA', 'password-giulia');

  const text = fs.readFileSync(file, 'utf8');
  assert.equal(text.includes('password-andrea'), false);
  assert.equal(text.includes(token), false);
  assert.equal(text.includes(giulia.token), false);

  const again = new UserStore(file);
  assert.equal(again.needsSetup(), false);
  assert.equal(again.verify(token).name, 'Andrea');
  assert.deepEqual(again.verify(giulia.token), { name: 'Giulia', role: 'user', apps: ['chatbz'] });
  assert.equal(again.verify('inventato'), null);
});

test('le sessioni scadono', async () => {
  let now = 1_000_000;
  const store = new UserStore(tmpFile(), { now: () => now });
  const { token } = await store.setup('password-andrea');
  assert.ok(store.verify(token));
  now += 181 * 86400000;
  assert.equal(store.verify(token), null);
});
