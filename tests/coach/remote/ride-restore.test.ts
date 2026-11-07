import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { expect, test } from 'vitest';
import { CoachHttpError, type CoachHttp } from '../../../src/coach/remote/coach-http';
import { RideRestore } from '../../../src/coach/remote/ride-restore';
import { RideUploads } from '../../../src/coach/remote/ride-upload';
import { listRides, loadRide } from '../../../src/coach/server/ride-store';
import type { RideUpload } from '../../../src/coach/ride-upload-format';

const temp = () => fs.mkdtempSync(path.join(os.tmpdir(), 'rrs-'));

const writeRide = (ridesDir: string, rideId: string, status = 'finished', profileId = 'pa', extra = '') => {
  const d = path.join(ridesDir, rideId);
  fs.mkdirSync(d, { recursive: true });
  fs.writeFileSync(path.join(d, 'meta.json'), JSON.stringify({ rideId, profileId, sessionId: 'ki', startedAtMs: 7, status }));
  fs.writeFileSync(path.join(d, 'session.json'), JSON.stringify({ session: { id: 'ki', name: 'KI', steps: [{ kind: 'erg', durationS: 1500, ftpFraction: 0.65, label: 'Locker' }] }, ftpW: 200 }));
  fs.writeFileSync(path.join(d, 'samples.jsonl'), `${Array.from({ length: 30 }, (_, i) => JSON.stringify({ seq: i, wallClockMs: 1_000_000 + i * 1000, rideElapsedS: i + 1, powerW: 120, cadenceRpm: 90, speedKph: 30, hrBpm: 130, targetW: 120, gradePct: null, gear: null })).join('\n')}\n${extra}`);
};

const setup = () => {
  const root = temp();
  const serverRides = path.join(root, 'server');
  const ridesDir = path.join(root, 'rides');
  const coachDir = path.join(root, 'coach');
  fs.mkdirSync(serverRides, { recursive: true });
  fs.mkdirSync(ridesDir, { recursive: true });
  const w = { gets: [] as string[], open: false, tamper: null as null | ((u: RideUpload) => RideUpload), fail: false };
  const http: CoachHttp = {
    status: async () => ({ profileId: 'pa', moved: true }),
    putRide: async () => { throw new Error('not here'); },
    listRides: async () => { if (w.fail) throw new CoachHttpError('offline'); return listRides(serverRides, 'pa'); },
    getRide: async (id) => {
      w.gets.push(id);
      const u = loadRide(serverRides, id, 'pa');
      if (!u) throw new CoachHttpError('refused', 404);
      return w.tamper ? w.tamper(u) : u;
    },
    begin: async () => { throw new Error('not here'); }, putItem: async () => { throw new Error('not here'); },
    finish: async () => { throw new Error('not here'); }, meals: async () => { throw new Error('not here'); },
  };
  const st = { now: 1_000_000 };
  const uploads = new RideUploads({ ridesDir, dir: coachDir, http: () => http, noOpenRide: () => !w.open, nowMs: () => st.now });
  const restore = new RideRestore({ ridesDir, uploads, http: () => http, noOpenRide: () => !w.open, nowMs: () => st.now });
  return { root, serverRides, ridesDir, w, uploads, restore, st };
};

test('missing rides come back with their FIT, are in the ledger, and are not uploaded again', async () => {
  const t = setup();
  writeRide(t.serverRides, 'ride-1');
  writeRide(t.serverRides, 'ride-2', 'aborted');
  await t.restore.tick('pa');
  for (const id of ['ride-1', 'ride-2']) {
    expect(fs.readFileSync(path.join(t.ridesDir, id, 'meta.json'), 'utf8')).toBe(fs.readFileSync(path.join(t.serverRides, id, 'meta.json'), 'utf8'));
    expect(fs.statSync(path.join(t.ridesDir, 'exports', `${id}.fit`)).size).toBeGreaterThan(0);
  }
  expect(fs.readdirSync(t.ridesDir).sort()).toEqual(['exports', 'ride-1', 'ride-2']);
  expect(t.uploads.closed('pa')).toEqual(['ride-1', 'ride-2']);
  expect(t.uploads.pending('pa')).toEqual([]);
  expect(t.restore.finished('pa')).toBe(true);
  // Once: a second tick asks nothing.
  t.w.gets.length = 0;
  await t.restore.tick('pa');
  expect(t.w.gets).toEqual([]);
});

test('a ride that exists locally is never touched or downloaded, even with other content', async () => {
  const t = setup();
  writeRide(t.serverRides, 'ride-1');
  writeRide(t.ridesDir, 'ride-1', 'finished', 'pa', 'local-only\n');
  const before = fs.readFileSync(path.join(t.ridesDir, 'ride-1', 'samples.jsonl'), 'utf8');
  await t.restore.tick('pa');
  expect(t.w.gets).toEqual([]);
  expect(fs.readFileSync(path.join(t.ridesDir, 'ride-1', 'samples.jsonl'), 'utf8')).toBe(before);
  expect(t.uploads.pending('pa')).toEqual(['ride-1']);
});

test('a download with a wrong hash is rejected: nothing written, not in the ledger, tried again later', async () => {
  const t = setup();
  writeRide(t.serverRides, 'ride-1');
  t.w.tamper = (u) => ({ ...u, files: { ...u.files, 'samples.jsonl': 'tampered\n' } });
  await t.restore.tick('pa');
  expect(fs.readdirSync(t.ridesDir)).toEqual([]);
  expect(t.restore.finished('pa')).toBe(false);
  // A hash the server did not list is rejected as well.
  t.w.tamper = (u) => ({ ...u, sha256: 'f'.repeat(64) });
  await t.restore.tick('pa');
  expect(fs.readdirSync(t.ridesDir)).toEqual([]);
  t.st.now += 61_000;
  t.w.tamper = null;
  await t.restore.tick('pa');
  expect(fs.existsSync(path.join(t.ridesDir, 'ride-1', 'meta.json'))).toBe(true);
  expect(t.restore.finished('pa')).toBe(true);
});

test('a ride of another profile is rejected', async () => {
  const t = setup();
  writeRide(t.serverRides, 'ride-1');
  t.w.tamper = (u) => {
    const files = { ...u.files, 'meta.json': JSON.stringify({ rideId: 'ride-1', profileId: 'pb', status: 'finished' }) };
    return { ...u, files };
  };
  await t.restore.tick('pa');
  expect(fs.existsSync(path.join(t.ridesDir, 'ride-1'))).toBe(false);
});

test('never while a ride is open; stops between rides when one opens', async () => {
  const t = setup();
  writeRide(t.serverRides, 'ride-1');
  writeRide(t.serverRides, 'ride-2');
  t.w.open = true;
  await t.restore.tick('pa');
  expect(t.w.gets).toEqual([]);
  expect(fs.readdirSync(t.ridesDir)).toEqual([]);
  t.w.open = false;
  const get = t.w.tamper;
  t.w.tamper = (u) => { t.w.open = true; return u; };
  await t.restore.tick('pa');
  expect(t.w.gets).toEqual(['ride-1']);
  expect(fs.existsSync(path.join(t.ridesDir, 'ride-1'))).toBe(false);
  expect(get).toBeNull();
  t.w.tamper = null;
  t.w.open = false;
  await t.restore.tick('pa');
  expect(fs.readdirSync(t.ridesDir).sort()).toEqual(['exports', 'ride-1', 'ride-2']);
});

test('an unreachable server is tried again after a minute; reset makes a profile run again', async () => {
  const t = setup();
  writeRide(t.serverRides, 'ride-1');
  t.w.fail = true;
  await t.restore.tick('pa');
  t.w.fail = false;
  t.st.now += 30_000;
  await t.restore.tick('pa');
  expect(fs.existsSync(path.join(t.ridesDir, 'ride-1'))).toBe(false);
  t.st.now += 31_000;
  await t.restore.tick('pa');
  expect(fs.existsSync(path.join(t.ridesDir, 'ride-1'))).toBe(true);
  writeRide(t.serverRides, 'ride-2');
  await t.restore.tick('pa');
  expect(fs.existsSync(path.join(t.ridesDir, 'ride-2'))).toBe(false);
  t.restore.reset('pa');
  await t.restore.tick('pa');
  expect(fs.existsSync(path.join(t.ridesDir, 'ride-2'))).toBe(true);
});
