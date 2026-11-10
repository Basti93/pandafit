import type { TrackedRecord } from '../../shared/records';
import { readStats, STATS_ID } from '../../shared/stats';
import { addDays, mondayOf } from '../../shared/week-plan';
import { dateKey } from '../day-load';
import { dataBlock } from '../meals/prompt';

/**
 * How the coaches think long term. Deliberately guidance for Claude, not rules in code: the riders do not follow a multi-week
 * plan strictly, so the coach keeps the long view and judges each week from what really happened.
 */
export const LONG_TERM_GUIDE = `Langfristig: Die Person will über Monate fitter, schneller, stärker und muskulöser werden, ohne Wettkampf und ohne festes Datum. Denk in groben Blöcken von etwa vier Wochen: ungefähr drei Wochen, in denen es Schritt für Schritt etwas mehr wird, dann eine leichtere Woche mit deutlich weniger Umfang bei gleicher Intensität, damit der Körper den Fortschritt einbaut. Das ist eine Richtschnur, kein Plan, an den sich jemand halten muss. Sieh in wochenVerlauf nach, was wirklich passiert ist: Eine ruhige Woche nach mehreren vollen Wochen war schon die Erholung; danach geht es normal weiter. Nach zwei oder mehr ruhigen Wochen steigt man etwas leichter wieder ein als zuletzt, ohne Nachholen. Wirkt die Person müde oder kommen Beschwerden, darf die leichtere Woche früher kommen. Sag nie, dass etwas verpasst wurde; ruhige Wochen sind einfach so, wie sie sind.`;

const WEEKS = 8;

/** The last weeks as data: minutes per sport and hard days, oldest first, from the stats record. Empty without one. */
export function weekHistory(stats: TrackedRecord[], nowMs: number, weeks = WEEKS): { woche: string; minuten: Record<string, number>; harteTage: number; aktuell?: true }[] {
  const body = readStats(stats.find((r) => r.id === STATS_ID && !r.deleted)?.body);
  if (!body) return [];
  const thisMonday = mondayOf(dateKey(nowMs));
  return Array.from({ length: weeks }, (_, i) => addDays(thisMonday, -7 * (weeks - 1 - i))).map((monday) => {
    const end = addDays(monday, 6);
    const days = body.days.filter((d) => d.date >= monday && d.date <= end);
    const minuten: Record<string, number> = {};
    for (const d of days) for (const [s, m] of Object.entries(d.minutes)) if (m > 0) minuten[s] = (minuten[s] ?? 0) + Math.round(m);
    return { woche: monday, minuten, harteTage: days.filter((d) => d.hardness === 'hard').length, ...(monday === thisMonday ? { aktuell: true as const } : {}) };
  });
}

/** The long-term view for a coach's prompt: the week history and the guide. Empty without a stats record. */
export function longTermHint(stats: TrackedRecord[], nowMs: number): string {
  const history = weekHistory(stats, nowMs);
  if (history.length === 0) return '';
  return `\n${dataBlock('wochenVerlauf', history)}\n${LONG_TERM_GUIDE}`;
}
