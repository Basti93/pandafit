// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { WeekPath } from '../../src/tracking/ui/kit';
import type { PathDay, PathState } from '../../src/tracking/ui/week-path';

afterEach(cleanup);

const mk = (date: string, short: string, state: PathState, done = state === 'done'): PathDay => ({ date, short, state, done });
const DAYS: PathDay[] = [
  mk('2026-11-02', 'Mo', 'done'), mk('2026-11-03', 'Di', 'rest'), mk('2026-11-04', 'Mi', 'done'), mk('2026-11-05', 'Do', 'today'),
  mk('2026-11-06', 'Fr', 'planned'), mk('2026-11-07', 'Sa', 'rest'), mk('2026-11-08', 'So', 'planned'),
];

describe('WeekPath', () => {
  it('is a list "Wochenweg" with one named button per day and state', () => {
    render(<WeekPath days={DAYS} kicker="Diese Woche" />);
    const list = screen.getByRole('list', { name: 'Wochenweg' });
    expect(within(list).getAllByRole('button')).toHaveLength(7);
    for (const n of ['Mittwoch, erledigt', 'Donnerstag, heute', 'Freitag, geplant', 'Samstag, Ruhetag']) expect(within(list).getByRole('button', { name: n })).toBeTruthy();
    expect(screen.getByText('Diese Woche')).toBeTruthy();
  });
  it('names a done today', () => {
    render(<WeekPath days={DAYS.map((d) => (d.state === 'today' ? { ...d, done: true } : d))} kicker="k" />);
    expect(screen.getByRole('button', { name: 'Donnerstag, heute, erledigt' })).toBeTruthy();
  });
  it('tells the picked date, and does not crash without onPick', () => {
    const onPick = vi.fn();
    const { unmount } = render(<WeekPath days={DAYS} kicker="k" onPick={onPick} />);
    fireEvent.click(screen.getByRole('button', { name: 'Donnerstag, heute' }));
    expect(onPick).toHaveBeenCalledWith('2026-11-05');
    unmount();
    render(<WeekPath days={DAYS} kicker="k" />);
    fireEvent.click(screen.getByRole('button', { name: 'Freitag, geplant' }));
  });
  it('shows the count only when given', () => {
    const { rerender } = render(<WeekPath days={DAYS} kicker="k" count="2 von 5 geschafft" />);
    expect(screen.getByText('2 von 5 geschafft')).toBeTruthy();
    rerender(<WeekPath days={DAYS} kicker="k" count={null} />);
    expect(screen.queryByText(/geschafft/)).toBeNull();
  });
});
