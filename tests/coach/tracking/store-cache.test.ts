import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { RecordStore } from '../../../src/coach/tracking/store';
import type { TrackedRecord } from '../../../src/shared/records';

const rec = (id: string, updatedMs: number): TrackedRecord => ({ kind: 'workout', id, updatedMs, deleted: false, body: { n: id } });

describe('RecordStore cache', () => {
  let dir: string;
  beforeEach(() => { dir = fs.mkdtempSync(path.join(os.tmpdir(), 'rsc-')); });
  afterEach(() => { vi.restoreAllMocks(); fs.rmSync(dir, { recursive: true, force: true }); });

  it('reads the file once for repeated all() without a change', () => {
    new RecordStore({ dir }).put('a', rec('w1', 1));
    const s = new RecordStore({ dir });
    const spy = vi.spyOn(fs, 'readFileSync');
    s.all('a'); s.all('a'); s.changedSince('a', 0);
    expect(spy.mock.calls.filter(c => String(c[0]).endsWith('a.json'))).toHaveLength(1);
  });

  it('does not read the file after its own write', () => {
    const s = new RecordStore({ dir });
    s.put('a', rec('w1', 1));
    const spy = vi.spyOn(fs, 'readFileSync');
    s.put('a', rec('w2', 2));
    expect(s.all('a').map(r => r.id).sort()).toEqual(['w1', 'w2']);
    expect(spy.mock.calls.filter(c => String(c[0]).endsWith('a.json'))).toHaveLength(0);
  });

  it('sees a change made by another writer', () => {
    const s = new RecordStore({ dir });
    s.put('a', rec('w1', 1));
    expect(s.all('a')).toHaveLength(1);
    new RecordStore({ dir }).put('a', rec('w2', 2));
    expect(s.all('a').map(r => r.id).sort()).toEqual(['w1', 'w2']);
  });

  it('sees a file removed by another writer', () => {
    const s = new RecordStore({ dir });
    s.put('a', rec('w1', 1));
    fs.rmSync(path.join(dir, 'a.json'));
    expect(s.all('a')).toEqual([]);
  });
});

test('changing a returned record does not change the store', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'store-copy-'));
  const store = new RecordStore({ dir });
  store.put('p', { kind: 'mealplan', id: 'm', updatedMs: 1, deleted: false, body: { meals: [{ eaters: ['a'] }] } });
  const [r] = store.all('p', 'mealplan');
  (r!.body as { meals: { eaters: string[] }[] }).meals[0]!.eaters = [];
  expect(store.all('p', 'mealplan')[0]!.body).toEqual({ meals: [{ eaters: ['a'] }] });
});

test('changing a written object afterwards does not change the store', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'store-copy-'));
  const store = new RecordStore({ dir });
  const r: TrackedRecord = { kind: 'workout', id: 'w', updatedMs: 1, deleted: false, body: { n: 'a' } };
  store.put('p', r);
  (r.body as { n: string }).n = 'changed';
  expect(store.all('p', 'workout')[0]!.body).toEqual({ n: 'a' });
});
