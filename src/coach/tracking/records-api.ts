import type { CoachClientMessage, CoachServerMessage } from '../protocol';
import { RECORD_KINDS, type RecordKind, type TrackedRecord } from '../../shared/records';
import type { RecordStore } from './store';

export { RECORD_KINDS };
export const MAX_BODY_BYTES = 1_000_000;

/** A record as the store may keep it. Extra body fields stay, everything else is cut to the known shape. */
export function validRecord(x: unknown): TrackedRecord | null {
  if (typeof x !== 'object' || x === null) return null;
  const r = x as Record<string, unknown>;
  if (typeof r.kind !== 'string' || !RECORD_KINDS.includes(r.kind as RecordKind)) return null;
  if (typeof r.id !== 'string' || r.id === '' || r.id.length > 200) return null;
  if (typeof r.updatedMs !== 'number' || !Number.isFinite(r.updatedMs)) return null;
  if (typeof r.deleted !== 'boolean') return null;
  let text: string | undefined;
  try { text = JSON.stringify(r.body); } catch { return null; }
  if (text === undefined || Buffer.byteLength(text) > MAX_BODY_BYTES) return null;
  return { kind: r.kind as RecordKind, id: r.id, updatedMs: r.updatedMs, deleted: r.deleted, body: r.body };
}

type Deps = {
  store: Pick<RecordStore, 'put' | 'all'>;
  gym: { start(id: string): void; workoutFinished(id: string): void };
  /** Ids of the profiles that exist. Nothing is stored or created for any other id. */
  profiles: () => string[];
};
type Result = { reply: CoachServerMessage; changed?: string };

export const finishedOwnWorkout = (r: TrackedRecord | undefined): boolean | null => {
  if (!r || r.kind !== 'workout' || r.deleted || typeof r.body !== 'object' || r.body === null) return null;
  const b = r.body as { endMs?: unknown; source?: unknown };
  if (b.source === 'hevy') return null;
  return typeof b.endMs === 'number' && Number.isFinite(b.endMs);
};

/** Local reads and writes only: no AI, no Hevy, no Garmin, so also fine with a ride open. */
export function handleRecords(deps: Deps, m: Extract<CoachClientMessage, { type: 'records-put' | 'records-list' }>): Result {
  const profileOk = typeof m.profileId === 'string' && m.profileId !== '' && deps.profiles().includes(m.profileId);
  if (m.type === 'records-list') {
    const kind = RECORD_KINDS.includes(m.kind) ? m.kind : null;
    const records = profileOk && kind ? deps.store.all(m.profileId, kind) : [];
    return { reply: { type: 'records', requestId: m.requestId, kind: m.kind, records } };
  }
  const record = profileOk ? validRecord(m.record) : null;
  if (!record) return { reply: { type: 'records-put-result', requestId: m.requestId, ok: false, refused: true } };
  let before: TrackedRecord | undefined;
  let after: TrackedRecord | undefined;
  let result: ReturnType<RecordStore['put']>;
  try {
    before = record.kind === 'workout' ? deps.store.all(m.profileId, 'workout').find((r) => r.id === record.id) : undefined;
    result = deps.store.put(m.profileId, record, typeof m.seenMs === 'number' && Number.isFinite(m.seenMs) ? m.seenMs : undefined);
    after = deps.store.all(m.profileId, record.kind).find((r) => r.id === record.id);
  } catch { return { reply: { type: 'records-put-result', requestId: m.requestId, ok: false } }; }
  // Stored, so the answer may go out. What follows is bookkeeping and must not turn a kept record into a failure.
  try {
    // Only the first change from open to finished plans; edits, replays and older copies do not.
    const finished = finishedOwnWorkout(after);
    if (finished !== null) { deps.gym.start(m.profileId); if ((finished && finishedOwnWorkout(before) !== true) || result.copies.length > 0) deps.gym.workoutFinished(m.profileId); }
  } catch { /* the next scan sees the stored workout anyway */ }
  return { reply: { type: 'records-put-result', requestId: m.requestId, ok: true, kept: result.kept, updatedMs: result.updatedMs }, changed: m.profileId };
}
