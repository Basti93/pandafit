import { describe, expect, it } from 'vitest';
import { muscleGroupOf, weeklySetRange, MUSCLE_TARGETS } from '../../../src/shared/muscle-targets';
import { muscleVolume, muscleChartOf } from '../../../src/coach/gym/muscle-volume';
import { buildGymPrompt, GYM_SYSTEM_PROMPT } from '../../../src/coach/gym/prompt';
import { initialGymState } from '../../../src/coach/gym/state';
import type { StrengthWorkout } from '../../../src/coach/hevy';

const DAY = 86_400_000;
const NOW = Date.UTC(2026, 10, 3, 12);

describe('muscleGroupOf', () => {
  it('counts the legacy shoulders as the front shoulder and the three parts as themselves', () => {
    expect(muscleGroupOf({ primaryMuscle: 'shoulders' })).toBe('front_delts');
    expect(muscleGroupOf({ primaryMuscle: 'front_delts' })).toBe('front_delts');
    expect(muscleGroupOf({ primaryMuscle: 'side_delts' })).toBe('side_delts');
    expect(muscleGroupOf({ primaryMuscle: 'rear_delts' })).toBe('rear_delts');
  });
  it('joins lats and upper back, keeps hamstrings and glutes apart, and knows nothing else', () => {
    expect(muscleGroupOf({ primaryMuscle: 'lats' })).toBe('back');
    expect(muscleGroupOf({ primaryMuscle: 'upper_back' })).toBe('back');
    expect(muscleGroupOf({ primaryMuscle: 'glutes' })).toBe('glutes');
    expect(muscleGroupOf({ primaryMuscle: 'hamstrings' })).toBe('hamstrings');
    expect(muscleGroupOf({ primaryMuscle: null })).toBe('other');
  });
});

describe('targets', () => {
  it('small muscles get higher reps than big compound groups', () => {
    expect(MUSCLE_TARGETS.side_delts.reps.min).toBeGreaterThan(MUSCLE_TARGETS.chest.reps.max - 1);
    expect(MUSCLE_TARGETS.calves.reps.min).toBeGreaterThan(MUSCLE_TARGETS.quads.reps.min);
  });
  it('a muscle goal asks for more sets than other goals', () => {
    expect(weeklySetRange('chest', 'muscle')).toEqual({ min: 12, max: 18 });
    expect(weeklySetRange('chest', undefined)).toEqual({ min: 6, max: 8 });
    expect(weeklySetRange('biceps', 'muscle').max).toBeLessThan(weeklySetRange('back', 'muscle').max);
  });
});

const workout = (daysAgo: number, exercises: { templateId: string; title: string; sets: number; warmups?: number }[]): StrengthWorkout => ({
  id: `w${daysAgo}`, title: 'T', startMs: NOW - daysAgo * DAY, durationS: 3600,
  exercises: exercises.map((e) => ({
    title: e.title, templateId: e.templateId, sets: e.sets, reps: 10, volumeKg: 0,
    workSets: [
      ...Array.from({ length: e.warmups ?? 0 }, () => ({ type: 'warmup' as const, weightKg: 20, reps: 10 })),
      ...Array.from({ length: e.sets }, () => ({ type: 'normal' as const, weightKg: 50, reps: 10 })),
    ],
  })),
});
const templates = [
  { id: 'BP', title: 'Bench Press (Barbell)', type: 'weight_reps', primaryMuscle: 'chest', equipment: 'barbell' },
  { id: 'LR', title: 'Lateral Raise (Dumbbell)', type: 'weight_reps', primaryMuscle: 'side_delts', equipment: 'dumbbell' },
];

describe('muscleVolume', () => {
  it('counts working sets per group for the last 7 days and the 4-week weekly average, without warm-ups', () => {
    const ws = [workout(2, [{ templateId: 'BP', title: 'Bench Press (Barbell)', sets: 4, warmups: 2 }]), workout(20, [{ templateId: 'BP', title: 'Bench Press (Barbell)', sets: 8 }]), workout(40, [{ templateId: 'BP', title: 'Bench Press (Barbell)', sets: 50 }])];
    const v = muscleVolume(ws, templates, [], NOW, 'muscle');
    const chest = v.find((g) => g.group === 'chest')!;
    expect(chest.effective7).toBe(4);
    expect(chest.perWeek4).toBe(3);
    expect(chest.state).toBe('low');
    expect(chest.target).toEqual({ min: 12, max: 18 });
  });
  it('lists every group with a target, also untrained ones, and Sonstiges only when trained', () => {
    const v = muscleVolume([], templates, [], NOW, 'muscle');
    expect(v.find((g) => g.group === 'calves')?.effective7).toBe(0);
    expect(v.some((g) => g.group === 'other')).toBe(false);
  });
});

describe('the gym prompt', () => {
  it('carries the muscle volume with targets and rep ranges as data', () => {
    const input = { state: initialGymState('p'), workouts: [workout(2, [{ templateId: 'LR', title: 'Lateral Raise (Dumbbell)', sets: 3 }])], templates, nowMs: NOW, summaries: [], complaints: [], previous: null, wantNote: false };
    const p = buildGymPrompt(input);
    expect(p).toContain('<muskelvolumen-nur-daten>');
    expect(p).toMatch(/"gruppe":"Schulter seitlich","saetze7Tage":3/);
    expect(p).toContain('"zustand":"Wenig"');
    expect(p).not.toContain('vor allem mittrainiert');
    expect(GYM_SYSTEM_PROMPT).toMatch(/Block muskelvolumen/);
    expect(GYM_SYSTEM_PROMPT).toMatch(/5 bis 30 Wiederholungen/);
  });
});

describe('pairVerdicts', () => {
  it('names the smaller side when it is below two thirds of the larger and the larger is at least 6', async () => {
    const { pairVerdicts } = await import('../../../src/shared/muscle-targets');
    expect(pairVerdicts({ chest: 14, back: 8 })[0]).toMatchObject({ label: 'Brust : Rücken', a: 14, b: 8, short: 'b', shortLabel: 'Rücken' });
    expect(pairVerdicts({ chest: 5, back: 2 })[0].short).toBeNull();
    expect(pairVerdicts({ chest: 12, back: 9 })[0].short).toBeNull();
    expect(pairVerdicts({ quads: 6, hamstrings: 0 })[1].short).toBe('b');
    expect(pairVerdicts({})).toHaveLength(3);
  });
  it('sums hamstrings and glutes against the quads, and the side and rear shoulder against the front', async () => {
    const { pairVerdicts } = await import('../../../src/shared/muscle-targets');
    expect(pairVerdicts({ quads: 12, hamstrings: 5, glutes: 4 })[1]).toMatchObject({ label: 'Oberschenkel vorn : Oberschenkel hinten und Gesäß', b: 9, short: null });
    expect(pairVerdicts({ front_delts: 9, side_delts: 2, rear_delts: 2 })[2]).toMatchObject({ b: 4, short: 'b', shortLabel: 'Schulter seitlich und Schulter hinten' });
  });
});

describe('the muscle pairs in the gym prompt', () => {
  const bench = { templateId: 'BP', title: 'Bench Press (Barbell)' };
  const row = { templateId: 'RW', title: 'Row (Cable)' };
  const tpl = [...templates, { id: 'RW', title: 'Row (Cable)', type: 'weight_reps', primaryMuscle: 'lats', equipment: 'cable' }];
  it('keeps the raw 4-week sum per group', () => {
    const v = muscleVolume([workout(3, [{ ...bench, sets: 7 }]), workout(10, [{ ...bench, sets: 7 }])], tpl, [], NOW, 'muscle');
    expect(v.find((g) => g.group === 'chest')!.effective28).toBe(14);
  });
  it('names the short side of a pair', () => {
    const ws = [workout(3, [{ ...bench, sets: 7 }, { ...row, sets: 3 }]), workout(10, [{ ...bench, sets: 7 }, { ...row, sets: 3 }])];
    const p = buildGymPrompt({ state: initialGymState('p'), workouts: ws, templates: tpl, nowMs: NOW, summaries: [], complaints: [], previous: null, wantNote: false });
    expect(p).toContain('<muskelpaare-nur-daten>');
    expect(p).toContain('"zuKurz":"Rücken"');
    expect(p).toContain('"zustand"');
    expect(GYM_SYSTEM_PROMPT).toContain('muskelpaare');
    expect(GYM_SYSTEM_PROMPT).toContain('Steht in muskelpaare eine Seite unter zuKurz, plane sie in den nächsten Trainings bevorzugt ein; das ist ein Hinweis, keine Pflicht.');
  });
  it('resolves secondary muscles through the catalog and says so in words', () => {
    const catalog = [{ id: 'RW', title: 'Row', type: 'weight_reps', primaryMuscle: 'lats', equipment: 'cable', secondaryMuscles: ['biceps', 'rear_delts', 'abdominals'] }];
    const p = buildGymPrompt({ state: initialGymState('p'), workouts: [workout(2, [{ ...row, sets: 3 }])], templates: tpl, catalog, nowMs: NOW, summaries: [], complaints: [], previous: null, wantNote: false });
    expect(p).toMatch(/"gruppe":"Bizeps","saetze7Tage":1.5,.*?"hinweis":"vor allem mittrainiert"/);
    expect(p).not.toMatch(/"gruppe":"Bauch","saetze7Tage":1/);
  });
  it('gives null when balanced', () => {
    const ws = [workout(3, [{ ...bench, sets: 8 }, { ...row, sets: 8 }])];
    const p = buildGymPrompt({ state: initialGymState('p'), workouts: ws, templates: tpl, nowMs: NOW, summaries: [], complaints: [], previous: null, wantNote: false });
    expect(p).toContain('"paar":"Brust : Rücken","seiteA":8,"seiteB":8,"zuKurz":null');
  });
  it('gives every exercise its rep range and step in words, and the studio as one line', () => {
    const base = { state: initialGymState('p'), workouts: [workout(3, [{ ...bench, sets: 3 }])], templates: tpl, nowMs: NOW, summaries: [], complaints: [], previous: null, wantNote: false };
    const p = buildGymPrompt({ ...base, studio: 'Invented Gym' });
    expect(p).toContain('\nStudio: Invented Gym\n');
    expect(p).toMatch(/"wiederholungen":\{"min":6,"max":12\},"schritt":"in [\d,]+-kg-Stufen"/);
    expect(buildGymPrompt(base)).not.toContain('Studio:');
  });
});

describe('muscleChartOf', () => {
  const bp = { templateId: 'BP', title: 'Bench Press (Barbell)', sets: 4, warmups: 2 };
  it('zählt nur Arbeitssätze der Trainings im Zeitraum', () => {
    const ws = [workout(2, [bp]), workout(20, [{ ...bp, sets: 8 }]), workout(40, [{ ...bp, sets: 50 }])];
    const c = muscleChartOf(ws, templates, [], NOW - 28 * DAY, NOW, 'muscle', [])!;
    expect(c.axes.find((a) => a.group === 'chest')!.sets).toBe(12);
  });
  it('gibt kein Diagramm ohne Krafttraining im Zeitraum', () => {
    expect(muscleChartOf([workout(40, [bp])], templates, [], NOW - 28 * DAY, NOW, 'muscle', [])).toBeNull();
  });
});
