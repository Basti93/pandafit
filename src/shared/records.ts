/** The one list of record kinds. Every screen, store and route derives from it. */
export const RECORD_KINDS = ['workout', 'routine', 'exercise', 'mobility', 'complaint', 'plan', 'mealplan', 'together', 'run', 'stats', 'chat', 'weekplan', 'coachprefs', 'loadstep', 'studio', 'change', 'goal', 'rule', 'frame', 'task', 'contact', 'bike', 'ride', 'health', 'activities', 'daytext'] as const;
export type RecordKind = (typeof RECORD_KINDS)[number];
/** Stored with sync cursors: a version that did not know a kind skipped its records, so a changed list fetches everything again. */
export const RECORD_KINDS_SIGNATURE = [...RECORD_KINDS].sort().join(',');
export type TrackedRecord = { kind: RecordKind; id: string; updatedMs: number; deleted: boolean; body: unknown };

export type LoggedSet = { type: 'warmup' | 'normal' | 'failure' | 'dropset'; weightKg: number | null; reps: number | null; durationS: number | null; doneMs: number | null };
/** How many more reps were left after an exercise: none (0), some (1–2), plenty (3+); skip means asked and not answered. */
export type Effort = 'none' | 'some' | 'plenty';
export type LoggedExercise = { exerciseId: string; title: string; supersetId: number | null; notes: string; sets: LoggedSet[]; effort?: Effort | 'skip' };
/**
 * A coach change taken during the workout, saved in the same write as the changed rows. `prior`: the touched rows before
 * (`pos`: where each stood), `after`: the rows the change produced. Undo needs both. Old records have none.
 */
export type WorkoutChangeEntry = { id: string; atMs: number; prior: LoggedExercise[]; pos: number[]; after: LoggedExercise[]; /** The rid of the row before the first touched row, null at the start. Old entries have none and use `pos`. */ anchor?: string | null };
export type LoggedWorkout = { id: string; title: string; startMs: number; endMs: number | null; source: 'pandafit' | 'hevy'; exercises: LoggedExercise[]; /** Where it was done (trimmed, at most 40 characters). Old records have none, see shared/studio. */ studio?: string; /** Set on a kept copy (see tracking/kept-copy): the record this version of the session came from. */ keptCopyOf?: string; /** The `updatedMs` of the last version the writing device knew the server had. See tracking/kept-copy. */ baseMs?: number; /** The versions before `baseMs` on this record's line, at most 20. */ ancestors?: number[]; /** Coach changes taken in this workout, see WorkoutChangeEntry. */ changes?: WorkoutChangeEntry[] };

const CHANGE_RANK: Record<string, number> = { proposed: 0, taken: 1, declined: 1, undone: 2, used: 3 };
const RULE_RANK: Record<string, number> = { proposed: 0, active: 1, paused: 1, declined: 2 };
const changeRank = (r: TrackedRecord): number => { if (r.deleted) return 4; const s = (r.body as { state?: unknown } | null)?.state; return typeof s === 'string' ? (r.kind === 'rule' ? RULE_RANK : CHANGE_RANK)[s] ?? 0 : 0; };

/** Newer wins; a tie goes to the greater JSON text so every device ends the same. The loser is returned, never dropped silently. */
export function applyRecord(current: TrackedRecord | undefined, incoming: TrackedRecord): { keep: TrackedRecord; overwritten: TrackedRecord | null } {
  if (!current) return { keep: incoming, overwritten: null };
  if (current.kind !== incoming.kind || current.id !== incoming.id) throw new Error('applyRecord: records differ in kind or id');
  // A change only moves forward: the furthest state wins whatever the stamps say, so an older device cannot revive a used one.
  // A tombstone is the end of the line, so the outcome does not depend on the order the two meet in.
  if (current.kind === 'change' || current.kind === 'rule') {
    const ra = changeRank(current), rb = changeRank(incoming);
    if (ra !== rb) return rb > ra ? { keep: incoming, overwritten: current } : { keep: current, overwritten: incoming };
  }
  const a = JSON.stringify(current), b = JSON.stringify(incoming);
  if (a === b) return { keep: current, overwritten: null };
  const incomingWins = incoming.updatedMs !== current.updatedMs ? incoming.updatedMs > current.updatedMs : b > a;
  return incomingWins ? { keep: incoming, overwritten: current } : { keep: current, overwritten: incoming };
}
