import { AskBoButton, BoBubble, SeeProposalButton } from '../../tracking/ui/kit';
import type { PandaGesture } from '../../tracking/ui/PandaPortrait';

/**
 * Bo on Heute: he stands at the place of his pose (DESIGN.md, Bos Orte), the coach sentence of the day in his bubble. `onAsk` opens the real coach chat.
 * With `onProposal` a waiting proposal adds the main button SeeProposalButton; AskBoButton stays beside it.
 * `pose` is the one pose Bo glides into when Heute opens and keeps until it opens again.
 */
export function CoachLine({ text, onAsk, pose, onProposal, still }: { still?: boolean; text: string; onAsk?: () => void; pose?: PandaGesture | null; onProposal?: () => void }) {
  const actions = (onProposal || onAsk) && (
    <>
      {onProposal && <SeeProposalButton onClick={onProposal} />}
      {onAsk && <AskBoButton onClick={onAsk} />}
    </>
  );
  return (
    <section className="tk-coachline" aria-label="Satz von Bo">
      <BoBubble still={still} place="own" pose={pose} actions={actions}>
        <p className="tk-coachtext">{text}</p>
      </BoBubble>
    </section>
  );
}
