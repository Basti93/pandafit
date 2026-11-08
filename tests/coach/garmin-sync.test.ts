import { EventEmitter } from 'node:events';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { PassThrough } from 'node:stream';
import { GarminSync } from '../../src/coach/garmin-sync';
import type { GarminTokens } from '../../src/coach/secrets/garmin-tokens';

const HOUR = 3600_000;
const setup = (opts: { tokens?: boolean; python?: boolean } = {}) => {
  const baseDir = fs.mkdtempSync(path.join(os.tmpdir(), 'garmin-sync-'));
  const python = path.join(baseDir, 'python');
  if (opts.python !== false) fs.writeFileSync(python, '');
  const tokens = path.join(baseDir, 'tokens', 'p1');
  if (opts.tokens !== false) { fs.mkdirSync(tokens, { recursive: true }); fs.writeFileSync(path.join(tokens, 'garmin_tokens.json'), '{}'); }
  const children: any[] = [];
  const spawnFn: any = (_bin: string, args: string[]) => {
    const child: any = new EventEmitter();
    child.stdout = new PassThrough();
    child.args = args;
    child.kill = vi.fn(() => child.emit('close', null, 'SIGTERM'));
    children.push(child);
    return child;
  };
  const env = { now: 1_000_000_000, ride: false };
  const make = () => new GarminSync({ baseDir, python, script: 's.py', spawnFn, rideOpen: () => env.ride, onUpdate: () => {}, nowMs: () => env.now });
  const finish = async (code: number, line?: object) => {
    const c = children.at(-1);
    if (line) c.stdout.write(`${JSON.stringify(line)}\n`);
    await new Promise((r) => setTimeout(r, 2));
    c.emit('close', code, null);
  };
  return { baseDir, tokens, children, env, make, sync: make(), finish };
};

test('starts the tool with tokens and database of this profile, and never twice', () => {
  const { sync, children, baseDir } = setup();
  sync.tick('p1');
  sync.tick('p1');
  expect(children).toHaveLength(1);
  expect(children[0].args).toEqual(expect.arrayContaining(['--tokens', path.join(baseDir, 'tokens', 'p1'), '--db', path.join(baseDir, 'data', 'p1', 'garmin.db')]));
  expect(sync.info('p1').running).toBe(true);
});
test('does not start without tokens or during a ride', () => {
  const none = setup({ tokens: false });
  none.sync.tick('p1');
  expect(none.children).toHaveLength(0);
  const riding = setup();
  riding.env.ride = true;
  riding.sync.tick('p1');
  expect(riding.children).toHaveLength(0);
});
test('runs a full sync every 3 hours until the history is complete, then every 6', async () => {
  const { sync, children, env, finish } = setup();
  const full = () => children.filter((c) => !c.args.includes('--quick')).length;
  // Ticks in steps of one hour; quick checks in between are finished at once.
  const hours = async (n: number) => {
    for (let i = 0; i < n; i++) {
      env.now += HOUR;
      sync.tick('p1');
      if (sync.info('p1').running) await finish(0, { status: 'ok' });
    }
  };
  sync.tick('p1');
  await finish(0, { status: 'ok', complete: false });
  expect(sync.info('p1')).toMatchObject({ running: false, complete: false, lastRunMs: env.now, problem: null });
  await hours(2);
  expect(full()).toBe(1);
  env.now += HOUR;
  sync.tick('p1');
  expect(full()).toBe(2);
  await finish(0, { status: 'ok', complete: true });
  await hours(5);
  expect(full()).toBe(2);
  await hours(1);
  expect(full()).toBe(3);
});
test('quick check runs one hour after the last try and passes --quick', async () => {
  const { sync, children, env, finish } = setup();
  sync.tick('p1');
  expect(children[0].args).not.toContain('--quick');
  await finish(0, { status: 'ok', complete: true });
  env.now += HOUR - 1;
  sync.tick('p1');
  expect(children).toHaveLength(1);
  env.now += 1;
  sync.tick('p1');
  expect(children).toHaveLength(2);
  expect(children[1].args).toContain('--quick');
  await finish(0, { status: 'ok' });
  env.now += HOUR - 1;
  sync.tick('p1');
  expect(children).toHaveLength(2);
  env.now += 1;
  sync.tick('p1');
  expect(children).toHaveLength(3);
  expect(children[2].args).toContain('--quick');
});
test('quick check leaves lastTryMs and complete alone', async () => {
  const { sync, children, env, finish } = setup();
  sync.tick('p1');
  const first = env.now;
  await finish(0, { status: 'ok', complete: false });
  env.now += HOUR;
  sync.tick('p1');
  expect(children[1].args).toContain('--quick');
  env.now += 5;
  await finish(0, { status: 'ok', complete: true });
  expect(sync.info('p1')).toMatchObject({ complete: false, lastRunMs: env.now, problem: null });
  const file = JSON.parse(fs.readFileSync(path.join((sync as any).dataDir('p1'), 'sync-meta.json'), 'utf8'));
  expect(file).toMatchObject({ lastTryMs: first, lastQuickMs: first + HOUR, complete: false });
  // A failed quick check changes nothing but lastQuickMs.
  env.now += HOUR;
  sync.tick('p1');
  await finish(1);
  expect(sync.info('p1').problem).toBeNull();
  expect(JSON.parse(fs.readFileSync(path.join((sync as any).dataDir('p1'), 'sync-meta.json'), 'utf8'))).toMatchObject({ lastTryMs: first, lastQuickMs: env.now });
});
test('full sync wins when it is due', async () => {
  const { sync, children, env, finish } = setup();
  sync.tick('p1');
  await finish(0, { status: 'ok', complete: false });
  env.now += 3 * HOUR;
  sync.tick('p1');
  expect(children).toHaveLength(2);
  expect(children[1].args).not.toContain('--quick');
});
test('rate limit from a quick check blocks both for six hours', async () => {
  const { sync, children, env, finish } = setup();
  sync.tick('p1');
  await finish(0, { status: 'ok', complete: true });
  env.now += HOUR;
  sync.tick('p1');
  const started = env.now;
  await finish(11, { status: 'rate-limit' });
  expect(sync.info('p1').problem).toBe('rate-limit');
  env.now = started + 6 * HOUR - 1;
  sync.tick('p1');
  expect(children).toHaveLength(2);
  env.now = started + 6 * HOUR;
  sync.tick('p1');
  expect(children).toHaveLength(3);
  expect(children[2].args).not.toContain('--quick');
});
test('no quick check while a ride is open', async () => {
  const { sync, children, env, finish } = setup();
  sync.tick('p1');
  await finish(0, { status: 'ok', complete: true });
  env.now += HOUR;
  env.ride = true;
  sync.tick('p1');
  expect(children).toHaveLength(1);
});
test('a ride stops a running sync, without counting as a failure, and it resumes afterwards', async () => {
  const { sync, children, env } = setup();
  sync.tick('p1');
  env.ride = true;
  sync.tick('p1');
  expect(children[0].kill).toHaveBeenCalled();
  expect(sync.info('p1')).toMatchObject({ running: false, problem: null, lastRunMs: null });
  env.ride = false;
  sync.tick('p1');
  expect(children).toHaveLength(2);
});
test('an expired login stops further runs until new tokens exist', async () => {
  const { sync, children, env, finish, tokens } = setup();
  sync.tick('p1');
  await finish(10);
  expect(sync.info('p1').problem).toBe('reauth');
  env.now += 24 * HOUR;
  sync.tick('p1');
  expect(children).toHaveLength(1);
  const f = path.join(tokens, 'garmin_tokens.json');
  fs.writeFileSync(f, '{"neu":1}');
  fs.utimesSync(f, new Date(), new Date(Date.now() + 5000));
  sync.tick('p1');
  expect(children).toHaveLength(2);
  expect(sync.info('p1').problem).toBeNull();
});
test('a rate limit waits six hours', async () => {
  const { sync, children, env, finish } = setup();
  sync.tick('p1');
  await finish(11);
  expect(sync.info('p1').problem).toBe('rate-limit');
  env.now += 6 * HOUR - 1;
  sync.tick('p1');
  expect(children).toHaveLength(1);
  env.now += 1;
  sync.tick('p1');
  expect(children).toHaveLength(2);
});
test('another failure retries after 30 minutes', async () => {
  const { sync, children, env, finish } = setup();
  sync.tick('p1');
  await finish(12);
  expect(sync.info('p1').problem).toBe('failed');
  env.now += 30 * 60_000;
  sync.tick('p1');
  expect(children).toHaveLength(2);
});
test('a missing helper reports a failure instead of throwing', () => {
  const { sync, children } = setup({ python: false });
  sync.tick('p1');
  expect(children).toHaveLength(0);
  expect(sync.info('p1').problem).toBe('failed');
});
test('the status survives a restart', async () => {
  const { sync, make, children, env, finish } = setup();
  sync.tick('p1');
  await finish(0, { status: 'ok', complete: true });
  const again = make();
  expect(again.info('p1')).toMatchObject({ complete: true, lastRunMs: env.now });
  again.tick('p1');
  expect(children).toHaveLength(1);
});
test('unsafe profile ids are ignored', () => {
  const { sync, children } = setup();
  sync.tick('../p1');
  expect(children).toHaveLength(0);
});

const recordingTokens = (log: string[], mtime: number | null = 5): GarminTokens => ({
  has: () => mtime !== null,
  mtimeMs: () => mtime,
  checkout: (id) => { log.push(`checkout ${id}`); return { id, dir: `/run/secrets/${id}`, gen: 1 }; },
  checkin: (h, how) => { log.push(`checkin ${h.id}${how?.discard ? ' discard' : ''}`); },
  remove: (id) => { log.push(`remove ${id}`); },
});
test('a sync run checks out before the spawn and checks in after the child exits, also when it fails', async () => {
  const { baseDir } = setup({ tokens: false });
  const log: string[] = [];
  const children: any[] = [];
  const spawnFn: any = (_bin: string, args: string[]) => {
    log.push('spawn');
    const child: any = new EventEmitter();
    child.stdout = new PassThrough();
    child.args = args;
    child.kill = vi.fn(() => child.emit('close', null, 'SIGTERM'));
    children.push(child);
    return child;
  };
  const env = { now: 1_000_000_000, ride: false };
  const sync = new GarminSync({ baseDir, python: path.join(baseDir, 'python'), script: 's.py', spawnFn, tokens: recordingTokens(log), rideOpen: () => env.ride, onUpdate: () => {}, nowMs: () => env.now });
  sync.tick('p1');
  expect(log).toEqual(['checkout p1', 'spawn']);
  expect(children[0].args).toEqual(expect.arrayContaining(['--tokens', '/run/secrets/p1']));
  children[0].emit('close', 0, null);
  expect(log).toEqual(['checkout p1', 'spawn', 'checkin p1']);

  env.now += 3 * HOUR;
  sync.tick('p1');
  children[1].emit('error', new Error('weg'));
  children[1].emit('close', 1, null);
  expect(log.slice(3)).toEqual(['checkout p1', 'spawn', 'checkin p1']);
  expect(sync.info('p1').problem).toBe('failed');

  // Stopped by a ride: checked in as well.
  env.now += HOUR;
  sync.tick('p1');
  env.ride = true;
  sync.tick('p1');
  expect(log.slice(6)).toEqual(['checkout p1', 'spawn', 'checkin p1']);
});
test('the sync uses the tokens time to see a new login', async () => {
  const { baseDir } = setup({ tokens: false });
  let mtime: number | null = 5;
  const log: string[] = [];
  const tokens: GarminTokens = { ...recordingTokens(log), has: () => mtime !== null, mtimeMs: () => mtime };
  const children: any[] = [];
  const spawnFn: any = () => { const c: any = new EventEmitter(); c.stdout = new PassThrough(); c.kill = vi.fn(); children.push(c); return c; };
  const sync = new GarminSync({ baseDir, python: path.join(baseDir, 'python'), script: 's.py', spawnFn, tokens, rideOpen: () => false, onUpdate: () => {}, nowMs: () => 1 });
  sync.tick('p1');
  children[0].emit('close', 10, null);
  expect(sync.info('p1').problem).toBe('reauth');
  sync.tick('p1');
  expect(children).toHaveLength(1);
  mtime = 6;
  sync.tick('p1');
  expect(children).toHaveLength(2);
});
