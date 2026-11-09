import nodeFs from 'node:fs';
import path from 'node:path';
import { randomBytes } from 'node:crypto';

export type AtomicOpts = { mode?: number; fs?: typeof nodeFs };

/**
 * Test runs only: hundreds of test files fsyncing at once make the suite twice as slow. Never set in the apps or containers;
 * tests that check durability turn it off again.
 */
const durable = (): boolean => process.env.PANDAFIT_UNSAFE_NO_FSYNC !== '1';

/** Writes to a unique temp file, fsyncs, renames over the target and fsyncs the folder. A failure leaves the old file untouched. */
export const writeFileAtomic = (file: string, data: string | Uint8Array, opts: AtomicOpts = {}): void => {
  const fs = opts.fs ?? nodeFs;
  const tmp = `${file}.${process.pid}.${randomBytes(4).toString('hex')}.tmp`;
  try {
    const fd = fs.openSync(tmp, 'w', opts.mode ?? 0o644);
    try { fs.writeFileSync(fd, data); if (durable()) fs.fsyncSync(fd); } finally { fs.closeSync(fd); }
    // The mode of openSync is reduced by the umask; set it exactly.
    if (opts.mode !== undefined) fs.chmodSync(tmp, opts.mode);
    fs.renameSync(tmp, file);
  } catch (e) {
    try { fs.rmSync(tmp, { force: true }); } catch { /* nothing left to clean */ }
    throw e;
  }
  if (!durable()) return;
  try {
    const dfd = fs.openSync(path.dirname(file), 'r');
    try { fs.fsyncSync(dfd); } finally { fs.closeSync(dfd); }
  } catch { /* folder fsync is not supported everywhere */ }
};

export const writeJsonAtomic = (file: string, value: unknown, opts: AtomicOpts = {}): void =>
  writeFileAtomic(file, JSON.stringify(value), opts);

const TEMP_NAME = /\.\d+\.[0-9a-f]{8}\.tmp$/;

/**
 * A crash between write and rename leaves `<name>.<pid>.<8 hex>.tmp` behind. Deletes those older than the limit in `dir` and its
 * sub-folders (down to `depth` levels). Best effort: every error is ignored, a file in use by a live write is younger than the limit.
 */
export const removeStaleTemps = (dir: string, olderThanMs = 3_600_000, depth = 2, nowMs: number = Date.now()): void => {
  let entries: nodeFs.Dirent[];
  try { entries = nodeFs.readdirSync(dir, { withFileTypes: true }); } catch { return; }
  for (const e of entries) {
    const full = path.join(dir, e.name);
    try {
      if (e.isDirectory()) { if (depth > 0) removeStaleTemps(full, olderThanMs, depth - 1, nowMs); continue; }
      if (!e.isFile() || !TEMP_NAME.test(e.name)) continue;
      if (nowMs - nodeFs.statSync(full).mtimeMs > olderThanMs) nodeFs.rmSync(full, { force: true });
    } catch { /* best effort */ }
  }
};
