import type { TrackedRecord } from '../../shared/records';
import { frameOf, type Frame } from '../../shared/frame';
import { dateKey } from '../../shared/day-rating';
import { hasSport, nextPlanDate, planFor } from '../../shared/week-plan';

type Reader = { all(profileId: string, kind?: 'frame' | 'weekplan' | 'workout'): TrackedRecord[] };

const isFinished = (b: unknown): boolean => typeof b === 'object' && b !== null && typeof (b as { startMs?: unknown }).startMs === 'number' && typeof (b as { endMs?: unknown }).endMs === 'number';

/** Read only, like the goal: the coaches never write the person's frame. Unreadable: no frame (week mode, no time). */
export function frameOfProfile(store: Reader, profileId: string, todayDate: string): Frame {
  try { return frameOf(store.all(profileId, 'frame'), todayDate); } catch { return frameOf([], todayDate); }
}

/**
 * The date the gym coach plans for: today in spontaneous mode, else the next gym day of the week plan without a finished
 * workout, else today.
 */
export function gymPlanDateOf(store: Reader, profileId: string, todayDate: string): string {
  try {
    // A day whose strength session is already done needs no plan.
    const done = new Set(store.all(profileId, 'workout').filter((r) => !r.deleted && isFinished(r.body)).map((r) => dateKey((r.body as { startMs: number }).startMs)));
    // Spontaneous: no week plan counts, the session is for today.
    if (frameOf(store.all(profileId, 'frame'), todayDate).mode === 'spontaneous') return todayDate;
    return nextPlanDate(store.all(profileId, 'weekplan'), todayDate, 'gym', (d) => done.has(d)) ?? todayDate;
  } catch { return todayDate; }
}

/** The plan day the gym coach plans for, when the agreed "no legs" holds for it (gym on that day, `legs` false). */
export function gymPlanDayNoLegs(store: Reader, profileId: string, todayDate: string): boolean {
  try {
    const day = planFor(store.all(profileId, 'weekplan'), gymPlanDateOf(store, profileId, todayDate));
    return day !== null && day.legs === false && hasSport(day, 'gym');
  } catch { return false; }
}

/** Short key of the target day and its legs value: changes when a new agreement or a new target day asks for a new plan. */
export function gymLegsKeyOf(store: Reader, profileId: string, todayDate: string): string {
  const date = gymPlanDateOf(store, profileId, todayDate);
  return `${date}:${gymPlanDayNoLegs(store, profileId, todayDate)}`;
}

/**
 * The minutes for the gym session the coach plans: the person's time on the day it is planned for (the next gym day of the
 * week plan, else today). null: no time given.
 */
export function gymBudgetOf(store: Reader, profileId: string, todayDate: string): number | null {
  try {
    return frameOf(store.all(profileId, 'frame'), gymPlanDateOf(store, profileId, todayDate)).effectiveMinutes;
  } catch { return null; }
}
