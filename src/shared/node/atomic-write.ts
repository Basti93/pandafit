import nodeFs from 'node:fs';
import path from 'node:path';
import { randomBytes } from 'node:crypto';

export type AtomicOpts = { mode?: number; fs?: typeof nodeFs };

/** Writes to a unique temp file, fsyncs, renames over the target and fsyncs the folder. A failure leaves the old file untouched. */
export const writeFileAtomic = (file: string, data: string | Uint8Array, opts: AtomicOpts = {}): void => {
  const fs = opts.fs ?? nodeFs;
  const tmp = `${file}.${process.pid}.${randomBytes(4).toString('hex')}.tmp`;
  try {
    const fd = fs.openSync(tmp, 'w', opts.mode ?? 0o644);
    try { fs.writeFileSync(fd, data); fs.fsyncSync(fd); } finally { fs.closeSync(fd); }
    // The mode of openSync is reduced by the umask; set it exactly.
    if (opts.mode !== undefined) fs.chmodSync(tmp, opts.mode);
    fs.renameSync(tmp, file);
  } catch (e) {
    try { fs.rmSync(tmp, { force: true }); } catch { /* nothing left to clean */ }
    throw e;
  }
  try {
    const dfd = fs.openSync(path.dirname(file), 'r');
    try { fs.fsyncSync(dfd); } finally { fs.closeSync(dfd); }
  } catch { /* folder fsync is not supported everywhere */ }
};

export const writeJsonAtomic = (file: string, value: unknown, opts: AtomicOpts = {}): void =>
  writeFileAtomic(file, JSON.stringify(value), opts);
