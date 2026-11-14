import { policyRule, ruleNumber, ruleValues } from './training-policy';

/**
 * How long a person has trained with weights, roughly and without numbers in the interface
 * (docs/superpowers/specs/2026-11-14-erfahrung-design.md). `neu`: starts, `einige`: a few months, `erfahren`: today's rules.
 * Everywhere a missing level means `erfahren`, so code that does not know the level keeps today's behaviour.
 */
export type Experience = 'neu' | 'einige' | 'erfahren';
export const EXPERIENCES: readonly Experience[] = ['neu', 'einige', 'erfahren'];

const rank = (e: Experience | undefined): number => EXPERIENCES.indexOf(e ?? 'erfahren');
/** Whether `e` (missing: erfahren) is at least `level`. */
export const atLeast = (e: Experience | undefined, level: Experience): boolean => rank(e) >= rank(level);
export const maxExperience = (a: Experience, b: Experience | undefined): Experience => (b !== undefined && rank(b) > rank(a) ? b : a);
export const isExperience = (x: unknown): x is Experience => EXPERIENCES.includes(x as Experience);

/** Bo's one question, asked only when the data cannot show `erfahren` yet. */
export const EXPERIENCE_QUESTION = 'Wie lange trainierst du schon mit Gewichten?';
/** The three answers, as the person says them. */
export const EXPERIENCE_ANSWER: Record<Experience, string> = { neu: 'Ich fange gerade an', einige: 'Ein paar Monate', erfahren: 'Länger als ein Jahr' };
/** The level in words for the AI planner. */
export const EXPERIENCE_WORDS: Record<Experience, string> = { neu: 'fängt an', einige: 'einige Monate dabei', erfahren: 'erfahren' };

const dayNumber = (key: string): number => { const [y, m, d] = key.split('-').map(Number); return Date.UTC(y!, m! - 1, d!) / 86_400_000; };

/**
 * The level the data shows: the number of distinct strength dates up to `today` (YYYY-MM-DD) and the days since the first one,
 * against `experience.levels`. Both have to be reached, so a long gap with few sessions or many sessions in a short time stay lower.
 */
export function experienceFromData(dates: readonly string[], today: string): Experience {
  const days = [...new Set(dates)].filter((d) => d <= today).sort();
  if (days.length === 0) return 'neu';
  const v = ruleValues('experience.levels');
  const span = dayNumber(today) - dayNumber(days[0]!);
  if (days.length >= v.erfahrenWorkouts! && span >= v.erfahrenDays!) return 'erfahren';
  if (days.length >= v.einigeWorkouts! && span >= v.einigeDays!) return 'einige';
  return 'neu';
}

/** The estimate: the higher of the data and the person's answer, so growing data overtakes an answer by itself. */
export const experienceOf = (o: { dates: readonly string[]; answer?: Experience; today: string }): Experience =>
  maxExperience(experienceFromData(o.dates, o.today), o.answer);

/** A value of a per-level rule; `erfahren` and a level the rule does not name keep `general`. */
const perLevel = (id: string, e: Experience | undefined, general: number): number => (e && e !== 'erfahren' ? ruleValues(id)[e] ?? general : general);

/** The hard gym limits of a level (missing: erfahren, today's general rules). */
export function limitsFor(e: Experience | undefined): { maxSets: number; maxSessionFractionalSets: number; maxFailureSets: number; failureAtEndOnly: boolean; maxWidowmakers: number; dropsetsCount: boolean } {
  const below = !atLeast(e, 'erfahren');
  return {
    maxSets: perLevel('experience.max-sets', e, ruleNumber('gym.max-sets')),
    maxSessionFractionalSets: perLevel('experience.session-fractional-sets', e, ruleNumber('gym.max-session-fractional-sets')),
    maxFailureSets: perLevel('experience.failure-sets', e, ruleNumber('gym.max-failure-sets')),
    // Below erfahren, failure and drop sets count together and only close an exercise; no widowmaker.
    failureAtEndOnly: below, dropsetsCount: below, maxWidowmakers: below ? 0 : ruleNumber('gym.max-widowmakers'),
  };
}

/** A rep range with the level's floor (`experience.rep-floor`): the minimum rises, the maximum never falls below it. */
export function repRangeFor(r: { min: number; max: number }, e: Experience | undefined): { min: number; max: number } {
  const floor = perLevel('experience.rep-floor', e, 0);
  if (r.min >= floor) return r;
  return { min: floor, max: Math.max(r.max, floor) };
}

/** The reps in reserve to plan with: the push's range, at least the level's (`experience.rir`). */
export function reserveWith(push: { min: number; max: number }, e: Experience | undefined): { min: number; max: number } {
  const own = e && e !== 'erfahren' ? policyRule('experience.rir').ranges?.[e] : undefined;
  return own ? { min: Math.max(push.min, own.min), max: Math.max(push.max, own.max) } : push;
}

/** How many reps one step of progress adds when there was clearly room (`experience.rep-jump`); 1 means no faster jump. */
export const repJumpFor = (e: Experience | undefined): number => perLevel('experience.rep-jump', e, 1);
/** Reps above the plan that count as "clearly more". */
export const clearMargin = (): number => ruleValues('experience.rep-jump').clearMargin!;
/** Sessions without progress before a core exercise changes. */
export const stagnationSessionsFor = (e: Experience | undefined): number => perLevel('experience.stagnation-sessions', e, ruleNumber('block.stagnation-sessions'));
/** Whether the weekly set targets and the balance follow the light view of a beginner (`experience.volume-view`). */
export const lightVolumeView = (e: Experience | undefined): boolean => e === 'neu';
