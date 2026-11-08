import { applyNextChanges, changeRecord, moveChange, readChange, usedMarks } from '../../src/shared/changes';
import { EXERCISES } from '../../src/shared/exercises';
import { startFromPlan } from '../../src/tracking/session';
import type { GymWorkout } from '../../src/coach/gym/types';

const ex = (templateId: string, title: string) => ({ templateId, title, restS: null, supersetId: null, notes: '', sets: [1, 2, 3].map(() => ({ type: 'normal' as const, weightKg: 40, reps: 8 })) });
const plan: GymWorkout = { name: 'Plan', exercises: [ex('pf-incline-bench-press', 'Schrägbankdrücken'), ex('pf-squat', 'Kniebeuge')] };
const swapChange = (from: string, to: string, mid = 's1') => readChange(`chg-${mid}`, moveChange(changeRecord(mid, [{ op: 'swap', exerciseId: from, toId: to }], 'Tausch', 1), 'taken', 2)!.body)!;
const NOT_FITTING = 'Ein Tausch passte nicht zu diesem Training und bleibt fürs nächste.';

test('the target is already planned: the swap counts as applied', () => {
  const r = applyNextChanges(plan, [swapChange('pf-bench-press', 'pf-incline-bench-press')], EXERCISES);
  expect(r.applied).toEqual(['chg-s1']);
  expect(r.plan.exercises.map((e) => e.templateId)).toEqual(['pf-incline-bench-press', 'pf-squat']);
  expect(r.notes).toEqual([]);
});

test('the original is gone: the same muscle takes the swap', () => {
  const r = applyNextChanges(plan, [swapChange('pf-bench-press', 'pf-chest-press-machine')], EXERCISES);
  expect(r.applied).toEqual(['chg-s1']);
  expect(r.plan.exercises.map((e) => e.templateId)).toEqual(['pf-chest-press-machine', 'pf-squat']);
});

test('an excluded same-muscle exercise is not swapped', () => {
  const r = applyNextChanges(plan, [swapChange('pf-bench-press', 'pf-chest-press-machine')], EXERCISES, undefined, new Set(['pf-incline-bench-press']));
  expect(r.applied).toEqual([]);
  expect(r.notes).toEqual([NOT_FITTING]);
});

test('no fitting exercise: note, not applied', () => {
  const r = applyNextChanges(plan, [swapChange('pf-pull-up', 'pf-lat-pulldown')], EXERCISES);
  expect(r.applied).toEqual([]);
  expect(r.notes).toEqual([NOT_FITTING]);
  expect(r.plan.exercises.map((e) => e.templateId)).toEqual(['pf-incline-bench-press', 'pf-squat']);
});

test('the workout lists only applied changes; the rest stays taken', () => {
  const ok = swapChange('pf-bench-press', 'pf-chest-press-machine', 'a');
  const no = swapChange('pf-pull-up', 'pf-lat-pulldown', 'b');
  const w = startFromPlan(plan, [], 5, 'w1', EXERCISES, undefined, undefined, { changes: [ok, no], workouts: [] });
  expect(w.changes?.map((c) => c.id)).toEqual(['chg-a']);
  const recs = [ok, no].map((c) => ({ kind: 'change' as const, id: c.id, updatedMs: 2, deleted: false, body: { target: 'next', ops: c.ops, reason: '', state: 'taken', atMs: 1 } }));
  expect(usedMarks(recs, [w], 9).map((r) => r.id)).toEqual(['chg-a']);
});

test('the gym prompt names confirmed swaps as data, and not without any', async () => {
  const { buildGymPrompt } = await import('../../src/coach/gym/prompt');
  const { initialGymState } = await import('../../src/coach/gym/state');
  const input = { state: initialGymState('p'), workouts: [], templates: [], nowMs: 1, summaries: [], complaints: [], previous: null, wantNote: false };
  expect(buildGymPrompt(input)).not.toContain('tausch-nur-daten');
  const p = buildGymPrompt({ ...input, swaps: [{ statt: 'Bankdrücken', nimm: 'Brustpresse' }] });
  expect(p).toContain('<tausch-nur-daten>\n[{"statt":"Bankdrücken","nimm":"Brustpresse"}]');
  expect(p).toContain('Bestätigte Tausche gelten: plane die Übung aus nimm statt der aus statt.');
});

test('a change applies whole: a failing swap keeps its drop from happening', () => {
  const c = readChange('chg-x', moveChange(changeRecord('x', [{ op: 'swap', exerciseId: 'pf-pull-up', toId: 'pf-lat-pulldown' }, { op: 'drop', exerciseId: 'pf-squat' }], 'r', 1), 'taken', 2)!.body)!;
  const r = applyNextChanges(plan, [c], EXERCISES);
  expect(r.applied).toEqual([]);
  expect(r.plan.exercises.map((e) => e.templateId)).toEqual(['pf-incline-bench-press', 'pf-squat']);
  expect(r.notes).toEqual([NOT_FITTING]);
});

test('two swaps of one muscle hit different exercises; one candidate serves only the first', () => {
  const two: GymWorkout = { name: 'P', exercises: [ex('pf-incline-bench-press', 'a'), ex('pf-bench-press-db', 'b')] };
  const a = swapChange('pf-bench-press', 'pf-chest-press-machine', 'a');
  const b = swapChange('pf-pec-deck', 'pf-incline-press-db', 'b');
  const r = applyNextChanges(two, [a, b], EXERCISES);
  expect(r.applied).toEqual(['chg-a', 'chg-b']);
  expect(r.plan.exercises.map((e) => e.templateId).sort()).toEqual(['pf-chest-press-machine', 'pf-incline-press-db']);
  const one = applyNextChanges(plan, [a, b], EXERCISES);
  expect(one.applied).toEqual(['chg-a']);
  expect(one.notes).toEqual([NOT_FITTING]);
});
