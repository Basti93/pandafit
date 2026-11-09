import { createServer, type IncomingMessage, type Server } from 'node:http';
import { WebSocketServer } from 'ws';
import type { ClientMessage } from '../shared/protocol';
import { SERVICE_PORT } from '../shared/protocol';
import { tokenMatches } from '../shared/node/local-token';
import type { RideService } from './ride-service';

type Options = { port?: number; devOrigin?: string; retryMs?: number; token: string };

/**
 * Only our own UI and local scripts (without an Origin) may talk to it, so that no foreign web page can end a running ride.
 * Origin `null` (sandboxed frames, data: pages) is never allowed. A connection also needs the machine's token in `?t=`.
 * An occupied port is retried; recording continues even without a UI.
 */
export const originAllowed = (devOrigin?: string) => {
  const allowed = new Set<string | undefined>([undefined, 'file://', devOrigin]);
  return ({ origin }: { origin?: string }): boolean => allowed.has(origin);
};

export const tokenOf = (req: IncomingMessage): string | null => {
  try { return new URL(req.url ?? '/', 'http://local').searchParams.get('t'); } catch { return null; }
};

export const localClientAllowed = (token: string, devOrigin?: string) => {
  const origin = originAllowed(devOrigin);
  return (info: { origin?: string; req: IncomingMessage }): boolean => origin(info) && tokenMatches(token, tokenOf(info.req));
};

export const startWsServer = (service: RideService, opts: Options): Server => {
  const port = opts.port ?? SERVICE_PORT;
  const http = createServer();
  const wss = new WebSocketServer({ server: http, verifyClient: localClientAllowed(opts.token, opts.devOrigin) });
  let timer: ReturnType<typeof setTimeout> | undefined;
  const listen = () => http.listen(port, '127.0.0.1');
  http.on('error', () => { timer = setTimeout(listen, opts.retryMs ?? 2000); });
  http.on('close', () => clearTimeout(timer));
  wss.on('error', () => {});
  wss.on('connection', (socket) => {
    const unsubscribe = service.subscribe((m) => socket.send(JSON.stringify(m)));
    socket.on('message', (raw) => {
      try { service.handle(JSON.parse(String(raw)) as ClientMessage); } catch { /* ignore invalid message */ }
    });
    socket.on('close', unsubscribe);
    socket.on('error', unsubscribe);
  });
  listen();
  return http;
};
