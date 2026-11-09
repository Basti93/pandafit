import { bodyOf } from '../../shared/record-bodies';
import type { ActivityItem } from '../../shared/activities';
import { localDayKey } from '../../shared/dates';
import type { LoggedWorkout, TrackedRecord } from '../../shared/records';
import { dayParts, type PlanDay } from '../../shared/week-plan';

export const FINISHER_WINDOW_MS = 3 * 3_600_000;
export const LONG_WORKOUT_MIN = 75;

export type Finisher = { cardio: boolean; stretch: true; reason: string | null };

export const STRETCH_ONLY_REASON = 'Heute reicht Dehnen.';

/** The same rule as the web's open complaints: a complaint that is not "over". */
export const complaintsOpenIn = (records: TrackedRecord[] | null): boolean =>
  (records ?? []).some((r) => {
    const b = r.body as { text?: unknown; status?: unknown } | null;
    return !r.deleted && typeof b === 'object' && b !== null && typeof b.text === 'string' && typeof b.status === 'string' && b.status !== 'over';
  });

/**
 * What to suggest after a finished strength workout: easy cardio and stretching, or only stretching when cardio does not fit today.
 * Null while the workout is open or more than three hours over.
 */
export function finisherOf(i: { workout: LoggedWorkout; nowMs: number; today: PlanDay | null; activities: ActivityItem[]; complaintsOpen: boolean }): Finisher | null {
  const end = i.workout.endMs;
  if (end === null || i.nowMs - end > FINISHER_WINDOW_MS) return null;
  const day = localDayKey(end);
  const cardioDone = i.activities.some((a) => (a.kind === 'rad' || a.kind === 'lauf') && localDayKey(a.startMs) === day);
  const cardioPlanned = i.today !== null && dayParts(i.today).some((p) => p.sport === 'bike' || p.sport === 'run');
  const long = (end - i.workout.startMs) / 60000 >= LONG_WORKOUT_MIN;
  const cardio = !(cardioDone || cardioPlanned || i.complaintsOpen || long);
  return { cardio, stretch: true, reason: cardio ? null : STRETCH_ONLY_REASON };
}

/** The newest non-deleted workout that ended on today's local date. */
export function latestFinishedStrength(workouts: TrackedRecord[] | null, nowMs: number): LoggedWorkout | null {
  const today = localDayKey(nowMs);
  let best: LoggedWorkout | null = null;
  for (const r of workouts ?? []) {
    if (r.deleted) continue;
    const w = { ...bodyOf('workout', r), id: r.id };
    // Today, or within the window across midnight (a workout ending 23:30 keeps its card until 02:30).
    if (w.endMs === null || (localDayKey(w.endMs) !== today && !(nowMs - w.endMs >= 0 && nowMs - w.endMs <= FINISHER_WINDOW_MS))) continue;
    if (!best || w.endMs > (best.endMs as number)) best = w;
  }
  return best;
}

export const CARDIO_LINE = 'Mach 20 Min lockeres Cardio auf dem Rad, dem Crosstrainer oder dem Laufband. Du kannst dabei noch reden.';
export const STRETCH_LINE = 'Dehn ein paar Minuten, was sich fest anfühlt.';

/** What to do after the workout in one line: the cardio sentence and the reason; without either, the stretch. */
export const finisherLine = (f: Finisher): string => [f.cardio && CARDIO_LINE, f.reason].filter(Boolean).join(' ') || STRETCH_LINE;
