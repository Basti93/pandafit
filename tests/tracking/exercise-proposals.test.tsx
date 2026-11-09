// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { mergeCatalog } from '../../src/shared/catalog';
import { EXERCISES } from '../../src/shared/exercises';
import type { LoggedWorkout, TrackedRecord } from '../../src/shared/records';
import { aiExerciseId, linkId, linkRecord } from '../../src/shared/exercise-links';
import { resolveExercise } from '../../src/tracking/exercise-identity';
import { changeProposal, confirmProposal, rejectProposal, relink, undoLink } from '../../src/tracking/exercise-proposals';
import { ExerciseProposals } from '../../src/tracking/ui/ExerciseProposals';
import { WorkoutScreen } from '../../src/tracking/ui/WorkoutScreen';
import { CatalogScreen } from '../../src/tracking/ui/CatalogScreen';
import { fakePort } from './fake-port';

afterEach(cleanup);

const NOW = Date.UTC(2026, 10, 6, 12);
const DAY = 86_400_000;
const TITLE = 'Cable Row Custom';
const cat = (records: TrackedRecord[] = []) => mergeCatalog(EXERCISES, [], records);
const sameProposal: TrackedRecord = { kind: 'exercise', id: 'prop-1', updatedMs: NOW - 1000, deleted: false, body: { id: 'prop-1', proposal: { forTitle: TITLE, kind: 'same', targetId: 'pf-squat', reason: 'Gleiche Übung.', atMs: NOW - 1000 } } };
const newProposal: TrackedRecord = { kind: 'exercise', id: 'prop-2', updatedMs: NOW - 1000, deleted: false, body: { id: 'prop-2', title: 'Zorbo-Zug', type: 'weight_reps', primaryMuscle: 'lats', equipment: 'machine', source: 'ai', description: 'Ruhig ziehen.', proposal: { forTitle: 'Zorbo Pull', kind: 'new', reason: 'Neu.', atMs: NOW - 1000 } } };
const linkRec = (atMs = NOW - DAY, title = 'Cable Curl', targetId = 'pf-squat'): TrackedRecord => linkRecord(title, targetId, 'auto', atMs);

describe('pure actions', () => {
  test('confirm same: a link by the person, proposal withdrawn', () => {
    const [link, gone] = confirmProposal(sameProposal, cat(), NOW, [sameProposal]);
    expect(link).toMatchObject({ id: linkId(TITLE), deleted: false, body: { kind: 'link', title: TITLE, targetId: 'pf-squat', by: 'person', atMs: NOW } });
    expect(gone).toMatchObject({ id: 'prop-1', deleted: true });
    expect(gone!.updatedMs).toBeGreaterThan(sameProposal.updatedMs);
    expect(cat([link!]).find((e) => e.id === 'pf-squat')?.aliases).toContain(TITLE);
  });

  test('confirm same without a target in the catalog writes nothing', () => {
    expect(confirmProposal({ ...sameProposal, body: { proposal: { forTitle: TITLE, kind: 'same', targetId: 'nope', reason: '', atMs: 1 } } }, cat(), NOW, [])).toEqual([]);
  });

  test('confirm new: the exercise under a fresh id (by ai), a link from the logged title, the proposal withdrawn', () => {
    const [ex, link, gone] = confirmProposal(newProposal, cat(), NOW, [newProposal]);
    const id = aiExerciseId('Zorbo Pull', NOW);
    expect(id).not.toBe('prop-2');
    expect(ex).toMatchObject({ id, deleted: false, body: { id, source: 'ai', title: 'Zorbo-Zug', primaryMuscle: 'lats' } });
    expect((ex!.body as Record<string, unknown>).proposal).toBeUndefined();
    expect(link).toMatchObject({ body: { kind: 'link', title: 'Zorbo Pull', targetId: id, by: 'person' } });
    expect(gone).toMatchObject({ id: 'prop-2', deleted: true });
    const merged = cat([ex!, link!, gone!]);
    expect(merged.find((e) => e.id === id)).toMatchObject({ title: 'Zorbo-Zug', source: 'ai', aliases: ['Zorbo Pull'] });
    expect(resolveExercise({ exerciseId: 'h', title: 'Zorbo Pull' }, merged).exercise?.id).toBe(id);
  });

  test('change: links to the chosen target; a missing target writes nothing', () => {
    const [link, gone] = changeProposal(sameProposal, 'pf-front-squat', cat(), NOW, [sameProposal]);
    expect(link).toMatchObject({ body: { targetId: 'pf-front-squat', title: TITLE } });
    expect(gone).toMatchObject({ id: 'prop-1', deleted: true });
    expect(changeProposal(sameProposal, 'nope', cat(), NOW, [sameProposal])).toEqual([]);
  });

  test('reject: only the proposal is withdrawn', () => {
    const out = rejectProposal(sameProposal, NOW);
    expect(out).toHaveLength(1);
    expect(out[0]).toMatchObject({ id: 'prop-1', deleted: true });
  });

  test('relink rewrites the one link record to the new target, by the person', () => {
    const [next] = relink(linkRec(), 'pf-front-squat', cat([linkRec()]), NOW);
    expect(next).toMatchObject({ id: linkId('Cable Curl'), deleted: false, body: { targetId: 'pf-front-squat', by: 'person', atMs: NOW } });
    expect(next!.updatedMs).toBeGreaterThan(linkRec().updatedMs);
    expect(relink(linkRec(), 'pf-squat', cat(), NOW)).toEqual([]);
    expect(relink(linkRec(NOW - 15 * DAY), 'pf-front-squat', cat(), NOW)).toEqual([]);
  });

  test('undo: the link record is deleted, nothing else is touched', () => {
    const [u, ...rest] = undoLink(linkRec(), NOW);
    expect(rest).toEqual([]);
    expect(u).toMatchObject({ id: linkId('Cable Curl'), deleted: true });
    expect(cat([u!]).find((e) => e.id === 'pf-squat')?.aliases ?? []).not.toContain('Cable Curl');
  });
});

describe('ExerciseProposals card', () => {
  const show = (seed: TrackedRecord[]) => { const f = fakePort(seed); render(<ExerciseProposals port={f.port} now={() => NOW} newId={() => 'x'} />); return f; };

  test('renders nothing without proposals or recent auto links', async () => {
    show([linkRec(NOW - 15 * DAY), { ...sameProposal, deleted: true }]);
    await new Promise((r) => setTimeout(r, 20));
    expect(document.body.textContent).toBe('');
  });

  test('rows read plainly, without numbers', async () => {
    show([sameProposal, newProposal, linkRec()]);
    expect(await screen.findByText(/‚Cable Row Custom‘ ist vermutlich Kniebeuge/)).toBeTruthy();
    expect(screen.getByText('Neue Übung: Zorbo-Zug, Latissimus, Maschine oder Kabel')).toBeTruthy();
    expect(screen.getByText(/‚Cable Curl‘ als Kniebeuge eingeordnet/)).toBeTruthy();
  });

  test('two proposals for one title show one card; confirming withdraws both', async () => {
    const twin: TrackedRecord = { ...sameProposal, id: 'prop-1b', body: { id: 'prop-1b', proposal: { forTitle: TITLE, kind: 'same', targetId: 'pf-squat', reason: 'x', atMs: NOW - 500 } } };
    const f = show([sameProposal, twin]);
    expect(await screen.findAllByRole('button', { name: 'Bestätigen' })).toHaveLength(1);
    fireEvent.click(screen.getByRole('button', { name: 'Bestätigen' }));
    await waitFor(() => expect(f.state.puts.map((r) => `${r.id}:${r.deleted}`).sort()).toEqual([`${linkId(TITLE)}:false`, 'prop-1:true', 'prop-1b:true'].sort()));
  });

  test('Rückgängig after a new exercise was confirmed withdraws the unused exercise too', async () => {
    const [ex, link] = confirmProposal(newProposal, cat(), NOW, [newProposal]);
    const f = show([ex!, link!]);
    fireEvent.click(await screen.findByRole('button', { name: 'Rückgängig' }));
    await waitFor(() => expect(f.state.puts.map((r) => `${r.id}:${r.deleted}`).sort()).toEqual([`${linkId('Zorbo Pull')}:true`, `${ex!.id}:true`].sort()));
  });

  test('Bestätigen writes the records through the port, the row goes', async () => {
    const f = show([sameProposal]);
    fireEvent.click(await screen.findByRole('button', { name: 'Bestätigen' }));
    await waitFor(() => expect(f.state.puts).toHaveLength(2));
    expect(f.state.puts.map((r) => `${r.id}:${r.deleted}`)).toEqual([`${linkId(TITLE)}:false`, 'prop-1:true']);
    await waitFor(() => expect(screen.queryByText(/ist vermutlich/)).toBeNull());
  });

  test('Ändern opens the picker; the pick links to that exercise', async () => {
    const f = show([sameProposal]);
    fireEvent.click(await screen.findByRole('button', { name: 'Ändern' }));
    const dialog = await screen.findByRole('dialog', { name: 'Übung wählen' });
    fireEvent.change(within(dialog).getByLabelText('Suchen'), { target: { value: 'Frontkniebeuge' } });
    fireEvent.click(within(dialog).getAllByRole('button', { name: /Frontkniebeuge/ })[0]!);
    await waitFor(() => expect(f.state.puts).toHaveLength(2));
    expect(f.state.puts[0]).toMatchObject({ id: linkId(TITLE), body: { targetId: 'pf-front-squat' } });
  });

  test('Ändern on a recent link opens the picker and rewrites the link', async () => {
    const f = show([linkRec()]);
    fireEvent.click(await screen.findByRole('button', { name: 'Ändern' }));
    const dialog = await screen.findByRole('dialog', { name: 'Übung wählen' });
    fireEvent.change(within(dialog).getByLabelText('Suchen'), { target: { value: 'Frontkniebeuge' } });
    fireEvent.click(within(dialog).getAllByRole('button', { name: /Frontkniebeuge/ })[0]!);
    await waitFor(() => expect(f.state.puts).toHaveLength(1));
    expect(f.state.puts[0]).toMatchObject({ id: linkId('Cable Curl'), body: { targetId: 'pf-front-squat', by: 'person' } });
  });

  test('Verwerfen withdraws the proposal and the row goes', async () => {
    const f = show([sameProposal]);
    fireEvent.click(await screen.findByRole('button', { name: 'Verwerfen' }));
    await waitFor(() => expect(f.state.puts).toHaveLength(1));
    expect(f.state.puts[0]).toMatchObject({ id: 'prop-1', deleted: true });
    await waitFor(() => expect(screen.queryByText(/ist vermutlich/)).toBeNull());
  });

  test('a proposal withdrawn in the meantime is not written again', async () => {
    const f = show([sameProposal]);
    await screen.findByRole('button', { name: 'Bestätigen' });
    await f.port.put({ ...sameProposal, updatedMs: NOW, deleted: true });
    f.state.puts.length = 0;
    fireEvent.click(screen.getByRole('button', { name: 'Bestätigen' }));
    await new Promise((r) => setTimeout(r, 30));
    expect(f.state.puts).toHaveLength(0);
  });

  test('a failed write says so and keeps the row', async () => {
    const f = show([sameProposal]);
    f.state.failPuts = true;
    fireEvent.click(await screen.findByRole('button', { name: 'Bestätigen' }));
    expect((await screen.findByRole('status')).textContent).toMatch(/nicht gespeichert/);
    expect(screen.getByText(/ist vermutlich/)).toBeTruthy();
  });

  test('Rückgängig takes the link away: the exercise shows "Muskel unbekannt" again in the workout screen', async () => {
    const w: LoggedWorkout = { id: 'o1', title: 'Zuhause', startMs: 1000, endMs: null, source: 'hevy', exercises: [{ exerciseId: 'hevy-x', title: TITLE, supersetId: null, notes: '', sets: [{ type: 'normal', weightKg: 20, reps: 8, durationS: null, doneMs: null }] }] };
    const f = fakePort([linkRec(NOW - DAY, TITLE), { kind: 'workout', id: 'o1', updatedMs: 1, deleted: false, body: w }]);
    const open = async () => {
      render(<WorkoutScreen port={f.port} now={() => NOW} newId={() => 'x'} />);
      fireEvent.click(await screen.findByRole('button', { name: 'Weitermachen' }));
      fireEvent.click(within(await screen.findByRole('region', { name: TITLE })).getByRole('button', { name: 'Anleitung' }));
      return (await screen.findByRole('dialog', { name: TITLE })).querySelector('.tk-sheet-head [role="img"]')!.getAttribute('aria-label');
    };
    expect(await open()).not.toBe('Muskel unbekannt');
    cleanup();
    render(<ExerciseProposals port={f.port} now={() => NOW} />);
    fireEvent.click(await screen.findByRole('button', { name: 'Rückgängig' }));
    await waitFor(() => expect(f.state.puts).toHaveLength(1));
    cleanup();
    expect(await open()).toBe('Muskel unbekannt');
    expect(f.state.puts[0]).toMatchObject({ id: linkId(TITLE), deleted: true });
  });
});

describe('where the card lives', () => {
  test('under Übungen, not on the training start screen', async () => {
    const f = fakePort([sameProposal]);
    render(<CatalogScreen port={f.port} now={() => NOW} newId={() => 'x'} />);
    expect(await screen.findByRole('region', { name: 'Übungen einordnen' })).toBeTruthy();
    cleanup();
    render(<WorkoutScreen port={fakePort([sameProposal]).port} now={() => NOW} newId={() => 'x'} />);
    await screen.findByRole('button', { name: 'Leeres Training starten' });
    await new Promise((r) => setTimeout(r, 20));
    expect(screen.queryByRole('region', { name: 'Übungen einordnen' })).toBeNull();
  });
});
