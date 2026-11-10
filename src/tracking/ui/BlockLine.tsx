import { blockLine, readBlock } from '../../shared/block';
import { dateKey } from '../../shared/day-rating';
import type { TrackingPort } from '../ports';
import { usePortRecords } from './hooks';

/** The one line about the running fixed section, on Woche and Kraft. Nothing without a running section. */
export function BlockLine({ port, now }: { port: TrackingPort; now: () => number }) {
  const blocks = usePortRecords(port, 'block').records;
  const plans = usePortRecords(port, 'weekplan').records;
  const today = dateKey(now());
  const running = (blocks ?? []).map((r) => readBlock(r.body)).filter((b) => b?.state === 'active' && !!b.start && !!b.end && b.start <= today && today <= b.end).sort((a, b) => b!.atMs - a!.atMs)[0] ?? null;
  const line = blockLine(running, today, plans ?? []);
  return line ? <p className="tk-weeksentence muted">{line}</p> : null;
}
