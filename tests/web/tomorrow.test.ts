import { describe, expect, it } from 'vitest';
import type { AlsoPart, PlanDay, Sport } from '../../src/shared/week-plan';
import { tomorrowTarget } from '../../src/web/today/tomorrow';

const day = (sport: Sport, also?: AlsoPart): PlanDay => ({ date: '2026-11-13', sport, hardness: 'moderate', fixed: false, ...(also ? { also } : {}) });
const base = { planWorkout: true, canBike: true, canRun: true };

describe('tomorrowTarget', () => {
  it('a strength day tomorrow opens Nächstes Training; only without a plan workout the Kraft page', () => {
    expect(tomorrowTarget({ ...base, tomorrow: day('gym') })).toBe('plan');
    expect(tomorrowTarget({ ...base, tomorrow: day('gym', { sport: 'bike', hardness: 'easy' }) })).toBe('plan');
    expect(tomorrowTarget({ ...base, tomorrow: day('gym'), planWorkout: false })).toBe('kraft');
  });
  it('bike and run go to Ausdauer when there is a way; otherwise and on rest the day sheet', () => {
    expect(tomorrowTarget({ ...base, tomorrow: day('bike') })).toBe('rad');
    expect(tomorrowTarget({ ...base, tomorrow: day('run') })).toBe('lauf');
    expect(tomorrowTarget({ ...base, tomorrow: day('bike'), canBike: false })).toBe('tag');
    expect(tomorrowTarget({ ...base, tomorrow: day('rest') })).toBe('tag');
    expect(tomorrowTarget({ ...base, tomorrow: day('mobility') })).toBe('tag');
  });
});
