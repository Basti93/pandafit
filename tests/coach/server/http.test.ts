import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import type { FastifyInstance } from 'fastify';
import { afterEach, beforeEach, vi } from 'vitest';
import WebSocket from 'ws';
import { Household } from '../../../src/coach/server/household';
import { buildCoachServer } from '../../../src/coach/server/http';
import type { CoachServerMessage } from '../../../src/shared/coach-protocol';
import type { Profile } from '../../../src/shared/profiles';
import { DEFAULT_MEAL_SETTINGS } from '../../../src/shared/meals';
import { taggingAi } from '../meals/fake-ai';

const KEY = Buffer.alloc(32, 7);
const TOKEN = 'b'.repeat(64);
const HEVY_KEY = '12345678-1234-1234-1234-123456789abc';
const NOON = new Date(2026, 10, 3, 12, 0).getTime();
const P1: Profile = { id: 'pa', name: 'A', ftpW: 200 };
const P2: Profile = { id: 'pb', name: 'B', ftpW: 180 };
const temp = () => fs.mkdtempSync(path.join(os.tmpdir(), 'cs-'));
const settle = (ms = 80) => new Promise((r) => setTimeout(r, ms));

const seedAccount = (root: string, id: number, profile: Profile, moved = true) => {
  const dir = path.join(root, 'accounts', String(id));
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, 'profile.json'), JSON.stringify(profile));
  if (moved) fs.writeFileSync(path.join(dir, 'moved.json'), JSON.stringify({ atMs: 1 }));
  return dir;
};

type Conn = { ws: WebSocket; frames: CoachServerMessage[]; raw: string[]; closed: Promise<number>; opened: Promise<void> };

let app: FastifyInstance | null = null;
let conns: Conn[] = [];
beforeEach(() => {
  // The records sync to the api: an empty, friendly api.
  vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({ records: [], cursor: 0, more: false, refused: [] }), { status: 200, headers: { 'content-type': 'application/json' } })));
});
afterEach(async () => {
  for (const c of conns) c.ws.terminate();
  conns = [];
  await app?.close();
  app = null;
  vi.unstubAllGlobals();
});

const start = async (o: { accounts?: [number, Profile, boolean?][]; now?: { ms: number }; meals?: boolean; pingMs?: number; idleMs?: number } = {}) => {
  const root = temp();
  for (const [id, p, moved] of o.accounts ?? [[1, P1], [2, P2]]) seedAccount(root, id, p, moved !== false);
  if (o.meals) {
    const dir = path.join(root, 'household', 'meals');
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, 'household.json'), JSON.stringify({ settings: { pa: { ...DEFAULT_MEAL_SETTINGS, on: true }, pb: { ...DEFAULT_MEAL_SETTINGS, on: true } }, plans: {}, states: {}, notices: {}, lastAuto: null }));
    fs.writeFileSync(path.join(dir, 'moved.json'), JSON.stringify({ atMs: 1 }));
  }
  const clock = o.now ?? { ms: NOON };
  const ask = vi.fn(async (): Promise<unknown> => { throw new Error('no Claude in tests'); });
  const hevyFetch = vi.fn(async () => new Response(JSON.stringify({ data: {} }), { status: 200, headers: { 'content-type': 'application/json' } }));
  const household = new Household({
    root, secretKey: KEY, runDir: temp(), python: process.execPath, garminScripts: path.join(root, 'scripts'),
    apiUrl: 'http://api.test:8081', internalToken: TOKEN, ask, nowMs: () => clock.ms,
    spawnFn: vi.fn(() => { throw new Error('no python in tests'); }) as never, fetchFn: hevyFetch as never, waitMs: 0,
  });
  app = buildCoachServer({ household, internalToken: TOKEN, nowMs: () => clock.ms, pingMs: o.pingMs, idleMs: o.idleMs });
  await app.listen({ port: 0, host: '127.0.0.1' });
  const port = (app.server.address() as { port: number }).port;
  const connect = (headers: Record<string, string>, opts: { autoPong?: boolean } = {}): Conn => {
    const ws = new WebSocket(`ws://127.0.0.1:${port}/ws`, { headers, ...opts });
    const frames: CoachServerMessage[] = [];
    const raw: string[] = [];
    ws.on('message', (d) => { raw.push(String(d)); frames.push(JSON.parse(String(d)) as CoachServerMessage); });
    const closed = new Promise<number>((r) => ws.on('close', (code) => r(code)));
    const opened = new Promise<void>((r) => ws.on('open', () => r()));
    ws.on('error', () => {});
    const c = { ws, frames, raw, closed, opened };
    conns.push(c);
    return c;
  };
  const as = async (accountId: number): Promise<Conn> => {
    const c = connect({ 'x-pandafit-internal': TOKEN, 'x-pandafit-account': String(accountId) });
    await c.opened;
    return c;
  };
  const send = (c: Conn, m: unknown) => c.ws.send(JSON.stringify(m));
  return { root, household, clock, ask, hevyFetch, connect, as, send, port };
};

const states = (c: Conn) => c.frames.filter((f): f is Extract<CoachServerMessage, { type: 'coach-state' }> => f.type === 'coach-state');

test('without the internal token every route but /healthz answers 401 and the socket closes with 4401', async () => {
  const t = await start();
  expect((await app!.inject({ method: 'GET', url: '/healthz' })).json()).toEqual({ ok: true });
  for (const headers of [{}, { 'x-pandafit-account': '1' }, { 'x-pandafit-internal': 'c'.repeat(64), 'x-pandafit-account': '1' }, { 'x-pandafit-internal': TOKEN }, { 'x-pandafit-internal': TOKEN, 'x-pandafit-account': '1.5' }, { 'x-pandafit-internal': TOKEN, 'x-pandafit-account': 'abc' }]) {
    expect((await app!.inject({ method: 'GET', url: '/status', headers })).statusCode).toBe(401);
    expect((await app!.inject({ method: 'GET', url: '/nothing-here', headers })).statusCode).toBe(401);
  }
  // Counts only with the token.
  expect((await app!.inject({ method: 'GET', url: '/healthz?counts=1' })).statusCode).toBe(401);
  const bad: Record<string, string>[] = [{}, { 'x-pandafit-account': '1' }, { 'x-pandafit-internal': 'c'.repeat(64), 'x-pandafit-account': '1' }, { 'x-pandafit-internal': TOKEN, 'x-pandafit-account': 'abc' }];
  for (const headers of bad) {
    expect(await t.connect(headers).closed).toBe(4401);
  }
  const ok = await app!.inject({ method: 'GET', url: '/status', headers: { 'x-pandafit-internal': TOKEN, 'x-pandafit-account': '1' } });
  expect(ok.json()).toEqual({ profileId: 'pa', moved: true });
});

test('a socket for an account that has not moved closes with 4404', async () => {
  const t = await start({ accounts: [[1, P1], [3, { id: 'pc', name: 'C', ftpW: 150 }, false]] });
  expect(await t.connect({ 'x-pandafit-internal': TOKEN, 'x-pandafit-account': '3' }).closed).toBe(4404);
  expect(await t.connect({ 'x-pandafit-internal': TOKEN, 'x-pandafit-account': '9' }).closed).toBe(4404);
  const status = async (account: string) => (await app!.inject({ method: 'GET', url: '/status', headers: { 'x-pandafit-internal': TOKEN, 'x-pandafit-account': account } })).json();
  // Account 3 is bound to its profile (its move has begun) but has not moved.
  expect(await status('3')).toEqual({ profileId: 'pc', moved: false });
  expect(await status('9')).toEqual({ profileId: null, moved: false });
});

test('subscribe with the account\'s profile id answers coach-state with profile', async () => {
  const t = await start();
  const c = await t.as(1);
  t.send(c, { type: 'subscribe', profileId: 'pa' });
  await vi.waitFor(() => expect(states(c).length).toBeGreaterThan(0));
  const s = states(c)[0]!;
  expect(s.state.profileId).toBe('pa');
  expect(s.profile).toEqual({ ...P1, ftpW: s.state.ftpW });
});

test('a message for another profile id is refused and changes nothing', async () => {
  const t = await start();
  const c1 = await t.as(1), c2 = await t.as(2);
  t.household.account(2)!.runtime.handle({ type: 'subscribe', profileId: 'pb' }, () => {});
  const before = JSON.stringify(t.household.account(2)!.runtime.coachState('pb')!.notes);
  t.send(c1, { type: 'note', profileId: 'pb', text: 'fremde Notiz' });
  t.send(c1, { type: 'subscribe', profileId: 'pb' });
  t.send(c1, { type: 'queued', atMs: NOON, message: { type: 'note', profileId: 'pb', text: 'fremde Notiz' } });
  t.send(c1, { type: 'profile-update', profileId: 'pb', profile: { ...P1, name: 'Fremd' } });
  await settle();
  expect(t.household.account(1)!.profile().name).toBe('A');
  expect(t.household.account(2)!.profile().name).toBe('B');
  expect(JSON.stringify(t.household.account(2)!.runtime.coachState('pb')!.notes)).toBe(before);
  expect(c1.frames).toEqual([]);
  expect(c2.frames).toEqual([]);
});

test('a socket of account 2 never receives account 1\'s coach-state', async () => {
  const t = await start();
  const c1 = await t.as(1), c2 = await t.as(2);
  t.send(c1, { type: 'subscribe', profileId: 'pa' });
  t.send(c2, { type: 'subscribe', profileId: 'pb' });
  await vi.waitFor(() => expect(states(c2).length).toBeGreaterThan(0));
  t.send(c1, { type: 'note', profileId: 'pa', text: 'Notiz nur für eins' });
  await vi.waitFor(() => expect(JSON.stringify(states(c1))).toContain('Notiz nur für eins'));
  t.household.scan();
  await settle();
  expect(states(c2).every((s) => s.state.profileId === 'pb' && s.profile?.id === 'pb')).toBe(true);
  expect(c2.raw.join('\n')).not.toContain('Notiz nur für eins');
  expect(c2.frames.some((f) => f.type === 'records-changed' && f.profileId !== 'pb')).toBe(false);
});

test('hevy-connect stores the key sealed and no frame ever carries it', async () => {
  const t = await start();
  const c = await t.as(1);
  t.send(c, { type: 'subscribe', profileId: 'pa' });
  t.send(c, { type: 'hevy-connect', profileId: 'pa', key: HEVY_KEY });
  const file = path.join(t.root, 'accounts', '1', 'hevy', 'pa', 'api-key');
  await vi.waitFor(() => expect(fs.existsSync(file)).toBe(true));
  const stored = fs.readFileSync(file, 'utf8');
  expect(stored.startsWith('pfs1.')).toBe(true);
  expect(stored).not.toContain(HEVY_KEY);
  await settle();
  t.household.scan();
  await settle();
  expect(c.raw.length).toBeGreaterThan(0);
  expect(c.raw.join('\n')).not.toContain(HEVY_KEY);
});

test('profile-update stores profile.json; coach-state.profile carries it with ftpW from the coach state', async () => {
  const t = await start();
  const c = await t.as(1);
  t.send(c, { type: 'subscribe', profileId: 'pa' });
  t.send(c, { type: 'set-ftp', profileId: 'pa', ftpW: 250 });
  t.send(c, { type: 'profile-update', profileId: 'pa', profile: { ...P1, name: 'Anna', ftpW: 999 } });
  await vi.waitFor(() => expect(states(c).at(-1)?.profile?.name).toBe('Anna'));
  expect(JSON.parse(fs.readFileSync(path.join(t.root, 'accounts', '1', 'profile.json'), 'utf8')).name).toBe('Anna');
  expect(states(c).at(-1)!.profile!.ftpW).toBe(250);
  expect(states(c).at(-1)!.state.ftpW).toBe(250);
  // Another profile id is never bound to this account.
  t.send(c, { type: 'profile-update', profileId: 'pa', profile: { ...P2 } });
  await settle();
  expect(JSON.parse(fs.readFileSync(path.join(t.root, 'accounts', '1', 'profile.json'), 'utf8')).id).toBe('pa');
});

test('queued: a change older than the item\'s last change is skipped', async () => {
  const t = await start({ now: { ms: 1000 } });
  t.clock.ms = 1000;
  const c = await t.as(1);
  t.send(c, { type: 'subscribe', profileId: 'pa' });
  t.send(c, { type: 'note', profileId: 'pa', text: 'Mein Knie schmerzt seit gestern' });
  const coach = () => t.household.account(1)!.runtime.coachState('pa')!;
  await vi.waitFor(() => expect(coach().complaints?.length).toBe(1));
  const id = coach().complaints![0]!.id;
  t.clock.ms = 2000;
  t.send(c, { type: 'complaint-update', profileId: 'pa', id, status: 'over' });
  await vi.waitFor(() => expect(coach().complaints![0]!.status).toBe('over'));
  t.clock.ms = 3000;
  t.send(c, { type: 'queued', atMs: 1000, message: { type: 'complaint-update', profileId: 'pa', id, status: 'healing' } });
  await settle();
  expect(coach().complaints![0]!.status).toBe('over');
  // A newer queued change still wins.
  t.send(c, { type: 'queued', atMs: 2500, message: { type: 'complaint-update', profileId: 'pa', id, status: 'healing' } });
  await vi.waitFor(() => expect(coach().complaints![0]!.status).toBe('healing'));
});

const json = (x: unknown) => new Response(JSON.stringify(x), { status: 200, headers: { 'content-type': 'application/json' } });

test('queued: an older Mac complaint change never undoes a newer change the phone made through the records', async () => {
  const t = await start({ now: { ms: 1000 } });
  const c = await t.as(1);
  t.send(c, { type: 'subscribe', profileId: 'pa' });
  t.send(c, { type: 'note', profileId: 'pa', text: 'Mein Knie schmerzt seit gestern' });
  const a = t.household.account(1)!;
  const coach = () => a.runtime.coachState('pa')!;
  await vi.waitFor(() => expect(coach().complaints?.length).toBe(1));
  const cpl = coach().complaints![0]!;
  // The phone marked it over at 50 s; the api serves that record once.
  const phone = { kind: 'complaint', id: cpl.id, updatedMs: 50_000, deleted: false, body: { text: cpl.text, status: 'over', atMs: cpl.startedMs } };
  const sent: { id: string; updatedMs: number; body: { status: string } }[] = [];
  let served = false;
  vi.stubGlobal('fetch', vi.fn(async (_url: string, init?: RequestInit) => {
    if (init?.method === 'POST') { sent.push(...(JSON.parse(String(init.body)) as { records: typeof sent }).records); return json({ refused: [] }); }
    const records = served ? [] : [phone];
    served = true;
    return json({ records, cursor: 1, more: false });
  }));
  t.clock.ms = 100_000;
  t.household.scan();
  await vi.waitFor(() => expect(coach().complaints![0]!.status).toBe('over'));
  await vi.waitFor(() => expect(a.runtime.accountSync.status('pa').lastSyncMs).toBe(100_000));
  sent.length = 0; // the complaint as it was before the phone's change went up in that first sync
  // The Mac's change was made at 40 s, before the phone's, and arrives only now.
  t.send(c, { type: 'queued', qid: 'q-old', atMs: 40_000, message: { type: 'complaint-update', profileId: 'pa', id: cpl.id, status: 'healing' } });
  await vi.waitFor(() => expect(c.frames.some((f) => f.type === 'queued-ack' && f.qid === 'q-old')).toBe(true));
  expect(coach().complaints![0]!).toMatchObject({ status: 'over', updatedMs: 50_000 });
  // The next sync sends nothing stale back to the phone.
  t.clock.ms = 200_000;
  t.household.scan();
  await vi.waitFor(() => expect(a.runtime.accountSync.status('pa').lastSyncMs).toBe(200_000));
  expect(sent.filter((r) => r.id === cpl.id && r.body.status !== 'over')).toEqual([]);
  expect(a.runtime.records.all('pa', 'complaint').find((r) => r.id === cpl.id)).toMatchObject({ updatedMs: 50_000, body: { status: 'over' } });
  // A queued change newer than the phone's wins and keeps its own time, on the server and in the exported record.
  t.send(c, { type: 'queued', qid: 'q-new', atMs: 60_000, message: { type: 'complaint-update', profileId: 'pa', id: cpl.id, status: 'healing' } });
  await vi.waitFor(() => expect(coach().complaints![0]!).toMatchObject({ status: 'healing', updatedMs: 60_000 }));
  t.clock.ms = 300_000;
  t.household.scan();
  await vi.waitFor(() => expect(a.runtime.accountSync.status('pa').lastSyncMs).toBe(300_000));
  expect(a.runtime.records.all('pa', 'complaint').find((r) => r.id === cpl.id)).toMatchObject({ updatedMs: 60_000, body: { status: 'healing' } });
});

test('queued: notes and answers are always applied, in order', async () => {
  const t = await start();
  const c = await t.as(1);
  t.send(c, { type: 'subscribe', profileId: 'pa' });
  t.send(c, { type: 'note', profileId: 'pa', text: 'live' });
  t.send(c, { type: 'queued', atMs: NOON - 3000, message: { type: 'note', profileId: 'pa', text: 'erste' } });
  t.send(c, { type: 'queued', atMs: NOON - 5000, message: { type: 'note', profileId: 'pa', text: 'zweite' } });
  t.send(c, { type: 'queued', atMs: NOON - 4000, message: { type: 'answer-question', profileId: 'pa', questionId: 'q1', text: 'Antwort eins' } });
  t.send(c, { type: 'queued', atMs: NOON - 9000, message: { type: 'answer-question', profileId: 'pa', questionId: 'q2', text: 'Antwort zwei' } });
  const coach = () => t.household.account(1)!.runtime.coachState('pa')!;
  await vi.waitFor(() => expect(coach().motives?.length).toBe(2));
  expect(coach().notes.map((n) => n.text)).toEqual(['live', 'erste', 'zweite']);
  expect(coach().motives!.map((m) => m.text)).toEqual(['Antwort eins', 'Antwort zwei']);
});

test('queued messages outside QUEUEABLE are ignored', async () => {
  const t = await start();
  const c = await t.as(1);
  t.send(c, { type: 'queued', atMs: NOON, message: { type: 'subscribe', profileId: 'pa' } });
  t.send(c, { type: 'queued', atMs: NOON, message: { type: 'hevy-connect', profileId: 'pa', key: HEVY_KEY } });
  t.send(c, { type: 'queued', atMs: NOON, message: { type: 'ride-detail', profileId: 'pa', rideId: 'ride-1' } });
  t.send(c, { type: 'queued', atMs: NOON, message: { type: 'queued', atMs: NOON, message: { type: 'note', profileId: 'pa', text: 'doppelt verpackt' } } });
  t.send(c, { type: 'queued', atMs: NOON, message: { type: 'records-list', requestId: 'r', profileId: 'pa', kind: 'workout' } });
  t.send(c, { type: 'queued', atMs: 'gestern', message: { type: 'note', profileId: 'pa', text: 'ohne Zeit' } });
  await settle();
  expect(c.frames).toEqual([]);
  expect(t.hevyFetch).not.toHaveBeenCalled();
  expect(fs.existsSync(path.join(t.root, 'accounts', '1', 'hevy', 'pa', 'api-key'))).toBe(false);
  const notes = t.household.account(1)!.runtime.coachState('pa')?.notes ?? [];
  expect(notes.map((n) => n.text)).toEqual([]);
});

test('every queued message with a qid gets its queued-ack: applied, stale or invalid', async () => {
  const t = await start({ now: { ms: 1000 } });
  const c = await t.as(1);
  t.send(c, { type: 'note', profileId: 'pa', text: 'Mein Knie schmerzt seit gestern' });
  const coach = () => t.household.account(1)!.runtime.coachState('pa')!;
  await vi.waitFor(() => expect(coach().complaints?.length).toBe(1));
  const id = coach().complaints![0]!.id;
  t.clock.ms = 2000;
  t.send(c, { type: 'complaint-update', profileId: 'pa', id, status: 'over' });
  await vi.waitFor(() => expect(coach().complaints![0]!.status).toBe('over'));
  t.clock.ms = 3000;
  t.send(c, { type: 'queued', qid: 'q-applied', atMs: 2900, message: { type: 'note', profileId: 'pa', text: 'unterwegs' } });
  t.send(c, { type: 'queued', qid: 'q-stale', atMs: 1000, message: { type: 'complaint-update', profileId: 'pa', id, status: 'healing' } });
  t.send(c, { type: 'queued', qid: 'q-outside', atMs: 2900, message: { type: 'hevy-connect', profileId: 'pa', key: HEVY_KEY } });
  t.send(c, { type: 'queued', qid: 'q-other', atMs: 2900, message: { type: 'note', profileId: 'pb', text: 'fremd' } });
  t.send(c, { type: 'queued', qid: 'q-no-time', atMs: 'gestern', message: { type: 'note', profileId: 'pa', text: 'ohne Zeit' } });
  t.send(c, { type: 'queued', qid: 'q-broken', atMs: 2900, message: 'kaputt' });
  await vi.waitFor(() => expect(c.frames.filter((f) => f.type === 'queued-ack')).toHaveLength(6));
  expect(c.frames.flatMap((f) => (f.type === 'queued-ack' ? [f.qid] : []))).toEqual(['q-applied', 'q-stale', 'q-outside', 'q-other', 'q-no-time', 'q-broken']);
  expect(coach().notes.map((n) => n.text)).toEqual(['Mein Knie schmerzt seit gestern', 'unterwegs']);
  expect(coach().complaints![0]!.status).toBe('over');
  // Sent again after a reconnect, the same change is skipped by the clock and still acknowledged.
  t.send(c, { type: 'queued', qid: 'q-stale', atMs: 1000, message: { type: 'complaint-update', profileId: 'pa', id, status: 'healing' } });
  await vi.waitFor(() => expect(c.frames.filter((f) => f.type === 'queued-ack')).toHaveLength(7));
  expect(coach().complaints![0]!.status).toBe('over');
});

test('a re-sent queued entry that was already handled is acked again but not applied twice, also after a restart', async () => {
  const t = await start();
  const c = await t.as(1);
  const note = { type: 'queued', qid: 'q-note', atMs: NOON - 1000, message: { type: 'note', profileId: 'pa', text: 'nur einmal' } };
  const summit = { type: 'queued', qid: 'q-summit', atMs: NOON - 500, message: { type: 'pass-summit', profileId: 'pa', passId: 'stelvio' } };
  t.send(c, note);
  t.send(c, summit);
  const acks = (x: Conn) => x.frames.filter((f) => f.type === 'queued-ack');
  await vi.waitFor(() => expect(acks(c)).toHaveLength(2));
  // The connection broke before the client saw the acks: it sends both again.
  const c2 = await t.as(1);
  t.send(c2, note);
  t.send(c2, summit);
  await vi.waitFor(() => expect(acks(c2)).toHaveLength(2));
  const coach = () => t.household.account(1)!.runtime.coachState('pa')!;
  expect(coach().notes.map((n) => n.text)).toEqual(['nur einmal']);
  expect(fs.existsSync(path.join(t.root, 'accounts', '1', 'qids.json'))).toBe(true);
  // A coach restart remembers them: the server reads the file again.
  for (const x of conns) x.ws.terminate();
  await app!.close();
  app = buildCoachServer({ household: t.household, internalToken: TOKEN, nowMs: () => t.clock.ms });
  await app.listen({ port: t.port, host: '127.0.0.1' });
  const c3 = await t.as(1);
  t.send(c3, note);
  await vi.waitFor(() => expect(acks(c3)).toHaveLength(1));
  await settle();
  expect(coach().notes.map((n) => n.text)).toEqual(['nur einmal']);
});

test('a queued message without a usable qid gets no ack', async () => {
  const t = await start();
  const c = await t.as(1);
  t.send(c, { type: 'queued', atMs: NOON, message: { type: 'note', profileId: 'pa', text: 'ohne Kennung' } });
  t.send(c, { type: 'queued', qid: 42, atMs: NOON, message: { type: 'note', profileId: 'pa', text: 'Zahl' } });
  t.send(c, { type: 'queued', qid: 'x'.repeat(200), atMs: NOON, message: { type: 'note', profileId: 'pa', text: 'zu lang' } });
  await settle();
  expect(c.frames.filter((f) => f.type === 'queued-ack')).toEqual([]);
});

test('a binary or broken frame is ignored and the socket stays open', async () => {
  const t = await start();
  const c = await t.as(1);
  c.ws.send(Buffer.from([1, 2, 3]));
  c.ws.send('{nope');
  t.send(c, null);
  t.send(c, { type: 'subscribe', profileId: 'pa' });
  await vi.waitFor(() => expect(states(c).length).toBeGreaterThan(0));
  expect(c.ws.readyState).toBe(WebSocket.OPEN);
});

test('/healthz?counts=1 with the token gives each account\'s counts', async () => {
  const t = await start();
  t.household.account(1)!.runtime.handle({ type: 'subscribe', profileId: 'pa' }, () => {});
  const started = vi.spyOn(t.household, 'start');
  const res = await app!.inject({ method: 'GET', url: '/healthz?counts=1', headers: { 'x-pandafit-internal': TOKEN } });
  expect(res.statusCode).toBe(200);
  const body = res.json() as { ok: boolean; accounts: Record<string, { profileId: string; rides: number; records: number; coach: boolean }> };
  expect(body.ok).toBe(true);
  expect(body.accounts['1']).toMatchObject({ profileId: 'pa', rides: 0, records: 0, coach: true });
  expect(body.accounts['2']).toMatchObject({ profileId: 'pb', rides: 0 });
  // A probe reads the disk only: it starts no account's coach.
  expect(started).not.toHaveBeenCalled();
  // One parser decides: a repeated counts=1 is still a counts request and still needs the token.
  expect((await app!.inject({ method: 'GET', url: '/healthz?counts=1&counts=1' })).statusCode).toBe(401);
  const twice = await app!.inject({ method: 'GET', url: '/healthz?counts=1&counts=1', headers: { 'x-pandafit-internal': TOKEN } });
  expect(twice.json()).toHaveProperty('accounts');
});

test('a probe before any socket starts no coach and counts every moved account from the disk', async () => {
  const t = await start({ accounts: [[1, P1], [3, { id: 'pc', name: 'C', ftpW: 150 }, false]] });
  const started = vi.spyOn(t.household, 'start');
  const res = await app!.inject({ method: 'GET', url: '/healthz?counts=1', headers: { 'x-pandafit-internal': TOKEN } });
  expect(Object.keys((res.json() as { accounts: object }).accounts)).toEqual(['1']);
  expect(started).not.toHaveBeenCalled();
});

test('the shared meal plan has one clock: a stale queued tick from account 1 does not undo a newer live tick from account 2', async () => {
  const t = await start({ meals: true });
  const c1 = await t.as(1), c2 = await t.as(2);
  t.send(c1, { type: 'subscribe', profileId: 'pa' });
  t.send(c2, { type: 'subscribe', profileId: 'pb' });
  await vi.waitFor(() => expect(states(c1).at(-1)?.meals).toBeTruthy());
  await vi.waitFor(() => expect(states(c2).at(-1)?.meals).toBeTruthy());
  const week = states(c1).at(-1)!.meals!.currentWeek;
  t.send(c1, { type: 'meals-replan', profileId: 'pa', week });
  const item = () => t.household.account(2)!.runtime.view('pb')!.meals!.weeks.find((w) => w.plan.week === week)?.state.items['Haferflocken']?.state;
  await vi.waitFor(() => expect(t.household.account(1)!.runtime.view('pa')!.meals!.weeks.some((w) => w.plan.week === week)).toBe(true), { timeout: 3000 });
  t.clock.ms = NOON + 2000;
  t.send(c2, { type: 'meals-item', profileId: 'pb', week, item: 'Haferflocken', state: 'gekauft' });
  await vi.waitFor(() => expect(item()).toBe('gekauft'));
  t.clock.ms = NOON + 3000;
  t.send(c1, { type: 'queued', atMs: NOON + 1000, message: { type: 'meals-item', profileId: 'pa', week, item: 'Haferflocken', state: 'offen' } });
  await settle();
  expect(item()).toBe('gekauft');
  // A newer queued tick from account 1 still wins.
  t.send(c1, { type: 'queued', atMs: NOON + 2500, message: { type: 'meals-item', profileId: 'pa', week, item: 'Haferflocken', state: 'da' } });
  await vi.waitFor(() => expect(item()).toBe('da'));
});

test('the clock moves only for a change that was applied', async () => {
  const t = await start();
  const c = await t.as(1);
  t.send(c, { type: 'subscribe', profileId: 'pa' });
  // A refused profile-update (another profile) at 2000 ...
  t.clock.ms = NOON + 2000;
  t.send(c, { type: 'profile-update', profileId: 'pa', profile: { ...P2 } });
  // ... and a meal tick before the household's meals moved change nothing, so they stamp nothing.
  t.send(c, { type: 'meals-item', profileId: 'pa', week: '2026-11-02', item: 'Haferflocken', state: 'da' });
  await settle();
  const clocks = [path.join(t.root, 'accounts', '1', 'clock.json'), path.join(t.root, 'household', 'meals', 'clock.json')];
  for (const f of clocks) if (fs.existsSync(f)) expect(fs.readFileSync(f, 'utf8')).not.toMatch(/profile|meal:/);
  // An older queued profile-update still applies.
  t.send(c, { type: 'queued', atMs: NOON + 1000, message: { type: 'profile-update', profileId: 'pa', profile: { ...P1, name: 'Alt' } } });
  await vi.waitFor(() => expect(t.household.account(1)!.profile().name).toBe('Alt'));
});

test('a socket that misses a pong is closed; one that answers stays', async () => {
  const t = await start({ pingMs: 40 });
  const headers = { 'x-pandafit-internal': TOKEN, 'x-pandafit-account': '1' };
  const silent = t.connect(headers, { autoPong: false });
  await silent.opened;
  const live = await t.as(1);
  expect(await silent.closed).toBe(1006);
  await settle(200);
  expect(live.ws.readyState).toBe(WebSocket.OPEN);
});

test('no total time limit on a request: a slow steady upload is answered, a stalled one is cut', async () => {
  // The idle limit shortened to 300 ms: the steady body takes about 2 s, every gap is shorter.
  const t = await start({ idleMs: 300 });
  expect(app!.server.requestTimeout).toBe(0);
  const trickle = (o: { chunks: number; everyMs: number; stallAfter?: number }) => new Promise<{ status: number } | { cut: string }>((resolve) => {
    const body = Buffer.from(JSON.stringify({ rideId: 'x', pad: 'p'.repeat(o.chunks * 100) }));
    const size = Math.ceil(body.length / o.chunks);
    const req = http.request({ host: '127.0.0.1', port: t.port, method: 'PUT', path: '/rides/x', headers: { 'x-pandafit-internal': TOKEN, 'x-pandafit-account': '1', 'content-type': 'application/json', 'content-length': String(body.length) } }, (res) => {
      res.resume();
      res.on('end', () => resolve({ status: res.statusCode! }));
    });
    req.on('error', (e) => resolve({ cut: e.message }));
    let i = 0;
    const next = () => {
      if (o.stallAfter !== undefined && i === o.stallAfter) return;
      req.write(body.subarray(i * size, (i + 1) * size));
      if (++i < o.chunks) setTimeout(next, o.everyMs); else req.end();
    };
    next();
  });
  // Answered at all (the ride id is no valid one), not cut.
  expect(await trickle({ chunks: 20, everyMs: 100 })).toEqual({ status: 409 });
  expect(await trickle({ chunks: 20, everyMs: 50, stallAfter: 3 })).toHaveProperty('cut');
});

test('the default idle limit is 60 s, with no total time limit', async () => {
  await start();
  expect(app!.server.requestTimeout).toBe(0);
  expect(app!.server.timeout).toBe(60_000);
});

const seedRide = (dir: string, rideId: string, profileId: string, status: string, folder = rideId) => {
  const d = path.join(dir, 'rides', folder);
  fs.mkdirSync(d, { recursive: true });
  fs.writeFileSync(path.join(d, 'meta.json'), JSON.stringify({ rideId, profileId, sessionId: 'ki', startedAtMs: 5, status }));
  fs.writeFileSync(path.join(d, 'session.json'), JSON.stringify({ session: { id: 'ki', name: 'KI', steps: [] }, ftpW: 200 }));
  fs.writeFileSync(path.join(d, 'samples.jsonl'), '{"seq":0}\n');
};

test('GET /rides and /rides/:id need the login and show only the account\'s own closed rides', async () => {
  const t = await start();
  const a1 = path.join(t.root, 'accounts', '1'), a2 = path.join(t.root, 'accounts', '2');
  seedRide(a1, 'ride-10', 'pa', 'finished');
  seedRide(a1, 'ride-11', 'pa', 'aborted');
  seedRide(a1, 'ride-12', 'pa', 'open');
  seedRide(a1, 'ride-13', 'pb', 'finished');
  seedRide(a1, 'ride-10', 'pa', 'finished', 'ride-10.replaced-99');
  seedRide(a2, 'ride-20', 'pb', 'finished');
  const h = (account: string) => ({ 'x-pandafit-internal': TOKEN, 'x-pandafit-account': account });
  for (const url of ['/rides', '/rides/ride-10']) {
    expect((await app!.inject({ method: 'GET', url })).statusCode).toBe(401);
    expect((await app!.inject({ method: 'GET', url, headers: { 'x-pandafit-internal': 'c'.repeat(64), 'x-pandafit-account': '1' } })).statusCode).toBe(401);
  }
  const list = (await app!.inject({ method: 'GET', url: '/rides', headers: h('1') })).json() as { rides: { rideId: string; sha256: string; status: string; startedAtMs: number }[] };
  expect(list.rides.map((r) => [r.rideId, r.status, r.startedAtMs])).toEqual([['ride-10', 'finished', 5], ['ride-11', 'aborted', 5]]);
  const one = await app!.inject({ method: 'GET', url: '/rides/ride-10', headers: h('1') });
  expect(one.statusCode).toBe(200);
  expect(one.json()).toMatchObject({ v: 1, rideId: 'ride-10', sha256: list.rides[0]!.sha256 });
  // Not open, not another profile's, not another account's, no traversal.
  for (const id of ['ride-12', 'ride-13', 'ride-20', 'ride-10.replaced-99', '..%2F2', 'nope'])
    expect((await app!.inject({ method: 'GET', url: `/rides/${id}`, headers: h('1') })).statusCode, id).toBe(404);
  expect((await app!.inject({ method: 'GET', url: '/rides/ride-20', headers: h('2') })).statusCode).toBe(200);
  expect((await app!.inject({ method: 'GET', url: '/rides', headers: h('9') })).statusCode).toBe(404);
});

test('live: the running ride of one account reaches only that account\'s other connections and commands go back to its Mac', async () => {
  const t = await start();
  const mac1 = await t.as(1), phone1 = await t.as(1), mac2 = await t.as(2), phone2 = await t.as(2);
  t.send(phone1, { type: 'live-watch' });
  t.send(phone2, { type: 'live-watch' });
  await settle();
  const state = { rideId: 'ride-1', profileId: 'pa', atMs: NOON, elapsedS: 5, powerW: 150, hrBpm: 120, cadenceRpm: 80, targetW: 160, step: { index: 0, count: 2, remainingS: 55 } };
  t.send(mac1, { type: 'live-state', profileId: 'pa', state });
  await vi.waitFor(() => expect(phone1.frames.some((f) => f.type === 'live-state')).toBe(true));
  expect(phone2.frames.some((f) => f.type === 'live-state')).toBe(false);
  expect(mac2.frames.some((f) => f.type === 'live-state')).toBe(false);
  expect(mac1.frames.some((f) => f.type === 'live-state')).toBe(false);
  t.send(phone1, { type: 'live-command', profileId: 'pa', id: 'x1', rideId: 'ride-1', atMs: NOON, kind: 'skip' });
  await vi.waitFor(() => expect(mac1.frames.some((f) => f.type === 'live-command')).toBe(true));
  t.send(mac1, { type: 'live-ack', profileId: 'pa', id: 'x1', ok: true });
  await vi.waitFor(() => expect(phone1.frames.some((f) => f.type === 'live-ack' && f.ok)).toBe(true));
  // The other account's phone cannot command the first account's ride.
  t.send(phone2, { type: 'live-command', profileId: 'pb', id: 'y1', rideId: 'ride-1', atMs: NOON, kind: 'skip' });
  await vi.waitFor(() => expect(phone2.frames.some((f) => f.type === 'live-ack' && !f.ok)).toBe(true));
  expect(mac1.frames.filter((f) => f.type === 'live-command')).toHaveLength(1);
  // A phone that comes later sees the fresh state; after 10 s it would not.
  const late = await t.as(1);
  t.send(late, { type: 'live-watch' });
  await vi.waitFor(() => expect(late.frames.some((f) => f.type === 'live-state')).toBe(true));
});

describe('GET /recipes/:id/image', () => {
  const H = (account: number, token = TOKEN) => ({ 'x-pandafit-internal': token, 'x-pandafit-account': String(account) });
  const JPEG = Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), Buffer.alloc(16, 1)]);
  const seed = async (t: Awaited<ReturnType<typeof start>>, check: boolean) => {
    const store = t.household.meals()!.recipes()!;
    const rec = (n: number) => ({ '@type': 'Recipe', name: `Erfundener Topf ${n}`, recipeYield: '2', recipeIngredient: [`${100 + n} g Linsen`, '1 Zwiebel', '1 EL Öl'], recipeInstructions: ['Alles kochen.'] });
    const a = await store.add({ source: 'collection', url: 'https://rezepte.example/a', recipe: rec(1) });
    const b = await store.add({ source: 'collection', url: 'https://rezepte.example/b', recipe: rec(2) });
    if (a.status !== 'saved' || b.status !== 'saved') throw new Error('seed');
    if (check) await store.tagIds([a.recipe.id], taggingAi());
    store.setImage(a.recipe.id, { bytes: JPEG, type: 'image/jpeg' });
    store.setImage(b.recipe.id, { bytes: JPEG, type: 'image/jpeg' });
    return { withPicture: a.recipe.id, unchecked: b.recipe.id, store };
  };

  test('needs the internal token and a moved account, and serves the picture with caching headers and an ETag', async () => {
    const t = await start({ meals: true, accounts: [[1, P1], [3, { id: 'pc', name: 'C', ftpW: 150 }, false]] });
    const { withPicture } = await seed(t, true);
    const url = `/recipes/${withPicture}/image`;
    expect((await app!.inject({ method: 'GET', url })).statusCode).toBe(401);
    expect((await app!.inject({ method: 'GET', url, headers: H(1, 'c'.repeat(64)) })).statusCode).toBe(401);
    expect((await app!.inject({ method: 'GET', url, headers: H(3) })).statusCode).toBe(404);
    const ok = await app!.inject({ method: 'GET', url, headers: H(1) });
    expect(ok.statusCode).toBe(200);
    expect(ok.headers['content-type']).toBe('image/jpeg');
    expect(ok.headers['cache-control']).toBe('private, max-age=604800');
    expect(ok.rawPayload.equals(JPEG)).toBe(true);
    const etag = String(ok.headers.etag);
    expect(etag).toMatch(/^"[0-9a-f]{20}"$/);
    const again = await app!.inject({ method: 'GET', url, headers: { ...H(1), 'if-none-match': etag } });
    expect(again.statusCode).toBe(304);
  });

  test('answers 404 without a picture, for an unknown or malformed id, and for a recipe the AI has not confirmed', async () => {
    const t = await start({ meals: true });
    const { withPicture, unchecked, store } = await seed(t, true);
    for (const id of [unchecked, 'c-00000000000000', '..%2F..%2Fetc%2Fpasswd', 'x']) expect((await app!.inject({ method: 'GET', url: `/recipes/${id}/image`, headers: H(1) })).statusCode).toBe(404);
    store.database().prepare('DELETE FROM images WHERE recipe_id = ?').run(withPicture);
    expect((await app!.inject({ method: 'GET', url: `/recipes/${withPicture}/image`, headers: H(1) })).statusCode).toBe(404);
  });

  test('is a 404 before the household\'s meals moved', async () => {
    const t = await start();
    expect((await app!.inject({ method: 'GET', url: '/recipes/c-00000000000000/image', headers: H(1) })).statusCode).toBe(404);
    void t;
  });
});
