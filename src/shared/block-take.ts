import { blockDates, blockRecord, blockWeeks, readBlock, type BlockBody } from './block';
import { FRAME_ID, readFrame, frameRecord } from './frame';
import { above } from './exercise-links';
import type { TrackedRecord } from './records';

export const BLOCK_UNDO_REFUSED = 'Das geht nicht, weil ein Wochenplan des Abschnitts danach geändert wurde.';

const isObj = (x: unknown): x is Record<string, unknown> => typeof x === 'object' && x !== null && !Array.isArray(x);
const storedWeek = (plans: readonly TrackedRecord[], weekStart: string): TrackedRecord | undefined => plans.find((r) => r.kind === 'weekplan' && r.id === weekStart);
/** The fields a take adds; a plan restored from `prior` carries none of them. */
const plain = (body: Record<string, unknown>): Record<string, unknown> => {
  const { takenFrom: _t, prior: _p, baseMs: _b, undoneFrom: _u, ...rest } = body;
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
export function blockTakeWrites(o: { block: TrackedRecord; frame: readonly TrackedRecord[]; plans: readonly TrackedRecord[]; /** All block records: a second section cannot run beside an active one. */ blocks?: readonly TrackedRecord[]; msgId: string; today: string; nowMs: number }): TrackedRecord[] | null {
  const body = o.block.deleted ? null : readBlock(o.block.body);
  if (!body || body.state !== 'proposed') return null;
  const dates = blockDates(o.today);
  // A section still active at the new start overlaps and refuses the take; one that ends before it (on the review day) does not.
  let ending: BlockBody | null = null;
  for (const r of o.blocks ?? []) {
    const b = r.kind === 'block' && r.id !== o.block.id && !r.deleted ? readBlock(r.body) : null;
    if (b?.state !== 'active' || !b.end || b.end < o.today) continue;
    if (b.end >= dates.start) return null;
    ending = b;
  }
  const { rec: frameRec, body: f } = frameBody(o.frame);
  const frameWrite = frameRecord({ mode: 'week', minutes: f?.minutes ?? null, ...(f?.today ? { today: f.today } : {}) }, o.nowMs, frameRec);
  // After a section that ends now, the plan mode to go back to is the one from before that section.
  const active: BlockBody = { ...body, state: 'active', ...dates, priorMode: ending?.priorMode ?? f?.mode ?? 'week', takenFrom: o.msgId, frameMs: frameWrite.updatedMs };
  // The section comes last: if a write fails on the way, it is still proposed and the rider can try again.
  const writes: TrackedRecord[] = [];
  for (const week of blockWeeks(active)) {
    const have = storedWeek(o.plans, week.weekStart);
    // A retry finds the plan this take wrote before: the original stays the one to go back to.
    const again = !!have && !have.deleted && isObj(have.body) && have.body.takenFrom === o.msgId;
    const kept = again ? (isObj((have!.body as Record<string, unknown>).prior) ? plain((have!.body as Record<string, unknown>).prior as Record<string, unknown>) : undefined) : undefined;
    const prior = again ? kept : have && !have.deleted && isObj(have.body) ? plain(have.body) : undefined;
    writes.push({
      kind: 'weekplan', id: week.weekStart, updatedMs: above(o.nowMs, have), deleted: false,
      body: { ...week, fromMessage: o.msgId, acceptedMs: o.nowMs, takenFrom: o.msgId, ...(prior ? { prior } : {}), baseMs: have?.updatedMs ?? 0 },
    });
  }
  writes.push(frameWrite, { ...o.block, updatedMs: above(o.nowMs, o.block), body: active });
  return writes;
}

/**
 * Undoes a take: the section is deleted, the frame goes back to the earlier mode, the week plans go back to `prior` (or are removed).
 * Refused while any week plan is not the one this take wrote.
 */
export function blockUndoWrites(o: { block: TrackedRecord; frame: readonly TrackedRecord[]; plans: readonly TrackedRecord[]; msgId: string; nowMs: number }): TrackedRecord[] | { refused: string } {
  const body = o.block.deleted ? null : readBlock(o.block.body);
  if (!body || body.state !== 'active') return { refused: BLOCK_UNDO_REFUSED };
  const taken = body.takenFrom ?? o.msgId;
  const weeks = blockWeeks(body);
  const restores: TrackedRecord[] = [];
  for (const week of weeks) {
    const have = storedWeek(o.plans, week.weekStart);
    // Restored by an undo that stopped on the way: the retry leaves it as it is.
    if (have && isObj(have.body) && (have.deleted ? have.body.takenFrom === taken : have.body.undoneFrom === taken)) continue;
    if (!have || have.deleted || !isObj(have.body) || have.body.takenFrom !== taken || JSON.stringify(have.body.days) !== JSON.stringify(week.days)) return { refused: BLOCK_UNDO_REFUSED };
    const prior = isObj(have.body.prior) ? plain(have.body.prior) : null;
    restores.push({ kind: 'weekplan', id: week.weekStart, updatedMs: above(o.nowMs, have), deleted: prior === null, body: prior ? { ...prior, undoneFrom: taken } : have.body });
  }
  const { rec: frameRec, body: f } = frameBody(o.frame);
  // The section is deleted last: if a write fails on the way, it stays active and the undo can be tried again.
  const writes: TrackedRecord[] = [...restores];
  // The frame goes back only while it is still the one the take wrote.
  if (f && frameRec && body.priorMode && f.mode !== body.priorMode && (body.frameMs === undefined || frameRec.updatedMs === body.frameMs)) writes.push(frameRecord({ mode: body.priorMode, minutes: f.minutes, ...(f.today ? { today: f.today } : {}) }, o.nowMs, frameRec));
  writes.push({ ...o.block, updatedMs: above(o.nowMs, o.block), deleted: true });
  return writes;
}

const frameWith = (frame: readonly TrackedRecord[], mode: 'week' | 'spontaneous', nowMs: number): TrackedRecord | null => {
  const { rec, body } = frameBody(frame);
  return rec && body ? frameRecord({ mode, minutes: body.minutes, ...(body.today ? { today: body.today } : {}) }, nowMs, rec) : null;
};

/**
 * The natural end of a section: the frame goes back to the earlier mode, but only while it is still the one the take wrote;
 * then the section is `ended`. The frame comes first and the section last. null when the section is not `active`.
 */
export function blockEndWrites(o: { block: TrackedRecord; frame: readonly TrackedRecord[]; nowMs: number }): TrackedRecord[] | null {
  const body = o.block.deleted ? null : readBlock(o.block.body);
  if (!body || body.state !== 'active') return null;
  const { rec, body: f } = frameBody(o.frame);
  const writes: TrackedRecord[] = [];
  if (rec && f && body.priorMode && f.mode !== body.priorMode && body.frameMs !== undefined && rec.updatedMs === body.frameMs) {
    const w = frameWith(o.frame, body.priorMode, o.nowMs);
    if (w) writes.push(w);
  }
  writes.push({ ...o.block, updatedMs: above(o.nowMs, o.block), body: { ...body, state: 'ended' } });
  return writes;
}

/**
 * "Ja, locker planen": the frame goes to spontaneous and the section ends. Week plans and the goal stay as they are.
 * `frameMs` of the section then names the frame this wrote, so the undo restores it only while it is unchanged. null when the section is not `active`.
 */
export function driftTakeWrites(o: { block: TrackedRecord; frame: readonly TrackedRecord[]; /** The chat message that asks; the section is marked with it. */ msgId: string; nowMs: number }): TrackedRecord[] | null {
  const body = o.block.deleted ? null : readBlock(o.block.body);
  if (!body || body.state !== 'active') return null;
  const { body: f } = frameBody(o.frame);
  const writes: TrackedRecord[] = [];
  let frameMs = body.frameMs;
  if (f && f.mode !== 'spontaneous') {
    const w = frameWith(o.frame, 'spontaneous', o.nowMs);
    if (w) { writes.push(w); frameMs = w.updatedMs; }
  }
  writes.push({ ...o.block, updatedMs: above(o.nowMs, o.block), body: { ...body, state: 'ended', endedBy: o.msgId, ...(frameMs !== undefined ? { frameMs } : {}) } });
  return writes;
}

/** The id of the section that continues an ended one after the undo. A record never moves back from `ended`, so the undo writes a new record. */
export const resumedBlockId = (endedId: string): string => `${endedId}-b`;

/** The newest record of a section's resume chain (`id`, `id-b`, `id-b-b`, ...), also a deleted one; `id` itself when it was not resumed. */
export function blockChainHead(blocks: readonly TrackedRecord[], id: string): TrackedRecord | undefined {
  let head = blocks.find((r) => r.kind === 'block' && r.id === id);
  for (let next = blocks.find((r) => r.id === resumedBlockId(head?.id ?? '')); head && next; next = blocks.find((r) => r.id === resumedBlockId(head!.id))) head = next;
  return head;
}

/** Whether `id` is `root` or a record of its resume chain (`root-b`, `root-b-b`, ...). */
const inChain = (id: string, root: string): boolean => id.startsWith(root) && /^(-b)*$/.test(id.slice(root.length));

/** Another section than the chain of `id` is active: an ended section of that chain then cannot run on beside it. */
export function otherBlockActive(blocks: readonly TrackedRecord[], id: string): boolean {
  return blocks.some((r) => r.kind === 'block' && !r.deleted && !inChain(r.id, id) && readBlock(r.body)?.state === 'active');
}

/**
 * Undoes `driftTakeWrites`: the frame goes back to week mode only while it is still the one the take wrote; then the same section
 * runs on as a new `active` record (an `ended` record never moves back, see applyRecord). null when it is not `ended`, or when
 * another section is active by now (`blocks`).
 */
export function driftUndoWrites(o: { block: TrackedRecord; frame: readonly TrackedRecord[]; /** All block records. */ blocks?: readonly TrackedRecord[]; nowMs: number }): TrackedRecord[] | null {
  const body = o.block.deleted ? null : readBlock(o.block.body);
  if (!body || body.state !== 'ended') return null;
  if (otherBlockActive(o.blocks ?? [], o.block.id)) return null;
  const { rec, body: f } = frameBody(o.frame);
  const writes: TrackedRecord[] = [];
  let frameMs = body.frameMs;
  if (rec && f && f.mode === 'spontaneous' && body.frameMs !== undefined && rec.updatedMs === body.frameMs) {
    const w = frameWith(o.frame, 'week', o.nowMs);
    if (w) { writes.push(w); frameMs = w.updatedMs; }
  } else if (rec && f && f.mode === 'week') {
    // A retry: an earlier try wrote the frame already, so its stamp is the one the section names.
    frameMs = rec.updatedMs;
  }
  const { endedBy: _e, ...resumed } = body;
  writes.push(blockRecord(resumedBlockId(o.block.id), { ...resumed, state: 'active', ...(frameMs !== undefined ? { frameMs } : {}) }, o.nowMs));
  return writes;
}
