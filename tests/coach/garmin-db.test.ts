import fs from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import os from 'node:os';
import path from 'node:path';
import { GarminDb } from '../../src/coach/garmin-db';

const make = () => {
  const file = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'gdb-')), 'garmin.db');
  const db = new DatabaseSync(file);
  db.exec(`CREATE TABLE daily (date TEXT, endpoint TEXT, json TEXT, fetched_at TEXT, PRIMARY KEY (date, endpoint));
    CREATE TABLE activities (activity_id TEXT PRIMARY KEY, start_time TEXT, sport TEXT, json TEXT, fetched_at TEXT);
    CREATE TABLE activity_files (activity_id TEXT PRIMARY KEY, format TEXT, data BLOB, fetched_at TEXT);
    CREATE TABLE singletons (name TEXT PRIMARY KEY, json TEXT, fetched_at TEXT);
    CREATE TABLE sync_state (stream TEXT PRIMARY KEY, cursor TEXT, complete INTEGER, updated_at TEXT);`);
  const day = (date: string, endpoint: string, v: unknown) => db.prepare('INSERT INTO daily VALUES (?,?,?,?)').run(date, endpoint, JSON.stringify(v), 't');
  const act = (a: { activityId: number; startTimeGMT: string; activityType: { typeKey: string }; [k: string]: unknown }) =>
    db.prepare('INSERT INTO activities VALUES (?,?,?,?,?)').run(String(a.activityId), a.startTimeGMT, a.activityType.typeKey, JSON.stringify(a), 't');
  const single = (name: string, v: unknown) => db.prepare('INSERT INTO singletons VALUES (?,?,?)').run(name, JSON.stringify(v), 't');
  return { file, db, day, act, single };
};

test('a full day has all values from their real places', () => {
  const { file, day } = make();
  day('2026-11-01', 'stats', { restingHeartRate: 60, averageStressLevel: 29, bodyBatteryHighestValue: 92, totalSteps: 5664, moderateIntensityMinutes: 30, vigorousIntensityMinutes: 10 });
  day('2026-11-01', 'sleep', { dailySleepDTO: { sleepTimeSeconds: 25200, deepSleepSeconds: 3600, remSleepSeconds: 5400, sleepScores: { overall: { value: 81 } } } });
  day('2026-11-01', 'hrv', { hrvSummary: { lastNightAvg: 55 } });
  day('2026-11-01', 'max_metrics', [{ generic: { vo2MaxPreciseValue: 51.4 }, cycling: null }]);
  day('2026-11-01', 'training_readiness', [{ score: 94, level: 'HIGH', acuteLoad: 35, recoveryTime: 1 }]);
  expect(new GarminDb(file).days('2026-01-01')).toEqual([{
    date: '2026-11-01', restingHrBpm: 60, hrvMs: 55, sleepS: 25200, deepS: 3600, remS: 5400, sleepScore: 81, bodyBatteryMax: 92, stressAvg: 29,
    vo2max: 51.4, steps: 5664, readinessScore: 94, acuteLoad: 35, recoveryHours: 1, intensityMin: 50,
  }]);
});
test.each([[{}], [[]], [null]])('an empty answer gives nulls and never throws: %j', (empty) => {
  const { file, day } = make();
  for (const e of ['stats', 'sleep', 'hrv', 'max_metrics', 'training_readiness']) day('2026-11-01', e, empty);
  const [d] = new GarminDb(file).days('2026-01-01');
  expect(Object.entries(d).filter(([k]) => k !== 'date').every(([, v]) => v === null)).toBe(true);
});
test('intensity minutes count vigorous double, a missing half counts as zero and none stays unknown', () => {
  const { file, day } = make();
  day('2026-11-01', 'stats', { moderateIntensityMinutes: 20 });
  day('2026-11-02', 'stats', { vigorousIntensityMinutes: 15 });
  day('2026-11-03', 'stats', { totalSteps: 100 });
  expect(new GarminDb(file).days('2026-01-01').map((d) => d.intensityMin)).toEqual([20, 30, null]);
});
test('sleep of zero or missing counts as no sleep data, and a stress of -1 as none', () => {
  const { file, day } = make();
  day('2026-11-01', 'sleep', { dailySleepDTO: { sleepTimeSeconds: 0, deepSleepSeconds: null } });
  day('2026-11-01', 'stats', { averageStressLevel: -1 });
  const [d] = new GarminDb(file).days('2026-01-01');
  expect(d.sleepS).toBeNull();
  expect(d.stressAvg).toBeNull();
});
test('days start at the given date and come in order', () => {
  const { file, day } = make();
  for (const date of ['2026-10-02', '2026-10-01', '2026-09-30']) day(date, 'stats', {});
  expect(new GarminDb(file).days('2026-10-01').map((d) => d.date)).toEqual(['2026-10-01', '2026-10-02']);
});
test('activities are normalized and filtered by time', () => {
  const { file, act } = make();
  act({ activityId: 1, startTimeGMT: '2019-04-15 17:58:23', beginTimestamp: 1555351103000, activityType: { typeKey: 'cycling' }, duration: 100 });
  act({ activityId: 2, startTimeGMT: '2026-10-28 17:29:48', beginTimestamp: 1793208588000, activityType: { typeKey: 'virtual_ride' }, activityName: 'ROUVY', duration: 3199.9, distance: 22430, averageHR: 145, maxHR: 171, avgPower: 119, normPower: 136, activityTrainingLoad: 82.5, aerobicTrainingEffect: 3.2, manufacturer: 'VIRTUALTRAINING' });
  const g = new GarminDb(file);
  expect(g.activities(0)).toHaveLength(2);
  expect(g.activities(1793000000000)).toEqual([{
    id: '2', startMs: 1793208588000, sport: 'virtual_ride', name: 'ROUVY', durationS: 3199.9, distanceM: 22430, avgHr: 145, maxHr: 171,
    avgPowerW: 119, normPowerW: 136, trainingLoad: 82.5, aerobicEffect: 3.2, fromBikeCoach: false,
  }]);
});
test('an activity without power or heart rate has nulls, and our own uploads are marked', () => {
  const { file, act } = make();
  act({ activityId: 3, startTimeGMT: '2026-01-01 08:00:00', beginTimestamp: 1, activityType: { typeKey: 'hiking' }, duration: 10, manufacturer: 'DEVELOPMENT' });
  const [a] = new GarminDb(file).activities(0);
  expect(a.avgPowerW).toBeNull();
  expect(a.avgHr).toBeNull();
  expect(a.fromBikeCoach).toBe(true);
});
test('body values use grams and stale FTP as Garmin delivers them', () => {
  const { file, single, act } = make();
  single('profile', { userData: { gender: 'MALE', weight: 72000, height: 178, birthDate: '1990-01-15' } });
  single('ftp', { functionalThresholdPower: 183, isStale: true });
  act({ activityId: 1, startTimeGMT: '2026-01-01 08:00:00', beginTimestamp: 1, activityType: { typeKey: 'running' }, maxHR: 190 });
  act({ activityId: 2, startTimeGMT: '2026-01-02 08:00:00', beginTimestamp: 2, activityType: { typeKey: 'running' }, maxHR: 300 });
  expect(new GarminDb(file).body()).toEqual({ birthDate: '1990-01-15', sex: 'male', heightCm: 178, weightKg: 72, ftpW: 183, ftpStale: true, maxHrSeen: 190 });
});
test('an unknown gender becomes unknown', () => {
  const { file, single } = make();
  single('profile', { userData: { gender: 'X' } });
  expect(new GarminDb(file).body()?.sex).toBe('unknown');
});
test('progress counts what is there and what is expected', () => {
  const { file, db, day, act } = make();
  day('2026-10-31', 'stats', {}); day('2026-10-31', 'sleep', {}); day('2026-11-01', 'stats', {});
  act({ activityId: 1, startTimeGMT: '2026-10-30 08:00:00', beginTimestamp: 1, activityType: { typeKey: 'running' } });
  db.prepare("INSERT INTO sync_state VALUES ('activities','1',1,'t')").run();
  expect(new GarminDb(file).progress('2026-11-01')).toEqual({ activities: 1, activitiesComplete: true, daysDone: 2, daysTotal: 3, filesDone: 0, filesTotal: 1 });
});
test('a missing database gives empty results', () => {
  const g = new GarminDb(path.join(os.tmpdir(), 'gibt-es-nicht', 'garmin.db'));
  expect(g.days('2020-01-01')).toEqual([]);
  expect(g.activities(0)).toEqual([]);
  expect(g.body()).toBeNull();
  expect(g.progress('2026-11-01')).toEqual({ activities: 0, activitiesComplete: false, daysDone: 0, daysTotal: 0, filesDone: 0, filesTotal: 0 });
});
test('it never writes to the database', () => {
  const { file, day } = make();
  day('2026-11-01', 'stats', {});
  fs.chmodSync(file, 0o400);
  expect(new GarminDb(file).days('2026-01-01')).toHaveLength(1);
});

test('runs: a row with broken JSON is skipped, and a missing beginTimestamp falls back to start_time', () => {
  const { file, db, act } = make();
  act({ activityId: 1, startTimeGMT: '2026-01-10 08:00:00', activityType: { typeKey: 'running' }, duration: 10 });
  db.prepare('INSERT INTO activities VALUES (?,?,?,?,?)').run('2', '2026-01-11 08:00:00', 'running', '{broken', 't');
  act({ activityId: 3, startTimeGMT: '2026-01-12 08:00:00', beginTimestamp: 5, activityType: { typeKey: 'running' }, duration: 10 });
  expect(new GarminDb(file).runs(0).map((r) => [r.id, r.startMs])).toEqual([['1', Date.UTC(2026, 0, 10, 8)], ['3', 5]]);
});
