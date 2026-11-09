import fs from 'node:fs';
import path from 'node:path';
import { writeJsonAtomic } from '../shared/node/atomic-write';

/** `<dir>/<profileId>.json`; the id is encoded so it cannot leave the folder. */
export const profileStateFile = (dir: string, profileId: string): string => path.join(dir, `${encodeURIComponent(profileId)}.json`);

export type StateFile<T> = {
  /** A missing file gives `empty()`. A file that cannot be read as a state is copied to `<file>.broken` and gives `empty()`. */
  load(): T;
  /** Atomic write. `keepRules`: legacy `rules` already in the file stay there (until they were migrated into records). */
  save(value: T, opts?: { keepRules?: boolean }): void;
};

/** The one JSON state file of a profile. `migrate` gets the parsed JSON and throws when it is not a usable state. */
export const createStateFile = <T>(file: string, opts: { empty: () => T; migrate?: (raw: unknown) => T; mode?: number }): StateFile<T> => ({
  load() {
    if (!fs.existsSync(file)) return opts.empty();
    try {
      const raw: unknown = JSON.parse(fs.readFileSync(file, 'utf8'));
      return opts.migrate ? opts.migrate(raw) : (raw as T);
    } catch {
      try { fs.copyFileSync(file, `${file}.broken`); } catch { /* starting fresh matters more */ }
      return opts.empty();
    }
  },
  save(value, o = {}) {
    fs.mkdirSync(path.dirname(file), { recursive: true });
    const keep = o.keepRules ? legacyField(file) : undefined;
    writeJsonAtomic(file, keep === undefined ? value : { ...value, rules: keep }, { mode: opts.mode });
  },
});

/** The free-text rules older versions kept in a state file (moved to `rule` records, see tracking/personal). */
export const legacyRuleTexts = (file: string): string[] => {
  try {
    const parsed = JSON.parse(fs.readFileSync(file, 'utf8')) as { rules?: unknown };
    return Array.isArray(parsed.rules) ? parsed.rules.flatMap((r: unknown) => (typeof (r as { text?: unknown })?.text === 'string' ? [(r as { text: string }).text] : [])) : [];
  } catch { return []; }
};

const legacyField = (f: string): unknown => {
  try { const r = (JSON.parse(fs.readFileSync(f, 'utf8')) as { rules?: unknown }).rules; return Array.isArray(r) && r.length ? r : undefined; } catch { return undefined; }
};
