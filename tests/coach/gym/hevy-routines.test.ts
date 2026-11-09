import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { HevyLinks } from '../../../src/coach/hevy';
import { HevyError, HevyRoutines } from '../../../src/coach/gym/hevy-routines';
import type { GymWorkout } from '../../../src/shared/gym/types';

const KEY = '00000000-1111-2222-3333-444444444444';
const NOW = Date.UTC(2026, 10, 2, 12);
const DAY = 86_400_000;
type Call = { method: string; url: string; body: any; key: string | null };

let dir: string;
beforeEach(() => { dir = fs.mkdtempSync(path.join(os.tmpdir(), 'hevy-routines-')); });
afterEach(() => { fs.rmSync(dir, { recursive: true, force: true }); });

const workout: GymWorkout = {
  name: 'Next workout',
  exercises: [
    { templateId: 'T1', title: 'Squat', restS: 120, supersetId: null, notes: 'Slow down', sets: [
      { type: 'warmup', weightKg: 20, reps: 10 },
      { type: 'normal', weightKg: 60, reps: 8, repRange: { start: 6, end: 10 } },
    ] },
    { templateId: 'T2', title: 'Pull-up', restS: null, supersetId: 0, notes: '', sets: [{ type: 'normal', weightKg: null, reps: 8 }] },
    { templateId: 'T3', title: 'Dip', restS: 9999, supersetId: 0, notes: '', sets: [{ type: 'normal', weightKg: null, reps: 8 }] },
    { templateId: 'T4', title: 'Lone', restS: 30, supersetId: 7, notes: '', sets: [{ type: 'normal', weightKg: null, reps: 8 }] },
  ],
};
const none = { routineId: null, updatedAt: null };

type World = { folders: { id: number; title: string }[]; routines: { id: string; folder_id: number | null; updated_at: string }[]; failing?: boolean; noPageCount?: boolean; missing?: Set<string> };
function fake(world: World) {
  const calls: Call[] = [];
  const fetchFn = (async (input: any, init: any = {}) => {
    const url = String(input);
    const u = new URL(url);
    const method = init.method ?? 'GET';
    const body = init.body ? JSON.parse(init.body) : null;
    calls.push({ method, url, body, key: init.headers?.['api-key'] ?? null });
    const json = (status: number, data: unknown) => new Response(JSON.stringify(data), { status });
    if (world.failing) return json(500, { error: 'boom' });
    const page = Number(u.searchParams.get('page') ?? 1);
    const size = Number(u.searchParams.get('pageSize') ?? 10);
    const paged = <T,>(items: T[], name: string) => json(200, { page, ...(world.noPageCount ? {} : { page_count: Math.ceil(items.length / size) }), [name]: items.slice((page - 1) * size, page * size) });
    if (u.pathname === '/v1/routine_folders' && method === 'GET') return paged(world.folders, 'routine_folders');
    if (u.pathname === '/v1/routine_folders' && method === 'POST') {
      const f = { id: 100 + world.folders.length, title: body.routine_folder.title };
      world.folders.push(f);
      return json(201, f);
    }
    if (u.pathname === '/v1/routines' && method === 'GET') return paged(world.routines, 'routines');
    if (u.pathname === '/v1/routines' && method === 'POST') {
      const r = { id: `r${world.routines.length + 1}`, folder_id: body.routine.folder_id, updated_at: '2026-11-02T10:00:00Z' };
      world.routines.push(r);
      return json(201, { routine: r });
    }
    const m = u.pathname.match(/^\/v1\/routines\/(.+)$/);
    if (m) {
      const r = world.routines.find((x) => x.id === m[1]);
      if (!r || world.missing?.has(m[1]!)) return json(404, { error: 'nope' });
      if (method === 'PUT') { r.updated_at = '2026-11-02T11:00:00Z'; return json(200, { routine: r }); }
      return json(200, { routine: r });
    }
    if (u.pathname === '/v1/exercise_templates') {
      const all = Array.from({ length: 230 }, (_, i) => ({ id: `E${i}`, title: `Ex ${i}`, type: 'weight_reps', primary_muscle_group: 'quadriceps', equipment: 'barbell' }));
      return paged(all, 'exercise_templates');
    }
    return json(404, {});
  }) as typeof fetch;
  return { calls, fetchFn };
}
const make = (world: World, nowMs = () => NOW) => {
  const f = fake(world);
  return { ...f, routines: new HevyRoutines({ key: KEY, dir, nowMs, fetchFn: f.fetchFn }) };
};
const writes = (calls: Call[]) => calls.filter((c) => c.method !== 'GET');

describe('HevyRoutines', () => {
  it('the folder is found by title, also after a restart without state', async () => {
    const world: World = { folders: Array.from({ length: 11 }, (_, i) => ({ id: i + 1, title: i === 10 ? 'Pandafit' : `F${i}` })), routines: [] };
    const { routines, calls } = make(world);
    await routines.writeRoutine(workout, none);
    expect(world.folders).toHaveLength(11);
    expect(calls.find((c) => c.method === 'POST' && c.url.endsWith('/v1/routines'))!.body.routine.folder_id).toBe(11);
  });

  it('the folder is created only when missing', async () => {
    const world: World = { folders: [{ id: 1, title: 'Other' }], routines: [] };
    const { routines, calls } = make(world);
    await routines.writeRoutine(workout, none);
    expect(calls.filter((c) => c.method === 'POST' && c.url.endsWith('/v1/routine_folders'))).toHaveLength(1);
    expect(calls.find((c) => c.url.endsWith('/v1/routine_folders') && c.method === 'POST')!.body).toEqual({ routine_folder: { title: 'Pandafit' } });
    await routines.writeRoutine(workout, none);
    expect(world.folders).toHaveLength(2);
  });

  it('a known routine is updated with PUT', async () => {
    const world: World = { folders: [{ id: 5, title: 'Pandafit' }], routines: [{ id: 'r9', folder_id: 5, updated_at: '2026-11-01T00:00:00Z' }] };
    const { routines, calls } = make(world);
    const r = await routines.writeRoutine(workout, { routineId: 'r9', updatedAt: '2026-11-01T00:00:00Z' });
    expect(r).toEqual({ routineId: 'r9', updatedAt: '2026-11-02T11:00:00Z' });
    expect(writes(calls).map((c) => `${c.method} ${new URL(c.url).pathname}`)).toEqual(['PUT /v1/routines/r9']);
  });

  it('without a known routine one found in the folder is reused', async () => {
    const world: World = {
      folders: [{ id: 5, title: 'Pandafit' }],
      routines: [{ id: 'x', folder_id: 1, updated_at: 'a' }, { id: 'mine', folder_id: 5, updated_at: 'b' }],
    };
    const { routines, calls } = make(world);
    const r = await routines.writeRoutine(workout, none);
    expect(r.routineId).toBe('mine');
    expect(writes(calls).map((c) => c.method)).toEqual(['PUT']);
  });

  it('a 404 on update creates a new routine', async () => {
    const world: World = { folders: [{ id: 5, title: 'Pandafit' }], routines: [] };
    const { routines, calls } = make(world);
    const r = await routines.writeRoutine(workout, { routineId: 'gone', updatedAt: 'x' });
    expect(r.routineId).toBe('r1');
    expect(writes(calls).map((c) => c.method)).toEqual(['PUT', 'POST']);
  });

  it('a superset is sent contiguous, even when the plan lists the partner later', async () => {
    const world: World = { folders: [{ id: 5, title: 'Pandafit' }], routines: [] };
    const { routines, calls } = make(world);
    const ex = (templateId: string, supersetId: number | null) => ({ templateId, title: templateId, restS: 90, supersetId, notes: '', sets: [{ type: 'normal' as const, weightKg: 20, reps: 8 }] });
    await routines.writeRoutine({ name: 'S', exercises: [ex('T1', 0), ex('T2', null), ex('T3', 0), ex('T4', 1), ex('T5', 1)] }, none);
    const body = calls.find((c) => c.method === 'POST' && c.url.endsWith('/v1/routines'))!.body;
    expect(body.routine.exercises.map((e: any) => [e.exercise_template_id, e.superset_id])).toEqual([['T1', 0], ['T3', 0], ['T2', null], ['T4', 1], ['T5', 1]]);
  });

  it('an unset rest is resolved with the coach catalog (a custom exercise gets its compound rest)', async () => {
    const world: World = { folders: [{ id: 5, title: 'Pandafit' }], routines: [] };
    const { routines, calls } = make(world);
    const mine = { id: 'own-1', title: 'Eigenes Bankdrücken', type: 'weight_reps', primaryMuscle: 'chest', secondaryMuscles: ['triceps'], equipment: 'barbell' };
    const w = { name: 'S', exercises: [{ templateId: 'own-1', title: 'Eigenes Bankdrücken', restS: null, supersetId: null, notes: '', sets: [{ type: 'normal' as const, weightKg: 20, reps: 10 }] }] };
    await routines.writeRoutine(w, none, [mine]);
    expect(calls.find((c) => c.method === 'POST' && c.url.endsWith('/v1/routines'))!.body.routine.exercises[0].rest_seconds).toBe(150);
  });

  it("the body matches Hevy's schema", async () => {
    const world: World = { folders: [{ id: 5, title: 'Pandafit' }], routines: [] };
    const { routines, calls } = make(world);
    await routines.writeRoutine(workout, none);
    const body = calls.find((c) => c.method === 'POST' && c.url.endsWith('/v1/routines'))!.body;
    expect(body).toEqual({ routine: {
      title: 'Next workout', folder_id: 5, notes: '',
      exercises: [
        { exercise_template_id: 'T1', superset_id: null, rest_seconds: 120, notes: 'Slow down', sets: [
          { type: 'warmup', weight_kg: 20, reps: 10, rep_range: null },
          { type: 'normal', weight_kg: 60, reps: 8, rep_range: { start: 6, end: 10 } },
        ] },
        { exercise_template_id: 'T2', superset_id: 0, rest_seconds: 90, notes: '', sets: [{ type: 'normal', weight_kg: null, reps: 8, rep_range: null }] },
        { exercise_template_id: 'T3', superset_id: 0, rest_seconds: 600, notes: '', sets: [{ type: 'normal', weight_kg: null, reps: 8, rep_range: null }] },
        { exercise_template_id: 'T4', superset_id: null, rest_seconds: 30, notes: '', sets: [{ type: 'normal', weight_kg: null, reps: 8, rep_range: null }] },
      ],
    } });
    expect(calls.every((c) => c.key === KEY)).toBe(true);
  });

  it('templates are paged at 100, cached for 7 days in the profile folder', async () => {
    const world: World = { folders: [], routines: [] };
    let now = NOW;
    const { routines, calls } = make(world, () => now);
    const list = await routines.templates();
    expect(list).toHaveLength(230);
    expect(list[0]).toEqual({ id: 'E0', title: 'Ex 0', type: 'weight_reps', primaryMuscle: 'quadriceps', equipment: 'barbell' });
    expect(calls.map((c) => new URL(c.url).searchParams.get('pageSize'))).toEqual(['100', '100', '100']);
    expect(fs.readFileSync(path.join(dir, 'templates.json'), 'utf8')).not.toContain(KEY);
    now += 6 * DAY;
    const again = make(world, () => now);
    expect(await again.routines.templates()).toHaveLength(230);
    expect(again.calls).toHaveLength(0);
    now += 2 * DAY;
    await again.routines.templates();
    expect(again.calls).toHaveLength(3);
  });

  it('a Hevy error rejects and leaves the state alone', async () => {
    const world: World = { folders: [], routines: [], failing: true };
    const { routines, calls } = make(world);
    const err = await routines.writeRoutine(workout, { routineId: 'r1', updatedAt: 'x' }).catch((e: Error) => e);
    expect(err).toBeInstanceOf(Error);
    expect(String((err as Error).message)).not.toContain(KEY);
    expect(writes(calls)).toHaveLength(0);
    expect(world.folders).toHaveLength(0);
    world.failing = false;
    await expect(routines.writeRoutine(workout, none)).resolves.toMatchObject({ routineId: 'r1' });
  });

  it('editedSince compares updated_at', async () => {
    const world: World = { folders: [], routines: [{ id: 'r1', folder_id: 1, updated_at: '2026-11-02T10:00:00Z' }] };
    const { routines } = make(world);
    expect(await routines.editedSince('r1', '2026-11-02T10:00:00Z')).toBe(false);
    expect(await routines.editedSince('r1', '2026-11-01T10:00:00Z')).toBe(true);
    expect(await routines.editedSince('gone', 'x')).toBe(false);
  });

  it('the PUT body has no folder_id, the POST body keeps it', async () => {
    const world: World = { folders: [{ id: 5, title: 'Pandafit' }], routines: [{ id: 'r9', folder_id: 5, updated_at: 'a' }] };
    const { routines, calls } = make(world);
    await routines.writeRoutine(workout, { routineId: 'r9', updatedAt: 'a' });
    expect(calls.find((c) => c.method === 'PUT')!.body.routine).not.toHaveProperty('folder_id');
  });

  it('a folder list without page_count makes no POST', async () => {
    const world: World = { folders: [{ id: 5, title: 'Pandafit' }], routines: [], noPageCount: true };
    const { routines, calls } = make(world);
    await expect(routines.writeRoutine(workout, none)).rejects.toThrow();
    expect(writes(calls)).toHaveLength(0);
  });

  it('a routine list without page_count makes no POST', async () => {
    const world: World = { folders: [{ id: 5, title: 'Pandafit' }], routines: [] };
    const { routines, calls } = make(world);
    const real = (routines as any).pages.bind(routines);
    (routines as any).pages = async (route: string, name: string, size: number) => {
      if (route === '/v1/routines') world.noPageCount = true;
      return real(route, name, size);
    };
    await expect(routines.writeRoutine(workout, none)).rejects.toThrow();
    expect(writes(calls)).toHaveLength(0);
  });

  it('an empty list or page_count 0 means nothing there', async () => {
    const world: World = { folders: [], routines: [] };
    const { routines, calls } = make(world);
    await expect(routines.writeRoutine(workout, none)).resolves.toMatchObject({ routineId: 'r1' });
    expect(calls.filter((c) => c.method === 'POST')).toHaveLength(2);
  });

  it('no DELETE is ever sent', async () => {
    const world: World = { folders: [], routines: [] };
    const { routines, calls } = make(world);
    await routines.templates();
    await routines.writeRoutine(workout, none);
    await routines.writeRoutine(workout, { routineId: 'gone', updatedAt: 'x' });
    await routines.editedSince('r1', 'x');
    expect(calls.some((c) => c.method === 'DELETE')).toBe(false);
    expect(calls.every((c) => ['GET', 'POST', 'PUT'].includes(c.method))).toBe(true);
  });
});

describe('HevyLinks.apiKey', () => {
  it('returns the stored key for a safe profile id, else null', () => {
    fs.mkdirSync(path.join(dir, 'p1'));
    fs.writeFileSync(path.join(dir, 'p1', 'api-key'), `${KEY}\n`);
    const links = new HevyLinks({ baseDir: dir, nowMs: () => NOW, onChange: () => {} });
    expect(links.apiKey('p1')).toBe(KEY);
    expect(links.apiKey('p2')).toBeNull();
    expect(links.apiKey('../p1')).toBeNull();
  });

  describe('errors and refreshing templates', () => {
    const status = (code: number) => (async () => new Response('{"error":"Secret body"}', { status: code })) as unknown as typeof fetch;
    it('errors expose the status and neither the key nor the body', async () => {
      for (const code of [400, 404, 429, 500]) {
        const r = new HevyRoutines({ key: KEY, dir, nowMs: () => NOW, fetchFn: status(code) });
        const e = await r.writeRoutine(workout, none).catch((x: unknown) => x);
        expect(e).toBeInstanceOf(HevyError);
        expect((e as HevyError).status).toBe(code);
        expect(`${(e as Error).message} ${JSON.stringify(e)}`).not.toMatch(new RegExp(`${KEY}|Secret`));
      }
    });
    it('refreshTemplates fetches past a fresh cache and stores the result', async () => {
      const world: World = { folders: [], routines: [] };
      const { routines, calls } = make(world);
      await routines.templates();
      calls.length = 0;
      expect(await routines.refreshTemplates()).toHaveLength(230);
      expect(calls).toHaveLength(3);
      expect(calls.every((c) => c.method === 'GET')).toBe(true);
      calls.length = 0;
      await routines.templates();
      expect(calls).toHaveLength(0);
    });
  });

  describe('templates when offline', () => {
    const down = (async () => { throw new TypeError('fetch failed'); }) as unknown as typeof fetch;
    it('an expired cache is the fallback when the fetch fails', async () => {
      const { routines } = make({ folders: [], routines: [] });
      await routines.templates();
      const later = new HevyRoutines({ key: KEY, dir, nowMs: () => NOW + 30 * DAY, fetchFn: down });
      expect(await later.templates()).toHaveLength(230);
    });
    it('without any cache the failure reaches the caller', async () => {
      const r = new HevyRoutines({ key: KEY, dir, nowMs: () => NOW, fetchFn: down });
      await expect(r.templates()).rejects.toThrow();
    });
    it('a disk failure keeps the fetched templates', async () => {
      const blocked = path.join(dir, 'a-file');
      fs.writeFileSync(blocked, 'x');
      const world: World = { folders: [], routines: [] };
      const r = new HevyRoutines({ key: KEY, dir: blocked, nowMs: () => NOW, fetchFn: fake(world).fetchFn });
      expect(await r.templates()).toHaveLength(230);
    });
  });
});
