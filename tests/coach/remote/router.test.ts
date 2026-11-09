import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, vi } from 'vitest';
import { createCoachRuntime } from '../../../src/coach/runtime';
import { AccountLinks } from '../../../src/coach/tracking/link';
import { rampTest } from '../../../src/shared/ramp';
import { homeOf, markMealsMoved, markMoved, mealFile, mealPeople, mealsDue } from '../../../src/coach/remote/home';
import { RemoteCoach, ruleFallback } from '../../../src/coach/remote/remote-coach';
import { createRouter, mealsStayLocal } from '../../../src/coach/remote/router';
import type { CoachServerMessage } from '../../../src/coach/protocol';
import { DEFAULT_MEAL_SETTINGS } from '../../../src/shared/meals';
import type { Profile } from '../../../src/shared/profiles';
import type { TrackedRecord } from '../../../src/shared/records';
import { fakeSockets } from './fake-socket';

const SERVER = 'https://pandafit.example.org/api';
const TOKEN = 'device-token-test';
const PROFILES: Profile[] = [{ id: 'pa', name: 'A', ftpW: 200 } as Profile, { id: 'pb', name: 'B', ftpW: 180 } as Profile];
const good = { id: 'ki', name: 'KI', steps: [{ kind: 'erg', durationS: 300, ftpFraction: 0.5, label: 'Warmup' }, { kind: 'erg', durationS: 1200, ftpFraction: 0.65, label: 'Locker' }] };
const answer = { phase: { name: 'Aufbau', weeksLeft: 3, goal: 'x' }, ftpForecast: [], session: good, reason: 'Von KI', change: 'neu' };
/** The Mac's own together page: local states plus the cached server states. */
const LOCAL_TOGETHER = { summits: [{ name: 'Auf dem Mac', atMs: 1 }] } as never;
const SERVER_TOGETHER = { summits: [{ name: 'Vom Server', atMs: 2 }] };
const temp = () => fs.mkdtempSync(path.join(os.tmpdir(), 'rr-'));
const settle = () => new Promise((r) => setTimeout(r, 50));

/** A finished ride for a profile, so its coach has something to plan from. */
const seedRide = (rides: string, profileId: string, rideId: string) => {
  fs.mkdirSync(path.join(rides, rideId), { recursive: true });
  const s = rampTest(200);
  fs.writeFileSync(path.join(rides, rideId, 'meta.json'), JSON.stringify({ rideId, profileId, sessionId: s.id, startedAtMs: Date.now() - 3600_000, status: 'finished' }));
  fs.writeFileSync(path.join(rides, rideId, 'session.json'), JSON.stringify({ session: s, ftpW: 200 }));
  fs.writeFileSync(path.join(rides, rideId, 'samples.jsonl'), Array.from({ length: 600 }, (_, i) => JSON.stringify({ seq: i, wallClockMs: i, rideElapsedS: i + 1, powerW: 260, cadenceRpm: 90, speedKph: 30, hrBpm: 150, targetW: 260, gradePct: null, gear: null })).join('\n') + '\n');
};
const connectHevyAndGarmin = (root: string, id: string) => {
  fs.mkdirSync(path.join(root, 'hevy', id), { recursive: true });
  fs.writeFileSync(path.join(root, 'hevy', id, 'api-key'), '00000000-0000-0000-0000-000000000000');
  fs.mkdirSync(path.join(root, 'garmin', 'tokens', id), { recursive: true });
  fs.writeFileSync(path.join(root, 'garmin', 'tokens', id, 'garmin_tokens.json'), '{}');
};
const link = (root: string, id: string) => {
  fs.mkdirSync(path.join(root, 'accounts'), { recursive: true });
  fs.writeFileSync(path.join(root, 'accounts', id), JSON.stringify({ url: SERVER, name: `konto-${id}`, token: TOKEN }));
};

/** The account api's records routes, as far as the Mac's account sync sees them. */
let posted: TrackedRecord[] = [];
let serverRecords: TrackedRecord[] = [];
beforeEach(() => {
  posted = []; serverRecords = [];
  vi.stubGlobal('fetch', vi.fn(async (input: string | URL, init?: RequestInit) => {
    const u = new URL(String(input));
    const json = (o: unknown) => new Response(JSON.stringify(o), { status: 200, headers: { 'content-type': 'application/json' } });
    if (u.pathname.endsWith('/records') && init?.method === 'POST') {
      posted.push(...(JSON.parse(String(init.body)) as { records: TrackedRecord[] }).records);
      return json({ accepted: 1, refused: [] });
    }
    if (u.pathname.endsWith('/records')) {
      const since = Number(u.searchParams.get('since') ?? 0);
      const page = serverRecords.slice(since);
      return json({ records: page, cursor: since + page.length, more: false, reset: false });
    }
    return new Response('', { status: 404 });
  }));
});
let stops: (() => void)[] = [];
afterEach(() => { for (const s of stops) s(); stops = []; vi.unstubAllGlobals(); });

/** The Mac's coach process as main.ts wires it, with a fake socket. */
const mac = (o: { moved?: string[]; linked?: string[]; meals?: string[]; mealsMoved?: boolean; timers?: (() => void)[]; pending?: number } = {}) => {
  const root = temp();
  const rides = path.join(root, 'rides');
  fs.mkdirSync(rides, { recursive: true });
  fs.writeFileSync(path.join(rides, 'profiles.json'), JSON.stringify(PROFILES));
  const coachDir = path.join(root, 'coach');
  for (const id of o.linked ?? o.moved ?? []) link(root, id);
  for (const id of o.moved ?? []) markMoved(coachDir, id, { atMs: 1, counts: { rides: 0, items: 0 } });
  if (o.meals) {
    fs.mkdirSync(path.join(coachDir, 'meals'), { recursive: true });
    fs.writeFileSync(path.join(coachDir, 'meals', 'household.json'), JSON.stringify({ settings: Object.fromEntries(o.meals.map((id) => [id, { ...DEFAULT_MEAL_SETTINGS, on: true }])), plans: {}, states: {}, notices: {}, lastAuto: null }));
  }
  if (o.mealsMoved) markMealsMoved(coachDir, 1);
  const ws = fakeSockets();
  const links = new AccountLinks({ dir: path.join(root, 'accounts') });
  const onServer = (id: string) => homeOf(coachDir, id, links.status(id).state !== 'idle') === 'server';
  const ask = vi.fn(async () => answer);
  const spawnFn = vi.fn(() => { throw new Error('no python in tests'); });
  const hevyFetch = vi.fn(async () => new Response('{}', { status: 200 }));
  const w = { ride: false, fromServer: [] as [string, CoachServerMessage][] };
  const remotes = new Map<string, RemoteCoach>();
  const remote = (id: string): RemoteCoach | null => {
    let r = remotes.get(id) ?? null;
    if (!onServer(id)) { r?.stop(); remotes.delete(id); return null; }
    if (!r) {
      r = new RemoteCoach({
        dir: path.join(coachDir, 'remote', id), profileId: id, url: () => links.url(id), token: () => links.token(id), reject: () => links.reject(id),
        mayWrite: () => !w.ride, fallback: () => ruleFallback(coachDir, id, 200, Date.now()), nowMs: () => Date.now(),
        WebSocketImpl: ws.Impl, onMessage: (m) => { w.fromServer.push([id, m]); if (m.type !== 'coach-state') router.answered(id, m); },
      });
      remotes.set(id, r);
      stops.push(() => r!.stop());
      r.start();
    }
    return r;
  };
  const mealsLocal = () => mealsStayLocal(coachDir);
  const runtime = createCoachRuntime({
    root, profiles: () => PROFILES, noOpenRide: () => !w.ride, ask,
    python: process.execPath, garminScripts: path.join(root, 'scripts'),
    links, meals: 'own', together: () => LOCAL_TOGETHER,
    spawnFn: spawnFn as never, fetchFn: hevyFetch as never, waitMs: 0,
    coachHere: (id) => !onServer(id), mealsHere: mealsLocal,
  });
  const togetherLocal = () => PROFILES.some((p) => !onServer(p.id));
  const router = createRouter({ local: runtime, remote, mealsLocal, togetherLocal, coachDir, ...(o.pending !== undefined ? { pendingRides: () => o.pending! } : {}), ...(o.timers ? { setTimer: (fn: () => void) => { o.timers!.push(fn); } } : {}) });
  const replies: CoachServerMessage[] = [];
  const handle = (m: Parameters<typeof router.handle>[0]) => router.handle(m, (r) => replies.push(r));
  return { root, rides, coachDir, ws, links, runtime, router, remote, ask, spawnFn, hevyFetch, w, replies, handle, onServer };
};

test('an unlinked profile goes to the local coach exactly as today, and no socket is opened', () => {
  const m = mac();
  m.handle({ type: 'subscribe', profileId: 'pa' });
  const v = m.replies.find((r) => r.type === 'coach-state');
  expect(v).toEqual(m.runtime.view('pa'));
  expect(m.router.view('pa')).toEqual(m.runtime.view('pa'));
  expect(v).not.toHaveProperty('coachHome');
  m.handle({ type: 'note', profileId: 'pa', text: 'lokal' });
  expect(m.runtime.coachState('pa')!.notes.map((n) => n.text)).toEqual(['lokal']);
  expect(m.ws.sockets).toEqual([]);
  // Linked but not moved: still local.
  const l = mac({ linked: ['pa'] });
  l.handle({ type: 'subscribe', profileId: 'pa' });
  expect(l.router.view('pa')).toEqual(l.runtime.view('pa'));
  expect(l.ws.sockets).toEqual([]);
});

test('a moved profile subscribes to the server and gets its coach-state with coachHome { where: \'server\', online: true, session: \'server\' }', () => {
  const m = mac({ moved: ['pa'] });
  m.handle({ type: 'subscribe', profileId: 'pa' });
  expect(m.ws.sockets).toHaveLength(1);
  expect(m.ws.last().url).toBe('wss://pandafit.example.org/api/coach');
  m.ws.last().open();
  expect(m.ws.last().sent).toEqual([{ type: 'subscribe', profileId: 'pa' }]);
  const state = { ...ruleFallback(temp(), 'pa', 250, Date.now()), ftpW: 250 };
  m.ws.last().answer({ type: 'coach-state', state, thinking: false, together: { summits: [] }, account: { state: 'linked', name: 'intern' } });
  const v = m.router.view('pa')!;
  expect(v.state.ftpW).toBe(250);
  expect(v.coachHome).toMatchObject({ where: 'server', online: true, session: 'server' });
  // The link shown is this Mac's.
  expect(v.account).toMatchObject({ state: 'linked', name: 'konto-pa' });
  // The other profile stays local.
  expect(m.router.view('pb')).toEqual(m.runtime.view('pb'));
  expect(m.runtime.view('pa')).toBeNull();
});

test('the local coach does not plan, sync Hevy or Garmin, or upload to Garmin for a moved profile', async () => {
  // The same Mac with the profile still local plans, and its Hevy and Garmin syncs start.
  const local = mac({ linked: ['pa'] });
  seedRide(local.rides, 'pa', 'ride-1000');
  connectHevyAndGarmin(local.root, 'pa');
  local.runtime.scan();
  await vi.waitFor(() => expect(local.ask).toHaveBeenCalled());
  await vi.waitFor(() => expect(local.spawnFn).toHaveBeenCalled());
  await vi.waitFor(() => expect(local.hevyFetch).toHaveBeenCalled());

  const m = mac({ moved: ['pa'] });
  seedRide(m.rides, 'pa', 'ride-1000');
  connectHevyAndGarmin(m.root, 'pa');
  m.runtime.scan();
  await settle();
  m.runtime.scan();
  await settle();
  m.handle({ type: 'garmin-upload', profileId: 'pa', rideId: 'ride-1000' });
  m.handle({ type: 'feedback', profileId: 'pa', rideId: 'ride-1000', rating: 'right' });
  m.runtime.rideReplaced('pa', 'ride-1000');
  await settle();
  expect(m.ask).not.toHaveBeenCalled();
  expect(m.spawnFn).not.toHaveBeenCalled();
  expect(m.hevyFetch).not.toHaveBeenCalled();
  expect(fs.existsSync(path.join(m.coachDir, 'pa.json'))).toBe(false);
  // The feedback waits for the server instead.
  expect(m.remote('pa')!.status().queued).toBe(1);
});

test('gym-preview and gym-confirm offline answer null and failed at once; hevy-connect offline is refused', () => {
  const m = mac({ moved: ['pa'] });
  m.handle({ type: 'subscribe', profileId: 'pa' });
  m.ws.last().end(1013);
  m.replies.length = 0;
  m.handle({ type: 'gym-preview', profileId: 'pa' });
  m.handle({ type: 'gym-confirm', profileId: 'pa', name: 'Tag A' });
  expect(m.replies).toEqual([{ type: 'gym-preview', preview: null }, { type: 'gym-confirm-result', result: 'failed' }]);
  m.handle({ type: 'hevy-connect', profileId: 'pa', key: '00000000-0000-0000-0000-000000000000' });
  expect(m.remote('pa')!.status().queued).toBe(0);
  expect(fs.existsSync(path.join(m.root, 'hevy', 'pa', 'api-key'))).toBe(false);
  expect(m.hevyFetch).not.toHaveBeenCalled();
});

test('online, a request goes to the server and its answer reaches the one who asked', () => {
  const m = mac({ moved: ['pa'] });
  m.handle({ type: 'subscribe', profileId: 'pa' });
  m.ws.last().open();
  m.replies.length = 0;
  m.handle({ type: 'gym-preview', profileId: 'pa' });
  expect(m.ws.last().sent.at(-1)).toEqual({ type: 'gym-preview', profileId: 'pa' });
  expect(m.replies).toEqual([]);
  m.ws.last().answer({ type: 'gym-preview', preview: null });
  expect(m.replies).toEqual([{ type: 'gym-preview', preview: null }]);
});

test('records stay local and sync as before, but no plan or complaint record is written for a moved profile', async () => {
  const m = mac({ moved: ['pa'] });
  // The local coach knew a complaint from before the move.
  fs.mkdirSync(m.coachDir, { recursive: true });
  const before = ruleFallback(m.coachDir, 'pa', 200, Date.now());
  const atMs = Date.now() - 3600_000;
  fs.writeFileSync(path.join(m.coachDir, 'pa.json'), JSON.stringify({ ...before, complaints: [{ id: 'c-1', text: 'Knie', status: 'active', startedMs: atMs, updatedMs: atMs }] }));
  serverRecords = [{ kind: 'complaint', id: 'c-2', updatedMs: Date.now(), deleted: false, body: { text: 'Schulter', status: 'active', atMs: Date.now() } }];
  const workout: TrackedRecord = { kind: 'workout', id: 'w-1', updatedMs: Date.now(), deleted: false, body: { id: 'w-1', title: 'Tag A', startMs: atMs, endMs: Date.now(), source: 'pandafit', exercises: [] } };
  m.handle({ type: 'records-put', requestId: 'r1', profileId: 'pa', record: workout });
  expect(m.replies.find((r) => r.type === 'records-put-result')).toMatchObject({ requestId: 'r1', ok: true });
  m.runtime.scan();
  await vi.waitFor(() => expect(posted.map((r) => r.id)).toContain('w-1'));
  await settle();
  expect(posted.filter((r) => r.kind === 'plan' || r.kind === 'complaint')).toEqual([]);
  expect(m.runtime.records.all('pa', 'plan')).toEqual([]);
  // The phone's complaint is kept as a record but does not reach the local coach.
  expect(m.runtime.records.all('pa', 'complaint').map((r) => r.id)).toEqual(['c-2']);
  const local = JSON.parse(fs.readFileSync(path.join(m.coachDir, 'pa.json'), 'utf8')) as { complaints: { id: string }[] };
  expect(local.complaints.map((c) => c.id)).toEqual(['c-1']);
  // The finished workout did not start a local gym plan.
  expect(m.ask).not.toHaveBeenCalled();
  // Records are not sent to the coach socket.
  expect(m.ws.sockets.flatMap((s) => s.types())).not.toContain('records-put');
});

test('unlinking a moved profile returns it to the local coach', () => {
  const m = mac({ moved: ['pa'] });
  m.handle({ type: 'subscribe', profileId: 'pa' });
  const socket = m.ws.last();
  socket.open();
  expect(m.onServer('pa')).toBe(true);
  m.replies.length = 0;
  m.handle({ type: 'account-unlink', profileId: 'pa' });
  expect(m.onServer('pa')).toBe(false);
  expect(m.replies.find((r) => r.type === 'coach-state')).toEqual(m.runtime.view('pa'));
  expect(m.links.status('pa').state).toBe('idle');
  expect(fs.existsSync(path.join(m.coachDir, 'remote', 'pa', 'moved.json'))).toBe(false);
  expect(m.runtime.view('pa')).not.toBeNull();
  expect(m.router.view('pa')).toEqual(m.runtime.view('pa'));
  expect(m.router.view('pa')).not.toHaveProperty('coachHome');
  expect(socket.closed).not.toBeNull();
  m.handle({ type: 'note', profileId: 'pa', text: 'wieder lokal' });
  expect(m.runtime.coachState('pa')!.notes.map((n) => n.text)).toEqual(['wieder lokal']);
  // Linking again alone does not move it back: only a finished move does.
  link(m.root, 'pa');
  expect(m.onServer('pa')).toBe(false);
});

test('the meal plan is due to move once everyone listed in its settings moved, meals on or off, and stays moved', () => {
  const coachDir = path.join(temp(), 'coach');
  fs.mkdirSync(path.join(coachDir, 'meals'), { recursive: true });
  fs.writeFileSync(mealFile(coachDir), JSON.stringify({ settings: { pa: { ...DEFAULT_MEAL_SETTINGS, on: true }, pb: { ...DEFAULT_MEAL_SETTINGS, on: false } } }));
  // pb has meals off and is still here: it still counts, as on the server.
  expect(mealPeople(coachDir, ['pa'])).toEqual(['pa', 'pb']);
  expect(mealsDue(coachDir, ['pa', 'pb'], (id) => id === 'pa')).toBe(false);
  expect(mealsStayLocal(coachDir)).toBe(true);
  expect(mealsDue(coachDir, ['pa', 'pb'], () => true)).toBe(true);
  // Everyone moved but the meal file is not up yet: the meal plan is still the Mac's.
  expect(mealsStayLocal(coachDir)).toBe(true);
  markMealsMoved(coachDir, 1);
  expect(mealsStayLocal(coachDir)).toBe(false);
  expect(mealsDue(coachDir, ['pa', 'pb'], () => true)).toBe(false);
  // A new profile here turning meals on does not take the meal plan back.
  fs.writeFileSync(mealFile(coachDir), JSON.stringify({ settings: { pa: {}, pb: {}, pc: { ...DEFAULT_MEAL_SETTINGS, on: true } } }));
  expect(mealsStayLocal(coachDir)).toBe(false);
  // Without a meal file, every profile on this Mac counts.
  fs.rmSync(mealFile(coachDir));
  expect(mealPeople(coachDir, ['pa', 'pb'])).toEqual(['pa', 'pb']);
});

test('meals stay local until the meal plan moved', () => {

  // pb is still here: pa's meal ticks stay local and its view shows the local meal plan.
  const m = mac({ moved: ['pa'], meals: ['pa', 'pb'] });
  m.handle({ type: 'subscribe', profileId: 'pa' });
  m.ws.last().open();
  m.ws.last().answer({ type: 'coach-state', state: ruleFallback(temp(), 'pa', 200, Date.now()), thinking: false, together: { summits: [] }, meals: null });
  expect(m.router.view('pa')!.meals).toEqual(m.runtime.mealsView('pa'));
  expect(m.router.view('pa')!.meals).not.toBeNull();
  m.handle({ type: 'meals-settings', profileId: 'pa', settings: { ...DEFAULT_MEAL_SETTINGS, on: true } });
  expect(m.ws.last().types()).toEqual(['subscribe']);
  expect(m.remote('pa')!.status().queued).toBe(0);

  // Both moved: the meal plan is the server's.
  const all = mac({ moved: ['pa', 'pb'], meals: ['pa', 'pb'], mealsMoved: true });
  all.handle({ type: 'subscribe', profileId: 'pa' });
  all.ws.last().open();
  all.ws.last().answer({ type: 'coach-state', state: ruleFallback(temp(), 'pa', 200, Date.now()), thinking: false, together: { summits: [] }, meals: null });
  expect(all.router.view('pa')!.meals).toBeNull();
  all.handle({ type: 'meals-item', profileId: 'pa', week: '2026-11-02', item: 'Haferflocken', state: 'gekauft' });
  expect(all.ws.last().types()).toEqual(['subscribe', 'queued']);
});

test('mixed household: while someone is still coached here, the moved profile sees the Mac\'s together page', () => {
  const m = mac({ moved: ['pa'] });
  m.handle({ type: 'subscribe', profileId: 'pa' });
  m.ws.last().open();
  m.ws.last().answer({ type: 'coach-state', state: ruleFallback(temp(), 'pa', 200, Date.now()), thinking: false, together: SERVER_TOGETHER });
  expect(m.router.view('pa')!.together).toEqual(LOCAL_TOGETHER);
  // Offline from the cache too.
  m.ws.last().end(1013);
  expect(m.router.view('pa')!.together).toEqual(LOCAL_TOGETHER);
});

test('once everyone has moved, the together page is the server\'s', () => {
  const m = mac({ moved: ['pa', 'pb'] });
  m.handle({ type: 'subscribe', profileId: 'pa' });
  m.ws.last().open();
  m.ws.last().answer({ type: 'coach-state', state: ruleFallback(temp(), 'pa', 200, Date.now()), thinking: false, together: SERVER_TOGETHER });
  expect(m.router.view('pa')!.together).toEqual(SERVER_TOGETHER);
});

test('gym-preview and ride-detail offline get an empty answer at once', () => {
  const m = mac({ moved: ['pa'] });
  m.handle({ type: 'subscribe', profileId: 'pa' });
  m.ws.last().end(1013);
  m.replies.length = 0;
  m.handle({ type: 'gym-preview', profileId: 'pa' });
  m.handle({ type: 'ride-detail', profileId: 'pa', rideId: 'ride-1000' });
  expect(m.replies).toEqual([{ type: 'gym-preview', preview: null }, { type: 'ride-detail', detail: { rideId: 'ride-1000', points: [] } }]);
});

test('a request that timed out gets its empty answer, and its late answer never reaches the next request', () => {
  const timers: (() => void)[] = [];
  const m = mac({ moved: ['pa'], timers });
  m.handle({ type: 'subscribe', profileId: 'pa' });
  m.ws.last().open();
  const ask = (msg: Parameters<typeof m.router.handle>[0]) => { const got: CoachServerMessage[] = []; m.router.handle(msg, (r) => got.push(r)); return got; };
  // Ride A times out, then ride B is asked.
  const a = ask({ type: 'ride-detail', profileId: 'pa', rideId: 'ride-a' });
  timers.shift()!();
  expect(a).toEqual([{ type: 'ride-detail', detail: { rideId: 'ride-a', points: [] } }]);
  const b = ask({ type: 'ride-detail', profileId: 'pa', rideId: 'ride-b' });
  m.ws.last().answer({ type: 'ride-detail', detail: { rideId: 'ride-a', points: [{ t: 1, powerW: 100, hrBpm: null, cadenceRpm: null }] } });
  expect(b).toEqual([]);
  expect(a).toHaveLength(1);
  m.ws.last().answer({ type: 'ride-detail', detail: { rideId: 'ride-b', points: [] } });
  expect(b).toEqual([{ type: 'ride-detail', detail: { rideId: 'ride-b', points: [] } }]);
  // Without a key: the late answer to a timed-out preview is dropped, the next one goes to the next request.
  const p1 = ask({ type: 'gym-preview', profileId: 'pa' });
  timers.pop()!();
  expect(p1).toEqual([{ type: 'gym-preview', preview: null }]);
  const p2 = ask({ type: 'gym-preview', profileId: 'pa' });
  const late = { type: 'gym-preview', preview: { workout: { name: 'spät' }, edited: false } };
  m.ws.last().answer(late);
  expect(p2).toEqual([]);
  m.ws.last().answer({ type: 'gym-preview', preview: null });
  expect(p2).toEqual([{ type: 'gym-preview', preview: null }]);
  // A request on a connection that broke never eats an answer on the next one.
  const p3 = ask({ type: 'gym-preview', profileId: 'pa' });
  m.ws.last().end(1006);
  const s2 = m.ws.sockets.length;
  m.remote('pa')!.stop(); m.remote('pa')!.start();
  expect(m.ws.sockets.length).toBe(s2 + 1);
  m.ws.last().open();
  const p4 = ask({ type: 'gym-preview', profileId: 'pa' });
  m.ws.last().answer({ type: 'gym-preview', preview: null });
  expect(p4).toEqual([{ type: 'gym-preview', preview: null }]);
  expect(p3).toEqual([{ type: 'gym-preview', preview: null }]);
});

test('unlinking sets the cached state and the queue aside, so a later move starts clean', () => {
  const m = mac({ moved: ['pa'] });
  m.handle({ type: 'subscribe', profileId: 'pa' });
  m.ws.last().open();
  m.ws.last().answer({ type: 'coach-state', state: ruleFallback(temp(), 'pa', 200, Date.now()), thinking: false, together: SERVER_TOGETHER });
  m.ws.last().end(1013);
  m.handle({ type: 'note', profileId: 'pa', text: 'vor dem Trennen' });
  const dir = path.join(m.coachDir, 'remote', 'pa');
  expect(fs.existsSync(path.join(dir, 'state.json'))).toBe(true);
  expect(fs.existsSync(path.join(dir, 'queue.json'))).toBe(true);
  m.handle({ type: 'account-unlink', profileId: 'pa' });
  expect(fs.existsSync(path.join(dir, 'state.json'))).toBe(false);
  expect(fs.existsSync(path.join(dir, 'queue.json'))).toBe(false);
  // Set aside, not deleted: the unsent note can still be looked at.
  const aside = fs.readdirSync(dir).filter((f) => f.startsWith('queue.unlinked-'));
  expect(aside).toHaveLength(1);
  expect(fs.readFileSync(path.join(dir, aside[0]!), 'utf8')).toContain('vor dem Trennen');
  // Moved again later: no old state, no old writes.
  link(m.root, 'pa');
  markMoved(m.coachDir, 'pa', { atMs: 2, counts: { rides: 0, items: 0 } });
  expect(m.router.view('pa')!.coachHome).toMatchObject({ session: 'rules', queued: 0 });
});

test('a moved profile\'s home carries the rides waiting for upload; a local profile has none', () => {
  const m = mac({ moved: ['pa'], pending: 2 });
  m.handle({ type: 'subscribe', profileId: 'pa' });
  m.ws.last().open();
  const state = { ...ruleFallback(temp(), 'pa', 250, Date.now()), ftpW: 250 };
  m.ws.last().answer({ type: 'coach-state', state, thinking: false, together: { summits: [] } });
  expect(m.router.view('pa')!.coachHome).toMatchObject({ where: 'server', pendingRides: 2 });
  const local = mac({ pending: 2 });
  local.handle({ type: 'subscribe', profileId: 'pa' });
  expect(JSON.stringify(local.router.view('pa'))).not.toContain('pendingRides');
});
