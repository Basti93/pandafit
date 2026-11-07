import type { MigrateResult } from './migrate';
import type { MoveBackoff } from './move-backoff';

export type AfterRideDeps = {
  profileIds: () => string[];
  /** False while a ride is open: then nothing here runs, and a run under way stops before its next step. */
  noOpenRide: () => boolean;
  onServer: (id: string) => boolean;
  /** Linked to an account and not refused. */
  linked: (id: string) => boolean;
  /** All of the profile's records are on the server. */
  settled: (id: string) => boolean;
  backoff: MoveBackoff;
  uploads: { tick: (id: string) => Promise<void> };
  /** Brings back a moved profile's rides this Mac lacks, once; `reset` for a profile that is not on the server. */
  restore: { tick: (id: string) => Promise<void>; reset: (id: string) => void };
  /** Runs one move; its result goes to the backoff here. */
  move: (id: string) => Promise<MigrateResult>;
  /** The meal plan's move, when due. */
  meals: () => Promise<boolean>;
};

/**
 * One pass after the ride: a moved profile's missing rides come back once, then its rides go up, a linked profile moves when its backoff allows, then the meal plan.
 * While a move waits for records, only `settled` is asked. Nothing starts with a ride open.
 */
export const afterRideJob = async (d: AfterRideDeps): Promise<void> => {
  for (const id of d.profileIds()) {
    if (!d.noOpenRide()) return;
    if (d.onServer(id)) {
      // What the server holds comes first, so a restored ride is in the ledger before the uploads look at the folder.
      await d.restore.tick(id);
      if (d.noOpenRide()) await d.uploads.tick(id);
      continue;
    }
    d.restore.reset(id);
    if (!d.linked(id) || !d.backoff.due(id, () => d.settled(id))) continue;
    d.backoff.record(id, await d.move(id));
  }
  if (d.noOpenRide()) await d.meals();
};
