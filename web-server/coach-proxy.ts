import { request as httpRequest, type IncomingMessage, type OutgoingHttpHeaders } from 'node:http';
import { request as httpsRequest } from 'node:https';
import type { Duplex } from 'node:stream';
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { WebSocket, WebSocketServer, type RawData } from 'ws';

const MiB = 1024 * 1024;
/** What a body to the coach may weigh: a ride's upload, one item of the move from the Mac, its manifest or meal file, anything else. */
export const COACH_CAPS = { ride: 32 * MiB, item: 128 * MiB, move: 4 * MiB, other: MiB };
/** How often client sockets are pinged; one that has not answered the previous ping by then is cut. */
export const PING_MS = 30_000;
export const MAX_SOCKETS_PER_ACCOUNT = 8;
/** The coach's own limit for one socket message. */
const MAX_MESSAGE = 256 * 1024;
/** Messages a client may send before the coach's side of its socket is open. */
const MAX_QUEUED = 64;
/** A coach that says nothing for this long is taken as gone. */
const UPSTREAM_IDLE_MS = 120_000;
/** The request headers the coach gets from a client. Never its cookie or authorization: the account goes in its own header. */
const FORWARDED = ['content-type', 'content-length', 'x-sha256', 'if-none-match'] as const;
/** The coach's answer headers that go back to the client: the type and what a browser needs to keep a picture. */
const RETURNED = ['cache-control', 'etag', 'last-modified', 'x-content-type-options'] as const;

export type CoachProxyOptions = {
  /** The coach container on the internal network, e.g. `http://coach:8090`. */
  coachUrl: string;
  /** The internal token shared with the coach. */
  token: string;
  /** The account of a request's login, or null. Cookie requests that change state or open a socket must be same-origin. */
  resolve: (req: IncomingMessage) => Promise<number | null>;
  /** The ping interval, shorter in tests. */
  pingMs?: number;
};

const MOVE_FILES = new Set(['/migrate/begin', '/migrate/finish', '/migrate/meals']);
const capOf = (path: string): number =>
  path.startsWith('/rides/') ? COACH_CAPS.ride : path.startsWith('/migrate/item/') ? COACH_CAPS.item : MOVE_FILES.has(path) ? COACH_CAPS.move : COACH_CAPS.other;

/** The path as the coach's router would read it, for the checks only: decoded, lower case, without repeated slashes. Null if it cannot be decoded. */
const readable = (path: string): string | null => {
  try { return decodeURIComponent(path).toLowerCase().replace(/\/{2,}/g, '/'); } catch { return null; }
};
/** The coach's health route counts every account with the internal token: it is never reachable through this door. */
const blocked = (path: string): boolean => /^\/healthz(\/|$)/.test(path);

/** A close code that may be sent on: the coach's own codes pass, a broken connection becomes "try again later". */
const sendable = (code: number): boolean => (code >= 1000 && code <= 1014 && ![1004, 1005, 1006].includes(code)) || (code >= 3000 && code <= 4999);
/**
 * The login was checked here, so a coach refusing the request's credentials (401 or 4401) can only mean it refused the internal
 * token: a fault of the server, which the client must never take for a failed login of its own.
 */
const COACH_REFUSED_TOKEN = 4401;

/**
 * The public door to the coach container. The api checks the login, names the account to the coach in a header with the internal
 * token, and passes the rest through untouched: `/coach/*` to the coach's `/*` with its raw body, and the socket at `/coach` to the
 * coach's `/ws`, one coach socket per client socket. The client's own credentials and account header never reach the coach.
 */
export function registerCoachProxy(app: FastifyInstance, opts: CoachProxyOptions): void {
  const base = new URL(opts.coachUrl);
  const prefix = base.pathname.replace(/\/+$/, '');
  const request = base.protocol === 'https:' ? httpsRequest : httpRequest;
  const wsBase = `${base.protocol === 'https:' ? 'wss:' : 'ws:'}//${base.host}${prefix}`;
  const internal = (account: number) => ({ 'x-pandafit-internal': opts.token, 'x-pandafit-account': String(account) });

  // ---- HTTP: checked before the body is read, then streamed through ----

  const checked = new WeakMap<IncomingMessage, { account: number; path: string; cap: number }>();

  const check = async (req: FastifyRequest, reply: FastifyReply) => {
    let account: number | null = null;
    try { account = await opts.resolve(req.raw); } catch { /* no login */ }
    if (account === null) return reply.code(401).send({ error: 'unauthorized' });
    const path = req.url.slice('/coach'.length);
    const seen = readable(path.split('?')[0]!);
    if (seen === null) return reply.code(400).send({ error: 'bad request' });
    if (blocked(seen)) return reply.code(404).send({ error: 'not found' });
    const cap = capOf(seen);
    const length = Number(req.headers['content-length'] ?? 0);
    if (!Number.isFinite(length) || length > cap) return reply.header('Connection', 'close').code(413).send({ error: 'too large' });
    checked.set(req.raw, { account, path, cap });
  };

  const forward = (req: FastifyRequest, reply: FastifyReply): Promise<FastifyReply> => new Promise((resolve) => {
    const { account, path, cap } = checked.get(req.raw)!;
    const headers: OutgoingHttpHeaders = internal(account);
    for (const h of FORWARDED) { const v = req.headers[h]; if (typeof v === 'string') headers[h] = v; }
    const up = request({ hostname: base.hostname, port: base.port || undefined, method: req.method, path: prefix + path, headers, timeout: UPSTREAM_IDLE_MS });
    const raw = req.raw;
    let answered = false;
    const answer = (code: number, body: unknown, close = false) => {
      if (answered) return;
      answered = true;
      up.destroy();
      if (close) reply.header('Connection', 'close');
      resolve(reply.code(code).send(body));
    };
    up.on('timeout', () => up.destroy(new Error('timeout')));
    up.on('error', () => answer(503, { error: 'coach unavailable' }));
    up.on('response', (res) => {
      if (answered) { res.resume(); return; }
      answered = true;
      if (res.statusCode === 401) { res.resume(); up.destroy(); resolve(reply.code(503).send({ error: 'coach unavailable' })); return; }
      const type = res.headers['content-type'];
      if (typeof type === 'string') reply.header('Content-Type', type);
      for (const h of RETURNED) { const v = res.headers[h]; if (typeof v === 'string') reply.header(h, v); }
      if (res.statusCode === 304) { res.resume(); resolve(reply.code(304).send()); return; }
      resolve(reply.code(res.statusCode ?? 502).send(res));
    });
    // A client that leaves takes the coach's request with it.
    reply.raw.on('close', () => { if (!reply.raw.writableFinished) up.destroy(); });

    if (req.headers['content-length'] === undefined && req.headers['transfer-encoding'] === undefined) { up.end(); return; }
    let bytes = 0;
    const onData = (chunk: Buffer) => {
      bytes += chunk.length;
      if (bytes > cap) {
        // The rest is not read: the answer closes the connection.
        raw.off('data', onData);
        raw.pause();
        answer(413, { error: 'too large' }, true);
        return;
      }
      if (!up.write(chunk)) raw.pause();
    };
    raw.on('data', onData);
    up.on('drain', () => { if (bytes <= cap) raw.resume(); });
    raw.on('end', () => { if (bytes <= cap) up.end(); });
    raw.on('error', () => up.destroy());
  });

  void app.register(async (scope) => {
    // The body stays a stream for the handler: nothing is parsed or buffered on the way.
    scope.removeAllContentTypeParsers();
    scope.addContentTypeParser('*', (_req, _payload, done) => { done(null); });
    scope.all('/coach/*', { onRequest: check }, forward);
  });

  // ---- The socket: one coach socket per client socket, both closing together ----

  const wss = new WebSocketServer({ noServer: true, maxPayload: MAX_MESSAGE });
  const upstreams = new Set<WebSocket>();
  const perAccount = new Map<number, number>();

  // A phone or Mac that changed networks can leave a half-open socket that never closes on its own and holds a slot.
  const alive = new WeakMap<WebSocket, boolean>();
  const heartbeat = setInterval(() => {
    for (const c of wss.clients) {
      if (alive.get(c) === false) { c.terminate(); continue; }
      alive.set(c, false);
      try { c.ping(); } catch { /* closing */ }
    }
  }, opts.pingMs ?? PING_MS);
  heartbeat.unref();

  const refuse = (socket: Duplex, status: number, text: string) => {
    socket.end(`HTTP/1.1 ${status} ${text}\r\nConnection: close\r\nContent-Length: 0\r\n\r\n`);
  };

  const join = (client: WebSocket, account: number, query: string) => {
    client.on('error', () => {});
    alive.set(client, true);
    client.on('pong', () => alive.set(client, true));
    const up = new WebSocket(`${wsBase}/ws${query}`, { headers: internal(account), handshakeTimeout: 10_000 });
    upstreams.add(up);
    up.on('error', () => {});
    let queue: [RawData, boolean][] | null = [];
    let wasOpen = false;
    client.on('message', (data, isBinary) => {
      if (up.readyState === WebSocket.OPEN) up.send(data, { binary: isBinary });
      else if (queue && queue.length < MAX_QUEUED) queue.push([data, isBinary]);
      // Never dropped silently: the client sends again once it is back.
      else if (queue) client.close(1013, 'coach not ready');
    });
    up.on('open', () => {
      wasOpen = true;
      for (const [data, isBinary] of queue ?? []) up.send(data, { binary: isBinary });
      queue = null;
    });
    up.on('message', (data, isBinary) => { if (client.readyState === WebSocket.OPEN) client.send(data, { binary: isBinary }); });
    up.on('close', (code, reason) => {
      upstreams.delete(up);
      queue = null;
      // A coach that cannot be reached, or a connection that broke: the client tries again later.
      const pass = wasOpen && sendable(code) && code !== COACH_REFUSED_TOKEN;
      if (client.readyState === WebSocket.OPEN || client.readyState === WebSocket.CONNECTING) client.close(pass ? code : 1013, pass ? reason.toString() : 'coach unavailable');
    });
    client.on('close', (code) => {
      queue = null;
      if (up.readyState === WebSocket.CONNECTING) up.terminate();
      else if (up.readyState === WebSocket.OPEN) up.close(sendable(code) ? code : 1000);
    });
  };

  app.server.on('upgrade', (req: IncomingMessage, socket: Duplex, head: Buffer) => {
    socket.on('error', () => {});
    const url = req.url ?? '';
    const q = url.indexOf('?');
    const [path, query] = q < 0 ? [url, ''] : [url.slice(0, q), url.slice(q)];
    if (path !== '/coach') { refuse(socket, 404, 'Not Found'); return; }
    void (async () => {
      let account: number | null = null;
      try { account = await opts.resolve(req); } catch { /* no login */ }
      if (account === null) { refuse(socket, 401, 'Unauthorized'); return; }
      // Gone while the login was checked: its close has passed, so it must not be counted.
      if (socket.destroyed) return;
      const n = perAccount.get(account) ?? 0;
      if (n >= MAX_SOCKETS_PER_ACCOUNT) { refuse(socket, 429, 'Too Many Requests'); return; }
      // Counted from here until the connection is gone, whether or not the upgrade succeeds.
      perAccount.set(account, n + 1);
      socket.once('close', () => {
        const left = (perAccount.get(account) ?? 1) - 1;
        if (left > 0) perAccount.set(account, left); else perAccount.delete(account);
      });
      wss.handleUpgrade(req, socket, head, (client) => join(client, account, query));
    })();
  });

  app.addHook('onClose', async () => {
    clearInterval(heartbeat);
    for (const c of wss.clients) c.terminate();
    for (const u of upstreams) u.terminate();
    wss.close();
  });
}
