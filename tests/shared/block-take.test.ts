import { describe, it, expect } from 'vitest';
import { blockRecord, blockWeeks, readBlock, type BlockBody, type BlockDay } from '../../src/shared/block';
import { blockTakeWrites, blockUndoWrites } from '../../src/shared/block-take';
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
    expect(w.map((r) => r.kind)).toEqual(['block', 'frame', 'weekplan', 'weekplan', 'weekplan', 'weekplan']);
    expect(readBlock(w[0]!.body)).toMatchObject({ state: 'active', start: '2026-11-30', end: '2026-12-27', priorMode: 'spontaneous' });
    expect(readFrame(w[1]!.body)).toMatchObject({ mode: 'week', minutes: 45 });
    expect(w.slice(2).map((r) => r.id)).toEqual(['2026-11-30', '2026-12-07', '2026-12-14', '2026-12-21']);
    expect(w[2]!.body).toMatchObject({ takenFrom: 'm1', weekStart: '2026-11-30' });
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
  it('without a frame record the prior mode is the week mode', () => {
    expect(readBlock(run({ frame: [] })![0]!.body)?.priorMode).toBe('week');
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
  it('is refused after a week plan was changed', () => {
    const recs = taken().map((r) => (r.kind === 'weekplan' && r.id === '2026-12-07' ? { ...r, updatedMs: 150, body: { ...(r.body as object), days: [] } } : r));
    const w = undo(recs);
    expect(w).toEqual({ refused: expect.stringContaining('Wochenplan') });
  });
  it('knows the weeks it wrote', () => {
    expect(blockWeeks(readBlock(run()![0]!.body)!)).toHaveLength(4);
  });
});
