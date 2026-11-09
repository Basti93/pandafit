import { bodyOf } from '../../../shared/record-bodies';
import type { GymWorkout } from '../../../shared/gym/types';
import type { Exercise } from '../../../shared/exercises';
import { excludedIds } from '../../../shared/personal';
import { dateKey } from '../../../shared/day-rating';
import { frameOf } from '../../../shared/frame';
import { HARDNESS_LABEL, hasSport, planFor, SPORT_LABEL } from '../../../shared/week-plan';
import type { TrackedRecord } from '../../../shared/records';
import type { TrackingPort } from '../../ports';
import { startFromPlan, type TrackedWorkout } from '../../session';
import { takenChanges } from '../../../shared/changes';
import { loadStepOverrides } from '../../../shared/loads';
import type { StudioState } from '../../../shared/studio';
import { finishedWorkouts } from '../hooks';

/** One exercise of the plan in a line: "Bankdrücken · 3 × 8 · 60 kg". Warm-ups are not counted. */
export function planLine(e: GymWorkout['exercises'][number]): string {
  const work = e.sets.filter((s) => s.type !== 'warmup');
  const reps = [...new Set(work.map((s) => (s.repRange ? `${s.repRange.start}–${s.repRange.end}` : s.reps)).filter((r) => r != null))];
  const kg = [...new Set(work.map((s) => s.weightKg).filter((w): w is number => w != null && w > 0))];
  const parts = [e.title];
  if (work.length > 0) parts.push(reps.length === 1 ? `${work.length} × ${reps[0]}` : `${work.length} Sätze`);
  if (kg.length === 1) parts.push(`${String(kg[0]).replace('.', ',')} kg`);
  return parts.join(' · ');
}

/**
 * Everything a start from a plan computes before the workout begins: rules, load steps, taken changes, history, frame and week plan.
 * The preview ("Ansehen und anpassen") shows exactly this workout. Every read that fails starts without it.
 * The changes taken for the next workout go in when it starts and are listed in the workout; each is marked used only when the
 * workout is finished (a thrown-away one leaves them taken). A listing workout stops a change from applying twice.
 * The notice (ops that no longer fit, the second session of today) is for the rider's screen only; it is not workout data.
 */
export async function prepareStart(port: TrackingPort, g: GymWorkout, ctx: { now: () => number; newId: () => string; catalog: Exercise[]; studio?: string; studios: StudioState }): Promise<{ workout: TrackedWorkout; notice: string | null; /** Only the line about today's second session: what a start from a draft says (the skipped lines are about the plan). */ also: string | null }> {
  const { now, newId, catalog, studio, studios } = ctx;
  let changeRecs: TrackedRecord[] = [], records: TrackedRecord[] = [], overrides = loadStepOverrides([], studios.renames), excludedNow: ReadonlySet<string> = new Set();
  try { excludedNow = excludedIds(await port.list('rule'), catalog); } catch { /* start without them */ }
  try { overrides = loadStepOverrides(await port.list('loadstep'), studios.renames); changeRecs = await port.list('change'); } catch { /* start without them: they stay taken for the next time */ }
  // The workouts on their own: a failed load step or change read never empties the history the weights come from.
  try { records = await port.list('workout'); } catch { /* start without the history */ }
  const live = records.filter((r) => !r.deleted);
  const all = live.map((r) => bodyOf('workout', r));
  const history = finishedWorkouts(live);
  let noLegs = false, alsoNote: string | null = null;
  try {
    // Spontaneous mode has no week plan: the plan day checks do not apply. A failed frame read keeps them.
    let spontaneous = false;
    try { spontaneous = frameOf(await port.list('frame'), dateKey(now())).mode === 'spontaneous'; } catch { /* keep the checks */ }
    const day = spontaneous ? null : planFor(await port.list('weekplan'), dateKey(now()));
    noLegs = !!day && day.legs === false && hasSport(day, 'gym');
    // The second session of today with minutes is part of the agreement: say it at the start.
    if (day && day.sport === 'gym' && day.also && day.also.sport !== 'gym' && day.also.minutes) alsoNote = `Dazu heute: ${day.also.minutes} Min. ${SPORT_LABEL[day.also.sport]} ${HARDNESS_LABEL[day.also.hardness]}.`;
  } catch { /* start with the plan as it is */ }
  let skipped: string[] = [];
  const w = startFromPlan(g, history, now(), newId(), catalog, studio, studios, { changes: takenChanges(changeRecs), workouts: all, overrides, excluded: excludedNow, noLegs, onSkipped: (l) => { skipped = l; } });
  return { workout: studio ? { ...w, studio } : w, notice: [...skipped, ...(alsoNote ? [alsoNote] : [])].join(' ') || null, also: alsoNote };
}
