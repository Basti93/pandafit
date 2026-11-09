/** The one note for a list that could not be read: the sentence says what, the button reads again. */
export function ReadFailed({ text, retry }: { text: string; retry: () => void }) {
  return <p role="status" className="tk-note">{text} <button type="button" onClick={retry}>Nochmal versuchen</button></p>;
}
