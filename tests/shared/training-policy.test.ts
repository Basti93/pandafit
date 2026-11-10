import { POLICY_VERSION, RULES, SCENARIOS, SOURCES, policyRule, ruleNumber, ruleRange } from '../../src/shared/training-policy';

describe('training policy register', () => {
  it('has a version and unique ids', () => {
    expect(POLICY_VERSION).toBe('2026-11-10.2');
    for (const list of [SOURCES, RULES, SCENARIOS]) expect(new Set(list.map((x) => x.id)).size).toBe(list.length);
  });

  it('registers the 26 sources of the foundation and the health sources with population, endpoint and limits', () => {
    expect(SOURCES.map((s) => s.id)).toEqual(Array.from({ length: 38 }, (_, i) => `S${String(i + 1).padStart(2, '0')}`));
    for (const s of SOURCES) for (const k of ['citation', 'url', 'population', 'endpoint', 'limits'] as const) expect(s[k].length).toBeGreaterThan(0);
  });

  it('only cites registered sources, and every orientation rule cites one', () => {
    const ids = new Set(SOURCES.map((s) => s.id));
    for (const r of RULES) {
      for (const s of r.sourceIds) expect(ids.has(s)).toBe(true);
      if (r.class === 'orientation') expect(r.sourceIds.length).toBeGreaterThan(0);
    }
  });

  it('gives every rule that will change a follow-up task between 1 and 12', () => {
    for (const r of RULES) {
      if (r.status.state === 'active') continue;
      expect(r.status.task).toBeGreaterThanOrEqual(1);
      expect(r.status.task).toBeLessThanOrEqual(12);
    }
  });

  it('assigns every scenario to a task and only links known scenarios', () => {
    const ids = new Set(SCENARIOS.map((s) => s.id));
    for (const s of SCENARIOS) expect(s.task).toBeGreaterThanOrEqual(1);
    for (const r of RULES) for (const s of r.scenarioIds) expect(ids.has(s)).toBe(true);
  });

  it('replaced the global gym range and step rules by per-exercise ones', () => {
    for (const id of ['gym.rep-range', 'gym.min-step-kg', 'gym.max-step-pct', 'gym.effort-step-back-count']) expect(() => policyRule(id)).toThrow();
    expect(ruleNumber('gym.drop-step-back-count')).toBe(2);
    expect(policyRule('gym.step-back-share').status).toEqual({ state: 'active' });
  });

  it('fixes the proposed start values as planned, not active', () => {
    expect(ruleRange('hypertrophy.isolation-reps')).toEqual({ min: 10, max: 20 });
    expect(policyRule('hypertrophy.isolation-reps').status).toMatchObject({ state: 'planned' });
  });

  it('activates the muscle weights and keeps one target rule per group', () => {
    expect(ruleNumber('muscle.direct-weight')).toBe(1);
    expect(ruleNumber('muscle.indirect-weight')).toBe(0.5);
    for (const id of ['muscle.direct-weight', 'muscle.indirect-weight']) expect(policyRule(id).status).toEqual({ state: 'active' });
    for (const g of ['chest', 'back', 'front_delts', 'side_delts', 'rear_delts', 'biceps', 'triceps', 'quads', 'hamstrings', 'glutes', 'calves', 'abs', 'traps', 'forearms'])
      expect(policyRule(`muscle.target.${g}`)).toMatchObject({ domain: 'muscle', class: 'product', status: { state: 'active' } });
    expect(policyRule('muscle.target.glutes')).toMatchObject({ value: { min: 6, max: 12 }, ranges: { other: { min: 0, max: 4 }, reps: { min: 8, max: 15 } } });
  });

  it('throws on unknown ids and on the wrong value shape', () => {
    expect(() => policyRule('nope')).toThrow('unknown policy rule: nope');
    expect(() => ruleNumber('muscle.target.chest')).toThrow();
    expect(() => ruleRange('gym.max-sets')).toThrow();
  });
});
