import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { FakeBlePort } from '../../src/service/ble/fake-device';
import { readRide } from '../../src/ride-format/read';
import { RideService } from '../../src/service/ride-service';
import type { ServerMessage, StateMessage } from '../../src/shared/protocol';

const session = { id: 's', name: 'x', steps: [{ kind: 'erg' as const, durationS: 100, ftpFraction: 0.5, label: 'A' }] };
const settle = () => new Promise((r) => setTimeout(r, 5));
const setup = async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'devices-'));
  const ble = new FakeBlePort();
  ble.online.clicker = true;
  const clock = { t: 0 };
  const svc = new RideService({ dir, ble, nowMs: () => clock.t, retryMs: 10 });
  const seen: ServerMessage[] = [];
  svc.subscribe((m) => seen.push(m));
  await settle();
  const last = () => { svc.tick(); return seen.filter((m): m is StateMessage => m.type === 'state').at(-1)!; };
  return { dir, svc, ble, seen, last, clock };
};

test('the clicker can be disconnected and connected again', async () => {
  const { svc, last } = await setup();
  svc.handle({ type: 'device-disconnect', kind: 'clicker' });
  await settle();
  expect(last().devices.clicker).toBe('off');
  svc.handle({ type: 'device-connect', kind: 'clicker' });
  await settle();
  expect(last().devices.clicker).toBe('connected');
  svc.close();
});
test('the trainer stays connected during a ride, with a clear message', async () => {
  const { svc, last, seen } = await setup();
  svc.handle({ type: 'start', profileId: 'A', session, ftpW: 200 });
  svc.handle({ type: 'device-disconnect', kind: 'trainer' });
  await settle();
  expect(last().devices.trainer).toBe('connected');
  expect(seen.some((m) => m.type === 'error' && m.message.includes('Trainer'))).toBe(true);
  svc.close();
});
test('starting a ride reconnects a trainer that was disconnected', async () => {
  const { svc, last } = await setup();
  svc.handle({ type: 'device-disconnect', kind: 'trainer' });
  await settle();
  expect(last().devices.trainer).toBe('off');
  svc.handle({ type: 'start', profileId: 'A', session, ftpW: 200 });
  await settle();
  expect(last().devices.trainer).toBe('connected');
  svc.close();
});
test('disconnecting the strap during a ride keeps recording, without an old pulse', async () => {
  const { dir, svc, ble, last, clock } = await setup();
  svc.handle({ type: 'start', profileId: 'A', session, ftpW: 200 });
  ble.emit('hr', Buffer.from([0x00, 90]));
  clock.t += 1000; svc.tick();
  svc.handle({ type: 'device-disconnect', kind: 'hr' });
  await settle();
  clock.t += 1000;
  const s = last();
  expect(s.latest.hrBpm).toBeUndefined();
  const rideId = s.ride!.rideId;
  svc.handle({ type: 'stop' });
  const ride = readRide(dir, rideId);
  expect(ride.samples.length).toBeGreaterThanOrEqual(2);
  expect(ride.events.filter((e) => e.type === 'device-lost' && e.detail === 'hr')).toHaveLength(1);
  svc.close();
});
