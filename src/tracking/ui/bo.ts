/** Bo's name and role live in src/shared/bo.ts; this re-export keeps the UI imports short. */
export { BO } from '../../shared/bo';

/** What Bo says in the calm places: the week, a waiting proposal, the chat. */
export const BO_LINES = {
  weekCalm: 'Wenn du an der Woche etwas ändern willst, sag es mir einfach.',
  weekEmpty: 'Für diese Woche steht noch kein Plan. Sollen wir zusammen einen machen?',
  proposal: 'Ich habe einen Vorschlag für dich. Schau ihn dir in Ruhe an.',
  thinking: 'Ich denke gerade über deine Nachricht nach.',
  seeProposal: 'Vorschlag ansehen',
  /** The first line of a week proposal in Bo's bubble; `from` is "16.11.". */
  proposalWeek: (from: string): string => `Für die Woche ab ${from} schlage ich dir das vor:`,
  /** The notes under a message that waits for Bo's answer: just sent, slow, no answer any more. */
  sent: 'Angekommen. Ich antworte dir, sobald ich kann.',
  slow: 'Ich antworte dir, sobald ich wieder erreichbar bin.',
  stale: 'Darauf habe ich nicht mehr geantwortet. Schreib mir gern nochmal.',
  subtitle: 'Dein Sensai kennt deinen Plan.',
  suggestions: ['Schlag mir eine Woche vor', 'Mir tut etwas weh', 'Diese Woche habe ich weniger Zeit'],
} as const;
