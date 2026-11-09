// @vitest-environment jsdom
import { cleanup, render, screen, within } from '@testing-library/react';
import { Week } from '../../src/tracking/ui/WeekList';

afterEach(cleanup);

test('Week shows what was done with a tick and a quiet Ruhetag', () => {
  render(<Week label="Woche" today="2026-11-04" rows={[
    { date: '2026-11-02', done: ['Lauf 6 km'], kinds: ['lauf'], plan: null, rest: false },
    { date: '2026-11-03', done: [], kinds: [], plan: null, rest: true },
  ]} />);
  const [mo, di] = within(screen.getByRole('list', { name: 'Woche' })).getAllByRole('listitem');
  expect(mo!.textContent).toBe('Montag✓ Lauf 6 km');
  expect(di!.textContent).toBe('DienstagRuhetag');
  expect(within(di!).getByText('Ruhetag').className).toContain('muted');
});
