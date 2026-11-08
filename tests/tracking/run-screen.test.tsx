// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import type { TrackedRecord } from '../../src/shared/records';
import { runFp, weekFp, type PlannedRun, type RunGarmin, type RunReviewBody, type RunStatusBody, type RunWeekBody } from '../../src/shared/run';
import { RunScreen } from '../../src/tracking/ui/RunScreen';
import { RunLookBack } from '../../src/tracking/ui/RunLookBack';
import { RunSettingsCard } from '../../src/tracking/ui/RunSettingsCard';
import { runView } from '../../src/tracking/ui/run-view';
import { fakePort } from './fake-port';

afterEach(cleanup);

// Wednesday 4 November 2026, 10:00 local time.
const NOW = new Date(2026, 10, 4, 10, 0).getTime();
const WEEK = '2026-11-02';
const ids = { now: () => NOW, newId: () => 'u1' };

const rec = (id: string, body: object, deleted = false): TrackedRecord => ({ kind: 'run', id, updatedMs: 1, deleted, body });
const planned = (over: Partial<PlannedRun> = {}): PlannedRun => ({ date: '2026-11-04', kind: 'easy', minutes: 30, hrCap: 150, counts: 'Heute zählt die Zeit, nicht das Tempo.', note: null, ...over });
const garminOf = (over: Partial<RunGarmin> = {}): RunGarmin => ({ status: 'none', reason: null, confirmedMs: null, sent: {}, ...over });
const weekBody = (runs: PlannedRun[] = [planned(), planned({ date: '2026-11-07', kind: 'long', minutes: 45, counts: 'Lang und ruhig.' })], garmin: RunGarmin | null = null): RunWeekBody => ({
  type: 'week', week: WEEK, announce: true, atMs: 1, phase: 1, source: 'rules', reason: 'Ruhiger Start in die Woche.', note: null,
  runs: runs.map((r) => ({ ...r, fp: runFp(r), done: null })), garmin,
});
const statusBody = (over: Partial<RunStatusBody> = {}): RunStatusBody => ({
  type: 'status', atMs: 1, on: true, suggest: false, needsAnswers: false, garmin: false, suggestedDays: [1, 3, 5], hrCap: 150, complaint: null,
  numbers: { easyPace: { now: null, weeks4: null, weeks12: null, trend: [] }, weeks: [], longest: { blockKm: null, lastBlockKm: null }, tests: [] }, card: null, ...over,
});
const reviewBody = (over: Partial<RunReviewBody> = {}): RunReviewBody => ({ type: 'review', week: '2026-10-26', atMs: 1, km: 12.5, minutes: 90, plannedMinutes: 90, runs: 3, longestKm: 6, easyPace: null, testM: null, focus: 'Ruhig weiter.', ...over });
const bodyOf = (m: Map<string, TrackedRecord>, id: string) => m.get(`run:${id}`)?.body as Record<string, unknown> | undefined;

const BAD = /Rekord|Serie|Streak|musst|Pflicht/;

test('nothing renders without run records', async () => {
  const { port } = fakePort([]);
  const a = render(<RunScreen port={port} {...ids} />);
  const b = render(<RunLookBack port={port} now={ids.now} />);
  await new Promise((r) => setTimeout(r, 30));
  expect(a.container.innerHTML).toBe('');
  expect(b.container.innerHTML).toBe('');
});

test('a status that is off and no suggestion renders nothing, and so does a status whose body type does not match its id', async () => {
  const { port } = fakePort([rec('status', statusBody({ on: false, suggest: false })), rec('week-2026-11-02', { ...weekBody(), type: 'review' })]);
  const { container } = render(<RunScreen port={port} {...ids} />);
  await new Promise((r) => setTimeout(r, 30));
  expect(container.innerHTML).toBe('');
});

test('runView ignores deleted, odd and mismatched records, and says visible only for on or suggest', () => {
  const v = runView([rec('status', statusBody()), rec('week-2026-11-02', weekBody()), rec('review-2026-10-26', reviewBody()), rec('review-2026-10-19', { ...reviewBody(), type: 'week' }), rec('settings', { type: 'settings', on: 'x' })], NOW);
  expect(v.visible).toBe(true);
  expect(v.week?.week).toBe(WEEK);
  expect(v.reviews).toHaveLength(1);
  expect(v.settings).toBeNull();
  expect(runView([rec('status', statusBody(), true)], NOW)).toMatchObject({ status: null, visible: false });
  expect(runView([rec('status', statusBody({ on: false, suggest: true }))], NOW).visible).toBe(true);
  expect(runView([], NOW)).toEqual({ status: null, settings: null, week: null, reviews: [], visible: false });
});

test('a suggestion offers "Laufen einschalten" and writes settings on true', async () => {
  const { port, map } = fakePort([rec('status', statusBody({ on: false, suggest: true }))]);
  render(<RunScreen port={port} {...ids} />);
  expect(await screen.findByText('Pandafit hat Läufe von deiner Uhr gefunden. Soll Pandafit dein Laufen mitplanen?')).toBeTruthy();
  fireEvent.click(screen.getByRole('button', { name: 'Laufen einschalten' }));
  await waitFor(() => expect(bodyOf(map, 'settings')).toMatchObject({ type: 'settings', on: true, weekdays: null, answers: null }));
});

test('"Nicht jetzt" writes settings on false', async () => {
  const { port, map } = fakePort([rec('status', statusBody({ on: false, suggest: true }))]);
  render(<RunScreen port={port} {...ids} />);
  fireEvent.click(await screen.findByRole('button', { name: 'Nicht jetzt' }));
  await waitFor(() => expect(bodyOf(map, 'settings')).toMatchObject({ on: false }));
});

test('the questions write answers and weekdays in one settings record', async () => {
  const { port, map } = fakePort([rec('status', statusBody({ needsAnswers: true })), rec('settings', { type: 'settings', on: true, weekdays: null, answers: null })]);
  render(<RunScreen port={port} {...ids} />);
  fireEvent.change(await screen.findByLabelText('Wie oft läufst du zurzeit?'), { target: { value: '2' } });
  fireEvent.change(screen.getByLabelText('Wie lange dauert ein Lauf meist (Minuten)?'), { target: { value: '40' } });
  fireEvent.click(screen.getByLabelText('Hast du beim Laufen gerade Schmerzen?'));
  const days = within(screen.getByRole('group', { name: 'An welchen Tagen möchtest du laufen?' }));
  // The coach's suggestion (Tue, Thu, Sat) is preselected; Tuesday goes, Monday comes.
  expect(days.getByRole('button', { name: 'Donnerstag' }).getAttribute('aria-pressed')).toBe('true');
  fireEvent.click(days.getByRole('button', { name: 'Dienstag' }));
  fireEvent.click(days.getByRole('button', { name: 'Montag' }));
  fireEvent.click(screen.getByRole('button', { name: 'Speichern' }));
  await waitFor(() => expect(bodyOf(map, 'settings')).toEqual({ type: 'settings', on: true, weekdays: [0, 3, 5], answers: { runsPerWeek: 2, usualMinutes: 40, pain: true } }));
  expect(map.get('run:settings')!.updatedMs).toBeGreaterThan(1);
});

test('a planned run shows what counts today', async () => {
  const { port } = fakePort([rec('status', statusBody()), rec(`week-${WEEK}`, weekBody())]);
  render(<RunScreen port={port} {...ids} />);
  const today = await screen.findByRole('region', { name: 'Heute' });
  expect(within(today).getByText('Heute zählt die Zeit, nicht das Tempo.')).toBeTruthy();
  expect(within(today).getByText(/30 Min/)).toBeTruthy();
  expect(screen.getByRole('region', { name: 'Läufe dieser Woche' })).toBeTruthy();
  expect(screen.getByText('Ruhiger Start in die Woche.')).toBeTruthy();
});

test('no run today: the card names the next run with its day', async () => {
  const { port } = fakePort([rec('status', statusBody()), rec(`week-${WEEK}`, weekBody([planned({ date: '2026-11-07', minutes: 45 })]))]);
  render(<RunScreen port={port} {...ids} />);
  const next = await screen.findByRole('region', { name: 'Nächster Lauf' });
  expect(within(next).getByText('Sa., 7. Nov.')).toBeTruthy();
  expect(within(next).getByText(/45 Min/)).toBeTruthy();
  expect(screen.queryByRole('region', { name: 'Heute' })).toBeNull();
});

test('no run today: no card named Heute', async () => {
  const { port } = fakePort([rec('status', statusBody()), rec(`week-${WEEK}`, weekBody([planned({ date: '2026-11-07' })]))]);
  render(<RunScreen port={port} {...ids} />);
  await screen.findByRole('region', { name: 'Läufe dieser Woche' });
  expect(screen.queryByRole('region', { name: 'Heute' })).toBeNull();
});

describe('Garmin', () => {
  const fpOf = (w: RunWeekBody) => weekFp(w.runs);
  const seeded = (garmin: boolean, g: RunGarmin | null) => {
    const w = weekBody(undefined, g);
    return { w, ...fakePort([rec('status', statusBody({ garmin })), rec(`week-${WEEK}`, w)]) };
  };

  test('An Garmin senden writes send-<week> with the week fingerprint; without garmin the button is absent', async () => {
    const a = seeded(true, garminOf());
    render(<RunScreen port={a.port} {...ids} />);
    fireEvent.click(await screen.findByRole('button', { name: 'An Garmin senden' }));
    await waitFor(() => expect(bodyOf(a.map, `send-${WEEK}`)).toEqual({ type: 'send', week: WEEK, fp: fpOf(a.w), atMs: NOW }));
    cleanup();
    // The week still carries sent ids after a disconnect, but the status says Garmin is not there: no button, no Garmin text.
    const b = seeded(false, garminOf({ status: 'sent', sent: { '2026-11-04': { workoutId: 'w', scheduleId: null, fp: 'x' } } }));
    render(<RunScreen port={b.port} {...ids} />);
    await screen.findByRole('region', { name: 'Läufe dieser Woche' });
    expect(screen.queryByRole('button', { name: 'An Garmin senden' })).toBeNull();
    expect(screen.queryByText('Auf deiner Uhr')).toBeNull();
  });

  test('changed and stale ask for a new confirmation; sending disables the button', async () => {
    const changed = 'Der Plan hat sich geändert. Bitte bestätige noch einmal, dann geht die neue Version an Garmin.';
    const stale = 'Inzwischen gibt es einen neueren Plan. Bitte schau ihn dir an und bestätige noch einmal.';
    for (const [status, text] of [['changed', changed], ['stale', stale]] as const) {
      const a = seeded(true, garminOf({ status, confirmedMs: 5 }));
      render(<RunScreen port={a.port} {...ids} />);
      expect(await screen.findByText(text)).toBeTruthy();
      expect((screen.getByRole('button', { name: 'An Garmin senden' }) as HTMLButtonElement).disabled).toBe(false);
      cleanup();
    }
    const sending = seeded(true, garminOf({ status: 'sending' }));
    render(<RunScreen port={sending.port} {...ids} />);
    expect(((await screen.findByRole('button', { name: 'An Garmin senden' })) as HTMLButtonElement).disabled).toBe(true);
    cleanup();
    const sent = seeded(true, garminOf({ status: 'sent', confirmedMs: 5 }));
    render(<RunScreen port={sent.port} {...ids} />);
    expect(await screen.findByText('Auf deiner Uhr')).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'An Garmin senden' })).toBeNull();
  });

  test('a week without a Garmin object offers no button even when the status says Garmin is there', async () => {
    const a = seeded(true, null);
    render(<RunScreen port={a.port} {...ids} />);
    await screen.findByRole('region', { name: 'Läufe dieser Woche' });
    expect(screen.queryByRole('button', { name: 'An Garmin senden' })).toBeNull();
  });

  test('a send record whose body names another week does not count as pending', async () => {
    const w = weekBody(undefined, garminOf());
    const { port } = fakePort([rec('status', statusBody({ garmin: true })), rec(`week-${WEEK}`, w), rec(`send-${WEEK}`, { type: 'send', week: '2026-10-26', fp: weekFp(w.runs), atMs: NOW })]);
    render(<RunScreen port={port} {...ids} />);
    expect(((await screen.findByRole('button', { name: 'An Garmin senden' })) as HTMLButtonElement).disabled).toBe(false);
  });

  test('during a pause, workouts still on the watch can be removed with the paused week fingerprint', async () => {
    const question = 'Auf deiner Uhr sind noch geplante Läufe. Sollen sie entfernt werden?';
    const sent = { '2026-11-03': { workoutId: 'w-past', scheduleId: null, fp: 'x' }, '2026-11-06': { workoutId: 'w6', scheduleId: null, fp: 'y' } };
    // The paused week: only the past run is left.
    const paused = weekBody([planned({ date: '2026-11-03' })], garminOf({ status: 'changed', sent }));
    const seed = (g: boolean, w: RunWeekBody) => fakePort([rec('status', statusBody({ garmin: g, complaint: 'pause' })), rec(`week-${WEEK}`, w)]);
    const a = seed(true, paused);
    render(<RunScreen port={a.port} {...ids} />);
    expect(await screen.findByText(question)).toBeTruthy();
    expect(screen.queryByRole('region', { name: 'Läufe dieser Woche' })).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Entfernen' }));
    await waitFor(() => expect(bodyOf(a.map, `send-${WEEK}`)).toEqual({ type: 'send', week: WEEK, fp: weekFp(paused.runs), atMs: NOW }));
    await waitFor(() => expect((screen.getByRole('button', { name: 'Entfernen' }) as HTMLButtonElement).disabled).toBe(true));
    cleanup();
    // Only past dates on the watch, no Garmin, or nothing sent: no question.
    for (const [g, w] of [
      [true, weekBody([planned({ date: '2026-11-03' })], garminOf({ status: 'changed', sent: { '2026-11-03': sent['2026-11-03'] } }))],
      [false, paused],
      [true, weekBody([planned({ date: '2026-11-03' })], garminOf({ status: 'sent' }))],
    ] as const) {
      const b = seed(g, w);
      render(<RunScreen port={b.port} {...ids} />);
      await screen.findByText(/Laufen pausiert/);
      expect(screen.queryByText(question)).toBeNull();
      cleanup();
    }
  });

  test('a tap is not repeated while the coach has not handled it yet', async () => {
    const a = seeded(true, garminOf());
    render(<RunScreen port={a.port} {...ids} />);
    const btn = await screen.findByRole('button', { name: 'An Garmin senden' });
    fireEvent.click(btn);
    await waitFor(() => expect((screen.getByRole('button', { name: 'An Garmin senden' }) as HTMLButtonElement).disabled).toBe(true));
    expect(a.state.puts.filter((p) => p.id.startsWith('send-'))).toHaveLength(1);
  });
});

test('manual entry writes manual-<id> with minutes in seconds and km in metres', async () => {
  const { port, map } = fakePort([rec('status', statusBody()), rec(`week-${WEEK}`, weekBody())]);
  render(<RunScreen port={port} {...ids} />);
  fireEvent.click(await screen.findByRole('button', { name: 'Lauf eintragen' }));
  const sheet = within(await screen.findByRole('dialog', { name: 'Lauf eintragen' }));
  fireEvent.change(sheet.getByLabelText('Dauer in Minuten'), { target: { value: '32' } });
  fireEvent.change(sheet.getByLabelText('Strecke in km'), { target: { value: '5,2' } });
  fireEvent.click(sheet.getByRole('button', { name: 'Mehr' }));
  fireEvent.change(sheet.getByLabelText('Puls im Schnitt (Schläge pro Minute, optional)'), { target: { value: '148' } });
  fireEvent.click(screen.getByRole('button', { name: 'Lauf speichern' }));
  await waitFor(() => expect(bodyOf(map, 'manual-u1')).toEqual({ type: 'manual', startMs: NOW, durationS: 1920, distanceM: 5200, avgHr: 148, runType: 'running' }));
  await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
});

test('the run entry sheet starts with distance and duration, today as the date, and the rest under Datum and Mehr', async () => {
  const { port } = fakePort([rec('status', statusBody())]);
  render(<RunScreen port={port} {...ids} />);
  fireEvent.click(await screen.findByRole('button', { name: 'Lauf eintragen' }));
  const sheet = within(await screen.findByRole('dialog', { name: 'Lauf eintragen' }));
  const labels = sheet.getAllByRole('textbox').map((e) => e.getAttribute('aria-label') ?? e.closest('label')?.textContent);
  expect(labels[0]).toBe('Strecke in km');
  expect(labels[1]).toBe('Dauer in Minuten');
  expect(sheet.getByRole('button', { name: /^Datum/ }).textContent).toContain('Heute');
  expect(sheet.queryByLabelText('Datum')).toBeNull();
  expect(sheet.queryByLabelText('Puls im Schnitt (Schläge pro Minute, optional)')).toBeNull();
  expect(sheet.queryByLabelText('Beginn')).toBeNull();
  fireEvent.click(sheet.getByRole('button', { name: /^Datum/ }));
  fireEvent.change(sheet.getByLabelText('Datum'), { target: { value: '2026-11-03' } });
  expect(sheet.getByRole('button', { name: /^Datum/ }).textContent).toContain('Di., 3. Nov.');
});

test('manual entry needs a duration and writes nothing otherwise', async () => {
  const { port, map, state } = fakePort([rec('status', statusBody())]);
  render(<RunScreen port={port} {...ids} />);
  fireEvent.click(await screen.findByRole('button', { name: 'Lauf eintragen' }));
  fireEvent.click(screen.getByRole('button', { name: 'Lauf speichern' }));
  await new Promise((r) => setTimeout(r, 30));
  expect(state.puts).toHaveLength(0);
  expect(map.has('run:manual-u1')).toBe(false);
});

test('on a test day the distance field reads "Strecke in den 30 Minuten"', async () => {
  const { port, map } = fakePort([rec('status', statusBody()), rec(`week-${WEEK}`, weekBody([planned({ kind: 'test', minutes: 30 })]))]);
  render(<RunScreen port={port} {...ids} />);
  fireEvent.click(await screen.findByRole('button', { name: 'Lauf eintragen' }));
  fireEvent.change(await screen.findByLabelText('Strecke in den 30 Minuten'), { target: { value: '5' } });
  fireEvent.change(screen.getByLabelText('Dauer in Minuten'), { target: { value: '30' } });
  fireEvent.click(screen.getByRole('button', { name: 'Lauf speichern' }));
  await waitFor(() => expect(bodyOf(map, 'manual-u1')).toMatchObject({ durationS: 1800, distanceM: 5000 }));
});

test('a pause status shows the calm pause text and no runs', async () => {
  const { port } = fakePort([rec('status', statusBody({ complaint: 'pause' })), rec(`week-${WEEK}`, weekBody())]);
  render(<RunScreen port={port} {...ids} />);
  expect(await screen.findByText('Laufen pausiert, solange die Beschwerde offen ist. Sobald sie vorbei ist, geht es ruhig weiter.')).toBeTruthy();
  expect(screen.queryByRole('region', { name: 'Läufe dieser Woche' })).toBeNull();
  expect(screen.queryByRole('region', { name: 'Heute' })).toBeNull();
  expect(screen.queryByRole('button', { name: 'An Garmin senden' })).toBeNull();
});

test('a gentle phase says so', async () => {
  const { port } = fakePort([rec('status', statusBody({ complaint: 'half' })), rec(`week-${WEEK}`, weekBody())]);
  render(<RunScreen port={port} {...ids} />);
  expect(await screen.findByText('Wir planen gerade sanft.')).toBeTruthy();
  cleanup();
  const b = fakePort([rec('status', statusBody()), rec('settings', { type: 'settings', on: true, weekdays: null, answers: { runsPerWeek: 2, usualMinutes: 30, pain: true } }), rec(`week-${WEEK}`, weekBody())]);
  render(<RunScreen port={b.port} {...ids} />);
  expect(await screen.findByText('Wir planen gerade sanft.')).toBeTruthy();
});

const progress = statusBody({
  numbers: {
    easyPace: { now: 372, weeks4: 384, weeks12: 400, trend: [400, null, 395, 390, 388, 386, 384, 380, 378, 376, 374, 372] },
    weeks: [{ week: '2026-10-26', km: 12.3, minutes: 90, plannedMinutes: 100 }, { week: WEEK, km: 4.5, minutes: 30, plannedMinutes: 100 }],
    longest: { blockKm: 8.5, lastBlockKm: 7 }, tests: [],
  },
});

test('Entwicklung is a row; its sheet says the easy pace in one sentence with decimal commas, and has longest run, km per week and no bars for the pace', async () => {
  const { port } = fakePort([rec('status', progress), rec(`week-${WEEK}`, weekBody())]);
  render(<RunScreen port={port} {...ids} />);
  expect(screen.queryByText(/Ruhiges Tempo bei gleichem Puls/)).toBeNull();
  fireEvent.click(await screen.findByRole('button', { name: /^Entwicklung/ }));
  const sheet = within(await screen.findByRole('dialog', { name: 'Entwicklung' }));
  expect(sheet.getByText('Du wirst schneller: 6:12 min/km, 28 Sek. schneller als vor 12 Wochen.')).toBeTruthy();
  expect(document.querySelectorAll('.tk-spark')).toHaveLength(0);
  expect(sheet.queryByText(/Ein einzelner Lauf/)).toBeNull();
  expect(sheet.queryByRole('heading', { name: 'Längster Lauf' })).toBeNull();
  fireEvent.click(sheet.getByRole('button', { name: /^Ältere Wochen/ }));
  expect(sheet.getByRole('heading', { name: 'Längster Lauf' }).closest('section')!.textContent).toContain('8,5 km');
  const km = sheet.getByRole('heading', { name: 'Kilometer pro Woche' }).closest('section')!;
  expect(km.textContent).toContain('12,3 km');
  expect(km.textContent).toContain('ab 26. Okt.');
  expect(km.textContent).not.toMatch(/\d\.\d+ km/);
});

test('the weekly look back sits in the Entwicklung sheet, newest first', async () => {
  const { port } = fakePort([rec('status', statusBody()), rec('review-2026-10-19', reviewBody({ week: '2026-10-19', km: 9 })), rec('review-2026-10-26', reviewBody({ testM: 5200 }))]);
  render(<RunScreen port={port} {...ids} />);
  fireEvent.click(await screen.findByRole('button', { name: /^Entwicklung/ }));
  const sheet = within(await screen.findByRole('dialog', { name: 'Entwicklung' }));
  fireEvent.click(sheet.getByRole('button', { name: /^Ältere Wochen/ }));
  expect(sheet.getByRole('heading', { name: 'Wochenrückblick' })).toBeTruthy();
  const items = sheet.getAllByRole('listitem').filter((li) => /km in/.test(li.textContent ?? '') && !li.querySelector('li'));
  expect(items[0]!.textContent).toContain('12,5 km');
  expect(items[1]!.textContent).toContain('9,0 km');
});

test('without numbers and reviews there is no Entwicklung row', async () => {
  const { port } = fakePort([rec('status', statusBody())]);
  render(<RunScreen port={port} {...ids} />);
  await screen.findByRole('button', { name: 'Lauf eintragen' });
  expect(screen.queryByRole('button', { name: /^Entwicklung/ })).toBeNull();
});

test('no progress without numbers', async () => {
  const { port } = fakePort([rec('status', statusBody())]);
  render(<RunScreen port={port} {...ids} />);
  await screen.findByRole('button', { name: 'Lauf eintragen' });
  expect(screen.queryByRole('heading', { name: 'Dein Fortschritt' })).toBeNull();
  expect(screen.queryByRole('heading', { name: 'Kilometer pro Woche' })).toBeNull();
});

test('RunLookBack shows reviews, newest first, only with review records', async () => {
  const { port } = fakePort([rec('status', statusBody()), rec('review-2026-10-19', reviewBody({ week: '2026-10-19', km: 9 })), rec('review-2026-10-26', reviewBody({ testM: 5200 }))]);
  render(<RunLookBack port={port} now={ids.now} />);
  expect(await screen.findByRole('heading', { name: 'Wochenrückblick' })).toBeTruthy();
  const items = screen.getAllByRole('listitem');
  expect(items[0]!.textContent).toContain('12,5 km');
  expect(items[0]!.textContent).toContain('5,2 km');
  expect(items[1]!.textContent).toContain('9,0 km');
  expect(items[0]!.textContent).toContain('Ruhig weiter.');
});

test('RunLookBack shows nothing once running is off, even with old reviews', async () => {
  for (const seed of [[rec('review-2026-10-26', reviewBody())], [rec('status', statusBody({ on: false, suggest: false })), rec('review-2026-10-26', reviewBody())]]) {
    const { port } = fakePort(seed);
    const { container } = render(<RunLookBack port={port} now={ids.now} />);
    await new Promise((r) => setTimeout(r, 30));
    expect(container.innerHTML).toBe('');
    cleanup();
  }
});

test('a visible-looking status stored under a week id is ignored (id and body type must agree)', async () => {
  expect(runView([rec('week-2026-11-02', statusBody())], NOW)).toMatchObject({ status: null, visible: false });
  expect(runView([rec('status', weekBody())], NOW)).toMatchObject({ status: null, week: null, visible: false });
  const { port } = fakePort([rec('week-2026-11-02', statusBody())]);
  const { container } = render(<RunScreen port={port} {...ids} />);
  await new Promise((r) => setTimeout(r, 30));
  expect(container.innerHTML).toBe('');
});

test('Speichern waits for at least one weekday and valid numbers', async () => {
  const { port, state } = fakePort([rec('status', statusBody({ needsAnswers: true, suggestedDays: [] })), rec('settings', { type: 'settings', on: true, weekdays: null, answers: null })]);
  render(<RunScreen port={port} {...ids} />);
  const save = (await screen.findByRole('button', { name: 'Speichern' })) as HTMLButtonElement;
  expect(save.disabled).toBe(true);
  fireEvent.click(screen.getByRole('button', { name: 'Montag' }));
  expect(save.disabled).toBe(false);
  fireEvent.change(screen.getByLabelText('Wie oft läufst du zurzeit?'), { target: { value: '' } });
  expect(save.disabled).toBe(true);
  expect(state.puts).toHaveLength(0);
});

test('the test-day label and hint follow the chosen date', async () => {
  const w = weekBody([planned({ kind: 'test', date: '2026-11-07' })]);
  const { port } = fakePort([rec('status', statusBody()), rec(`week-${WEEK}`, w)]);
  render(<RunScreen port={port} {...ids} />);
  fireEvent.click(await screen.findByRole('button', { name: 'Lauf eintragen' }));
  expect(await screen.findByLabelText('Strecke in km')).toBeTruthy();
  expect(screen.queryByText(/An diesem Tag ist ein Testlauf/)).toBeNull();
  fireEvent.click(screen.getByRole('button', { name: /^Datum/ }));
  fireEvent.change(screen.getByLabelText('Datum'), { target: { value: '2026-11-07' } });
  expect(screen.getByLabelText('Strecke in den 30 Minuten')).toBeTruthy();
  expect(screen.getByText(/An diesem Tag ist ein Testlauf/)).toBeTruthy();
  fireEvent.change(screen.getByLabelText('Datum'), { target: { value: '2026-11-04' } });
  expect(screen.getByLabelText('Strecke in km')).toBeTruthy();
});

test('no rendered text contains Rekord, Serie, Streak, musst or Pflicht', async () => {
  const states: TrackedRecord[][] = [
    [rec('status', statusBody({ on: false, suggest: true }))],
    [rec('status', statusBody({ needsAnswers: true }))],
    [rec('status', progress), rec(`week-${WEEK}`, weekBody()), rec('review-2026-10-26', reviewBody({ testM: 5000 }))],
    [rec('status', statusBody({ garmin: true, complaint: 'half', card: { runId: 'a', date: '2026-11-03', kind: 'unplanned', counted: 'Zeit zählt', result: '30 Minuten', sentence: 'Schön ruhig.' } })), rec(`week-${WEEK}`, weekBody(undefined, garminOf({ status: 'changed' })))],
    [rec('status', statusBody({ garmin: true })), rec(`week-${WEEK}`, weekBody([planned({ kind: 'test' })], garminOf({ status: 'stale' })))],
    [rec('status', statusBody({ garmin: true })), rec(`week-${WEEK}`, weekBody(undefined, garminOf({ status: 'failed', reason: 'x' })))],
    [rec('status', statusBody({ complaint: 'pause' }))],
  ];
  for (const seed of states) {
    const { port } = fakePort(seed);
    const a = render(<><RunScreen port={port} {...ids} /><RunLookBack port={port} now={ids.now} /><RunSettingsCard port={port} now={ids.now} /></>);
    await waitFor(() => expect(a.container.textContent!.length).toBeGreaterThan(40));
    await new Promise((r) => setTimeout(r, 20));
    expect(a.container.textContent).not.toMatch(BAD);
    cleanup();
  }
});

test('RunSettingsCard switches running on and off', async () => {
  const { port, map } = fakePort([]);
  render(<RunSettingsCard port={port} now={ids.now} />);
  const sw = await screen.findByRole('switch', { name: 'Laufen planen' });
  await waitFor(() => expect((sw as HTMLInputElement).disabled).toBe(false));
  expect((sw as HTMLInputElement).checked).toBe(false);
  expect(screen.getByText('Deine Läufe zählen trotzdem bei der Belastung mit.')).toBeTruthy();
  fireEvent.click(sw);
  await waitFor(() => expect(bodyOf(map, 'settings')).toMatchObject({ type: 'settings', on: true, weekdays: null, answers: null }));
  await waitFor(() => expect((screen.getByRole('switch', { name: 'Laufen planen' }) as HTMLInputElement).checked).toBe(true));
  fireEvent.click(screen.getByRole('switch', { name: 'Laufen planen' }));
  await waitFor(() => expect(bodyOf(map, 'settings')).toMatchObject({ on: false }));
  expect(map.get('run:settings')!.updatedMs).toBeGreaterThan(NOW - 1);
});

test('RunSettingsCard keeps earlier answers when switching', async () => {
  const keep = { type: 'settings', on: true, weekdays: [0, 2], answers: { runsPerWeek: 2, usualMinutes: 30, pain: false } };
  const { port, map } = fakePort([rec('settings', keep)]);
  render(<RunSettingsCard port={port} now={ids.now} />);
  const sw = await screen.findByRole('switch', { name: 'Laufen planen' });
  await waitFor(() => expect((sw as HTMLInputElement).checked).toBe(true));
  fireEvent.click(sw);
  await waitFor(() => expect(bodyOf(map, 'settings')).toEqual({ ...keep, on: false }));
});

test('after Speichern the questions close at once, before the coach answers', async () => {
  const { port, map } = fakePort([rec('status', statusBody({ needsAnswers: true })), rec('settings', { type: 'settings', on: true, weekdays: null, answers: null })]);
  render(<RunScreen port={port} {...ids} />);
  fireEvent.click(await screen.findByRole('button', { name: 'Speichern' }));
  await waitFor(() => expect(bodyOf(map, 'settings')?.weekdays).toEqual([1, 3, 5]));
  await waitFor(() => expect(screen.queryByRole('button', { name: 'Speichern' })).toBeNull());
  expect(screen.getByRole('status').textContent).toMatch(/Plan angepasst: Di, Do und Sa/);
});

test('days and answers can be changed later, starting from what was saved', async () => {
  const saved = { type: 'settings', on: true, weekdays: [0, 3], answers: { runsPerWeek: 2, usualMinutes: 40, pain: false } };
  const { port, map } = fakePort([rec('status', statusBody()), rec('settings', saved), rec(`week-${WEEK}`, weekBody())]);
  render(<RunScreen port={port} {...ids} />);
  fireEvent.click(await screen.findByRole('button', { name: /^Lauftage/ }));
  expect((screen.getByLabelText('Wie oft läufst du zurzeit?') as HTMLInputElement).value).toBe('2');
  expect((screen.getByLabelText('Wie lange dauert ein Lauf meist (Minuten)?') as HTMLInputElement).value).toBe('40');
  expect(screen.getByRole('button', { name: 'Montag' }).getAttribute('aria-pressed')).toBe('true');
  fireEvent.click(screen.getByRole('button', { name: 'Samstag' }));
  fireEvent.click(screen.getByRole('button', { name: 'Speichern' }));
  await waitFor(() => expect(bodyOf(map, 'settings')?.weekdays).toEqual([0, 3, 5]));
  expect(bodyOf(map, 'settings')?.on).toBe(true);
  await waitFor(() => expect(screen.queryByRole('button', { name: 'Speichern' })).toBeNull());
});

test('changing can be cancelled without writing', async () => {
  const saved = { type: 'settings', on: true, weekdays: [0, 3], answers: { runsPerWeek: 2, usualMinutes: 40, pain: false } };
  const { port, map } = fakePort([rec('status', statusBody()), rec('settings', saved)]);
  render(<RunScreen port={port} {...ids} />);
  fireEvent.click(await screen.findByRole('button', { name: /^Lauftage/ }));
  fireEvent.click(screen.getByRole('button', { name: 'Schließen' }));
  expect(screen.queryByRole('button', { name: 'Speichern' })).toBeNull();
  expect(map.get('run:settings')!.updatedMs).toBe(1);
});

test('the entry sheet is closed until asked for, and closes again with ×', async () => {
  const { port } = fakePort([rec('status', statusBody())]);
  render(<RunScreen port={port} {...ids} />);
  const open = await screen.findByRole('button', { name: 'Lauf eintragen' });
  expect(screen.queryByLabelText('Dauer in Minuten')).toBeNull();
  fireEvent.click(open);
  expect(screen.getByLabelText('Dauer in Minuten')).toBeTruthy();
  fireEvent.click(screen.getByRole('button', { name: 'Schließen' }));
  expect(screen.queryByLabelText('Dauer in Minuten')).toBeNull();
});

test('the feel question sits inside "Letzter Lauf", with Später as a link', async () => {
  const card = { runId: 'a', date: '2026-11-03', kind: 'unplanned' as const, counted: 'Zeit zählt', result: '30 Minuten', sentence: 'Schön ruhig.' };
  const { port } = fakePort([rec('status', statusBody({ card }))]);
  render(<RunScreen port={port} {...ids} />);
  const last = await screen.findByRole('region', { name: 'Dein letzter Lauf' });
  expect(within(last).getByText('Letzter Lauf')).toBeTruthy();
  expect(within(last).getByText(/Di\., 3\. Nov\./)).toBeTruthy();
  const q = within(last).getByRole('region', { name: 'Wie fühlte sich der Lauf an?' });
  expect(within(q).getByRole('button', { name: 'Später' }).className).toContain('link');
});

test('the pain question is a switch in the sheet "Lauftage", with all seven days in one row', async () => {
  const saved = { type: 'settings', on: true, weekdays: [0, 3], answers: { runsPerWeek: 2, usualMinutes: 40, pain: false } };
  const { port, map } = fakePort([rec('status', statusBody()), rec('settings', saved)]);
  render(<RunScreen port={port} {...ids} />);
  fireEvent.click(await screen.findByRole('button', { name: /^Lauftage/ }));
  const sheet = within(await screen.findByRole('dialog', { name: 'Lauftage' }));
  expect(sheet.getByRole('group', { name: 'An welchen Tagen möchtest du laufen?' }).querySelectorAll('button')).toHaveLength(7);
  fireEvent.click(sheet.getByRole('switch', { name: 'Hast du beim Laufen gerade Schmerzen?' }));
  fireEvent.click(sheet.getByRole('button', { name: 'Speichern' }));
  await waitFor(() => expect(bodyOf(map, 'settings')).toEqual({ ...saved, answers: { ...saved.answers, pain: true } }));
  await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
});

test('with no run ahead the page shows one week card with the days, the minutes and the pulse rule', async () => {
  const { port } = fakePort([rec('status', statusBody()), rec(`week-${WEEK}`, weekBody([planned({ date: '2026-11-03', minutes: 40 }), planned({ date: '2026-11-02', minutes: 40 })]))]);
  render(<RunScreen port={port} {...ids} />);
  const card = await screen.findByRole('region', { name: 'Diese Woche' });
  expect(card.textContent).toContain('Diese Woche: Mo und Di · 40 Min');
  expect(card.textContent).toContain('Puls bis 150');
});

test('the run entry says what is missing instead of a mute disabled button', async () => {
  const { port } = fakePort([rec('status', statusBody()), rec(`week-${WEEK}`, weekBody())]);
  render(<RunScreen port={port} {...ids} />);
  fireEvent.click(await screen.findByRole('button', { name: 'Lauf eintragen' }));
  const sheet = within(await screen.findByRole('dialog', { name: 'Lauf eintragen' }));
  expect(sheet.getByText('Strecke und Dauer fehlen.')).toBeTruthy();
  fireEvent.change(sheet.getByLabelText('Strecke in km'), { target: { value: '5' } });
  expect(sheet.getByText('Dauer fehlt.')).toBeTruthy();
});
