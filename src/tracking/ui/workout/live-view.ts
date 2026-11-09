import type { TrackedExercise, TrackedWorkout } from '../../session';
import type { Mark } from '../kit';
import { setLabels } from '../setGrid';

/** One set as a small circle in the focus card: `short` is its chip ("A" for a warm-up), `index` its row in the set table. */
export type SetMark = { rid: string; index: number; short: string; state: Mark };

const isOpen = (s: { doneMs: number | null }) => s.doneMs === null;
const workOf = (e: TrackedExercise) => e.sets.filter((s) => s.type !== 'warmup');

/** The first open set of the exercise (a warm-up included): the one the focus card shows. All done: null. */
export function focusSet(e: TrackedExercise): { index: number; kicker: string } | null {
  const index = e.sets.findIndex(isOpen);
  if (index < 0) return null;
  const s = e.sets[index]!;
  if (s.type === 'warmup') return { index, kicker: 'Aufwärmsatz' };
  const work = workOf(e);
  return { index, kicker: `Nächster Satz · ${work.indexOf(s) + 1} von ${work.length}` };
}

/** The sets as circles: done, now (the first open one) or open. */
export function setMarks(e: TrackedExercise): SetMark[] {
  const labels = setLabels(e.sets);
  const now = e.sets.findIndex(isOpen);
  return e.sets.map((s, index) => ({
    rid: s.rid, index, short: labels[index] === 'Aufw.' ? 'A' : labels[index]!,
    state: !isOpen(s) ? 'done' : index === now ? 'now' : 'open',
  }));
}

const STATE_WORD: Record<Mark, string> = { done: 'geschafft', now: 'dran', open: 'offen' };

/** What a screen reader says for a circle: "Satz 3: dran", "Aufwärmsatz: offen". The number is the row in the set table. */
export function markName(m: SetMark): string {
  return `${m.short === 'A' ? 'Aufwärmsatz' : `Satz ${m.index + 1}`}: ${STATE_WORD[m.state]}`;
}

const openWork = (e: TrackedExercise) => workOf(e).filter(isOpen).length;
const sets = (n: number) => (n === 1 ? '1 Satz' : `${n} Sätze`);

/**
 * The quiet list under the focus card: the exercises after the focus one that still have open sets, then the open ones before it.
 * A superset is one row ("A und B", "Im Wechsel, je 3 Sätze"); the focus exercise's own superset is not listed.
 */
export function upNext(w: TrackedWorkout, focusRid: string | null): { rid: string; title: string; sub: string }[] {
  const at = w.exercises.findIndex((e) => e.rid === focusRid);
  const focusGroup = at >= 0 ? w.exercises[at]!.supersetId : null;
  const order = at >= 0 ? [...w.exercises.slice(at + 1), ...w.exercises.slice(0, at)] : w.exercises;
  const rows: { rid: string; title: string; sub: string }[] = [];
  const seen = new Set<number>();
  for (const e of order) {
    if (e.supersetId === null) {
      if (openWork(e) > 0) rows.push({ rid: e.rid, title: e.title, sub: sets(openWork(e)) });
      continue;
    }
    if (e.supersetId === focusGroup || seen.has(e.supersetId)) continue;
    seen.add(e.supersetId);
    const members = w.exercises.filter((x) => x.supersetId === e.supersetId);
    const most = Math.max(...members.map(openWork));
    if (most === 0) continue;
    const first = members.find((x) => openWork(x) > 0)!;
    rows.push({ rid: first.rid, title: members.map((x) => x.title).join(' und '), sub: `Im Wechsel, je ${sets(most)}` });
  }
  return rows;
}

/** The exercise of the focus card: the chosen one (`openRid`, which follows the next open set), else the current one, else the last. */
export function focusExercise(w: TrackedWorkout, openRid: string | null, currentRid: string | null): TrackedExercise | null {
  return w.exercises.find((e) => e.rid === openRid) ?? w.exercises.find((e) => e.rid === currentRid) ?? w.exercises[w.exercises.length - 1] ?? null;
}

/** All sets of the exercise are done (an exercise without sets is never done). */
export const isDoneExercise = (e: TrackedExercise): boolean => e.sets.length > 0 && e.sets.every((s) => !isOpen(s));

/**
 * Where the workout stands, for the card "Dein Training": the focus exercise's place, the parts for `Band`
 * (a done exercise full, the focus one by its done work sets, an open one empty) and the titles of the done exercises.
 */
export function progressOf(w: TrackedWorkout, focusRid: string | null): { index: number; total: number; parts: { grow: 1; fill: number }[]; doneTitles: string[] } {
  const at = w.exercises.findIndex((e) => e.rid === focusRid);
  const parts = w.exercises.map((e): { grow: 1; fill: number } => {
    if (isDoneExercise(e)) return { grow: 1, fill: 1 };
    if (e.rid !== focusRid) return { grow: 1, fill: 0 };
    const work = workOf(e);
    return { grow: 1, fill: work.length === 0 ? 0 : work.filter((s) => !isOpen(s)).length / work.length };
  });
  return { index: at + 1, total: w.exercises.length, parts, doneTitles: w.exercises.filter(isDoneExercise).map((e) => e.title) };
}

const COUNT_WORD = ['Null', 'Eine', 'Zwei', 'Drei', 'Vier', 'Fünf', 'Sechs', 'Sieben', 'Acht', 'Neun', 'Zehn', 'Elf', 'Zwölf'];

/** The done exercises as one sentence: one or two by name, from three on as a count in words. None: null. */
export function doneSentence(titles: string[]): string | null {
  if (titles.length === 0) return null;
  if (titles.length === 1) return `${titles[0]} hast du schon geschafft.`;
  if (titles.length === 2) return `${titles[0]} und ${titles[1]} hast du schon geschafft.`;
  return `${COUNT_WORD[titles.length] ?? titles.length} Übungen hast du schon geschafft.`;
}

/**
 * The one effort question: about the exercise that holds the most recently confirmed set, and only when `asks` is true for it.
 * An older unanswered question goes away with the next exercise (the question is never owed) and does not come back.
 */
export function effortAsk(w: TrackedWorkout, asks: (rid: string) => boolean): TrackedExercise | null {
  let last: { e: TrackedExercise; at: number } | null = null;
  for (const e of w.exercises) for (const s of e.sets) if (s.doneMs !== null && (!last || s.doneMs >= last.at)) last = { e, at: s.doneMs };
  return last && asks(last.e.rid) ? last.e : null;
}
