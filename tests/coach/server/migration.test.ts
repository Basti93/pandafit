import { createHash } from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { PassThrough, Readable } from 'node:stream';
import type { FastifyInstance } from 'fastify';
import { afterEach, beforeEach, expect, test, vi } from 'vitest';
import { cleanSettings } from '../../../src/coach/meals/meal-coach';
import { MEAL_SYSTEM_PROMPT } from '../../../src/coach/meals/prompt';
import { rideHash, type RideFiles, type RideUpload } from '../../../src/coach/ride-upload-format';
import { openText } from '../../../src/coach/secrets/secret-box';
import { Household } from '../../../src/coach/server/household';
import { buildCoachServer } from '../../../src/coach/server/http';
import type { Manifest, MigrationDesk, MigrationItem } from '../../../src/coach/server/migration';
import { storeRide } from '../../../src/coach/server/ride-store';
import { DEFAULT_MEAL_SETTINGS } from '../../../src/shared/meals';
import type { Profile } from '../../../src/shared/profiles';

const KEY = Buffer.alloc(32, 7);
const TOKEN = 'c'.repeat(64);
const HEVY_KEY = '12345678-1234-1234-1234-123456789abc';
const NOON = new Date(2026, 10, 3, 12, 0).getTime();
const P1: Profile = { id: 'pa', name: 'A', ftpW: 200 };
const P2: Profile = { id: 'pb', name: 'B', ftpW: 180 };
const temp = () => fs.mkdtempSync(path.join(os.tmpdir(), 'mig-'));
const sha = (b: Buffer | string) => createHash('sha256').update(b).digest('hex');
const session = { id: 'ki', name: 'KI', steps: [{ kind: 'erg', durationS: 600, ftpFraction: 0.65, label: 'Locker' }] };

const rideFiles = (rideId: string, profileId = 'pa'): RideFiles => {
  const startedAtMs = NOON - 3600_000;
  const samples = Array.from({ length: 600 }, (_, i) => ({ seq: i, wallClockMs: startedAtMs + i * 1000, rideElapsedS: i + 1, powerW: 130, cadenceRpm: 90, speedKph: 30, hrBpm: 130, targetW: 130, gradePct: null, gear: null }));
  return {
    'meta.json': JSON.stringify({ rideId, profileId, sessionId: 'ki', startedAtMs, status: 'finished' }),
    'session.json': JSON.stringify({ session, ftpW: 200 }),
    'samples.jsonl': samples.map((s) => JSON.stringify(s)).join('\n') + '\n',
    'events.jsonl': '',
  };
};
const rideUpload = (rideId: string, profileId = 'pa'): RideUpload => {
  const files = rideFiles(rideId, profileId);
  return { v: 1, rideId, files, fit: null, sha256: rideHash(files) };
};

const garminDb = (dir: string): Buffer => {
  const file = path.join(dir, 'source.db');
  const db = new DatabaseSync(file);
  db.exec('CREATE TABLE daily (day TEXT PRIMARY KEY, resting_hr INTEGER); INSERT INTO daily VALUES (\'2026-11-01\', 50);');
  db.close();
  return fs.readFileSync(file);
};

type Items = Partial<Record<MigrationItem, Buffer>>;
const fullItems = (dir: string): Items => ({
  'coach-state': Buffer.from(JSON.stringify({ ftpW: 200, phase: 'Aufbau' })),
  'gym-state': Buffer.from(JSON.stringify({ sessions: [] })),
  'garmin-db': garminDb(dir),
  'hevy-key': Buffer.from(`${HEVY_KEY}\n`),
  'garmin-tokens': Buffer.from(JSON.stringify({ oauth: 'test-only' })),
});
const manifestOf = (profile: Profile, items: Items, rides: RideUpload[]): Manifest => ({
  profile,
  rides: rides.map((r) => ({ rideId: r.rideId, sha256: r.sha256 })),
  items: Object.entries(items).map(([name, b]) => ({ name: name as MigrationItem, sha256: sha(b!), bytes: b!.length })),
});

let app: FastifyInstance | null = null;
beforeEach(() => {
  vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({ records: [], cursor: 0, more: false, refused: [] }), { status: 200, headers: { 'content-type': 'application/json' } })));
});
afterEach(async () => { await app?.close(); app = null; vi.unstubAllGlobals(); });

const make = (o: { root?: string; nowMs?: number; ask?: (input: { systemPrompt: string }) => Promise<unknown> } = {}) => {
  const root = o.root ?? temp();
  const ask = vi.fn(o.ask ?? (async (): Promise<unknown> => { throw new Error('no Claude in tests'); }));
  const household = new Household({
    root, secretKey: KEY, runDir: temp(), python: process.execPath, garminScripts: path.join(root, 'scripts'),
    apiUrl: 'http://api.test:8081', internalToken: TOKEN, ask: ask as never, nowMs: () => o.nowMs ?? NOON,
    spawnFn: (() => { throw new Error('no python in tests'); }) as never,
    fetchFn: (async () => new Response('', { status: 401 })) as never, waitMs: 0,
  });
  const desk: MigrationDesk = household.migrationDesk();
  const acc = (id: number) => path.join(root, 'accounts', String(id));
  const put = (accountId: number, name: string, body: Buffer, hash = sha(body)) => desk.putItem(accountId, name, Readable.from([body]), hash);
  const putAll = async (accountId: number, items: Items) => { for (const [n, b] of Object.entries(items)) expect(await put(accountId, n, b!)).toBe('ok'); };
  const storeRides = (accountId: number, profileId: string, rides: RideUpload[]) => {
    for (const r of rides) expect(storeRide({ ridesDir: path.join(acc(accountId), 'rides'), profileId, upload: r, nowMs: NOON }).ok).toBe(true);
  };
  return { root, household, desk, ask, acc, put, putAll, storeRides };
};

const tree = (dir: string): string[] => {
  const out: string[] = [];
  const walk = (d: string, rel: string) => {
    let names: string[];
    try { names = fs.readdirSync(d); } catch { return; }
    for (const n of names.sort()) {
      const p = path.join(d, n);
      if (fs.statSync(p).isDirectory()) walk(p, `${rel}${n}/`); else out.push(`${rel}${n}`);
    }
  };
  walk(dir, '');
  return out;
};

test('begin binds the profile id to the account; another profile id is refused with other-profile', () => {
  const t = make();
  const m = manifestOf(P1, {}, []);
  expect(t.desk.begin(1, m)).toEqual({ state: 'open', haveItems: [], haveRides: [] });
  expect(t.desk.boundProfileId(1)).toBe('pa');
  // The same account with another profile id.
  expect(t.desk.begin(1, manifestOf(P2, {}, []))).toEqual({ state: 'refused', reason: 'other-profile' });
  expect(t.desk.boundProfileId(1)).toBe('pa');
  // Another account with the profile id account 1 holds.
  expect(t.desk.begin(2, manifestOf(P1, {}, []))).toEqual({ state: 'refused', reason: 'other-profile' });
  expect(t.desk.boundProfileId(2)).toBeNull();
  expect(t.desk.begin(2, manifestOf(P2, {}, []))).toEqual({ state: 'open', haveItems: [], haveRides: [] });
  // Repeating begin is safe.
  expect(t.desk.begin(1, m)).toEqual({ state: 'open', haveItems: [], haveRides: [] });
});

test('begin refuses a manifest with an unsafe profile id or an unknown item', () => {
  const t = make();
  expect(() => t.desk.begin(1, manifestOf({ ...P1, id: '../x' }, {}, []))).toThrow();
  expect(() => t.desk.begin(1, { ...manifestOf(P1, {}, []), items: [{ name: 'passwd' as MigrationItem, sha256: sha('x'), bytes: 1 }] })).toThrow();
  expect(t.desk.boundProfileId(1)).toBeNull();
});

test('begin reports the items and rides the server holds with the same hash', async () => {
  const t = make();
  const dir = temp();
  const items = fullItems(dir);
  const rides = [rideUpload('ride-1'), rideUpload('ride-2')];
  t.desk.begin(1, manifestOf(P1, items, rides));
  expect(await t.put(1, 'coach-state', items['coach-state']!)).toBe('ok');
  expect(await t.put(1, 'hevy-key', items['hevy-key']!)).toBe('ok');
  t.storeRides(1, 'pa', [rides[0]!]);
  const changed = { ...items, 'gym-state': Buffer.from('{"changed":true}') };
  expect(await t.put(1, 'gym-state', items['gym-state']!)).toBe('ok');
  const other = rideUpload('ride-2');
  other.files['events.jsonl'] = '{"x":1}\n';
  other.sha256 = rideHash(other.files);
  t.storeRides(1, 'pa', [other]);

  const r = t.desk.begin(1, manifestOf(P1, changed, rides));
  expect(r.state).toBe('open');
  if (r.state !== 'open') return;
  // gym-state and ride-2 are held with another hash, so they are not reported.
  expect(r.haveItems.sort()).toEqual(['coach-state', 'hevy-key']);
  expect(r.haveRides).toEqual(['ride-1']);
});

test('an item with a wrong hash is refused and not kept', async () => {
  const t = make();
  const body = Buffer.from('{"ftpW":200}');
  // Before begin the desk is closed.
  expect(await t.put(1, 'coach-state', body)).toBe('closed');
  t.desk.begin(1, manifestOf(P1, { 'coach-state': body }, []));
  expect(await t.put(1, 'coach-state', body, sha('something else'))).toBe('hash');
  expect(await t.put(1, 'hevy-key', Buffer.from(HEVY_KEY), sha('nope'))).toBe('hash');
  expect(tree(path.join(t.acc(1), 'migrate'))).toEqual([]);
  const r = t.desk.begin(1, manifestOf(P1, { 'coach-state': body }, []));
  expect(r).toEqual({ state: 'open', haveItems: [], haveRides: [] });
  // An unknown name never reaches the disk.
  expect(await t.put(1, '../../profile.json', body)).toBe('unknown');
  expect(await t.put(1, 'constructor', body)).toBe('unknown');
  expect(tree(path.join(t.acc(1), 'migrate'))).toEqual([]);
});

test('a secret is sealed as it arrives; its clear text never stays on the disk', async () => {
  const t = make();
  t.desk.begin(1, manifestOf(P1, {}, []));
  expect(await t.put(1, 'hevy-key', Buffer.from(HEVY_KEY))).toBe('ok');
  expect(await t.put(1, 'garmin-tokens', Buffer.from('{"oauth":"test-only"}'))).toBe('ok');
  for (const f of tree(t.acc(1))) expect(fs.readFileSync(path.join(t.acc(1), f), 'utf8')).not.toMatch(/12345678-1234|test-only/);
});

test('finish lists what is missing or differs and switches nothing', async () => {
  const t = make();
  const dir = temp();
  const items = fullItems(dir);
  const rides = [rideUpload('ride-1'), rideUpload('ride-2')];
  const m = manifestOf(P1, items, rides);
  t.desk.begin(1, m);
  const { 'garmin-db': _db, ...rest } = items;
  await t.putAll(1, rest);
  // garmin-db arrives with other bytes than the manifest names.
  expect(await t.put(1, 'garmin-db', Buffer.from('other bytes'))).toBe('ok');
  t.storeRides(1, 'pa', [rides[0]!]);

  const before = tree(t.acc(1));
  expect(t.desk.finish(1, m)).toEqual({ state: 'missing', items: ['garmin-db'], rides: ['ride-2'] });
  expect(tree(t.acc(1))).toEqual(before);
  expect(fs.existsSync(path.join(t.acc(1), 'moved.json'))).toBe(false);
  expect(t.household.account(1)).toBeNull();
});

test('finish with everything matching installs, seals and starts the account\'s coach', async () => {
  const t = make();
  const dir = temp();
  const items = fullItems(dir);
  const rides = [rideUpload('ride-1'), rideUpload('ride-2')];
  const m = manifestOf(P1, items, rides);
  t.desk.begin(1, m);
  await t.putAll(1, items);
  t.storeRides(1, 'pa', rides);

  expect(t.desk.finish(1, m)).toEqual({ state: 'done', counts: { rides: 2, items: 5 } });
  const a = t.household.account(1);
  expect(a).not.toBeNull();
  expect(a!.profileId).toBe('pa');
  const acc = t.acc(1);
  expect(fs.readFileSync(path.join(acc, 'coach', 'pa.json'))).toEqual(items['coach-state']);
  expect(fs.readFileSync(path.join(acc, 'coach', 'gym', 'pa.json'))).toEqual(items['gym-state']);
  expect(fs.readFileSync(path.join(acc, 'garmin', 'data', 'pa', 'garmin.db'))).toEqual(items['garmin-db']);
  const apiKey = fs.readFileSync(path.join(acc, 'hevy', 'pa', 'api-key'), 'utf8');
  expect(apiKey.startsWith('pfs1.')).toBe(true);
  expect(openText(KEY, '1:hevy', apiKey).trim()).toBe(HEVY_KEY);
  const tokens = fs.readFileSync(path.join(acc, 'garmin', 'tokens', 'pa', 'garmin_tokens.json.sealed'), 'utf8');
  expect(tokens.startsWith('pfs1.')).toBe(true);
  expect(openText(KEY, '1:garmin', tokens)).toBe('{"oauth":"test-only"}');
  // The incoming folder is gone, and nothing on the disk holds a secret in clear text.
  expect(fs.existsSync(path.join(acc, 'migrate', 'incoming'))).toBe(false);
  for (const f of tree(acc)) expect(fs.readFileSync(path.join(acc, f), 'utf8')).not.toMatch(/12345678-1234|test-only/);
  // The moved marker is there and the status of the account names its profile.
  expect(fs.existsSync(path.join(acc, 'moved.json'))).toBe(true);
  expect(t.desk.boundProfileId(1)).toBe('pa');
  // Repeating finish answers done again.
  expect(t.desk.finish(1, m)).toEqual({ state: 'done', counts: { rides: 2, items: 5 } });
});

test('not there: a profile without Hevy or Garmin moves with neither item', async () => {
  const t = make();
  const items: Items = { 'coach-state': Buffer.from('{"ftpW":200}') };
  const m = manifestOf(P1, items, []);
  t.desk.begin(1, m);
  await t.putAll(1, items);
  expect(t.desk.finish(1, m)).toEqual({ state: 'done', counts: { rides: 0, items: 1 } });
  expect(t.household.account(1)).not.toBeNull();
  expect(fs.existsSync(path.join(t.acc(1), 'hevy'))).toBe(false);
  expect(fs.existsSync(path.join(t.acc(1), 'garmin'))).toBe(false);
});

test('after done, begin answers done with the profile id and changes nothing', async () => {
  const t = make();
  const items: Items = { 'coach-state': Buffer.from('{"ftpW":200}') };
  const m = manifestOf(P1, items, []);
  t.desk.begin(1, m);
  await t.putAll(1, items);
  t.desk.finish(1, m);
  const before = tree(t.acc(1)).map((f) => [f, fs.readFileSync(path.join(t.acc(1), f), 'utf8')]);
  expect(t.desk.begin(1, manifestOf({ ...P1, ftpW: 300 }, { 'coach-state': Buffer.from('{"ftpW":300}') }, []))).toEqual({ state: 'done', profileId: 'pa' });
  expect(await t.put(1, 'coach-state', Buffer.from('{"ftpW":300}'))).toBe('closed');
  expect(tree(t.acc(1)).map((f) => [f, fs.readFileSync(path.join(t.acc(1), f), 'utf8')])).toEqual(before);
});

test('a broken Garmin database is refused at finish', async () => {
  const t = make();
  const dir = temp();
  const good = garminDb(dir);
  const broken = Buffer.from(good);
  // Past the header: the pages are garbage.
  broken.fill(0x41, 100);
  const items: Items = { 'coach-state': Buffer.from('{"ftpW":200}'), 'garmin-db': broken };
  const m = manifestOf(P1, items, []);
  t.desk.begin(1, m);
  await t.putAll(1, items);
  expect(t.desk.finish(1, m)).toEqual({ state: 'missing', items: ['garmin-db'], rides: [] });
  expect(fs.existsSync(path.join(t.acc(1), 'moved.json'))).toBe(false);
  expect(fs.existsSync(path.join(t.acc(1), 'garmin', 'data'))).toBe(false);
  // The broken copy is dropped, so begin asks for it again.
  const again = t.desk.begin(1, m);
  expect(again).toEqual({ state: 'open', haveItems: ['coach-state'], haveRides: [] });
  // A good copy then moves.
  const fixed = { ...items, 'garmin-db': good };
  const m2 = manifestOf(P1, fixed, []);
  t.desk.begin(1, m2);
  expect(await t.put(1, 'garmin-db', good)).toBe('ok');
  expect(t.desk.finish(1, m2)).toEqual({ state: 'done', counts: { rides: 0, items: 2 } });
});

test('meals: the first upload is taken whole, a later one adds only that person\'s settings, and planning starts once everyone in the file has moved', async () => {
  // Saturday 07:00: the plan for the coming week is due.
  const saturday = new Date(2026, 10, 7, 7, 0).getTime();
  const t = make({ nowMs: saturday, ask: async (input) => { if (input.systemPrompt === MEAL_SYSTEM_PROMPT) throw new Error('rules will do'); throw new Error('no Claude'); } });
  const mealsDir = path.join(t.root, 'household', 'meals');
  const on = { ...DEFAULT_MEAL_SETTINGS, on: true };
  const moveAccount = async (id: number, p: Profile) => {
    const items: Items = { 'coach-state': Buffer.from(JSON.stringify({ ftpW: p.ftpW })) };
    const m = manifestOf(p, items, []);
    t.desk.begin(id, m);
    await t.putAll(id, items);
    expect(t.desk.finish(id, m).state).toBe('done');
  };

  const first = Buffer.from(JSON.stringify({ settings: { pa: on, pb: { ...on, dislikes: ['Pilze'] } }, plans: {}, states: {}, notices: {}, lastAuto: null }));
  // Not moved yet: refused.
  expect(t.desk.meals(1, first)).toBe('not-moved');
  expect(fs.existsSync(path.join(mealsDir, 'household.json'))).toBe(false);

  await moveAccount(1, P1);
  expect(t.desk.meals(1, first)).toBe('ok');
  expect(JSON.parse(fs.readFileSync(path.join(mealsDir, 'household.json'), 'utf8'))).toEqual(JSON.parse(first.toString()));
  // pb is in the file but has not moved: no planning.
  expect(fs.existsSync(path.join(mealsDir, 'moved.json'))).toBe(false);

  await moveAccount(2, P2);
  // Account 2's moving completes the household: everyone in the file has moved.
  expect(fs.existsSync(path.join(mealsDir, 'moved.json'))).toBe(true);
  // A later upload from account 2 adds nothing: pb's settings are there already, and pa's are never touched.
  const later = Buffer.from(JSON.stringify({ settings: { pa: { ...on, dislikes: ['Fisch'] }, pb: { ...on, dislikes: ['Oliven'] } }, plans: {}, states: {}, notices: {}, lastAuto: null }));
  expect(t.desk.meals(2, later)).toBe('ok');
  const afterLater = JSON.parse(fs.readFileSync(path.join(mealsDir, 'household.json'), 'utf8')) as { settings: Record<string, { dislikes: string[] }> };
  expect(afterLater.settings.pa!.dislikes).toEqual([]);
  expect(afterLater.settings.pb!.dislikes).toEqual(['Pilze']);

  t.household.scan();
  await vi.waitFor(() => expect(t.household.account(2)!.runtime.records.all('pb', 'mealplan').length).toBeGreaterThan(0), { timeout: 3000 });
  expect(t.ask.mock.calls.some(([i]) => (i as { systemPrompt: string }).systemPrompt === MEAL_SYSTEM_PROMPT)).toBe(true);
});

test('meals: a person not in the file yet is added through the open meal plan, never behind its back', async () => {
  const t = make();
  const mealsDir = path.join(t.root, 'household', 'meals');
  const on = { ...DEFAULT_MEAL_SETTINGS, on: true };
  const items: Items = { 'coach-state': Buffer.from('{}') };
  for (const [id, p] of [[1, P1], [2, P2]] as const) {
    const m = manifestOf(p, items, []);
    t.desk.begin(id, m);
    await t.putAll(id, items);
    t.desk.finish(id, m);
  }
  expect(t.desk.meals(1, Buffer.from(JSON.stringify({ settings: { pa: on }, plans: {}, states: {}, notices: {}, lastAuto: null })))).toBe('ok');
  expect(fs.existsSync(path.join(mealsDir, 'moved.json'))).toBe(true);
  // A pa change opens the household's meal plan, which caches its file from now on.
  t.household.account(1)!.runtime.handle({ type: 'meals-settings', profileId: 'pa', settings: on } as never, () => {});
  expect(t.desk.meals(2, Buffer.from(JSON.stringify({ settings: { pb: { ...on, dislikes: ['Oliven'] } } })))).toBe('ok');
  // A later write of the open meal plan keeps pb: the upload went through it, not behind its back.
  t.household.account(1)!.runtime.handle({ type: 'meals-settings', profileId: 'pa', settings: { ...on, dislikes: ['Fisch'] } } as never, () => {});
  const file = JSON.parse(fs.readFileSync(path.join(mealsDir, 'household.json'), 'utf8')) as { settings: Record<string, { dislikes: string[] }> };
  expect(file.settings.pb!.dislikes).toEqual(['Oliven']);
  expect(file.settings.pa!.dislikes).toEqual(['Fisch']);
});

// ---- The routes ----

const startHttp = () => {
  const t = make();
  app = buildCoachServer({ household: t.household, internalToken: TOKEN, nowMs: () => NOON });
  const headers = (account: number) => ({ 'x-pandafit-internal': TOKEN, 'x-pandafit-account': String(account) });
  const json = (method: 'POST' | 'PUT', url: string, body: unknown, account = 1) => app!.inject({ method, url, payload: JSON.stringify(body), headers: { ...headers(account), 'content-type': 'application/json' } });
  const item = (name: string, body: Buffer, hash = sha(body), account = 1) => app!.inject({ method: 'PUT', url: `/migrate/item/${encodeURIComponent(name)}`, payload: body, headers: { ...headers(account), 'content-type': 'application/octet-stream', 'x-sha256': hash } });
  const status = (account = 1) => app!.inject({ method: 'GET', url: '/status', headers: headers(account) });
  return { ...t, json, item, status };
};

test('routes: begin, items, rides, finish and meals move an account; /status names the bound profile from begin on', async () => {
  const t = startHttp();
  const dir = temp();
  const items = fullItems(dir);
  const rides = [rideUpload('ride-1'), rideUpload('ride-2')];
  const m = manifestOf(P1, items, rides);
  expect((await t.status()).json()).toEqual({ profileId: null, moved: false });
  expect((await t.json('POST', '/migrate/begin', m)).json()).toEqual({ state: 'open', haveItems: [], haveRides: [] });
  expect((await t.status()).json()).toEqual({ profileId: 'pa', moved: false });

  expect((await t.item('coach-state', items['coach-state']!, sha('x'))).statusCode).toBe(409);
  expect((await t.item('bogus', items['coach-state']!)).statusCode).toBe(404);
  for (const [n, b] of Object.entries(items)) expect((await t.item(n, b!)).json()).toEqual({ result: 'ok' });
  // Rides land in the bound account's folder before the move.
  for (const r of rides) expect((await t.json('PUT', `/rides/${r.rideId}`, r)).statusCode).toBe(200);
  // A ride of another profile is refused.
  expect((await t.json('PUT', '/rides/ride-3', rideUpload('ride-3', 'pb'))).statusCode).toBe(409);

  const done = await t.json('POST', '/migrate/finish', m);
  expect(done.json()).toEqual({ state: 'done', counts: { rides: 2, items: 5 } });
  expect((await t.status()).json()).toEqual({ profileId: 'pa', moved: true });
  // No answer ever carries a secret.
  expect(done.body).not.toMatch(/12345678-1234|test-only/);

  expect((await t.item('coach-state', items['coach-state']!)).statusCode).toBe(409);
  const meals = await t.json('POST', '/migrate/meals', { settings: { pa: DEFAULT_MEAL_SETTINGS } });
  expect(meals.json()).toEqual({ result: 'ok' });
  expect((await t.json('POST', '/migrate/meals', { settings: {} }, 2)).statusCode).toBe(404);
});

test('routes: an invalid manifest is a 400, another profile a 409, and a finish before begin a 409', async () => {
  const t = startHttp();
  expect((await t.json('POST', '/migrate/begin', { profile: P1 })).statusCode).toBe(400);
  expect((await t.json('POST', '/migrate/finish', manifestOf(P1, {}, []))).statusCode).toBe(409);
  await t.json('POST', '/migrate/begin', manifestOf(P1, {}, []));
  const other = await t.json('POST', '/migrate/begin', manifestOf(P1, {}, []), 2);
  expect(other.statusCode).toBe(409);
  expect(other.json()).toEqual({ state: 'refused', reason: 'other-profile' });
  // A ride for an account that has neither moved nor begun is a 404.
  expect((await t.json('PUT', '/rides/ride-1', rideUpload('ride-1', 'pb'), 3)).statusCode).toBe(404);
});

// ---- Fix round 1 ----

/** Every file under the folder whose bytes hold the text. */
const holding = (dir: string, text: string) => tree(dir).filter((f) => fs.readFileSync(path.join(dir, f)).includes(Buffer.from(text)));

test('a secret never touches the disk in clear, not even while it arrives', async () => {
  const t = make();
  t.desk.begin(1, manifestOf(P1, {}, []));
  const body = new PassThrough();
  const done = t.desk.putItem(1, 'hevy-key', body, sha(HEVY_KEY));
  body.write(HEVY_KEY);
  // The upload is still open: its bytes have arrived, but nothing under the account may hold them.
  await new Promise((r) => setTimeout(r, 30));
  expect(holding(t.acc(1), HEVY_KEY)).toEqual([]);
  body.end();
  expect(await done).toBe('ok');
  expect(holding(t.acc(1), HEVY_KEY)).toEqual([]);
});

test('the desk sweeps leftover upload parts when it starts', () => {
  const root = temp();
  const incoming = path.join(root, 'accounts', '1', 'migrate', 'incoming');
  fs.mkdirSync(incoming, { recursive: true });
  fs.writeFileSync(path.join(incoming, '.hevy-key.0a1b2c.part'), HEVY_KEY);
  fs.writeFileSync(path.join(incoming, '.garmin-db.0a1b2c.part'), 'half a database');
  fs.writeFileSync(path.join(incoming, 'coach-state'), '{}');
  make({ root });
  expect(fs.readdirSync(incoming)).toEqual(['coach-state']);
});

test('moved.json carries the household clock', async () => {
  const t = make({ nowMs: NOON + 5 });
  const m = manifestOf(P1, {}, []);
  t.desk.begin(1, m);
  t.desk.finish(1, m);
  expect(JSON.parse(fs.readFileSync(path.join(t.acc(1), 'moved.json'), 'utf8')).atMs).toBe(NOON + 5);
});

test('every install folder is synced before the moved marker is written', async () => {
  const t = make();
  const items = fullItems(temp());
  const m = manifestOf(P1, items, []);
  t.desk.begin(1, m);
  await t.putAll(1, items);
  const fdPath = new Map<number, string>();
  const log: string[] = [];
  const open = fs.openSync;
  const openSpy = vi.spyOn(fs, 'openSync').mockImplementation(((p: fs.PathLike, ...rest: unknown[]) => { const fd = (open as (...a: unknown[]) => number)(p, ...rest); fdPath.set(fd, String(p)); return fd; }) as typeof fs.openSync);
  const fsync = fs.fsyncSync;
  const syncSpy = vi.spyOn(fs, 'fsyncSync').mockImplementation((fd) => { log.push(`sync ${fdPath.get(fd as number)}`); fsync(fd); });
  const rename = fs.renameSync;
  const renameSpy = vi.spyOn(fs, 'renameSync').mockImplementation((a, b) => { log.push(`rename ${String(b)}`); rename(a, b); });
  try { expect(t.desk.finish(1, m).state).toBe('done'); } finally { openSpy.mockRestore(); syncSpy.mockRestore(); renameSpy.mockRestore(); }
  const marker = log.indexOf(`rename ${path.join(t.acc(1), 'moved.json')}`);
  expect(marker).toBeGreaterThan(0);
  // The target folders and the parents mkdir made for them.
  for (const dir of [[], ['coach'], ['coach', 'gym'], ['garmin'], ['garmin', 'data'], ['garmin', 'data', 'pa'], ['hevy'], ['hevy', 'pa'], ['garmin', 'tokens'], ['garmin', 'tokens', 'pa']]) {
    const at = log.indexOf(`sync ${path.join(t.acc(1), ...dir)}`);
    if (dir.length === 0) { expect(at).toBeGreaterThanOrEqual(0); continue; }
    expect(at, dir.join('/')).toBeGreaterThanOrEqual(0);
    expect(at, dir.join('/')).toBeLessThan(marker);
  }
});

test('after a crash past the moved marker, finish and begin redo the cleanup and the meal plan\'s move', async () => {
  const t = make();
  const mealsDir = path.join(t.root, 'household', 'meals');
  const on = { ...DEFAULT_MEAL_SETTINGS, on: true };
  const m = manifestOf(P1, {}, []);
  t.desk.begin(1, m);
  // The meal file lists pa only, so pa's move completes the household.
  fs.mkdirSync(mealsDir, { recursive: true });
  fs.writeFileSync(path.join(mealsDir, 'household.json'), JSON.stringify({ settings: { pa: on } }));
  // The crash: moved.json is written, migrate/ and the meal plan's move are not.
  fs.mkdirSync(path.join(t.acc(1), 'migrate', 'incoming'), { recursive: true });
  fs.writeFileSync(path.join(t.acc(1), 'migrate', 'incoming', 'coach-state'), '{}');
  fs.writeFileSync(path.join(t.acc(1), 'moved.json'), JSON.stringify({ atMs: 1, profileId: 'pa', counts: { rides: 0, items: 0 } }));

  expect(t.desk.begin(1, m)).toEqual({ state: 'done', profileId: 'pa' });
  expect(fs.existsSync(path.join(t.acc(1), 'migrate'))).toBe(false);
  expect(fs.existsSync(path.join(mealsDir, 'moved.json'))).toBe(true);

  // The same through finish.
  fs.rmSync(path.join(mealsDir, 'moved.json'));
  fs.mkdirSync(path.join(t.acc(1), 'migrate', 'incoming'), { recursive: true });
  expect(t.desk.finish(1, m)).toEqual({ state: 'done', counts: { rides: 0, items: 0 } });
  expect(fs.existsSync(path.join(t.acc(1), 'migrate'))).toBe(false);
  expect(fs.existsSync(path.join(mealsDir, 'moved.json'))).toBe(true);
  expect(t.household.account(1)).not.toBeNull();
});

test('meals: before the meal plan opens, settings are cleaned as the open plan would clean them', async () => {
  const t = make();
  const mealsDir = path.join(t.root, 'household', 'meals');
  const items: Items = {};
  for (const [id, p] of [[1, P1], [2, P2]] as const) { const m = manifestOf(p, items, []); t.desk.begin(id, m); t.desk.finish(id, m); }
  const raw = { on: true, diet: 'bogus', dislikes: ['  Pilze  ', 7], extra: 'x' };
  // A third person keeps the meal plan closed: pc has not moved.
  expect(t.desk.meals(1, Buffer.from(JSON.stringify({ settings: { pa: raw, pc: raw }, plans: {} })))).toBe('ok');
  expect(fs.existsSync(path.join(mealsDir, 'moved.json'))).toBe(false);
  expect(t.desk.meals(2, Buffer.from(JSON.stringify({ settings: { pb: raw } })))).toBe('ok');
  const file = JSON.parse(fs.readFileSync(path.join(mealsDir, 'household.json'), 'utf8')) as { settings: Record<string, unknown> };
  expect(file.settings.pa).toEqual(cleanSettings(raw));
  expect(file.settings.pc).toEqual(cleanSettings(raw));
  expect(file.settings.pb).toEqual(cleanSettings(raw));
});

test('routes: a secret past its size is a 413 and leaves no part behind; a meals body that is no object is a 400', async () => {
  const t = startHttp();
  await t.json('POST', '/migrate/begin', manifestOf(P1, {}, []));
  const big = Buffer.alloc(65 * 1024, 0x61);
  const res = await t.item('hevy-key', big);
  expect(res.statusCode).toBe(413);
  expect(tree(path.join(t.acc(1), 'migrate'))).toEqual([]);
  const m = manifestOf(P1, {}, []);
  await t.json('POST', '/migrate/finish', m);
  for (const body of ['[1,2]', '"text"', 'not json']) {
    const r = await app!.inject({ method: 'POST', url: '/migrate/meals', payload: body, headers: { 'x-pandafit-internal': TOKEN, 'x-pandafit-account': '1', 'content-type': 'application/json' } });
    expect(r.statusCode, body).toBe(400);
  }
});

// ---- Fix round 2 ----

test('a write error between chunks is answered, never crashes the process, and leaves no part', async () => {
  const t = make();
  t.desk.begin(1, manifestOf(P1, {}, []));
  const real = fs.createWriteStream;
  let made: fs.WriteStream | null = null;
  const spy = vi.spyOn(fs, 'createWriteStream').mockImplementation(((...args: Parameters<typeof fs.createWriteStream>) => {
    const s = real(...args);
    made = s;
    // The disk fills up after the first chunk was written, while the desk waits for the next one.
    s.once('finish', () => {});
    const write = s.write.bind(s);
    let n = 0;
    s.write = ((chunk: unknown, ...rest: unknown[]) => {
      const ok = (write as (...a: unknown[]) => boolean)(chunk, ...rest);
      if (++n === 1) setTimeout(() => s.destroy(Object.assign(new Error('no space left'), { code: 'ENOSPC' })), 5);
      return ok;
    }) as typeof s.write;
    return s;
  }) as typeof fs.createWriteStream);
  const body = new PassThrough();
  const first = Buffer.alloc(1024, 1), second = Buffer.alloc(1024, 2);
  const done = t.desk.putItem(1, 'coach-state', body, sha(Buffer.concat([first, second])));
  try {
    body.write(first);
    await new Promise((r) => setTimeout(r, 40));
    body.end(second);
    await expect(done).rejects.toMatchObject({ code: 'ENOSPC' });
  } finally { spy.mockRestore(); }
  expect(made).not.toBeNull();
  expect(tree(path.join(t.acc(1), 'migrate'))).toEqual([]);
});

test('a secret past its size is wiped from memory', async () => {
  const t = make();
  t.desk.begin(1, manifestOf(P1, {}, []));
  const body = new PassThrough();
  const a = Buffer.alloc(40 * 1024, 0x61), b = Buffer.alloc(40 * 1024, 0x62);
  const done = t.desk.putItem(1, 'hevy-key', body, sha('x'));
  body.write(a);
  body.end(b);
  await expect(done).rejects.toMatchObject({ reason: 'too-large' });
  expect(a.every((x) => x === 0)).toBe(true);
  expect(b.every((x) => x === 0)).toBe(true);
});
