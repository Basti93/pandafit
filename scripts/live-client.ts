import { WebSocket } from 'ws';
import { requireLocalToken, servicePort } from '../src/shared/node/local-token';
import { SERVICE_PORT, type ClientMessage } from '../src/shared/protocol';

export const sendToService = (msg: ClientMessage): void => {
  const ws = new WebSocket(`ws://127.0.0.1:${servicePort(SERVICE_PORT)}/?t=${requireLocalToken()}`);
  ws.once('open', () => { ws.send(JSON.stringify(msg)); setTimeout(() => ws.close(), 100); });
  ws.once('error', (e) => { process.stderr.write(`Fahrdienst nicht erreichbar: ${e.message}\n`); process.exitCode = 1; });
};
