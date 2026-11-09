import { BoBubble, Icon } from '../../tracking/ui/kit';
import { BO } from '../../tracking/ui/bo';
import type { PandaGesture } from '../../tracking/ui/PandaPortrait';

/**
 * Bo on Heute: he sits in his nest, the coach sentence of the day in his bubble. `onAsk` opens the real coach chat.
 * With `onProposal` a waiting proposal turns the main button into "Vorschlag ansehen"; "Frag Bo" stays beside it.
 * `pose` is the one pose Bo glides into when Heute opens and keeps until it opens again.
 */
export function CoachLine({ text, onAsk, pose, onProposal }: { text: string; onAsk?: () => void; pose?: PandaGesture | null; onProposal?: () => void }) {
  const actions = (onProposal || onAsk) && (
    <>
      {onProposal && <button type="button" className="primary" onClick={onProposal}>Vorschlag ansehen</button>}
      {onAsk && <button type="button" className="secondary" onClick={onAsk}><Icon name="sprechen" size={18} />{BO.ask}</button>}
    </>
  );
  return (
    <section className="tk-coachline" aria-label="Satz von Bo">
      <BoBubble place="nest" pose={pose} actions={actions}>
        <p className="tk-coachtext">{text}</p>
      </BoBubble>
    </section>
  );
}
