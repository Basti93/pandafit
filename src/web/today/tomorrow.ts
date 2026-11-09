import type { PlanDay } from '../../shared/week-plan';

/** Where the Morgen card on Heute leads: the training itself, or the day sheet when there is no training page for it. */
export type TomorrowTarget = 'plan' | 'kraft' | 'rad' | 'lauf' | 'tag';

export function tomorrowTarget({ tomorrow, planWorkout, canBike, canRun }: { tomorrow: PlanDay; planWorkout: boolean; canBike: boolean; canRun: boolean }): TomorrowTarget {
  switch (tomorrow.sport) {
    case 'gym': return planWorkout ? 'plan' : 'kraft';
    case 'bike': return canBike ? 'rad' : 'tag';
    case 'run': return canRun ? 'lauf' : 'tag';
    default: return 'tag';
  }
}
