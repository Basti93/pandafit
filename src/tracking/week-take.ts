import type { TrackedRecord } from '../shared/records';
import type { WeekProposal } from '../shared/week-plan';
import type { TrackingPort } from './ports';

export const TAKE_REFUSED = 'Das geht nicht, weil der Wochenplan inzwischen geändert wurde. Frag den Coach nochmal.';
export const UNDO_REFUSED = 'Das geht nicht, weil der Wochenplan danach geändert wurde.';

export type WeekResult = { ok: true } | { ok: false; reason: string };

const isObj = (x: unknown): x is Record<string, unknown> => typeof x === 'object' && x !== null && !Array.isArray(x);
const storedOf = async (port: TrackingPort, weekStart: string): Promise<TrackedRecord | undefined> =>
  (await port.list('weekplan')).find((r) => r.id === weekStart);
/** The fields a take adds; a plan restored from `prior` carries none of them. */
const plain = (body: Record<string, unknown>): Record<string, unknown> => {
  const { takenFrom: _t, prior: _p, baseMs: _b, ...rest } = body;
  return rest;
};

/**
 * Takes a week proposal: the stored plan is kept as `prior` so the take can be undone. Refused when the stored plan changed
 * after the proposal was made (`shownMs` = when the proposal was made, i.e. the time of its chat message).
 */
export async function takeWeekPlan(port: TrackingPort, p: { proposal: WeekProposal; changeId: string; shownMs: number; now: number }): Promise<WeekResult> {
  const have = await storedOf(port, p.proposal.weekStart);
  if ((have?.updatedMs ?? 0) > p.shownMs) return { ok: false, reason: TAKE_REFUSED };
  const prior = have && !have.deleted && isObj(have.body) ? plain(have.body) : undefined;
  const body = { ...p.proposal, fromMessage: p.changeId, acceptedMs: p.now, takenFrom: p.changeId, ...(prior ? { prior } : {}), baseMs: have?.updatedMs ?? 0 };
  const r = await port.put({ kind: 'weekplan', id: p.proposal.weekStart, updatedMs: Math.max(p.now, (have?.updatedMs ?? 0) + 1), deleted: false, body });
  return r.kept ? { ok: true } : { ok: false, reason: TAKE_REFUSED };
}

/** Whether the stored plan of that week is the one this take wrote (the stored data decides, nothing remembered by the screen). */
export const weekTaken = (have: TrackedRecord | undefined, changeId: string): boolean => !!have && !have.deleted && isObj(have.body) && have.body.takenFrom === changeId;

/** null when the take can be undone, else the reason in words. */
export const weekUndoRefusal = (have: TrackedRecord | undefined, proposal: WeekProposal, changeId: string): string | null =>
  weekTaken(have, changeId) && JSON.stringify((have!.body as Record<string, unknown>).days) === JSON.stringify(proposal.days) ? null : UNDO_REFUSED;

/** Undoes a take: restores `prior`, or removes the plan if there was none. Only while the stored plan is still the one this take wrote (same take and same days as the proposal). */
export async function undoWeekPlan(port: TrackingPort, p: { proposal: WeekProposal; changeId: string; now: number }): Promise<WeekResult> {
  const weekStart = p.proposal.weekStart;
  const have = await storedOf(port, weekStart);
  if (weekUndoRefusal(have, p.proposal, p.changeId) || !have) return { ok: false, reason: UNDO_REFUSED };
  if (!isObj(have.body)) return { ok: false, reason: UNDO_REFUSED };
  const prior = isObj(have.body.prior) ? plain(have.body.prior) : null;
  const next: TrackedRecord = { kind: 'weekplan', id: weekStart, updatedMs: Math.max(p.now, have.updatedMs + 1), deleted: prior === null, body: prior ?? have.body };
  const r = await port.put(next);
  return r.kept ? { ok: true } : { ok: false, reason: UNDO_REFUSED };
}
