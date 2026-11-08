// @vitest-environment jsdom
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { CoachTasks } from '../../src/coach/coach-tasks';
import { RecordStore } from '../../src/coach/tracking/store';
import { dayHeading, timeLabel } from '../../src/shared/dates';
import { applyRecord, type TrackedRecord } from '../../src/shared/records';
import { openTasks, readTask, taskId, taskRecord } from '../../src/shared/tasks';
import { readable } from '../../src/web/validate';
import { openChat } from '../tracking/open-chat';
import { CoachScreen } from '../../src/tracking/ui/CoachScreen';
import { fakePort } from '../tracking/fake-port';

afterEach(cleanup);
const DAY = 86_400_000;
const NOW = new Date(2026, 10, 7, 14, 5).getTime();
let n = 0;
const env = { now: () => NOW, newId: () => `id${++n}` };
const at = (daysAgo: number, h: number, m = 0) => { const d = new Date(NOW); d.setDate(d.getDate() - daysAgo); d.setHours(h, m, 0, 0); return d.getTime(); };
const msg = (id: string, role: 'rider' | 'coach', text: string, atMs: number): TrackedRecord => ({ kind: 'chat', id, updatedMs: atMs, deleted: false, body: { role, text, atMs } });

describe('dates', () => {
  it('German day headings and 24h times', () => {
    expect(dayHeading(at(0, 9), NOW)).toBe('Heute');
    expect(dayHeading(at(1, 23, 59), NOW)).toBe('Gestern');
    expect(dayHeading(new Date(2026, 10, 3, 12).getTime(), NOW)).toBe('Di., 3. Nov.');
    expect(timeLabel(new Date(2026, 10, 7, 14, 5).getTime())).toBe('14:05');
    expect(timeLabel(new Date(2026, 10, 7, 9, 3).getTime())).toBe('09:03');
  });
});

describe('week chat', () => {
  it('has a separator per day and a time on each message', async () => {
    const { port } = fakePort([msg('a', 'rider', 'Alt', at(5, 8, 30)), msg('b', 'coach', 'Gestern Antwort', at(1, 19, 45)), msg('c', 'rider', 'Heute Frage', at(0, 13, 7))]);
    render(<CoachScreen port={port} {...env} />);
    await openChat();
    const chat = within(await screen.findByRole('region', { name: 'Unterhaltung mit dem Coach' }));
    await chat.findByText('Heute Frage');
    expect(chat.getAllByRole('separator').map((e) => e.textContent)).toEqual([dayHeading(at(5, 8), NOW), 'Gestern', 'Heute']);
    expect(chat.getByText('08:30')).toBeTruthy();
    expect(chat.getByText('19:45')).toBeTruthy();
    expect(chat.getByText('13:07')).toBeTruthy();
  });

  it('shows the newest 30 and "Ältere anzeigen" adds 30 more', async () => {
    const rows = Array.from({ length: 75 }, (_, i) => msg(`m${String(i).padStart(2, '0')}`, 'rider', `Nachricht ${i}`, NOW - (75 - i) * 60_000));
    const { port } = fakePort(rows);
    render(<CoachScreen port={port} {...env} />);
    await openChat();
    const chat = within(await screen.findByRole('region', { name: 'Unterhaltung mit dem Coach' }));
    await chat.findByText('Nachricht 74');
    expect(chat.getAllByText(/^Nachricht \d+$/)).toHaveLength(30);
    expect(chat.queryByText('Nachricht 44')).toBeNull();
    fireEvent.click(chat.getByRole('button', { name: 'Ältere anzeigen' }));
    expect(chat.getAllByText(/^Nachricht \d+$/)).toHaveLength(60);
    expect(chat.getByText('Nachricht 15')).toBeTruthy();
    fireEvent.click(chat.getByRole('button', { name: 'Ältere anzeigen' }));
    expect(chat.getAllByText(/^Nachricht \d+$/)).toHaveLength(75);
    expect(chat.queryByRole('button', { name: 'Ältere anzeigen' })).toBeNull();
  });
});

describe('forwarded requests on the week page', () => {
  const rec = (from: 'chat' | 'bike', to: 'gym' | 'run', text: string, lasting: boolean, atMs: number) => taskRecord({ from, to, text, lasting, atMs }, atMs);

  it('lists open tasks with the coach and the end, removes with a tombstone, hides expired ones', async () => {
    const { port, map } = fakePort([rec('chat', 'gym', 'Nur eine Trizepsübung', false, NOW - DAY), rec('bike', 'run', 'Beine schonen', true, NOW - 2 * DAY), rec('chat', 'gym', 'Uralt', false, NOW - 29 * DAY)]);
    render(<CoachScreen port={port} {...env} />);
    fireEvent.click(await screen.findByRole('button', { name: /^Regeln/ }));
    const list = within(await screen.findByRole('list', { name: 'Regeln' }));
    const row = (re: RegExp) => list.getByRole('button', { name: re });
    expect(row(/Nur eine Trizepsübung/).textContent).toContain('für Kraft');
    expect(row(/Beine schonen/).textContent).toContain('für Laufen');
    expect(list.queryByText(/Uralt/)).toBeNull();
    fireEvent.click(row(/Beine schonen/));
    expect(list.getByText('dauerhaft')).toBeTruthy();
    fireEvent.click(row(/Nur eine Trizepsübung/));
    expect(list.getByText('bis zur nächsten Einheit')).toBeTruthy();
    expect(list.queryByText('dauerhaft')).toBeNull(); // only one row is open
    fireEvent.click(list.getByRole('button', { name: 'Entfernen' }));
    fireEvent.click(list.getByRole('button', { name: 'Ja' }));
    await waitFor(() => expect(list.queryByText(/Trizepsübung/)).toBeNull());
    const gone = [...map.values()].find((r) => r.kind === 'task' && (r.body as { text: string }).text === 'Nur eine Trizepsübung')!;
    expect(gone.deleted).toBe(true);
    expect(readable(gone)).toBe(true);
  });

  it('task records are valid and readable', () => {
    const r = rec('chat', 'gym', 'Text', false, NOW);
    expect(readTask(r.body)).toMatchObject({ from: 'chat', to: 'gym' });
    expect(readTask({ ...(r.body as object), to: 'meals' })).toBeNull();
    expect(readable(r)).toBe(true);
    expect(openTasks([r], NOW + 29 * DAY)).toEqual([]);
  });
});

describe('coach task board on records', () => {
  let tmp: string;
  beforeEach(() => { tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'tasks-h-')); });
  afterEach(() => fs.rmSync(tmp, { recursive: true, force: true }));
  const file = () => path.join(tmp, 'chat', 'tasks.json');
  const legacy = (tasks: object) => { fs.mkdirSync(path.dirname(file()), { recursive: true }); fs.writeFileSync(file(), JSON.stringify(tasks)); };
  const oldTasks = {
    p1: { tasks: [{ from: 'chat', to: 'gym', text: 'Mehr Beine', lasting: true, atMs: NOW - DAY }, { from: 'bike', to: 'run', text: 'Locker', lasting: false, atMs: NOW - 29 * DAY }], versions: { gym: 3 } },
    p2: { tasks: [{ from: 'run', to: 'bike', text: 'Rad ruhig', lasting: false, atMs: NOW - DAY }], versions: {} },
  };

  it('migrates once for both profiles: stamped 1, deterministic ids, expired skipped, old file removed after writing', () => {
    legacy(oldTasks);
    const store = new RecordStore({ dir: path.join(tmp, 'tracking') });
    const t = new CoachTasks(file(), store, () => NOW);
    expect(fs.existsSync(file())).toBe(false);
    const p1 = store.all('p1', 'task'), p2 = store.all('p2', 'task');
    expect(p1).toHaveLength(1);
    expect(p2).toHaveLength(1);
    expect(p1[0]!.updatedMs).toBe(1);
    expect(p1[0]!.id).toBe(taskId({ from: 'chat', to: 'gym', text: 'Mehr Beine', atMs: NOW - DAY }));
    expect(t.open('p1', 'gym', NOW).map((x) => x.text)).toEqual(['Mehr Beine']);
    // A second Mac with the same file arrives at the same records.
    legacy(oldTasks);
    const store2 = new RecordStore({ dir: path.join(tmp, 'tracking2') });
    new CoachTasks(file(), store2, () => NOW);
    expect(store2.all('p1', 'task').map((r) => r.id)).toEqual(p1.map((r) => r.id));
    // And a rerun on the first adds nothing.
    legacy(oldTasks);
    new CoachTasks(file(), store, () => NOW);
    expect(store.all('p1', 'task')).toHaveLength(1);
  });

  it('keeps the old file while a write fails, and a removed task is not brought back', () => {
    legacy(oldTasks);
    const failing = { all: () => [], put: () => { throw new Error('disk'); } };
    new CoachTasks(file(), failing as never, () => NOW);
    expect(fs.existsSync(file())).toBe(true);
    // The person removed it elsewhere (a tombstone is newer than the migrated stamp 1).
    const store = new RecordStore({ dir: path.join(tmp, 'tracking') });
    const id = taskId({ from: 'chat', to: 'gym', text: 'Mehr Beine', atMs: NOW - DAY });
    store.put('p1', { ...taskRecord({ from: 'chat', to: 'gym', text: 'Mehr Beine', lasting: true, atMs: NOW - DAY }, 5), deleted: true, updatedMs: 5 });
    new CoachTasks(file(), store, () => NOW);
    expect(store.all('p1', 'task').find((r) => r.id === id)!.deleted).toBe(true);
    // Sync order does not matter: a migrated record never beats the tombstone.
    const live = taskRecord({ from: 'chat', to: 'gym', text: 'Mehr Beine', lasting: true, atMs: NOW - DAY }, NOW, true);
    expect(applyRecord(store.all('p1', 'task').find((r) => r.id === id), live).keep.deleted).toBe(true);
  });

  it('a rider task bumps the plan key of its coach only; a coach task does not; removal does', () => {
    const store = new RecordStore({ dir: path.join(tmp, 'tracking') });
    const t = new CoachTasks(file(), store, () => NOW);
    const k0 = t.version('p', 'gym');
    t.add('p', { from: 'bike', to: 'gym', text: 'Beine schonen', lasting: false }, NOW);
    expect(t.version('p', 'gym')).toBe(k0);
    t.add('p', { from: 'chat', to: 'gym', text: 'Nur Trizeps', lasting: false }, NOW + 1);
    const k1 = t.version('p', 'gym');
    expect(k1).not.toBe(k0);
    expect(t.version('p', 'bike')).toBe(k0);
    const mine = store.all('p', 'task').find((r) => (r.body as { from: string }).from === 'bike')!;
    store.put('p', { ...mine, deleted: true, updatedMs: NOW + 5 });
    expect(t.version('p', 'gym')).not.toBe(k1);
    expect(t.open('p', 'gym', NOW + 2).map((x) => x.text)).toEqual(['Nur Trizeps']);
  });
});
