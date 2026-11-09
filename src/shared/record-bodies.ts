import type { GymWorkout } from './gym/types';
import type { RunBody } from './run';
import type { LoggedWorkout, RecordKind, TrackedRecord } from './records';

export type ComplaintBody = { text: string; status: string; atMs: number };

/** The body type of the kinds the screens read. Types only: a body is still checked where it is read. Other kinds are `unknown`. */
export type RecordBodies = {
  workout: LoggedWorkout;
  routine: GymWorkout;
  run: RunBody;
  mobility: { doneMs: number };
  complaint: ComplaintBody;
};
export type BodyOf<K extends RecordKind> = K extends keyof RecordBodies ? RecordBodies[K] : unknown;

/** The typed body of a record of kind `kind`. No runtime check; the kind argument only picks the type. */
export const bodyOf = <K extends RecordKind>(_kind: K, r: TrackedRecord): BodyOf<K> => r.body as BodyOf<K>;
