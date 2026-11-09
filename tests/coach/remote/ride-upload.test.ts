import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { expect, test } from 'vitest';
import { CoachHttpError, type CoachHttp } from '../../../src/coach/remote/coach-http';
import { RideUploads } from '../../../src/coach/remote/ride-upload';
import type { RideUpload } from '../../../src/coach/ride-upload-format';

const temp = () => fs.mkdtempSync(path.join(os.tmpdir(), 'rup-'));

const writeRide = (ridesDir: string, rideId: string, status: string, profileId = 'pa') => {
  const d = path.join(ridesDir, rideId);
  fs.mkdirSync(d, { recursive: true });
  fs.writeFileSync(path.join(d, 'meta.json'), JSON.stringify({ rideId, profileId, sessionId: 'ki', startedAtMs: 1, status }));
  fs.writeFileSync(path.join(d, 'session.json'), JSON.stringify({ session: { id: 'ki', name: 'KI', steps: [] }, ftpW: 200 }));
  fs.writeFileSync(path.join(d, 'samples.jsonl'), `${JSON.stringify({ seq: 0, wallClockMs: 1, rideElapsedS: 1, powerW: 120 })}\n`);
};

/** Every file under a folder with its bytes. */
const snapshot = (dir: string): Record<string, string> => {
  const out: Record<string, string> = {};
  const walk = (d: string, rel: string) => {
    for (const n of fs.readdirSync(d).sort()) {
      const p = path.join(d, n);
      if (fs.statSync(p).isDirectory()) walk(p, `${rel}${n}/`); else out[`${rel}${n}`] = fs.readFileSync(p).toString('base64');
    }
  };
  walk(dir, '');
  return out;
};

/** A server that takes rides into memory; `fail` makes the next requests fail as an unreachable server. */
const fakeServer = () => {
  const w = { got: [] as RideUpload[], fail: false, onPut: null as null | ((u: RideUpload) => void) };
  const http: CoachHttp = {
    status: async () => ({ profileId: 'pa', moved: true }),
    listRides: async () => { throw new Error('not here'); },
    getRide: async () => { throw new Error('not here'); },
    putRide: async (u) => {
      if (w.fail) throw new CoachHttpError('offline');
      w.got.push(u);
      w.onPut?.(u);
      return { sha256: u.sha256, same: false };
    },
    begin: async () => { throw new Error('not here'); },
    putItem: async () => { throw new Error('not here'); },
    finish: async () => { throw new Error('not here'); },
    meals: async () => { throw new Error('not here'); },
  };
  return { w, http };
};

const setup = () => {
  const root = temp();
  const ridesDir = path.join(root, 'rides');
  const coachDir = path.join(root, 'coach');
  fs.mkdirSync(ridesDir, { recursive: true });
  const s = fakeServer();
  const st = { open: false, now: 1_000_000 };
  const uploads = new RideUploads({ ridesDir, dir: coachDir, http: () => s.http, noOpenRide: () => !st.open, nowMs: () => st.now });
  return { root, ridesDir, coachDir, uploads, st, ...s };
};

test('an open ride is never uploaded; a discarded one neither', async () => {
  const t = setup();
  writeRide(t.ridesDir, 'ride-1', 'open');
  writeRide(t.ridesDir, 'ride-2', 'discarded');
  writeRide(t.ridesDir, 'ride-3', 'finished', 'pb');
  expect(t.uploads.pending('pa')).toEqual([]);
  await t.uploads.tick('pa');
  expect(t.w.got).toEqual([]);
});

test('a closed ride uploads once, the ledger keeps it, and the local files stay byte for byte', async () => {
  const t = setup();
  writeRide(t.ridesDir, 'ride-1', 'finished');
  writeRide(t.ridesDir, 'ride-2', 'aborted');
  fs.mkdirSync(path.join(t.ridesDir, 'exports'));
  fs.writeFileSync(path.join(t.ridesDir, 'exports', 'ride-1.fit'), Buffer.from('not really a fit file'));
  const before = snapshot(t.ridesDir);
  expect(t.uploads.pending('pa')).toEqual(['ride-1', 'ride-2']);
  await t.uploads.tick('pa');
  expect(t.w.got.map((u) => u.rideId)).toEqual(['ride-1', 'ride-2']);
  expect(t.w.got[0]!.fit).toBe(Buffer.from('not really a fit file').toString('base64'));
  expect(t.uploads.pending('pa')).toEqual([]);
  const ledger = JSON.parse(fs.readFileSync(path.join(t.coachDir, 'remote', 'pa', 'rides.json'), 'utf8'));
  expect(Object.keys(ledger)).toEqual(['ride-1', 'ride-2']);
  // Again, and with a new uploads object: the ledger holds.
  t.st.now += 10 * 60_000;
  await t.uploads.tick('pa');
  await new RideUploads({ ridesDir: t.ridesDir, dir: t.coachDir, http: () => t.http, noOpenRide: () => true }).tick('pa');
  expect(t.w.got).toHaveLength(2);
  expect(snapshot(t.ridesDir)).toEqual(before);
});

test('a failed upload retries on a later run', async () => {
  const t = setup();
  writeRide(t.ridesDir, 'ride-1', 'finished');
  t.w.fail = true;
  await t.uploads.tick('pa');
  expect(t.uploads.pending('pa')).toEqual(['ride-1']);
  t.w.fail = false;
  // Within the minute after a failure nothing is tried.
  t.st.now += 30_000;
  await t.uploads.tick('pa');
  expect(t.w.got).toEqual([]);
  t.st.now += 31_000;
  await t.uploads.tick('pa');
  expect(t.w.got.map((u) => u.rideId)).toEqual(['ride-1']);
  expect(t.uploads.pending('pa')).toEqual([]);
});

test('a ride that opens mid-list stops the uploads before the next request', async () => {
  const t = setup();
  for (const id of ['ride-1', 'ride-2', 'ride-3']) writeRide(t.ridesDir, id, 'finished');
  // The first request is on its way when a ride starts.
  t.w.onPut = () => { t.st.open = true; };
  await t.uploads.tick('pa');
  expect(t.w.got.map((u) => u.rideId)).toEqual(['ride-1']);
  expect(t.uploads.pending('pa')).toEqual(['ride-2', 'ride-3']);
  // Nothing at all while it is open.
  t.w.onPut = null;
  await t.uploads.tick('pa');
  expect(t.w.got).toHaveLength(1);
  t.st.open = false;
  await t.uploads.tick('pa');
  expect(t.w.got.map((u) => u.rideId)).toEqual(['ride-1', 'ride-2', 'ride-3']);
});

// ---- Fix round 1 ----

test('a ride over the size limit is not sent, waits longer each time up to six hours, and does not hold up the others', async () => {
  const root = temp();
  const ridesDir = path.join(root, 'rides');
  const coachDir = path.join(root, 'coach');
  fs.mkdirSync(ridesDir, { recursive: true });
  writeRide(ridesDir, 'ride-1', 'finished');
  writeRide(ridesDir, 'ride-2', 'finished');
  // ride-1 is far larger than the others.
  fs.appendFileSync(path.join(ridesDir, 'ride-1', 'samples.jsonl'), 'x'.repeat(4000) + '\n');
  const s = fakeServer();
  const st = { now: 1_000_000 };
  const uploads = new RideUploads({ ridesDir, dir: coachDir, http: () => s.http, noOpenRide: () => true, nowMs: () => st.now, maxBytes: 2000 });
  await uploads.tick('pa');
  expect(s.w.got.map((u) => u.rideId)).toEqual(['ride-2']);
  expect(uploads.refused('pa')).toEqual([{ rideId: 'ride-1', reason: 'too-large', tries: 1 }]);
  // Waits 1 min, then 2, 4 ... and never more than six hours.
  const waits: number[] = [];
  let last = st.now;
  for (let i = 0; i < 12; i++) {
    const tries = uploads.refused('pa')[0]!.tries;
    while (uploads.refused('pa')[0]!.tries === tries) { st.now += 60_000; await uploads.tick('pa'); }
    waits.push(st.now - last);
    last = st.now;
  }
  expect(waits.slice(0, 4)).toEqual([60_000, 120_000, 240_000, 480_000]);
  expect(Math.max(...waits)).toBe(6 * 3_600_000);
  expect(s.w.got.map((u) => u.rideId)).toEqual(['ride-2']);
  // Kept across a restart.
  const again = new RideUploads({ ridesDir, dir: coachDir, http: () => s.http, noOpenRide: () => true, nowMs: () => st.now, maxBytes: 2000 });
  expect(again.refused('pa')[0]!.reason).toBe('too-large');
});

test('a ride the server refuses as too large (413) is put on the same long wait', async () => {
  const t = setup();
  writeRide(t.ridesDir, 'ride-1', 'finished');
  t.http.putRide = async () => { throw new CoachHttpError('refused', 413, 'too-large'); };
  await t.uploads.tick('pa');
  expect(t.uploads.refused('pa')).toEqual([{ rideId: 'ride-1', reason: 'too-large', tries: 1 }]);
});

test('an upload stopped by a ride opening is no failure: it goes on right after the ride', async () => {
  const t = setup();
  writeRide(t.ridesDir, 'ride-1', 'finished');
  let stop = true;
  const put = t.http.putRide;
  t.http.putRide = async (u) => { if (stop) throw new CoachHttpError('stopped'); return put(u); };
  await t.uploads.tick('pa');
  stop = false;
  // No minute's wait as after a failure.
  t.st.now += 1000;
  await t.uploads.tick('pa');
  expect(t.w.got.map((u) => u.rideId)).toEqual(['ride-1']);
  expect(t.uploads.refused('pa')).toEqual([]);
});
