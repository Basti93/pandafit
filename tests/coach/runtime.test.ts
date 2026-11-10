import { EventEmitter } from 'node:events';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { PassThrough } from 'node:stream';
import { onTestFinished, vi } from 'vitest';
import { createCoachRuntime, type RuntimeOptions } from '../../src/coach/runtime';
import { AccountLinks } from '../../src/coach/tracking/link';
import { RecordStore } from '../../src/coach/tracking/store';
import { rampTest } from '../../src/shared/ramp';
import type { Profile } from '../../src/shared/profiles';
import type { CoachServerMessage } from '../../src/coach/protocol';
import { sealedTokens } from '../../src/coach/secrets/garmin-tokens';
import { sealedCodec } from '../../src/coach/secrets/secret-box';
import { CHAT_SYSTEM_PROMPT } from '../../src/coach/meals/chat';
import { REVIEW_SYSTEM_PROMPT } from '../../src/coach/chat/chat-coach';
import { CHAT_SYSTEM_PROMPT as WEEK_CHAT_PROMPT } from '../../src/coach/chat/chat-coach';
import { MealCoach } from '../../src/coach/meals/meal-coach';
import { computeTogether } from '../../src/coach/together';
import { TOGETHER_ID } from '../../src/shared/together';
import { loadRunCache } from '../../src/coach/run/state';
import { dateKey } from '../../src/coach/day-load';
import { weekFp, type RunWeekBody } from '../../src/shared/run';
import { mondayOf, weekDates } from '../../src/shared/week-plan';

const temp = () => fs.mkdtempSync(path.join(os.tmpdir(), 'rt-'));
const good = { id: 'ki', name: 'KI', steps: [
  { kind: 'erg', durationS: 300, ftpFraction: 0.5, label: 'Warmup' },
  { kind: 'erg', durationS: 1200, ftpFraction: 0.65, label: 'Locker' },
] };
const answer = { phase: { name: 'Aufbau', weeksLeft: 3, goal: 'x' }, ftpForecast: [], session: good, reason: 'Von KI', change: 'neu' };
const PROFILES: Profile[] = [{ id: 'pa', name: 'A', ftpW: 200 } as Profile];

const seed = (root: string) => {
  const rides = path.join(root, 'rides');
  fs.mkdirSync(path.join(rides, 'ride-1000'), { recursive: true });
  fs.writeFileSync(path.join(rides, 'profiles.json'), JSON.stringify(PROFILES));
  const s = rampTest(200);
  fs.writeFileSync(path.join(rides, 'ride-1000', 'meta.json'), JSON.stringify({ rideId: 'ride-1000', profileId: 'pa', sessionId: s.id, startedAtMs: Date.now() - 3600_000, status: 'finished' }));
  fs.writeFileSync(path.join(rides, 'ride-1000', 'session.json'), JSON.stringify({ session: s, ftpW: 200 }));
  fs.writeFileSync(path.join(rides, 'ride-1000', 'samples.jsonl'), Array.from({ length: 600 }, (_, i) => JSON.stringify({ seq: i, wallClockMs: i, rideElapsedS: i + 1, powerW: 260, cadenceRpm: 90, speedKph: 30, hrBpm: 150, targetW: 260, gradePct: null, gear: null })).join('\n') + '\n');
  return rides;
};
/** A Hevy key and Garmin tokens, so a tick would start a Hevy request and a Garmin run. */
const connectHevyAndGarmin = (root: string) => {
  fs.mkdirSync(path.join(root, 'hevy', 'pa'), { recursive: true });
  fs.writeFileSync(path.join(root, 'hevy', 'pa', 'api-key'), '00000000-0000-0000-0000-000000000000');
  fs.mkdirSync(path.join(root, 'garmin', 'tokens', 'pa'), { recursive: true });
  fs.writeFileSync(path.join(root, 'garmin', 'tokens', 'pa', 'garmin_tokens.json'), '{}');
};

const make = (over: Partial<RuntimeOptions> = {}) => {
  const root = temp(); seed(root);
  const ask = vi.fn(async () => answer);
  const spawnFn = vi.fn(() => { throw new Error('no python in tests'); });
  const fetchFn = vi.fn(async () => new Response('', { status: 401 }));
  const runtime = createCoachRuntime({
    root, profiles: () => PROFILES, noOpenRide: () => true, ask,
    python: process.execPath, garminScripts: path.join(root, 'scripts'),
    links: new AccountLinks({ dir: path.join(root, 'accounts') }),
    meals: 'own', together: () => ({ summits: [] }) as never,
    spawnFn: spawnFn as never, fetchFn: fetchFn as never, waitMs: 0,
    ...over,
  });
  return { root, runtime, ask, spawnFn, fetchFn };
};
const settle = () => new Promise((r) => setTimeout(r, 50));
const subscribe = (runtime: ReturnType<typeof make>['runtime'], profileId = 'pa') => {
  const replies: CoachServerMessage[] = [];
  runtime.handle({ type: 'subscribe', profileId }, (m) => replies.push(m));
  return replies;
};

test('subscribe answers with the coach-state keys main.ts sent before', () => {
  const { runtime } = make();
  const replies = subscribe(runtime);
  const state = replies.find((m) => m.type === 'coach-state');
  expect(Object.keys(state!)).toEqual(['type', 'state', 'thinking', 'hevy', 'debriefing', 'together', 'garmin', 'garminSync', 'garminReadiness', 'garminSuggestion', 'gym', 'strengthHealth', 'mobility', 'account', 'meals']);
  expect(runtime.view('pa')).toEqual(state);
});

test('a profile outside profiles() gets no view and its messages change nothing', () => {
  const { root, runtime } = make();
  subscribe(runtime);
  expect(runtime.view('x')).toBeNull();
  const replies: CoachServerMessage[] = [];
  runtime.handle({ type: 'note', profileId: 'x', text: 'a' }, (m) => replies.push(m));
  runtime.handle({ type: 'subscribe', profileId: 'x' }, (m) => replies.push(m));
  expect(fs.existsSync(path.join(root, 'coach', 'x.json'))).toBe(false);
  expect(replies).toEqual([]);
  expect(runtime.profileIds()).toEqual(['pa']);
  expect(runtime.coachState('pa')?.profileId).toBe('pa');
});

test('scan with scheduled() false asks no Claude and starts no Hevy or Garmin run', async () => {
  for (const over of [{ scheduled: () => false }, { noOpenRide: () => false }]) {
    const { root, runtime, ask, spawnFn, fetchFn } = make(over);
    connectHevyAndGarmin(root);
    runtime.scan();
    await settle();
    runtime.scan();
    await settle();
    expect(ask).not.toHaveBeenCalled();
    expect(spawnFn).not.toHaveBeenCalled();
    expect(fetchFn).not.toHaveBeenCalled();
  }
});

test('with a ride open no day sentence is asked, even with a training today', async () => {
  const { root, runtime, ask } = make({ noOpenRide: () => false });
  const store = new RecordStore({ dir: path.join(root, 'coach', 'tracking') });
  store.putMany('pa', [{ kind: 'run', id: 'manual-abc', updatedMs: Date.now(), deleted: false, body: { type: 'manual', startMs: Date.now() - 3600_000, durationS: 1800, distanceM: 5000, avgHr: null, runType: 'running' } }]);
  runtime.scan();
  await settle();
  runtime.scan();
  await settle();
  expect(ask).not.toHaveBeenCalled();
  expect(fs.existsSync(path.join(root, 'coach', 'day', 'texts.json'))).toBe(false);
});

test('heavyBusy() true skips the Hevy and Garmin ticks but not planning', async () => {
  const busy = make({ heavyBusy: () => true });
  connectHevyAndGarmin(busy.root);
  busy.runtime.scan();
  await settle();
  expect(busy.ask).toHaveBeenCalled();
  expect(busy.spawnFn).not.toHaveBeenCalled();
  expect(busy.fetchFn).not.toHaveBeenCalled();

  const free = make({ heavyBusy: () => false });
  connectHevyAndGarmin(free.root);
  free.runtime.scan();
  await settle();
  expect(free.spawnFn).toHaveBeenCalled();
  expect(free.fetchFn).toHaveBeenCalled();
});

test('meals null: meals messages are ignored and the view has meals null', () => {
  const { root, runtime } = make({ meals: null });
  subscribe(runtime);
  runtime.handle({ type: 'meals-settings', profileId: 'pa', settings: { enabled: true } } as never, () => {});
  expect(runtime.view('pa')?.meals).toBeNull();
  expect(fs.existsSync(path.join(root, 'coach', 'meals'))).toBe(false);
});

test('onChange tells about a change and stops after unsubscribing', () => {
  const { runtime } = make();
  const seen: (string | null)[] = [];
  const off = runtime.onChange((id) => seen.push(id));
  subscribe(runtime);
  expect(seen.length).toBeGreaterThan(0);
  off();
  const n = seen.length;
  subscribe(runtime);
  expect(seen.length).toBe(n);
});

test('a disconnect and a new login while a sync runs: the new tokens are sealed and stay, nothing of the old account comes back, no plain text is left', () => {
  const root = temp(); seed(root);
  const runDir = temp();
  const garminDir = path.join(root, 'garmin');
  const tokens = sealedTokens({ garminDir, runDir, codec: (id) => sealedCodec(Buffer.alloc(32, 5), `acc:${id}:garmin`) });
  const old = tokens.checkout('pa');
  fs.writeFileSync(path.join(old.dir, 'garmin_tokens.json'), '{"konto":"alt"}');
  tokens.checkin(old);
  const children: any[] = [];
  const spawnFn = vi.fn((_bin: string, args: string[]) => {
    const child: any = new EventEmitter();
    child.stdout = new PassThrough();
    child.stdin = new PassThrough();
    child.args = args;
    // A real child reports its exit later, not inside kill().
    child.kill = vi.fn();
    children.push(child);
    return child;
  });
  const python = path.join(root, 'python');
  fs.writeFileSync(python, '');
  const runtime = createCoachRuntime({
    root, profiles: () => PROFILES, noOpenRide: () => true, ask: vi.fn(async () => answer),
    python, garminScripts: path.join(root, 'scripts'),
    links: new AccountLinks({ dir: path.join(root, 'accounts') }),
    meals: null, together: () => ({ summits: [] }) as never,
    spawnFn: spawnFn as never, fetchFn: vi.fn(async () => new Response('', { status: 401 })) as never, waitMs: 0,
    garminTokens: tokens,
  });
  runtime.scan();
  const sync = children.find((c) => String(c.args[0]).endsWith('garmin_sync.py'));
  expect(sync).toBeDefined();
  const syncDir: string = sync.args[sync.args.indexOf('--tokens') + 1];
  fs.writeFileSync(path.join(syncDir, 'garmin_tokens.json'), '{"konto":"alt-refreshed"}');

  runtime.handle({ type: 'garmin-disconnect', profileId: 'pa' }, () => {});
  expect(sync.kill).toHaveBeenCalled();
  runtime.handle({ type: 'garmin-login', profileId: 'pa', email: 'a@b.c', password: 'pw' }, () => {});
  const bridge = children.find((c) => String(c.args[0]).endsWith('bridge.py'));
  const request = JSON.parse(String(bridge.stdin.read()).split('\n')[0]);
  expect(fs.readdirSync(request.tokens)).toEqual([]);

  // The old sync writes its refreshed token once more on the way out, then exits after the new login began.
  fs.mkdirSync(syncDir, { recursive: true });
  fs.writeFileSync(path.join(syncDir, 'garmin_tokens.json'), '{"konto":"alt-refreshed"}');
  sync.emit('close', null, 'SIGTERM');
  expect(fs.existsSync(request.tokens)).toBe(true);

  fs.writeFileSync(path.join(request.tokens, 'garmin_tokens.json'), '{"konto":"neu"}');
  bridge.stdout.write(`${JSON.stringify({ status: 'connected' })}\n`);
  bridge.emit('close', 0, null);

  expect(runtime.view('pa')?.garmin).toEqual({ state: 'connected' });
  const check = tokens.checkout('pa');
  expect(fs.readFileSync(path.join(check.dir, 'garmin_tokens.json'), 'utf8')).toBe('{"konto":"neu"}');
  tokens.checkin(check);
  const left = (dir: string): string[] => fs.readdirSync(dir, { withFileTypes: true }).flatMap((e) => (e.isDirectory() ? left(path.join(dir, e.name)) : [path.join(dir, e.name)]));
  expect(left(runDir)).toEqual([]);
  for (const f of left(garminDir)) expect(fs.readFileSync(f, 'utf8')).not.toContain('konto');
});

test('a meal chat message from the Mac reaches the meal plan and gets its answer', async () => {
  const { runtime, ask } = make();
  subscribe(runtime);
  const week = runtime.view('pa')!.meals!.currentWeek;
  runtime.handle({ type: 'meals-settings', profileId: 'pa', settings: { on: true } }, () => {});
  runtime.handle({ type: 'meals-replan', profileId: 'pa', week }, () => {});
  await vi.waitFor(() => expect(runtime.view('pa')!.meals!.weeks.length).toBeGreaterThan(0));
  runtime.handle({ type: 'meals-chat', profileId: 'pa', week, text: 'Passt das so?' }, () => {});
  await vi.waitFor(() => expect(runtime.view('pa')!.meals!.chat[0]?.reply).toBeTruthy());
  expect((ask.mock.calls as unknown as [{ systemPrompt: string }][]).some(([i]) => i.systemPrompt === CHAT_SYSTEM_PROMPT)).toBe(true);
});

test('the scan writes the together page to a linked profile, and not with a ride open', () => {
  const linked = { ...new AccountLinks({ dir: temp() }), link: async () => { throw new Error('no'); }, unlink: () => {}, status: () => ({ state: 'linked', name: null }), token: () => null, url: () => null, reject: () => {}, cursors: () => new AccountLinks({ dir: temp() }).cursors('pa') } as never;
  const together = () => computeTogether(PROFILES, [], Date.now());
  const open = make({ links: linked, together, noOpenRide: () => false });
  open.runtime.scan();
  expect(open.runtime.records.all('pa', 'together')).toEqual([]);
  const free = make({ links: linked, together });
  free.runtime.scan();
  expect(free.runtime.records.all('pa', 'together').map((r) => r.id)).toEqual([TOGETHER_ID]);
});

test('meals as a getter: ignored while it gives null, then the messages reach the shared meal plan', () => {
  const root = temp();
  let shared: MealCoach | null = null;
  const { runtime } = make({ meals: () => shared });
  subscribe(runtime);
  runtime.handle({ type: 'meals-settings', profileId: 'pa', settings: { on: true } }, () => {});
  expect(runtime.view('pa')?.meals).toBeNull();
  shared = new MealCoach({ dir: path.join(root, 'meals'), nowMs: () => Date.now(), profiles: () => PROFILES.map(({ id, name }) => ({ id, name })), noOpenRide: () => true });
  expect(shared.enabled('pa')).toBe(false);
  runtime.handle({ type: 'meals-settings', profileId: 'pa', settings: { on: true } }, () => {});
  expect(shared.enabled('pa')).toBe(true);
  expect(runtime.view('pa')?.meals?.settings.on).toBe(true);
});

test('notify tells the listeners about a profile whose records changed', () => {
  const { runtime } = make();
  const seen: (string | null)[] = [];
  runtime.onChange((id) => seen.push(id));
  runtime.notify('pa');
  expect(seen).toEqual(['pa']);
});

test('a failed scan logs only the error kind, never its message or the error object', () => {
  let fail = false;
  const { runtime } = make({ profiles: () => { if (fail) throw Object.assign(new Error('token abc123 in /secret/path'), { code: 'EACCES' }); return PROFILES; } });
  const log = vi.spyOn(console, 'error').mockImplementation(() => {});
  try {
    fail = true;
    runtime.scan();
    expect(log).toHaveBeenCalledWith('Coach-Lauf fehlgeschlagen', 'EACCES');
    expect(JSON.stringify(log.mock.calls)).not.toContain('abc123');
    expect(log.mock.calls.flat().some((x) => x instanceof Error)).toBe(false);
  } finally { log.mockRestore(); }
});

describe('the run coach in the runtime', () => {
  const runSettings = (runtime: ReturnType<typeof make>['runtime']) => runtime.records.put('pa', { kind: 'run', id: 'settings', updatedMs: Date.now(), deleted: false, body: { type: 'settings', on: true, weekdays: [0, 1, 2, 3, 4, 5, 6], answers: null } });
  const runIds = (runtime: ReturnType<typeof make>['runtime']) => runtime.records.all('pa', 'run').map((r) => r.id).sort();

  test('scan ticks the run coach only for profiles coached here', async () => {
    const away = make({ coachHere: () => false });
    runSettings(away.runtime);
    away.runtime.scan();
    await settle();
    expect(runIds(away.runtime)).toEqual(['settings']);

    const here = make();
    runSettings(here.runtime);
    here.runtime.scan();
    await settle();
    expect(runIds(here.runtime)).toContain('status');
    expect(runIds(here.runtime).some((id) => id.startsWith('week-'))).toBe(true);
  });

  test('the planning ratings of the run coach count a run done yesterday', async () => {
    // Pin the clock to a Wednesday: on a Monday "yesterday" belongs to the previous week.
    vi.useFakeTimers({ now: new Date('2026-11-11T10:00:00'), toFake: ['Date'] });
    onTestFinished(() => { vi.useRealTimers(); });
    const { root, runtime } = make();
    runSettings(runtime);
    const startMs = Date.now() - 24 * 3600_000;
    runtime.records.put('pa', { kind: 'run', id: 'manual-y', updatedMs: Date.now(), deleted: false, body: { type: 'manual', startMs, durationS: 80 * 60, distanceM: 12000, avgHr: null, runType: 'running' } } as never);
    runtime.scan();
    await settle();
    const yesterday = dateKey(startMs);
    const planDays = Object.values(loadRunCache(path.join(root, 'coach', 'run'), 'pa').planDays);
    expect(planDays.some((w) => w[yesterday] === 'moderate')).toBe(true);
  });

  test('with no ride open and Garmin missing, scan writes no run records', async () => {
    const { runtime } = make();
    runtime.scan();
    await settle();
    runtime.scan();
    await settle();
    expect(runIds(runtime)).toEqual([]);
  });

  test('with a Garmin login the workout check runs once; a confirmed week is sent, and a disconnect stops the send', async () => {
    const children: any[] = [];
    const spawnFn = vi.fn((_bin: string, args: string[]) => {
      const child: any = new EventEmitter();
      child.stdout = new PassThrough();
      child.stdin = new PassThrough();
      child.args = args;
      child.kill = vi.fn();
      children.push(child);
      return child;
    });
    // A fixed Monday: on the last days of a week the plan has no run left to send, so the test must not depend on today's date.
    const monday = new Date(2026, 10, 2, 9).getTime();
    const { root, runtime } = make({ spawnFn: spawnFn as never, nowMs: () => monday });
    connectHevyAndGarmin(root);
    runSettings(runtime);
    const workoutRuns = () => children.filter((c) => String(c.args[0]).endsWith('garmin_workout.py'));
    runtime.scan();
    await settle();
    runtime.scan();
    await settle();
    expect(workoutRuns()).toHaveLength(1);
    expect(workoutRuns()[0].args).toContain('--check');
    workoutRuns()[0].stdout.write('{"status":"ok"}\n');
    workoutRuns()[0].emit('close', 0);
    runtime.scan();
    await settle();
    const weekRec = runtime.records.all('pa', 'run').find((r) => r.id.startsWith('week-'))!;
    const week = weekRec.body as RunWeekBody;
    expect(week.garmin).toMatchObject({ status: 'none' });
    runtime.records.put('pa', { kind: 'run', id: `send-${week.week}`, updatedMs: monday, deleted: false, body: { type: 'send', week: week.week, fp: weekFp(week.runs), atMs: monday } });
    runtime.scan();
    await settle();
    expect(workoutRuns()).toHaveLength(2);
    const send = workoutRuns()[1];
    expect(send.args).not.toContain('--check');
    const ops = JSON.parse(String(send.stdin.read()));
    expect(ops.delete).toEqual([]);
    expect(ops.create.length).toBeGreaterThan(0);
    runtime.handle({ type: 'garmin-disconnect', profileId: 'pa' }, () => {});
    expect(send.kill).toHaveBeenCalled();
  });

  test('with a ride open scan writes no run records', async () => {
    const { runtime } = make({ noOpenRide: () => false });
    runSettings(runtime);
    runtime.scan();
    await settle();
    expect(runIds(runtime)).toEqual(['settings']);
  });
});

describe('the stats record on the scan', () => {
  const mobilityMinutes = (runtime: ReturnType<typeof make>['runtime']) => {
    const body = runtime.records.all('pa', 'stats').find((r) => r.id === 'stats')?.body as { days: { minutes: { mobility: number } }[] } | undefined;
    return body ? body.days.reduce((a, d) => a + d.minutes.mobility, 0) : null;
  };
  const addMobility = (runtime: ReturnType<typeof make>['runtime'], id: string, doneMs: number, minutes: number) =>
    runtime.records.put('pa', { kind: 'mobility', id, updatedMs: doneMs, deleted: false, body: { doneMs, minutes } } as never);

  test('is made at most every five minutes, or at once when the date changed', () => {
    const d = new Date();
    let clock = new Date(d.getFullYear(), d.getMonth(), d.getDate(), 12).getTime();
    const { runtime } = make({ nowMs: () => clock });
    addMobility(runtime, 'm1', clock - 3_600_000, 15);
    runtime.scan();
    expect(mobilityMinutes(runtime)).toBe(15);
    addMobility(runtime, 'm2', clock - 1_800_000, 20);
    clock += 10_000;
    runtime.scan();
    expect(mobilityMinutes(runtime)).toBe(15);
    clock += 5 * 60_000;
    runtime.scan();
    expect(mobilityMinutes(runtime)).toBe(35);
    // Just before midnight, then two minutes later on the next date.
    clock = new Date(d.getFullYear(), d.getMonth(), d.getDate(), 23, 59).getTime();
    runtime.scan();
    addMobility(runtime, 'm3', clock - 60_000, 5);
    clock += 2 * 60_000;
    runtime.scan();
    expect(mobilityMinutes(runtime)).toBe(40);
  });

  test('publishes what the bike coach changed, with its reason, and only when it changed', () => {
    const { runtime } = make();
    addMobility(runtime, 'm1', Date.now() - 60_000, 15);
    runtime.handle({ type: 'set-ftp', profileId: 'pa', ftpW: 211 }, () => {});
    runtime.scan();
    const body = () => runtime.records.all('pa', 'stats').find((r) => r.id === 'stats');
    const first = body()!;
    expect((first.body as { changes?: unknown }).changes).toContainEqual({ atMs: expect.any(Number), coach: 'bike', text: 'FTP: 211 W', reason: 'von dir gesetzt' });
    runtime.scan();
    expect(body()!.updatedMs).toBe(first.updatedMs);
  });

  test('with a ride open nothing is written', () => {
    const { runtime } = make({ noOpenRide: () => false });
    addMobility(runtime, 'm1', Date.now() - 60_000, 15);
    runtime.scan();
    expect(mobilityMinutes(runtime)).toBeNull();
  });
});

test('a new activity of any source, here a run entered by hand, makes the bike coach plan again with it in the prompt', async () => {
  const { root, runtime, ask } = make();
  runtime.scan();
  await settle();
  runtime.scan();
  await settle();
  ask.mockClear();
  runtime.scan();
  await settle();
  expect(ask).not.toHaveBeenCalled();

  const store = new RecordStore({ dir: path.join(root, 'coach', 'tracking') });
  const startMs = Date.now() - 2 * 3600_000;
  store.putMany('pa', [{ kind: 'run', id: 'manual-abc', updatedMs: Date.now(), deleted: false, body: { type: 'manual', startMs, durationS: 1800, distanceM: 5000, avgHr: null, runType: 'running' } }]);
  runtime.scan();
  await settle();
  runtime.scan();
  await settle();
  expect(ask).toHaveBeenCalled();
  // The coach sentence about the new training asks as well; the bike coach's plan is the call with the activity block.
  const prompt = (ask.mock.calls as unknown as [{ prompt: string }][]).map((c) => c[0].prompt).find((p) => p.includes('<aktivitaeten-nur-daten>'))!;
  expect(prompt).toContain('"art":"running"');

  // Seen once: the next scans do not plan again for it.
  ask.mockClear();
  runtime.scan();
  await settle();
  expect(ask).not.toHaveBeenCalled();
});

test('with a week plan taken for this week, a new activity has the chat look at the week; without one it asks nothing extra', async () => {
  for (const withPlan of [true, false]) {
    const { root, runtime, ask } = make();
    const store = new RecordStore({ dir: path.join(root, 'coach', 'tracking') });
    if (withPlan) {
      const monday = mondayOf(dateKey(Date.now()));
      store.putMany('pa', [{ kind: 'weekplan', id: monday, updatedMs: Date.now(), deleted: false, body: { weekStart: monday, days: weekDates(monday).map((date) => ({ date, sport: 'rest', hardness: 'easy', fixed: false })), fromMessage: 'm', acceptedMs: 1 } }]);
    }
    runtime.scan();
    await settle();
    runtime.scan();
    await settle();
    const prompts = (ask.mock.calls as unknown as [{ prompt: string }][]).map(([p]) => p.prompt);
    expect(prompts.some((p) => p.includes('<neueAktivitaeten-nur-daten>'))).toBe(withPlan);
  }
});

test('a change asked for in the week chat goes to the coach in charge, who plans again at once with it', async () => {
  const prompts: { system: string; prompt: string }[] = [];
  const ask = vi.fn(async (input: { prompt: string; systemPrompt: string }) => {
    prompts.push({ system: input.systemPrompt, prompt: input.prompt });
    if (input.systemPrompt === WEEK_CHAT_PROMPT) return { text: 'Gebe ich an die Planung weiter.', proposal: null, riderAskedForMore: false, newComplaint: null, complaintsOver: [], tasks: [{ coach: 'bike', text: 'Nächste Fahrt kürzer', lasting: false }] };
    return answer;
  });
  const { root, runtime } = make({ ask: ask as never });
  runtime.scan();
  await settle();
  runtime.scan();
  await settle();
  const store = new RecordStore({ dir: path.join(root, 'coach', 'tracking') });
  store.putMany('pa', [{ kind: 'chat', id: 'r1', updatedMs: Date.now(), deleted: false, body: { role: 'rider', text: 'Nächste Fahrt bitte kürzer', atMs: Date.now() } }]);
  prompts.length = 0;
  for (let i = 0; i < 3; i++) { runtime.scan(); await settle(); }
  const chat = prompts.find((p) => p.system === WEEK_CHAT_PROMPT);
  expect(chat?.prompt).toContain('<einheiten-nur-daten>');
  const bike = prompts.filter((p) => p.system !== WEEK_CHAT_PROMPT && p.prompt.includes('<auftraege-nur-daten>'));
  expect(bike.length).toBeGreaterThan(0);
  expect(bike[0]!.prompt).toContain('Nächste Fahrt kürzer');
});

describe('the last Sunday of the month', () => {
  const SUNDAY = new Date(2026, 10, 29, 18, 5).getTime();
  const workout = (day: number, month = 9) => { const startMs = new Date(2026, month, day, 10).getTime(); return { kind: 'workout' as const, id: `w${month}-${day}`, updatedMs: 1, deleted: false, body: { id: `w${month}-${day}`, title: 'Kraft', startMs, endMs: startMs + 3600_000, exercises: [] } }; };

  test('the monthly review comes first; the week conversation follows in a later scan and sees it', async () => {
    const calls: { system: string; prompt: string }[] = [];
    const ask = vi.fn(async (input: { prompt: string; systemPrompt: string }) => {
      calls.push({ system: input.systemPrompt, prompt: input.prompt });
      if (input.systemPrompt === REVIEW_SYSTEM_PROMPT) return { opening: 'Ein guter Monat.', observations: [], complaintQuestions: [], nextWeeks: 'Weiter so.' };
      if (input.systemPrompt === WEEK_CHAT_PROMPT) return { text: 'Hier ist die nächste Woche.', proposal: null, riderAskedForMore: false, newComplaint: null, complaintsOver: [], tasks: [] };
      return answer;
    });
    const { root, runtime } = make({ ask: ask as never, nowMs: () => SUNDAY });
    const dir = path.join(root, 'coach', 'chat');
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, 'prompts-sent.json'), JSON.stringify({ pa: { reviewSports: '' } }));
    runtime.records.put('pa', { kind: 'coachprefs', id: 'prefs', updatedMs: 1, deleted: false, body: { week: { on: true, day: 6, hour: 18 }, evening: { on: false, hour: 19 }, review: { on: true } } });
    runtime.records.putMany('pa', [workout(5), workout(15), workout(2, 10), workout(8, 10)]);
    const order = () => calls.map((c) => (c.system === REVIEW_SYSTEM_PROMPT ? 'review' : c.system === WEEK_CHAT_PROMPT ? 'week' : 'other')).filter((x) => x !== 'other');
    runtime.scan(); await settle();
    expect(order()).toEqual(['review']);
    for (let i = 0; i < 3; i++) { runtime.scan(); await settle(); }
    expect(order()).toEqual(['review', 'week']);
  });
});

describe('the weekly mail in the runtime', () => {
  const SUNDAY = new Date(2026, 10, 15, 18, 30).getTime();
  const mailFetch = () => vi.fn(async (url: string) => (String(url).endsWith('/v1/send') ? new Response(JSON.stringify({ status: 'ok' }), { status: 200 }) : new Response('', { status: 401 })));
  const CFG = { url: 'http://mail.example.org:8080', token: 'tok', appUrl: 'https://app.example.org' };
  const contact = (runtime: ReturnType<typeof make>['runtime'], weekly = true) => runtime.records.put('pa', { kind: 'contact', id: 'contact', updatedMs: 1, deleted: false, body: { email: 'a@example.org', weekly, atMs: 1 } });
  const sends = (f: ReturnType<typeof mailFetch>) => f.mock.calls.filter((c) => String(c[0]).endsWith('/v1/send'));

  test('a scan on Sunday evening sends one overview to the address, and a second scan does not', async () => {
    const fetchFn = mailFetch();
    const { runtime } = make({ mail: CFG, nowMs: () => SUNDAY, fetchFn: fetchFn as never });
    contact(runtime);
    runtime.scan(); await settle(); runtime.scan(); await settle();
    expect(sends(fetchFn)).toHaveLength(1);
    const body = JSON.parse(String((sends(fetchFn)[0] as unknown as [string, RequestInit])[1].body)) as Record<string, string>;
    expect(body.to).toBe('a@example.org');
    expect(body.subject).toBe('Deine Woche ab Mo., 16. Nov.');
    expect(body.text).toContain('Hallo A,');
    expect(body.text).toContain('Zur App: https://app.example.org');
  });

  test('nothing goes out without mail settings, with the switch off, or before the hour', async () => {
    const off = mailFetch();
    const a = make({ nowMs: () => SUNDAY, fetchFn: off as never });
    contact(a.runtime);
    a.runtime.scan(); await settle();
    const b = mailFetch();
    const c = make({ mail: CFG, nowMs: () => SUNDAY, fetchFn: b as never });
    contact(c.runtime, false);
    c.runtime.scan(); await settle();
    const d = mailFetch();
    const e = make({ mail: CFG, nowMs: () => SUNDAY - 3 * 3600_000, fetchFn: d as never });
    contact(e.runtime);
    e.runtime.scan(); await settle();
    expect([off, b, d].map((f) => sends(f).length)).toEqual([0, 0, 0]);
  });
});
