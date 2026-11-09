import type { TrackedRecord } from '../../shared/records';
import { weekOf } from '../../shared/meals';
import { shortDateOfKey } from '../../shared/dates';
import { readRunBody, runIdType, type RunNumbers, type RunReviewBody, type RunSettingsBody, type RunStatusBody, type RunWeekBody } from '../../shared/run';

export type RunView = { status: RunStatusBody | null; settings: RunSettingsBody | null; week: RunWeekBody | null; reviews: RunReviewBody[]; visible: boolean };

/** The readable run records. A record whose id and body type disagree is ignored, as is anything deleted or odd. */
export function runView(records: TrackedRecord[], nowMs: number): RunView {
  let status: RunStatusBody | null = null;
  let settings: RunSettingsBody | null = null;
  const weeks: RunWeekBody[] = [];
  const reviews: RunReviewBody[] = [];
  for (const r of records) {
    if (r.deleted) continue;
    const body = readRunBody(r.body);
    if (!body || runIdType(r.id) !== body.type) continue;
    if (body.type === 'status') status = body;
    else if (body.type === 'settings') settings = body;
    else if (body.type === 'week') weeks.push(body);
    else if (body.type === 'review') reviews.push(body);
  }
  // This week's plan; before it exists, the next one that does.
  const current = weekOf(nowMs);
  const week = weeks.find((w) => w.week === current) ?? weeks.filter((w) => w.week > current).sort((a, b) => a.week.localeCompare(b.week))[0] ?? null;
  reviews.sort((a, b) => b.week.localeCompare(a.week));
  return { status, settings, week, reviews, visible: !!(status?.on || status?.suggest) };
}

/** Writes follow the existing pattern: always above what is there, tombstones included. */
export const nextUpdatedMs = (now: number, have: TrackedRecord | undefined): number => Math.max(now, (have?.updatedMs ?? 0) + 1);

export const DAY_NAMES = ['Montag', 'Dienstag', 'Mittwoch', 'Donnerstag', 'Freitag', 'Samstag', 'Sonntag'] as const;
export const DAY_SHORT = ['Mo', 'Di', 'Mi', 'Do', 'Fr', 'Sa', 'So'] as const;

export const dateKeyOf = (ms: number): string => {
  const d = new Date(ms);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
};
/** "Mi., 4. Nov." */
export const dayText = (key: string): string => shortDateOfKey(key);
export const kmFromKm = (km: number): string => `${km.toFixed(1).replace('.', ',')} km`;

/** One sentence without a number: the easy pace now, against the oldest value there is (12 weeks, else 4). */
export function runTrendSentence(n: RunNumbers): string | null {
  const { now, weeks4, weeks12 } = n.easyPace;
  const [then, label] = weeks12 !== null ? [weeks12, 'vor 12 Wochen'] : [weeks4, 'vor 4 Wochen'];
  if (now === null || then === null) return null;
  const d = Math.round(then) - Math.round(now);
  return d > 0 ? 'Du wirst bei gleichem Puls schneller.' : d < 0 ? `Du bist gerade etwas langsamer als ${label}.` : 'Dein ruhiges Tempo ist gleich geblieben.';
}
