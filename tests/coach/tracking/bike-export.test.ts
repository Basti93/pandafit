import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { RecordStore } from '../../../src/coach/tracking/store';
import { exportBike } from '../../../src/coach/tracking/bike-export';
import { readBike, readRideBody } from '../../../src/shared/bike';
import type { CoachState } from '../../../src/coach/state';
import type { RideSummary } from '../../../src/coach/metrics';
import type { Sample } from '../../../src/shared/sample';

const NOW = new Date(2026, 10, 4, 12).getTime();
let dir: string;
let store: RecordStore;
beforeEach(() => { dir = fs.mkdtempSync(path.join(os.tmpdir(), 'pf-bike-')); store = new RecordStore({ dir }); });
afterEach(() => fs.rmSync(dir, { recursive: true, force: true }));

const summary = (id: string, avg = 150): RideSummary => ({ rideId: id, startedAtMs: NOW - 86_400_000, status: 'finished', sessionId: 's', ftpW: 200, durationS: 3000, avgPowerW: avg, normalizedPowerW: 160, intensityFactor: 0.6, tss: 40, avgHrBpm: 130, maxHrBpm: 150, bestMinutePowerW: 200, completedFraction: 1, sessionName: 'Grundlage' });
const state = (summaries: RideSummary[]): CoachState => ({
  profileId: 'pa', ftpW: 200, ftpHistory: [{ atMs: NOW - 1000, ftpW: 200, source: 'manual' }], phase: { name: 'Aufbau', weeksLeft: 3, goal: 'x' }, ftpForecast: [],
  next: { session: { id: 'n', name: 'Locker, 45 Min', steps: [{ kind: 'erg', durationS: 2700, ftpFraction: 0.6, label: 'x' }] }, reason: 'weil', source: 'rules' },
  changes: [], notes: [], feedback: {}, summaries, processedRides: [], awaitingFeedback: null, dirty: false, dirtySinceMs: null, lastError: null, lastAttemptMs: null,
});
const samples = (): Sample[] => Array.from({ length: 3000 }, (_, i) => ({ seq: i, wallClockMs: i, rideElapsedS: i + 1, powerW: 150, cadenceRpm: 90, speedKph: 30, hrBpm: 130, targetW: null, gradePct: null, gear: null }));

let st: CoachState;
let reads: string[];
const run = (o: { ride?: boolean; now?: number } = {}) => exportBike({ store, profileIds: ['pa', 'pb'], coachHere: (id) => id === 'pa', noOpenRide: () => !o.ride, nowMs: o.now ?? NOW, state: () => st, samples: (id) => { reads.push(id); return samples(); } });
const rides = () => store.all('pa', 'ride');

describe('the bike and ride records', () => {
  beforeEach(() => { st = state([summary('r1')]); reads = []; });

  it('writes the plan and each ride for the profile coached here only', () => {
    expect(run()).toEqual(['pa']);
    const bike = store.all('pa', 'bike')[0]!;
    expect(readBike(bike.body)!.next!.name).toBe('Locker, 45 Min');
    expect(readBike(bike.body)!.weekHours).toHaveLength(12);
    const r = rides()[0]!;
    expect(r.id).toBe('r1');
    const body = readRideBody(r.body)!;
    expect(body.curve.length).toBeLessThanOrEqual(150);
    expect(body.hardness).toBe('easy');
    expect(store.all('pb', 'bike')).toEqual([]);
  });

  it('writes nothing with a ride open', () => {
    expect(run({ ride: true })).toEqual([]);
    expect(rides()).toEqual([]);
  });

  it('writes only on change and does not reread unchanged rides', () => {
    run();
    reads = [];
    expect(run({ now: NOW + 60_000 })).toEqual([]);
    expect(reads).toEqual([]);
    expect(rides()[0]!.updatedMs).toBe(NOW);
  });

  it('a replaced ride updates its record', () => {
    run();
    st = state([summary('r1', 190)]);
    expect(run({ now: NOW + 60_000 })).toEqual(['pa']);
    expect(readRideBody(rides()[0]!.body)!.avgPowerW).toBe(190);
    expect(reads).toEqual(['r1', 'r1']);
  });

  it('a removed ride is tombstoned', () => {
    run();
    st = state([]);
    run({ now: NOW + 60_000 });
    expect(rides()[0]!.deleted).toBe(true);
  });

  it('a ride whose file cannot be read waits for the next scan', () => {
    const bad = exportBike({ store, profileIds: ['pa'], coachHere: () => true, noOpenRide: () => true, nowMs: NOW, state: () => st, samples: () => { throw new Error('busy'); } });
    expect(rides()).toEqual([]);
    expect(bad).toEqual(['pa']); // the plan was still written
  });
});
