import type { DatabaseSync } from 'node:sqlite';
import { applyRecord, RECORD_KINDS, type RecordKind, type TrackedRecord } from '../src/shared/records';
import { generationOf } from './db';
import { mealWeekOf, runWeekOf } from './push';

/** The records of one account, shared by the public routes (login) and the internal ones (the coach). */
const KINDS: readonly RecordKind[] = RECORD_KINDS;
const RECORD_BODY_LIMIT = 1024 * 1024;
export const MAX_RECORDS_PER_POST = 1000;
const MAX_PAGE = 500;
const MAX_AHEAD_MS = 7 * 24 * 3600 * 1000;
const KEEP_OVERWRITTEN = 500;
const KEEP_PER_RECORD = 3;

type Row = { kind: string; id: string; updated_ms: number; deleted: number; body: string; seq: number };
const toRecord = (r: Row): TrackedRecord => ({ kind: r.kind as RecordKind, id: r.id, updatedMs: r.updated_ms, deleted: r.deleted === 1, body: JSON.parse(r.body) as unknown });
const isObj = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);
const str = (v: unknown, max: number): v is string => typeof v === 'string' && v.length > 0 && v.length <= max;

/** A coach message that sends a push. Only the coach itself writes one; a client's copy is refused. */
const isCoachPush = (r: Record<string, unknown>): boolean => {
  const b = r.body;
  return r.kind === 'chat' && isObj(b) && b.role === 'coach' && b.push === true;
};

/** The list of a POST body, or null when the body is not `{ records: [...] }` within the limit. */
export const recordsOfBody = (body: unknown): unknown[] | null => {
  const list = isObj(body) ? body.records : undefined;
  return Array.isArray(list) && list.length <= MAX_RECORDS_PER_POST ? list : null;
};

/** The page asked for by a GET query, or null when it is invalid. */
export const pageOfQuery = (q: { since?: string; limit?: string }): { since: number; limit: number } | null => {
  const since = q.since === undefined ? 0 : Number(q.since);
  const limit = q.limit === undefined ? MAX_PAGE : Number(q.limit);
  if (!Number.isInteger(since) || since < 0 || !Number.isInteger(limit) || limit < 1) return null;
  return { since, limit };
};

/** Stores what is newer, keeps what lost, in one transaction. A new meal or run week is reported so its push goes out after the commit. */
export function putRecords(db: DatabaseSync, accountId: number, list: unknown[], nowMs: number, from: 'client' | 'coach' = 'coach'): { accepted: number; refused: { kind: unknown; id: unknown; reason: string }[]; newMealWeek: boolean; newRunWeek: boolean; newCoachNote: boolean } {
  const account = accountId, t = nowMs;
  const refused: { kind: unknown; id: unknown; reason: string }[] = [];
  let accepted = 0, newMealWeek = false, newRunWeek = false, newCoachNote = false;
  const weekStmt = db.prepare('INSERT OR IGNORE INTO push_meal_weeks VALUES (?, ?)');
  const runWeekStmt = db.prepare('INSERT OR IGNORE INTO push_run_weeks VALUES (?, ?)');
  const getStmt = db.prepare('SELECT * FROM records WHERE account_id = ? AND kind = ? AND id = ?');
  const putStmt = db.prepare(`INSERT INTO records (account_id, kind, id, updated_ms, deleted, body, seq)
    VALUES (?, ?, ?, ?, ?, ?, (SELECT COALESCE(MAX(seq), 0) + 1 FROM records WHERE account_id = ?))
    ON CONFLICT (account_id, kind, id) DO UPDATE SET updated_ms = excluded.updated_ms, deleted = excluded.deleted, body = excluded.body, seq = excluded.seq`);
  const lostStmt = db.prepare('INSERT INTO overwritten (account_id, kind, id, updated_ms, body, at_ms, deleted, stale) VALUES (?, ?, ?, ?, ?, ?, ?, ?)');
  const haveLostStmt = db.prepare('SELECT 1 FROM overwritten WHERE account_id = ? AND kind = ? AND id = ? AND updated_ms = ? AND deleted = ? AND body = ?');
  // Forward edits leave a short trail per record. The loser of a stale send was never based on what stayed: it is not part of that trail.
  const trimStmt = db.prepare(`DELETE FROM overwritten WHERE account_id = ? AND kind = ? AND id = ? AND stale = 0 AND n NOT IN
    (SELECT n FROM overwritten WHERE account_id = ? AND kind = ? AND id = ? AND stale = 0 ORDER BY updated_ms DESC, n DESC LIMIT ?)`);
  db.exec('BEGIN');
  try {
    for (const raw of list) {
      const r = isObj(raw) ? raw : {};
      const ref = { kind: r.kind, id: r.id };
      const reason =
        !isObj(raw) ? 'not an object'
        : !KINDS.includes(r.kind as RecordKind) ? 'unknown kind'
        : !str(r.id, 200) ? 'bad id'
        : typeof r.updatedMs !== 'number' || !Number.isFinite(r.updatedMs) ? 'bad updatedMs'
        : r.updatedMs > t + MAX_AHEAD_MS ? 'updatedMs too far ahead'
        : typeof r.deleted !== 'boolean' ? 'bad deleted'
        : r.body === undefined ? 'missing body'
        : from === 'client' && isCoachPush(r) ? 'coach push message from a client'
        : Buffer.byteLength(JSON.stringify(r.body)) > RECORD_BODY_LIMIT ? 'body too large'
        : null;
      if (reason) { refused.push({ ...ref, reason }); continue; }
      const incoming: TrackedRecord = { kind: r.kind as RecordKind, id: r.id as string, updatedMs: r.updatedMs as number, deleted: r.deleted as boolean, body: r.body };
      const cur = getStmt.get(account, incoming.kind, incoming.id) as Row | undefined;
      const { keep, overwritten } = applyRecord(cur ? toRecord(cur) : undefined, incoming);
      if (overwritten) {
        const body = JSON.stringify(overwritten.body), del = overwritten.deleted ? 1 : 0;
        if (!haveLostStmt.get(account, overwritten.kind, overwritten.id, overwritten.updatedMs, del, body)) lostStmt.run(account, overwritten.kind, overwritten.id, overwritten.updatedMs, body, t, del, overwritten === incoming ? 1 : 0);
        if (keep === incoming) trimStmt.run(account, keep.kind, keep.id, account, keep.kind, keep.id, KEEP_PER_RECORD);
      }
      if (keep === incoming) {
        putStmt.run(account, keep.kind, keep.id, keep.updatedMs, keep.deleted ? 1 : 0, JSON.stringify(keep.body), account);
        const w = mealWeekOf(keep, t);
        if (w && weekStmt.run(account, w).changes > 0) newMealWeek = true;
        const rw = runWeekOf(keep, t);
        if (rw && runWeekStmt.run(account, rw).changes > 0) newRunWeek = true;
        // A coach message written for a push (the week conversation, the evening before): once, when it first arrives.
        const b = keep.body as { role?: unknown; push?: unknown } | null;
        if (!cur && !keep.deleted && keep.kind === 'chat' && b && b.role === 'coach' && b.push === true) newCoachNote = true;
      }
      accepted++;
    }
    db.prepare('DELETE FROM overwritten WHERE account_id = ? AND n NOT IN (SELECT n FROM overwritten WHERE account_id = ? ORDER BY stale DESC, n DESC LIMIT ?)').run(account, account, KEEP_OVERWRITTEN);
    db.exec('COMMIT');
  } catch (e) {
    db.exec('ROLLBACK');
    throw e;
  }
  return { accepted, refused, newMealWeek, newRunWeek, newCoachNote };
}

/** One page after the cursor. A cursor from the future means the server lost data (restore): start over so nothing is missed. */
export function listRecords(db: DatabaseSync, accountId: number, since: number, limit: number) {
  const n = Math.min(limit, MAX_PAGE);
  const top = (db.prepare('SELECT COALESCE(MAX(seq), 0) AS m FROM records WHERE account_id = ?').get(accountId) as { m: number }).m;
  const reset = since > top;
  if (reset) since = 0;
  const rows = db.prepare('SELECT * FROM records WHERE account_id = ? AND seq > ? ORDER BY seq LIMIT ?').all(accountId, since, n + 1) as Row[];
  const page = rows.slice(0, n);
  return { records: page.map(toRecord), cursor: page.length ? page[page.length - 1]!.seq : since, more: rows.length > n, reset, generation: generationOf(db) };
}
