import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { AccountLinks, LinkError } from '../../../src/coach/tracking/link';
import { AccountSync } from '../../../src/coach/tracking/mac-sync';
import { RecordStore } from '../../../src/coach/tracking/store';
import { hevyRecord } from '../../../src/coach/tracking/hevy-import';
import { Coach } from '../../../src/coach/coach';
import { GymCoach } from '../../../src/coach/gym/gym-coach';
import { MobilityCoach } from '../../../src/coach/mobility/mobility';
import { applyRecord, type TrackedRecord } from '../../../src/shared/records';

const HOUR = 3_600_000;
const NOW = Date.UTC(2026, 10, 2, 12);
const URL_ = 'http://127.0.0.1:9';
const PW = 'pw-never-stored-7';
const TOKEN = 'tok-secret-1';
const ID = 'pa';

type Call = { method: string; path: string; auth: string | null; body: string };
/** The server as far as the Mac sees it. No network. */
function sim() {
  const db = new Map<string, { r: TrackedRecord; seq: number }>();
  let seq = 0;
  const s = {
    calls: [] as Call[], hook: null as null | (() => void), status: 0, /** An older server that does not know these kinds. */ unknownKinds: [] as string[], offline: false, wait: null as Promise<void> | null, db,
    add(r: TrackedRecord) { const k = `${r.kind}:${r.id}`; const cur = db.get(k)?.r; const { keep } = applyRecord(cur, r); if (keep !== cur) db.set(k, { r: keep, seq: ++seq }); },
    fetch: async (input: string | URL | Request, init?: RequestInit): Promise<Response> => {
      const u = new URL(String(input));
      const body = typeof init?.body === 'string' ? init.body : '';
      const headers = (init?.headers ?? {}) as Record<string, string>;
      s.calls.push({ method: init?.method ?? 'GET', path: u.pathname + u.search, auth: headers.authorization ?? null, body });
      s.hook?.();
      if (s.wait) await s.wait;
      if (s.offline) throw new TypeError('fetch failed');
      const json = (o: unknown, status = 200) => new Response(JSON.stringify(o), { status, headers: { 'content-type': 'application/json' } });
      if (s.status) return json({ error: 'x' }, s.status);
      if (u.pathname === '/device-token') {
        const b = JSON.parse(body) as { password: string };
        return b.password === PW ? json({ token: TOKEN, deviceId: 1 }) : json({ error: 'login failed' }, 401);
      }
      if (headers.authorization !== `Bearer ${TOKEN}`) return json({ error: 'unauthorized' }, 401);
      if (u.pathname === '/records' && init?.method === 'POST') {
        const refused: { id: string; reason: string }[] = [];
        let accepted = 0;
        for (const r of (JSON.parse(body) as { records: TrackedRecord[] }).records) {
          if (s.unknownKinds.includes(r.kind)) { refused.push({ id: r.id, reason: 'unknown kind' }); continue; }
          if (r.updatedMs > NOW + 7 * 24 * HOUR) { refused.push({ id: r.id, reason: 'updatedMs too far ahead' }); continue; }
          s.add(r); accepted++;
        }
        return json({ accepted, refused });
      }
      if (u.pathname === '/records') {
        const since = Number(u.searchParams.get('since') ?? 0), limit = Number(u.searchParams.get('limit') ?? 500);
        const rows = [...db.values()].filter((e) => e.seq > since).sort((a, b) => a.seq - b.seq);
        const page = rows.slice(0, limit);
        return json({ records: page.map((e) => e.r), cursor: page.length ? page[page.length - 1]!.seq : since, more: rows.length > limit, reset: false });
      }
      return json({}, 404);
    },
    /** Records that arrived by a POST, by id. */
    posted(): string[] { return s.calls.filter((c) => c.method === 'POST' && c.path === '/records').flatMap((c) => (JSON.parse(c.body) as { records: TrackedRecord[] }).records.map((r) => r.id)); },
    gets(): number { return s.calls.filter((c) => c.method === 'GET').length; },
  };
  return s;
}

let tmp: string;
beforeEach(() => { tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'link-')); });
afterEach(() => { vi.restoreAllMocks(); fs.rmSync(tmp, { recursive: true, force: true }); });

function world() {
  const server = sim();
  const w = {
    server, now: NOW, ride: false, rides: [] as unknown[], changed: [] as string[],
    links: new AccountLinks({ dir: path.join(tmp, 'accounts'), fetchFn: server.fetch as typeof fetch }),
    store: new RecordStore({ dir: path.join(tmp, 'tracking') }),
    coach: null as unknown as Coach, gym: null as unknown as GymCoach, mobility: null as unknown as MobilityCoach, sync: null as unknown as AccountSync,
    asks: [] as string[],
  };
  w.coach = new Coach({ ridesDir: path.join(tmp, 'rides'), coachDir: path.join(tmp, 'coach'), ask: async () => ({}), nowMs: () => w.now });
  fs.mkdirSync(path.join(tmp, 'rides'), { recursive: true });
  w.coach.scanRides([{ id: ID, name: 'Max', ftpW: 200 }]);
  w.mobility = new MobilityCoach({ store: w.store, nowMs: () => w.now, rides: () => w.rides as never, strength: () => [], complaints: () => w.coach.state(ID).complaints ?? [] });
  w.gym = new GymCoach({
    dir: path.join(tmp, 'gym'), nowMs: () => w.now, store: w.store, hevy: () => false,
    ask: async (i) => { w.asks.push(i.prompt); throw new Error('no ai'); },
    workouts: () => [], templates: async () => [], refreshTemplates: async () => [], ready: () => true,
    bike: (id) => ({ summaries: [], complaints: w.coach.state(id).complaints ?? [] }),
    complaint: (id, text) => w.coach.addComplaintFromText(id, text), writer: () => null,
    account: (id) => w.links.status(id).state === 'linked',
  });
  w.sync = new AccountSync({
    links: w.links, store: w.store, coach: w.coach, gym: w.gym, mobility: w.mobility, nowMs: () => w.now,
    noOpenRide: () => !w.ride, fetchFn: server.fetch as typeof fetch, onChange: (id) => { w.changed.push(id); },
  });
  return w;
}
const linked = async (w: ReturnType<typeof world>) => { await w.links.link(ID, URL_, 'anna', PW); return w; };
const rec = (kind: TrackedRecord['kind'], id: string, updatedMs: number, body: unknown, deleted = false): TrackedRecord => ({ kind, id, updatedMs, deleted, body });
const finished = (id: string, endMs: number | null) => rec('workout', id, NOW, { id, title: 'Tag A', startMs: NOW - HOUR, endMs, source: 'pandafit', exercises: [] });
const MIN = 60_000;

describe('AccountLinks', () => {
  it('stores url, name and token privately and never the password', async () => {
    const w = world();
    await w.links.link(ID, URL_, 'anna', PW);
    const f = path.join(tmp, 'accounts', ID);
    expect(JSON.parse(fs.readFileSync(f, 'utf8'))).toEqual({ url: URL_, name: 'anna', token: TOKEN });
    expect(fs.statSync(f).mode & 0o777).toBe(0o600);
    for (const e of fs.readdirSync(path.join(tmp, 'accounts'))) expect(fs.readFileSync(path.join(tmp, 'accounts', e), 'utf8')).not.toContain(PW);
    expect(w.links.status(ID)).toEqual({ state: 'linked', name: 'anna' });
    expect(w.links.token(ID)).toBe(TOKEN);
    expect(w.server.calls[0]!.path).toBe('/device-token');
  });

  it('needs https, except for localhost', async () => {
    const w = world();
    await expect(w.links.link(ID, 'http://example.org', 'anna', PW)).rejects.toMatchObject({ reason: 'url' });
    await expect(w.links.link(ID, 'ftp://example.org', 'anna', PW)).rejects.toBeInstanceOf(LinkError);
    expect(w.server.calls).toEqual([]);
    await w.links.link(ID, 'https://pandafit.example.org', 'anna', PW);
    expect(w.links.status(ID).state).toBe('linked');
  });

  it('the account status carries the web app origin for https links only, never a path', async () => {
    const w = world();
    expect(w.sync.status(ID).webOrigin).toBeNull();
    const file = path.join(tmp, 'accounts', ID);
    const store = (url: string) => { fs.mkdirSync(path.dirname(file), { recursive: true }); fs.writeFileSync(file, JSON.stringify({ url, name: 'anna', token: TOKEN })); };
    store('https://pandafit.example.org/app');
    expect(w.sync.status(ID).webOrigin).toBe('https://pandafit.example.org');
    store('http://localhost:8080');
    expect(w.sync.status(ID).webOrigin).toBeNull();
  });

  it('a wrong password stores nothing and the error does not carry it', async () => {
    const w = world();
    const err = await w.links.link(ID, URL_, 'anna', 'wrong-pw-123').catch((e: unknown) => e as LinkError);
    expect(err).toBeInstanceOf(LinkError);
    expect((err as LinkError).reason).toBe('invalid');
    expect(`${(err as LinkError).message} ${(err as LinkError).stack}`).not.toContain('wrong-pw-123');
    expect(w.links.status(ID)).toEqual({ state: 'idle', name: null });
    expect(fs.existsSync(path.join(tmp, 'accounts', ID))).toBe(false);
  });

  it('a network error says failed, an unknown profile id is refused', async () => {
    const w = world();
    w.server.offline = true;
    await expect(w.links.link(ID, URL_, 'anna', PW)).rejects.toMatchObject({ reason: 'failed' });
    await expect(w.links.link('../x', URL_, 'anna', PW)).rejects.toBeInstanceOf(LinkError);
  });

  it('unlink removes the token and keeps local records', async () => {
    const w = await linked(world());
    w.store.put(ID, finished('w1', NOW));
    w.links.unlink(ID);
    expect(w.links.status(ID)).toEqual({ state: 'idle', name: null });
    expect(w.links.token(ID)).toBeNull();
    expect(w.store.all(ID, 'workout').length).toBe(1);
  });
});

describe('AccountSync', () => {
  it('no account means no call and no error', async () => {
    const w = world();
    w.store.put(ID, finished('w1', NOW));
    await expect(w.sync.tick(ID)).resolves.toBeUndefined();
    expect(w.server.calls).toEqual([]);
    expect(w.sync.status(ID)).toMatchObject({ state: 'idle', refused: 0 });
  });

  it('no sync during an open ride', async () => {
    const w = await linked(world());
    w.server.calls.length = 0;
    w.ride = true;
    await w.sync.tick(ID);
    expect(w.server.calls).toEqual([]);
    w.ride = false;
    await w.sync.tick(ID);
    expect(w.server.gets()).toBeGreaterThan(0);
  });

  it('a ride opening between two requests stops the run', async () => {
    const w = await linked(world());
    for (let i = 0; i < 3; i++) w.store.put(ID, finished(`w${i}`, NOW));
    w.server.calls.length = 0;
    w.server.hook = () => { w.ride = true; };
    await w.sync.tick(ID);
    // The send was the first request. Nothing follows it.
    expect(w.server.posted()).toEqual(['w0', 'w1', 'w2']);
    expect(w.server.gets()).toBe(0);
  });

  it('sends local records and takes what the phone wrote, once', async () => {
    const w = await linked(world());
    w.store.put(ID, finished('mine', NOW));
    w.server.add(finished('theirs', NOW));
    await w.sync.tick(ID);
    expect(w.server.posted()).toContain('mine');
    expect(w.store.all(ID, 'workout').map((r) => r.id).sort()).toEqual(['mine', 'theirs']);
    expect(w.changed).toEqual([ID]);
    w.now += 2 * MIN;
    await w.sync.tick(ID);
    w.now += 2 * MIN;
    await w.sync.tick(ID);
    expect(w.server.posted().filter((i) => i === 'theirs')).toEqual([]);
    expect(w.server.posted().filter((i) => i === 'mine')).toEqual(['mine']);
  });

  it('at most once a minute, soon after a local change, never twice at once', async () => {
    const w = await linked(world());
    await w.sync.tick(ID);
    const before = w.server.gets();
    w.now += 10_000;
    await w.sync.tick(ID);
    expect(w.server.gets()).toBe(before);
    w.sync.touch(ID);
    w.now += 6_000;
    await w.sync.tick(ID);
    expect(w.server.gets()).toBe(before + 1);
    w.now += 61_000;
    let release!: () => void;
    w.server.wait = new Promise<void>((r) => { release = r; });
    const a = w.sync.tick(ID), b = w.sync.tick(ID);
    release();
    await Promise.all([a, b]);
    expect(w.server.gets()).toBe(before + 2);
  });

  it('a failing server never throws, and the next minute retries', async () => {
    const w = await linked(world());
    w.store.put(ID, finished('w1', NOW));
    w.server.offline = true;
    await expect(w.sync.tick(ID)).resolves.toBeUndefined();
    expect(w.sync.status(ID)).toMatchObject({ state: 'linked', offline: true });
    w.server.offline = false;
    w.now += MIN + 1;
    await w.sync.tick(ID);
    expect(w.server.posted()).toContain('w1');
    expect(w.sync.status(ID).offline).toBe(false);
    expect(w.sync.status(ID).lastSyncMs).toBe(w.now);
  });

  it('a 403 is logged once, without the token, and the sync keeps retrying', async () => {
    const w = await linked(world());
    const log = vi.spyOn(console, 'error').mockImplementation(() => {});
    w.server.status = 403;
    await w.sync.tick(ID);
    expect(w.sync.status(ID)).toMatchObject({ state: 'linked', offline: true });
    expect(log).toHaveBeenCalledTimes(1);
    expect(String(log.mock.calls[0]![0])).toContain('403');
    expect(JSON.stringify(log.mock.calls)).not.toContain(TOKEN);
    const n = w.server.calls.length;
    w.now += MIN + 1;
    await w.sync.tick(ID);
    expect(w.server.calls.length).toBeGreaterThan(n);
    expect(log).toHaveBeenCalledTimes(1);
    // Once a run went through, a new 403 is worth one more line.
    w.server.status = 0;
    w.now += MIN + 1;
    await w.sync.tick(ID);
    expect(w.sync.status(ID).offline).toBe(false);
    w.server.status = 403;
    w.now += MIN + 1;
    await w.sync.tick(ID);
    expect(log).toHaveBeenCalledTimes(2);
  });

  it('a rejected token shows calmly and stops calling', async () => {
    const w = await linked(world());
    w.server.status = 401;
    await w.sync.tick(ID);
    expect(w.sync.status(ID)).toMatchObject({ state: 'rejected', name: 'anna' });
    const n = w.server.calls.length;
    w.now += 10 * MIN;
    await w.sync.tick(ID);
    await w.sync.tick(ID);
    expect(w.server.calls.length).toBe(n);
    w.server.status = 0;
    await w.sync.link(ID, URL_, 'anna', PW);
    expect(w.sync.status(ID).state).toBe('linked');
    w.now += 10 * MIN;
    await w.sync.tick(ID);
    expect(w.server.calls.length).toBeGreaterThan(n + 1);
  });

  it('the token and password never reach status, logs or prompts', async () => {
    const spies = (['log', 'error', 'warn', 'info', 'debug'] as const).map((k) => vi.spyOn(console, k).mockImplementation(() => {}));
    const w = world();
    await w.sync.link(ID, URL_, 'anna', PW);
    w.coach.addComplaintFromText(ID, 'Das Knie zwickt');
    w.server.offline = true;
    await w.sync.tick(ID);
    w.server.offline = false;
    w.now += 2 * MIN;
    await w.sync.tick(ID);
    await w.gym.tick(ID).catch(() => {});
    const seen = JSON.stringify([w.sync.status(ID), w.links.status(ID), w.coach.state(ID), w.gym.state(ID), w.asks, spies.map((s) => s.mock.calls)]);
    expect(seen).not.toContain(TOKEN);
    expect(seen).not.toContain(PW);
    expect(JSON.stringify(w.store.all(ID))).not.toContain(TOKEN);
  });

  it('imported Hevy workouts are sent, the Hevy key is not', async () => {
    const w = await linked(world());
    fs.mkdirSync(path.join(tmp, 'hevy', ID), { recursive: true });
    fs.writeFileSync(path.join(tmp, 'hevy', ID, 'api-key'), 'HEVY-KEY-0000');
    w.store.put(ID, hevyRecord({ id: 'hv1', title: 'Push', startMs: NOW - 3 * HOUR, durationS: 3000, exercises: [{ title: 'Bench', templateId: 't1', sets: 1, reps: 8, volumeKg: 320, workSets: [{ type: 'normal', weightKg: 40, reps: 8 }] }] }));
    await w.sync.tick(ID);
    expect(w.server.posted()).toContain('hv1');
    expect(w.server.calls.map((c) => c.body + c.path).join('')).not.toContain('HEVY-KEY-0000');
  });

  it('refused records stay on the Mac, show as a note and do not block the queue', async () => {
    const w = await linked(world());
    w.store.put(ID, rec('workout', 'future', NOW + 30 * 24 * HOUR, {}));
    w.store.put(ID, finished('ok', NOW));
    await w.sync.tick(ID);
    expect(w.server.db.has('workout:ok')).toBe(true);
    expect(w.sync.status(ID).refused).toBe(1);
    expect(w.store.all(ID, 'workout').map((r) => r.id)).toContain('future');
    w.now += 2 * MIN;
    await w.sync.tick(ID);
    expect(w.server.posted().filter((i) => i === 'future')).toEqual(['future']);
  });

  it('an older server that does not know the mealplan kind yet: nothing breaks, nothing alarms, it is offered again later', async () => {
    const w = await linked(world());
    w.server.unknownKinds = ['mealplan'];
    w.store.putMany(ID, [rec('mealplan', 'week-2026-11-09', NOW, { week: '2026-11-09', meals: [] })]);
    w.store.put(ID, finished('ok', NOW));
    await w.sync.tick(ID);
    expect(w.server.db.has('workout:ok')).toBe(true);
    expect(w.sync.status(ID)).toMatchObject({ refused: 0, offline: false });
    w.server.unknownKinds = [];
    w.now += 2 * MIN;
    await w.sync.tick(ID);
    expect(w.server.db.has('mealplan:week-2026-11-09')).toBe(false);
    w.now += 6 * 60 * MIN;
    await w.sync.tick(ID);
    expect(w.server.db.get('mealplan:week-2026-11-09')!.r.body).toEqual({ week: '2026-11-09', meals: [] });
  });

  it('the plan and open complaints go to the server as records, without churn', async () => {
    const w = await linked(world());
    w.gym.start(ID);
    const s = w.gym.state(ID);
    s.next = { workout: { name: 'Oberkörper', exercises: [] } as never, reason: 'Zuletzt 40 kg', source: 'rules' };
    w.coach.addComplaintFromText(ID, 'Das Knie zwickt');
    await w.sync.tick(ID);
    const plan = w.server.db.get('plan:current')!.r;
    expect(plan.deleted).toBe(false);
    expect(plan.body).toMatchObject({ workout: { name: 'Oberkörper' }, reason: 'Zuletzt 40 kg', source: 'rules', note: null, questions: [], atMs: NOW, mobility: null });
    const c = w.coach.state(ID).complaints![0]!;
    expect(w.server.db.get(`complaint:${c.id}`)!.r.body).toEqual({ text: 'Das Knie zwickt', status: 'active', atMs: c.startedMs });
    w.now += 2 * MIN;
    await w.sync.tick(ID);
    w.now += 2 * MIN;
    await w.sync.tick(ID);
    expect(w.server.posted().filter((i) => i === 'current')).toEqual(['current']);
    expect(w.server.posted().filter((i) => i === c.id)).toEqual([c.id]);
    s.next = { workout: { name: 'Beine', exercises: [] } as never, reason: 'Neu', source: 'claude' };
    w.now += 2 * MIN;
    await w.sync.tick(ID);
    expect(w.server.posted().filter((i) => i === 'current')).toEqual(['current', 'current']);
    expect((w.server.db.get('plan:current')!.r.body as { workout: { name: string } }).workout.name).toBe('Beine');
  });

  it('a complaint added or closed on the phone reaches the bike coach and the gym coach', async () => {
    const w = await linked(world());
    w.server.add(rec('complaint', 'p-1', NOW - HOUR, { text: 'Die Schulter schmerzt', status: 'active', atMs: NOW - HOUR }));
    await w.sync.tick(ID);
    const c = w.coach.state(ID).complaints!;
    expect(c.map((x) => ({ id: x.id, text: x.text, status: x.status }))).toEqual([{ id: 'p-1', text: 'Die Schulter schmerzt', status: 'active' }]);
    await w.gym.tick(ID).catch(() => {});
    expect(w.gym.state(ID).complaintsFingerprint).toContain('p-1:active');
    // Closed on the phone, newer: it applies. An older copy never wins.
    w.server.add(rec('complaint', 'p-1', NOW, { text: 'Die Schulter schmerzt', status: 'over', atMs: NOW - HOUR }));
    w.now += 2 * MIN;
    await w.sync.tick(ID);
    expect(w.coach.state(ID).complaints![0]!.status).toBe('over');
    await w.gym.tick(ID).catch(() => {});
    expect(w.gym.state(ID).complaintsFingerprint).not.toContain('p-1:active');
  });

  it('a complaint written out from the Mac does not come back as a new complaint', async () => {
    const w = await linked(world());
    w.coach.addComplaintFromText(ID, 'Das Knie zwickt');
    const id = w.coach.state(ID).complaints![0]!.id;
    await w.sync.tick(ID);
    // The server hands the same record back after a reset or a second device.
    w.server.add(rec('complaint', id, NOW + 1, { text: 'Das Knie zwickt', status: 'active', atMs: NOW }));
    w.now += 2 * MIN;
    await w.sync.tick(ID);
    w.now += 2 * MIN;
    await w.sync.tick(ID);
    expect(w.coach.state(ID).complaints!.map((x) => x.id)).toEqual([id]);
    expect([...w.server.db.keys()].filter((k) => k.startsWith('complaint:'))).toEqual([`complaint:${id}`]);
  });

  it('the plan keeps its date when only the mobility offer changes', async () => {
    const w = await linked(world());
    w.gym.start(ID);
    w.gym.state(ID).next = { workout: { name: 'Oberkörper', exercises: [] } as never, reason: 'r', source: 'rules' };
    await w.sync.tick(ID);
    w.now += 3 * HOUR;
    w.rides = [{ status: 'finished', startedAtMs: w.now - 2 * HOUR, durationS: 3600 }];
    await w.sync.tick(ID);
    const body = w.server.db.get('plan:current')!.r.body as { atMs: number; mobility: unknown };
    expect(body.mobility).not.toBeNull();
    expect(body.atMs).toBe(NOW);
  });

  it('a mobility session done on the phone counts on the Mac', async () => {
    const w = await linked(world());
    const end = NOW - 2 * HOUR;
    w.rides = [{ status: 'finished', startedAtMs: end - 3600_000, durationS: 3600 }];
    const offer = w.mobility.view(ID).session!;
    expect(offer).not.toBeNull();
    w.server.add(rec('mobility', offer.id, NOW - HOUR, { doneMs: NOW - HOUR, forSession: 'bike' }));
    await w.sync.tick(ID);
    expect(w.mobility.view(ID).session).toBeNull();
  });

  it('a workout finished on the phone plans once, like one finished here', async () => {
    const w = await linked(world());
    w.server.add(finished('ph1', null));
    await w.sync.tick(ID);
    expect(w.gym.state(ID).localStart).toBe(true);
    expect(w.gym.state(ID).dirty).toBe(false);
    w.server.add({ ...finished('ph1', NOW), updatedMs: NOW + 1 });
    w.now += 2 * MIN;
    await w.sync.tick(ID);
    expect(w.gym.state(ID).dirty).toBe(true);
    w.gym.state(ID).dirty = false;
    w.server.add({ ...finished('ph1', NOW), updatedMs: NOW + 2, body: { ...(finished('ph1', NOW).body as object), title: 'Umbenannt' } });
    w.now += 2 * MIN;
    await w.sync.tick(ID);
    expect(w.gym.state(ID).dirty).toBe(false);
  });

  it('a linked account switches the gym coach on, unlinking keeps the data', async () => {
    const w = world();
    expect(w.gym.enabled(ID)).toBe(false);
    await w.links.link(ID, URL_, 'anna', PW);
    expect(w.gym.enabled(ID)).toBe(true);
    w.store.put(ID, rec('routine', 'r1', NOW, {}));
    w.links.unlink(ID);
    expect(w.gym.enabled(ID)).toBe(false);
    expect(w.store.all(ID, 'routine').length).toBe(1);
  });

  it('cursors stored without the kinds signature or with an old one fetch everything again; local records stay', async () => {
    const w = await linked(world());
    const file = path.join(tmp, 'accounts', `${ID}.cursors`);
    await w.links.cursors(ID).set({ sent: 7, received: 40, generation: 'g1' });
    expect(await w.links.cursors(ID).get()).toEqual({ sent: 7, received: 40, generation: 'g1' });
    // An older Mac wrote them without a signature: received starts from 0, the rest stays.
    fs.writeFileSync(file, JSON.stringify({ sent: 7, received: 40, generation: 'g1' }));
    expect(await w.links.cursors(ID).get()).toEqual({ sent: 7, received: 0, generation: 'g1' });
    fs.writeFileSync(file, JSON.stringify({ sent: 7, received: 40, kinds: 'workout,routine' }));
    expect((await w.links.cursors(ID).get()).received).toBe(0);

    // End to end: a run record the old version skipped comes down after the update.
    w.store.put(ID, rec('mobility', 'm-local', NOW, { text: 'hier' }));
    await w.sync.tick(ID);
    w.server.add(rec('run', 'settings', NOW, { type: 'settings', on: true, weekdays: null, answers: null }));
    const c = await w.links.cursors(ID).get();
    // Pretend the run record was seen and dropped by an older version: cursor past it, no signature.
    fs.writeFileSync(file, JSON.stringify({ sent: c.sent, received: 1_000, ...(c.generation ? { generation: c.generation } : {}) }));
    w.now += 10 * MIN;
    await w.sync.tick(ID);
    expect(w.store.all(ID, 'run').map((r) => r.id)).toEqual(['settings']);
    expect(w.store.all(ID, 'mobility').map((r) => r.id)).toEqual(['m-local']);
  });

  it('settled: a run that leaves its resend open is not settled, even when the sent cursor is past every record', async () => {
    const w = await linked(world());
    w.store.put(ID, rec('mobility', 'm1', NOW, { text: 'a' }));
    // The server's database was replaced: everything must go up again from the start.
    await w.links.cursors(ID).set({ sent: 1_000_000, received: 0, resend: true });
    // A ride opens with the first request, so the run stops before it cleared resend.
    w.server.hook = () => { w.ride = true; };
    await w.sync.tick(ID);
    expect((await w.links.cursors(ID).get()).resend).toBe(true);
    expect(w.sync.settled(ID)).toBe(false);
  });

  it('settled: only after a run that went through, and not once something changed here since', async () => {
    const w = await linked(world());
    expect(w.sync.settled(ID)).toBe(false);
    w.store.put(ID, rec('mobility', 'n1', NOW, { text: 'a' }));
    await w.sync.tick(ID);
    expect(w.server.posted()).toContain('n1');
    expect(w.sync.settled(ID)).toBe(true);
    // A new record here: not settled until the next run sent it.
    w.store.put(ID, rec('mobility', 'n2', NOW + 1, { text: 'b' }));
    expect(w.sync.settled(ID)).toBe(false);
    w.now += 2 * MIN;
    await w.sync.tick(ID);
    expect(w.sync.settled(ID)).toBe(true);
    // A failed run is not settled.
    w.server.offline = true;
    w.now += 2 * MIN;
    await w.sync.tick(ID);
    expect(w.sync.settled(ID)).toBe(false);
    // A run stopped by a ride before it sent is not settled either.
    w.server.offline = false;
    w.store.put(ID, rec('mobility', 'n3', NOW + 2, { text: 'c' }));
    w.server.hook = () => { w.ride = true; };
    w.now += 2 * MIN;
    await w.sync.tick(ID);
    expect(w.sync.settled(ID)).toBe(false);
  });
});
