import { weekdayOfKey } from '../../shared/dates';
import { hasSport, type Sport } from '../../shared/week-plan';
import type { TrackingPort } from '../ports';
import type { ActivityKind } from '../../shared/activities';
import type { Mark } from './kit/StandCard';
import { useWeekDays } from './week-days';
import { cap, numberWord } from './week-path';

export type SportKey = 'kraft' | 'rad' | 'lauf';
export type SportWeek = { marks: Mark[]; done: number; onPlan: number; planned: number | null; next: string | null };

const NAMES: Record<SportKey, { none: string; one: string; many: string; today: string; article: string; dative: string }> = {
  kraft: { none: 'kein Krafttraining', one: 'Ein Krafttraining', many: 'Krafttrainings', today: 'ein Krafttraining', article: 'Das', dative: 'Krafttrainings' },
  rad: { none: 'keine Fahrt', one: 'Eine Fahrt', many: 'Fahrten', today: 'eine Fahrt', article: 'Die', dative: 'Fahrten' },
  lauf: { none: 'kein Lauf', one: 'Einen Lauf', many: 'Läufe', today: 'ein Lauf', article: 'Der', dative: 'Läufen' },
};
const KIND: Record<SportKey, ActivityKind> = { kraft: 'kraft', rad: 'rad', lauf: 'lauf' };
const PLAN_SPORT: Record<SportKey, Sport> = { kraft: 'gym', rad: 'bike', lauf: 'run' };

/** One sport's week: a dot per done day, then a dot per planned day from today on (today = now, later = open). Missed days do not show. */
export function sportWeekOf({ done, planned, today }: { done: string[]; planned: string[] | null; today: string }): SportWeek {
  const doneDays = [...new Set(done)].filter((d) => d <= today);
  const rest = [...new Set(planned ?? [])].filter((d) => d >= today && !doneDays.includes(d)).sort();
  const marks: Mark[] = [...doneDays.map((): Mark => 'done'), ...rest.map((d): Mark => (d === today ? 'now' : 'open'))];
  // A plan without a day of this sport is no plan. `onPlan` counts the done days that were planned.
  const plan = planned?.length ? new Set(planned) : null;
  return { marks, done: doneDays.length, onPlan: plan ? doneDays.filter((d) => plan.has(d)).length : doneDays.length, planned: plan?.size ?? null, next: rest[0] ?? null };
}

export function sportWeekText(sport: SportKey, w: SportWeek, today: string): string {
  const n = NAMES[sport];
  const parts: string[] = [];
  if (w.done === 0) parts.push(`Diese Woche ist noch ${n.none} erledigt.`);
  else if (w.done === 1) parts.push(`${n.one} hast du geschafft.`);
  else parts.push(`${cap(numberWord(w.done))} ${n.many} hast du geschafft.`);
  if (w.next === today) parts.push(`Heute ist ${n.today} dran.`);
  else if (w.next) parts.push(`${n.article} nächste kommt am ${weekdayOfKey(w.next)}.`);
  else if (w.planned !== null && w.onPlan >= w.planned) parts.push('Damit ist alles geschafft, was geplant war.');
  return parts.join(' ');
}

export function sportWeekLabel(sport: SportKey, w: SportWeek): string {
  if (w.planned === null) return `${w.done} geschafft`;
  return `${w.onPlan} von ${w.planned} ${NAMES[sport].dative}`;
}

export function useSportWeek(port: TrackingPort, nowMs: number, sport: SportKey): SportWeek & { text: string; label: string; loaded: boolean } {
  const { rows, today, current, spontaneous, runs, loaded } = useWeekDays(port, nowMs);
  const done = rows.filter((r) => r.kinds.includes(KIND[sport])).map((r) => r.date);
  const runDays = sport === 'lauf' ? runs.map((r) => r.date) : [];
  const fromPlan = current && !spontaneous ? current.days.filter((d) => hasSport(d, PLAN_SPORT[sport])).map((d) => d.date) : null;
  const planned = fromPlan === null && runDays.length === 0 ? null : [...new Set([...(fromPlan ?? []), ...runDays])];
  const w = sportWeekOf({ done, planned, today });
  return { ...w, text: sportWeekText(sport, w, today), label: sportWeekLabel(sport, w), loaded };
}
