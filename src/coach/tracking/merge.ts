import type { StrengthWorkout } from '../../shared/gym/types';
import { historyFromLogged, toStrengthWorkout } from '../../shared/gym/strength-history';
import { overlapsHalf } from '../../shared/history';

type Links = ReadonlyMap<string, string>;

export { toStrengthWorkout, historyFromLogged };

const seconds = (n: unknown): number => typeof n === 'number' && Number.isFinite(n) && n > 0 ? n : 0;

const asSpan = (w: StrengthWorkout) => ({ startMs: w.startMs, durationMs: seconds(w.durationS) * 1000 });

/**
 * Own and Hevy history as one list, oldest first. A Hevy workout that overlaps an own one by at least half of the
 * shorter is the same session: it is dropped and the own one stays. Exercises with a Hevy template id in `links` are
 * renamed to the own exercise id in both lists, so one exercise keeps one history even when Hevy has duplicates.
 */
export function mergeHistory(own: StrengthWorkout[], hevy: StrengthWorkout[], links: Links): StrengthWorkout[] {
  const norm = (w: StrengthWorkout): StrengthWorkout => ({ ...w, exercises: w.exercises.map((e) => ({ ...e, templateId: links.get(e.templateId) ?? e.templateId })) });
  const mapped = own.map(norm);
  const kept = hevy.filter((h) => !mapped.some((o) => overlapsHalf(asSpan(o), asSpan(h)))).map(norm);
  return [...mapped, ...kept].sort((a, b) => a.startMs - b.startMs);
}
