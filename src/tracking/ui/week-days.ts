import { addDays, mondayOf, planOfWeek } from '../../shared/week-plan';
import type { PlannedRun } from '../../shared/run';
import { localDayKey } from '../../shared/dates';
import type { TrackingPort } from '../ports';
import { doneDays, mergedActivities, type DayRow } from './done-days';
import { useTodayAdvice } from './frame-hooks';
import { usePortRecords } from './hooks';
import { runView } from './run-view';

/**
 * The one source of the week: Heute (the week path) and Woche (the list) read the same rows.
 * Monday to today in Spontan mode or without a plan, else the whole week; every activity counts once.
 */
export function useWeekDays(port: TrackingPort, nowMs: number): {
  today: string; monday: string; dates: string[]; rows: DayRow[]; current: ReturnType<typeof planOfWeek>; next: ReturnType<typeof planOfWeek>;
  runs: PlannedRun[]; spontaneous: boolean; loaded: boolean; frame: ReturnType<typeof useTodayAdvice>;
} {
  const plans = usePortRecords(port, 'weekplan').all;
  const runRecords = usePortRecords(port, 'run').all;
  const activityRecords = usePortRecords(port, 'activities').all;
  const workoutRecords = usePortRecords(port, 'workout').all;
  const frame = useTodayAdvice(port, nowMs);

  const today = localDayKey(nowMs);
  const monday = mondayOf(today);
  const current = planOfWeek(plans ?? [], monday);
  const next = planOfWeek(plans ?? [], addDays(monday, 7));
  // The run coach's runs sit on their days; without a week plan they are listed on their own.
  const runs = runView(runRecords ?? [], nowMs).week?.runs ?? [];
  const dates = Array.from({ length: 7 }, (_, i) => addDays(monday, i));
  // Without a week plan (or in Spontan) the week still shows Monday to today, from what was done.
  const spontaneous = frame.frame.mode === 'spontaneous';
  const rowDates = current && !spontaneous ? dates : dates.filter((d) => d <= today);
  const merged = mergedActivities(activityRecords, workoutRecords, true);
  const rows = doneDays(rowDates, today, spontaneous ? null : current?.days ?? null, merged);
  return { today, monday, dates, rows, current, next, runs, spontaneous, loaded: plans !== null, frame };
}
