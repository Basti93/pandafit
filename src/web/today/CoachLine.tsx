import { BoBubble } from '../../tracking/ui/kit';
import { BO } from '../../tracking/ui/bo';
import type { PandaGesture } from '../../tracking/ui/PandaPortrait';

/**
 * Bo on Heute: his portrait, the coach sentence of the day in his bubble and, on today, one button that opens the real coach chat.
 * `pose` is the one pose Bo glides into when Heute opens and keeps until it opens again.
 */
export function CoachLine({ text, onAsk, pose }: { text: string; onAsk?: () => void; pose?: PandaGesture | null }) {
  return (
    <section className="tk-coachline" aria-label="Satz vom Coach">
      <BoBubble pose={pose} actions={onAsk && <button type="button" className="secondary" onClick={onAsk}>{BO.ask}</button>}>
        <span className="tk-bo-name">{BO.name} · {BO.role}</span>
        <p className="tk-coachtext">{text}</p>
      </BoBubble>
    </section>
  );
}
