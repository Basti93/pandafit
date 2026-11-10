// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { exerciseDescription } from '../../src/shared/exercise-descriptions';
import type { LoggedWorkout, TrackedRecord } from '../../src/shared/records';
import { exerciseImages } from '../../src/tracking/media';
import { ExerciseInfo } from '../../src/tracking/ui/ExerciseInfo';
import { ExercisePicker } from '../../src/tracking/ui/ExercisePicker';
import { MuscleIcon } from '../../src/tracking/ui/MuscleIcon';
import { WorkoutScreen } from '../../src/tracking/ui/WorkoutScreen';
import { fakePort } from './fake-port';

afterEach(cleanup);

const set = { type: 'normal' as const, weightKg: 60, reps: 8, durationS: null, doneMs: null };
const ex = (exerciseId: string, title: string) => ({ exerciseId, title, supersetId: null, notes: '', sets: [set] });
const open: LoggedWorkout = {
  id: 'o1', title: 'Zuhause', startMs: 1000, endMs: null, source: 'pandafit',
  exercises: [ex('pf-squat', 'Kniebeuge'), ex('pf-front-squat', 'Frontkniebeuge'), ex('my-own-uuid', 'Meine Übung')],
};
const rec = (w: LoggedWorkout): TrackedRecord => ({ kind: 'workout', id: w.id, updatedMs: 1, deleted: false, body: w });
const ids = { newId: () => 'new-id', now: () => 100_000 };

async function running() {
  const { port } = fakePort([rec(open)]);
  render(<WorkoutScreen port={port} {...ids} />);
  fireEvent.click(await screen.findByRole('button', { name: 'Weitermachen' }));
  await screen.findByText('Kniebeuge');
}

/** Makes the exercise the focus (its row under "Danach") and opens its Anleitung sheet. */
async function anleitung(title: string) {
  if (!screen.queryByRole('region', { name: title })) fireEvent.click(screen.getAllByRole('button').find((b) => b.textContent?.startsWith(title))!);
  fireEvent.click(within(screen.getByRole('region', { name: title })).getByRole('button', { name: 'Anleitung' }));
  return screen.findByRole('dialog', { name: title });
}
/** The muscle icon at the head of the Anleitung sheet. */
const headIcon = (sheet: HTMLElement) => sheet.querySelector('.tk-sheet-head [role="img"]')!;

describe('workout: Anleitung behind its round button on the focus card', () => {
  test('closed by default; the button opens it in a sheet with the wger credit, and × closes it', async () => {
    await running();
    expect(screen.queryByText(/Füße etwas mehr als hüftbreit/)).toBeNull();
    const sheet = await anleitung('Kniebeuge');
    const note = within(sheet).getByRole('note', { name: 'Anleitung Kniebeuge' });
    expect(note.textContent).toMatch(/Füße etwas mehr als hüftbreit/);
    expect(note.textContent).toContain('Quelle: wger.de, CC-BY-SA 3.0');
    expect(screen.queryByRole('button', { name: 'Kniebeuge tauschen' })).toBeNull(); // the menu stays closed
    fireEvent.click(within(sheet).getByRole('button', { name: 'Schließen' }));
    expect(screen.queryByRole('note', { name: 'Anleitung Kniebeuge' })).toBeNull();
  });

  test('the menu has no Anleitung entry; the round button is the one way', async () => {
    await running();
    fireEvent.click(screen.getByRole('button', { name: 'Mehr zu Kniebeuge' }));
    fireEvent.click(screen.getByRole('button', { name: 'Mehr' }));
    expect(screen.getAllByRole('button', { name: 'Anleitung' })).toHaveLength(1); // only the round button, none in the menu
    expect(within(screen.getByRole('list', { name: 'Mehr zu Kniebeuge' })).queryByText('Anleitung')).toBeNull();
  });

  test('an own text shows without a credit line', async () => {
    await running();
    const note = within(await anleitung('Frontkniebeuge')).getByRole('note', { name: 'Anleitung Frontkniebeuge' });
    expect(note.textContent).toMatch(/Ellbogen/);
    expect(note.textContent).not.toContain('Quelle');
  });

  test('an exercise without a description still opens: no text yet, but the video link', async () => {
    await running();
    const note = within(await anleitung('Meine Übung')).getByRole('note', { name: 'Anleitung Meine Übung' });
    expect(note.textContent).toContain('Für diese Übung gibt es noch keine Beschreibung.');
    const video = within(note).getByRole('link', { name: 'Video ansehen' });
    expect(video.getAttribute('href')).toBe('https://www.youtube.com/results?search_query=Meine%20%C3%9Cbung%20exercise%20form');
  });

  test('the video link searches the English Hevy name in a new window; no picture means no image', async () => {
    await running();
    const note = within(await anleitung('Kniebeuge')).getByRole('note', { name: 'Anleitung Kniebeuge' });
    const video = within(note).getByRole('link', { name: 'Video ansehen' });
    expect(video.getAttribute('href')).toBe('https://www.youtube.com/results?search_query=Squat%20(Barbell)%20exercise%20form');
    expect(video.getAttribute('target')).toBe('_blank');
    expect(video.getAttribute('rel')).toBe('noopener noreferrer');
    expect(within(note).queryByRole('img', { name: /Ausführung/ })).toBeNull();
  });

  test('the Anleitung sheet shows the muscle icon of the exercise', async () => {
    await running();
    expect(headIcon(await anleitung('Kniebeuge')).getAttribute('aria-label')).toBe('Oberschenkel vorn');
    fireEvent.click(screen.getByRole('button', { name: 'Schließen' }));
    expect(headIcon(await anleitung('Meine Übung')).getAttribute('aria-label')).toBe('Muskel unbekannt');
  });
});

describe('workout: imported exercises resolve by identity', () => {
  const imported: LoggedWorkout = {
    id: 'o2', title: 'Hevy', startMs: 1000, endMs: null, source: 'pandafit',
    exercises: [ex('h-row', 'Cable Row Custom'), ex('h-smith', 'Squat (Smith Machine)'), ex('h-rdf', 'Rear Delt Reverse Fly (Machine)')],
  };
  const statsRec = (body: unknown): TrackedRecord => ({ kind: 'stats', id: 'stats', updatedMs: 1, deleted: false, body });
  const good = statsRec({ type: 'stats', atMs: 1, goal: null, days: [], muscles: { 'h-row': 'upper_back' } });
  async function runningWith(extra: TrackedRecord[]) {
    const { port } = fakePort([rec(imported), ...extra]);
    render(<WorkoutScreen port={port} {...ids} />);
    fireEvent.click(await screen.findByRole('button', { name: 'Weitermachen' }));
    await screen.findByText('Cable Row Custom');
  }
  const iconOf = async (title: string) => headIcon(await anleitung(title));

  test('a Hevy row unknown to the catalog shows the back from the stats muscles', async () => {
    await runningWith([good]);
    const sheet = await anleitung('Cable Row Custom');
    await waitFor(() => expect(headIcon(sheet).getAttribute('aria-label')).toBe('Rücken'));
  });

  test('without a stats record the same exercise shows "Muskel unbekannt", not Sonstiges', async () => {
    await runningWith([]);
    expect((await iconOf('Cable Row Custom')).getAttribute('aria-label')).toBe('Muskel unbekannt');
  });

  test('a malformed stats record is ignored', async () => {
    await runningWith([statsRec({ type: 'stats' })]);
    expect((await iconOf('Cable Row Custom')).getAttribute('aria-label')).toBe('Muskel unbekannt');
  });

  test('a Smith machine squat shows no free-weight text and no pictures', async () => {
    await runningWith([good]);
    const note = within(await anleitung('Squat (Smith Machine)')).getByRole('note', { name: 'Anleitung Squat (Smith Machine)' });
    expect(note.textContent).toContain('Für diese Übung gibt es noch keine Beschreibung.');
    expect(note.textContent).not.toContain('Beschrieben am Beispiel');
    expect(within(note).queryByRole('img', { name: /Ausführung/ })).toBeNull();
  });

  test('the machine reverse fly from Hevy shows its machine text', async () => {
    await runningWith([]);
    const note = within(await anleitung('Rear Delt Reverse Fly (Machine)')).getByRole('note', { name: 'Anleitung Rear Delt Reverse Fly (Machine)' });
    expect(note.textContent).toContain(exerciseDescription('pf-rear-delt-fly-machine')!.text);
    expect(note.textContent).not.toMatch(/Kurzhantel/);
  });
});

describe('ExerciseInfo pictures', () => {
  test('shows the bundled pictures above the text, lazy, each with its credit and source link', () => {
    render(<ExerciseInfo title="Bankdrücken" description={exerciseDescription('pf-bench-press')} images={exerciseImages('pf-bench-press')} video="https://example.invalid/v" />);
    const imgs = screen.getAllByRole('img', { name: 'Bankdrücken, Ausführung' });
    expect(imgs).toHaveLength(2);
    expect(imgs[0]!.getAttribute('src')).toBe('/exercises/pf-bench-press-1.jpg');
    expect(imgs[0]!.getAttribute('loading')).toBe('lazy');
    const note = screen.getByRole('note', { name: 'Anleitung Bankdrücken' });
    expect(note.textContent).toContain('Bild: wger.de, Everkinetic, CC-BY-SA 3.0');
    const source = within(note).getAllByRole('link', { name: 'wger.de' })[0]!;
    expect(source.getAttribute('href')).toBe('https://wger.de/en/exercise/73/view/');
    expect(source.getAttribute('target')).toBe('_blank');
    expect(imgs[0]!.compareDocumentPosition(screen.getByText(/Lege dich auf die Bank/)) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });
});

describe('ExerciseInfo base-catalog pictures', () => {
  test('credits the public-domain source, and a picture that fails to load hides its frame', () => {
    const images = [{ file: 'exercises/fedb/fedb-x-1.jpg', author: 'free-exercise-db (gemeinfrei)', licence: 'Unlicense', sourceUrl: 'https://example.invalid/fedb' }];
    render(<ExerciseInfo title="Übung" description={null} images={images} video="https://example.invalid/v" />);
    const note = screen.getByRole('note', { name: 'Anleitung Übung' });
    expect(note.textContent).toContain('Bild: free-exercise-db (gemeinfrei)');
    const img = screen.getByRole('img', { name: 'Übung, Ausführung' });
    fireEvent.error(img);
    expect(img.closest('figure')!.hidden).toBe(true);
  });
});

describe('MuscleIcon', () => {
  test('with null is labelled as unknown and highlights nothing', () => {
    render(<MuscleIcon group={null} />);
    const icon = screen.getByRole('img', { name: 'Muskel unbekannt' });
    expect(icon.querySelector('[fill="var(--accent)"]')).toBeNull();
    expect(icon.textContent).toContain('?');
  });

  test('is an image named after the muscle group, with the group drawn in the accent colour', () => {
    const { container } = render(<><MuscleIcon group="chest" /><MuscleIcon group="calves" size={24} /><MuscleIcon group="other" /></>);
    expect(screen.getByRole('img', { name: 'Brust' }).querySelector('[data-region="chest"]')?.getAttribute('fill')).toBe('var(--accent)');
    const calves = screen.getByRole('img', { name: 'Waden' });
    expect(calves.getAttribute('width')).toBe('24');
    expect(calves.querySelector('[data-region="calves"]')?.getAttribute('fill')).toBe('var(--accent)');
    expect(calves.querySelector('[data-region="chest"]')).toBeNull(); // the back view has no chest
    expect(screen.getByRole('img', { name: 'Sonstiges' }).querySelector('[fill="var(--accent)"]')).toBeNull();
    expect(container.querySelectorAll('svg')).toHaveLength(3);
  });
});

describe('picker: info toggle per exercise', () => {
  const mine: TrackedRecord = { kind: 'exercise', id: 'mine-1', updatedMs: 1, deleted: false, body: { id: 'mine-1', title: 'Seilspringen am Hof', type: 'reps_only', primaryMuscle: 'cardio', equipment: 'none' } };

  test('the mark shows and hides the text inline without picking, credit included', async () => {
    const { port } = fakePort();
    const onPick = vi.fn();
    render(<ExercisePicker port={port} onPick={onPick} onClose={() => {}} />);
    fireEvent.change(screen.getByLabelText('Suchen'), { target: { value: 'Bankdrücken' } });
    const info = await screen.findByRole('button', { name: 'Anleitung Bankdrücken' });
    expect(info.textContent).not.toContain('ⓘ');
    expect(info.getAttribute('aria-expanded')).toBe('false');
    expect(screen.queryByRole('note', { name: 'Anleitung Bankdrücken' })).toBeNull();
    fireEvent.click(info);
    expect(onPick).not.toHaveBeenCalled();
    expect(info.getAttribute('aria-expanded')).toBe('true');
    const note = screen.getByRole('note', { name: 'Anleitung Bankdrücken' });
    expect(note.textContent).toMatch(/Lege dich auf die Bank/);
    expect(note.textContent).toContain('Quelle: wger.de, sistab2, CC-BY-SA 3.0');
    fireEvent.click(info);
    expect(screen.queryByRole('note', { name: 'Anleitung Bankdrücken' })).toBeNull();
  });

  test('picking still works with the row; own exercises get the toggle too, with the video link only', async () => {
    const { port } = fakePort([mine]);
    const onPick = vi.fn();
    render(<ExercisePicker port={port} onPick={onPick} onClose={() => {}} />);
    fireEvent.change(screen.getByLabelText('Suchen'), { target: { value: 'Seilspringen' } });
    const row = await screen.findByRole('button', { name: /^Seilspringen am Hof/ });
    fireEvent.click(screen.getByRole('button', { name: 'Anleitung Seilspringen am Hof' }));
    const note = screen.getByRole('note', { name: 'Anleitung Seilspringen am Hof' });
    expect(note.textContent).toContain('Für diese Übung gibt es noch keine Beschreibung.');
    expect(within(note).getByRole('link', { name: 'Video ansehen' })).toBeTruthy();
    expect(onPick).not.toHaveBeenCalled();
    fireEvent.click(row);
    expect(onPick).toHaveBeenCalledWith(expect.objectContaining({ id: 'mine-1' }));
  });

  test('a row is the name only; the muscle icon and the picture show in the opened info', async () => {
    const { port } = fakePort();
    render(<ExercisePicker port={port} onPick={() => {}} onClose={() => {}} />);
    fireEvent.change(screen.getByLabelText('Suchen'), { target: { value: 'Bankdrücken' } });
    const row = (await screen.findByRole('button', { name: 'Bankdrücken' })).closest('.tk-pick-row') as HTMLElement;
    expect(within(row).queryByRole('img', { name: /Ausführung/ })).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Anleitung Bankdrücken' }));
    expect(screen.getAllByRole('img', { name: 'Bankdrücken, Ausführung' }).length).toBeGreaterThan(0);
  });
});

describe('long descriptions', () => {
  test('zeigt die ganze Anleitung ohne mehr-Knopf', () => {
    const text = Array.from({ length: 120 }, (_, i) => `w${i}`).join(' ');
    render(<ExerciseInfo title="X" description={{ text, source: { kind: 'own' } }} video="https://example.com" />);
    expect(screen.getByText(/w119/).textContent).toBe(text);
    expect(screen.queryByRole('button', { name: 'mehr' })).toBeNull();
  });
});
