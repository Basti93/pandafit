import { minuteChoices } from '../../shared/frame';
import type { Frame } from '../../shared/frame';

const parse = (v: string): number | null => (v === '' ? null : Number(v));

/** One compact line: how the week is planned and how long a session may take. */
export function PlanningLine({ frame, onMode, onMinutes }: { frame: Frame; onMode: (m: Frame['mode']) => void; onMinutes: (m: number | null) => void }) {
  return (
    <p className="tk-row tk-frame-line">
      <label>Planung <select aria-label="Planung" value={frame.mode} onChange={(e) => onMode(e.target.value as Frame['mode'])}>
        <option value="week">Feste Woche</option><option value="spontaneous">Spontan</option>
      </select></label>
      <span aria-hidden>·</span>
      <label>Zeit pro Einheit <select aria-label="Zeit pro Einheit" value={frame.minutes ?? ''} onChange={(e) => onMinutes(parse(e.target.value))}>
        <option value="">–</option>{minuteChoices().map((m) => <option key={m} value={m}>{m}</option>)}
      </select> Min</label>
    </p>
  );
}

/** "Heute nur" with chips for 20, 30, 45 and 60 Min and "Wie geplant": a lower time for today only. */
export function TodayOnly({ frame, date, onChange }: { frame: Frame; date: string; onChange: (m: number | null) => void }) {
  const value = frame.today?.date === date ? frame.today.minutes : null;
  return (
    <div className="tk-today-only" role="group" aria-label="Heute nur">
      <span>Heute nur</span>
      <div className="tk-chips">
        {minuteChoices().filter((m) => m <= 60).map((m) => (
          <button key={m} type="button" aria-pressed={value === m} onClick={() => onChange(value === m ? null : m)}>{m} Min</button>
        ))}
      </div>
    </div>
  );
}
