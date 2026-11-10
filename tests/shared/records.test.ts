import { describe, it, expect } from 'vitest';
import { applyRecord, type TrackedRecord } from '../../src/shared/records';
import { EXERCISES, linkHevyTemplates } from '../../src/shared/exercises';

const rec = (updatedMs: number, body: unknown = { a: 1 }, deleted = false): TrackedRecord => ({ kind: 'workout', id: 'w1', updatedMs, deleted, body });

describe('applyRecord', () => {
  it('the newer record wins and returns the overwritten one', () => {
    const a = rec(1), b = rec(2, { a: 2 });
    expect(applyRecord(a, b)).toEqual({ keep: b, overwritten: a });
  });
  it('the same record twice changes nothing', () => {
    const a = rec(1);
    expect(applyRecord(a, { ...a })).toEqual({ keep: a, overwritten: null });
    expect(applyRecord(undefined, a)).toEqual({ keep: a, overwritten: null });
  });
  it('an older record never replaces a newer one', () => {
    const a = rec(5), old = rec(2, { a: 9 });
    expect(applyRecord(a, old)).toEqual({ keep: a, overwritten: old });
  });
  it('a tie ends the same in either order', () => {
    const a = rec(3, { a: 1 }), b = rec(3, { a: 2 });
    expect(applyRecord(a, b).keep).toEqual(applyRecord(b, a).keep);
  });
  it('a deleted record stays as a tombstone', () => {
    const a = rec(1), gone = rec(2, null, true);
    const r = applyRecord(a, gone);
    expect(r.keep.deleted).toBe(true);
    expect(r.keep.id).toBe('w1');
    expect(applyRecord(r.keep, a).keep.deleted).toBe(true);
  });
});

describe('applyRecord guards', () => {
  it('throws on a different kind or id', () => {
    expect(() => applyRecord(rec(1), { ...rec(2), id: 'other' })).toThrow();
    expect(() => applyRecord(rec(1), { ...rec(2), kind: 'plan' })).toThrow();
  });
  it('a tombstone in a tie ends the same in either order', () => {
    const live = rec(3, { a: 1 }), gone = rec(3, null, true);
    expect(applyRecord(live, gone).keep).toEqual(applyRecord(gone, live).keep);
  });
  it('three records end the same in every order', () => {
    const all = [rec(1, { a: 1 }), rec(3, { a: 2 }), rec(3, { a: 3 }), rec(2, null, true)];
    const perms = (xs: TrackedRecord[]): TrackedRecord[][] => xs.length <= 1 ? [xs] : xs.flatMap((x, i) => perms([...xs.slice(0, i), ...xs.slice(i + 1)]).map((p) => [x, ...p]));
    const ends = perms(all).map((p) => p.reduce<TrackedRecord | undefined>((cur, r) => applyRecord(cur, r).keep, undefined));
    for (const e of ends) expect(e).toEqual(ends[0]);
  });
});

describe('applyRecord block', () => {
  const b = (state: string, updatedMs: number): TrackedRecord => ({ kind: 'block', id: 'block-1', updatedMs, deleted: false, body: { state } });
  it('an active block beats a younger proposed one, in either order', () => {
    const active = b('active', 1), proposed = b('proposed', 9);
    expect(applyRecord(active, proposed).keep).toBe(active);
    expect(applyRecord(proposed, active).keep).toBe(active);
  });
  it('an ended block beats an active one', () => {
    expect(applyRecord(b('active', 9), b('ended', 1)).keep.body).toEqual({ state: 'ended' });
  });
});

describe('EXERCISES', () => {
  it('exercise ids are unique and each has a known type, muscle and equipment', () => {
    const types = ['weight_reps', 'reps_only', 'bodyweight_weighted', 'bodyweight_assisted', 'duration', 'distance_duration', 'short_distance_weight', 'floors_duration', 'steps_duration'];
    expect(EXERCISES.length).toBeGreaterThanOrEqual(90);
    expect(new Set(EXERCISES.map((e) => e.id)).size).toBe(EXERCISES.length);
    for (const e of EXERCISES) {
      expect(e.id).toMatch(/^pf-/);
      expect(types).toContain(e.type);
      expect(e.title).not.toBe('');
      expect(e.primaryMuscle).not.toBe('');
      expect(e.equipment).not.toBe('');
    }
  });
  it('each hevyTitle appears on one exercise only', () => {
    const titles = EXERCISES.map((e) => e.hevyTitle).filter((t): t is string => !!t);
    expect(titles.length).toBeGreaterThan(30);
    expect(new Set(titles).size).toBe(titles.length);
  });
  it('linkHevyTemplates links by exact title and ignores unknown ones', () => {
    const squat = EXERCISES.find((e) => e.id === 'pf-squat')!;
    const map = linkHevyTemplates([
      { id: 'H1', title: squat.hevyTitle! }, { id: 'H2', title: squat.hevyTitle!.toLowerCase() }, { id: 'H3', title: 'Nonsense Move' },
    ]);
    expect(map.get('H1')).toBe('pf-squat');
    expect(map.size).toBe(1);
  });
  it('two Hevy templates with the same title both link to the own exercise', () => {
    const t = EXERCISES.find((e) => e.id === 'pf-squat')!.hevyTitle!;
    const map = linkHevyTemplates([{ id: 'H1', title: t }, { id: 'H2', title: t }]);
    expect([...map.entries()]).toEqual([['H1', 'pf-squat'], ['H2', 'pf-squat']]);
  });
  it('the cable glute kickback agrees between equipment and Hevy title', () => {
    const e = EXERCISES.find((x) => x.id === 'pf-cable-kickback')!;
    expect(e.hevyTitle).toMatch(/Cable/);
    expect(e.equipment).toBe('machine');
  });
});

describe('applyRecord for changes', () => {
  const chg = (state: string, updatedMs: number, deleted = false): TrackedRecord => ({ kind: 'change', id: 'chg-1', updatedMs, deleted, body: { target: 'next', ops: [{ op: 'drop', exerciseId: 'x' }], reason: '', state, atMs: 1 } });
  it('a tombstone ranks highest, whatever the stamps and the order they meet in', () => {
    for (const [live, gone] of [[chg('used', 50), chg('taken', 10, true)], [chg('proposed', 50), chg('proposed', 10, true)]] as const) {
      expect(applyRecord(live, gone).keep).toEqual(gone);
      expect(applyRecord(gone, live).keep).toEqual(gone);
    }
  });
  it('without a tombstone the furthest state still wins in both orders', () => {
    expect(applyRecord(chg('used', 1), chg('taken', 9)).keep.body).toMatchObject({ state: 'used' });
    expect(applyRecord(chg('taken', 9), chg('used', 1)).keep.body).toMatchObject({ state: 'used' });
  });
});
