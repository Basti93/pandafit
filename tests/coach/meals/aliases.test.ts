import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import { MealCoach } from '../../../src/coach/meals/meal-coach';
import { RecordStore } from '../../../src/coach/tracking/store';
import { ALIASES_RECORD_ID, readAliases, SLOTS, canonName, type MealSettings } from '../../../src/shared/meals';
import type { MealAnswer } from '../../../src/coach/meals/prompt';

const PEOPLE = [{ id: 'max', name: 'Max' }];
const at = (day: number, hour: number) => new Date(2026, 10, day, hour, 0).getTime();
const ON: MealSettings = { on: true, diet: 'vegetarisch', dislikes: [], intolerances: [], habits: { fruehstueck: 'zuhause', mittag: 'zuhause', abend: 'zuhause' } };

const plan = (): MealAnswer => ({
  mahlzeiten: Array.from({ length: 7 }, (_, day) => SLOTS.map((slot) => ({
    tag: day, slot, restVon: null, titel: `Gericht ${day} ${slot}`, minuten: 15, eiweissG: 25, haltbarTage: 3, schritte: ['Zubereiten.'],
    zutaten: [{ name: day % 2 ? 'Hüttenkäse' : 'Körniger Frischkäse', menge: 100, einheit: 'g' as const, abteilung: 'Kühlregal' as const, roh: false }],
  }))).flat(),
});
const isAliasPrompt = (p: string) => p.includes('kandidaten-nur-daten');

const setup = (alias: (prompt: string) => Promise<unknown>) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'alias-'));
  const clock = { now: at(19, 9) };
  const store = new RecordStore({ dir: path.join(dir, 'tracking') });
  const ask = vi.fn(async (i: { prompt: string }) => (isAliasPrompt(i.prompt) ? alias(i.prompt) : plan()));
  const coach = new MealCoach({ dir: path.join(dir, 'meals'), nowMs: () => clock.now, profiles: () => PEOPLE, noOpenRide: () => true, ask, store, linked: () => true, trainingDays: () => [] });
  coach.setSettings('max', ON);
  const aliasCalls = () => ask.mock.calls.filter((c) => isAliasPrompt(c[0].prompt));
  const stored = () => readAliases(store.all('max', 'mealplan').find((r) => r.id === ALIASES_RECORD_ID && !r.deleted)?.body);
  return { coach, clock, aliasCalls, stored };
};
const SAME = { paare: [{ name: 'Hüttenkäse', gleichwie: canonName('Körniger Frischkäse') }] };

describe('the coach learns aliases while it plans', () => {
  it('asks once in a batch, stores the answer and syncs it as a record', async () => {
    const { coach, aliasCalls, stored } = setup(async () => SAME);
    await coach.tick();
    expect(aliasCalls()).toHaveLength(1);
    const prompt = aliasCalls()[0]![0].prompt;
    expect(prompt).toContain('Hüttenkäse');
    expect(stored()).toEqual({ [canonName('Hüttenkäse')]: canonName('Körniger Frischkäse') });
  });

  it('never asks again for a known name', async () => {
    const { coach, clock, aliasCalls } = setup(async () => SAME);
    await coach.tick();
    clock.now = at(20, 9);
    await coach.tick();
    expect(aliasCalls()).toHaveLength(1);
  });

  it('survives a restart: the map and the asked names are on disk', async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'alias-'));
    const mk = () => new MealCoach({ dir: path.join(dir, 'meals'), nowMs: () => at(19, 9), profiles: () => PEOPLE, noOpenRide: () => true, ask: async (i) => (isAliasPrompt(i.prompt) ? SAME : plan()), store: new RecordStore({ dir: path.join(dir, 'tracking') }), linked: () => true });
    const a = mk();
    a.setSettings('max', ON);
    await a.tick();
    expect(JSON.parse(fs.readFileSync(path.join(dir, 'meals', 'household.json'), 'utf8')).aliases).toEqual({ [canonName('Hüttenkäse')]: canonName('Körniger Frischkäse') });
  });

  it('AI failure changes nothing and the names are asked again next time', async () => {
    let fail = true;
    const { coach, clock, aliasCalls, stored } = setup(async () => { if (fail) throw new Error('offline'); return SAME; });
    await coach.tick();
    expect(stored()).toEqual({});
    fail = false;
    clock.now = at(20, 9);
    await coach.tick();
    expect(aliasCalls()).toHaveLength(2);
    expect(Object.keys(stored())).toHaveLength(1);
  });

  it('bad answers are ignored: unknown key, unknown name, chains, nonsense', async () => {
    const { coach, stored } = setup(async () => ({ paare: [
      { name: 'Hüttenkäse', gleichwie: 'gibt es nicht' },
      { name: 'Unbekannt', gleichwie: canonName('Körniger Frischkäse') },
      { name: 'Körniger Frischkäse', gleichwie: canonName('Körniger Frischkäse') },
    ] }));
    await coach.tick();
    expect(stored()).toEqual({});
    const b = setup(async () => 'quatsch');
    await b.coach.tick();
    expect(b.stored()).toEqual({});
  });

  it('without an AI nothing is asked and nothing changes', async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'alias-'));
    const store = new RecordStore({ dir: path.join(dir, 'tracking') });
    const coach = new MealCoach({ dir: path.join(dir, 'meals'), nowMs: () => at(19, 9), profiles: () => PEOPLE, noOpenRide: () => true, store, linked: () => true });
    coach.setSettings('max', ON);
    await coach.tick();
    expect(store.all('max', 'mealplan').some((r) => r.id === ALIASES_RECORD_ID && !r.deleted)).toBe(false);
  });
});
