import { describe, expect, test } from 'vitest';
import { BAR_LABEL, barKgFor, barTypeOf, barUseRecord, barWeightRecord, readBar, readBars } from '../../src/shared/bars';
import { RECORD_KINDS } from '../../src/shared/records';
import { validBody } from '../../src/web/validate';
import { policyRule, ruleNumber } from '../../src/shared/training-policy';

const none = readBars([]);

describe('bars', () => {
  test('defaults: 20 kg barbell, 10 kg EZ bar; the catalog picks the EZ bar for the preacher curl and the skullcrusher', () => {
    expect(barKgFor('pf-squat', 'barbell', 'A', none)).toBe(20);
    expect(barTypeOf('pf-preacher-curl', none)).toBe('sz');
    expect(barKgFor('pf-preacher-curl', 'barbell', 'A', none)).toBe(10);
    expect(barKgFor('pf-skullcrusher', 'barbell', '', none)).toBe(10);
    expect(BAR_LABEL).toEqual({ langhantel: 'Langhantel', sz: 'SZ-Stange' });
  });
  test('the rule is a product rule of 10 kg', () => {
    expect(ruleNumber('load.sz-bar-kg')).toBe(10);
    expect(policyRule('load.sz-bar-kg')).toMatchObject({ class: 'product', status: { state: 'active' } });
  });
  test('a weight of 8.5 counts in its studio only', () => {
    const bars = readBars([barWeightRecord('sz', 'Gym A', 8.5, 1)]);
    expect(barKgFor('pf-preacher-curl', 'barbell', 'Gym A', bars)).toBe(8.5);
    expect(barKgFor('pf-preacher-curl', 'barbell', 'Gym B', bars)).toBe(10);
    expect(barKgFor('pf-squat', 'barbell', 'Gym A', bars)).toBe(20);
  });
  test('a studio rename keeps the weight', () => {
    const bars = readBars([barWeightRecord('sz', 'Old', 8.5, 1)], new Map([['old', 'New']]));
    expect(barKgFor('pf-preacher-curl', 'barbell', 'New', bars)).toBe(8.5);
  });
  test('the newer record wins, a tombstone counts for nothing', () => {
    const bars = readBars([barWeightRecord('sz', 'A', 9, 2), barWeightRecord('sz', 'A', 8, 1), { ...barWeightRecord('langhantel', 'A', 15, 3), deleted: true }]);
    expect(barKgFor('pf-preacher-curl', 'barbell', 'A', bars)).toBe(9);
    expect(barKgFor('pf-squat', 'barbell', 'A', bars)).toBe(20);
  });
  test('the person changes the type of an exercise, for every studio', () => {
    const bars = readBars([barUseRecord('pf-squat', 'sz', 1), barUseRecord('pf-preacher-curl', 'langhantel', 1)]);
    expect(barTypeOf('pf-squat', bars)).toBe('sz');
    expect(barKgFor('pf-squat', 'barbell', 'A', bars)).toBe(10);
    expect(barKgFor('pf-preacher-curl', 'barbell', 'A', bars)).toBe(20);
  });
  test('invalid weights and types are dropped', () => {
    for (const kg of [0, -5, 0.5, 41, Number.NaN, Infinity, '8' as unknown as number])
      expect(readBar({ what: 'weight', type: 'sz', studio: '', kg })).toBeNull();
    expect(readBar({ what: 'weight', type: 'trap', studio: '', kg: 20 })).toBeNull();
    expect(readBar({ what: 'use', exerciseId: '', type: 'sz' })).toBeNull();
    expect(readBar({ what: 'use', exerciseId: 'x', type: 'trap' })).toBeNull();
    expect(readBar(null)).toBeNull();
    const bad = { ...barWeightRecord('sz', 'A', 8.5, 1), body: { what: 'weight', type: 'sz', studio: 'A', kg: 500 } };
    expect(barKgFor('pf-preacher-curl', 'barbell', 'A', readBars([bad]))).toBe(10);
  });
  test('anything but a barbell has no bar', () => {
    expect(barKgFor('pf-leg-press', 'machine', 'A', none)).toBe(0);
    expect(barKgFor('pf-hammer-curl', 'dumbbell', 'A', readBars([barUseRecord('pf-hammer-curl', 'sz', 1)]))).toBe(0);
  });
  test('the id is stable per type and studio, and the kind is registered and validated', () => {
    expect(barWeightRecord('sz', 'A', 8, 1).id).toBe(barWeightRecord('sz', 'A', 9, 2).id);
    expect(barWeightRecord('sz', 'A', 8, 1).id).not.toBe(barWeightRecord('sz', 'B', 8, 1).id);
    expect(barWeightRecord('sz', 'A', 8, 1).id).not.toBe(barWeightRecord('langhantel', 'A', 8, 1).id);
    expect(RECORD_KINDS).toContain('bar');
    expect(validBody('bar', barUseRecord('x', 'sz', 1).body)).toBe(true);
    expect(validBody('bar', { what: 'weight', type: 'sz', studio: '', kg: 0 })).toBe(false);
  });
});
