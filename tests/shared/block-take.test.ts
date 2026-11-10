import { describe, it, expect } from 'vitest';
import { blockRecord, blockWeeks, readBlock, type BlockBody, type BlockDay } from '../../src/shared/block';
import { blockTakeWrites, blockUndoWrites, driftTakeWrites, driftUndoWrites } from '../../src/shared/block-take';
import { frameRecord, readFrame } from '../../src/shared/frame';
import { applyRecord, type TrackedRecord } from '../../src/shared/records';

const day = (sport: BlockDay['sport'], hardness: BlockDay['hardness'], extra: Partial<BlockDay> = {}): BlockDay => ({ sport, hardness, ...extra });
const RHYTHM: BlockDay[] = [
  day('gym', 'hard', { template: 0 }), day('bike', 'easy'), day('gym', 'moderate', { template: 1 }), day('rest', 'easy'),
  day('bike', 'hard'), day('run', 'easy'), day('rest', 'easy'),
];
const proposed: BlockBody = { state: 'proposed', atMs: 1, rhythm: RHYTHM, templates: [{ name: 'Oberkörper A', core: ['pf-a', 'pf-b', 'pf-c'] }, { name: 'Unterkörper B', core: ['pf-d', 'pf-e', 'pf-f'] }] };
const blockRec = blockRecord('block-m1', proposed, 1);
const frame = (mode: 'week' | 'spontaneous') => frameRecord({ mode, minutes: 45 }, 5);
const run = (over: Partial<Parameters<typeof blockTakeWrites>[0]> = {}) =>
  blockTakeWrites({ block: blockRec, frame: [frame('spontaneous')], plans: [], msgId: 'm1', today: '2026-11-29', nowMs: 100, ...over });
/** Stores the writes the way the store does, so a later write cannot lose against an older one. */
const store = (seed: TrackedRecord[], writes: TrackedRecord[]): TrackedRecord[] => {
  const map = new Map(seed.map((r) => [`${r.kind}:${r.id}`, r]));
  for (const w of writes) map.set(`${w.kind}:${w.id}`, applyRecord(map.get(`${w.kind}:${w.id}`), w).keep);
  return [...map.values()];
};

describe('blockTakeWrites', () => {
  it('writes the section, the frame and one week plan per week from the Monday after', () => {
    const w = run()!;
    expect(w.map((r) => r.kind)).toEqual(['weekplan', 'weekplan', 'weekplan', 'weekplan', 'frame', 'block']);
    expect(readBlock(w[5]!.body)).toMatchObject({ state: 'active', start: '2026-11-30', end: '2026-12-27', priorMode: 'spontaneous' });
    expect(readFrame(w[4]!.body)).toMatchObject({ mode: 'week', minutes: 45 });
    expect(w.slice(0, 4).map((r) => r.id)).toEqual(['2026-11-30', '2026-12-07', '2026-12-14', '2026-12-21']);
    expect(w[0]!.body).toMatchObject({ takenFrom: 'm1', weekStart: '2026-11-30' });
  });
  it('remembers a stored week plan as prior', () => {
    const old: TrackedRecord = { kind: 'weekplan', id: '2026-12-07', updatedMs: 10, deleted: false, body: { weekStart: '2026-12-07', days: [] } };
    const w = run({ plans: [old] })!;
    expect(w.find((r) => r.id === '2026-12-07')!.body).toMatchObject({ prior: { weekStart: '2026-12-07', days: [] } });
  });
  it('takes nothing when the section is no longer proposed', () => {
    const active = blockRecord('block-m1', { ...proposed, state: 'active', start: '2026-11-30', end: '2026-12-27' }, 2);
    expect(run({ block: active })).toBeNull();
  });
  it('takes nothing when another section is already active', () => {
    const other = blockRecord('block-m0', { ...proposed, state: 'active', start: '2026-11-02', end: '2026-12-27' }, 2);
    expect(run({ blocks: [other] })).toBeNull();
    expect(run({ blocks: [blockRec] })).not.toBeNull();
  });
  it('takes the next section on the last day of a running one, which then ends before the new start', () => {
    const ending = blockRecord('block-m0', { ...proposed, state: 'active', start: '2026-11-02', end: '2026-11-29', priorMode: 'spontaneous', frameMs: 5 }, 2);
    const w = run({ blocks: [ending], frame: [frame('week')] })!;
    expect(w).not.toBeNull();
    // The plan mode to go back to is the one before the running section.
    expect(readBlock(w.at(-1)!.body)).toMatchObject({ state: 'active', start: '2026-11-30', priorMode: 'spontaneous' });
    const overlapping = blockRecord('block-m0', { ...proposed, state: 'active', start: '2026-11-02', end: '2026-12-06' }, 2);
    expect(run({ blocks: [overlapping] })).toBeNull();
  });
  it('keeps the first prior when a retry writes the same take again', () => {
    const old: TrackedRecord = { kind: 'weekplan', id: '2026-12-07', updatedMs: 10, deleted: false, body: { weekStart: '2026-12-07', days: [] } };
    const first = run({ plans: [old] })!;
    const again = run({ plans: store([old], first).filter((r) => r.kind === 'weekplan'), nowMs: 300 })!;
    expect(again.find((r) => r.id === '2026-12-07')!.body).toMatchObject({ prior: { weekStart: '2026-12-07', days: [] } });
  });
  it('writes who took the section and which frame it wrote', () => {
    const w = run()!;
    expect(readBlock(w.at(-1)!.body)).toMatchObject({ takenFrom: 'm1', frameMs: w[4]!.updatedMs });
  });
  it('without a frame record the prior mode is the week mode', () => {
    expect(readBlock(run({ frame: [] })!.at(-1)!.body)?.priorMode).toBe('week');
  });
});

describe('blockUndoWrites', () => {
  const taken = () => { const w = run()!; return store([blockRec, frame('spontaneous')], w); };
  const undo = (recs: TrackedRecord[]) => blockUndoWrites({ block: recs.find((r) => r.kind === 'block')!, frame: recs.filter((r) => r.kind === 'frame'), plans: recs.filter((r) => r.kind === 'weekplan'), msgId: 'm1', nowMs: 200 });

  it('deletes the section and restores the frame and the week plans', () => {
    const recs = taken();
    const w = undo(recs);
    if ('refused' in w) throw new Error(w.refused);
    const after = store(recs, w);
    expect(after.find((r) => r.kind === 'block')!.deleted).toBe(true);
    expect(readFrame(after.find((r) => r.kind === 'frame')!.body)?.mode).toBe('spontaneous');
    expect(after.filter((r) => r.kind === 'weekplan').every((r) => r.deleted)).toBe(true);
  });
  it('undoes by the message that took it, whichever message asks', () => {
    const recs = taken();
    const w = blockUndoWrites({ block: recs.find((r) => r.kind === 'block')!, frame: recs.filter((r) => r.kind === 'frame'), plans: recs.filter((r) => r.kind === 'weekplan'), msgId: 'reply', nowMs: 200 });
    expect('refused' in w).toBe(false);
  });
  it('brings back a stored week plan that the take replaced', () => {
    const old: TrackedRecord = { kind: 'weekplan', id: '2026-12-07', updatedMs: 10, deleted: false, body: { weekStart: '2026-12-07', days: [] } };
    const recs = store([blockRec, frame('spontaneous'), old], run({ plans: [old] })!);
    const after = store(recs, undo(recs) as TrackedRecord[]);
    const back = after.find((r) => r.kind === 'weekplan' && r.id === '2026-12-07')!;
    expect(back.deleted).toBe(false);
    expect(back.body).toMatchObject({ weekStart: '2026-12-07', days: [] });
  });
  it('writes the week plans first, then the frame, and the section last', () => {
    const w = undo(taken()) as TrackedRecord[];
    expect(w.map((r) => r.kind)).toEqual(['weekplan', 'weekplan', 'weekplan', 'weekplan', 'frame', 'block']);
  });
  it('a retry after a failure on the way finishes the undo', () => {
    const old: TrackedRecord = { kind: 'weekplan', id: '2026-12-07', updatedMs: 10, deleted: false, body: { weekStart: '2026-12-07', days: [] } };
    const recs = store([blockRec, frame('spontaneous'), old], run({ plans: [old] })!);
    const first = undo(recs) as TrackedRecord[];
    // Only the first two restores were written, then the app stopped.
    const partway = store(recs, first.slice(0, 2));
    const second = undo(partway);
    if ('refused' in second) throw new Error(second.refused);
    const after = store(partway, second);
    expect(after.find((r) => r.kind === 'block')!.deleted).toBe(true);
    expect(readFrame(after.find((r) => r.kind === 'frame')!.body)?.mode).toBe('spontaneous');
    expect(after.find((r) => r.kind === 'weekplan' && r.id === '2026-12-07')!.body).toMatchObject({ weekStart: '2026-12-07', days: [] });
    expect(after.find((r) => r.kind === 'weekplan' && r.id === '2026-12-07')!.deleted).toBe(false);
    expect(after.filter((r) => r.kind === 'weekplan' && r.id !== '2026-12-07').every((r) => r.deleted)).toBe(true);
  });
  it('a plan changed by the person after a partial undo is still refused', () => {
    const recs = taken();
    const first = undo(recs) as TrackedRecord[];
    const partway = store(recs, first.slice(0, 1)).map((r) => (r.kind === 'weekplan' && r.id === '2026-12-07' ? { ...r, updatedMs: 900, body: { ...(r.body as object), days: [] } } : r));
    expect(undo(partway)).toEqual({ refused: expect.stringContaining('Wochenplan') });
  });
  it('leaves a frame alone that was changed since the take', () => {
    const recs = taken().map((r) => (r.kind === 'frame' ? frameRecord({ mode: 'week', minutes: 30 }, 500, r) : r));
    const w = undo(recs) as TrackedRecord[];
    expect(w.some((r) => r.kind === 'frame')).toBe(false);
    expect(w.some((r) => r.kind === 'block' && r.deleted)).toBe(true);
  });
  it('is refused after a week plan was changed', () => {
    const recs = taken().map((r) => (r.kind === 'weekplan' && r.id === '2026-12-07' ? { ...r, updatedMs: 150, body: { ...(r.body as object), days: [] } } : r));
    const w = undo(recs);
    expect(w).toEqual({ refused: expect.stringContaining('Wochenplan') });
  });
  it('knows the weeks it wrote', () => {
    expect(blockWeeks(readBlock(run()!.at(-1)!.body)!)).toHaveLength(4);
  });
});

describe('driftUndoWrites', () => {
  const ended = { kind: 'block' as const, id: 'block-m1', updatedMs: 5, deleted: false, body: { state: 'ended', atMs: 1, start: '2026-11-30', end: '2026-12-27', priorMode: 'spontaneous', frameMs: 40, endedBy: 'd1', templates: [{ name: 'A', core: ['a', 'b', 'c'] }, { name: 'B', core: ['d', 'e', 'f'] }], rhythm: [{ sport: 'gym', hardness: 'hard', template: 0 }, { sport: 'bike', hardness: 'easy' }, { sport: 'gym', hardness: 'moderate', template: 1 }, { sport: 'rest', hardness: 'easy' }, { sport: 'bike', hardness: 'hard' }, { sport: 'run', hardness: 'easy' }, { sport: 'rest', hardness: 'easy' }] } };
  it('nimmt bei einem Wiederholungsversuch den Stempel des Rahmens, der schon passt', () => {
    const w = driftUndoWrites({ block: ended, frame: [frameRecord({ mode: 'week', minutes: null }, 50)], nowMs: 100 })!;
    expect(w).toHaveLength(1);
    expect(w[0]).toMatchObject({ id: 'block-m1-b', body: { state: 'active', frameMs: 50 } });
    expect((w[0]!.body as Record<string, unknown>).endedBy).toBeUndefined();
  });
  it('markiert den Abschnitt beim Beenden mit der Nachricht', () => {
    const active = { ...ended, body: { ...ended.body, state: 'active', endedBy: undefined } };
    const w = driftTakeWrites({ block: active, frame: [frameRecord({ mode: 'week', minutes: null }, 40)], msgId: 'd1', nowMs: 100 })!;
    expect(w.at(-1)!.body).toMatchObject({ state: 'ended', endedBy: 'd1' });
  });
});
