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
