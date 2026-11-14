import { DEFAULT_PREFS, type CoachPrefs } from '../../shared/chat';
import { lastSundayOf } from '../../shared/dates';
import type { GoalBody, Push } from '../../shared/personal';
import { ruleNumber } from '../../shared/training-policy';
import { dateKey } from '../day-load';
import { QUESTION_GAP_DAYS } from '../motivation';
import type { Sent, SentPrompts } from './prompts';
import { atLeast, experienceFromData, experienceOf, type Experience } from '../../shared/experience';

export type ReviewReason = 'month' | 'sports' | 'pause';
/** What opening a review did: nothing written, written, or written and it asked how hard Bo may push. */
export type ReviewOpened = false | 'written' | 'asked';

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
 * one is never sent twice. A review that really asked how hard Bo may push also marks `pushAsk`, the one marker for that
 * question. Returns the attempt, or null when nothing was tried.
 */
export function startReview(o: {
  id: string; prefs: CoachPrefs; sportsKey: string; gymDates: readonly string[]; nowMs: number;
  sent: Pick<SentPrompts, 'get' | 'mark'>; tried: Map<string, number>; retryMs: number;
  /** `askPush`: Bo has not asked yet how hard he may push, so the review asks (unless it was chosen or a complaint is open). */
  open: (id: string, reason: ReviewReason, askPush: boolean) => Promise<ReviewOpened>;
}): Promise<ReviewOpened> | null {
  const had = o.sent.get(o.id);
  if (had.reviewSports === undefined) { o.sent.mark(o.id, 'reviewSports', o.sportsKey); return null; }
  const reason = reviewDue({ prefs: o.prefs, sportsKey: o.sportsKey, gymDates: o.gymDates, sent: had, nowMs: o.nowMs });
  if (!reason || o.nowMs - (o.tried.get(o.id) ?? 0) < o.retryMs) return null;
  o.tried.set(o.id, o.nowMs);
  const today = dateKey(o.nowMs);
  return o.open(o.id, reason, had.pushAsk === undefined).then((opened) => {
    if (opened) { o.sent.mark(o.id, 'review', today); o.sent.mark(o.id, 'reviewSports', o.sportsKey); }
    if (opened === 'asked') o.sent.mark(o.id, 'pushAsk', today);
    return opened;
  });
}

/** The question alone comes from this hour of the day until the evening hour. */
const PUSH_ASK_FROM_HOUR = 8;
/** After a message Bo sent by himself, the question alone waits this long. */
const PUSH_ASK_QUIET_MS = 3 * 3_600_000;

type AskWindow = {
  sent: Sent; prefs: CoachPrefs; nowMs: number;
  /** A review attempt is running now. */
  reviewOpen: boolean; reviewTriedMs?: number; retryMs: number;
  /** When Bo's last message of his own (with a push) was written. */
  lastPushMs?: number;
  lastQuestionMs?: number;
};

/**
 * Whether Bo may ask one of his structured questions alone now: not while a review is being written or was tried within
 * `retryMs` (it may ask itself), not within three hours of Bo's last message of his own, only from 8 o'clock until the evening
 * hour, and the last question of Bo at least QUESTION_GAP_DAYS ago.
 */
function askWindowOpen(o: AskWindow): boolean {
  if (o.reviewOpen || (o.reviewTriedMs !== undefined && o.nowMs - o.reviewTriedMs < o.retryMs)) return false;
  if (o.lastPushMs !== undefined && o.nowMs - o.lastPushMs < PUSH_ASK_QUIET_MS) return false;
  const hour = new Date(o.nowMs).getHours();
  if (hour < PUSH_ASK_FROM_HOUR || hour >= (o.prefs.evening.on ? o.prefs.evening.hour : DEFAULT_PREFS.evening.hour)) return false;
  if (o.lastQuestionMs !== undefined && o.nowMs - o.lastQuestionMs < QUESTION_GAP_DAYS * 86_400_000) return false;
  return true;
}

/** The person's experience as the scan sees it: the strength dates of every source and the stored answer. */
export const experienceNow = (goal: { experience?: Experience }, gymDates: readonly string[], nowMs: number): Experience =>
  experienceOf({ dates: gymDates, ...(goal.experience ? { answer: goal.experience } : {}), today: dateKey(nowMs) });

/** Whether Bo may ask how hard he may push at all: only from `einige` on (a person who starts trains without failure anyway). */
export const pushAllowed = (goal: { experience?: Experience }, gymDates: readonly string[], nowMs: number): boolean =>
  atLeast(experienceNow(goal, gymDates, nowMs), 'einige');

/**
 * Whether Bo asks now, outside a review, how hard he may push: never chosen, no open or healing complaint (then gentle applies
 * by itself), experience at least `einige`, at least `push.ask-after-workouts` strength days and no earlier ask (`pushAsk`, also
 * set by a review that asked), and the window for a question alone is open (askWindowOpen).
 */
export function pushAskDue(o: AskWindow & { goal: { push?: Push; experience?: Experience }; complaints: readonly { status: string }[]; gymDates: readonly string[] }): boolean {
  if (o.goal.push !== undefined || o.sent.pushAsk !== undefined) return false;
  if (o.complaints.some((c) => c.status === 'active' || c.status === 'healing')) return false;
  if (!askWindowOpen(o)) return false;
  if (!pushAllowed(o.goal, o.gymDates, o.nowMs)) return false;
  const today = dateKey(o.nowMs);
  return new Set(o.gymDates.filter((d) => d <= today)).size >= ruleNumber('push.ask-after-workouts');
}

/**
 * Whether Bo asks now how long the person trains with weights: once (`expAsk`, also set by "Später"), never after an answer,
 * only for a person who trains strength, and only while the data shows less than `erfahren` (the estimate is the higher of
 * the answer and the data, so above that the answer changes nothing). Not while a history is still loading (`historyReady`
 * false, e.g. the first Hevy import), since the data could still show more. The window for a question alone must be open.
 */
export function experienceAskDue(o: AskWindow & { goal: { experience?: Experience }; gymDates: readonly string[]; strength: boolean; historyReady: boolean }): boolean {
  if (o.goal.experience !== undefined || o.sent.expAsk !== undefined || !o.strength || !o.historyReady) return false;
  if (experienceFromData(o.gymDates, dateKey(o.nowMs)) === 'erfahren') return false;
  return askWindowOpen(o);
}
