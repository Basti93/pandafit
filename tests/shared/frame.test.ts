import { describe, expect, it } from 'vitest';
import { frameOf, frameRecord, readFrame } from '../../src/shared/frame';
import { RECORD_KINDS, type TrackedRecord } from '../../src/shared/records';
import { validBody } from '../../src/web/validate';
import { gymBudgetOf, gymLegsKeyOf, gymPlanDateOf, gymPlanDayNoLegs } from '../../src/coach/tracking/frame';
import { buildGymPrompt } from '../../src/coach/gym/prompt';
import { initialGymState } from '../../src/coach/gym/state';
import { gymMinutes } from '../../src/shared/duration';

describe('frame', () => {
  it('without a record: week mode, no time', () => {
    expect(frameOf([], '2026-11-09')).toEqual({ mode: 'week', minutes: null, effectiveMinutes: null });
    expect(frameOf([{ kind: 'frame', id: 'frame', updatedMs: 1, deleted: false, body: { nonsense: 1 } }], '2026-11-09').mode).toBe('week');
  });
  it('is a known, validated kind with the allowed minutes only', () => {
    expect(RECORD_KINDS).toContain('frame');
    const ok = { mode: 'spontaneous', minutes: 45, atMs: 1 };
    expect(validBody('frame', ok)).toBe(true);
    expect(validBody('frame', { ...ok, minutes: null })).toBe(true);
    expect(validBody('frame', { ...ok, minutes: 50 })).toBe(true);
    expect(validBody('frame', { ...ok, minutes: 4 })).toBe(false);
    expect(validBody('frame', { ...ok, minutes: 241 })).toBe(false);
    expect(validBody('frame', { ...ok, minutes: 30.5 })).toBe(false);
    expect(validBody('frame', { ...ok, mode: 'x' })).toBe(false);
    expect(readFrame({ ...ok, today: { date: '2026-11-09', minutes: 30 } })?.today).toEqual({ date: '2026-11-09', minutes: 30 });
    expect(readFrame({ ...ok, today: { date: 'heute', minutes: 30 } })).toBeNull();
    expect(readFrame({ ...ok, today: { date: '2026-11-09', minutes: 33 } })?.today?.minutes).toBe(33);
    expect(readFrame({ ...ok, today: { date: '2026-11-09', minutes: 300 } })).toBeNull();
  });
  it('today only counts on its date', () => {
    const rec = frameRecord({ mode: 'week', minutes: 60, today: { date: '2026-11-09', minutes: 30 } }, 5);
    expect(frameOf([rec], '2026-11-09')).toMatchObject({ minutes: 60, effectiveMinutes: 30 });
    expect(frameOf([rec], '2026-11-10').effectiveMinutes).toBe(60);
    expect(frameOf([{ ...rec, deleted: true }], '2026-11-09').effectiveMinutes).toBeNull();
  });
});

describe('gymMinutes', () => {
  const ex = (n: number, restS: number | null = 90) => ({ restS, sets: Array.from({ length: n }, () => ({})) });
  it('adds warm-up, sets with rest and exercise changes, rounded to 5', () => {
    // 8 min + 9 sets x (40 + 90) s + 2 changes x 60 s = 29.5 min -> 30
    expect(gymMinutes({ exercises: [ex(3), ex(3), ex(3)] })).toBe(30);
    expect(gymMinutes({ exercises: [ex(4, 60)] })).toBe(15);
    expect(gymMinutes({ exercises: [] })).toBe(0);
  });
});

describe('gym time budget', () => {
  const store = (records: TrackedRecord[]) => ({ all: (_id: string, kind?: string) => records.filter((r) => !kind || r.kind === kind) });
  const plan = { kind: 'weekplan' as const, id: '2026-11-09', updatedMs: 1, deleted: false, body: { weekStart: '2026-11-09', days: ['2026-11-09', '2026-11-10', '2026-11-11', '2026-11-12', '2026-11-13', '2026-11-14', '2026-11-15'].map((date, i) => ({ date, sport: i === 2 ? 'gym' : 'rest', hardness: 'easy', fixed: false })), fromMessage: 'm', acceptedMs: 1 } };
  it('is the usual time, or the one for today when the workout is planned for today', () => {
    const f = (today?: { date: string; minutes: number }) => frameRecord({ mode: 'week', minutes: 60, ...(today ? { today } : {}) }, 5);
    expect(gymBudgetOf(store([]), 'p', '2026-11-09')).toBeNull();
    expect(gymBudgetOf(store([f()]), 'p', '2026-11-09')).toBe(60);
    // no plan: planned for today
    expect(gymBudgetOf(store([f({ date: '2026-11-09', minutes: 30 })]), 'p', '2026-11-09')).toBe(30);
    // the gym day is Wednesday: the override for Monday does not count
    expect(gymBudgetOf(store([plan, f({ date: '2026-11-09', minutes: 30 })]), 'p', '2026-11-09')).toBe(60);
    expect(gymBudgetOf(store([plan, f({ date: '2026-11-11', minutes: 20 })]), 'p', '2026-11-09')).toBe(20);
  });
  it('spontaneous mode plans for today, whatever the week plan says', () => {
    const f = (today?: { date: string; minutes: number }) => frameRecord({ mode: 'spontaneous', minutes: 60, ...(today ? { today } : {}) }, 5);
    expect(gymBudgetOf(store([plan, f({ date: '2026-11-11', minutes: 20 })]), 'p', '2026-11-09')).toBe(60);
    expect(gymBudgetOf(store([plan, f({ date: '2026-11-09', minutes: 30 })]), 'p', '2026-11-09')).toBe(30);
  });
  it('skips a gym day that already has a finished workout', () => {
    const body = (endMs: number | null) => ({ id: 'w', title: 't', startMs: new Date(2026, 10, 11, 8).getTime(), endMs, source: 'pandafit', exercises: [] });
    const w = (endMs: number | null): TrackedRecord => ({ kind: 'workout', id: 'w', updatedMs: 1, deleted: false, body: body(endMs) });
    const f = frameRecord({ mode: 'week', minutes: 60, today: { date: '2026-11-11', minutes: 20 } }, 5);
    // finished: that day is done, so the usual time counts (no later gym day: today)
    expect(gymBudgetOf(store([plan, f, w(new Date(2026, 10, 11, 9).getTime())]), 'p', '2026-11-09')).toBe(60);
    // still open: the day stays
    expect(gymBudgetOf(store([plan, f, w(null)]), 'p', '2026-11-09')).toBe(20);
  });
  it('is one line in the prompt', () => {
    const p = buildGymPrompt({ state: initialGymState('p'), workouts: [], templates: [], nowMs: 1, summaries: [], complaints: [], previous: null, wantNote: false, budgetMinutes: 30 });
    expect(p).toContain('Zeit: höchstens 30 Min einschließlich Aufwärmen und Pausen.');
    expect(p).not.toContain('Heute keine Beinübungen.');
    expect(buildGymPrompt({ state: initialGymState('p'), workouts: [], templates: [], nowMs: 1, summaries: [], complaints: [], previous: null, wantNote: false, avoidLegs: true })).toContain('Heute keine Beinübungen.');
  });
});

describe('the day the gym coach plans for', () => {
  const store = (records: TrackedRecord[]) => ({ all: (_id: string, kind?: string) => records.filter((r) => !kind || r.kind === kind) });
  const dates = ['2026-11-09', '2026-11-10', '2026-11-11', '2026-11-12', '2026-11-13', '2026-11-14', '2026-11-15'];
  // Tuesday 11-10 and Thursday 11-12 are gym days
  const plan = (legsThu?: boolean): TrackedRecord => ({ kind: 'weekplan', id: '2026-11-09', updatedMs: 1, deleted: false, body: { weekStart: '2026-11-09', fromMessage: 'm', acceptedMs: 1,
    days: dates.map((date, i) => ({ date, sport: i === 3 ? 'gym' : 'rest', hardness: 'easy', fixed: false, ...(i === 3 && legsThu !== undefined ? { legs: legsThu } : {}) })) } });
  it('is the next gym day, today in spontaneous mode', () => {
    expect(gymPlanDateOf(store([plan()]), 'p', '2026-11-10')).toBe('2026-11-12');
    expect(gymPlanDateOf(store([]), 'p', '2026-11-10')).toBe('2026-11-10');
    expect(gymPlanDateOf(store([plan(), frameRecord({ mode: 'spontaneous', minutes: 60 }, 5)]), 'p', '2026-11-10')).toBe('2026-11-10');
  });
  it('skips a gym day with a finished workout', () => {
    const rec = plan();
    (rec.body as { days: { sport: string }[] }).days[1]!.sport = 'gym';
    const w: TrackedRecord = { kind: 'workout', id: 'w', updatedMs: 1, deleted: false, body: { id: 'w', title: 't', startMs: new Date(2026, 10, 10, 8).getTime(), endMs: new Date(2026, 10, 10, 9).getTime(), source: 'pandafit', exercises: [] } };
    expect(gymPlanDateOf(store([rec]), 'p', '2026-11-10')).toBe('2026-11-10');
    expect(gymPlanDateOf(store([rec, w]), 'p', '2026-11-10')).toBe('2026-11-12');
  });
  it('no legs on Thursday holds on Tuesday; without the agreement it does not', () => {
    expect(gymPlanDayNoLegs(store([plan(false)]), 'p', '2026-11-10')).toBe(true);
    expect(gymPlanDayNoLegs(store([plan()]), 'p', '2026-11-10')).toBe(false);
    expect(gymPlanDayNoLegs(store([plan(true)]), 'p', '2026-11-10')).toBe(false);
  });
  it('the key changes with the legs value of the target day', () => {
    const a = gymLegsKeyOf(store([plan()]), 'p', '2026-11-10');
    expect(gymLegsKeyOf(store([plan(false)]), 'p', '2026-11-10')).not.toBe(a);
    expect(gymLegsKeyOf(store([plan()]), 'p', '2026-11-10')).toBe(a);
  });
});
