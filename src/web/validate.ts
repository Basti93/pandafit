import type { RecordKind, TrackedRecord } from '../shared/records';
import { readMealPlan } from '../shared/meals';
import { readRunBody } from '../shared/run';
import { readStats } from '../shared/stats';
import { readTogether } from '../shared/together';
import { readLoadStep } from '../shared/loads';
import { readChange } from '../shared/changes';
import { readGoal, readRule } from '../shared/personal';
import { readBlock } from '../shared/block';
import { readFrame } from '../shared/frame';
import { readContact } from '../shared/contact';
import { readBike, readRideBody } from '../shared/bike';
import { readHealth } from '../shared/health';
import { readDayText } from '../shared/day-text';
import { readActivities } from '../shared/activities';
import { readTask } from '../shared/tasks';
import { readStudio } from '../shared/studio';
import { readChat } from '../shared/chat';
import { parseProposal } from '../shared/week-plan';

const isObj = (x: unknown): x is Record<string, unknown> => typeof x === 'object' && x !== null && !Array.isArray(x);
const num = (x: unknown): boolean => typeof x === 'number' && Number.isFinite(x);
const optNum = (x: unknown): boolean => x === null || x === undefined || num(x);
const sets = (x: unknown): boolean => Array.isArray(x) && x.every((s) => isObj(s) && optNum(s.weightKg) && optNum(s.reps));
const exercises = (x: unknown): boolean => Array.isArray(x) && x.every((e) => isObj(e) && typeof e.title === 'string' && sets(e.sets));

const gymWorkout = (b: unknown): boolean => isObj(b) && typeof b.name === 'string' && exercises(b.exercises);

/** A shape the screens can draw without throwing. Anything else is skipped when reading, but never deleted. */
export function validBody(kind: RecordKind, body: unknown): boolean {
  if (!isObj(body)) return false;
  switch (kind) {
    case 'workout': return typeof body.id === 'string' && typeof body.title === 'string' && num(body.startMs) && (body.endMs === null || num(body.endMs)) && exercises(body.exercises) && (body.exercises as { exerciseId?: unknown }[]).every((e) => typeof e.exerciseId === 'string');
    case 'routine': return gymWorkout(body);
    case 'exercise': return typeof body.id === 'string' && typeof body.title === 'string';
    case 'plan': return (body.workout === null || body.workout === undefined || gymWorkout(body.workout))
      && (body.mobility === null || body.mobility === undefined || (isObj(body.mobility) && typeof body.mobility.id === 'string' && Array.isArray(body.mobility.exercises) && body.mobility.exercises.every((e) => isObj(e) && typeof e.id === 'string' && typeof e.title === 'string')));
    case 'complaint': return typeof body.text === 'string' && typeof body.status === 'string' && num(body.atMs);
    case 'mobility': return true;
    // The plan must be drawable; the state is read entry by entry and anything odd in it is skipped.
    case 'mealplan': return 'meals' in body ? readMealPlan(body) !== null : true;
    case 'together': return readTogether(body) !== null;
    case 'run': return readRunBody(body) !== null;
    case 'stats': return readStats(body) !== null;
    case 'chat': return readChat(body) !== null;
    case 'weekplan': return parseProposal(body) !== null;
    case 'coachprefs': return true;
    case 'loadstep': return readLoadStep(body) !== null;
    case 'studio': return readStudio(body) !== null;
    case 'change': return readChange('', body) !== null;
    case 'goal': return readGoal(body) !== null;
    case 'rule': return readRule('', body) !== null;
    case 'block': return readBlock(body) !== null;
    case 'frame': return readFrame(body) !== null;
    case 'task': return readTask(body) !== null;
    case 'contact': return readContact(body) !== null;
    case 'bike': return readBike(body) !== null;
    case 'ride': return readRideBody(body) !== null;
    case 'health': return readHealth(body) !== null;
    case 'activities': return readActivities(body) !== null;
    case 'daytext': return readDayText(body) !== null;
  }
}

export const readable = (r: TrackedRecord): boolean => r.deleted || validBody(r.kind, r.body);
