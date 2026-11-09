import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { removeStaleTemps, writeFileAtomic, writeJsonAtomic } from '../../src/shared/node/atomic-write';

let dir: string;
beforeEach(() => { dir = fs.mkdtempSync(path.join(os.tmpdir(), 'atomic-')); });

test('writes the content and leaves no temp file', () => {
  const f = path.join(dir, 'a.json');
  writeFileAtomic(f, 'hello');
  writeJsonAtomic(path.join(dir, 'b.json'), { x: 1 });
  expect(fs.readFileSync(f, 'utf8')).toBe('hello');
  expect(JSON.parse(fs.readFileSync(path.join(dir, 'b.json'), 'utf8'))).toEqual({ x: 1 });
  expect(fs.readdirSync(dir).filter((n) => n.endsWith('.tmp'))).toEqual([]);
});
test('accepts bytes and replaces an existing file', () => {
  const f = path.join(dir, 'a.bin');
  writeFileAtomic(f, 'old');
  writeFileAtomic(f, new Uint8Array([1, 2, 3]));
  expect([...fs.readFileSync(f)]).toEqual([1, 2, 3]);
});
test('a failed write keeps the old file and removes the temp file', () => {
  const f = path.join(dir, 'a.json');
  writeFileAtomic(f, 'old');
  const failing = { ...fs, writeFileSync: () => { throw new Error('disk full'); } } as unknown as typeof fs;
  expect(() => writeFileAtomic(f, 'new', { fs: failing })).toThrow('disk full');
  expect(fs.readFileSync(f, 'utf8')).toBe('old');
  expect(fs.readdirSync(dir)).toEqual(['a.json']);
});
test('mode 0600 gives owner-only permissions', () => {
  const f = path.join(dir, 's.json');
  writeFileAtomic(f, 'secret', { mode: 0o600 });
  expect(fs.statSync(f).mode & 0o777).toBe(0o600);
});
test('fsyncs the file and its folder unless the test-only switch is set', () => {
  vi.stubEnv('PANDAFIT_UNSAFE_NO_FSYNC', '0');
  const spy = vi.spyOn(fs, 'fsyncSync');
  writeFileAtomic(path.join(dir, 'a.json'), 'x');
  expect(spy).toHaveBeenCalledTimes(2);
  spy.mockClear();
  vi.stubEnv('PANDAFIT_UNSAFE_NO_FSYNC', '1');
  writeFileAtomic(path.join(dir, 'b.json'), 'x');
  expect(spy).not.toHaveBeenCalled();
  spy.mockRestore();
  vi.unstubAllEnvs();
});

test('removeStaleTemps deletes only old files named like the helper temp files', () => {
  fs.mkdirSync(path.join(dir, 'ride-1'));
  const old = [path.join(dir, 'a.json.123.deadbeef.tmp'), path.join(dir, 'ride-1', 'meta.json.9.0123abcd.tmp')];
  const young = path.join(dir, 'b.json.123.deadbeef.tmp');
  const foreign = [path.join(dir, 'c.tmp'), path.join(dir, 'd.json.1.xyz.tmp'), path.join(dir, 'keep.json')];
  for (const f of [...old, young, ...foreign]) fs.writeFileSync(f, 'x');
  const past = new Date(Date.now() - 2 * 3_600_000);
  for (const f of [...old, ...foreign]) fs.utimesSync(f, past, past);
  removeStaleTemps(dir);
  expect(old.map((f) => fs.existsSync(f))).toEqual([false, false]);
  expect([young, ...foreign].map((f) => fs.existsSync(f))).toEqual([true, true, true, true]);
  expect(() => removeStaleTemps(path.join(dir, 'missing'))).not.toThrow();
});
