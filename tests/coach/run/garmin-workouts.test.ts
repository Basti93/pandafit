import { EventEmitter } from 'node:events';
import { vi } from 'vitest';
import { GarminWorkouts, type WorkoutOps, type WorkoutResult } from '../../../src/coach/run/garmin-workouts';
import type { GarminTokens, TokenCheckout } from '../../../src/coach/secrets/garmin-tokens';

type Child = EventEmitter & { stdout: EventEmitter; stdin: { end: ReturnType<typeof vi.fn> }; kill: ReturnType<typeof vi.fn> };

const OPS: WorkoutOps = {
  delete: [{ workoutId: '7', scheduleId: '70' }],
  create: [{ date: '2026-11-04', name: 'Lauf ruhig', warmupS: 300, mainS: 1200, cooldownS: 300, hrLow: 114, hrHigh: 143 }],
};

const make = (o: { rideOpen?: boolean } = {}) => {
  const children: Child[] = [];
  const spawnFn = vi.fn(() => {
    const child = Object.assign(new EventEmitter(), { stdout: new EventEmitter(), stdin: { end: vi.fn() }, kill: vi.fn() });
    children.push(child);
    return child;
  });
  const checkins: [TokenCheckout, { discard?: boolean } | undefined][] = [];
  const tokens: GarminTokens = {
    has: (id) => id !== 'ohne', mtimeMs: () => null,
    checkout: (id) => ({ id, dir: `/run/${id}`, gen: 1 }),
    checkin: (h, how) => { checkins.push([h, how]); },
    remove: () => {},
  };
  const results: [string, string, WorkoutResult][] = [];
  const w = new GarminWorkouts({
    python: 'py', script: 'w.py', baseDir: '/g', tokens, rideOpen: () => o.rideOpen ?? false,
    onResult: (id, week, r) => results.push([id, week, r]), spawnFn: spawnFn as never,
  });
  return { w, children, spawnFn, checkins, results };
};
const finish = (c: Child, out: string) => { c.stdout.emit('data', Buffer.from(out)); c.emit('close', 0); };

afterEach(() => { vi.useRealTimers(); });

test('no run starts during a ride or without tokens', () => {
  const ride = make({ rideOpen: true });
  expect(ride.w.send('pa', '2026-11-02', OPS)).toBe(false);
  const none = make();
  expect(none.w.send('ohne', '2026-11-02', OPS)).toBe(false);
  expect(none.w.send('../pa', '2026-11-02', OPS)).toBe(false);
  expect(ride.spawnFn).not.toHaveBeenCalled();
  expect(none.spawnFn).not.toHaveBeenCalled();
});

test('the ops go to stdin and the last JSON line is the result', () => {
  const { w, children, spawnFn, checkins, results } = make();
  expect(w.send('pa', '2026-11-02', OPS)).toBe(true);
  expect(spawnFn).toHaveBeenCalledWith('py', ['w.py', '--tokens', '/run/pa'], expect.objectContaining({ stdio: ['pipe', 'pipe', 'pipe'] }));
  expect(children[0]!.stdin.end).toHaveBeenCalledWith(JSON.stringify(OPS));
  // One run per profile at a time.
  expect(w.send('pa', '2026-11-02', OPS)).toBe(false);
  const r: WorkoutResult = { status: 'ok', reason: null, deleted: ['7'], created: [{ date: '2026-11-04', workoutId: '101', scheduleId: '1101' }] };
  finish(children[0]!, `library noise\n${JSON.stringify(r)}\n`);
  expect(results).toEqual([['pa', '2026-11-02', r]]);
  expect(checkins).toHaveLength(1);
  expect(w.send('pa', '2026-11-02', OPS)).toBe(true);
});

test('unreadable output is a failure that keeps nothing', () => {
  const { w, children, results } = make();
  w.send('pa', '2026-11-02', OPS);
  finish(children[0]!, 'Quatsch\n');
  expect(results[0]![2]).toEqual({ status: 'failed', reason: 'failed', deleted: [], created: [] });
});

test('a hang is killed after the timeout and the tokens are checked in', () => {
  vi.useFakeTimers();
  const { w, children, checkins, results } = make();
  w.send('pa', '2026-11-02', OPS);
  vi.advanceTimersByTime(179_000);
  expect(children[0]!.kill).not.toHaveBeenCalled();
  vi.advanceTimersByTime(1_000);
  expect(children[0]!.kill).toHaveBeenCalled();
  expect(checkins.length).toBeGreaterThanOrEqual(1);
  children[0]!.emit('close', null);
  expect(results[0]![2].status).toBe('failed');
});

test('stop ends the run at once and discards what it wrote', () => {
  const { w, children, checkins } = make();
  w.send('pa', '2026-11-02', OPS);
  w.stop('pa');
  expect(children[0]!.kill).toHaveBeenCalled();
  expect(checkins[0]![1]).toEqual({ discard: true });
});

test('capable stays false when the check prints unsupported or fails', () => {
  const unsupported = make();
  expect(unsupported.w.capable('pa')).toBe(false);
  unsupported.w.check('pa');
  expect(unsupported.spawnFn).toHaveBeenCalledWith('py', ['w.py', '--tokens', '/run/pa', '--check'], expect.anything());
  finish(unsupported.children[0]!, '{"status":"unsupported"}\n');
  expect(unsupported.w.capable('pa')).toBe(false);
  expect(unsupported.checkins).toHaveLength(1);

  const broken = make();
  broken.w.check('pa');
  broken.children[0]!.emit('error', new Error('weg'));
  expect(broken.w.capable('pa')).toBe(false);
});

test('the check runs once per process and ok makes it capable', () => {
  const { w, children, spawnFn } = make();
  w.check('ohne');
  expect(spawnFn).not.toHaveBeenCalled();
  w.check('pa');
  w.check('pa');
  w.check('pb');
  expect(spawnFn).toHaveBeenCalledTimes(1);
  finish(children[0]!, '{"status":"ok"}\n');
  expect(w.capable('pa')).toBe(true);
  expect(w.capable('pb')).toBe(true);
  w.check('pa');
  expect(spawnFn).toHaveBeenCalledTimes(1);
});
