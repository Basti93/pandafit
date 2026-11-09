import { createServer, type Server } from 'node:http';
import { WebSocketServer } from 'ws';
import { parseClientMessage } from '../shared/ride-messages';
import { SERVICE_PORT } from '../shared/protocol';
import { localClientAllowed } from '../shared/node/ws-guard';
import type { RideService } from './ride-service';

type Options = { port?: number; devOrigin?: string; retryMs?: number; token: string };

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
      // A rejected message only gets an error answer: it never touches a running ride.
      const msg = parseClientMessage(String(raw));
      if (!msg) { try { socket.send(JSON.stringify({ type: 'error', message: 'Ungültige Nachricht.' })); } catch { /* connection gone */ } return; }
      try { service.handle(msg); } catch { /* ignore a failing message */ }
    });
    socket.on('close', unsubscribe);
    socket.on('error', unsubscribe);
  });
  listen();
  return http;
};
