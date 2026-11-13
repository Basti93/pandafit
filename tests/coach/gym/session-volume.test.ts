import { describe, expect, it } from 'vitest';
import type { StrengthWorkout } from '../../../src/coach/hevy';
import type { ExerciseTemplate } from '../../../src/shared/gym/types';
import { checkWorkout, reasonPhrase, type GymContext } from '../../../src/coach/gym/guardrails';
import { capSessionVolume, ruleWorkout } from '../../../src/coach/gym/rules';
import { hardSetsOf } from '../../../src/shared/gym/pre-fatigue';
import { sessionSetsByGroup } from '../../../src/shared/gym/session-limits';
import { EXERCISES } from '../../../src/shared/exercises';

const DAY = 86_400_000;
const THURSDAY = new Date(2026, 10, 12, 12).getTime(); // Mon 9.11. to Sun 15.11.
const byId = (id: string) => EXERCISES.find((e) => e.id === id)!;
const template = (id: string): ExerciseTemplate => ({ id, title: byId(id).title, type: byId(id).type, primaryMuscle: byId(id).primaryMuscle, equipment: byId(id).equipment });
const IDS = ['pf-shoulder-press-machine', 'pf-lateral-raise', 'pf-lateral-raise-cable', 'pf-bench-press', 'pf-incline-bench-press', 'pf-chest-press-machine', 'pf-chest-fly-db', 'pf-pec-deck', 'pf-cable-crossover', 'pf-shoulder-press-db'];
const done = (id: string, at: number): StrengthWorkout => ({
  id: `${id}@${at}`, title: 'Day', startMs: at, durationS: 3600,
  exercises: [{ title: byId(id).title, templateId: id, sets: 2, reps: 0, volumeKg: 0, workSets: [{ type: 'normal', weightKg: null, reps: 10 }, { type: 'normal', weightKg: null, reps: 10 }] }],
});
// Every exercise was done long ago, so the equipment is known and each one is a frequent choice.
const OLD = IDS.flatMap((id) => [done(id, THURSDAY - 30 * DAY), done(id, THURSDAY - 20 * DAY)]);
const ctxOf = (workouts: StrengthWorkout[], nowMs = THURSDAY, extra: Partial<GymContext> = {}): GymContext => ({ workouts: [...OLD, ...workouts], templates: IDS.map(template), nowMs, catalog: EXERCISES, ...extra });
const row = (id: string, n: number) => ({ templateId: id, title: byId(id).title, restS: 90, supersetId: null, notes: '', sets: Array.from({ length: n }, () => ({ type: 'normal', weightKg: null, reps: 10 })) });
const wo = (...exercises: unknown[]) => ({ name: 'Test', exercises });

describe('Sätze pro Muskel und Training', () => {
  it('lehnt mehr als 11 Bruchteilssätze für einen Muskel ab, 11 gehen durch', () => {
    const ctx = ctxOf([]);
    expect(checkWorkout(wo(row('pf-bench-press', 11)), ctx).ok).toBe(true);
    const r = checkWorkout(wo(row('pf-bench-press', 12)), ctx);
    expect(r.ok).toBe(false);
    expect(reasonPhrase(r.ok ? '' : r.reason)).toContain('Sätze für einen Muskel');
  });
  it('zählt Sätze von Mitspielern halb', () => {
    const ctx = ctxOf([]);
    const sets = sessionSetsByGroup([{ exercise: byId('pf-bench-press'), sets: 8 }, { exercise: byId('pf-shoulder-press-db'), sets: 2 }]);
    expect(sets.front_delts).toBe(2 + 8 * 0.5);
    expect(checkWorkout(wo(row('pf-bench-press', 10), row('pf-shoulder-press-db', 2)), ctx).ok).toBe(true);
  });
});

describe('Isolationsarbeit gebündelt', () => {
  const twice = [done('pf-lateral-raise', THURSDAY - 3 * DAY), done('pf-lateral-raise-cable', THURSDAY - 2 * DAY)];
  it('lehnt Seitheben im dritten Training der Woche ab', () => {
    const r = checkWorkout(wo(row('pf-lateral-raise', 3)), ctxOf(twice));
    expect(r.ok).toBe(false);
    expect(reasonPhrase(r.ok ? '' : r.reason)).toContain('Isolationsübungen');
  });
  it('erlaubt Seitheben mit einem Training weniger und in der nächsten Woche wieder', () => {
    expect(checkWorkout(wo(row('pf-lateral-raise', 3)), ctxOf(twice.slice(0, 1))).ok).toBe(true);
    expect(checkWorkout(wo(row('pf-lateral-raise', 3)), ctxOf(twice, THURSDAY + 7 * DAY)).ok).toBe(true);
  });
  it('begrenzt eine Grundübung nicht', () => {
    const bench = [done('pf-bench-press', THURSDAY - 3 * DAY), done('pf-incline-bench-press', THURSDAY - 2 * DAY)];
    expect(checkWorkout(wo(row('pf-bench-press', 3)), ctxOf(bench)).ok).toBe(true);
  });
  it('erlaubt Schulterpresse an der Maschine im dritten Training der Woche', () => {
    const presses = [done('pf-shoulder-press-machine', THURSDAY - 3 * DAY), done('pf-shoulder-press-machine', THURSDAY - 2 * DAY)];
    expect(checkWorkout(wo(row('pf-shoulder-press-machine', 3)), ctxOf(presses)).ok).toBe(true);
  });
  it('begrenzt eine Übung ohne Katalogeintrag nicht', () => {
    expect(checkWorkout(wo(row('pf-lateral-raise', 3)), ctxOf(twice, THURSDAY, { catalog: [] })).ok).toBe(true);
  });
  it('lässt eine Kernübung des Abschnitts durch', () => {
    const block = { core: ['pf-lateral-raise'], exempt: new Set<string>(), light: false, lightCap: null };
    expect(checkWorkout(wo(row('pf-lateral-raise', 3)), ctxOf(twice, THURSDAY, { block })).ok).toBe(true);
    expect(checkWorkout(wo(row('pf-lateral-raise', 3), row('pf-lateral-raise-cable', 3)), ctxOf(twice, THURSDAY, { block })).ok).toBe(false);
  });
});

describe('Regelplan', () => {
  it('plant keine Isolation für eine Gruppe, die diese Woche schon zweimal dran war', () => {
    const twice = [done('pf-lateral-raise', THURSDAY - 3 * DAY), done('pf-lateral-raise-cable', THURSDAY - 2 * DAY)];
    const plan = ruleWorkout(ctxOf(twice));
    expect(plan.guard).toBeUndefined();
    expect(plan.workout.exercises.length).toBeGreaterThan(0);
    expect(plan.workout.exercises.some((e) => e.templateId.startsWith('pf-lateral-raise'))).toBe(false);
    expect(checkWorkout(plan.workout, ctxOf(twice)).ok).toBe(true);
  });
  it('plant nie mehr als 11 Bruchteilssätze für einen Muskel', () => {
    const chest = ['pf-bench-press', 'pf-incline-bench-press', 'pf-chest-press-machine', 'pf-chest-fly-db', 'pf-pec-deck', 'pf-cable-crossover'];
    const ctx = ctxOf([...chest, ...chest].map((id, i) => done(id, THURSDAY - (8 + i) * DAY)));
    const plan = ruleWorkout(ctx);
    expect(plan.guard).toBeUndefined();
    const sets = sessionSetsByGroup(plan.workout.exercises.map((e) => ({ exercise: byId(e.templateId), sets: hardSetsOf(e.sets) })));
    expect(Math.max(...Object.values(sets))).toBeLessThanOrEqual(11);
    expect(checkWorkout(plan.workout, ctx).ok).toBe(true);
  });
  it('kürzt einen zu großen Plan, eine Kernübung bleibt', () => {
    const ctx = ctxOf([], THURSDAY, { block: { core: ['pf-bench-press'], exempt: new Set<string>(), light: false, lightCap: null } });
    const w = { name: 'x', exercises: ['pf-bench-press', 'pf-incline-bench-press', 'pf-chest-press-machine'].map((id) => ({ ...row(id, 6), sets: row(id, 6).sets.map((s) => ({ ...s, type: 'normal' as const })) })) };
    const out = capSessionVolume(w, ctx);
    expect(out.exercises.some((e) => e.templateId === 'pf-bench-press')).toBe(true);
    expect(checkWorkout(out, ctx).ok).toBe(true);
  });
});
