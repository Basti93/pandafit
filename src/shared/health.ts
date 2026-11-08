import type { GarminReadiness } from './garmin';

/**
 * What the coach that reads a profile's Garmin data publishes for the web: one `health` record. Read-only for the web.
 * Never a diagnosis: the findings are short German sentences from the rules of the policy register (health.*).
 */
export const HEALTH_ID = 'health';
/** The most the web reads of the record (bytes of its JSON). */
export const MAX_HEALTH_BODY = 64 * 1024;
export const HEALTH_WEEKS = 52;
export const HEALTH_DAYS = 28;
export const COACH_TEXT_MAX = 600;

/** info: neutral; gut: fine as it is; achtung: worth a look; arzt: a calm "ärztlich abklären lassen". */
export type HealthTone = 'info' | 'gut' | 'achtung' | 'arzt';
export const HEALTH_TONES: readonly HealthTone[] = ['info', 'gut', 'achtung', 'arzt'];
export type HealthFinding = { rule: string; text: string; tone: HealthTone };
/** One ISO week (`week` = its Monday): medians, the daily average of steps, the sum of active minutes. A missing value is left out. */
export type HealthWeek = { week: string; rhr?: number; vo2?: number; steps?: number; activeMin?: number; strengthDays?: number; sleepH?: number; hrv?: number };
export type HealthDay = { date: string; rhr?: number; steps?: number; sleepH?: number };
export type HealthBody = {
  type: 'health'; atMs: number; today: GarminReadiness; findings: HealthFinding[]; weeks: HealthWeek[]; days: HealthDay[];
  coachText?: { week: string; text: string; atMs?: number; key?: string };
};

const isObj = (x: unknown): x is Record<string, unknown> => typeof x === 'object' && x !== null && !Array.isArray(x);
const fin = (x: unknown, lo: number, hi: number): x is number => typeof x === 'number' && Number.isFinite(x) && x >= lo && x <= hi;
const DATE = /^\d{4}-\d{2}-\d{2}$/;
const list = (x: unknown, n: number): unknown[] => (Array.isArray(x) ? x.slice(-n) : []);
const opt = <K extends string>(key: K, x: unknown, lo: number, hi: number): { [P in K]?: number } => (fin(x, lo, hi) ? { [key]: x } as { [P in K]?: number } : {});

/** The health body, or null when it is not whole. Lists are read entry by entry; a broken entry is dropped. */
export function readHealth(body: unknown): HealthBody | null {
  if (!isObj(body) || body.type !== 'health' || JSON.stringify(body).length > MAX_HEALTH_BODY) return null;
  if (!fin(body.atMs, 0, Infinity) || !isObj(body.today)) return null;
  const level = body.today.level;
  if (level !== 'normal' && level !== 'careful' && level !== 'unknown') return null;
  const reasons = list(body.today.reasons, 5).flatMap((r) => (typeof r === 'string' && r.length > 0 ? [r.slice(0, 200)] : []));
  const findings = list(body.findings, 20).flatMap((f): HealthFinding[] =>
    (isObj(f) && typeof f.rule === 'string' && f.rule.length > 0 && f.rule.length <= 60 && typeof f.text === 'string' && f.text.length > 0 && HEALTH_TONES.includes(f.tone as HealthTone)
      ? [{ rule: f.rule, text: f.text.slice(0, 400), tone: f.tone as HealthTone }] : []));
  const weeks = list(body.weeks, HEALTH_WEEKS).flatMap((w): HealthWeek[] => (isObj(w) && typeof w.week === 'string' && DATE.test(w.week)
    ? [{ week: w.week, ...opt('rhr', w.rhr, 20, 250), ...opt('vo2', w.vo2, 5, 120), ...opt('steps', w.steps, 0, 100_000), ...opt('activeMin', w.activeMin, 0, 20_000),
      ...opt('strengthDays', w.strengthDays, 0, 7), ...opt('sleepH', w.sleepH, 0, 24), ...opt('hrv', w.hrv, 0, 500) }] : []));
  const days = list(body.days, HEALTH_DAYS).flatMap((d): HealthDay[] => (isObj(d) && typeof d.date === 'string' && DATE.test(d.date)
    ? [{ date: d.date, ...opt('rhr', d.rhr, 20, 250), ...opt('steps', d.steps, 0, 100_000), ...opt('sleepH', d.sleepH, 0, 24) }] : []));
  const c = body.coachText;
  const coachText = isObj(c) && typeof c.week === 'string' && DATE.test(c.week) && typeof c.text === 'string' && c.text.length > 0 && c.text.length <= COACH_TEXT_MAX
    ? { week: c.week, text: c.text, ...(fin(c.atMs, 0, Infinity) ? { atMs: c.atMs } : {}), ...(typeof c.key === 'string' && c.key.length <= 4000 ? { key: c.key } : {}) } : null;
  return { type: 'health', atMs: body.atMs, today: { level, reasons }, findings, weeks, days, ...(coachText ? { coachText } : {}) };
}
