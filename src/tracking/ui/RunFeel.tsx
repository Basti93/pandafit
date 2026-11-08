import { ruleNumber } from '../../shared/training-policy';
import type { RunFeel as Feel } from '../../shared/run';

const DAY = 86_400_000;
/** The question is asked for the newest run of the last 3 days (register: run.feel-ask-days). */
export const FEEL_ASK_DAYS = ruleNumber('run.feel-ask-days');
const LABEL: Record<Feel, string> = { easy: 'leicht', right: 'passend', hard: 'schwer' };

/** True while the card's run is recent enough and has no feel record (an answer or a skip). */
export const feelAsked = (card: { runId: string; date: string } | null, answered: ReadonlySet<string>, nowMs: number): boolean => {
  if (!card || answered.has(card.runId)) return false;
  const [y, m, d] = card.date.split('-').map(Number) as [number, number, number];
  return nowMs - new Date(y, m - 1, d, 12).getTime() <= FEEL_ASK_DAYS * DAY + DAY / 2;
};

/** One line after a run: how was it. One tap, skippable, written once. */
export function RunFeelQuestion({ onAnswer }: { onAnswer: (feel: Feel | null) => void }) {
  const tap = onAnswer;
  return (
    <section className="tk-feel" aria-label="Wie fühlte sich der Lauf an?">
      <p>Wie fühlte sich der Lauf an?</p>
      <div className="tk-chips">
        {(Object.keys(LABEL) as Feel[]).map((f) => <button key={f} type="button" className="secondary" onClick={() => tap(f)}>{LABEL[f]}</button>)}
      </div>
      <button type="button" className="link" onClick={() => tap(null)}>Später</button>
    </section>
  );
}
