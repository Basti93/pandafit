import { afterEach, expect, test, vi } from 'vitest';
import { LiveRelay } from '../../../src/coach/remote/live-relay';
import { RemoteCoach, ruleFallback } from '../../../src/coach/remote/remote-coach';
import type { LiveMessage } from '../../../src/shared/live';
import { fakeSockets } from './fake-socket';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const NOW = 5_000_000;
let relays: LiveRelay[] = [];
afterEach(() => { for (const r of relays) r.stop(); relays = []; vi.useRealTimers(); });

const serviceState = (over: Record<string, unknown> = {}, rideId = 'ride-1') => ({
  type: 'state', ride: { rideId, profileId: 'pa', status: 'open' },
  engine: { stepIndex: 1, stepRemainingS: 90, rideElapsedS: 150, targetW: 170, label: 'Tempo', nextLabel: 'Locker', paused: false },
  latest: { powerW: 168, hrBpm: 141, cadenceRpm: 88 }, session: { steps: [{}, {}, {}] }, ...over,
});

const make = (o: { open?: () => boolean; target?: boolean } = {}) => {
  vi.useFakeTimers({ now: NOW });
  const ws = fakeSockets();
  const sent: LiveMessage[] = [];
  const w = { open: true, target: o.target !== false, now: NOW };
  const relay = new LiveRelay({
    serviceUrl: 'ws://127.0.0.1:7410', rideOpen: o.open ?? (() => w.open), nowMs: () => w.now, WebSocketImpl: ws.Impl,
    target: () => (w.target ? (m) => { sent.push(m); return true; } : null),
  });
  relays.push(relay);
  return { relay, ws, sent, w };
};
const connect = (t: ReturnType<typeof make>) => { t.relay.tick(); const s = t.ws.last(); s.open(); return s; };

test('while a ride is open it connects to the service and sends the latest state once per second, no backlog', () => {
  const t = make();
  const s = connect(t);
  expect(s.url).toBe('ws://127.0.0.1:7410');
  for (let i = 0; i < 3; i++) { t.w.now += 300; s.answer(serviceState({ engine: { ...serviceState().engine, rideElapsedS: 150 + i } })); }
  vi.advanceTimersByTime(1000);
  expect(t.sent).toHaveLength(1);
  expect(t.sent[0]).toMatchObject({ type: 'live-state', profileId: 'pa', state: {
    rideId: 'ride-1', elapsedS: 152, powerW: 168, hrBpm: 141, cadenceRpm: 88, targetW: 170,
    step: { name: 'Tempo', index: 1, count: 3, remainingS: 90 }, nextStep: { label: 'Locker' },
  } });
  vi.advanceTimersByTime(3000);
  expect(t.sent).toHaveLength(1);
});

test('no ride open: no connection; ride closes: live-end and the connection is let go', () => {
  const t = make();
  t.w.open = false;
  t.relay.tick();
  expect(t.ws.sockets).toHaveLength(0);
  t.w.open = true;
  const s = connect(t);
  s.answer(serviceState());
  t.w.open = false;
  t.relay.tick();
  expect(t.sent.at(-1)).toEqual({ type: 'live-end', profileId: 'pa', rideId: 'ride-1' });
  expect(s.closed).toBe(1000);
});

test('a state without a ride ends the live ride', () => {
  const t = make();
  const s = connect(t);
  s.answer(serviceState());
  s.answer({ type: 'state', ride: null, engine: null, latest: {} });
  expect(t.sent.at(-1)).toMatchObject({ type: 'live-end', rideId: 'ride-1' });
  vi.advanceTimersByTime(2000);
  expect(t.sent.filter((m) => m.type === 'live-state')).toHaveLength(0);
});

test('a profile without a server coach gets nothing', () => {
  const t = make({ target: false });
  const s = connect(t);
  s.answer(serviceState());
  vi.advanceTimersByTime(2000);
  expect(t.sent).toEqual([]);
});

test('garbage from the service never throws; a lost service connection retries later and sends nothing', () => {
  const t = make();
  const s = connect(t);
  expect(() => { s.emit('message', Buffer.from('{{{'), false); s.answer({ type: 'state', ride: { rideId: 1 }, engine: {} }); s.answer(null); }).not.toThrow();
  s.end(1006);
  vi.advanceTimersByTime(2500);
  expect(t.ws.sockets).toHaveLength(2);
});

const command = (over: Record<string, unknown> = {}) => ({ type: 'live-command', profileId: 'pa', id: 'c1', rideId: 'ride-1', atMs: NOW, kind: 'adjust', deltaPct: 5, ...over });
const acks = (t: ReturnType<typeof make>) => t.sent.filter((m) => m.type === 'live-ack');

test('commands become the normal service messages and are acked', () => {
  const t = make();
  const s = connect(t);
  s.answer(serviceState());
  t.relay.onCommand(command());
  t.relay.onCommand(command({ id: 'c2', kind: 'adjust', deltaPct: -5 }));
  t.relay.onCommand(command({ id: 'c3', kind: 'mark', deltaPct: undefined }));
  t.relay.onCommand(command({ id: 'c4', kind: 'skip', deltaPct: undefined }));
  expect(s.sent).toEqual([{ type: 'adjust', deltaPct: 5 }, { type: 'adjust', deltaPct: -5 }, { type: 'mark', note: 'Handy' }, { type: 'skip' }]);
  expect(acks(t).map((a) => (a as { ok: boolean }).ok)).toEqual([true, true, true, true]);
});

test('refused: another ride, old, bad shape, no service state, wrong profile', () => {
  const t = make();
  const s = connect(t);
  t.relay.onCommand(command({ id: 'n0' }));
  s.answer(serviceState());
  t.relay.onCommand(command({ id: 'n1', rideId: 'ride-9' }));
  t.relay.onCommand(command({ id: 'n2', atMs: NOW - 11_000 }));
  t.relay.onCommand(command({ id: 'n3', deltaPct: 10 }));
  t.relay.onCommand(command({ id: 'n4', kind: 'stop' }));
  t.relay.onCommand(command({ id: 'n5', profileId: 'pb' }));
  expect(s.sent).toEqual([]);
  expect(acks(t).map((a) => (a as { reason?: string }).reason)).toEqual(['no-ride', 'no-ride', 'old', 'no-ride']);
  // A service state that went quiet for over 5 s no longer counts.
  t.w.now += 6000;
  t.relay.onCommand(command({ id: 'n6', atMs: t.w.now }));
  expect(s.sent).toEqual([]);
  expect(acks(t).at(-1)).toMatchObject({ ok: false, reason: 'no-ride' });
});

test('the same id is answered but done once; more than five per ten seconds are refused', () => {
  const t = make();
  const s = connect(t);
  s.answer(serviceState());
  t.relay.onCommand(command({ id: 'dup' }));
  t.relay.onCommand(command({ id: 'dup' }));
  expect(s.sent).toHaveLength(1);
  expect(acks(t)).toHaveLength(2);
  for (let i = 0; i < 6; i++) t.relay.onCommand(command({ id: `r${i}`, kind: 'mark', deltaPct: undefined }));
  expect(s.sent).toHaveLength(5);
  expect(acks(t).at(-1)).toMatchObject({ ok: false, reason: 'rate' });
  t.w.now += 10_001;
  s.answer(serviceState());
  t.relay.onCommand(command({ id: 'again', atMs: t.w.now }));
  expect(s.sent).toHaveLength(6);
});

test('a service socket that throws on send gives an honest failure and never throws', () => {
  const t = make();
  const s = connect(t);
  s.answer(serviceState());
  s.send = () => { throw new Error('closed'); };
  expect(() => t.relay.onCommand(command())).not.toThrow();
  expect(acks(t).at(-1)).toMatchObject({ ok: false, reason: 'failed' });
});

test('a broken server link does not touch the service connection: sending fails silently, the service socket stays', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'lr-'));
  const server = fakeSockets();
  const remote = new RemoteCoach({
    dir, profileId: 'pa', url: () => 'https://pandafit.example.org/api', token: () => 'tok', mayWrite: () => false,
    fallback: () => ruleFallback(dir, 'pa', 200, NOW), nowMs: () => NOW, WebSocketImpl: server.Impl, onMessage: () => {},
  });
  vi.useFakeTimers({ now: NOW });
  const svc = fakeSockets();
  const relay = new LiveRelay({
    serviceUrl: 'ws://127.0.0.1:7410', rideOpen: () => true, nowMs: () => NOW, WebSocketImpl: svc.Impl,
    target: () => (m) => remote.sendLive(m),
  });
  relays.push(relay);
  remote.start();
  relay.tick();
  svc.last().open();
  svc.last().answer(serviceState());
  // Server link not open yet: nothing is queued or sent, nothing throws.
  vi.advanceTimersByTime(1500);
  expect(server.last().sent).toEqual([]);
  server.last().open();
  svc.last().answer(serviceState());
  vi.advanceTimersByTime(1000);
  expect(server.last().sent.map((m) => m.type)).toEqual(['subscribe', 'live-state']);
  // The server link breaks: further states are dropped, the service socket is untouched.
  server.last().send = () => { throw new Error('broken'); };
  svc.last().answer(serviceState());
  expect(() => vi.advanceTimersByTime(1000)).not.toThrow();
  server.last().end(1006);
  svc.last().answer(serviceState());
  expect(() => vi.advanceTimersByTime(1000)).not.toThrow();
  expect(svc.last().closed).toBeNull();
  expect(svc.sockets).toHaveLength(1);
  remote.stop();
});
