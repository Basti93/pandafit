/** Bo's name and role live in src/shared/bo.ts; this re-export keeps the UI imports short. */
export { BO } from '../../shared/bo';

/** What Bo says in the calm places: the week, a waiting proposal, the chat. */
export const BO_LINES = {
  weekCalm: 'Wenn du an der Woche etwas ändern willst, sag es mir einfach.',
  weekEmpty: 'Für diese Woche steht noch kein Plan. Sollen wir zusammen einen machen?',
  proposal: 'Ich habe einen Vorschlag für dich. Schau ihn dir in Ruhe an.',
  thinking: 'Ich denke gerade über deine Nachricht nach.',
  subtitle: 'Dein Sensei kennt deinen Plan.',
  suggestions: ['Schlag mir eine Woche vor', 'Mir tut etwas weh', 'Diese Woche habe ich weniger Zeit'],
} as const;
