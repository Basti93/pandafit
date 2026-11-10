import { blockDates, blockWeeks, readBlock, type BlockBody } from './block';
import { FRAME_ID, readFrame, frameRecord } from './frame';
import { above } from './exercise-links';
import type { TrackedRecord } from './records';

export const BLOCK_UNDO_REFUSED = 'Das geht nicht, weil ein Wochenplan des Abschnitts danach geändert wurde.';

const isObj = (x: unknown): x is Record<string, unknown> => typeof x === 'object' && x !== null && !Array.isArray(x);
const storedWeek = (plans: readonly TrackedRecord[], weekStart: string): TrackedRecord | undefined => plans.find((r) => r.kind === 'weekplan' && r.id === weekStart);
/** The fields a take adds; a plan restored from `prior` carries none of them. */
const plain = (body: Record<string, unknown>): Record<string, unknown> => {
  const { takenFrom: _t, prior: _p, baseMs: _b, ...rest } = body;
  return rest;
};
const frameBody = (frame: readonly TrackedRecord[]) => {
  const r = frame.find((x) => x.kind === 'frame' && x.id === FRAME_ID && !x.deleted);
  return { rec: r, body: r ? readFrame(r.body) : null };
};

/**
 * Takes a proposed section on `today`: the section becomes active with its dates and the plan mode before, the frame goes to week mode,
 * and each week of the section gets a week plan from the rhythm (the stored one is kept as `prior`, like a taken week proposal).
 * null when the section is not `proposed` any more.
 */
export function blockTakeWrites(o: { block: TrackedRecord; frame: readonly TrackedRecord[]; plans: readonly TrackedRecord[]; msgId: string; today: string; nowMs: number }): TrackedRecord[] | null {
  const body = o.block.deleted ? null : readBlock(o.block.body);
  if (!body || body.state !== 'proposed') return null;
  const { rec: frameRec, body: f } = frameBody(o.frame);
  const active: BlockBody = { ...body, state: 'active', ...blockDates(o.today), priorMode: f?.mode ?? 'week' };
  const writes: TrackedRecord[] = [{ ...o.block, updatedMs: above(o.nowMs, o.block), body: active }];
  writes.push(frameRecord({ mode: 'week', minutes: f?.minutes ?? null, ...(f?.today ? { today: f.today } : {}) }, o.nowMs, frameRec));
  for (const week of blockWeeks(active)) {
    const have = storedWeek(o.plans, week.weekStart);
    const prior = have && !have.deleted && isObj(have.body) ? plain(have.body) : undefined;
    writes.push({
      kind: 'weekplan', id: week.weekStart, updatedMs: above(o.nowMs, have), deleted: false,
      body: { ...week, fromMessage: o.msgId, acceptedMs: o.nowMs, takenFrom: o.msgId, ...(prior ? { prior } : {}), baseMs: have?.updatedMs ?? 0 },
    });
  }
  return writes;
}

/**
 * Undoes a take: the section is deleted, the frame goes back to the earlier mode, the week plans go back to `prior` (or are removed).
 * Refused while any week plan is not the one this take wrote.
 */
export function blockUndoWrites(o: { block: TrackedRecord; frame: readonly TrackedRecord[]; plans: readonly TrackedRecord[]; msgId: string; nowMs: number }): TrackedRecord[] | { refused: string } {
  const body = o.block.deleted ? null : readBlock(o.block.body);
  if (!body || body.state !== 'active') return { refused: BLOCK_UNDO_REFUSED };
  const weeks = blockWeeks(body);
  const restores: TrackedRecord[] = [];
  for (const week of weeks) {
    const have = storedWeek(o.plans, week.weekStart);
    if (!have || have.deleted || !isObj(have.body) || have.body.takenFrom !== o.msgId || JSON.stringify(have.body.days) !== JSON.stringify(week.days)) return { refused: BLOCK_UNDO_REFUSED };
    const prior = isObj(have.body.prior) ? plain(have.body.prior) : null;
    restores.push({ kind: 'weekplan', id: week.weekStart, updatedMs: above(o.nowMs, have), deleted: prior === null, body: prior ?? have.body });
  }
  const { rec: frameRec, body: f } = frameBody(o.frame);
  const writes: TrackedRecord[] = [{ ...o.block, updatedMs: above(o.nowMs, o.block), deleted: true }];
  if (f && body.priorMode && f.mode !== body.priorMode) writes.push(frameRecord({ mode: body.priorMode, minutes: f.minutes, ...(f.today ? { today: f.today } : {}) }, o.nowMs, frameRec));
  return [...writes, ...restores];
}
