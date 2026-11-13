import { POLICY_VERSION, policyRule, ruleNamedRange, ruleNumber } from '../../shared/training-policy';
import type { Push } from '../../shared/personal';

/**
 * Our own choices for the gym coach, not taken from research. The values live in the policy register
 * (src/shared/training-policy/rules.ts), which also says which follow-up task replaces each one.
 */
export const GYM_POLICY_VERSION = POLICY_VERSION;
export const RECENT_DAYS = ruleNumber('gym.recent-days');
export const LONG_BREAK_DAYS = ruleNumber('gym.long-break-days');
/** Sessions of one exercise needed within COMPARABLE_DAYS before the coach changes anything. */
export const MIN_COMPARABLE = ruleNumber('gym.min-comparable');
export const COMPARABLE_DAYS = ruleNumber('gym.comparable-days');
export const STEP_BACK = ruleNumber('gym.step-back-share');
/** Comparable sessions in a row with fewer reps at the same weight before the weight steps back. */
export const DROP_STEP_BACK = ruleNumber('gym.drop-step-back-count');
/** Past sessions count as comparable when their hard sets before the exercise for the same muscle differ by at most this. */
export const PRE_FATIGUE_TOLERANCE = ruleNumber('gym.pre-fatigue-tolerance');
export const MAX_EXERCISES = ruleNumber('gym.max-exercises');
/** Hip-dominant exercises (the families named in the rule) allowed in one workout. */
export const MAX_HIP_DOMINANT = ruleNumber('gym.max-hip-dominant');
export const HIP_DOMINANT_FAMILIES: readonly string[] = policyRule('gym.max-hip-dominant').lists?.families ?? [];
export const MAX_SETS = ruleNumber('gym.max-sets');
export const MAX_FAILURE_SETS = ruleNumber('gym.max-failure-sets');
export const MAX_WIDOWMAKERS = ruleNumber('gym.max-widowmakers');
/** Failure and drop sets allowed in one workout when the person trains gently. */
export const GENTLE_FAILURE_SETS = ruleNumber('push.gentle-no-failure');
/** Reps in reserve for the work sets at each push. */
export const reserveFor = (push: Push): { min: number; max: number } => ruleNamedRange('push.rir', push);

/** Comparable sessions in a row without more load or reps before a core exercise of the section changes. */
export const STAGNATION_SESSIONS = ruleNumber('block.stagnation-sessions');
/** The share of the usual hard sets the light week of a section keeps. */
export const LIGHT_SHARE = ruleNumber('block.light-share');
