// Phone screenshots of every screen of the web app, with a realistic seeded account (invented data only).
// Starts the real web server on localhost with a temporary database, writes the records the Mac side would publish
// straight into it, logs in with a 390x844 phone and photographs every tab, sub-screen and dialog (full page).
// Usage: npm run ui:web-shots -- <out dir> [name filter]   (builds the web app first; needs a Chromium that playwright-core finds)
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { chromium, type Browser, type Page, type WebSocketRoute } from 'playwright-core';
import { createAccount } from '../web-server/auth';
import { openDb } from '../web-server/db';
import { putRecords } from '../web-server/records';
import { buildServer } from '../web-server/index';
import { EXERCISES } from '../src/shared/exercises';
import { MOBILITY_EXERCISES } from '../src/coach/mobility/exercises';
import { changeRecord } from '../src/shared/changes';
import { frameRecord } from '../src/shared/frame';
import { goalRecord, ruleRecord } from '../src/shared/personal';
import { studioRecord } from '../src/shared/studio';
import { taskRecord } from '../src/shared/tasks';
import { addDays, mondayOf, type PlanDay, type Hardness, type Sport } from '../src/shared/week-plan';
import type { TrackedRecord } from '../src/shared/records';

const out = resolve(process.argv[2] ?? 'web-shots');
const filter = process.argv[3] ?? '';
const NAME = 'mira';
const PASSWORD = 'shots demo pass 1';
mkdirSync(out, { recursive: true });

// ---------- deterministic helpers ----------
let seed = 7;
const rnd = () => { seed = (seed * 1664525 + 1013904223) % 4294967296; return seed / 4294967296; };
const NOW = Date.now();
const DAY = 86_400_000;
const keyOf = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
const todayKey = keyOf(new Date(NOW));
const monday = mondayOf(todayKey);
/** Local time on the date `n` days before today. */
const at = (n: number, h: number, min = 0): number => { const d = new Date(NOW); d.setDate(d.getDate() - n); d.setHours(h, min, 0, 0); return d.getTime(); };
const dateAt = (key: string, h = 12) => { const [y, m, d] = key.split('-').map(Number); return new Date(y!, m! - 1, d!, h).getTime(); };
const rec = (kind: TrackedRecord['kind'], id: string, body: unknown, updatedMs = NOW): TrackedRecord => ({ kind, id, updatedMs, deleted: false, body });
const records: TrackedRecord[] = [];
const title = (id: string): string => EXERCISES.find((e) => e.id === id)?.title ?? id;

// ---------- 3 months of gym workouts in three studios ----------
type Tpl = { name: string; ex: { id: string; kg: number; reps: number; sets: number; ss?: number }[] };
const TPL: Record<string, Tpl> = {
  legs: { name: 'Beine A', ex: [{ id: 'pf-squat', kg: 60, reps: 8, sets: 4 }, { id: 'pf-romanian-deadlift', kg: 70, reps: 8, sets: 3 }, { id: 'pf-leg-press', kg: 120, reps: 10, sets: 3 }, { id: 'pf-calf-raise-standing', kg: 50, reps: 12, sets: 3 }] },
  push: { name: 'Push', ex: [{ id: 'pf-bench-press', kg: 50, reps: 8, sets: 4 }, { id: 'pf-shoulder-press-db', kg: 16, reps: 10, sets: 3 }, { id: 'pf-lateral-raise', kg: 8, reps: 12, sets: 3, ss: 1 }, { id: 'pf-triceps-pushdown', kg: 25, reps: 12, sets: 3, ss: 1 }] },
  pull: { name: 'Pull', ex: [{ id: 'pf-lat-pulldown', kg: 50, reps: 10, sets: 4 }, { id: 'pf-seated-row-cable', kg: 45, reps: 10, sets: 3 }, { id: 'pf-face-pull', kg: 20, reps: 15, sets: 3, ss: 1 }, { id: 'pf-bicep-curl-db', kg: 12, reps: 10, sets: 3, ss: 1 }] },
};
const round25 = (x: number) => Math.round(x / 2.5) * 2.5;
let nRid = 0;
const rid = () => `r${++nRid}`;
const buildWorkout = (id: string, tpl: Tpl, startMs: number, studio: string, week: number, doneUpTo: number | 'all' = 'all'): Record<string, unknown> => {
  let t = startMs;
  let counter = 0;
  const exercises = tpl.ex.map((e) => {
    const kg = round25(e.kg * (1 + 0.012 * (13 - week)));
    const sets = [] as Record<string, unknown>[];
    if (e.sets >= 4 || e.id === 'pf-squat') sets.push({ rid: rid(), type: 'warmup', weightKg: round25(kg * 0.5), reps: 8, durationS: null, doneMs: 0 });
    for (let i = 0; i < e.sets; i++) sets.push({ rid: rid(), type: 'normal', weightKg: kg, reps: e.reps - (i === e.sets - 1 && rnd() < 0.4 ? 1 : 0), durationS: null, doneMs: 0 });
    for (const s of sets) {
      counter++;
      t += 150_000;
      s.doneMs = doneUpTo === 'all' || counter <= doneUpTo ? t : null;
    }
    return { rid: rid(), exerciseId: e.id, title: title(e.id), supersetId: e.ss ?? null, notes: '', sets, ...(doneUpTo === 'all' && rnd() < 0.5 ? { effort: (['none', 'some', 'plenty'] as const)[Math.floor(rnd() * 3)] } : {}) };
  });
  return { id, title: tpl.name, startMs, endMs: doneUpTo === 'all' ? t + 120_000 : null, source: 'pandafit', exercises, studio };
};
const workoutRecords: { id: string; startMs: number; legs: boolean; minutes: number }[] = [];
for (let n = 92; n >= 3; n--) {
  const d = new Date(at(n, 12));
  const dow = (d.getDay() + 6) % 7;
  const kind = dow === 0 ? 'legs' : dow === 2 ? 'push' : dow === 4 ? 'pull' : null;
  if (!kind || rnd() < 0.15) continue;
  const week = Math.floor(n / 7);
  const studio = n < 20 && dow === 4 ? 'Fitnessfabrik' : n > 50 && dow === 2 ? 'Hotel-Gym' : 'Studio Nord';
  const id = `w-${n}`;
  const start = at(n, kind === 'legs' ? 18 : 7, 30);
  const body = buildWorkout(id, TPL[kind]!, start, studio, week);
  records.push(rec('workout', id, body, body.endMs as number));
  workoutRecords.push({ id, startMs: start, legs: kind === 'legs', minutes: Math.round(((body.endMs as number) - start) / 60000) });
}
for (const s of ['Studio Nord', 'Fitnessfabrik', 'Hotel-Gym']) records.push(studioRecord(s, at(80, 12), at(80, 12)));

// ---------- runs (manual) and the run coach's records ----------
const runDays: { date: string; min: number }[] = [];
for (let n = 90; n >= 2; n -= 3 + (rnd() < 0.5 ? 1 : 0)) {
  const durationS = Math.round((28 + rnd() * 22) * 60);
  const paceS = 345 - (90 - n) * 0.25 + rnd() * 15;
  records.push(rec('run', `manual-demo${n}`, { type: 'manual', startMs: at(n, 17, 45), durationS, distanceM: Math.round((durationS / paceS) * 1000), avgHr: 148 + Math.round(rnd() * 12), runType: 'running' }, at(n, 18, 40)));
  runDays.push({ date: keyOf(new Date(at(n, 12))), min: Math.round(durationS / 60) });
}
const weekKeys = Array.from({ length: 12 }, (_, i) => addDays(monday, -7 * (11 - i)));
records.push(rec('run', 'status', {
  type: 'status', atMs: NOW - 3600_000, on: true, suggest: false, needsAnswers: false, garmin: false, suggestedDays: [1, 5], hrCap: 160, complaint: null,
  numbers: {
    easyPace: { now: 331, weeks4: 336, weeks12: 349, trend: weekKeys.map((_, i) => 352 - i * 2 + (i % 3)) },
    weeks: weekKeys.map((w, i) => ({ week: w, km: 14 + i * 0.9 + (i % 3), minutes: 85 + i * 5, plannedMinutes: 90 + i * 4 })),
    longest: { blockKm: 8.4, lastBlockKm: 7.2 }, tests: [{ date: addDays(todayKey, -60), distanceM: 2850 }],
  },
  card: { runId: 'manual-demo2', date: addDays(todayKey, -3), kind: 'easy', counted: 'Lockerer Lauf, 38 Minuten', result: '6,3 km in 38 Minuten, Puls 151', sentence: 'Ruhig und gleichmäßig gelaufen, genau so war er gedacht.' },
}));
records.push(rec('run', 'settings', { type: 'settings', on: true, weekdays: [1, 5], answers: { runsPerWeek: 2, usualMinutes: 40, pain: false } }));
const runPlanDays = [addDays(monday, 1), addDays(monday, 5)];
records.push(rec('run', `week-${monday}`, {
  type: 'week', week: monday, announce: false, atMs: dateAt(monday, 8), phase: 1, source: 'rules',
  reason: 'Zwei ruhige Läufe, einer davon etwas länger, damit der Grundumfang langsam wächst.', note: 'Beim langen Lauf bleibt der Puls unter 160.',
  runs: [
    { date: runPlanDays[0]!, kind: 'easy', minutes: 35, hrCap: 155, counts: 'Zählt als lockere Einheit.', note: null, fp: 'a', done: runPlanDays[0]! < todayKey ? 'manual-demo2' : null },
    { date: runPlanDays[1]!, kind: 'long', minutes: 50, hrCap: 160, counts: 'Zählt als lange Einheit.', note: 'Gern im Grünen.', fp: 'b', done: null },
  ], garmin: null,
}, dateAt(monday, 8)));
records.push(rec('run', `review-${addDays(monday, -7)}`, { type: 'review', week: addDays(monday, -7), atMs: dateAt(monday, 7), km: 17.4, minutes: 112, plannedMinutes: 110, runs: 3, longestKm: 8.1, easyPace: { now: 334, weeks4: 338 }, testM: null, focus: 'Der lockere Lauf wird langsam schneller, ohne dass der Puls steigt. Weiter so.' }, dateAt(monday, 7)));

// ---------- week plans, frame, goal, rules, wishes, tasks ----------
const day = (offset: number, sport: Sport, hardness: Hardness, extra: Partial<PlanDay> = {}): PlanDay => ({ date: addDays(monday, offset), sport, hardness, fixed: false, ...extra });
const weekDays = (w: number): PlanDay[] => [
  { ...day(0, 'gym', 'hard', { legs: true }), date: addDays(monday, 7 * w) },
  { ...day(1, 'run', 'easy'), date: addDays(monday, 7 * w + 1) },
  { ...day(2, 'gym', 'moderate', { legs: false, fixed: true, note: 'Studio Nord' }), date: addDays(monday, 7 * w + 2) },
  { ...day(3, 'mobility', 'easy'), date: addDays(monday, 7 * w + 3) },
  { ...day(4, 'gym', 'moderate', { legs: false, also: { sport: 'bike', hardness: 'easy' } }), date: addDays(monday, 7 * w + 4) },
  { ...day(5, 'run', 'moderate', { long: true }), date: addDays(monday, 7 * w + 5) },
  { ...day(6, 'rest', 'easy'), date: addDays(monday, 7 * w + 6) },
];
const wp = (w: number, takenFrom: string) => rec('weekplan', addDays(monday, 7 * w), { weekStart: addDays(monday, 7 * w), days: weekDays(w), fromMessage: takenFrom, takenFrom, acceptedMs: dateAt(addDays(monday, 7 * w - 1), 19) }, dateAt(addDays(monday, 7 * w - 1), 19));
records.push(wp(0, 'm52'), wp(-1, 'm31'), wp(-2, 'm12'));
records.push(frameRecord({ mode: 'week', minutes: 60 }, at(20, 10)));
records.push(goalRecord({ strength: 'muscle', focus: ['back', 'side_delts'], sports: { gym: 'focus', run: 'equal', bike: 'keep' } }, at(40, 10)));
records.push(ruleRecord('rule-kh', { kind: 'exclude', text: 'Ohne Kreuzheben', sport: 'gym', exerciseIds: ['pf-deadlift'] }, 'active', 'person', at(35, 9)));
records.push(ruleRecord('rule-lunge', { kind: 'exclude', text: 'Ohne alle Varianten: Ausfallschritt', sport: 'gym', families: ['lunge'] }, 'active', 'person', at(30, 9)));
records.push(ruleRecord('rule-fr', { kind: 'wish', text: 'Freitags höchstens 45 Minuten im Studio', sport: 'gym' }, 'active', 'chat', at(18, 20)));
records.push(ruleRecord('rule-run', { kind: 'wish', text: 'Lange Läufe lieber am Samstag', sport: 'run' }, 'paused', 'person', at(12, 20)));
records.push(ruleRecord('rule-prop', { kind: 'wish', text: 'Kein Beintraining vor einem langen Lauf', sport: 'all' }, 'proposed', 'chat', at(1, 20)));
records.push(taskRecord({ from: 'chat', to: 'gym', text: 'Diese Woche die Schulter schonen, kein Überkopfdrücken.', lasting: false, atMs: at(2, 20) }, at(2, 20)));
records.push(taskRecord({ from: 'run', to: 'gym', text: 'Am Tag vor dem langen Lauf keine schweren Beinübungen.', lasting: true, atMs: at(9, 9) }, at(9, 9)));
records.push(rec('complaint', 'c1', { text: 'Linke Schulter zwickt bei Überkopfbewegungen', status: 'open', atMs: at(4, 20) }, at(4, 20)));

// ---------- the plan for the next gym workout (Heute, Kraft) ----------
const planEx = (id: string, kg: number | null, reps: number, sets: number, rest: number | null = null) => ({ templateId: id, title: title(id), restS: rest, supersetId: null, notes: '', sets: Array.from({ length: sets }, () => ({ type: 'normal' as const, weightKg: kg, reps })) });
const mob = (ids: string[]) => ids.map((i) => { const e = MOBILITY_EXERCISES.find((x) => x.id === i) ?? MOBILITY_EXERCISES[0]!; return { id: e.id, title: e.title, howTo: e.howTo, area: e.area }; });
records.push(rec('plan', 'current', {
  workout: { name: 'Pull', studio: 'Studio Nord', exercises: [planEx('pf-lat-pulldown', 57.5, 10, 4), planEx('pf-seated-row-cable', 50, 10, 3), planEx('pf-face-pull', 22.5, 15, 3), planEx('pf-bicep-curl-db', 14, 10, 3)] },
  reason: 'Rücken steht im Fokus und hatte zuletzt weniger Sätze als die Brust. Beim Latzug gibt es 2,5 kg mehr, weil die letzten Sätze sauber liefen.',
  source: 'rules', note: 'Das Überkopfdrücken bleibt wegen der Schulter draußen.', questions: ['Wie fühlt sich die Schulter heute an?'], atMs: at(0, 7),
  mobility: { id: `mobility-strength-${at(0, 6)}`, forSession: 'strength', minutes: 6, reason: 'Nach dem Training lockern Schulter und Brust ein paar ruhige Minuten.', exercises: mob(['mob-chest-doorway', 'mob-hamstring-seated', 'mob-glute-figure-four']) },
  outlook: { direction: 'In den nächsten Wochen steigt der Rückenanteil langsam, die Beine bleiben stabil.', sessions: [
    { date: addDays(todayKey, 2), name: 'Beine A', focus: 'Kniebeuge und Hüftbeuger', exercises: [{ title: title('pf-squat'), sets: 4 }, { title: title('pf-leg-press'), sets: 3 }] },
    { date: addDays(todayKey, 4), name: 'Push', focus: 'Brust und Schultern, ohne Überkopf', exercises: [{ title: title('pf-bench-press'), sets: 4 }, { title: title('pf-lateral-raise'), sets: 3 }] },
  ] },
}, at(0, 7)));
records.push(rec('routine', 'rt1', { name: 'Kurz und knapp', exercises: [planEx('pf-squat', 60, 8, 3), planEx('pf-bench-press', 50, 8, 3), planEx('pf-lat-pulldown', 50, 10, 3)] }, at(50, 9)));
records.push(rec('routine', 'rt2', { name: 'Hotel-Programm', exercises: [planEx('pf-push-up', null, 12, 3), planEx('pf-bicep-curl-db', 10, 12, 3), planEx('pf-plank', null, 1, 3)] }, at(45, 9)));

// ---------- stats and change notes as the coach publishes them ----------
const sportMinutes = (m: Partial<Record<'bike' | 'strength' | 'run' | 'mobility' | 'other', number>>) => ({ bike: 0, strength: 0, run: 0, mobility: 0, other: 0, ...m });
const statDays: Record<string, { minutes: ReturnType<typeof sportMinutes>; hardness: Hardness | null; legs: boolean }> = {};
for (const w of workoutRecords) { const k = keyOf(new Date(w.startMs)); statDays[k] = { minutes: sportMinutes({ strength: w.minutes }), hardness: w.legs ? 'hard' : 'moderate', legs: w.legs }; }
for (const r of runDays) statDays[r.date] = { minutes: sportMinutes({ ...(statDays[r.date]?.minutes ?? {}), run: r.min }), hardness: statDays[r.date]?.hardness ?? 'easy', legs: statDays[r.date]?.legs ?? false };
for (const k of Object.keys(statDays)) if (k < addDays(todayKey, -68) || k > todayKey) delete statDays[k];
records.push(rec('stats', 'stats', {
  type: 'stats', atMs: NOW - 1800_000, goal: 'Muskeln aufbauen',
  days: Object.keys(statDays).sort().map((date) => ({ date, ...statDays[date]! })), muscles: {}, weightKg: 68.5,
  advice: { date: todayKey, mode: 'week', sport: 'gym', hardness: 'moderate', label: 'Kraft, mittel', reason: 'Der Plan passt zu dem, wie die Woche bisher lief.', line: 'Heute Kraft, mittel: Rücken und Arme.', fromPlan: true },
  next: [
    { exerciseId: 'pf-lat-pulldown', title: title('pf-lat-pulldown'), weightKg: 57.5, reps: 10, why: 'progress', reason: 'Alle Sätze sauber geschafft, also 2,5 kg mehr.', forWorkoutId: 'w-3', atMs: at(3, 7) },
    { exerciseId: 'pf-seated-row-cable', title: title('pf-seated-row-cable'), weightKg: 45, reps: 10, why: 'keep', reason: 'Gleiches Gewicht, die Wiederholungen waren zuletzt knapp.', forWorkoutId: 'w-3', atMs: at(3, 7) },
  ],
  changes: [
    { atMs: at(1, 21), coach: 'gym', text: 'Überkopfdrücken ist erst mal raus', reason: 'Die Schulter zwickt, du hast es im Chat geschrieben.' },
    { atMs: at(3, 8), coach: 'gym', text: 'Latzug 2,5 kg schwerer', reason: 'Alle Sätze liefen sauber.' },
    { atMs: at(4, 20), coach: 'run', text: 'Langer Lauf am Samstag auf 50 Minuten verlängert', reason: 'Der lockere Lauf klappt gut, der Umfang darf wachsen.' },
    { atMs: at(8, 19), coach: 'chat', text: 'Freitags höchstens 45 Minuten im Studio', reason: 'Dein Wunsch aus dem Wochengespräch.' },
  ],
}, NOW - 1800_000));

// ---------- the bike plan and rides as the server coach publishes them ----------
{
  const kinds = [
    { name: 'Grundlage', min: 55, f: 0.62, hardness: 'easy' as Hardness },
    { name: 'Schwellen-Intervalle', min: 60, f: 0.86, hardness: 'hard' as Hardness },
    { name: 'Locker', min: 35, f: 0.55, hardness: 'easy' as Hardness },
  ];
  const agos = [2, 6, 9, 13, 16, 20, 27, 33, 41, 55, 62, 70];
  agos.forEach((ago, i) => {
    const k = kinds[i % 3]!;
    const durationS = (k.min + (i % 4) * 3) * 60;
    const curve = Array.from({ length: 120 }, (_, j) => {
      const t = Math.round((j / 119) * durationS);
      const hard = k.hardness === 'hard' && j > 20 && j < 100 && Math.floor((j - 20) / 20) % 2 === 0;
      const base = 200 * (hard ? 0.95 : k.f * 0.85);
      return { t, powerW: Math.round(base + rnd() * 12), hrBpm: Math.round(105 + (hard ? 45 : 20) + j * 0.15 + rnd() * 3) };
    });
    records.push(rec('ride', `ride-demo${i}`, {
      type: 'ride', startedAtMs: at(ago, 18), sessionName: k.name, durationS, hardness: k.hardness,
      avgPowerW: Math.round(200 * k.f * 0.9), normalizedPowerW: Math.round(200 * k.f), avgHrBpm: 128 + (k.hardness === 'hard' ? 15 : 0), maxHrBpm: 150 + (k.hardness === 'hard' ? 20 : 0),
      tss: Math.round((durationS / 3600) * k.f ** 2 * 100), completedFraction: 1,
      ...(i < 3 ? { debrief: i === 0 ? 'Ruhig und gleichmäßig, der Puls blieb schön niedrig.' : 'Alle Intervalle geschafft, die letzten waren die stärksten.' } : {}), curve,
    }, at(ago, 19)));
  });
  records.push(rec('bike', 'bike', {
    type: 'bike', atMs: NOW - 3600_000, ftpW: 205,
    ftpHistory: [{ atMs: NOW - 150 * DAY, ftpW: 190, source: 'manual' }, { atMs: NOW - 70 * DAY, ftpW: 195, source: 'coach' }, { atMs: NOW - 14 * DAY, ftpW: 205, source: 'coach' }],
    phase: { name: 'Aufbau', weeksLeft: 3, goal: 'Die Ausdauer solide aufbauen, ein Intervalltag pro Woche' },
    next: { name: 'Schwellen-Intervalle', reason: 'Die letzten beiden Tage waren locker, die Beine sind frisch.', minutes: 60, hardness: 'hard', blocks: [
      { label: '10 Min locker', minutes: 10, pct: 55 }, { label: '3 × 8 Min bei 95 %, dazwischen 4 Min locker', minutes: 32, pct: 95 }, { label: '8 Min locker', minutes: 8, pct: 50 }] },
    alternatives: [{ name: 'Grundlage, 50 Min', minutes: 50, why: 'Falls die Beine müde sind.' }],
    weekHours: Array.from({ length: 12 }, (_, w) => ({ week: addDays(monday, -7 * (11 - w)), hours: Math.round((1.5 + ((w * 5) % 4) * 0.6 + rnd()) * 10) / 10 })),
  }, NOW - 3600_000));
}

// ---------- health as the server coach publishes it (invented values) ----------
const healthBody = (arzt: boolean) => ({
  type: 'health', atMs: NOW - 1800_000, today: { level: 'normal', reasons: [] },
  findings: [
    ...(arzt ? [{ rule: 'health.rhr-persist', tone: 'arzt', text: 'Dein Ruhepuls liegt seit einer Woche deutlich über deinem üblichen Wert. Wenn das anhält, lass es ärztlich abklären.' }] : []),
    { rule: 'health.vo2-trend', tone: 'gut', text: 'Deine geschätzte Ausdauerfitness ist in den letzten Wochen etwas gestiegen.' },
    { rule: 'health.steps-band', tone: 'info', text: 'Letzte Woche lagst du im Schnitt bei etwa 7.400 Schritten pro Tag; ein Richtwert aus Studien sind 8.000 bis 10.000.' },
    { rule: 'health.activity-minutes', tone: 'info', text: 'Die WHO empfiehlt Muskelkräftigung an mindestens 2 Tagen pro Woche; letzte Woche war es ein Tag.' },
  ],
  weeks: Array.from({ length: 52 }, (_, w) => ({
    week: addDays(monday, -7 * (51 - w)), rhr: Math.round(60 - w * 0.08 + Math.sin(w) * 1.5 + (arzt && w > 50 ? 9 : 0)), vo2: Math.round((48 + w * 0.05 + Math.sin(w / 3) * 0.3) * 10) / 10,
    steps: 7000 + ((w * 370) % 2200), activeMin: 90 + ((w * 37) % 120), strengthDays: w % 3 === 0 ? 2 : 1, sleepH: 7 + Math.round(Math.sin(w / 4) * 5) / 10, hrv: 48 + ((w * 3) % 9),
  })),
  days: Array.from({ length: 28 }, (_, d) => ({ date: addDays(monday, d - 27 - 1), rhr: 56 + (d % 4) + (arzt && d > 20 ? 9 : 0), steps: 6000 + ((d * 611) % 5000), sleepH: 6.5 + (d % 5) * 0.3 })),
  coachText: { week: monday, text: 'Insgesamt eine ruhige Woche: Deine Fitness zeigt leicht nach oben, bei den Schritten ist noch etwas Luft zum Richtwert, und ein zweiter Krafttag würde zu den WHO-Empfehlungen passen.' },
});
records.push(rec('health', 'health', healthBody(false), NOW - 1800_000));

// ---------- the meal plan ----------
const dish = (t: string, min: number, prot: number, ing: [string, number, string, string][]) => ({ title: t, minutes: min, proteinG: prot, keepsDays: 2, source: 'coach', steps: ['Alles vorbereiten.', 'Zusammen garen und abschmecken.'], ingredients: ing.map(([name, amount, unit, section]) => ({ name, amount, unit, section })) });
const real = <T extends object>(d: T, path: string) => ({ ...d, source: 'rezept', sourceUrl: `https://rezepte.example/${path}` });
const DISHES = [
  dish('Haferbrei mit Beeren', 10, 18, [['Haferflocken', 80, 'g', 'Vorrat'], ['Beeren', 150, 'g', 'Tiefkühl'], ['Milch', 250, 'ml', 'Kühlregal']]),
  real(dish('Linsen-Gemüse-Pfanne', 30, 32, [['Rote Linsen', 100, 'g', 'Vorrat'], ['Paprika', 2, 'Stk', 'Obst und Gemüse'], ['Kokosmilch', 1, 'Dose', 'Vorrat']]), 'linsen-gemuese-pfanne'),
  real(dish('Ofengemüse mit Feta', 40, 28, [['Zucchini', 2, 'Stk', 'Obst und Gemüse'], ['Feta', 150, 'g', 'Kühlregal'], ['Süßkartoffel', 2, 'Stk', 'Obst und Gemüse']]), 'ofengemuese-feta'),
  real(dish('Skyr mit Nüssen', 5, 25, [['Skyr', 300, 'g', 'Kühlregal'], ['Walnüsse', 30, 'g', 'Vorrat']]), 'skyr-nuesse'),
];
const mealPlanBody = {
  week: monday, createdMs: dateAt(addDays(monday, -2), 18), source: 'coach', trainingDays: [0, 2, 4],
  people: [{ id: 'p-mira', name: 'Mira' }, { id: 'p-jonas', name: 'Jonas' }],
  meals: Array.from({ length: 7 }, (_, d) => (['fruehstueck', 'mittag', 'abend'] as const).map((slot, s) => ({ day: d, slot, dish: DISHES[s === 0 ? 0 : s === 1 ? (d % 2 ? 1 : 3) : (d % 2 ? 2 : 1)], reuseOf: null, eaters: d === 5 && s === 2 ? ['p-mira'] : ['p-mira', 'p-jonas'], takeAlong: s === 1 && d < 5 }))).flat(),
};
records.push(rec('mealplan', `week-${monday}`, mealPlanBody, dateAt(addDays(monday, -2), 18)));
// A person's own recipes (written by the coach) and an answered link request.
records.push(rec('mealplan', 'recipe-l-a1b2c3d4e5f6a7', { title: 'Linsen-Gemüse-Pfanne', sourceUrl: 'https://rezepte.example/linsen-gemuese-pfanne', minutes: 30 }, NOW - 2 * DAY));
records.push(rec('mealplan', 'recipe-l-b2c3d4e5f6a7b8', { title: 'Ofengemüse mit Feta', sourceUrl: 'https://rezepte.example/ofengemuese-feta', minutes: 40 }, NOW - DAY));
records.push(rec('mealplan', 'link-shotseed01', { url: 'https://rezepte.example/ofengemuese-feta', atMs: NOW - DAY, result: { state: 'saved', title: 'Ofengemüse mit Feta' }, answeredMs: NOW - DAY + 1000 }, NOW - DAY));

// ---------- the week chat: ~60 messages over 3 weeks ----------
type Msg = { d: number; h: number; role: 'rider' | 'coach'; text: string; extra?: Record<string, unknown> };
const lines: Msg[] = [];
const say = (d: number, h: number, role: 'rider' | 'coach', text: string, extra?: Record<string, unknown>) => lines.push({ d, h, role, text, extra });
const w2 = addDays(monday, -14), w1 = addDays(monday, -7);
say(21, 18, 'coach', 'Hallo Mira, das Wochengespräch ist da. Wie lief die Woche, und wie sieht die nächste aus?', { push: true });
say(21, 19, 'rider', 'Gut eigentlich. Drei Mal Studio, zwei Läufe. Nächste Woche bin ich Mittwoch sicher im Studio, Freitag eher knapp.');
say(21, 19, 'coach', 'Das klingt nach einer soliden Woche. Ich schlage drei Kraft- und zwei Lauftage vor, mit dem Mittwoch fest im Studio.');
say(21, 19, 'coach', 'Hier ist mein Vorschlag für die Woche ab dem ' + w2.slice(8) + '.' + w2.slice(5, 7) + '.', { proposal: { weekStart: w2, days: weekDays(-2) } });
say(21, 20, 'rider', 'Übernommen.', { takes: 'm04' });
say(20, 8, 'rider', 'Schulter fühlt sich heute etwas steif an.');
say(20, 8, 'coach', 'Danke für den Hinweis. Ich lasse das Überkopfdrücken diese Woche im Plan, aber mit leichterem Gewicht. Sag mir, wenn es schlimmer wird.');
say(19, 7, 'rider', 'Beine heute waren richtig schwer.');
say(19, 7, 'coach', 'Das passt zur Woche mit zwei langen Einheiten. Die Beinpresse bleibt beim gleichen Gewicht, damit du sauber wiederholst.');
say(18, 20, 'rider', 'Kann ich freitags kürzer trainieren? Ich habe da selten mehr als 45 Minuten.');
say(18, 20, 'coach', 'Klar. Soll ich daraus eine Regel machen, damit ich freitags immer bei 45 Minuten bleibe?', { rule: 'rule-fr' });
say(18, 21, 'rider', 'Ja, bitte.');
say(17, 8, 'coach', 'Erledigt. Freitags plane ich ab jetzt höchstens 45 Minuten.');
say(16, 19, 'rider', 'Heute nur 30 Minuten Zeit, was machen wir?');
say(16, 19, 'coach', 'Dann ein kurzer Pull mit vier Übungen. Latzug, Rudern, Face Pull und Curl, jeweils zwei bis drei Sätze.');
say(15, 18, 'rider', 'Lauf war toll, 6 km locker.');
say(15, 18, 'coach', 'Schön, genau so war er gedacht. Dein ruhiges Tempo wird seit Wochen etwas schneller, ohne dass der Puls steigt.');
say(14, 18, 'coach', 'Wochengespräch: Wie war die Woche? Dann plane ich die nächste mit dir.', { push: true });
say(14, 19, 'rider', 'Sehr gut. Ich würde gern mehr Rücken machen, die Schultern wirken vorn überlastet.');
say(14, 19, 'coach', 'Das lässt sich gut einrichten. Ich setze den Rücken in den Fokus und gebe dem Latzug einen zusätzlichen Satz.');
say(14, 19, 'coach', 'Mein Vorschlag für die Woche ab dem ' + w1.slice(8) + '.' + w1.slice(5, 7) + '.', { proposal: { weekStart: w1, days: weekDays(-1) } });
say(14, 20, 'rider', 'Nein danke.', { declines: 'm19' });
say(14, 20, 'rider', 'Da ist mir der Samstag zu voll. Lieber den langen Lauf auf Sonntag.');
say(14, 20, 'coach', 'Verstanden, dann tausche ich Lauf und Ruhetag. Hier die zweite Fassung.');
say(14, 20, 'coach', 'Wochenplan mit langem Lauf am Sonntag.', { proposal: { weekStart: w1, days: weekDays(-1) } });
say(14, 21, 'rider', 'Übernommen.', { takes: 'm23' });
say(13, 8, 'rider', 'Kreuzheben lasse ich lieber ganz weg, der Rücken macht da nicht mit.');
say(13, 8, 'coach', 'Gut, ich nehme das Kreuzheben aus allen Plänen. Rumänisches Kreuzheben bleibt, weil es sanfter ist. Passt das?', { rule: 'rule-kh' });
say(12, 7, 'rider', 'Passt.');
say(11, 18, 'rider', 'Der Latzug ging heute richtig gut, alle Sätze sauber.');
say(11, 18, 'coach', 'Das sehe ich auch. Fürs nächste Training schlage ich 2,5 kg mehr vor.', { nextChange: 'chg-m33' });
say(10, 12, 'rider', 'Ich bin Samstag auf einer Hochzeit, da fällt der Lauf aus.');
say(10, 12, 'coach', 'Alles gut, einen Lauf zu verschieben ist kein Problem. Ich lege ihn auf den Sonntag oder lasse ihn weg, wie du magst.');
say(9, 20, 'rider', 'Lass ihn weg, ich bin eh müde.');
say(9, 20, 'coach', 'Gut, dann wird der Tag ein Ruhetag. Erholung gehört dazu.');
say(8, 8, 'rider', 'Hotel-Gym heute, nur Kurzhanteln. Was geht?');
say(8, 8, 'coach', 'Dann machen wir Kurzhantel-Push mit Bankdrücken auf dem Boden, Schulterdrücken im Sitzen und Seitheben. Ich passe die Gewichte an.');
say(7, 18, 'coach', 'Wochengespräch: Die Woche war ordentlich. Wie fühlst du dich, und was steht in der neuen an?', { push: true });
say(7, 19, 'rider', 'Müde, aber zufrieden. Nächste Woche viel Arbeit, vielleicht nur zwei Mal Studio.');
say(7, 19, 'coach', 'Dann halte ich es bei zwei Kraft- und zwei Lauftagen, dazu einen Beweglichkeitstag.');
say(7, 19, 'coach', 'Vorschlag für die Woche ab dem ' + monday.slice(8) + '.' + monday.slice(5, 7) + '.', { proposal: { weekStart: monday, days: weekDays(0) } });
say(7, 20, 'rider', 'Übernommen.', { takes: 'm43' });
say(6, 7, 'rider', 'Schulter wieder besser.');
say(6, 7, 'coach', 'Sehr gut. Ich lasse das Überkopfdrücken noch eine Woche draußen, dann schauen wir wieder.');
say(5, 20, 'rider', 'Kann ich statt Beinpresse eine Hackenschmidt-Kniebeuge machen?');
say(5, 20, 'coach', 'Ja, gleiche Muskeln, etwas mehr Rumpf. Ich schlage das fürs nächste Beintraining vor.', { nextChange: 'chg-m48' });
say(4, 20, 'rider', 'Mein Knie zwickt manchmal bei Ausfallschritten.');
say(4, 20, 'coach', 'Danke. Ich nehme Ausfallschritte raus, solange das so ist.', { rule: 'rule-lunge' });
say(3, 7, 'rider', 'Pull war gut, Latzug mit 57,5 kg geklappt.');
say(3, 7, 'coach', 'Stark. Ich merke mir das und plane das Gewicht für nächste Woche gleich oder minimal höher.');
say(2, 20, 'rider', 'Diese Woche die Schulter schonen, bitte.');
say(2, 20, 'coach', 'Mache ich, ich gebe das an den Kraft-Coach weiter.');
say(1, 20, 'rider', 'Wenn ich Samstag einen langen Lauf habe, möchte ich am Freitag keine Beine trainieren.');
say(1, 20, 'coach', 'Das ist sinnvoll. Soll das eine feste Regel sein?', { rule: 'rule-prop' });
say(1, 21, 'rider', 'Ich überlege noch.');
say(0, 8, 'coach', 'Guten Morgen, heute steht ein Pull an. Ich habe den Plan angepasst und die Schulterfrage notiert.', { push: true });
say(0, 9, 'rider', 'Danke! Heute habe ich nur etwa 40 Minuten.');
say(0, 9, 'coach', 'Dann streichen wir den Curl und machen den Rest straff. Du hast Zeit für etwa vier Übungen.');
say(0, 10, 'rider', 'Gut. Wie sieht die nächste Woche aus?');
const nextMonday = addDays(monday, 7);
say(0, 10, 'coach', 'Ein Vorschlag für die Woche ab dem ' + nextMonday.slice(8) + '.' + nextMonday.slice(5, 7) + '.', { proposal: { weekStart: nextMonday, days: weekDays(1) } });
say(0, 11, 'rider', 'Bei Samstag bin ich unsicher. Antwort kommt später.');
lines.forEach((m, i) => {
  const id = `m${String(i + 1).padStart(2, '0')}`;
  const ms = Math.min(at(m.d, m.h, (i * 7) % 50), NOW - (lines.length - i) * 120_000);
  records.push(rec('chat', id, { role: m.role, text: m.text, atMs: ms, ...(m.role === 'coach' && i > 0 && lines[i - 1]!.role === 'rider' ? { replyTo: `m${String(i).padStart(2, '0')}` } : {}), ...m.extra }, ms));
});
// The take/decline notes point at the proposal message before them.
const idAt = (i: number) => `m${String(i + 1).padStart(2, '0')}`;
const proposalIdx = lines.map((m, i) => (m.extra?.proposal ? i : -1)).filter((i) => i >= 0);
lines.forEach((m, i) => {
  if (!m.extra?.takes && !m.extra?.declines) return;
  const target = idAt(proposalIdx.filter((p) => p < i).pop()!);
  const b = records.find((r) => r.kind === 'chat' && r.id === idAt(i))!.body as Record<string, unknown>;
  if (b.takes) b.takes = target; else b.declines = target;
});
const proposalIds = proposalIdx.map(idAt);
for (const [w, mid] of [[-2, proposalIds[0]!], [-1, proposalIds[2]!], [0, proposalIds[3]!]] as const) { const r = records.find((x) => x.kind === 'weekplan' && x.id === addDays(monday, 7 * w))!; (r.body as Record<string, unknown>).takenFrom = mid; (r.body as Record<string, unknown>).fromMessage = mid; }
// Cards inside the chat: a change proposed, one taken, one used; the rules above are referenced by id.
const changeAt = (n: number, mid: string, ops: Parameters<typeof changeRecord>[1], reason: string, state: string) => { const r = changeRecord(mid, ops, reason, at(n, 18)); (r.body as Record<string, unknown>).state = state; return r; };
const idOf = (pred: (m: Msg) => boolean) => idAt(lines.findIndex(pred));
const latzugMsg = idOf((m) => m.extra?.nextChange === 'chg-m33'), hackMsg = idOf((m) => m.extra?.nextChange === 'chg-m48');
for (const r of records) if (r.kind === 'chat') { const b = r.body as Record<string, unknown>; if (b.nextChange === 'chg-m33') b.nextChange = `chg-${latzugMsg}`; if (b.nextChange === 'chg-m48') b.nextChange = `chg-${hackMsg}`; }
records.push(changeAt(11, latzugMsg, [{ op: 'lighter', exerciseId: 'pf-lat-pulldown' }], 'Alle Sätze am Latzug liefen sauber, das nächste Mal darf es etwas mehr sein.', 'used'));
records.push(changeAt(5, hackMsg, [{ op: 'swap', exerciseId: 'pf-leg-press', toId: 'pf-hack-squat' }], 'Hackenschmidt-Kniebeuge statt Beinpresse, gleiche Muskeln, etwas mehr Rumpf.', 'proposed'));

// ---------- the open workout (written later, so Kraft can be photographed without it first) ----------
const openWorkout = () => {
  const start = NOW - 38 * 60_000;
  const set = (type: string, kg: number | null, reps: number | null, done: number | null) => ({ rid: rid(), type, weightKg: kg, reps, durationS: null, doneMs: done === null ? null : start + done * 60_000 });
  const ex = (id: string, ss: number | null, sets: ReturnType<typeof set>[]) => ({ rid: rid(), exerciseId: id, title: title(id), supersetId: ss, notes: '', sets });
  return {
    id: 'w-open', title: 'Push', startMs: start, endMs: null, source: 'pandafit', studio: 'Studio Nord', rest: { startMs: NOW - 25_000, durationS: 120 },
    exercises: [
      ex('pf-bench-press', null, [set('warmup', 25, 8, 3), set('normal', 52.5, 8, 7), set('normal', 52.5, 8, 11), set('normal', 52.5, null, null), set('normal', 52.5, 8, null)]),
      ex('pf-lateral-raise', 1, [set('normal', 8, 12, 17), set('normal', 8, 12, 24), set('normal', 8, 12, null)]),
      ex('pf-triceps-pushdown', 1, [set('normal', 27.5, 12, 19), set('normal', 27.5, 12, 26), set('normal', 27.5, 12, null)]),
      ex('pf-shoulder-press-machine', null, [set('normal', 30, 10, null), set('normal', 30, 10, null), set('normal', 30, 10, null)]),
    ],
  };
};

// ---------- start the server, seed, shoot ----------
const dbPath = join(mkdtempSync(join(tmpdir(), 'pf-shots-')), 'shots.db');
const db = openDb(dbPath);
const accountId = await createAccount(db, NAME, PASSWORD);
const result = putRecords(db, accountId, records, NOW);
if (result.refused.length) throw new Error(`shots: seed refused: ${JSON.stringify(result.refused.slice(0, 3))}`);
const app = buildServer({ dbPath, staticDir: resolve('out/web') });
await app.listen({ port: 0, host: '127.0.0.1' });
const base = `http://127.0.0.1:${(app.server.address() as { port: number }).port}`;
let browser: Browser | null = null;
let liveTimer: ReturnType<typeof setInterval> | undefined;
const taken: string[] = [];
const missed: string[] = [];

async function main() {
  try { browser = await chromium.launch({ headless: true }); }
  catch (e) { throw new Error(`no browser could be launched (${(e as Error).message.split('\n')[0]}). Install one with: npx playwright-core install chromium`); }
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true, locale: 'de-DE' });
  const page = await ctx.newPage();
  page.setDefaultTimeout(8000);
  page.on('pageerror', (e) => console.log('pageerror', e.message));

  const shot = async (name: string) => {
    if (filter && !name.includes(filter)) return;
    await page.waitForTimeout(350);
    await page.screenshot({ path: join(out, `${name}.png`), fullPage: true });
    taken.push(name);
    console.log(`shot ${name}`);
  };
  /** A step that may fail without stopping the rest: the screen is then listed as not reached. */
  const step = async (name: string, f: () => Promise<void>) => { try { await f(); } catch (e) { missed.push(name); console.log(`MISSED ${name}: ${(e as Error).message.split('\n')[0]}`); } };
  const nav = (label: string) => page.getByRole('navigation').getByRole('button', { name: label, exact: true }).click().then(() => page.waitForTimeout(400));
  const seg = (label: string) => page.getByRole('group', { name: 'Kraft' }).getByRole('button', { name: label, exact: true }).click().then(() => page.waitForTimeout(400));
  /** A clean start on a tab: reload (a dialog may still be open from the step before), then go there. */
  const fresh = async (tab: string) => { await page.reload(); await page.getByRole('navigation').getByRole('button', { name: tab, exact: true }).waitFor(); await page.waitForTimeout(1200); await nav(tab); };
  const closeDialog = () => page.getByRole('button', { name: 'Schließen' }).first().click({ timeout: 1500 }).catch(() => {});

  // The ride companion: no coach runs here, so the coach socket is played by the script. While `liveOn`, a running ride (invented values) comes once per second; every command is acked.
  let liveOn = false;
  let liveStep = 0;
  const liveSockets = new Set<WebSocketRoute>();
  const liveState = () => ({
    rideId: 'ride-shots', profileId: 'pa', atMs: Date.now(), elapsedS: 1425 + liveStep, powerW: 187, hrBpm: 142, cadenceRpm: 86, targetW: 190,
    step: { name: 'Tempo', index: 2, count: 5, remainingS: 200 - liveStep }, nextStep: { label: 'Locker' },
  });
  const pushLive = (ws: WebSocketRoute) => { try { ws.send(JSON.stringify({ type: 'live-state', profileId: 'pa', state: liveState() })); } catch { /* closed */ } };
  await page.route(/\/coach\/status$/, (route) => route.fulfill({ json: { profileId: 'pa', moved: true } }));
  await page.routeWebSocket(/\/coach$/, (ws) => {
    liveSockets.add(ws);
    ws.onClose(() => { liveSockets.delete(ws); });
    ws.onMessage((raw) => {
      try {
        const m = JSON.parse(String(raw)) as { type?: string; id?: string };
        if (m.type === 'live-watch' && liveOn) pushLive(ws);
        // Profil: the settings the account's coach holds (invented): Hevy connected, Garmin not, strength planned, meals on.
        if (m.type === 'subscribe') ws.send(JSON.stringify({ type: 'coach-state', state: {}, thinking: false, together: {}, hevy: { state: 'connected', workouts: 42, loading: false, lastSyncMs: null }, garmin: { state: 'idle' }, gym: { state: {} }, meals: { settings: { on: true, diet: 'vegetarisch', dislikes: [], intolerances: [], habits: { fruehstueck: 'zuhause', mittag: 'mitnehmen', abend: 'zuhause' } } } }));
        if (m.type === 'live-command') ws.send(JSON.stringify({ type: 'live-ack', profileId: 'pa', id: m.id, ok: true }));
      } catch { /* not ours */ }
    });
  });
  liveTimer = setInterval(() => { if (liveOn) { liveStep++; for (const ws of liveSockets) pushLive(ws); } }, 1000);

  // Login screen, then in.
  await page.goto(base);
  await page.getByLabel('Name').waitFor();
  await shot('login');
  await page.getByLabel('Name').fill(NAME);
  await page.getByLabel('Passwort').fill(PASSWORD);
  await page.getByRole('button', { name: 'Anmelden' }).click();
  await page.getByRole('heading', { level: 1, name: /^\p{L}+, \d+\. \p{L}+$/u }).waitFor();
  await page.getByRole('navigation').getByRole('button', { name: 'Statistik', exact: true }).waitFor({ timeout: 30_000 });
  await page.waitForFunction(() => document.body.innerText.includes('Pull'), null, { timeout: 30_000 }).catch(() => {});
  await page.waitForTimeout(1500);

  await shot('heute');
  await step('fahrt', async () => {
    liveOn = true;
    for (const ws of liveSockets) pushLive(ws);
    await page.getByRole('button', { name: /Fahrt läuft/ }).waitFor();
    await shot('fahrt-streifen');
    await page.getByRole('button', { name: /Fahrt läuft/ }).click();
    await page.getByLabel('Leistung').waitFor();
    await shot('fahrt-laeuft');
    await page.getByRole('button', { name: '+5 %' }).click();
    await page.waitForTimeout(250);
    await shot('fahrt-laeuft-gesendet');
    await page.getByRole('button', { name: 'Intervall überspringen' }).click();
    await shot('fahrt-laeuft-ueberspringen');
    await page.getByRole('button', { name: 'Abbrechen' }).click();
    liveOn = false;
    await page.waitForTimeout(11_500);
    await shot('fahrt-laeuft-weg');
    await closeDialog();
    await page.waitForTimeout(400);
  });
  await step('heute-anders', async () => { await page.getByRole('button', { name: /^Anders heute/ }).click(); await shot('heute-anders-heute'); await closeDialog(); });
  await step('heute-beweglichkeit', async () => { await page.getByRole('button', { name: /^Beweglichkeit/ }).click(); await page.waitForTimeout(300); await shot('heute-beweglichkeit-sheet'); await closeDialog(); });

  // Woche: the week and three rows; goal, rules and the coach chat are sheets.
  await nav('Woche');
  await page.waitForTimeout(800);
  await shot('woche');
  const row = (name: RegExp) => page.getByRole('button', { name });
  await step('woche-ziel-sheet', async () => { await row(/^Mein Ziel/).click(); await shot('woche-ziel-sheet'); await closeDialog(); });
  await step('woche-regeln-sheet', async () => { await fresh('Woche'); await row(/^Regeln/).click(); await page.getByRole('button', { name: /Ohne Kreuzheben/ }).click(); await shot('woche-regeln-sheet'); });
  await step('woche-exclude-picker', async () => { await fresh('Woche'); await row(/^Regeln/).click(); await page.getByRole('button', { name: '+ Hinzufügen' }).click(); await page.getByRole('button', { name: 'Übung ausschließen' }).click(); await shot('woche-exclude-exercise-picker'); });
  await step('woche-chat-sheet', async () => { await fresh('Woche'); await row(/^Coach/).click(); await page.waitForTimeout(500); await shot('woche-chat-sheet'); });
  await step('woche-chat-older', async () => {
    await page.getByRole('button', { name: 'Ältere anzeigen' }).click();
    await page.waitForTimeout(300);
    await shot('woche-chat-older-30');
  });
  await step('woche-chat-vorschlaege', async () => { await page.getByRole('button', { name: /^\d Vorschl/ }).click(); await page.waitForTimeout(300); await shot('woche-chat-vorschlaege'); await closeDialog(); });
  await step('woche-typing', async () => { await fresh('Woche'); await row(/^Coach/).click(); await page.getByLabel('Nachricht an den Coach').fill('Kannst du mir für nächste Woche etwas mit weniger Beinen vorschlagen?'); await page.getByLabel('Nachricht an den Coach').focus(); await shot('woche-chat-typing'); });

  // Kraft.
  await fresh('Kraft');
  await shot('kraft-training-start');
  await step('kraft-studio', async () => { await page.getByRole('button', { name: /^Studio/ }).click({ timeout: 1000 }); await shot('kraft-training-start-studio'); await closeDialog(); });
  await step('kraft-anderes', async () => { await page.getByRole('button', { name: 'Anderes Training' }).click({ timeout: 1000 }); await shot('kraft-training-start-anderes'); await closeDialog(); });
  await seg('Routinen');
  await shot('kraft-routinen');
  await step('kraft-routine-edit', async () => {
    await page.getByRole('button', { name: /^Kurz und knapp/ }).click(); await shot('kraft-routinen-sheet');
    await page.getByRole('button', { name: 'Bearbeiten' }).click(); await shot('kraft-routinen-bearbeiten');
    await step('kraft-routine-picker', async () => {
      await page.getByRole('button', { name: 'Übung hinzufügen' }).click(); await shot('kraft-routinen-uebung-waehlen');
      await page.locator('.tk-sheet .tk-rows .tk-rowbtn[aria-expanded]').first().click(); await shot('kraft-routinen-uebung-waehlen-gruppe');
      await page.getByLabel('Suchen').fill('zzzz'); await shot('kraft-routinen-uebung-waehlen-leer');
      await page.getByRole('button', { name: 'Eigene Übung anlegen' }).click(); await shot('kraft-routinen-uebung-eigene');
      await page.getByRole('button', { name: 'Schließen' }).last().click(); await page.getByRole('button', { name: 'Schließen' }).last().click();
    });
    await page.getByRole('button', { name: 'Abbrechen' }).first().click();
  });
  await step('kraft-routine-new', async () => { await page.getByRole('button', { name: 'Neue Routine' }).click(); await shot('kraft-routinen-neu'); await page.getByRole('button', { name: 'Abbrechen' }).first().click(); });
  await seg('Verlauf');
  await shot('kraft-verlauf');
  await step('kraft-verlauf-detail', async () => {
    await page.locator('.tk-rows .tk-rowbtn').first().click();
    await page.waitForTimeout(500);
    await shot('kraft-verlauf-detail');
    await step('kraft-verlauf-detail-exercise-history', async () => { await page.locator('.tk-rows .tk-rowbtn').first().click(); await shot('kraft-verlauf-detail-uebungsverlauf'); await page.locator('.tk-rows .tk-rowbtn').first().click(); await shot('kraft-verlauf-detail-uebungsverlauf-offen'); await page.getByRole('button', { name: 'Zurück' }).click(); });
    await step('kraft-verlauf-detail-edit', async () => { await page.getByRole('button', { name: 'Bearbeiten' }).click(); await shot('kraft-verlauf-detail-bearbeiten'); await page.getByRole('button', { name: 'Fertig' }).click(); });
    await page.getByRole('button', { name: 'Zurück' }).click();
  });
  await step('kraft-verlauf-uebungen', async () => {
    await page.getByRole('group', { name: 'Ansicht' }).getByRole('button', { name: 'Je Übung', exact: true }).click();
    await shot('kraft-verlauf-uebungen');
    await page.locator('.tk-rows .tk-rowbtn').first().click();
    await shot('kraft-verlauf-uebung-detail');
  });
  await fresh('Kraft'); await seg('Übungen');
  await shot('kraft-uebungen-katalog');
  await step('kraft-uebungen-group', async () => { await page.getByRole('button', { name: 'Brust', exact: true }).click(); await shot('kraft-uebungen-gruppe-offen'); await page.getByLabel('Übung suchen').fill('Kniebeuge mit Kurzhanteln'); await page.locator('.tk-row-more .tk-rowbtn').first().click(); await shot('kraft-uebungen-info-offen'); await page.getByRole('button', { name: /^Nicht mehr vorschlagen/ }).click(); await shot('kraft-uebungen-nicht-mehr-vorschlagen'); await page.keyboard.press('Escape'); });

  // Essen, Laufen, Statistik, Profil.
  await fresh('Essen');
  await shot('essen-tage');
  await step('essen-mahlzeit-offen', async () => { await page.locator('.tk-rowbtn[aria-expanded]').first().click(); await shot('essen-tage-mahlzeit-offen'); });
  await step('essen-gericht-quelle', async () => { await page.locator('.tk-rowbtn[aria-expanded]').nth(1).click(); await shot('essen-gericht-quelle'); });
  await step('essen-wunsch', async () => { await page.getByRole('button', { name: 'Änderung wünschen' }).click(); await shot('essen-aenderung-wuenschen'); await page.keyboard.press('Escape'); });
  await step('essen-rezept-hinzufuegen', async () => {
    await page.getByRole('button', { name: 'Rezept hinzufügen' }).click();
    await page.getByLabel('Link zum Rezept').fill('https://rezepte.example/gemuese-curry');
    await shot('essen-rezept-hinzufuegen');
    await page.keyboard.press('Escape');
  });
  await step('essen-eigene-rezepte', async () => { await page.getByRole('button', { name: /^Eigene Rezepte/ }).click(); await shot('essen-eigene-rezepte'); await page.keyboard.press('Escape'); });
  await step('essen-einkauf', async () => { await page.getByRole('button', { name: /^Einkauf/ }).click(); await shot('essen-einkauf'); });
  await step('essen-einkauf-haben-wir', async () => { await page.locator('.pm-have').first().click(); await shot('essen-einkauf-haben-wir'); await page.locator('.pm-have').first().click(); });
  await step('essen-einkauf-eigenes', async () => {
    await page.getByLabel('Etwas dazuschreiben').fill('Kaffee');
    await page.getByLabel('Menge (optional)').fill('2 Pakete');
    await page.getByRole('button', { name: 'Hinzufügen' }).click();
    await page.getByRole('checkbox', { name: 'Haferflocken gekauft' }).click().catch(() => {});
    await page.waitForTimeout(400);
    await shot('essen-einkauf-eigenes');
  });
  // Ausdauer: Rad first (the default), then the switch to Laufen.
  await nav('Ausdauer');
  await page.waitForTimeout(500);
  await shot('rad');
  await step('rad-aufbau', async () => { await page.getByRole('button', { name: /^Aufbau/ }).click(); await shot('rad-aufbau'); await closeDialog(); });
  await step('rad-fahrt', async () => { await page.getByRole('button', { name: /Grundlage|Locker|Schwellen/ }).first().click(); await shot('rad-fahrt'); await closeDialog(); });
  await step('rad-entwicklung', async () => { await page.getByRole('button', { name: /^Entwicklung/ }).click(); await shot('rad-entwicklung'); await closeDialog(); });
  await step('rad-fahrten', async () => { await page.getByRole('button', { name: /^Fahrten/ }).click(); await shot('rad-fahrten'); await closeDialog(); });
  const enduranceSeg = (label: string) => page.getByRole('group', { name: 'Ausdauer' }).getByRole('button', { name: label, exact: true }).click().then(() => page.waitForTimeout(400));
  await enduranceSeg('Laufen');
  await shot('ausdauer-umschalter');
  await shot('laufen');
  await step('laufen-eintragen', async () => { await page.getByRole('button', { name: 'Lauf eintragen' }).click(); await shot('laufen-lauf-eintragen'); await page.getByRole('button', { name: /^Mehr/ }).click(); await shot('laufen-lauf-eintragen-mehr'); await page.keyboard.press('Escape'); });
  await step('laufen-entwicklung', async () => { await fresh('Ausdauer'); await enduranceSeg('Laufen'); await page.getByRole('button', { name: /^Entwicklung/ }).click(); await shot('laufen-entwicklung'); await page.keyboard.press('Escape'); });
  await step('laufen-einstellungen', async () => { await fresh('Ausdauer'); await enduranceSeg('Laufen'); await page.getByRole('button', { name: /^Lauftage und Angaben/ }).click(); await shot('laufen-lauftage-aendern'); await page.keyboard.press('Escape'); });
  await nav('Statistik');
  await page.waitForTimeout(500);
  await shot('statistik');
  await step('statistik-muscle', async () => { await page.getByRole('button', { name: 'Muskeln' }).click(); await page.getByRole('dialog', { name: 'Muskeln' }).locator('.tk-rowbtn').first().click(); await shot('statistik-muskel-offen'); await page.keyboard.press('Escape'); await page.getByRole('button', { name: 'Details' }).click(); await shot('statistik-details'); await page.keyboard.press('Escape'); });
  await step('gesundheit', async () => {
    await page.getByRole('button', { name: 'Gesundheit' }).click();
    await page.getByRole('dialog', { name: 'Gesundheit' }).waitFor();
    await shot('gesundheit');
    await page.getByRole('dialog', { name: 'Gesundheit' }).getByRole('button', { name: /^Ruhepuls/ }).click();
    await shot('gesundheit-ruhepuls');
    await page.getByRole('button', { name: /^Quellen/ }).click();
    await shot('gesundheit-quellen');
    await page.keyboard.press('Escape');
    await page.waitForTimeout(400);
    await closeDialog();
  });
  await step('gesundheit-arzt', async () => {
    const dbh = openDb(dbPath);
    putRecords(dbh, accountId, [rec('health', 'health', healthBody(true), NOW + 5000)], NOW + 5000);
    dbh.close();
    await fresh('Statistik');
    await page.getByRole('button', { name: 'Gesundheit' }).click();
    await page.getByRole('dialog', { name: 'Gesundheit' }).waitFor();
    await shot('gesundheit-arzt');
    await closeDialog();
  });
  await page.getByRole('button', { name: 'Profil', exact: true }).click();
  await page.waitForTimeout(500);
  await shot('profil');

  // The open workout arrives from the server like it would from another device.
  const putOpen = openWorkout();
  const dbw = openDb(dbPath);
  putRecords(dbw, accountId, [rec('workout', 'w-open', putOpen, NOW)], NOW);
  dbw.close();
  await page.reload();
  await page.getByRole('navigation').waitFor();
  await page.waitForFunction(() => document.body.innerText.length > 0);
  await page.waitForTimeout(3500);
  await nav('Heute');
  await page.getByRole('button', { name: 'Weitermachen' }).waitFor({ timeout: 10_000 }); // the open workout must really be on Heute
  await shot('heute-training-offen');
  await nav('Kraft');
  await page.waitForTimeout(1000);
  await shot('kraft-training-offen-karte');
  await step('kraft-training-active', async () => {
    await page.getByRole('button', { name: 'Weitermachen' }).click();
    await page.waitForTimeout(800);
    await shot('kraft-training-active');
    await step('kraft-training-active-menu', async () => { await page.getByRole('button', { name: 'Mehr zu Bankdrücken' }).click(); await shot('kraft-training-active-uebung-menue'); await page.getByRole('button', { name: 'Mehr', exact: true }).click(); await shot('kraft-training-active-uebung-menue-mehr'); await closeDialog(); });
    await step('kraft-training-active-header-menu', async () => { await page.evaluate(() => window.scrollTo(0, 0)); await page.getByRole('button', { name: 'Mehr zum Training' }).click(); await shot('kraft-training-active-kopf-menue'); await closeDialog(); });
    await step('kraft-training-active-studio', async () => { await page.evaluate(() => window.scrollTo(0, 0)); await page.getByRole('button', { name: 'Mehr zum Training' }).click(); await page.getByRole('button', { name: /^Studio wechseln/ }).click(); await shot('kraft-training-active-studio'); await closeDialog(); });
    await step('kraft-training-active-reorder', async () => {
      await page.evaluate(() => window.scrollTo(0, 0));
      const box = await page.locator('.tk-hold').nth(1).boundingBox();
      if (!box) throw new Error('no exercise title');
      await page.mouse.move(box.x + 60, box.y + box.height / 2);
      await page.mouse.down();
      await page.waitForTimeout(700);
      await page.mouse.move(box.x + 60, box.y + box.height / 2 + 70, { steps: 6 });
      await page.waitForTimeout(300);
      await shot('kraft-training-active-reihenfolge');
      await page.mouse.up();
      await page.waitForTimeout(300);
      await shot('kraft-training-active-reihenfolge-danach');
      await page.getByRole('button', { name: 'Fertig' }).click();
    });
    await step('kraft-training-active-picker', async () => { await page.getByRole('button', { name: 'Übung hinzufügen' }).click(); await shot('kraft-training-active-uebung-hinzufuegen'); await closeDialog(); });
    await step('kraft-training-active-set-edit', async () => { await page.getByLabel('Gewicht Satz 1').first().focus(); await shot('kraft-training-active-tippen'); await page.getByLabel('Gewicht Satz 1').first().blur(); });
    await step('kraft-training-summary', async () => {
      await page.getByRole('button', { name: 'Training beenden' }).click();
      await page.waitForTimeout(800);
      await shot('kraft-training-beendet');
      await page.getByRole('button', { name: 'Weglassen' }).click();
      await page.waitForTimeout(1200);
      await shot('kraft-training-zusammenfassung');
    });
  });
  await ctx.close();
}

try {
  await main();
  writeFileSync(join(out, 'MANIFEST.txt'), taken.map((n) => `${n}.png`).join('\n') + '\n');
  console.log(`done: ${taken.length} shots in ${out}${missed.length ? `; not reached: ${missed.join(', ')}` : ''}`);
} catch (e) {
  console.error(e instanceof Error ? e.message : e);
  process.exitCode = 1;
} finally {
  if (liveTimer) clearInterval(liveTimer);
  await (browser as Browser | null)?.close().catch(() => {});
  await app.close();
  db.close();
}
