import { activeBlock, blockLine } from '../../shared/block';
import { dateKey } from '../../shared/day-rating';
import type { TrackingPort } from '../ports';
import { usePortRecords } from './hooks';

/** The one line about the running fixed section, on Woche and Kraft. Nothing without a running section. */
export function BlockLine({ port, now }: { port: TrackingPort; now: () => number }) {
  const blocks = usePortRecords(port, 'block').records;
  const plans = usePortRecords(port, 'weekplan').records;
  const workouts = usePortRecords(port, 'workout').records;
  const today = dateKey(now());
  // Days with a finished strength session: the line then names the next strength day, not the one already done.
  const done = (workouts ?? []).flatMap((r) => {
    const b = r.body as { startMs?: unknown; endMs?: unknown } | null;
    return !r.deleted && b && typeof b.startMs === 'number' && typeof b.endMs === 'number' ? [dateKey(b.startMs)] : [];
  });
  const line = blockLine(activeBlock(blocks ?? [], today), today, plans ?? [], done);
  return line ? <p className="tk-weeksentence muted">{line}</p> : null;
}
