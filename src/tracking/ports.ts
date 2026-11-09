import type { RecordKind, TrackedRecord } from '../shared/records';

/** What a write ended as: `kept` false means a newer record stayed, and `updatedMs` is that record's. */
export type PutResult = { kept: boolean; updatedMs: number };

/** The only way the tracking screens reach storage and sync. IndexedDB, Electron or a test fake sit behind it. */
export type TrackingPort = {
  list(kind: RecordKind): Promise<TrackedRecord[]>;
  /** Must apply `applyRecord` semantics (newer `updatedMs` wins, ties by JSON text) and must not blindly overwrite; callers raise `updatedMs` above what they saw. Reports what was kept. `seenMs` is the version a workout write stands on. */
  put(r: TrackedRecord, opts?: { seenMs?: number }): Promise<PutResult>;
  /** Fires after every local `put` and after every remote change that arrives. Listeners must tell the two apart by comparing `updatedMs`. */
  subscribe(fn: () => void): () => void;
  /** Like `subscribe`, but only for changes to records of `kind`. Optional: without it the records cache reloads on every change. */
  subscribeKind?(kind: RecordKind, fn: () => void): () => void;
  /** Fires when `syncState()` may have changed (counts, last sync, sync status). Optional. */
  subscribeSync?(fn: () => void): () => void;
  /** `refused` counts records the other side did not accept; they stay safe on this device. */
  syncState(): { pending: number; lastOkMs: number | null; refused?: number };
  /** Arms (or with null cancels) a notification for the end of the rest, for when the screen is locked. Fire and forget: never throws, never awaited. */
  restAlarm?(atMs: number | null): void;
};
