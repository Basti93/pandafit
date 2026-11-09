// @vitest-environment jsdom
import fs from 'node:fs';
import type { FastifyInstance } from 'fastify';
import { afterEach, describe, expect, it } from 'vitest';
import { handleRecords } from '../../src/coach/tracking/records-api';
import type { CoachServerMessage } from '../../src/coach/protocol';
import type { LoggedWorkout, TrackedRecord } from '../../src/shared/records';
import { createWorkoutStore } from '../../src/tracking/store';
import type { TrackingPort } from '../../src/tracking/ports';
import { createCoachTrackingPort } from '../support/coachTrackingPort';
import { setup } from '../web-server/helpers';
import { mac, phone, rec, setsOf, sides, wk, type Side } from './two-devices';

let app: FastifyInstance | null = null;
afterEach(async () => { await app?.close(); app = null; });

const copies = (rs: TrackedRecord[]) => rs.filter((r) => r.id !== 'w1');
const baseOf = (r: TrackedRecord) => (r.body as { baseMs?: number }).baseMs;
const w1 = async (s: Side) => (await s.all()).find((r) => r.id === 'w1')!;

describe.each([['phone holds, Mac is stale', 'phone', 'mac'], ['Mac holds, phone is stale', 'mac', 'phone']] as const)('%s', (_n, holderKind, otherKind) => {
  /** The empty workout reached both; the 20 sets reached the server and the holder knows it. The other device has not synced since. */
  const start = async () => {
    const s = await setup();
    app = s.app;
    const make = sides(s.app, () => s.clock.now);
    const holder = (await make[holderKind]()) as unknown as Side;
    const other = (await make[otherKind]()) as unknown as Side;
    await holder.write(rec(0, 10));
    await holder.sync();
    await other.sync();
    await holder.write(rec(20, 20));
    await holder.sync();
    return { holder, other };
  };

  it('R1: a stale discard of sets that are already on the server leaves a copy on both devices', async () => {
    const { holder, other } = await start();
    await other.write(rec(0, 30, { deleted: true }));
    await other.sync(); await holder.sync(); await other.sync();
    for (const d of [holder, other]) {
      expect((await w1(d)).deleted).toBe(true);
      expect(copies(await d.all()).map(setsOf)).toEqual([20]);
    }
  });

  it('R1b: a stale edit with one set leaves a copy, and five more edits leave it standing', async () => {
    const { holder, other } = await start();
    await other.write(rec(1, 31));
    await other.sync(); await holder.sync();
    expect(copies(await holder.all()).map(setsOf)).toEqual([20]);
    for (let i = 2; i <= 6; i++) { await other.write(rec(i, 30 + i)); await other.sync(); }
    await holder.sync(); await other.sync();
    for (const d of [holder, other]) {
      expect(setsOf(await w1(d))).toBe(6);
      expect(copies(await d.all()).map(setsOf)).toEqual([20]);
    }
  });

  it('the holder that was offline while the stale device made several synced edits still keeps its copy', async () => {
    const { holder, other } = await start();
    for (let i = 1; i <= 4; i++) { await other.write(rec(i, 30 + i)); await other.sync(); }
    await holder.sync();
    expect(copies(await holder.all()).map(setsOf)).toEqual([20]);
  });

  it('a second round and further rounds give no further copy; a copy deleted by hand stays deleted', async () => {
    const { holder, other } = await start();
    await other.write(rec(0, 30, { deleted: true }));
    for (let i = 0; i < 4; i++) { await other.sync(); await holder.sync(); }
    const copy = copies(await other.all())[0]!;
    await other.write({ ...copy, updatedMs: 99, deleted: true });
    for (let i = 0; i < 3; i++) { await other.sync(); await holder.sync(); }
    for (const d of [holder, other]) {
      const c = copies(await d.all());
      expect(c).toHaveLength(1);
      expect(c[0]!.deleted).toBe(true);
    }
  });

  it('a set removed after seeing the latest version gives no copy on the other device', async () => {
    const { holder, other } = await start();
    await other.sync();
    expect(setsOf(await w1(other))).toBe(20);
    await other.write(rec(19, 30));
    await other.sync(); await holder.sync(); await other.sync();
    expect(setsOf(await w1(holder))).toBe(19);
    for (const d of [holder, other]) expect(await d.all()).toHaveLength(1);
  });

  it('a delete after seeing the latest version gives no copy (R5)', async () => {
    const { holder, other } = await start();
    await other.sync();
    await other.write(rec(20, 30, { deleted: true }));
    await other.sync(); await holder.sync(); await other.sync();
    expect((await w1(holder)).deleted).toBe(true);
    for (const d of [holder, other]) expect(await d.all()).toHaveLength(1);
  });

  it('several local edits between syncs, removing sets too, carry one base and give no copy', async () => {
    const { holder, other } = await start();
    await other.sync();
    const base = (await w1(holder)).updatedMs;
    for (const [n, u] of [[21, 40], [18, 41], [3, 42]] as const) {
      await holder.write(rec(n, u));
      expect(baseOf(await w1(holder))).toBe(base);
    }
    await holder.sync(); await other.sync(); await holder.sync();
    expect(setsOf(await w1(other))).toBe(3);
    for (const d of [holder, other]) expect(await d.all()).toHaveLength(1);
    // Acknowledged: the next edit stands on the version sent.
    await holder.write(rec(4, 50));
    expect(baseOf(await w1(holder))).toBe(42);
  });

  it('a copy carries no base, syncs like any new record, and an edit of it then gets one', async () => {
    const { holder, other } = await start();
    await other.write(rec(0, 30, { deleted: true }));
    await other.sync(); await holder.sync(); await other.sync();
    const [copy] = copies(await other.all());
    expect(baseOf(copy!)).toBeUndefined();
    expect((copy!.body as LoggedWorkout).endMs).toBe(2019);
    await other.write({ ...copy!, updatedMs: 500 });
    expect(baseOf(copies(await other.all())[0]!)).toBe(copy!.updatedMs);
    await other.sync(); await holder.sync();
    expect(copies(await holder.all()).map((r) => r.updatedMs)).toEqual([500]);
    expect(copies(await holder.all())).toHaveLength(1);
  });
});

describe('relinking the Mac', () => {
  it('counts everything as unsent again but gives no copy for a delete made after seeing that version', async () => {
    const s = await setup();
    app = s.app;
    const p = await phone(s.app, () => s.clock.now), m = await mac(s.app, () => s.clock.now);
    await p.write(rec(20, 20)); await p.sync(); await m.sync();
    await p.write(rec(20, 30, { deleted: true })); await p.sync();
    fs.rmSync(`${(m.links as unknown as { opts: { dir: string } }).opts.dir}/p.cursors`);
    await m.sync(); await p.sync();
    expect(await m.all()).toHaveLength(1);
    expect(await p.all()).toHaveLength(1);
    p.stop();
  });
});

type Port = { port: TrackingPort; remote: (r: TrackedRecord) => Promise<void>; all: () => Promise<TrackedRecord[]>; stop: () => void };
async function webPort(s: Awaited<ReturnType<typeof setup>>): Promise<Port> {
  const p = await phone(s.app, () => s.clock.now);
  return { port: p.port, remote: (r) => p.store.applyMany([r]), all: () => p.all(), stop: () => p.stop() };
}
async function macPort(s: Awaited<ReturnType<typeof setup>>): Promise<Port> {
  const m = await mac(s.app, () => s.clock.now);
  const mem = new Map<string, string>();
  const port = createCoachTrackingPort({
    profileId: 'p', storage: { getItem: (k) => mem.get(k) ?? null, setItem: (k, v) => { mem.set(k, v); } },
    send: (x) => {
      if (x.type !== 'records-put' && x.type !== 'records-list') return false;
      const { reply } = handleRecords({ store: m.store, gym: { start() {}, workoutFinished() {} }, profiles: () => ['p'] }, x);
      queueMicrotask(() => port.handle(reply as CoachServerMessage));
      return true;
    },
  });
  return { port, remote: async (r) => { m.store.putMany('p', [r], 'remote'); }, all: () => m.all(), stop: () => port.dispose() };
}

describe.each([['web', webPort], ['Mac', macPort]] as const)('writing past a version the screen has not seen, %s port', (_n, make) => {
  const open = async () => {
    const s = await setup();
    app = s.app;
    const d = await make(s);
    await d.port.put(rec(1, 900));
    return d;
  };

  it('R3: a lost write over 20 applied sets keeps the rider on top and the 20 as a copy', async () => {
    const d = await open();
    const store = createWorkoutStore(d.port, rec(1, 900), () => 1000);
    await d.remote(rec(20, 5000, { body: { ...wk(20), baseMs: 900 } }));
    expect(await store.apply(() => wk(2) as never)).toBe(true);
    const all = await d.all();
    expect(setsOf(all.find((r) => r.id === 'w1')!)).toBe(2);
    expect(copies(all).map(setsOf)).toEqual([20]);
    store.dispose(); d.stop();
  });

  it('with no clock skew, a write that wins past an unseen 20 sets keeps them as well', async () => {
    const d = await open();
    const store = createWorkoutStore(d.port, rec(1, 900), () => 6000);
    await d.remote(rec(20, 5000, { body: { ...wk(20), baseMs: 900 } }));
    await store.apply(() => wk(2) as never);
    expect(copies(await d.all()).map(setsOf)).toEqual([20]);
    store.dispose(); d.stop();
  });

  it('a winner with no more sets than the rider gives no copy', async () => {
    const d = await open();
    const store = createWorkoutStore(d.port, rec(1, 900), () => 1000);
    await d.remote(rec(1, 5000));
    await store.apply(() => wk(2) as never);
    expect(await d.all()).toHaveLength(1);
    store.dispose(); d.stop();
  });

  it('a discard on a stale screen: the bigger version survives as a copy', async () => {
    const d = await open();
    const store = createWorkoutStore(d.port, rec(1, 900), () => 1000);
    await d.remote(rec(20, 5000));
    await store.remove();
    const all = await d.all();
    expect(all.find((r) => r.id === 'w1')!.deleted).toBe(true);
    expect(copies(all).map(setsOf)).toEqual([20]);
    store.dispose(); d.stop();
  });

  it('a discard after seeing the latest version simply deletes', async () => {
    const d = await open();
    const latest = rec(20, 5000);
    await d.remote(latest);
    const store = createWorkoutStore(d.port, (await d.all()).find((r) => r.id === 'w1')!, () => 6000);
    await store.remove();
    expect(await d.all()).toHaveLength(1);
    store.dispose(); d.stop();
  });

  it('a reload takes the new version as seen: later edits give no copy, also when they remove sets', async () => {
    const d = await open();
    const store = createWorkoutStore(d.port, rec(1, 900), () => 6000);
    await d.remote(rec(20, 5000));
    store.reload((await d.all())[0]!);
    await store.apply(() => wk(19) as never);
    await store.apply(() => wk(18) as never);
    expect(await d.all()).toHaveLength(1);
    store.dispose(); d.stop();
  });
});

describe('R2: the Mac queue', () => {
  it('a record that waited while 20 sets arrived goes on top, and the 20 stay as a copy', async () => {
    const s = await setup();
    app = s.app;
    const p = await phone(s.app, () => s.clock.now), m = await mac(s.app, () => s.clock.now);
    const mem = new Map<string, string>();
    let up = false;
    const port = createCoachTrackingPort({
      profileId: 'p', storage: { getItem: (k) => mem.get(k) ?? null, setItem: (k, v) => { mem.set(k, v); } },
      send: (x) => {
        if (!up || (x.type !== 'records-put' && x.type !== 'records-list')) return false;
        const { reply } = handleRecords({ store: m.store, gym: { start() {}, workoutFinished() {} }, profiles: () => ['p'] }, x);
        queueMicrotask(() => port.handle(reply as CoachServerMessage));
        return true;
      },
    });
    await port.put(rec(3, 15));
    await p.write(rec(20, 20)); await p.sync(); await m.sync();
    up = true;
    port.opened();
    await new Promise((r) => setTimeout(r, 20));
    await m.sync(); await p.sync();
    for (const d of [p, m]) {
      const all = await d.all();
      expect(setsOf(all.find((r) => r.id === 'w1')!)).toBe(3);
      expect(copies(all).map(setsOf)).toEqual([20]);
    }
    port.dispose(); p.stop();
  });

  it('several queued edits in a chain are one write: removing sets gives no copy', async () => {
    const s = await setup();
    app = s.app;
    const m = await mac(s.app, () => s.clock.now);
    const mem = new Map<string, string>();
    let up = false;
    const port = createCoachTrackingPort({
      profileId: 'p', storage: { getItem: (k) => mem.get(k) ?? null, setItem: (k, v) => { mem.set(k, v); } },
      send: (x) => {
        if (!up || (x.type !== 'records-put' && x.type !== 'records-list')) return false;
        const { reply } = handleRecords({ store: m.store, gym: { start() {}, workoutFinished() {} }, profiles: () => ['p'] }, x);
        queueMicrotask(() => port.handle(reply as CoachServerMessage));
        return true;
      },
    });
    m.store.put('p', rec(5, 100));
    const store = createWorkoutStore(port, rec(5, 100), () => 200);
    await store.apply(() => wk(4) as never);
    await store.apply(() => wk(3) as never);
    up = true;
    port.opened();
    await new Promise((r) => setTimeout(r, 20));
    const all = await m.all();
    expect(all).toHaveLength(1);
    expect(setsOf(all[0]!)).toBe(3);
    store.dispose(); port.dispose();
  });
});
