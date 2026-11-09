import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { RideRecorder } from '../../src/service/recorder';
import { readRide, type RideMeta } from '../../src/ride-format/read';
import type { Sample } from '../../src/shared/sample';

const meta: RideMeta = { rideId: 'r1', profileId: 'p', sessionId: 's', startedAtMs: 1, status: 'open' };
const sample = (seq: number): Sample => ({ seq, wallClockMs: seq, rideElapsedS: seq, powerW: 100, cadenceRpm: 80, speedKph: 30, hrBpm: null, targetW: 100, gradePct: null, gear: null });
let dir: string;
beforeEach(() => { dir = fs.mkdtempSync(path.join(os.tmpdir(), 'rec-')); });

test('every append is on disk immediately', () => {
  const rec = RideRecorder.create(dir, meta);
  rec.append(sample(0));
  expect(readRide(dir, 'r1').samples).toEqual([sample(0)]);
});
test('truncated last line is ignored on read', () => {
  const rec = RideRecorder.create(dir, meta);
  rec.append(sample(0));
  fs.appendFileSync(path.join(dir, 'r1', 'samples.jsonl'), '{"seq":1,"wall');
  expect(readRide(dir, 'r1').samples).toHaveLength(1);
});
test('open() continues cleanly after truncation', () => {
  const rec = RideRecorder.create(dir, meta);
  rec.append(sample(0));
  fs.appendFileSync(path.join(dir, 'r1', 'samples.jsonl'), '{"seq":1,"wall');
  RideRecorder.open(dir, 'r1').append(sample(1));
  expect(readRide(dir, 'r1').samples.map((s) => s.seq)).toEqual([0, 1]);
});
test('meta write is atomic', () => {
  RideRecorder.create(dir, meta);
  fs.writeFileSync(path.join(dir, 'r1', 'meta.json.tmp'), '{broken');
  expect(readRide(dir, 'r1').meta.status).toBe('open');
});
test('finish updates status', () => {
  RideRecorder.create(dir, meta).finish('aborted');
  expect(readRide(dir, 'r1').meta.status).toBe('aborted');
});
test('write failure buffers and retries without throwing', () => {
  let failing = true;
  const flaky = { ...fs, writeSync: (fd: number, data: string) => {
    if (failing) throw Object.assign(new Error('full'), { code: 'ENOSPC' });
    return fs.writeSync(fd, data);
  } } as unknown as typeof fs;
  const rec = RideRecorder.create(dir, meta, flaky);
  rec.append(sample(0));
  rec.append(sample(1));
  expect(rec.hasStorageError()).toBe(true);
  failing = false;
  rec.append(sample(2));
  expect(rec.hasStorageError()).toBe(false);
  expect(readRide(dir, 'r1').samples.map((s) => s.seq)).toEqual([0, 1, 2]);
});
const flakyFs = (state: { failing: boolean }) => ({ ...fs,
  writeSync: (fd: number, data: string) => { if (state.failing) throw Object.assign(new Error('full'), { code: 'ENOSPC' }); return fs.writeSync(fd, data); },
  writeFileSync: (f: string, data: string) => { if (state.failing) throw Object.assign(new Error('full'), { code: 'ENOSPC' }); return fs.writeFileSync(f, data); },
}) as unknown as typeof fs;
test('finish keeps buffered samples and stays open while writes fail', () => {
  const state = { failing: false };
  const rec = RideRecorder.create(dir, meta, flakyFs(state));
  rec.append(sample(0));
  state.failing = true;
  rec.append(sample(1));
  expect(rec.finish('finished')).toBe(false);
  expect(readRide(dir, 'r1').meta.status).toBe('open');
  state.failing = false;
  expect(rec.finish('finished')).toBe(true);
  const r = readRide(dir, 'r1');
  expect(r.meta.status).toBe('finished');
  expect(r.samples.map((s) => s.seq)).toEqual([0, 1]);
});
