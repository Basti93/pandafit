import type { Prio, SportKey, Strength } from './personal';
import { ruleNamedRange, ruleValues } from './training-policy';

/**
 * The chart card "Training und Intensität": three rows per week, averaged over the period. Kraft is strength sessions, Ausdauer
 * the moderate-equivalent minutes (vigorous count double), Intensiv the hard sessions. Each row carries the target band the
 * goal asks for. The values are counted by code from the recorded training, never by the model. The card carries them, so a
 * device without the history still draws it. Rules: `week.*` and `intensity.*` in the policy.
 */
export type IntensityRow = { perWeek: number; min: number; max: number; /** The goal does not name this sport: only the lower edge (the WHO floor) is a target. */ floorOnly?: boolean };
export type IntensityChart = { kind: 'intensity'; fromMs: number; toMs: number; weeks: number; strength: IntensityRow; endurance: IntensityRow; hard: IntensityRow };
export type IntensityTotals = { strengthSessions: number; enduranceMin: number; hardSessions: number };
type Band = { min: number; max: number; floorOnly?: boolean };
export type IntensityGoal = { strength: Strength; sports: Partial<Record<SportKey, Prio | undefined>> };

const WEEK_MS = 7 * 86_400_000;
const RANK: Record<Prio, number> = { keep: 0, equal: 1, focus: 2 };
const higher = (a: Prio | undefined, b: Prio | undefined): Prio | undefined => (a && b ? (RANK[a] >= RANK[b] ? a : b) : a ?? b);

/** The weekly target bands for a goal (with a temporary focus already laid over it). */
export function intensityBands(goal: IntensityGoal, newToIntensity: boolean): { strength: Band; endurance: Band; hard: Band } {
  const gym = goal.sports.gym, endurance = higher(goal.sports.bike, goal.sports.run);
  const pick = (id: string, prio: Prio | undefined): Band => ({ ...ruleNamedRange(id, prio ?? 'keep'), ...(prio ? {} : { floorOnly: true }) });
  const strength = pick('week.strength-sessions', gym);
  const hardRule = ruleValues('week.hard-sessions');
  const cap = (b: Band, max: number): Band => ({ ...b, max: Math.min(b.max, max), min: Math.min(b.min, max) });
  return {
    strength: goal.strength === 'fitness' ? cap(strength, ruleValues('week.strength-sessions').fitnessMax!) : strength,
    endurance: pick('week.endurance-minutes', endurance),
    hard: cap(pick('week.hard-sessions', endurance), newToIntensity ? hardRule.newToIntensityMax! : hardRule.max!),
  };
}

const round1 = (n: number) => Math.round(n * 10) / 10;
const clean = (n: number) => (Number.isFinite(n) && n > 0 ? n : 0);

/** The chart of the training in a period, or null when there was none. */
export function buildIntensityChart(o: { fromMs: number; toMs: number; totals: IntensityTotals; goal: IntensityGoal; newToIntensity: boolean }): IntensityChart | null {
  const t = o.totals;
  if (clean(t.strengthSessions) + clean(t.enduranceMin) + clean(t.hardSessions) <= 0) return null;
  const weeks = Math.max(1, (o.toMs - o.fromMs) / WEEK_MS);
  const b = intensityBands(o.goal, o.newToIntensity);
  const row = (total: number, band: Band, digits: 'one' | 'whole'): IntensityRow => {
    const v = clean(total) / weeks;
    return { perWeek: digits === 'one' ? round1(v) : Math.round(v), min: band.min, max: band.max, ...(band.floorOnly ? { floorOnly: true } : {}) };
  };
  return { kind: 'intensity', fromMs: o.fromMs, toMs: o.toMs, weeks: round1(weeks), strength: row(t.strengthSessions, b.strength, 'one'), endurance: row(t.enduranceMin, b.endurance, 'whole'), hard: row(t.hardSessions, b.hard, 'one') };
}

const isObj = (x: unknown): x is Record<string, unknown> => typeof x === 'object' && x !== null && !Array.isArray(x);
const num = (x: unknown): x is number => typeof x === 'number' && Number.isFinite(x) && x >= 0;
const readRow = (x: unknown): IntensityRow | null => {
  if (!isObj(x) || !num(x.perWeek) || !num(x.min) || !num(x.max) || x.max < x.min) return null;
  return { perWeek: x.perWeek, min: x.min, max: x.max, ...(x.floorOnly === true ? { floorOnly: true } : {}) };
};

/** Reads a stored chart; another kind (also an old sport card), or unusable data gives null (the message then reads without it), never an error. */
export function readIntensityChart(x: unknown): IntensityChart | null {
  if (!isObj(x) || x.kind !== 'intensity' || !num(x.fromMs) || !num(x.toMs) || x.toMs < x.fromMs || !num(x.weeks)) return null;
  const strength = readRow(x.strength), endurance = readRow(x.endurance), hard = readRow(x.hard);
  return strength && endurance && hard ? { kind: 'intensity', fromMs: x.fromMs, toMs: x.toMs, weeks: x.weeks, strength, endurance, hard } : null;
}

export type RowKey = 'strength' | 'endurance' | 'hard';
export const ROW_KEYS: readonly RowKey[] = ['strength', 'endurance', 'hard'];
export const ROW_NAME: Record<RowKey, string> = { strength: 'Kraft', endurance: 'Ausdauer', hard: 'Intensiv' };
export type RowVerdict = 'darunter' | 'im Zielbereich' | 'darüber';

/** The smallest gap that counts: half a session, half an hour. */
const MIN_GAP: Record<RowKey, number> = { strength: 0.5, endurance: 30, hard: 0.5 };
const SCALE: Record<RowKey, number> = { strength: 1, endurance: 150, hard: 1 };

/** How a row sits against its band; an excess does not count for a sport the goal does not name. */
export function rowGap(c: IntensityChart, k: RowKey): { verdict: RowVerdict; gap: number } {
  const r = c[k];
  if (r.perWeek < r.min && r.min - r.perWeek >= MIN_GAP[k]) return { verdict: 'darunter', gap: r.min - r.perWeek };
  if (!r.floorOnly && r.perWeek > r.max && r.perWeek - r.max >= MIN_GAP[k]) return { verdict: 'darüber', gap: r.perWeek - r.max };
  return { verdict: 'im Zielbereich', gap: 0 };
}

const WORD = ['kein', 'ein', 'zwei', 'drei', 'vier', 'fünf'];
const count = (n: number) => WORD[Math.min(Math.round(n), 5)] ?? 'mehrere';
/** Weekly endurance time in words. */
const enduranceWords = (min: number) => {
  if (min < 45) return 'weniger als eine Stunde';
  const h = Math.round(min / 60);
  return h <= 1 ? 'etwa eine Stunde' : h <= 5 ? `etwa ${count(h)} Stunden` : 'mehrere Stunden';
};
const sessions = (n: number, one: string, many: string) => (Math.round(n) === 1 ? `etwa ${one}` : `etwa ${count(n)} ${many}`);

/**
 * Up to two short sentences, no recommendation: where the person stands in the row that differs most from its band, and what
 * studies show with the strength of the evidence (`docs/research/2026-11-20-kraft-ausdauer-hiit.md`). The person decides.
 */
export function intensityChartSentence(c: IntensityChart): string {
  let worst: { k: RowKey; verdict: RowVerdict; gap: number; rel: number } | null = null;
  for (const k of ROW_KEYS) {
    const { verdict, gap } = rowGap(c, k);
    if (verdict === 'im Zielbereich') continue;
    const rel = gap / Math.max(SCALE[k], k === 'endurance' ? c[k].min : 0);
    if (!worst || rel > worst.rel + 1e-9 || (Math.abs(rel - worst.rel) <= 1e-9 && verdict === 'darunter')) worst = { k, verdict, gap, rel };
  }
  if (!worst) return 'Kraft, Ausdauer und harte Einheiten liegen in den Bereichen, die zu deinem Ziel gehören.';
  const less = worst.verdict === 'darunter';
  if (worst.k === 'strength') {
    const n = c.strength.perWeek;
    const stand = n < 0.5 ? 'Im letzten Zeitraum gab es kaum Krafttraining.' : `Im Schnitt waren es zuletzt ${sessions(n, 'eine Krafteinheit', 'Krafteinheiten')} pro Woche.`;
    return less
      ? `${stand} Die WHO nennt mindestens zwei Tage Krafttraining pro Woche; Beobachtungsstudien sehen den größten Rückgang des Sterberisikos bei etwa einer halben bis einer Stunde pro Woche.`
      : `${stand} Für Muskelaufbau bringt mehr Volumen laut Studien eher mehr Wachstum, mit abnehmendem Ertrag; einen Schaden durch mehr Training zeigen Beobachtungsstudien nicht.`;
  }
  if (worst.k === 'endurance') {
    const stand = `Bei der Ausdauer waren es zuletzt ${enduranceWords(c.endurance.perWeek)} pro Woche.`;
    return less
      ? `${stand} Die WHO nennt als Spanne zweieinhalb bis fünf Stunden moderat pro Woche und betont, dass auch weniger schon nützt.`
      : `${stand} Laut WHO bringen mehr als fünf Stunden moderat pro Woche zusätzlichen Nutzen.`;
  }
  const n = c.hard.perWeek;
  const stand = n < 0.5 ? 'Im letzten Zeitraum gab es kaum harte Einheiten.' : `Im Schnitt waren es zuletzt ${sessions(n, 'eine harte Einheit', 'harte Einheiten')} pro Woche.`;
  return `${stand} Studien zeigen für HIIT einen kleinen Vorteil bei der Ausdauerleistung; eine ideale Anzahl pro Woche ist nicht belegt.`;
}

/** The text for screen readers: each row against its target band, in words. */
export function intensityChartSummary(c: IntensityChart): string {
  const rows = ROW_KEYS.map((k) => `${ROW_NAME[k]}: ${rowGap(c, k).verdict}`);
  return `Training und Intensität pro Woche im Vergleich zu deinem Ziel. ${rows.join(', ')}.`;
}
