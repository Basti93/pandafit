import { PandaPortrait, type PandaEvent, type PandaGesture } from '../../tracking/ui/PandaPortrait';

/**
 * Panda on Heute: the portrait (still, animated once the canvas has drawn), the name, the coach sentence of the day and, on today, one button that opens the real coach chat.
 * `gesture` is the greeting when Heute opens; `dayClip` is the one calm clip that follows it.
 */
export function CoachLine({ text, onAsk, gesture, dayClip }: { text: string; onAsk?: () => void; gesture?: PandaEvent; dayClip?: PandaGesture | null }) {
  return (
    <section className="card tk-coachline" aria-label="Satz vom Coach">
      <PandaPortrait gesture={gesture} dayClip={dayClip} />
      <div className="tk-pandahead">
        <span className="tk-pandaname">Bo</span>
        <span className="tk-pandarole">Dein Coach</span>
      </div>
      <p className="tk-coachtext">{text}</p>
      {onAsk && <button type="button" className="tk-coachask" onClick={onAsk}>Frag Bo, deinen Coach</button>}
    </section>
  );
}
