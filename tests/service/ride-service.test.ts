import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { FakeBlePort } from '../../src/service/ble/fake-device';
import { readRide } from '../../src/service/recorder';
import { RideService } from '../../src/service/ride-service';
import type { ServerMessage } from '../../src/shared/protocol';
import type { Session } from '../../src/shared/session';

const session: Session = { id: 's', name: 'Test', steps: [{ kind: 'erg', durationS: 100, ftpFraction: 0.5, label: 'A' }] };
let dir: string; let t: number; let out: ServerMessage[];
const make = () => { const svc = new RideService({ dir, ble: new FakeBlePort(), nowMs: () => t }); svc.subscribe((m) => out.push(m)); return svc; };
const ticks = (svc: RideService, n: number) => { for (let i = 0; i < n; i++) { t += 1000; svc.tick(); } };
beforeEach(() => { dir = fs.mkdtempSync(path.join(os.tmpdir(), 'svc-')); t = 1000; out = []; });

const start = (svc: RideService, profileId = 'A') => svc.handle({ type: 'start', profileId, session, ftpW: 200 });
const onlyRide = () => fs.readdirSync(dir).find((n) => n.startsWith('ride-'))!;

test('records a sample per tick and finishes at the end', () => {
  const svc = make(); start(svc); ticks(svc, 100);
  const r = readRide(dir, onlyRide());
  expect(r.samples).toHaveLength(100);
  expect(r.meta.status).toBe('finished');
});
test('recovery keeps original profile regardless of active profile', () => {
  const first = make(); start(first, 'A'); ticks(first, 10);
  out = [];
  const svc = make();
  svc.subscribeActiveProfile('B');
  const offer = out.find((m) => m.type === 'recovery-offer');
  expect(offer && offer.type === 'recovery-offer' && offer.profileId).toBe('A');
  svc.handle({ type: 'resume', rideId: onlyRide() });
  ticks(svc, 1);
  expect(readRide(dir, onlyRide()).meta.profileId).toBe('A');
  expect(readRide(dir, onlyRide()).samples).toHaveLength(11);
});
test('open ride keeps recording after restart until the user decides', () => {
  const first = make(); start(first); ticks(first, 10);
  const svc = make(); ticks(svc, 5);
  const r = readRide(dir, onlyRide());
  expect(r.samples.map((s) => s.seq)).toEqual(Array.from({ length: 15 }, (_, i) => i));
  expect(r.events.some((e) => e.type === 'resumed')).toBe(true);
});
test('discard-resume marks aborted and keeps samples', () => {
  const first = make(); start(first); ticks(first, 10);
  const svc = make();
  svc.handle({ type: 'discard-resume', rideId: onlyRide() });
  const r = readRide(dir, onlyRide());
  expect(r.meta.status).toBe('aborted');
  expect(r.samples).toHaveLength(10);
});
test('stop saves an aborted ride', () => {
  const svc = make(); start(svc); ticks(svc, 3);
  svc.handle({ type: 'stop' });
  expect(readRide(dir, onlyRide()).meta.status).toBe('aborted');
});
test('discarded ride keeps its data on disk, marked and without FIT', () => {
  const svc = make(); start(svc); ticks(svc, 3);
  svc.handle({ type: 'discard' });
  const { meta, samples } = readRide(dir, onlyRide());
  expect(meta.status).toBe('discarded');
  expect(samples.length).toBeGreaterThan(0);
  expect(fs.existsSync(path.join(dir, 'exports'))).toBe(false);
});
test('ui subscriber failure does not affect ride', () => {
  const svc = make(); svc.subscribe(() => { throw new Error('ui gone'); });
  start(svc); ticks(svc, 5);
  expect(readRide(dir, onlyRide()).samples).toHaveLength(5);
});
test('second start is refused while a ride is open', () => {
  const svc = make(); start(svc); start(svc);
  expect(fs.readdirSync(dir).filter((n) => n.startsWith('ride-'))).toHaveLength(1);
  expect(out.some((m) => m.type === 'error')).toBe(true);
});
test('ride can start with no devices connected', () => {
  const ble = new FakeBlePort(); ble.online = { trainer: false, hr: false, clicker: false };
  const svc = new RideService({ dir, ble, nowMs: () => t });
  start(svc); ticks(svc, 2);
  expect(readRide(dir, onlyRide()).samples).toHaveLength(2);
  svc.close();
});
test('mark is stored in ride events', () => {
  const svc = make(); start(svc);
  svc.handle({ type: 'mark', note: 'zu hart' });
  expect(readRide(dir, onlyRide()).events.find((e) => e.type === 'marker')?.detail).toBe('zu hart');
});
test('lost trainer clears readings and logs device events', () => {
  const ble = new FakeBlePort();
  const svc = new RideService({ dir, ble, nowMs: () => t, retryMs: 5 });
  start(svc);
  return new Promise<void>((resolve) => setTimeout(() => {
    ble.emit('trainer', Buffer.from([0x41, 0x00, 0x64, 0x00]));
    ticks(svc, 1);
    ble.drop('trainer');
    ticks(svc, 1);
    const r = readRide(dir, onlyRide());
    expect(r.samples.map((x) => x.powerW)).toEqual([100, null]);
    expect(r.events.some((e) => e.type === 'device-lost' && e.detail === 'trainer')).toBe(true);
    svc.close();
    resolve();
  }, 20));
});
test('profiles persist across service restarts', () => {
  const first = make();
  first.handle({ type: 'save-profile', profile: { id: 'p1', name: 'Anna', ftpW: 150 } });
  out = [];
  const svc = make();
  t += 1000; svc.tick();
  const state = out.find((m) => m.type === 'state');
  expect(state && state.type === 'state' && state.profiles).toEqual([{ id: 'p1', name: 'Anna', ftpW: 150 }]);
});
test('finished and stopped rides are exported as FIT automatically', () => {
  const svc = make(); start(svc); ticks(svc, 100);
  expect(fs.existsSync(path.join(dir, 'exports', `${onlyRide()}.fit`))).toBe(true);
});
test('export-fit writes a file for an earlier ride', () => {
  const svc = make(); start(svc); ticks(svc, 100);
  fs.rmSync(path.join(dir, 'exports'), { recursive: true });
  svc.handle({ type: 'export-fit', rideId: onlyRide() });
  expect(fs.existsSync(path.join(dir, 'exports', `${onlyRide()}.fit`))).toBe(true);
});
test('export failure does not lose the ride', () => {
  fs.writeFileSync(path.join(dir, 'exports'), 'im Weg');
  const svc = make(); start(svc); ticks(svc, 100);
  expect(readRide(dir, onlyRide()).meta.status).toBe('finished');
});
const failingFs = (state: { failing: boolean }) => ({ ...fs,
  writeSync: (fd: number, data: string) => { if (state.failing) throw new Error('ENOSPC'); return fs.writeSync(fd, data); },
  writeFileSync: (f: string, data: string) => { if (state.failing) throw new Error('ENOSPC'); return fs.writeFileSync(f, data); },
}) as unknown as typeof fs;
test('ride ending on a full disk keeps retrying without losing samples', () => {
  const state = { failing: false };
  const svc = new RideService({ dir, ble: new FakeBlePort(), nowMs: () => t, recorderFs: failingFs(state) });
  svc.handle({ type: 'start', profileId: 'A', session: { ...session, steps: [{ ...session.steps[0], durationS: 3 }] }, ftpW: 200 });
  ticks(svc, 1);
  state.failing = true;
  ticks(svc, 4);
  expect(readRide(dir, onlyRide()).meta.status).toBe('open');
  expect(svc.isRiding()).toBe(true);
  state.failing = false;
  ticks(svc, 1);
  const r = readRide(dir, onlyRide());
  expect(r.meta.status).toBe('finished');
  expect(r.samples.map((s) => s.seq)).toEqual([0, 1, 2]);
  expect(svc.isRiding()).toBe(false);
  svc.close();
});
test('corrupt session file does not stop the service from starting', () => {
  const first = make(); start(first); ticks(first, 5);
  fs.writeFileSync(path.join(dir, onlyRide(), 'session.json'), '{"session":');
  const svc = make();
  expect(svc.isRiding()).toBe(false);
  const r = readRide(dir, onlyRide());
  expect(r.meta.status).toBe('aborted');
  expect(r.samples).toHaveLength(5);
});
test('session file is written atomically', () => {
  const svc = make(); start(svc);
  expect(fs.readdirSync(path.join(dir, onlyRide()))).not.toContain('session.json.tmp');
  expect(fs.readdirSync(path.join(dir, onlyRide()))).toContain('session.json');
});
test('frozen readings are not recorded as live data', () => {
  const ble = new FakeBlePort();
  const svc = new RideService({ dir, ble, nowMs: () => t, retryMs: 5 });
  start(svc);
  return new Promise<void>((resolve) => setTimeout(() => {
    ble.emit('trainer', Buffer.from([0x41, 0x00, 0x64, 0x00]));
    ticks(svc, 5);
    expect(readRide(dir, onlyRide()).samples.map((x) => x.powerW)).toEqual([100, 100, 100, null, null]);
    svc.close();
    resolve();
  }, 20));
});
test('downtime after a crash is marked as a gap', () => {
  const first = make(); start(first); ticks(first, 5);
  t += 60_000;
  make();
  const gap = readRide(dir, onlyRide()).events.filter((e) => e.type === 'gap-start' || e.type === 'gap-end');
  expect(gap.map((e) => e.type)).toEqual(['gap-start', 'gap-end']);
});
test('after a long downtime the ride waits for a decision and counts no time', () => {
  const first = make(); start(first); ticks(first, 5);
  t += 24 * 3600 * 1000;
  const svc = make(); ticks(svc, 10);
  expect(readRide(dir, onlyRide()).samples).toHaveLength(5);
  svc.handle({ type: 'resume', rideId: onlyRide() });
  ticks(svc, 1);
  expect(readRide(dir, onlyRide()).samples.at(-1)!.rideElapsedS).toBe(6);
});
test('invalid rideId and invalid profile are refused', () => {
  const svc = make(); out = [];
  svc.handle({ type: 'export-fit', rideId: '../../evil' });
  svc.handle({ type: 'save-profile', profile: { id: 'x' } as never });
  expect(out.filter((m) => m.type === 'error')).toHaveLength(2);
  expect(fs.existsSync(path.join(dir, 'profiles.json'))).toBe(false);
});
test('deleting a profile removes it but keeps its rides', () => {
  const svc = make();
  svc.handle({ type: 'save-profile', profile: { id: 'gone', name: 'Weg', ftpW: 150 } });
  start(svc, 'gone'); ticks(svc, 10); svc.handle({ type: 'stop' });
  const rideDirs = () => fs.readdirSync(dir).filter((f) => f.startsWith('ride-'));
  const before = rideDirs();
  svc.handle({ type: 'delete-profile', profileId: 'gone' });
  const saved = JSON.parse(fs.readFileSync(path.join(dir, 'profiles.json'), 'utf8'));
  expect(saved.map((p: { id: string }) => p.id)).not.toContain('gone');
  expect(rideDirs()).toEqual(before);
});
test('a profile cannot be deleted during its ride', () => {
  const svc = make();
  svc.handle({ type: 'save-profile', profile: { id: 'P', name: 'Fahrend', ftpW: 150 } });
  start(svc, 'P');
  out = [];
  svc.handle({ type: 'delete-profile', profileId: 'P' });
  expect(out.some((m) => m.type === 'error')).toBe(true);
  expect(JSON.parse(fs.readFileSync(path.join(dir, 'profiles.json'), 'utf8'))).toHaveLength(1);
});
test('another profile can be deleted during a ride', () => {
  const svc = make();
  svc.handle({ type: 'save-profile', profile: { id: 'P', name: 'Fahrend', ftpW: 150 } });
  svc.handle({ type: 'save-profile', profile: { id: 'Q', name: 'Andere', ftpW: 150 } });
  start(svc, 'P');
  out = [];
  svc.handle({ type: 'delete-profile', profileId: 'Q' });
  expect(out.some((m) => m.type === 'error')).toBe(false);
  expect(JSON.parse(fs.readFileSync(path.join(dir, 'profiles.json'), 'utf8')).map((p: { id: string }) => p.id)).toEqual(['P']);
});

const twoSteps: Session = { id: 's2', name: 'Zwei', steps: [
  { kind: 'erg', durationS: 100, ftpFraction: 0.5, label: 'A' },
  { kind: 'erg', durationS: 100, ftpFraction: 0.8, label: 'B' },
] };
test('skip moves to the next step and is recorded as an event', () => {
  const svc = make(); svc.handle({ type: 'start', profileId: 'A', session: twoSteps, ftpW: 200 });
  ticks(svc, 5);
  svc.handle({ type: 'skip' });
  ticks(svc, 1);
  const r = readRide(dir, onlyRide());
  expect(r.events.filter((e) => e.type === 'skip')).toHaveLength(1);
  expect(r.samples.at(-1)?.targetW).toBe(160);
});
test('skip without a ride or on the last step does nothing and never throws', () => {
  const svc = make();
  svc.handle({ type: 'skip' });
  expect(out.some((m) => m.type === 'error')).toBe(false);
  start(svc); ticks(svc, 3);
  svc.handle({ type: 'skip' });
  expect(readRide(dir, onlyRide()).events.some((e) => e.type === 'skip')).toBe(false);
});
