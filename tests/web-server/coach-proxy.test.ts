import { createHash, randomBytes } from 'node:crypto';
import { request, type IncomingHttpHeaders, type IncomingMessage } from 'node:http';
import { connect as tcp, type AddressInfo } from 'node:net';
import { Readable } from 'node:stream';
import { afterEach, describe, expect, it } from 'vitest';
import Fastify, { type FastifyInstance } from 'fastify';
import { WebSocket, WebSocketServer } from 'ws';
import { setup, login, PW_A, PW_B } from './helpers';
import { buildServer } from '../../web-server';
import { registerCoachProxy } from '../../web-server/coach-proxy';

const TOKEN = 'c'.repeat(64);
const MiB = 1024 * 1024;
const sha = (b: Buffer) => createHash('sha256').update(b).digest('hex');

type Seen = { method: string; url: string; headers: IncomingHttpHeaders; body: Buffer };
type SeenSocket = { url: string; headers: IncomingHttpHeaders; ws: WebSocket; closed: Promise<number> };

const cleanup: (() => Promise<unknown>)[] = [];
afterEach(async () => { for (const f of cleanup.splice(0).reverse()) await f().catch(() => {}); });

/** A real coach stand-in on 127.0.0.1: records what reaches it, answers with what it got, echoes socket messages. */
async function fakeCoach() {
  const seen: Seen[] = [], started: string[] = [], sockets: SeenSocket[] = [];
  let closeWith: number | null = null, upgradeDelayMs = 0;
  const coach = Fastify({ logger: false });
  coach.removeAllContentTypeParsers();
  coach.addContentTypeParser('*', { parseAs: 'buffer', bodyLimit: 512 * MiB }, (_req, body, done) => { done(null, body); });
  coach.addHook('onRequest', async (req) => { started.push(req.url); });
  coach.all('/*', async (req, reply) => {
    const body = Buffer.isBuffer(req.body) ? req.body : Buffer.alloc(0);
    // The coach refusing the internal token.
    if (req.url.startsWith('/refuse-token')) return reply.code(401).send({ error: 'unauthorized' });
    seen.push({ method: req.method, url: req.url, headers: req.headers, body });
    return reply.code(201).header('content-type', 'application/json').send({ url: req.url, account: req.headers['x-pandafit-account'], bytes: body.length, sha: sha(body) });
  });
  const wss = new WebSocketServer({ noServer: true });
  coach.server.on('upgrade', (req: IncomingMessage, socket, head) => {
    setTimeout(() => wss.handleUpgrade(req, socket, head, (ws) => {
      const closed = new Promise<number>((r) => ws.on('close', (code) => r(code)));
      sockets.push({ url: req.url ?? '', headers: req.headers, ws, closed });
      if (closeWith !== null) { ws.close(closeWith, 'x'); return; }
      ws.on('message', (data, isBinary) => ws.send(isBinary ? data : `echo:${String(data)}`, { binary: isBinary }));
    }), upgradeDelayMs);
  });
  await coach.listen({ port: 0, host: '127.0.0.1' });
  cleanup.push(async () => { for (const c of wss.clients) c.terminate(); wss.close(); await coach.close(); });
  const url = `http://127.0.0.1:${(coach.server.address() as AddressInfo).port}`;
  return { url, seen, started, sockets, closeWith: (c: number | null) => { closeWith = c; }, delayUpgrades: (ms: number) => { upgradeDelayMs = ms; } };
}

async function world(o: { coachUrl?: string | null; pingMs?: number; idleMs?: number; limitMs?: number } = {}) {
  const coach = await fakeCoach();
  const base = await setup();
  await base.app.close();
  const coachUrl = o.coachUrl === undefined ? coach.url : o.coachUrl;
  const app = buildServer({ dbPath: base.dbPath, idleMs: o.idleMs, requestLimitMs: o.limitMs, ...(coachUrl === null ? {} : { coach: { url: coachUrl, token: TOKEN, pingMs: o.pingMs } }) });
  await app.listen({ port: 0, host: '127.0.0.1' });
  cleanup.push(() => app.close());
  const host = `127.0.0.1:${(app.server.address() as AddressInfo).port}`;
  const a = (await login(app, 'anna', PW_A)).cookie!, b = (await login(app, 'ben', PW_B)).cookie!;
  const device = (await app.inject({ method: 'POST', url: '/device-token', payload: { name: 'anna', password: PW_A, deviceName: 'mac' } })).json().token as string;
  const own = (cookie: string) => ({ cookie, origin: `http://${host}` });
  return { coach, app, host, a, b, device, own };
}

type Answer = { status: number; body: string; headers: IncomingHttpHeaders };
/** A plain HTTP call: the test controls every header, the body may be a buffer or a stream. A connection reset with no answer is status 0. */
const call = (host: string, method: string, path: string, headers: Record<string, string | number> = {}, body?: Buffer | Readable): Promise<Answer> =>
  new Promise((resolve, reject) => {
    const [hostname, port] = host.split(':');
    // A buffer goes with its length, as any client sends it (Node would send a GET body without framing).
    const framed = Buffer.isBuffer(body) && headers['content-length'] === undefined ? { ...headers, 'content-length': body.length } : headers;
    const req = request({ hostname, port: Number(port), method, path, headers: framed }, (res) => {
      const chunks: Buffer[] = [];
      res.on('data', (c: Buffer) => chunks.push(c));
      res.on('end', () => resolve({ status: res.statusCode!, body: Buffer.concat(chunks).toString(), headers: res.headers }));
      res.on('error', reject);
    });
    // The server may answer early and close while the body is still being sent: the answer usually arrives anyway.
    req.on('error', (e: NodeJS.ErrnoException) => {
      if (e.code === 'EPIPE' || e.code === 'ECONNRESET') setTimeout(() => resolve({ status: 0, body: '', headers: {} }), 200);
      else reject(e);
    });
    if (body instanceof Readable) body.pipe(req);
    else req.end(body);
  });

/** Opens a socket and reports either the open socket or the HTTP status that refused it. */
const connect = (host: string, headers: Record<string, string>, path = '/coach', o: { autoPong?: boolean } = {}): Promise<{ ws: WebSocket } | { refused: number }> =>
  new Promise((resolve, reject) => {
    const ws = new WebSocket(`ws://${host}${path}`, { headers, ...o });
    ws.on('open', () => resolve({ ws }));
    ws.on('unexpected-response', (_req, res) => { resolve({ refused: res.statusCode! }); ws.terminate(); });
    ws.on('error', (e) => reject(e));
  });
const opened = async (p: ReturnType<typeof connect>) => {
  const r = await p;
  if (!('ws' in r)) throw new Error(`refused ${r.refused}`);
  cleanup.push(async () => r.ws.terminate());
  return r.ws;
};
const closeCode = (ws: WebSocket) => new Promise<number>((r) => { if (ws.readyState === WebSocket.CLOSED) r(-1); ws.on('close', (code) => r(code)); });
const nextMessage = (ws: WebSocket) => new Promise<string>((r) => ws.once('message', (d) => r(String(d))));
const until = async (f: () => boolean) => { for (let i = 0; i < 200 && !f(); i++) await new Promise((r) => setTimeout(r, 10)); expect(f()).toBe(true); };
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
/** A body sent slowly: `chunks` pieces of `size` bytes, one every `everyMs`, then (unless `stallAfter`) the end. Reports the answer or the cut. */
const trickle = (host: string, path: string, headers: Record<string, string>, o: { chunks: number; size: number; everyMs: number; stallAfter?: number; method?: string }) =>
  new Promise<{ status: number; body: string } | { cut: string }>((resolve) => {
    const [hostname, port] = host.split(':');
    const req = request({ hostname, port: Number(port), method: o.method ?? 'PUT', path, headers: { ...headers, 'content-length': String(o.chunks * o.size) } }, (res) => {
      const parts: Buffer[] = [];
      res.on('data', (c: Buffer) => parts.push(c));
      res.on('end', () => resolve({ status: res.statusCode!, body: Buffer.concat(parts).toString() }));
      res.on('error', (e) => resolve({ cut: e.message }));
    });
    req.on('error', (e) => resolve({ cut: e.message }));
    let sent = 0;
    const next = () => {
      if (o.stallAfter !== undefined && sent === o.stallAfter) return; // never another byte
      req.write(Buffer.alloc(o.size, 7));
      if (++sent < o.chunks) setTimeout(next, o.everyMs); else req.end();
    };
    next();
  });

describe('coach proxy', () => {
  it('without login every /coach route answers 401 and the socket upgrade is refused', async () => {
    const { coach, host, a } = await world();
    for (const [method, path] of [['GET', '/coach/status'], ['GET', '/coach/rides'], ['GET', '/coach/rides/r1'], ['PUT', '/coach/rides/r1'], ['POST', '/coach/migrate/begin'], ['PUT', '/coach/migrate/item/x'], ['POST', '/coach/migrate/meals'], ['DELETE', '/coach/anything']] as const) {
      expect((await call(host, method, path, { 'content-type': 'application/json' }, Buffer.from('{}'))).status, path).toBe(401);
      expect((await call(host, method, path, { cookie: 'pf_session=' + '0'.repeat(64), origin: `http://${host}` }, Buffer.from('{}'))).status, path).toBe(401);
      expect((await call(host, method, path, { authorization: `Bearer ${'1'.repeat(64)}` }, Buffer.from('{}'))).status, path).toBe(401);
    }
    expect(await connect(host, {})).toEqual({ refused: 401 });
    expect(await connect(host, { cookie: 'pf_session=' + '0'.repeat(64), origin: `http://${host}` })).toEqual({ refused: 401 });
    expect(await connect(host, { authorization: `Bearer ${TOKEN}` })).toEqual({ refused: 401 });
    // The internal token is no login either.
    expect((await call(host, 'GET', '/coach/status', { 'x-pandafit-internal': TOKEN, 'x-pandafit-account': '1' })).status).toBe(401);
    expect(coach.started).toEqual([]);
    expect(coach.sockets).toEqual([]);
    // A login reaches it.
    expect((await call(host, 'GET', '/coach/status', { cookie: a })).status).toBe(201);
  });

  it('the account comes from the login: a client-sent x-pandafit-account is replaced', async () => {
    const { coach, host, a, b, device, own } = await world();
    const spoof = { 'x-pandafit-account': '2', 'x-pandafit-internal': 'f'.repeat(64) };
    expect((await call(host, 'GET', '/coach/status?x=1', { ...own(a), ...spoof })).status).toBe(201);
    expect((await call(host, 'GET', '/coach/status', { authorization: `Bearer ${device}`, ...spoof })).status).toBe(201);
    expect((await call(host, 'GET', '/coach/status', { ...own(b), 'x-pandafit-account': '1' })).status).toBe(201);
    expect(coach.seen.map((s) => [s.url, s.headers['x-pandafit-account'], s.headers['x-pandafit-internal']])).toEqual([
      ['/status?x=1', '1', TOKEN], ['/status', '1', TOKEN], ['/status', '2', TOKEN],
    ]);
    // Neither the cookie nor the device token goes on to the coach.
    for (const s of coach.seen) { expect(s.headers.cookie).toBeUndefined(); expect(s.headers.authorization).toBeUndefined(); }

    const ws = await opened(connect(host, { ...own(a), ...spoof }));
    await until(() => coach.sockets.length === 1);
    expect(coach.sockets[0]!.url).toBe('/ws');
    expect(coach.sockets[0]!.headers).toMatchObject({ 'x-pandafit-account': '1', 'x-pandafit-internal': TOKEN });
    expect(coach.sockets[0]!.headers.cookie).toBeUndefined();
    ws.send('hi');
    expect(await nextMessage(ws)).toBe('echo:hi');
    // The Mac signs in with its device token.
    const mac = await opened(connect(host, { authorization: `Bearer ${device}` }));
    await until(() => coach.sockets.length === 2);
    expect(coach.sockets[1]!.headers['x-pandafit-account']).toBe('1');
    expect(coach.sockets[1]!.headers.authorization).toBeUndefined();
    mac.close();
  });

  it("account A cannot reach account B's coach data on any coach route", async () => {
    const { coach, host, a, own } = await world();
    const routes: [string, string][] = [['GET', '/coach/status'], ['GET', '/coach/rides'], ['GET', '/coach/rides/ride-1'], ['PUT', '/coach/rides/2026-01-01T10-00-00'], ['POST', '/coach/migrate/begin'], ['PUT', '/coach/migrate/item/x'],
      ['POST', '/coach/migrate/finish'], ['POST', '/coach/migrate/meals'], ['GET', '/coach/accounts/2/status'], ['GET', '/coach/status?account=2']];
    for (const [method, path] of routes)
      expect((await call(host, method, path, { ...own(a), 'x-pandafit-account': '2', 'content-type': 'application/json' }, Buffer.from('{"accountId":2}'))).status, path).toBe(201);
    expect(coach.seen).toHaveLength(routes.length);
    expect(new Set(coach.seen.map((s) => s.headers['x-pandafit-account']))).toEqual(new Set(['1']));
    for (let i = 0; i < 3; i++) await opened(connect(host, { ...own(a), 'x-pandafit-account': '2' }, '/coach?account=2'));
    await until(() => coach.sockets.length === 3);
    expect(new Set(coach.sockets.map((s) => s.headers['x-pandafit-account']))).toEqual(new Set(['1']));
    // The coach's health counts name every account: never reachable through the door, however the path is spelled.
    for (const path of ['/coach/healthz?counts=1', '/coach/healthz', '/coach/%68ealthz?counts=1', '/coach/HEALTHZ?counts=1', '/coach//healthz?counts=1', '/coach/healthz/?counts=1'])
      expect((await call(host, 'GET', path, own(a))).status, path).toBe(404);
    expect(coach.started.filter((u) => /h(ealthz|EALTHZ)|%68/i.test(u))).toEqual([]);
  });

  it('a cookie socket from another origin is refused', async () => {
    const { coach, host, a, device } = await world();
    expect(await connect(host, { cookie: a, origin: 'https://evil.test' })).toEqual({ refused: 401 });
    expect(await connect(host, { cookie: a, origin: 'not a url' })).toEqual({ refused: 401 });
    expect(await connect(host, { cookie: a })).toEqual({ refused: 401 });
    // A cookie request that changes state follows the same rule.
    expect((await call(host, 'POST', '/coach/migrate/begin', { cookie: a, origin: 'https://evil.test', 'content-type': 'application/json' }, Buffer.from('{}'))).status).toBe(401);
    expect(coach.sockets).toEqual([]);
    expect(coach.started).toEqual([]);
    // The own origin and a device token (no cookie, no browser) are let through.
    await opened(connect(host, { cookie: a, origin: `http://${host}` }));
    await opened(connect(host, { authorization: `Bearer ${device}`, origin: 'https://evil.test' }));
    await until(() => coach.sockets.length === 2);
  });

  it('bodies pass through unparsed, and over the cap answer 413', async () => {
    const { coach, host, a, own } = await world();
    // Raw bytes, the declared hash and the content type arrive as sent.
    const item = randomBytes(3 * MiB);
    const r = await call(host, 'PUT', '/coach/migrate/item/garmin%2Fgarmin.db?n=1', { ...own(a), 'content-type': 'application/octet-stream', 'x-sha256': sha(item) }, item);
    expect(r.status).toBe(201);
    expect(r.headers['content-type']).toMatch(/^application\/json/);
    expect(JSON.parse(r.body)).toMatchObject({ url: '/migrate/item/garmin%2Fgarmin.db?n=1', account: '1', bytes: item.length, sha: sha(item) });
    const last = coach.seen.at(-1)!;
    expect(last.headers['x-sha256']).toBe(sha(item));
    expect(last.headers['content-type']).toBe('application/octet-stream');
    // JSON is not parsed and re-encoded on the way: odd spacing and even invalid JSON arrive byte for byte.
    for (const text of ['{ "rideId" :  "r1",\n "x": [1,2] }', '{not json']) {
      const body = Buffer.from(text);
      expect((await call(host, 'PUT', '/coach/rides/r1', { ...own(a), 'content-type': 'application/json' }, body)).status).toBe(201);
      expect(coach.seen.at(-1)!.body.toString()).toBe(text);
    }
    // A streamed body without a length passes too.
    const streamed = randomBytes(2 * MiB);
    expect((await call(host, 'PUT', '/coach/rides/r2', { ...own(a), 'content-type': 'application/json', 'transfer-encoding': 'chunked' }, Readable.from([streamed.subarray(0, MiB), streamed.subarray(MiB)]))).status).toBe(201);
    expect(coach.seen.at(-1)!.body.equals(streamed)).toBe(true);
    const before = coach.started.length;

    // By the declared length: answered before anything is forwarded or read.
    for (const [path, cap] of [['/coach/rides/r3', 32 * MiB], ['/coach/migrate/item/big', 128 * MiB], ['/coach/migrate/begin', 4 * MiB], ['/coach/migrate/finish', 4 * MiB], ['/coach/migrate/meals', 4 * MiB], ['/coach/status', MiB]] as const) {
      const res = await call(host, 'PUT', path, { ...own(a), 'content-type': 'application/octet-stream', 'content-length': cap + 1 });
      expect(res.status, path).toBe(413);
    }
    // While streaming: a body without a length that grows past the cap is cut off.
    const chunks = function* (n: number, size: number) { for (let i = 0; i < n; i++) yield Buffer.alloc(size, 1); };
    const over = await call(host, 'POST', '/coach/status', { ...own(a), 'content-type': 'application/json', 'transfer-encoding': 'chunked' }, Readable.from(chunks(5, 256 * 1024 + 1)));
    // The early 413 races the client still writing: under load the client may see the reset before the answer.
    expect([413, 0]).toContain(over.status);
    // The coach may have seen the start of it, but never a whole oversized body.
    await new Promise((r) => setTimeout(r, 50));
    expect(coach.started.length - before).toBeLessThanOrEqual(1);
    expect(coach.seen.filter((s) => s.body.length > MiB && s.url.startsWith('/status'))).toEqual([]);

    // Exactly at the cap passes: 1 MiB in general, 4 MiB for the move's manifest and meal file, as the coach takes them.
    expect((await call(host, 'POST', '/coach/status', { ...own(a), 'content-type': 'application/json' }, Buffer.alloc(MiB, 2))).status).toBe(201);
    for (const path of ['/coach/migrate/begin', '/coach/migrate/finish', '/coach/migrate/meals']) {
      expect((await call(host, 'POST', path, { ...own(a), 'content-type': 'application/json' }, Buffer.alloc(4 * MiB, 2))).status, path).toBe(201);
      expect(coach.seen.at(-1)!.body.length).toBe(4 * MiB);
    }
    const ride = Buffer.alloc(32 * MiB, 3);
    expect((await call(host, 'PUT', '/coach/rides/r4', { ...own(a), 'content-type': 'application/json' }, ride)).status).toBe(201);
    expect(coach.seen.at(-1)!.body.length).toBe(32 * MiB);
  });

  it('coach down: 503, and the socket closes with 1013', async () => {
    const dead = await fakeCoach();
    await cleanup.pop()!(); // its port is closed now
    const { host, a, own } = await world({ coachUrl: dead.url });
    const r = await call(host, 'GET', '/coach/status', own(a));
    expect(r.status).toBe(503);
    expect(JSON.parse(r.body)).toEqual({ error: 'coach unavailable' });
    expect((await call(host, 'PUT', '/coach/rides/r1', { ...own(a), 'content-type': 'application/json' }, Buffer.from('{}'))).status).toBe(503);
    const ws = await opened(connect(host, own(a)));
    expect(await closeCode(ws)).toBe(1013);
  });

  it('coach close codes reach the client, and both sides close together', async () => {
    const { coach, host, a, own } = await world();
    coach.closeWith(4404);
    const ws1 = await opened(connect(host, own(a)));
    expect(await closeCode(ws1)).toBe(4404);
    coach.closeWith(4000);
    expect(await closeCode(await opened(connect(host, own(a))))).toBe(4000);
    coach.closeWith(null);

    // The client leaves: the coach's side closes too.
    const ws2 = await opened(connect(host, own(a)));
    await until(() => coach.sockets.length === 3);
    ws2.close(1000);
    await coach.sockets[2]!.closed;
    // The coach ends it: the client's side closes too.
    const ws3 = await opened(connect(host, own(a)));
    await until(() => coach.sockets.length === 4);
    const c3 = closeCode(ws3);
    coach.sockets[3]!.ws.close(4404, 'x');
    expect(await c3).toBe(4404);
  });

  it('at most 8 coach sockets per account', async () => {
    const { coach, host, a, b, own } = await world();
    const mine: WebSocket[] = [];
    for (let i = 0; i < 8; i++) mine.push(await opened(connect(host, own(a))));
    expect(await connect(host, own(a))).toEqual({ refused: 429 });
    // The other account is not affected.
    await opened(connect(host, own(b)));
    // A closed one makes room.
    mine[0]!.close();
    await until(() => coach.sockets.filter((s) => s.ws.readyState === WebSocket.CLOSED).length === 1);
    await new Promise((r) => setTimeout(r, 20));
    await opened(connect(host, own(a)));
  });

  it("the coach refusing the internal token is a server fault, never a login failure: 503, and the socket closes with 1013", async () => {
    const { coach, host, a, own } = await world();
    const r = await call(host, 'GET', '/coach/refuse-token', own(a));
    expect(r.status).toBe(503);
    expect(JSON.parse(r.body)).toEqual({ error: 'coach unavailable' });
    coach.closeWith(4401);
    expect(await closeCode(await opened(connect(host, own(a))))).toBe(1013);
  });

  it('a socket that misses a pong is closed and frees its slot; one that answers stays', async () => {
    const { coach, host, a, own } = await world({ pingMs: 40 });
    const silent: WebSocket[] = [];
    for (let i = 0; i < 8; i++) silent.push(await opened(connect(host, own(a), '/coach', { autoPong: false })));
    expect(await connect(host, own(a))).toEqual({ refused: 429 });
    await Promise.all(silent.map(closeCode));
    // Their coach sockets close with them.
    await until(() => coach.sockets.length === 8 && coach.sockets.every((s) => s.ws.readyState === WebSocket.CLOSED));
    const live = await opened(connect(host, own(a)));
    await sleep(250);
    expect(live.readyState).toBe(WebSocket.OPEN);
    live.send('still here');
    expect(await nextMessage(live)).toBe('echo:still here');
  });

  it('messages beyond the queue before the coach answers close the socket with 1013 rather than vanish', async () => {
    const { coach, host, a, own } = await world();
    coach.delayUpgrades(300);
    const ws = await opened(connect(host, own(a)));
    const code = closeCode(ws);
    for (let i = 0; i < 65; i++) ws.send(`m${i}`);
    expect(await code).toBe(1013);
    // Up to the limit is kept and delivered once the coach is there.
    const ws2 = await opened(connect(host, own(a)));
    const got: string[] = [];
    ws2.on('message', (d) => got.push(String(d)));
    for (let i = 0; i < 64; i++) ws2.send(`n${i}`);
    await until(() => got.length === 64);
    expect(got[63]).toBe('echo:n63');
  });

  it('a socket gone while its login is checked takes no slot', async () => {
    const coach = await fakeCoach();
    const app = Fastify({ logger: false });
    registerCoachProxy(app, { coachUrl: coach.url, token: TOKEN, resolve: async () => { await sleep(50); return 1; } });
    await app.listen({ port: 0, host: '127.0.0.1' });
    cleanup.push(() => app.close());
    const port = (app.server.address() as AddressInfo).port;
    for (let i = 0; i < 8; i++) {
      const s = tcp(port, '127.0.0.1');
      s.on('error', () => {});
      await new Promise((r) => s.on('connect', r));
      s.write('GET /coach HTTP/1.1\r\nHost: x\r\nUpgrade: websocket\r\nConnection: Upgrade\r\nSec-WebSocket-Version: 13\r\nSec-WebSocket-Key: dGhlIHNhbXBsZSBub25jZQ==\r\n\r\n');
      await sleep(5);
      s.resetAndDestroy(); // a reset: the server's side is gone at once
    }
    await sleep(120);
    await opened(connect(`127.0.0.1:${port}`, {}));
  });

  it('no total time limit on a /coach request: a slow steady upload completes, a stalled one is cut', async () => {
    // The idle limit shortened to 300 ms and the other routes' total limit to 500 ms: the steady upload takes about 2 s, many
    // times both, and every gap is shorter.
    const { coach, app, host, a, own } = await world({ idleMs: 300, limitMs: 500 });
    expect(app.server.requestTimeout).toBe(0);
    const steady = await trickle(host, '/coach/migrate/item/slow', { ...own(a), 'content-type': 'application/octet-stream' }, { chunks: 20, size: 1000, everyMs: 100 });
    expect(steady).toMatchObject({ status: 201 });
    expect(coach.seen.at(-1)!.body.length).toBe(20_000);
    const stalled = await trickle(host, '/coach/migrate/item/stuck', { ...own(a), 'content-type': 'application/octet-stream' }, { chunks: 20, size: 1000, everyMs: 50, stallAfter: 3 });
    expect(stalled).toHaveProperty('cut');
    expect(coach.seen.filter((s) => s.url === '/migrate/item/stuck')).toEqual([]);
  });

  it('every other route keeps a total time limit: a slow trickle to /login is cut once it is over', async () => {
    const { host } = await world({ idleMs: 300, limitMs: 500 });
    const t0 = Date.now();
    // 3 s of body, a piece every 100 ms: never idle, but six times the limit.
    const slow = await trickle(host, '/login', { 'content-type': 'application/json' }, { chunks: 30, size: 10, everyMs: 100, method: 'POST' });
    expect(slow).toHaveProperty('cut');
    expect(Date.now() - t0).toBeLessThan(2500);
  });

  it('the default idle limit is 60 s, every route but /coach has 30 s in all, and connections are capped', async () => {
    const { app } = await world();
    expect(app.server.requestTimeout).toBe(0);
    expect(app.server.timeout).toBe(60_000);
    expect(app.server.maxConnections).toBe(256);
  });

  it('without PANDAFIT_COACH_URL the /coach routes do not exist', async () => {
    const { host, a, own } = await world({ coachUrl: null });
    expect((await call(host, 'GET', '/coach/status', own(a))).status).toBe(404);
    expect((await call(host, 'PUT', '/coach/rides/r1', { ...own(a), 'content-type': 'application/json' }, Buffer.from('{}'))).status).toBe(404);
    expect(await connect(host, own(a))).toEqual({ refused: 404 });
  });
});

describe('healthz names whether the coach answers', () => {
  it('coach: true while the coach answers its health route', async () => {
    const { app, coach } = await world();
    expect((await app.inject({ method: 'GET', url: '/healthz' })).json()).toEqual({ ok: true, coach: true });
    expect(coach.seen.some((s) => s.url === '/healthz')).toBe(true);
  });
  it('coach: false when the coach cannot be reached, and the api itself stays healthy', async () => {
    const { app } = await world({ coachUrl: 'http://127.0.0.1:1' });
    const h = await app.inject({ method: 'GET', url: '/healthz' });
    expect(h.statusCode).toBe(200);
    expect(h.json()).toEqual({ ok: true, coach: false });
  });
});
