// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import type { LoggedWorkout, TrackedRecord } from '../../src/shared/records';
import { studioRecord } from '../../src/shared/studio';
import { WorkoutScreen } from '../../src/tracking/ui/WorkoutScreen';
import { fakePort } from './fake-port';

afterEach(cleanup);

const ids = { newId: () => 'new-id', now: () => 100_000 };
const past = (id: string, startMs: number, studio: string): TrackedRecord => ({ kind: 'workout', id, updatedMs: 1, deleted: false,
  body: { id, title: 'T', startMs, endMs: startMs + 1, source: 'pandafit', exercises: [], studio } as LoggedWorkout });
/** The studio row on the start screen shows the chosen studio; the sheet behind it lists, creates, renames and removes. */
const current = () => screen.getByRole('button', { name: /^Studio/ }).querySelector('.tk-row-value')!.textContent;
const openSheet = () => { fireEvent.click(screen.getByRole('button', { name: /^Studio/ })); return screen.getByRole('dialog', { name: 'Studio' }); };

async function start(f: ReturnType<typeof fakePort>) {
  render(<WorkoutScreen port={f.port} {...ids} />);
  await screen.findByRole('button', { name: /^(Anderes Training|Leeres Training starten)$/ });
}
async function create(name: string) {
  fireEvent.click(within(openSheet()).getByRole('button', { name: 'Neues Studio …' }));
  const input = await screen.findByLabelText('Name des neuen Studios');
  fireEvent.change(input, { target: { value: name } });
  fireEvent.keyDown(input, { key: 'Enter' });
}

describe('studio records on the start screen', () => {
  test('a created studio is saved at once and is listed after a remount, without any workout', async () => {
    const f = fakePort([]);
    await start(f);
    await create('Testhalle');
    await waitFor(() => expect(f.state.puts.some((r) => r.kind === 'studio' && (r.body as { name: string }).name === 'Testhalle')).toBe(true));
    cleanup();
    await start(f);
    await waitFor(() => expect(current()).toBe('Testhalle'));
    expect(within(openSheet()).getByRole('button', { name: 'Testhalle' })).toBeTruthy();
  });

  test('the default follows the newest pick', async () => {
    const f = fakePort([past('a', 1000, 'Alpha'), studioRecord('Beta', 5000, 5000)]);
    await start(f);
    await waitFor(() => expect(current()).toBe('Beta'));
    fireEvent.click(within(openSheet()).getByRole('button', { name: 'Alpha' }));
    await waitFor(() => expect(f.state.puts.some((r) => r.kind === 'studio' && (r.body as { name: string; atMs: number }).name === 'Alpha' && (r.body as { atMs: number }).atMs === 100_000)).toBe(true));
    cleanup();
    await start(f);
    await waitFor(() => expect(current()).toBe('Alpha'));
  });

  test('rename writes both records, never touches workouts, and merges onto an existing name', async () => {
    const f = fakePort([past('a', 1000, 'Alpha'), past('b', 2000, 'Beta')]);
    await start(f);
    await waitFor(() => expect(current()).toBe('Beta'));
    fireEvent.click(within(openSheet()).getByRole('button', { name: 'Umbenennen' }));
    const input = await screen.findByLabelText('Neuer Name des Studios');
    fireEvent.change(input, { target: { value: 'alpha' } });
    fireEvent.keyDown(input, { key: 'Enter' });
    await waitFor(() => expect(f.state.puts.filter((r) => r.kind === 'studio')).toHaveLength(2));
    const bodies = f.state.puts.map((r) => r.body as { name: string; renamedTo?: string });
    expect(bodies).toContainEqual(expect.objectContaining({ name: 'Beta', renamedTo: 'Alpha' }));
    expect(f.state.puts.some((r) => r.kind === 'workout')).toBe(false);
    cleanup();
    await start(f);
    await waitFor(() => expect(current()).toBe('Alpha'));
    expect(within(openSheet()).queryByRole('button', { name: 'Beta' })).toBeNull();
  });
});

describe('removing and hiding studios', () => {
  test('a studio without workouts is removed: its records are tombstoned and it is gone after a remount', async () => {
    const f = fakePort([past('a', 1000, 'Alpha'), studioRecord('Leer', 5000, 5000)]);
    await start(f);
    await waitFor(() => expect(current()).toBe('Leer'));
    fireEvent.click(within(openSheet()).getByRole('button', { name: 'Entfernen' }));
    expect(f.state.puts.some((r) => r.kind === 'studio' && r.deleted)).toBe(false); // a confirm comes first
    fireEvent.click(screen.getByRole('button', { name: 'Ja' }));
    await waitFor(() => expect(f.state.puts.some((r) => r.kind === 'studio' && r.deleted)).toBe(true));
    expect(f.state.puts.some((r) => r.kind === 'workout')).toBe(false);
    cleanup();
    await start(f);
    await waitFor(() => expect(current()).toBe('Alpha'));
    expect(within(openSheet()).queryByRole('button', { name: 'Leer' })).toBeNull();
  });

  test('a studio with workouts is hidden: not offered any more, the workout keeps it', async () => {
    const f = fakePort([past('a', 1000, 'Alpha'), past('b', 2000, 'Beta')]);
    await start(f);
    await waitFor(() => expect(current()).toBe('Beta'));
    const sheet = openSheet();
    expect(within(sheet).queryByRole('button', { name: 'Entfernen' })).toBeNull();
    fireEvent.click(within(sheet).getByRole('button', { name: 'Ausblenden' }));
    await waitFor(() => expect(f.state.puts.some((r) => r.kind === 'studio' && (r.body as { hidden?: boolean }).hidden === true)).toBe(true));
    cleanup();
    await start(f);
    await waitFor(() => expect(current()).toBe('Alpha'));
    expect(within(openSheet()).queryByRole('button', { name: 'Beta' })).toBeNull();
    expect((f.map.get('workout:b')!.body as LoggedWorkout).studio).toBe('Beta');
  });
});
