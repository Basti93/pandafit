import type { TrackedRecord } from './records';
import { above, titleHash } from './exercise-links';

export type CoachId = 'bike' | 'gym' | 'run';
export type TaskFrom = CoachId | 'chat';
export const COACH_IDS: readonly CoachId[] = ['bike', 'gym', 'run'];
export const TASK_MAX_TEXT = 300;
/** A lasting task is a wish that holds for a while. A one-off task ends with its session or its day; the cap only catches forgotten ones. */
export const ONE_OFF_CAP_MS = 28 * 86_400_000;
export const LASTING_MS = 60 * 86_400_000;

/** A request handed to a coach, by the person through the week chat or by another coach. `doneMs`: set when it was dealt with. */
export type CoachTask = { from: TaskFrom; to: CoachId; text: string; lasting: boolean; atMs: number; doneMs?: number; forDate?: string };

const isObj = (x: unknown): x is Record<string, unknown> => typeof x === 'object' && x !== null && !Array.isArray(x);
const FROMS: readonly string[] = ['chat', ...COACH_IDS];

/** The same request (from, to, text, time) is the same record on every Mac, so a migration or a second answer adds nothing. */
/** A local calendar day as `YYYY-MM-DD`. */
export const isDateKey = (x: unknown): x is string => typeof x === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(x) && !Number.isNaN(new Date(`${x}T12:00:00`).getTime()) && new Date(`${x}T12:00:00`).getDate() === Number(x.slice(8));

export const taskId = (t: Pick<CoachTask, 'from' | 'to' | 'text' | 'atMs'>): string => `task-${titleHash(`${t.from}\n${t.to}\n${t.text}\n${t.atMs}`)}`;

/** The body of a `task` record, or null for anything else. */
export function readTask(body: unknown): CoachTask | null {
  if (!isObj(body) || !FROMS.includes(body.from as string) || !COACH_IDS.includes(body.to as CoachId)) return null;
  if (typeof body.text !== 'string' || !body.text.trim() || typeof body.lasting !== 'boolean') return null;
  if (typeof body.atMs !== 'number' || !Number.isFinite(body.atMs)) return null;
  if (body.doneMs !== undefined && (typeof body.doneMs !== 'number' || !Number.isFinite(body.doneMs))) return null;
  return { from: body.from as TaskFrom, to: body.to as CoachId, text: body.text, lasting: body.lasting, atMs: body.atMs, ...(body.doneMs !== undefined ? { doneMs: body.doneMs as number } : {}), ...(isDateKey(body.forDate) ? { forDate: body.forDate } : {}) };
}

/** Migrated records are stamped 1, so any later person edit (remove) wins over a migration run on another Mac. */
export const taskRecord = (t: CoachTask, nowMs: number, migrated = false): TrackedRecord =>
  ({ kind: 'task', id: taskId(t), updatedMs: migrated ? 1 : nowMs, deleted: false, body: { ...t } });

/** The tombstone for a task (remove). */
export const deleteTask = (r: TrackedRecord, nowMs: number): TrackedRecord => ({ ...r, deleted: true, updatedMs: above(nowMs, r) });

/** Lasting: 60 days. With a day: until the end of that local day. Otherwise until a session settles it, at most the cap. */
export const taskAlive = (t: CoachTask, nowMs: number): boolean => {
  if (t.lasting) return nowMs - t.atMs <= LASTING_MS;
  if (t.forDate) return nowMs < endOfDay(t.forDate);
  return nowMs - t.atMs <= ONE_OFF_CAP_MS;
};
const endOfDay = (key: string): number => { const [y, m, d] = key.split('-').map(Number); return new Date(y!, m! - 1, d! + 1).getTime(); };

/** The live, readable, unexpired, undone tasks, oldest first. */
export const openTasks = (records: readonly TrackedRecord[], nowMs: number): (CoachTask & { id: string })[] =>
  records.flatMap((r) => { const t = r.kind === 'task' && !r.deleted ? readTask(r.body) : null; return t && t.doneMs === undefined && taskAlive(t, nowMs) ? [{ ...t, id: r.id }] : []; })
    .sort((a, b) => a.atMs - b.atMs || (a.id < b.id ? -1 : 1));

export const TASK_FROM_LABEL: Record<TaskFrom, string> = { chat: 'Person über den Wochenchat', bike: 'Rad-Coach', gym: 'Kraft-Coach', run: 'Lauf-Coach' };
export const COACH_LABEL: Record<CoachId, string> = { bike: 'Rad-Coach', gym: 'Kraft-Coach', run: 'Lauf-Coach' };
