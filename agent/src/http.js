import http from 'node:http';
import { timingSafeEqual, createHash } from 'node:crypto';

const VERSION = '0.1.0';
const sha = (s) => createHash('sha256').update(String(s)).digest();

/** Confronto del token a tempo costante. */
export function tokenMatches(header, token) {
  const m = /^Bearer (.+)$/.exec(header || '');
  return !!m && timingSafeEqual(sha(m[1]), sha(token));
}

/**
 * Server HTTP dell'agent. Tutte le rotte tranne /api/health richiedono `Authorization: Bearer <token>`.
 * Dopo 10 tentativi sbagliati in un minuto lo stesso indirizzo riceve 429.
 */
export function createServer({ config, apps, system, getMode = () => null, log = console.log }) {
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
    ['GET', /^\/api\/system$/, () => system.info()],
    ['POST', /^\/api\/gpu\/free$/, () => system.freeGpu()],
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
      const now = Date.now();
      const recent = (failures.get(ip) || []).filter((t) => now - t < 60000);
      if (recent.length >= 10) return send(429, { error: 'troppi tentativi, riprova tra un minuto' });
      if (!tokenMatches(req.headers.authorization, config.token)) {
        failures.set(ip, [...recent, now]);
        return send(401, { error: 'token mancante o sbagliato' });
      }

      for (const [method, re, handler] of routes) {
        const m = re.exec(url.pathname);
        if (!m) continue;
        if (req.method !== method) return send(405, { error: 'metodo non consentito' });
        return send(200, await handler(m, url));
      }
      send(404, { error: 'rotta sconosciuta' });
    } catch (e) {
      send(e.status || 500, { error: e.message });
    }
  });
}
