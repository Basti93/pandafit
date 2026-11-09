import { HEALTH_ID, readHealth, type HealthBody, type HealthFinding, type HealthWeek } from '../../shared/health';
import type { IconName } from './kit';
import type { TrackedRecord } from '../../shared/records';
import { RULES, SOURCES, type PolicySource } from '../../shared/training-policy';

/** The health record of the profile, or null when there is none (the Statistik row then does not exist). */
export const healthOf = (records: TrackedRecord[] | null): HealthBody | null => {
  const r = (records ?? []).find((x) => x.id === HEALTH_ID && !x.deleted);
  return r ? readHealth(r.body) : null;
};

export type HealthRowKey = 'rhr' | 'vo2' | 'move' | 'sleep';
export type HealthSeries = { label: string; values: (number | null)[]; unit?: string };
export type HealthRow = {
  key: HealthRowKey; title: string; /** The short name for a tile: Ruhepuls, Fitness, Bewegung, Schlaf. */ short: string; icon: IconName;
  /** One word: how it stands. */ word: string; /** "note" for "beachten" and "Hinweis", otherwise "calm". */ tone: 'calm' | 'note'; sentence: string; series: HealthSeries[]; facts: string[];
};

/** Shown instead of the sleep card when there is no sleep or HRV data. Not wearing the watch at night is normal, never a lack. */
export const SLEEP_HINT = 'Für Schlaf und HRV gibt es keine Daten, zum Beispiel weil die Uhr nachts nicht getragen wird. Das ist in Ordnung: Pandafit liest deine Erholung aus Ruhepuls und Training.';

const de = (n: number, digits = 0): string => n.toLocaleString('de-DE', { minimumFractionDigits: digits, maximumFractionDigits: digits });
const column = (weeks: HealthWeek[], pick: (w: HealthWeek) => number | undefined): (number | null)[] => weeks.map((w) => pick(w) ?? null);
const has = (values: (number | null)[]): boolean => values.some((v) => v !== null);
const last = (values: (number | null)[]): number | null => [...values].reverse().find((v): v is number => v !== null) ?? null;
const findingOf = (findings: HealthFinding[], ...rules: string[]): HealthFinding | null => findings.find((f) => rules.includes(f.rule)) ?? null;
/** A finding in one word: nothing to say or good news is calm, a hint is "beachten", the doctor row is "Hinweis". */
const wordOf = (f: HealthFinding | null, calm: string): string => (!f || f.tone === 'gut' ? calm : f.tone === 'arzt' ? 'Hinweis' : 'beachten');

const toneOf = (f: HealthFinding | null): 'calm' | 'note' => (f && f.tone !== 'gut' ? 'note' : 'calm');

/** The urgent finding, shown once at the top of the sheet. */
export const doctorFinding = (h: HealthBody): HealthFinding | null => h.findings.find((f) => f.tone === 'arzt') ?? null;

/** The first line: the coach's note of the week, or the first finding that is not the doctor row. */
export const firstLine = (h: HealthBody): string => h.coachText?.text ?? h.findings.find((f) => f.tone !== 'arzt')?.text ?? 'Gerade gibt es nichts Besonderes zu sagen.';

const MORE = 'Mehr dazu steht auf der Gesundheitsseite.';

/**
 * What the card says. The card never prints a digit: a text without digits is used as is.
 * A doctor finding with digits becomes one general sentence naming its area; other texts with digits are skipped for the next digit-free one.
 * The doctor hint still leads. The page keeps the full texts.
 */
export function cardText(h: HealthBody): { doctor: string | null; line: string } {
  const clean = (t: string | undefined): string | null => (t && !/\d/.test(t) ? t : null);
  const d = doctorFinding(h);
  let doctor: string | null = null;
  if (d) {
    const area = healthRows(h).find((r) => r.sentence === d.text)?.short;
    doctor = clean(d.text) ?? `${area ? `Dein Wert für ${area} fällt` : 'Ein Wert fällt'} gerade auf. Lass das am besten ärztlich abklären.`;
  }
  const line = clean(h.coachText?.text) ?? h.findings.filter((f) => f.tone !== 'arzt').map((f) => clean(f.text)).find((t) => t !== null) ?? (h.findings.some((f) => f.tone !== 'arzt') || h.coachText ? MORE : 'Gerade gibt es nichts Besonderes zu sagen.');
  return { doctor, line };
}

/**
 * Up to four rows, each one sentence; the numbers (and sparklines) are only in the opened row. A row exists only with data.
 * Body Battery and stress are not in the record and never appear here.
 */
export function healthRows(h: HealthBody): HealthRow[] {
  const out: HealthRow[] = [];
  const rhrWeeks = column(h.weeks, (w) => w.rhr);
  const rhrDays = h.days.map((d) => d.rhr ?? null);
  if (has(rhrWeeks) || has(rhrDays)) {
    const now = last(rhrDays) ?? last(rhrWeeks);
    const f = findingOf(h.findings, 'health.rhr-high', 'health.rhr-persist', 'health.rhr-raised', 'health.rhr-longterm');
    out.push({
      key: 'rhr', title: 'Ruhepuls', short: 'Ruhepuls', icon: 'herz', word: wordOf(f, 'ruhig'), tone: toneOf(f),
      sentence: f?.text ?? 'Im Ruhepuls fällt gerade nichts auf.',
      series: [{ label: 'Letzte 28 Tage', values: rhrDays }, { label: 'Letzte 52 Wochen', values: rhrWeeks }],
      facts: now === null ? [] : [`Zuletzt ${de(now)} Schläge pro Minute in Ruhe.`],
    });
  }
  const vo2 = column(h.weeks, (w) => w.vo2);
  if (has(vo2)) {
    const f = findingOf(h.findings, 'health.vo2-trend');
    out.push({
      key: 'vo2', title: 'Fitness', short: 'Fitness', icon: 'spross', word: wordOf(f, f ? 'steigt' : 'stabil'), tone: toneOf(f),
      sentence: f?.text ?? 'Deine geschätzte Ausdauerfitness hat sich noch nicht klar verändert.',
      series: [{ label: 'Letzte 52 Wochen', values: vo2 }],
      facts: ['Die Uhr schätzt diesen Wert nur grob. Wichtig ist der Verlauf über Wochen.'],
    });
  }
  const steps = column(h.weeks, (w) => w.steps), minutes = column(h.weeks, (w) => w.activeMin);
  if (has(steps) || has(minutes)) {
    const week = h.weeks.at(-2);
    const f = findingOf(h.findings, 'health.steps-band', 'health.activity-minutes');
    out.push({
      key: 'move', title: 'Bewegung im Alltag', short: 'Bewegung', icon: 'lauf', word: wordOf(f, f ? 'im Richtwert' : 'offen'), tone: toneOf(f),
      sentence: f?.text ?? 'Für einen Vergleich mit den Empfehlungen gibt es noch zu wenig Daten.',
      series: [...(has(steps) ? [{ label: 'Schritte pro Tag, 52 Wochen', values: steps }] : []), ...(has(minutes) ? [{ label: 'Aktive Minuten pro Woche, 52 Wochen', values: minutes }] : [])],
      facts: [
        ...(week?.steps !== undefined ? [`Schritte pro Tag (letzte volle Woche): ${de(week.steps)}.`] : []),
        ...(week?.activeMin !== undefined ? [`Aktive Minuten: ${de(week.activeMin)}.`] : []),
        ...(week?.strengthDays !== undefined ? [`Tage mit Krafttraining: ${week.strengthDays}.`] : []),
      ],
    });
  }
  const sleep = column(h.weeks, (w) => w.sleepH), hrv = column(h.weeks, (w) => w.hrv);
  if (has(sleep) || has(hrv)) {
    const s = last(sleep);
    out.push({
      key: 'sleep', title: 'Schlaf & HRV', short: 'Schlaf', icon: 'mond', word: 'Verlauf', tone: 'calm',
      sentence: s !== null ? 'Hier siehst du Schlaf und HRV als Verlauf, ohne Bewertung.' : 'Hier siehst du die HRV als Verlauf, ohne Bewertung.',
      series: [...(has(sleep) ? [{ label: 'Schlaf in Stunden, 52 Wochen', values: sleep }] : []), ...(has(hrv) ? [{ label: 'HRV, 52 Wochen', values: hrv }] : [])],
      facts: s !== null ? [`Zuletzt im Schnitt ${de(s, 1)} Stunden pro Nacht.`] : [],
    });
  }
  return out;
}

const HEALTH_SOURCE_IDS = (): Set<string> => new Set(RULES.filter((r) => r.domain === 'health').flatMap((r) => r.sourceIds));
/** The sources behind the health rules, as the register lists them. */
export const healthSources = (): PolicySource[] => { const ids = HEALTH_SOURCE_IDS(); return SOURCES.filter((s) => ids.has(s.id)); };

/** The kicker of the health page: "Diese Woche, Stand Montag, 3. November" when the note knows its time, otherwise "Diese Woche". */
export const standLine = (h: HealthBody): string => {
  const ms = h.coachText?.atMs;
  return ms === undefined ? 'Diese Woche' : `Diese Woche, Stand ${new Date(ms).toLocaleDateString('de-DE', { weekday: 'long', day: 'numeric', month: 'long' })}`;
};
