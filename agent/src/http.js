import http from 'node:http';
import net from 'node:net';
import { timingSafeEqual, createHash } from 'node:crypto';

const VERSION = '0.2.0';
const sha = (s) => createHash('sha256').update(String(s)).digest();

/** Confronto del token a tempo costante. */
export function tokenMatches(header, token) {
  const m = /^Bearer (.+)$/.exec(header || '');
  return !!m && timingSafeEqual(sha(m[1]), sha(token));
}

const LOOPBACK = new Set(['127.0.0.1', '::1', '::ffff:127.0.0.1']);

/** Indirizzo come numero (BigInt) e famiglia; gli IPv4 scritti come IPv6 («::ffff:1.2.3.4») tornano IPv4. */
function ipValue(ip) {
  const v4 = /^(?:::ffff:)?(\d+\.\d+\.\d+\.\d+)$/i.exec(ip || '');
  if (v4 && net.isIPv4(v4[1])) return { v: v4[1].split('.').reduce((a, x) => (a << 8n) + BigInt(x), 0n), bits: 32 };
  if (!net.isIPv6(ip || '')) return null;
  const [head, tail = ''] = ip.split('%')[0].split('::');
  const part = (s) => (s ? s.split(':') : []);
  const h = part(head), t = part(tail);
  const groups = ip.includes('::') ? [...h, ...Array(8 - h.length - t.length).fill('0'), ...t] : h;
  return { v: groups.reduce((a, g) => (a << 16n) + BigInt(`0x${g || '0'}`), 0n), bits: 128 };
}

/** true se `ip` sta in una delle reti (es. "100.64.0.0/10"). */
export function inNets(ip, nets) {
  const a = ipValue(ip);
  if (!a) return false;
  return nets.some((cidr) => {
    const [base, len] = cidr.split('/');
    const b = ipValue(base);
    if (!b || b.bits !== a.bits) return false;
    const shift = BigInt(b.bits - Number(len ?? b.bits));
    return (a.v >> shift) === (b.v >> shift);
  });
}

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

/** Token dalla richiesta ("Authorization: Bearer ..."), o null. */
const bearer = (header) => /^Bearer (.+)$/.exec(header || '')?.[1] || null;

/** Quello che vede un utente normale di un'app: nome, se è accesa e il link per aprirla. Niente dati tecnici. */
const userApp = (a) => ({ id: a.id, name: a.name, state: a.state, openUrl: a.openUrl });

/**
 * Server HTTP dell'agent.
 * Accesso: token di sessione dell'utente (POST /api/auth/login) oppure il token di config.json,
 * che vale come amministratore (lo usano il countdown all'accensione e gli script sul PC).
 * Le rotte segnate `user` sono aperte anche agli utenti normali, ma solo per le app che l'amministratore
 * ha abilitato; tutte le altre (log, sistema, GPU, alimentazione, utenti) sono solo per l'amministratore.
 * Le rotte dell'arbitro della GPU (`local`) sono aperte anche senza token, ma solo dal PC stesso:
 * ChatBz e LocalAI le usano senza configurazione.
 * Dopo 10 tentativi sbagliati (token o password) in un minuto lo stesso indirizzo riceve 429.
 */
export function createServer({ config, apps, system, gpu, users, getMode = () => null, requestGame = null,
  displays = null, gaming = null, terminals = null, claude = null, approvals = null, log = console.log }) {
  const failures = new Map();
  const trusted = config.trustedNets || ['100.64.0.0/10', 'fd7a:115c:a1e0::/48'];
  const need = (x, what) => { if (!x) throw Object.assign(new Error(`${what} non disponibile su questo agent`), { status: 501 }); return x; };
  const allowed = (who, id) => who.role === 'admin' || who.apps.includes(id);
  const checkApps = (list) => {
    if (list === undefined) return;
    const known = new Set(apps.ids());
    const bad = (Array.isArray(list) ? list : []).filter((id) => !known.has(id));
    if (bad.length) throw Object.assign(new Error(`app sconosciute: ${bad.join(', ')}`), { status: 400 });
  };
  /** Per un utente normale un'app non abilitata non esiste. */
  const appFor = (who, id) => {
    if (!allowed(who, id)) throw Object.assign(new Error('app sconosciuta'), { status: 404 });
    return id;
  };
  // Il relay del telefono di casa serve a tutti per accendere il PC: l'app lo prende da qui dopo l'accesso
  const me = (who) => ({ name: who.name, role: who.role, apps: who.apps, relay: config.relay || null });

  const user = { role: 'user' };
  const routes = [
    ['GET', /^\/api\/me$/, (m, url, req, who) => me(who), user],
    ['POST', /^\/api\/auth\/logout$/, (m, url, req, who) => (who.token ? users.logout(who.token) : { ok: true }), user],
    ['GET', /^\/api\/apps$/, async (m, url, req, who) => {
      const list = await apps.list();
      return who.role === 'admin' ? list : list.filter((a) => allowed(who, a.id)).map(userApp);
    }, user],
    ['GET', /^\/api\/apps\/([a-z0-9-]+)$/, async (m, url, req, who) => {
      const a = await apps.status(appFor(who, m[1]));
      return who.role === 'admin' ? a : userApp(a);
    }, user],
    ['GET', /^\/api\/apps\/([a-z0-9-]+)\/logs$/, (m, url) => ({ lines: apps.logs(m[1], Number(url.searchParams.get('lines') || 200)) })],
    ['POST', /^\/api\/apps\/([a-z0-9-]+)\/start$/, async (m, url, req, who) => {
      const id = appFor(who, m[1]);
      if (who.role !== 'admin') log(`[start ${id}] richiesto da ${who.name}`);
      const view = who.role === 'admin' ? (a) => a : userApp;
      if (url.searchParams.get('wait') === '1') return view(await apps.start(id));
      apps.start(id).catch((e) => log(`[start ${id}] ${e.message}`));
      return { ...view(await apps.status(id)), state: 'starting', accepted: true };
    }, user],
    ['POST', /^\/api\/apps\/([a-z0-9-]+)\/stop$/, (m) => apps.stop(m[1])],
    // «Per giocare» (Steam Deck): il countdown resta in modalità Xbox, o si lascia la modalità server
    ['POST', /^\/api\/mode\/game$/, (m, url, req, who) => {
      if (!requestGame) throw Object.assign(new Error('non disponibile'), { status: 501 });
      return requestGame(who?.name || 'PC');
    }],
    // Schermi accesi e quale sta guardando Moonlight; dati per il pannello gioco
    ['GET', /^\/api\/displays$/, () => need(displays, 'Monitor')()],
    ['GET', /^\/api\/gaming$/, () => need(gaming, 'Modalità gioco')()],
    // Terminale sul PC: solo amministratore e solo da Tailscale (o dal PC stesso). Ogni comando finisce nel log.
    ['POST', /^\/api\/terminal$/, (m, url, req, who) => need(terminals, 'Terminale').open(who.name), { vpn: true }],
    ['GET', /^\/api\/terminal\/([A-Za-z0-9_-]+)$/, (m, url) => need(terminals, 'Terminale').read(m[1], Number(url.searchParams.get('since') || 0), Number(url.searchParams.get('wait') || 0)), { vpn: true }],
    ['POST', /^\/api\/terminal\/([A-Za-z0-9_-]+)\/input$/, async (m, url, req) => need(terminals, 'Terminale').input(m[1], (await readJson(req)).line), { vpn: true }],
    ['DELETE', /^\/api\/terminal\/([A-Za-z0-9_-]+)$/, (m) => need(terminals, 'Terminale').close(m[1]), { vpn: true }],
    // Claude sul PC con il controllo remoto
    ['GET', /^\/api\/claude$/, () => need(claude, 'Claude').status(), { vpn: true }],
    ['POST', /^\/api\/claude\/start$/, (m, url, req, who) => need(claude, 'Claude').start(who.name), { vpn: true }],
    ['POST', /^\/api\/claude\/stop$/, (m, url, req, who) => need(claude, 'Claude').stop(who.name), { vpn: true }],
    // Richieste di permesso: le fanno Claude e gli script dal PC stesso, le decide l'amministratore dall'app
    ['POST', /^\/api\/approvals\/ask$/, async (m, url, req) => need(approvals, 'Permessi').ask(await readJson(req)), { local: true, localOnly: true }],
    ['GET', /^\/api\/approvals\/([A-Za-z0-9_-]+)\/wait$/, (m, url) => need(approvals, 'Permessi').wait(m[1], Number(url.searchParams.get('ms') || 20000)), { local: true, localOnly: true }],
    ['GET', /^\/api\/approvals$/, () => need(approvals, 'Permessi').pending(), { vpn: true }],
    ['POST', /^\/api\/approvals\/([A-Za-z0-9_-]+)\/decide$/, async (m, url, req, who) => {
      const b = await readJson(req);
      if (typeof b.allow !== 'boolean') throw Object.assign(new Error('serve "allow": true o false'), { status: 400 });
      return need(approvals, 'Permessi').decide(m[1], b.allow, who.name);
    }, { vpn: true }],
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
    ['GET', /^\/api\/users$/, () => users.list()],
    ['POST', /^\/api\/users$/, async (m, url, req) => {
      const b = await readJson(req);
      checkApps(b.apps);
      const u = await users.create(b);
      log(`[utenti] creato ${u.name}`);
      return u;
    }],
    ['POST', /^\/api\/users\/([^/]+)$/, async (m, url, req) => {
      const b = await readJson(req);
      checkApps(b.apps);
      return users.update(decodeURIComponent(m[1]), { password: b.password, apps: b.apps });
    }],
    ['DELETE', /^\/api\/users\/([^/]+)$/, (m) => {
      const name = decodeURIComponent(m[1]);
      log(`[utenti] eliminato ${name}`);
      return users.remove(name);
    }],
  ];

  return http.createServer(async (req, res) => {
    const send = (status, body) => {
      res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
      res.end(JSON.stringify(body));
    };
    const url = new URL(req.url, 'http://agent');
    const ip = req.socket.remoteAddress;
    const now = Date.now();
    const recent = () => (failures.get(ip) || []).filter((t) => now - t < 60000);
    const fail = () => failures.set(ip, [...recent(), now]);
    try {
      if (req.method === 'GET' && url.pathname === '/api/health') {
        return send(200, { ok: true, service: 'remote-app-controller', version: VERSION, mode: getMode() });
      }
      if (req.method === 'GET' && url.pathname === '/api/auth/status') {
        return send(200, { setup: users.needsSetup() });
      }

      const matching = routes.filter(([, re]) => re.test(url.pathname));
      const route = matching.find(([method]) => method === req.method);
      const localOk = matching.some((r) => r[3]?.local) && LOOPBACK.has(ip) && !req.headers.authorization;
      if (!localOk && recent().length >= 10) return send(429, { error: 'troppi tentativi, riprova tra un minuto' });

      if (req.method === 'POST' && url.pathname === '/api/auth/login') {
        const b = await readJson(req);
        const session = await users.login(b.name, b.password);
        if (!session) { fail(); return send(401, { error: 'nome o password sbagliati' }); }
        log(`[accesso] ${session.user.name}`);
        return send(200, { token: session.token, user: me(session.user) });
      }
      // Primo avvio: la password di Andrea si sceglie con il token di config.json (o dal PC stesso)
      if (req.method === 'POST' && url.pathname === '/api/auth/setup') {
        const machine = tokenMatches(req.headers.authorization, config.token) || (LOOPBACK.has(ip) && !req.headers.authorization);
        if (!machine) { fail(); return send(401, { error: 'serve il token dell\'agent (in config.json sul PC)' }); }
        const b = await readJson(req);
        const session = await users.setup(b.password);
        log(`[accesso] password di ${session.user.name} impostata`);
        return send(200, { token: session.token, user: me(session.user) });
      }

      let who = null;
      if (!localOk) {
        const token = bearer(req.headers.authorization);
        if (token && tokenMatches(req.headers.authorization, config.token)) who = { name: 'agent', role: 'admin', apps: null };
        else if (token) {
          const u = users.verify(token);
          if (u) who = { ...u, token };
        }
        if (!who) { fail(); return send(401, { error: 'accesso scaduto o token sbagliato' }); }
      }

      if (!matching.length) return send(404, { error: 'rotta sconosciuta' });
      if (!route) return send(405, { error: 'metodo non consentito' });
      const [, re, handler, opts] = route;
      // Le rotte solo-PC (richieste di permesso) non si aprono da fuori nemmeno col token
      if (opts?.localOnly && !LOOPBACK.has(ip)) return send(403, { error: 'solo dal PC stesso' });
      if (who && who.role !== 'admin' && opts?.role !== 'user') return send(403, { error: 'riservato all\'amministratore' });
      if (opts?.vpn && !LOOPBACK.has(ip) && !inNets(ip, trusted)) {
        log(`[sicurezza] ${url.pathname} rifiutato da ${ip}: non arriva da Tailscale`);
        return send(403, { error: 'terminale, Claude e permessi funzionano solo attraverso Tailscale' });
      }
      send(200, await handler(re.exec(url.pathname), url, req, who));
    } catch (e) {
      send(e.status || 500, { error: e.message });
    }
  });
}
