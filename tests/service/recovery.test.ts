import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { findOpenRides, resumePoint } from '../../src/service/recovery';
import { readRide, RideRecorder } from '../../src/service/recorder';

const sample = (seq: number) => ({ seq, wallClockMs: seq, rideElapsedS: seq + 1, powerW: 1, cadenceRpm: 1, speedKph: 1, hrBpm: null, targetW: 1, gradePct: null, gear: null });
test('open ride yields resume point from last sample', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'rec-'));
  const rec = RideRecorder.create(dir, { rideId: 'a', profileId: 'p', sessionId: 's', startedAtMs: 1, status: 'open' });
  rec.append(sample(0)); rec.append(sample(1));
  RideRecorder.create(dir, { rideId: 'b', profileId: 'p', sessionId: 's', startedAtMs: 1, status: 'open' }).finish('finished');
  expect(findOpenRides(dir).map((m) => m.rideId)).toEqual(['a']);
  expect(resumePoint(readRide(dir, 'a'))).toMatchObject({ resumeAtS: 2, startSeq: 2, skippedS: 0 });
});
test('ride without samples resumes at the start', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'rec-'));
  RideRecorder.create(dir, { rideId: 'a', profileId: 'p', sessionId: 's', startedAtMs: 1, status: 'open' });
  expect(resumePoint(readRide(dir, 'a'))).toMatchObject({ resumeAtS: 0, startSeq: 0, skippedS: 0 });
});
test('foreign entries in the data dir are ignored', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'rec-'));
  fs.mkdirSync(path.join(dir, 'exports'));
  fs.writeFileSync(path.join(dir, 'profiles.json'), '[]');
  expect(findOpenRides(dir)).toEqual([]);
});
test('rides with unreadable meta are skipped', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'rec-'));
  fs.mkdirSync(path.join(dir, 'bad'));
  fs.writeFileSync(path.join(dir, 'bad', 'meta.json'), '{"rideId":');
  expect(findOpenRides(dir)).toEqual([]);
});

test('looking for open rides does not read samples', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'rec-'));
  const rec = RideRecorder.create(dir, { rideId: 'a', profileId: 'p', sessionId: 's', startedAtMs: 1, status: 'open' });
  rec.append(sample(0));
  const spy = vi.spyOn(fs, 'readFileSync');
  expect(findOpenRides(dir).map((m) => m.rideId)).toEqual(['a']);
  expect(spy.mock.calls.filter(([f]) => String(f).includes('samples'))).toEqual([]);
  spy.mockRestore();
});

test('skipped seconds are restored from the logged skip events', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'rec-'));
  const rec = RideRecorder.create(dir, { rideId: 'a', profileId: 'p', sessionId: 's', startedAtMs: 1, status: 'open' });
  rec.append(sample(0));
  rec.event({ wallClockMs: 1, type: 'skip', detail: '0:50' }); rec.event({ wallClockMs: 2, type: 'skip', detail: '1:30' }); rec.event({ wallClockMs: 3, type: 'skip', detail: 'junk' });
  expect(resumePoint(readRide(dir, 'a')).skippedS).toBe(80);
});

const sampleLine = (seq: number, wallClockMs: number) => `${JSON.stringify({ ...sample(seq), wallClockMs })}\n`;
test.each([['empty', ''], ['broken', '{"rideId":']])('a ride with %s meta.json and samples is recovered as open', (_n, content) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'rec-'));
  fs.mkdirSync(path.join(dir, 'ride-9'));
  fs.writeFileSync(path.join(dir, 'ride-9', 'meta.json'), content);
  fs.writeFileSync(path.join(dir, 'ride-9', 'samples.jsonl'), sampleLine(0, 5000) + sampleLine(1, 6000));
  fs.writeFileSync(path.join(dir, 'ride-9', 'session.json'), JSON.stringify({ session: { id: 'sess-1' }, ftpW: 200 }));
  const open = findOpenRides(dir);
  expect(open).toHaveLength(1);
  expect(open[0]).toMatchObject({ rideId: 'ride-9', status: 'open', startedAtMs: 5000, sessionId: 'sess-1' });
  // The rebuilt meta is saved, so the next read works.
  expect(readRide(dir, 'ride-9').meta.status).toBe('open');
});
test('a ride without meta.json keeps its profile from session.json', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'rec-'));
  fs.mkdirSync(path.join(dir, 'ride-8'));
  fs.writeFileSync(path.join(dir, 'ride-8', 'samples.jsonl'), sampleLine(0, 5000));
  fs.writeFileSync(path.join(dir, 'ride-8', 'session.json'), JSON.stringify({ profileId: 'p1', session: { id: 'sess-1' }, ftpW: 200 }));
  expect(findOpenRides(dir)).toEqual([expect.objectContaining({ rideId: 'ride-8', profileId: 'p1', status: 'open' })]);
});
test('a ride with broken meta.json and no samples is still skipped', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'rec-'));
  fs.mkdirSync(path.join(dir, 'ride-9'));
  fs.writeFileSync(path.join(dir, 'ride-9', 'meta.json'), '');
  expect(findOpenRides(dir)).toEqual([]);
});
test('an old meta.json without formatVersion is read; new rides write formatVersion 1', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'rec-'));
  fs.mkdirSync(path.join(dir, 'old'));
  fs.writeFileSync(path.join(dir, 'old', 'meta.json'), JSON.stringify({ rideId: 'old', profileId: 'p', sessionId: 's', startedAtMs: 1, status: 'open' }));
  expect(findOpenRides(dir).map((m) => m.rideId)).toEqual(['old']);
  RideRecorder.create(dir, { rideId: 'n', profileId: 'p', sessionId: 's', startedAtMs: 1, status: 'open' });
  expect(readRide(dir, 'n').meta.formatVersion).toBe(1);
});

import { RideEngine } from '../../src/service/engine';
import type { Session } from '../../src/shared/session';

const adjSession: Session = { id: 's', name: 'x', steps: [
  { kind: 'erg', durationS: 60, ftpFraction: 0.5, label: 'A' },
  { kind: 'erg', durationS: 600, ftpFraction: 1, label: 'B' },
] };
/** Runs an engine, records its samples and events like the service does, and returns what a crash would leave. */
const rideWith = (steps: (e: RideEngine) => void) => {
  let now = 1_000;
  const e = new RideEngine({ session: adjSession, ftpW: 200, nowMs: () => now });
  const samples: ReturnType<RideEngine['tick']>['sample'][] = [];
  const events: import('../../src/shared/sample').RideEvent[] = [];
  const secs = (n: number) => { for (let i = 0; i < n; i++) { now += 1000; const t = e.tick({ powerW: 100 }); samples.push(t.sample); events.push(...t.events); } };
  const adjust = (d: number) => events.push(e.adjustTarget(d));
  (e as unknown as { secs: typeof secs; adjust: typeof adjust }).secs = secs;
  (e as unknown as { adjust: typeof adjust }).adjust = adjust;
  steps(e);
  return { e, samples, events, now: () => now };
};
const drive = (e: RideEngine) => e as unknown as { secs: (n: number) => void; adjust: (d: number) => void };

test('two +5 adjusts survive a crash: the target is base x 1.10', () => {
  const r = rideWith((e) => { drive(e).secs(70); drive(e).adjust(5); drive(e).adjust(5); drive(e).secs(5); });
  const live = r.e.state().targetW;
  expect(live).toBe(220);
  const point = resumePoint({ samples: r.samples, events: r.events }, adjSession);
  expect(point.adjustPct).toBe(10);
  const back = new RideEngine({ session: adjSession, ftpW: 200, nowMs: r.now, ...point });
  expect(back.state().targetW).toBe(live);
});
test('an adjust from an earlier step is not restored in a later step', () => {
  const r = rideWith((e) => { drive(e).secs(10); drive(e).adjust(5); drive(e).secs(70); });
  const point = resumePoint({ samples: r.samples, events: r.events }, adjSession);
  const back = new RideEngine({ session: adjSession, ftpW: 200, nowMs: r.now, ...point });
  expect(back.state().targetW).toBe(r.e.state().targetW);
  expect(back.state().targetW).toBe(200);
});
test('without a session no adjust is restored (old callers)', () => {
  const r = rideWith((e) => { drive(e).secs(70); drive(e).adjust(5); });
  expect(resumePoint({ samples: r.samples, events: r.events }).adjustPct).toBe(0);
});
test('auto reductions from the logged events are restored', () => {
  const hrSession: Session = { id: 's', name: 'x', steps: [{ kind: 'erg', durationS: 600, ftpFraction: 1, label: 'B' }] };
  let now = 1_000;
  const e = new RideEngine({ session: hrSession, ftpW: 200, nowMs: () => now, maxHrBpm: 150, hrMaxBpm: 190 });
  const samples: ReturnType<RideEngine['tick']>['sample'][] = [];
  const events: import('../../src/shared/sample').RideEvent[] = [];
  for (let i = 0; i < 65; i++) { now += 1000; const t = e.tick({ powerW: 100, hrBpm: 170 }); samples.push(t.sample); events.push(...t.events); }
  expect(events.filter((x) => x.detail?.startsWith('auto:'))).toHaveLength(2);
  const point = resumePoint({ samples, events }, hrSession);
  const back = new RideEngine({ session: hrSession, ftpW: 200, nowMs: () => now, maxHrBpm: 150, hrMaxBpm: 190, ...point });
  expect(back.state().targetW).toBe(e.state().targetW);
  expect(back.state().autoReducedPct).toBe(10);
});
