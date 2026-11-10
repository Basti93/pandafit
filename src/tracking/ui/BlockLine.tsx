import { activeBlock, blockLine } from '../../shared/block';
import { dateKey } from '../../shared/day-rating';
import type { TrackingPort } from '../ports';
import { usePortRecords } from './hooks';

/** The one line about the running fixed section, on Woche and Kraft. Nothing without a running section. */
export function BlockLine({ port, now }: { port: TrackingPort; now: () => number }) {
  const blocks = usePortRecords(port, 'block').records;
  const plans = usePortRecords(port, 'weekplan').records;
  const today = dateKey(now());
  const line = blockLine(activeBlock(blocks ?? [], today), today, plans ?? []);
  return line ? <p className="tk-weeksentence muted">{line}</p> : null;
}
