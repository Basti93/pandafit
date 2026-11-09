// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { ConnectionSettings } from '../../src/web/ConnectionSettings';
import { CoachLink } from '../../src/web/coachLink';
import type { LiveSocket } from '../../src/web/live';

class FakeSocket implements LiveSocket {
  sent: Record<string, unknown>[] = [];
  closed = false;
  onopen: (() => void) | null = null;
  onmessage: ((e: { data: unknown }) => void) | null = null;
  onclose: (() => void) | null = null;
  onerror: (() => void) | null = null;
  send(d: string) { this.sent.push(JSON.parse(d) as Record<string, unknown>); }
  close() { this.closed = true; }
  say(m: unknown) { this.onmessage?.({ data: JSON.stringify(m) }); }
}

const flush = () => act(async () => { await new Promise((r) => setTimeout(r, 0)); });
const meals = (on: boolean) => ({ on, diet: 'vegetarisch', dislikes: [], intolerances: [], habits: { fruehstueck: 'zuhause', mittag: 'mitnehmen', abend: 'zuhause' } });
const coachState = (over: Record<string, unknown> = {}) => ({ type: 'coach-state', state: {}, thinking: false, together: {}, gym: null, meals: { settings: meals(false) }, ...over });

const setup = async (status: { profileId: string | null; moved: boolean } | null = { profileId: 'p1', moved: true }) => {
  const ws = new FakeSocket();
  const link = new CoachLink({ open: () => ws, status: async () => status });
  render(<ConnectionSettings link={link} plan={null} hasBike={false} />);
  await flush();
  return { ws, link };
};
afterEach(cleanup);

describe('ConnectionSettings on the web Profil', () => {
  it('shows nothing for an account whose coach is not on the server', async () => {
    const { ws } = await setup({ profileId: 'p1', moved: false });
    expect(ws.sent).toEqual([]);
    expect(screen.queryByText('Hevy')).toBeNull();
  });

  it('subscribes with the profile the coach names and shows the state', async () => {
    const { ws } = await setup();
    act(() => { ws.onopen?.(); });
    expect(ws.sent).toEqual([{ type: 'subscribe', profileId: 'p1' }]);
    act(() => ws.say(coachState({ hevy: { state: 'connected', workouts: 12, loading: false, lastSyncMs: null } })));
    expect(screen.getByText('Hevy').parentElement?.textContent).toContain('verbunden');
    expect(screen.getByText('Garmin').parentElement?.textContent).toContain('optional');
  });

  it('connects Hevy with a key and never keeps the key in the field', async () => {
    const { ws } = await setup();
    act(() => { ws.onopen?.(); ws.say(coachState()); });
    fireEvent.click(screen.getByText('Hevy'));
    fireEvent.change(screen.getByLabelText('Hevy-Schlüssel'), { target: { value: ' abc-123 ' } });
    fireEvent.click(screen.getByRole('button', { name: 'Verbinden' }));
    expect(ws.sent.at(-1)).toEqual({ type: 'hevy-connect', key: 'abc-123', profileId: 'p1' });
    expect((screen.getByLabelText('Hevy-Schlüssel') as HTMLInputElement).value).toBe('');
  });

  it('logs in to Garmin and answers the code', async () => {
    const { ws } = await setup();
    act(() => { ws.onopen?.(); ws.say(coachState()); });
    fireEvent.click(screen.getByText('Garmin'));
    fireEvent.change(screen.getByLabelText('Garmin-E-Mail'), { target: { value: 'a@example.org' } });
    fireEvent.change(screen.getByLabelText('Garmin-Passwort'), { target: { value: 'pw' } });
    fireEvent.click(screen.getByRole('button', { name: 'Verbinden' }));
    expect(ws.sent.at(-1)).toEqual({ type: 'garmin-login', email: 'a@example.org', password: 'pw', profileId: 'p1' });
    act(() => ws.say(coachState({ garmin: { state: 'needs-mfa' } })));
    fireEvent.change(screen.getByLabelText('Zwei-Faktor-Code'), { target: { value: '123456' } });
    fireEvent.click(screen.getByRole('button', { name: 'Code senden' }));
    expect(ws.sent.at(-1)).toEqual({ type: 'garmin-mfa', code: '123456', profileId: 'p1' });
  });

  it('starts strength training once, and turns the meal plan on and off', async () => {
    const { ws } = await setup();
    act(() => { ws.onopen?.(); ws.say(coachState()); });
    fireEvent.click(screen.getByRole('switch', { name: 'Krafttraining planen' }));
    expect(ws.sent.at(-1)).toEqual({ type: 'gym-start', profileId: 'p1' });
    fireEvent.click(screen.getByRole('switch', { name: 'Essensplan' }));
    expect(ws.sent.at(-1)).toMatchObject({ type: 'meals-settings', profileId: 'p1', settings: { on: true, diet: 'vegetarisch' } });
    expect(screen.queryByText('Essen anpassen')).toBeNull();
    act(() => ws.say(coachState({ gym: { state: {} }, meals: { settings: meals(true) } })));
    // Once on, it is a plain line, not a switch that looks broken.
    expect(screen.queryByRole('switch', { name: 'Krafttraining planen' })).toBeNull();
    expect(screen.getByText('Dein Krafttraining wird immer geplant. Rad geht mit der ersten Fahrt am Mac los.')).toBeTruthy();
    fireEvent.click(screen.getByText('Essen anpassen'));
    fireEvent.change(screen.getByLabelText('Abneigungen'), { target: { value: 'Pilze, Oliven' } });
    fireEvent.click(screen.getByRole('button', { name: 'Speichern' }));
    expect(ws.sent.at(-1)).toMatchObject({ type: 'meals-settings', settings: { on: true, dislikes: ['Pilze', 'Oliven'] } });
  });

  it('shows how big the recipe collection is inside Essen anpassen: before and after it is used for planning', async () => {
    const { ws } = await setup();
    act(() => { ws.onopen?.(); ws.say(coachState({ meals: { settings: meals(false), recipes: { collection: 734, unlock: 1000 } } })); });
    // Only with the meal plan on, and only in the sheet.
    expect(screen.queryByText('Essen anpassen')).toBeNull();
    act(() => ws.say(coachState({ meals: { settings: meals(true), recipes: { collection: 734, unlock: 1000 } } })));
    expect(screen.queryByText(/Rezeptsammlung/)).toBeNull();
    fireEvent.click(screen.getByText('Essen anpassen'));
    expect(screen.getByText('Rezeptsammlung: 734 von 1.000')).toBeTruthy();
    act(() => ws.say(coachState({ meals: { settings: meals(true), recipes: { collection: 1512, unlock: 1000 } } })));
    expect(screen.getByText('Rezeptsammlung: 1.512 Rezepte')).toBeTruthy();
    act(() => ws.say(coachState({ meals: { settings: meals(true), recipes: null } })));
    expect(screen.queryByText(/Rezeptsammlung/)).toBeNull();
  });

  it('closes the socket when Profil goes away', async () => {
    const { ws } = await setup();
    cleanup();
    expect(ws.closed).toBe(true);
  });

  it('keeps the socket open until Profil closes when Profil opens during the shell-start window', async () => {
    const ws = new FakeSocket();
    const link = new CoachLink({ open: () => ws, status: async () => ({ profileId: 'p1', moved: true }) });
    link.start(); // the shell start, until the first answer
    await flush();
    link.start(); // Profil opens in that window
    act(() => { ws.onopen?.(); ws.say(coachState()); });
    link.stop(); // the shell start lets go after the first answer
    expect(ws.closed).toBe(false);
    link.stop(); // Profil closes
    expect(ws.closed).toBe(true);
  });
});
