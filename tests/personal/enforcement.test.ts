import { describe, expect, it } from 'vitest';
import type { StrengthWorkout } from '../../src/coach/hevy';
import type { ExerciseTemplate } from '../../src/shared/gym/types';
import { checkWorkout, reasonPhrase, type GymContext } from '../../src/coach/gym/guardrails';
import { ruleWorkout } from '../../src/coach/gym/rules';
import { buildGymPrompt } from '../../src/coach/gym/prompt';
import { initialGymState } from '../../src/coach/gym/state';
import { personalHint } from '../../src/coach/tracking/personal';
import { ChatCoach } from '../../src/coach/chat/chat-coach';
import { chatThread } from '../../src/shared/chat';
import { EXERCISES } from '../../src/shared/exercises';
import { deleteRule, excludedIds, personalKeyOf, goalRecord, moveRule, ruleRecord } from '../../src/shared/personal';
import type { RecordKind, TrackedRecord } from '../../src/shared/records';
import { weeklySetRange } from '../../src/shared/muscle-targets';
import { similarExercises } from '../../src/tracking/similar';
import { startFromPlan } from '../../src/tracking/session';
import { checkOps } from '../../src/tracking/workout-change';
import { statsView } from '../../src/tracking/stats-node';

const DAY = 86_400_000;
const NOW = Date.UTC(2026, 10, 2, 12);
const T = (id: string, equipment: string, primaryMuscle: string): ExerciseTemplate => ({ id, title: `Title ${id}`, type: 'weight_reps', primaryMuscle, equipment });
const TEMPLATES = [T('cp', 'machine', 'chest'), T('lp', 'machine', 'quadriceps'), T('lr', 'machine', 'lats')];
const wk = (daysAgo: number, id: string): StrengthWorkout => ({
  id: `w${daysAgo}${id}`, title: 'Day', startMs: NOW - daysAgo * DAY, durationS: 3600,
  exercises: [{ title: id, templateId: id, sets: 2, reps: 0, volumeKg: 0, workSets: [{ type: 'normal', weightKg: 40, reps: 8 }, { type: 'normal', weightKg: 40, reps: 8 }] }],
});
const WORKOUTS = ['cp', 'lp', 'lr'].flatMap((id) => [wk(14, id), wk(7, id)]);
const exclude = (id: string, ids: string[], state: 'active' | 'paused' = 'active'): TrackedRecord =>
  ruleRecord(id, { kind: 'exclude', text: 'ohne', sport: 'gym', exerciseIds: ids }, state, 'person', NOW);
const store = (seed: TrackedRecord[] = []) => {
  const recs = new Map<string, TrackedRecord>(seed.map((r) => [`${r.kind}:${r.id}`, r]));
  return { all: (_id: string, kind?: RecordKind) => [...recs.values()].filter((r) => !kind || r.kind === kind), put: (_id: string, r: TrackedRecord) => { recs.set(`${r.kind}:${r.id}`, r); return r; } };
};

describe('an excluded exercise never comes back', () => {
  const ctx: GymContext = { workouts: WORKOUTS, templates: TEMPLATES, nowMs: NOW, excluded: new Set(['cp']) };

  it('is left out of the rule workout', () => {
    const ids = ruleWorkout(ctx).workout.exercises.map((e) => e.templateId);
    expect(ids).toEqual(expect.arrayContaining(['lp', 'lr']));
    expect(ids).not.toContain('cp');
  });

  it('is left out of the prompt lists and named in one line', () => {
    const p = buildGymPrompt({ state: initialGymState('p'), workouts: WORKOUTS, templates: TEMPLATES, nowMs: NOW, summaries: [], complaints: [], previous: null, wantNote: false, excluded: new Set(['cp']) });
    const lists = p.slice(p.indexOf('<uebungen-nur-daten>'), p.indexOf('<muskelvolumen-nur-daten>'));
    expect(lists).not.toContain('"templateId":"cp"');
    expect(lists).toContain('"templateId":"lp"');
    expect(p).toContain('Ausgeschlossen (Regel der Person): Title cp');
  });

  it('is refused by checkWorkout with the phrase', () => {
    const raw = { name: 'T', exercises: [{ templateId: 'cp', title: 'x', restS: 90, supersetId: null, notes: '', sets: [{ type: 'normal', weightKg: 40, reps: 9 }] }] };
    const r = checkWorkout(raw, ctx);
    expect(r.ok).toBe(false);
    expect(reasonPhrase(r.ok ? '' : r.reason)).toBe('eine Übung, die du ausgeschlossen hast');
    expect(checkWorkout(raw, { ...ctx, excluded: new Set() }).ok).toBe(true);
  });

  it('is not suggested as a similar exercise', () => {
    const base = similarExercises({ title: 'Kniebeuge', exerciseId: 'pf-squat' }, EXERCISES);
    const gone = base[0]!.id;
    expect(similarExercises({ title: 'Kniebeuge', exerciseId: 'pf-squat' }, EXERCISES, new Set(), new Set([gone])).map((e) => e.id)).not.toContain(gone);
  });

  it('is dropped when a workout starts from a plan or routine, with a notice', () => {
    const set = { type: 'normal' as const, weightKg: null, reps: 8 };
    const plan = { name: 'P', exercises: [{ templateId: 'pf-squat', title: 'Kniebeuge', restS: 90, supersetId: null, notes: '', sets: [set] }, { templateId: 'pf-bench-press', title: 'Bankdrücken', restS: 90, supersetId: null, notes: '', sets: [set] }] };
    let lines: string[] = [];
    const w = startFromPlan(plan, [], NOW, 'w1', EXERCISES, undefined, undefined, { changes: [], workouts: [], excluded: new Set(['pf-squat']), onSkipped: (l) => { lines = l; } });
    expect(w.exercises.map((e) => e.exerciseId)).toEqual(['pf-bench-press']);
    expect(lines).toEqual(['Ohne Kniebeuge – deine Regel.']);
  });

  it('is also dropped when the plan carries a Hevy template id or only a title of the excluded exercise', () => {
    const set = { type: 'normal' as const, weightKg: null, reps: 8 };
    const ex = (templateId: string, title: string) => ({ templateId, title, restS: 90, supersetId: null, notes: '', sets: [set] });
    const own = EXERCISES.find((e) => e.id === 'pf-squat')!;
    const plan = { name: 'P', exercises: [ex('hevy-123', own.title), ex('hevy-999', 'Etwas ganz anderes')] };
    const w = startFromPlan(plan, [], NOW, 'w1', EXERCISES, undefined, undefined, { changes: [], workouts: [], excluded: new Set(['pf-squat']) });
    expect(w.exercises.map((e) => e.exerciseId)).toEqual(['hevy-999']);
  });

  it('refuses a swap into it in the workout chat with "Das geht nicht, weil"', () => {
    const swap = { workoutId: 'w1', ops: [{ op: 'swap' as const, ex: 'r1', to: 'pf-goblet-squat' }] };
    const w = { id: 'w1', title: 'T', startMs: NOW, endMs: null, source: 'pandafit', rest: null, exercises: [{ rid: 'r1', exerciseId: 'pf-squat', title: 'Kniebeuge', supersetId: null, notes: '', sets: [{ rid: 's', type: 'normal', weightKg: null, reps: 8, durationS: null, doneMs: null }] }] };
    const r = checkOps(swap, w as never, EXERCISES, new Set(['pf-goblet-squat']));
    expect(r.ops).toEqual([]);
    expect(r.reasons[0]).toMatch(/ausgeschlossen hast$/);
    expect(checkOps(swap, w as never, EXERCISES).ops).toHaveLength(1);
  });

  it('refuses a next-change swap in the chat message', async () => {
    const s = store([{ kind: 'chat', id: 'r1', updatedMs: NOW - 1000, deleted: false, body: { role: 'rider', text: 'tausch', atMs: NOW - 1000 } }, exclude('rule-x', ['pf-goblet-squat'])]);
    const c = new ChatCoach({ store: s as never, nowMs: () => NOW, newId: () => 'c1', ask: (async () => ({ text: 'Okay.', nextChange: { ops: [{ op: 'swap', exerciseId: 'pf-squat', toId: 'pf-goblet-squat' }], reason: 'Wunsch' } })) as never });
    await c.tick('p');
    const m = chatThread([...s.all('p').map((r) => r)]).find((x) => x.role === 'coach')!;
    expect(m.text).toMatch(/Das geht nicht, weil du .* ausgeschlossen hast\./);
    expect(m.nextChange).toBeUndefined();
  });

  it('has no effect while paused or after delete', () => {
    const active = exclude('rule-a', ['cp']);
    expect([...excludedIds([active], [])]).toEqual(['cp']);
    const paused = moveRule(active, 'paused', NOW + 1)!;
    expect(excludedIds([paused], []).size).toBe(0);
    expect(excludedIds([deleteRule(active, NOW + 1)], []).size).toBe(0);
  });
});

describe('goals steer the planners', () => {
  it("'strength' gives the ranges weeklySetRange defines for non-muscle goals", () => {
    const strength = goalRecord({ strength: 'strength', focus: [], sports: {} }, NOW);
    const v = statsView(null, [], NOW, undefined, 'strength');
    expect(v.targets.chest).toEqual(weeklySetRange('chest', 'strength'));
    expect(v.targets.chest).not.toEqual(statsView(null, [], NOW, undefined, 'muscle').targets.chest);
    const p = buildGymPrompt({ state: initialGymState('p'), workouts: WORKOUTS, templates: TEMPLATES, nowMs: NOW, summaries: [], complaints: [], previous: null, wantNote: false, goal: { strength: 'strength', focus: ['chest'], sports: { run: 'focus' } } });
    expect(p).toContain('Ziel der Person: Kraft.');
    expect(p).toContain('Schwerpunkt: Brust.');
    expect(p).toContain('Laufen Schwerpunkt');
    expect(strength.kind).toBe('goal');
  });
});

describe('wishes reach the prompts of their sport', () => {
  const wish = (id: string, sport: 'gym' | 'bike' | 'run', text: string, state: 'active' | 'paused' = 'active') => ruleRecord(id, { kind: 'wish', text, sport }, state, 'person', NOW);
  const records = [wish('rule-g', 'gym', 'gern kurze Pausen'), wish('rule-b', 'bike', 'keine Intervalle am Sonntag'), wish('rule-r', 'run', 'lieber im Wald'), wish('rule-p', 'run', 'pausiert', 'paused'), goalRecord({ strength: 'muscle', focus: [], sports: { bike: 'keep' } }, NOW)];

  it('bike and run hints carry their wishes and the priority line only', () => {
    const s = store(records);
    expect(personalHint(s, 'p', 'bike', '2026-11-04')).toContain('keine Intervalle am Sonntag');
    expect(personalHint(s, 'p', 'bike', '2026-11-04')).toContain('Rad erhalten');
    expect(personalHint(s, 'p', 'bike', '2026-11-04')).not.toContain('Wald');
    expect(personalHint(s, 'p', 'run', '2026-11-04')).toContain('lieber im Wald');
    expect(personalHint(s, 'p', 'run', '2026-11-04')).not.toContain('pausiert');
    expect(personalHint(store(), 'p', 'run', '2026-11-04')).toBe('');
  });

  it('gym prompt and chat prompt carry them', async () => {
    const p = buildGymPrompt({ state: initialGymState('p'), workouts: WORKOUTS, templates: TEMPLATES, nowMs: NOW, summaries: [], complaints: [], previous: null, wantNote: false, wishes: ['gern kurze Pausen'] });
    expect(p).toContain('Wünsche der Person (nicht prüfbar): gern kurze Pausen');
    const s = store([{ kind: 'chat', id: 'r1', updatedMs: NOW - 1000, deleted: false, body: { role: 'rider', text: 'hi', atMs: NOW - 1000 } }, ...records]);
    let prompt = '';
    await new ChatCoach({ store: s as never, nowMs: () => NOW, newId: () => 'c1', ask: (async (i: { prompt: string }) => { prompt = i.prompt; return { text: 'ok' }; }) as never }).tick('p');
    expect(prompt).toContain('Wünsche der Person (nicht prüfbar): gern kurze Pausen; keine Intervalle am Sonntag; lieber im Wald');
  });
});

describe('replan key and exact-title exclusion', () => {
  it('a proposed or declined rule leaves the key unchanged, activating changes it', () => {
    const rec = (state: 'proposed' | 'declined' | 'active') => ruleRecord('r1', { kind: 'exclude', text: 'ohne', sport: 'gym', exerciseIds: ['cp'] }, state, 'chat', NOW);
    const base = personalKeyOf([], []);
    expect(personalKeyOf([rec('proposed')], [])).toBe(base);
    expect(personalKeyOf([rec('declined')], [])).toBe(base);
    expect(personalKeyOf([rec('active')], [])).not.toBe(base);
    const frame = { kind: 'frame' as const, id: 'frame', updatedMs: 5, deleted: false, body: {} };
    expect(personalKeyOf([], [], [frame])).not.toBe(base);
    expect(personalKeyOf([], [], [{ ...frame, updatedMs: 6 }])).not.toBe(personalKeyOf([], [], [frame]));
  });

  it('a changed hardness in the goal changes the key, so the coaches plan again', () => {
    const before = goalRecord({ strength: 'muscle', focus: [], sports: {} }, NOW);
    const after = goalRecord({ strength: 'muscle', focus: [], sports: {}, push: 'hard' }, NOW + 1000, before);
    expect(personalKeyOf([], [after])).not.toBe(personalKeyOf([], [before]));
  });

  it('an unlinked Hevy template with the exact title of an excluded exercise is rejected and filtered', () => {
    const own = EXERCISES[0]!;
    const hevy: ExerciseTemplate = { id: 'hevy-unlinked', title: ` ${own.title.toUpperCase()} `, type: 'weight_reps', primaryMuscle: 'chest', equipment: 'machine' };
    const ctx: GymContext = { workouts: [], templates: [hevy, ...TEMPLATES], nowMs: NOW, excluded: new Set([own.id]), catalog: EXERCISES };
    const ex = { templateId: hevy.id, title: hevy.title, restS: 90, supersetId: null, notes: '', sets: [{ type: 'normal' as const, weightKg: 20, reps: 10 }] };
    expect(checkWorkout({ name: 'x', exercises: [ex] }, ctx).ok).toBe(false);
    expect(ruleWorkout(ctx).workout.exercises.map((e) => e.templateId)).not.toContain(hevy.id);
  });
});

describe('taken changes in the personal key', () => {
  const change = (state: 'taken' | 'proposed' | 'used' | 'undone') => ({ kind: 'change' as const, id: 'chg-m1', updatedMs: 5, deleted: false,
    body: { target: 'next', ops: [{ op: 'drop', exerciseId: 'pf-squat' }], reason: 'x', state, atMs: 1 } });
  it('a taken change changes the key at once; proposed does not; using it is one more change', () => {
    const base = personalKeyOf([], [], [], '2026-11-07', []);
    expect(personalKeyOf([], [], [], '2026-11-07', [change('proposed')])).toBe(base);
    const taken = personalKeyOf([], [], [], '2026-11-07', [change('taken')]);
    expect(taken).not.toBe(base);
    expect(personalKeyOf([], [], [], '2026-11-07', [change('used')])).toBe(base);
    expect(personalKeyOf([], [], [], '2026-11-07', [change('undone')])).toBe(base);
  });
});
