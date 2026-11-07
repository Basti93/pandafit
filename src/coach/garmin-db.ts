import fs from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import { RUN_TYPES, type RunType } from '../shared/run';
import { ruleValues } from '../shared/training-policy';
import type { GarminActivity, GarminBody, GarminDay, GarminProgress } from '../shared/garmin';

const DAY_MS = 86_400_000;
const MAX_PLAUSIBLE_HR = 240;
// Pandafit writes its FIT files with the manufacturer "development".
const OWN_MANUFACTURER = /^development$/i;

type Raw = Record<string, unknown>;
const obj = (v: unknown): Raw => (v && typeof v === 'object' && !Array.isArray(v) ? v as Raw : {});
const first = (v: unknown): Raw => (Array.isArray(v) ? obj(v[0]) : obj(v));
const num = (v: unknown): number | null => (typeof v === 'number' && Number.isFinite(v) ? v : null);
const positive = (v: unknown): number | null => { const n = num(v); return n !== null && n > 0 ? n : null; };
const notNegative = (v: unknown): number | null => { const n = num(v); return n !== null && n >= 0 ? n : null; };
const text = (v: unknown): string | null => (typeof v === 'string' && v !== '' ? v : null);

const intensityMinutes = (stats: Raw): number | null => {
  const moderate = notNegative(stats.moderateIntensityMinutes), vigorous = notNegative(stats.vigorousIntensityMinutes);
  return moderate === null && vigorous === null ? null : (moderate ?? 0) + ruleValues('health.activity-minutes').vigorousFactor! * (vigorous ?? 0);
};

const toDay = (date: string, r: Record<string, unknown>): GarminDay => {
  const stats = obj(r.stats);
  const sleep = obj(obj(r.sleep).dailySleepDTO);
  const readiness = first(r.training_readiness);
  return {
    date,
    restingHrBpm: positive(stats.restingHeartRate),
    hrvMs: positive(obj(obj(r.hrv).hrvSummary).lastNightAvg),
    sleepS: positive(sleep.sleepTimeSeconds),
    deepS: notNegative(sleep.deepSleepSeconds),
    remS: notNegative(sleep.remSleepSeconds),
    sleepScore: num(obj(obj(sleep.sleepScores).overall).value),
    bodyBatteryMax: notNegative(stats.bodyBatteryHighestValue),
    stressAvg: notNegative(stats.averageStressLevel),
    vo2max: positive(obj(first(r.max_metrics).generic).vo2MaxPreciseValue),
    steps: notNegative(stats.totalSteps),
    readinessScore: notNegative(readiness.score),
    acuteLoad: notNegative(readiness.acuteLoad),
    recoveryHours: notNegative(readiness.recoveryTime),
    intensityMin: intensityMinutes(stats),
  };
};

const toActivity = (id: string, sport: string, a: Raw): GarminActivity => ({
  id, sport,
  startMs: num(a.beginTimestamp) ?? 0,
  name: text(a.activityName),
  durationS: num(a.duration) ?? 0,
  distanceM: positive(a.distance),
  avgHr: positive(a.averageHR),
  maxHr: positive(a.maxHR),
  avgPowerW: positive(a.avgPower),
  normPowerW: positive(a.normPower),
  trainingLoad: notNegative(a.activityTrainingLoad),
  aerobicEffect: notNegative(a.aerobicTrainingEffect),
  fromBikeCoach: OWN_MANUFACTURER.test(text(a.manufacturer) ?? ''),
});

export type GarminRun = {
  id: string; type: RunType; startMs: number; durationS: number; distanceM: number | null;
  avgHr: number | null; maxHr: number | null; elevationGainM: number | null;
};

const gmt = (ms: number): string => new Date(ms).toISOString().slice(0, 19).replace('T', ' ');

/** Reads the standalone Garmin database, never writes to it and derives everything from the raw data. */
export class GarminDb {
  constructor(private file: string) {}

  private read<T>(empty: T, fn: (db: DatabaseSync) => T): T {
    if (!fs.existsSync(this.file)) return empty;
    let db: DatabaseSync | undefined;
    try {
      db = new DatabaseSync(this.file, { readOnly: true });
      return fn(db);
    } catch {
      return empty;
    } finally {
      db?.close();
    }
  }

  days(fromDate: string): GarminDay[] {
    return this.read<GarminDay[]>([], (db) => {
      const rows = db.prepare('SELECT date, endpoint, json FROM daily WHERE date >= ? ORDER BY date').all(fromDate) as { date: string; endpoint: string; json: string }[];
      const byDate = new Map<string, Record<string, unknown>>();
      for (const row of rows) {
        const day = byDate.get(row.date) ?? {};
        day[row.endpoint] = JSON.parse(row.json);
        byDate.set(row.date, day);
      }
      return [...byDate].map(([date, raw]) => toDay(date, raw));
    });
  }

  activities(fromMs: number): GarminActivity[] {
    return this.read<GarminActivity[]>([], (db) => {
      const rows = db.prepare('SELECT activity_id, sport, json FROM activities WHERE start_time >= ? ORDER BY start_time').all(gmt(fromMs)) as { activity_id: string; sport: string | null; json: string }[];
      return rows.map((r) => toActivity(r.activity_id, r.sport ?? 'other', obj(JSON.parse(r.json))));
    });
  }

  runs(fromMs: number): GarminRun[] {
    return this.read<GarminRun[]>([], (db) => {
      const marks = RUN_TYPES.map(() => '?').join(',');
      const rows = db.prepare(`SELECT activity_id, start_time, sport, json FROM activities WHERE start_time >= ? AND sport IN (${marks}) ORDER BY start_time`).all(gmt(fromMs), ...RUN_TYPES) as { activity_id: string; start_time: string; sport: RunType; json: string }[];
      const out: GarminRun[] = [];
      for (const r of rows) {
        try {
          const a = obj(JSON.parse(r.json));
          out.push({
            id: r.activity_id, type: r.sport,
            startMs: num(a.beginTimestamp) ?? Date.parse(`${r.start_time.replace(' ', 'T')}Z`),
            durationS: num(a.duration) ?? 0,
            distanceM: positive(a.distance),
            avgHr: positive(a.averageHR),
            maxHr: positive(a.maxHR),
            elevationGainM: notNegative(a.elevationGain),
          });
        } catch { /* one broken row must not hide the other runs */ }
      }
      return out;
    });
  }

  activityFile(id: string): Uint8Array | null {
    return this.read<Uint8Array | null>(null, (db) => {
      const row = db.prepare('SELECT data FROM activity_files WHERE activity_id = ?').get(id) as { data: Uint8Array | null } | undefined;
      return row?.data && row.data.length > 0 ? row.data : null;
    });
  }

  body(): GarminBody | null {
    return this.read<GarminBody | null>(null, (db) => {
      const single = (name: string): Raw => {
        const row = db.prepare('SELECT json FROM singletons WHERE name = ?').get(name) as { json: string } | undefined;
        return row ? obj(JSON.parse(row.json)) : {};
      };
      const user = obj(single('profile').userData);
      const ftp = single('ftp');
      const gender = text(user.gender)?.toLowerCase();
      const grams = positive(user.weight);
      const seen = db.prepare("SELECT MAX(json_extract(json, '$.maxHR')) AS m FROM activities WHERE json_extract(json, '$.maxHR') <= ?").get(MAX_PLAUSIBLE_HR) as { m: number | null };
      return {
        birthDate: text(user.birthDate),
        sex: gender === 'male' || gender === 'female' ? gender : 'unknown',
        heightCm: positive(user.height),
        weightKg: grams === null ? null : grams / 1000,
        ftpW: positive(ftp.functionalThresholdPower),
        ftpStale: ftp.isStale === true,
        maxHrSeen: seen.m,
      };
    });
  }

  progress(today: string): GarminProgress {
    const empty: GarminProgress = { activities: 0, activitiesComplete: false, daysDone: 0, daysTotal: 0, filesDone: 0, filesTotal: 0 };
    return this.read(empty, (db) => {
      const count = (sql: string): number => (db.prepare(sql).get() as { c: number }).c;
      const activities = count('SELECT COUNT(*) AS c FROM activities');
      const complete = db.prepare("SELECT complete FROM sync_state WHERE stream = 'activities'").get() as { complete: number } | undefined;
      const oldest = (db.prepare('SELECT MIN(d) AS d FROM (SELECT MIN(date) AS d FROM daily UNION SELECT MIN(substr(start_time, 1, 10)) FROM activities)').get() as { d: string | null }).d;
      return {
        activities,
        activitiesComplete: complete?.complete === 1,
        daysDone: count('SELECT COUNT(DISTINCT date) AS c FROM daily'),
        daysTotal: oldest ? Math.round((Date.parse(today) - Date.parse(oldest)) / DAY_MS) + 1 : 0,
        filesDone: count('SELECT COUNT(*) AS c FROM activity_files'),
        filesTotal: activities,
      };
    });
  }
}
