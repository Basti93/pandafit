import { useState } from 'react';
import type { RideDebrief } from '../../coach/debrief';
import type { CoachState } from '../../coach/state';
import type { CoachClientMessage } from '../../shared/coach-protocol';
import { PandaMark } from './PandaMark';

export const coachScreen = (s: CoachState | null): 'feedback' | 'debrief' | 'coach' => {
  if (s?.awaitingFeedback) return 'feedback';
  return s?.debriefToShow && s.debriefs?.[s.debriefToShow] ? 'debrief' : 'coach';
};

const Question = ({ question, onAnswer, onSkip }: { question: string; onAnswer: (q: string, text: string) => void; onSkip: (q: string) => void }) => {
  const [text, setText] = useState('');
  return (
    <form className="form debrief-question" onSubmit={(e) => { e.preventDefault(); if (text.trim()) onAnswer(question, text.trim()); }}>
      <label>{question}<input value={text} onChange={(e) => setText(e.target.value)} /></label>
      <div className="debrief-actions">
        <button type="submit">Antworten</button>
        <button type="button" className="ghost" onClick={() => onSkip(question)}>Überspringen</button>
      </div>
    </form>
  );
};

type CardProps = { debrief: RideDebrief; thinking: boolean; next?: CoachState['next']; onAnswer?: (question: string, text: string) => void; onSkip?: (question: string) => void };

/** The coach's words on a ride. Without the AI the rule version stands here, nothing waits for it. */
export const DebriefCard = ({ debrief, thinking, next, onAnswer, onSkip }: CardProps) => (
  <section className="encouragement debrief" data-testid="debrief">
    <span className="encouragement-from">Dein Coach</span>
    {thinking && debrief.source === 'rules' && <p className="muted" role="status">Dein Coach schreibt noch …</p>}
    {debrief.motivation && <p className="motivation-words">{debrief.motivation}</p>}
    {debrief.summary && <><h3>So lief es</h3><p>{debrief.summary}</p></>}
    {debrief.tips.length > 0 && <><h3>Tipps</h3><ul>{debrief.tips.map((t) => <li key={t}>{t}</li>)}</ul></>}
    {next && <><h3>Ausblick</h3><p><b>{next.session.name}</b>{next.reason ? `: ${next.reason}` : ''}</p></>}
    {onAnswer && onSkip && debrief.questions.map((q) => <Question key={q} question={q} onAnswer={onAnswer} onSkip={onSkip} />)}
  </section>
);

type Send = (m: CoachClientMessage) => void;
export const debriefHandlers = (profileId: string, rideId: string, send: Send) => ({
  onAnswer: (question: string, text: string) => send({ type: 'debrief-answer', profileId, rideId, question, text }),
  onSkip: (question: string) => send({ type: 'debrief-skip-question', profileId, rideId, question }),
});

/** For a ride that was already rated before its debrief existed. */
export const DebriefView = ({ profileId, debrief, next, thinking, title, send }: { profileId: string; debrief: RideDebrief; next?: CoachState['next']; thinking: boolean; title?: string; send: Send }) => (
  <main>
    <PandaMark small />
    <h1>{title ?? 'Deine Fahrt'}</h1>
    <DebriefCard debrief={debrief} next={next} thinking={thinking} {...debriefHandlers(profileId, debrief.rideId, send)} />
    <button onClick={() => send({ type: 'debrief-seen', profileId })}>Weiter</button>
  </main>
);
