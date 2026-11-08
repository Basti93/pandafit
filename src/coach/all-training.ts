import { overlapsByHalf } from '../shared/overlap';

export { overlapsByHalf, type Span } from '../shared/overlap';
export type Source = 'rad' | 'kraft' | 'andere';
export type TrainingInput = {
  /** Rides recorded in this app. */
  rides?: { rideId: string; startedAtMs: number; durationS: number; sessionName?: string }[] | null;
  /** Hevy workouts. */
  workouts?: { id: string; title: string; startMs: number; durationS: number }[] | null;
  /** Garmin activities. */
  activities?: { id: string; startMs: number; durationS: number; sport: string; name: string | null; fromBikeCoach: boolean }[] | null;
};
export type Part = { sessions: number; minutes: number };
export type TrainingWeek = { weekStartMs: number; rad: Part; kraft: Part; andere: Part; sessions: number; minutes: number };
export type TrainingSession = { key: string; source: Source; title: string | null; sport?: string; startMs: number; minutes: number };
export type AllTraining = { weeks: TrainingWeek[]; recent: TrainingSession[]; sources: Source[] };

const WEEKS = 12;
const RECENT = 10;
export const CYCLING = /cycling|biking|ride|bike/i;
export const STRENGTH = /strength/i;

/** Every session from the three inputs, each once. A Garmin copy of a ride or workout from this app is left out. */
export const trainingSessions = (input: TrainingInput): TrainingSession[] => {
  const rides = input.rides ?? [];
  const workouts = input.workouts ?? [];
  const sessions: TrainingSession[] = [
    ...rides.map((r): TrainingSession => ({ key: `rad-${r.rideId}`, source: 'rad', title: r.sessionName ?? null, startMs: r.startedAtMs, minutes: r.durationS / 60 })),
    ...workouts.map((w): TrainingSession => ({ key: `kraft-${w.id}`, source: 'kraft', title: w.title, startMs: w.startMs, minutes: w.durationS / 60 })),
  ];
  for (const a of input.activities ?? []) {
    const ownRide = CYCLING.test(a.sport) && rides.some((r) => overlapsByHalf({ startMs: r.startedAtMs, durationS: r.durationS }, a));
    const ownWorkout = STRENGTH.test(a.sport) && workouts.some((w) => overlapsByHalf(w, a));
    if (ownRide || ownWorkout) continue;
    // A ride from this app that exists only at Garmin is still a ride from this app.
    sessions.push({ key: `garmin-${a.id}`, source: a.fromBikeCoach ? 'rad' : 'andere', title: a.name, sport: a.sport, startMs: a.startMs, minutes: a.durationS / 60 });
  }
  return sessions;
};

/**
 * Time and number of sessions per week and source, plus the newest sessions, from data that is already local.
 * Only counts and durations are combined: no load, watts or kilos, and no score. A session recorded in two places counts once,
 * as Rad or Kraft. Weeks start on Monday in local time, built from calendar dates because a week is not always 7 x 24 hours.
 */
export const allTraining = (input: TrainingInput, nowMs: number): AllTraining | null => {
  const sessions = trainingSessions(input);
  if (sessions.length === 0) return null;

  const now = new Date(nowMs);
  const monday = new Date(now.getFullYear(), now.getMonth(), now.getDate() - ((now.getDay() + 6) % 7));
  const starts = Array.from({ length: WEEKS + 1 }, (_, i) => new Date(monday.getFullYear(), monday.getMonth(), monday.getDate() - 7 * (WEEKS - 1 - i)).getTime());
  const weeks = starts.slice(0, WEEKS).map((weekStartMs, i): TrainingWeek => {
    const inWeek = sessions.filter((s) => s.startMs >= weekStartMs && s.startMs < (starts[i + 1] ?? Infinity));
    const part = (source: Source): Part => {
      const own = inWeek.filter((s) => s.source === source);
      return { sessions: own.length, minutes: Math.round(own.reduce((a, s) => a + s.minutes, 0)) };
    };
    const rad = part('rad'), kraft = part('kraft'), andere = part('andere');
    return { weekStartMs, rad, kraft, andere, sessions: rad.sessions + kraft.sessions + andere.sessions, minutes: rad.minutes + kraft.minutes + andere.minutes };
  });
  const recent = [...sessions].sort((a, b) => b.startMs - a.startMs).slice(0, RECENT).map((s) => ({ ...s, minutes: Math.round(s.minutes) }));
  const sources = (['rad', 'kraft', 'andere'] as const).filter((s) => sessions.some((x) => x.source === s));
  return { weeks, recent, sources };
};
