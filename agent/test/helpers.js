import net from 'node:net';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const fixture = path.join(path.dirname(fileURLToPath(import.meta.url)), 'fixtures', 'fake-app.js');

export function freePort() {
  return new Promise((resolve) => {
    const s = net.createServer().listen(0, '127.0.0.1', () => { const { port } = s.address(); s.close(() => resolve(port)); });
  });
}

export function fakeApp(id, port, extra = {}) {
  return {
    id, name: id, command: process.execPath, args: [fixture], cwd: process.cwd(),
    env: { PORT: String(port) }, health: `http://127.0.0.1:${port}/`, port, openUrl: null,
    requires: [], processNames: [], stop: null, autostart: false, startTimeoutSec: 10, ...extra,
  };
}
