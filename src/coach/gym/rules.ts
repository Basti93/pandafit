import type { ExerciseTemplate, GymExercise, GymWorkout } from '../../shared/gym/types';
import { RECENT_DAYS } from './limits';
import { muscleGroupOf, repRangeOf } from '../../shared/muscle-targets';
import { LEG_MUSCLES, availableExercises, isRepBased, ladderFor, recentLegWork } from './history';
import { isExcluded } from '../../shared/excluded';
import { balanceEntryOf, checkWorkout, executionKeyOf, isCoreExercise, isCoreOfSection, placedSuggestion, saturatedIsolationGroups, type GymContext } from './guardrails';
import { MAX_SESSION_FRACTIONAL_SETS } from './limits';
import { isolationGroupOf, sessionSetsByGroup } from '../../shared/gym/session-limits';
import { contributions } from '../../shared/muscle-balance';
import { resolveCatalogEntry } from '../../shared/excluded';
import { hardSetsOf, musclesOfFrom, preFatigue } from './pre-fatigue';
import { warmupRamp, workingWeightOf } from '../../shared/warmup';
import { EXERCISES, type Exercise } from '../../shared/exercises';
import { durationNote, gymLimit, gymMinutes } from '../../shared/duration';

const DAY_MS = 86_400_000;
const CORE_SIZE = 6;
const SETS = 3;
const START_REPS = 10;
const FALLBACK_MUSCLES = ['quadriceps', 'chest', 'lats', 'front_delts', 'side_delts', 'hamstrings', 'triceps', 'biceps'];

function exerciseOf(t: ExerciseTemplate, ctx: GymContext, preSets: number): GymExercise {
  const s = placedSuggestion(t.id, t, ctx, preSets).here;
  const range = repRangeOf(t);
  const reps = s.why === 'none' ? Math.min(range.max, Math.max(range.min, START_REPS)) : s.reps;
  const sets = Array.from({ length: SETS }, () => ({ type: 'normal' as const, weightKg: s.weightKg, reps }));
  return { templateId: t.id, title: t.title, restS: null, supersetId: null, notes: '', sets };
}

/** The exercises in this order, each with the load its place allows. */
function exercisesOf(templates: ExerciseTemplate[], ctx: GymContext): GymExercise[] {
  const muscleOf = musclesOfFrom(ctx.templates, ctx.catalog ?? []);
  const pre = preFatigue(templates.map((t) => ({ ...muscleOf(t.id), primaryMuscle: muscleOf(t.id)?.primaryMuscle, hardSets: SETS, supersetId: null })));
  return templates.map((t, i) => exerciseOf(t, ctx, pre[i]!));
}

/** The first exercise of each muscle group gets the warm-up ramp before its work sets, when its working weight is known. Warm-up sets are outside the set limit. */
function withRamps(templates: ExerciseTemplate[], exercises: GymExercise[], ctx: GymContext): GymExercise[] {
  const seen = new Set<string>();
  const plan = { studio: ctx.studio, overrides: ctx.overrides, renames: ctx.renames };
  return exercises.map((e, i) => {
    const t = templates[i]!;
    const group = muscleGroupOf(t);
    if (seen.has(group)) return e;
    seen.add(group);
    const ramp = warmupRamp({ workingKg: workingWeightOf(e), equipment: t.equipment, type: t.type, ladder: ladderFor(t.id, t, ctx.workouts, ctx.nowMs, plan) });
    if (ramp.length === 0) return e; // warm-ups never count toward the set limit, and never take work sets away
    return { ...e, sets: [...ramp.map((r) => ({ type: 'warmup' as const, weightKg: r.weightKg, reps: r.reps })), ...e.sets] };
  });
}

type Plan = { workout: GymWorkout; reason: string };
const KEEP_SETS = 2;
const HISTORY_NAME = 'Ganzkörper';

/**
 * The plain workout: from the history or, without usable history, simple machine exercises (the minimal plan). Not checked yet.
 * Caller contract: an empty exercise list must never be offered to the rider or written to Hevy.
 */
function plainWorkout(ctx: GymContext, machinesOnly: boolean): Plan {
  const byId = new Map(ctx.templates.map((t) => [t.id, t]));
  const recentLegs = recentLegWork(ctx.workouts, ctx.templates, ctx.nowMs);
  const legsTired = recentLegs || ctx.avoidLegs === true;
  const usable = (t: ExerciseTemplate): boolean => isRepBased(t) && !isExcluded(t, ctx.excluded, ctx.catalog ?? [], ctx.links) && !(legsTired && LEG_MUSCLES.includes(t.primaryMuscle));
  // A group with isolation work in two sessions this week gets none more (a core exercise of the section stays).
  const full = saturatedIsolationGroups(ctx);
  const allowed = (t: ExerciseTemplate): boolean => usable(t) && !(full.size > 0 && full.has(isolationGroupOf(resolveCatalogEntry(t, ctx.catalog ?? [], ctx.links)) ?? ''));
  const since = ctx.nowMs - RECENT_DAYS * DAY_MS;
  const count = new Map<string, number>();
  for (const w of ctx.workouts) {
    if (w.startMs > ctx.nowMs || w.startMs < since) continue;
    for (const id of new Set(w.exercises.map((e) => e.templateId))) if (id) count.set(id, (count.get(id) ?? 0) + 1);
  }
  const lastMs = new Map(availableExercises(ctx.workouts, ctx.nowMs).map((a) => [a.templateId, a.lastMs]));
  // The same execution only once (the more frequent one); the next most frequent exercise fills the place.
  const keys = new Set<string>();
  // Inside a section the core exercises come first; the most frequent ones fill the rest.
  const mustHave = (ctx.block?.core ?? []).filter((c) => !ctx.block!.exempt.has(c))
    .flatMap((c) => { const t = ctx.templates.find((x) => usable(x) && isCoreExercise({ templateId: x.id, title: x.title }, c, ctx)); return t ? [t] : []; });
  for (const t of mustHave) { const key = executionKeyOf({ templateId: t.id, title: t.title }, ctx); if (key !== null) keys.add(key); }
  const frequent = [...count.keys()]
    .map((id) => byId.get(id))
    .filter((t): t is ExerciseTemplate => !!t && allowed(t) && !mustHave.some((m) => m.id === t.id))
    .sort((a, b) => (count.get(b.id)! - count.get(a.id)!) || ((lastMs.get(b.id) ?? 0) - (lastMs.get(a.id) ?? 0)) || a.id.localeCompare(b.id))
    .filter((t) => {
      const key = executionKeyOf({ templateId: t.id, title: t.title }, ctx);
      if (key !== null && keys.has(key)) return false;
      if (key !== null) keys.add(key);
      return true;
    });
  const core = [...mustHave, ...frequent].slice(0, Math.max(CORE_SIZE, mustHave.length));
  if (!machinesOnly && core.length > 0) {
    return {
      workout: { name: HISTORY_NAME, exercises: withRamps(core, exercisesOf(core, ctx), ctx) },
      reason: legsTired && !recentLegs
        ? 'Heute gibt es deine häufigsten Übungen der letzten Monate, ohne Beinarbeit, damit die Beine geschont bleiben.'
        : legsTired
        ? 'Heute gibt es deine häufigsten Übungen der letzten Monate, ohne schwere Beinarbeit, weil die Beine noch Pause brauchen.'
        : 'Heute gibt es deine häufigsten Übungen der letzten Monate in ruhigem Aufbau, damit sich Fortschritt gut messen lässt.',
    };
  }
  const machines = ctx.templates.filter((t) => t.equipment === 'machine' && allowed(t));
  const fill = FALLBACK_MUSCLES.map((m) => machines.find((t) => t.primaryMuscle === m)).filter((t): t is ExerciseTemplate => !!t && !mustHave.some((m) => m.id === t.id));
  const picked = [...mustHave, ...fill].slice(0, Math.max(CORE_SIZE, mustHave.length));
  if (picked.length === 0) {
    return { workout: { name: 'Ganzkörper', exercises: [] }, reason: 'Ich habe keine passenden Übungen gefunden, deshalb gibt es gerade kein Training. Sobald Hevy mehr Übungen liefert, geht es weiter.' };
  }
  const exercises = withRamps(picked, exercisesOf(picked, ctx), ctx);
  const hasHistory = ctx.workouts.some((w) => w.startMs <= ctx.nowMs);
  const withWeights = exercises.some((e) => e.sets.some((s) => s.weightKg !== null));
  return {
    workout: { name: 'Ganzkörper an Geräten', exercises },
    reason: !hasHistory
      ? 'Du hast noch keine früheren Trainings. Darum gibt es ein einfaches Ganzkörpertraining an Geräten, ohne Gewichte. Taste dich in Ruhe heran.'
      : withWeights
        ? 'Aus deinem Verlauf passt gerade keine Übung gut, deshalb gibt es ein einfaches Ganzkörpertraining an Geräten. Wo du eine Übung schon kennst, steht ein Gewicht aus deinem Verlauf dabei, sonst taste dich in Ruhe heran.'
        : 'Aus deinem Verlauf passt gerade keine Übung gut, deshalb gibt es ein einfaches Ganzkörpertraining an Geräten, ohne Gewichte. Taste dich in Ruhe heran.',
  };
}

/** Cuts a workout to the time: first sets beyond 2 per exercise from the last exercises, then the last exercises. */
function trimToLimit(w: GymWorkout, limit: number, catalog: readonly Exercise[]): GymWorkout {
  const exercises = w.exercises.map((e) => ({ ...e, sets: [...e.sets] }));
  const out = { ...w, exercises };
  while (gymMinutes(out, catalog) > limit) {
    const long = [...exercises].reverse().find((e) => e.sets.length > KEEP_SETS);
    if (long) long.sets.pop();
    else if (exercises.length > 1) exercises.pop();
    else break;
  }
  return out;
}

/** The light week: from the last exercises, sets are taken away until the hard sets fit the cap. Without a cap, the workout stays. A core exercise is only dropped as a last resort. */
export function capLightWeek(w: GymWorkout, ctx: GymContext): GymWorkout {
  const cap = ctx.block?.light ? ctx.block.lightCap : null;
  if (cap === null || cap === undefined) return w;
  const exercises = w.exercises.map((e) => ({ ...e, sets: [...e.sets] }));
  const hard = (e: GymExercise): number => hardSetsOf(e.sets);
  const isCore = (e: GymExercise): boolean => (ctx.block?.core ?? []).some((c) => !ctx.block!.exempt.has(c) && isCoreExercise(e, c, ctx));
  while (exercises.reduce((n, e) => n + hard(e), 0) > cap) {
    const long = [...exercises].reverse().find((e) => hard(e) > 1 && e.sets.some((s) => s.type === 'normal'));
    if (long) { long.sets.splice(long.sets.map((s) => s.type).lastIndexOf('normal'), 1); continue; }
    const extra = exercises.map(isCore).lastIndexOf(false);
    if (extra >= 0) exercises.splice(extra, 1);
    else if (exercises.length > 1) exercises.pop();
    else break;
  }
  return { ...w, exercises };
}

/**
 * No muscle group above the fractional-set limit: from the last exercises, sets are taken away from an exercise of the group, then
 * the exercise itself; a core exercise only loses sets, and only when nothing else is left.
 */
export function capSessionVolume(w: GymWorkout, ctx: GymContext): GymWorkout {
  const exercises = w.exercises.map((e) => ({ ...e, sets: [...e.sets] }));
  const entries = new Map(exercises.map((e) => [e, balanceEntryOf(e, ctx)]));
  const hardOf = (e: GymExercise): number => hardSetsOf(e.sets);
  for (;;) {
    const over = Object.entries(sessionSetsByGroup(exercises.map((e) => ({ exercise: entries.get(e)!, sets: hardOf(e) })))).find(([, n]) => n > MAX_SESSION_FRACTIONAL_SETS)?.[0];
    if (!over) break;
    const hits = exercises.filter((e) => contributions(entries.get(e)!).some((c) => c.group === over)).reverse();
    const plain = hits.filter((e) => !isCoreOfSection(e, ctx));
    const target = plain.find((e) => hardOf(e) > 1) ?? plain[0] ?? hits.find((e) => hardOf(e) > 1);
    if (!target) break;
    if (hardOf(target) > 1) target.sets.splice(target.sets.length - 1 - [...target.sets].reverse().findIndex((s) => s.type !== 'warmup'), 1);
    else exercises.splice(exercises.indexOf(target), 1);
  }
  return { ...w, exercises };
}

/**
 * The workout used when the AI answer fails the check twice, or when there is no AI. It goes through the same check as an
 * AI plan: with a time budget it is trimmed to fit first. A history plan that still fails a guardrail is replaced by the
 * minimal plan (simple machine exercises), which is safe by construction and so offered as it is when it too fails the check
 * only because there is no history (the check refuses unknown equipment). `guard` names why the first plan was dropped.
 * Caller contract: an empty exercise list must never be offered to the rider or written to Hevy.
 */
export function ruleWorkout(ctx: GymContext): Plan & { guard?: string } {
  const limit = ctx.budgetMinutes !== undefined ? gymLimit(ctx.budgetMinutes) : Infinity;
  const catalog = ctx.catalog ?? EXERCISES;
  const finish = (p: Plan, w: GymWorkout): Plan => ({ workout: w, reason: `${p.reason} Dauer ${durationNote(w, catalog)}.` });
  const first = plainWorkout(ctx, false);
  if (first.workout.exercises.length === 0) return first;
  const fromHistory = first.workout.name === HISTORY_NAME;
  let guard: string | undefined;
  if (fromHistory) {
    const checked = checkWorkout(capSessionVolume(capLightWeek(trimToLimit(first.workout, limit, catalog), ctx), ctx), ctx);
    if (checked.ok) return finish(first, checked.workout);
    guard = checked.reason;
  }
  const minimal = fromHistory ? plainWorkout(ctx, true) : first;
  if (minimal.workout.exercises.length === 0) return { ...minimal, ...(guard ? { guard } : {}) };
  const fit = capSessionVolume(capLightWeek(trimToLimit(minimal.workout, limit, catalog), ctx), ctx);
  const again = checkWorkout(fit, ctx);
  const done = finish(minimal, again.ok ? again.workout : fit);
  // Even the smallest plan is longer than the time: say so instead of a number that looks like it fits.
  if (ctx.budgetMinutes !== undefined && gymMinutes(done.workout, catalog) > limit) done.reason = `${done.reason} Das ist länger als deine ${ctx.budgetMinutes} Min.`;
  return { ...done, ...(guard ? { guard } : {}) };
}
