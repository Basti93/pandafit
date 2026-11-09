// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import type { RideDebrief } from '../../src/coach/debrief';
import type { CoachState } from '../../src/coach/state';
import { coachScreen, DebriefCard, DebriefView } from '../../src/ui/views/DebriefCard';
import { FeedbackView } from '../../src/ui/views/FeedbackView';

afterEach(cleanup);
const debrief: RideDebrief = { rideId: 'r1', source: 'claude', atMs: 1, attempts: 1, summary: 'Ruhig gefahren.', tips: ['Weiter so.'], motivation: 'Gut gemacht.', questions: ['Wie ging es den Knien?'] };
const next = { session: { name: 'Locker' }, reason: 'Passt gerade.' } as CoachState['next'];

test('shows every part of the debrief', () => {
  render(<DebriefCard debrief={debrief} next={next} thinking={false} />);
  for (const text of ['So lief es', 'Ruhig gefahren.', 'Tipps', 'Weiter so.', 'Gut gemacht.', 'Ausblick', 'Locker', 'Passt gerade.']) expect(screen.getByText(new RegExp(text))).toBeTruthy();
});
test('hides empty parts', () => {
  render(<DebriefCard debrief={{ ...debrief, summary: '', tips: [], motivation: '' }} thinking={false} />);
  for (const text of ['So lief es', 'Tipps', 'Ausblick']) expect(screen.queryByText(text)).toBeNull();
});
test('says the coach is still writing while the rule version shows', () => {
  render(<DebriefCard debrief={{ ...debrief, source: 'rules' }} thinking />);
  expect(screen.getByRole('status').textContent).toContain('Bo schreibt noch');
});
test('does not say so once the AI version is there', () => {
  render(<DebriefCard debrief={debrief} thinking />);
  expect(screen.queryByRole('status')).toBeNull();
});
test('a question can be answered', () => {
  const onAnswer = vi.fn();
  render(<DebriefCard debrief={debrief} thinking={false} onAnswer={onAnswer} onSkip={vi.fn()} />);
  fireEvent.change(screen.getByLabelText('Wie ging es den Knien?'), { target: { value: ' Gut ' } });
  fireEvent.click(screen.getByRole('button', { name: 'Antworten' }));
  expect(onAnswer).toHaveBeenCalledWith('Wie ging es den Knien?', 'Gut');
});
test('an empty answer is not sent', () => {
  const onAnswer = vi.fn();
  render(<DebriefCard debrief={debrief} thinking={false} onAnswer={onAnswer} onSkip={vi.fn()} />);
  fireEvent.click(screen.getByRole('button', { name: 'Antworten' }));
  expect(onAnswer).not.toHaveBeenCalled();
});
test('a question can be skipped', () => {
  const onSkip = vi.fn();
  render(<DebriefCard debrief={debrief} thinking={false} onAnswer={vi.fn()} onSkip={onSkip} />);
  fireEvent.click(screen.getByRole('button', { name: 'Überspringen' }));
  expect(onSkip).toHaveBeenCalledWith('Wie ging es den Knien?');
});
test('the history shows no questions', () => {
  render(<DebriefCard debrief={debrief} thinking={false} />);
  expect(screen.queryByText('Wie ging es den Knien?')).toBeNull();
});
test('the feedback screen shows the debrief above the rating, and the rating works without one', () => {
  const send = vi.fn();
  const { rerender } = render(<FeedbackView profileId="p" rideId="r1" send={send} detail={null} debrief={debrief} />);
  const card = screen.getByTestId('debrief');
  const heading = screen.getByRole('heading', { name: /Wie war/ });
  expect(card.compareDocumentPosition(heading) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  rerender(<FeedbackView profileId="p" rideId="r1" send={send} detail={null} />);
  expect(screen.queryByTestId('debrief')).toBeNull();
  fireEvent.click(screen.getByRole('button', { name: /Genau richtig/ }));
  expect(send).toHaveBeenCalledWith({ type: 'feedback', profileId: 'p', rideId: 'r1', rating: 'right' });
});
test('answers on the feedback screen reach the coach', () => {
  const send = vi.fn();
  render(<FeedbackView profileId="p" rideId="r1" send={send} detail={null} debrief={debrief} />);
  fireEvent.click(screen.getAllByRole('button', { name: 'Überspringen' })[0]);
  expect(send).toHaveBeenCalledWith({ type: 'debrief-skip-question', profileId: 'p', rideId: 'r1', question: 'Wie ging es den Knien?' });
});
test('the debrief page goes on with Weiter', () => {
  const send = vi.fn();
  render(<DebriefView profileId="p" debrief={debrief} send={send} thinking={false} />);
  fireEvent.click(screen.getByRole('button', { name: 'Weiter' }));
  expect(send).toHaveBeenCalledWith({ type: 'debrief-seen', profileId: 'p' });
});
test('the rating comes first, then an open debrief, then the coach', () => {
  const s = (over: Partial<CoachState>) => ({ awaitingFeedback: null, debriefToShow: null, debriefs: { r1: debrief }, ...over }) as CoachState;
  expect(coachScreen(s({ awaitingFeedback: 'r1', debriefToShow: 'r1' }))).toBe('feedback');
  expect(coachScreen(s({ debriefToShow: 'r1' }))).toBe('debrief');
  expect(coachScreen(s({}))).toBe('coach');
  expect(coachScreen(s({ debriefToShow: 'weg' }))).toBe('coach');
  expect(coachScreen(null)).toBe('coach');
});
