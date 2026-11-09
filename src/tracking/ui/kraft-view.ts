import type { Trend } from '../progress';
import { cap, numberWord } from './week-path';

/** The tile "Deine Routinen" in one sentence. */
export function routinesSentence(n: number): string {
  if (n <= 0) return 'Leg feste Abläufe an, zum Beispiel für das Hotel.';
  if (n === 1) return 'Ein fester Ablauf liegt bereit.';
  return `${cap(numberWord(n))} feste Abläufe liegen bereit.`;
}

/** The tile "Deine Übungen" in one sentence: how most of them move. */
export function exercisesSentence(trends: Map<string, Trend>): string {
  if (trends.size === 0) return 'Hier findest du alle Übungen mit Anleitung.';
  const rising = [...trends.values()].filter((t) => t === 'steigt').length;
  return rising * 2 > trends.size ? 'Bei den meisten Übungen wirst du gerade stärker.' : 'Deine Übungen halten gerade ihr Niveau.';
}
