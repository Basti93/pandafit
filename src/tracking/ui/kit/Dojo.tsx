import type { ReactNode } from 'react';
import { PandaPortrait, type PandaGesture } from '../PandaPortrait';
import { BoScene, type BoPlace } from './BoScene';
import { Icon } from './Icon';

/** The one card. `soft` is the quieter fill for a group inside a page. */
export function Card({ soft = false, label, children }: { soft?: boolean; label?: string; children: ReactNode }) {
  return <section className={soft ? 'card soft' : 'card'} aria-label={label}>{children}</section>;
}

/** The small amber line above a title. */
export function Kicker({ children }: { children: ReactNode }) {
  return <p className="tk-kicker">{children}</p>;
}

/** A title in the display face with a brush stroke below it. */
export function BrushTitle({ children, level = 2 }: { children: ReactNode; level?: 1 | 2 | 3 }) {
  const H = level === 1 ? 'h1' : level === 2 ? 'h2' : 'h3';
  return (
    <div className="tk-brush">
      <H className={level === 1 ? 'tk-title' : undefined}>{children}</H>
      <svg aria-hidden="true" width="150" height="10" viewBox="0 0 150 10"><path d="M2 6 C 40 2, 90 9, 148 4" stroke="currentColor" strokeWidth="3.5" fill="none" strokeLinecap="round" /></svg>
    </div>
  );
}

type Action = { label: string; onClick: () => void };

/** "Jetzt dran": the one main card of a screen. The same look everywhere. `more` holds quiet extras below the buttons. */
export function MainCard({ kicker, title, text, primary, secondary, more, label }: { kicker: string; title: string; text?: ReactNode; primary?: Action; secondary?: Action; more?: ReactNode; label?: string }) {
  return (
    <Card label={label ?? kicker}>
      <Kicker>{kicker}</Kicker>
      <BrushTitle>{title}</BrushTitle>
      {text && <p className="tk-maintext">{text}</p>}
      {(primary || secondary) && (
        <div className="tk-mainactions">
          {primary && <button type="button" className="primary" onClick={primary.onClick}>{primary.label}</button>}
          {secondary && <button type="button" className="secondary" onClick={secondary.onClick}>{secondary.label}</button>}
        </div>
      )}
      {more}
    </Card>
  );
}

/** A speech bubble with a small tail. `tail="right"` is the user's own bubble; `foot` is a small muted line (time, label). */
export function Bubble({ children, actions, tail = 'left', foot }: { children: ReactNode; actions?: ReactNode; tail?: 'left' | 'right' | 'none'; foot?: ReactNode }) {
  return (
    <div className={tail === 'right' ? 'tk-bubble right' : 'tk-bubble'}>
      {tail !== 'none' && <span className="tk-bubble-tail" aria-hidden="true" />}
      <div className="tk-bubble-text">{children}</div>
      {actions && <div className="tk-bubble-actions">{actions}</div>}
      {foot && <p className="tk-bubble-foot">{foot}</p>}
    </div>
  );
}

/** The one back button of a page: round with "Zurück" as its name, or a pill "‹ label". */
export function BackButton({ label, onClick }: { label?: string; onClick: () => void }) {
  return (
    <button type="button" className={label ? 'tk-backbtn pill' : 'tk-backbtn'} aria-label={label ? undefined : 'Zurück'} onClick={onClick}>
      <Icon name="zurueck" size={20} />{label}
    </button>
  );
}

/** A small green label with a check, e.g. "Im Training berücksichtigt". */
export function Tag({ children }: { children: ReactNode }) {
  return <span className="tk-tag"><Icon name="haken" size={14} />{children}</span>;
}

/** Bo speaks: his portrait (in a scene when `place` is set) and a bubble next to it. `mini` is the still picture only; a moving mini Bo is a PandaPortrait set by the caller. */
export function BoBubble({ children, actions, pose, portrait = 'full', place, foot }: { children: ReactNode; actions?: ReactNode; foot?: ReactNode; pose?: PandaGesture | null; portrait?: 'full' | 'mini' | 'none'; place?: BoPlace }) {
  if (portrait === 'none') return <div className="tk-bo"><Bubble actions={actions} foot={foot} tail="none">{children}</Bubble></div>;
  const bo = portrait === 'mini' ? <img className="tk-bo-still" src="/brand/panda-still.svg" alt="" /> : <PandaPortrait pose={pose} />;
  return (
    <div className={`tk-bo ${portrait}`}>
      <span className="tk-bo-portrait">{place ? <BoScene place={place}>{bo}</BoScene> : bo}</span>
      <Bubble actions={actions} foot={foot}>{children}</Bubble>
    </div>
  );
}
