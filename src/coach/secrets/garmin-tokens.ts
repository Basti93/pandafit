import fs from 'node:fs';
import path from 'node:path';
import type { SecretCodec } from './secret-box';
import { writeFileAtomic } from '../../shared/node/atomic-write';

const SAFE_ID = /^[A-Za-z0-9-]+$/;
const TOKEN_FILE = 'garmin_tokens.json';
const SEALED_FILE = `${TOKEN_FILE}.sealed`;
/** The folder this process creates and owns inside the given run dir, which may be a mount point owned by root. */
const OWN_FOLDER = 'garmin';

/** One use of the tokens. `dir` goes to the program as `--tokens`. Hand it back to `checkin` exactly when the use ends. */
export type TokenCheckout = { readonly id: string; readonly dir: string; readonly gen: number };

/**
 * Where a Python run finds the Garmin login of a profile. Every checkout ends with a checkin of its handle, also when the run fails.
 * A checkin is safe to repeat, and a handle from before a `remove` only ever wipes its own folder.
 */
export type GarminTokens = {
  has(id: string): boolean;
  mtimeMs(id: string): number | null;
  /** Throws `TokensUnopenable` when stored tokens exist but do not open, any other error for anything else. */
  checkout(id: string): TokenCheckout;
  /** discard: whatever the program left is dropped, never stored. */
  checkin(handle: TokenCheckout, opts?: { discard?: boolean }): void;
  remove(id: string): void;
};

/** Stored tokens exist but do not open: another key, another account or a damaged file. Carries no detail on purpose. */
export class TokensUnopenable extends Error {
  constructor() { super('Garmin-Zugang lässt sich nicht öffnen'); }
}

const safe = (id: string): string => {
  if (!SAFE_ID.test(id)) throw new Error('Ungültiges Profil');
  return id;
};

const mtimeOf = (file: string): number | null => {
  try { return fs.statSync(file).mtimeMs; } catch { return null; }
};

/** The Mac's way, as today: the program reads and writes `<garminDir>/tokens/<id>` itself. */
export const plainTokens = (garminDir: string): GarminTokens => {
  const dir = (id: string) => path.join(garminDir, 'tokens', safe(id));
  return {
    has: (id) => SAFE_ID.test(id) && fs.existsSync(path.join(dir(id), TOKEN_FILE)),
    mtimeMs: (id) => (SAFE_ID.test(id) ? mtimeOf(path.join(dir(id), TOKEN_FILE)) : null),
    checkout: (id) => ({ id, dir: dir(id), gen: 0 }),
    checkin: () => {},
    remove: (id) => { if (SAFE_ID.test(id)) fs.rmSync(dir(id), { recursive: true, force: true }); },
  };
};

type Open = { gen: number; dir: string; opened: string | null; holders: Set<TokenCheckout>; discarded: boolean };

/**
 * Sealed at rest in `<garminDir>/tokens/<id>/garmin_tokens.json.sealed`. Opened into `<runDir>/garmin/<id>.<gen>/` (tmpfs on the server) only while
 * runs last, sealed back when a program changed it, and wiped at the last checkin. Overlapping runs of one profile share one generation;
 * after a `remove` the next checkout starts a new one in a new folder, so a late old run can never touch it.
 */
export const sealedTokens = (opts: { garminDir: string; runDir: string; codec: (id: string) => SecretCodec }): GarminTokens => {
  const base = path.join(opts.runDir, OWN_FOLDER);
  const sealedFile = (id: string) => path.join(opts.garminDir, 'tokens', safe(id), SEALED_FILE);
  const open = new Map<string, Open>();
  let nextGen = 1;

  // Whatever an earlier process left (a crash with tokens checked out) goes now. Only our own folder: the run dir itself is not ours.
  try { fs.rmSync(base, { recursive: true, force: true }); } catch { /* checkout reports it */ }

  const wipe = (dir: string): void => { fs.rmSync(dir, { recursive: true, force: true }); };

  const sealBack = (id: string, text: string): void => {
    const target = sealedFile(id);
    fs.mkdirSync(path.dirname(target), { recursive: true, mode: 0o700 });
    writeFileAtomic(target, opts.codec(id).seal(text), { mode: 0o600 });
  };

  return {
    has: (id) => SAFE_ID.test(id) && fs.existsSync(sealedFile(id)),
    mtimeMs: (id) => (SAFE_ID.test(id) ? mtimeOf(sealedFile(id)) : null),

    checkout: (id) => {
      safe(id);
      const current = open.get(id);
      if (current) {
        const handle: TokenCheckout = { id, dir: current.dir, gen: current.gen };
        current.holders.add(handle);
        return handle;
      }
      fs.mkdirSync(base, { recursive: true, mode: 0o700 });
      fs.chmodSync(base, 0o700);
      const gen = nextGen++;
      const dir = path.join(base, `${id}.${gen}`);
      wipe(dir);
      fs.mkdirSync(dir, { mode: 0o700 });
      fs.chmodSync(dir, 0o700);
      let opened: string | null = null;
      let stored: string | null = null;
      try { stored = fs.readFileSync(sealedFile(id), 'utf8'); } catch { /* no login yet: an empty folder for the login */ }
      if (stored !== null) {
        try { opened = opts.codec(id).open(stored.trim()); } catch { wipe(dir); throw new TokensUnopenable(); }
        try {
          const file = path.join(dir, TOKEN_FILE);
          fs.writeFileSync(file, opened, { mode: 0o600, flag: 'wx' });
          fs.chmodSync(file, 0o600);
        } catch {
          wipe(dir);
          // Deliberately without the cause.
          throw new Error('Garmin-Zugang lässt sich nicht bereitstellen');
        }
      }
      const handle: TokenCheckout = { id, dir, gen };
      open.set(id, { gen, dir, opened, holders: new Set([handle]), discarded: false });
      return handle;
    },

    checkin: (handle, how) => {
      if (!SAFE_ID.test(handle.id)) return;
      const current = open.get(handle.id);
      if (!current || !current.holders.has(handle)) {
        // Already checked in, or from before a remove: only its own folder goes, never a newer one.
        if (!current || current.dir !== handle.dir) wipe(handle.dir);
        return;
      }
      current.holders.delete(handle);
      if (how?.discard) current.discarded = true;
      if (current.holders.size > 0) return;
      open.delete(handle.id);
      try {
        if (current.discarded) return;
        let text: string | null = null;
        try { text = fs.readFileSync(path.join(current.dir, TOKEN_FILE), 'utf8'); } catch { /* the program wrote nothing */ }
        if (text !== null && text !== current.opened) sealBack(handle.id, text);
      } catch {
        throw new Error('Garmin-Zugang lässt sich nicht speichern');
      } finally {
        wipe(current.dir);
      }
    },

    remove: (id) => {
      if (!SAFE_ID.test(id)) return;
      const current = open.get(id);
      open.delete(id);
      if (current) wipe(current.dir);
      try {
        for (const name of fs.readdirSync(base)) if (name.startsWith(`${id}.`)) wipe(path.join(base, name));
      } catch { /* no run folder yet */ }
      fs.rmSync(path.join(opts.garminDir, 'tokens', id), { recursive: true, force: true });
    },
  };
};
