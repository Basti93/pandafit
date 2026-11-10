import type { CoachPrefs } from '../../shared/chat';
import { lastSundayOf } from '../../shared/dates';
import type { GoalBody } from '../../shared/personal';
import { ruleNumber } from '../../shared/training-policy';
import { dateKey } from '../day-load';

export type ReviewReason = 'month' | 'sports' | 'pause';

/** The sports focus of a goal as text, so a change of focus can be told from the last review. */
export function sportsKeyOf(goal: Pick<GoalBody, 'sports'>): string {
  return Object.entries(goal.sports).sort(([a], [b]) => a.localeCompare(b)).map(([k, v]) => `${k}:${v}`).join(',');
}

const dayNumber = (key: string): number => { const [y, m, d] = key.split('-').map(Number); return Date.UTC(y!, m! - 1, d!) / 86_400_000; };

/** Why a monthly review is due now, or null. Limits come from the rule register. */
export function reviewDue(o: {
  prefs: CoachPrefs; sportsKey: string; gymDates: readonly string[];
  sent: { review?: string; reviewSports?: string }; nowMs: number;
}): ReviewReason | null {
  if (!o.prefs.review.on) return null;
  const today = dateKey(o.nowMs);
  const now = dayNumber(today);
  if (o.sent.review && now - dayNumber(o.sent.review) < ruleNumber('review.min-gap-days')) return null;

  const days = [...new Set(o.gymDates)].filter((d) => d <= today).sort();
  const last = days[days.length - 1];
  const before = days[days.length - 2];
  if (last && before && now - dayNumber(last) <= 2 && dayNumber(last) - dayNumber(before) > ruleNumber('review.pause-days')) return 'pause';

  const window = ruleNumber('review.window-days');
  const enough = days.filter((d) => now - dayNumber(d) < window).length >= ruleNumber('review.min-workouts');
  if (!enough) return null;
  if (o.sent.reviewSports && o.sent.reviewSports !== o.sportsKey) return 'sports';
  if (today === lastSundayOf(today) && new Date(o.nowMs).getHours() >= o.prefs.week.hour && o.sent.review !== today) return 'month';
  return null;
}
