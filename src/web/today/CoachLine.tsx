import { PandaPortrait, type PandaEvent } from '../../tracking/ui/PandaPortrait';
import type { PandaGesture } from '../../tracking/ui/panda-rive';

/**
 * Panda on Heute: the portrait (still, animated once the Rive runtime has drawn), the name, the coach sentence of the day and, on today, one button that opens the real coach chat.
 * `gesture` is the greeting when Heute opens; `dayClip` is the one calm clip that follows it.
 */
export function CoachLine({ text, onAsk, gesture, dayClip }: { text: string; onAsk?: () => void; gesture?: PandaEvent; dayClip?: PandaGesture | null }) {
  return (
    <section className="card tk-coachline" aria-label="Satz vom Coach">
      <PandaPortrait gesture={gesture} dayClip={dayClip} />
      <div className="tk-pandahead">
        <span className="tk-pandaname">Panda</span>
        <span className="tk-pandarole">Dein Coach</span>
      </div>
      <p className="tk-coachtext">{text}</p>
      {onAsk && <button type="button" className="tk-coachask" onClick={onAsk}>Panda fragen</button>}
    </section>
  );
}
