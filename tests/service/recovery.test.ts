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
  expect(resumePoint(readRide(dir, 'a'))).toEqual({ resumeAtS: 2, startSeq: 2, skippedS: 0 });
});
test('ride without samples resumes at the start', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'rec-'));
  RideRecorder.create(dir, { rideId: 'a', profileId: 'p', sessionId: 's', startedAtMs: 1, status: 'open' });
  expect(resumePoint(readRide(dir, 'a'))).toEqual({ resumeAtS: 0, startSeq: 0, skippedS: 0 });
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
