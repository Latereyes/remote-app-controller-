import http from 'node:http';
import { timingSafeEqual, createHash } from 'node:crypto';

const VERSION = '0.1.0';
const sha = (s) => createHash('sha256').update(String(s)).digest();

/** Confronto del token a tempo costante. */
export function tokenMatches(header, token) {
  const m = /^Bearer (.+)$/.exec(header || '');
  return !!m && timingSafeEqual(sha(m[1]), sha(token));
}

const LOOPBACK = new Set(['127.0.0.1', '::1', '::ffff:127.0.0.1']);

/** Corpo JSON della richiesta (al massimo 64 KB). */
async function readJson(req) {
  let size = 0;
  const chunks = [];
  for await (const c of req) {
    size += c.length;
    if (size > 65536) throw Object.assign(new Error('richiesta troppo grande'), { status: 413 });
    chunks.push(c);
  }
  if (!size) return {};
  try { return JSON.parse(Buffer.concat(chunks).toString('utf8')); }
  catch { throw Object.assign(new Error('JSON non valido'), { status: 400 }); }
}

/**
 * Server HTTP dell'agent. Tutte le rotte tranne /api/health richiedono `Authorization: Bearer <token>`.
 * Le rotte dell'arbitro della GPU (`local`) sono aperte anche senza token, ma solo dal PC stesso:
 * ChatBz e LocalAI le usano senza configurazione.
 * Dopo 10 tentativi sbagliati in un minuto lo stesso indirizzo riceve 429.
 */
export function createServer({ config, apps, system, gpu, getMode = () => null, log = console.log }) {
  const failures = new Map();

  const routes = [
    ['GET', /^\/api\/apps$/, () => apps.list()],
    ['GET', /^\/api\/apps\/([a-z0-9-]+)$/, (m) => apps.status(m[1])],
    ['GET', /^\/api\/apps\/([a-z0-9-]+)\/logs$/, (m, url) => ({ lines: apps.logs(m[1], Number(url.searchParams.get('lines') || 200)) })],
    ['POST', /^\/api\/apps\/([a-z0-9-]+)\/start$/, async (m, url) => {
      if (url.searchParams.get('wait') === '1') return apps.start(m[1]);
      apps.start(m[1]).catch((e) => log(`[start ${m[1]}] ${e.message}`));
      return { ...(await apps.status(m[1])), state: 'starting', accepted: true };
    }],
    ['POST', /^\/api\/apps\/([a-z0-9-]+)\/stop$/, (m) => apps.stop(m[1])],
    ['GET', /^\/api\/system$/, async () => ({ ...(await system.info()), arbiter: gpu.state() })],
    ['GET', /^\/api\/gpu$/, () => gpu.state(), { local: true }],
    ['POST', /^\/api\/gpu\/free$/, () => gpu.free(), { local: true }],
    ['POST', /^\/api\/gpu\/acquire$/, async (m, url, req) => {
      const b = await readJson(req);
      const id = b.ticket || gpu.request({ who: b.who, app: b.app, label: b.label, priority: b.priority });
      return gpu.wait(id, Math.min(Number(b.waitMs ?? 20000), 25000));
    }, { local: true }],
    ['POST', /^\/api\/gpu\/leases\/([A-Za-z0-9_-]+)\/renew$/, (m) => gpu.renew(m[1]), { local: true }],
    ['POST', /^\/api\/gpu\/leases\/([A-Za-z0-9_-]+)\/release$/, (m) => gpu.release(m[1]), { local: true }],
    ['POST', /^\/api\/system\/(shutdown|restart|sleep)$/, (m) => { log(`[power] ${m[1]} richiesto`); return system.power(m[1]); }],
  ];

  return http.createServer(async (req, res) => {
    const send = (status, body) => {
      res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
      res.end(JSON.stringify(body));
    };
    const url = new URL(req.url, 'http://agent');
    try {
      if (req.method === 'GET' && url.pathname === '/api/health') {
        return send(200, { ok: true, service: 'remote-app-controller', version: VERSION, mode: getMode() });
      }

      const ip = req.socket.remoteAddress;
      const route = routes.find(([, re]) => re.test(url.pathname));
      const localOk = route?.[3]?.local && LOOPBACK.has(ip) && !req.headers.authorization;
      const now = Date.now();
      const recent = (failures.get(ip) || []).filter((t) => now - t < 60000);
      if (!localOk && recent.length >= 10) return send(429, { error: 'troppi tentativi, riprova tra un minuto' });
      if (!localOk && !tokenMatches(req.headers.authorization, config.token)) {
        failures.set(ip, [...recent, now]);
        return send(401, { error: 'token mancante o sbagliato' });
      }

      if (!route) return send(404, { error: 'rotta sconosciuta' });
      const [method, re, handler] = route;
      if (req.method !== method) return send(405, { error: 'metodo non consentito' });
      send(200, await handler(re.exec(url.pathname), url, req));
    } catch (e) {
      send(e.status || 500, { error: e.message });
    }
  });
}
