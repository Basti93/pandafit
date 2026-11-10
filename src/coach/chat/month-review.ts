import { DEFAULT_PREFS, type CoachPrefs } from '../../shared/chat';
import { lastSundayOf } from '../../shared/dates';
import type { GoalBody } from '../../shared/personal';
import { ruleNumber } from '../../shared/training-policy';
import { dateKey } from '../day-load';
import type { SentPrompts } from './prompts';

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
  if (o.sent.reviewSports !== undefined && o.sent.reviewSports !== o.sportsKey) return 'sports';
  if (today === lastSundayOf(today) && new Date(o.nowMs).getHours() >= (o.prefs.week.on ? o.prefs.week.hour : DEFAULT_PREFS.week.hour) && o.sent.review !== today) return 'month';
  return null;
}

/**
 * The scan's step for the monthly review of one profile. The first time it only remembers the sports focus, so a review is never
 * sent just because nothing was remembered yet. When a review is due and the last try is at least `retryMs` ago, it opens the
 * review; only a review really written marks the day and the sports focus, so a failing Claude tries again later and a written
 * one is never sent twice. Returns the attempt, or null when nothing was tried.
 */
export function startReview(o: {
  id: string; prefs: CoachPrefs; sportsKey: string; gymDates: readonly string[]; nowMs: number;
  sent: Pick<SentPrompts, 'get' | 'mark'>; tried: Map<string, number>; retryMs: number;
  open: (id: string, reason: ReviewReason) => Promise<boolean>;
}): Promise<boolean> | null {
  const had = o.sent.get(o.id);
  if (had.reviewSports === undefined) { o.sent.mark(o.id, 'reviewSports', o.sportsKey); return null; }
  const reason = reviewDue({ prefs: o.prefs, sportsKey: o.sportsKey, gymDates: o.gymDates, sent: had, nowMs: o.nowMs });
  if (!reason || o.nowMs - (o.tried.get(o.id) ?? 0) < o.retryMs) return null;
  o.tried.set(o.id, o.nowMs);
  const today = dateKey(o.nowMs);
  return o.open(o.id, reason).then((wrote) => {
    if (wrote) { o.sent.mark(o.id, 'review', today); o.sent.mark(o.id, 'reviewSports', o.sportsKey); }
    return wrote;
  });
}
