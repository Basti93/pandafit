import { ruleValues } from './training-policy';

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
