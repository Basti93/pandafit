import { familyOf } from './families';

/** Words that only name the equipment, not the movement. Longer phrases first, so "am Kabelzug" is not cut as "am Kabel". */
export const EQUIPMENT_WORDS = ['mit SZ-Stange', 'mit Kurzhanteln', 'mit Langhantel', 'an der Multipresse', 'an der Maschine', 'am Kabelzug', 'mit Stange', 'mit Seil', 'am Kabel', 'einarmig'] as const;

const WORD_EDGE = '(?<![\\p{L}\\p{N}])';
const WORD_END = '(?![\\p{L}\\p{N}])';
const EQUIPMENT_RE = EQUIPMENT_WORDS.map((w) => new RegExp(`${WORD_EDGE}${w.replace(/\s+/g, '\\s+')}${WORD_END}`, 'giu'));

/** The title without the bracket part and the equipment words: "Trizepsdrücken mit Seil" → "trizepsdrücken". */
export function titleStem(title: string): string {
  let s = title.replace(/\s*\([^)]*\)\s*/g, ' ');
  for (const re of EQUIPMENT_RE) s = s.replace(re, ' ');
  return s.replace(/\s+/g, ' ').trim().toLowerCase();
}

/**
 * What makes two exercises the same execution: movement family, primary muscle and the title stem without equipment words.
 * Two exercises with the same key differ only in equipment. Family `other` has no key (null): it is never treated as a duplicate.
 */
export function executionKey(e: { title: string; family?: string; primaryMuscle?: string | null }): string | null {
  const family = familyOf(e);
  if (family === 'other') return null;
  return `${family}|${e.primaryMuscle ?? ''}|${titleStem(e.title)}`;
}
