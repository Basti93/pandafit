import { EventEmitter } from 'node:events';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { RAMP_ID } from '../../src/shared/session';
import { activityName, canUpload, REPO_DESCRIPTION, uploadSettings, withUploadMode } from '../../src/coach/garmin-upload';
import { GarminUploader, type UploadResult } from '../../src/coach/garmin-uploader';
import { externalLoad } from '../../src/coach/readiness';
import type { RideSummary } from '../../src/coach/metrics';
import { loadState, saveState, type CoachState } from '../../src/coach/state';

const summary = (rideId: string, startedAtMs: number, durationS = 1800) => ({ rideId, startedAtMs, durationS }) as RideSummary;
const state = (over: Partial<CoachState> = {}) => ({ summaries: [summary('old', 100), summary('new', 2000)], ...over }) as CoachState;
const auto = (rides = {}) => ({ mode: 'ask' as const, rides });

test('uploading is off until it is switched on', () => {
  expect(uploadSettings(state())).toMatchObject({ mode: 'off', rides: {} });
});
test('an older automatic setting counts as asking, nothing goes up by itself', () => {
  expect(uploadSettings(state({ garminUpload: { mode: 'auto', rides: {} } as never })).mode).toBe('ask');
});
test('changing the mode keeps what is already uploaded', () => {
  const rides = { new: { status: 'uploaded' as const, atMs: 1 } };
  expect(withUploadMode(state({ garminUpload: { mode: 'ask', rides } }), 'off')).toEqual({ mode: 'off', rides });
});
test('the description links the public project', () => {
  expect(REPO_DESCRIPTION).toBe('Gefahren mit Pandafit 🚴 https://github.com/Basti93/pandafit #vibeIt');
});
const named = (over: Partial<RideSummary>) => activityName({ sessionId: 's', intensityFactor: 0.6, ...over } as RideSummary);
test('the name at Garmin is simple and always says indoor cycling', () => {
  expect(named({ intensityFactor: 0.5 })).toBe('Indoor Cycling Locker');
  expect(named({ intensityFactor: 0.62, sessionName: 'Grundlage mit Schnörkeln' })).toBe('Indoor Cycling Grundlage');
  expect(named({ intensityFactor: 0.85 })).toBe('Indoor Cycling Tempo');
  expect(named({ intensityFactor: 0.97 })).toBe('Indoor Cycling Hart');
  expect(named({ intervalsPlanned: 4 })).toBe('Indoor Cycling Intervalle');
  expect(named({ sessionId: RAMP_ID })).toBe('Indoor Cycling Rampentest');
  expect(named({ intensityFactor: null })).toBe('Indoor Cycling');
});
test('the button works in any mode, for known rides that are not up yet', () => {
  expect(canUpload(state(), 'new')).toBe(true);
  expect(canUpload(state(), 'unbekannt')).toBe(false);
  expect(canUpload(state({ garminUpload: auto({ new: { status: 'uploaded', atMs: 1 } }) }), 'new')).toBe(false);
  expect(canUpload(state({ garminUpload: auto({ new: { status: 'uploading', atMs: 1 } }) }), 'new')).toBe(false);
  expect(canUpload(state({ garminUpload: auto({ new: { status: 'failed', atMs: 1 } }) }), 'new')).toBe(true);
});
test('an upload cut off by a restart counts as failed', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'coach-'));
  const s = loadState(dir, 'pa', 200, 1);
  s.garminUpload = auto({ new: { status: 'uploading', atMs: 1 }, done: { status: 'uploaded', atMs: 1 } });
  saveState(dir, s);
  const rides = loadState(dir, 'pa', 200, 1).garminUpload?.rides;
  expect(rides?.new).toMatchObject({ status: 'failed', reason: 'failed' });
  expect(rides?.done.status).toBe('uploaded');
});
test('a ride uploaded to Garmin does not count again as load', () => {
  const activity = { id: 'g', sport: 'cycling', startMs: 86_400_000 * 100, durationS: 1800, trainingLoad: 40, name: null, avgHr: null };
  const ride = { ...summary('r', activity.startMs), status: 'finished' } as RideSummary;
  expect(externalLoad([activity] as never, [ride], activity.startMs + 3600_000)).toEqual([]);
});

describe('uploader', () => {
  const fake = () => {
    const children: (EventEmitter & { stdout: EventEmitter; kill: () => void })[] = [];
    const spawnFn = vi.fn(() => {
      const child = Object.assign(new EventEmitter(), { stdout: new EventEmitter(), kill: vi.fn() });
      children.push(child);
      return child;
    });
    return { children, spawnFn };
  };
  const make = (rideOpen = false) => {
    const f = fake();
    const results: [string, string, UploadResult][] = [];
    const up = new GarminUploader({ python: 'py', script: 's.py', baseDir: '/g', exportsDir: '/x', rideOpen: () => rideOpen, hasTokens: (id) => id !== 'ohne', onResult: (p, r, x) => results.push([p, r, x]), spawnFn: f.spawnFn as never });
    return { ...f, results, up };
  };
  const finish = (c: ReturnType<typeof fake>['children'][number], line: string) => { c.stdout.emit('data', Buffer.from(`${line}\n`)); c.emit('close', 0); };

  test('runs the script with the tokens and file of that ride', () => {
    const { up, spawnFn } = make();
    expect(up.upload('pa', 'ride-1-a', 'Indoor Cycling Locker', 5000)).toBe(true);
    expect(spawnFn).toHaveBeenCalledWith('py', ['s.py', '--tokens', path.join('/g', 'tokens', 'pa'), '--file', path.join('/x', 'ride-1-a.fit'), '--name', 'Indoor Cycling Locker', '--start-ms', '5000'], expect.anything());
  });
  test('passes a description only when there is one', () => {
    const { up, spawnFn } = make();
    up.upload('pa', 'ride-1', 'n', 1, 'Text');
    expect((spawnFn.mock.calls[0] as unknown[])[1]).toEqual(expect.arrayContaining(['--description', 'Text']));
  });
  test('rejects ids that could leave the folder', () => {
    const { up, spawnFn } = make();
    expect(up.upload('pa', '../../etc/passwd', 'n', 1)).toBe(false);
    expect(up.upload('../pa', 'ride-1', 'n', 1)).toBe(false);
    expect(spawnFn).not.toHaveBeenCalled();
  });
  test('does nothing without a Garmin login', () => {
    const { up, spawnFn } = make();
    expect(up.upload('ohne', 'ride-1', 'n', 1)).toBe(false);
    expect(spawnFn).not.toHaveBeenCalled();
  });
  test('does nothing while a ride is open', () => {
    const { up, spawnFn } = make(true);
    expect(up.upload('pa', 'ride-1', 'n', 1)).toBe(false);
    expect(spawnFn).not.toHaveBeenCalled();
  });
  test('one upload per profile at a time', () => {
    const { up, spawnFn, children } = make();
    up.upload('pa', 'ride-1', 'n', 1);
    expect(up.upload('pa', 'ride-2', 'n', 1)).toBe(false);
    expect(up.upload('pb', 'ride-3', 'n', 1)).toBe(true);
    expect(spawnFn).toHaveBeenCalledTimes(2);
    finish(children[0], '{"status":"uploaded"}');
    expect(up.upload('pa', 'ride-2', 'n', 1)).toBe(true);
  });
  test('a duplicate counts as uploaded', () => {
    const { up, children, results } = make();
    up.upload('pa', 'ride-1', 'n', 1);
    finish(children[0], '{"status":"duplicate"}');
    expect(results).toEqual([['pa', 'ride-1', { status: 'uploaded' }]]);
  });
  test('reports the reason of a failure', () => {
    const { up, children, results } = make();
    up.upload('pa', 'ride-1', 'n', 1);
    finish(children[0], '{"status":"failed","reason":"reauth"}');
    expect(results[0][2]).toEqual({ status: 'failed', reason: 'reauth' });
  });
  test('unreadable output or a crash is a failure, reported once', () => {
    const { up, children, results } = make();
    up.upload('pa', 'ride-1', 'n', 1);
    children[0].stdout.emit('data', Buffer.from('Quatsch\n'));
    children[0].emit('error', new Error('weg'));
    children[0].emit('close', 1);
    expect(results).toEqual([['pa', 'ride-1', { status: 'failed', reason: 'failed' }]]);
  });
});
