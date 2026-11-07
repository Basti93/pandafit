import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { RecordStore } from '../../../src/coach/tracking/store';
import { exportHealth } from '../../../src/coach/health/health-export';
import { readHealth, MAX_HEALTH_BODY, type HealthBody } from '../../../src/shared/health';
import { RECORD_KINDS } from '../../../src/shared/records';
import { readable } from '../../../src/web/validate';

const NOW = new Date(2026, 10, 4, 12).getTime();
let dir: string;
let store: RecordStore;
beforeEach(() => { dir = fs.mkdtempSync(path.join(os.tmpdir(), 'pf-health-')); store = new RecordStore({ dir }); });
afterEach(() => fs.rmSync(dir, { recursive: true, force: true }));

const content = (over: Partial<Omit<HealthBody, 'atMs' | 'coachText'>> = {}): Omit<HealthBody, 'atMs' | 'coachText'> => ({
  type: 'health', today: { level: 'normal', reasons: [] }, findings: [{ rule: 'health.steps-band', text: 'Ein ruhiger Satz.', tone: 'gut' }],
  weeks: [{ week: '2026-10-26', rhr: 55, steps: 8200, strengthDays: 1 }], days: [{ date: '2026-11-03', rhr: 55 }], ...over,
});
let c: Omit<HealthBody, 'atMs' | 'coachText'> | null;
let text: HealthBody['coachText'];
const run = (o: { ride?: boolean; now?: number } = {}) => exportHealth({ store, profileIds: ['pa', 'pb'], coachHere: (id) => id === 'pa', noOpenRide: () => !o.ride, nowMs: o.now ?? NOW, content: () => c, coachText: () => text });
const records = () => store.all('pa', 'health');

describe('the health record', () => {
  beforeEach(() => { c = content(); text = undefined; });

  it('is a known kind and the web reads what is written', () => {
    expect(RECORD_KINDS).toContain('health');
    expect(run()).toEqual(['pa']);
    const r = records()[0]!;
    expect(r.id).toBe('health');
    expect(readHealth(r.body)!.weeks).toHaveLength(1);
    expect(readable(r)).toBe(true);
    expect(store.all('pb', 'health')).toEqual([]);
  });

  it('writes nothing with a ride open, nothing without content', () => {
    expect(run({ ride: true })).toEqual([]);
    c = null;
    expect(run()).toEqual([]);
    expect(records()).toEqual([]);
  });

  it('writes only on change, and again for a new coach text', () => {
    run();
    expect(run({ now: NOW + 60_000 })).toEqual([]);
    expect(records()[0]!.updatedMs).toBe(NOW);
    text = { week: '2026-11-02', text: 'Ruhig weiter.' };
    expect(run({ now: NOW + 120_000 })).toEqual(['pa']);
    expect(readHealth(records()[0]!.body)!.coachText!.text).toBe('Ruhig weiter.');
  });

  it('does not write a body the web would not read (over the size limit)', () => {
    c = content({ weeks: Array.from({ length: 3000 }, (_, i) => ({ week: '2026-10-26', rhr: 55, hrv: 40, sleepH: 7, steps: 9000 + i })) });
    expect(JSON.stringify(c).length).toBeGreaterThan(MAX_HEALTH_BODY);
    expect(run()).toEqual([]);
    expect(records()).toEqual([]);
  });

  it('never throws', () => {
    expect(exportHealth({ store, profileIds: ['pa'], coachHere: () => true, noOpenRide: () => true, nowMs: NOW, content: () => { throw new Error('x'); }, coachText: () => undefined })).toEqual([]);
  });
});
