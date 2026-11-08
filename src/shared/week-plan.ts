import type { TrackedRecord } from './records';

/**
 * The week plan across the sports: per day one sport (or rest), how hard the day may be, and whether the day is fixed by the
 * rider. The coaches keep deciding what a session holds; the plan only says which sport on which day and how hard.
 */
export type Sport = 'bike' | 'gym' | 'run' | 'mobility' | 'rest';
export type Hardness = 'easy' | 'moderate' | 'hard';
/** A second session on the same day, only on the person's wish. */
export type AlsoPart = { sport: Sport; hardness: Hardness; minutes?: number };
export const MIN_ALSO_MINUTES = 5;
export const MAX_ALSO_MINUTES = 90;
/** Minutes of a second session: an integer from 5 to 90, else undefined. */
export const validAlsoMinutes = (x: unknown): number | undefined => (typeof x === 'number' && Number.isInteger(x) && x >= MIN_ALSO_MINUTES && x <= MAX_ALSO_MINUTES ? x : undefined);
/** The minutes of a second session as words: "15 Min.". */
export const minutesText = (p: AlsoPart): string => (p.minutes ? `${p.minutes} Min.` : '');
export type PlanDay = { date: string; sport: Sport; hardness: Hardness; fixed: boolean; legs?: boolean; long?: boolean; note?: string; also?: AlsoPart };
export type WeekProposal = { weekStart: string; days: PlanDay[] };
/** The `weekplan` record, id = weekStart. Written only by the rider's device when they take a proposal. */
export type WeekPlanBody = WeekProposal & { fromMessage: string; acceptedMs: number; takenFrom?: string; prior?: Record<string, unknown>; baseMs?: number };

export const SPORTS: readonly Sport[] = ['bike', 'gym', 'run', 'mobility', 'rest'];
export const SPORT_LABEL: Record<Sport, string> = { bike: 'Rad', gym: 'Kraft', run: 'Laufen', mobility: 'Beweglichkeit', rest: 'Ruhetag' };
export const HARDNESS_LABEL: Record<Hardness, string> = { easy: 'locker', moderate: 'mittel', hard: 'hart' };
export const WEEKDAY_LABEL = ['Montag', 'Dienstag', 'Mittwoch', 'Donnerstag', 'Freitag', 'Samstag', 'Sonntag'];
const HARDNESSES: readonly Hardness[] = ['easy', 'moderate', 'hard'];
const MAX_HARD_DAYS = 2;
const HARD_RANK: Record<Hardness, number> = { easy: 0, moderate: 1, hard: 2 };
export const TWO_HARD_MESSAGE = 'Zwei Einheiten an einem Tag gehen nur, wenn höchstens eine davon hart ist.';

/** The sessions of a day: the first, and the second if there is one. */
export const dayParts = (d: PlanDay): AlsoPart[] => [{ sport: d.sport, hardness: d.hardness }, ...(d.also ? [d.also] : [])];
/** Whether the day holds this sport, as its first or its second session. */
export const hasSport = (d: PlanDay, sport: Sport): boolean => dayParts(d).some((p) => p.sport === sport);
/** The day's hardness: the harder part counts. */
export const dayHardness = (d: PlanDay): Hardness => dayParts(d).reduce<Hardness>((a, p) => (HARD_RANK[p.hardness] > HARD_RANK[a] ? p.hardness : a), 'easy');
/** The day's parts as words: "Kraft, mittel + Rad, locker". `extra` adds to the first part. */
export const dayLabel = (d: PlanDay, extra: (p: AlsoPart, first: boolean) => string = () => ''): string =>
  dayParts(d).map((p, i) => (p.sport === 'rest' ? 'Ruhetag' : `${SPORT_LABEL[p.sport]}, ${HARDNESS_LABEL[p.hardness]}${extra(p, i === 0)}${p.minutes ? `, ${minutesText(p)}` : ''}`)).join(' + ');

const DATE = /^\d{4}-\d{2}-\d{2}$/;
const toDate = (key: string) => { const [y, m, d] = key.split('-').map(Number); return new Date(y!, m! - 1, d!); };
const keyOf = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
export const addDays = (key: string, n: number): string => { const d = toDate(key); d.setDate(d.getDate() + n); return keyOf(d); };
/** The Monday of a date's week (local dates). */
export const mondayOf = (key: string): string => addDays(key, -((toDate(key).getDay() + 6) % 7));
export const weekDates = (monday: string): string[] => Array.from({ length: 7 }, (_, i) => addDays(monday, i));

/**
 * The shared rules, checked by code: at most two hard days; no hard bike or run day the day after a hard leg day; the long
 * session not the day after a leg day. One sport per day is given by the shape. Returns what is broken, in plain German.
 */
export function checkWeekPlan(days: PlanDay[]): string[] {
  const out: string[] = [];
  if (days.filter((d) => dayHardness(d) === 'hard').length > MAX_HARD_DAYS) out.push('Die Woche hat mehr als zwei harte Tage.');
  if (days.some((d) => d.also && d.also.hardness === 'hard' && d.hardness === 'hard')) out.push(TWO_HARD_MESSAGE);
  days.forEach((d, i) => {
    const before = days[i - 1];
    // A gym day that does not say counts as a leg day: the safe side.
    if (!before || !hasSport(before, 'gym') || before.legs === false) return;
    const name = WEEKDAY_LABEL[(toDate(d.date).getDay() + 6) % 7];
    const hardOutdoor = dayParts(d).some((p) => (p.sport === 'bike' || p.sport === 'run') && p.hardness === 'hard');
    if (dayHardness(before) === 'hard' && hardOutdoor) out.push(`Am ${name} folgt ein harter Rad- oder Lauftag auf einen harten Beintag.`);
    if (d.long && (d.sport === 'bike' || d.sport === 'run' || d.also?.sport === 'bike' || d.also?.sport === 'run')) out.push(`Am ${name} folgt eine lange Einheit auf einen Beintag.`);
  });
  return out;
}

const isObj = (x: unknown): x is Record<string, unknown> => typeof x === 'object' && x !== null && !Array.isArray(x);

/** A proposal from Claude or a record: seven days of the week starting on its Monday, every field valid. Null otherwise. */
export function parseProposal(x: unknown): WeekProposal | null {
  if (!isObj(x) || typeof x.weekStart !== 'string' || !DATE.test(x.weekStart) || mondayOf(x.weekStart) !== x.weekStart || !Array.isArray(x.days)) return null;
  const dates = weekDates(x.weekStart);
  if (x.days.length !== 7) return null;
  const days: PlanDay[] = [];
  for (let i = 0; i < 7; i++) {
    const d = x.days[i];
    if (!isObj(d) || d.date !== dates[i] || !SPORTS.includes(d.sport as Sport) || !HARDNESSES.includes(d.hardness as Hardness)) return null;
    const day: PlanDay = { date: dates[i]!, sport: d.sport as Sport, hardness: d.hardness as Hardness, fixed: d.fixed === true };
    if (d.legs === true) day.legs = true; else if (d.legs === false) day.legs = false;
    if (d.long === true) day.long = true;
    // Never rest plus something, never the same sport twice, never two hard parts; such a second part is left out.
    if (isObj(d.also) && SPORTS.includes(d.also.sport as Sport) && HARDNESSES.includes(d.also.hardness as Hardness)
      && d.also.sport !== 'rest' && day.sport !== 'rest' && d.also.sport !== day.sport && !(day.hardness === 'hard' && d.also.hardness === 'hard')) {
      const minutes = validAlsoMinutes(d.also.minutes);
      day.also = { sport: d.also.sport as Sport, hardness: d.also.hardness as Hardness, ...(minutes !== undefined ? { minutes } : {}) };
    }
    if (typeof d.note === 'string' && d.note.trim()) day.note = d.note.trim().slice(0, 120);
    days.push(day);
  }
  return { weekStart: x.weekStart, days };
}

/** The accepted plan of a week, or null. */
export function planOfWeek(records: TrackedRecord[], monday: string): WeekPlanBody | null {
  const r = records.find((x) => x.kind === 'weekplan' && x.id === monday && !x.deleted);
  if (!r || !isObj(r.body)) return null;
  const p = parseProposal(r.body);
  return p ? { ...p, fromMessage: String(r.body.fromMessage ?? ''), acceptedMs: Number(r.body.acceptedMs ?? 0) } : null;
}
/** The planned day of a date, or null without a plan for its week. */
export const planFor = (records: TrackedRecord[], date: string): PlanDay | null =>
  planOfWeek(records, mondayOf(date))?.days.find((d) => d.date === date) ?? null;

/** The first date from `from` on (within seven days) whose plan day has this sport, or null. */
export const nextPlanDate = (records: TrackedRecord[], from: string, sport: Sport, skip: (date: string) => boolean = () => false): string | null =>
  [0, 1, 2, 3, 4, 5, 6].map((i) => addDays(from, i)).find((d) => { const p = planFor(records, d); return p && !skip(d) ? hasSport(p, sport) : false; }) ?? null;
