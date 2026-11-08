// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { dayKey, hiddenToday, hideToday, MobilityOffer } from '../../src/tracking/ui/MobilityOffer';

afterEach(cleanup);
const session = { id: 's1', minutes: 8, reason: 'Nach der Fahrt tut das gut.', exercises: [
  { id: 'a', title: 'Waden an der Wand', howTo: 'Hände an die Wand.' },
  { id: 'b', title: 'Brust im Türrahmen', howTo: 'Unterarm am Türrahmen.' },
] };
const memory = () => { const m = new Map<string, string>(); return { m, getItem: (k: string) => m.get(k) ?? null, setItem: (k: string, v: string) => { m.set(k, v); } }; };
const DAY = Date.UTC(2026, 10, 3, 12);

test('a local day key, and hiding lasts exactly until the next day', () => {
  const s = memory();
  expect(dayKey(DAY)).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  expect(hiddenToday(s, 'k', DAY)).toBe(false);
  hideToday(s, 'k', DAY);
  expect(hiddenToday(s, 'k', DAY + 3600_000)).toBe(true);
  expect(hiddenToday(s, 'k', DAY + 86_400_000)).toBe(false);
});
test('a storage that throws never breaks the card', () => {
  const broken = { getItem: () => { throw new Error('x'); }, setItem: () => { throw new Error('x'); } };
  expect(hiddenToday(broken, 'k', DAY)).toBe(false);
  expect(() => hideToday(broken, 'k', DAY)).not.toThrow();
});

const offer = (storage = memory(), now = DAY) => {
  const onDone = vi.fn();
  render(<MobilityOffer session={session} hideKey="k" storage={storage} now={() => now} onDone={onDone} />);
  return { onDone, storage };
};

test('one row with the minutes; the exercises, Gemacht and "Heute nicht" are in a sheet', () => {
  offer();
  expect(screen.getByText('Beweglichkeit · 8 Min')).toBeTruthy();
  expect(screen.queryByText('Waden an der Wand')).toBeNull();
  fireEvent.click(screen.getByRole('button', { name: /^Beweglichkeit/ }));
  expect(screen.getByRole('dialog')).toBeTruthy();
  expect(screen.getByText('Waden an der Wand').closest('ol')).toBeTruthy();
  expect(screen.getByText('Hände an die Wand.')).toBeTruthy();
  fireEvent.click(screen.getByRole('button', { name: 'Schließen' }));
  expect(screen.queryByText('Waden an der Wand')).toBeNull();
});
test('the sheet does not say "Nach dem Training"; "Heute nicht" is a link, "Gemacht" the main button', () => {
  offer();
  fireEvent.click(screen.getByRole('button', { name: /^Beweglichkeit/ }));
  expect(screen.queryByText(/Nach dem/)).toBeNull();
  expect(screen.getByRole('button', { name: 'Heute nicht' }).className).toBe('link');
  expect(screen.getByRole('button', { name: 'Gemacht' }).className).toBe('primary');
});
test('Gemacht reports done and closes the sheet', () => {
  const { onDone } = offer();
  fireEvent.click(screen.getByRole('button', { name: /^Beweglichkeit/ }));
  fireEvent.click(screen.getByRole('button', { name: 'Gemacht' }));
  expect(onDone).toHaveBeenCalled();
  expect(screen.queryByRole('dialog')).toBeNull();
});
const hideIt = () => { fireEvent.click(screen.getByRole('button', { name: /^Beweglichkeit/ })); fireEvent.click(screen.getByRole('button', { name: 'Heute nicht' })); };
test('"Heute nicht" only hides it for today, on this device, and asks nothing', () => {
  const { onDone, storage } = offer();
  hideIt();
  expect(screen.queryByRole('button', { name: /^Beweglichkeit/ })).toBeNull();
  expect(screen.queryByRole('textbox')).toBeNull();
  expect(onDone).not.toHaveBeenCalled();
  cleanup();
  offer(storage, DAY + 3600_000);
  expect(screen.queryByRole('button', { name: /^Beweglichkeit/ })).toBeNull();
  cleanup();
  offer(storage, DAY + 86_400_000);
  expect(screen.getByRole('button', { name: /^Beweglichkeit/ })).toBeTruthy();
});
test('no pressure: no streaks, no guilt', () => {
  offer();
  fireEvent.click(screen.getByRole('button', { name: /^Beweglichkeit/ }));
  expect(document.body.textContent).not.toMatch(/musst|verpasst|Serie|streak|schade/i);
});
