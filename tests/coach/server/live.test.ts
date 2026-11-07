import { beforeEach, expect, test } from 'vitest';
import { LiveChannel } from '../../../src/coach/server/live';
import type { LiveMessage, LiveState } from '../../../src/shared/live';

type Peer = { name: string; subscribed: boolean; got: LiveMessage[] };
let now: number;
let accounts: Map<number, Peer[]>;
let ch: LiveChannel<Peer>;
const peer = (account: number, name: string, subscribed = true): Peer => {
  const p = { name, subscribed, got: [] as LiveMessage[] };
  accounts.set(account, [...(accounts.get(account) ?? []), p]);
  return p;
};
beforeEach(() => {
  now = 1_000_000; accounts = new Map();
  ch = new LiveChannel<Peer>({ nowMs: () => now, send: (p, m) => { p.got.push(m); }, peers: (id) => accounts.get(id) ?? [], watching: (p) => p.subscribed });
});

const state = (over: Partial<LiveState> = {}): LiveState => ({
  rideId: 'ride-1', profileId: 'pa', atMs: now, elapsedS: 120, powerW: 180, hrBpm: 140, cadenceRpm: 85, targetW: 190,
  step: { name: 'Tempo', index: 1, count: 4, remainingS: 200 }, nextStep: { label: 'Locker' }, ...over,
});
const live = (p: Peer, s: LiveState = state()) => ch.handle(1, 'pa', p, { type: 'live-state', profileId: 'pa', state: s });
const cmd = (over: Record<string, unknown> = {}) => ({ type: 'live-command', profileId: 'pa', id: 'c1', rideId: 'ride-1', atMs: now, kind: 'adjust', deltaPct: 5, ...over });

test('the state reaches the account\'s other subscribed connections, not the Mac and not another account', () => {
  const mac = peer(1, 'mac'), phone = peer(1, 'phone'), idle = peer(1, 'idle', false), other = peer(2, 'other');
  live(mac);
  expect(phone.got).toEqual([{ type: 'live-state', profileId: 'pa', state: state() }]);
  expect(mac.got).toEqual([]);
  expect(idle.got).toEqual([]);
  expect(other.got).toEqual([]);
});

test('a connection that subscribes later sees a fresh state, but never a stale one', () => {
  const mac = peer(1, 'mac'); live(mac);
  const early = peer(1, 'early'); ch.hello(1, early);
  expect(early.got).toHaveLength(1);
  now += 10_001;
  const late = peer(1, 'late'); ch.hello(1, late);
  expect(late.got).toEqual([]);
  expect(ch.fresh(1)).toBeNull();
});

test('a state for another profile id or a malformed one is dropped', () => {
  const mac = peer(1, 'mac'), phone = peer(1, 'phone');
  ch.handle(1, 'pa', mac, { type: 'live-state', profileId: 'pb', state: state({ profileId: 'pb' }) });
  ch.handle(1, 'pa', mac, { type: 'live-state', profileId: 'pa', state: { nope: true } });
  ch.handle(1, 'pa', mac, { type: 'live-state', profileId: 'pa', state: state({ profileId: 'pb' }) });
  expect(phone.got).toEqual([]);
  expect(ch.fresh(1)).toBeNull();
});

test('live-end clears the ride and tells the phones; only the owner can end it', () => {
  const mac = peer(1, 'mac'), phone = peer(1, 'phone'); live(mac);
  ch.handle(1, 'pa', phone, { type: 'live-end', profileId: 'pa', rideId: 'ride-1' });
  expect(ch.fresh(1)).not.toBeNull();
  ch.handle(1, 'pa', mac, { type: 'live-end', profileId: 'pa', rideId: 'ride-1' });
  expect(ch.fresh(1)).toBeNull();
  expect(phone.got.at(-1)).toEqual({ type: 'live-end', profileId: 'pa', rideId: 'ride-1' });
});

test('the owner closing drops the ride', () => {
  const mac = peer(1, 'mac'); live(mac);
  ch.closed(1, mac);
  expect(ch.fresh(1)).toBeNull();
});

test('a command goes to the Mac of the same account only, and its ack comes back to the phone', () => {
  const mac = peer(1, 'mac'), phone = peer(1, 'phone'), otherMac = peer(2, 'otherMac'), otherPhone = peer(2, 'otherPhone');
  live(mac);
  ch.handle(1, 'pa', phone, cmd());
  expect(mac.got.at(-1)).toMatchObject({ type: 'live-command', id: 'c1', kind: 'adjust', deltaPct: 5 });
  expect(otherMac.got).toEqual([]);
  ch.handle(1, 'pa', mac, { type: 'live-ack', profileId: 'pa', id: 'c1', ok: true });
  expect(phone.got.at(-1)).toEqual({ type: 'live-ack', profileId: 'pa', id: 'c1', ok: true });
  expect(otherPhone.got).toEqual([]);
  // A second ack for the same id is not passed on.
  const n = phone.got.length;
  ch.handle(1, 'pa', mac, { type: 'live-ack', profileId: 'pa', id: 'c1', ok: true });
  expect(phone.got).toHaveLength(n);
});

test('a command is refused across accounts: an account without a ride gets no-ride and nothing reaches the other Mac', () => {
  const mac = peer(1, 'mac'); live(mac);
  const stranger = peer(2, 'stranger'), strangerMac = peer(2, 'strangerMac');
  ch.handle(2, 'pb', stranger, { ...cmd(), profileId: 'pb' });
  expect(stranger.got).toEqual([{ type: 'live-ack', profileId: 'pb', id: 'c1', ok: false, reason: 'no-ride' }]);
  expect(mac.got).toEqual([]);
  expect(strangerMac.got).toEqual([]);
});

test('a command for another ride, a stale ride, an old command or a bad shape is refused', () => {
  const mac = peer(1, 'mac'), phone = peer(1, 'phone'); live(mac);
  ch.handle(1, 'pa', phone, cmd({ id: 'a', rideId: 'ride-other' }));
  ch.handle(1, 'pa', phone, cmd({ id: 'b', atMs: now - 11_000 }));
  ch.handle(1, 'pa', phone, cmd({ id: 'c', deltaPct: 50 }));
  ch.handle(1, 'pa', phone, cmd({ id: 'd', deltaPct: 5.5 }));
  ch.handle(1, 'pa', phone, cmd({ id: 'e', kind: 'stop' }));
  expect(phone.got.filter((m) => m.type === 'live-ack').map((m) => (m as { reason?: string }).reason)).toEqual(['no-ride', 'old', 'invalid', 'invalid', 'invalid']);
  expect(mac.got).toEqual([]);
  now += 10_001;
  ch.handle(1, 'pa', phone, cmd({ id: 'f' }));
  expect(phone.got.at(-1)).toMatchObject({ reason: 'no-ride' });
  expect(mac.got).toEqual([]);
});

test('at most five commands per ten seconds', () => {
  const mac = peer(1, 'mac'), phone = peer(1, 'phone'); live(mac);
  for (let i = 0; i < 7; i++) ch.handle(1, 'pa', phone, cmd({ id: `c${i}`, kind: 'mark', deltaPct: undefined }));
  expect(mac.got).toHaveLength(5);
  expect(phone.got.filter((m) => (m as { reason?: string }).reason === 'rate')).toHaveLength(2);
  now += 10_000;
  live(mac, state({ atMs: now }));
  ch.handle(1, 'pa', phone, cmd({ id: 'later', kind: 'skip', deltaPct: undefined }));
  expect(mac.got).toHaveLength(6);
});

test('only the owner can ack, and a failing owner send turns into an offline answer', () => {
  const mac = peer(1, 'mac'), phone = peer(1, 'phone'), imposter = peer(1, 'imposter'); live(mac);
  ch.handle(1, 'pa', phone, cmd());
  ch.handle(1, 'pa', imposter, { type: 'live-ack', profileId: 'pa', id: 'c1', ok: true });
  expect(phone.got.filter((m) => m.type === 'live-ack')).toEqual([]);
  const broken = new LiveChannel<Peer>({ nowMs: () => now, send: (p, m) => { if (p.name === 'mac') throw new Error('gone'); p.got.push(m); }, peers: (id) => accounts.get(id) ?? [], watching: () => true });
  const phone2 = peer(1, 'phone2');
  broken.handle(1, 'pa', mac, { type: 'live-state', profileId: 'pa', state: state() });
  broken.handle(1, 'pa', phone2, cmd({ id: 'z' }));
  expect(phone2.got.at(-1)).toMatchObject({ type: 'live-ack', ok: false, reason: 'offline' });
});

test('garbage never throws', () => {
  const mac = peer(1, 'mac');
  for (const m of [{}, { type: 'live-state' }, { type: 'live-command', profileId: 'pa' }, { type: 'live-ack', profileId: 'pa' }, { type: 'live-end', profileId: 'pa' }]) {
    expect(() => ch.handle(1, 'pa', mac, m)).not.toThrow();
  }
});
