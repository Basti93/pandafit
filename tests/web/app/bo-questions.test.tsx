// @vitest-environment jsdom
import 'fake-indexeddb/auto';
import { act, cleanup, fireEvent, screen, waitFor, within } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { localDayKey } from '../../../src/shared/dates';
import { mondayOf, weekDates } from '../../../src/shared/week-plan';
import type { TrackedRecord } from '../../../src/shared/records';
import type { LiveSocket } from '../../../src/web/live';
import { boot, NOW, plan } from './helpers';

afterEach(cleanup);

const QUESTION = 'Wie fühlt sich dein Knie an?';
const today = localDayKey(NOW);
const weekplan: TrackedRecord = {
  kind: 'weekplan', id: mondayOf(today), updatedMs: NOW, deleted: false,
  body: { weekStart: mondayOf(today), fromMessage: 'c', acceptedMs: NOW, days: weekDates(mondayOf(today)).map((date) => ({ date, sport: date === today ? 'gym' : 'rest', hardness: 'moderate', fixed: false })) },
};
const withQuestion = (): TrackedRecord => { const p = plan(NOW - 1000); return { ...p, body: { ...(p.body as object), questions: [QUESTION] } }; };

/** Sockets that answer like a coach: open, then a coach-state. Every frame sent is kept. */
const coachSockets = () => {
  const sent: Record<string, unknown>[] = [];
  const openLive = (): LiveSocket => {
    const s: LiveSocket = { send: (d: string) => { sent.push(JSON.parse(d) as Record<string, unknown>); }, close: () => {}, onopen: null, onmessage: null, onclose: null, onerror: null };
    setTimeout(() => { s.onopen?.(); s.onmessage?.({ data: JSON.stringify({ type: 'coach-state', state: {}, hevy: { state: 'idle' }, garmin: { state: 'idle' }, gym: {}, meals: null }) }); }, 0);
    return s;
  };
  return { sent, openLive };
};
const gymFrames = (sent: Record<string, unknown>[]) => sent.filter((m) => String(m.type).startsWith('gym-'));

describe('Bo\'s questions on Heute', () => {
  it('answering a question in the chat sends gym-answer and the question leaves Heute', async () => {
    const { sent, openLive } = coachSockets();
    await boot({ account: 'anna', seed: [weekplan, withQuestion()], openLive });
    fireEvent.click(await screen.findByRole('button', { name: QUESTION }));
    const chat = await screen.findByRole('dialog');
    expect(within(chat).getByText(QUESTION)).toBeTruthy();
    fireEvent.change(within(chat).getByLabelText('Nachricht an Bo'), { target: { value: 'Gut, kaum Schmerzen.' } });
    await act(async () => { fireEvent.click(within(chat).getByRole('button', { name: 'Senden' })); });
    await waitFor(() => expect(gymFrames(sent)).toEqual([{ type: 'gym-answer', question: QUESTION, text: 'Gut, kaum Schmerzen.', profileId: 'pa' }]));
    fireEvent.keyDown(chat, { key: 'Escape' });
    await waitFor(() => expect(screen.queryByRole('button', { name: QUESTION })).toBeNull());
  });

  it('Überspringen sends gym-skip-question and the question leaves Heute', async () => {
    const { sent, openLive } = coachSockets();
    await boot({ account: 'anna', seed: [weekplan, withQuestion()], openLive });
    await screen.findByRole('button', { name: QUESTION });
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: `Überspringen: ${QUESTION}` })); });
    await waitFor(() => expect(gymFrames(sent)).toEqual([{ type: 'gym-skip-question', question: QUESTION, profileId: 'pa' }]));
    await waitFor(() => expect(screen.queryByRole('button', { name: QUESTION })).toBeNull());
  });
});
