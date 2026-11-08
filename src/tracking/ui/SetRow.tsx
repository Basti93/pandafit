import { useState } from 'react';
import { filled, formatDecimal, parseDecimal, type TrackedSet } from '../session';
import { useDraft } from './hooks';
import { TYPE_NAMES } from './setGrid';

const invalidOf = (text: string, integer: boolean): boolean => {
  const n = parseDecimal(text);
  return n === undefined || (integer && n !== null && !Number.isInteger(n));
};

function NumField({ label, value, placeholder, integer, onCommit, onValidity }: {
  label: string; value: number | null; placeholder: string; integer?: boolean; onCommit: (n: number | null) => void; onValidity: (invalid: boolean) => void;
}) {
  const d = useDraft(formatDecimal(value), (text) => {
    const bad = invalidOf(text, !!integer);
    onValidity(bad);
    if (!bad) onCommit(parseDecimal(text) as number | null);
  });
  const bad = invalidOf(d.draft, !!integer);
  return (
    <span className="tk-field-wrap">
      <input
        className="tk-num" aria-label={label} placeholder={placeholder} inputMode={integer ? 'numeric' : 'decimal'} autoComplete="off"
        aria-invalid={bad} value={d.draft} onFocus={d.onFocus}
        onBlur={() => { d.onBlur(); if (!bad) d.setDraft(formatDecimal(parseDecimal(d.draft) as number | null)); }}
        onChange={(e) => { onValidity(invalidOf(e.target.value, !!integer)); d.onChange(e.target.value); }}
      />
      {bad && <small className="tk-invalid" role="note">{integer ? 'Bitte eine ganze Zahl' : 'Bitte eine Zahl'}</small>}
    </span>
  );
}

/** Column headers above the sets of one exercise. Same grid as the rows, so everything lines up. */
export function SetHead({ timed, editing }: { timed: boolean; editing?: boolean }) {
  return (
    <div className={`tk-set tk-head${editing ? ' tk-edit' : ''}`} aria-hidden="true">
      {editing && <span />}<span>Satz</span><span>{timed ? '' : 'kg'}</span><span>{timed ? 'Sek.' : 'Wdh'}</span><span />
    </div>
  );
}

const CHIP_CLASS: Record<TrackedSet['type'], string> = { warmup: ' tk-chip-warm', normal: '', failure: ' tk-chip-fail', dropset: ' tk-chip-drop' };

export function SetRow({ index, set, timed, label, preset, target, plates, editing, confirmedNow, onEdit, onToggle, onRemove }: {
  index: number; set: TrackedSet; timed: boolean;
  /** Edit mode (from the exercise menu): each set gets its remove button. */
  editing?: boolean;
  /** The short chip: Aufw., F, D or the set's number. Defaults to the row number. */
  label?: string;
  /** Shown in an empty field as the value a tap on the check takes (the set before). */
  preset?: Pick<TrackedSet, 'weightKg' | 'reps' | 'durationS'>;
  /** A muted line under the values: what you did last time. Tapping it shows the target range (`target`). */
  target?: string | null;
  /** Barbell only: the plates per side, on the next open set. */
  plates?: string | null;
  /** Is this set confirmed in the newest state? The display can lag behind a pending save. */
  confirmedNow?: () => boolean;
  onEdit: (patch: Partial<Pick<TrackedSet, 'weightKg' | 'reps' | 'durationS' | 'type'>>) => void;
  onToggle?: () => void; onRemove: () => void;
}) {
  const n = index + 1;
  const done = set.doneMs !== null;
  const [bad, setBad] = useState({ w: false, r: false });
  const [asking, setAsking] = useState(false);
  const blocked = bad.w || bad.r;
  const shown = preset ? filled(set, preset) : undefined; // an empty field shows what a tap on the check would put in it
  return (
    <div className={`tk-set${done ? ' tk-done' : ''}${editing ? ' tk-edit' : ''}`}>
      {editing && <button type="button" className="tk-del" aria-label={`Satz ${n} entfernen`} onClick={() => ((confirmedNow ? confirmedNow() : done) ? setAsking(true) : onRemove())}>×</button>}
      <span className="tk-chip-wrap">
        <span className={`tk-chip${CHIP_CLASS[set.type]}`} aria-hidden="true">{label ?? String(n)}</span>
        <select className="tk-type" aria-label={`Satztyp Satz ${n}`} value={set.type} onChange={(e) => onEdit({ type: e.target.value as TrackedSet['type'] })}>
          {Object.entries(TYPE_NAMES).map(([v, l]) => <option key={v} value={v}>{l}</option>)}
        </select>
      </span>
      {timed
        ? <span />
        : <NumField label={`Gewicht Satz ${n}`} value={set.weightKg} placeholder={shown?.weightKg != null ? formatDecimal(shown.weightKg) : '–'} onValidity={(w) => setBad((b) => ({ ...b, w }))} onCommit={(weightKg) => onEdit({ weightKg })} />}
      {timed
        ? <NumField label={`Sekunden Satz ${n}`} value={set.durationS} placeholder={shown?.durationS != null ? String(shown.durationS) : '–'} integer onValidity={(r) => setBad((b) => ({ ...b, r }))} onCommit={(durationS) => onEdit({ durationS })} />
        : <NumField label={`Wiederholungen Satz ${n}`} value={set.reps} placeholder={shown?.reps != null ? String(shown.reps) : '–'} integer onValidity={(r) => setBad((b) => ({ ...b, r }))} onCommit={(reps) => onEdit({ reps })} />}
      {onToggle
        ? <button type="button" className={`tk-check${done ? ' on' : ''}`} aria-label={`Satz ${n} erledigt`} aria-pressed={done} disabled={blocked && !done} onClick={onToggle}><span aria-hidden="true">✓</span></button>
        : <span />}
      {target && <small className="tk-hint muted">{target}</small>}
      {plates && <small className="tk-plates muted">{plates}</small>}
      {asking && (
        <p className="tk-note tk-wide">
          Dieser erledigte Satz geht dabei weg. Wirklich entfernen?{' '}
          <button type="button" className="danger-link" onClick={() => { setAsking(false); onRemove(); }}>Ja, entfernen</button>{' '}
          <button type="button" className="link" onClick={() => setAsking(false)}>Behalten</button>
        </p>
      )}
    </div>
  );
}
