import { ClaudeError } from '../claude-client';
import type { StrengthWorkout } from '../hevy';
import { isAssisted, LEG_MUSCLES, recentLegWork, stagnates, suggestNext } from './history';
import { hardSetsOf, musclesOfFrom } from './pre-fatigue';
import { activeBlock, blockWeek } from '../../shared/block';
import { addDays } from '../../shared/week-plan';
import { strengthFacts, type StrengthFacts } from './review-facts';
import { addNote, type ChangeNote } from '../../shared/change-notes';
import type { NextStep } from '../../shared/stats';
import type { RideSummary } from '../metrics';
import { complaintFromNote, type Complaint } from '../motivation';
import { checkWorkout, isCoreExercise, reasonPhrase, WIDOWMAKER_REPS, type GymContext } from './guardrails';
import { HevyError, type HevyRoutines } from './hevy-routines';
import { LIGHT_SHARE, LONG_BREAK_DAYS, MAX_SETS } from './limits';
import { buildGymPrompt, gymAnswerJsonSchema, gymAnswerSchema, GYM_SYSTEM_PROMPT, honestFigures, NEUTRAL_REASON, type GymAnswer, type PromptInput } from './prompt';
import { ruleWorkout } from './rules';
import { mergeCatalog } from '../../shared/catalog';
import { isExcluded } from '../../shared/excluded';
import { EXERCISES, linkHevyTemplates, type Exercise } from '../../shared/exercises';
import { FEDB_EXERCISES } from '../../shared/fedb';
import { onePerSession } from '../../shared/history';
import { effectivePush, goalOf } from '../../shared/personal';
import type { LoggedWorkout, TrackedRecord } from '../../shared/records';
import { hevyRecord } from '../tracking/hevy-import';
import { historyFromLogged, mergeHistory } from '../tracking/merge';
import { chatThread, latestReview } from '../../shared/chat';
import type { RecordStore } from '../tracking/store';
import { legacyGymRules, loadGymState, removeGymState, saveGymState, type GymState } from './state';
import type { ExerciseTemplate, GymExercise, GymWorkout } from '../../shared/gym/types';
import { readTasks, type GivenTask } from '../coach-tasks';
import { readOutlook, type GymOutlook } from '../../shared/gym-outlook';
import type { LoadStepOverrides } from '../../shared/loads';
import { MUSCLE_TARGETS } from '../../shared/muscle-targets';
import { defaultStudio, NO_STUDIOS, type StudioState } from '../../shared/studio';
import { studiosOf } from '../tracking/studios';
import { loadStepsOf } from '../tracking/load-steps';
import { takenChangesOf } from '../tracking/changes';
import { excludedOf, goalOfProfile, migrateRules, wishesOf } from '../tracking/personal';
import { gymBudgetOf, gymPlanDateOf } from '../tracking/frame';
import { dateKey } from '../day-load';
import { durationNote } from '../../shared/duration';
import { considered } from '../../shared/changes';

const DAY_MS = 86_400_000;
const RETRY_MS = 10 * 60_000;
const MAX_ATTEMPTS = 3;
const MAX_NOTES = 20;
const MAX_ANSWERS = 20;
const MAX_QUESTIONS = 2;
const TEXT_MAX = 400;
const QUESTION_MAX = 200;
const NAME_MAX = 80;
const GYM_QUESTION = 'Trainierst du noch im selben Studio, mit denselben Geräten?';
export const LEG_COMPLAINT = /knie|hüfte|huefte|oberschenkel|wade|knöchel|knoechel|fuß|fuss|achilles|bein/i;
const COMPLAINT_HINT = 'Deine gemeldete Beschwerde habe ich so weit berücksichtigt, wie Regeln das können. Lass einfach weg, was dich stört.';
const BREAK_NOTE = 'Nach der Pause fange ich ruhig an und taste mich wieder heran.';

type Ask = (input: { prompt: string; systemPrompt: string; schema: object }) => Promise<unknown>;
type Deps = {
  dir: string; ask: Ask; nowMs: () => number;
  workouts: (id: string) => StrengthWorkout[];
  templates: (id: string) => Promise<ExerciseTemplate[]>;
  /** Fetches past the template cache. Only reads from Hevy. */
  refreshTemplates: (id: string) => Promise<ExerciseTemplate[]>;
  ready: (id: string) => boolean;
  bike: (id: string) => { summaries: RideSummary[]; complaints: Complaint[] };
  complaint: (id: string, text: string) => void;
  /** Recent mobility for the prompt, as data. */
  mobility?: (id: string) => unknown;
  /** Today's advice asks for strength without leg exercises (tired legs): plan without them. */
  avoidLegs?: (id: string) => boolean;
  /** The accepted week plan as prompt text, or ''. */
  planHint?: (id: string) => string;
  /** Hands a task from this coach to another one. */
  giveTask?: (id: string, task: GivenTask) => void;
  /** Own records of this Mac. Without one only Hevy counts, as before. */
  store?: RecordStore;
  /** The profile's one exercise catalog. Defaults to the merged catalog of the store (built-ins without a store). */
  catalog?: (id: string) => Exercise[];
  /** The person's own weight-step overrides per exercise and studio. Defaults to the `loadstep` records of the store. */
  loadSteps?: (id: string) => LoadStepOverrides;
  /** Whether Hevy is connected for this profile. Defaults to true: the coach was Hevy-only. */
  hevy?: (id: string) => boolean;
  /** Whether the profile is linked to an account: strength tracking is on then, as with Hevy. */
  account?: (id: string) => boolean;
  /** A workout of the rider's own was finished, once per workout. Must only mark something, never plan. */
  onWorkoutFinished?: (id: string) => void;
  /** Null without a Hevy key. This is the only path to a Hevy write, and only `confirm` uses it. */
  writer: (id: string) => HevyRoutines | null;
};

/** Hevy refuses what we sent, so the stored workout cannot be written. Auth, limits, its own trouble and the network are no such answer. */
const refusedByHevy = (e: unknown): boolean => e instanceof HevyError && e.status >= 400 && e.status < 500 && ![401, 403, 429].includes(e.status);
/** Older stored records lack the sets until the next sync has replaced them. The coach skips such a record until then. */
const hasSetDetails = (w: StrengthWorkout): boolean => Array.isArray(w.exercises) && w.exercises.every((e) => Array.isArray(e.workSets));
const complaintsFingerprint = (open: Complaint[]): string => open.map((c) => `${c.id}:${c.status}`).sort().join(',');
const fingerprint = (w: GymWorkout): string => JSON.stringify(w);
/** A tombstone written by the import because Hevy's list no longer had the workout; any other is the person's delete. */
const goneFromHevy = (r: TrackedRecord): boolean => (r.body as { goneFromHevy?: unknown } | null)?.goneFromHevy === true;
const isWidowmaker = (e: GymExercise): boolean => /^\s*widowmaker\b/i.test(e.notes);
const isWidowSet = (e: GymExercise, i: number): boolean => isWidowmaker(e) && e.sets[i].reps === WIDOWMAKER_REPS && !e.sets[i].repRange;
const clean = (text: string | undefined, max: number): string | null => {
  const t = (text ?? '').trim();
  return t ? t.slice(0, max) : null;
};

/**
 * The strength coach. It plans from the rider's Hevy history and only writes to Hevy in `confirm`, after a `preview`.
 * It reacts to real workouts, notes, changed open complaints and every new activity of other sports; the bike plan alone never
 * triggers a replan.
 */
export class GymCoach {
  private states = new Map<string, GymState>();
  private running = new Map<string, Promise<void>>();
  private previews = new Map<string, { fp: string; edited: boolean }>();
  private writing = new Set<string>();
  private generation = new Map<string, number>();

  constructor(private deps: Deps) {}

  state(id: string): GymState {
    let s = this.states.get(id);
    if (!s) {
      s = loadGymState(this.deps.dir, id);
      this.states.set(id, s);
      this.migrateRules(id);
    }
    return s;
  }
  /** Once per profile: the old free-text rules become wish records, then the state file is written without them. */
  private migrateRules(id: string): void {
    const old = legacyGymRules(this.deps.dir, id);
    if (old.length === 0) return;
    if (!this.deps.store) return;
    try {
      // A legacy rule that is just a complaint's text stays a complaint, it does not become a wish too.
      const norm = (t: string): string => t.trim().toLowerCase().replace(/\s+/g, ' ');
      const complaints = new Set(this.deps.store.all(id, 'complaint').filter((r) => !r.deleted && typeof (r.body as { text?: unknown })?.text === 'string').map((r) => norm((r.body as { text: string }).text)));
      migrateRules(this.deps.store, id, 'gym', old.filter((t) => !complaints.has(norm(t))), this.deps.nowMs());
      saveGymState(this.deps.dir, this.states.get(id)!, true);
    } catch { /* the file keeps the rules; the next start tries again */ }
  }
  isThinking(id: string): boolean { return this.running.has(id); }

  /** The exercises the person's active exclude rules rule out, as own ids plus the Hevy template ids linked to them. */
  private excluded(id: string): Set<string> {
    if (!this.deps.store) return new Set();
    const own = excludedOf(this.deps.store, id, this.catalog(id));
    const out = new Set(own);
    for (const [hevyId, ownId] of Object.entries(this.state(id).links)) if (own.has(ownId)) out.add(hevyId);
    return out;
  }

  /** The profile's merged catalog (aliases from the mapper or the person included). Built per call: callers hold on to it for one run. */
  private catalog(id: string): Exercise[] {
    if (this.deps.catalog) return this.deps.catalog(id);
    return this.deps.store ? mergeCatalog(EXERCISES, FEDB_EXERCISES, this.deps.store.all(id, 'exercise')) : EXERCISES;
  }
  /** The plan's reason with a short "Berücksichtigt: …" for the changes taken for the next workout. Never changes the plan itself. */
  private withTaken(id: string, reason: string): string {
    const base = reason.replace(/\s*Berücksichtigt:[\s\S]*$/, '');
    const note = this.deps.store ? considered(takenChangesOf(this.deps.store, id)) : '';
    return note ? `${base} ${note}`.trim() : base;
  }
  /** The taken swaps as titles from the catalog, for the planner's prompt. */
  private swapsTaken(id: string): { statt: string; nimm: string }[] {
    if (!this.deps.store) return [];
    const cat = this.catalog(id);
    const title = (x: string) => cat.find((e) => e.id === x)?.title;
    return takenChangesOf(this.deps.store, id).flatMap((c) => c.ops.flatMap((o) => {
      if (o.op !== 'swap') return [];
      const statt = title(o.exerciseId); const nimm = title(o.toId);
      return statt && nimm ? [{ statt, nimm }] : [];
    }));
  }
  /**
   * The fixed section on the day the plan is for (the next open gym day of the week plan in week mode, else today), for the
   * guardrail and the prompt; null outside a section. That day's template is that of the rhythm day; on a day without one it is
   * the one after the template trained last in the section (a missed session is never made up).
   */
  private section(id: string, real: StrengthWorkout[], templates: ExerciseTemplate[], now: number, open: Complaint[], avoidLegs: boolean, excluded: Set<string>): { block: NonNullable<GymContext['block']>; prompt: NonNullable<PromptInput['abschnitt']> } | null {
    if (!this.deps.store) return null;
    const planDate = gymPlanDateOf(this.deps.store, id, dateKey(now), real.map((w) => dateKey(w.startMs)));
    const b = activeBlock(this.deps.store.all(id, 'block'), planDate);
    if (!b?.start) return null;
    const links = this.state(id).links;
    const catalog = this.catalog(id);
    const week = blockWeek(b, planDate);
    const hasCore = (w: StrengthWorkout, core: string): boolean => w.exercises.some((e) => isCoreExercise({ templateId: e.templateId ?? '', title: e.title }, core, { catalog, links }));
    const inBlock = real.filter((w) => dateKey(w.startMs) >= b.start!).sort((a, c) => c.startMs - a.startMs);
    const weekday = (new Date(`${planDate}T00:00:00Z`).getUTCDay() + 6) % 7;
    let index = b.rhythm[weekday]?.template;
    if (index === undefined) {
      const overlap = (w: StrengthWorkout, i: number): number => b.templates[i]!.core.filter((c) => hasCore(w, c)).length;
      const best = (w: StrengthWorkout): number => b.templates.reduce((m, _, i) => (overlap(w, i) > overlap(w, m) ? i : m), 0);
      const last = inBlock.map((w) => (overlap(w, best(w)) > 0 ? best(w) : -1)).find((i) => i >= 0);
      index = last !== undefined ? (last + 1) % b.templates.length : undefined;
    }
    if (index === undefined) {
      for (let k = 1; k <= 7 && index === undefined; k++) index = b.rhythm[(weekday + k) % 7]?.template;
    }
    const template = b.templates[index ?? 0]!;
    const plan = { studio: this.studio(id), renames: this.studios(id).renames, muscleOf: musclesOfFrom(templates, catalog) };
    const swapped = new Set(takenChangesOf(this.deps.store, id).flatMap((c) => c.ops.flatMap((o) => (o.op === 'swap' ? [o.exerciseId] : []))));
    const legsTired = avoidLegs || recentLegWork(real, templates, now);
    const exempt = new Set<string>();
    const core: NonNullable<PromptInput['abschnitt']>['core'] = [];
    for (const c of template.core) {
      const t = templates.find((x) => isCoreExercise({ templateId: x.id, title: x.title }, c, { catalog, links }));
      const entry = catalog.find((e) => e.id === c);
      const title = t?.title ?? entry?.title ?? c;
      const stag = [c, ...Object.entries(links).filter(([, own]) => own === c).map(([hevy]) => hevy)].some((tid) => stagnates(tid, real, now, t, plan));
      const muscle = entry?.primaryMuscle ?? t?.primaryMuscle;
      const gone = isExcluded({ id: c, templateId: t?.id, title }, excluded, catalog, links) || swapped.has(c);
      const free = !t || stag || gone || open.length > 0 || (legsTired && muscle !== undefined && LEG_MUSCLES.includes(muscle));
      if (free) exempt.add(c);
      if (t && !gone) core.push({ templateId: t.id, title, stagnates: stag, ...(free ? { exempt: true } : {}) });
    }
    let lightCap: number | null = null;
    if (week.light) {
      const lightMonday = addDays(b.start, (week.of - 1) * 7);
      const before = real.filter((w) => dateKey(w.startMs) >= b.start! && dateKey(w.startMs) < lightMonday).map((w) => w.exercises.reduce((n, e) => n + hardSetsOf(e.workSets), 0));
      if (before.length > 0) lightCap = Math.floor(LIGHT_SHARE * (before.reduce((a, n) => a + n, 0) / before.length));
    }
    return {
      block: { core: template.core, exempt, light: week.light, lightCap },
      prompt: { n: week.n, of: week.of, template: template.name, light: week.light, core },
    };
  }

  private loadSteps(id: string): LoadStepOverrides {
    if (this.deps.loadSteps) return this.deps.loadSteps(id);
    return this.deps.store ? loadStepsOf(this.deps.store, id, this.studios(id).renames) : new Map();
  }
  /** The studio the plan is for: the one of the newest own workout. Undefined when none is known. */
  studio(id: string): string | undefined { const s = this.studios(id); return defaultStudio(this.logged(id), s.renames, s.picks); }
  /** The profile's `studio` records: renames and remembered picks. */
  private studios(id: string): StudioState { return this.deps.store ? studiosOf(this.deps.store, id) : NO_STUDIOS; }
  isHevy(id: string): boolean { return this.deps.hevy ? this.deps.hevy(id) : true; }
  private logged(id: string): LoggedWorkout[] {
    if (!this.deps.store) return [];
    return this.deps.store.all(id, 'workout')
      .filter((r) => !r.deleted && typeof r.body === 'object' && r.body !== null && Array.isArray((r.body as LoggedWorkout).exercises))
      .map((r) => r.body as LoggedWorkout);
  }
  private links(id: string): Map<string, string> { return new Map(Object.entries(this.state(id).links)); }
  /** On with Hevy, after "Krafttraining starten", or once a finished workout is kept on this Mac (an imported Hevy one stays too). */
  enabled(id: string): boolean {
    return this.isHevy(id) || (this.deps.account?.(id) ?? false) || this.state(id).localStart || this.logged(id).some((w) => w.endMs !== null);
  }
  /** A workout of the rider's own was finished: plan again. Only a flag, the run itself waits for `tick` and so for a free bike. */
  workoutFinished(id: string): void {
    this.update(id, (s) => { s.dirty = true; s.attempts = 0; });
    try { this.deps.onWorkoutFinished?.(id); } catch { /* the other coach's trouble is not this workout's */ }
  }
  /** Begins strength training without Hevy. */
  /** The rider took a new week plan: the next workout is planned again for it. */
  weekPlanChanged(id: string): void { this.update(id, (s) => { s.dirty = true; s.attempts = 0; }); }
  /** A task from the week chat or another coach: the next workout is planned again with it. */
  taskAdded(id: string): void { this.update(id, (s) => { s.dirty = true; s.attempts = 0; }); }
  /** A new activity from any source, planned or not (a ride, a run, Garmin): the next workout is planned again. */
  activityAdded(id: string): void { this.update(id, (s) => { s.dirty = true; s.attempts = 0; }); }
  start(id: string): void { if (!this.state(id).localStart) this.update(id, (s) => { s.localStart = true; }); }

  /**
   * Own and Hevy workouts as one list. With Hevy the live Hevy list is used; without it the Hevy workouts imported
   * earlier take its place. Unconfirmed sets of an own workout never count.
   */
  history(id: string): StrengthWorkout[] {
    const links = this.links(id);
    const all = this.logged(id);
    const own = historyFromLogged(onePerSession(all.filter((w) => w.source !== 'hevy' && w.endMs !== null)), links);
    const deleted = this.deletedByPerson(id);
    const hevy = this.isHevy(id) ? this.deps.workouts(id).filter((w) => Array.isArray(w.exercises) && !deleted.has(w.id)) : historyFromLogged(all.filter((w) => w.source === 'hevy'), links);
    return mergeHistory(own, hevy, links);
  }
  /** Ids the person deleted here or on the phone. Hevy's list still has them; the person's word counts. */
  private deletedByPerson(id: string): Set<string> {
    return new Set((this.deps.store?.all(id, 'workout') ?? []).filter((r) => r.deleted && !goneFromHevy(r)).map((r) => r.id));
  }
  hasHistory(id: string): boolean { return this.history(id).length > 0; }

  /** Keeps Hevy workouts in the store, so they stay when Hevy is removed. Identical workouts change nothing. */
  importHevy(id: string): void {
    if (!this.deps.store || !this.isHevy(id)) return;
    const hevy = this.deps.workouts(id);
    const now = this.deps.nowMs();
    const links = this.links(id);
    const stored = new Map(this.deps.store.all(id, 'workout').map((r) => [r.id, r]));
    const records: TrackedRecord[] = [];
    for (const w of hevy) {
      const r = hevyRecord(w, links);
      const have = stored.get(r.id);
      // Our own tombstone (it was gone from Hevy's list) and present again: written live and newer, so a rebuild cannot let the tombstone win.
      if (have?.deleted && goneFromHevy(have)) records.push({ ...r, updatedMs: Math.max(now, have.updatedMs + 1) });
      // The person deleted it: it stays deleted, whatever Hevy still lists.
      else if (have?.deleted) continue;
      // Already live with the same content under a newer time (a revived one): nothing to write.
      else if (have && have.updatedMs > r.updatedMs && JSON.stringify(have.body) === JSON.stringify(r.body)) continue;
      // Stored before a link existed (still the plain Hevy ids): written again with the own ids, newer so it wins.
      else if (have && !have.deleted && JSON.stringify(have.body) === JSON.stringify(hevyRecord(w).body) && JSON.stringify(have.body) !== JSON.stringify(r.body)) records.push({ ...r, updatedMs: Math.max(r.updatedMs, have.updatedMs + 1) });
      else records.push(r);
    }
    // Only a complete list can say a workout is gone. While Hevy still loads, nothing is removed.
    if (this.deps.ready(id)) {
      const present = new Set(hevy.map((w) => w.id));
      for (const r of this.deps.store.all(id, 'workout')) {
        if (!r.deleted && (r.body as LoggedWorkout | null)?.source === 'hevy' && !present.has(r.id)) records.push({ ...r, deleted: true, updatedMs: now, body: { ...(r.body as object), goneFromHevy: true } });
      }
    }
    if (records.length > 0) this.deps.store.putMany(id, records);
  }
  private imported = new Set<string>();

  /** Own exercises, the rider's own ones, and Hevy's that are not linked to an own one (under their Hevy id). */
  async templateList(id: string, fresh = false): Promise<ExerciseTemplate[]> {
    const catalog = this.catalog(id);
    let hevy: ExerciseTemplate[] = [];
    if (this.isHevy(id)) {
      hevy = await (fresh ? this.deps.refreshTemplates(id) : this.deps.templates(id));
      // Derived from the current catalog on every run, so an undone or changed link follows. A stored link survives only where its template
      // is not listed now (a failed or emptied fetch, a removed template must not split the history) or the catalog still says the same.
      const derived = linkHevyTemplates(hevy, catalog);
      const listed = new Set(hevy.map((t) => t.id));
      const kept = Object.entries(this.state(id).links).filter(([tid, own]) => !listed.has(tid) || derived.get(tid) === own);
      const links = { ...Object.fromEntries(kept), ...Object.fromEntries(derived) };
      if (JSON.stringify(links) !== JSON.stringify(this.state(id).links)) this.update(id, (s) => { s.links = links; });
    }
    const linked = new Set(Object.keys(this.state(id).links));
    // With Hevy the plan stays with Hevy's list; an own exercise joins it once it is linked or has been done in the app.
    const used = new Set(this.logged(id).filter((w) => w.source !== 'hevy').flatMap((w) => w.exercises.map((e) => e.exerciseId)));
    const builtIn = new Set(EXERCISES.map((e) => e.id));
    const linkedOwn = new Set(Object.values(this.state(id).links));
    // The base list (thousands) is not offered as a whole: built-ins, the person's own and those used or linked are.
    const own: ExerciseTemplate[] = catalog.filter((e) => builtIn.has(e.id) ? !this.isHevy(id) || used.has(e.id) || linkedOwn.has(e.id) : e.source === 'user' || e.source === 'ai' || used.has(e.id) || linkedOwn.has(e.id))
      .map((e) => ({ id: e.id, title: e.title, type: e.type, primaryMuscle: e.primaryMuscle, equipment: e.equipment }));
    const have = new Set(own.map((t) => t.id));
    const list = [...own, ...this.ownExercises(id).filter((t) => !have.has(t.id)), ...hevy.filter((t) => !linked.has(t.id))];
    // Remembered with the unlinked Hevy templates and the whole catalog, so any known id finds its muscle.
    this.listed.set(id, new Map([...hevy, ...list].map((t) => [t.id, t] as const)));
    this.known.set(id, new Map([...catalog.map((e) => [e.id, e.primaryMuscle] as const), ...[...hevy, ...list].map((t) => [t.id, t.primaryMuscle] as const)]));
    return list;
  }
  private known = new Map<string, Map<string, string>>();
  private listed = new Map<string, Map<string, ExerciseTemplate>>();
  /**
   * What the next plan would give for each exercise of the latest workout, with the words for why. It uses exactly what the plan uses
   * (studio, weight steps, renames, the template of the last list), so "next time" and the next plan agree. Empty before the first template list.
   */
  nextSteps(id: string): NextStep[] {
    const now = this.deps.nowMs();
    const known = this.listed.get(id);
    if (!known) return [];
    const real = this.history(id).filter((w) => w.startMs <= now && hasSetDetails(w));
    const latest = real.reduce<StrengthWorkout | null>((a, w) => (!a || w.startMs > a.startMs ? w : a), null);
    if (!latest) return [];
    const plan = { studio: this.studio(id), overrides: this.loadSteps(id), renames: this.studios(id).renames };
    const seen = new Set<string>();
    const out: NextStep[] = [];
    for (const e of latest.exercises) {
      if (!e.templateId || seen.has(e.templateId)) continue;
      seen.add(e.templateId);
      const t = known.get(e.templateId);
      const s = suggestNext(e.templateId, real, now, t, plan);
      if (s.why === 'none') continue;
      out.push({ exerciseId: e.templateId, title: t?.title ?? e.title, weightKg: s.weightKg, reps: s.reps, why: s.why, reason: s.reason, forWorkoutId: latest.id, atMs: latest.startMs });
    }
    return out.slice(0, 30);
  }
  /** The strength facts for the monthly review, from the stored workouts. Null before the first template list, like `nextSteps`. */
  reviewFacts(id: string): StrengthFacts | null {
    const listed = this.listed.get(id);
    if (!listed) return null;
    const now = this.deps.nowMs();
    const goal = this.deps.store ? goalOfProfile(this.deps.store, id, dateKey(now)) : goalOf([], dateKey(now));
    return strengthFacts(this.history(id), [...listed.values()], this.catalog(id), { strength: goal.strength, focus: goal.focus }, now);
  }
  /** What the coach changed on exercises, newest last: the notes of the plans, kept up to 20 and 60 days. */
  changeNotes(id: string): ChangeNote[] { return this.state(id).changeNotes.map(({ key: _k, ...n }) => n); }
  /**
   * After a plan: an exercise whose first work weight differs from the last session's gets a note with the reason the progression
   * gives. One note per exercise and latest workout, so replanning replaces it. Never throws; a note is a bonus.
   */
  private noteChanges(id: string): void {
    try {
      const now = this.deps.nowMs();
      const next = this.state(id).next;
      if (!next) return;
      const real = this.history(id).filter((w) => w.startMs <= now && hasSetDetails(w));
      const latest = real.reduce<StrengthWorkout | null>((a, w) => (!a || w.startMs > a.startMs ? w : a), null);
      if (!latest) return;
      const known = this.listed.get(id);
      const plan = { studio: this.studio(id), overrides: this.loadSteps(id), renames: this.studios(id).renames };
      const firstKg = (sets: { type: string; weightKg: number | null }[]): number | null => sets.find((x) => x.type === 'normal' && x.weightKg !== null)?.weightKg ?? null;
      const fmt = (kg: number): string => String(kg).replace('.', ',');
      let notes = this.state(id).changeNotes;
      const before = JSON.stringify(notes);
      const seen = new Set<string>();
      for (const e of next.workout.exercises) {
        if (!e.templateId || seen.has(e.templateId)) continue;
        seen.add(e.templateId);
        const t = known?.get(e.templateId);
        const key = `${e.templateId}|${latest.id}`;
        const last = real.filter((w) => w.exercises.some((x) => x.templateId === e.templateId)).sort((a, b) => b.startMs - a.startMs)[0];
        const was = last ? firstKg(last.exercises.find((x) => x.templateId === e.templateId)!.workSets) : null;
        const to = firstKg(e.sets);
        if (was === null || to === null || was === to || isAssisted(t?.type)) { notes = notes.filter((n) => n.key !== key); continue; }
        const s = suggestNext(e.templateId, real, now, t, plan);
        const agrees = (to > was && s.why === 'progress') || (to < was && s.why === 'step-back');
        notes = addNote(notes, { atMs: now, coach: 'gym', text: `${t?.title ?? e.title}: ${fmt(was)} → ${fmt(to)} kg`, reason: agrees && s.reason ? s.reason : 'weil der Plan es so vorsieht', key }, now);
      }
      if (JSON.stringify(notes) !== before) this.update(id, (x) => { x.changeNotes = notes; });
    } catch { /* the plan stands without its note */ }
  }
  /** Whether a template list of this profile was made since the start. */
  knowsTemplates(id: string): boolean { return this.known.has(id); }
  /** The primary muscle of a template from the last template list of this profile; null before the first one or when unknown. */
  templateMuscle(id: string, templateId: string): string | null {
    return this.known.get(id)?.get(templateId) || null;
  }
  private ownExercises(id: string): ExerciseTemplate[] {
    if (!this.deps.store) return [];
    return this.deps.store.all(id, 'exercise').flatMap((r) => {
      const b = r.body as Partial<ExerciseTemplate> | null;
      if (r.deleted || !b || typeof b.title !== 'string' || typeof b.type !== 'string') return [];
      return [{ id: r.id, title: b.title, type: b.type, primaryMuscle: String(b.primaryMuscle ?? ''), equipment: String(b.equipment ?? '') }];
    });
  }

  /** Own ids become Hevy ids for the export. An own exercise with no Hevy id is left out, by title. */
  private toHevy(id: string, w: GymWorkout): { workout: GymWorkout; leftOut: string[] } {
    const reverse = new Map<string, string>();
    // With several Hevy templates linked to one exercise, the most recently used one wins; without use, the first listed.
    const lastUsed = new Map<string, number>();
    try { for (const w of this.deps.workouts(id)) for (const e of w.exercises ?? []) lastUsed.set(e.templateId, Math.max(lastUsed.get(e.templateId) ?? 0, w.startMs)); } catch { /* no usage data: first listed */ }
    for (const [hevyId, ownId] of Object.entries(this.state(id).links)) {
      const have = reverse.get(ownId);
      if (have === undefined || (lastUsed.get(hevyId) ?? 0) > (lastUsed.get(have) ?? 0)) reverse.set(ownId, hevyId);
    }
    const ownIds = new Set([...this.catalog(id).map((e) => e.id), ...this.ownExercises(id).map((t) => t.id)]);
    const leftOut: string[] = [];
    const exercises: GymExercise[] = [];
    for (const e of w.exercises) {
      const hevyId = reverse.get(e.templateId);
      if (hevyId) exercises.push({ ...structuredClone(e), templateId: hevyId });
      else if (ownIds.has(e.templateId)) leftOut.push(e.title);
      else exercises.push(structuredClone(e));
    }
    // A superset needs two members.
    for (const e of exercises) if (e.supersetId !== null && exercises.filter((x) => x.supersetId === e.supersetId).length < 2) e.supersetId = null;
    return { workout: { ...w, exercises }, leftOut };
  }

  private update(id: string, fn: (s: GymState) => void): void {
    const s = this.state(id);
    fn(s);
    saveGymState(this.deps.dir, s);
  }
  private gen(id: string): number { return this.generation.get(id) ?? 0; }
  /** Drops the change when `forget` ran since the work began. */
  private updateIf(gen: number, id: string, fn: (s: GymState) => void): void {
    if (this.gen(id) === gen) this.update(id, fn);
  }

  tick(id: string): Promise<void> {
    const active = this.running.get(id);
    if (active) return active;
    const run: Promise<void> = this.plan(id).then((planned) => { if (planned) this.noteChanges(id); }).finally(() => { if (this.running.get(id) === run) this.running.delete(id); });
    this.running.set(id, run);
    return run;
  }

  private async plan(id: string): Promise<boolean> {
    if (!this.enabled(id) || !this.deps.ready(id)) return false;
    // Workouts loaded before the store existed reach it once, without waiting for a change.
    if (this.isHevy(id) && !this.imported.has(id)) { this.imported.add(id); try { this.importHevy(id); } catch { this.imported.delete(id); } }
    const now = this.deps.nowMs();
    let real = this.history(id).filter((w) => w.startMs <= now && hasSetDetails(w));
    this.askAboutGym(id, real, now);
    const s = this.state(id);
    const open = this.deps.bike(id).complaints.filter((c) => c.status !== 'over');
    const used = complaintsFingerprint(open);
    // Stored right away, so a failing plan retries through dirty and the attempts limit, not through this.
    if (used !== s.complaintsFingerprint) this.update(id, (x) => { x.complaintsFingerprint = used; x.dirty = true; x.attempts = 0; });
    const seen = new Set(s.seenWorkoutIds);
    const unseen = real.filter((w) => !seen.has(w.id));
    if (s.planned && !s.dirty && unseen.length === 0) return false;
    const newest = (list: StrengthWorkout[]) => list.reduce<StrengthWorkout | null>((a, w) => (!a || w.startMs > a.startMs ? w : a), null);
    const key = (newest(unseen) ?? newest(real))?.id ?? 'none';
    if (s.attemptKey !== key) this.update(id, (x) => { x.attemptKey = key; x.attempts = 0; });
    if (s.attempts > 0 && (s.attempts >= MAX_ATTEMPTS || (s.lastAttemptMs !== null && now - s.lastAttemptMs < RETRY_MS))) return false;
    if (s.templatesFailedMs !== null && now - s.templatesFailedMs < RETRY_MS) return false;
    this.update(id, (x) => { x.dirty = true; });
    const latest = newest(real);
    // Old workouts surfacing during a break get no feedback, which would also replace the note about the break.
    const onBreak = latest !== null && now - latest.startMs > LONG_BREAK_DAYS * DAY_MS;
    const wantNote = s.planned && unseen.length > 0 && !onBreak;
    const previous = s.next;
    const gen = this.gen(id);
    let templates: ExerciseTemplate[];
    try {
      templates = await this.templateList(id);
    } catch {
      this.updateIf(gen, id, (x) => { x.lastError = 'failed'; x.templatesFailedMs = now; });
      return false;
    }
    this.updateIf(gen, id, (x) => { x.templatesFailedMs = null; x.attempts += 1; x.lastAttemptMs = now; });
    try {
      const ids = new Set(templates.map((t) => t.id));
      if (this.isHevy(id) && real.some((w) => w.exercises.some((e) => e.templateId && !ids.has(e.templateId)))) {
        // Once per plan. A failure keeps what is known; such exercises are left out.
        try { templates = await this.templateList(id, true); } catch { /* keep the known list */ }
      }
      // The templates may have brought new links, which merge exercises in the history.
      real = this.history(id).filter((w) => w.startMs <= now && hasSetDetails(w));
      const studio = this.studio(id);
      const overrides = this.loadSteps(id);
      const excluded = this.excluded(id);
      const budget = this.deps.store ? gymBudgetOf(this.deps.store, id, dateKey(now), real.map((w) => dateKey(w.startMs))) : null;
      const avoidLegs = open.some((c) => LEG_COMPLAINT.test(c.text)) || this.deps.avoidLegs?.(id) === true;
      const goal = this.deps.store ? goalOfProfile(this.deps.store, id, dateKey(now)) : goalOf([], dateKey(now));
      // Computed once: the guardrail and the prompt must hold the same push.
      const push = effectivePush(goal, open);
      const section = this.section(id, real, templates, now, open, avoidLegs, excluded);
      const ctx: GymContext = { ...(section ? { block: section.block } : {}), workouts: real, templates, nowMs: now, push, excluded, catalog: this.catalog(id), links: this.state(id).links, ...(studio ? { studio } : {}), overrides, renames: this.studios(id).renames, ...(avoidLegs ? { avoidLegs: true } : {}), ...(budget !== null ? { budgetMinutes: budget } : {}) };
      const rule = ruleWorkout(ctx);
      if (rule.guard) console.warn(`Regel-Training: erster Plan verworfen (${rule.guard})`);
      if (open.length > 0 && rule.workout.exercises.length > 0) rule.reason = `${rule.reason} ${COMPLAINT_HINT}`;
      const hasRule = rule.workout.exercises.length > 0;
      if (real.length === 0) {
        // Nothing to learn from yet: the plain rule workout is the plan, and the AI is not asked.
        this.updateIf(gen, id, (x) => {
          x.next = hasRule ? { workout: rule.workout, reason: this.withTaken(id, rule.reason), source: 'rules' } : null;
          x.emptyReason = hasRule ? null : rule.reason;
          x.lastError = null; x.dirty = false; x.planned = true; x.attempts = 0; x.seenWorkoutIds = [];
        });
        return true;
      }
      // An empty rule workout is never stored as an offer; only its reason is kept.
      this.updateIf(gen, id, (x) => {
        x.next = hasRule ? { workout: rule.workout, reason: this.withTaken(id, rule.reason), source: 'rules' } : null;
        x.emptyReason = hasRule ? null : rule.reason;
      });
      const review = this.deps.store ? latestReview(chatThread(this.deps.store.all(id, 'chat'))) : null;
      const ask = (rejection?: string) => this.deps.ask({
        prompt: buildGymPrompt({ state: this.state(id), workouts: real, templates, nowMs: now, ...this.deps.bike(id), previous, wantNote, rejection, mobility: this.mobilityData(id), swaps: this.swapsTaken(id), catalog: this.catalog(id), ...(studio ? { studio } : {}), overrides, renames: this.studios(id).renames, excluded, ...(avoidLegs ? { avoidLegs: true } : {}), goal, push, ...(this.deps.store ? { wishes: wishesOf(this.deps.store, id, 'gym') } : {}), ...(review ? { review } : {}), ...(section ? { abschnitt: section.prompt } : {}), ...(budget !== null ? { budgetMinutes: budget } : {}) }) + (this.deps.planHint?.(id) ?? ''),
        systemPrompt: GYM_SYSTEM_PROMPT, schema: gymAnswerJsonSchema,
      });
      let raw = await ask();
      this.handOff(id, raw);
      const rejected = this.rejection(raw, ctx);
      if (rejected) {
        // Exactly one second attempt with the reason, after that the rules take over.
        try { raw = await ask(rejected); this.handOff(id, raw); } catch { /* The first answer decides. */ }
      }
      const parsed = gymAnswerSchema.safeParse(raw);
      const checked = parsed.success ? checkWorkout(parsed.data.workout, ctx) : null;
      this.updateIf(gen, id, (x) => {
        if (parsed.success && checked?.ok) this.applyAnswer(x, parsed.data, checked.workout, real, wantNote, now, id);
        else {
          x.lastError = 'invalid';
          // The rules take over; say so in words instead of the neutral sentence.
          const why = parsed.success ? (checked && !checked.ok ? checked.reason : '') : 'Schema';
          if (x.next?.source === 'rules') x.next = { ...x.next, reason: this.withTaken(id, `Mein Plan passte nicht zu deinen Grenzen (${reasonPhrase(why)}), deshalb gibt es heute einen einfachen Plan. Dauer ${durationNote(x.next.workout, this.catalog(id))}.`) };
        }
        x.dirty = false; x.planned = true; x.attempts = 0;
        x.seenWorkoutIds = real.map((w) => w.id);
      });
      return true;
    } catch (e) {
      this.updateIf(gen, id, (x) => { x.lastError = e instanceof ClaudeError ? e.kind : 'failed'; x.dirty = true; });
      return false;
    }
  }

  /** Tasks for the other coaches in an answer. Never throws. */
  private handOff(id: string, raw: unknown): void {
    try { for (const t of readTasks((raw as { tasks?: unknown } | null)?.tasks)) this.deps.giveTask?.(id, t); } catch { /* a task is a bonus */ }
  }

  private mobilityData(id: string): unknown { try { return this.deps.mobility?.(id) ?? undefined; } catch { return undefined; } }

  private rejection(raw: unknown, ctx: GymContext): string | null {
    const parsed = gymAnswerSchema.safeParse(raw);
    if (!parsed.success) return 'Die Antwort passte nicht zum Schema.';
    const checked = checkWorkout(parsed.data.workout, ctx);
    return checked.ok ? null : checked.reason;
  }

  /** The sketch without exercises the person's rules rule out (matched by title, the sketch has no ids). */
  private withoutExcluded(id: string, o: GymOutlook): GymOutlook {
    const own = this.deps.store ? excludedOf(this.deps.store, id, this.catalog(id)) : new Set<string>();
    if (own.size === 0) return o;
    const catalog = this.catalog(id);
    return { ...o, sessions: o.sessions.map((x) => ({ ...x, exercises: x.exercises.filter((e) => !isExcluded({ title: e.title }, own, catalog)) })).filter((x) => x.exercises.length > 0) };
  }

  private applyAnswer(s: GymState, a: GymAnswer, workout: GymWorkout, real: StrengthWorkout[], wantNote: boolean, now: number, id: string): void {
    const honest = (text: string) => honestFigures(text, figures(real, workout));
    const fallback = s.next?.source === 'rules' ? s.next.reason : NEUTRAL_REASON;
    const reason = clean(a.reason, TEXT_MAX);
    s.next = { workout, reason: this.withTaken(id, `${((reason && honest(reason)) || fallback).replace(/\s*Dauer ca\. \d+ Min\./, '')} Dauer ${durationNote(workout, this.catalog(id))}.`), source: 'claude' };
    // A sketch without weights; an answer without one keeps the last sketch rather than none.
    const outlook = readOutlook(a.outlook);
    s.outlook = outlook ? this.withoutExcluded(id, outlook) : s.outlook;
    s.emptyReason = null;
    s.lastError = null;
    if (!wantNote) return;
    const text = clean(a.note, TEXT_MAX);
    const newest = real.reduce((m, w) => (w.startMs > m.startMs ? w : m), real[0]);
    const checkedText = text && honest(text);
    s.lastNote = checkedText ? {
      workoutId: newest.id, text: checkedText, atMs: now,
      questions: (a.questions ?? []).flatMap((q) => { const c = clean(q, QUESTION_MAX); return c && honest(c) ? [c] : []; }).slice(0, MAX_QUESTIONS),
    } : null;
  }

  /** After a long break the coach asks once whether the gym is still the same, and rebuilds the plan with stepped-back weights. */
  private askAboutGym(id: string, real: StrengthWorkout[], now: number): void {
    const s = this.state(id);
    if (real.length === 0) return;
    const newest = real.reduce((m, w) => (w.startMs > m.startMs ? w : m), real[0]);
    if (now - newest.startMs <= LONG_BREAK_DAYS * DAY_MS) {
      if (s.gymAsked) this.update(id, (x) => { x.gymAsked = false; });
      return;
    }
    if (s.gymAsked) return;
    this.update(id, (x) => { x.gymAsked = true; x.dirty = true; x.attempts = 0; x.lastNote = { workoutId: newest.id, text: BREAK_NOTE, questions: [GYM_QUESTION], atMs: now }; });
  }

  adjust(id: string, how: 'easier' | 'harder' | 'shorter'): void {
    const next = this.state(id).next;
    if (!next || next.workout.exercises.length === 0) return;
    if (how !== 'easier' && how !== 'harder' && how !== 'shorter') return;
    const w = structuredClone(next.workout);
    if (how === 'easier') {
      for (const e of w.exercises) {
        const work = e.sets.map((_, i) => i).filter((i) => e.sets[i].type !== 'warmup' && !isWidowSet(e, i));
        if (work.length > 1) e.sets.splice(work[work.length - 1], 1);
      }
    } else if (how === 'harder') {
      for (const e of w.exercises) {
        if (w.exercises.reduce((n, x) => n + x.sets.filter((s) => s.type !== 'warmup').length, 0) >= MAX_SETS) break;
        const last = e.sets.map((s, i) => ({ s, i })).filter(({ s, i }) => s.type === 'normal' && !isWidowSet(e, i)).pop();
        if (last && !isWidowmaker(e)) e.sets.push({ ...last.s });
      }
    } else if (how === 'shorter') {
      if (w.exercises.length <= 1) return;
      w.exercises.splice(w.exercises.length - Math.ceil(w.exercises.length / 3));
      const ids = w.exercises.map((e) => e.supersetId).filter((v): v is number => v !== null);
      for (const e of w.exercises) if (e.supersetId !== null && ids.filter((v) => v === e.supersetId).length < 2) e.supersetId = null;
    }
    this.update(id, (s) => { s.next = { ...next, workout: w }; });
  }

  note(id: string, text: string): void {
    this.update(id, (s) => {
      const now = this.deps.nowMs();
      s.notes = [...s.notes, { atMs: now, text: text.slice(0, 300) }].slice(-MAX_NOTES);
      this.keepComplaint(id, text);
      s.dirty = true; s.attempts = 0;
    });
  }

  answer(id: string, question: string, text: string): void {
    this.update(id, (s) => {
      const now = this.deps.nowMs();
      s.answers = [...s.answers, { atMs: now, question: question.slice(0, QUESTION_MAX), text: text.slice(0, 300) }].slice(-MAX_ANSWERS);
      if (s.lastNote) s.lastNote.questions = s.lastNote.questions.filter((q) => q !== question);
      // Only the rider's own words are checked, so a "fine" answer to a question about a knee is no complaint.
      this.keepComplaint(id, text);
      s.dirty = true; s.attempts = 0;
    });
  }

  /** A body complaint goes to the bike coach. */
  private keepComplaint(id: string, text: string): void {
    if (!complaintFromNote(text)) return;
    this.deps.complaint(id, text);
  }

  skipQuestion(id: string, question: string): void {
    this.update(id, (s) => { if (s.lastNote) s.lastNote.questions = s.lastNote.questions.filter((q) => q !== question); });
  }

  forget(id: string): void {
    this.generation.set(id, this.gen(id) + 1);
    this.running.delete(id);
    this.states.delete(id);
    this.previews.delete(id);
    removeGymState(this.deps.dir, id);
  }

  /** Shows what would be written. Asks Hevy whether the routine was edited since the last write, and writes nothing. */
  async preview(id: string): Promise<{ workout: GymWorkout; edited: boolean; leftOut: string[] } | null> {
    const writer = this.isHevy(id) ? this.deps.writer(id) : null;
    const s = this.state(id);
    if (!this.deps.ready(id) || !writer || !s.next || s.next.workout.exercises.length === 0) return null;
    const fp = fingerprint(s.next.workout);
    const { workout, leftOut } = this.toHevy(id, s.next.workout);
    try {
      const edited = s.routine && workout.exercises.length > 0 ? await writer.editedSince(s.routine.routineId, s.routine.updatedAt) : false;
      this.previews.set(id, { fp, edited });
      return { workout, edited, leftOut };
    } catch {
      return null;
    }
  }

  /** Writes the previewed workout. Stale when the workout changed since the preview or the routine was edited in Hevy after it. */
  async confirm(id: string, name: string): Promise<'written' | 'stale' | 'failed'> {
    const writer = this.isHevy(id) ? this.deps.writer(id) : null;
    const start = this.state(id).next;
    if (!this.deps.ready(id) || !writer || !start || start.workout.exercises.length === 0 || this.writing.has(id)) return 'failed';
    // Nothing of it exists in Hevy: there is nothing to write.
    if (this.toHevy(id, start.workout).workout.exercises.length === 0) return 'failed';
    const shown = this.previews.get(id);
    if (!shown || shown.fp !== fingerprint(start.workout)) return 'stale';
    this.writing.add(id);
    const gen = this.gen(id);
    try {
      const known = this.state(id).routine;
      // An edit the rider already saw in the preview was confirmed with it. Only a new one makes this stale.
      if (known && !shown.edited && await writer.editedSince(known.routineId, known.updatedAt)) return 'stale';
      const current = this.state(id).next;
      if (!this.deps.ready(id) || this.gen(id) !== gen) return 'failed';
      if (!current || fingerprint(current.workout) !== shown.fp) return 'stale';
      const workout = { ...this.toHevy(id, current.workout).workout, name: name.trim().slice(0, NAME_MAX) || current.workout.name };
      const written = await writer.writeRoutine(workout, { routineId: known?.routineId ?? null, updatedAt: known?.updatedAt ?? null }, this.catalog(id));
      this.previews.delete(id);
      this.updateIf(gen, id, (s) => { s.routine = { routineId: written.routineId, updatedAt: written.updatedAt }; });
      return 'written';
    } catch (e) {
      if (!refusedByHevy(e)) return 'failed';
      // Probably a template that vanished: retrying the same workout would never work, so the rider gets a rebuilt plan.
      if (this.deps.ready(id)) { try { await this.templateList(id, true); } catch { /* the plan uses what is known */ } }
      this.previews.delete(id);
      this.updateIf(gen, id, (s) => { s.dirty = true; s.attempts = 0; });
      return 'stale';
    } finally {
      this.writing.delete(id);
    }
  }
}

/** Every figure the coach may name: what was done and what is planned, plus the rep range. */
function figures(real: StrengthWorkout[], planned: GymWorkout): { weights: number[]; reps: number[]; sets: number[] } {
  const weights: number[] = [];
  const reps: number[] = [...Object.values(MUSCLE_TARGETS).flatMap((t) => [t.reps.min, t.reps.max]), WIDOWMAKER_REPS];
  const sets: number[] = [1];
  for (const w of real) {
    let total = 0;
    for (const e of w.exercises) {
      sets.push(e.workSets.length, e.sets);
      total += e.workSets.length;
      for (const s of e.workSets) { if (s.weightKg !== null) weights.push(s.weightKg); if (s.reps !== null) reps.push(s.reps); }
    }
    sets.push(total);
  }
  let total = 0;
  for (const e of planned.exercises) {
    sets.push(e.sets.length);
    total += e.sets.length;
    for (const s of e.sets) {
      if (s.weightKg !== null) weights.push(s.weightKg);
      for (const r of [s.reps, s.repRange?.start, s.repRange?.end]) if (r !== null && r !== undefined) reps.push(r);
    }
  }
  sets.push(total);
  return { weights, reps, sets };
}
