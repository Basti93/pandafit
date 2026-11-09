import { createHash } from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import type { FastifyInstance } from 'fastify';
import { afterEach, beforeEach, expect, test, vi } from 'vitest';
import { CoachHttpError, coachHttp } from '../../../src/coach/remote/coach-http';
import { driftOf, homeOf, mealsMoved } from '../../../src/coach/remote/home';
import { migrate, moveMeals } from '../../../src/coach/remote/migrate';
import { RideUploads } from '../../../src/coach/remote/ride-upload';
import { createRouter } from '../../../src/coach/remote/router';
import { openText } from '../../../src/coach/secrets/secret-box';
import { Household } from '../../../src/coach/server/household';
import { buildCoachServer } from '../../../src/coach/server/http';
import type { CoachRuntime } from '../../../src/coach/runtime';
import type { Profile } from '../../../src/shared/profiles';

const KEY = Buffer.alloc(32, 7);
const TOKEN = 'c'.repeat(64);
const DEVICE_TOKEN = 'device-token-for-tests';
const HEVY_KEY = '12345678-1234-1234-1234-123456789abc';
const GARMIN_TOKENS = JSON.stringify({ oauth: 'garmin-test-only-token' });
const P1: Profile = { id: 'pa', name: 'A', ftpW: 200 };
const NOON = new Date(2026, 10, 3, 12, 0).getTime();
const temp = () => fs.mkdtempSync(path.join(os.tmpdir(), 'mmig-'));
const realFetch = globalThis.fetch;

const openDbs: DatabaseSync[] = [];
let app: FastifyInstance | null = null;
beforeEach(() => {
  // The server's own account sync and Hevy reach nothing in tests.
  vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({ records: [], cursor: 0, more: false, refused: [] }), { status: 200, headers: { 'content-type': 'application/json' } })));
});
afterEach(async () => {
  for (const db of openDbs.splice(0)) { try { db.close(); } catch { /* closed */ } }
  await app?.close(); app = null;
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

const writeRide = (ridesDir: string, rideId: string, status: string) => {
  const d = path.join(ridesDir, rideId);
  fs.mkdirSync(d, { recursive: true });
  const startedAtMs = NOON - 3600_000;
  fs.writeFileSync(path.join(d, 'meta.json'), JSON.stringify({ rideId, profileId: 'pa', sessionId: 'ki', startedAtMs, status }));
  fs.writeFileSync(path.join(d, 'session.json'), JSON.stringify({ session: { id: 'ki', name: 'KI', steps: [{ kind: 'erg', durationS: 600, ftpFraction: 0.65, label: 'Locker' }] }, ftpW: 200 }));
  const samples = Array.from({ length: 120 }, (_, i) => ({ seq: i, wallClockMs: startedAtMs + i * 1000, rideElapsedS: i + 1, powerW: 130, cadenceRpm: 90, speedKph: 30, hrBpm: 130, targetW: 130, gradePct: null, gear: null }));
  fs.writeFileSync(path.join(d, 'samples.jsonl'), samples.map((s) => JSON.stringify(s)).join('\n') + '\n');
  fs.writeFileSync(path.join(d, 'events.jsonl'), '');
};

/** The Mac's data folder for profile pa: coach state, rides, a Garmin database with rows still in its WAL, Hevy and Garmin logins. */
const macData = (o: { hevy?: boolean; garmin?: boolean } = {}) => {
  const root = temp();
  const rides = path.join(root, 'rides');
  fs.mkdirSync(rides, { recursive: true });
  fs.writeFileSync(path.join(rides, 'profiles.json'), JSON.stringify([P1]));
  writeRide(rides, 'ride-1', 'finished');
  writeRide(rides, 'ride-2', 'aborted');
  writeRide(rides, 'ride-3', 'discarded');
  const coach = path.join(root, 'coach');
  fs.mkdirSync(path.join(coach, 'gym'), { recursive: true });
  fs.writeFileSync(path.join(coach, 'pa.json'), JSON.stringify({ profileId: 'pa', ftpW: 200 }));
  fs.writeFileSync(path.join(coach, 'gym', 'pa.json'), JSON.stringify({ sessions: [] }));
  if (o.garmin !== false) {
    const dir = path.join(root, 'garmin', 'data', 'pa');
    fs.mkdirSync(dir, { recursive: true });
    const db = new DatabaseSync(path.join(dir, 'garmin.db'));
    db.exec('PRAGMA journal_mode=WAL; PRAGMA wal_autocheckpoint=0; CREATE TABLE daily (day TEXT PRIMARY KEY, resting_hr INTEGER); INSERT INTO daily VALUES (\'2026-11-01\', 50);');
    // Kept open: the row stays in the WAL, as while the Mac's sync is running.
    openDbs.push(db);
    fs.writeFileSync(path.join(dir, 'sync-meta.json'), JSON.stringify({ lastDay: '2026-11-01' }));
    fs.mkdirSync(path.join(root, 'garmin', 'tokens', 'pa'), { recursive: true });
    fs.writeFileSync(path.join(root, 'garmin', 'tokens', 'pa', 'garmin_tokens.json'), GARMIN_TOKENS);
  }
  if (o.hevy !== false) {
    fs.mkdirSync(path.join(root, 'hevy', 'pa'), { recursive: true });
    fs.writeFileSync(path.join(root, 'hevy', 'pa', 'api-key'), HEVY_KEY);
    fs.writeFileSync(path.join(root, 'hevy', 'pa', 'workouts.json'), JSON.stringify({ workouts: [] }));
  }
  return { root, rides, coach };
};

type Req = { method: string; route: string; body: string };
type Fault = (r: { method: string; route: string }) => 'before' | 'after' | null;

/**
 * The household's coach server on a real port, reached the way the Mac reaches it: `<url>/coach/<route>` with the device token,
 * through a stand-in for the api proxy (the device token becomes account 1; a coach 401 becomes 503). Every request is recorded
 * with its body. A fault cuts a request before it reaches the server, or after the server answered.
 */
const server = async (o: { root?: string; mayContinue?: () => boolean } = {}) => {
  const sroot = o.root ?? temp();
  const household = new Household({
    root: sroot, secretKey: KEY, runDir: temp(), python: process.execPath, garminScripts: path.join(sroot, 'scripts'),
    apiUrl: 'http://api.test:8081', internalToken: TOKEN, ask: (async () => { throw new Error('no Claude in tests'); }) as never, nowMs: () => NOON,
    spawnFn: (() => { throw new Error('no python in tests'); }) as never, fetchFn: (async () => new Response('', { status: 401 })) as never, waitMs: 0,
  });
  app = buildCoachServer({ household, internalToken: TOKEN });
  await app.listen({ port: 0, host: '127.0.0.1' });
  const port = (app.server.address() as { port: number }).port;
  const w = { reqs: [] as Req[], fault: null as Fault | null };
  const fetchFn = (async (input: string | URL, init: RequestInit & { duplex?: 'half' } = {}) => {
    const u = new URL(String(input));
    const route = u.pathname.replace(/^\/coach/, '');
    const method = init.method ?? 'GET';
    const headers = new Headers(init.headers);
    if (headers.get('authorization') !== `Bearer ${DEVICE_TOKEN}`) return new Response('{"error":"unauthorized"}', { status: 401 });
    // The body, recorded on its way through.
    const req: Req = { method, route, body: '' };
    w.reqs.push(req);
    let body = init.body as unknown;
    if (body && typeof body === 'object' && Symbol.asyncIterator in (body as object)) {
      const src = body as AsyncIterable<Uint8Array>;
      body = (async function* () { for await (const c of src) { req.body += Buffer.from(c).toString('utf8'); yield c; } })();
    } else if (typeof body === 'string') req.body = body;
    const fault = w.fault?.({ method, route }) ?? null;
    if (fault === 'before') throw new TypeError('fetch failed');
    const fwd = new Headers({ 'x-pandafit-internal': TOKEN, 'x-pandafit-account': '1' });
    for (const h of ['content-type', 'x-sha256']) { const v = headers.get(h); if (v) fwd.set(h, v); }
    const res = await realFetch(`http://127.0.0.1:${port}${route}`, { method, headers: fwd, body: body as BodyInit | undefined, ...(body ? { duplex: 'half' } : {}), signal: init.signal } as RequestInit);
    const text = await res.text();
    if (fault === 'after') throw new TypeError('fetch failed');
    return new Response(text, { status: res.status === 401 ? 503 : res.status, headers: { 'content-type': 'application/json' } });
  }) as typeof fetch;
  const http = coachHttp({ url: 'https://coach.test', token: DEVICE_TOKEN, fetchFn, ...(o.mayContinue ? { mayContinue: o.mayContinue } : {}) });
  return { sroot, household, w, http, acc: path.join(sroot, 'accounts', '1') };
};

const run = (mac: ReturnType<typeof macData>, http: ReturnType<typeof coachHttp>, o: { settled?: () => boolean; open?: () => boolean } = {}) => {
  const uploads = new RideUploads({ ridesDir: mac.rides, dir: mac.coach, http: () => http, noOpenRide: () => !(o.open?.() ?? false) });
  const progress: [number, number][] = [];
  const out = migrate({
    root: mac.root, profileId: 'pa', http, uploads, recordsSettled: o.settled ?? (() => true),
    noOpenRide: () => !(o.open?.() ?? false), progress: (d, t) => progress.push([d, t]), nowMs: () => NOON,
  });
  return { out, uploads, progress };
};

/** Every file under a folder with its bytes, for "nothing changed". WAL files of the open database are left out. */
const files = (dir: string): Record<string, string> => {
  const out: Record<string, string> = {};
  const walk = (d: string, rel: string) => {
    let names: string[];
    try { names = fs.readdirSync(d); } catch { return; }
    for (const n of names.sort()) {
      const p = path.join(d, n);
      if (fs.statSync(p).isDirectory()) walk(p, `${rel}${n}/`);
      else if (!/-(wal|shm)$/.test(n) && !n.endsWith('garmin.db')) out[`${rel}${n}`] = fs.readFileSync(p).toString('base64');
    }
  };
  walk(dir, '');
  return out;
};
const userData = (root: string) => ({ ...files(path.join(root, 'rides')), ...files(path.join(root, 'hevy')), ...files(path.join(root, 'garmin')), coach: files(path.join(root, 'coach', 'gym')), pa: fs.readFileSync(path.join(root, 'coach', 'pa.json'), 'utf8') });

test('migration uploads everything once, finishes and marks the profile moved', async () => {
  const mac = macData();
  const s = await server();
  const before = userData(mac.root);
  const r = run(mac, s.http);
  expect(await r.out).toEqual({ state: 'done' });
  expect(homeOf(mac.coach, 'pa', true)).toBe('server');
  // Each item and each closed ride once; discarded ride-3 never.
  const puts = s.w.reqs.filter((q) => q.method === 'PUT').map((q) => q.route).sort();
  expect(puts).toEqual(['/migrate/item/coach-state', '/migrate/item/garmin-db', '/migrate/item/garmin-sync-meta', '/migrate/item/garmin-tokens', '/migrate/item/gym-state', '/migrate/item/hevy-key', '/migrate/item/hevy-workouts', '/rides/ride-1', '/rides/ride-2']);
  expect(r.progress.at(-1)).toEqual([9, 9]);
  // The server runs the account's coach with the data as it was on the Mac, the WAL rows included.
  expect(s.household.account(1)?.profileId).toBe('pa');
  const db = new DatabaseSync(path.join(s.acc, 'garmin', 'data', 'pa', 'garmin.db'), { readOnly: true });
  expect(db.prepare('SELECT resting_hr FROM daily').all()).toEqual([{ resting_hr: 50 }]);
  db.close();
  expect(fs.readdirSync(path.join(s.acc, 'rides')).filter((n) => n.startsWith('ride-')).sort()).toEqual(['ride-1', 'ride-2']);
  expect(openText(KEY, '1:hevy', fs.readFileSync(path.join(s.acc, 'hevy', 'pa', 'api-key'), 'utf8'))).toBe(HEVY_KEY);
  // The ledger knows both rides, so the uploads after the move do not send them again.
  expect(r.uploads.pending('pa')).toEqual([]);
  // The Mac's own files are untouched, and the staging copy is gone.
  expect(userData(mac.root)).toEqual(before);
  expect(fs.existsSync(path.join(mac.coach, 'remote', 'pa', 'staging'))).toBe(false);
});

test('a cut-off migration resumes and skips what the server already has', async () => {
  const mac = macData();
  const s = await server();
  // The connection breaks at the third item.
  let items = 0;
  s.w.fault = ({ route }) => (route.startsWith('/migrate/item/') && ++items === 3 ? 'before' : null);
  expect(await run(mac, s.http).out).toEqual({ state: 'failed', reason: 'offline' });
  expect(homeOf(mac.coach, 'pa', true)).toBe('local');
  const first = s.w.reqs.filter((q) => q.method === 'PUT').map((q) => q.route);
  s.w.reqs = [];
  s.w.fault = null;
  expect(await run(mac, s.http).out).toEqual({ state: 'done' });
  const second = s.w.reqs.filter((q) => q.method === 'PUT').map((q) => q.route);
  // Only the rest: the rides and the two items that arrived are not sent again; the one cut off is.
  const firstItems = first.filter((r) => r.startsWith('/migrate/item/'));
  expect(first.filter((r) => r.startsWith('/rides/'))).toEqual(['/rides/ride-1', '/rides/ride-2']);
  expect(firstItems).toHaveLength(3);
  expect(second.filter((r) => r.startsWith('/rides/'))).toEqual([]);
  for (const r of firstItems.slice(0, 2)) expect(second).not.toContain(r);
  expect(second).toContain(firstItems[2]);
  expect(second).toHaveLength(7 - 2);
});

test('a finish cut off after the server switched is asked again with the same snapshot, never failed', async () => {
  const mac = macData();
  const s = await server();
  s.w.fault = ({ route }) => (route === '/migrate/finish' ? 'after' : null);
  expect(await run(mac, s.http).out).toEqual({ state: 'paused', reason: 'finish' });
  expect(homeOf(mac.coach, 'pa', true)).toBe('local');
  s.w.fault = null;
  s.w.reqs = [];
  expect(await run(mac, s.http).out).toEqual({ state: 'done' });
  expect(homeOf(mac.coach, 'pa', true)).toBe('server');
  // The server had switched already: begin says done, nothing is uploaded again.
  expect(s.w.reqs.map((q) => `${q.method} ${q.route}`)).toEqual(['POST /migrate/begin']);
});

test('a coach change during the upload restarts the snapshot and does not switch', async () => {
  const mac = macData();
  const s = await server();
  // The local coach writes its state while the items go up, once.
  let changed = false;
  s.w.fault = ({ route }) => {
    if (route === '/migrate/item/gym-state' && !changed) {
      changed = true;
      fs.writeFileSync(path.join(mac.coach, 'pa.json'), JSON.stringify({ profileId: 'pa', ftpW: 210 }));
    }
    return null;
  };
  // The server sees a finish only with the new state.
  expect(await run(mac, s.http).out).toEqual({ state: 'done' });
  const finishes = s.w.reqs.filter((q) => q.route === '/migrate/finish');
  expect(finishes).toHaveLength(1);
  const begins = s.w.reqs.filter((q) => q.route === '/migrate/begin');
  expect(begins).toHaveLength(2);
  expect(JSON.parse(fs.readFileSync(path.join(s.acc, 'coach', 'pa.json'), 'utf8')).ftpW).toBe(210);
  // Only the coach state went up again.
  const items = s.w.reqs.filter((q) => q.route.startsWith('/migrate/item/')).map((q) => q.route);
  expect(items.filter((r) => r === '/migrate/item/coach-state')).toHaveLength(2);
  expect(items).toHaveLength(8);
});

test('a coach that keeps changing never switches with a stale snapshot', async () => {
  const mac = macData();
  const s = await server();
  let n = 0;
  s.w.fault = ({ route }) => {
    if (route === '/migrate/begin') fs.writeFileSync(path.join(mac.coach, 'pa.json'), JSON.stringify({ profileId: 'pa', ftpW: 200 + ++n }));
    return null;
  };
  expect(await run(mac, s.http).out).toEqual({ state: 'failed', reason: 'changing' });
  expect(s.w.reqs.filter((q) => q.route === '/migrate/finish')).toEqual([]);
  expect(homeOf(mac.coach, 'pa', true)).toBe('local');
  expect(fs.existsSync(path.join(s.acc, 'moved.json'))).toBe(false);
});

test('unsent records hold the switch until they are on the server', async () => {
  const mac = macData();
  const s = await server();
  let settled = false;
  expect(await run(mac, s.http, { settled: () => settled }).out).toEqual({ state: 'paused', reason: 'records' });
  expect(s.w.reqs.filter((q) => q.route === '/migrate/finish')).toEqual([]);
  expect(homeOf(mac.coach, 'pa', true)).toBe('local');
  settled = true;
  s.w.reqs = [];
  expect(await run(mac, s.http, { settled: () => settled }).out).toEqual({ state: 'done' });
  // Everything had arrived already.
  expect(s.w.reqs.map((q) => q.route)).toEqual(['/migrate/begin', '/migrate/finish']);
});

test('an open ride pauses the move before the next request', async () => {
  const mac = macData();
  const s = await server();
  let open = false;
  s.w.fault = ({ route }) => { if (route === '/rides/ride-1') open = true; return null; };
  expect(await run(mac, s.http, { open: () => open }).out).toEqual({ state: 'paused', reason: 'ride' });
  expect(s.w.reqs.map((q) => q.route)).toEqual(['/migrate/begin', '/rides/ride-1']);
});

test('other-profile keeps the profile local and coachHome says why', async () => {
  const s = await server();
  // Account 1 already holds another profile.
  s.household.migrationDesk().begin(1, { profile: { id: 'pz', name: 'Z', ftpW: 180 }, rides: [], items: [] });
  const mac = macData();
  expect(await run(mac, s.http).out).toEqual({ state: 'refused', reason: 'other-profile' });
  expect(homeOf(mac.coach, 'pa', true)).toBe('local');
  expect(s.w.reqs.map((q) => q.route)).toEqual(['/migrate/begin']);

  // The Mac's view of the local profile carries the reason.
  const view = { type: 'coach-state', state: { profileId: 'pa' }, thinking: false, together: { summits: [] } };
  const local = { view: () => view, handle: (_m: unknown, reply: (m: unknown) => void) => reply(view) } as unknown as CoachRuntime;
  const router = createRouter({
    local, remote: () => null, mealsLocal: () => true, togetherLocal: () => true, coachDir: mac.coach,
    moving: (id) => (id === 'pa' ? { where: 'moving', done: 0, total: 0, problem: 'other-profile' } : null),
  });
  expect(router.view('pa')!.coachHome).toEqual({ where: 'moving', done: 0, total: 0, problem: 'other-profile' });
  const replies: unknown[] = [];
  router.handle({ type: 'subscribe', profileId: 'pa' }, (m) => replies.push(m));
  expect(replies).toEqual([{ ...view, coachHome: { where: 'moving', done: 0, total: 0, problem: 'other-profile' } }]);
  expect(router.view('pb')!.coachHome).toBeUndefined();
});

test('not there: without Hevy and Garmin, migration sends neither item and succeeds', async () => {
  const mac = macData({ hevy: false, garmin: false });
  const s = await server();
  expect(await run(mac, s.http).out).toEqual({ state: 'done' });
  const items = s.w.reqs.filter((q) => q.route.startsWith('/migrate/item/')).map((q) => q.route).sort();
  expect(items).toEqual(['/migrate/item/coach-state', '/migrate/item/gym-state']);
  expect(fs.existsSync(path.join(s.acc, 'hevy'))).toBe(false);
  expect(fs.existsSync(path.join(s.acc, 'garmin'))).toBe(false);
});

test('the Hevy key and Garmin tokens go only to the migration route and never into a log', async () => {
  const spies = (['log', 'info', 'warn', 'error', 'debug'] as const).map((k) => vi.spyOn(console, k));
  const stdout = vi.spyOn(process.stdout, 'write');
  const stderr = vi.spyOn(process.stderr, 'write');
  const mac = macData();
  const s = await server();
  // A failed run too: errors carry no secret either.
  let cut = true;
  s.w.fault = ({ route }) => (route === '/migrate/item/garmin-tokens' && cut ? 'after' : null);
  expect(await run(mac, s.http).out).toEqual({ state: 'failed', reason: 'offline' });
  cut = false;
  expect(await run(mac, s.http).out).toEqual({ state: 'done' });
  const secret = /12345678-1234-1234-1234-123456789abc|garmin-test-only-token/;
  for (const q of s.w.reqs) {
    if (secret.test(q.body)) expect(['/migrate/item/hevy-key', '/migrate/item/garmin-tokens']).toContain(q.route);
  }
  // The cut-off request had arrived: the server holds it, so each secret went up once.
  expect(s.w.reqs.filter((q) => secret.test(q.body)).map((q) => q.route).sort()).toEqual(['/migrate/item/garmin-tokens', '/migrate/item/hevy-key']);
  for (const spy of [...spies, stdout, stderr]) for (const call of spy.mock.calls) expect(String(call.map(String).join(' '))).not.toMatch(secret);
  // No clear copy of a secret is left in the staging folder or anywhere under the Mac's remote folder.
  const remote = files(path.join(mac.coach, 'remote'));
  for (const v of Object.values(remote)) expect(Buffer.from(v, 'base64').toString('utf8')).not.toMatch(secret);
});

test('server unreachable: nothing changes locally, and it tries again', async () => {
  const mac = macData();
  const s = await server();
  const before = userData(mac.root);
  s.w.fault = () => 'before';
  expect(await run(mac, s.http).out).toEqual({ state: 'failed', reason: 'offline' });
  expect(homeOf(mac.coach, 'pa', true)).toBe('local');
  expect(userData(mac.root)).toEqual(before);
  expect(mealsMoved(mac.coach)).toBe(false);
  s.w.fault = null;
  expect(await run(mac, s.http).out).toEqual({ state: 'done' });
  expect(homeOf(mac.coach, 'pa', true)).toBe('server');
});

test('a 401 rejects the link; a coach-side token fault (503) does not', async () => {
  const rejected = vi.fn();
  const answer = (status: number) => coachHttp({ url: 'https://coach.test', token: 't', reject: rejected, fetchFn: (async () => new Response('{}', { status })) as typeof fetch });
  await expect(answer(503).status()).rejects.toMatchObject({ kind: 'offline' });
  expect(rejected).not.toHaveBeenCalled();
  await expect(answer(401).status()).rejects.toMatchObject({ kind: 'rejected' });
  expect(rejected).toHaveBeenCalledTimes(1);
});

test('an upload is given up only when no byte moved for the idle time, never for its total time', async () => {
  const dir = temp();
  const file = path.join(dir, 'item');
  fs.writeFileSync(file, Buffer.alloc(5 * 64 * 1024, 1));
  /** Reads the body slowly: each chunk after `gapMs`, and stalls for good after `stallAfter` chunks. */
  const slow = (gapMs: number, stallAfter = Infinity) => (async (_u: string | URL, init: RequestInit = {}) => {
    let n = 0;
    for await (const _c of init.body as unknown as AsyncIterable<Uint8Array>) {
      if (++n > stallAfter) await new Promise((_, reject) => init.signal!.addEventListener('abort', () => reject(new Error('aborted'))));
      await new Promise((r) => setTimeout(r, gapMs));
      if (init.signal?.aborted) throw new Error('aborted');
    }
    return new Response('{"result":"ok"}', { status: 200 });
  }) as typeof fetch;
  // Five chunks 40 ms apart: 200 ms in total, more than the 100 ms timeout, but bytes keep moving.
  await expect(coachHttp({ url: 'https://coach.test', token: 't', timeoutMs: 100, fetchFn: slow(40) }).putItem('garmin-db', file, 'x')).resolves.toBeUndefined();
  // Stalls after two chunks: given up.
  await expect(coachHttp({ url: 'https://coach.test', token: 't', timeoutMs: 100, fetchFn: slow(10, 2) }).putItem('garmin-db', file, 'x')).rejects.toBeInstanceOf(CoachHttpError);
  // A call that is no upload has the timeout in total.
  const hang = (async (_u: string | URL, init: RequestInit = {}) => new Promise((_, reject) => init.signal!.addEventListener('abort', () => reject(new Error('aborted'))))) as typeof fetch;
  await expect(coachHttp({ url: 'https://coach.test', token: 't', timeoutMs: 50, fetchFn: hang }).status()).rejects.toMatchObject({ kind: 'offline' });
});

// ---- Fix round 1 ----

const sha = (b: string | Buffer) => createHash('sha256').update(b).digest('hex');

test('an item that is there but cannot be staged fails the move; the profile stays local', async () => {
  const mac = macData({ garmin: false });
  fs.mkdirSync(path.join(mac.root, 'garmin', 'data', 'pa'), { recursive: true });
  fs.writeFileSync(path.join(mac.root, 'garmin', 'data', 'pa', 'garmin.db'), 'this is not a database, SQLite cannot open it');
  const s = await server();
  expect(await run(mac, s.http).out).toEqual({ state: 'failed', reason: 'unreadable', items: ['garmin-db'] });
  expect(homeOf(mac.coach, 'pa', true)).toBe('local');
  expect(s.w.reqs.filter((q) => q.route === '/migrate/finish' || q.route === '/migrate/item/garmin-db')).toEqual([]);
  expect(fs.existsSync(path.join(s.acc, 'moved.json'))).toBe(false);
});

test('begin answering done for another profile is a refusal; the profile stays local', async () => {
  const s = await server();
  const other = { profile: { id: 'pz', name: 'Z', ftpW: 180 }, rides: [], items: [] };
  const desk = s.household.migrationDesk();
  desk.begin(1, other);
  expect(desk.finish(1, other).state).toBe('done');
  const mac = macData();
  expect(await run(mac, s.http).out).toEqual({ state: 'refused', reason: 'other-profile' });
  expect(homeOf(mac.coach, 'pa', true)).toBe('local');
});

test('a change here after the server switched on a cut finish is kept, logged once and shown, never dropped silently', async () => {
  const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
  const mac = macData();
  const s = await server();
  s.w.fault = ({ route }) => (route === '/migrate/finish' ? 'after' : null);
  expect(await run(mac, s.http).out).toEqual({ state: 'paused', reason: 'finish' });
  s.w.fault = null;
  // The local coach writes again before the next run.
  const newer = JSON.stringify({ profileId: 'pa', ftpW: 222 });
  fs.writeFileSync(path.join(mac.coach, 'pa.json'), newer);
  expect(await run(mac, s.http).out).toEqual({ state: 'done', drift: ['coach-state'] });
  expect(homeOf(mac.coach, 'pa', true)).toBe('server');
  // Kept here as it is; the server has the switched snapshot.
  expect(fs.readFileSync(path.join(mac.coach, 'pa.json'), 'utf8')).toBe(newer);
  expect(driftOf(mac.coach, 'pa')).toEqual(['coach-state']);
  expect(warn).toHaveBeenCalledTimes(1);
  expect(String(warn.mock.calls[0]![0])).toContain('coach-state');
  expect(String(warn.mock.calls[0]!.join(' '))).not.toContain('222');
  // Shown on the moved profile's coachHome.
  const remote = { view: () => ({ type: 'coach-state', state: { profileId: 'pa' }, thinking: false, together: { summits: [] }, coachHome: { where: 'server', online: true, sinceMs: 1, session: 'server', queued: 0, full: false } }) };
  const local = { view: () => null, handle: () => {}, accountSync: { status: () => null } } as unknown as CoachRuntime;
  const router = createRouter({ local, remote: () => remote as never, mealsLocal: () => false, togetherLocal: () => false, coachDir: mac.coach });
  expect(router.view('pa')!.coachHome).toMatchObject({ where: 'server', drift: ['coach-state'] });
});

test('a ride opening between items pauses before the next item', async () => {
  const mac = macData();
  const s = await server();
  let open = false;
  s.w.fault = ({ route }) => { if (route === '/migrate/item/coach-state') open = true; return null; };
  expect(await run(mac, s.http, { open: () => open }).out).toEqual({ state: 'paused', reason: 'ride' });
  expect(s.w.reqs.map((q) => q.route).at(-1)).toBe('/migrate/item/coach-state');
});

test('a paused move resumes with the same snapshot: nothing is staged again while the live data is unchanged', async () => {
  const mac = macData();
  const s = await server();
  expect(await run(mac, s.http, { settled: () => false }).out).toEqual({ state: 'paused', reason: 'records' });
  const staging = path.join(mac.coach, 'remote', 'pa', 'staging');
  const stats = () => fs.readdirSync(staging).sort().map((n) => { const st = fs.statSync(path.join(staging, n)); return `${n} ${st.ino} ${st.mtimeMs}`; });
  const before = stats();
  expect(await run(mac, s.http, { settled: () => false }).out).toEqual({ state: 'paused', reason: 'records' });
  expect(stats()).toEqual(before);
});

test('the snapshot file holds no hash of a secret', async () => {
  const mac = macData();
  const s = await server();
  expect(await run(mac, s.http, { settled: () => false }).out).toEqual({ state: 'paused', reason: 'records' });
  const text = fs.readFileSync(path.join(mac.coach, 'remote', 'pa', 'staging', 'snapshot.json'), 'utf8');
  expect(text).not.toContain(sha(HEVY_KEY));
  expect(text).not.toContain(sha(GARMIN_TOKENS));
  // The secrets still arrive with their hash checked.
  expect(await run(mac, s.http).out).toEqual({ state: 'done' });
  expect(openText(KEY, '1:hevy', fs.readFileSync(path.join(s.acc, 'hevy', 'pa', 'api-key'), 'utf8'))).toBe(HEVY_KEY);
});

test('without a meal file here, the empty placeholder moves the meal plan on the server', async () => {
  const mac = macData();
  const s = await server();
  expect(await run(mac, s.http).out).toEqual({ state: 'done' });
  const onServer = (id: string) => homeOf(mac.coach, id, true) === 'server';
  expect(await moveMeals({ coachDir: mac.coach, profileIds: ['pa'], onServer, http: () => s.http, nowMs: () => NOON })).toBe(true);
  expect(mealsMoved(mac.coach)).toBe(true);
  expect(fs.existsSync(path.join(s.sroot, 'household', 'meals', 'moved.json'))).toBe(true);
  expect(JSON.parse(fs.readFileSync(path.join(s.sroot, 'household', 'meals', 'household.json'), 'utf8'))).toMatchObject({ settings: {} });
  // Once moved, nothing goes again.
  s.w.reqs = [];
  expect(await moveMeals({ coachDir: mac.coach, profileIds: ['pa'], onServer, http: () => s.http, nowMs: () => NOON })).toBe(false);
  expect(s.w.reqs).toEqual([]);
});

// ---- Fix round 2 ----

test('drift survives a run that fails after the cut finish: measured from what was sent to finish', async () => {
  const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
  const mac = macData();
  const s = await server();
  // The server switches, but the answer to finish is lost.
  s.w.fault = ({ route }) => (route === '/migrate/finish' ? 'after' : null);
  expect(await run(mac, s.http).out).toEqual({ state: 'paused', reason: 'finish' });
  // The coach here writes again.
  fs.writeFileSync(path.join(mac.coach, 'pa.json'), JSON.stringify({ profileId: 'pa', ftpW: 222 }));
  // The next run takes a fresh snapshot, and its begin is cut.
  s.w.fault = ({ route }) => (route === '/migrate/begin' ? 'before' : null);
  expect(await run(mac, s.http).out).toEqual({ state: 'failed', reason: 'offline' });
  // A clean run: the server says done; the change after the switch is still known.
  s.w.fault = null;
  expect(await run(mac, s.http).out).toEqual({ state: 'done', drift: ['coach-state'] });
  expect(driftOf(mac.coach, 'pa')).toEqual(['coach-state']);
  expect(warn).toHaveBeenCalledTimes(1);
  // Gone with the move.
  expect(fs.readdirSync(path.join(mac.coach, 'remote', 'pa')).filter((n) => n.includes('sent'))).toEqual([]);
});

test('no drift is reported when the switch came from this run\'s own finish', async () => {
  const mac = macData();
  const s = await server();
  // An earlier finish was cut before the server, so it did not switch; the data changes; this run finishes itself.
  s.w.fault = ({ route }) => (route === '/migrate/finish' ? 'before' : null);
  expect(await run(mac, s.http).out).toEqual({ state: 'paused', reason: 'finish' });
  fs.writeFileSync(path.join(mac.coach, 'pa.json'), JSON.stringify({ profileId: 'pa', ftpW: 222 }));
  s.w.fault = null;
  expect(await run(mac, s.http).out).toEqual({ state: 'done' });
  expect(driftOf(mac.coach, 'pa')).toEqual([]);
  expect(JSON.parse(fs.readFileSync(path.join(s.acc, 'coach', 'pa.json'), 'utf8')).ftpW).toBe(222);
});

test('a ride opening while an item streams pauses the move for the ride, not as a failure', async () => {
  const mac = macData();
  // A large workout file: several chunks.
  fs.writeFileSync(path.join(mac.root, 'hevy', 'pa', 'workouts.json'), JSON.stringify({ workouts: 'x'.repeat(400 * 1024) }));
  let open = false;
  const s = await server({ mayContinue: () => !open });
  // The ride starts as this item's request goes out, after the check before it.
  s.w.fault = ({ route }) => { if (route === '/migrate/item/hevy-workouts') open = true; return null; };
  expect(await run(mac, s.http, { open: () => open }).out).toEqual({ state: 'paused', reason: 'ride' });
  expect(homeOf(mac.coach, 'pa', true)).toBe('local');
});
