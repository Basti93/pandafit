// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { CoachPrefs } from '../../src/tracking/ui/CoachPrefs';
import { fakePort } from './fake-port';

afterEach(cleanup);
const NOW = new Date(2026, 10, 4, 18).getTime();

test('the coach writes by itself only when switched on here; the settings are saved as a record', async () => {
  const { port, map } = fakePort();
  render(<CoachPrefs port={port} now={() => NOW} />);
  const evening = await screen.findByRole('switch', { name: /Am Vorabend sagen/ }) as HTMLInputElement;
  expect(evening.checked).toBe(false);
  fireEvent.click(evening);
  await waitFor(() => expect([...map.values()].filter((r) => r.kind === 'coachprefs')[0]?.body).toEqual({ week: { on: false, day: 6, hour: 18 }, evening: { on: true, hour: 19 } }));
  expect(await screen.findByRole('button', { name: /Uhrzeit am Vorabend/ })).toBeTruthy();
});
