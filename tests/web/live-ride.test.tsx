// @vitest-environment jsdom
import 'fake-indexeddb/auto';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { IDBFactory } from 'fake-indexeddb';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { App } from '../../src/web/App';
import { openIdb } from '../../src/web/idbStore';
import { LiveClient, type LiveSocket } from '../../src/web/live';
import { LiveRide } from '../../src/web/LiveRide';

class FakeLive implements LiveSocket {
  sent: Record<string, unknown>[] = [];
  closed = false;
  onopen: (() => void) | null = null;
  onmessage: ((e: { data: unknown }) => void) | null = null;
  onclose: (() => void) | null = null;
  onerror: (() => void) | null = null;
  send(d: string) { this.sent.push(JSON.parse(d) as Record<string, unknown>); }
  close() { this.closed = true; }
  open() { this.onopen?.(); }
  say(m: unknown) { this.onmessage?.({ data: JSON.stringify(m) }); }
  commands() { return this.sent.filter((m) => m.type === 'live-command'); }
}

const state = (over: Record<string, unknown> = {}) => ({
  rideId: 'ride-1', profileId: 'pa', atMs: 1, elapsedS: 600, powerW: 182, hrBpm: 141, cadenceRpm: 88, targetW: 190,
  step: { name: 'Tempo', index: 1, count: 4, remainingS: 200 }, nextStep: { label: 'Locker' }, ...over,
});

let t: number;
let sock: FakeLive;
let ids: number;
const NOW0 = Date.UTC(2026, 10, 7, 10);

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'setInterval', 'clearInterval'] });
  t = NOW0; ids = 0; sock = new FakeLive();
});
afterEach(() => { cleanup(); vi.useRealTimers(); vi.unstubAllGlobals(); });

const mount = () => {
  const client = new LiveClient({ open: () => sock, now: () => t, newId: () => `id-${++ids}` });
  client.start();
  render(<LiveRide client={client} now={() => t} />);
  act(() => sock.open());
  return client;
};
const say = (m: unknown) => act(() => sock.say(m));
const advance = async (ms: number) => { t += ms; await act(async () => { vi.advanceTimersByTime(ms); }); };
const openScreen = () => fireEvent.click(screen.getByRole('button', { name: /Fahrt läuft/ }));

describe('the ride strip', () => {
  it('asks to follow the ride, and shows nothing without live data', () => {
    mount();
    expect(sock.sent).toEqual([{ type: 'live-watch' }]);
    expect(screen.queryByRole('button', { name: /Fahrt läuft/ })).toBeNull();
  });

  it('shows while live data is fresh and goes away when it is older than 10 seconds', async () => {
    mount();
    say({ type: 'live-state', profileId: 'pa', state: state() });
    expect(screen.getByRole('button', { name: /Fahrt läuft/ })).toBeTruthy();
    await advance(9000);
    expect(screen.queryByRole('button', { name: /Fahrt läuft/ })).toBeTruthy();
    await advance(2000);
    expect(screen.queryByRole('button', { name: /Fahrt läuft/ })).toBeNull();
  });

  it('is gone after the ride ended', () => {
    mount();
    say({ type: 'live-state', profileId: 'pa', state: state() });
    say({ type: 'live-end', profileId: 'pa', rideId: 'ride-1' });
    expect(screen.queryByRole('button', { name: /Fahrt läuft/ })).toBeNull();
  });
});

describe('the ride view', () => {
  it('shows power with its target, heart rate, cadence and the interval line', () => {
    mount();
    say({ type: 'live-state', profileId: 'pa', state: state() });
    openScreen();
    expect(screen.getByLabelText('Leistung').textContent).toBe('182');
    expect(screen.getByText('Ziel 190 W')).toBeTruthy();
    expect(screen.getByText('141')).toBeTruthy();
    expect(screen.getByText('88')).toBeTruthy();
    expect(screen.getByText(/noch 3:20/)).toBeTruthy();
    expect(screen.getByText('danach: Locker')).toBeTruthy();
  });

  it('keeps the screen awake while open and lets go on close', async () => {
    const release = vi.fn(async () => {});
    const request = vi.fn(async () => ({ release }));
    vi.stubGlobal('navigator', { ...navigator, wakeLock: { request } });
    mount();
    say({ type: 'live-state', profileId: 'pa', state: state() });
    openScreen();
    await act(async () => {});
    expect(request).toHaveBeenCalledWith('screen');
    fireEvent.click(screen.getByRole('button', { name: 'Schließen' }));
    await act(async () => {});
    expect(release).toHaveBeenCalled();
  });

  it('a refused wake lock is no problem', async () => {
    vi.stubGlobal('navigator', { ...navigator, wakeLock: { request: async () => { throw new Error('no'); } } });
    mount();
    say({ type: 'live-state', profileId: 'pa', state: state() });
    openScreen();
    await act(async () => {});
    expect(screen.getByLabelText('Leistung')).toBeTruthy();
  });

  it('the buttons send the right commands for the right ride', () => {
    mount();
    say({ type: 'live-state', profileId: 'pa', state: state() });
    openScreen();
    fireEvent.click(screen.getByRole('button', { name: 'Leichter' }));
    fireEvent.click(screen.getByRole('button', { name: 'Schwerer' }));
    fireEvent.click(screen.getByRole('button', { name: 'Markieren' }));
    expect(sock.commands()).toEqual([
      { type: 'live-command', profileId: 'pa', id: 'id-1', rideId: 'ride-1', atMs: NOW0, kind: 'adjust', deltaPct: -5 },
      { type: 'live-command', profileId: 'pa', id: 'id-2', rideId: 'ride-1', atMs: NOW0, kind: 'adjust', deltaPct: 5 },
      { type: 'live-command', profileId: 'pa', id: 'id-3', rideId: 'ride-1', atMs: NOW0, kind: 'mark' },
    ]);
  });

  it('skipping asks first, and Abbrechen sends nothing', () => {
    mount();
    say({ type: 'live-state', profileId: 'pa', state: state() });
    openScreen();
    fireEvent.click(screen.getByRole('button', { name: 'Überspringen' }));
    fireEvent.click(screen.getByRole('button', { name: 'Abbrechen' }));
    expect(sock.commands()).toEqual([]);
    fireEvent.click(screen.getByRole('button', { name: 'Überspringen' }));
    fireEvent.click(screen.getAllByRole('button', { name: 'Überspringen' })[1]);
    expect(sock.commands()).toEqual([expect.objectContaining({ kind: 'skip', rideId: 'ride-1' })]);
  });

  it('skip is not offered on the last interval', () => {
    mount();
    say({ type: 'live-state', profileId: 'pa', state: state({ step: { index: 3, count: 4, remainingS: 60 }, nextStep: undefined }) });
    openScreen();
    expect((screen.getByRole('button', { name: 'Überspringen' }) as HTMLButtonElement).disabled).toBe(true);
  });

  it('a tap shows … then ✓ for 1.5 seconds on the ack', async () => {
    mount();
    say({ type: 'live-state', profileId: 'pa', state: state() });
    openScreen();
    fireEvent.click(screen.getByRole('button', { name: 'Schwerer' }));
    expect(screen.getByRole('button', { name: '…' })).toBeTruthy();
    say({ type: 'live-ack', profileId: 'pa', id: 'id-1', ok: true });
    await act(async () => {});
    expect(screen.getByRole('button', { name: 'Gesendet' })).toBeTruthy();
    await advance(1600);
    expect(screen.getByRole('button', { name: 'Schwerer' })).toBeTruthy();
  });

  it('a refusal shows nicht angekommen', async () => {
    mount();
    say({ type: 'live-state', profileId: 'pa', state: state() });
    openScreen();
    fireEvent.click(screen.getByRole('button', { name: 'Markieren' }));
    say({ type: 'live-ack', profileId: 'pa', id: 'id-1', ok: false, reason: 'old' });
    await act(async () => {});
    expect(screen.getByRole('button', { name: 'nicht angekommen' })).toBeTruthy();
  });

  it('no ack within 5 seconds shows nicht angekommen', async () => {
    mount();
    say({ type: 'live-state', profileId: 'pa', state: state() });
    openScreen();
    fireEvent.click(screen.getByRole('button', { name: 'Leichter' }));
    // The state keeps coming, the ack does not.
    for (let i = 0; i < 5; i++) { await advance(1000); say({ type: 'live-state', profileId: 'pa', state: state() }); }
    await advance(100);
    expect(screen.getByRole('button', { name: 'nicht angekommen' })).toBeTruthy();
  });

  it('without live data for over 10 seconds the numbers grey out and the buttons are off', async () => {
    mount();
    say({ type: 'live-state', profileId: 'pa', state: state() });
    openScreen();
    await advance(11_000);
    expect(screen.getByText('Keine Verbindung zum Mac. Die Fahrt läuft dort weiter und wird gespeichert.')).toBeTruthy();
    expect(document.querySelector('.live-gone')).toBeTruthy();
    expect((screen.getByRole('button', { name: 'Schwerer' }) as HTMLButtonElement).disabled).toBe(true);
    // And it comes back when the data does.
    say({ type: 'live-state', profileId: 'pa', state: state() });
    expect(screen.queryByText('Keine Verbindung zum Mac. Die Fahrt läuft dort weiter und wird gespeichert.')).toBeNull();
  });

  it('marks on target, too low and too high, and shows dashes when the connection is gone', async () => {
    mount();
    say({ type: 'live-state', profileId: 'pa', state: state({ powerW: 190 }) });
    openScreen();
    expect(screen.getByText(/im Ziel/)).toBeTruthy();
    say({ type: 'live-state', profileId: 'pa', state: state({ powerW: 150 }) });
    expect(screen.getByText(/zu niedrig/)).toBeTruthy();
    say({ type: 'live-state', profileId: 'pa', state: state({ powerW: 230 }) });
    expect(screen.getByText(/zu hoch/)).toBeTruthy();
    await advance(11_000);
    expect(screen.getByLabelText('Leistung').textContent).toBe('–');
    expect(screen.getByText('Ziel – W')).toBeTruthy();
  });

  it('names the interval, says where to end, and the skip question names what comes next', () => {
    mount();
    say({ type: 'live-state', profileId: 'pa', state: state() });
    openScreen();
    expect(screen.getByText(/Intervall 2 von 4 · Beenden am Mac/)).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Überspringen' }));
    expect(screen.getByText('Weiter mit Locker.')).toBeTruthy();
  });

  it('closes itself 30 seconds after the ride ended', async () => {
    mount();
    say({ type: 'live-state', profileId: 'pa', state: state() });
    openScreen();
    say({ type: 'live-end', profileId: 'pa', rideId: 'ride-1' });
    expect(screen.getByText('Fahrt beendet')).toBeTruthy();
    await advance(29_000);
    expect(screen.queryByRole('dialog')).toBeTruthy();
    await advance(2000);
    expect(screen.queryByRole('dialog')).toBeNull();
  });
});

describe('the skip confirmation goes stale safely', () => {
  const ask = () => {
    mount();
    say({ type: 'live-state', profileId: 'pa', state: state() });
    openScreen();
    fireEvent.click(screen.getByRole('button', { name: 'Überspringen' }));
    expect(screen.getByText('Weiter mit Locker.')).toBeTruthy();
  };
  const noUsableSkip = () => {
    expect(screen.queryByText('Weiter mit Locker.')).toBeNull();
    for (const b of screen.queryAllByRole('button', { name: 'Überspringen' })) {
      if (!(b as HTMLButtonElement).disabled) fireEvent.click(b);
    }
    expect(sock.commands().filter((c) => c.kind === 'skip')).toEqual([]);
  };

  it('closes when the data gets older than the freshness limit', async () => {
    ask();
    await advance(11_000);
    noUsableSkip();
  });

  it('closes when the ride ended', () => {
    ask();
    say({ type: 'live-end', profileId: 'pa', rideId: 'ride-1' });
    noUsableSkip();
  });

  it('closes when another ride takes over', () => {
    ask();
    say({ type: 'live-state', profileId: 'pa', state: state({ rideId: 'ride-2' }) });
    noUsableSkip();
  });

  it('closes when the step moved on', () => {
    ask();
    say({ type: 'live-state', profileId: 'pa', state: state({ step: { name: 'Locker', index: 2, count: 4, remainingS: 300 }, nextStep: { label: 'Ende' } }) });
    noUsableSkip();
  });
});

describe('in the app', () => {
  it('the strip shows at the top of every tab while a ride runs; the app works without the socket', async () => {
    vi.useRealTimers();
    const factory = new IDBFactory();
    (await openIdb('anna', factory)).close();
    const fetchFn = (async (url: string) => (url === '/me'
      ? new Response(JSON.stringify({ name: 'anna' }), { status: 200, headers: { 'content-type': 'application/json' } })
      : new Response(JSON.stringify({ records: [], cursor: 0, more: false, reset: false, accepted: 0, refused: [] }), { status: 200, headers: { 'content-type': 'application/json' } }))) as unknown as typeof fetch;
    const storage = new Map<string, string>([['pandafit.account', 'anna']]);
    const live = new FakeLive();
    render(<App env={{
      fetchFn, idbFactory: factory, now: () => NOW0, newId: () => 'id', persist: async () => true, ua: 'Mozilla/5.0 Android', standalone: false,
      storage: { getItem: (k: string) => storage.get(k) ?? null, setItem: (k: string, v: string) => { storage.set(k, v); }, removeItem: (k: string) => { storage.delete(k); } },
      openLive: () => live,
    }} />);
    await screen.findByRole('navigation');
    await act(async () => { await new Promise((r) => setTimeout(r, 50)); });
    expect(screen.queryByRole('button', { name: /Fahrt läuft/ })).toBeNull();
    act(() => { live.open(); live.say({ type: 'live-state', profileId: 'pa', state: state() }); });
    expect(await screen.findByRole('button', { name: /Fahrt läuft/ })).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Kraft' }));
    expect(screen.getByRole('button', { name: /Fahrt läuft/ })).toBeTruthy();
  });
});
