import { DAYTEXT_ID, readDayText } from '../shared/day-text';
import type { ActivityKind } from '../shared/activities';
import type { TrainingSession } from './all-training';
import { kindOf } from './activities-export';
import { dateKey } from './day-load';
import type { DoneToday } from './day-text';
import type { RecordStore } from './tracking/store';

type Deps = {
  store: Pick<RecordStore, 'all' | 'put'>;
  profileIds: string[];
  /** Only the side that coaches a profile writes its day record. */
  coachHere: (profileId: string) => boolean;
  noOpenRide: () => boolean;
  nowMs: number;
  entry: (profileId: string) => { date: string; text: string | null; atMs: number; about?: string } | undefined;
};

const isObj = (x: unknown): x is Record<string, unknown> => typeof x === 'object' && x !== null && !Array.isArray(x);

/**
 * Publishes the coach sentence to every profile coached here, only when it has a text that differs from the stored one
 * and never with a ride open. Without a text (the AI failed) nothing is written and the web shows the saying. Never throws.
 * Returns the profiles it wrote to.
 */
export function exportDayText(d: Deps): string[] {
  try {
    if (!d.noOpenRide()) return [];
    const out: string[] = [];
    for (const id of d.profileIds) {
      try {
        if (!d.coachHere(id)) continue;
        const e = d.entry(id);
        if (!e || e.text === null) continue;
        const next = { type: 'daytext', date: e.date, text: e.text, ...(e.about !== undefined ? { about: e.about } : {}) };
        const have = d.store.all(id, 'daytext').find((r) => r.id === DAYTEXT_ID);
        if (have && !have.deleted && isObj(have.body)) {
          const { atMs: _at, ...rest } = have.body;
          if (JSON.stringify(rest) === JSON.stringify(next)) continue;
        }
        const body = { ...next, atMs: e.atMs };
        if (readDayText(body) === null) continue;
        d.store.put(id, { kind: 'daytext', id: DAYTEXT_ID, updatedMs: Math.max(d.nowMs, (have?.updatedMs ?? 0) + 1), deleted: false, body });
        out.push(id);
      } catch { /* this profile tries again on the next scan */ }
    }
    return out;
  } catch { return []; }
}

const KIND_LABEL: Record<ActivityKind, string> = { kraft: 'Kraft', rad: 'Rad', lauf: 'Lauf', andere: 'Aktivität' };

/** How an activity reads in the prompt, e.g. „Kraft Beine · 54 Min“. */
export const doneText = (s: TrainingSession): string =>
  `${[KIND_LABEL[kindOf(s)], s.title].filter(Boolean).join(' ')} · ${Math.round(s.minutes)} Min`;

/** The finished activities with today's local date, with the key the activities record uses. */
export const doneToday = (sessions: TrainingSession[], nowMs: number): DoneToday[] =>
  sessions.filter((s) => s.startMs <= nowMs && dateKey(s.startMs) === dateKey(nowMs)).map((s) => ({ key: s.key, text: doneText(s), startMs: s.startMs }));
