import type { ReactNode } from 'react';
import { PandaPortrait, type PandaGesture } from '../PandaPortrait';
import { BoScene, poseIn, type BoPlace } from './BoScene';
import { Icon, type IconName } from './Icon';
import { BO, BO_LINES } from '../bo';

/** The one card. `soft` is the quieter fill for a group inside a page. */
export function Card({ soft = false, focus = false, label, children }: { soft?: boolean; focus?: boolean; label?: string; children: ReactNode }) {
  return <section className={focus ? 'card focus' : soft ? 'card soft' : 'card'} aria-label={label}>{children}</section>;
}

/** The small amber line above a title. With `heading` it is a level-2 heading (the groups of Profil). */
export function Kicker({ children, heading = false }: { children: ReactNode; heading?: boolean }) {
  return heading ? <h2 className="tk-kicker">{children}</h2> : <p className="tk-kicker">{children}</p>;
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

/** "Jetzt dran": the one main card of a screen. The same look everywhere. `middle` sits between the text and the buttons (a band, a small figure); `more` holds quiet extras below the buttons; `picture` stands on top, centred (the meal of Essen). */
export function MainCard({ kicker, title, text, primary, secondary, middle, more, label, picture }: { picture?: ReactNode; kicker: string; title: string; text?: ReactNode; primary?: Action; secondary?: Action; middle?: ReactNode; more?: ReactNode; label?: string }) {
  return (
    <Card label={label ?? kicker}>
      {picture && <div className="tk-cardpicture">{picture}</div>}
      <Kicker>{kicker}</Kicker>
      <BrushTitle>{title}</BrushTitle>
      {text && <p className="tk-maintext">{text}</p>}
      {middle}
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

/** The one round icon button: 44 px, card fill, thin line. `name` is what a screen reader says. */
export function RoundButton({ icon, name, onClick, pressed }: {
  icon: IconName; name: string; onClick: () => void;
  /** Toggle state (`aria-pressed`; the icon fills with the accent). Only for icons that read as filled when on (the heart). */
  pressed?: boolean;
}) {
  return <button type="button" className="tk-roundbtn" aria-label={name} aria-pressed={pressed} onClick={onClick}><Icon name={icon} size={20} /></button>;
}

/** The one pill: a quiet side action with an icon on the left (and the back button of a page with a label). `name` is the screen reader name when the visible label is short. */
export function PillButton({ icon, label, name, onClick }: { icon: IconName; label: string; name?: string; onClick: () => void }) {
  return <button type="button" className="tk-pill" aria-label={name} onClick={onClick}><Icon name={icon} size={18} />{label}</button>;
}

/** The one back button of a page: the round button with "Zurück" as its name, or a PillButton "‹ label". */
export function BackButton({ label, onClick }: { label?: string; onClick: () => void }) {
  if (!label) return <RoundButton icon="zurueck" name="Zurück" onClick={onClick} />;
  return <PillButton icon="zurueck" label={label} onClick={onClick} />;
}

/** Bo's two buttons, the same on every page: "Vorschlag ansehen" (the main one) and "Frag Bo, deinen Sensai" with the speech icon. */
export function SeeProposalButton({ onClick }: { onClick: () => void }) {
  return <button type="button" className="primary" onClick={onClick}>{BO_LINES.seeProposal}</button>;
}
export function AskBoButton({ onClick }: { onClick: () => void }) {
  return <button type="button" className="secondary" onClick={onClick}><Icon name="sprechen" size={18} /><span>{BO.ask}</span></button>;
}

/**
 * The one slim timer card (the rest between sets): the whole text is one button (`skipName`, e.g. "Pause überspringen"),
 * a `secondary` button beside it. `label` names the timer. Where it sits (sticky) is the screen's layout.
 */
export function TimerCard({ label, skipName, onSkip, more, children }: { label: string; skipName: string; onSkip: () => void; more: Action; children: ReactNode }) {
  return (
    <div role="timer" aria-label={label} className="tk-timercard">
      <button type="button" className="tk-rest-main" aria-label={skipName} onClick={onSkip}>{children}</button>
      <button type="button" className="secondary" onClick={more.onClick}>{more.label}</button>
    </div>
  );
}

/**
 * The one head card of a page, with its title (Essen, a meal, a recipe, Profil): kicker, title, a muted sentence, then `children`.
 * Two shapes: with `picture` the picture stands on top, centred (Essen, a meal, a recipe); with `icon` a round avatar
 * (64 px, accent ring) stands left and the text beside it (Profil only). Not a MainCard: it has no main and side action.
 */
export function HeadCard({ kicker, title, level = 1, text, icon, picture, children }: { kicker?: string; title: string; level?: 1 | 2; text?: ReactNode; icon?: IconName; picture?: ReactNode; children?: ReactNode }) {
  const head = (
    <>
      {kicker && <Kicker>{kicker}</Kicker>}
      <BrushTitle level={level}>{title}</BrushTitle>
      {text && <p className="tk-maintext">{text}</p>}
    </>
  );
  return (
    <Card label={title}>
      {picture && <div className="tk-cardpicture">{picture}</div>}
      {icon ? (
        <div className="tk-headavatar">
          <span className="tk-avatar" aria-hidden="true"><Icon name={icon} size={32} /></span>
          <div className="tk-headtext">{head}</div>
        </div>
      ) : head}
      {children}
    </Card>
  );
}

/** A small green label with a check, e.g. "Im Training berücksichtigt". */
export function Tag({ children }: { children: ReactNode }) {
  return <span className="tk-tag"><Icon name="haken" size={14} />{children}</span>;
}

/** Bo speaks: his portrait (in a scene when `place` is set) and a bubble next to it. `mini` is the still picture only; a moving mini Bo is a PandaPortrait set by the caller. */
export function BoBubble({ children, actions, pose, portrait = 'full', place, foot }: { children: ReactNode; actions?: ReactNode; foot?: ReactNode; pose?: PandaGesture | null; portrait?: 'full' | 'mini' | 'none'; place?: BoPlace }) {
  if (portrait === 'none') return <div className="tk-bo"><Bubble actions={actions} foot={foot} tail="none">{children}</Bubble></div>;
  const bo = portrait === 'mini' ? <img className="tk-bo-still" src="/brand/panda-still.svg" alt="" /> : <PandaPortrait pose={place ? poseIn(place, pose) : pose} />;
  return (
    <div className={`tk-bo ${portrait}`}>
      <span className="tk-bo-portrait">{place ? <BoScene place={place}>{bo}</BoScene> : bo}</span>
      <Bubble actions={actions} foot={foot}>{children}</Bubble>
    </div>
  );
}
