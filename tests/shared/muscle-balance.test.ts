import { describe, expect, it } from 'vitest';
import { muscleBalance, contributions, type BalanceExercise } from '../../src/shared/muscle-balance';
import { MUSCLE_TARGETS } from '../../src/shared/muscle-targets';
import { policyRule } from '../../src/shared/training-policy';
import { type StatsView } from '../../src/tracking/stats';
import { statsView } from '../../src/tracking/stats-node';
import { muscleVolume } from '../../src/coach/gym/muscle-volume';
import { EXERCISES } from '../../src/shared/exercises';
import type { LoggedWorkout } from '../../src/shared/records';

const DAY = 86_400_000;
const row: BalanceExercise = { primaryMuscle: 'lats', secondaryMuscles: ['biceps', 'rear_delts'] };
const bench: BalanceExercise = { primaryMuscle: 'chest', secondaryMuscles: ['triceps', 'shoulders'] };
const snatch: BalanceExercise = { primaryMuscle: 'quadriceps', secondaryMuscles: ['glutes', 'hamstrings', 'lower_back', 'traps', 'front_delts', 'side_delts', 'abdominals', 'calves'] };
const get = (b: ReturnType<typeof muscleBalance>, g: string) => b.find((x) => x.group === g)!;

describe('muscleBalance', () => {
  it('3 rows sets count back 3 and biceps 1.5', () => {
    const b = muscleBalance([{ exercise: row, sets: 3, ageMs: DAY }], 'muscle');
    expect(get(b, 'back')).toMatchObject({ direct7: 3, indirect7: 0, effective7: 3 });
    expect(get(b, 'biceps')).toMatchObject({ direct7: 0, indirect7: 3, effective7: 1.5 });
  });
  it('bench 4 counts chest 4, triceps 2 and front_delts 2', () => {
    const b = muscleBalance([{ exercise: bench, sets: 4, ageMs: 0 }], 'muscle');
    expect([get(b, 'chest').effective7, get(b, 'triceps').effective7, get(b, 'front_delts').effective7]).toEqual([4, 2, 2]);
  });
  it('a deadlift-like hinge gives glutes and hamstrings half sets', () => {
    const dl: BalanceExercise = { primaryMuscle: 'lower_back', secondaryMuscles: ['glutes', 'hamstrings'] };
    const b = muscleBalance([{ exercise: dl, sets: 4, ageMs: 0 }], 'muscle');
    expect([get(b, 'glutes').effective7, get(b, 'hamstrings').effective7]).toEqual([2, 2]);
    const ex = EXERCISES.find((e) => e.id === 'pf-deadlift')!;
    expect(ex.secondaryMuscles).toEqual(expect.arrayContaining(['glutes', 'hamstrings']));
  });
  it('a dip gives chest and front delts half sets', () => {
    const dip: BalanceExercise = { primaryMuscle: 'triceps', secondaryMuscles: ['chest', 'front_delts'] };
    const b = muscleBalance([{ exercise: dip, sets: 4, ageMs: 0 }], 'muscle');
    expect([get(b, 'chest').effective7, get(b, 'front_delts').effective7]).toEqual([2, 2]);
  });
  it('a secondary counts only when its group is a synergist of the primary group', () => {
    const c = contributions(snatch);
    expect(c.map((x) => x.group)).toEqual(['quads', 'glutes']);
    const b = muscleBalance([{ exercise: snatch, sets: 2, ageMs: 0 }], 'muscle');
    expect(get(b, 'glutes').effective7).toBe(1);
    expect(get(b, 'traps').effective7).toBe(0);
    expect(get(b, 'abs').effective7).toBe(0);
  });
  it('counts a group once per exercise and ignores a secondary of the primary group', () => {
    const e: BalanceExercise = { primaryMuscle: 'chest', secondaryMuscles: ['triceps', 'triceps', 'chest'] };
    expect(contributions(e)).toEqual([{ group: 'chest', direct: true }, { group: 'triceps', direct: false }]);
  });
  it('unresolved exercises count as other, direct only; other is listed only when trained', () => {
    expect(muscleBalance([], 'muscle').some((g) => g.group === 'other')).toBe(false);
    const b = muscleBalance([{ exercise: null, sets: 3, ageMs: 0 }], 'muscle');
    expect(get(b, 'other')).toMatchObject({ direct7: 3, effective7: 3, state: null });
  });
  it('the synergist table is a register rule', () => {
    expect(policyRule('muscle.synergists').lists?.back).toEqual(['biceps', 'rear_delts', 'glutes', 'hamstrings']);
  });
  it('state thresholds: none, low, good, high against the goal range', () => {
    const range = MUSCLE_TARGETS.chest.muscle; // 12..18
    const at = (sets: number) => get(muscleBalance([{ exercise: { primaryMuscle: 'chest' }, sets, ageMs: 0 }], 'muscle'), 'chest').state;
    expect(get(muscleBalance([], 'muscle'), 'chest').state).toBe('none');
    expect(at(range.min - 1)).toBe('low');
    expect(at(range.min)).toBe('good');
    expect(at(range.max)).toBe('good');
    expect(at(range.max + 1)).toBe('high');
    expect(get(muscleBalance([{ exercise: { primaryMuscle: 'chest' }, sets: 7, ageMs: 0 }], undefined), 'chest').state).toBe('good'); // 6..8
  });
  it('7 days for the week, 28 days for the weekly average', () => {
    const b = muscleBalance([
      { exercise: bench, sets: 4, ageMs: 2 * DAY }, { exercise: bench, sets: 8, ageMs: 20 * DAY }, { exercise: bench, sets: 50, ageMs: 40 * DAY },
    ], 'muscle');
    expect(get(b, 'chest')).toMatchObject({ effective7: 4, perWeek4: 3 });
  });
});

describe('statistics and coach agree', () => {
  const NOW = Date.UTC(2026, 10, 4, 12);
  const catalog = EXERCISES;
  const mk = (id: string, daysAgo: number, sets: number) => ({ id, daysAgo, sets });
  const input = [mk('pf-bench-press', 2, 4), mk('pf-squat', 3, 3), mk('pf-lateral-raise', 9, 3)].filter((x) => catalog.some((e) => e.id === x.id));
  it('gives the same states for the same workouts', () => {
    const logged = input.map((x, i): LoggedWorkout => ({
      id: `w${i}`, profileId: 'p', startMs: NOW - x.daysAgo * DAY, endMs: NOW - x.daysAgo * DAY + 3600_000, source: 'app',
      exercises: [{ exerciseId: x.id, title: catalog.find((e) => e.id === x.id)!.title, sets: Array.from({ length: x.sets }, () => ({ type: 'normal', doneMs: NOW, weightKg: 50, reps: 10 })) }],
    } as unknown as LoggedWorkout));
    const hevy = input.map((x, i) => ({
      id: `h${i}`, title: 'T', startMs: NOW - x.daysAgo * DAY, durationS: 3600,
      exercises: [{ title: 'x', templateId: x.id, sets: x.sets, reps: 10, volumeKg: 0, workSets: Array.from({ length: x.sets }, () => ({ type: 'normal' as const, weightKg: 50, reps: 10 })) }],
    }));
    const v: StatsView = statsView(null, logged, NOW, catalog);
    const coach = muscleVolume(hevy as never, [], catalog, NOW, undefined);
    expect(input.length).toBeGreaterThan(1);
    expect(v.balance.map((g) => [g.group, g.state, g.effective7])).toEqual(coach.map((g) => [g.group, g.state, g.effective7]));
    expect(v.balance.some((g) => g.effective7 > 0)).toBe(true);
  });
});
