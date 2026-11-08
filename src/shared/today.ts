import type { DayRating } from './day-rating';
import type { PlanMode } from './frame';
import type { Prio, SportKey } from './personal';
import { addDays, dayHardness, dayLabel, dayParts, SPORT_LABEL, type AlsoPart, type Hardness, type PlanDay, type Sport } from './week-plan';
import { ruleNumber } from './training-policy';

/**
 * What fits today, from plain data: the past days' load, today's plan day, the goal, the frame and (optionally) the body's
 * state. Pure and without AI, so the app and the coaches say the same. The advice only looks at today's plan day and the past:
 * a missed plan day is never carried over.
 */
export type TodayInput = {
  date: string;
  /** Rated past days (see day-rating). Missing days count as not trained. */
  ratings: Record<string, DayRating>;
  planDay?: PlanDay | null;
  goal: { sports: Partial<Record<SportKey, Prio>> };
  frame: { mode: PlanMode };
  readiness?: { restingHrRaised?: boolean };
  /** Local hour of the day (0-23). From the register's done-after hour on, a day already trained is done. */
  hour?: number;
};

export type TodayAdvice = {
  sport: Sport; hardness: Hardness; also?: AlsoPart;
  /** The session(s) in words: "Kraft, mittel + Rad, locker". */
  label: string;
  /** One German clause: "weil …" or "laut deinem Wochenplan". */
  reason: string;
  /** "<label> – <reason>" */
  line: string;
  /** True when this is today's plan day unchanged; then a reason adds nothing. */
  fromPlan: boolean;
  /** false: a strength session today leaves the legs out (the plan day says so, or the legs are tired). */
  legs?: boolean;
  /** True when today is already trained and the day is over for training: rest, nothing more to do. */
  done?: true;
};

const SPORT_KEYS: readonly SportKey[] = ['gym', 'bike', 'run'];
const NUMBER_WORD: Record<number, string> = { 2: 'zwei', 3: 'drei', 4: 'vier' };
type Parts = AlsoPart[];

const asDay = (date: string, parts: Parts, legs?: boolean): PlanDay => ({
  date, sport: parts[0]!.sport, hardness: parts[0]!.hardness, fixed: false, ...(legs !== undefined ? { legs } : {}),
  ...(parts[1] ? { also: parts[1] } : {}),
});
const mapParts = (parts: Parts, f: (p: AlsoPart) => AlsoPart): Parts => {
  const out = parts.map(f);
  return out[1] && out[1].sport === out[0]!.sport ? [out[0]!] : out;
};
const same = (a: Parts, b: Parts): boolean => a.length === b.length && a.every((p, i) => p.sport === b[i]!.sport && p.hardness === b[i]!.hardness);
/** The sessions in words; a strength part without legs says so instead of its hardness. */
const wordsOf = (date: string, parts: Parts, noLegs: boolean): string =>
  noLegs ? dayParts(asDay(date, parts)).map((p) => (p.sport === 'gym' ? 'Kraft ohne Beine' : dayLabel(asDay(date, [p])))).join(' + ') : dayLabel(asDay(date, parts));
const REST: Parts = [{ sport: 'rest', hardness: 'easy' }];

export function todayAdvice(input: TodayInput): TodayAdvice {
  const { date, ratings, goal } = input;
  const before = (n: number): DayRating | undefined => ratings[addDays(date, -n)];
  const legsHardYesterday = before(1)?.legs === true && before(1)?.hardness === 'hard';
  if (input.hour !== undefined && ratings[date]?.hardness != null && input.hour >= ruleNumber('today.done-after-hour')) {
    const reason = 'weil du heute schon trainiert hast';
    const label = wordsOf(date, REST, false);
    return { sport: 'rest', hardness: 'easy', label, reason, line: `${label} – ${reason}`, fromPlan: false, done: true };
  }
  const plan = input.frame.mode === 'week' ? input.planDay ?? null : null;

  // The starting point: the plan day, else the sport done least recently, at moderate.
  let parts: Parts;
  let reason: string;
  if (plan) {
    parts = dayParts(plan);
    reason = 'laut deinem Wochenplan';
  } else {
    const lastDone = (s: SportKey): string =>
      Object.values(ratings).filter((r) => r.date < date && r.sports?.includes(s)).reduce((m, r) => (r.date > m ? r.date : m), '');
    let pool = SPORT_KEYS.filter((s) => goal.sports[s] !== undefined || lastDone(s) !== '');
    if (pool.length === 0) pool = [...SPORT_KEYS];
    if (legsHardYesterday && pool.some((s) => s !== 'gym')) pool = pool.filter((s) => s !== 'gym');
    const focus = pool.filter((s) => goal.sports[s] === 'focus');
    const from = focus.length > 0 ? focus : pool;
    const pick = from.reduce((best, s) => (lastDone(s) < lastDone(best) ? s : best));
    parts = [{ sport: pick, hardness: 'moderate' }];
    // Without any history "longest ago" is not true: a calm start instead.
    reason = lastDone(pick) === '' ? 'ein ruhiger Einstieg' : `weil du ${SPORT_LABEL[pick]} am längsten nicht gemacht hast`;
  }

  // Protective rules, in order; the first that changes the day gives the reason.
  // Tired legs keep the sport: strength goes on without legs, bike and run get less hard. Only a plan day that already leaves
  // the legs out is fine as it is. (A plan day cannot say "only legs", so strength is never swapped for another sport.)
  const gymWithLegs = plan?.legs !== false && parts.some((p) => p.sport === 'gym');
  const hardInRow = ruleNumber('today.hard-days-in-row');
  const restAfter = ruleNumber('today.rest-after-days');
  const hardRun = Array.from({ length: hardInRow }, (_, i) => before(i + 1)?.hardness === 'hard').every(Boolean);
  const noBreak = Array.from({ length: restAfter }, (_, i) => before(i + 1)?.hardness != null).every(Boolean);
  const day = asDay(date, parts, plan?.legs);
  const protective: { to: Parts; reason: string; noLegs?: boolean }[] = [
    { to: dayHardness(day) === 'hard' ? REST : mapParts(parts, (p) => (p.sport === 'rest' ? p : { sport: p.sport, hardness: 'easy' })), reason: 'weil dein Ruhepuls erhöht ist', noLegs: gymWithLegs && legsHardYesterday },
    { to: mapParts(parts, (p) => (p.sport !== 'gym' && p.hardness === 'hard' ? { sport: p.sport, hardness: 'moderate' } : p)), reason: 'weil deine Beine gestern hart gearbeitet haben', noLegs: gymWithLegs },
    { to: mapParts(parts, (p) => (p.sport === 'rest' ? p : { sport: p.sport, hardness: 'easy' })), reason: `weil du ${NUMBER_WORD[hardInRow] ?? hardInRow} harte Tage hintereinander hattest` },
    { to: REST, reason: `weil du seit ${restAfter} Tagen ohne Pause trainierst` },
  ];
  const active = [input.readiness?.restingHrRaised === true, legsHardYesterday, hardRun, noBreak];
  let fromPlan = plan !== null;
  const hit = protective.find((r, i) => active[i] && (!same(r.to, parts) || r.noLegs === true));
  if (hit) { parts = hit.to; reason = hit.reason; fromPlan = false; }
  const noLegs = hit?.noLegs === true;

  const [first, also] = parts as [AlsoPart, AlsoPart?];
  const label = wordsOf(date, parts, noLegs);
  const legs = noLegs ? false : plan?.legs;
  return { sport: first.sport, hardness: first.hardness, ...(also ? { also } : {}), label, reason, line: `${label} – ${reason}`, fromPlan, ...(legs !== undefined ? { legs } : {}) };
}
