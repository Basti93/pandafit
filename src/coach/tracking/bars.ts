import type { TrackedRecord } from '../../shared/records';
import { readBars, type Bars } from '../../shared/bars';
import type { Renames } from '../../shared/studio';

/** The person's bar weights and bar types, per profile (not mirrored: bars belong to the person's studios). */
export function barsOf(store: { all(profileId: string, kind?: 'bar'): TrackedRecord[] }, profileId: string, renames?: Renames): Bars {
  try { return readBars(store.all(profileId, 'bar'), renames); } catch { return { weights: new Map(), uses: new Map() }; }
}
