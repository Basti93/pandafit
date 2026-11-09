import { createHash, timingSafeEqual } from 'node:crypto';
import type { FastifyInstance } from 'fastify';
import type { WebSocket, WebSocketServer } from 'ws';

/** An account id in a path or header: digits only, no leading zero, at most 16 of them. */
export const ACCOUNT_ID = /^[1-9][0-9]{0,15}$/;
/** As large as a POST to the public app or the internal listener may be. */
export const BODY_LIMIT = 5 * 1024 * 1024;

/** A fixed-length digest, so comparing two tokens neither leaks the length nor the content through the time taken. */
export const tokenDigest = (s: string): Buffer => createHash('sha256').update(s).digest();
/** True when `given` is the string whose digest is `expected`. */
export const tokenMatches = (given: unknown, expected: Buffer): boolean =>
  typeof given === 'string' && given.length > 0 && timingSafeEqual(tokenDigest(given), expected);

/** Client errors answer with their code, everything else with a plain 500. Only method, path and error name are logged. */
export const installErrorHandler = (app: FastifyInstance, label: string): void => {
  app.setErrorHandler((err: { statusCode?: number; name?: string }, req, reply) => {
    const code = typeof err.statusCode === 'number' && err.statusCode >= 400 && err.statusCode < 500 ? err.statusCode : 500;
    if (code === 500) console.error(label, req.method, req.url.split('?')[0], err.name ?? 'Error');
    return reply.code(code).send({ error: code === 413 ? 'too large' : code === 500 ? 'error' : 'bad request' });
  });
};

/**
 * A socket whose other end vanished without a close (the peer restarted, the network broke) is found and cut: it is pinged every
 * `intervalMs`, and one that has not answered the previous ping by then is terminated. Call `watch` for every new socket.
 */
export const startHeartbeat = (wss: WebSocketServer, intervalMs: number): { watch(ws: WebSocket): void; stop(): void } => {
  const alive = new WeakMap<WebSocket, boolean>();
  const timer = setInterval(() => {
    for (const ws of wss.clients) {
      if (alive.get(ws) === false) { ws.terminate(); continue; }
      alive.set(ws, false);
      try { ws.ping(); } catch { /* closing */ }
    }
  }, intervalMs);
  timer.unref();
  return {
    watch(ws) { alive.set(ws, true); ws.on('pong', () => alive.set(ws, true)); },
    stop() { clearInterval(timer); },
  };
};
