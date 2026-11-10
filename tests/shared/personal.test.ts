import { describe, expect, it } from 'vitest';
import { applyRecord, RECORD_KINDS, RECORD_KINDS_SIGNATURE, type TrackedRecord } from '../../src/shared/records';
import { validBody } from '../../src/web/validate';
import { activeRules, applyGoalPatch, effectivePush, PUSH_LABEL, deleteRule, excludedIds, goalOf, goalRecord, migratedRuleId, moveRule, readGoal, readRule, ruleRecord, storedGoalOf, wishes } from '../../src/shared/personal';
const TODAY = '2026-11-04';

const rule = (id: string, kind: 'exclude' | 'wish', state: 'proposed' | 'active' | 'paused' | 'declined', over: { sport?: 'gym' | 'bike' | 'run' | 'all'; ids?: string[]; at?: number } = {}): TrackedRecord =>
  ruleRecord(id, { kind, text: `text ${id}`, sport: over.sport ?? 'gym', ...(kind === 'exclude' ? { exerciseIds: over.ids ?? ['ex-a'] } : {}) }, state, 'person', over.at ?? 10);

describe('goal', () => {
  it('without a record it is today: muscle, no focus, no priorities', () => {
    expect(goalOf([], TODAY)).toEqual({ strength: 'muscle', focus: [], sports: {} });
    expect(goalOf([{ kind: 'goal', id: 'goal', updatedMs: 1, deleted: false, body: { nonsense: true } }], TODAY)).toEqual({ strength: 'muscle', focus: [], sports: {} });
  });
  it('reads the written goal, ignores a deleted one', () => {
    const g = goalRecord({ strength: 'strength', focus: ['chest', 'back'], sports: { bike: 'keep' } }, 5);
    expect(goalOf([g], TODAY)).toEqual({ strength: 'strength', focus: ['chest', 'back'], sports: { bike: 'keep' } });
    expect(goalOf([{ ...g, deleted: true }], TODAY).strength).toBe('muscle');
  });
  it('validates: at most three focus muscles, known values only', () => {
    const ok = { strength: 'fitness', focus: [], sports: { gym: 'equal' }, atMs: 1 };
    expect(readGoal(ok)).not.toBeNull();
    expect(readGoal({ ...ok, focus: ['chest', 'back', 'biceps', 'abs'] })).toBeNull();
    expect(readGoal({ ...ok, focus: ['other'] })).toBeNull();
    expect(readGoal({ ...ok, strength: 'x' })).toBeNull();
    expect(readGoal({ ...ok, sports: { swim: 'focus' } })).toBeNull();
    expect(validBody('goal', ok)).toBe(true);
    expect(validBody('goal', { ...ok, sports: { gym: 'max' } })).toBe(false);
  });
});

describe('rule records', () => {
  it('are known kinds and validated', () => {
    expect(RECORD_KINDS).toContain('rule');
    expect(RECORD_KINDS).toContain('goal');
    expect(RECORD_KINDS_SIGNATURE).toContain('rule');
    const r = rule('x', 'exclude', 'proposed');
    expect(validBody('rule', r.body)).toBe(true);
    expect(readRule('x', { ...(r.body as object), exerciseIds: [] })).toBeNull();
    expect(readRule('x', { ...(r.body as object), exerciseIds: Array.from({ length: 31 }, (_, i) => `e${i}`) })).toBeNull();
    expect(readRule('x', { ...(r.body as object), text: 'a'.repeat(121) })).toBeNull();
    expect(readRule('x', { ...(r.body as object), state: 'taken' })).toBeNull();
    expect(readRule('x', { ...(r.body as object), sport: 'swim' })).toBeNull();
    expect(validBody('rule', rule('w', 'wish', 'active').body)).toBe(true);
    expect(validBody('rule', { kind: 'goal', text: 'x', sport: 'all', goal: { strength: 'strength' }, state: 'proposed', source: 'chat', atMs: 1 })).toBe(true);
    expect(validBody('rule', { kind: 'goal', text: 'x', sport: 'all', state: 'proposed', source: 'chat', atMs: 1 })).toBe(false);
  });

  it('state moves: proposed to active or declined, active and paused toggle, declined is final', () => {
    const p = rule('x', 'wish', 'proposed');
    expect(moveRule(p, 'paused', 20)).toBeNull();
    const a = moveRule(p, 'active', 20)!;
    expect((a.body as { state: string }).state).toBe('active');
    expect(moveRule(a, 'declined', 30)).toBeNull();
    const z = moveRule(a, 'paused', 30)!;
    expect(moveRule(z, 'active', 40)).not.toBeNull();
    const d = moveRule(p, 'declined', 20)!;
    expect(moveRule(d, 'active', 30)).toBeNull();
    expect(moveRule(deleteRule(a, 30), 'paused', 40)).toBeNull();
  });

  it('a tombstone wins in both orders; declined beats active and proposed; the stamp decides active against paused', () => {
    const base = rule('x', 'wish', 'active', { at: 10 });
    const tomb = deleteRule(base, 20);
    const later = { ...moveRule(base, 'paused', 50)!, updatedMs: 99 };
    expect(applyRecord(later, tomb).keep.deleted).toBe(true);
    expect(applyRecord(tomb, later).keep.deleted).toBe(true);
    const proposed = rule('y', 'wish', 'proposed');
    const declined = { ...moveRule(proposed, 'declined', 5)!, updatedMs: 1 };
    const active = { ...moveRule(proposed, 'active', 5)!, updatedMs: 100 };
    expect(applyRecord(active, declined).keep).toBe(declined);
    expect(applyRecord(declined, active).keep).toBe(declined);
    const paused = { ...moveRule(base, 'paused', 30)!, updatedMs: 30 };
    expect(applyRecord(base, paused).keep).toBe(paused);
    expect(applyRecord(paused, base).keep).toBe(paused);
    const resumed = { ...moveRule(paused, 'active', 40)!, updatedMs: 40 };
    expect(applyRecord(paused, resumed).keep).toBe(resumed);
    expect(applyRecord(resumed, paused).keep).toBe(resumed);
    expect(applyRecord(rule('y', 'wish', 'proposed'), active).keep).toBe(active);
  });
});

describe('helpers', () => {
  const records = [
    rule('a', 'exclude', 'active', { ids: ['e1', 'e2'], at: 1 }),
    rule('b', 'exclude', 'paused', { ids: ['e3'], at: 2 }),
    rule('c', 'exclude', 'proposed', { ids: ['e4'], at: 3 }),
    rule('d', 'exclude', 'declined', { ids: ['e5'], at: 4 }),
    { ...rule('e', 'exclude', 'active', { ids: ['e6'] }), deleted: true },
    rule('f', 'exclude', 'active', { ids: ['e2', 'e7'], sport: 'run', at: 6 }),
    rule('g', 'wish', 'active', { sport: 'gym', at: 7 }),
    rule('h', 'wish', 'active', { sport: 'all', at: 8 }),
    rule('i', 'wish', 'active', { sport: 'bike', at: 9 }),
    rule('j', 'wish', 'paused', { sport: 'gym', at: 10 }),
  ];
  it('excludedIds covers only active exclude rules', () => {
    expect([...excludedIds(records, [])].sort()).toEqual(['e1', 'e2', 'e7']);
    expect(excludedIds([], [])).toEqual(new Set());
  });
  it('activeRules and wishes follow the sport; "all" counts everywhere', () => {
    expect(wishes(records, 'gym')).toEqual(['text g', 'text h']);
    expect(wishes(records, 'bike')).toEqual(['text h', 'text i']);
    expect(wishes(records, 'run')).toEqual(['text h']);
    expect(activeRules(records, 'gym', 0).map((r) => r.id)).toEqual(['a', 'g', 'h']);
  });
  it('migrated ids are deterministic', () => {
    expect(migratedRuleId('gym', 'abc')).toBe(migratedRuleId('gym', 'abc'));
    expect(migratedRuleId('gym', 'abc')).not.toBe(migratedRuleId('bike', 'abc'));
  });
});

describe('push (Härte) in the goal', () => {
  const base = { strength: 'muscle', focus: [], sports: {}, atMs: 5 };
  it('reads a valid push, rejects an unknown one, and reads a goal without it', () => {
    expect(readGoal({ ...base, push: 'hard' })?.push).toBe('hard');
    expect(readGoal({ ...base, push: 'x' })).toBeNull();
    const g = readGoal(base);
    expect(g).not.toBeNull();
    expect(g?.push).toBeUndefined();
  });
  it('a goal patch can set push, and a goal rule draft keeps it', () => {
    expect(applyGoalPatch({ strength: 'muscle', focus: [], sports: {} }, { push: 'gentle' }, TODAY).push).toBe('gentle');
    expect(readRule('rule-a', { kind: 'goal', text: 't', sport: 'all', goal: { push: 'hard' }, state: 'proposed', source: 'chat', atMs: 1 })?.goal).toEqual({ push: 'hard' });
    expect(readRule('rule-a', { kind: 'goal', text: 't', sport: 'all', goal: { push: 'x' }, state: 'proposed', source: 'chat', atMs: 1 })).toBeNull();
  });
  it('the stored goal passes push on when set', () => {
    const rec = goalRecord({ strength: 'muscle', focus: [], sports: {}, push: 'hard' }, 5);
    expect(storedGoalOf([rec]).push).toBe('hard');
    expect('push' in storedGoalOf([goalRecord({ strength: 'muscle', focus: [], sports: {} }, 5)])).toBe(false);
  });
  it('a complaint that is active or healing makes it gentle', () => {
    expect(effectivePush({ push: 'hard' }, [{ status: 'healing' }])).toBe('gentle');
    expect(effectivePush({ push: 'hard' }, [{ status: 'active' }])).toBe('gentle');
    expect(effectivePush({}, [])).toBe('normal');
    expect(effectivePush({ push: 'hard' }, [{ status: 'over' }])).toBe('hard');
  });
  it('has labels', () => {
    expect(PUSH_LABEL).toEqual({ gentle: 'Vorsichtig', normal: 'Normal', hard: 'Fordere mich' });
  });
});
