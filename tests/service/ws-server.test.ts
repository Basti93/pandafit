import { createServer } from 'node:http';
import { WebSocket } from 'ws';
import { startWsServer } from '../../src/service/ws-server';
import type { RideService } from '../../src/service/ride-service';

const fakeService = () => ({ subscribe: () => () => {}, handle: vi.fn() }) as unknown as RideService;
const TOKEN = 'a'.repeat(64);
const opens = (port: number, origin?: string, token: string | null = TOKEN) => new Promise<boolean>((resolve) => {
  const ws = new WebSocket(`ws://127.0.0.1:${port}${token === null ? '' : `?t=${token}`}`, origin ? { origin } : {});
  ws.once('open', () => { ws.close(); resolve(true); });
  ws.once('error', () => resolve(false));
});
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

test('foreign web pages are rejected, app and scripts accepted', async () => {
  const srv = startWsServer(fakeService(), { port: 7611, devOrigin: 'http://localhost:5173', token: TOKEN });
  await sleep(30);
  expect(await opens(7611, 'https://evil.example')).toBe(false);
  expect(await opens(7611, 'http://localhost:9999')).toBe(false);
  expect(await opens(7611)).toBe(true);
  expect(await opens(7611, 'file://')).toBe(true);
  expect(await opens(7611, 'http://localhost:5173')).toBe(true);
  srv.close();
});
test('a wrong or missing token is rejected, origin null never passes', async () => {
  const srv = startWsServer(fakeService(), { port: 7613, token: TOKEN });
  await sleep(30);
  expect(await opens(7613, undefined, null)).toBe(false);
  expect(await opens(7613, undefined, 'b'.repeat(64))).toBe(false);
  expect(await opens(7613, undefined, 'a')).toBe(false);
  expect(await opens(7613, 'file://', null)).toBe(false);
  expect(await opens(7613, 'null')).toBe(false);
  expect(await opens(7613, 'file://')).toBe(true);
  expect(await opens(7613)).toBe(true);
  srv.close();
});
test('occupied port is retried instead of crashing', async () => {
  const blocker = createServer().listen(7612, '127.0.0.1');
  await sleep(30);
  const srv = startWsServer(fakeService(), { port: 7612, retryMs: 20, token: TOKEN });
  await sleep(50);
  await new Promise((r) => blocker.close(r));
  await sleep(60);
  expect(await opens(7612)).toBe(true);
  srv.close();
});
