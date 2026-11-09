import { weekdayOfKey } from '../../../shared/dates';
import type { PathDay, PathState } from '../week-path';
import { Icon } from './Icon';
import { Kicker } from './Dojo';

const STATE_WORD: Record<PathState, string> = { done: 'erledigt', today: 'heute', planned: 'geplant', rest: 'Ruhetag' };

/** DESIGN "Wochenweg": seven dots on a line, the head says which week part this is. Heute and Woche both build it through here. */
export function WeekPath({ days, kicker, count, onPick }: { days: PathDay[]; kicker: string; count?: string | null; onPick?: (date: string) => void }) {
  const last = days.reduce((a, d, i) => (d.state === 'done' || (d.state === 'today' && d.done) ? i : a), -1);
  const fill = last <= 0 ? 0 : last / Math.max(1, days.length - 1);
  return (
    <div className="tk-weekpath">
      <div className="tk-weekpath-head">
        <Kicker>{kicker}</Kicker>
        {count && <span className="tk-weekpath-count">{count}</span>}
      </div>
      <div className="tk-weekpath-track">
        <span className="tk-weekpath-line" aria-hidden="true"><span style={{ width: `${fill * 100}%` }} /></span>
        <ol className="tk-weekpath-dots" aria-label="Wochenweg">
          {days.map((d) => {
            const word = d.state === 'today' && d.done ? 'heute, erledigt' : STATE_WORD[d.state];
            return (
              <li key={d.date}>
                <button type="button" className={`tk-pathdot ${d.state}${d.done ? ' done' : ''}`} aria-label={`${weekdayOfKey(d.date)}, ${word}`} onClick={() => onPick?.(d.date)}>
                  <span className="tk-pathdot-mark" aria-hidden="true">{d.state === 'done' || d.done ? <Icon name="haken" size={14} /> : null}</span>
                  <span className="tk-pathdot-name" aria-hidden="true">{d.short}</span>
                </button>
              </li>
            );
          })}
        </ol>
      </div>
    </div>
  );
}
