import { useState } from 'react';
import { studioName } from '../../shared/studio';
import { ConfirmLink, Sheet } from './kit';

/** "Studio  Nord ›": the studio of this workout, one row. It opens the studio sheet. */
export function StudioRow({ value, onOpen }: { value: string | undefined; onOpen: () => void }) {
  return (
    <button type="button" className="tk-rowbtn tk-choice" onClick={onOpen}>
      <span className="tk-row-title">Studio</span>
      <span className="tk-row-value muted">{value ?? 'noch keins'}</span>
      <span className="tk-chevron" aria-hidden="true">›</span>
    </button>
  );
}

/**
 * Choose the studio from the known ones, create a new one, rename this one. On the start screen (`onAway`) it can also be taken out of
 * the list: removed for good when no workout has it (after a confirm), else only hidden. The workouts keep their studio either way.
 */
export function StudioSheet({ value, known, onChange, onRename, onAway, onClose }: {
  value: string | undefined; known: string[]; onChange: (name: string | undefined, created?: boolean) => void; onRename: (from: string, to: string) => void;
  onAway?: { used: boolean; run: (name: string, used: boolean) => void }; onClose: () => void;
}) {
  const [mode, setMode] = useState<'pick' | 'new' | 'rename'>('pick');
  const [text, setText] = useState('');
  const names = value && !known.includes(value) ? [value, ...known] : known;
  const match = (typed: string) => known.find((k) => k.toLowerCase() === typed.toLowerCase());
  const save = () => {
    const typed = studioName(text);
    if (!typed) return;
    if (mode === 'new') onChange(match(typed) ?? typed, !match(typed));
    else if (value && typed !== value) onRename(value, match(typed) ?? typed);
    onClose();
  };
  const typing = mode !== 'pick';
  return (
    <Sheet size={typing ? 'full' : 'small'} title="Studio" display onClose={onClose} actions={typing ? <button type="button" disabled={!studioName(text)} onClick={save}>Speichern</button> : undefined}>
      {typing ? (
        <input type="text" autoFocus maxLength={40} value={text} aria-label={mode === 'new' ? 'Name des neuen Studios' : 'Neuer Name des Studios'}
          onChange={(e) => setText(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter') save(); }} />
      ) : (
        <>
          <p className="muted">Jedes Studio merkt sich seine Gewichte.</p>
          <ul className="tk-rows">
            {names.map((n) => (
              <li key={n} className="tk-rowitem">
                <button type="button" className="tk-rowbtn" aria-pressed={n === value} onClick={() => { if (n !== value) onChange(n); onClose(); }}>
                  <span className="tk-row-title">{n}</span>{n === value && <span className="tk-row-value" aria-hidden="true">✓</span>}
                </button>
              </li>
            ))}
            <li className="tk-rowitem">
              <button type="button" className="tk-rowbtn" onClick={() => { setText(''); setMode('new'); }}><span className="tk-row-title">Neues Studio …</span><span className="tk-chevron" aria-hidden="true">›</span></button>
            </li>
          </ul>
          {value && (
            <div className="tk-links">
              <button type="button" className="link" onClick={() => { setText(value); setMode('rename'); }}>{value} umbenennen</button>
              {onAway && !onAway.used && <ConfirmLink label={`${value} entfernen`} question="Studio wirklich entfernen?" onConfirm={() => { onAway.run(value, false); onClose(); }} />}
              {onAway && onAway.used && <button type="button" className="link" onClick={() => { onAway.run(value, true); onClose(); }}>{value} ausblenden</button>}
            </div>
          )}
        </>
      )}
    </Sheet>
  );
}
