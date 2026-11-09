import type { CoachClientMessage, CoachServerMessage } from '../../src/coach/protocol';
import { applyRecord, type RecordKind, type TrackedRecord } from '../../src/shared/records';
import type { TrackingPort } from '../../src/tracking/ports';

/**
 * The Mac renderer shows no screen that writes records any more (milestone Q), so the app does not use this port.
 * It stays only because tests/tracking (base-rule, lost-write) check the never-lose-a-write rules against it as a second port.
 */
/** `seenMs`: the version the first write of this chain stood on. */
type Entry = { record: TrackedRecord; seenMs?: number };
type Answer = Extract<CoachServerMessage, { type: 'records-put-result' | 'records' }>;
export type CoachTrackingPort = TrackingPort & {
  /** Messages from the Mac that belong to the tracking. */
  handle(m: CoachServerMessage): void;
  /** The socket is open (again): unsent records go out in order. */
  opened(): void;
  /** The socket is gone: requests without an answer stay in the queue. */
  closed(): void;
  dispose(): void;
};

const keyOf = (r: { kind: string; id: string }) => `${r.kind}:${r.id}`;
const sameRecord = (a: TrackedRecord, b: TrackedRecord) => JSON.stringify(a) === JSON.stringify(b);

/**
 * The tracking screens' view of the Mac's record store, over the coach socket. A put is confirmed only after the Mac
 * stored it. While the socket is down, or an answer does not come, the record waits in localStorage (the bike-coach
 * data folder, so it survives a restart) and is removed only after the Mac confirmed it.
 */
export function createCoachTrackingPort(o: {
  profileId: string;
  send: (m: CoachClientMessage) => boolean;
  storage?: Pick<Storage, 'getItem' | 'setItem'>;
  now?: () => number;
  timeoutMs?: number;
  retryMs?: number;
}): CoachTrackingPort {
  const { profileId } = o;
  const now = o.now ?? Date.now;
  const timeoutMs = o.timeoutMs ?? 10_000;
  const retryMs = o.retryMs ?? 15_000;
  const storageKey = `pandafit.tracking.queue.${profileId}`;
  const refusedKey = `pandafit.tracking.refused.${profileId}`;
  const store = (): Pick<Storage, 'getItem' | 'setItem'> => o.storage ?? localStorage;
  const subs = new Set<() => void>();
  const waiting = new Map<string, { settle: (a: Answer | null) => void; timer: ReturnType<typeof setTimeout> }>();
  const cache = new Map<RecordKind, Map<string, TrackedRecord>>();
  let lastOkMs: number | null = null;
  let inflight = 0;
  let flushing = false;
  let seq = 0;
  let disposed = false;
  const notify = () => subs.forEach((f) => { try { f(); } catch { /* one listener must not stop the rest */ } });

  const readList = (key: string): Entry[] => {
    try {
      const v = JSON.parse(store().getItem(key) ?? '[]') as unknown;
      return Array.isArray(v) ? v.filter((e): e is Entry => typeof e === 'object' && e !== null && typeof (e as Entry).record === 'object') : [];
    } catch { return []; }
  };
  const readQueue = (): Entry[] => readList(storageKey);
  const writeQueue = (q: Entry[]): void => store().setItem(storageKey, JSON.stringify(q));

  const enqueue = (r: TrackedRecord, seenMs: number | undefined): void => {
    const q = readQueue();
    const i = q.findIndex((e) => keyOf(e.record) === keyOf(r));
    if (i < 0) q.push({ record: r, seenMs });
    else q[i] = { record: applyRecord(q[i].record, r).keep, seenMs: q[i].seenMs };
    writeQueue(q);
  };
  const dequeue = (r: TrackedRecord): void => {
    // A newer version of the same record may have replaced it while it was on its way: that one stays.
    const q = readQueue().filter((e) => !sameRecord(e.record, r));
    writeQueue(q);
  };

  const request = (m: CoachClientMessage & { requestId: string }): Promise<Answer | null> =>
    new Promise((resolve) => {
      const settle = (a: Answer | null) => {
        const w = waiting.get(m.requestId);
        if (!w) return;
        clearTimeout(w.timer);
        waiting.delete(m.requestId);
        resolve(a);
      };
      const timer = setTimeout(() => settle(null), timeoutMs);
      waiting.set(m.requestId, { settle, timer });
      if (!o.send(m)) settle(null);
    });

  const remember = (r: TrackedRecord) => {
    const m = cache.get(r.kind);
    if (m) m.set(r.id, applyRecord(m.get(r.id), r).keep);
  };

  const flush = async (): Promise<void> => {
    if (flushing || disposed) return;
    flushing = true;
    try {
      for (;;) {
        const head = readQueue()[0];
        if (!head) break;
        inflight++;
        let a: Answer | null;
        try { a = await request({ type: 'records-put', requestId: `${profileId}-${now()}-${++seq}`, profileId, record: head.record, seenMs: head.seenMs }); } finally { inflight--; }
        if (!a || a.type !== 'records-put-result') break;
        if (a.ok && a.kept === false) {
          // A newer record stayed on the Mac. What waited here goes above it, standing on what it stood on, so the rule in
          // tracking/kept-copy keeps that record as a copy if it holds more sets.
          const raised = { ...head.record, updatedMs: (a.updatedMs ?? head.record.updatedMs) + 1 };
          writeQueue(readQueue().map((e) => (sameRecord(e.record, head.record) ? { record: raised, seenMs: head.seenMs ?? head.record.updatedMs } : e)));
          continue;
        }
        if (a.ok) { lastOkMs = now(); remember(head.record); dequeue(head.record); notify(); continue; }
        // A refusal never turns into a yes and must not block the rest. It is kept, apart from the queue, never deleted.
        if (a.refused) {
          store().setItem(refusedKey, JSON.stringify([...readList(refusedKey), head]));
          dequeue(head.record);
          continue;
        }
        break;
      }
    } catch { /* stays queued, the next connection tries again */ } finally { flushing = false; notify(); }
  };

  // A waiting queue is tried again now and then, not only when the socket reconnects.
  const retry = setInterval(() => { if (readQueue().length > 0) void flush(); }, retryMs);

  return {
    async list(kind) {
      const queued = readQueue().map((e) => e.record).filter((r) => r.kind === kind);
      let base = cache.get(kind);
      const a = await request({ type: 'records-list', requestId: `${profileId}-${now()}-${++seq}`, profileId, kind });
      if (a && a.type === 'records') {
        base = new Map(a.records.map((r) => [r.id, r]));
        cache.set(kind, base);
      }
      if (!base) throw new Error('Die Daten konnten nicht geladen werden.');
      const merged = new Map(base);
      for (const r of queued) merged.set(r.id, applyRecord(merged.get(r.id), r).keep);
      return [...merged.values()];
    },
    async put(r, opts) {
      // Behind unsent records, so the order of edits is kept.
      if (readQueue().length > 0 || flushing) {
        enqueue(r, opts?.seenMs);
        notify();
        void flush();
        return { kept: true, updatedMs: r.updatedMs };
      }
      inflight++;
      let a: Answer | null;
      try { a = await request({ type: 'records-put', requestId: `${profileId}-${now()}-${++seq}`, profileId, record: r, seenMs: opts?.seenMs }); } finally { inflight--; }
      if (a && a.type === 'records-put-result') {
        if (!a.ok) throw new Error('Das Training konnte nicht gespeichert werden.');
        lastOkMs = now();
        remember(r);
        notify();
        return { kept: a.kept !== false, updatedMs: a.updatedMs ?? r.updatedMs };
      }
      // No answer: kept on this device, it goes out when the Mac answers again.
      enqueue(r, opts?.seenMs);
      remember(r);
      notify();
      return { kept: true, updatedMs: r.updatedMs };
    },
    subscribe(fn) { subs.add(fn); return () => { subs.delete(fn); }; },
    // This port cannot tell which kind changed: every kind subscriber hears every change.
    subscribeKind(_kind, fn) { subs.add(fn); return () => { subs.delete(fn); }; },
    subscribeSync(fn) { subs.add(fn); return () => { subs.delete(fn); }; },
    syncState: () => ({ pending: readQueue().length + (inflight > 0 && readQueue().length === 0 ? inflight : 0), lastOkMs, refused: readList(refusedKey).length }),
    handle(m) {
      if (m.type === 'records-changed') { if (m.profileId === profileId) notify(); return; }
      if (m.type === 'records' || m.type === 'records-put-result') waiting.get(m.requestId)?.settle(m);
    },
    opened() { void flush(); notify(); },
    closed() { for (const w of [...waiting.values()]) w.settle(null); },
    dispose() { disposed = true; clearInterval(retry); subs.clear(); for (const w of [...waiting.values()]) w.settle(null); },
  };
}

/**
 * One port per profile, kept for as long as the window lives. A workout store that outlives a profile switch keeps
 * writing through its own port, under its own profile. Answers are matched by request id across all ports.
 */
export function createTrackingPorts(o: Omit<Parameters<typeof createCoachTrackingPort>[0], 'profileId'>) {
  const ports = new Map<string, CoachTrackingPort>();
  return {
    get(profileId: string): CoachTrackingPort {
      let p = ports.get(profileId);
      if (!p) { p = createCoachTrackingPort({ ...o, profileId }); ports.set(profileId, p); }
      return p;
    },
    handle(m: CoachServerMessage): void { for (const p of ports.values()) p.handle(m); },
    opened(): void { for (const p of ports.values()) p.opened(); },
    closed(): void { for (const p of ports.values()) p.closed(); },
    dispose(): void { for (const p of ports.values()) p.dispose(); ports.clear(); },
  };
}
