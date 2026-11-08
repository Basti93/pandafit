// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { goalRecord, ruleRecord } from '../../src/shared/personal';
import type { TrackedRecord } from '../../src/shared/records';
import { CoachScreen } from '../../src/tracking/ui/CoachScreen';
import { fakePort } from '../tracking/fake-port';

afterEach(cleanup);
const NOW = new Date(2026, 10, 4, 18).getTime();
let n = 0;
const env = { now: () => NOW, newId: () => `id${++n}` };
const body = (map: Map<string, TrackedRecord>, key: string) => map.get(key)!.body as Record<string, unknown>;
const seed = (): TrackedRecord[] => [
  ruleRecord('rule-a', { kind: 'wish', text: 'Lieber kurze Pausen', sport: 'gym' }, 'active', 'person', 1000),
  ruleRecord('rule-b', { kind: 'exclude', text: 'Ohne Übung X', sport: 'gym', exerciseIds: ['pf-squat'] }, 'paused', 'person', 2000),
  ruleRecord('rule-c', { kind: 'wish', text: 'Vorgeschlagen', sport: 'bike' }, 'proposed', 'chat', 3000),
];
/** Opens the sheet behind a row of the week page ("Regeln", "Mein Ziel") and looks inside it. */
const sheet = async (row: RegExp, title: string) => {
  fireEvent.click(await screen.findByRole('button', { name: row }));
  return within(await screen.findByRole('dialog', { name: title }));
};
const rules = () => sheet(/^Was der Coach beachtet/, 'Was der Coach beachtet');
const goalSheet = () => sheet(/^Ziel und Planung/, 'Ziel und Planung');
/** A choice row opens a small sheet; picks an option in it. */
const choose = async (label: string | RegExp, option: string) => {
  fireEvent.click(screen.getByRole('button', { name: label }));
  fireEvent.click(await screen.findByRole('button', { name: option }));
};
/** "+ Hinzufügen" opens a small sheet with the two ways to add. */
const addVia = async (c: ReturnType<typeof within>, how: 'Regel schreiben' | 'Übung ausschließen') => {
  fireEvent.click(c.getByRole('button', { name: '+ Regel hinzufügen' }));
  fireEvent.click(await screen.findByRole('button', { name: how }));
};
/** The focus row opens the muscle chips. */
const openFocus = async (c: ReturnType<typeof within>) => { fireEvent.click(await c.findByRole('button', { name: /^Muskeln im Fokus/ })); };
/** A rule row opens to its actions. */
const openRule = async (c: ReturnType<typeof within>, text: RegExp) => { fireEvent.click(await c.findByRole('button', { name: text })); };

test('lists active and paused rules, not proposed ones', async () => {
  const { port } = fakePort(seed());
  render(<CoachScreen port={port} {...env} />);
  const c = await rules();
  expect(await c.findByText(/Lieber kurze Pausen/)).toBeTruthy();
  expect(c.getByText(/Ohne Übung X/)).toBeTruthy();
  expect(c.queryByText(/Vorgeschlagen/)).toBeNull();
});

test('the status word sits under the rule text, and a complaint is the first muted line', async () => {
  const complaint: TrackedRecord = { kind: 'complaint', id: 'k1', updatedMs: 1, deleted: false, body: { text: 'Linke Schulter', status: 'open' } };
  const { port } = fakePort([...seed(), complaint]);
  render(<CoachScreen port={port} {...env} />);
  const c = await rules();
  expect(await c.findByText('Linke Schulter')).toBeTruthy();
  expect(c.getByRole('button', { name: /Ohne Übung X\s*.+ · pausiert/ })).toBeTruthy();
  expect(c.getByRole('button', { name: /Lieber kurze Pausen\s*Kraft · aktiv/ })).toBeTruthy();
});

test('pause, continue and delete write the right records', async () => {
  const { port, map } = fakePort(seed());
  render(<CoachScreen port={port} {...env} />);
  const c = await rules();
  await openRule(c, /Lieber kurze Pausen/);
  fireEvent.click(await c.findByRole('button', { name: 'Pausieren Lieber kurze Pausen' }));
  await waitFor(() => expect(body(map, 'rule:rule-a').state).toBe('paused'));
  await openRule(c, /Ohne Übung X/);
  expect(c.queryByRole('button', { name: 'Pausieren Lieber kurze Pausen' })).toBeNull(); // only one row is open
  fireEvent.click(await c.findByRole('button', { name: 'Fortsetzen Ohne Übung X' }));
  await waitFor(() => expect(body(map, 'rule:rule-b').state).toBe('active'));
  await openRule(c, /Lieber kurze Pausen/);
  fireEvent.click(c.getByRole('button', { name: 'Löschen' }));
  expect(map.get('rule:rule-a')!.deleted).toBe(false); // asks first
  fireEvent.click(c.getByRole('button', { name: 'Ja' }));
  await waitFor(() => expect(map.get('rule:rule-a')!.deleted).toBe(true));
  await waitFor(() => expect(c.queryByText(/Lieber kurze Pausen/)).toBeNull());
});

test('a written wish and an excluded exercise from the picker', async () => {
  const { port, map } = fakePort();
  render(<CoachScreen port={port} {...env} />);
  const c = await rules();
  await addVia(c, 'Regel schreiben');
  fireEvent.change(c.getByLabelText('Neue Regel'), { target: { value: 'Keine Sprünge' } });
  fireEvent.click(c.getByRole('button', { name: 'Speichern' }));
  await waitFor(() => expect([...map.values()].find((r) => r.kind === 'rule' && body(map, `rule:${r.id}`).text === 'Keine Sprünge')).toBeTruthy());
  const wish = [...map.values()].find((r) => r.kind === 'rule')!;
  expect(wish.body).toMatchObject({ kind: 'wish', state: 'active', source: 'person', sport: 'all' });

  await addVia(c, 'Übung ausschließen');
  fireEvent.change(await screen.findByLabelText('Suchen'), { target: { value: 'Kniebeuge' } });
  fireEvent.click((await screen.findAllByRole('button', { name: /^Kniebeuge/ }))[0]!);
  expect(await screen.findByRole('button', { name: /^Alle Varianten \(Kniebeuge\)/ })).toBeTruthy();
  fireEvent.click(screen.getByRole('button', { name: 'Nur diese Übung' }));
  await waitFor(() => expect([...map.values()].some((r) => r.kind === 'rule' && body(map, `rule:${r.id}`).kind === 'exclude')).toBe(true));
  const ex = [...map.values()].find((r) => r.kind === 'rule' && (r.body as { kind: string }).kind === 'exclude')!;
  expect(ex.body).toMatchObject({ state: 'active', source: 'person', sport: 'gym' });
  expect((ex.body as { exerciseIds: string[] }).exerciseIds).toHaveLength(1);
});

test('an exercise can be excluded with all its variants; an exercise of the other family has no such button', async () => {
  const { port, map } = fakePort();
  render(<CoachScreen port={port} {...env} />);
  const c = await rules();
  await addVia(c, 'Übung ausschließen');
  fireEvent.change(await screen.findByLabelText('Suchen'), { target: { value: 'Kniebeuge' } });
  fireEvent.click((await screen.findAllByRole('button', { name: /^Kniebeuge/ }))[0]!);
  fireEvent.click(await screen.findByRole('button', { name: /^Alle Varianten \(Kniebeuge\)/ }));
  await waitFor(() => expect([...map.values()].some((r) => r.kind === 'rule')).toBe(true));
  const ex = [...map.values()].find((r) => r.kind === 'rule')!;
  expect(ex.body).toMatchObject({ kind: 'exclude', state: 'active', sport: 'gym', families: ['squat'] });
  expect((ex.body as { exerciseIds?: string[] }).exerciseIds).toBeUndefined();
  // The rule text already names the variants: the family is not said twice.
  expect(await c.findByText(/Ohne alle Varianten: Kniebeuge/)).toBeTruthy();
  fireEvent.click(await c.findByRole('button', { name: /Ohne alle Varianten/ }));
  expect(c.queryByText(/^Alle Varianten: Kniebeuge/)).toBeNull();

  await addVia(c, 'Übung ausschließen');
  fireEvent.change(await screen.findByLabelText('Suchen'), { target: { value: 'Laufen' } });
  fireEvent.click((await screen.findAllByRole('button', { name: /^Laufen/ }))[0]!);
  expect(await screen.findByRole('button', { name: 'Nur diese Übung' })).toBeTruthy();
  expect(screen.queryByRole('button', { name: /^Alle Varianten \(/ })).toBeNull();
});

test('the goal selects write the goal record, stamped above the stored one', async () => {
  const { port, map } = fakePort([goalRecord({ strength: 'muscle', focus: [], sports: {} }, NOW + 5000)]);
  render(<CoachScreen port={port} {...env} />);
  const c = await goalSheet();
  await choose(/^Ziel(?! und)/, 'Kraft steigern');
  await waitFor(() => expect(body(map, 'goal:goal').strength).toBe('strength'));
  expect(map.get('goal:goal')!.updatedMs).toBeGreaterThan(NOW + 5000);
  await choose(/^Rad/, 'nebenbei');
  await waitFor(() => expect(body(map, 'goal:goal').sports).toEqual({ bike: 'keep' }));
  expect(body(map, 'goal:goal').strength).toBe('strength');
});

test('at most three focus muscles', async () => {
  const { port, map } = fakePort();
  render(<CoachScreen port={port} {...env} />);
  const c = await goalSheet();
  await openFocus(c);
  expect(c.getByText('keiner')).toBeTruthy();
  for (const g of ['Brust', 'Rücken', 'Bizeps']) fireEvent.click(await c.findByRole('button', { name: g }));
  await waitFor(() => expect((body(map, 'goal:goal').focus as string[]).length).toBe(3));
  expect(c.getByText(/Brust, Rücken, Bizeps/)).toBeTruthy();
  expect((c.getByRole('button', { name: 'Trizeps' }) as HTMLButtonElement).disabled).toBe(true);
  fireEvent.click(c.getByRole('button', { name: 'Brust' }));
  await waitFor(() => expect((body(map, 'goal:goal').focus as string[]).length).toBe(2));
});

test('"für 4 Wochen" writes a temporary focus and keeps the base; the line names the end', async () => {
  const { port, map } = fakePort([goalRecord({ strength: 'muscle', focus: ['chest'], sports: {} }, NOW - 5000)]);
  render(<CoachScreen port={port} {...env} />);
  const c = await goalSheet();
  await openFocus(c);
  await choose(/^Dauer/, '4 Wochen');
  fireEvent.click(c.getByRole('button', { name: 'Rücken' }));
  await waitFor(() => expect(body(map, 'goal:goal').temporary).toEqual({ focus: ['chest', 'back'], until: '2026-12-02' }));
  expect(body(map, 'goal:goal').focus).toEqual(['chest']);
  expect(await c.findByText('Brust, Rücken bis Mi., 2. Dez.')).toBeTruthy();
});

test('an ended focus shows once with OK, then it is gone', async () => {
  const { port, map } = fakePort([goalRecord({ strength: 'muscle', focus: ['chest'], sports: {}, temporary: { focus: ['back'], until: '2026-11-01' } }, NOW - 5000)]);
  render(<CoachScreen port={port} {...env} />);
  const c = await goalSheet();
  expect(await c.findByText(/Dein Fokus auf Rücken ist am So\., 1\. Nov\. ausgelaufen\. Jetzt gilt wieder dein Grundziel\./)).toBeTruthy();
  expect(c.getByText('Brust')).toBeTruthy();
  fireEvent.click(c.getByRole('button', { name: 'OK' }));
  await waitFor(() => expect((body(map, 'goal:goal').temporary as { endedSeenMs?: number }).endedSeenMs).toBe(NOW));
  await waitFor(() => expect(c.queryByText(/ausgelaufen/)).toBeNull());
});

const activeTemp = (extra: object = {}) => goalRecord({ strength: 'muscle', focus: ['chest'], sports: { bike: 'keep' }, temporary: { focus: ['back'], until: '2026-11-20', endedSeenMs: 7, ...extra } }, NOW - 5000);

test('toggling a muscle in an active temporary focus keeps its end and endedSeenMs, and not the base', async () => {
  const { port, map } = fakePort([activeTemp()]);
  render(<CoachScreen port={port} {...env} />);
  const c = await goalSheet();
  await openFocus(c);
  fireEvent.click(await c.findByRole('button', { name: 'Bizeps' }));
  await waitFor(() => expect(body(map, 'goal:goal').temporary).toEqual({ focus: ['back', 'biceps'], until: '2026-11-20', endedSeenMs: 7 }));
  expect(body(map, 'goal:goal').focus).toEqual(['chest']);
});

test('a sport priority edits the temporary focus; the last part removed drops it', async () => {
  const { port, map } = fakePort([activeTemp({ sports: { run: 'focus' } })]);
  render(<CoachScreen port={port} {...env} />);
  const c = await goalSheet();
  await c.findByRole('button', { name: /^Laufen/ });
  await choose(/^Laufen/, 'normal');
  await waitFor(() => expect((body(map, 'goal:goal').temporary as { sports: object }).sports).toEqual({ run: 'equal' }));
  expect(body(map, 'goal:goal').sports).toEqual({ bike: 'keep' });
  await choose(/^Laufen/, '–');
  await waitFor(() => expect(body(map, 'goal:goal').temporary).toEqual({ focus: ['back'], until: '2026-11-20', endedSeenMs: 7 }));
});

test('only picking a duration moves the end of an active temporary focus', async () => {
  const { port, map } = fakePort([activeTemp()]);
  render(<CoachScreen port={port} {...env} />);
  const c = await goalSheet();
  await openFocus(c);
  await choose(/^Dauer/, '2 Wochen');
  await waitFor(() => expect((body(map, 'goal:goal').temporary as { until: string }).until).toBe('2026-11-18'));
  fireEvent.click(c.getByRole('button', { name: 'Bizeps' }));
  await waitFor(() => expect((body(map, 'goal:goal').temporary as { focus: string[] }).focus).toEqual(['back', 'biceps']));
  expect((body(map, 'goal:goal').temporary as { until: string }).until).toBe('2026-11-18');
});

test('"Jetzt beenden" ends the temporary focus without an ended notice', async () => {
  const { port, map } = fakePort([activeTemp()]);
  render(<CoachScreen port={port} {...env} />);
  const c = await goalSheet();
  await openFocus(c);
  fireEvent.click(await c.findByRole('button', { name: 'Jetzt beenden' }));
  await waitFor(() => expect(body(map, 'goal:goal').temporary).toBeUndefined());
  expect((await c.findAllByText('Brust')).length).toBeGreaterThan(0);
  expect(c.queryByText(/ausgelaufen/)).toBeNull();
  expect(c.queryByRole('button', { name: 'Jetzt beenden' })).toBeNull();
});

describe('used sports', () => {
  const sportsShown = (c: { getAllByRole: (role: string) => HTMLElement[] }) => c.getAllByRole('button').map((x) => x.querySelector('.tk-row-title')?.textContent?.trim() ?? '').filter((x) => ['Kraft', 'Rad', 'Laufen'].includes(x));
  const workout = (dayOffset: number): TrackedRecord => ({ kind: 'workout', id: `w${dayOffset}`, updatedMs: 1, deleted: false,
    body: { id: `w${dayOffset}`, title: 'T', startMs: NOW - dayOffset * 86_400_000, endMs: NOW - dayOffset * 86_400_000 + 3_600_000, source: 'pandafit', exercises: [] } });
  test('only sports with activity in the last 90 days, the rest behind a toggle', async () => {
    const { port } = fakePort([workout(3), workout(200)]);
    render(<CoachScreen port={port} {...env} />);
    const c = await goalSheet();
    await c.findByRole('button', { name: 'Weitere Sportarten' });
    expect(sportsShown(c)).toEqual(['Kraft']);
    fireEvent.click(c.getByRole('button', { name: 'Weitere Sportarten' }));
    expect(sportsShown(c)).toEqual(['Kraft', 'Rad', 'Laufen']);
  });
  test('a sport with a priority always shows; with no activity all three show', async () => {
    const { port } = fakePort([workout(3), goalRecord({ strength: 'fitness', focus: [], sports: { run: 'keep' } }, 1)]);
    render(<CoachScreen port={port} {...env} />);
    const c = await goalSheet();
    await c.findByRole('button', { name: 'Weitere Sportarten' });
    expect(sportsShown(c)).toEqual(['Kraft', 'Laufen']);
    cleanup();
    const empty = fakePort([]);
    render(<CoachScreen port={empty.port} {...env} />);
    const e = await goalSheet();
    await e.findByRole('button', { name: /^Ziel/ });
    expect(sportsShown(e)).toEqual(['Kraft', 'Rad', 'Laufen']);
    expect(e.queryByRole('button', { name: 'Weitere Sportarten' })).toBeNull();
  });
});
