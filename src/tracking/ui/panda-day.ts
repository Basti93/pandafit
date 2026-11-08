import { dayParts, type PlanDay } from '../../shared/week-plan';
import type { PandaGesture } from './panda-rive';

/** The one calm clip that Panda plays once after the greeting on today. */
export type DayClip = Extract<PandaGesture, 'bike' | 'run' | 'flex' | 'yoga' | 'read' | 'knit'>;

/**
 * Which day clip fits the day Heute shows, or null for none.
 * `today` is the plan day (null: no plan, so the kind of day is unknown and Panda only greets).
 * `mobility` is true while a mobility session is offered. `finisher` is true while the finisher card is shown.
 * `open` is true while an open workout is shown; `offset` is 0 on today, else Gestern or Morgen: both play no day clip.
 * A plain rest day alternates between read and knit by the date.
 */
export function dayClip(i: { today: PlanDay | null; dateKey: string; mobility: boolean; finisher: boolean; open: boolean; offset: number }): DayClip | null {
  if (i.open || i.offset !== 0) return null;
  if (i.finisher) return 'yoga';
  if (!i.today) return null;
  const main = dayParts(i.today)[0]?.sport;
  if (main === 'bike') return 'bike';
  if (main === 'run') return 'run';
  if (main === 'gym') return 'flex';
  if (main === 'mobility') return 'yoga';
  if (main !== 'rest') return null;
  if (i.mobility) return 'yoga';
  const day = Number(i.dateKey.slice(8, 10));
  return day % 2 === 0 ? 'read' : 'knit';
}
