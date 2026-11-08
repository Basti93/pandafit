import { useMemo } from 'react';
import { dateKey, ratingsFromEntries, type DayRating, type RatingEntry } from '../../shared/day-rating';
import type { Exercise } from '../../shared/exercises';
import { frameOf, frameRecord, type Frame, type FrameBody } from '../../shared/frame';
import { LEG_MUSCLES } from '../../shared/legs';
import { addDays, planFor } from '../../shared/week-plan';
import { todayAdvice, type TodayAdvice } from '../../shared/today';
import type { RunWeekBody } from '../../shared/run';
import type { RideBody } from '../../shared/bike';
import type { LoggedWorkout } from '../../shared/records';
import type { TrackingPort } from '../ports';
import { readStats } from '../../shared/stats';
import { finishedWorkouts, useCatalog, useGoal, usePortRecords } from './hooks';
import { ridesOf } from './bike-view';

const DAYS_BACK = 7;
const RUN_HARDNESS = { test: 'hard', long: 'moderate', easy: 'easy' } as const;

/** The profile's frame and the one way to change it: a write stamped above the stored record. */
export function useFrame(port: TrackingPort, nowMs: number) {
  const all = usePortRecords(port, 'frame').all;
  const date = dateKey(nowMs);
  const frame: Frame = useMemo(() => frameOf(all ?? [], date), [all, date]);
  const save = (patch: Partial<Omit<FrameBody, 'atMs'>>): Promise<unknown> => {
    const have = (all ?? []).find((r) => r.kind === 'frame' && r.id === 'frame');
    const { mode, minutes, today } = { ...frame, ...patch };
    return port.put(frameRecord({ mode, minutes, ...(today ? { today } : {}) }, nowMs, have));
  };
  return {
    frame,
    setMode: (mode: Frame['mode']) => save({ mode }),
    setMinutes: (minutes: number | null) => save({ minutes }),
    /** Today only; null takes the value back. */
    setToday: (minutes: number | null) => save({ today: minutes === null ? undefined : { date, minutes } }),
  };
}

/** The past days as the app knows them: finished workouts, done runs and the rides the coach published (counted like the coach counts them: no tired legs from the bike). */
export function ratingsFromRecords(workouts: LoggedWorkout[], runWeeks: RunWeekBody[], catalog: readonly Exercise[], dates: string[], rides: readonly RideBody[] = []): Record<string, DayRating> {
  const entries: RatingEntry[] = [];
  for (const w of workouts) {
    const legs = w.exercises.some((e) => LEG_MUSCLES.includes(catalog.find((c) => c.id === e.exerciseId)?.primaryMuscle ?? ''));
    entries.push({ date: dateKey(w.startMs), hardness: legs ? 'hard' : 'moderate', legs, minutes: ((w.endMs ?? w.startMs) - w.startMs) / 60_000, sport: 'gym' });
  }
  for (const wk of runWeeks) for (const r of wk.runs) if (r.done !== null) entries.push({ date: r.date, hardness: RUN_HARDNESS[r.kind], legs: false, minutes: r.minutes, sport: 'run' });
  for (const r of rides) entries.push({ date: dateKey(r.startedAtMs), hardness: r.hardness, legs: false, minutes: r.durationS / 60, sport: 'bike' });
  return ratingsFromEntries(entries, dates);
}

/** What fits today, from the app's own records. No readiness here. */
export function useTodayAdvice(port: TrackingPort, nowMs: number): { advice: TodayAdvice; ratings: Record<string, DayRating> } & ReturnType<typeof useFrame> {
  const fr = useFrame(port, nowMs);
  const goal = useGoal(port, nowMs);
  const catalog = useCatalog(port);
  const workouts = usePortRecords(port, 'workout').records;
  const runs = usePortRecords(port, 'run').records;
  const weekplans = usePortRecords(port, 'weekplan').records;
  const stats = usePortRecords(port, 'stats').records;
  const rideRecords = usePortRecords(port, 'ride').records;
  const date = dateKey(nowMs);
  const ratings = useMemo(() => {
    const weeks = (runs ?? []).map((r) => r.body as RunWeekBody).filter((b) => b && b.type === 'week' && Array.isArray(b.runs));
    return ratingsFromRecords(finishedWorkouts(workouts), weeks, catalog, Array.from({ length: DAYS_BACK + 1 }, (_, i) => addDays(date, -i)), ridesOf(rideRecords).map((r) => r.body));
  }, [workouts, runs, catalog, date, rideRecords]);
  // The coach's advice for today counts when it is there (it knows the bike rides); else the app's own.
  const published = useMemo(() => {
    const r = (stats ?? []).find((x) => x.kind === 'stats' && x.id === 'stats' && !x.deleted);
    const a = r ? readStats(r.body)?.advice : undefined;
    if (!a || a.date !== date || a.mode !== fr.frame.mode) return null;
    const { date: _d, mode: _m, ...rest } = a;
    return rest as TodayAdvice;
  }, [stats, date, fr.frame.mode]);
  const own = useMemo(
    () => todayAdvice({ date, ratings, planDay: planFor(weekplans ?? [], date), goal, frame: { mode: fr.frame.mode }, hour: new Date(nowMs).getHours() }),
    [date, ratings, weekplans, goal, fr.frame.mode, nowMs],
  );
  const advice = own.done ? own : published ?? own;
  return { advice, ratings, ...fr };
}
