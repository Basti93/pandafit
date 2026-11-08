import { HARDNESS_LABEL, SPORT_LABEL, dayParts, minutesText, type PlanDay } from '../../shared/week-plan';
import type { PlannedRun } from '../../shared/run';

const RUN_KIND: Record<string, string> = { easy: 'locker', long: 'lang', test: 'Test' };

/** One planned session in words, parts joined with " · ": "Laufen · 35 Min · locker · Puls bis 150". */
export const runText = (r: PlannedRun & { done?: unknown }): string =>
  ['Laufen', `${r.minutes} Min`, RUN_KIND[r.kind] ?? '', ...(r.hrCap !== null ? [`Puls bis ${r.hrCap}`] : []), ...(r.done != null ? ['gelaufen'] : [])].filter(Boolean).join(' · ');

/** A plan day as one line: "Kraft · mittel", "Kraft · mittel · mit Beinen", "Rad · locker + Kraft · mittel", "Ruhetag". */
export function planDayText(d: PlanDay, opts: { legs?: boolean } = {}): string {
  return dayParts(d).map((p, i) => {
    if (p.sport === 'rest') return 'Ruhetag';
    const extra = [i === 0 && d.long ? 'lang' : '', opts.legs && p.sport === 'gym' && d.legs ? 'mit Beinen' : '', minutesText(p)].filter(Boolean);
    return [SPORT_LABEL[p.sport], HARDNESS_LABEL[p.hardness], ...extra].join(' · ');
  }).join(' + ');
}
