import type { TrackedRecord } from './records';
import { above } from './exercise-links';
import { lastSundayOf } from './dates';
import type { PlanMode } from './frame';
import { addDays, checkWeekPlan, hasSport, mondayOf, parseProposal, planFor, WEEKDAY_LABEL, type Hardness, type PlanDay, type Sport, type WeekProposal } from './week-plan';
import { ruleNumber, ruleRange } from './training-policy';

/**
 * The fixed section: 4 to 6 weeks with a week rhythm and, per strength-day template, a few core exercises that stay.
 * One record per section, kind `block`, id `block-<message id>`; per profile.
 */
export type BlockState = 'proposed' | 'active' | 'ended' | 'declined';
/** One day of the rhythm. `template`: the index into `templates` for a strength day. */
export type BlockDay = { sport: Sport; hardness: Hardness; legs?: boolean; long?: boolean; template?: number };
export type BlockTemplate = { name: string; core: string[] };
/** `start`, `end`: Monday and Sunday, set when the person takes it. `priorMode`: the plan mode to go back to. `takenFrom`: the chat message the take is marked with; `frameMs`: the stamp of the frame the take wrote. */
export type BlockBody = { state: BlockState; templates: BlockTemplate[]; rhythm: BlockDay[]; start?: string; end?: string; priorMode?: PlanMode; takenFrom?: string; frameMs?: number; /** The chat message whose answer ended the section ("Ja, locker planen"); the stored data then says the question was answered. */ endedBy?: string; atMs: number };

export const blockId = (msgId: string): string => `block-${msgId}`;

const isObj = (x: unknown): x is Record<string, unknown> => typeof x === 'object' && x !== null && !Array.isArray(x);
const DATE = /^\d{4}-\d{2}-\d{2}$/;
const STATES: BlockState[] = ['proposed', 'active', 'ended', 'declined'];
const SPORT_LIST: Sport[] = ['bike', 'gym', 'run', 'mobility', 'rest'];
const HARDNESS_LIST: Hardness[] = ['easy', 'moderate', 'hard'];
const MAX_TEMPLATES = 4;
const NAME_MAX = 60;
/** Any Monday: the rhythm is checked as one week with dates. */
const SAMPLE_MONDAY = '2026-01-05';

const daysBetween = (a: string, b: string): number => {
  const t = (k: string) => { const [y, m, d] = k.split('-').map(Number); return Date.UTC(y!, m! - 1, d!); };
  return Math.round((t(b) - t(a)) / 86_400_000);
};
const weekdayIndex = (date: string): number => { const [y, m, d] = date.split('-').map(Number); return (new Date(Date.UTC(y!, m! - 1, d!)).getUTCDay() + 6) % 7; };

/** A YYYY-MM-DD key of a day that exists. */
const isRealDate = (x: unknown): x is string => {
  if (typeof x !== 'string' || !DATE.test(x)) return false;
  const [y, m, d] = x.split('-').map(Number);
  const t = new Date(Date.UTC(y!, m! - 1, d!));
  return t.getUTCFullYear() === y && t.getUTCMonth() === m! - 1 && t.getUTCDate() === d;
};

function readDay(x: unknown, templates: number): BlockDay | null {
  if (!isObj(x) || !SPORT_LIST.includes(x.sport as Sport) || !HARDNESS_LIST.includes(x.hardness as Hardness)) return null;
  const day: BlockDay = { sport: x.sport as Sport, hardness: x.hardness as Hardness };
  if (x.legs !== undefined) { if (typeof x.legs !== 'boolean') return null; day.legs = x.legs; }
  if (x.long !== undefined) { if (typeof x.long !== 'boolean') return null; day.long = x.long; }
  if (x.template !== undefined) {
    if (typeof x.template !== 'number' || !Number.isInteger(x.template) || x.template < 0 || x.template >= templates) return null;
    day.template = x.template;
  }
  return day;
}

const toPlanDays = (rhythm: BlockDay[], monday: string): PlanDay[] =>
  rhythm.map((d, i) => ({ date: addDays(monday, i), sport: d.sport, hardness: d.hardness, fixed: false, ...(d.legs !== undefined ? { legs: d.legs } : {}), ...(d.long !== undefined ? { long: d.long } : {}) }));

/** The body of a `block` record, or null for anything else. */
export function readBlock(body: unknown): BlockBody | null {
  if (!isObj(body) || !STATES.includes(body.state as BlockState) || typeof body.atMs !== 'number' || !Number.isFinite(body.atMs)) return null;
  if (!Array.isArray(body.templates) || body.templates.length < 1 || body.templates.length > MAX_TEMPLATES) return null;
  const { min, max } = ruleRange('block.core-per-template');
  const templates: BlockTemplate[] = [];
  for (const t of body.templates) {
    if (!isObj(t) || typeof t.name !== 'string' || t.name.trim() === '' || t.name.length > NAME_MAX || !Array.isArray(t.core)) return null;
    if (t.core.length < min || t.core.length > max || !t.core.every((c) => typeof c === 'string' && c !== '') || new Set(t.core).size !== t.core.length) return null;
    templates.push({ name: t.name, core: t.core as string[] });
  }
  if (!Array.isArray(body.rhythm) || body.rhythm.length !== 7) return null;
  const rhythm: BlockDay[] = [];
  for (const d of body.rhythm) { const day = readDay(d, templates.length); if (!day) return null; rhythm.push(day); }
  // Templates and strength days belong together: a template only on a gym day, every gym day has one, every template is used.
  if (rhythm.some((d) => (d.sport === 'gym') !== (d.template !== undefined))) return null;
  if (templates.some((_, i) => !rhythm.some((d) => d.template === i))) return null;
  // The rhythm repeats weekly: check it as a week, and again from Sunday so the turn to Monday counts.
  if (checkWeekPlan(toPlanDays(rhythm, SAMPLE_MONDAY)).length > 0) return null;
  if (checkWeekPlan(toPlanDays([rhythm[6]!, ...rhythm.slice(0, 6)], addDays(SAMPLE_MONDAY, -1))).length > 0) return null;
  const out: BlockBody = { state: body.state as BlockState, templates, rhythm, atMs: body.atMs };
  if ((body.start === undefined) !== (body.end === undefined)) return null;
  if (body.start !== undefined) {
    if (!isRealDate(body.start) || !isRealDate(body.end) || mondayOf(body.start) !== body.start || weekdayIndex(body.end) !== 6 || body.end < body.start) return null;
    out.start = body.start;
    out.end = body.end;
  } else if (out.state === 'active' || out.state === 'ended') return null;
  if (body.priorMode !== undefined) { if (body.priorMode !== 'week' && body.priorMode !== 'spontaneous') return null; out.priorMode = body.priorMode; }
  if (body.takenFrom !== undefined) { if (typeof body.takenFrom !== 'string' || body.takenFrom === '') return null; out.takenFrom = body.takenFrom; }
  if (body.frameMs !== undefined) { if (typeof body.frameMs !== 'number' || !Number.isFinite(body.frameMs)) return null; out.frameMs = body.frameMs; }
  if (body.endedBy !== undefined) { if (typeof body.endedBy !== 'string' || body.endedBy === '') return null; out.endedBy = body.endedBy; }
  return out;
}

/** The record. `have`: the record it replaces, so the stamp goes above it. */
export const blockRecord = (id: string, b: BlockBody, nowMs: number, have?: TrackedRecord): TrackedRecord =>
  ({ kind: 'block', id, updatedMs: above(nowMs, have), deleted: false, body: b });

/**
 * When a section taken on `today` runs: from the Monday (today on a Monday) to the last Sunday of the next month end;
 * if that is under `block.min-weeks` away, to the one after. At most `block.max-weeks` weeks.
 */
export function blockDates(today: string): { start: string; end: string } {
  const start = addDays(today, (7 - weekdayIndex(today)) % 7);
  let end = lastSundayOf(today);
  if (end < today) end = lastSundayOf(addDays(today, 7));
  if (daysBetween(start, end) + 1 < ruleNumber('block.min-weeks') * 7) end = lastSundayOf(addDays(end, 7));
  const cap = addDays(start, ruleNumber('block.max-weeks') * 7 - 1);
  return { start, end: end < cap ? end : cap };
}

/** The active block whose dates hold `today`. */
export function activeBlock(records: readonly TrackedRecord[], today: string): (BlockBody & { id: string }) | null {
  let best: (BlockBody & { id: string }) | null = null;
  for (const r of records) {
    if (r.kind !== 'block' || r.deleted) continue;
    const b = readBlock(r.body);
    if (!b || b.state !== 'active' || !b.start || !b.end || today < b.start || today > b.end) continue;
    if (!best || b.atMs > best.atMs || (b.atMs === best.atMs && r.id > best.id)) best = { ...b, id: r.id };
  }
  return best;
}

/** Week number `n` of `of`, counted from the start; the last week is the light one. */
export function blockWeek(b: BlockBody, date: string): { n: number; of: number; light: boolean } {
  if (!b.start || !b.end) return { n: 1, of: 1, light: false };
  const of = Math.max(1, Math.round((daysBetween(b.start, b.end) + 1) / 7));
  const n = Math.min(of, Math.max(1, Math.floor(daysBetween(b.start, date) / 7) + 1));
  return { n, of, light: n === of && of > 1 };
}

/** The week plans of the whole section, one per week, from the rhythm. */
export function blockWeeks(b: BlockBody): WeekProposal[] {
  if (!b.start) return [];
  const { of } = blockWeek(b, b.start);
  return Array.from({ length: of }, (_, i) => {
    const weekStart = addDays(b.start!, i * 7);
    return parseProposal({ weekStart, days: toPlanDays(b.rhythm, weekStart) }) ?? { weekStart, days: toPlanDays(b.rhythm, weekStart) };
  });
}

/** The template of the rhythm day of a date; on a day without one, that of the next day in the rhythm that has one. */
export function templateFor(b: BlockBody, planDate: string): BlockTemplate | null {
  const i = weekdayIndex(planDate);
  for (let k = 0; k < 7; k++) {
    const t = b.rhythm[(i + k) % 7]?.template;
    if (t !== undefined) return b.templates[t] ?? null;
  }
  return null;
}

/**
 * The one line for Woche and Kraft: the week of the section and which strength day comes next (from the stored week plans),
 * or the note for the light last week. null for anything but a running section.
 */
export function blockLine(b: BlockBody | null, today: string, plans: readonly TrackedRecord[]): string | null {
  if (!b || b.state !== 'active' || !b.start || !b.end || today < b.start || today > b.end) return null;
  const { n, of, light } = blockWeek(b, today);
  if (light) return 'Letzte Woche im Abschnitt, sie ist leichter.';
  const head = `Woche ${n} von ${of} im festen Abschnitt.`;
  for (let d = today; d <= b.end; d = addDays(d, 1)) {
    const plan = planFor([...plans], d);
    if (!plan || !hasSport(plan, 'gym')) continue;
    const template = templateFor(b, d);
    if (template) return d === today ? `${head} Heute kommt ${template.name}.` : `${head} Als Nächstes kommt ${template.name} am ${WEEKDAY_LABEL[weekdayIndex(d)]}.`;
  }
  return head;
}
