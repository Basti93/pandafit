import type { Effort } from '../../shared/records';

const KEY = 'pandafit-effort-questions';
export const EFFORT_LABEL: Record<Effort, string> = { none: '0', some: '1–2', plenty: '3+' };

/** On unless switched off on this device. */
export const effortQuestionsOn = (): boolean => { try { return localStorage.getItem(KEY) !== 'off'; } catch { return true; } };
const switchOff = () => { try { localStorage.setItem(KEY, 'off'); } catch { /* private mode: off for this session only */ } };

/** One tap after an exercise: how many more reps would have been possible. Skippable, never repeated. */
export function EffortQuestion({ title, onAnswer, onOff }: { title: string; onAnswer: (a: Effort | 'skip') => void; onOff: () => void }) {
  return (
    <div className="tk-effort" role="group" aria-label={`Wie viele hättest du bei ${title} noch geschafft?`}>
      <p>Wie viele Wiederholungen hättest du im letzten Satz noch geschafft?</p>
      <div className="tk-row">
        {(Object.keys(EFFORT_LABEL) as Effort[]).map((k) => (
          <button key={k} type="button" className="secondary" onClick={() => onAnswer(k)}>{EFFORT_LABEL[k]}</button>
        ))}
        <button type="button" className="link" onClick={() => onAnswer('skip')}>Überspringen</button>
      </div>
      <button type="button" className="link tk-sub" onClick={() => { switchOff(); onOff(); }}>Nicht mehr fragen</button>
    </div>
  );
}
