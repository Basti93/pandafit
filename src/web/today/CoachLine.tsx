/** The sentence of the coach for the day: a card with the coach mark, no heading, no buttons. */
export function CoachLine({ text }: { text: string }) {
  return (
    <section className="card tk-coachline" aria-label="Satz vom Coach">
      <span className="tk-coachmark" aria-hidden="true">C</span>
      <p>{text}</p>
    </section>
  );
}
