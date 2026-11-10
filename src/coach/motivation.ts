import type { RideSummary } from './metrics';

// Foundations and limits: docs/motivation.md. All numbers here are our own choices.
const DAY_MS = 86_400_000;
export const QUESTION_GAP_DAYS = 3;
const ASK_AGAIN_DAYS = 90;
const MONTH_DAYS = 28;

export type ComplaintStatus = 'active' | 'healing' | 'over';
export type Complaint = { id: string; text: string; status: ComplaintStatus; startedMs: number; updatedMs: number };
export type Motive = { atMs: number; questionId: string; text: string };

/** Open questions, one per visit. They ask about what is your own, not about targets or discipline. */
export const QUESTIONS = [
  { id: 'wozu', text: 'Wofür möchtest du fit sein, was soll dir das Radfahren im Alltag ermöglichen?' },
  { id: 'schoen', text: 'Nach welcher Fahrt ging es dir zuletzt richtig gut, und was war daran so schön?' },
  { id: 'warum-jetzt', text: 'Warum ist dir das Fahren gerade jetzt wichtig?' },
  { id: 'huerde', text: 'Was hält dich am ehesten vom Fahren ab?' },
  { id: 'hilft', text: 'Was hilft dir an Tagen, an denen du eigentlich keine Lust hast?' },
  { id: 'erfolg', text: 'Woran würdest du in drei Monaten merken, dass es sich gelohnt hat?' },
] as const;

const BODY = /schienbein|sprunggelenk|lendenwirbel|\b(knee|foot|feet|ankle|shin|calf|calves|hip|lower back)\b|knie|rücken|hüfte|schulter|nacken|wade|achilles|oberschenkel|schmerz|zwick|tut .*weh|verletz|stechen|zerr|beschwerd|krank|erkält|fieber|schwindel|gebrochen|\bbruch|sitzbein|becken|knöchel|sprunggelenk|handgelenk|ellbogen|(?<![a-zäöüß])fu(ß|ss)(?![a-zäöüß])|operation|operiert|bandscheib|sehne|prellung|gelenk/i;
const FINE = /wieder gut|alles gut|keine? (schmerz|beschwerd)|nicht mehr weh/i;
const HEALING = /verheil|heilt|besser|unsicher|abgeklungen|fast weg/i;

/** Deliberately without AI: a complaint must get through even when the AI is unreachable. */
export const complaintFromNote = (text: string): 'active' | 'healing' | null => {
  if (!BODY.test(text) || FINE.test(text)) return null;
  return HEALING.test(text) ? 'healing' : 'active';
};

/** At most one question every few days. Answered ones are only asked again after months, since motives change. */
export const nextQuestion = (motives: Motive[], lastQuestionMs: number | undefined, nowMs: number): (typeof QUESTIONS)[number] | null => {
  if (lastQuestionMs !== undefined && nowMs - lastQuestionMs < QUESTION_GAP_DAYS * DAY_MS) return null;
  const lastAnswer = (id: string) => Math.max(-Infinity, ...motives.filter((m) => m.questionId === id).map((m) => m.atMs));
  const open = QUESTIONS.find((q) => lastAnswer(q.id) === -Infinity);
  if (open) return open;
  return QUESTIONS.find((q) => nowMs - lastAnswer(q.id) >= ASK_AGAIN_DAYS * DAY_MS) ?? null;
};

export type Overview = { rides: number; totalHours: number; minutes28: number; highlight: string | null };

/** Only against yourself and only what was achieved: no streak that can break, no counter for breaks. */
export const motivationOverview = (summaries: RideSummary[], nowMs: number): Overview => {
  const minutesIn = (fromDays: number, toDays: number) => summaries
    .filter((r) => nowMs - r.startedAtMs >= fromDays * DAY_MS && nowMs - r.startedAtMs < toDays * DAY_MS)
    .reduce((sum, r) => sum + r.durationS / 60, 0);
  const minutes28 = Math.round(minutesIn(0, MONTH_DAYS));
  const before = Math.round(minutesIn(MONTH_DAYS, 2 * MONTH_DAYS));
  const sorted = [...summaries].sort((a, b) => b.startedAtMs - a.startedAtMs);
  const latest = sorted[0];
  let highlight: string | null = null;
  if (latest && sorted.length > 1 && sorted.slice(1).every((r) => r.durationS < latest.durationS)) highlight = `Deine letzte Fahrt war mit ${Math.round(latest.durationS / 60)} Minuten deine bisher längste.`;
  else if (before > 0 && minutes28 > before) highlight = `In den letzten vier Wochen warst du ${minutes28 - before} Minuten mehr unterwegs als in den vier davor.`;
  return { rides: summaries.length, totalHours: summaries.reduce((sum, r) => sum + r.durationS / 3600, 0), minutes28, highlight };
};

/** Words without AI. A long break is not named, only welcomed. */
export const ruleEncouragement = (summaries: RideSummary[], nowMs: number, complaint = false): string => {
  if (complaint) return 'Hör heute auf deinen Körper. Ruhig fahren zählt genauso, und aussetzen ist auch in Ordnung.';
  const latest = Math.max(-Infinity, ...summaries.map((r) => r.startedAtMs));
  if (nowMs - latest < 7 * DAY_MS) return 'Schön, dass du dranbleibst. Jede Fahrt zählt, ganz gleich wie kurz.';
  return 'Schön, dass du da bist. Fang einfach so an, wie es sich heute gut anfühlt.';
};
