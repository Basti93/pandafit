import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, vi } from 'vitest';
import { Household, type HouseholdOptions } from '../../../src/coach/server/household';
import { internalLinks } from '../../../src/coach/server/internal-links';
import { MEAL_SYSTEM_PROMPT } from '../../../src/coach/meals/prompt';
import { CHAT_SYSTEM_PROMPT } from '../../../src/coach/meals/chat';
import { sealedCodec } from '../../../src/coach/secrets/secret-box';
import { rampTest } from '../../../src/shared/ramp';
import { DEFAULT_MEAL_SETTINGS, readMealChat } from '../../../src/shared/meals';
import type { Profile } from '../../../src/shared/profiles';

const KEY = Buffer.alloc(32, 7);
const API = 'http://api.test:8081';
const TOKEN = 'a'.repeat(64);
const NOON = new Date(2026, 10, 3, 12, 0).getTime();
const temp = () => fs.mkdtempSync(path.join(os.tmpdir(), 'hh-'));
const settle = (ms = 50) => new Promise((r) => setTimeout(r, ms));
const good = { id: 'ki', name: 'KI', steps: [
  { kind: 'erg', durationS: 300, ftpFraction: 0.5, label: 'Warmup' },
  { kind: 'erg', durationS: 1200, ftpFraction: 0.65, label: 'Locker' },
] };
const answer = { phase: { name: 'Aufbau', weeksLeft: 3, goal: 'x' }, ftpForecast: [], session: good, reason: 'Von KI', change: 'neu' };
const P1: Profile = { id: 'pa', name: 'A', ftpW: 200 };
const P2: Profile = { id: 'pb', name: 'B', ftpW: 180 };

const accountDir = (root: string, id: number) => path.join(root, 'accounts', String(id));
const seedAccount = (root: string, id: number, profile: Profile, opts: { moved?: boolean; rideId?: string; nowMs?: number } = {}) => {
  const dir = accountDir(root, id);
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, 'profile.json'), JSON.stringify(profile));
  if (opts.moved !== false) fs.writeFileSync(path.join(dir, 'moved.json'), JSON.stringify({ atMs: 1 }));
  if (opts.rideId) {
    const ride = path.join(dir, 'rides', opts.rideId);
    fs.mkdirSync(ride, { recursive: true });
    const s = rampTest(profile.ftpW);
    fs.writeFileSync(path.join(ride, 'meta.json'), JSON.stringify({ rideId: opts.rideId, profileId: profile.id, sessionId: s.id, startedAtMs: (opts.nowMs ?? NOON) - 3600_000, status: 'finished' }));
    fs.writeFileSync(path.join(ride, 'session.json'), JSON.stringify({ session: s, ftpW: profile.ftpW }));
    fs.writeFileSync(path.join(ride, 'samples.jsonl'), Array.from({ length: 600 }, (_, i) => JSON.stringify({ seq: i, wallClockMs: i, rideElapsedS: i + 1, powerW: 260, cadenceRpm: 90, speedKph: 30, hrBpm: 150, targetW: 260, gradePct: null, gear: null })).join('\n') + '\n');
  }
  return dir;
};
/** A sealed Hevy key and sealed Garmin tokens, so a tick would start a Hevy request and a Garmin run. */
const connectHevyAndGarmin = (root: string, id: number, profileId: string) => {
  const dir = accountDir(root, id);
  fs.mkdirSync(path.join(dir, 'hevy', profileId), { recursive: true });
  fs.writeFileSync(path.join(dir, 'hevy', profileId, 'api-key'), sealedCodec(KEY, `${id}:hevy`).seal('00000000-0000-0000-0000-000000000000'));
  fs.mkdirSync(path.join(dir, 'garmin', 'tokens', profileId), { recursive: true });
  fs.writeFileSync(path.join(dir, 'garmin', 'tokens', profileId, 'garmin_tokens.json.sealed'), sealedCodec(KEY, `${id}:garmin`).seal('{}'));
};

let apiFetch: ReturnType<typeof vi.fn>;
beforeEach(() => {
  // The records sync to the api uses the global fetch: an empty, friendly api.
  apiFetch = vi.fn(async () => new Response(JSON.stringify({ records: [], cursor: 0, more: false, refused: [] }), { status: 200, headers: { 'content-type': 'application/json' } }));
  vi.stubGlobal('fetch', apiFetch);
});
afterEach(() => { vi.unstubAllGlobals(); });

const make = (over: Partial<HouseholdOptions> = {}) => {
  const root = over.root ?? temp();
  const ask = vi.fn(async (_input: { prompt: string; systemPrompt: string; schema: object }): Promise<unknown> => answer);
  const spawnFn = vi.fn(() => { throw new Error('no python in tests'); });
  const fetchFn = vi.fn(async () => new Response('', { status: 401 }));
  const opts: HouseholdOptions = {
    root, secretKey: KEY, runDir: temp(), python: process.execPath, garminScripts: path.join(root, 'scripts'),
    apiUrl: API, internalToken: TOKEN, ask, nowMs: () => NOON,
    spawnFn: spawnFn as never, fetchFn: fetchFn as never, waitMs: 0,
    ...over,
  };
  return { root, household: new Household(opts), ask: (over.ask ?? ask) as typeof ask, spawnFn: (over.spawnFn ?? spawnFn) as unknown as typeof spawnFn, fetchFn: (over.fetchFn ?? fetchFn) as unknown as typeof fetchFn, opts };
};

test('an account without moved.json has no coach', () => {
  const root = temp();
  seedAccount(root, 1, P1, { moved: false });
  const { household } = make({ root });
  household.start(1);
  household.scan();
  expect(household.account(1)).toBeNull();
  expect(household.account(9)).toBeNull();
});

test('a moved account has a coach bound to its profile', () => {
  const root = temp();
  seedAccount(root, 1, P1);
  const { household } = make({ root });
  const a = household.account(1);
  expect(a?.accountId).toBe(1);
  expect(a?.profileId).toBe('pa');
  expect(a?.runtime.profileIds()).toEqual(['pa']);
  expect(a?.profile()).toEqual(P1);
  a!.setProfile({ ...P1, name: 'A2' });
  expect(JSON.parse(fs.readFileSync(path.join(accountDir(root, 1), 'profile.json'), 'utf8')).name).toBe('A2');
  expect(household.account(1)?.profile().name).toBe('A2');
  // Another profile id is never bound to this account.
  expect(() => a!.setProfile({ ...P2 })).toThrow();
});

test('each account reads only its own folder', () => {
  const root = temp();
  seedAccount(root, 1, P1, { rideId: 'ride-1000' });
  seedAccount(root, 2, P2);
  const { household } = make({ root });
  const a1 = household.account(1)!, a2 = household.account(2)!;
  a2.runtime.handle({ type: 'subscribe', profileId: 'pb' }, () => {});
  a1.runtime.handle({ type: 'note', profileId: 'pa', text: 'Notiz nur für eins' }, () => {});
  // A message for the other account's profile changes nothing there.
  a2.runtime.handle({ type: 'note', profileId: 'pa', text: 'fremde Notiz' }, () => {});
  expect(a1.runtime.coachState('pa')!.summaries.map((r) => r.rideId)).toEqual(['ride-1000']);
  expect(a2.runtime.coachState('pb')!.summaries).toEqual([]);
  expect(a2.runtime.view('pa')).toBeNull();
  expect(a2.runtime.coachState('pa')).toBeNull();
  const v2 = JSON.stringify(a2.runtime.view('pb'));
  expect(v2).not.toContain('Notiz nur für eins');
  expect(v2).not.toContain('ride-1000');
  expect(JSON.stringify(a1.runtime.view('pa'))).not.toContain('fremde Notiz');
  expect(fs.existsSync(path.join(accountDir(root, 2), 'coach', 'pa.json'))).toBe(false);
});

test('together combines both accounts and carries no note, complaint or ride id of the other', () => {
  const root = temp();
  seedAccount(root, 1, P1, { rideId: 'ride-1000' });
  seedAccount(root, 2, P2, { rideId: 'ride-2000' });
  const { household } = make({ root });
  const a1 = household.account(1)!, a2 = household.account(2)!;
  a1.runtime.handle({ type: 'note', profileId: 'pa', text: 'Mein Knie schmerzt seit gestern' }, () => {});
  a2.runtime.handle({ type: 'note', profileId: 'pb', text: 'Rücken zwickt beim Sitzen' }, () => {});
  const t = household.together();
  expect(t.people.map((p) => p.profileId).sort()).toEqual(['pa', 'pb']);
  expect(t.recent.length).toBe(2);
  const view1 = JSON.stringify(a1.runtime.view('pa')!.together);
  expect(view1).toEqual(JSON.stringify(t));
  for (const text of [JSON.stringify(t), view1]) {
    for (const secret of ['Knie', 'Rücken', 'ride-1000', 'ride-2000']) expect(text).not.toContain(secret);
  }
});

test('two planning runs from two accounts never overlap', async () => {
  const root = temp();
  seedAccount(root, 1, P1, { rideId: 'ride-1000' });
  seedAccount(root, 2, P2, { rideId: 'ride-2000' });
  let now = 0, peak = 0;
  const ask = vi.fn(async () => {
    now++; peak = Math.max(peak, now);
    await settle(20);
    now--;
    return answer;
  });
  const { household } = make({ root, ask });
  household.scan();
  await vi.waitFor(() => expect(ask.mock.calls.length).toBeGreaterThanOrEqual(2), { timeout: 2000 });
  await settle(100);
  expect(peak).toBe(1);
});

test('Garmin and Hevy ticks skip while Claude runs', async () => {
  const root = temp();
  seedAccount(root, 1, P1);
  seedAccount(root, 2, P2);
  connectHevyAndGarmin(root, 2, 'pb');
  let release!: () => void;
  const ask = vi.fn(() => new Promise<unknown>((r) => { release = () => r(answer); }));
  const { household, spawnFn, fetchFn } = make({ root, ask });
  // A person's note on account 1 starts a Claude run that hangs.
  household.account(1)!.runtime.handle({ type: 'note', profileId: 'pa', text: 'heute locker' }, () => {});
  await vi.waitFor(() => expect(ask).toHaveBeenCalled());
  household.scan();
  await settle();
  expect(spawnFn).not.toHaveBeenCalled();
  expect(fetchFn).not.toHaveBeenCalled();
  // Claude is done: the next scan syncs account 2.
  release();
  await vi.waitFor(() => expect(household.account(1)!.runtime.coachState('pa')!.dirty).toBe(false));
  release?.();
  await settle();
  household.scan();
  await settle();
  expect(spawnFn).toHaveBeenCalled();
  expect(fetchFn).toHaveBeenCalled();
});

test('a person\'s message still plans in quiet hours', async () => {
  const root = temp();
  const three = new Date(2026, 10, 3, 3, 0).getTime();
  seedAccount(root, 1, P1, { rideId: 'ride-1000', nowMs: three });
  const { household, ask } = make({ root, nowMs: () => three });
  household.scan();
  await settle();
  // The scan pauses at night ...
  expect(ask).not.toHaveBeenCalled();
  // ... a note from a person does not.
  household.account(1)!.runtime.handle({ type: 'note', profileId: 'pa', text: 'kurz vor der Arbeit' }, () => {});
  await vi.waitFor(() => expect(ask).toHaveBeenCalled());
});

test('the meal plan waits until the household\'s meals moved, then plans for both and writes each mealplan record to its own account store', async () => {
  const root = temp();
  // Saturday 07:00: the plan for the coming week is due.
  const saturday = new Date(2026, 10, 7, 7, 0).getTime();
  seedAccount(root, 1, P1);
  seedAccount(root, 2, P2);
  const meals = path.join(root, 'household', 'meals');
  fs.mkdirSync(meals, { recursive: true });
  const on = { ...DEFAULT_MEAL_SETTINGS, on: true };
  fs.writeFileSync(path.join(meals, 'household.json'), JSON.stringify({ settings: { pa: on, pb: on }, plans: {}, states: {}, notices: {}, lastAuto: null }));
  const ask = vi.fn(async (input: { systemPrompt: string }): Promise<unknown> => {
    if (input.systemPrompt === MEAL_SYSTEM_PROMPT) throw new Error('rules will do');
    return answer;
  });
  const { household } = make({ root, ask: ask as never, nowMs: () => saturday });
  const a1 = household.account(1)!, a2 = household.account(2)!;
  const mealAsks = () => ask.mock.calls.filter(([i]) => i.systemPrompt === MEAL_SYSTEM_PROMPT).length;

  household.scan();
  a1.runtime.handle({ type: 'meals-replan', profileId: 'pa', week: '2026-11-02' } as never, () => {});
  await settle(150);
  expect(mealAsks()).toBe(0);
  expect(a1.runtime.view('pa')!.meals).toBeNull();
  expect(a1.runtime.records.all('pa', 'mealplan')).toEqual([]);

  fs.writeFileSync(path.join(meals, 'moved.json'), JSON.stringify({ atMs: 2 }));
  // The scheduled tick's records reach each account's subscribers at once, not at the next scan.
  const told: (string | null)[] = [];
  a2.runtime.onChange((id) => told.push(id));
  household.scan();
  await vi.waitFor(() => expect(a2.runtime.records.all('pb', 'mealplan').length).toBeGreaterThan(0), { timeout: 3000 });
  await vi.waitFor(() => expect(told).toContain('pb'));
  expect(mealAsks()).toBeGreaterThan(0);
  const plan1 = a1.runtime.records.all('pa', 'mealplan').find((r) => r.id.startsWith('week-'))!;
  const plan2 = a2.runtime.records.all('pb', 'mealplan').find((r) => r.id.startsWith('week-'))!;
  expect((plan1.body as { you: string }).you).toBe('pa');
  expect((plan2.body as { you: string }).you).toBe('pb');
  expect((plan1.body as { people: { id: string }[] }).people.map((p) => p.id).sort()).toEqual(['pa', 'pb']);
  // Each record lives in its own account's store only.
  expect(a1.runtime.records.all('pb')).toEqual([]);
  expect(a2.runtime.records.all('pa')).toEqual([]);
  expect(fs.existsSync(path.join(accountDir(root, 1), 'coach', 'tracking', 'pb.json'))).toBe(false);
  expect(a1.runtime.view('pa')!.meals?.weeks.length).toBeGreaterThan(0);
});

test('quiet hours: a meal chat message from the phone is answered, the weekly plan waits until 06:00', async () => {
  const root = temp();
  seedAccount(root, 1, P1);
  const meals = path.join(root, 'household', 'meals');
  fs.mkdirSync(meals, { recursive: true });
  fs.writeFileSync(path.join(meals, 'household.json'), JSON.stringify({ settings: { pa: { ...DEFAULT_MEAL_SETTINGS, on: true } }, plans: {}, states: {}, notices: {}, lastAuto: null }));
  fs.writeFileSync(path.join(meals, 'moved.json'), JSON.stringify({ atMs: 2 }));
  // Sunday 03:00: the plan for the coming week is due, but it is night.
  let now = new Date(2026, 10, 8, 3, 0).getTime();
  const ask = vi.fn(async (input: { systemPrompt: string }): Promise<unknown> => {
    if (input.systemPrompt === MEAL_SYSTEM_PROMPT) throw new Error('rules will do');
    if (input.systemPrompt === CHAT_SYSTEM_PROMPT) return { antwort: 'Gern, passt so.', aenderungen: [], abneigungenMerken: [] };
    return answer;
  });
  const { household } = make({ root, ask: ask as never, nowMs: () => now });
  const a1 = household.account(1)!;
  const weekRecords = () => a1.runtime.records.all('pa', 'mealplan').filter((r) => r.id.startsWith('week-') && !r.deleted);
  household.scan();
  await settle(150);
  expect(weekRecords()).toEqual([]);

  // 06:00: the scheduled plan comes.
  now = new Date(2026, 10, 8, 6, 0).getTime();
  household.scan();
  await vi.waitFor(() => expect(weekRecords().length).toBeGreaterThan(0), { timeout: 3000 });

  // Monday 03:00: a message typed on the phone for this week's plan is answered at night.
  now = new Date(2026, 10, 9, 3, 0).getTime();
  a1.runtime.records.putMany('pa', [{ kind: 'mealplan', id: 'chat-mob1x2y3z', updatedMs: now, deleted: false, body: { week: '2026-11-09', text: 'Passt das so?', atMs: now, reply: null, answeredMs: null, changed: [] } }], 'remote');
  household.scan();
  await vi.waitFor(() => {
    const rec = a1.runtime.records.all('pa', 'mealplan').find((r) => r.id === 'chat-mob1x2y3z')!;
    expect(readMealChat(rec.id, rec.body)?.reply).toBe('Gern, passt so.');
  }, { timeout: 3000 });
  expect(ask.mock.calls.some(([i]) => i.systemPrompt === CHAT_SYSTEM_PROMPT)).toBe(true);
});

test('not there: an account without Hevy and Garmin coaches with no fetch and no spawn', async () => {
  const root = temp();
  seedAccount(root, 1, P1, { rideId: 'ride-1000' });
  const { household, ask, spawnFn, fetchFn } = make({ root });
  household.scan();
  await vi.waitFor(() => expect(ask).toHaveBeenCalled());
  await settle();
  household.scan();
  await settle();
  expect(spawnFn).not.toHaveBeenCalled();
  expect(fetchFn).not.toHaveBeenCalled();
  for (const [url] of apiFetch.mock.calls) expect(String(url).startsWith(`${API}/internal/accounts/1/`)).toBe(true);
  const v = household.account(1)!.runtime.view('pa')!;
  expect(v.hevy?.state).not.toBe('connected');
  expect(v.garmin?.state).not.toBe('connected');
  expect(v.state.next).toBeTruthy();
});

test('a 401 on the internal records sync is logged without secrets and retried later', async () => {
  let now = NOON;
  const log = vi.spyOn(console, 'error').mockImplementation(() => {});
  try {
    const links = internalLinks({ apiUrl: API, token: TOKEN, accountId: 1, profileId: 'pa', dir: temp(), nowMs: () => now });
    links.reject('pa');
    expect(links.token('pa')).toBeNull();
    expect(links.status('pa').state).toBe('rejected');
    expect(log).toHaveBeenCalledTimes(1);
    expect(JSON.stringify(log.mock.calls)).not.toContain(TOKEN);
    now += 29 * 60_000;
    expect(links.token('pa')).toBeNull();
    // Later the sync tries again with the token.
    now += 2 * 60_000;
    expect(links.token('pa')).toBe(TOKEN);
    expect(links.status('pa').state).toBe('linked');

    // Through the household: a refused sync stops, and runs again after the wait.
    const root = temp();
    seedAccount(root, 1, P1);
    apiFetch.mockImplementation(async () => new Response('{}', { status: 401 }));
    const { household } = make({ root, nowMs: () => now });
    const a = household.account(1)!;
    a.runtime.handle({ type: 'records-put', profileId: 'pa', records: [] } as never, () => {});
    household.scan();
    await vi.waitFor(() => expect(a.runtime.accountSync.status('pa').state).toBe('rejected'));
    const calls = apiFetch.mock.calls.length;
    household.scan();
    await settle();
    expect(apiFetch.mock.calls.length).toBe(calls);
    apiFetch.mockImplementation(async () => new Response(JSON.stringify({ records: [], cursor: 0, more: false, refused: [] }), { status: 200, headers: { 'content-type': 'application/json' } }));
    now += 31 * 60_000;
    a.runtime.handle({ type: 'records-put', profileId: 'pa', records: [] } as never, () => {});
    household.scan();
    await vi.waitFor(() => expect(apiFetch.mock.calls.length).toBeGreaterThan(calls));
    await vi.waitFor(() => expect(a.runtime.accountSync.status('pa').state).toBe('linked'));
  } finally { log.mockRestore(); }
});

test('the records link points at /internal/accounts/1 with the internal token', async () => {
  const dir = temp();
  const links = internalLinks({ apiUrl: `${API}/`, token: TOKEN, accountId: 1, profileId: 'pa', dir });
  expect(links.url('pa')).toBe(`${API}/internal/accounts/1`);
  expect(links.token('pa')).toBe(TOKEN);
  expect(links.status('pa').state).toBe('linked');
  // Only the bound profile.
  expect(links.token('pb')).toBeNull();
  expect(links.url('pb')).toBeNull();
  expect(links.status('pb').state).toBe('idle');
  await expect(links.link('pa', 'https://x', 'n', 'p')).rejects.toThrow();
  await links.cursors('pa').set({ sent: 3, received: 4 });
  expect(await links.cursors('pa').get()).toEqual({ sent: 3, received: 4 });
  expect(fs.readdirSync(dir).length).toBeGreaterThan(0);
  links.reject('pa');
  expect(links.token('pa')).toBeNull();
  expect(links.status('pa').state).toBe('rejected');

  // Through the household: the account's records sync calls that link with the token.
  const root = temp();
  seedAccount(root, 1, P1);
  const { household } = make({ root });
  household.account(1)!.runtime.handle({ type: 'records-put', profileId: 'pa', records: [] } as never, () => {});
  household.scan();
  await vi.waitFor(() => expect(apiFetch).toHaveBeenCalled());
  const [url, init] = apiFetch.mock.calls[0] as [string, RequestInit];
  expect(url.startsWith(`${API}/internal/accounts/1/records`)).toBe(true);
  expect((init.headers as Record<string, string>).authorization).toBe(`Bearer ${TOKEN}`);
});

test('a coach that does not start is logged once with the kind of error, never its message', () => {
  const root = temp();
  seedAccount(root, 1, P1);
  const { household } = make({ root });
  const log = vi.spyOn(console, 'error').mockImplementation(() => {});
  try {
    vi.spyOn(household, 'start').mockImplementation(() => { throw new SyntaxError('Unexpected token in "Mein Knie schmerzt"'); });
    expect(household.account(1)).toBeNull();
    household.scan();
    expect(log).toHaveBeenCalledTimes(1);
    const line = JSON.stringify(log.mock.calls);
    expect(line).toContain('SyntaxError');
    expect(line).not.toContain('Knie');
  } finally { log.mockRestore(); }
});
