// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import type { LoggedWorkout, TrackedRecord } from '../../src/shared/records';
import { STATS_ID, type Sport, type StatsBody, type StatsDay } from '../../src/shared/stats';
import { LookBack } from '../../src/tracking/ui/StatsScreen';
import { dateLabel } from '../../src/tracking/ui/labels';
import { fakePort } from './fake-port';

afterEach(cleanup);

// Wednesday 4 November 2026, 10:00 local time; the current week starts Monday 2 November.
const NOW = new Date(2026, 10, 4, 10).getTime();
const now = () => NOW;
const zero = (): Record<Sport, number> => ({ bike: 0, strength: 0, run: 0, mobility: 0, other: 0 });
const day = (date: string, minutes: Partial<Record<Sport, number>>, hardness: StatsDay['hardness'] = null): StatsDay => ({ date, minutes: { ...zero(), ...minutes }, hardness, legs: false });
const statsBody = (days: StatsDay[], over: Partial<StatsBody> = {}): StatsBody => ({ type: 'stats', atMs: NOW - 3_600_000, goal: 'muscle', days, muscles: {}, ...over });
const statsRec = (body: StatsBody): TrackedRecord => ({ kind: 'stats', id: STATS_ID, updatedMs: 1, deleted: false, body });
const set = () => ({ type: 'normal' as const, weightKg: 50, reps: 8, durationS: null, doneMs: 1 });
const workout = (id: string, startMs: number, exerciseId: string, title: string, n: number): TrackedRecord => {
  const body: LoggedWorkout = { id, title: 'Training', startMs, endMs: startMs + 3_600_000, source: 'pandafit', exercises: [{ exerciseId, title, supersetId: null, notes: '', sets: Array.from({ length: n }, set) }] };
  return { kind: 'workout', id, updatedMs: 1, deleted: false, body };
};

const days = [
  day('2026-10-20', { bike: 60 }, 'hard'),
  day('2026-10-27', { bike: 45, strength: 50 }, 'moderate'),
  day('2026-11-02', { bike: 30 }, 'hard'),
  day('2026-11-03', { strength: 40 }),
];
const workouts = [
  workout('w1', new Date(2026, 10, 3, 18).getTime(), 'pf-bench-press', 'Bankdrücken', 3),
  workout('w2', new Date(2026, 9, 27, 18).getTime(), 'hevy-odd', 'Seltsame Maschine', 2),
];
const openMuscles = () => { fireEvent.click(screen.getByRole('button', { name: 'Muskeln' })); return screen.getByRole('dialog', { name: 'Muskeln' }); };
const BAD = /Serie|Streak|Punkte|musst/;

async function show(seed: TrackedRecord[]) {
  const { port } = fakePort(seed);
  const r = render(<LookBack port={port} now={now} onHistory={() => {}} />);
  await screen.findByRole('button', { name: 'Zeit pro Woche' });
  return r;
}
const openDetails = () => { fireEvent.click(screen.getByRole('button', { name: 'Zeit pro Woche' })); return screen.getByRole('dialog', { name: 'Zeit pro Woche' }); };

test('Rückblick is the verdicts and rows; the week sentence, muscles and numbers wait behind them', async () => {
  const { container } = await show([statsRec(statsBody(days)), ...workouts]);
  expect(screen.getByRole('heading', { name: 'Rückblick' })).toBeTruthy();
  expect(screen.getByRole('button', { name: 'Verlauf' })).toBeTruthy();
  expect(screen.getByRole('button', { name: 'Muskeln' })).toBeTruthy();
  expect(screen.queryByText(/^Diese Woche: /)).toBeNull();
  const sheet = openDetails();
  expect(within(sheet).getByText(`Stand: ${dateLabel(NOW - 3_600_000)}`)).toBeTruthy();
  expect(within(sheet).getByText('Diese Woche: 2 Einheiten, 1 Std 10 Min')).toBeTruthy();
  fireEvent.click(within(sheet).getByRole('button', { name: 'Schließen' }));
  expect(screen.queryByRole('button', { name: /Brust/ })).toBeNull();
  expect(container.textContent).not.toMatch(/Wenig|Noch nichts|Locker|Ruhetage|\d+ Minuten|Zielbereich/);
  expect(screen.queryByRole('region', { name: 'Letzte 8 Wochen' })).toBeNull();
  expect(screen.queryByRole('table')).toBeNull();
  expect(screen.queryByText(/Ohne bekannten Muskel/)).toBeNull();
  expect(container.textContent).not.toMatch(BAD);
});

test('Zeit pro Woche opens the chart with bars and dates only, the sport minutes and the unknown list', async () => {
  await show([statsRec(statsBody(days)), ...workouts]);
  const sheet = openDetails();
  const last = within(sheet).getByRole('region', { name: 'Letzte 8 Wochen' });
  expect(within(last).getByRole('img', { name: 'Woche vom 26.10.: 1 Std 35 Min' })).toBeTruthy();
  expect(within(last).getByRole('img', { name: 'Woche vom 19.10.: 1 Std' })).toBeTruthy();
  expect(last.textContent).toContain('26.10.');
  expect(last.textContent).not.toMatch(/Die Zahl über dem Balken|Locker|Hart/);
  expect(within(last).queryByText('95')).toBeNull();
  expect(within(sheet).getByText('30 Min')).toBeTruthy();
  expect(within(sheet).getByText('40 Min')).toBeTruthy();
  expect(sheet.textContent).not.toMatch(/Minuten| : /);
  expect(within(sheet).queryByRole('table')).toBeNull();
  expect(within(sheet).getByText('Ohne bekannten Muskel: Seltsame Maschine')).toBeTruthy();
  fireEvent.click(within(sheet).getByRole('button', { name: 'Schließen' }));
  expect(screen.queryByRole('dialog')).toBeNull();
});

test('without a stats record: the note, and still the muscle part', async () => {
  const { container } = await show(workouts);
  const time = openDetails();
  expect(within(time).getByText('Minuten und harte Tage erscheinen nach dem nächsten Lauf des Coaches.')).toBeTruthy();
  expect(within(time).queryByText(/^Stand:/)).toBeNull();
  fireEvent.click(within(time).getByRole('button', { name: 'Schließen' }));
  const muscles = openMuscles();
  expect(within(muscles).getByText('Brust')).toBeTruthy();
  expect(within(within(muscles).getByRole('button', { name: /Brust/ })).getByText('Wenig')).toBeTruthy();
  expect(container.textContent).not.toMatch(BAD);
});

test('a bike-only profile sees no muscle part at all', async () => {
  const { container } = await show([statsRec(statsBody([day('2026-10-27', { bike: 60 }), day('2026-11-02', { bike: 40 })], { goal: null }))]);
  expect(container.textContent).not.toMatch(/Sätze|Brust|Rücken|Ohne bekannten Muskel/);
  const sheet = openDetails();
  expect(within(sheet).getByText('Diese Woche: 1 Einheit, 40 Min')).toBeTruthy();
  expect(within(sheet).getByText('40 Min')).toBeTruthy();
  expect(sheet.textContent).not.toMatch(/Sätze|Brust|Rücken/);
  expect(screen.queryByRole('button', { name: 'Muskeln' })).toBeNull();
  expect(container.textContent).not.toMatch(BAD);
});

test('without anything to look back on, Rückblick is only the Verlauf row', async () => {
  const open = { ...workouts[0], body: { ...(workouts[0].body as LoggedWorkout), endMs: null } };
  const { port } = fakePort([{ ...statsRec(statsBody([])), body: { type: 'nope' } }, open]);
  const onHistory = vi.fn();
  render(<LookBack port={port} now={now} latest="Kraft Pull" onHistory={onHistory} />);
  await screen.findByRole('heading', { name: 'Rückblick' });
  await new Promise((r) => setTimeout(r, 20));
  const rows = within(screen.getByRole('list', { name: 'Rückblick' })).getAllByRole('button');
  expect(rows.map((b) => b.textContent)).toEqual(['VerlaufKraft Pull›']);
  fireEvent.click(rows[0]!);
  expect(onHistory).toHaveBeenCalledTimes(1);
});

test('pairs are not listed as numbers; a short side is one plain sentence at the top', async () => {
  await show([workout('w3', new Date(2026, 9, 21, 18).getTime(), 'pf-bench-press', 'Bankdrücken', 12)]);
  const week = screen.getByRole('region', { name: 'Rückblick' });
  expect(week.textContent).toMatch(/Rücken kommt zu kurz/);
  const sheet = openDetails();
  expect(sheet.textContent).not.toMatch(/ : |Verhältnis/);
});

test('broken workout bodies next to a good one do not break the page', async () => {
  const good = workouts[0];
  const broken: TrackedRecord[] = [
    { ...good, id: 'b1', body: null },
    { ...good, id: 'b2', body: { ...(good.body as LoggedWorkout), exercises: 'x' } },
    { ...good, id: 'b3', body: { ...(good.body as LoggedWorkout), startMs: null } },
    { ...good, id: 'b4', body: { ...(good.body as LoggedWorkout), exercises: [{ exerciseId: 'pf-bench-press', title: 'Bankdrücken', sets: null }] } },
  ];
  await show([...broken, good]);
  const muscles = openMuscles();
  expect(within(within(muscles).getByRole('button', { name: /Brust/ })).getByText('Wenig')).toBeTruthy();
});

test('a failed first read shows a calm message with a retry', async () => {
  const { port, state } = fakePort([statsRec(statsBody(days)), ...workouts]);
  state.failList = true;
  render(<LookBack port={port} now={now} onHistory={() => {}} />);
  expect((await screen.findByRole('status')).textContent).toMatch(/nicht gelesen/);
  state.failList = false;
  fireEvent.click(screen.getByRole('button', { name: 'Nochmal versuchen' }));
  expect(await screen.findByRole('button', { name: 'Zeit pro Woche' })).toBeTruthy();
});

test('Fortschritt shows one line per area with data and nothing for the rest', async () => {
  const at = Date.UTC(2026, 10, 4, 12);
  const body = { type: 'stats', atMs: at, goal: null, days: [], muscles: {}, ftp: [{ atMs: at - 70 * 86_400_000, ftpW: 200 }, { atMs: at - 86_400_000, ftpW: 210 }], weightKg: 70 };
  const { port } = fakePort([{ kind: 'stats', id: 'stats', updatedMs: 1, deleted: false, body }]);
  render(<LookBack port={port} now={() => at} onHistory={() => {}} />);
  await screen.findByRole('button', { name: 'Zeit pro Woche' });
  const card = within(openDetails()).getByRole('region', { name: 'Fortschritt' });
  expect(card.textContent).toContain('Rad: FTP 210 W (3,0 W/kg), 10 W mehr als vor 10 Wochen');
  expect(card.querySelectorAll('li')).toHaveLength(1);
});

test('rows exist for trained groups in the Muskeln sheet; the rest waits behind a link, no list of "Noch nichts" on top', async () => {
  await show([statsRec(statsBody(days)), ...workouts]);
  const sheet = openMuscles();
  expect(within(within(sheet).getByRole('button', { name: /Brust/ })).getByText('Wenig')).toBeTruthy();
  expect(within(sheet).queryByRole('button', { name: /Rücken/ })).toBeNull();
  expect(within(sheet).queryByText(/^Noch nichts: /)).toBeNull();
  fireEvent.click(within(sheet).getByRole('button', { name: 'Alle Muskelgruppen anzeigen' }));
  expect(within(within(sheet).getByRole('button', { name: /Rücken/ })).getByText('Noch nichts')).toBeTruthy();
});

test('a new person with no sets in the last 4 weeks is not flooded with "Noch nichts"', async () => {
  await show([workout('old', new Date(2026, 8, 1, 18).getTime(), 'pf-bench-press', 'Bankdrücken', 3)]);
  const sheet = openMuscles();
  expect(within(sheet).queryByText('Noch nichts')).toBeNull();
  expect(within(sheet).getByText('Diese Woche noch keine Sätze.')).toBeTruthy();
  expect(within(sheet).queryByRole('button', { name: /Rücken/ })).toBeNull();
  fireEvent.click(within(sheet).getByRole('button', { name: 'Alle Muskelgruppen anzeigen' }));
  expect(within(sheet).getByRole('button', { name: /Rücken/ })).toBeTruthy();
  fireEvent.click(within(sheet).getByRole('button', { name: 'Weniger Muskelgruppen' }));
  expect(within(sheet).queryByRole('button', { name: /Rücken/ })).toBeNull();
});

test('tapping a row shows the sets against the target in words; only one row is open', async () => {
  await show([statsRec(statsBody(days)), ...workouts]);
  const week = openMuscles();
  const row = within(week).getByRole('button', { name: /Brust/ });
  expect(row.getAttribute('aria-expanded')).toBe('false');
  expect(week.textContent).not.toMatch(/Sätzen|direkt/);
  fireEvent.click(row);
  expect(row.getAttribute('aria-expanded')).toBe('true');
  expect(week.textContent).toContain('3 von 12–18 Sätzen diese Woche');
  fireEvent.click(within(week).getByRole('button', { name: /Trizeps/ }));
  expect(row.getAttribute('aria-expanded')).toBe('false');
  expect(week.textContent).toContain('1,5 von');
  expect(week.textContent).not.toContain('3 von 12–18');
  fireEvent.click(within(week).getByRole('button', { name: /Trizeps/ }));
  expect(week.textContent).not.toMatch(/Sätzen diese Woche/);
});

test('the pair verdict names the short group without the numbers', async () => {
  await show([workout('w11', new Date(2026, 9, 21, 18).getTime(), 'pf-bench-press', 'Bankdrücken', 12)]);
  const week = screen.getByRole('region', { name: 'Rückblick' });
  expect(week.textContent).toMatch(/kommt zu kurz/);
  expect(week.textContent).not.toMatch(/\d+ Sätze, /);
});

test('Fortschritt is in Zeit pro Woche, not on the page', async () => {
  const body = { ...statsBody(days), ftp: [{ atMs: NOW - 86_400_000, ftpW: 210 }], weightKg: 70 };
  const { port } = fakePort([statsRec(body), ...workouts]);
  render(<LookBack port={port} now={now} onHistory={() => {}} />);
  await screen.findByRole('button', { name: 'Zeit pro Woche' });
  expect(screen.queryByRole('region', { name: 'Fortschritt' })).toBeNull();
  expect(within(openDetails()).getByRole('region', { name: 'Fortschritt' })).toBeTruthy();
});
