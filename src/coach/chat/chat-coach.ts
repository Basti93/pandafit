import { BO_PERSONA } from '../../shared/bo';
import { changeId, changeRecord, readNextOps, type NextOp } from '../../shared/changes';
import { CHAT_CONTEXT, CHAT_KEEP_MS, MAX_CHAT_TEXT, MAX_OBSERVATION_CHARS, chatThread, readWorkoutChange, waitingMessage, type ChatEntry, type ChatMessage } from '../../shared/chat';
import { EXERCISES, exerciseTitles, type Exercise } from '../../shared/exercises';
import { checkOps } from '../../tracking/workout-change';
import { gehtNicht } from '../../shared/wording';
import type { TrackedWorkout } from '../../tracking/session';
import type { TrackedRecord } from '../../shared/records';
import { readStats, STATS_ID } from '../../shared/stats';
import { addDays, checkWeekPlan, mondayOf, parseProposal, planOfWeek, WEEKDAY_LABEL, type WeekProposal } from '../../shared/week-plan';
import { ClaudeError } from '../claude-client';
import { dateKey } from '../day-load';
import { dataBlock } from '../meals/prompt';
import type { RecordStore } from '../tracking/store';
import { excludedOf, goalOfProfile, wishesOf } from '../tracking/personal';
import { FAMILY_IDS, isExcludableFamily, MAX_FAMILIES } from '../../shared/families';
import { effectivePush, FOCUS_GROUPS, MAX_EXCLUDED, moveRule, PUSH_QUESTION, readRule, ruleId, ruleRecord, RULE_TEXT_MAX, wishLine, type RuleDraft, type RuleKind, type RuleSport, type SportKey } from '../../shared/personal';
import { LONG_TERM_GUIDE, weekHistory } from './long-term';
import { titleHash } from '../../shared/exercise-links';
import { readTasks, type GivenTask, tasksJsonSchema } from '../coach-tasks';
import type { StrengthFacts } from '../gym/review-facts';
import { ruleNumber, ruleRange } from '../../shared/training-policy';
import { blockTakeWrites } from '../../shared/block-take';
import { activeBlock, blockId, blockRecord, readBlock, type BlockBody } from '../../shared/block';
import { resolveCatalogEntry } from '../../shared/excluded';
import { executionKey } from '../../shared/execution';
import type { ReviewOpened, ReviewReason } from './month-review';

const EXCLUDABLE = FAMILY_IDS.filter((f) => f !== 'other');

type Draft = { ops: NextOp[]; reason: string; refused?: string[] };
/** A rule or goal change the coach proposes: valid, and `note` when it had to be weakened to a wish. */
type RuleOut = { draft: RuleDraft; note?: string };
type Answer = ChatMessage & { draft?: Draft; ruleDraft?: RuleDraft; acceptsRule?: boolean };
type Ask = (input: { prompt: string; systemPrompt: string; schema: object }) => Promise<unknown>;
type Deps = {
  store: Pick<RecordStore, 'all' | 'put'>;
  ask: Ask;
  nowMs: () => number;
  newId: () => string;
  /** The profile's complaints (the bike coach keeps them; every coach reads them). Without: the complaint records. */
  complaints?: (profileId: string) => { id: string; text: string; status: string }[];
  /** Starts a complaint the rider told the chat about. */
  /** The profile's merged exercise catalog; decides which swap targets exist. Defaults to the built-ins. */
  catalog?: (profileId: string) => Exercise[];
  addComplaint?: (profileId: string, text: string) => void;
  /** Ends a complaint the rider said is over. */
  endComplaint?: (profileId: string, complaintId: string) => void;
  /** Sets a complaint the rider said is getting better, but is not gone, to healing. */
  healComplaint?: (profileId: string, complaintId: string) => void;
  /** What the bike, gym and run coach have planned next, for answers about a single session. */
  sessions?: (profileId: string) => object | null;
  /** Hands a change the rider asked for to the coach in charge, who plans again at once. */
  giveTask?: (profileId: string, task: GivenTask) => void;
  /** The strength facts of the last weeks for the monthly review; null when the gym coach cannot tell them yet. */
  strengthFacts?: (profileId: string) => StrengthFacts | null;
};

const strings = (v: unknown): string[] => (Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string') : []);

/** A rider message older than this gets no late answer. */
const STALE_MS = 2 * 86_400_000;
const DAYS_SHOWN = 28;

/** The chosen push and the one that applies now differ while a complaint is open; Bo talks about the one that applies. */
const PUSH_NOW_GUIDE = 'In ziel ist push die Härte, die die Person gewählt hat, und haerteJetzt die Härte, die gerade gilt: Bei einer offenen oder abklingenden Beschwerde ist sie vorsichtig, auch wenn die Person mehr gewählt hat. Sprich über haerteJetzt.';

export const CHAT_SYSTEM_PROMPT = `${BO_PERSONA} in Pandafit für Rad, Kraft, Laufen und Beweglichkeit, alles zusammen. Du sprichst Deutsch, kurz und warm, duzt, ohne Schuld und ohne Druck: keine Serien, kein Nachholen verpasster Einheiten, eine leichte Woche ist in Ordnung.
Du planst mit der Person ihre Woche: welche Sportart an welchem Tag und wie hart. Ruhetage gehören zum Plan, nicht jeder Tag ist Training.
Die einzelnen Einheiten (Übungen, Sätze, Watt, Laufminuten) plant jeweils eine eigene Planung für Rad (bike), Kraft (gym) und Laufen (run); was sie als Nächstes geplant haben, steht in einheiten (beim Rad auch FTP und Phase, und radFahrten sind die letzten Fahrten). Fragen dazu beantwortest du selbst, fachlich und sportwissenschaftlich begründet. Verweise die Person nie an eine andere Stelle oder ins Training..
Will die Person an einer Einheit etwas ändern (etwa "nur eine Trizepsübung", "mehr Beine", "Samstag kürzer"), gib der zuständigen Planung in tasks einen Auftrag: coach, text als klare Anweisung in ihren Worten, lasting true, wenn es ein Wunsch für länger ist, sonst false, forDate (JJJJ-MM-TT), wenn die Person einen Tag nennt ("am Montag"), sonst null ("das nächste Training"). Die Planung plant dann sofort neu. Sag in text kurz, was du weitergegeben hast. Ohne Änderungswunsch ist tasks leer.
Will die Person etwas fürs nächste Training ändern (etwa "nächstes Mal ohne Kniebeugen"), setze nextChange: ops mit exerciseId aus einheiten, und reason als ein Satz, warum. Für Tausch fürs nächste Training: nenne toId aus katalog oder toTitle; kennst du die id nicht, nenne toTitle. Ohne so einen Wunsch ist nextChange null. Es gilt erst, wenn die Person es übernimmt.
Sagt die Person "künftig", "immer" oder "nie" ("künftig keine Kniebeugen", "ich will lieber kurze Pausen"), ist das keine einmalige Änderung, sondern eine Regel: setze ruleDraft mit kind exclude (bestimmte Übungen fallen dauerhaft weg; exerciseIds aus katalog, alle Varianten dieser Übung. Will die Person eine Bewegung ganz meiden ("keine Kniebeugen"), nenne families (${EXCLUDABLE.join(', ')}); sonst exerciseIds), wish (ein allgemeiner Wunsch) oder goal (das Trainingsziel ändert sich: goal mit strength muscle, strength oder fitness, focus bis zu drei Muskelgruppen, sports mit gym, bike, run als focus, equal oder keep, nur was sich ändert; weeks von 1 bis 12 nur, wenn Schwerpunkt oder Sportarten bloß für einige Wochen gelten sollen; push gentle, normal oder hard, wenn die Person sagt, wie sehr du sie fordern sollst; das gilt dauerhaft, also ohne weeks), text als kurzer Satz in der Sicht der Person, sport gym, bike, run oder all. Sonst ist ruleDraft null. Bei einer Regel bleiben nextChange null und tasks ohne lasting-Auftrag dafür. Es gilt erst, wenn die Person es übernimmt. Bestätigt die Person einen offenen Regelentwurf ausdrücklich („trag ein“, „ja, übernehmen“), setze acceptsRule true und ruleDraft null; sonst ist acceptsRule false.
Die Person kann Mengen nennen ("2× Kraft, 3× Rad"), feste Tage ("Freitag Studio") oder dich vorschlagen lassen; oft eine Mischung. Feste Wünsche der Person markierst du mit fixed true.
Stelle höchstens eine Frage auf einmal und nur, wenn die Antwort den Plan ändert. Wenn du genug weißt, mach einen Vorschlag.
Ein Vorschlag (proposal) ist immer eine ganze Woche von Montag bis Sonntag (sieben Tage, date im Format JJJJ-MM-TT, aus wocheJetzt oder wocheNaechste) mit sport bike, gym, run, mobility oder rest und hardness easy, moderate oder hard. Bei Krafttagen sagt legs, ob Beine trainiert werden; long markiert die lange Rad- oder Laufeinheit. note ist optional und kurz. Zwei Einheiten an einem Tag (also mit sport und hardness, optional minutes) setzt du nur, wenn die Person eine Kombination ausdrücklich will, und höchstens eine davon ist hart; sonst ist ein Tag eine Einheit. Ein Wunsch wie „15–20 Min. Ausdauer im Gym“ ist also mit minutes (der kleinere Wert, ganze Minuten von 5 bis 90), keine Notiz. Ohne Vorschlag ist proposal null. Du änderst nie etwas still: Ein Vorschlag gilt erst, wenn die Person ihn übernimmt.
Regeln, die der Code prüft: höchstens zwei harte Tage pro Woche; kein harter Rad- oder Lauftag am Tag nach einem harten Beintag; die lange Einheit nicht am Tag nach einem Beintag; höchstens zwei Einheiten pro Tag, die zweite nur auf Wunsch.
Will die Person ausdrücklich mehr als die Regeln erlauben, sag einmal klar und ohne Drama, was du davon hältst, und setze riderAskedForMore auf true; sonst ist es false. Bei offenen Beschwerden (beschwerden) bleibst du vorsichtig, das gilt immer.
Plane nur Sportarten, die die Person macht oder ausdrücklich will (siehe letzteTage). Hevy und Garmin sind optional; erwähne sie nicht.
Beschwerden kommen jetzt über diesen Chat: Erzählt die Person von einem neuen Schmerz oder Zwicken (etwa "Knie zwickt"), setze newComplaint auf einen kurzen Text in ihren Worten und plane vorsichtig; sonst ist newComplaint null. Sagt sie, dass eine Beschwerde aus beschwerden vorbei ist, nenne deren id in complaintsOver; sonst ist complaintsOver leer. Sagt sie, dass eine Beschwerde besser wird, aber noch nicht weg ist, nenne deren id in complaintsHealing; sonst ist complaintsHealing leer. Ohne klare Aussage änderst du nichts. Frag nicht nach, ob du sie eintragen sollst.
${PUSH_NOW_GUIDE}
${LONG_TERM_GUIDE} Wenn es passt, sag in einem Halbsatz, wo die Person gerade steht (etwa „dritte volle Woche, nächste Woche darf leichter werden“).
Antworte in text in ein bis vier Sätzen. Medizinische Ratschläge gibst du nicht.`;

export const WORKOUT_SYSTEM_PROMPT = `${BO_PERSONA} in Pandafit und begleitest die Person gerade in ihrem laufenden Krafttraining. Du sprichst Deutsch, sehr kurz und warm, duzt; sie steht im Studio und liest zwischen zwei Sätzen.
Sie sagt dir etwa "Gerät belegt", "Schulter zwickt" oder "nur noch 30 Minuten". Schlag dann vor, wie der Rest dieses Trainings aussieht, als change mit ops; ohne Änderung ist change null.
ops: drop (die offenen Sätze einer Übung fallen weg), swap (die offenen Sätze wandern zu einer anderen Übung aus katalog, to ist deren id, nimm eine mit demselben Muskel und einem Gerät, das frei ist), sets (open: so viele offene Sätze bleiben), lighter (pct 5 bis 30: die offenen Sätze werden um so viel Prozent leichter). ex ist immer die ex-Kennung einer Übung aus training, die noch offene Sätze hat. Erledigte Sätze änderst du nie.
Bei Schmerzen: die betroffene Bewegung weglassen oder deutlich leichter, nie durchziehen; keine medizinischen Ratschläge. Erzählt die Person von einem neuen Schmerz, setze newComplaint auf einen kurzen Text in ihren Worten; sonst null. Sagt sie, eine Beschwerde aus beschwerden ist vorbei, nenne deren id in complaintsOver. Sagt sie, dass eine Beschwerde besser wird, aber noch nicht weg ist, nenne deren id in complaintsHealing; sonst ist complaintsHealing leer. Ohne klare Aussage änderst du nichts.
Meint die Person das nächste Training statt dieses ("nächstes Mal"), setze statt change nextChange: ops mit exerciseId (die Übungs-id aus katalog oder training) und reason als ein Satz; für einen Tausch nenne toId aus katalog oder toTitle, kennst du die id nicht, nenne toTitle; sonst null. Nichts ändert sich, bevor die Person den Vorschlag übernimmt. Sagt sie "künftig/immer/nie", setze ruleDraft (kind exclude mit exerciseIds aus katalog, wish oder goal; text, sport); sonst null. Bestätigt die Person einen offenen Regelentwurf ausdrücklich („trag ein“, „ja, übernehmen“), setze acceptsRule true und ruleDraft null; sonst ist acceptsRule false. text: ein bis zwei Sätze.`;

export const REVIEW_SYSTEM_PROMPT = `${BO_PERSONA} in Pandafit und schreibst der Person ihren Monatsrückblick, ohne dass sie dir geschrieben hat. Du sprichst Deutsch, kurz und warm, duzt. Du bist ehrlich und ermutigend, Regelmäßigkeit vor Gewichten.
Du siehst auf die letzten drei Monate: wochen (Minuten je Sportart und harte Tage je Woche), kraft (Krafttrainings je Woche, wie sich die häufigsten Übungen entwickeln, Muskelgruppen, die dauerhaft unter dem Ziel liegen), geplant (Krafttage je Woche im Wochenplan, null ohne Plan), ziel, Wünsche, Ausschlüsse und beschwerden. anlass sagt, warum der Rückblick jetzt kommt. ${PUSH_NOW_GUIDE}
opening: ein ehrlicher, ermutigender Satz zu diesem Monat.
observations: höchstens drei Beobachtungen aus den drei Monaten, die für das Ziel wirklich zählen. text ist die Beobachtung als ganzer Satz, reason ein ganzer Satz, warum sie zählt. Lieber weniger als belanglose.
complaintQuestions: für jede Beschwerde aus beschwerden genau eine kurze, freundliche Frage, wie es damit inzwischen geht, mit ihrer id.
nextWeeks: ein bis zwei Sätze als Vorschlag für die nächsten Wochen, passend zum Ziel.
block: ein fester Abschnitt für die nächsten 4 bis 6 Wochen, oder null. templates sind die Vorlagen der Krafttage, je mit name (etwa „Oberkörper A“) und core, den Kernübungen. rhythm ist eine Woche von Montag bis Sonntag, sieben Tage mit sport bike, gym, run, mobility oder rest und hardness easy, moderate oder hard; legs sagt bei Krafttagen, ob Beine trainiert werden, long markiert die lange Rad- oder Laufeinheit, template ist bei Krafttagen die Stelle der Vorlage in templates, ab 0. Für den Rhythmus gelten die Regeln für Erholung, auch von Sonntag auf Montag: höchstens zwei harte Tage pro Woche, kein harter Rad- oder Lauftag am Tag nach einem harten Beintag, die lange Einheit nicht am Tag nach einem Beintag. Läuft schon ein Abschnitt (abschnitt), ist block null. Schlag einen festen Abschnitt nur vor, wenn er zum Ziel und zu den letzten Wochen passt; sonst bleib locker. Kernübungen nach Ziel, Vorlieben und Regeln der Person, nie ausgeschlossene, 3 bis 4 je Vorlage, ids aus katalog.
Keine Vorwürfe, keine Serien, nie „du hast nur“. Hat die Person weniger trainiert, passt du den Rahmen an und sagst ehrlich, was das für ihr Ziel bedeutet. Sprich nie über Körpergewicht, Kalorien oder Aussehen. Schlag nichts vor, was gegen ihre Ausschlüsse, Wünsche oder Beschwerden geht. Medizinische Ratschläge gibst du nicht.`;

const reviewSchema = {
  type: 'object', additionalProperties: false, required: ['opening', 'observations', 'complaintQuestions', 'nextWeeks', 'block'],
  properties: {
    opening: { type: 'string' },
    observations: { type: 'array', items: { type: 'object', additionalProperties: false, required: ['text', 'reason'], properties: { text: { type: 'string' }, reason: { type: 'string' } } } },
    complaintQuestions: { type: 'array', items: { type: 'object', additionalProperties: false, required: ['id', 'question'], properties: { id: { type: 'string' }, question: { type: 'string' } } } },
    nextWeeks: { type: 'string' },
    block: { anyOf: [{ type: 'null' }, {
      type: 'object', additionalProperties: false, required: ['templates', 'rhythm'],
      properties: {
        templates: { type: 'array', items: { type: 'object', additionalProperties: false, required: ['name', 'core'], properties: { name: { type: 'string' }, core: { type: 'array', items: { type: 'string' } } } } },
        rhythm: { type: 'array', items: {
          type: 'object', additionalProperties: false, required: ['sport', 'hardness'],
          properties: { sport: { enum: ['bike', 'gym', 'run', 'mobility', 'rest'] }, hardness: { enum: ['easy', 'moderate', 'hard'] }, legs: { type: 'boolean' }, long: { type: 'boolean' }, template: { type: 'integer' } },
        } },
      },
    }] },
  },
};

/** Why the review comes now, in the words the prompt gives the model. */
const REVIEW_REASON: Record<ReviewReason, string> = {
  month: 'Der Monat ist zu Ende.',
  sports: 'Der Schwerpunkt im Ziel hat sich geändert.',
  pause: 'Die Person trainiert nach einer längeren Pause wieder Kraft.',
};

const nextChangeSchema = { anyOf: [{ type: 'null' }, {
  type: 'object', additionalProperties: false, required: ['ops', 'reason'],
  properties: { reason: { type: 'string' }, ops: { type: 'array', items: {
    type: 'object', additionalProperties: false, required: ['op', 'exerciseId'],
    properties: { op: { enum: ['drop', 'swap', 'sets', 'lighter'] }, exerciseId: { type: 'string' }, toId: { type: 'string' }, toTitle: { type: 'string' }, sets: { type: 'integer' } },
  } } },
}] };

const prio = { enum: ['focus', 'equal', 'keep'] };
const ruleDraftSchema = { anyOf: [{ type: 'null' }, {
  type: 'object', additionalProperties: false, required: ['kind', 'text', 'sport'],
  properties: {
    kind: { enum: ['exclude', 'wish', 'goal'] }, text: { type: 'string' }, sport: { enum: ['gym', 'bike', 'run', 'all'] },
    exerciseIds: { type: 'array', items: { type: 'string' } },
    families: { type: 'array', items: { enum: EXCLUDABLE } },
    goal: { type: 'object', additionalProperties: false, properties: {
      strength: { enum: ['muscle', 'strength', 'fitness'] }, focus: { type: 'array', items: { enum: FOCUS_GROUPS } },
      sports: { type: 'object', additionalProperties: false, properties: { gym: prio, bike: prio, run: prio } },
      push: { enum: ['gentle', 'normal', 'hard'] },
      weeks: { type: 'integer', minimum: 1, maximum: 12 },
    } },
  },
}] };

const workoutSchema = {
  type: 'object', additionalProperties: false, required: ['text', 'change', 'newComplaint', 'complaintsOver', 'complaintsHealing', 'nextChange', 'ruleDraft', 'acceptsRule'],
  properties: {
    text: { type: 'string' },
    acceptsRule: { type: 'boolean' },
    nextChange: nextChangeSchema,
    ruleDraft: ruleDraftSchema,
    newComplaint: { anyOf: [{ type: 'null' }, { type: 'string' }] },
    complaintsOver: { type: 'array', items: { type: 'string' } },
    complaintsHealing: { type: 'array', items: { type: 'string' } },
    change: { anyOf: [{ type: 'null' }, {
      type: 'object', additionalProperties: false, required: ['ops'],
      properties: { ops: { type: 'array', items: {
        type: 'object', additionalProperties: false, required: ['op', 'ex'],
        properties: { op: { enum: ['drop', 'swap', 'sets', 'lighter'] }, ex: { type: 'string' }, to: { type: 'string' }, open: { type: 'integer' }, pct: { type: 'number' } },
      } } },
    }] },
  },
};

const answerSchema = {
  type: 'object', additionalProperties: false, required: ['text', 'proposal', 'riderAskedForMore', 'newComplaint', 'complaintsOver', 'complaintsHealing', 'tasks', 'nextChange', 'ruleDraft', 'acceptsRule'],
  properties: {
    text: { type: 'string' },
    acceptsRule: { type: 'boolean' },
    nextChange: nextChangeSchema,
    ruleDraft: ruleDraftSchema,
    tasks: tasksJsonSchema,
    newComplaint: { anyOf: [{ type: 'null' }, { type: 'string' }] },
    complaintsOver: { type: 'array', items: { type: 'string' } },
    complaintsHealing: { type: 'array', items: { type: 'string' } },
    riderAskedForMore: { type: 'boolean' },
    proposal: {
      anyOf: [{ type: 'null' }, {
        type: 'object', additionalProperties: false, required: ['weekStart', 'days'],
        properties: {
          weekStart: { type: 'string' },
          days: { type: 'array', items: {
            type: 'object', additionalProperties: false, required: ['date', 'sport', 'hardness', 'fixed'],
            properties: {
              date: { type: 'string' }, sport: { enum: ['bike', 'gym', 'run', 'mobility', 'rest'] }, hardness: { enum: ['easy', 'moderate', 'hard'] },
              fixed: { type: 'boolean' }, legs: { type: 'boolean' }, long: { type: 'boolean' }, note: { type: 'string' },
              also: { type: 'object', additionalProperties: false, required: ['sport', 'hardness'], properties: { sport: { enum: ['bike', 'gym', 'run', 'mobility'] }, hardness: { enum: ['easy', 'moderate', 'hard'] }, minutes: { type: ['integer', 'null'] } } },
            },
          } },
        },
      }],
    },
  },
};

const isObj = (x: unknown): x is Record<string, unknown> => typeof x === 'object' && x !== null && !Array.isArray(x);
const weekday = (date: string) => WEEKDAY_LABEL[(new Date(`${date}T12:00:00`).getDay() + 6) % 7];

/** Answers the rider's chat messages of the profiles coached here, one at a time per profile. */
export class ChatCoach {
  private busy = new Set<string>();
  constructor(private deps: Deps) {}

  isThinking(id: string): boolean { return this.busy.has(id); }

  /** Answers the waiting message, if any. Returns whether it wrote an answer. Never throws. */
  async tick(id: string): Promise<boolean> {
    if (this.busy.has(id)) return false;
    try {
      const all = this.deps.store.all(id, 'chat');
      this.prune(id, all);
      const thread = chatThread(all);
      const waiting = waitingMessage(thread);
      const now = this.deps.nowMs();
      if (!waiting || now - waiting.atMs > STALE_MS) return false;
      this.busy.add(id);
      let answer: Answer;
      try {
        answer = waiting.inWorkout ? await this.answerWorkout(id, waiting, thread) : await this.answer(id, this.prompt(id, thread.slice(-CHAT_CONTEXT), now), now);
      } catch (e) {
        const limit = e instanceof ClaudeError && e.kind === 'limit';
        answer = { role: 'coach', text: limit ? 'Mein Claude-Kontingent ist gerade aufgebraucht. Schreib mir später nochmal.' : 'Ich komme gerade nicht durch. Schreib mir gleich nochmal.', atMs: this.deps.nowMs(), failed: true };
      }
      const { draft, ruleDraft, acceptsRule, ...msg } = answer;
      const accepted = acceptsRule && !answer.failed ? this.acceptOpenRule(id, thread, waiting, now, msg) : false;
      this.put(id, { ...msg, replyTo: waiting.id, ...(waiting.inWorkout ? { inWorkout: waiting.inWorkout } : {}) }, draft, accepted ? null : ruleDraft);
      return true;
    } catch { return false; } finally { this.busy.delete(id); }
  }

  /** The yes to an open section: the same writes as the Übernehmen button. Sets `block` on the reply (the card then shows Rückgängig). */
  private acceptOpenBlock(id: string, prev: ChatEntry, now: number, msg: ChatMessage): boolean {
    const rec = this.deps.store.all(id, 'block').find((r) => r.id === prev.block);
    const writes = rec ? blockTakeWrites({ block: rec, frame: this.deps.store.all(id, 'frame'), plans: this.deps.store.all(id, 'weekplan'), msgId: prev.id, today: dateKey(now), nowMs: now }) : null;
    if (!writes) {
      msg.text += '\nIch sehe gerade keinen offenen Vorschlag, den ich übernehmen könnte. Deshalb gilt noch kein neuer Abschnitt.';
      return false;
    }
    for (const w of writes) this.deps.store.put(id, w);
    msg.block = prev.block;
    return true;
  }

  /**
   * The rider's explicit yes to the open rule draft: the draft of the coach message right before hers becomes active, the same
   * move as the Übernehmen button. In a workout only the coach messages of that workout count. A goal is never taken from the
   * chat. Sets `rule` on the reply (the card then shows Rückgängig); without an open draft the reply says so.
   * Returns whether the rule was taken.
   */
  private acceptOpenRule(id: string, thread: ChatEntry[], waiting: ChatEntry, now: number, msg: ChatMessage): boolean {
    const before = thread.slice(0, thread.findIndex((m) => m.id === waiting.id));
    // The Härte question that follows a review is no proposal: the yes still means the message before it.
    const prev = before.reverse().find((m) => m.role === 'coach' && !m.askPush && (!waiting.inWorkout || m.inWorkout === waiting.inWorkout));
    if (prev?.block) return this.acceptOpenBlock(id, prev, now, msg);
    const rid = prev?.rule;
    const cur = rid ? this.deps.store.all(id, 'rule').find((r) => r.id === rid) : undefined;
    const open = cur ? readRule(cur.id, cur.body) : null;
    if (!cur || !open || open.state !== 'proposed') {
      msg.text += '\nIch sehe gerade keinen offenen Vorschlag, den ich übernehmen könnte. Deshalb gilt noch keine neue Regel.';
      return false;
    }
    if (open.kind === 'goal') {
      if (!msg.text.includes('Übernehmen')) msg.text += '\nEin neues Ziel übernimmst du selbst mit „Übernehmen“ auf der Karte.';
      return false;
    }
    const next = moveRule(cur, 'active', now);
    if (!next) return false;
    this.deps.store.put(id, next);
    msg.rule = cur.id;
    return true;
  }

  private async answer(id: string, prompt: string, now: number, fromRider = true): Promise<Answer> {
    const ask = async (p: string) => {
      const raw = await this.deps.ask({ prompt: p, systemPrompt: CHAT_SYSTEM_PROMPT, schema: answerSchema });
      if (!isObj(raw) || typeof raw.text !== 'string') throw new ClaudeError('invalid', 'Keine Antwort.');
      return {
        text: raw.text.trim().slice(0, 1500), proposal: this.proposalOf(raw.proposal, now), more: raw.riderAskedForMore === true,
        complaint: typeof raw.newComplaint === 'string' && raw.newComplaint.trim() ? raw.newComplaint.trim().slice(0, 200) : null,
        over: strings(raw.complaintsOver),
        healing: strings(raw.complaintsHealing),
        tasks: readTasks(raw.tasks),
        draft: this.draftOf(id, raw.nextChange),
        nextRaw: raw.nextChange,
        ruleRaw: raw.ruleDraft,
        accepts: raw.acceptsRule === true,
      };
    };
    let a = await ask(prompt);
    // The coach does not see the catalog by default. Only a rule or a swap that names exercises it could not name gets one more try, with the catalog.
    if (fromRider && this.needsCatalog(id, a.ruleRaw, a.nextRaw)) {
      try { a = await ask(`${prompt}\n${this.catalogBlock(id)}\nNenne in ruleDraft.exerciseIds und bei einem Tausch in nextChange als toId die ids aus katalog.`); } catch { /* the first answer decides */ }
    }
    // Only the rider's own words start or end a complaint, never a message the coach opened by itself.
    if (fromRider) this.applyComplaints(id, a.complaint, a.over, a.healing);
    // Only the rider's own words change a session; a message the coach opened by itself never does.
    // A lasting wish of the rider is a rule she confirms, not a task; a one-off request is a task.
    if (fromRider) for (const t of a.tasks) { try { if (t.lasting) this.proposeWish(id, t, now); else this.deps.giveTask?.(id, t); } catch { /* the rider can ask again */ } }
    const careful = this.complaintList(id).length > 0;
    let broken = a.proposal ? checkWeekPlan(a.proposal.days) : [];
    if (broken.length && (!a.more || careful)) {
      try { a = await ask(`${prompt}\nDein Vorschlag bricht diese Regeln: ${broken.join(' ')} Korrigiere ihn.`); } catch { /* the first answer decides */ }
      broken = a.proposal ? checkWeekPlan(a.proposal.days) : [];
    }
    const msg: Answer = { role: 'coach', text: a.text || 'Okay.', atMs: this.deps.nowMs(), ...(fromRider && a.accepts ? { acceptsRule: true } : {}) };
    // Only the rider's own words propose a change for the next workout.
    if (fromRider && a.draft) {
      const line = gehtNicht(a.draft.refused ?? []);
      if (line) msg.text += `\n${line}`;
      if (a.draft.ops.length) msg.draft = { ops: a.draft.ops, reason: a.draft.reason };
    }
    // Only the rider's own words propose a rule or a goal.
    if (fromRider) this.addRule(msg, id, a.ruleRaw);
    if (a.proposal && broken.length === 0) msg.proposal = a.proposal;
    else if (a.proposal && a.more && !careful) { msg.proposal = a.proposal; msg.warnings = broken; }
    else if (a.proposal) msg.text += `\n\nMein Vorschlag passte nicht zu unseren Regeln für Erholung (${broken.map((b) => b.replace(/\.$/, '')).join('; ')}), deshalb lasse ich ihn weg. Sag mir, was dir wichtig ist, dann versuche ich es anders.`;
    return msg;
  }

  /** The rider's lasting wish for a coach, as a proposed wish rule (the rider confirms it in the rules). */
  private proposeWish(id: string, t: GivenTask, now: number): void {
    const text = t.text.replace(/\s+/g, ' ').trim().slice(0, RULE_TEXT_MAX);
    if (!text) return;
    const rid = ruleId(`w-${titleHash(`${t.to}\n${text}`)}`);
    if (this.deps.store.all(id, 'rule').some((r) => r.id === rid)) return; // asked before: accepted or declined stays
    this.deps.store.put(id, ruleRecord(rid, { kind: 'wish', text, sport: t.to }, 'proposed', 'chat', now));
  }

  /** Complaints apply at once, from the first answer: they only ever make the coaches more careful. */
  private applyComplaints(id: string, complaint: string | null, over: string[], healing: string[]): void {
    const open = this.complaintList(id);
    if (complaint && !open.some((c) => c.text.toLowerCase() === complaint.toLowerCase())) { try { this.deps.addComplaint?.(id, complaint); } catch { /* the rider can say it again */ } }
    for (const cid of over) if (open.some((c) => c.id === cid)) { try { this.deps.endComplaint?.(id, cid); } catch { /* stays open */ } }
    // An id in both lists counts as over.
    for (const cid of healing) if (!over.includes(cid) && open.some((c) => c.id === cid && c.status !== 'healing')) { try { this.deps.healComplaint?.(id, cid); } catch { /* stays as it is */ } }
  }

  /** An answer about the rest of the open workout the message was written in. */
  private async answerWorkout(id: string, waiting: ChatEntry, thread: ChatEntry[]): Promise<Answer> {
    const rec = this.deps.store.all(id, 'workout').find((r) => r.id === waiting.inWorkout && !r.deleted);
    const w = rec && isObj(rec.body) && Array.isArray(rec.body.exercises) ? rec.body as unknown as TrackedWorkout : null;
    const at = this.deps.nowMs();
    if (!w || w.endMs !== null) return { role: 'coach', text: 'Dieses Training ist schon beendet. Für die Woche schreib mir gern im Tab Woche.', atMs: at };
    const sets = (s: TrackedWorkout['exercises'][number]['sets'], done: boolean) => s.filter((x) => (x.doneMs !== null) === done).map((x) => ({ kg: x.weightKg, wdh: x.reps, typ: x.type }));
    const prompt = [
      dataBlock('training', { name: w.title, minutenSeitStart: Math.round((at - w.startMs) / 60_000), uebungen: w.exercises.map((e) => ({ ex: e.rid, uebungId: e.exerciseId, uebung: e.title, erledigt: sets(e.sets, true), offen: sets(e.sets, false) })) }),
      this.catalogBlock(id, true),
      dataBlock('beschwerden', this.complaintList(id)),
      ...this.wishLines(id, ['gym']),
      dataBlock('verlauf', thread.filter((m) => m.inWorkout === w.id).slice(-10).map((m) => ({ von: m.role === 'rider' ? 'person' : 'coach', text: m.text }))),
      'Antworte auf die letzte Nachricht der Person im Verlauf.',
    ].join('\n');
    const raw = await this.deps.ask({ prompt, systemPrompt: WORKOUT_SYSTEM_PROMPT, schema: workoutSchema });
    if (!isObj(raw) || typeof raw.text !== 'string') throw new ClaudeError('invalid', 'Keine Antwort.');
    this.applyComplaints(id, typeof raw.newComplaint === 'string' && raw.newComplaint.trim() ? raw.newComplaint.trim().slice(0, 200) : null,
      strings(raw.complaintsOver), strings(raw.complaintsHealing));
    const msg: Answer = { role: 'coach', text: raw.text.trim().slice(0, 1000) || 'Okay.', atMs: this.deps.nowMs(), inWorkout: w.id, ...(raw.acceptsRule === true ? { acceptsRule: true } : {}) };
    const draft = this.draftOf(id, raw.nextChange);
    if (draft) {
      const refusal = gehtNicht(draft.refused ?? []);
      if (refusal) msg.text = `${msg.text}\n${refusal}`;
      if (draft.ops.length) msg.draft = { ops: draft.ops, reason: draft.reason };
    }
    this.addRule(msg, id, raw.ruleDraft);
    const change = isObj(raw.change) ? readWorkoutChange({ workoutId: w.id, ops: raw.change.ops }) : null;
    const { ops, reasons } = change ? checkOps(change, w, this.deps.catalog?.(id) ?? EXERCISES, excludedOf(this.deps.store, id, this.catalogOf(id))) : { ops: [], reasons: [] };
    if (ops.length > 0) msg.workoutChange = { workoutId: w.id, ops };
    const line = gehtNicht(reasons);
    if (line) msg.text = `${msg.text}\n${line}`;
    return msg;
  }

  private catalogOf(id: string): Exercise[] { return this.deps.catalog?.(id) ?? EXERCISES; }

  /** The compact catalog the coach gets when it has to name an exercise: id, title and muscle (and the equipment when asked), without the excluded ones. */
  private catalogBlock(id: string, withEquipment = false): string {
    const out = excludedOf(this.deps.store, id, this.catalogOf(id));
    return dataBlock('katalog', this.catalogOf(id).filter((e) => !out.has(e.id)).map((e) => ({ id: e.id, titel: e.title, muskel: e.primaryMuscle, ...(withEquipment ? { geraet: e.equipment } : {}) })));
  }

  /** An exclude rule that names no exercise the catalog knows, or a swap whose target is not in the catalog. */
  private needsCatalog(id: string, rule: unknown, next: unknown): boolean {
    return (isObj(rule) && rule.kind === 'exclude' && this.validIds(rule.exerciseIds, this.catalogOf(id)).length === 0 && this.validFamilies(rule.families).length === 0) || this.splitOps(id, next).unknown > 0;
  }

  /** The ops of a next-change draft with every swap target resolved (by id, else by a title, ignoring case and extra whitespace); `unknown` counts the swaps still without a catalog target (those are left out of `ops`). */
  private splitOps(id: string, x: unknown): { ops: unknown[]; unknown: number } {
    if (!isObj(x) || !Array.isArray(x.ops)) return { ops: [], unknown: 0 };
    const catalog = this.catalogOf(id);
    let unknown = 0;
    const ops = x.ops.flatMap((o): unknown[] => {
      if (!isObj(o) || o.op !== 'swap') return [o];
      if (typeof o.toId === 'string' && catalog.some((e) => e.id === o.toId)) return [o];
      const norm = (t: string) => t.toLocaleLowerCase('de').split(/\s+/).filter(Boolean).join(' ');
      const title = typeof o.toTitle === 'string' ? norm(o.toTitle) : '';
      const hit = title ? catalog.find((e) => exerciseTitles(e).some((t) => norm(t) === title)) : undefined;
      if (hit) return [{ ...o, toId: hit.id }];
      unknown++;
      return [];
    });
    return { ops, unknown };
  }

  private validFamilies(x: unknown): string[] {
    return Array.isArray(x) ? [...new Set(x.filter(isExcludableFamily))].slice(0, MAX_FAMILIES) : [];
  }

  private validIds(x: unknown, catalog: readonly Exercise[]): string[] {
    return Array.isArray(x) ? [...new Set(x.filter((i): i is string => typeof i === 'string' && catalog.some((e) => e.id === i)))].slice(0, MAX_EXCLUDED) : [];
  }

  /** A rule or goal change the coach proposed: a valid draft, or null. Unknown ids are dropped; an exclude without any valid id becomes a wish. */
  private ruleOf(id: string, x: unknown): RuleOut | null {
    if (!isObj(x) || !['exclude', 'wish', 'goal'].includes(x.kind as string) || typeof x.text !== 'string') return null;
    const text = x.text.replace(/\s+/g, ' ').trim();
    if (!text || text.length > RULE_TEXT_MAX) return null;
    let kind = x.kind as RuleKind;
    const sport: RuleSport = kind === 'goal' ? 'all' : (['gym', 'bike', 'run', 'all'].includes(x.sport as string) ? x.sport as RuleSport : 'all');
    let note: string | undefined;
    let exerciseIds: string[] | undefined;
    let families: string[] | undefined;
    if (kind === 'exclude') {
      const ids = this.validIds(x.exerciseIds, this.catalogOf(id));
      const fams = this.validFamilies(x.families);
      if (ids.length) exerciseIds = ids;
      if (fams.length) families = fams;
      if (!exerciseIds && !families) { kind = 'wish'; note = 'Ich konnte keine bestimmte Übung zuordnen, deshalb merke ich es mir als allgemeinen Wunsch.'; }
    }
    const draft: RuleDraft = { kind, text, sport, ...(exerciseIds ? { exerciseIds } : {}), ...(families ? { families } : {}), ...(kind === 'goal' && isObj(x.goal) ? { goal: x.goal as RuleDraft['goal'] } : {}) };
    // The same reader the app uses decides whether the draft is well formed (a goal needs a readable partial).
    const read = readRule('x', ruleRecord('x', draft, 'proposed', 'chat', 0).body);
    if (!read || (kind === 'goal' && Object.keys(read.goal ?? {}).length === 0)) return null;
    return { draft, ...(note ? { note } : {}) };
  }

  private addRule(msg: Answer, id: string, raw: unknown): void {
    const r = this.ruleOf(id, raw);
    if (!r) return;
    msg.ruleDraft = r.draft;
    if (r.note) msg.text += `\n${r.note}`;
  }

  /** The goal as data, with the push that applies now next to the chosen one. */
  private goalBlock(id: string, today: string, complaints: readonly { status: string }[]): string {
    const goal = goalOfProfile(this.deps.store, id, today);
    return dataBlock('ziel', { ...goal, haerteJetzt: effectivePush(goal, complaints) });
  }

  /** One line with the active wishes of these sports, or nothing. Same wording as in the planners' prompts. */
  private wishLines(id: string, sports: SportKey[]): string[] {
    const line = wishLine([...new Set(sports.flatMap((s) => wishesOf(this.deps.store, id, s)))]);
    return line ? [line] : [];
  }

  /** A change for the next workout the coach proposed: valid ops and a reason, or null. */
  private draftOf(id: string, x: unknown): Draft | null {
    if (!isObj(x)) return null;
    const split = this.splitOps(id, x);
    const read = split.ops.length ? readNextOps(split.ops, this.catalogOf(id)) : split.unknown ? [] : null;
    const reason = typeof x.reason === 'string' ? x.reason.trim().slice(0, 200) : '';
    if (!read || !reason) return null;
    // A swap into an excluded exercise is refused whole; the others stay. `refused` carries the reasons to the message.
    const excluded = excludedOf(this.deps.store, id, this.catalogOf(id));
    const catalog = this.deps.catalog?.(id) ?? EXERCISES;
    const refused = [
      ...read.flatMap((o) => (o.op === 'swap' && excluded.has(o.toId) ? [`du ${catalog.find((e) => e.id === o.toId)?.title ?? 'die Übung'} ausgeschlossen hast`] : [])),
      ...(split.unknown ? ['die Übung nicht im Katalog steht'] : []),
    ];
    const ops = read.filter((o) => !(o.op === 'swap' && excluded.has(o.toId)));
    return ops.length || refused.length ? { ops, reason, ...(refused.length ? { refused } : {}) } : null;
  }

  /** A proposal for this or next week only. */
  private proposalOf(x: unknown, now: number): WeekProposal | null {
    const p = parseProposal(x);
    const monday = mondayOf(dateKey(now));
    return p && (p.weekStart === monday || p.weekStart === addDays(monday, 7)) ? p : null;
  }

  /** The exercises of the planned next strength workout, with their ids. */
  private nextExercises(id: string): { exerciseId: string; titel: string }[] | null {
    const body = this.deps.store.all(id, 'plan').find((r) => r.id === 'current' && !r.deleted)?.body;
    const ex = isObj(body) && isObj(body.workout) && Array.isArray(body.workout.exercises) ? body.workout.exercises : null;
    const out = excludedOf(this.deps.store, id, this.catalogOf(id));
    return ex ? ex.flatMap((e) => (isObj(e) && typeof e.templateId === 'string' && !out.has(e.templateId) ? [{ exerciseId: e.templateId, titel: String(e.title ?? '') }] : [])) : null;
  }

  private sessionsOf(id: string): object | null {
    try { return this.deps.sessions?.(id) ?? null; } catch { return null; }
  }

  /** The open complaints with their ids. */
  private complaintList(id: string): { id: string; text: string; status: string }[] {
    if (this.deps.complaints) return this.deps.complaints(id).filter((c) => c.status !== 'over');
    return this.deps.store.all(id, 'complaint').filter((r) => !r.deleted && isObj(r.body) && r.body.status !== 'over' && typeof r.body.text === 'string')
      .map((r) => ({ id: r.id, text: (r.body as { text: string }).text, status: String((r.body as { status: unknown }).status) }));
  }

  /** The week conversation: the coach opens it with a proposal for next week, without being asked. Never throws. */
  async openWeek(id: string): Promise<boolean> {
    if (this.busy.has(id)) return false;
    this.busy.add(id);
    try {
      const now = this.deps.nowMs();
      const thread = chatThread(this.deps.store.all(id, 'chat'));
      const prompt = this.prompt(id, thread.slice(-CHAT_CONTEXT), now, 'Das ist das Wochengespräch, die Person hat dir gerade nicht geschrieben. Blick in einem Halbsatz auf die letzte Woche zurück, ohne Schuld, und schlag die nächste Woche vor (wocheNaechste). Frag kurz, ob es so passt.');
      const msg = await this.answer(id, prompt, now, false);
      this.put(id, { ...msg, push: true });
      return true;
    } catch { return false; } finally { this.busy.delete(id); }
  }

  /**
   * The monthly review: Bo writes it without being asked, with a push. The structure is fixed here (opening, at most
   * `review.max-observations` observations with their reasons, one question per open complaint, a suggestion for the next
   * weeks); only the words come from the model. It reads the stored data, never the chat thread. Returns whether it wrote the
   * message ('asked' when it also asked how hard Bo may push); false while busy or when Claude fails. Never throws. With
   * `askPush` (Bo has not asked yet) it also asks, unless that was chosen or a complaint is open (then gentle applies by itself).
   */
  async openReview(id: string, reason: ReviewReason, askPush = false): Promise<ReviewOpened> {
    if (this.busy.has(id)) return false;
    this.busy.add(id);
    try {
      const now = this.deps.nowMs();
      const complaints = this.complaintList(id);
      const raw = await this.deps.ask({ prompt: this.reviewPrompt(id, now, complaints, reason), systemPrompt: REVIEW_SYSTEM_PROMPT, schema: reviewSchema });
      if (!isObj(raw) || typeof raw.opening !== 'string' || typeof raw.nextWeeks !== 'string' || !raw.opening.trim() || !raw.nextWeeks.trim()) return false;
      const clip = (x: unknown, max: number) => (typeof x === 'string' ? x.replace(/\s+/g, ' ').trim().slice(0, max) : '');
      const observations = (Array.isArray(raw.observations) ? raw.observations : [])
        .flatMap((o) => { const text = isObj(o) ? clip(o.text, MAX_OBSERVATION_CHARS) : '', why = isObj(o) ? clip(o.reason, MAX_OBSERVATION_CHARS) : ''; return text && why ? [{ text, reason: why }] : []; })
        .slice(0, ruleNumber('review.max-observations'));
      const asked = Array.isArray(raw.complaintQuestions) ? raw.complaintQuestions.filter(isObj) : [];
      const questions = complaints.map((c) => clip(asked.find((q) => q.id === c.id)?.question, 200) || `Du hattest „${c.text}“ erwähnt. Wie geht es dir damit inzwischen?`);
      const compose = () => [[clip(raw.opening, 300)], observations.map((o) => `${o.text} ${o.reason}`), questions, [clip(raw.nextWeeks, 300)]]
        .filter((part) => part.length > 0).map((part) => part.join('\n')).join('\n\n');
      // The whole message must fit into a chat message: observations go from the end first, never the questions or the suggestion.
      let text = compose();
      while (text.length > MAX_CHAT_TEXT && observations.length > 0) { observations.pop(); text = compose(); }
      const ask = askPush && complaints.length === 0 && goalOfProfile(this.deps.store, id, dateKey(now)).push === undefined;
      const block = this.blockOf(id, raw.block, now);
      // One card per message: with a section proposed, the push question follows as its own message, so both stay open to answer.
      this.put(id, { role: 'coach', text, atMs: now, push: true, review: { observations }, ...(ask && !block ? { askPush: true as const } : {}) }, null, null, block);
      if (ask && block) this.put(id, { role: 'coach', text: PUSH_QUESTION, atMs: now + 1, askPush: true });
      return ask ? 'asked' : 'written';
    } catch { return false; } finally { this.busy.delete(id); }
  }

  /**
   * The fixed section the review proposes, as a `proposed` body, or null. Core exercises must be catalog exercises, never
   * excluded, and not the same execution twice in one template (a later one goes); at most `block.core-per-template` stay.
   * The reader the app uses then decides the rest (enough core exercises, the recovery rules of the rhythm). None while a
   * section runs.
   */
  private blockOf(id: string, x: unknown, now: number): BlockBody | null {
    if (!isObj(x) || !Array.isArray(x.templates) || activeBlock(this.deps.store.all(id, 'block'), dateKey(now))) return null;
    const catalog = this.catalogOf(id);
    const out = excludedOf(this.deps.store, id, catalog);
    const templates = x.templates.map((t) => {
      if (!isObj(t)) return t;
      const seen = new Set<string>();
      const core = strings(t.core).flatMap((cid) => {
        const e = resolveCatalogEntry({ id: cid }, catalog);
        if (!e || out.has(e.id) || seen.has(e.id)) return [];
        const key = executionKey(e);
        if (key !== null && seen.has(key)) return [];
        seen.add(e.id);
        if (key !== null) seen.add(key);
        return [e.id];
      }).slice(0, ruleRange('block.core-per-template').max);
      return { name: typeof t.name === 'string' ? t.name.replace(/\s+/g, ' ').trim() : t.name, core };
    });
    return readBlock({ state: 'proposed', templates, rhythm: x.rhythm, atMs: now });
  }

  /** The week history without the weeks before the first day the stats record covers: those would look empty, not unknown. */
  private coveredWeeks(id: string, now: number, weeks: number): ReturnType<typeof weekHistory> {
    const stats = this.deps.store.all(id, 'stats');
    const first = readStats(stats.find((r) => r.id === STATS_ID && !r.deleted)?.body)?.days[0]?.date;
    return weekHistory(stats, now, weeks).filter((w) => !first || addDays(w.woche, 6) >= first);
  }

  /** The data of the monthly review: stored trainings, goal, rules and complaints of the last weeks; no chat thread. */
  private reviewPrompt(id: string, now: number, complaints: { id: string; text: string; status: string }[], reason: ReviewReason): string {
    const today = dateKey(now);
    const weeks = ruleNumber('review.weeks');
    const thisMonday = mondayOf(today);
    const plans = this.deps.store.all(id, 'weekplan');
    const geplant = Array.from({ length: weeks }, (_, i) => addDays(thisMonday, -7 * (weeks - 1 - i))).map((montag) => {
      const plan = planOfWeek(plans, montag);
      return { montag, kraft: plan ? plan.days.filter((d) => d.sport === 'gym' || d.also?.sport === 'gym').length : null };
    });
    const out = excludedOf(this.deps.store, id, this.catalogOf(id));
    const running = activeBlock(this.deps.store.all(id, 'block'), today);
    let kraft: StrengthFacts | null = null;
    try { kraft = this.deps.strengthFacts?.(id) ?? null; } catch { /* the review goes without */ }
    return [
      dataBlock('heute', { datum: today, tag: weekday(today) }),
      this.goalBlock(id, today, complaints),
      ...this.wishLines(id, ['gym', 'bike', 'run']),
      dataBlock('ausschluesse', this.catalogOf(id).filter((e) => out.has(e.id)).map((e) => e.title)),
      dataBlock('beschwerden', complaints),
      dataBlock('wochen', this.coveredWeeks(id, now, weeks)),
      dataBlock('kraft', kraft),
      dataBlock('geplant', geplant),
      dataBlock('anlass', REVIEW_REASON[reason]),
      dataBlock('abschnitt', running ? { bis: running.end } : null),
      ...(running ? [] : [this.catalogBlock(id)]),
      'Schreib den Monatsrückblick.',
    ].join('\n');
  }

  /**
   * After a new activity, planned or not: checks this week's accepted plan and, only when the rest of the week should change,
   * proposes the updated week. The accepted plan stays until the rider takes the proposal. 'busy' means: try again later.
   * Never throws.
   */
  async reviewWeek(id: string, activities: object[]): Promise<'busy' | 'done'> {
    if (this.busy.has(id)) return 'busy';
    const now = this.deps.nowMs();
    const monday = mondayOf(dateKey(now));
    if (!planOfWeek(this.deps.store.all(id, 'weekplan'), monday)) return 'done';
    this.busy.add(id);
    try {
      const thread = chatThread(this.deps.store.all(id, 'chat'));
      const prompt = this.prompt(id, thread.slice(-CHAT_CONTEXT), now, [
        dataBlock('neueAktivitaeten', activities),
        'Die Person hat dir gerade nicht geschrieben. Das sind neue Aktivitäten, auch ohne Plan. Prüf, ob der Rest dieser Woche (wocheJetzt) danach noch passt. '
        + 'Wenn eine Aktivität den Plan verändert (zum Beispiel ungeplant, länger oder härter als geplant), schlag die angepasste Woche vor (wocheJetzt): '
        + 'vergangene Tage so, wie sie wirklich waren, die kommenden Tage angepasst. Sag in ein bis zwei Sätzen, was du warum änderst; '
        + 'die Person entscheidet, ob sie beim alten Plan bleibt. Passt der Plan weiterhin, gib proposal null.',
      ].join('\n'));
      const msg = await this.answer(id, prompt, now, false);
      // Only an updated plan for this week is news; everything else stays silent.
      if (msg.proposal?.weekStart === monday) this.put(id, { ...msg, push: true });
      return 'done';
    } catch { return 'done'; } finally { this.busy.delete(id); }
  }

  private prompt(id: string, thread: ReturnType<typeof chatThread>, now: number, instruction = 'Antworte auf die letzte Nachricht der Person im Verlauf.'): string {
    const today = dateKey(now);
    const monday = mondayOf(today);
    const plans = this.deps.store.all(id, 'weekplan');
    const stats = readStats(this.deps.store.all(id, 'stats').find((r) => r.id === STATS_ID && !r.deleted)?.body);
    const from = addDays(today, -DAYS_SHOWN);
    const days = (stats?.days ?? []).filter((d) => d.date >= from && d.date <= today)
      .map((d) => ({ date: d.date, tag: weekday(d.date), minuten: Object.fromEntries(Object.entries(d.minutes).filter(([, m]) => m > 0)), hart: d.hardness, beine: d.legs }))
      .filter((d) => Object.keys(d.minuten).length > 0);
    const week = (m: string) => planOfWeek(plans, m)?.days.map(({ date, sport, hardness, fixed, legs, long, note, also }) => ({ date, tag: weekday(date), sport, hardness, fixed, legs, long, note, also })) ?? null;
    return [
      dataBlock('heute', { datum: today, tag: weekday(today) }),
      dataBlock('wocheJetzt', { montag: monday, plan: week(monday) }),
      dataBlock('wocheNaechste', { montag: addDays(monday, 7), plan: week(addDays(monday, 7)) }),
      dataBlock('letzteTage', days),
      dataBlock('einheiten', this.sessionsOf(id)),
      dataBlock('naechstesKrafttraining', this.nextExercises(id)),
      dataBlock('wochenVerlauf', weekHistory(this.deps.store.all(id, 'stats'), now)),
      this.goalBlock(id, today, this.complaintList(id)),
      ...this.wishLines(id, ['gym', 'bike', 'run']),
      dataBlock('beschwerden', this.complaintList(id)),
      dataBlock('verlauf', thread.map((m) => ({ von: m.role === 'rider' ? 'person' : 'coach', text: m.text, ...(m.proposal ? { vorschlagFuerWoche: m.proposal.weekStart } : {}), ...(m.takes ? { hatUebernommen: true } : {}), ...(m.declines ? { hatAbgelehnt: true } : {}), ...(m.undoes ? { hatZurueckgenommen: true } : {}) }))),
      instruction,
    ].join('\n');
  }

  /** Writes a coach message the rider did not ask for. */
  say(id: string, m: ChatMessage): void { this.put(id, m); }
  /** Bo asks how hard he may push, without AI: the card under the message holds the choices. */
  askPush(id: string): void {
    this.put(id, { role: 'coach', text: PUSH_QUESTION, atMs: this.deps.nowMs(), push: true, askPush: true });
  }

  /** The change, rule or block record is written first, so the message never points at nothing. The coach only ever writes it as `proposed`. */
  private put(id: string, m: ChatMessage, draft?: Draft | null, rule?: RuleDraft | null, block?: BlockBody | null): void {
    const mid = this.deps.newId();
    const body = { ...m };
    if (draft) { this.deps.store.put(id, changeRecord(mid, draft.ops, draft.reason, this.deps.nowMs())); body.nextChange = changeId(mid); }
    if (rule) { this.deps.store.put(id, ruleRecord(ruleId(mid), rule, 'proposed', 'chat', this.deps.nowMs())); body.rule = ruleId(mid); }
    if (block) { this.deps.store.put(id, blockRecord(blockId(mid), block, this.deps.nowMs())); body.block = blockId(mid); }
    const r: TrackedRecord = { kind: 'chat', id: mid, updatedMs: Math.max(m.atMs, this.deps.nowMs()), deleted: false, body };
    this.deps.store.put(id, r);
  }

  /** Deletes messages older than 90 days. */
  private prune(id: string, all: TrackedRecord[]): void {
    const now = this.deps.nowMs();
    for (const r of all) {
      if (r.deleted || !isObj(r.body) || typeof r.body.atMs !== 'number' || now - r.body.atMs <= CHAT_KEEP_MS) continue;
      this.deps.store.put(id, { ...r, deleted: true, updatedMs: Math.max(now, r.updatedMs + 1) });
    }
  }
}
