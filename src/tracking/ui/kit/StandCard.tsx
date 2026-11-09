import { Card, Kicker } from './Dojo';
import { Icon } from './Icon';

/** One vocabulary for week state, set circles and progress: done, now (the next one), open. */
export type Mark = 'done' | 'now' | 'open';

/** The one state dot. With `onClick` it is a button (44 px tap area) named by `name`; `short` replaces the check (e.g. a set number or "A"). */
export function MarkDot({ state, short, name, onClick }: { state: Mark; short?: string; name?: string; onClick?: () => void }) {
  const inner = state === 'done' && !short ? <Icon name="haken" size={14} /> : short ?? null;
  if (onClick) return <button type="button" className={`tk-mark ${state}`} aria-label={name} onClick={onClick}>{inner}</button>;
  return <span className={`tk-mark ${state}`} aria-hidden="true">{inner}</span>;
}

/** The one part bar: each part is as wide as its `grow`, filled `fill` (0 to 1) in the accent; `tall` parts are higher. Named only with `label`. */
export function Band({ parts, label }: { parts: { grow: number; fill: number; tall?: boolean }[]; label?: string }) {
  return (
    <div className="tk-band" role={label ? 'img' : undefined} aria-label={label} aria-hidden={label ? undefined : true}>
      {parts.map((p, i) => (
        <span key={i} className={p.tall ? 'tall' : undefined} style={{ flexGrow: p.grow }}>
          <span style={{ width: `${Math.max(0, Math.min(1, p.fill)) * 100}%` }} />
        </span>
      ))}
    </div>
  );
}

/** The one orientation card "Kraft · diese Woche": the week of one sport as a sentence and small dots. The count is only in `marksLabel`. */
export function StandCard({ kicker, text, marks, marksLabel, action }: { kicker: string; text: string; marks: Mark[]; marksLabel: string; action?: { label: string; onClick: () => void } }) {
  return (
    <Card label={kicker}>
      <div className="tk-stand">
        <div className="tk-stand-text">
          <Kicker>{kicker}</Kicker>
          <p className="tk-maintext">{text}</p>
        </div>
        {marks.length > 0 && (
          <span className="tk-stand-marks" role="img" aria-label={marksLabel}>
            {marks.map((m, i) => <MarkDot key={i} state={m} />)}
          </span>
        )}
      </div>
      {action && <button type="button" className="secondary" onClick={action.onClick}>{action.label}</button>}
    </Card>
  );
}
