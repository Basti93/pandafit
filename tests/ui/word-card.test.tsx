// @vitest-environment jsdom
import { act, cleanup, render, screen } from '@testing-library/react';
import { WordCard } from '../../src/ui/views/WordCard';
import type { CoachState } from '../../src/coach/state';

const coachState = { profileId: 'A', wordProgress: {} } as unknown as CoachState;

beforeEach(() => {
  vi.useFakeTimers();
  Object.defineProperty(window, 'speechSynthesis', { value: { cancel: vi.fn(), speak: vi.fn() }, configurable: true });
  vi.stubGlobal('SpeechSynthesisUtterance', class { constructor(public text: string) {} });
});
afterEach(() => { cleanup(); vi.useRealTimers(); vi.unstubAllGlobals(); });

test('before the reveal the card says that the answer comes soon', () => {
  render(<WordCard calm state={coachState} send={vi.fn()} click={null} />);
  expect(screen.getByText('Gleich kannst du antworten.')).toBeTruthy();
});
test('after the reveal with a clicker the card explains plus and minus', () => {
  render(<WordCard calm state={coachState} send={vi.fn()} click={null} clicker />);
  act(() => { vi.advanceTimersByTime(6000); });
  expect(screen.getByText('Mit Plus sagst du „Wusste ich“, mit Minus „Nochmal“.')).toBeTruthy();
});
test('without a clicker there is no plus and minus hint', () => {
  render(<WordCard calm state={coachState} send={vi.fn()} click={null} />);
  act(() => { vi.advanceTimersByTime(6000); });
  expect(screen.queryByText(/Mit Plus/)).toBeNull();
});
