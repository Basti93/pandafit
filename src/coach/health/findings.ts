import { dateKey } from '../../shared/day-rating';
import type { GarminDay } from '../../shared/garmin';
import type { HealthFinding, HealthWeek } from '../../shared/health';
import { ruleNamedRange, ruleNumber, ruleRange, ruleValues } from '../../shared/training-policy';
import { addDays, mondayOf } from '../../shared/week-plan';
import { restingHrRaised } from '../readiness';
import { median } from './aggregate';

const DAY_MS = 86_400_000;
const WEEK_DAYS = 7;

const num = (n: number): string => String(Math.round(n)).replace(/\B(?=(\d{3})+(?!\d))/g, '.');
const dayNumber = (key: string): number => Math.round(Date.parse(`${key}T00:00:00Z`) / DAY_MS);

/** Resting-pulse days up to the newest one, only while that one is fresh (today or yesterday). Null when there is nothing current. */
const rhrByDate = (days: GarminDay[], today: string): { byDate: Map<string, number>; anchor: string } | null => {
  const byDate = new Map<string, number>();
  for (const d of days) if (d.restingHrBpm !== null && d.date <= today) byDate.set(d.date, d.restingHrBpm);
  const anchor = [...byDate.keys()].sort().at(-1);
  return anchor && anchor >= addDays(today, -1) ? { byDate, anchor } : null;
};

const rhrFindings = (days: GarminDay[], today: string): HealthFinding[] => {
  const out: HealthFinding[] = [];
  if (restingHrRaised(days)) out.push({ rule: 'health.rhr-raised', tone: 'info', text: 'Dein Ruhepuls liegt seit zwei Tagen über deinem üblichen Wert. Heute lieber locker.' });
  const cur = rhrByDate(days, today);
  if (!cur) return out;
  const week = Array.from({ length: WEEK_DAYS }, (_, i) => cur.byDate.get(addDays(cur.anchor, -i)));
  const high = ruleValues('health.rhr-high');
  if (week.filter((v) => v !== undefined && v > ruleNumber('health.rhr-high')).length >= high.days!) {
    out.push({ rule: 'health.rhr-high', tone: 'arzt', text: 'Dein Ruhepuls lag an mehreren der letzten Tage über 100. Das lässt du am besten ärztlich abklären.' });
  }
  const persist = ruleValues('health.rhr-persist');
  const base = Array.from({ length: persist.baselineDays! }, (_, i) => cur.byDate.get(addDays(cur.anchor, -(persist.days! + i)))).filter((v): v is number => v !== undefined);
  if (base.length >= persist.minDays! && week.length === persist.days! && week.every((v) => v !== undefined && v >= median(base) + ruleNumber('health.rhr-persist'))) {
    out.push({ rule: 'health.rhr-persist', tone: 'arzt', text: 'Dein Ruhepuls liegt seit einer Woche deutlich über deinem üblichen Wert. Wenn das anhält, lass es ärztlich abklären.' });
  }
  return out;
};

const rhrLongterm = (weeks: HealthWeek[]): HealthFinding[] => {
  const v = ruleValues('health.rhr-longterm');
  const w = weeks.filter((x) => x.rhr !== undefined);
  if (w.length < 2 * v.compareWeeks!) return [];
  if (dayNumber(w.at(-1)!.week) - dayNumber(w[0]!.week) < v.minWeeks! * WEEK_DAYS) return [];
  const early = median(w.slice(0, v.compareWeeks!).map((x) => x.rhr!)), recent = median(w.slice(-v.compareWeeks!).map((x) => x.rhr!));
  const change = recent - early;
  if (Math.abs(change) < ruleNumber('health.rhr-longterm')) return [];
  return change < 0
    ? [{ rule: 'health.rhr-longterm', tone: 'gut', text: 'Über die letzten Monate ist dein Ruhepuls leicht gesunken.' }]
    : [{ rule: 'health.rhr-longterm', tone: 'info', text: 'Über die letzten Monate ist dein Ruhepuls leicht gestiegen. Das ist allein kein Grund zur Sorge; sprich beim nächsten Arztbesuch kurz darüber.' }];
};

const vo2Trend = (weeks: HealthWeek[], today: string): HealthFinding[] => {
  const v = ruleValues('health.vo2-trend');
  const from = addDays(mondayOf(today), -v.lookbackWeeks! * WEEK_DAYS);
  const w = weeks.filter((x) => x.vo2 !== undefined && x.week >= from);
  if (w.length < 2) return [];
  const first = w[0]!, last = w.at(-1)!;
  if (dayNumber(last.week) - dayNumber(first.week) < (v.weeks! - 1) * WEEK_DAYS) return [];
  const edge = (pick: (x: HealthWeek) => boolean): number => median(w.filter(pick).map((x) => x.vo2!));
  const start = edge((x) => dayNumber(x.week) - dayNumber(first.week) < v.compareWeeks! * WEEK_DAYS);
  const end = edge((x) => dayNumber(last.week) - dayNumber(x.week) < v.compareWeeks! * WEEK_DAYS);
  const change = Math.round((end - start) * 10) / 10;
  if (Math.abs(change) < ruleNumber('health.vo2-trend')) return [];
  return change > 0
    ? [{ rule: 'health.vo2-trend', tone: 'gut', text: 'Deine geschätzte Ausdauerfitness ist in den letzten Wochen etwas gestiegen.' }]
    : [{ rule: 'health.vo2-trend', tone: 'info', text: 'Deine geschätzte Ausdauerfitness ist in den letzten Wochen etwas gesunken. Die Uhr schätzt den Wert nur grob; ein paar Wochen mehr zeigen, ob das ein Trend ist.' }];
};

const age = (birthDate: string | null, nowMs: number): number | null => {
  if (!birthDate || !/^\d{4}-\d{2}-\d{2}/.test(birthDate)) return null;
  const b = new Date(`${birthDate.slice(0, 10)}T00:00:00Z`), n = new Date(nowMs);
  if (Number.isNaN(b.getTime())) return null;
  return n.getUTCFullYear() - b.getUTCFullYear() - (n.getUTCMonth() < b.getUTCMonth() || (n.getUTCMonth() === b.getUTCMonth() && n.getUTCDate() < b.getUTCDate()) ? 1 : 0);
};

const stepsBand = (week: HealthWeek | undefined, birthDate: string | null, nowMs: number): HealthFinding[] => {
  if (week?.steps === undefined) return [];
  const older = (age(birthDate, nowMs) ?? 0) >= ruleValues('health.steps-band').olderFromAge!;
  const { min, max } = older ? ruleNamedRange('health.steps-band', 'older') : ruleRange('health.steps-band');
  const rounded = Math.round(week.steps / 100) * 100;
  if (week.steps < min) return [{ rule: 'health.steps-band', tone: 'info', text: `Letzte Woche lagst du im Schnitt bei etwa ${num(rounded)} Schritten pro Tag; ein Richtwert aus Studien sind ${num(min)} bis ${num(max)}.` }];
  if (week.steps <= max) return [{ rule: 'health.steps-band', tone: 'gut', text: `Letzte Woche lagst du im Schnitt bei etwa ${num(rounded)} Schritten pro Tag, im Richtwert von ${num(min)} bis ${num(max)}.` }];
  return [];
};

const activity = (week: HealthWeek | undefined): HealthFinding[] => {
  if (!week) return [];
  const out: HealthFinding[] = [];
  const { min, max } = ruleRange('health.activity-minutes');
  if (week.activeMin !== undefined) {
    out.push(week.activeMin < min
      ? { rule: 'health.activity-minutes', tone: 'info', text: `Letzte Woche kamen ${num(week.activeMin)} Minuten Bewegung mit erhöhtem Puls zusammen; die WHO empfiehlt ${min} bis ${max} moderate Minuten pro Woche, weniger ist trotzdem sinnvoll.` }
      : { rule: 'health.activity-minutes', tone: 'gut', text: `Letzte Woche kamen ${num(week.activeMin)} Minuten Bewegung mit erhöhtem Puls zusammen, das passt zur WHO-Empfehlung von ${min} bis ${max} Minuten.` });
  }
  // Strength days only say something when the week is otherwise measured.
  if ((week.activeMin !== undefined || week.steps !== undefined) && week.strengthDays !== undefined) {
    const need = ruleValues('health.activity-minutes').strengthDays!;
    out.push(week.strengthDays >= need
      ? { rule: 'health.activity-minutes', tone: 'gut', text: `Muskelkräftigung an ${week.strengthDays} Tagen, die WHO empfiehlt mindestens ${need}.` }
      : { rule: 'health.activity-minutes', tone: 'info', text: `Die WHO empfiehlt Muskelkräftigung an mindestens ${need} Tagen pro Woche; letzte Woche ${week.strengthDays === 0 ? 'gab es keinen solchen Tag' : 'war es ein Tag'}.` });
  }
  return out;
};

const TONE_ORDER: Record<HealthFinding['tone'], number> = { arzt: 0, achtung: 1, info: 2, gut: 3 };

/**
 * The deterministic findings, the conspicuous ones first. Pure; every rule is in the policy register with its source.
 * Missing data gives no finding. Body Battery, stress and ACWR are never used (health.not-used).
 */
export function findingsOf(days: GarminDay[], weeks: HealthWeek[], profile: { birthDate: string | null }, nowMs: number): HealthFinding[] {
  const today = dateKey(nowMs);
  const lastWeek = weeks.find((w) => w.week === mondayOf(addDays(today, -WEEK_DAYS)));
  return [
    ...rhrFindings(days, today), ...rhrLongterm(weeks), ...vo2Trend(weeks, today),
    ...stepsBand(lastWeek, profile.birthDate, nowMs), ...activity(lastWeek),
  ].sort((a, b) => TONE_ORDER[a.tone] - TONE_ORDER[b.tone]);
}
