import type { DayHardness } from './day-rating';
import type { Session, Step } from './session';
import { stepFtpFraction } from './session';

/**
 * What the coach that rides with a profile publishes for the web: the plan (`bike`, one per profile) and every counted ride
 * (`ride`, id = ride id). Read-only for the web, never written back.
 */
export const BIKE_ID = 'bike';
export const MAX_CURVE_POINTS = 150;
/** The most the web reads of one record (bytes of its JSON). */
export const MAX_BIKE_BODY = 64 * 1024;

export type BikeBlock = { label: string; minutes: number; pct?: number };
export type BikeNext = { name: string; reason: string; minutes: number; hardness: DayHardness; blocks: BikeBlock[] };
export type BikeAlternative = { name: string; minutes: number; why: string };
export type BikeBody = {
  type: 'bike'; atMs: number; ftpW: number;
  ftpHistory: { atMs: number; ftpW: number; source: string }[];
  phase: { name: string; weeksLeft: number; goal: string } | null;
  next: BikeNext | null; alternatives: BikeAlternative[];
  weekHours: { week: string; hours: number }[];
};
export type CurvePoint = { t: number; powerW: number | null; hrBpm: number | null };
export type RideBody = {
  type: 'ride'; startedAtMs: number; sessionName?: string; durationS: number; hardness: DayHardness;
  avgPowerW: number | null; normalizedPowerW: number | null; avgHrBpm: number | null; maxHrBpm: number | null;
  tss: number; completedFraction: number; feedback?: string; debrief?: string; curve: CurvePoint[];
};

// ---- Block merging ----

type Atom = { minutes: number; pct: number };
const LOOSE_PCT = 65;
const MAX_BLOCKS = 20;
const round5 = (x: number): number => Math.round(x / 5) * 5;
const minutesOf = (durationS: number): number => Math.max(1, Math.round(durationS / 60));
const same = (a: Atom, b: Atom): boolean => a.pct === b.pct;

/** The wording of one stretch: easy ones just "locker". */
const stretch = (a: Atom): string => `${a.minutes} Min ${a.pct <= LOOSE_PCT ? 'locker' : `bei ${a.pct} %`}`;

/**
 * Steps of a session as readable blocks: neighbours at the same level merge, and a work/rest pair that repeats becomes
 * "3 × 8 Min bei 95 %, dazwischen 4 Min locker". Climbs and ramps count by the power they are ridden at.
 */
export function mergeBlocks(steps: readonly Step[]): BikeBlock[] {
  const atoms: Atom[] = [];
  for (const s of steps) {
    const a = { minutes: s.durationS / 60, pct: round5(stepFtpFraction(s) * 100) };
    const last = atoms.at(-1);
    if (last && same(last, a)) last.minutes += a.minutes;
    else atoms.push(a);
  }
  const rounded = atoms.map((a) => ({ ...a, minutes: minutesOf(a.minutes * 60) }));
  const out: BikeBlock[] = [];
  for (let i = 0; i < rounded.length; ) {
    const work = rounded[i]!, rest = rounded[i + 1];
    const eq = (x: Atom | undefined, y: Atom): boolean => !!x && x.pct === y.pct && x.minutes === y.minutes;
    let n = 1;
    if (rest && rest.pct < work.pct) {
      // Full pairs first; the last work part may stand without a rest after it.
      while (eq(rounded[i + 2 * n], work)) { n++; if (!eq(rounded[i + 2 * n - 1], rest)) break; }
    }
    if (n >= 2) {
      const hasRest = eq(rounded[i + 2 * n - 1], rest!);
      const used = hasRest ? 2 * n : 2 * n - 1;
      const total = rounded.slice(i, i + used).reduce((a, b) => a + b.minutes, 0);
      out.push({ label: `${n} × ${work.minutes} Min bei ${work.pct} %, dazwischen ${rest!.minutes} Min ${rest!.pct <= LOOSE_PCT ? 'locker' : `bei ${rest!.pct} %`}`, minutes: total, pct: work.pct });
      i += used;
    } else {
      out.push({ label: stretch(work), minutes: work.minutes, pct: work.pct });
      i++;
    }
  }
  return out.slice(0, MAX_BLOCKS);
}

export const sessionMinutes = (s: Pick<Session, 'steps'>): number => Math.round(s.steps.reduce((a, st) => a + st.durationS, 0) / 60);

/** How hard a planned session is by its work: the time-weighted share of FTP, the same scale as a ride's intensity factor. */
export function plannedIntensity(steps: readonly Step[]): number | null {
  const total = steps.reduce((a, s) => a + s.durationS, 0);
  if (total <= 0) return null;
  return (steps.reduce((a, s) => a + s.durationS * stepFtpFraction(s) ** 4, 0) / total) ** 0.25;
}

// ---- Thinning ----

export type ThinSample = { rideElapsedS: number; powerW: number | null; hrBpm: number | null; cadenceRpm: number | null };
export type ThinPoint = { t: number; powerW: number | null; hrBpm: number | null; cadenceRpm: number | null };

/** At most `max` points (about): each is the mean of a stretch of samples, at the stretch's last second. */
export function thinSamples(samples: readonly ThinSample[], max: number): ThinPoint[] {
  const size = Math.max(1, Math.ceil(samples.length / max));
  const avg = (xs: (number | null)[]): number | null => { const k = xs.filter((x): x is number => x !== null); return k.length ? Math.round(k.reduce((a, b) => a + b, 0) / k.length) : null; };
  const points: ThinPoint[] = [];
  for (let i = 0; i < samples.length; i += size) {
    const part = samples.slice(i, i + size);
    points.push({ t: part.at(-1)!.rideElapsedS, powerW: avg(part.map((x) => x.powerW)), hrBpm: avg(part.map((x) => x.hrBpm)), cadenceRpm: avg(part.map((x) => x.cadenceRpm)) });
  }
  return points;
}

// ---- Readers ----

const isObj = (x: unknown): x is Record<string, unknown> => typeof x === 'object' && x !== null && !Array.isArray(x);
const fin = (x: unknown, lo: number, hi: number): x is number => typeof x === 'number' && Number.isFinite(x) && x >= lo && x <= hi;
const optNum = (x: unknown, lo: number, hi: number): number | null => (fin(x, lo, hi) ? x : null);
const str = (x: unknown, max: number): x is string => typeof x === 'string' && x.length > 0 && x.length <= max;
const HARD: readonly unknown[] = ['easy', 'moderate', 'hard'];
const small = (x: unknown): boolean => JSON.stringify(x).length <= MAX_BIKE_BODY;

function readBlock(x: unknown): BikeBlock[] {
  if (!isObj(x) || !str(x.label, 120) || !fin(x.minutes, 0, 1440)) return [];
  return [{ label: x.label, minutes: x.minutes, ...(fin(x.pct, 0, 400) ? { pct: x.pct } : {}) }];
}

/** The bike body, or null when it is not whole. Lists are read entry by entry; a broken entry is dropped. */
export function readBike(body: unknown): BikeBody | null {
  if (!isObj(body) || body.type !== 'bike' || !small(body)) return null;
  if (!fin(body.atMs, 0, Infinity) || !fin(body.ftpW, 1, 2000)) return null;
  const list = (x: unknown, n: number): unknown[] => (Array.isArray(x) ? x.slice(0, n) : []);
  const ftpHistory = list(body.ftpHistory, 60).flatMap((h) => (isObj(h) && fin(h.atMs, 0, Infinity) && fin(h.ftpW, 1, 2000) ? [{ atMs: h.atMs, ftpW: h.ftpW, source: typeof h.source === 'string' ? h.source.slice(0, 20) : 'manual' }] : []));
  const p = body.phase;
  const phase = isObj(p) && str(p.name, 60) && fin(p.weeksLeft, 0, 520) && typeof p.goal === 'string' ? { name: p.name, weeksLeft: p.weeksLeft, goal: p.goal.slice(0, 400) } : null;
  const n = body.next;
  const next: BikeNext | null = isObj(n) && str(n.name, 120) && fin(n.minutes, 0, 1440) && HARD.includes(n.hardness) && typeof n.reason === 'string'
    ? { name: n.name, reason: n.reason.slice(0, 400), minutes: n.minutes, hardness: n.hardness as DayHardness, blocks: list(n.blocks, 20).flatMap(readBlock) }
    : null;
  const alternatives = list(body.alternatives, 3).flatMap((a): BikeAlternative[] => (isObj(a) && str(a.name, 120) && fin(a.minutes, 0, 1440) && typeof a.why === 'string' ? [{ name: a.name, minutes: a.minutes, why: a.why.slice(0, 400) }] : []));
  const weekHours = list(body.weekHours, 12).flatMap((w) => (isObj(w) && typeof w.week === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(w.week) && fin(w.hours, 0, 200) ? [{ week: w.week, hours: w.hours }] : []));
  return { type: 'bike', atMs: body.atMs, ftpW: body.ftpW, ftpHistory, phase, next, alternatives, weekHours };
}

/** The ride body, or null when it is not whole. */
export function readRideBody(body: unknown): RideBody | null {
  if (!isObj(body) || body.type !== 'ride' || !small(body)) return null;
  if (!fin(body.startedAtMs, 0, Infinity) || !fin(body.durationS, 0, 86_400 * 2) || !HARD.includes(body.hardness)) return null;
  if (!fin(body.tss, 0, 5000) || !fin(body.completedFraction, 0, 1)) return null;
  const curve = (Array.isArray(body.curve) ? body.curve.slice(0, MAX_CURVE_POINTS) : []).flatMap((c): CurvePoint[] =>
    (isObj(c) && fin(c.t, 0, 86_400 * 2) ? [{ t: c.t, powerW: optNum(c.powerW, 0, 3000), hrBpm: optNum(c.hrBpm, 0, 300) }] : []));
  return {
    type: 'ride', startedAtMs: body.startedAtMs, ...(str(body.sessionName, 120) ? { sessionName: body.sessionName } : {}), durationS: body.durationS,
    hardness: body.hardness as DayHardness, avgPowerW: optNum(body.avgPowerW, 0, 3000), normalizedPowerW: optNum(body.normalizedPowerW, 0, 3000),
    avgHrBpm: optNum(body.avgHrBpm, 0, 300), maxHrBpm: optNum(body.maxHrBpm, 0, 300), tss: body.tss, completedFraction: body.completedFraction,
    ...(str(body.feedback, 40) ? { feedback: body.feedback } : {}), ...(str(body.debrief, 300) ? { debrief: body.debrief } : {}), curve,
  };
}
