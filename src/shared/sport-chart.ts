import type { Prio, SportKey } from './personal';
import { ruleNumber, ruleValues } from './training-policy';

/**
 * The chart card "Ausdauer und Kraft": the share of training time per sport next to the share the goal asks for. The
 * minutes are counted by code from the recorded training (own rides and workouts, runs and Garmin activities, doubles
 * removed by the stats record), never by the model. `target` is the goal's share (0 to 1; 0 for a sport the goal does not
 * name). The card carries the counted values, so a device without the history still draws it.
 */
export type SportPart = { sport: SportKey; minutes: number; target: number };
export type SportChart = { kind: 'sport'; fromMs: number; toMs: number; parts: SportPart[] };
export type SportVerdict = 'passt' | 'zu wenig' | 'zu viel';

const ORDER: SportKey[] = ['gym', 'bike', 'run'];
/** Minutes per sport of the stats record; running and other endurance activities count as run, mobility not at all. */
export type SportMinutes = Partial<Record<'strength' | 'bike' | 'run' | 'other' | 'mobility', number>>;

const minutesOf = (m: SportMinutes): Record<SportKey, number> => ({ gym: m.strength ?? 0, bike: m.bike ?? 0, run: (m.run ?? 0) + (m.other ?? 0) });
const clean = (n: number) => (Number.isFinite(n) && n > 0 ? Math.round(n) : 0);

/** The chart of the training time in a period, or null when there was none. */
export function buildSportChart(o: { fromMs: number; toMs: number; minutes: SportMinutes; sports: Partial<Record<SportKey, Prio | undefined>> }): SportChart | null {
  const mins = minutesOf(o.minutes);
  const weights = ruleValues('chart.sport-weights');
  const weight = (s: SportKey) => { const p = o.sports[s]; return p ? weights[p] ?? 0 : 0; };
  const sum = ORDER.reduce((a, s) => a + weight(s), 0);
  const parts = ORDER.flatMap((sport): SportPart[] => {
    const minutes = clean(mins[sport]), target = sum > 0 ? weight(sport) / sum : 0;
    return minutes > 0 || target > 0 ? [{ sport, minutes, target }] : [];
  });
  return parts.some((p) => p.minutes > 0) ? { kind: 'sport', fromMs: o.fromMs, toMs: o.toMs, parts } : null;
}

const isObj = (x: unknown): x is Record<string, unknown> => typeof x === 'object' && x !== null && !Array.isArray(x);
const num = (x: unknown): x is number => typeof x === 'number' && Number.isFinite(x) && x >= 0;

/** Reads a stored chart; another kind or unusable data gives null (the message then reads without it), never an error. */
export function readSportChart(x: unknown): SportChart | null {
  if (!isObj(x) || x.kind !== 'sport' || !num(x.fromMs) || !num(x.toMs) || x.toMs < x.fromMs || !Array.isArray(x.parts) || x.parts.length === 0) return null;
  const parts: SportPart[] = [];
  for (const p of x.parts) {
    if (!isObj(p) || !ORDER.includes(p.sport as SportKey) || !num(p.minutes) || !num(p.target) || p.target > 1 || parts.some((q) => q.sport === p.sport)) return null;
    parts.push({ sport: p.sport as SportKey, minutes: p.minutes, target: p.target });
  }
  return { kind: 'sport', fromMs: x.fromMs, toMs: x.toMs, parts };
}

/** The share of each sport in the training time (0 to 1). */
export function actualShares(c: SportChart): Record<SportKey, number> {
  const total = c.parts.reduce((a, p) => a + p.minutes, 0);
  return Object.fromEntries(ORDER.map((s) => [s, total > 0 ? (c.parts.find((p) => p.sport === s)?.minutes ?? 0) / total : 0])) as Record<SportKey, number>;
}
export const hasTarget = (c: SportChart) => c.parts.some((p) => p.target > 0);

/** How each sport sits against its target; empty when the goal names no sport (nothing to check). */
export function sportVerdicts(c: SportChart): Partial<Record<SportKey, SportVerdict>> {
  if (!hasTarget(c)) return {};
  const tol = ruleNumber('chart.sport-tolerance') / 100, share = actualShares(c);
  return Object.fromEntries(c.parts.map((p) => {
    const d = share[p.sport] - p.target;
    return [p.sport, d < -tol ? 'zu wenig' : d > tol ? 'zu viel' : 'passt'];
  }));
}

const NAME: Record<SportKey, string> = { gym: 'Kraft', bike: 'Rad', run: 'Laufen' };
/** The sport as a noun after "fürs" and as a neuter subject ("Das ..."). */
const NOUN: Record<SportKey, string> = { gym: 'Krafttraining', bike: 'Radfahren', run: 'Laufen' };
const list = (xs: string[]) => (xs.length < 2 ? xs.join('') : `${xs.slice(0, -1).join(', ')} und ${xs[xs.length - 1]}`);

/** One calm sentence in words: the clearest mismatch, or that it fits. No numbers. */
export function sportChartSentence(c: SportChart): string {
  const v = sportVerdicts(c);
  if (!hasTarget(c)) return 'So verteilte sich deine Trainingszeit, ein Ziel für die Sportarten hast du noch nicht gewählt.';
  const share = actualShares(c);
  let worst: { sport: SportKey; v: SportVerdict; d: number } | null = null;
  for (const p of c.parts) {
    const verdict = v[p.sport];
    const d = Math.abs(share[p.sport] - p.target);
    if (verdict && verdict !== 'passt' && (!worst || d > worst.d + 1e-9 || (Math.abs(d - worst.d) <= 1e-9 && verdict === 'zu wenig'))) worst = { sport: p.sport, v: verdict, d };
  }
  if (!worst) { const names = c.parts.map((p) => NAME[p.sport]); return `${list(names)} ${names.length > 1 ? 'passen' : 'passt'} gut zu deinem Ziel.`; }
  return worst.v === 'zu wenig' ? `Fürs ${NOUN[worst.sport]} war zuletzt weniger Zeit, als dein Ziel vorsieht.` : `Das ${NOUN[worst.sport]} nahm zuletzt mehr Zeit ein, als dein Ziel vorsieht.`;
}

/** The text for screen readers: which sports fit, which have too little and which too much time, in words. */
export function sportChartSummary(c: SportChart): string {
  const parts = ['Ausdauer und Kraft: Anteile der Trainingszeit je Sportart im Vergleich zu deinem Ziel.'];
  const v = sportVerdicts(c);
  const names = (x: SportVerdict) => c.parts.filter((p) => v[p.sport] === x).map((p) => NAME[p.sport]).join(', ');
  if (!hasTarget(c)) parts.push(`Trainiert: ${c.parts.filter((p) => p.minutes > 0).map((p) => NAME[p.sport]).join(', ')}. Kein Ziel für die Sportarten gewählt.`);
  for (const [x, label] of [['passt', 'Passt'], ['zu wenig', 'Zu wenig'], ['zu viel', 'Zu viel']] as const) if (names(x)) parts.push(`${label}: ${names(x)}.`);
  return parts.join(' ');
}

export const SPORT_NAME = NAME;
