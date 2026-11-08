import { describe, expect, it } from 'vitest';
import { MAX_ACTIVITIES, readActivities, type ActivityItem } from '../../src/shared/activities';
import { RECORD_KINDS } from '../../src/shared/records';

const item = (over: Partial<ActivityItem> = {}): ActivityItem => ({
  key: 'garmin-1', kind: 'lauf', title: 'Morgenlauf', sport: 'running', startMs: 1000, minutes: 30, distanceM: 5000, avgHr: 150, ref: null, ...over,
});

describe('readActivities', () => {
  it('is a known record kind', () => { expect(RECORD_KINDS).toContain('activities'); });
  it('returns a valid body unchanged', () => {
    const body = { type: 'activities', atMs: 5, items: [item(), item({ key: 'kraft-a', kind: 'kraft', ref: 'a', distanceM: null, avgHr: null })] };
    expect(readActivities(body)).toEqual(body);
  });
  it('rejects a wrong type', () => { expect(readActivities({ type: 'health', atMs: 5, items: [] })).toBeNull(); });
  it('drops a broken entry and keeps the rest', () => {
    const r = readActivities({ type: 'activities', atMs: 5, items: [{ ...item(), startMs: 'x' }, item({ key: 'rad-2', kind: 'rad' })] });
    expect(r!.items.map((i) => i.key)).toEqual(['rad-2']);
  });
  it('rejects more than the maximum', () => {
    const items = Array.from({ length: MAX_ACTIVITIES + 1 }, (_, i) => item({ key: `garmin-${i}` }));
    expect(readActivities({ type: 'activities', atMs: 5, items })).toBeNull();
  });
});
