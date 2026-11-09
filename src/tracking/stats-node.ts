import { mergeCatalog } from '../shared/catalog';
import { EXERCISES, type Exercise } from '../shared/exercises';
import { FEDB_EXERCISES } from '../shared/fedb';
import type { LoggedWorkout } from '../shared/records';
import type { MuscleGroup } from '../shared/muscle-targets';
import type { StatsBody } from '../shared/stats';
import { statsView as statsViewOf, type StatsView } from './stats';

/** statsView for code that runs in node (coach, tests): without a catalog it uses the built-in one plus the base catalog. The web app passes its own. */
export function statsView(stats: StatsBody | null, workouts: LoggedWorkout[], nowMs: number, catalog: Exercise[] = mergeCatalog(EXERCISES, FEDB_EXERCISES, []), strength: string | null | undefined = stats?.goal, focus: readonly MuscleGroup[] = []): StatsView {
  return statsViewOf(stats, workouts, nowMs, catalog, strength, focus);
}
