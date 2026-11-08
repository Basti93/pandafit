import { PandaPortrait, type PandaGesture } from '../../tracking/ui/PandaPortrait';

/**
 * Panda on Heute: the portrait (still, animated once the canvas has drawn), the name, the coach sentence of the day and, on today, one button that opens the real coach chat.
 * `pose` is the one pose Bo glides into when Heute opens and keeps until it opens again.
 */
export function CoachLine({ text, onAsk, pose }: { text: string; onAsk?: () => void; pose?: PandaGesture | null }) {
  return (
    <section className="card tk-coachline" aria-label="Satz vom Coach">
      <PandaPortrait pose={pose} />
      <div className="tk-pandahead">
        <span className="tk-pandaname">Bo</span>
        <span className="tk-pandarole">Dein Coach</span>
      </div>
      <p className="tk-coachtext">{text}</p>
      {onAsk && <button type="button" className="tk-coachask" onClick={onAsk}>Frag Bo, deinen Coach</button>}
    </section>
  );
}
