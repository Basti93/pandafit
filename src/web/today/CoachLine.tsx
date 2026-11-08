/** Panda on Heute: the still picture, the name, the coach sentence of the day and, on today, one button that opens the real coach chat. */
export function CoachLine({ text, onAsk }: { text: string; onAsk?: () => void }) {
  return (
    <section className="card tk-coachline" aria-label="Satz vom Coach">
      <img className="tk-pandastill" src="/brand/panda-still.svg" alt="" aria-hidden="true" width="72" height="75" />
      <div className="tk-pandahead">
        <span className="tk-pandaname">Panda</span>
        <span className="tk-pandarole">Dein Coach</span>
      </div>
      <p className="tk-coachtext">{text}</p>
      {onAsk && <button type="button" className="tk-coachask" onClick={onAsk}>Panda fragen</button>}
    </section>
  );
}
