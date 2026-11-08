import { useEffect, useState, useSyncExternalStore } from 'react';
import { Sheet } from '../tracking/ui/kit';
import { LIVE_ADJUST_PCT, LIVE_FRESH_MS, type LiveCommandKind } from '../shared/live';
import type { CommandResult, LiveClient } from './live';

/** After the Mac says the ride ended, the view closes itself. */
export const CLOSE_AFTER_END_MS = 30_000;
/** Without any live data for this long the view closes too, so a forgotten one does not hold the screen awake. */
export const CLOSE_AFTER_LOST_MS = 5 * 60_000;
const OK_MS = 1500;
const FAIL_MS = 3000;

const clock = (s: number): string => `${Math.floor(Math.max(0, s) / 60)}:${String(Math.max(0, Math.floor(s) % 60)).padStart(2, '0')}`;
/** Within this share of the target counts as on target. */
const ON_TARGET = 0.06;
const MIN = (s: number): number => Math.max(1, Math.ceil(s / 60));
const num = (n: number | null): string => (n === null ? '–' : String(Math.round(n)));

type Key = 'down' | 'up' | 'mark' | 'skip';
type Shown = 'wait' | 'ok' | 'fail';

/** The screen stays on while the ride display is open. Best effort: a browser without it just lets the screen dim. */
function useWakeLock(on: boolean): void {
  useEffect(() => {
    if (!on) return;
    let lock: { release(): Promise<void> } | null = null;
    let gone = false;
    const get = async () => {
      try {
        const wl = (navigator as unknown as { wakeLock?: { request(t: 'screen'): Promise<{ release(): Promise<void> }> } }).wakeLock;
        if (!wl || gone) return;
        const l = await wl.request('screen');
        if (gone) { void l.release().catch(() => {}); return; }
        lock = l;
      } catch { /* refused or not available: the screen may dim */ }
    };
    void get();
    // The browser drops the lock when the page is hidden; ask again when it is back.
    const again = () => { if (document.visibilityState === 'visible' && !lock) void get(); };
    document.addEventListener('visibilitychange', again);
    return () => {
      gone = true;
      document.removeEventListener('visibilitychange', again);
      try { void lock?.release().catch(() => {}); } catch { /* released anyway */ }
    };
  }, [on]);
}

export function LiveRide({ client, now }: { client: LiveClient; now: () => number }) {
  const snap = useSyncExternalStore(client.subscribe, client.snapshot);
  const [open, setOpen] = useState(false);
  const [, tick] = useState(0);
  const has = snap.state !== null;
  useEffect(() => {
    if (!has) return;
    const t = setInterval(() => tick((n) => n + 1), 1000);
    return () => clearInterval(t);
  }, [has]);

  const t = now();
  const age = t - snap.receivedMs;
  const fresh = has && age <= LIVE_FRESH_MS;
  const ended = snap.endedMs !== null;
  const showStrip = fresh && !ended;
  // Closes itself 30 s after the end, or after five minutes without any data.
  const over = (ended && t - snap.endedMs! >= CLOSE_AFTER_END_MS) || (has && age >= CLOSE_AFTER_LOST_MS);
  useEffect(() => { if (over && open) setOpen(false); }, [over, open]);
  useWakeLock(open);

  if (!has) return null;
  return (
    <>
      {showStrip && !open && (
        <button type="button" className="web-live-strip" onClick={() => setOpen(true)}>
          <span className="web-live-dot" aria-hidden="true" />
          <span className="web-live-text">Fahrt läuft</span>
          <span className="web-live-go" aria-hidden="true">Ansehen ›</span>
        </button>
      )}
      {open && !over && <LiveScreen client={client} now={now} onClose={() => setOpen(false)} />}
    </>
  );
}

function LiveScreen({ client, now, onClose }: { client: LiveClient; now: () => number; onClose: () => void }) {
  const snap = useSyncExternalStore(client.subscribe, client.snapshot);
  const [shown, setShown] = useState<Partial<Record<Key, Shown>>>({});
  const [sure, setSure] = useState(false);
  const s = snap.state!;
  const stale = now() - snap.receivedMs > LIVE_FRESH_MS;
  const ended = snap.endedMs !== null;
  const dead = stale || ended;

  const run = (key: Key, kind: LiveCommandKind, deltaPct?: number) => {
    if (shown[key] === 'wait') return;
    setShown((x) => ({ ...x, [key]: 'wait' }));
    void client.command(kind, deltaPct).then((r: CommandResult) => {
      setShown((x) => ({ ...x, [key]: r === 'ok' ? 'ok' : 'fail' }));
      setTimeout(() => setShown((x) => ({ ...x, [key]: undefined })), r === 'ok' ? OK_MS : FAIL_MS);
    });
  };
  const label = (key: Key, text: string): string => (shown[key] === 'wait' ? '…' : shown[key] === 'ok' ? 'Gesendet' : shown[key] === 'fail' ? 'nicht angekommen' : text);
  const shownW = (n: number | null): string => (dead ? '–' : num(n));
  const zone = !dead && s.powerW !== null && s.targetW !== null && s.targetW > 0
    ? (s.powerW < s.targetW * (1 - ON_TARGET) ? 'low' : s.powerW > s.targetW * (1 + ON_TARGET) ? 'high' : 'ok') : null;
  const zoneText = zone === 'ok' ? 'im Ziel' : zone === 'low' ? 'zu niedrig' : zone === 'high' ? 'zu hoch' : '';
  const last = s.step.index >= s.step.count - 1;

  return (
    <Sheet title="Fahrt" onClose={onClose} actions={
      <div className="live-buttons">
        <button type="button" className="secondary" disabled={dead} onClick={() => run('down', 'adjust', -LIVE_ADJUST_PCT)}>{label('down', 'Leichter')}</button>
        <button type="button" className="secondary" disabled={dead} onClick={() => run('up', 'adjust', LIVE_ADJUST_PCT)}>{label('up', 'Schwerer')}</button>
        <button type="button" className="secondary" disabled={dead} onClick={() => run('mark', 'mark')}>{label('mark', 'Markieren')}</button>
        <button type="button" className="secondary" disabled={dead || last || s.paused === true} onClick={() => setSure(true)}>{label('skip', 'Überspringen')}</button>
      </div>
    }>
      <p className="live-head muted">Seit {MIN(s.elapsedS)} Min · Intervall {s.step.index + 1} von {s.step.count} · Beenden am Mac</p>
      <div className={`live-body${dead ? ' live-gone' : ''}`}>
        <div className="live-power">
          <span className={`live-big${zone ? ` live-${zone}` : ''}`} aria-label="Leistung">{shownW(s.powerW)}</span><span className="live-unit">W</span>
          <p className="live-target">{s.targetW === null ? '' : `Ziel ${shownW(s.targetW)} W`}{zoneText && <span className="live-zone"> · {zoneText}</span>}</p>
        </div>
        <div className="live-pair">
          <div><b>{shownW(s.hrBpm)}</b><span>Puls</span></div>
          <div><b>{shownW(s.cadenceRpm)}</b><span>Trittfrequenz</span></div>
        </div>
        <div className="live-step">
          <p className="live-now"><strong>{s.step.name ?? 'Intervall'}</strong>{s.paused ? ' · Pause' : ` · noch ${dead ? '–' : clock(s.step.remainingS)}`}</p>
          {s.nextStep && <p className="muted">danach: {s.nextStep.label}</p>}
        </div>
      </div>
      {ended ? <p role="status" className="live-note">Fahrt beendet</p> : stale ? <p role="status" className="live-note">Keine Verbindung zum Mac. Die Fahrt läuft dort weiter und wird gespeichert.</p> : null}
      {sure && (
        <Sheet title="Überspringen?" size="small" onClose={() => setSure(false)} actions={
          <div className="live-buttons">
            <button type="button" className="secondary" onClick={() => setSure(false)}>Abbrechen</button>
            <button type="button" className="primary" onClick={() => { setSure(false); run('skip', 'skip'); }}>Überspringen</button>
          </div>
        }>
          <p className="muted">{s.nextStep ? `Weiter mit ${s.nextStep.label}.` : 'Weiter mit dem nächsten Teil.'}</p>
        </Sheet>
      )}
    </Sheet>
  );
}
