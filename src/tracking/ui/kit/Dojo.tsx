import type { ReactNode } from 'react';
import { PandaPortrait, type PandaGesture } from '../PandaPortrait';

/** The one card. `soft` is the quieter fill for a group inside a page. */
export function Card({ soft = false, label, children }: { soft?: boolean; label?: string; children: ReactNode }) {
  return <section className={soft ? 'card soft' : 'card'} aria-label={label}>{children}</section>;
}

/** The small amber line above a title. */
export function Kicker({ children }: { children: ReactNode }) {
  return <p className="tk-kicker">{children}</p>;
}

/** A title in the display face with a brush stroke below it. */
export function BrushTitle({ children, level = 2 }: { children: ReactNode; level?: 2 | 3 }) {
  const Tag = level === 2 ? 'h2' : 'h3';
  return (
    <div className="tk-brush">
      <Tag>{children}</Tag>
      <svg aria-hidden="true" width="150" height="10" viewBox="0 0 150 10"><path d="M2 6 C 40 2, 90 9, 148 4" stroke="currentColor" strokeWidth="3.5" fill="none" strokeLinecap="round" /></svg>
    </div>
  );
}

type Action = { label: string; onClick: () => void };

/** "Jetzt dran": the one main card of a screen. The same look everywhere. */
export function MainCard({ kicker, title, text, primary, secondary }: { kicker: string; title: string; text?: ReactNode; primary: Action; secondary?: Action }) {
  return (
    <Card label={kicker}>
      <Kicker>{kicker}</Kicker>
      <BrushTitle>{title}</BrushTitle>
      {text && <p className="tk-maintext">{text}</p>}
      <div className="tk-mainactions">
        <button type="button" className="primary" onClick={primary.onClick}>{primary.label}</button>
        {secondary && <button type="button" className="secondary" onClick={secondary.onClick}>{secondary.label}</button>}
      </div>
    </Card>
  );
}

/** A speech bubble with a small tail. */
export function Bubble({ children, actions, tail = 'left' }: { children: ReactNode; actions?: ReactNode; tail?: 'left' | 'none' }) {
  return (
    <div className="tk-bubble">
      {tail === 'left' && <span className="tk-bubble-tail" aria-hidden="true" />}
      <div className="tk-bubble-text">{children}</div>
      {actions && <div className="tk-bubble-actions">{actions}</div>}
    </div>
  );
}

/** Bo speaks: his portrait in a soft glow, and a bubble next to it. */
export function BoBubble({ children, actions, pose, portrait = 'full' }: { children: ReactNode; actions?: ReactNode; pose?: PandaGesture | null; portrait?: 'full' | 'mini' | 'none' }) {
  if (portrait === 'none') return <div className="tk-bo"><Bubble actions={actions} tail="none">{children}</Bubble></div>;
  return (
    <div className={`tk-bo ${portrait}`}>
      <span className="tk-bo-portrait"><PandaPortrait pose={pose} /></span>
      <Bubble actions={actions}>{children}</Bubble>
    </div>
  );
}
