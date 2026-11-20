import { readMuscleChart, type MuscleChart } from './muscle-chart';
import { readSportChart, type SportChart } from './sport-chart';

/** The chart cards a chat message can carry. A new kind is added here; a reader skips a kind it does not know. */
export type ChartCard = MuscleChart | SportChart;

/** Reads one stored card; an unknown kind or unusable data gives null. */
export function readChartCard(x: unknown): ChartCard | null {
  return readMuscleChart(x) ?? readSportChart(x);
}

/** Reads a stored list of cards; entries that cannot be read are skipped. */
export function readChartCards(x: unknown): ChartCard[] {
  return Array.isArray(x) ? x.flatMap((c) => { const r = readChartCard(c); return r ? [r] : []; }) : [];
}

/**
 * The message fields for a list of cards. `chart` is always the first card (older devices read only that one) and `charts`
 * is the whole list, written only when there are several.
 */
export function cardFields(cards: readonly ChartCard[]): { chart?: ChartCard; charts?: ChartCard[] } {
  if (cards.length === 0) return {};
  return cards.length === 1 ? { chart: cards[0]! } : { chart: cards[0]!, charts: [...cards] };
}
