import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { RecordStore } from '../../src/coach/tracking/store';
import { doneToday, exportDayText } from '../../src/coach/day-text-export';
import { readDayText } from '../../src/shared/day-text';
import { readable } from '../../src/web/validate';

const NOW = new Date(2026, 10, 8, 12).getTime();
let dir: string;
let store: RecordStore;
beforeEach(() => { dir = fs.mkdtempSync(path.join(os.tmpdir(), 'pf-daytext-ex-')); store = new RecordStore({ dir }); });
afterEach(() => fs.rmSync(dir, { recursive: true, force: true }));

type Entry = { date: string; text: string | null; atMs: number; about?: string };
let e: Entry | undefined;
const run = (o: { ride?: boolean; now?: number } = {}) => exportDayText({ store, profileIds: ['pa', 'pb'], coachHere: (id) => id === 'pa', noOpenRide: () => !o.ride, nowMs: o.now ?? NOW, entry: () => e });
const records = () => store.all('pa', 'daytext');

describe('the day text record', () => {
  beforeEach(() => { e = { date: '2026-11-08', text: 'Ein ruhiger Satz.', atMs: NOW }; });

  it('writes a record the web reads', () => {
    expect(run()).toEqual(['pa']);
    const r = records();
    expect(r).toHaveLength(1);
    expect(r[0]).toMatchObject({ kind: 'daytext', id: 'today' });
    expect(readDayText(r[0]!.body)).toMatchObject({ date: '2026-11-08', text: 'Ein ruhiger Satz.' });
    expect(readable(r[0]!)).toBe(true);
  });
  it('writes nothing with a ride open', () => { expect(run({ ride: true })).toEqual([]); expect(records()).toHaveLength(0); });
  it('writes nothing for a profile not coached here', () => { run(); expect(store.all('pb', 'daytext')).toHaveLength(0); });
  it('writes nothing without a text', () => {
    e = { date: '2026-11-08', text: null, atMs: NOW };
    expect(run()).toEqual([]);
    e = undefined;
    expect(run()).toEqual([]);
    expect(records()).toHaveLength(0);
  });
  it('writes an identical entry once', () => {
    run();
    e = { ...e!, atMs: NOW + 5000 };
    expect(run({ now: NOW + 5000 })).toEqual([]);
    expect(records()[0]!.updatedMs).toBe(NOW);
  });
  it('writes a changed text again with a higher updatedMs', () => {
    run();
    e = { date: '2026-11-08', text: 'Stark, das Training.', atMs: NOW, about: 'kraft-1' };
    expect(run()).toEqual(['pa']);
    const r = records()[0]!;
    expect(r.updatedMs).toBeGreaterThan(NOW);
    expect(readDayText(r.body)).toMatchObject({ text: 'Stark, das Training.', about: 'kraft-1' });
  });
});

describe('doneToday', () => {
  it('keeps today only, with key and a readable text', () => {
    const s = (key: string, startMs: number, o = {}) => ({ key, source: 'kraft' as const, title: 'Beine', startMs, minutes: 53.6, ...o });
    const out = doneToday([s('kraft-1', NOW - 3_600_000), s('kraft-0', NOW - 86_400_000), s('kraft-9', NOW + 60_000), s('garmin-2', NOW - 7_200_000, { source: 'andere', title: null, sport: 'running' })], NOW);
    expect(out.map((x) => x.key)).toEqual(['kraft-1', 'garmin-2']);
    expect(out[0]!.text).toBe('Kraft Beine · 54 Min');
    expect(out[1]!.text).toBe('Lauf · 54 Min');
  });
});
