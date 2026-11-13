import type { Effort } from '../records';
import { extendDown, ladderFrom, nextUp, snapDown, type Ladder, type LoadStepOverrides } from '../loads';
import { repRangeOf } from '../muscle-targets';
import { mainStudio, studioKey, resolveStudio, type Renames } from '../studio';
import { ruleNumber } from '../training-policy';
import { hardSetsOf, positionShare, preFatigue, type Muscles } from './pre-fatigue';
import type { StrengthWorkout } from './types';

const DAY_MS = 86_400_000;
const COMPARABLE_DAYS = ruleNumber('gym.comparable-days');
const FAILURE_PLENTY_MARGIN = ruleNumber('gym.failure-plenty-margin');
const DROP_STEP_BACK = ruleNumber('gym.drop-step-back-count');
const LONG_BREAK_DAYS = ruleNumber('gym.long-break-days');
const MIN_COMPARABLE = ruleNumber('gym.min-comparable');
const PRE_FATIGUE_TOLERANCE = ruleNumber('gym.pre-fatigue-tolerance');
const STAGNATION_SESSIONS = ruleNumber('block.stagnation-sessions');
const STEP_BACK = ruleNumber('gym.step-back-share');

/** The assistance is weight_kg here, so more of it is easier. In this first version its weight is simply kept. */
export const isAssisted = (type: string | undefined): boolean => type === 'bodyweight_assisted' || type === 'bodyweight_assisted_reps';
/** Which way the decision went; the key into REASONS. */
type Path = 'none' | 'all-reps' | 'not-all-reps' | 'few-sessions' | 'zero-left' | 'plenty-left' | 'dropped' | 'long-break' | 'assisted' | 'other-position';
/** The words for each decision path, shown to the person as the reason of the next step. */
export const REASONS: Record<Path, string> = {
  none: '',
  'all-reps': 'weil du alle Wiederholungen geschafft hast',
  'not-all-reps': 'weil du noch nicht alle Wiederholungen geschafft hast',
  'few-sessions': 'weil erst eine Einheit zum Vergleichen da ist',
  'zero-left': 'weil noch 0 übrig waren und die Leistung hält',
  'plenty-left': 'weil noch 3 oder mehr übrig waren',
  dropped: 'weil die Leistung zweimal gesunken ist',
  'long-break': 'weil die letzte Einheit lange her ist',
  assisted: 'weil die Hilfe gleich bleibt',
  'other-position': 'weil die Übung diesmal an anderer Stelle im Training steht',
};
export type Suggestion = { weightKg: number | null; reps: number; why: 'progress' | 'keep' | 'step-back' | 'none'; reason: string };
const done = (weightKg: number | null, reps: number, why: Suggestion['why'], path: Path): Suggestion => ({ weightKg, reps, why, reason: REASONS[path] });

/** What progression needs to know about an exercise: the catalog entry's fields. */
export type ExerciseInfo = { type?: string; equipment?: string; primaryMuscle?: string | null };
/**
 * Where the plan is for: the studio (undefined: the main one) and the person's weight-step overrides. `muscleOf` lets the history
 * see where an exercise stood in each past workout; without it every past session counts as done fresh.
 */
export type Plan = { studio?: string; overrides?: LoadStepOverrides; renames?: Renames; muscleOf?: (templateId: string) => Muscles | undefined };

type Sets = StrengthWorkout['exercises'][number]['workSets'];
/** `preSets`: hard sets for the same muscle before the exercise in that workout. */
type Session = { ms: number; weightKg: number | null; minReps: number; sets: number[]; preSets: number; effort?: Effort };
type Occurrence = { ms: number; sets: Sets; preSets: number; effort?: Effort };

/** The bucket the plan is for. No studio known means the main studio, or the one shared bucket. */
export const plannedKey = (workouts: StrengthWorkout[], plan: Plan | undefined): string => (plan?.studio ? resolveStudio(plan.studio, plan.renames) : undefined) ?? mainStudio(workouts, plan?.renames) ?? '';

/**
 * The exercise's sessions in the planned studio only, oldest first. Several occurrences in one workout are one session; its
 * pre-fatigue is the one of the first occurrence.
 */
function occurrences(templateId: string, workouts: StrengthWorkout[], nowMs: number, plan: Plan | undefined): Occurrence[] {
  const main = mainStudio(workouts, plan?.renames);
  const key = plannedKey(workouts, plan);
  const muscleOf = plan?.muscleOf;
  const out: Occurrence[] = [];
  for (const w of workouts) {
    if (w.startMs > nowMs || studioKey(w, main, plan?.renames) !== key) continue;
    const mine = w.exercises.filter((e) => e.templateId === templateId);
    if (mine.length === 0) continue;
    const answered = [...mine].reverse().find((e) => e.effort)?.effort;
    // A failure set far above the plan says "plenty left" without a question; an answer wins.
    const far = mine.some((e) => e.workSets.some((s) => s.type === 'failure' && s.reps !== null && s.plannedReps !== undefined && s.reps >= s.plannedReps + FAILURE_PLENTY_MARGIN));
    const effort = answered ?? (far ? 'plenty' : undefined);
    const pre = muscleOf ? preFatigue(w.exercises.map((e) => ({ ...muscleOf(e.templateId), primaryMuscle: muscleOf(e.templateId)?.primaryMuscle, hardSets: hardSetsOf(e.workSets), supersetId: null }))) : [];
    const preSets = pre[w.exercises.findIndex((e) => e.templateId === templateId)] ?? 0;
    out.push({ ms: w.startMs, sets: mine.flatMap((e) => e.workSets), preSets, ...(effort ? { effort } : {}) });
  }
  return out.sort((a, b) => a.ms - b.ms);
}

/** One value per session: the heaviest weight of the normal and failure sets and the reps done at it. */
function sessionsOf(templateId: string, workouts: StrengthWorkout[], nowMs: number, plan: Plan | undefined): Session[] {
  const out: Session[] = [];
  for (const o of occurrences(templateId, workouts, nowMs, plan)) {
    const work = o.sets.filter((s) => (s.type === 'normal' || s.type === 'failure') && s.reps !== null && s.reps > 0);
    if (work.length === 0) continue;
    const top = Math.max(...work.map((s) => s.weightKg ?? 0));
    const atTop = work.filter((s) => (s.weightKg ?? 0) === top).map((s) => s.reps as number);
    out.push({ ms: o.ms, weightKg: top > 0 ? top : null, minReps: Math.min(...atTop), sets: atTop, preSets: o.preSets, ...(o.effort ? { effort: o.effort } : {}) });
  }
  return out;
}

/**
 * The weight steps of an exercise in the planned studio: learned from its newest 10 sessions there (the shared `ladderFrom`),
 * then the person's override. The learned anchor is the lightest weight seen, exactly as it is (an off-grid 22.68 stays the
 * anchor and the steps go on from there), which is no floor of the equipment: the lattice goes on below it (down to
 * one step, or the bar for a barbell), so a step back or a break can go lighter than anything seen so far.
 */
export function ladderFor(templateId: string, ex: ExerciseInfo | undefined, workouts: StrengthWorkout[], nowMs: number, plan?: Plan): Ladder {
  const sessions = workouts.filter((w) => w.startMs <= nowMs).map((w) => ({ studio: w.studio, startMs: w.startMs, sets: w.exercises.filter((e) => e.templateId === templateId).flatMap((e) => e.workSets), has: w.exercises.some((e) => e.templateId === templateId) }))
    .filter((s) => s.has);
  const { ladder: l } = ladderFrom(sessions, { exerciseId: templateId, studio: plannedKey(workouts, plan), main: mainStudio(workouts, plan?.renames), renames: plan?.renames }, ex?.equipment ?? 'other', plan?.overrides ?? new Map());
  return extendDown(l, ex?.equipment ?? 'other');
}

/**
 * Double progression: reps first, then weight. "All reps reached" means every top-weight set of the last
 * session did at least as many reps as the lowest set of the session before it, at the same or a lower weight.
 * The rep range is the exercise's own, the weight steps are the ones reachable in the planned studio. Only sessions
 * of that studio count. "0 left" is no reason on its own to hold or lower the weight: the numbers decide.
 * `preSets` is today's hard sets for the same muscle before the exercise. Only sessions with a similar pre-fatigue are compared;
 * with none of those, the newest session is kept, lowered by a share when today comes more tired than it did, never raised.
 */
export function suggestNext(templateId: string, workouts: StrengthWorkout[], nowMs: number, ex?: ExerciseInfo, plan?: Plan, preSets = 0): Suggestion {
  const all = templateId ? sessionsOf(templateId, workouts, nowMs, plan) : [];
  const sessions = all.filter((s) => Math.abs(s.preSets - preSets) <= PRE_FATIGUE_TOLERANCE);
  const range = repRangeOf({ primaryMuscle: ex?.primaryMuscle });
  const newest = all[all.length - 1];
  if (!newest) return done(null, range.min, 'none', 'none');
  const last = sessions[sessions.length - 1] ?? newest;
  // Weighted work stays in the rep range; bodyweight work has no upper limit, since reps are its only progression.
  const fit = (r: number): number => last.weightKg === null ? Math.max(1, r) : Math.min(range.max, Math.max(range.min, r));
  const reps = fit(last.minReps);
  const assisted = isAssisted(ex?.type);
  const ladder = ladderFor(templateId, ex, workouts, nowMs, plan);
  const stepBack = (kg: number): number => snapDown(kg * STEP_BACK, ladder);
  if (sessions.length === 0) {
    if (last.weightKg === null || assisted || preSets <= last.preSets) return done(last.weightKg, reps, 'keep', 'other-position');
    const share = positionShare(preSets - last.preSets);
    return done(snapDown(last.weightKg * share, ladder), reps, 'keep', 'other-position');
  }
  if (nowMs - last.ms > LONG_BREAK_DAYS * DAY_MS) {
    return done(last.weightKg === null || assisted ? last.weightKg : stepBack(last.weightKg), reps, 'step-back', 'long-break');
  }
  const comparable = sessions.filter((s) => nowMs - s.ms <= COMPARABLE_DAYS * DAY_MS);
  // Fewer reps against the session before at exactly the same weight, several times in a row: the weight is too much for now.
  // A weight rise resets the reps to the range's start by design, so it is no drop.
  let drops = 0;
  for (let i = comparable.length - 1; i >= 1; i--) {
    const [prev, cur] = [comparable[i - 1], comparable[i]];
    if (cur.weightKg === null || cur.weightKg !== prev.weightKg || cur.minReps >= prev.minReps) break;
    drops++;
  }
  if (drops >= DROP_STEP_BACK && last.weightKg !== null && !assisted) return done(stepBack(last.weightKg), reps, 'step-back', 'dropped');
  if (last.effort !== 'plenty') {
    if (comparable.length < MIN_COMPARABLE) return done(last.weightKg, reps, 'keep', 'few-sessions');
    const before = comparable[comparable.length - 2];
    const reached = (last.weightKg ?? 0) >= (before.weightKg ?? 0) && last.sets.every((r) => r >= before.minReps);
    if (!reached) return done(last.weightKg, reps, 'keep', 'not-all-reps');
  }
  const path: Path = last.effort === 'plenty' ? 'plenty-left' : last.effort === 'none' ? 'zero-left' : 'all-reps';
  if (last.weightKg === null || last.minReps < range.max) return done(last.weightKg, fit(last.minReps + 1), 'progress', path);
  if (assisted) return done(last.weightKg, reps, 'keep', 'assisted');
  return done(nextUp(last.weightKg, ladder), range.min, 'progress', path);
}

/**
 * True when the last `block.stagnation-sessions` comparable sessions of an exercise each brought neither more load nor, at the same
 * load, more reps than the session before (the comparison the progression makes). Needs one more session to compare the first with.
 */
export function stagnates(templateId: string, workouts: StrengthWorkout[], nowMs: number, ex?: ExerciseInfo, plan?: Plan): boolean {
  const all = sessionsOf(templateId, workouts, nowMs, plan).filter((s) => nowMs - s.ms <= COMPARABLE_DAYS * DAY_MS);
  // Like the progression: only sessions with a pre-fatigue similar to the newest one are compared (the studio is the plan's).
  const newest = all[all.length - 1];
  const recent = newest ? all.filter((s) => Math.abs(s.preSets - newest.preSets) <= PRE_FATIGUE_TOLERANCE) : [];
  if (recent.length < STAGNATION_SESSIONS + 1) return false;
  const assisted = isAssisted(ex?.type);
  const tail = recent.slice(-(STAGNATION_SESSIONS + 1));
  return tail.slice(1).every((cur, i) => {
    const prev = tail[i]!;
    const [c, p] = [cur.weightKg ?? 0, prev.weightKg ?? 0];
    // With assistance, less weight is more load.
    return !(assisted ? c < p : c > p) && !(c === p && cur.minReps > prev.minReps);
  });
}
