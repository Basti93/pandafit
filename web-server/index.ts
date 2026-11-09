import Fastify, { type FastifyInstance, type FastifyReply, type FastifyRequest } from 'fastify';
import { existsSync, realpathSync, statSync, readFileSync } from 'node:fs';
import type { IncomingMessage } from 'node:http';
import { extname, resolve, sep } from 'node:path';
import { pathToFileURL } from 'node:url';
import { clientIp, dropAttempt, hashToken, isLimited, MAX_PASSWORD, newToken, recordAttempt, safeEqual, verifyPassword } from './auth';
import { registerCoachProxy } from './coach-proxy';
import { openDb } from './db';
import { INTERNAL_PORT, startInternal, validInternalToken } from './internal';
import { createRestAlarms, REST_MAX_AHEAD_MS } from './rest-alarm';
import { announceVersion, buildVersion, MAX_SUBSCRIPTIONS, pushFor, rememberOrigin, validEndpoint, validKeys, type PushOptions } from './push';
import { listRecords, pageOfQuery, putRecords, recordsOfBody } from './records';

export type { PushOptions } from './push';

const BODY_LIMIT = 5 * 1024 * 1024;
const LOGIN_BODY_LIMIT = 8192;
const PUSH_BODY_LIMIT = 4096;
const IDLE_MS = 60_000;
/** The total time a request outside /coach may take, body included. */
const REQUEST_LIMIT_MS = 30_000;
const MAX_CONNECTIONS = 256;
const SESSION_MS = 90 * 24 * 3600 * 1000;
const COOKIE = 'pf_session';
const CSP = "default-src 'self'; script-src 'self'; img-src 'self' data:; style-src 'self' 'unsafe-inline'; frame-ancestors 'none'; base-uri 'none'; form-action 'self'; object-src 'none'";
const TYPES: Record<string, string> = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8', '.json': 'application/json', '.webmanifest': 'application/manifest+json',
  '.svg': 'image/svg+xml', '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.ico': 'image/x-icon', '.txt': 'text/plain; charset=utf-8',
  '.ttf': 'font/ttf', '.woff2': 'font/woff2',
};

const isObj = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);
const str = (v: unknown, max: number): v is string => typeof v === 'string' && v.length > 0 && v.length <= max;

export const buildServer = (opts: {
  dbPath: string; staticDir?: string; nowMs?: () => number; trustProxyCidr?: string; push?: PushOptions;
  /** The coach container on the internal network. Without it the /coach routes do not exist. */
  coach?: { url: string; token: string; pingMs?: number };
  /** How long a connection may stay silent, request body included, before it is cut. Shorter in tests. */
  idleMs?: number;
  /** The total time limit of every request outside /coach. Shorter in tests. */
  requestLimitMs?: number;
}): FastifyInstance => {
  const db = openDb(opts.dbPath);
  const now = opts.nowMs ?? Date.now;
  // No server-wide limit on a request's total time, so a slow but steady upload to the coach (up to 128 MiB) completes. A
  // connection that goes silent is cut instead; Node's headersTimeout still bounds the headers against slow senders.
  const app = Fastify({ logger: false, bodyLimit: BODY_LIMIT, requestTimeout: 0, connectionTimeout: opts.idleMs ?? IDLE_MS });
  app.server.maxConnections = MAX_CONNECTIONS;
  // Every route outside /coach keeps a total limit: a client trickling a body to /login or /records is cut when it is over.
  const limitMs = opts.requestLimitMs ?? REQUEST_LIMIT_MS;
  app.addHook('onRequest', (req, reply, done) => {
    const p = req.url.split('?')[0]!;
    if (p === '/coach' || p.startsWith('/coach/')) { done(); return; }
    const timer = setTimeout(() => req.raw.socket.destroy(), limitMs);
    timer.unref();
    const stop = () => clearTimeout(timer);
    reply.raw.once('finish', stop);
    reply.raw.once('close', stop);
    done();
  });
  const staticRoot = opts.staticDir && existsSync(opts.staticDir) ? realpathSync(opts.staticDir) : null;
  const accounts = new WeakMap<FastifyRequest, number>();
  /** How the request logged in: a push subscription is bound to it and ends with it. */
  const owners = new WeakMap<FastifyRequest, { session: string } | { device: number }>();
  const { keys: pushKeys, push } = pushFor(db, opts.push, now);
  /** Rest-end alarms: endpoint -> account at the time it was set; the push goes to that one subscription only. */
  const restOwner = new Map<string, number>();
  const restAlarms = createRestAlarms({
    now,
    fire: async (endpoint) => { const id = restOwner.get(endpoint); restOwner.delete(endpoint); if (id !== undefined) await push.notifyEndpoint(id, endpoint, 'rest'); },
  });
  const cancelRest = (endpoint: string) => { restAlarms.cancel(endpoint); restOwner.delete(endpoint); };

  app.setErrorHandler((err: { statusCode?: number; name?: string }, req, reply) => {
    const code = typeof err.statusCode === 'number' && err.statusCode >= 400 && err.statusCode < 500 ? err.statusCode : 500;
    if (code === 500) console.error('server error', req.method, req.url.split('?')[0], err.name ?? 'Error');
    return reply.code(code).send({ error: code === 413 ? 'too large' : code === 500 ? 'error' : 'bad request' });
  });
  app.addHook('onSend', async (_req, reply) => {
    reply.header('X-Content-Type-Options', 'nosniff').header('Referrer-Policy', 'no-referrer').header('X-Frame-Options', 'DENY');
    if (!reply.hasHeader('Cache-Control')) reply.header('Cache-Control', 'no-store');
  });

  const cookieOf = (req: { headers: IncomingMessage['headers'] }): string | null => {
    const m = new RegExp(`(?:^|;\\s*)${COOKIE}=([0-9a-f]{64})(?:;|$)`).exec(req.headers.cookie ?? '');
    return m ? m[1]! : null;
  };
  const setCookie = (reply: FastifyReply, token: string, maxAge = SESSION_MS / 1000) =>
    reply.header('Set-Cookie', `${COOKIE}=${token}; Max-Age=${maxAge}; Path=/; HttpOnly; Secure; SameSite=Strict`);
  const sameOrigin = (req: { headers: IncomingMessage['headers'] }): boolean => {
    const origin = req.headers.origin;
    if (typeof origin === 'string') {
      try { return new URL(origin).host === req.headers.host; } catch { return false; }
    }
    return req.headers['sec-fetch-site'] === 'same-origin';
  };
  const ipOf = (req: FastifyRequest) => clientIp(req.socket.remoteAddress ?? '', req.headers['x-forwarded-for'] as string | undefined, opts.trustProxyCidr);

  type Login = { account: number; owner: { session: string } | { device: number }; cookie: string | null };
  /**
   * The login of a request: a device token, or a session cookie (which it extends). A cookie request that changes state, or opens
   * a socket, must come from the own origin, or it is 'forbidden'. Null for no valid login.
   */
  const resolveLogin = (req: IncomingMessage): Login | 'forbidden' | null => {
    const auth = req.headers.authorization;
    if (typeof auth === 'string') {
      const m = /^Bearer ([0-9a-f]{64})$/.exec(auth);
      const h = m ? hashToken(m[1]!) : null;
      const row = h ? (db.prepare('SELECT id, account_id, token_hash FROM devices WHERE token_hash = ? AND revoked = 0').get(h) as { id: number; account_id: number; token_hash: string } | undefined) : undefined;
      if (row && h && safeEqual(Buffer.from(row.token_hash), Buffer.from(h))) return { account: row.account_id, owner: { device: row.id }, cookie: null };
      return null;
    }
    const token = cookieOf(req);
    if (token) {
      const h = hashToken(token), t = now();
      const row = db.prepare('SELECT account_id, token_hash, expires_ms FROM sessions WHERE token_hash = ?').get(h) as { account_id: number; token_hash: string; expires_ms: number } | undefined;
      if (row && safeEqual(Buffer.from(row.token_hash), Buffer.from(h)) && row.expires_ms > t) {
        const socket = String(req.headers.upgrade ?? '').toLowerCase() === 'websocket';
        if ((socket || (req.method !== 'GET' && req.method !== 'HEAD')) && !sameOrigin(req)) return 'forbidden';
        db.prepare('UPDATE sessions SET expires_ms = ? WHERE token_hash = ?').run(t + SESSION_MS, h);
        return { account: row.account_id, owner: { session: h }, cookie: token };
      }
    }
    return null;
  };
  /** The account of a request's login, or null; for the coach door, which answers every failure the same. */
  const resolveAccount = async (req: IncomingMessage): Promise<number | null> => {
    const login = resolveLogin(req);
    return login && login !== 'forbidden' ? login.account : null;
  };

  /** Resolves a device token or session cookie to an account id. Any failure answers the same 401. */
  const requireAuth = async (req: FastifyRequest, reply: FastifyReply) => {
    const login = resolveLogin(req.raw);
    if (login === 'forbidden') return reply.code(403).send({ error: 'forbidden' });
    if (!login) return reply.code(401).send({ error: 'unauthorized' });
    if (login.cookie && req.routeOptions.url !== '/logout') setCookie(reply, login.cookie);
    accounts.set(req, login.account);
    owners.set(req, login.owner);
  };
  const acct = (req: FastifyRequest) => accounts.get(req)!;

  /** Shared by /login and /device-token: limit, password check, identical failure answer. */
  const checkCredentials = async (req: FastifyRequest, reply: FastifyReply, body: unknown): Promise<number | null> => {
    const b = isObj(body) ? body : {};
    if (!str(b.name, 100) || typeof b.password !== 'string' || b.password.length === 0 || b.password.length > MAX_PASSWORD) { reply.code(400).send({ error: 'bad request' }); return null; }
    const t = now(), ip = ipOf(req), key = b.name.toLowerCase();
    if (isLimited(db, t, ip, key)) { reply.code(429).send({ error: 'too many attempts' }); return null; }
    const attempt = recordAttempt(db, t, ip, key);
    const id = await verifyPassword(db, b.name, b.password);
    if (id === 'busy') { dropAttempt(db, attempt); reply.code(429).send({ error: 'too many attempts' }); return null; }
    if (id === null) { reply.code(401).send({ error: 'login failed' }); return null; }
    dropAttempt(db, attempt);
    return id;
  };

  // With a coach: whether it answers its own health route, for the home-server overview. The api stays healthy either way.
  const coachAnswers = async (url: string): Promise<boolean> => {
    try { return (await fetch(`${url}/healthz`, { signal: AbortSignal.timeout(2000) })).ok; } catch { return false; }
  };
  app.get('/healthz', async () => (opts.coach ? { ok: true, coach: await coachAnswers(opts.coach.url) } : { ok: true }));

  app.post('/login', { bodyLimit: LOGIN_BODY_LIMIT }, async (req, reply) => {
    const id = await checkCredentials(req, reply, req.body);
    if (id === null) return reply;
    const t = now(), token = newToken();
    db.prepare('DELETE FROM sessions WHERE expires_ms <= ?').run(t);
    db.prepare('INSERT INTO sessions VALUES (?, ?, ?)').run(hashToken(token), id, t + SESSION_MS);
    setCookie(reply, token);
    return { ok: true };
  });

  app.post('/logout', { onRequest: requireAuth }, async (req, reply) => {
    const token = cookieOf(req);
    if (token) {
      for (const r of db.prepare('SELECT endpoint FROM push_subs WHERE session_hash = ?').all(hashToken(token)) as { endpoint: string }[]) cancelRest(r.endpoint);
      db.prepare('DELETE FROM push_subs WHERE session_hash = ?').run(hashToken(token));
      db.prepare('DELETE FROM sessions WHERE token_hash = ?').run(hashToken(token));
    }
    setCookie(reply, '', 0);
    return { ok: true };
  });

  app.post('/device-token', { bodyLimit: LOGIN_BODY_LIMIT }, async (req, reply) => {
    const id = await checkCredentials(req, reply, req.body);
    if (id === null) return reply;
    const dn = (req.body as { deviceName?: unknown }).deviceName;
    if (!str(dn, 100)) return reply.code(400).send({ error: 'bad request' });
    const token = newToken();
    const r = db.prepare('INSERT INTO devices (account_id, name, token_hash) VALUES (?, ?, ?)').run(id, dn, hashToken(token));
    return { token, deviceId: Number(r.lastInsertRowid) };
  });

  app.get('/me', { onRequest: requireAuth }, async (req) => {
    const r = db.prepare('SELECT name FROM accounts WHERE id = ?').get(acct(req)) as { name: string };
    return { name: r.name };
  });

  // --- push notifications: the public key, and one subscription per browser, bound to the login it came with ---
  app.get('/push/key', { onRequest: requireAuth }, async () => ({ key: pushKeys.publicKey }));

  app.post('/push/subscribe', { onRequest: requireAuth, bodyLimit: PUSH_BODY_LIMIT }, async (req, reply) => {
    const b = isObj(req.body) ? req.body : {};
    if (!validEndpoint(b.endpoint) || !validKeys(b.keys)) return reply.code(400).send({ error: 'bad request' });
    const account = acct(req), owner = owners.get(req)!;
    // The subject of the VAPID token defaults to the public origin the app is used from.
    const origin = typeof req.headers.origin === 'string' ? req.headers.origin : `https://${req.headers.host ?? ''}`;
    if (/^https:\/\/[a-z0-9.-]+(:\d+)?$/i.test(origin)) rememberOrigin(db, origin.toLowerCase());
    db.prepare(`INSERT INTO push_subs (endpoint, account_id, p256dh, auth, session_hash, device_id, created_ms) VALUES (?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT (endpoint) DO UPDATE SET account_id = excluded.account_id, p256dh = excluded.p256dh, auth = excluded.auth,
        session_hash = excluded.session_hash, device_id = excluded.device_id, created_ms = excluded.created_ms`)
      .run(b.endpoint, account, b.keys.p256dh, b.keys.auth, 'session' in owner ? owner.session : null, 'device' in owner ? owner.device : null, now());
    db.prepare('DELETE FROM push_subs WHERE account_id = ? AND endpoint NOT IN (SELECT endpoint FROM push_subs WHERE account_id = ? ORDER BY created_ms DESC, rowid DESC LIMIT ?)')
      .run(account, account, MAX_SUBSCRIPTIONS);
    return { ok: true };
  });

  app.post('/push/unsubscribe', { onRequest: requireAuth, bodyLimit: PUSH_BODY_LIMIT }, async (req, reply) => {
    const b = isObj(req.body) ? req.body : {};
    if (!str(b.endpoint, 1024)) return reply.code(400).send({ error: 'bad request' });
    const r = db.prepare('DELETE FROM push_subs WHERE endpoint = ? AND account_id = ?').run(b.endpoint, acct(req));
    if (Number(r.changes) > 0) cancelRest(b.endpoint);
    return { ok: true };
  });

  app.post('/push/rest', { onRequest: requireAuth, bodyLimit: PUSH_BODY_LIMIT }, async (req, reply) => {
    const b = isObj(req.body) ? req.body : {};
    if (!str(b.endpoint, 1024) || (b.atMs !== null && (typeof b.atMs !== 'number' || !Number.isFinite(b.atMs) || b.atMs <= now() || b.atMs > now() + REST_MAX_AHEAD_MS)))
      return reply.code(400).send({ error: 'bad request' });
    const account = acct(req);
    if (!db.prepare('SELECT 1 FROM push_subs WHERE endpoint = ? AND account_id = ?').get(b.endpoint, account)) return reply.code(404).send({ error: 'not found' });
    if (b.atMs === null) cancelRest(b.endpoint);
    else if (restAlarms.set(b.endpoint, b.atMs)) restOwner.set(b.endpoint, account);
    return { ok: true };
  });

  app.post('/records', { onRequest: requireAuth }, async (req, reply) => {
    const list = recordsOfBody(req.body);
    if (!list) return reply.code(400).send({ error: 'bad request' });
    const account = acct(req);
    // A linked Mac (device token) runs a coach and may send its messages with a push; a browser session may not.
    const { accepted, refused, newMealWeek, newRunWeek, newCoachNote } = putRecords(db, account, list, now(), 'device' in (owners.get(req) ?? {}) ? 'coach' : 'client');
    if (newMealWeek) void push.notifyAccount(account, 'meal'); // fire and forget, after the data is safe
    if (newRunWeek) void push.notifyAccount(account, 'run');
    if (newCoachNote) void push.notifyAccount(account, 'coach');
    return { accepted, refused };
  });

  app.get<{ Querystring: { since?: string; limit?: string } }>('/records', { onRequest: requireAuth }, async (req, reply) => {
    const page = pageOfQuery(req.query);
    if (!page) return reply.code(400).send({ error: 'bad request' });
    return listRecords(db, acct(req), page.since, page.limit);
  });

  if (opts.coach) registerCoachProxy(app, { coachUrl: opts.coach.url, token: opts.coach.token, resolve: resolveAccount, pingMs: opts.coach.pingMs });

  // Static files: GET only, only from staticDir, no traversal, no symlink escape.
  app.setNotFoundHandler(async (req, reply) => {
    if (!staticRoot || (req.method !== 'GET' && req.method !== 'HEAD')) return reply.code(404).send({ error: 'not found' });
    try {
      let rel = decodeURIComponent(req.url.split('?')[0]!);
      if (rel.includes('\0') || rel.includes('\\')) throw new Error('bad path');
      if (rel.split('/').some((seg) => seg.startsWith('.') && seg !== '.well-known')) throw new Error('hidden');
      let file = resolve(staticRoot, '.' + rel);
      if (existsSync(file) && statSync(file).isDirectory()) file = resolve(file, 'index.html');
      file = realpathSync(file);
      if (file !== staticRoot && !file.startsWith(staticRoot + sep)) throw new Error('outside');
      if (!statSync(file).isFile()) throw new Error('not a file');
      return reply.header('Content-Type', TYPES[extname(file).toLowerCase()] ?? 'application/octet-stream')
        .header('Content-Security-Policy', CSP).header('Cache-Control', 'no-cache').send(readFileSync(file));
    } catch {
      return reply.code(404).send({ error: 'not found' });
    }
  });

  const version = opts.push?.version;
  if (version) app.addHook('onReady', async () => { void announceVersion(db, push, version); });
  app.addHook('onClose', async () => { restAlarms.clearAll(); restOwner.clear(); db.close(); });
  return app;
};

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
  if (!process.env.PANDAFIT_TRUST_PROXY_CIDR) console.warn('warning: PANDAFIT_TRUST_PROXY_CIDR is not set; all clients are seen at the proxy address and share one login limit');
  const staticDir = process.env.PANDAFIT_STATIC;
  let subject = process.env.PANDAFIT_PUSH_SUBJECT?.trim() || undefined;
  if (subject && !/^(mailto:|https:\/\/)\S+$/.test(subject)) { console.warn('warning: PANDAFIT_PUSH_SUBJECT must start with mailto: or https://; using the public origin'); subject = undefined; }
  let version: string | null = null;
  try { if (staticDir && existsSync(staticDir)) version = buildVersion(staticDir); } catch { /* no announcement without a build */ }
  // The coach's door: both need the internal token, shared with the coach container only.
  const internalToken = process.env.PANDAFIT_INTERNAL_TOKEN?.trim() || undefined;
  if (internalToken && !validInternalToken(internalToken)) console.warn('warning: PANDAFIT_INTERNAL_TOKEN must be 64 hex characters; the coach routes stay off');
  const token = internalToken && validInternalToken(internalToken) ? internalToken : undefined;
  const coachUrl = process.env.PANDAFIT_COACH_URL?.trim() || undefined;
  if (coachUrl && !token) console.warn('warning: PANDAFIT_COACH_URL is set without PANDAFIT_INTERNAL_TOKEN; the /coach routes stay off');
  const pushOpts: PushOptions | undefined = process.env.PANDAFIT_PUSH === 'off' ? undefined : { send: 'web', subject, version };
  const app = buildServer({
    dbPath: process.env.PANDAFIT_DB ?? 'pandafit.db',
    staticDir,
    trustProxyCidr: process.env.PANDAFIT_TRUST_PROXY_CIDR,
    // PANDAFIT_PUSH=off sends nothing (the restore drill runs on a copy that holds real subscriptions).
    push: pushOpts,
    coach: coachUrl && token ? { url: coachUrl, token } : undefined,
  });
  app.listen({ port: Number(process.env.PORT ?? 8080), host: process.env.HOST ?? '127.0.0.1' });
  // The internal records routes listen on the internal network only when the token is set; the public port never has them.
  if (token) {
    void startInternal({ dbPath: process.env.PANDAFIT_DB ?? 'pandafit.db', token, push: pushOpts, host: '0.0.0.0', port: INTERNAL_PORT, peer: process.env.PANDAFIT_INTERNAL_PEER?.trim() ? { host: process.env.PANDAFIT_INTERNAL_PEER.trim() } : undefined });
  }
}
