// @vitest-environment jsdom
import 'fake-indexeddb/auto';
import { IDBFactory } from 'fake-indexeddb';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { createCoachTrackingPort } from '../support/coachTrackingPort';
import { handleRecords } from '../../src/coach/tracking/records-api';
import { RecordStore } from '../../src/coach/tracking/store';
import { openIdb } from '../../src/web/idbStore';
import { createWebPort } from '../../src/web/webPort';
import { createWorkoutStore } from '../../src/tracking/store';
import type { TrackingPort } from '../../src/tracking/ports';
import type { LoggedWorkout, TrackedRecord } from '../../src/shared/records';
import type { CoachClientMessage, CoachServerMessage } from '../../src/coach/protocol';

const wk = (sets: number) => ({
  id: 'w1', title: 'T', startMs: 1000, endMs: null, source: 'pandafit' as const, rest: null,
  exercises: [{ rid: 'e', exerciseId: 'pf-squat', title: 'K', supersetId: null, notes: '', sets: Array.from({ length: sets }, (_, i) => ({ rid: `s${i}`, type: 'normal' as const, weightKg: 60, reps: 8, durationS: null, doneMs: 2000 + i })) }],
});
const rec = (sets: number, updatedMs: number): TrackedRecord => ({ kind: 'workout', id: 'w1', updatedMs, deleted: false, body: wk(sets) });

async function webSide() {
  const idb = await openIdb('anna', new IDBFactory());
  const port = createWebPort({ store: idb, account: 'anna', fetchFn: (async () => new Response('{}', { status: 503 })) as unknown as typeof fetch, events: new EventTarget(), intervalMs: 1e9 });
  return { port: port as TrackingPort, remote: (r: TrackedRecord) => idb.applyMany([r]), stored: async () => (await idb.list('workout'))[0]!, stop: () => port.dispose() };
}
function macSide() {
  const store = new RecordStore({ dir: fs.mkdtempSync(path.join(os.tmpdir(), 'pf-lost-')) });
  const mem = new Map<string, string>();
  const port = createCoachTrackingPort({
    profileId: 'p', storage: { getItem: (k) => mem.get(k) ?? null, setItem: (k, v) => { mem.set(k, v); } },
    send: (m: CoachClientMessage) => {
      if (m.type !== 'records-put' && m.type !== 'records-list') return false;
      const { reply } = handleRecords({ store, gym: { start() {}, workoutFinished() {} }, profiles: () => ['p'] }, m);
      queueMicrotask(() => port.handle(reply as CoachServerMessage));
      return true;
    },
  });
  return { port: port as TrackingPort, remote: async (r: TrackedRecord) => { store.put('p', r); }, stored: async () => store.all('p', 'workout')[0]!, stop: () => port.dispose() };
}

describe.each([['web', webSide], ['Mac', async () => macSide()]] as const)('a write that lost on the %s port', (_n, side) => {
  it('S2: raises the floor, writes again and keeps the set; no false "saved"', async () => {
    const s = await side();
    await s.port.put(rec(1, 900));
    const store = createWorkoutStore(s.port, rec(1, 900), () => 1000);
    const remote = rec(1, 5000); // the other device's clock runs ahead
    await s.remote(remote);
    expect(await store.apply(() => wk(2) as never)).toBe(true);
    const kept = await s.stored();
    expect((kept.body as LoggedWorkout).exercises[0]!.sets).toHaveLength(2);
    expect(kept.updatedMs).toBeGreaterThan(5000);
    expect(store.updatedMs()).toBe(kept.updatedMs);
    expect(store.view().save).toBe('saved');
    // The list change that follows brings the older remote copy: it does not replace the rider's state.
    store.reload(remote);
    expect(store.current().exercises[0]!.sets).toHaveLength(2);
    store.dispose(); s.stop();
  });

  it('put reports what was kept', async () => {
    const s = await side();
    await s.port.put(rec(1, 5000));
    expect(await s.port.put(rec(2, 6000))).toEqual({ kept: true, updatedMs: 6000 });
    expect(await s.port.put(rec(3, 100))).toEqual({ kept: false, updatedMs: 6000 });
    s.stop();
  });

  it('a discard that lost is written again too, as a discard', async () => {
    const s = await side();
    await s.port.put(rec(0, 900));
    const store = createWorkoutStore(s.port, rec(0, 900), () => 1000);
    await s.remote(rec(0, 5000));
    await store.remove();
    expect((await s.stored()).deleted).toBe(true);
    store.dispose(); s.stop();
  });
});

describe('a queued record on the Mac port', () => {
  it('that loses when it finally goes out is written again above the winner', async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'pf-lost-'));
    const store = new RecordStore({ dir });
    const mem = new Map<string, string>();
    let up = false;
    const port = createCoachTrackingPort({
      profileId: 'p', storage: { getItem: (k) => mem.get(k) ?? null, setItem: (k, v) => { mem.set(k, v); } },
      send: (m) => {
        if (!up || (m.type !== 'records-put' && m.type !== 'records-list')) return false;
        const { reply } = handleRecords({ store, gym: { start() {}, workoutFinished() {} }, profiles: () => ['p'] }, m);
        queueMicrotask(() => port.handle(reply as CoachServerMessage));
        return true;
      },
    });
    await port.put(rec(4, 1000)); // socket down: queued
    store.put('p', rec(0, 9000));
    up = true;
    port.opened();
    await new Promise((r) => setTimeout(r, 20));
    const kept = store.all('p', 'workout')[0]!;
    expect((kept.body as LoggedWorkout).exercises[0]!.sets).toHaveLength(4);
    expect(kept.updatedMs).toBe(9001);
    expect(port.syncState().pending).toBe(0);
    port.dispose();
  });
});
