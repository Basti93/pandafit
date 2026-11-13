import type { Effort } from '../../shared/records';

const KEY = 'pandafit-effort-questions';
/** The answers, in the order they are shown: the stored value stays none/some/plenty (reps left), the text says how the last reps went. */
export const EFFORT_ANSWER: Record<Effort, string> = { plenty: 'So schnell wie die ersten', some: 'Langsamer, aber sauber', none: 'Die letzte ging kaum noch hoch' };

/** On unless switched off on this device. */
export const effortQuestionsOn = (): boolean => { try { return localStorage.getItem(KEY) !== 'off'; } catch { return true; } };
const switchOff = () => { try { localStorage.setItem(KEY, 'off'); } catch { /* private mode: off for this session only */ } };

/** One tap after an exercise: how the last reps went. Skippable, never repeated unless the person reopens it. */
export function EffortQuestion({ title, onAnswer, onOff }: { title: string; onAnswer: (a: Effort | 'skip') => void; onOff: () => void }) {
  const question = `Wie liefen die letzten Wiederholungen bei ${title}?`;
  return (
    <div className="tk-effort" role="group" aria-label={question}>
      <p>{question}</p>
      <div className="tk-row">
        {(Object.keys(EFFORT_ANSWER) as Effort[]).map((k) => (
          <button key={k} type="button" className="secondary" onClick={() => onAnswer(k)}>{EFFORT_ANSWER[k]}</button>
        ))}
        <button type="button" className="link" onClick={() => onAnswer('skip')}>Überspringen</button>
      </div>
      <button type="button" className="link tk-sub" onClick={() => { switchOff(); onOff(); }}>Nicht mehr fragen</button>
    </div>
  );
}
