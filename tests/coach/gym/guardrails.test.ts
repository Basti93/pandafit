import { describe, expect, it } from 'vitest';
import type { StrengthWorkout, SetType } from '../../../src/coach/hevy';
import type { ExerciseTemplate } from '../../../src/shared/gym/types';
import { checkWorkout, reasonPhrase, type GymContext } from '../../../src/coach/gym/guardrails';
import { gymMinutes } from '../../../src/shared/duration';
import { capLightWeek, ruleWorkout } from '../../../src/coach/gym/rules';
import { ladderFor, suggestNext } from '../../../src/coach/gym/history';
import { snapDown } from '../../../src/shared/loads';
import { EXERCISES } from '../../../src/shared/exercises';

const DAY = 86_400_000;
const NOW = Date.UTC(2026, 10, 2, 12);
const T = (id: string, equipment: string, primaryMuscle: string, type = 'weight_reps'): ExerciseTemplate => ({ id, title: `Title ${id}`, type, primaryMuscle, equipment });
const TEMPLATES: ExerciseTemplate[] = [
  T('sq', 'barbell', 'quadriceps'), T('bp', 'barbell', 'chest'), T('cp', 'machine', 'chest'), T('lp', 'machine', 'quadriceps'),
  T('lr', 'machine', 'lats'), T('cu', 'machine', 'biceps'), T('sp', 'machine', 'shoulders'), T('hc', 'machine', 'hamstrings'),
  T('kb', 'kettlebell', 'glutes'), T('pu', 'none', 'lats', 'bodyweight_reps'), T('db', 'dumbbell', 'triceps'),
];
type S = [number | null, number, SetType?];
const wk = (daysAgo: number, id: string, sets: S[]): StrengthWorkout => ({
  id: `w${daysAgo}${id}`, title: 'Day', startMs: NOW - daysAgo * DAY, durationS: 3600,
  exercises: [{ title: id, templateId: id, sets: sets.length, reps: 0, volumeKg: 0, workSets: sets.map(([weightKg, reps, type]) => ({ type: type ?? 'normal', weightKg, reps })) }],
});
const two = (id: string, kg: number | null, reps = 8): StrengthWorkout[] => [wk(14, id, [[kg, reps], [kg, reps]]), wk(7, id, [[kg, reps], [kg, reps]])];
// suggestNext: sq 60 kg reps 8 keep? 8 reps both sessions -> progress 9 reps at 60. cp 40 kg, bp 80 kg, pu bodyweight.
const CTX: GymContext = { workouts: [...two('sq', 60), ...two('bp', 80), ...two('cp', 40), ...two('pu', null, 12)], templates: TEMPLATES, nowMs: NOW };

const set = (weightKg: number | null, reps: number | null, type = 'normal') => ({ type, weightKg, reps });
const ex = (templateId: unknown, sets: unknown[], extra: Record<string, unknown> = {}) => ({ templateId, title: 'x', restS: 90, supersetId: null, notes: '', sets, ...extra });
const wo = (exercises: unknown) => ({ name: 'Test', exercises });
const refused = (raw: unknown, ctx = CTX) => { const r = checkWorkout(raw, ctx); expect(r.ok).toBe(false); return r.ok ? '' : r.reason; };
const passes = (raw: unknown, ctx = CTX) => { const r = checkWorkout(raw, ctx); if (!r.ok) throw new Error(r.reason); return r.workout; };

describe('checkWorkout stamps the studio', () => {
  it('the plan carries the studio it was planned for, never one from the answer', () => {
    const inStudio = (studio: string) => two('cp', 40).map((w) => ({ ...w, studio }));
    const ctx: GymContext = { ...CTX, workouts: inStudio('Alpha') };
    expect(passes(wo([ex('cp', [set(40, 8)])]), ctx).studio).toBe('Alpha');
    expect(passes({ ...wo([ex('cp', [set(40, 8)])]), studio: 'Fremd' }, ctx).studio).toBe('Alpha');
    expect(passes(wo([ex('cp', [set(null, 8)])]), { ...ctx, studio: 'Beta' }).studio).toBe('Beta');
    expect(passes(wo([ex('cp', [set(40, 8)])])).studio).toBeUndefined();
  });
});

describe('checkWorkout', () => {
  it('an unknown template id is refused', () => {
    refused(wo([ex('nope', [set(null, 8)])]));
    refused(wo([ex(42, [set(null, 8)])]));
  });
  it('more than 10 exercises or 30 sets are refused', () => {
    const ten = ['cp', 'lp', 'lr', 'cu', 'sp', 'hc', 'cp', 'lp', 'lr', 'cu'].map((id) => ex(id, [set(null, 8)]));
    passes(wo(ten));
    refused(wo([...ten, ex('sp', [set(null, 8)])]));
    passes(wo([ex('cp', Array.from({ length: 30 }, () => set(40, 8)))]));
    refused(wo([ex('cp', Array.from({ length: 31 }, () => set(40, 8)))]));
    refused(wo([ex('cp', Array.from({ length: 15 }, () => set(40, 8))), ex('lp', Array.from({ length: 16 }, () => set(null, 8)))]));
    refused(wo([]));
    refused(wo([ex('cp', [])]));
  });
  it('warm-up sets do not count toward the set limit', () => {
    const warm = Array.from({ length: 4 }, () => set(20, 5, 'warmup'));
    passes(wo([ex('cp', [...warm, ...Array.from({ length: 30 }, () => set(40, 8))])]));
    refused(wo([ex('cp', [...warm, ...Array.from({ length: 31 }, () => set(40, 8))])]));
  });
  it('the plan keeps all its work sets whatever ramps it adds', () => {
    const plan = ruleWorkout(CTX).workout;
    expect(plan.exercises.some((e) => e.sets.some((s) => s.type === 'warmup'))).toBe(true);
    for (const e of plan.exercises) expect(e.sets.filter((s) => s.type !== 'warmup')).toHaveLength(3);
  });
  it('a weight above suggestNext plus one reachable step is refused', () => {
    passes(wo([ex('cp', [set(40, 9)])]));
    passes(wo([ex('cp', [set(45, 8)])]));
    refused(wo([ex('cp', [set(50, 8)])]));
    passes(wo([ex('bp', [set(82.5, 8)])]));
    refused(wo([ex('bp', [set(85, 8)])]));
  });
  it('snaps a weight down onto the exercise ladder before it is checked', () => {
    const ws = [wk(21, 'cp', [[40, 8]]), wk(14, 'cp', [[45, 8]]), wk(7, 'cp', [[50, 8]])];
    const ctx = { ...CTX, workouts: ws };
    expect(passes(wo([ex('cp', [set(47, 8), set(50, 8)])]), ctx).exercises[0].sets.map((s) => s.weightKg)).toEqual([45, 50]);
    expect(passes(wo([ex('cp', [set(52, 8)])]), ctx).exercises[0].sets[0].weightKg).toBe(50);
  });
  it('only the planned studio\'s history counts for the ladder and the suggestion', () => {
    const other = { ...wk(3, 'cp', [[100, 8]]), studio: 'Beta' };
    const ctx = { ...CTX, workouts: [...CTX.workouts.map((w) => ({ ...w, studio: 'Alpha' })), other], studio: 'Alpha' };
    passes(wo([ex('cp', [set(45, 8)])]), ctx);
    refused(wo([ex('cp', [set(100, 8)])]), ctx);
  });
  it("the range is the exercise's own", () => {
    const ctx = { ...CTX, workouts: [...CTX.workouts, ...two('lat', 8, 12)], templates: [...TEMPLATES, T('lat', 'dumbbell', 'side_delts')] };
    passes(wo([ex('lat', [set(8, 20)])]), ctx);
    refused(wo([ex('lat', [set(8, 26)])]), ctx);
    refused(wo([ex('cp', [set(40, 20)])]), ctx);
  });
  it('a weight without history is refused', () => {
    refused(wo([ex('lp', [set(30, 8)])]));
    refused(wo([ex('pu', [set(10, 8)])]));
    passes(wo([ex('lp', [set(null, 8)])]));
  });
  it("a template from Hevy's list with recent equipment passes without a weight", () => {
    expect(passes(wo([ex('lp', [set(null, 8)])])).exercises[0].title).toBe('Title lp');
  });
  it('equipment never seen in recent months is refused', () => {
    refused(wo([ex('kb', [set(null, 8)])]));
    // machine equipment was only seen long ago: not available any more
    const onlyOld: GymContext = { ...CTX, workouts: [wk(200, 'cp', [[40, 8], [40, 8]]), ...CTX.workouts.filter((w) => !w.id.includes('cp'))] };
    refused(wo([ex('lp', [set(null, 8)])]), onlyOld);
  });
  it('failure on barbell is refused', () => {
    refused(wo([ex('bp', [set(80, 8), set(80, 8, 'failure')])]));
  });
  it('failure on machine or cable passes, at most 4 per workout', () => {
    passes(wo([ex('cp', [set(40, 8), set(40, 8, 'failure')])]));
    passes(wo([ex('cp', [set(40, 8, 'failure'), set(40, 8, 'failure')]), ex('lp', [set(null, 8, 'failure'), set(null, 8, 'failure')])]));
    refused(wo([ex('cp', Array.from({ length: 5 }, () => set(40, 8, 'failure')))]));
  });
  it('a widowmaker note on barbell is refused, and a second widowmaker too', () => {
    refused(wo([ex('bp', [set(60, 20)], { notes: 'Widowmaker: 20 Wiederholungen' })]));
    const w = { notes: 'Widowmaker: 20 Wiederholungen' };
    passes(wo([ex('cp', [set(40, 20)], w)]));
    refused(wo([ex('cp', [set(40, 20)], w), ex('lp', [set(null, 20)], w)]));
  });
  it('a widowmaker without a 20 rep set, or with two, is refused', () => {
    refused(wo([ex('cp', [set(40, 8)], { notes: 'Widowmaker: x' })]));
    refused(wo([ex('cp', [set(40, 20), set(40, 20)], { notes: 'Widowmaker: x' })]));
  });
  it('superset ids must pair at least two exercises', () => {
    refused(wo([ex('cp', [set(40, 8)], { supersetId: 1 }), ex('lp', [set(null, 8)])]));
    passes(wo([ex('cp', [set(40, 8)], { supersetId: 1 }), ex('lp', [set(null, 8)], { supersetId: 1 })]));
    refused(wo([ex('cp', [set(40, 8)], { supersetId: 1.5 }), ex('lp', [set(null, 8)], { supersetId: 1.5 })]));
    refused(wo([ex('cp', [set(40, 8)], { supersetId: '1' })]));
  });
  it('reps outside 6 to 12 on normal sets are refused except on a widowmaker with 20 reps', () => {
    refused(wo([ex('cp', [set(40, 5)])]));
    refused(wo([ex('cp', [set(40, 13)])]));
    refused(wo([ex('cp', [set(40, 20)])]));
    refused(wo([ex('cp', [set(40, 5, 'failure')])]));
    passes(wo([ex('cp', [set(40, 6), set(40, 12)])]));
    refused(wo([ex('cp', [set(40, 21)], { notes: 'Widowmaker: x' })]));
  });
  it('bodyweight reps may exceed 12 but stay positive whole numbers', () => {
    passes(wo([ex('pu', [set(null, 15)])]));
    passes(wo([ex('pu', [set(null, 1)])]));
    refused(wo([ex('pu', [set(null, 0)])]));
    refused(wo([ex('pu', [set(null, 500)])]));
  });
  it('a widowmaker is 20 reps at no more than the suggested weight', () => {
    const w = { notes: 'Widowmaker: 20 Wiederholungen' };
    passes(wo([ex('cp', [set(40, 20)], w)]));
    refused(wo([ex('cp', [set(45, 20)], w)]));
    refused(wo([ex('lp', [set(null, 20)], w)])); // no history: no widowmaker
  });
  it('malformed values are refused', () => {
    for (const bad of [null, undefined, 'x', 7, [], {}, { name: 'a' }, { name: '', exercises: [ex('cp', [set(40, 8)])] }, { name: 5, exercises: [] }, wo('x'), wo([null]), wo([ex('cp', 'x' as unknown as unknown[])]), wo([ex('cp', [null])])]) refused(bad);
    for (const w of [Number.NaN, Infinity, -5, 0, '40', 40.123]) refused(wo([ex('cp', [set(w as number, 8)])]));
    for (const r of [Number.NaN, Infinity, -1, 8.5, '8', undefined]) refused(wo([ex('cp', [set(40, r as number)])]));
    refused(wo([ex('cp', [set(40, 8, 'superset')])]));
    refused(wo([ex('cp', [set(40, 8)], { restS: -1 })]));
    refused(wo([ex('cp', [set(40, 8)], { restS: 99999 })]));
    refused(wo([ex('cp', [set(40, 8)], { restS: Number.NaN })]));
    refused(wo([ex('cp', [set(40, 8)], { notes: 5 })]));
    refused(wo([ex('cp', [{ ...set(40, null), repRange: { start: 5, end: 10 } }])]));
    refused(wo([ex('cp', [{ ...set(40, null), repRange: { start: 10, end: 8 } }])]));
    passes(wo([ex('cp', [{ ...set(40, null), repRange: { start: 8, end: 12 } }])]));
  });
  it('reps are checked together with a rep range', () => {
    refused(wo([ex('cp', [{ ...set(40, 100), repRange: { start: 8, end: 10 } }])]));
    refused(wo([ex('cp', [{ ...set(40, 20), repRange: { start: 8, end: 10 } }])]));
    refused(wo([ex('cp', [{ ...set(40, 20), repRange: { start: 8, end: 10 } }], { notes: 'Widowmaker: x' })]));
    refused(wo([ex('cp', [{ ...set(40, null), repRange: { start: 4, end: 10 } }])]));
    refused(wo([ex('cp', [{ ...set(40, null), repRange: { start: 8, end: 15 } }])]));
    passes(wo([ex('cp', [{ ...set(40, 9), repRange: { start: 8, end: 10 } }])]));
  });
  it('a widowmaker note is recognised with a leading space or other case', () => {
    expect(refused(wo([ex('bp', [set(60, 8)], { notes: '  widowmaker: 20' })]))).toMatch(/Widowmaker/);
    expect(refused(wo([ex('bp', [set(60, 8)], { notes: 'WIDOWMAKER' })]))).toMatch(/Widowmaker/);
    const a = ex('cp', [set(40, 20)], { notes: ' widowmaker: x' });
    const b = ex('lp', [set(null, 20)], { notes: 'WIDOWMAKER: x' });
    expect(refused(wo([a, b]))).toMatch(/mehr als 1 Widowmaker/);
  });
  it('the result carries only known fields, with the title from the template', () => {
    const w = passes({ name: 'Test', extra: 1, exercises: [{ ...ex('cp', [set(40, 8)]), evil: 'x' }] });
    expect(w).toEqual({ name: 'Test', exercises: [{ templateId: 'cp', title: 'Title cp', restS: 90, supersetId: null, notes: '', sets: [{ type: 'normal', weightKg: 40, reps: 8 }] }] });
  });
});

describe('ruleWorkout', () => {
  const many = (): StrengthWorkout[] => [
    ...two('cp', 40), ...two('lr', 30), ...two('sp', 20), ...two('cu', 15), ...two('hc', 25), ...two('lp', 100), wk(3, 'db', [[10, 8]]),
  ];
  it('leaves every rest to restOf (restS null)', () => {
    const ctx: GymContext = { workouts: [...many(), wk(2, 'cp', [[40, 8]]), wk(1, 'cp', [[40, 8]])].map((w) => ({ ...w, startMs: w.startMs - 5 * DAY })), templates: TEMPLATES, nowMs: NOW };
    const ex = ruleWorkout(ctx).workout.exercises;
    expect(ex.length).toBeGreaterThan(0);
    expect(ex.every((e) => e.restS === null)).toBe(true);
  });
  it('has a recurring core of up to 6 most frequent recent exercises, passes its own check, and has no weights where history is missing', () => {
    const ctx: GymContext = { workouts: [...many(), wk(2, 'cp', [[40, 8]]), wk(1, 'cp', [[40, 8]])].map((w) => ({ ...w, startMs: w.startMs - 5 * DAY })), templates: TEMPLATES, nowMs: NOW };
    const r = ruleWorkout(ctx);
    expect(r.workout.exercises.length).toBe(6);
    expect(r.workout.exercises[0].templateId).toBe('cp'); // most frequent
    expect(r.workout.exercises.map((e) => e.templateId)).not.toContain('db');
    expect(r.reason.length).toBeGreaterThan(0);
    const c = checkWorkout(r.workout, ctx);
    expect(c.ok).toBe(true);
    const noKg: GymContext = { ...ctx, workouts: ctx.workouts.map((w) => ({ ...w, exercises: w.exercises.map((e) => ({ ...e, workSets: e.workSets.map((s) => ({ ...s, weightKg: null })) })) })) };
    expect(ruleWorkout(noKg).workout.exercises.flatMap((e) => e.sets).every((s) => s.weightKg === null)).toBe(true);
  });
  it('starts at the range minimum when it is above 10', () => {
    const sd = T('sd', 'machine', 'side_delts');
    const ctx: GymContext = { workouts: [], templates: [sd], nowMs: NOW };
    const sets = ruleWorkout(ctx).workout.exercises.flatMap((e) => e.sets);
    expect(sets.length).toBeGreaterThan(0);
    expect(sets.every((x) => x.reps === 12)).toBe(true);
  });
  it('ignores exercises that are not recent or not in the template list', () => {
    const ctx: GymContext = { workouts: [wk(300, 'cp', [[40, 8]]), wk(10, 'ghost', [[40, 8]]), wk(10, 'lr', [[30, 8]])], templates: TEMPLATES, nowMs: NOW };
    expect(ruleWorkout(ctx).workout.exercises.map((e) => e.templateId)).toEqual(['lr']);
  });
  it('with empty history the rule workout is a simple machine full-body workout without weights', () => {
    const r = ruleWorkout({ workouts: [], templates: TEMPLATES, nowMs: NOW });
    const list = r.workout.exercises;
    expect(list.length).toBeGreaterThanOrEqual(4);
    expect(list.length).toBeLessThanOrEqual(6);
    expect(list.every((e) => TEMPLATES.find((t) => t.id === e.templateId)?.equipment === 'machine')).toBe(true);
    expect(list.flatMap((e) => e.sets).every((s) => s.weightKg === null && s.type === 'normal' && s.reps! >= 6 && s.reps! <= 12)).toBe(true);
    expect(r.reason).toMatch(/Du hast noch keine früheren Trainings/);
  });
  it('says honestly when no suitable exercises were found', () => {
    for (const templates of [[], TEMPLATES.filter((t) => t.equipment !== 'machine')]) {
      const r = ruleWorkout({ workouts: [], templates, nowMs: NOW });
      expect(r.workout.exercises).toEqual([]);
      expect(r.reason).toMatch(/keine passenden Übungen/);
      expect(r.reason).not.toMatch(/Ganzkörpertraining/);
    }
  });
  it('recent leg work leaves out heavy leg exercises', () => {
    const legs = [wk(1, 'lp', [[100, 8]]), ...many().filter((w) => !w.id.endsWith('lp'))];
    const ctx: GymContext = { workouts: legs, templates: TEMPLATES, nowMs: NOW };
    const ids = ruleWorkout(ctx).workout.exercises.map((e) => e.templateId);
    expect(ids).not.toContain('lp');
    expect(ids).not.toContain('hc');
    expect(ids.length).toBeGreaterThan(0);
  });
});

describe('no legs today', () => {
  const legs = wo([ex('lp', [set(null, 8)])]);
  it('refuses a leg exercise when avoidLegs is set, accepts it otherwise', () => {
    passes(legs);
    const reason = refused(legs, { ...CTX, avoidLegs: true });
    expect(reasonPhrase(reason)).not.toBe('eine Angabe außerhalb der Grenzen');
    passes(wo([ex('cp', [set(40, 8)])]), { ...CTX, avoidLegs: true });
  });
});

describe('time budget', () => {
  const sets = (n: number) => Array.from({ length: n }, () => set(40, 8));
  const long = wo([ex('cp', sets(4)), ex('lp', [set(null, 8), set(null, 8), set(null, 8), set(null, 8)]), ex('lr', [set(null, 8), set(null, 8), set(null, 8), set(null, 8)])]);
  const budgeted = (m: number): GymContext => ({ ...CTX, budgetMinutes: m });
  it('refuses an AI plan over budget plus 10 % with the phrase', () => {
    // 8 min + 12 sets x 130 s + 2 changes = 36 min, about 35
    const reason = refused(long, budgeted(30));
    expect(reason).toMatch(/zu lang für deine Zeit/);
    expect(reasonPhrase(reason)).toBe('zu lang für deine Zeit');
    passes(long, budgeted(35));
    passes(long, budgeted(32)); // 32 x 1.1 = 35.2
    refused(long, budgeted(31)); // 34.1
  });
  it('does not check the time without a budget', () => {
    passes(long);
  });
  it('trims the rule fallback to fit and the result passes the check', () => {
    const ctx = budgeted(20);
    const r = ruleWorkout(ctx);
    expect(r.workout.exercises.length).toBeGreaterThan(0);
    expect(gymMinutes(r.workout)).toBeLessThanOrEqual(22);
    expect(checkWorkout(r.workout, ctx).ok).toBe(true);
    expect(r.reason).toMatch(/Dauer ca\. \d+ Min\./);
    expect(r.workout.exercises.every((e) => e.sets.length >= 2)).toBe(true);
  });
  it('says so when even the smallest plan is longer than the time', () => {
    const r = ruleWorkout(budgeted(5));
    expect(gymMinutes(r.workout)).toBeGreaterThan(5 * 1.1);
    expect(r.reason).toContain('länger als deine 5 Min');
    expect(ruleWorkout(budgeted(60)).reason).not.toContain('länger als deine');
  });
  it('leaves the rule fallback whole without a budget', () => {
    const r = ruleWorkout(CTX);
    const sets3 = r.workout.exercises.every((e) => e.sets.filter((s) => s.type !== 'warmup').length === 3);
    expect(sets3).toBe(true);
    expect(r.guard).toBeUndefined();
    expect(r.reason).toMatch(/Dauer ca\. \d+ Min\./);
  });
});

describe('checkWorkout and the place in the workout', () => {
  // Invented: an incline press so far done fresh at 40 kg, planned as the third chest exercise.
  const ctx: GymContext = { ...CTX, templates: [...TEMPLATES, T('ip', 'barbell', 'chest')], workouts: [...CTX.workouts, ...two('ip', 40)] };
  const ip = (w: ReturnType<typeof passes>) => w.exercises.find((e) => e.templateId === 'ip')!.sets.map((s) => s.weightKg);
  it('kappt die Last nach der Stelle im Training', () => {
    const third = passes(wo([ex('cp', [set(40, 8), set(40, 8), set(40, 8), set(40, 8)]), ex('bp', [set(80, 8), set(80, 8)]), ex('ip', [set(40, 8), set(40, 8)])]), ctx);
    const ladder = ladderFor('ip', ctx.templates.at(-1), ctx.workouts, NOW);
    const step2 = snapDown(40 * 0.88, ladder);
    for (const kg of ip(third)) expect(kg).toBeLessThanOrEqual(step2);
    expect(ip(third)).toEqual([snapDown(40 * 0.82, ladder), snapDown(40 * 0.82, ladder)]);
  });
  it('leaves the load alone when the exercise comes first', () => {
    const first = passes(wo([ex('ip', [set(40, 8)]), ex('cp', [set(40, 8)])]), ctx);
    expect(ip(first)).toEqual([40]);
  });
  it('the rule workout plans a later exercise for the same muscle with its lower load', () => {
    const own: GymContext = { ...ctx, workouts: [...two('cp', 40), ...two('ip', 40)] };
    const plan = ruleWorkout(own).workout;
    expect(plan.exercises.map((e) => e.templateId)).toEqual(['cp', 'ip']);
    const ladder = ladderFor('ip', ctx.templates.at(-1), own.workouts, NOW);
    expect(ip(plan)).toEqual([0, 0, 0].map(() => snapDown(40 * 0.91, ladder)));
  });
  it('takes the refusal limit from the suggestion the prompt shows, and lowers only where the place demands', () => {
    // Older session tired (after 4 chest-press sets), newer one fresh, both at the top of the range: the prompt says 42.5 kg.
    const tiredDay: StrengthWorkout = { ...wk(14, 'ip', [[40, 12], [40, 12]]), exercises: [...wk(14, 'cp', [[40, 8], [40, 8], [40, 8], [40, 8]]).exercises, ...wk(14, 'ip', [[40, 12], [40, 12]]).exercises] };
    const mixed: GymContext = { ...ctx, workouts: [...two('bp', 80), tiredDay, wk(7, 'ip', [[40, 12], [40, 12]])] };
    expect(ip(passes(wo([ex('ip', [set(45, 6)]), ex('bp', [set(80, 8)])]), mixed))).toEqual([45]);
    expect(ip(passes(wo([ex('cp', [set(40, 8), set(40, 8), set(40, 8), set(40, 8)]), ex('ip', [set(45, 6)])]), mixed))).toEqual([40]);
  });
  it('counts the pre-fatigue in the order the person sees, superset partners pulled together', () => {
    const w = passes(wo([ex('cp', [set(40, 8), set(40, 8)], { supersetId: 1 }), ex('bp', [set(80, 8)]), ex('ip', [set(40, 8), set(40, 8)], { supersetId: 1 })]), ctx);
    expect(w.exercises.map((e) => e.templateId)).toEqual(['cp', 'ip', 'bp']);
    const ladder = ladderFor('bp', ctx.templates.find((t) => t.id === 'bp'), ctx.workouts, NOW);
    expect(w.exercises[2]!.sets[0]!.weightKg).toBe(snapDown(80 * 0.88, ladder));
  });
  it('still refuses a weight above the fresh suggestion plus one step', () => {
    refused(wo([ex('cp', [set(40, 8)]), ex('ip', [set(50, 8)])]), ctx);
  });
  // Invented: the incline press so far always came after six chest-press sets; the rule plan puts it after three.
  const day = (daysAgo: number, ipReps: number): StrengthWorkout => ({
    ...wk(daysAgo, 'ip', []),
    exercises: [...wk(daysAgo, 'cp', Array.from({ length: 6 }, (): S => [40, 8])).exercises, ...wk(daysAgo, 'ip', [[40, ipReps], [40, ipReps]]).exercises],
  });
  const blindKg = (c: GymContext) => suggestNext('ip', c.workouts, NOW, c.templates.find((t) => t.id === 'ip')).weightKg!;
  it('the rule workout passes its own check when the reps dropped twice at another place', () => {
    const own: GymContext = { ...ctx, workouts: [day(21, 10), day(14, 9), day(7, 8)] };
    const r = ruleWorkout(own);
    expect(r.guard).toBeUndefined();
    expect(r.workout.exercises.map((e) => e.templateId)).toEqual(['cp', 'ip']);
    for (const kg of ip(r.workout)) expect(kg).toBeLessThanOrEqual(blindKg(own));
  });
  it('the rule workout passes its own check after a long break at another place', () => {
    const own: GymContext = { ...ctx, workouts: [day(42, 8), day(35, 8)] };
    const r = ruleWorkout(own);
    expect(r.guard).toBeUndefined();
    expect(r.workout.exercises.map((e) => e.templateId)).toEqual(['cp', 'ip']);
    for (const kg of ip(r.workout)) expect(kg).toBeLessThanOrEqual(blindKg(own));
  });
});

describe('checkWorkout refuses the same execution twice', () => {
  const catalogTemplates: ExerciseTemplate[] = ['pf-triceps-rope', 'pf-triceps-pushdown', 'pf-overhead-triceps-cable'].map((id) => {
    const e = EXERCISES.find((c) => c.id === id)!;
    return { id, title: e.title, type: e.type, primaryMuscle: e.primaryMuscle, equipment: e.equipment };
  });
  const ctx: GymContext = {
    workouts: ['pf-triceps-rope', 'pf-triceps-pushdown', 'pf-overhead-triceps-cable'].flatMap((id) => two(id, 20, 10)),
    templates: catalogTemplates, nowMs: NOW, catalog: EXERCISES,
  };
  const row = (id: string) => ex(id, [set(20, 10)]);

  it('lehnt dieselbe Ausführung zweimal ab', () => {
    const r = checkWorkout(wo([row('pf-triceps-rope'), row('pf-triceps-pushdown')]), ctx);
    expect(r).toEqual({ ok: false, reason: 'dieselbe Ausführung doppelt' });
  });
  it('finds the entry of a Hevy template through the link', () => {
    const hevy: ExerciseTemplate = { id: 'hevy-1', title: 'Fremdname', type: 'weight_reps', primaryMuscle: 'triceps', equipment: 'machine' };
    const c: GymContext = { ...ctx, templates: [...catalogTemplates, hevy], workouts: [...ctx.workouts, ...two('hevy-1', 20, 10)], links: { 'hevy-1': 'pf-triceps-rope' } };
    expect(checkWorkout(wo([row('hevy-1'), row('pf-triceps-pushdown')]), c)).toEqual({ ok: false, reason: 'dieselbe Ausführung doppelt' });
    passes(wo([row('hevy-1'), row('pf-triceps-pushdown')]), { ...c, links: {} });
  });
  it('lets another angle of the same muscle through', () => {
    passes(wo([row('pf-triceps-rope'), row('pf-overhead-triceps-cable')]), ctx);
  });
  it('never refuses an exercise without a catalog entry', () => {
    passes(wo([row('pf-triceps-rope'), row('pf-triceps-pushdown')]), { ...ctx, catalog: [] });
  });
  it('the rule workout takes only one of two executions done together', () => {
    const both = (daysAgo: number): StrengthWorkout => ({
      ...wk(daysAgo, 'x', []),
      exercises: ['pf-triceps-rope', 'pf-triceps-pushdown', 'pf-overhead-triceps-cable'].flatMap((id) => wk(daysAgo, id, [[20, 10], [20, 10]]).exercises),
    });
    const r = ruleWorkout({ ...ctx, workouts: [both(14), both(7)] });
    expect(r.guard).toBeUndefined();
    expect(r.workout.name).toBe('Ganzkörper');
    const ids = r.workout.exercises.map((e) => e.templateId);
    expect(ids).toHaveLength(2);
    expect(ids).toContain('pf-overhead-triceps-cable');
    expect(ids.filter((id) => id === 'pf-triceps-rope' || id === 'pf-triceps-pushdown')).toHaveLength(1);
  });
  it('turns the reason into a phrase that completes the sentence', () => {
    expect(reasonPhrase('dieselbe Ausführung doppelt')).toBe('dieselbe Übung zweimal, nur mit anderem Gerät');
  });
});

describe('Härte', () => {
  it('lehnt Versagenssätze bei vorsichtiger Härte ab', () => {
    const gentle: GymContext = { ...CTX, push: 'gentle' };
    expect(checkWorkout(wo([ex('cp', [set(40, 8), set(40, 8, 'failure')])]), gentle)).toEqual({ ok: false, reason: 'Versagen passt nicht zur Härte' });
    expect(checkWorkout(wo([ex('cp', [set(40, 8), set(40, 8, 'dropset')])]), gentle)).toEqual({ ok: false, reason: 'Versagen passt nicht zur Härte' });
    passes(wo([ex('cp', [set(40, 8), set(40, 8)])]), gentle);
  });
  it('erlaubt sie bei normal und hart wie bisher', () => {
    for (const push of ['normal', 'hard'] as const) {
      passes(wo([ex('cp', [set(40, 8), set(40, 8, 'failure')])]), { ...CTX, push });
      passes(wo([ex('cp', [set(40, 8), set(40, 8, 'dropset')])]), { ...CTX, push });
      refused(wo([ex('cp', Array.from({ length: 5 }, () => set(40, 8, 'failure')))]), { ...CTX, push });
    }
  });
  it('lehnt bei vorsichtiger Härte auch einen Widowmaker ab', () => {
    const w = { notes: 'Widowmaker: 20 Wiederholungen' };
    passes(wo([ex('cp', [set(40, 20)], w)]), { ...CTX, push: 'normal' });
    expect(checkWorkout(wo([ex('cp', [set(40, 20)], w)]), { ...CTX, push: 'gentle' })).toEqual({ ok: false, reason: 'Versagen passt nicht zur Härte' });
  });
  it('nennt bei vorsichtiger Härte zuerst die Härte, auch bei zu vielen Versagenssätzen', () => {
    const five = wo([ex('cp', Array.from({ length: 5 }, () => set(40, 8, 'failure')))]);
    expect(checkWorkout(five, { ...CTX, push: 'gentle' })).toEqual({ ok: false, reason: 'Versagen passt nicht zur Härte' });
  });
  it('der Regelplan für eine vorsichtige Person kommt ohne Ablehnung durch', () => {
    const plan = ruleWorkout({ ...CTX, push: 'gentle' });
    expect(plan.guard).toBeUndefined();
    expect(plan.workout.exercises.length).toBeGreaterThan(0);
    expect(plan.workout.exercises.flatMap((e) => e.sets).some((s) => s.type === 'failure' || s.type === 'dropset')).toBe(false);
  });
});

describe('Abschnitt', () => {
  const block = (over: Partial<NonNullable<GymContext['block']>> = {}): NonNullable<GymContext['block']> => ({ core: ['cp', 'lr'], exempt: new Set<string>(), light: false, lightCap: null, ...over });
  const full = () => wo([ex('cp', [set(40, 9), set(40, 9)]), ex('lr', [set(50, 9), set(50, 9)])]);
  it('lehnt einen Plan ohne Kernübung ab', () => {
    const ctx = { ...CTX, workouts: [...CTX.workouts, ...two('lr', 50)], block: block() };
    passes(full(), ctx);
    expect(refused(wo([ex('cp', [set(40, 9), set(40, 9)])]), ctx)).toBe('Kernübung fehlt');
  });
  it('lässt eine ausgenommene Kernübung weg', () => {
    const ctx = { ...CTX, workouts: [...CTX.workouts, ...two('lr', 50)], block: block({ exempt: new Set(['lr']) }) };
    passes(wo([ex('cp', [set(40, 9), set(40, 9)])]), ctx);
  });
  it('erkennt eine Kernübung über den Link auf die eigene Id', () => {
    const ctx = { ...CTX, links: { cp: 'own-chest' }, block: block({ core: ['own-chest'] }) };
    passes(wo([ex('cp', [set(40, 9), set(40, 9)])]), ctx);
  });
  it('kappt die leichte Woche', () => {
    const ctx = { ...CTX, block: block({ core: [], light: true, lightCap: 10 }) };
    const sets = (n: number) => Array.from({ length: n }, () => set(40, 9));
    expect(refused(wo([ex('cp', sets(6)), ex('bp', sets(5).map(() => set(80, 9)))]), ctx)).toBe('zu viel für die leichte Woche');
    passes(wo([ex('cp', sets(5)), ex('bp', sets(5).map(() => set(80, 9)))]), ctx);
    expect(refused(wo([ex('cp', [set(40, 9), set(40, 9, 'failure')])]), ctx)).toBe('zu viel für die leichte Woche');
  });
  it('ohne Kappe gibt es in der leichten Woche keine Obergrenze für Sätze', () => {
    passes(wo([ex('cp', Array.from({ length: 12 }, () => set(40, 9)))]), { ...CTX, block: block({ core: [], light: true, lightCap: null }) });
  });
  it('bleibt vorsichtig im Abschnitt', () => {
    const ctx = { ...CTX, push: 'gentle' as const, block: block({ core: [] }) };
    expect(refused(wo([ex('cp', [set(40, 9), set(40, 9, 'failure')])]), ctx)).toBe('Versagen passt nicht zur Härte');
  });
  it('der Regelplan bringt die Kernübungen mit und hält die Kappe der leichten Woche', () => {
    const ctx: GymContext = { ...CTX, block: { core: ['cp', 'bp'], exempt: new Set(), light: true, lightCap: 4 } };
    const plan = ruleWorkout(ctx);
    expect(plan.guard).toBeUndefined();
    const ids = plan.workout.exercises.map((e) => e.templateId);
    expect(ids).toEqual(expect.arrayContaining(['cp', 'bp']));
    expect(plan.workout.exercises.flatMap((e) => e.sets).filter((s) => s.type !== 'warmup').length).toBeLessThanOrEqual(4);
  });
  it('der Regelplan setzt eine Kernübung vor die häufigsten Übungen', () => {
    const ctx: GymContext = { ...CTX, workouts: [...CTX.workouts, ...two('lr', 50)], block: { core: ['lr'], exempt: new Set(), light: false, lightCap: null } };
    const plan = ruleWorkout(ctx);
    expect(plan.guard).toBeUndefined();
    expect(plan.workout.exercises.map((e) => e.templateId)).toContain('lr');
  });
});

describe('capLightWeek', () => {
  const e = (id: string, types: string[]) => ({ templateId: id, title: id, restS: null, supersetId: null, notes: '', sets: types.map((type) => ({ type: type as 'normal', weightKg: 40, reps: 8 })) });
  const ctx = (core: string[], cap: number): GymContext => ({ ...CTX, block: { core, exempt: new Set(), light: true, lightCap: cap } });
  it('nimmt zuerst eine Übung, die keine Kernübung ist', () => {
    const w = { name: 'x', exercises: [e('lr', ['normal']), e('cp', ['normal'])] };
    expect(capLightWeek(w, ctx(['cp'], 1)).exercises.map((x) => x.templateId)).toEqual(['cp']);
  });
  it('streicht keinen falschen Satz, wenn eine Übung keinen normalen Satz hat', () => {
    const w = { name: 'x', exercises: [e('cp', ['normal', 'normal']), e('lr', ['failure', 'failure'])] };
    const out = capLightWeek(w, ctx([], 3));
    expect(out.exercises[1]!.sets.map((s) => s.type)).toEqual(['failure', 'failure']);
    expect(out.exercises[0]!.sets).toHaveLength(1);
  });
});
