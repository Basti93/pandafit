// @vitest-environment jsdom
import 'fake-indexeddb/auto';
import { cleanup, fireEvent, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { openIdb } from '../../../src/web/idbStore';
import { dayIndex, weekOf } from '../../../src/shared/meals';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { MealCoach } from '../../../src/coach/meals/meal-coach';
import { MEAL_SYSTEM_PROMPT } from '../../../src/coach/meals/prompt';
import { RecordStore } from '../../../src/coach/tracking/store';
import { NOW, boot } from './helpers';

afterEach(cleanup);

const week = weekOf(NOW);
const today = dayIndex(NOW);

describe('Essen on the phone with the coach on the Mac', () => {
  it('a message to the coach: written as a record, waiting until the Mac answers, then the reply and the change for both', async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'phone-chat-'));
    const store = new RecordStore({ dir: path.join(dir, 'tracking') });
    const ON = { on: true, diet: 'vegetarisch', dislikes: [], intolerances: [], habits: { fruehstueck: 'zuhause', mittag: 'mitnehmen', abend: 'zuhause' } };
    const mac = new MealCoach({
      dir: path.join(dir, 'meals'), nowMs: () => NOW + 60_000, profiles: () => [{ id: 'pa', name: 'Max' }, { id: 'pb', name: 'Lena' }], noOpenRide: () => true, random: () => 0.5,
      store, linked: () => true,
      ask: async (i) => {
        if (i.systemPrompt === MEAL_SYSTEM_PROMPT) throw new Error('rules only');
        return { antwort: 'Heute Abend gibt es Nudeln.', abneigungenMerken: [], aenderungen: [{ art: 'gericht', tag: today, slot: 'abend', zutatAlt: null, zutatNeu: null, schritte: null, titel: null,
          gericht: { titel: 'Nudeln mit Tomatensoße und Linsen', minuten: 20, eiweissG: 24, haltbarTage: 1, schritte: ['Nudeln kochen.', 'Soße erhitzen.'], zutaten: [{ name: 'Vollkornnudeln', menge: 90, einheit: 'g', abteilung: 'Vorrat', roh: false }] } }] };
      },
    });
    mac.setSettings('pa', ON);
    mac.setSettings('pb', ON);
    await mac.replan('pa', week);
    const a = await boot({ account: 'anna', seed: store.all('pb') });
    fireEvent.click(await screen.findByRole('button', { name: 'Essen' }));
    fireEvent.click(await screen.findByRole('button', { name: 'Plan ändern' }));
    fireEvent.change(await screen.findByLabelText('Nachricht an Bo'), { target: { value: 'Heute Abend lieber was mit Nudeln' } });
    fireEvent.click(screen.getByRole('button', { name: 'Senden' }));
    expect(await screen.findByText('Dein Wunsch ist bei Bo angekommen.')).toBeTruthy();
    expect(await screen.findByText('Bo antwortet gleich. Ist der Mac aus, dauert es, bis er wieder an ist.')).toBeTruthy();
    expect(screen.getByText(/Heute Abend lieber was mit Nudeln/)).toBeTruthy();
    // Through the account to the Mac, which answers at its next tick.
    const phone = await openIdb('anna', a.factory);
    const sent = (await phone.list('mealplan')).filter((r) => r.id.startsWith('chat-'));
    phone.close();
    expect(sent).toHaveLength(1);
    store.putMany('pb', sent, 'remote');
    await mac.tick();
    expect(mac.view('pb').chat[0]).toMatchObject({ text: 'Heute Abend lieber was mit Nudeln', reply: 'Heute Abend gibt es Nudeln.' });
    // And back to the phone with the plan: Lena sees the reply, Max's copy shows the change and who asked.
    cleanup();
    await boot({ account: 'anna', seed: store.all('pb') });
    fireEvent.click(await screen.findByRole('button', { name: 'Essen' }));
    fireEvent.click(await screen.findByRole('button', { name: 'Plan ändern' }));
    expect(await screen.findByText('Heute Abend gibt es Nudeln.')).toBeTruthy();
    expect(screen.queryByText('Bo antwortet gleich. Ist der Mac aus, dauert es, bis er wieder an ist.')).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Schließen' }));
    fireEvent.click(screen.getByRole('button', { name: /Nudeln mit Tomatensoße und Linsen/ }));
    expect(await screen.findByText('Auf Wunsch von Lena.')).toBeTruthy();
    expect(store.all('pa').some((r) => r.id.startsWith('chat-'))).toBe(false);
  });

});
