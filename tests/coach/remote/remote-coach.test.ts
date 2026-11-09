import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, vi } from 'vitest';
import { coachSocketUrl, MAX_QUEUE, RemoteCoach, ruleFallback, type RemoteCoachOptions } from '../../../src/coach/remote/remote-coach';
import type { CoachState } from '../../../src/coach/state';
import type { CoachServerMessage, CoachStateMessage } from '../../../src/shared/coach-protocol';
import { fakeSockets } from './fake-socket';

const NOW = Date.UTC(2026, 10, 3, 12);
const SERVER = 'https://pandafit.example.org/api';
const TOKEN = 'device-token-test';
const temp = () => fs.mkdtempSync(path.join(os.tmpdir(), 'rc-'));

const serverState = (over: Partial<CoachState> = {}): CoachStateMessage => {
  const s = ruleFallback(temp(), 'pa', 200, NOW);
  return {
    type: 'coach-state', thinking: false, together: { summits: [] } as never,
    state: { ...s, next: { session: { id: 'server-plan', name: 'Vom Server', steps: s.next.session.steps }, reason: 'Server', source: 'claude' }, ...over },
  };
};

let coaches: RemoteCoach[] = [];
afterEach(() => { for (const c of coaches) c.stop(); coaches = []; vi.useRealTimers(); });

const make = (over: Partial<RemoteCoachOptions> & { dir?: string } = {}) => {
  const ws = fakeSockets();
  const w = { ride: false, now: NOW, messages: [] as CoachServerMessage[], rejected: 0 };
  const dir = over.dir ?? temp();
  const coach = new RemoteCoach({
    dir, profileId: 'pa', url: () => SERVER, token: () => TOKEN,
    mayWrite: () => !w.ride, fallback: () => ruleFallback(path.join(dir, 'local-coach'), 'pa', 200, w.now), nowMs: () => w.now,
    WebSocketImpl: ws.Impl, onMessage: (m) => w.messages.push(m), reject: () => { w.rejected++; },
    ...over,
  });
  coaches.push(coach);
  return { coach, ws, w, dir };
};
const queuedFrames = (sent: Record<string, unknown>[]) => sent.filter((m) => m.type === 'queued') as { qid: string; atMs: number; message: { type: string; text?: string } }[];

test('the socket goes to the link address as wss://…/coach with the device token', () => {
  expect(coachSocketUrl('https://pandafit.example.org/api')).toBe('wss://pandafit.example.org/api/coach');
  expect(coachSocketUrl('http://localhost:8081')).toBe('ws://localhost:8081/coach');
  expect(coachSocketUrl('ftp://x')).toBeNull();
  const { coach, ws } = make();
  coach.start();
  expect(ws.last().url).toBe('wss://pandafit.example.org/api/coach');
  expect(ws.last().options.headers).toEqual({ authorization: `Bearer ${TOKEN}` });
});

test('a moved profile subscribes to the server and gets its coach-state with coachHome { where: \'server\', online: true, session: \'server\' }', () => {
  const { coach, ws, w, dir } = make();
  coach.start();
  ws.last().open();
  expect(ws.last().sent).toEqual([{ type: 'subscribe', profileId: 'pa' }]);
  ws.last().answer(serverState());
  const v = coach.view();
  expect(v.state.next.session.id).toBe('server-plan');
  expect(v.coachHome).toEqual({ where: 'server', online: true, sinceMs: NOW, session: 'server', queued: 0, full: false });
  expect(w.messages.at(-1)).toEqual(v);
  // Kept for the next ride, also when the server is down then.
  expect(JSON.parse(fs.readFileSync(path.join(dir, 'state.json'), 'utf8')).view.state.next.session.id).toBe('server-plan');
});

test('offline: coach-state comes from the cache, marked online false and session cached', () => {
  const dir = temp();
  const first = make({ dir });
  first.coach.start();
  first.ws.last().open();
  first.ws.last().answer({ ...serverState(), thinking: true });
  first.coach.stop();
  // A restart while the server is down.
  const { coach, ws, w } = make({ dir });
  w.now = NOW + 3_600_000;
  coach.start();
  ws.last().end(1013);
  const v = coach.view();
  expect(v.state.next.session.id).toBe('server-plan');
  expect(v.thinking).toBe(false);
  expect(v.coachHome).toEqual({ where: 'server', online: false, sinceMs: NOW, session: 'cached', queued: 0, full: false });
});

test('offline without a cache: the next session is the local rule session, marked rules', () => {
  const { coach, ws } = make();
  coach.start();
  ws.last().end(1013);
  const v = coach.view();
  expect(v.state.next.source).toBe('rules');
  expect(v.state.profileId).toBe('pa');
  expect(v.coachHome).toMatchObject({ where: 'server', online: false, sinceMs: null, session: 'rules' });
});

test('writes while offline are queued in order with their time and sent as queued messages when back', () => {
  vi.useFakeTimers();
  const { coach, ws, w, dir } = make();
  coach.start();
  ws.last().end(1013);
  expect(coach.send({ type: 'note', profileId: 'pa', text: 'erste' })).toBe('queued');
  w.now += 1000;
  expect(coach.send({ type: 'set-ftp', profileId: 'pa', ftpW: 230 })).toBe('queued');
  w.now += 1000;
  expect(coach.send({ type: 'note', profileId: 'pa', text: 'zweite' })).toBe('queued');
  expect(coach.status()).toEqual({ online: false, sinceMs: null, queued: 3 });
  expect(coach.view().coachHome).toMatchObject({ queued: 3 });
  // Back after the backoff.
  vi.advanceTimersByTime(1000);
  expect(ws.sockets).toHaveLength(2);
  ws.last().open();
  const q = queuedFrames(ws.last().sent);
  expect(ws.last().types()).toEqual(['subscribe', 'queued', 'queued', 'queued']);
  expect(q.map((e) => [e.message.type, e.atMs])).toEqual([['note', NOW], ['set-ftp', NOW + 1000], ['note', NOW + 2000]]);
  expect(new Set(q.map((e) => e.qid)).size).toBe(3);
  // Only an ack takes an entry out of the queue.
  ws.last().answer({ type: 'queued-ack', qid: q[0]!.qid });
  expect(coach.status().queued).toBe(2);
  expect(JSON.parse(fs.readFileSync(path.join(dir, 'queue.json'), 'utf8'))).toHaveLength(2);
  // Cut before the other acks: the rest goes again after the reconnect, in order and with the same ids.
  ws.last().end(1006);
  vi.advanceTimersByTime(1000);
  ws.last().open();
  expect(queuedFrames(ws.last().sent).map((e) => e.qid)).toEqual([q[1]!.qid, q[2]!.qid]);
  ws.last().answer({ type: 'queued-ack', qid: q[1]!.qid });
  ws.last().answer({ type: 'queued-ack', qid: q[2]!.qid });
  expect(coach.status().queued).toBe(0);
  // Online, a write goes out at once, still as a queued entry with its time.
  expect(coach.send({ type: 'note', profileId: 'pa', text: 'live' })).toBe('sent');
  expect(queuedFrames(ws.last().sent).at(-1)!.message).toEqual({ type: 'note', profileId: 'pa', text: 'live' });
});

test('with a ride open nothing is sent: writes are queued and the subscription stays', () => {
  vi.useFakeTimers();
  const { coach, ws, w } = make();
  coach.start();
  ws.last().open();
  ws.last().answer(serverState());
  w.ride = true;
  const before = ws.last().sent.length;
  expect(coach.send({ type: 'pass-progress', profileId: 'pa', passId: 'stelvio', distanceM: 1200 })).toBe('queued');
  expect(coach.send({ type: 'note', profileId: 'pa', text: 'Beine schwer' })).toBe('queued');
  expect(coach.send({ type: 'gym-preview', profileId: 'pa' })).toBe('refused');
  expect(coach.send({ type: 'garmin-upload', profileId: 'pa', rideId: 'ride-1' })).toBe('refused');
  vi.advanceTimersByTime(30_000);
  expect(ws.last().sent).toHaveLength(before);
  expect(ws.last().closed).toBeNull();
  expect(ws.sockets).toHaveLength(1);
  // A new state from the server still arrives.
  ws.last().answer(serverState({ ftpW: 210 }));
  expect(coach.view().state.ftpW).toBe(210);
  expect(coach.view().coachHome).toMatchObject({ online: true, queued: 2 });
  // The ride closed: the queue goes out on its own.
  w.ride = false;
  vi.advanceTimersByTime(2000);
  expect(queuedFrames(ws.last().sent).map((e) => e.message.type)).toEqual(['pass-progress', 'note']);
});

test('the queue survives a restart', () => {
  const dir = temp();
  const first = make({ dir });
  first.coach.start();
  first.ws.last().end(1013);
  first.coach.send({ type: 'note', profileId: 'pa', text: 'vor dem Neustart' });
  first.coach.send({ type: 'feedback', profileId: 'pa', rideId: 'ride-1', rating: 'hard' });
  first.coach.stop();
  const { coach, ws } = make({ dir });
  expect(coach.status().queued).toBe(2);
  coach.start();
  ws.last().open();
  expect(queuedFrames(ws.last().sent).map((e) => e.message.type)).toEqual(['note', 'feedback']);
});

test('a local fallback plan is never sent: the queue holds only messages the UI sent', () => {
  vi.useFakeTimers();
  const { coach, ws, dir } = make();
  coach.start();
  ws.last().end(1013);
  expect(coach.view().state.next.source).toBe('rules');
  coach.send({ type: 'adjust', profileId: 'pa', how: 'easier' });
  expect(JSON.parse(fs.readFileSync(path.join(dir, 'queue.json'), 'utf8')).map((e: { message: unknown }) => e.message)).toEqual([{ type: 'adjust', profileId: 'pa', how: 'easier' }]);
  vi.advanceTimersByTime(1000);
  ws.last().open();
  expect(ws.last().sent).toEqual([{ type: 'subscribe', profileId: 'pa' }, expect.objectContaining({ type: 'queued', message: { type: 'adjust', profileId: 'pa', how: 'easier' } })]);
  expect(JSON.stringify(ws.last().sent)).not.toContain('regel-');
});

test('a request that wants the server now is refused offline and sent live online', () => {
  const { coach, ws } = make();
  coach.start();
  expect(coach.send({ type: 'hevy-connect', profileId: 'pa', key: '00000000-0000-0000-0000-000000000000' })).toBe('refused');
  ws.last().open();
  expect(coach.send({ type: 'gym-preview', profileId: 'pa' })).toBe('sent');
  expect(ws.last().sent.at(-1)).toEqual({ type: 'gym-preview', profileId: 'pa' });
  ws.last().answer({ type: 'gym-preview', preview: null });
  expect(coach.send({ type: 'queued', qid: 'x', atMs: NOW, message: { type: 'note', profileId: 'pa', text: 'x' } })).toBe('refused');
});

test('the queue holds at most 1000 entries and refuses more', () => {
  const dir = temp();
  fs.writeFileSync(path.join(dir, 'queue.json'), JSON.stringify(Array.from({ length: MAX_QUEUE - 1 }, (_, i) => ({ qid: `q${i}`, atMs: NOW, message: { type: 'word-result', profileId: 'pa', nl: `w${i}`, knew: true } }))));
  const { coach, ws } = make({ dir });
  coach.start();
  ws.last().end(1013);
  expect(coach.send({ type: 'word-result', profileId: 'pa', nl: 'letztes', knew: true })).toBe('queued');
  expect(coach.send({ type: 'note', profileId: 'pa', text: 'eine zu viel' })).toBe('refused');
  expect(coach.status().queued).toBe(MAX_QUEUE);
});

test('a full queue is shown, not dropped silently: the view says full, and a pass-progress still merges', () => {
  const dir = temp();
  fs.writeFileSync(path.join(dir, 'queue.json'), JSON.stringify(Array.from({ length: MAX_QUEUE - 1 }, (_, i) => ({ qid: `q${i}`, atMs: NOW, message: { type: 'word-result', profileId: 'pa', nl: `w${i}`, knew: true } }))));
  const { coach, ws, w } = make({ dir });
  coach.start();
  ws.last().end(1013);
  expect(coach.view().coachHome).toMatchObject({ queued: MAX_QUEUE - 1, full: false });
  expect(coach.send({ type: 'pass-progress', profileId: 'pa', passId: 'stelvio', distanceM: 100 })).toBe('queued');
  expect(coach.view().coachHome).toMatchObject({ queued: MAX_QUEUE, full: true });
  w.messages.length = 0;
  expect(coach.send({ type: 'note', profileId: 'pa', text: 'eine zu viel' })).toBe('refused');
  expect(w.messages.at(-1)).toMatchObject({ type: 'coach-state', coachHome: { full: true } });
  // Replacing the pass's entry does not grow the queue.
  expect(coach.send({ type: 'pass-progress', profileId: 'pa', passId: 'stelvio', distanceM: 200 })).toBe('queued');
  expect(coach.status().queued).toBe(MAX_QUEUE);
});

test('pass-progress is merged per pass in the queue, and a lower distance never replaces a higher one', () => {
  const { coach, ws, dir } = make();
  coach.start();
  ws.last().end(1013);
  const progress = (passId: string, distanceM: number) => coach.send({ type: 'pass-progress', profileId: 'pa', passId, distanceM });
  progress('stelvio', 1000);
  progress('stelvio', 2000);
  progress('galibier', 300);
  progress('stelvio', 1500);
  const queued = () => (JSON.parse(fs.readFileSync(path.join(dir, 'queue.json'), 'utf8')) as { message: { type: string; passId?: string; distanceM?: number } }[]).map((e) => [e.message.type, e.message.passId, e.message.distanceM]);
  expect(queued()).toEqual([['pass-progress', 'stelvio', 2000], ['pass-progress', 'galibier', 300]]);
  progress('stelvio', 2500);
  expect(queued()).toEqual([['pass-progress', 'galibier', 300], ['pass-progress', 'stelvio', 2500]]);
  // A summit starts the climb again: progress after it is its own entry.
  coach.send({ type: 'pass-summit', profileId: 'pa', passId: 'stelvio' });
  progress('stelvio', 100);
  expect(queued()).toEqual([['pass-progress', 'galibier', 300], ['pass-progress', 'stelvio', 2500], ['pass-summit', 'stelvio', undefined], ['pass-progress', 'stelvio', 100]]);
});

test('1013 and a refused upgrade back off from 1 s to 60 s; 4404 keeps the cache and shows offline', () => {
  vi.useFakeTimers();
  const { coach, ws, w } = make();
  coach.start();
  ws.last().open();
  ws.last().answer(serverState());
  ws.last().end(4404);
  expect(coach.view().coachHome).toMatchObject({ online: false, session: 'cached' });
  expect(coach.view().state.next.session.id).toBe('server-plan');
  expect(w.rejected).toBe(0);
  const gaps: number[] = [];
  for (let i = 0; i < 9; i++) {
    const n = ws.sockets.length;
    let waited = 0;
    while (ws.sockets.length === n) { vi.advanceTimersByTime(500); waited += 500; }
    gaps.push(waited);
    if (i % 2) ws.last().end(1013); else ws.last().refuse(503);
  }
  expect(gaps).toEqual([1000, 2000, 4000, 8000, 16000, 32000, 60000, 60000, 60000]);
  expect(w.rejected).toBe(0);
});

test('a 401 on the upgrade rejects the link; without a token no socket is opened', () => {
  vi.useFakeTimers();
  let token: string | null = TOKEN;
  const { coach, ws, w } = make({ token: () => token, reject: () => { w.rejected++; token = null; } });
  coach.start();
  ws.last().refuse(401);
  expect(w.rejected).toBe(1);
  vi.advanceTimersByTime(10 * 60_000);
  expect(ws.sockets).toHaveLength(1);
  expect(coach.view().coachHome).toMatchObject({ online: false });
});

test('queue.json is written with fsync of the file and of its folder', () => {
  const { coach, ws, dir } = make();
  coach.start();
  ws.last().end(1013);
  // Which path each fd belongs to at the moment it is synced (fds are reused after a close).
  const realOpen = fs.openSync.bind(fs);
  const realSync = fs.fsyncSync.bind(fs);
  const byFd = new Map<number, string>();
  const synced: string[] = [];
  const openSpy = vi.spyOn(fs, 'openSync').mockImplementation(((f: fs.PathLike, ...rest: never[]) => { const fd = (realOpen as (...a: unknown[]) => number)(f, ...rest); byFd.set(fd, String(f)); return fd; }) as typeof fs.openSync);
  const sync = vi.spyOn(fs, 'fsyncSync').mockImplementation((fd: number) => { synced.push(byFd.get(fd) ?? '?'); realSync(fd); });
  coach.send({ type: 'note', profileId: 'pa', text: 'sicher' });
  expect(synced.some((f) => f.startsWith(path.join(dir, 'queue.json.')) && f.endsWith('.tmp'))).toBe(true);
  expect(synced).toContain(dir);
  expect(JSON.parse(fs.readFileSync(path.join(dir, 'queue.json'), 'utf8'))).toHaveLength(1);
  sync.mockRestore(); openSpy.mockRestore();
});

test('an unreadable queue.json is moved aside, never overwritten, and logged', () => {
  const dir = temp();
  fs.writeFileSync(path.join(dir, 'queue.json'), '[{"qid":"a","atMs":1,"mess');
  const log = vi.spyOn(console, 'error').mockImplementation(() => {});
  const { coach, ws } = make({ dir });
  expect(coach.status().queued).toBe(0);
  expect(fs.readFileSync(path.join(dir, `queue.corrupt-${NOW}.json`), 'utf8')).toBe('[{"qid":"a","atMs":1,"mess');
  expect(log).toHaveBeenCalledWith(expect.stringContaining('queue.corrupt-'));
  coach.start();
  ws.last().end(1013);
  coach.send({ type: 'note', profileId: 'pa', text: 'neu' });
  expect(JSON.parse(fs.readFileSync(path.join(dir, 'queue.json'), 'utf8'))).toHaveLength(1);
  expect(fs.readFileSync(path.join(dir, `queue.corrupt-${NOW}.json`), 'utf8')).toBe('[{"qid":"a","atMs":1,"mess');
  log.mockRestore();
});
