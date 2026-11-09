// @vitest-environment jsdom
import 'fake-indexeddb/auto';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { ruleRecord } from '../../src/shared/personal';
import type { GymWorkout } from '../../src/shared/gym/types';
import type { TrackedRecord } from '../../src/shared/records';
import { planKeyOf, readDraft, writeDraft, type DraftStorage } from '../../src/tracking/plan-draft';
import { WorkoutScreen } from '../../src/tracking/ui/WorkoutScreen';
import { exercisesSentence, routinesSentence } from '../../src/tracking/ui/kraft-view';
import { gymLine } from '../../src/tracking/ui/plan-text';
import { NOW, boot, plan as planRec } from '../web/app/helpers';
import { fakePort } from './fake-port';

afterEach(cleanup);

const set = (weightKg: number | null, reps: number) => ({ type: 'normal' as const, weightKg, reps });
const plan: GymWorkout = { name: 'Pull', exercises: [
  { templateId: 'pf-lat-pulldown', title: 'Latzug', restS: null, supersetId: null, notes: '', sets: [set(50, 10), set(50, 10)] },
] };
const meta = { atMs: NOW - 3_600_000, reason: 'Rücken steht im Fokus.', note: null, outlook: null };
const KEY = planKeyOf({ atMs: meta.atMs, workout: plan });
const memory = (): DraftStorage => {
  const m = new Map<string, string>();
  return { getItem: (k) => m.get(k) ?? null, setItem: (k, v) => { m.set(k, v); }, removeItem: (k) => { m.delete(k); } };
};
const ids = { now: () => NOW, newId: () => 'id-1' };
const routine = (id: string, name: string): TrackedRecord => ({ kind: 'routine', id, updatedMs: 1, deleted: false, body: { name, exercises: [] } });
const openWorkout = (id: string, title: string, startMs: number): TrackedRecord => ({ kind: 'workout', id, updatedMs: startMs, deleted: false, body: { id, title, startMs, endMs: null, source: 'pandafit', exercises: [] } });
const show = (seed: TrackedRecord[] = [], o: { plan?: GymWorkout | null; storage?: DraftStorage } = {}) => {
  const f = fakePort(seed);
  const storage = o.storage ?? memory();
  render(<WorkoutScreen port={f.port} plan={o.plan === undefined ? plan : o.plan} planMeta={meta} account="mira" storage={storage} {...ids} />);
  return { f, storage };
};
const before = (a: HTMLElement, b: HTMLElement) => (a.compareDocumentPosition(b) & Node.DOCUMENT_POSITION_FOLLOWING) !== 0;

describe('Kraft start', () => {
  it('shows the week stand, the next workout as the main card, studio and Anderes Training as pills, Bo and two tiles', async () => {
    await boot({ account: 'anna', seed: [planRec(NOW - 1000)] });
    fireEvent.click(await screen.findByRole('button', { name: 'Kraft' }));
    const stand = await screen.findByRole('region', { name: 'Kraft · diese Woche' });
    const main = await screen.findByRole('region', { name: 'Nächstes Training' });
    expect(before(stand, main)).toBe(true);
    expect(main.textContent).toContain('Krafttraining, etwa');
    expect(within(main).getByRole('button', { name: 'Training starten' }).className).toBe('primary');
    expect(within(main).getByRole('button', { name: 'Ansehen' }).className).toBe('secondary');
    expect(screen.getByRole('button', { name: /^Studio / })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Anderes Training' })).toBeTruthy();
    expect(screen.getByRole('button', { name: /Deine Routinen/ })).toBeTruthy();
    expect(screen.getByRole('button', { name: /Deine Übungen/ })).toBeTruthy();
    expect(screen.queryByRole('group', { name: 'Kraft' })).toBeNull();
    expect(document.querySelectorAll('.tk-screen button:not([class])')).toHaveLength(0);
  });

  it('Deine Übungen is a page with a back pill; Kraft comes back', async () => {
    await boot({ account: 'anna', seed: [planRec(NOW - 1000)] });
    fireEvent.click(await screen.findByRole('button', { name: 'Kraft' }));
    fireEvent.click(await screen.findByRole('button', { name: /Deine Übungen/ }));
    expect(await screen.findByRole('heading', { level: 1, name: 'Deine Übungen' })).toBeTruthy();
    expect(await screen.findByRole('heading', { name: 'Anleitungen nachschlagen' })).toBeTruthy();
    fireEvent.click(screen.getAllByRole('button', { name: 'Kraft' }).find((b) => b.className.includes('tk-pill'))!);
    expect(await screen.findByRole('region', { name: 'Nächstes Training' })).toBeTruthy();
  });

  it('Deine Routinen is a page; starting a routine goes back to Kraft and runs it', async () => {
    await boot({ account: 'anna', seed: [planRec(NOW - 1000), routine('r1', 'Hotel')] });
    fireEvent.click(await screen.findByRole('button', { name: 'Kraft' }));
    fireEvent.click(await screen.findByRole('button', { name: /Deine Routinen/ }));
    expect(await screen.findByRole('heading', { level: 1, name: 'Deine Routinen' })).toBeTruthy();
    fireEvent.click(await screen.findByRole('button', { name: /Hotel/ }));
    fireEvent.click(await screen.findByRole('button', { name: 'Training starten' }));
    expect(await screen.findByRole('button', { name: 'Training beenden' })).toBeTruthy();
    expect(screen.queryByRole('heading', { name: 'Deine Routinen' })).toBeNull();
  });

  it('without a plan the main button is Leeres Training starten; Anderes Training only with routines', async () => {
    show([], { plan: null });
    const main = await screen.findByRole('region', { name: 'Freies Training' });
    expect(within(main).getByRole('button', { name: 'Leeres Training starten' }).className).toBe('primary');
    expect(screen.queryByRole('button', { name: 'Anderes Training' })).toBeNull();
    cleanup();
    show([routine('r1', 'Hotel')], { plan: null });
    expect(await screen.findByRole('button', { name: 'Anderes Training' })).toBeTruthy();
  });

  it('Anderes Training lists the routines and Leeres Training starten', async () => {
    show([routine('r1', 'Hotel')]);
    fireEvent.click(await screen.findByRole('button', { name: 'Anderes Training' }));
    const sheet = await screen.findByRole('dialog', { name: 'Anderes Training' });
    expect(within(sheet).getByRole('button', { name: 'Hotel starten' })).toBeTruthy();
    expect(within(sheet).getByRole('button', { name: 'Leeres Training starten' })).toBeTruthy();
  });

  it('an adjusted plan says so in the card and Zurücksetzen drops the draft', async () => {
    const storage = memory();
    writeDraft(storage, 'mira', KEY, { ...plan, exercises: plan.exercises.map((e) => ({ ...e, sets: [...e.sets, set(50, 10)] })), startMs: NOW, id: 'd' } as never);
    show([], { storage });
    const main = await screen.findByRole('region', { name: 'Nächstes Training' });
    expect(main.textContent).toContain('Du hast den Plan angepasst.');
    fireEvent.click(within(main).getByRole('button', { name: 'Zurücksetzen' }));
    await waitFor(() => expect(readDraft(storage, 'mira', KEY)).toBeNull());
    expect(main.textContent).not.toContain('Du hast den Plan angepasst.');
  });

  it('the plan reason is in Bo’s bubble, not in the card', async () => {
    show();
    const main = await screen.findByRole('region', { name: 'Nächstes Training' });
    expect(main.textContent).not.toContain('Rücken steht im Fokus.');
    expect(document.querySelector('.tk-bo')!.textContent).toContain('Rücken steht im Fokus.');
  });

  it('an open workout is the main card Läuft noch with Weitermachen; verwerfen asks first', async () => {
    const { f } = show([openWorkout('w1', 'Pull', NOW - 600_000)]);
    const main = await screen.findByRole('region', { name: 'Läuft noch' });
    expect(within(main).getByRole('button', { name: 'Weitermachen' }).className).toBe('primary');
    fireEvent.click(within(main).getByRole('button', { name: 'Training verwerfen' }));
    expect(f.map.get('workout:w1')!.deleted).toBe(false);
    fireEvent.click(within(main).getByRole('button', { name: 'Ja' }));
    await waitFor(() => expect(f.map.get('workout:w1')!.deleted).toBe(true));
  });

  it('a second open workout is a row card with the suffixed actions in a sheet', async () => {
    show([openWorkout('w1', 'Pull', NOW - 600_000), openWorkout('w2', 'Beine', NOW - 90_000_000)]);
    await screen.findByRole('region', { name: 'Läuft noch' });
    fireEvent.click(screen.getByRole('button', { name: /Beine/ }));
    const sheet = await screen.findByRole('dialog');
    expect(within(sheet).getByRole('button', { name: /^Weitermachen Beine / })).toBeTruthy();
    expect(within(sheet).getByRole('button', { name: /^Training beenden Beine / })).toBeTruthy();
  });
});

describe('plan and routine', () => {
  it('after a routine workout is discarded Kraft shows the plan again', async () => {
    await boot({ account: 'anna', seed: [planRec(NOW - 1000), routine('r1', 'Hotel')] });
    fireEvent.click(await screen.findByRole('button', { name: 'Kraft' }));
    fireEvent.click(await screen.findByRole('button', { name: /Deine Routinen/ }));
    fireEvent.click(await screen.findByRole('button', { name: /Hotel/ }));
    fireEvent.click(await screen.findByRole('button', { name: 'Training starten' }));
    fireEvent.click(await screen.findByRole('button', { name: 'Mehr zum Training' }));
    fireEvent.click(await screen.findByRole('button', { name: 'Training verwerfen' }));
    fireEvent.click(await screen.findByRole('button', { name: 'Ja' }));
    expect(await screen.findByRole('region', { name: 'Nächstes Training' })).toBeTruthy();
    expect(screen.queryByRole('region', { name: 'Freies Training' })).toBeNull();
  });

  it('Heute and Kraft count the same exercises when a rule rules one out', async () => {
    const base = planRec(NOW - 1000);
    const w = (base.body as { workout: GymWorkout }).workout;
    const two = { ...base, body: { ...(base.body as object), workout: { ...w, exercises: [w.exercises[0]!, { ...w.exercises[0]!, templateId: 'pf-deadlift', title: 'Kreuzheben' }] } } } as TrackedRecord;
    const rule = ruleRecord('r1', { kind: 'exclude', text: 'Ohne Kreuzheben', sport: 'gym', exerciseIds: ['pf-deadlift'] }, 'active', 'person', NOW - 1000);
    const { mondayOf, weekDates } = await import('../../src/shared/week-plan');
    const { dateKey } = await import('../../src/shared/day-rating');
    const monday = mondayOf(dateKey(NOW));
    const week = { kind: 'weekplan', id: monday, updatedMs: 1, deleted: false, body: { weekStart: monday, fromMessage: 'm', acceptedMs: 1, days: weekDates(monday).map((date) => ({ date, sport: 'gym', hardness: 'moderate', fixed: false })) } } as TrackedRecord;
    await boot({ account: 'anna', seed: [two, rule, week] });
    const heute = await screen.findByText(/^Krafttraining, etwa \d+ Minuten, \d Übungen?$/);
    fireEvent.click(screen.getByRole('button', { name: 'Kraft' }));
    const main = await screen.findByRole('region', { name: 'Nächstes Training' });
    const kraft = within(main).getByText(/^Krafttraining, etwa/).textContent;
    expect(heute.textContent).toContain('1 Übung');
    expect(kraft).toBe(heute.textContent);
  });
});

describe('kraft-view and gymLine', () => {
  it('says the sentences', () => {
    expect(routinesSentence(0)).toBe('Leg feste Abläufe an, zum Beispiel für das Hotel.');
    expect(routinesSentence(1)).toBe('Ein fester Ablauf liegt bereit.');
    expect(routinesSentence(2)).toBe('Zwei feste Abläufe liegen bereit.');
    expect(exercisesSentence(new Map([['a', 'steigt'], ['b', 'steigt'], ['c', 'steigt'], ['d', 'gleich']]))).toBe('Bei den meisten Übungen wirst du gerade stärker.');
    expect(exercisesSentence(new Map([['a', 'steigt'], ['b', 'gleich']]))).toBe('Deine Übungen halten gerade ihr Niveau.');
    expect(exercisesSentence(new Map())).toBe('Hier findest du alle Übungen mit Anleitung.');
  });
  it('gymLine counts the exercises, one is singular, none is null', () => {
    expect(gymLine(plan)).toMatch(/^Krafttraining, etwa \d+ Minuten, 1 Übung$/);
    expect(gymLine({ exercises: [] })).toBeNull();
  });
});
