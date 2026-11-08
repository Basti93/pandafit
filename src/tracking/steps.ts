import type { LoggedWorkout, TrackedRecord } from '../shared/records';
import { extendDown, ladderFrom, loadStepId, loadStepRecord, platesPerSide, type LoadStepOverrides } from '../shared/loads';
import { mainStudio, NO_STUDIOS, type Renames } from '../shared/studio';
import { dedupeSessions, onePerSession } from '../shared/history';
import { ruleNumber } from '../shared/training-policy';
import { formatDecimal, hereKey } from './session';

export { hereKey };

/**
 * The weight step of an exercise here: learned from its newest 10 sessions in this studio (the shared `ladderFrom`), then the
 * person's own choice. Only done sets count, and a session known as a record and as kept copies counts once.
 */
export function stepHere(exerciseId: string, equipment: string, history: readonly LoggedWorkout[], key: string, overrides: LoadStepOverrides, renames: Renames = NO_STUDIOS.renames): { stepKg: number; own: boolean } {
  const { ladder, learned } = ladderHere(exerciseId, equipment, history, key, overrides, renames);
  return { stepKg: ladder.stepKg, own: ladder.stepKg !== learned.stepKg || overrides.has(`${exerciseId}|${key}`) };
}

/** The ladder of an exercise here (steps and anchor) and the learned one without the person's override. */
export function ladderHere(exerciseId: string, equipment: string, history: readonly LoggedWorkout[], key: string, overrides: LoadStepOverrides, renames: Renames = NO_STUDIOS.renames) {
  const sessions = onePerSession(dedupeSessions([...history]))
    .map((w) => ({ studio: w.studio, startMs: w.startMs, sets: w.exercises.filter((e) => e.exerciseId === exerciseId).flatMap((e) => e.sets.filter((s) => s.doneMs !== null)), has: w.exercises.some((e) => e.exerciseId === exerciseId) }))
    .filter((s) => s.has);
  const r = ladderFrom(sessions, { exerciseId, studio: key, main: mainStudio(history, renames), renames }, equipment, overrides);
  return { ...r, ladder: extendDown(r.ladder, equipment) };
}

/** "Gewichtsstufen hier: 5 kg (gelernt)". */
export const stepLine = (s: { stepKg: number; own: boolean }): string => `Gewichtsstufen hier: ${formatDecimal(s.stepKg)} kg (${s.own ? 'von dir' : 'gelernt'})`;

/** The plate line of a barbell set: "Scheiben je Seite: 20 + 2,5", "Nicht genau auflegbar – 60 oder 62,5 kg" or "Leichter als die Stange (20 kg)". */
export function plateLine(totalKg: number): string {
  const p = platesPerSide(totalKg);
  const bar = formatDecimal(ruleNumber('load.bar-kg'));
  if (p.status === 'below-bar') return `Leichter als die Stange (${bar} kg)`;
  if (p.status === 'between') return `Das geht mit Scheiben nicht genau. Nimm ${formatDecimal(p.lower as number)} oder ${formatDecimal(p.upper as number)} kg.`;
  return p.perSide.length === 0 ? `Nur die Stange (${bar} kg)` : `Scheiben je Seite: ${p.perSide.map(formatDecimal).join(' + ')}`;
}

/** The record that sets the step here, or with `stepKg` null the tombstone ("gelernt"). Stamped above what is stored, tombstones included. */
export function stepChange(stored: readonly TrackedRecord[], exerciseId: string, key: string, stepKg: number | null, nowMs: number): TrackedRecord {
  const id = loadStepId(exerciseId, key);
  const above = Math.max(nowMs, (stored.find((r) => r.kind === 'loadstep' && r.id === id)?.updatedMs ?? 0) + 1);
  if (stepKg !== null) return loadStepRecord(exerciseId, key, stepKg, above);
  return { ...loadStepRecord(exerciseId, key, 1, above), deleted: true };
}
