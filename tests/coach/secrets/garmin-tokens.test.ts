import { EventEmitter } from 'node:events';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { PassThrough } from 'node:stream';
import { GarminSync } from '../../../src/coach/garmin-sync';
import { GarminLink } from '../../../src/coach/garmin';
import { GarminUploader } from '../../../src/coach/garmin-uploader';
import { plainTokens, sealedTokens, TokensUnopenable } from '../../../src/coach/secrets/garmin-tokens';
import { sealedCodec } from '../../../src/coach/secrets/secret-box';

const KEY = Buffer.alloc(32, 9);
const OTHER_KEY = Buffer.alloc(32, 8);
const TOKEN_TEXT = '{"oauth":"token-text-sehr-geheim"}';
const mode = (p: string) => fs.statSync(p).mode & 0o777;
const tmp = (name: string) => fs.mkdtempSync(path.join(os.tmpdir(), name));

const filesUnder = (dir: string): string[] => (fs.existsSync(dir) ? fs.readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
  const p = path.join(dir, e.name);
  return e.isDirectory() ? filesUnder(p) : [p];
}) : []);

/** runDir stands for a mount point the process does not own: it exists already and keeps its mode. */
const sealedSetup = (key = KEY, dirs?: { garminDir: string; runDir: string }) => {
  const garminDir = dirs?.garminDir ?? tmp('garmin-');
  const runDir = dirs?.runDir ?? tmp('run-');
  if (!dirs) fs.chmodSync(runDir, 0o755);
  const tokens = sealedTokens({ garminDir, runDir, codec: (id) => sealedCodec(key, `acc-${id}:garmin`) });
  return { garminDir, runDir, tokens, base: path.join(runDir, 'garmin') };
};
const sealedFileOf = (garminDir: string, id = 'p1') => path.join(garminDir, 'tokens', id, 'garmin_tokens.json.sealed');

/** Stores tokens as a login would: check out, the Python program writes the file, check in. */
const login = (tokens: ReturnType<typeof sealedTokens>, id: string, text = TOKEN_TEXT) => {
  const h = tokens.checkout(id);
  fs.writeFileSync(path.join(h.dir, 'garmin_tokens.json'), text);
  tokens.checkin(h);
};
const read = (tokens: ReturnType<typeof sealedTokens>, id = 'p1') => {
  const h = tokens.checkout(id);
  const text = fs.readFileSync(path.join(h.dir, 'garmin_tokens.json'), 'utf8');
  tokens.checkin(h);
  return text;
};

test('plain tokens use <garmin>/tokens/<id> and checkin changes nothing', () => {
  const garminDir = tmp('garmin-');
  const tokens = plainTokens(garminDir);
  const dir = path.join(garminDir, 'tokens', 'p1');
  expect(tokens.has('p1')).toBe(false);
  expect(tokens.mtimeMs('p1')).toBeNull();
  const h = tokens.checkout('p1');
  expect(h.dir).toBe(dir);
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, 'garmin_tokens.json'), TOKEN_TEXT);
  const before = fs.statSync(path.join(dir, 'garmin_tokens.json')).mtimeMs;
  tokens.checkin(h);
  tokens.checkin(h, { discard: true });
  expect(fs.readFileSync(path.join(dir, 'garmin_tokens.json'), 'utf8')).toBe(TOKEN_TEXT);
  expect(fs.readdirSync(dir)).toEqual(['garmin_tokens.json']);
  expect(tokens.has('p1')).toBe(true);
  expect(tokens.mtimeMs('p1')).toBe(before);
  tokens.remove('p1');
  expect(fs.existsSync(dir)).toBe(false);
  expect(tokens.has('p1')).toBe(false);
});

test('sealed checkout writes garmin_tokens.json under runDir with mode 0600; checkin seals a changed file back and removes the run folder', () => {
  const { garminDir, runDir, base, tokens } = sealedSetup();
  login(tokens, 'p1');
  const sealedFile = sealedFileOf(garminDir);
  expect(fs.readFileSync(sealedFile, 'utf8').startsWith('pfs1.')).toBe(true);
  expect(mode(sealedFile)).toBe(0o600);
  expect(tokens.has('p1')).toBe(true);
  expect(tokens.mtimeMs('p1')).not.toBeNull();

  const h = tokens.checkout('p1');
  expect(path.dirname(h.dir)).toBe(base);
  // Its own subfolder, 0700. The given run dir (maybe a root-owned mount point) is left as it is.
  expect(mode(base)).toBe(0o700);
  expect(mode(runDir)).toBe(0o755);
  expect(mode(h.dir)).toBe(0o700);
  const file = path.join(h.dir, 'garmin_tokens.json');
  expect(fs.readFileSync(file, 'utf8')).toBe(TOKEN_TEXT);
  expect(mode(file)).toBe(0o600);

  // Unchanged: the sealed file stays as it is, so a sync does not take it for a new login.
  const sealedBefore = fs.readFileSync(sealedFile, 'utf8');
  tokens.checkin(h);
  expect(fs.existsSync(h.dir)).toBe(false);
  expect(fs.readFileSync(sealedFile, 'utf8')).toBe(sealedBefore);

  // Changed (the program refreshed its token): sealed back.
  const again = tokens.checkout('p1');
  fs.writeFileSync(path.join(again.dir, 'garmin_tokens.json'), '{"oauth":"refreshed"}');
  tokens.checkin(again);
  expect(fs.existsSync(again.dir)).toBe(false);
  expect(fs.readFileSync(sealedFile, 'utf8')).not.toBe(sealedBefore);
  expect(read(tokens)).toBe('{"oauth":"refreshed"}');
});

test('the sealed file is flushed to disk before it replaces the old one', () => {
  vi.stubEnv('PANDAFIT_UNSAFE_NO_FSYNC', '0'); // durability is what this test checks
  const { tokens } = sealedSetup();
  const fsync = vi.spyOn(fs, 'fsyncSync');
  try {
    login(tokens, 'p1');
    expect(fsync).toHaveBeenCalled();
  } finally { fsync.mockRestore(); }
});

test('with sealed tokens no file under garminDir contains the token text', () => {
  const { garminDir, tokens } = sealedSetup();
  login(tokens, 'p1');
  const h = tokens.checkout('p1');
  fs.writeFileSync(path.join(h.dir, 'garmin_tokens.json'), TOKEN_TEXT.replace('sehr', 'neu'));
  tokens.checkin(h);
  const files = filesUnder(garminDir);
  expect(files.length).toBeGreaterThan(0);
  for (const f of files) {
    const text = fs.readFileSync(f, 'utf8');
    expect(text).not.toContain('token-text');
    expect(text).not.toContain('oauth');
  }
});

test('overlapping checkouts share one folder, which goes with the last checkin', () => {
  const { tokens } = sealedSetup();
  login(tokens, 'p1');
  const a = tokens.checkout('p1');
  const b = tokens.checkout('p1');
  expect(b.dir).toBe(a.dir);
  tokens.checkin(a);
  expect(fs.existsSync(path.join(a.dir, 'garmin_tokens.json'))).toBe(true);
  tokens.checkin(b);
  expect(fs.existsSync(a.dir)).toBe(false);
});

test('a discarded checkin seals nothing back', () => {
  const { tokens } = sealedSetup();
  login(tokens, 'p1');
  const h = tokens.checkout('p1');
  fs.writeFileSync(path.join(h.dir, 'garmin_tokens.json'), '{"oauth":"verworfen"}');
  tokens.checkin(h, { discard: true });
  expect(fs.existsSync(h.dir)).toBe(false);
  expect(read(tokens)).toBe(TOKEN_TEXT);
});

test('a stale handle neither seals back nor touches a newer checkout', () => {
  const { base, tokens } = sealedSetup();
  login(tokens, 'p1', '{"oauth":"alt"}');
  const old = tokens.checkout('p1');
  tokens.remove('p1');
  const fresh = tokens.checkout('p1');
  expect(fresh.dir).not.toBe(old.dir);
  expect(fs.readdirSync(fresh.dir)).toEqual([]);
  // The old program still writes its refreshed token, into its own folder, then exits.
  fs.mkdirSync(old.dir, { recursive: true });
  fs.writeFileSync(path.join(old.dir, 'garmin_tokens.json'), '{"oauth":"alt-refreshed"}');
  tokens.checkin(old);
  expect(fs.existsSync(old.dir)).toBe(false);
  expect(fs.existsSync(fresh.dir)).toBe(true);
  expect(tokens.has('p1')).toBe(false);
  fs.writeFileSync(path.join(fresh.dir, 'garmin_tokens.json'), '{"oauth":"neu"}');
  tokens.checkin(fresh);
  expect(read(tokens)).toBe('{"oauth":"neu"}');
  expect(filesUnder(base)).toEqual([]);
  // A checkin twice is harmless.
  tokens.checkin(fresh);
  expect(read(tokens)).toBe('{"oauth":"neu"}');
});

test('tokens sealed for one profile do not open for another, and the error says so without a token', () => {
  const { garminDir, base, tokens } = sealedSetup();
  login(tokens, 'p1');
  fs.mkdirSync(path.join(garminDir, 'tokens', 'p2'), { recursive: true });
  fs.copyFileSync(sealedFileOf(garminDir), sealedFileOf(garminDir, 'p2'));
  let error: unknown = null;
  try { tokens.checkout('p2'); } catch (e) { error = e; }
  expect(error).toBeInstanceOf(TokensUnopenable);
  const message = `${String(error)} ${(error as Error).stack ?? ''}`;
  expect(message).not.toContain('token-text');
  expect(filesUnder(base)).toEqual([]);
});

test('remove deletes the sealed tokens and a checked-out folder, and a late checkin brings nothing back', () => {
  const { garminDir, base, tokens } = sealedSetup();
  login(tokens, 'p1');
  const h = tokens.checkout('p1');
  tokens.remove('p1');
  expect(fs.existsSync(path.join(garminDir, 'tokens', 'p1'))).toBe(false);
  expect(fs.existsSync(h.dir)).toBe(false);
  tokens.checkin(h);
  expect(tokens.has('p1')).toBe(false);
  expect(filesUnder(base)).toEqual([]);
});

test('leftovers from an earlier process are wiped at the start, and nothing else in the run dir is touched', () => {
  const { garminDir, runDir, base, tokens } = sealedSetup();
  login(tokens, 'p1');
  const h = tokens.checkout('p1');
  fs.writeFileSync(path.join(runDir, 'fremd'), 'x');
  // The process dies here with tokens checked out.
  expect(fs.existsSync(path.join(h.dir, 'garmin_tokens.json'))).toBe(true);
  const again = sealedSetup(KEY, { garminDir, runDir });
  expect(filesUnder(base)).toEqual([]);
  expect(fs.existsSync(path.join(runDir, 'fremd'))).toBe(true);
  expect(read(again.tokens)).toBe(TOKEN_TEXT);
});

test('unsafe ids are refused', () => {
  const { tokens } = sealedSetup();
  expect(tokens.has('../p1')).toBe(false);
  expect(() => tokens.checkout('../p1')).toThrow();
  expect(() => tokens.checkout('p1.2')).toThrow();
  expect(() => plainTokens(tmp('garmin-')).checkout('../x')).toThrow();
});

// ---- the Python runs around checkout and checkin ----

const fakeSpawn = (opts: { closeOnKill?: boolean } = {}) => {
  const children: any[] = [];
  const spawnFn: any = (_bin: string, args: string[]) => {
    const child: any = new EventEmitter();
    child.stdout = new PassThrough();
    child.stdin = new PassThrough();
    child.args = args;
    child.kill = vi.fn(() => { if (opts.closeOnKill !== false) child.emit('close', null, 'SIGTERM'); });
    children.push(child);
    return child;
  };
  return { children, spawnFn };
};
const tokensArg = (child: any): string => child.args[child.args.indexOf('--tokens') + 1];

test('not there: no tokens means has() is false and no Python run starts', () => {
  const { garminDir, tokens } = sealedSetup();
  const python = path.join(garminDir, 'python');
  fs.writeFileSync(python, '');
  const { children, spawnFn } = fakeSpawn();
  expect(tokens.has('p1')).toBe(false);
  expect(tokens.mtimeMs('p1')).toBeNull();
  const sync = new GarminSync({ baseDir: garminDir, python, script: 's.py', spawnFn, tokens, rideOpen: () => false, onUpdate: () => {}, nowMs: () => 1 });
  sync.tick('p1');
  const uploader = new GarminUploader({ python, script: 'u.py', baseDir: garminDir, exportsDir: '/x', tokens, rideOpen: () => false, onResult: () => {}, spawnFn });
  expect(uploader.upload('p1', 'r1', 'Fahrt', 1)).toBe(false);
  const link = new GarminLink({ baseDir: garminDir, python, script: 'b.py', spawnFn, tokens, onUpdate: () => {} });
  expect(link.status('p1')).toEqual({ state: 'idle' });
  expect(children).toHaveLength(0);
});

test('a sealed sync run gets the run folder, and a crash wipes it while keeping the tokens', async () => {
  const { garminDir, base, tokens } = sealedSetup();
  login(tokens, 'p1');
  const python = path.join(garminDir, 'python');
  fs.writeFileSync(python, '');
  const { children, spawnFn } = fakeSpawn();
  const sync = new GarminSync({ baseDir: garminDir, python, script: 's.py', spawnFn, tokens, rideOpen: () => false, onUpdate: () => {}, nowMs: () => 1 });
  sync.tick('p1');
  expect(children).toHaveLength(1);
  const dir = tokensArg(children[0]);
  expect(path.dirname(dir)).toBe(base);
  expect(fs.readFileSync(path.join(dir, 'garmin_tokens.json'), 'utf8')).toBe(TOKEN_TEXT);
  children[0].emit('error', new Error('boom'));
  children[0].emit('close', 1, null);
  expect(filesUnder(base)).toEqual([]);
  expect(tokens.has('p1')).toBe(true);
  expect(sync.info('p1').problem).toBe('failed');
});

const unopenable = () => {
  // Sealed with another key: what a changed PANDAFIT_SECRET_KEY leaves behind.
  const before = sealedSetup(OTHER_KEY);
  login(before.tokens, 'p1');
  const s = sealedSetup(KEY, { garminDir: before.garminDir, runDir: before.runDir });
  const python = path.join(s.garminDir, 'python');
  fs.writeFileSync(python, '');
  return { ...s, python };
};

test('a sync with tokens that do not open asks for a new login and starts nothing', () => {
  const { garminDir, base, tokens, python } = unopenable();
  const { children, spawnFn } = fakeSpawn();
  const sync = new GarminSync({ baseDir: garminDir, python, script: 's.py', spawnFn, tokens, rideOpen: () => false, onUpdate: () => {}, nowMs: () => 1 });
  sync.tick('p1');
  expect(children).toHaveLength(0);
  expect(filesUnder(base)).toEqual([]);
  expect(sync.info('p1').problem).toBe('reauth');
  // Asks once, then waits for new tokens.
  sync.tick('p1');
  expect(sync.info('p1').problem).toBe('reauth');
});

test('an upload with tokens that do not open reports reauth and starts nothing', () => {
  const { garminDir, base, tokens, python } = unopenable();
  const { children, spawnFn } = fakeSpawn();
  const results: unknown[] = [];
  const uploader = new GarminUploader({ python, script: 'u.py', baseDir: garminDir, exportsDir: '/x', tokens, rideOpen: () => false, onResult: (_p, _r, x) => results.push(x), spawnFn });
  expect(uploader.upload('p1', 'r1', 'Fahrt', 1)).toBe(false);
  expect(results).toEqual([{ status: 'failed', reason: 'reauth' }]);
  expect(children).toHaveLength(0);
  expect(filesUnder(base)).toEqual([]);
});

test('a login with tokens that do not open drops them and logs in fresh from the password', () => {
  const { garminDir, tokens, python } = unopenable();
  const { children, spawnFn } = fakeSpawn();
  const link = new GarminLink({ baseDir: garminDir, python, script: 'b.py', spawnFn, tokens, onUpdate: () => {} });
  link.login('p1', 'a@b.c', 'pw');
  expect(children).toHaveLength(1);
  expect(fs.existsSync(sealedFileOf(garminDir))).toBe(false);
  const request = JSON.parse(String(children[0].stdin.read()).split('\n')[0]);
  expect(fs.readdirSync(request.tokens)).toEqual([]);
  fs.writeFileSync(path.join(request.tokens, 'garmin_tokens.json'), '{"oauth":"neu"}');
  children[0].stdout.write(`${JSON.stringify({ status: 'connected' })}\n`);
  children[0].emit('close', 0, null);
  expect(link.status('p1')).toEqual({ state: 'connected' });
  expect(read(tokens)).toBe('{"oauth":"neu"}');
});

test('a sealed upload that times out or fails wipes the run folder', async () => {
  vi.useFakeTimers();
  try {
    const { garminDir, base, tokens } = sealedSetup();
    login(tokens, 'p1');
    const { children, spawnFn } = fakeSpawn({ closeOnKill: false });
    const results: unknown[] = [];
    const uploader = new GarminUploader({ python: 'py', script: 'u.py', baseDir: garminDir, exportsDir: '/x', tokens, rideOpen: () => false, onResult: (_p, _r, x) => results.push(x), spawnFn });
    expect(uploader.upload('p1', 'r1', 'Fahrt', 1)).toBe(true);
    expect(path.dirname(tokensArg(children[0]))).toBe(base);
    expect(fs.existsSync(path.join(tokensArg(children[0]), 'garmin_tokens.json'))).toBe(true);
    vi.advanceTimersByTime(120_000);
    expect(children[0].kill).toHaveBeenCalled();
    // Wiped at once, even though the hung program has not exited yet.
    expect(filesUnder(base)).toEqual([]);
    children[0].emit('close', null, 'SIGTERM');
    expect(results).toHaveLength(1);

    expect(uploader.upload('p1', 'r2', 'Fahrt', 1)).toBe(true);
    children[1].emit('error', new Error('spawn failed'));
    expect(filesUnder(base)).toEqual([]);
    expect(tokens.has('p1')).toBe(true);
  } finally { vi.useRealTimers(); }
});

test('a sealed login stores the new tokens sealed once the helper ends, and a disconnect leaves nothing', () => {
  const { garminDir, base, tokens } = sealedSetup();
  const python = path.join(garminDir, 'python');
  fs.writeFileSync(python, '');
  const { children, spawnFn } = fakeSpawn();
  const link = new GarminLink({ baseDir: garminDir, python, script: 'b.py', spawnFn, tokens, onUpdate: () => {} });
  link.login('p1', 'a@b.c', 'pw');
  const request = JSON.parse(String(children[0].stdin.read()).split('\n')[0]);
  expect(path.dirname(request.tokens)).toBe(base);
  expect(fs.statSync(request.tokens).isDirectory()).toBe(true);
  fs.writeFileSync(path.join(request.tokens, 'garmin_tokens.json'), TOKEN_TEXT);
  children[0].stdout.write(`${JSON.stringify({ status: 'connected' })}\n`);
  children[0].emit('close', 0, null);
  expect(filesUnder(base)).toEqual([]);
  expect(link.status('p1')).toEqual({ state: 'connected' });
  expect(tokens.has('p1')).toBe(true);

  // A login that is still running when the profile disconnects: the late exit brings nothing back.
  const fresh = new GarminLink({ baseDir: garminDir, python, script: 'b.py', spawnFn, tokens, onUpdate: () => {} });
  fresh.login('p1', 'a@b.c', 'pw');
  const second = JSON.parse(String(children[1].stdin.read()).split('\n')[0]);
  fs.writeFileSync(path.join(second.tokens, 'garmin_tokens.json'), TOKEN_TEXT);
  fresh.disconnect('p1');
  expect(filesUnder(base)).toEqual([]);
  expect(tokens.has('p1')).toBe(false);
  expect(fresh.status('p1')).toEqual({ state: 'idle' });
});

test('stopping a profile kills its sync and upload and seals nothing of theirs back', () => {
  const { garminDir, base, tokens } = sealedSetup();
  login(tokens, 'p1');
  const python = path.join(garminDir, 'python');
  fs.writeFileSync(python, '');
  const { children, spawnFn } = fakeSpawn();
  const sync = new GarminSync({ baseDir: garminDir, python, script: 's.py', spawnFn, tokens, rideOpen: () => false, onUpdate: () => {}, nowMs: () => 1 });
  const results: unknown[] = [];
  const uploader = new GarminUploader({ python, script: 'u.py', baseDir: garminDir, exportsDir: '/x', tokens, rideOpen: () => false, onResult: (_p, _r, x) => results.push(x), spawnFn });
  sync.tick('p1');
  expect(uploader.upload('p1', 'r1', 'Fahrt', 1)).toBe(true);
  fs.writeFileSync(path.join(tokensArg(children[0]), 'garmin_tokens.json'), '{"oauth":"alt-refreshed"}');
  sync.stop('p1');
  uploader.stop('p1');
  expect(children[0].kill).toHaveBeenCalled();
  expect(children[1].kill).toHaveBeenCalled();
  expect(filesUnder(base)).toEqual([]);
  expect(read(tokens)).toBe(TOKEN_TEXT);
  expect(sync.info('p1')).toMatchObject({ running: false, problem: null });
  expect(results).toHaveLength(1);
});

afterEach(() => { vi.unstubAllEnvs(); });
