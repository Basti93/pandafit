import fs from 'node:fs';
import path from 'node:path';
import { prefsOf, type ChatMessage } from '../../shared/chat';
import type { TrackedRecord } from '../../shared/records';
import { addDays, dayLabel, mondayOf, planFor, type PlanDay } from '../../shared/week-plan';
import { dateKey } from '../day-load';
import { writeJsonAtomic } from '../../shared/node/atomic-write';

export type Sent = { week?: string; evening?: string; review?: string; reviewSports?: string; pushAsk?: string; drift?: string; blockEnd?: string };

/** Remembers what was sent per profile (the Monday of the week conversation, the date of the evening suggestion), in a file. */
export class SentPrompts {
  private sent: Record<string, Sent> | null = null;
  constructor(private file: string) {}
  get(id: string): Sent { return this.load()[id] ?? {}; }
  mark(id: string, k: keyof Sent, v: string): void {
    const s = this.load();
    s[id] = { ...s[id], [k]: v };
    try { fs.mkdirSync(path.dirname(this.file), { recursive: true }); writeJsonAtomic(this.file, s); } catch { /* sent again at worst once more */ }
  }
  private load(): Record<string, Sent> {
    if (this.sent) return this.sent;
    try { const x = JSON.parse(fs.readFileSync(this.file, 'utf8')) as unknown; this.sent = x && typeof x === 'object' && !Array.isArray(x) ? x as Record<string, Sent> : {}; } catch { this.sent = {}; }
    return this.sent;
  }
}

/** The evening message for tomorrow's planned day, or null on a rest day or without a plan. No Claude: plain words from the plan. */
export function eveningText(day: PlanDay | null, detail: string | null): string | null {
  if (!day || day.sport === 'rest') return null;
  const what = dayLabel(day, (_, first) => (first && day.long ? ', lang' : ''));
  return `Morgen: ${what}${detail ? ` (${detail})` : ''}${day.note ? `. ${day.note}` : ''}. Passt das, oder lieber etwas anderes?`;
}

/** What is due now for a profile: the week conversation and/or the evening suggestion. Marks them as sent. */
export function duePrompts(o: {
  id: string; records: { prefs: TrackedRecord[]; weekplan: TrackedRecord[] }; nowMs: number; sent: SentPrompts;
  detail: (sport: PlanDay['sport']) => string | null;
}): { week: boolean; evening: ChatMessage | null } {
  const prefs = prefsOf(o.records.prefs);
  const d = new Date(o.nowMs);
  const today = dateKey(o.nowMs);
  const weekday = (d.getDay() + 6) % 7;
  const had = o.sent.get(o.id);
  let week = false;
  const monday = mondayOf(today);
  // Marked by the caller once the conversation was really written, so a busy or failing Claude tries again later that day.
  if (prefs.week.on && weekday === prefs.week.day && d.getHours() >= prefs.week.hour && had.week !== monday) week = true;
  let evening: ChatMessage | null = null;
  if (prefs.evening.on && d.getHours() >= prefs.evening.hour && had.evening !== today) {
    const tomorrow = planFor(o.records.weekplan, addDays(today, 1));
    const text = eveningText(tomorrow, tomorrow ? [...new Set([tomorrow.sport, tomorrow.also?.sport])].flatMap((x) => (x ? [o.detail(x)] : [])).filter(Boolean).join('; ') || null : null);
    o.sent.mark(o.id, 'evening', today);
    if (text) evening = { role: 'coach', text, atMs: o.nowMs, push: true };
  }
  return { week, evening };
}
