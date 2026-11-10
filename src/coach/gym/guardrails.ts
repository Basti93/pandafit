import { contiguousGroups } from '../../shared/superset';
import type { StrengthWorkout } from '../hevy';
import type { ExerciseTemplate, GymExercise, GymSet, GymWorkout } from '../../shared/gym/types';
import { MAX_EXERCISES, MAX_FAILURE_SETS, MAX_SETS, MAX_WIDOWMAKERS } from './limits';
import { availableExercises, isAssisted, LEG_MUSCLES, isRepBased, ladderFor, plannedKey, suggestNext, type Plan } from './history';
import { hardSetsOf, muscleOfFrom, preFatigue } from './pre-fatigue';
import { nextUp, snapDown, type Ladder, type LoadStepOverrides } from '../../shared/loads';
import { studioName, type Renames } from '../../shared/studio';
import { repRangeOf } from '../../shared/muscle-targets';
import { isExcluded } from '../../shared/excluded';
import { EXERCISES, type Exercise } from '../../shared/exercises';
import { gymLimit, gymMinutes } from '../../shared/duration';

export type GymContext = { workouts: StrengthWorkout[]; templates: ExerciseTemplate[]; nowMs: number; /** Leave leg exercises out of rule workouts, e.g. for an open leg complaint. */ avoidLegs?: boolean;
  /** The studio the plan is for (undefined: the main one) and the person's weight-step overrides. */
  studio?: string; overrides?: LoadStepOverrides; renames?: Renames;
  /** Template ids the person's active exclude rules rule out (own ids and the Hevy ids linked to them). */
  excluded?: Set<string>;
  /** The catalog and Hevy links the exclusion is resolved with (exact id or exact known title, never fuzzy). */
  catalog?: readonly Exercise[]; links?: Readonly<Record<string, string>>;
  /** The most minutes the person has for this session, warm-up and rests included. Without it, no time check. */
  budgetMinutes?: number };
export type CheckResult = { ok: true; workout: GymWorkout } | { ok: false; reason: string };

export const WIDOWMAKER_REPS = 20;
const MAX_REST_S = 600;
const MAX_NOTES = 500;
const MAX_NAME = 80;
const MAX_BODYWEIGHT_REPS = 100;
const SET_TYPES = ['warmup', 'normal', 'failure', 'dropset'] as const;
const BODYWEIGHT_TYPES = ['bodyweight_reps', 'reps_only'];

class Refuse extends Error {}
const no = (reason: string): never => { throw new Refuse(reason); };

const isRecord = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);
const isInt = (v: unknown): v is number => typeof v === 'number' && Number.isInteger(v);
const isWidowmaker = (notes: string): boolean => /^\s*widowmaker\b/i.test(notes);
/** Hevy's own weights are not always on a 0.5 kg grid, e.g. 61.25 or a converted 22.68. */
const twoDecimals = (kg: number): boolean => Math.round(kg * 100) / 100 === kg;

/** Highest weight accepted for an exercise: the next reachable weight above the suggestion, or the suggestion alone. */
export function weightCap(suggested: number, withStep: boolean, ladder: Ladder): number {
  return withStep ? nextUp(suggested, ladder) : suggested;
}

/** The plan the suggestions are made for: studio, weight steps and where each exercise stood in past workouts. */
export const gymPlan = (ctx: GymContext): Plan => ({ studio: ctx.studio, overrides: ctx.overrides, renames: ctx.renames, muscleOf: muscleOfFrom(ctx.templates, ctx.catalog ?? []) });

function parseSet(raw: unknown, where: string): GymSet {
  if (!isRecord(raw)) return no(`${where}: Satz ungültig`);
  const type = SET_TYPES.find((t) => t === raw.type);
  if (!type) return no(`${where}: Satztyp ungültig`);
  const w = raw.weightKg;
  if (w !== null && !(typeof w === 'number' && Number.isFinite(w) && w > 0 && w <= 1000 && twoDecimals(w))) return no(`${where}: Gewicht ungültig`);
  const reps = raw.reps;
  if (reps !== null && !(isInt(reps) && reps > 0)) return no(`${where}: Wiederholungen ungültig`);
  const out: GymSet = { type, weightKg: w, reps };
  if (raw.repRange !== undefined && raw.repRange !== null) {
    const rr = raw.repRange;
    if (!isRecord(rr) || !isInt(rr.start) || !isInt(rr.end) || rr.start < 1 || rr.start > rr.end) return no(`${where}: Wiederholungsbereich ungültig`);
    out.repRange = { start: rr.start, end: rr.end };
  }
  if (reps === null && !out.repRange) return no(`${where}: Wiederholungen fehlen`);
  return out;
}

function parseExercise(raw: unknown, i: number, byId: Map<string, ExerciseTemplate>): { ex: GymExercise; template: ExerciseTemplate } {
  const where = `Übung ${i + 1}`;
  if (!isRecord(raw)) return no(`${where}: ungültig`);
  const template = typeof raw.templateId === 'string' ? byId.get(raw.templateId) : undefined;
  if (!template) return no(`${where}: unbekannte Übungsvorlage`);
  const restS = raw.restS;
  if (restS !== null && !(isInt(restS) && restS >= 0 && restS <= MAX_REST_S)) return no(`${where}: Pause ungültig`);
  const supersetId = raw.supersetId;
  if (supersetId !== null && !(isInt(supersetId) && supersetId >= 0)) return no(`${where}: Superset-Id ungültig`);
  const notes = raw.notes;
  if (typeof notes !== 'string' || notes.length > MAX_NOTES) return no(`${where}: Notiz ungültig`);
  if (!Array.isArray(raw.sets) || raw.sets.length === 0) return no(`${where}: keine Sätze`);
  const sets = raw.sets.map((s) => parseSet(s, where));
  return { ex: { templateId: template.id, title: template.title, restS, supersetId, notes, sets }, template };
}

/**
 * `preSets`: hard sets for the same muscle before this exercise in the workout. The limit for refusing is the suggestion as if
 * the exercise came first; a weight above what its place allows is then lowered to the suggestion for that place.
 */
function checkExercise(ex: GymExercise, t: ExerciseTemplate, ctx: GymContext, recentEquipment: Set<string>, known: Set<string>, preSets: number): void {
  const where = ex.title;
  if (!isRepBased(t)) no(`${where}: nur Übungen mit Wiederholungen`);
  const plan = gymPlan(ctx);
  const sug = suggestNext(ex.templateId, ctx.workouts, ctx.nowMs, t, plan);
  const here = preSets > 0 ? suggestNext(ex.templateId, ctx.workouts, ctx.nowMs, t, plan, preSets) : sug;
  const ladder = ladderFor(ex.templateId, t, ctx.workouts, ctx.nowMs, plan);
  const range = repRangeOf(t);
  if (!known.has(ex.templateId) && !recentEquipment.has(t.equipment)) no(`${where}: Gerät in den letzten Monaten nicht benutzt`);
  const widow = isWidowmaker(ex.notes);
  const barbell = t.equipment === 'barbell';
  if (widow && barbell) no(`${where}: Widowmaker nicht an der Langhantel`);
  if (widow && sug.why === 'none') no(`${where}: Widowmaker nur mit Verlauf`);
  const bodyweight = BODYWEIGHT_TYPES.includes(t.type) || (sug.why !== 'none' && sug.weightKg === null);
  const isWidowSet = (s: GymSet): boolean => widow && s.reps === WIDOWMAKER_REPS && !s.repRange;
  const widowSets = ex.sets.filter(isWidowSet);
  if (widow && (widowSets.length !== 1 || widowSets[0].type !== 'normal')) no(`${where}: Widowmaker braucht genau einen Satz mit ${WIDOWMAKER_REPS}`);
  for (const s of ex.sets) {
    if (s.type === 'failure' && barbell) no(`${where}: Muskelversagen nicht an der Langhantel`);
    if (s.weightKg !== null) {
      if (sug.weightKg === null) no(`${where}: Gewicht ohne Verlauf`);
      if (isAssisted(t.type)) { if (s.weightKg !== sug.weightKg) no(`${where}: Unterstützung bleibt gleich`); }
      // Only reachable weights go on.
      else s.weightKg = Math.min(s.weightKg, snapDown(s.weightKg, ladder));
      if (s.weightKg > weightCap(sug.weightKg as number, !isWidowSet(s), ladder)) no(`${where}: Gewicht zu hoch`);
      if (here.weightKg !== null && s.weightKg > weightCap(here.weightKg, !isWidowSet(s), ladder)) s.weightKg = here.weightKg;
    }
    if (s.type === 'warmup') continue;
    if (isWidowSet(s)) continue;
    // reps and both range ends are all checked, so neither can hide a value from the other
    const values = [...(s.reps !== null ? [s.reps] : []), ...(s.repRange ? [s.repRange.start, s.repRange.end] : [])];
    for (const r of values) {
      if (bodyweight) { if (r < 1 || r > MAX_BODYWEIGHT_REPS) no(`${where}: Wiederholungen außerhalb des Rahmens`); }
      else if (r < range.min || r > range.max) no(`${where}: Wiederholungen außerhalb von ${range.min} bis ${range.max}`);
    }
  }
}

/**
 * Hard limits for an AI workout. Anything outside them is refused whole. Only weights are fitted: snapped to reachable steps and
 * lowered to what the place of the exercise in the workout allows.
 */
export function checkWorkout(raw: unknown, ctx: GymContext): CheckResult {
  try {
    if (!isRecord(raw)) return no('Training ungültig');
    if (typeof raw.name !== 'string' || raw.name.trim() === '' || raw.name.length > MAX_NAME) return no('Name ungültig');
    if (!Array.isArray(raw.exercises) || raw.exercises.length === 0) return no('keine Übungen');
    if (raw.exercises.length > MAX_EXERCISES) return no(`mehr als ${MAX_EXERCISES} Übungen`);
    const byId = new Map(ctx.templates.map((t) => [t.id, t]));
    const parsed = raw.exercises.map((e, i) => parseExercise(e, i, byId));
    const exercises = parsed.map((p) => p.ex);
    if (exercises.some((e) => isExcluded(e, ctx.excluded, ctx.catalog ?? [], ctx.links))) return no('Übung ausgeschlossen (Regel der Person)');
    if (ctx.avoidLegs === true && parsed.some((p) => LEG_MUSCLES.includes(p.template.primaryMuscle))) return no('Keine Beine in dieser Einheit');
    const all = exercises.flatMap((e) => e.sets);
    if (all.filter((s) => s.type !== 'warmup').length > MAX_SETS) return no(`mehr als ${MAX_SETS} Sätze`);
    if (all.filter((s) => s.type === 'failure').length > MAX_FAILURE_SETS) return no(`mehr als ${MAX_FAILURE_SETS} Sätze bis zum Versagen`);
    if (exercises.filter((e) => isWidowmaker(e.notes)).length > MAX_WIDOWMAKERS) return no(`mehr als ${MAX_WIDOWMAKERS} Widowmaker`);
    const ids = exercises.map((e) => e.supersetId).filter((v): v is number => v !== null);
    for (const id of new Set(ids)) if (ids.filter((v) => v === id).length < 2) return no('Superset mit nur einer Übung');
    const avail = availableExercises(ctx.workouts, ctx.nowMs);
    const known = new Set(avail.map((a) => a.templateId));
    const recentEquipment = new Set(avail.filter((a) => a.recent).map((a) => byId.get(a.templateId)?.equipment).filter((e): e is string => !!e));
    const muscleOf = muscleOfFrom(ctx.templates, ctx.catalog ?? []);
    const pre = preFatigue(exercises.map((e) => ({ primaryMuscle: muscleOf(e.templateId), hardSets: hardSetsOf(e.sets), supersetId: e.supersetId })));
    parsed.forEach((p, i) => checkExercise(p.ex, p.template, ctx, recentEquipment, known, pre[i]!));
    // The weights are for this studio's equipment; the app uses it to refit them when another studio is chosen. Never taken from the answer.
    const studio = studioName(plannedKey(ctx.workouts, ctx));
    const workout: GymWorkout = { name: raw.name.trim(), exercises: contiguousGroups(exercises), ...(studio ? { studio } : {}) };
    if (ctx.budgetMinutes !== undefined && gymMinutes(workout, ctx.catalog ?? EXERCISES) > gymLimit(ctx.budgetMinutes)) return no(`zu lang für deine Zeit: ca. ${gymMinutes(workout, ctx.catalog ?? EXERCISES)} Min bei höchstens ${ctx.budgetMinutes}`);
    return { ok: true, workout };
  } catch (e) {
    if (e instanceof Refuse) return { ok: false, reason: e.message };
    throw e;
  }
}

/**
 * Short plain German for a guardrail refusal, e.g. "zu viele Sätze". One table, in the order the checks can fire; the
 * part before ": " (which exercise) is dropped. A reason nobody mapped yet gets the general phrase.
 */
const REASON_PHRASES: [RegExp, string][] = [
  [/Schema/, 'die Antwort war nicht lesbar'],
  [/Keine Beine in dieser Einheit/, 'Beinübungen, obwohl die Beine in dieser Einheit pausieren'],
  [/ausgeschlossen/, 'eine Übung, die du ausgeschlossen hast'],
  [/mehr als \d+ Übungen/, 'zu viele Übungen'],
  [/mehr als \d+ Sätze bis zum Versagen/, 'zu viele Sätze bis zum Versagen'],
  [/mehr als \d+ Sätze/, 'zu viele Sätze'],
  [/Widowmaker/, 'ein Widowmaker, der nicht passt'],
  [/Muskelversagen/, 'Muskelversagen an der Langhantel'],
  [/Gewicht zu hoch|Gewicht ohne Verlauf|Unterstützung/, 'ein Gewicht, das noch nicht dran ist'],
  [/zu lang für deine Zeit/, 'zu lang für deine Zeit'],
  [/Wiederholungen außerhalb/, 'Wiederholungen außerhalb des Rahmens'],
  [/Gerät in den letzten Monaten/, 'ein Gerät, das du länger nicht benutzt hast'],
  [/unbekannte Übungsvorlage|nur Übungen mit Wiederholungen/, 'eine Übung, die ich nicht einplanen kann'],
  [/keine (Übungen|Sätze)|Superset/, 'eine unvollständige Aufteilung'],
];
export function reasonPhrase(reason: string): string {
  const plain = reason.replace(/^[^:]*: /, '');
  return REASON_PHRASES.find(([re]) => re.test(reason) || re.test(plain))?.[1] ?? 'eine Angabe außerhalb der Grenzen';
}
