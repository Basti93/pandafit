import type { StrengthWorkout } from './hevy';

const DAY_MS = 86_400_000;
const RECENT_DAYS = 14;
const MAX_RECENT = 8;
const MAX_EXERCISES = 8;
const MAX_MONTHS = 24;

/** Bounded however long the history gets: the last two weeks in detail, older months only as totals. */
export const strengthPromptData = (workouts: StrengthWorkout[], nowMs: number): object | null => {
  if (workouts.length === 0) return null;
  const from = nowMs - RECENT_DAYS * DAY_MS;
  const letzte14Tage = workouts.filter((w) => w.startMs >= from && w.startMs <= nowMs).slice(-MAX_RECENT).map((w) => ({
    tag: new Date(w.startMs).toISOString().slice(0, 10), titel: w.title, minuten: Math.round(w.durationS / 60),
    uebungen: w.exercises.slice(0, MAX_EXERCISES).map((e) => ({ name: e.title, saetze: e.sets, wdh: e.reps, volumenKg: e.volumeKg })),
  }));
  const months = new Map<string, { monat: string; anzahl: number; stunden: number; volumenKg: number }>();
  for (const w of workouts.filter((x) => x.startMs < from)) {
    const monat = new Date(w.startMs).toISOString().slice(0, 7);
    const row = months.get(monat) ?? { monat, anzahl: 0, stunden: 0, volumenKg: 0 };
    row.anzahl += 1;
    row.stunden += w.durationS / 3600;
    row.volumenKg += w.exercises.reduce((a, e) => a + e.volumeKg, 0);
    months.set(monat, row);
  }
  const oldest = new Date(nowMs);
  oldest.setUTCMonth(oldest.getUTCMonth() - MAX_MONTHS, 1);
  const first = oldest.toISOString().slice(0, 7);
  const monate = [...months.values()]
    .filter((m) => m.monat >= first)
    .sort((a, b) => a.monat.localeCompare(b.monat))
    .map((m) => ({ ...m, stunden: Math.round(m.stunden * 10) / 10 }));
  return { letzte14Tage, monate };
};

const HEALTH_RECENT = 10;
const HEALTH_WEEKS = 12;
type Totals = { sets: number; volumeKg: number };
/** Warmup sets are not training volume. Falls back to the stored totals, which already leave them out. */
const workTotals = (w: StrengthWorkout): Totals => w.exercises.reduce<Totals>((acc, e) => {
  if (!e.workSets?.length) return { sets: acc.sets + e.sets, volumeKg: acc.volumeKg + e.volumeKg };
  const work = e.workSets.filter((s) => s.type !== 'warmup');
  return { sets: acc.sets + work.length, volumeKg: acc.volumeKg + Math.round(work.reduce((a, s) => a + (s.weightKg ?? 0) * (s.reps ?? 0), 0)) };
}, { sets: 0, volumeKg: 0 });

/** Only from local workouts. Weeks start on Monday in local time; built from calendar dates, as a week is not always 7 x 24 hours. */
export const strengthHealth = (workouts: StrengthWorkout[], nowMs: number) => {
  const now = new Date(nowMs);
  const monday = new Date(now.getFullYear(), now.getMonth(), now.getDate() - ((now.getDay() + 6) % 7));
  const starts = Array.from({ length: HEALTH_WEEKS + 1 }, (_, i) => new Date(monday.getFullYear(), monday.getMonth(), monday.getDate() - 7 * (HEALTH_WEEKS - 1 - i)).getTime());
  const weeks = starts.slice(0, HEALTH_WEEKS).map((weekStartMs, i) => {
    const inWeek = workouts.filter((w) => w.startMs >= weekStartMs && w.startMs < (starts[i + 1] ?? Infinity));
    return { weekStartMs, workouts: inWeek.length, volumeKg: inWeek.reduce((a, w) => a + workTotals(w).volumeKg, 0) };
  });
  const recent = [...workouts].sort((a, b) => b.startMs - a.startMs).slice(0, HEALTH_RECENT).map((w) => ({
    id: w.id, title: w.title, startMs: w.startMs, minutes: Math.round(w.durationS / 60), ...workTotals(w),
  }));
  // Only start and duration of the twelve weeks, for the combined week view.
  const sessions = workouts.filter((w) => w.startMs >= starts[0] && w.startMs < nowMs + DAY_MS).map((w) => ({ id: w.id, title: w.title, startMs: w.startMs, durationS: w.durationS }));
  return { recent, weeks, sessions };
};
export type StrengthHealth = ReturnType<typeof strengthHealth>;
