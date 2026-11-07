// @vitest-environment jsdom
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { cleanup } from '@testing-library/react';
import { handleRecords } from '../../src/coach/tracking/records-api';
import { RecordStore } from '../../src/coach/tracking/store';
import type { CoachServerMessage } from '../../src/shared/coach-protocol';
import type { LoggedWorkout, TrackedRecord } from '../../src/shared/records';

afterEach(cleanup);

const wk = (over: Partial<LoggedWorkout> = {}): TrackedRecord => ({
  kind: 'workout', id: 'w1', updatedMs: 10, deleted: false,
  body: { id: 'w1', title: 'Beine', startMs: 1, endMs: null, source: 'pandafit', exercises: [], ...over, extra: 'bleibt' },
});

let tmp: string;
beforeEach(() => { tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'mac-tracking-')); });
afterEach(() => fs.rmSync(tmp, { recursive: true, force: true }));

const profiles = () => ['a'];
const gymSpy = () => ({ start: vi.fn(), workoutFinished: vi.fn() });

describe('server side', () => {
  test('a set reaches the store before the UI confirms', () => {
    const store = new RecordStore({ dir: tmp });
    const order: string[] = [];
    const put = store.put.bind(store);
    store.put = (p, r, seen) => { const res = put(p, r, seen); order.push('stored'); return res; };
    const out = handleRecords({ store, gym: gymSpy(), profiles }, { type: 'records-put', requestId: 'q1', profileId: 'a', record: wk() });
    order.push('answered');
    expect(order).toEqual(['stored', 'answered']);
    expect(out.reply).toEqual({ type: 'records-put-result', requestId: 'q1', ok: true, kept: true, updatedMs: wk().updatedMs });
    expect(store.all('a', 'workout')[0].body).toMatchObject({ extra: 'bleibt' });
    expect(out.changed).toBe('a');
  });

  test('a failing store answers not ok and announces no change', () => {
    const store = new RecordStore({ dir: tmp });
    store.put = () => { throw new Error('disk'); };
    const out = handleRecords({ store, gym: gymSpy(), profiles }, { type: 'records-put', requestId: 'q1', profileId: 'a', record: wk() });
    expect(out.reply).toEqual({ type: 'records-put-result', requestId: 'q1', ok: false });
    expect(out.changed).toBeUndefined();
  });

  test('a malformed record is refused', () => {
    const store = new RecordStore({ dir: tmp });
    const gym = gymSpy();
    const bad: unknown[] = [
      { ...wk(), kind: 'bogus' }, { ...wk(), id: 5 }, { ...wk(), id: '' }, { ...wk(), updatedMs: NaN }, { ...wk(), updatedMs: '1' },
      { ...wk(), deleted: 'no' }, { ...wk(), body: 'x'.repeat(1_000_001) }, null, 'text',
    ];
    for (const record of bad) {
      const out = handleRecords({ store, gym, profiles }, { type: 'records-put', requestId: 'q', profileId: 'a', record: record as TrackedRecord });
      expect(out.reply).toEqual({ type: 'records-put-result', requestId: 'q', ok: false, refused: true });
    }
    expect(store.all('a')).toEqual([]);
    expect(gym.start).not.toHaveBeenCalled();
    const noProfile = handleRecords({ store, gym, profiles }, { type: 'records-put', requestId: 'q', profileId: '', record: wk() });
    expect(noProfile.reply).toMatchObject({ ok: false, refused: true });
  });

  test('lists carry only that profile and kind', () => {
    const store = new RecordStore({ dir: tmp });
    store.put('a', wk());
    store.put('b', { ...wk(), id: 'other', body: {} });
    store.put('a', { kind: 'routine', id: 'r', updatedMs: 1, deleted: false, body: {} });
    const out = handleRecords({ store, gym: gymSpy(), profiles }, { type: 'records-list', requestId: 'l1', profileId: 'a', kind: 'workout' });
    expect(out.reply).toMatchObject({ type: 'records', kind: 'workout', requestId: 'l1' });
    expect((out.reply as Extract<CoachServerMessage, { type: 'records' }>).records.map((r) => r.id)).toEqual(['w1']);
    const unknown = handleRecords({ store, gym: gymSpy(), profiles }, { type: 'records-list', requestId: 'l2', profileId: 'a', kind: 'zzz' as never });
    expect((unknown.reply as Extract<CoachServerMessage, { type: 'records' }>).records).toEqual([]);
  });

  test('a finished workout marks the gym coach dirty, an open one only starts it', () => {
    const store = new RecordStore({ dir: tmp });
    const gym = gymSpy();
    handleRecords({ store, gym, profiles }, { type: 'records-put', requestId: 'q', profileId: 'a', record: wk() });
    expect(gym.start).toHaveBeenCalledWith('a');
    expect(gym.workoutFinished).not.toHaveBeenCalled();
    handleRecords({ store, gym, profiles }, { type: 'records-put', requestId: 'q', profileId: 'a', record: { ...wk({ endMs: 99 }), updatedMs: 20 } });
    expect(gym.workoutFinished).toHaveBeenCalledWith('a');
    const routine: TrackedRecord = { kind: 'routine', id: 'r', updatedMs: 1, deleted: false, body: { endMs: 5 } };
    handleRecords({ store, gym, profiles }, { type: 'records-put', requestId: 'q', profileId: 'a', record: routine });
    expect(gym.workoutFinished).toHaveBeenCalledTimes(1);
  });
});

describe('server rules', () => {
  test('a finished workout plans once, not on edits or replays', () => {
    const store = new RecordStore({ dir: tmp });
    const gym = gymSpy();
    const put = (r: TrackedRecord) => handleRecords({ store, gym, profiles }, { type: 'records-put', requestId: 'q', profileId: 'a', record: r });
    put(wk());
    put({ ...wk({ endMs: 99 }), updatedMs: 20 });
    expect(gym.workoutFinished).toHaveBeenCalledTimes(1);
    put({ ...wk({ endMs: 99, title: 'geändert' }), updatedMs: 30 });
    put({ ...wk({ endMs: 99 }), updatedMs: 20 });
    put(wk());
    expect(gym.workoutFinished).toHaveBeenCalledTimes(1);
  });

  test('an unknown profile is refused and no file is created', () => {
    const store = new RecordStore({ dir: path.join(tmp, 'tracking') });
    const gym = gymSpy();
    const out = handleRecords({ store, gym, profiles }, { type: 'records-put', requestId: 'q', profileId: '../evil', record: wk() });
    expect(out.reply).toEqual({ type: 'records-put-result', requestId: 'q', ok: false, refused: true });
    expect(out.changed).toBeUndefined();
    const list = handleRecords({ store, gym, profiles }, { type: 'records-list', requestId: 'l', profileId: 'zz', kind: 'workout' });
    expect((list.reply as { records: unknown[] }).records).toEqual([]);
    expect(fs.existsSync(path.join(tmp, 'tracking'))).toBe(false);
    expect(gym.start).not.toHaveBeenCalled();
  });
});

test('tracking.css does not collide with the app styles', () => {
  const t = fs.readFileSync(path.resolve('src/tracking/ui/tracking.css'), 'utf8');
  const app = fs.readFileSync(path.resolve('src/ui/style.css'), 'utf8');
  const classes = new Set([...t.matchAll(/\.(tk-[a-z-]+)/g)].map((m) => m[1]));
  for (const c of classes) expect(app.includes(`.${c}`), c).toBe(false);
  // every rule of tracking.css is scoped to a tk- class or a media query
  const selectors = t.replace(/\/\*[\s\S]*?\*\//g, '').split('\n').filter((l) => /^[^\s@}]/.test(l)).map((l) => l.trim());
  for (const l of selectors) expect(l.startsWith('.tk-'), l).toBe(true);
});
