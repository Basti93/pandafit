import type { ActivityItem } from '../../shared/activities';
import { localDayKey } from '../../shared/dates';

/** The items of one local date, oldest first; null when the activities are unknown and no local item is there. */
export function activitiesOn(merged: { items: ActivityItem[]; known: boolean }, date: string): ActivityItem[] | null {
  const items = merged.items.filter((a) => localDayKey(a.startMs) === date).sort((a, b) => a.startMs - b.startMs);
  if (!merged.known && items.length === 0) return null;
  return items;
}
