import type { TrackedWorkout } from './session';

/**
 * The person's changes to the next planned workout, made before it starts. Local to the device, one per account:
 * `pandafit.plandraft.<account>` = `{ planKey, workout }`. The key ties the draft to the plan it was made from; a new coach plan
 * drops it. Every read and write is safe: storage that throws (private mode) never blocks a start, it starts from the plan.
 */
export type DraftStorage = Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>;

const keyFor = (account: string): string => `pandafit.plandraft.${account}`;

/** The plan record's time and the workout name: a new plan from the coach has another key. */
export const planKeyOf = (plan: { atMs: number; workout: { name: string } }): string => `${plan.atMs}:${plan.workout.name}`;

type Stored = { planKey: string; workout: TrackedWorkout };
const isObj = (x: unknown): x is Record<string, unknown> => typeof x === 'object' && x !== null && !Array.isArray(x);

function readStored(storage: DraftStorage, account: string): Stored | null | 'none' {
  let raw: string | null;
  try { raw = storage.getItem(keyFor(account)); } catch { return null; }
  if (raw === null) return 'none';
  try {
    const v: unknown = JSON.parse(raw);
    if (!isObj(v) || typeof v.planKey !== 'string' || !isObj(v.workout) || !Array.isArray(v.workout.exercises)) return null;
    return v as unknown as Stored;
  } catch { return null; }
}

/** The draft for this plan; null when there is none, it belongs to another plan, it cannot be read, or the storage throws. */
export function readDraft(storage: DraftStorage, account: string, planKey: string): TrackedWorkout | null {
  const s = readStored(storage, account);
  return s && s !== 'none' && s.planKey === planKey ? s.workout : null;
}

/** False when the storage refuses; the caller keeps the draft in memory then. */
export function writeDraft(storage: DraftStorage, account: string, planKey: string, w: TrackedWorkout): boolean {
  try { storage.setItem(keyFor(account), JSON.stringify({ planKey, workout: w } satisfies Stored)); return true; } catch { return false; }
}

export function clearDraft(storage: DraftStorage, account: string): void {
  try { storage.removeItem(keyFor(account)); } catch { /* nothing to do */ }
}

/** True once when the stored draft belongs to another plan: it is removed, so the next call says false. */
export function draftDropped(storage: DraftStorage, account: string, planKey: string): boolean {
  const s = readStored(storage, account);
  if (!s || s === 'none' || s.planKey === planKey) return false;
  clearDraft(storage, account);
  return true;
}

/** The workout a draft starts: a new id and start time, no set done, everything else as edited. */
export function startFromDraft(d: TrackedWorkout, nowMs: number, id: string): TrackedWorkout {
  return { ...d, id, startMs: nowMs, endMs: null, rest: null, exercises: d.exercises.map((e) => ({ ...e, sets: e.sets.map((s) => ({ ...s, doneMs: null })) })) };
}

/** localStorage when the browser gives it; reading the property itself can throw. */
export function deviceStorage(): DraftStorage | null {
  try { return typeof localStorage === 'undefined' ? null : localStorage; } catch { return null; }
}
