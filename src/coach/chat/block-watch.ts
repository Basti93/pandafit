import fs from 'node:fs';
import path from 'node:path';
import { blockEndWrites } from '../../shared/block-take';
import { activeBlock, readBlock, type BlockBody } from '../../shared/block';
import type { TrackedRecord } from '../../shared/records';
import { ruleNumber } from '../../shared/training-policy';
import { writeJsonAtomic } from '../../shared/node/atomic-write';
import { addDays, hasSport, mondayOf, planOfWeek } from '../../shared/week-plan';
import type { Sent, SentPrompts } from './prompts';
import { QUESTION_GAP_DAYS } from '../motivation';

export const DRIFT_QUESTION = 'Die letzten zwei Wochen sahen anders aus als geplant. Sollen wir wieder locker planen?';
export const BLOCK_END_TEXT = 'Dein fester Abschnitt ist vorbei. Ab jetzt plane ich wieder locker, dein Ziel bleibt.';
export const BLOCK_END_WEEK_TEXT = 'Dein fester Abschnitt ist vorbei. Ab jetzt planen wir wieder Woche für Woche, dein Ziel bleibt.';

const dayNumber = (key: string): number => { const [y, m, d] = key.split('-').map(Number); return Date.UTC(y!, m! - 1, d!) / 86_400_000; };

/** How many strength days each week of a section had planned, noted the first time the week is seen (a later change of the plan does not move it). */
export class PlannedWeeks {
  private data: Record<string, Record<string, number>> | null = null;
  constructor(private file: string) {}
  private load(): Record<string, Record<string, number>> {
    if (this.data) return this.data;
    try { const x = JSON.parse(fs.readFileSync(this.file, 'utf8')) as unknown; this.data = x && typeof x === 'object' && !Array.isArray(x) ? x as Record<string, Record<string, number>> : {}; } catch { this.data = {}; }
    return this.data;
  }
  get(id: string, monday: string): number | undefined { return this.load()[id]?.[monday]; }
  note(id: string, monday: string, count: number): void {
    const all = this.load();
    if (all[id]?.[monday] !== undefined) return;
    all[id] = { ...all[id], [monday]: count };
    try { fs.mkdirSync(path.dirname(this.file), { recursive: true }); writeJsonAtomic(this.file, all); } catch { /* noted again next scan */ }
  }
}

/**
 * Whether Bo asks if the section still fits: each of the last two full calendar weeks (Monday to Sunday, inside the section,
 * before the current week) had strength days planned, and fewer than `block.drift-share` of them took place. After a question,
 * at least `block.drift-weeks` weeks pass before the next one.
 */
export function driftDue(o: { block: BlockBody; planned: (monday: string) => number | undefined; gymDates: readonly string[]; sent: Pick<Sent, 'drift'>; today: string }): boolean {
  const { block } = o;
  if (block.state !== 'active' || !block.start || !block.end || o.today > block.end) return false;
  const weeks = ruleNumber('block.drift-weeks');
  if (o.sent.drift && dayNumber(o.today) - dayNumber(o.sent.drift) < weeks * 7) return false;
  const share = ruleNumber('block.drift-share');
  const current = mondayOf(o.today);
  const done = new Set(o.gymDates);
  for (let i = 1; i <= weeks; i++) {
    const monday = addDays(current, -7 * i);
    if (monday < block.start || addDays(monday, 6) > block.end) return false;
    const planned = o.planned(monday);
    if (!planned || planned <= 0) return false;
    let count = 0;
    for (let d = 0; d < 7; d++) if (done.has(addDays(monday, d))) count++;
    if (count >= share * planned) return false;
  }
  return true;
}

/** The section ran out: the day after its end, once per section. The section is ended and the frame restored whatever else was said. */
export function blockEndDue(o: { block: BlockBody & { id: string }; sent: Pick<Sent, 'blockEnd'>; today: string }): boolean {
  const { block } = o;
  if (block.state !== 'active' || !block.end || o.today <= block.end) return false;
  return o.sent.blockEnd !== block.id;
}

/**
 * Ends a section. The frame goes back first (only if the take's frame is unchanged), then the message by the plan mode it goes back
 * to (`message` false: a section that follows is already active, its take said enough), then the section becomes `ended`, and the
 * mark comes last, only after the section was written: a failure on the way never loses the message or repeats the frame change.
 */
export function announceBlockEnd(o: { block: TrackedRecord; frame: readonly TrackedRecord[]; nowMs: number; message: boolean; put: (r: TrackedRecord) => void; say: (text: string) => void; mark: () => void }): boolean {
  const writes = blockEndWrites({ block: o.block, frame: o.frame, nowMs: o.nowMs });
  if (!writes) return false;
  for (const w of writes.slice(0, -1)) o.put(w);
  if (o.message) o.say(readBlock(o.block.body)?.priorMode === 'week' ? BLOCK_END_WEEK_TEXT : BLOCK_END_TEXT);
  o.put(writes[writes.length - 1]!);
  o.mark();
  return true;
}

/**
 * The scan's step for the fixed section of one profile: notes how many strength days the week has planned, asks Bo's question when
 * the last two weeks drifted, and announces the end. Returns what was written, or null.
 */
export function watchBlock(o: {
  today: string; nowMs: number; blocks: readonly TrackedRecord[]; weekplans: TrackedRecord[]; frame: readonly TrackedRecord[]; gymDates: readonly string[];
  id: string; sent: Pick<SentPrompts, 'get' | 'mark'>; planned: PlannedWeeks;
  /** No other question went out in this scan; without it the drift question waits for a later scan. The end runs anyway. */
  askAllowed: boolean;
  /** A monthly review is being written now: it may ask itself, so the drift question waits. */
  reviewOpen?: boolean;
  /** When Bo last asked a question; the drift question keeps QUESTION_GAP_DAYS away from it. */
  lastQuestionMs?: number;
  ask: (blockId: string) => void; say: (text: string) => void; put: (r: TrackedRecord) => void;
}): 'drift' | 'end' | null {
  const running = activeBlock(o.blocks, o.today);
  if (running) {
    const monday = mondayOf(o.today);
    const week = planOfWeek(o.weekplans, monday);
    if (week) o.planned.note(o.id, monday, week.days.filter((d) => hasSport(d, 'gym')).length);
    const quiet = !o.reviewOpen && (o.lastQuestionMs === undefined || o.nowMs - o.lastQuestionMs >= QUESTION_GAP_DAYS * 86_400_000);
    if (o.askAllowed && quiet && driftDue({ block: running, planned: (m) => o.planned.get(o.id, m), gymDates: o.gymDates, sent: o.sent.get(o.id), today: o.today })) {
      o.ask(running.id);
      o.sent.mark(o.id, 'drift', o.today);
      return 'drift';
    }
  }
  let over: { rec: TrackedRecord; block: BlockBody & { id: string } } | null = null;
  for (const rec of o.blocks) {
    const b = rec.kind === 'block' && !rec.deleted ? readBlock(rec.body) : null;
    if (b && b.state === 'active' && b.end && b.end < o.today && (!over || b.atMs > over.block.atMs)) over = { rec, block: { ...b, id: rec.id } };
  }
  if (over && blockEndDue({ block: over.block, sent: o.sent.get(o.id), today: o.today })) {
    const { rec, block } = over;
    // A section that follows is already active: its take said what happens, so the old one ends without a message.
    const successor = running !== null && running.id !== block.id;
    return announceBlockEnd({ block: rec, frame: o.frame, nowMs: o.nowMs, message: !successor, put: o.put, say: o.say, mark: () => o.sent.mark(o.id, 'blockEnd', block.id) }) ? 'end' : null;
  }
  return null;
}
