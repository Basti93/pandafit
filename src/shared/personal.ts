import type { TrackedRecord } from './records';
import type { MuscleGroup } from './muscle-targets';
import { titleHash, above } from './exercise-links';
import { addDays } from './week-plan';
import { ruleNumber } from './training-policy';
import { takenChanges } from './changes';
import { activeBlock, blockWeek } from './block';
import type { Exercise } from './exercises';
import { familyLabel, familyOf, isExcludableFamily, MAX_FAMILIES } from './families';

const isObj = (x: unknown): x is Record<string, unknown> => typeof x === 'object' && x !== null && !Array.isArray(x);
const num = (x: unknown): x is number => typeof x === 'number' && Number.isFinite(x);

/** The muscle groups a person can put the focus on (everything the targets know except "other"). */
export const FOCUS_GROUPS: Exclude<MuscleGroup, 'other'>[] = ['chest', 'back', 'front_delts', 'side_delts', 'rear_delts', 'biceps', 'triceps', 'quads', 'hamstrings', 'glutes', 'calves', 'abs', 'traps', 'forearms'];
export const MAX_FOCUS = 3;
export const RULE_TEXT_MAX = 120;
export const MAX_EXCLUDED = 30;

export type Strength = 'muscle' | 'strength' | 'fitness';
export type Prio = 'focus' | 'equal' | 'keep';
export type SportKey = 'gym' | 'bike' | 'run';
/** A focus that lies over the base goal until a date (inclusive). It never changes the base; `endedSeenMs` hides the end notice. */
export type TemporaryFocus = { focus?: MuscleGroup[]; sports?: Partial<Record<SportKey, Prio>>; until: string; endedSeenMs?: number };
/** How hard the coach pushes. A goal without `push` counts as normal, so code can tell that it was never chosen. */
export type Push = 'gentle' | 'normal' | 'hard';
export const PUSH_LABEL: Record<Push, string> = { gentle: 'Vorsichtig', normal: 'Normal', hard: 'Fordere mich' };
/** Bo's question for the push, asked once (docs/superpowers/specs/2026-11-10-monatsrueckblick-design.md §4). */
export const PUSH_QUESTION = 'Wie sehr soll ich dich beim Krafttraining fordern? Du kannst das jederzeit im Profil ändern.';
export type GoalBody = { strength: Strength; focus: MuscleGroup[]; sports: Partial<Record<SportKey, Prio>>; push?: Push; temporary?: TemporaryFocus; atMs: number };
export const DEFAULT_GOAL: Omit<GoalBody, 'atMs'> = { strength: 'muscle', focus: [], sports: {} };
export const MAX_WEEKS = 12;
/** The goal as the coaches and screens use it: the base with an active temporary focus laid over it, plus a recently ended one. */
export type EffectiveGoal = Omit<GoalBody, 'atMs' | 'temporary'> & { temporary?: TemporaryFocus; ended?: { until: string; focus: MuscleGroup[]; sports: Partial<Record<SportKey, Prio>> } };

const STRENGTHS: Strength[] = ['muscle', 'strength', 'fitness'];
const PRIOS: Prio[] = ['focus', 'equal', 'keep'];
const SPORT_KEYS: SportKey[] = ['gym', 'bike', 'run'];
export const PUSHES: readonly Push[] = ['gentle', 'normal', 'hard'];

/** The hardness that applies now: gentle while a complaint is active or healing, else the chosen one (normal if never chosen). */
export const effectivePush = (goal: { push?: Push }, complaints: readonly { status: string }[]): Push =>
  complaints.some((c) => c.status === 'active' || c.status === 'healing') ? 'gentle' : goal.push ?? 'normal';

/** One goal per profile: record kind `goal`, id `goal`. */
export const GOAL_ID = 'goal';

function readGoalParts(b: Record<string, unknown>): Omit<GoalBody, 'atMs'> | null {
  if (!STRENGTHS.includes(b.strength as Strength)) return null;
  if (!Array.isArray(b.focus) || b.focus.length > MAX_FOCUS || !b.focus.every((g) => FOCUS_GROUPS.includes(g as never)) || new Set(b.focus).size !== b.focus.length) return null;
  if (!isObj(b.sports)) return null;
  const sports: Partial<Record<SportKey, Prio>> = {};
  for (const [k, v] of Object.entries(b.sports)) {
    if (!SPORT_KEYS.includes(k as SportKey) || !PRIOS.includes(v as Prio)) return null;
    sports[k as SportKey] = v as Prio;
  }
  if (b.push !== undefined && !PUSHES.includes(b.push as Push)) return null;
  return { strength: b.strength as Strength, focus: b.focus as MuscleGroup[], sports, ...(b.push !== undefined ? { push: b.push as Push } : {}) };
}

const isDateKey = (x: unknown): x is string => typeof x === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(x) && addDays(x, 0) === x;

function readTemporary(t: unknown): TemporaryFocus | null {
  if (!isObj(t) || !isDateKey(t.until) || (t.focus === undefined && t.sports === undefined)) return null;
  if (t.endedSeenMs !== undefined && !num(t.endedSeenMs)) return null;
  const parts = readGoalParts({ strength: 'muscle', focus: t.focus ?? [], sports: t.sports ?? {} });
  if (!parts) return null;
  return { ...(t.focus !== undefined ? { focus: parts.focus } : {}), ...(t.sports !== undefined ? { sports: parts.sports } : {}), until: t.until, ...(t.endedSeenMs !== undefined ? { endedSeenMs: t.endedSeenMs as number } : {}) };
}

/** The body of a `goal` record, or null for anything else. A record without `temporary` reads as before. */
export function readGoal(body: unknown): GoalBody | null {
  if (!isObj(body) || !num(body.atMs)) return null;
  const g = readGoalParts(body);
  if (!g) return null;
  if (body.temporary === undefined) return { ...g, atMs: body.atMs };
  const temporary = readTemporary(body.temporary);
  return temporary ? { ...g, temporary, atMs: body.atMs } : null;
}

export const goalRecord = (g: Omit<GoalBody, 'atMs'>, nowMs: number, have?: TrackedRecord): TrackedRecord =>
  ({ kind: 'goal', id: GOAL_ID, updatedMs: above(nowMs, have), deleted: false, body: { ...g, atMs: nowMs } });

/** The stored goal as it is, whatever the date (default without a readable record). Edits start from this, never from the overlay. */
export function storedGoalOf(records: readonly TrackedRecord[]): Omit<GoalBody, 'atMs'> {
  const r = records.find((x) => x.kind === 'goal' && x.id === GOAL_ID && !x.deleted);
  const g = r ? readGoal(r.body) : null;
  return g ? { strength: g.strength, focus: g.focus, sports: g.sports, ...(g.push ? { push: g.push } : {}), ...(g.temporary ? { temporary: g.temporary } : {}) } : { ...DEFAULT_GOAL, focus: [], sports: {} };
}

/**
 * The profile's goal on `today` (YYYY-MM-DD): the base, overlaid by a temporary focus while today <= until. After that the base
 * returns, and `ended` says what ran out for `focus.ended-notice-days` days unless the person has seen it.
 * Without a record (or a readable one) today's behaviour: build muscle, no focus, no priorities.
 */
export function goalOf(records: readonly TrackedRecord[], today: string): EffectiveGoal {
  const { temporary: t, ...base } = storedGoalOf(records);
  if (!t) return base;
  if (today <= t.until) return { ...base, focus: t.focus ?? base.focus, sports: { ...base.sports, ...t.sports }, temporary: t };
  const noticeUntil = addDays(t.until, ruleNumber('focus.ended-notice-days'));
  return t.endedSeenMs === undefined && today <= noticeUntil ? { ...base, ended: { until: t.until, focus: t.focus ?? [], sports: t.sports ?? {} } } : base;
}

/** A goal change applied to the stored goal. With `weeks`, focus and sports go into a temporary focus until then; strength and push stay base changes. */
export function applyGoalPatch(prior: Omit<GoalBody, 'atMs'>, patch: NonNullable<Rule['goal']>, today: string): Omit<GoalBody, 'atMs'> {
  const { weeks, ...rest } = patch;
  if (!weeks) return { ...prior, ...rest };
  return { ...prior, ...(rest.strength ? { strength: rest.strength } : {}), ...(rest.push ? { push: rest.push } : {}), temporary: { ...(rest.focus ? { focus: rest.focus } : {}), ...(rest.sports ? { sports: rest.sports } : {}), until: addDays(today, weeks * 7) } };
}

export type RuleKind = 'exclude' | 'wish' | 'goal';
export type RuleSport = SportKey | 'all';
export type RuleState = 'proposed' | 'active' | 'paused' | 'declined';
export type RuleSource = 'chat' | 'person' | 'migrated';
export type Rule = { id: string; kind: RuleKind; text: string; sport: RuleSport; exerciseIds?: string[]; families?: string[]; goal?: Partial<Omit<GoalBody, 'atMs' | 'temporary'>> & { weeks?: number }; state: RuleState; source: RuleSource; atMs: number };

const KINDS: RuleKind[] = ['exclude', 'wish', 'goal'];
const RULE_STATES: RuleState[] = ['proposed', 'active', 'paused', 'declined'];
const SOURCES: RuleSource[] = ['chat', 'person', 'migrated'];

export const ruleId = (id: string): string => `rule-${id}`;
/** Migrated rules: the same text for the same sport is the same record, so a rerun adds nothing. */
export const migratedRuleId = (sport: RuleSport, text: string): string => ruleId(`m-${sport}-${titleHash(`${sport}\n${text}`)}`);

/** The body of a `rule` record, or null for anything else. */
export function readRule(id: string, body: unknown): Rule | null {
  if (!isObj(body) || !KINDS.includes(body.kind as RuleKind) || !RULE_STATES.includes(body.state as RuleState) || !SOURCES.includes(body.source as RuleSource) || !num(body.atMs)) return null;
  if (typeof body.text !== 'string' || body.text.trim() === '' || body.text.length > RULE_TEXT_MAX) return null;
  if (body.sport !== 'all' && !SPORT_KEYS.includes(body.sport as SportKey)) return null;
  const kind = body.kind as RuleKind;
  let exerciseIds: string[] | undefined;
  let families: string[] | undefined;
  if (kind === 'exclude') {
    const ids = body.exerciseIds;
    if (ids !== undefined) {
      if (!Array.isArray(ids) || ids.length < 1 || ids.length > MAX_EXCLUDED || !ids.every((x) => typeof x === 'string' && x !== '')) return null;
      exerciseIds = ids as string[];
    }
    const fams = body.families;
    if (fams !== undefined) {
      if (!Array.isArray(fams) || fams.length < 1 || fams.length > MAX_FAMILIES || !fams.every(isExcludableFamily)) return null;
      families = [...new Set(fams as string[])];
    }
    if (!exerciseIds && !families) return null;
  }
  let goal: Rule['goal'];
  if (kind === 'goal') {
    if (!isObj(body.goal)) return null;
    const g = body.goal;
    goal = {};
    if (g.strength !== undefined) { if (!STRENGTHS.includes(g.strength as Strength)) return null; goal.strength = g.strength as Strength; }
    if (g.focus !== undefined || g.sports !== undefined) {
      const parts = readGoalParts({ strength: 'muscle', focus: g.focus ?? [], sports: g.sports ?? {} });
      if (!parts) return null;
      if (g.focus !== undefined) goal.focus = parts.focus;
      if (g.sports !== undefined) goal.sports = parts.sports;
    }
    if (g.push !== undefined) { if (!PUSHES.includes(g.push as Push)) return null; goal.push = g.push as Push; }
    if (g.weeks !== undefined) {
      if (typeof g.weeks !== 'number' || !Number.isInteger(g.weeks) || g.weeks < 1 || g.weeks > MAX_WEEKS || (g.focus === undefined && g.sports === undefined)) return null;
      goal.weeks = g.weeks;
    }
  }
  return { id, kind, text: body.text, sport: body.sport as RuleSport, ...(exerciseIds ? { exerciseIds } : {}), ...(families ? { families } : {}), ...(goal ? { goal } : {}), state: body.state as RuleState, source: body.source as RuleSource, atMs: body.atMs };
}

export type RuleDraft = { kind: RuleKind; text: string; sport: RuleSport; exerciseIds?: string[]; families?: string[]; goal?: Rule['goal'] };

/** Migrated records are stamped 1, so any later person edit (pause, delete) wins over a migration run on another Mac. */
export const ruleRecord = (id: string, d: RuleDraft, state: RuleState, source: RuleSource, nowMs: number): TrackedRecord =>
  ({ kind: 'rule', id, updatedMs: source === 'migrated' ? 1 : nowMs, deleted: false, body: { kind: d.kind, text: d.text, sport: d.sport, ...(d.exerciseIds ? { exerciseIds: d.exerciseIds } : {}), ...(d.families ? { families: d.families } : {}), ...(d.goal ? { goal: d.goal } : {}), state, source, atMs: nowMs } });

const ALLOWED: Record<RuleState, RuleState[]> = { proposed: ['active', 'declined'], active: ['paused'], paused: ['active'], declined: [] };

/** The record in its next state, stamped above what it has, or null when that move is not allowed. */
export function moveRule(r: TrackedRecord, to: RuleState, nowMs: number): TrackedRecord | null {
  const c = r.kind === 'rule' && !r.deleted ? readRule(r.id, r.body) : null;
  if (!c || !ALLOWED[c.state].includes(to) || !isObj(r.body)) return null;
  return { ...r, updatedMs: above(nowMs, r), body: { ...r.body, state: to } };
}

/** The tombstone for a rule (delete). */
export const deleteRule = (r: TrackedRecord, nowMs: number): TrackedRecord => ({ ...r, deleted: true, updatedMs: above(nowMs, r) });

/** Live, readable rule records, oldest first. */
export const rulesOf = (records: readonly TrackedRecord[]): Rule[] =>
  records.flatMap((r) => { const c = r.kind === 'rule' && !r.deleted ? readRule(r.id, r.body) : null; return c ? [c] : []; }).sort((a, b) => a.atMs - b.atMs || (a.id < b.id ? -1 : 1));

/** The active rules for a sport (rules for 'all' count for every sport). `nowMs` is for symmetry with later expiry; a rule has none yet. */
export function activeRules(records: readonly TrackedRecord[], sport: SportKey, _nowMs: number): Rule[] {
  return rulesOf(records).filter((r) => r.state === 'active' && r.kind !== 'goal' && (r.sport === sport || r.sport === 'all'));
}

/** The rule a person writes to rule out one exercise, or with `wholeFamily` all variants of a family. The one writer for RulesCard and the catalog page. */
export const excludeRuleRecord = (e: { id: string; title: string }, wholeFamily: string | undefined, newId: string, nowMs: number): TrackedRecord => {
  const text = wholeFamily ? `Ohne alle Varianten: ${familyLabel(wholeFamily)}` : `Ohne ${e.title}`;
  return ruleRecord(ruleId(newId), { kind: 'exclude', text: text.slice(0, RULE_TEXT_MAX), sport: 'gym', ...(wholeFamily ? { families: [wholeFamily] } : { exerciseIds: [e.id] }) }, 'active', 'person', nowMs);
};

/** The active exclude rules that rule an exercise out by id or by its family. */
export const rulesExcluding = (records: readonly TrackedRecord[], e: Pick<Exercise, 'id' | 'family'>): Rule[] =>
  rulesOf(records).filter((r) => r.state === 'active' && r.kind === 'exclude' && ((r.exerciseIds ?? []).includes(e.id) || (isExcludableFamily(familyOf(e)) && (r.families ?? []).includes(familyOf(e)))));

/**
 * The union of the exercises named by active exclude rules, whatever the rule's sport. The one resolver everywhere: a rule's
 * families are expanded against the given catalog, so a variant added later (with the family) is excluded without a new rule.
 */
export function excludedIds(records: readonly TrackedRecord[], catalog: readonly Pick<Exercise, 'id' | 'family'>[]): Set<string> {
  const rules = rulesOf(records).filter((r) => r.state === 'active' && r.kind === 'exclude');
  const families = new Set(rules.flatMap((r) => r.families ?? []).filter(isExcludableFamily));
  return new Set([...rules.flatMap((r) => r.exerciseIds ?? []), ...(families.size ? catalog.filter((e) => families.has(familyOf(e))).map((e) => e.id) : [])]);
}

/** The texts of the active wishes for a sport. */
export const wishes = (records: readonly TrackedRecord[], sport: SportKey): string[] =>
  activeRules(records, sport, 0).filter((r) => r.kind === 'wish').map((r) => r.text);

const PRIO_WORDS: Record<Prio, string> = { focus: 'Schwerpunkt', equal: 'gleichrangig', keep: 'erhalten' };
const SPORT_WORDS: Record<SportKey, string> = { gym: 'Kraft', bike: 'Rad', run: 'Laufen' };

/** One prompt line with the person's sport priorities, or null when none is set. */
export function priorityLine(goal: Pick<GoalBody, 'sports'>): string | null {
  const parts = SPORT_KEYS.flatMap((k) => (goal.sports[k] ? [`${SPORT_WORDS[k]} ${PRIO_WORDS[goal.sports[k]!]}`] : []));
  return parts.length ? `Sportarten nach Wunsch der Person: ${parts.join(', ')}.` : null;
}

/** One prompt line with the active wishes, or null when there are none. Wishes cannot be checked, so the line says so. */
export const wishLine = (texts: readonly string[]): string | null =>
  texts.length ? `Wünsche der Person (nicht prüfbar): ${texts.map((t) => t.replace(/\s+/g, ' ').trim()).join('; ')}` : null;

/**
 * What makes the coaches plan again: active or paused exclude and wish rules (id, state, exercises, text) and the goal record.
 * Proposals, declines and deleted rules are not in it, so they never trigger a replan. '' when there is nothing.
 */
export function personalKeyOf(ruleRecords: readonly TrackedRecord[], goalRecords: readonly TrackedRecord[], frameRecords: readonly TrackedRecord[] = [], today?: string, changeRecords: readonly TrackedRecord[] = [], blockRecords: readonly TrackedRecord[] = []): string {
  const parts = rulesOf(ruleRecords)
    .filter((r) => (r.state === 'active' || r.state === 'paused') && r.kind !== 'goal')
    .map((r) => `${r.id}:${r.state}:${(r.exerciseIds ?? []).join(',')}:${(r.families ?? []).join(',')}:${r.text}`);
  for (const g of goalRecords) parts.push(`goal:${g.id}:${g.updatedMs}:${g.deleted ? 1 : 0}`);
  // A temporary focus that runs out changes the goal without a new record.
  const until = today ? storedGoalOf(goalRecords).temporary?.until : undefined;
  if (today && until) parts.push(`focus-active:${today <= until ? 1 : 0}`);
  // A new mode or time makes the plans fit again.
  for (const f of frameRecords) parts.push(`frame:${f.id}:${f.updatedMs}:${f.deleted ? 1 : 0}`);
  // A change the person took makes the coaches plan at once; when it is used (one more step) or undone, they plan once more.
  for (const c of takenChanges(changeRecords)) parts.push(`chg:${c.id}:${c.state}`);
  // A section the person took makes the coaches plan at once, and again with every new week of it (the last one is light).
  if (today) {
    const b = activeBlock(blockRecords, today);
    if (b) parts.push(`blk:${b.id}:${blockWeek(b, today).n}`);
  }
  return parts.sort().join('|');
}
