import { describe, expect, it } from 'vitest';
import { MAX_HEALTH_BODY, readHealth } from '../../src/shared/health';
import { RULES, SOURCES, policyRule } from '../../src/shared/training-policy';

const body = (over: Record<string, unknown> = {}) => ({
  type: 'health', atMs: 1, today: { level: 'normal', reasons: [] },
  findings: [{ rule: 'health.rhr-raised', text: 'Ein Satz.', tone: 'info' }],
  weeks: [{ week: '2026-10-26', rhr: 55, steps: 8000 }], days: [{ date: '2026-11-01', rhr: 55 }], ...over,
});

describe('readHealth', () => {
  it('keeps atMs and key of the coach text, and accepts the old body without them', () => {
    expect(readHealth(body({ coachText: { week: '2026-11-02', text: 'Ruhig.', atMs: 5, key: 'a:b' } }))!.coachText).toEqual({ week: '2026-11-02', text: 'Ruhig.', atMs: 5, key: 'a:b' });
    expect(readHealth(body({ coachText: { week: '2026-11-02', text: 'Ruhig.' } }))!.coachText).toEqual({ week: '2026-11-02', text: 'Ruhig.' });
  });
  it('reads a whole body and keeps the coach text', () => {
    const b = readHealth(body({ coachText: { week: '2026-11-02', text: 'Ruhig.' } }))!;
    expect(b.findings).toHaveLength(1);
    expect(b.coachText).toEqual({ week: '2026-11-02', text: 'Ruhig.' });
  });
  it('rejects a wrong type, a missing level and an oversized body', () => {
    expect(readHealth(body({ type: 'bike' }))).toBeNull();
    expect(readHealth(body({ today: { level: 'x', reasons: [] } }))).toBeNull();
    expect(readHealth(body({ weeks: Array.from({ length: 3000 }, () => ({ week: '2026-10-26', rhr: 55, hrv: 40 })) }))).toBeNull();
    expect(JSON.stringify(body()).length).toBeLessThan(MAX_HEALTH_BODY);
  });
  it('drops broken entries and implausible values', () => {
    const b = readHealth(body({ findings: [{ rule: 'x', text: 'ok', tone: 'rot' }, { rule: 'x', text: 'ok', tone: 'arzt' }], weeks: [{ week: 'nope' }, { week: '2026-10-26', rhr: 999, steps: 5 }], coachText: { week: '2026-11-02', text: 'x'.repeat(601) } }))!;
    expect(b.findings.map((f) => f.tone)).toEqual(['arzt']);
    expect(b.weeks).toEqual([{ week: '2026-10-26', steps: 5 }]);
    expect(b.coachText).toBeUndefined();
  });
});

describe('the health rules in the register', () => {
  const health = RULES.filter((r) => r.domain === 'health');
  it('has every rule of the evidence table, each with registered sources where it is a medical or guideline rule', () => {
    for (const id of ['rhr-raised', 'rhr-persist', 'rhr-high', 'rhr-longterm', 'vo2-trend', 'steps-band', 'activity-minutes', 'sleep', 'not-used']) expect(() => policyRule(`health.${id}`)).not.toThrow();
    const ids = new Set(SOURCES.map((s) => s.id));
    for (const r of health) {
      for (const s of r.sourceIds) expect(ids.has(s)).toBe(true);
      if (r.class === 'orientation') expect(r.sourceIds.length).toBeGreaterThan(0);
    }
  });
  it('keeps the old readiness thresholds', () => {
    expect(policyRule('health.rhr-raised').value).toBe(5);
    expect(policyRule('health.rhr-raised').values).toMatchObject({ days: 2, baselineDays: 28, minDays: 14 });
    expect(policyRule('health.sleep').value).toBe(5);
    expect(policyRule('health.load-spike')).toMatchObject({ value: 1.5, values: { windowDays: 3, minLoad: 100, baselineDays: 28 } });
  });
});
