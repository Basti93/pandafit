import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { RecordStore } from '../../src/coach/tracking/store';
import { activityItems, exportActivities } from '../../src/coach/activities-export';
import type { TrainingSession } from '../../src/coach/all-training';
import { readActivities, MAX_ACTIVITIES, type ActivityItem } from '../../src/shared/activities';

const NOW = new Date(2026, 10, 8, 12).getTime();
let dir: string;
let store: RecordStore;
beforeEach(() => { dir = fs.mkdtempSync(path.join(os.tmpdir(), 'pf-act-')); store = new RecordStore({ dir }); });
afterEach(() => fs.rmSync(dir, { recursive: true, force: true }));

const s = (over: Partial<TrainingSession>): TrainingSession => ({ key: 'garmin-1', source: 'andere', title: null, startMs: 1000, minutes: 30.4, ...over });

describe('activityItems', () => {
  it('classifies the sources and keeps ref, distance and heart rate', () => {
    const items = activityItems([
      s({ key: 'garmin-g1', sport: 'running', title: 'Lauf', startMs: 5 }),
      s({ key: 'garmin-g2', sport: 'yoga', startMs: 4 }),
      s({ key: 'kraft-w1', source: 'kraft', title: 'Push', startMs: 3 }),
      s({ key: 'rad-r1', source: 'rad', startMs: 2 }),
      s({ key: 'lauf-m1', sport: 'running', startMs: 1 }),
      s({ key: 'garmin-g3', sport: 'indoor_cycling', startMs: 0 }),
    ], [{ id: 'g1', distanceM: 5000, avgHr: 150 }]);
    expect(items.map((i) => i.kind)).toEqual(['lauf', 'andere', 'kraft', 'rad', 'lauf', 'rad']);
    expect(items[0]).toMatchObject({ distanceM: 5000, avgHr: 150, ref: null, minutes: 30 });
    expect(items[1]).toMatchObject({ distanceM: null, avgHr: null });
    expect(items[2]!.ref).toBe('w1');
    expect(items[3]!.ref).toBe('r1');
    expect(items[4]!.ref).toBeNull();
  });
  it('is newest first and limited', () => {
    const many = Array.from({ length: MAX_ACTIVITIES + 5 }, (_, i) => s({ key: `garmin-${i}`, startMs: i }));
    const items = activityItems(many, []);
    expect(items).toHaveLength(MAX_ACTIVITIES);
    expect(items[0]!.startMs).toBe(MAX_ACTIVITIES + 4);
  });
});

describe('exportActivities', () => {
  let c: ActivityItem[] | null;
  const one = (key: string): ActivityItem => activityItems([s({ key, startMs: 1 })], [])[0]!;
  const run = (o: { ride?: boolean; now?: number } = {}) => exportActivities({ store, profileIds: ['pa', 'pb'], coachHere: (id) => id === 'pa', noOpenRide: () => !o.ride, nowMs: o.now ?? NOW, content: () => c });
  beforeEach(() => { c = [one('garmin-1')]; });

  it('writes a readable record only for the profile coached here', () => {
    expect(run()).toEqual(['pa']);
    const r = store.all('pa', 'activities')[0]!;
    expect(r.id).toBe('activities');
    expect(readActivities(r.body)!.items).toHaveLength(1);
    expect(store.all('pb', 'activities')).toEqual([]);
  });
  it('writes nothing with a ride open or without content', () => {
    expect(run({ ride: true })).toEqual([]);
    c = null;
    expect(run()).toEqual([]);
    expect(store.all('pa', 'activities')).toEqual([]);
  });
  it('writes only on change', () => {
    run();
    expect(run({ now: NOW + 60_000 })).toEqual([]);
    expect(store.all('pa', 'activities')[0]!.updatedMs).toBe(NOW);
    c = [one('garmin-2'), one('garmin-1')];
    expect(run({ now: NOW + 120_000 })).toEqual(['pa']);
  });
  it('keeps items with an empty or very long name readable', () => {
    c = activityItems([s({ key: 'garmin-1', title: '', sport: '', startMs: 2 }), s({ key: 'garmin-2', title: 'x'.repeat(300), startMs: 1 })], []);
    expect(run()).toEqual(['pa']);
    const items = readActivities(store.all('pa', 'activities')[0]!.body)!.items;
    expect(items).toHaveLength(2);
    expect(items[0]).toMatchObject({ title: null, sport: null });
    expect(items[1]!.title).toHaveLength(200);
  });
  it('never throws', () => {
    expect(exportActivities({ store, profileIds: ['pa'], coachHere: () => true, noOpenRide: () => true, nowMs: NOW, content: () => { throw new Error('x'); } })).toEqual([]);
  });
});
