import { DEFAULT_PREFS, type CoachPrefs } from '../../shared/chat';
import { lastSundayOf } from '../../shared/dates';
import type { GoalBody, Push } from '../../shared/personal';
import { ruleNumber } from '../../shared/training-policy';
import { dateKey } from '../day-load';
import { QUESTION_GAP_DAYS } from '../motivation';
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
  /** `askPush`: the first review (none written before, and Bo has not asked on his own yet) also asks how hard Bo may push. */
  open: (id: string, reason: ReviewReason, askPush: boolean) => Promise<boolean>;
}): Promise<boolean> | null {
  const had = o.sent.get(o.id);
  if (had.reviewSports === undefined) { o.sent.mark(o.id, 'reviewSports', o.sportsKey); return null; }
  const reason = reviewDue({ prefs: o.prefs, sportsKey: o.sportsKey, gymDates: o.gymDates, sent: had, nowMs: o.nowMs });
  if (!reason || o.nowMs - (o.tried.get(o.id) ?? 0) < o.retryMs) return null;
  o.tried.set(o.id, o.nowMs);
  const today = dateKey(o.nowMs);
  return o.open(o.id, reason, had.review === undefined && had.pushAsk === undefined).then((wrote) => {
    if (wrote) { o.sent.mark(o.id, 'review', today); o.sent.mark(o.id, 'reviewSports', o.sportsKey); }
    return wrote;
  });
}

/**
 * Whether Bo asks now, outside a review, how hard he may push: never chosen, no open or healing complaint (then gentle applies
 * by itself), at least `push.ask-after-workouts` strength days, no review yet (the first review asks) and no earlier ask, and
 * the last question of Bo at least QUESTION_GAP_DAYS ago.
 */
export function pushAskDue(o: {
  goal: { push?: Push }; complaints: readonly { status: string }[]; gymDates: readonly string[];
  sent: { review?: string; pushAsk?: string }; lastQuestionMs?: number; nowMs: number;
}): boolean {
  if (o.goal.push !== undefined || o.sent.review !== undefined || o.sent.pushAsk !== undefined) return false;
  if (o.complaints.some((c) => c.status === 'active' || c.status === 'healing')) return false;
  if (o.lastQuestionMs !== undefined && o.nowMs - o.lastQuestionMs < QUESTION_GAP_DAYS * 86_400_000) return false;
  const today = dateKey(o.nowMs);
  return new Set(o.gymDates.filter((d) => d <= today)).size >= ruleNumber('push.ask-after-workouts');
}
