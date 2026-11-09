import { useEffect, useRef, useState } from 'react';
import type { CoachState } from '../../coach/state';
import type { CoachClientMessage } from '../../coach/protocol';
import { DUTCH_WORDS, nextWord, type Word } from '../../shared/language';

const ASK_MS = 6000;
const ANSWER_MS = 15000;
const GAP_MS = 20000;
type Phase = 'ask' | 'reveal' | 'gap';

const speak = (text: string): void => {
  try {
    window.speechSynthesis.cancel();
    const u = new SpeechSynthesisUtterance(text);
    u.lang = 'nl-NL';
    window.speechSynthesis.speak(u);
  } catch { /* Without a voice the card stays readable. */ }
};

/** Vocabulary in calm phases: hear Dutch, see German, answer by click or the J/N key. */
export const WordCard = ({ calm, state, send, click }: { calm: boolean; state: CoachState; send: (m: CoachClientMessage) => void; click: { dir: 'up' | 'down'; n: number } | null }) => {
  const [phase, setPhase] = useState<Phase>('ask');
  const [word, setWord] = useState<Word | null>(() => nextWord(DUTCH_WORDS, state.wordProgress ?? {}, Date.now()));
  const [sound, setSound] = useState(true);
  const [hidden, setHidden] = useState(false);
  const seenClick = useRef(click?.n ?? 0);
  const last = useRef<string | undefined>(undefined);

  const finish = () => {
    last.current = word?.nl ?? last.current;
    setPhase('gap');
  };
  // Recall first, then reveal: the thinking is the part that makes learning work.
  const answer = (knew: boolean) => {
    if (!calm || phase !== 'reveal' || !word) return;
    send({ type: 'word-result', profileId: state.profileId, nl: word.nl, knew });
    finish();
  };

  useEffect(() => {
    if (hidden || !calm) {
      window.speechSynthesis?.cancel();
      return undefined;
    }
    if (phase === 'ask' && word && sound) speak(word.nl);
    if (phase === 'reveal' && word && sound) speak(word.example);
    const after = phase === 'ask' ? ASK_MS : phase === 'reveal' ? ANSWER_MS : GAP_MS;
    const timer = setTimeout(() => {
      if (phase === 'ask') setPhase('reveal');
      else if (phase === 'reveal') finish();
      else {
        setWord(nextWord(DUTCH_WORDS, state.wordProgress ?? {}, Date.now(), last.current));
        setPhase('ask');
      }
    }, after);
    return () => clearTimeout(timer);
    // The sequence depends only on phase and word, new coach states should not restart it.
  }, [phase, word, hidden, sound, calm]);

  // When switching off, no word in progress may keep running.
  useEffect(() => () => window.speechSynthesis?.cancel(), []);
  useEffect(() => {
    if (click && click.n !== seenClick.current) {
      seenClick.current = click.n;
      answer(click.dir === 'up');
    }
  }, [click]);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'j') answer(true);
      if (e.key === 'n') answer(false);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  });

  if (!calm || hidden || !word || phase === 'gap') return null;
  return (
    <aside className="word" aria-live="polite">
      <div className="word-text">
        <b lang="nl">{word.nl}</b>
        <span className={phase === 'reveal' ? 'word-de' : 'word-de covered'}>{phase === 'reveal' ? word.de : 'Was heißt das?'}</span>
        {phase === 'reveal' && <span className="word-example"><span lang="nl">{word.example}</span> <span className="muted">{word.exampleDe}</span></span>}
      </div>
      {phase === 'reveal' && (
        <div className="row">
          <button onClick={() => answer(true)}>Wusste ich</button>
          <button className="secondary" onClick={() => answer(false)}>Nochmal</button>
        </div>
      )}
      <div className="word-tools">
        <button className="ghost" onClick={() => setSound(!sound)}>{sound ? 'Ton aus' : 'Ton an'}</button>
        <button className="ghost" onClick={() => setHidden(true)}>Ausblenden</button>
      </div>
    </aside>
  );
};
