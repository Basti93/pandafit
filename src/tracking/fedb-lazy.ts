import type { Exercise } from '../shared/exercises';

/**
 * The base catalog (about 1 MB of JSON) is loaded on first use, so it is a separate chunk and not part of the app's first load.
 * Code that runs in node imports ../shared/fedb directly instead.
 */
let loaded: Exercise[] | null = null;
let pending: Promise<Exercise[]> | null = null;

export function loadFedb(): Promise<Exercise[]> {
  pending ??= import('../shared/fedb').then((m) => (loaded = m.FEDB_EXERCISES));
  return pending;
}

/** The base catalog once loaded, else null. */
export const fedbIfLoaded = (): Exercise[] | null => loaded;
