# Training Statistics Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** One statistics page per profile (phone and Mac) showing whether the whole training is in balance and whether the muscles are trained evenly, this week and over the last 8 weeks; the gym coach sees the same muscle numbers.

**Architecture:** The side that coaches a profile (Mac or server coach, `coachHere`) writes one `stats` record per profile with minutes per sport and hardness per day for the last 9 weeks, plus the gym goal and the muscles of Hevy templates used. Muscle sets are computed on the showing device from `workout` records with shared code (`src/tracking/stats.ts`), so phone and Mac show the same. One shared screen (`StatsScreen`) is used by the phone tab and the Mac menu item.

**Tech Stack:** TypeScript, React, Vitest (+ jsdom, Testing Library), Electron (Mac), PWA (phone), node:sqlite server (records stored as opaque JSON, kinds from `RECORD_KINDS`).

**Spec:** `docs/archive/specs/2026-11-03-training-stats-design.md`

## Global Constraints

- Public repo: no personal data in code, tests or fixtures (no real names, ids, emails, IPs).
- Works for anyone: a profile that only rides or only lifts sees only its part. Hevy and Garmin stay optional; nothing may require them.
- No guilt and no streaks: no score, no "balance index", no red alarm for a rest week; plain German counts and sentences.
- The record carries no health details beyond minutes and hardness per day (no heart rate, watts, kilos, sleep).
- Week = Monday to Sunday in local time (same as `allTraining` in `src/coach/all-training.ts`). Trend window: 8 weeks plus the current week.
- Working set = a set with `doneMs !== null` and `type !== 'warmup'`, in a finished workout (`endMs !== null`). Primary muscle only.
- Muscle groups and weekly ranges come only from `src/shared/muscle-targets.ts` (`MUSCLE_TARGETS`, `muscleGroupOf`, `weeklySetRange`). Do not invent new numbers.
- Imbalance verdict: over the last 4 complete weeks, a pair is called out when the smaller side has less than two thirds of the larger side and the larger side has at least 6 sets.
- Balance verdicts: more than two hard days in a week; a sport that was "set up" (at least one session in the 8 weeks before the last 3 weeks) with no session in the last 3 weeks; a week with more than 1.5× the mean minutes of the 4 weeks before it.
- No writes with a ride open (`noOpenRide()`); the writer is only the side where `coachHere(profileId)` is true.
- During an open ride `src/service/**`, `src/shared/**`, `src/main/**` must not be touched — check `grep -lE '"status": *"open"' "$HOME/Library/Application Support/bike-coach/rides"/ride-*/meta.json` before starting a task; if a ride is open, stop and report.
- Every commit message ends with:
  ```
  Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
  Claude-Session: https://claude.ai/code/session_013UaCPT9jfJFFdfGrx5oF5J
  ```

## Review Focus

1. A session logged both in Pandafit and in Hevy (same workout twice) — counted once; tested in Task 4 with `dedupeSessions`-style duplicates.
2. A Hevy exercise whose template muscle is unknown and that matches no own exercise — counts under "Sonstiges" and is listed by name; tested in Task 4.
3. A stats record that is days old (Mac off) — the page says "Stand: <Datum>" and still renders; tested in Task 5.
4. A profile with workouts but no stats record yet (new install, coach not run) — the muscle part shows, the balance part says it appears after the next coach run; tested in Task 5.
5. A workout still open (`endMs === null`) — its sets do not count until it is finished; tested in Task 4.

---

### Task 1: The `stats` record kind and its shape

**Files:**
- Create: `src/shared/stats.ts`
- Modify: `src/shared/records.ts:2` (add `'stats'` to `RECORD_KINDS`)
- Modify: `src/web/validate.ts` (case `'stats'`)
- Test: `tests/shared/stats-record.test.ts`

**Interfaces:**
- Produces:
  - `export const STATS_ID = 'stats'`
  - `export type Sport = 'bike' | 'strength' | 'run' | 'mobility' | 'other'`
  - `export type StatsDay = { date: string /* YYYY-MM-DD local */; minutes: Record<Sport, number>; hardness: 'easy' | 'moderate' | 'hard' | null; legs: boolean }`
  - `export type StatsBody = { type: 'stats'; atMs: number; goal: string | null; days: StatsDay[]; muscles: Record<string, string> }`
  - `export function readStats(body: unknown): StatsBody | null` — null for anything not matching; `days` at most 70 entries, dates unique and ascending, minutes finite and ≥ 0 and ≤ 1440, `muscles` at most 500 entries with string keys and values (each ≤ 100 chars), `goal` string ≤ 40 or null.

- [ ] **Step 1: Write the failing tests** — `readStats` accepts a valid body (2 days, one muscle entry); rejects: unknown `type`, a negative minute, 71 days, duplicate dates, dates out of order, a minutes object missing `run`, a `muscles` value that is a number, `hardness: 'brutal'`. `RECORD_KINDS` contains `'stats'`. `validBody('stats', valid)` is true and `validBody('stats', {})` false.
- [ ] **Step 2: Run** `npx vitest run tests/shared/stats-record.test.ts` — Expected: FAIL (module not found).
- [ ] **Step 3: Implement** `src/shared/stats.ts`, add the kind, add the validate case.
- [ ] **Step 4: Run** the test file, then `npx vitest run` (whole suite; tests that list the kinds, e.g. sync/idb/server tests, may need the new kind added to expectations — update them, never weaken them) and `npm run typecheck`. Expected: all pass.
- [ ] **Step 5: Commit** `feat(stats): a stats record kind with minutes and hardness per day`

Note: adding a kind changes `RECORD_KINDS_SIGNATURE`, so every device refetches its records once. That is intended.

### Task 2: Minutes per sport and hardness per day (coach side)

**Files:**
- Create: `src/coach/stats/stats-days.ts`
- Modify: `src/coach/day-load.ts` (accept runs)
- Test: `tests/coach/stats/stats-days.test.ts`, `tests/coach/day-load.test.ts` (extend; find the existing file with `rg -l dayRatings tests`)

**Interfaces:**
- Consumes: `dayRatings`, `DayInput` from `src/coach/day-load.ts`; `overlapsByHalf` from `src/coach/all-training.ts`; `StatsDay`, `Sport` from Task 1.
- Produces:
  - `DayInput` gains optional `runs?: { startMs: number; durationS: number; hardness: DayHardness }[]` — each adds its hardness and minutes to its date in `dayRatings` (legs stays false for runs).
  - `export const rateRun = (r: { durationS: number; planned: 'easy' | 'long' | 'test' | null }): DayHardness` — `test` → `'hard'`, `long` or a run of 75 minutes or more → `'moderate'`, else `'easy'`.
  - `export type StatsInput = { rides: { startedAtMs: number; durationS: number }[]; strength: { startMs: number; durationS: number }[]; runs: { startMs: number; durationS: number }[]; mobility: { doneMs: number; minutes: number }[]; other: { startMs: number; durationS: number; sport: string }[]; ratings: Record<string, DayRating> }`
  - `export function statsDays(input: StatsInput, dates: string[]): StatsDay[]` — minutes per sport per date (rounded), `hardness`/`legs` from `ratings[date]` (null/false when missing). Mobility counts on the date of `doneMs`.
  - `export const lastDates = (nowMs: number, weeks = 9): string[]` — local dates from the Monday 8 weeks before the current week's Monday up to and including today, ascending.

- [ ] **Step 1: Write the failing tests** — `rateRun` cases above; `dayRatings` with a hard run on a date gives `hardness: 'hard'` and adds its minutes; `statsDays` puts a 60-min ride, a 45-min workout, a 30-min run and a 10-min mobility on the right dates and sports; a date with nothing has all zeros and `hardness: null`; `lastDates` for a Wednesday returns 8×7 + 3 dates starting on a Monday (test with a fixed local `Date`).
- [ ] **Step 2: Run** `npx vitest run tests/coach/stats tests/coach/day-load.test.ts` — Expected: FAIL.
- [ ] **Step 3: Implement.** Dedupe across sources is done by the caller (Task 3), not here.
- [ ] **Step 4: Run** the tests, `npx vitest run`, `npm run typecheck`. Expected: pass.
- [ ] **Step 5: Commit** `feat(stats): minutes per sport and hardness per day for the stats record`

### Task 3: Writing the stats record

**Files:**
- Create: `src/coach/tracking/stats-export.ts`
- Modify: `src/coach/runtime.ts` (call it in the tick next to `exportTogether`, ~line 472)
- Modify: `src/coach/run/run-coach.ts` (expose `runsFor(profileId): { startMs: number; durationS: number; hardness: DayHardness }[]` from its merged Garmin + manual runs of the last 70 days, hardness via `rateRun` with the planned kind of that date from the week records if any)
- Test: `tests/coach/tracking/stats-export.test.ts`

**Interfaces:**
- Consumes: Tasks 1 and 2; `allTraining`-style dedupe `overlapsByHalf`; `RecordStore` (`all`, `put`) from `src/coach/tracking/store.ts`; gym state `goal` (`gym.state(id).goal`); `muscleOf` already used in `runtime.ts` for Hevy templates.
- Produces: `export function exportStats(d: { store: Pick<RecordStore, 'all' | 'put'>; profileIds: string[]; coachHere: (id: string) => boolean; noOpenRide: () => boolean; nowMs: number; content: (id: string) => Omit<StatsBody, 'atMs'> | null }): string[]` — writes `{ kind: 'stats', id: STATS_ID }` for every profile with `coachHere(id)` whose content differs from the stored body ignoring `atMs`; `updatedMs = max(nowMs, have.updatedMs + 1)`; nothing with a ride open; a throwing `content` skips only that profile; `content` returning null writes nothing. Mirrors `exportTogether` in `src/coach/tracking/together-export.ts`, but for every coached profile, linked or not.
- In `runtime.ts`, `content(id)` builds `StatsInput` from: bike `coach.state(id).summaries`; strength `gym.history(id)`; runs `run.runsFor(id)`; mobility done records of the profile (`records.all(id, 'mobility')` with numeric `doneMs`; minutes = `body.minutes` if a finite number, else 10); other Garmin activities from `garminData(id)?.activities` that are neither a ride of this app, nor a strength workout, nor a run (same overlap rules as `allTraining`); ratings from the same `dayRatings` call the run coach uses (with `runs` added and `bikeNext`/`gymNext` null). `muscles` = `{ [templateId]: primaryMuscle }` for every Hevy template used in `gym.history(id)` within the dates. `goal` = `gym.state(id).goal ?? null`. Returns null when every day is empty and there are no muscles.

- [ ] **Step 1: Write the failing tests** for `exportStats`: writes for a coached profile; skips a profile with `coachHere` false; writes nothing with a ride open; a second call with the same content writes nothing; changed content writes with a higher `updatedMs`; a throwing `content` for one profile still writes the other.
- [ ] **Step 2: Run** `npx vitest run tests/coach/tracking/stats-export.test.ts` — Expected: FAIL.
- [ ] **Step 3: Implement** `exportStats`, `runsFor`, and the wiring in `runtime.ts`.
- [ ] **Step 4: Run** `npx vitest run` and `npm run typecheck`. Expected: pass.
- [ ] **Step 5: Commit** `feat(stats): the coach writes the stats record for the profiles it coaches`

### Task 4: The numbers of the page (shared)

**Files:**
- Create: `src/tracking/stats.ts`
- Modify: `src/shared/muscle-targets.ts` (add `pairVerdicts`)
- Test: `tests/tracking/stats.test.ts`, `tests/coach/gym/muscle-volume.test.ts` (extend for `pairVerdicts`)

**Interfaces:**
- Consumes: `StatsBody` (Task 1); `MUSCLE_TARGETS`, `muscleGroupOf`, `weeklySetRange`, `MuscleGroup`; `ownExerciseFor` from `src/tracking/similar.ts`; `EXERCISES`; `dedupeSessions`, `onePerSession` from `src/shared/history.ts`; `LoggedWorkout`.
- Produces (in `src/shared/muscle-targets.ts`):
  - `export const PAIRS: { a: MuscleGroup; b: MuscleGroup; label: string }[]` = Brust : Rücken (`chest`/`back`), Oberschenkel vorn : Oberschenkel hinten und Gesäß (`quads`/`hams_glutes`), Schultern vorn : Schultern seitlich und hinten (`front_delts`/`side_rear_delts`).
  - `export function pairVerdicts(sets4Weeks: Partial<Record<MuscleGroup, number>>): { label: string; a: number; b: number; short: MuscleGroup | null }[]` — `short` is the smaller side when it is below 2/3 of the larger and the larger is ≥ 6, else null.
- Produces (in `src/tracking/stats.ts`):
  - `export type WeekStats = { weekStart: string; minutes: Record<Sport, number>; hardDays: number; sets: Partial<Record<MuscleGroup, number>> }`
  - `export type StatsView = { asOfMs: number | null; weeks: WeekStats[] /* oldest first, current week last, 9 entries */; thisWeek: WeekStats; targets: Record<MuscleGroup, { min: number; max: number }>; pairs: ReturnType<typeof pairVerdicts>; verdicts: string[]; unknown: string[] /* titles counted under Sonstiges, unique */; sports: Sport[] /* sports with any minutes in the 9 weeks */ }`
  - `export function statsView(stats: StatsBody | null, workouts: LoggedWorkout[], nowMs: number): StatsView` — sets per group per week from finished workouts (deduped); muscle of an exercise: own exercise via `ownExerciseFor` (`primaryMuscle`), else `stats.muscles[exerciseId]`, else `'other'` (title into `unknown`); minutes and hard days from `stats.days` (all zero when `stats` is null); `targets` from `weeklySetRange(g, stats?.goal)`; pairs over the last 4 complete weeks; verdicts as German sentences with the exact wording:
    - pair: `"<Kurz-Seite> <n> Sätze, <andere Seite> <m>: <Kurz-Seite> kommt zu kurz."` with the group labels from `MUSCLE_TARGETS` and the 4-week sums.
    - hard days: `"<n> harte Tage in der Woche vom <TT.MM.>. Mehr als zwei sind viel."`
    - sport gone: `"Seit drei Wochen kein <Rad|Krafttraining|Laufen|Mobility>."` (no sentence for `other`).
    - jump: `"Die Woche vom <TT.MM.> hatte deutlich mehr Minuten als die vier davor."`

- [ ] **Step 1: Write the failing tests** — counts working sets only (warm-ups and undone sets excluded); an open workout does not count; the same session twice (Pandafit and Hevy copy, see `tests/tracking/*` for how duplicates look) counts once; a Hevy exercise with `muscles` entry `chest` counts for `chest`; an unknown Hevy exercise counts for `other` and appears in `unknown`; `pairVerdicts({ chest: 14, back: 8 })` gives `short: 'back'`; `({ chest: 5, back: 2 })` gives null (larger < 6); `({ chest: 12, back: 9 })` null; each verdict sentence once with exact wording; `stats: null` gives zero minutes and no balance verdicts; goal `'muscle'` gives chest target `{ min: 12, max: 18 }`.
- [ ] **Step 2: Run** `npx vitest run tests/tracking/stats.test.ts tests/coach/gym/muscle-volume.test.ts` — Expected: FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run** `npx vitest run`, `npm run typecheck`. Expected: pass.
- [ ] **Step 5: Commit** `feat(stats): the page's numbers from the stats record and the workouts`

### Task 5: The statistics screen, the phone tab and the Mac menu item

**Files:**
- Create: `src/tracking/ui/StatsScreen.tsx`, styles in `src/tracking/ui/tracking.css`
- Modify: `src/web/App.tsx` (tab `'statistik'`, label `'Statistik'`, after `'verlauf'`), `src/ui/nav.ts` (menu item `'statistik'`, label `'Statistik'`), the Mac view that renders tracking screens (follow how `'laufen'`/`RunScreen` is wired in `src/ui/nav.ts` and `src/ui/App.tsx`)
- Test: `tests/tracking/stats-screen.test.tsx`, extend `tests/web/app.test.tsx` and the nav tests (`rg -l "menuItems" tests`)

**Interfaces:**
- Consumes: `statsView` (Task 4), `usePortRecords(port, 'stats')` and `usePortRecords(port, 'workout')` from `src/tracking/ui/hooks.ts`, `readStats`, `MuscleIcon` from `src/tracking/ui/MuscleIcon.tsx`.
- Produces: `export function StatsScreen({ port, now }: { port: TrackingPort; now: () => number })`.

Screen content, top to bottom:
1. `h1` "Statistik"; under it `"Stand: <Wochentag, TT. Mon>"` from `asOfMs` (via `dateLabel`), or, without a stats record, `"Minuten und harte Tage erscheinen nach dem nächsten Lauf des Coaches."`.
2. Section "Diese Woche" (`aria-label="Diese Woche"`): minutes per sport that occurs in `sports` (German labels Rad, Kraft, Laufen, Mobility, Andere); `"Harte Tage: <n>"`; per muscle group with a target (`max > 0`) or sets > 0: `MuscleIcon`, label, sets this week, and a bar showing the sets against the band (band drawn as a shaded range, value as a bar; text `"<n> von <min>–<max> Sätzen"` always present so it reads without colour); the verdicts as a list (none → no list).
3. Section "Letzte 8 Wochen" (`aria-label="Letzte 8 Wochen"`): stacked bars of minutes per week by sport (one bar per week, oldest left, with a legend and a text alternative per bar `"Woche vom TT.MM.: <n> Minuten"`); hard days per week as numbers under the bars; a compact table weeks × muscle groups (sets); the pairs over 4 weeks as `"<a label> <a> : <b> <b label>"`.
4. When `unknown` is not empty: `"Ohne bekannten Muskel: <titles joined by ', '>"`.
Only sports with minutes and only muscle groups with a target or sets are shown, so a bike-only profile sees no muscle section at all when it has no workouts (then the muscle parts are left out entirely).
The phone tab and the Mac menu item appear when a `stats` record exists or at least one finished workout exists.

- [ ] **Step 1: Write the failing tests** — renders both sections with a stats record and two workouts; shows "Stand:" with the record date; without a stats record shows the "erscheinen nach dem nächsten Lauf" note and still the muscle part; a bike-only profile (stats with only bike minutes, no workouts) shows no muscle part; the band text `"<n> von 12–18 Sätzen"` for chest with goal muscle; the unknown list; no text matches `/Serie|Streak|Punkte|musst/`. Phone: the tab `Statistik` is shown with a stats record and hidden without stats and workouts. Mac: the menu has `Statistik` under the same rule.
- [ ] **Step 2: Run** `npx vitest run tests/tracking/stats-screen.test.tsx tests/web/app.test.tsx` and the nav test — Expected: FAIL.
- [ ] **Step 3: Implement.** Charts are plain SVG/CSS in the project style (see `.tk-progress`, `.tk-bar` in `tracking.css` and `Spark` in `RunScreen.tsx`); colours via the existing CSS variables, sports with distinct but calm colours, and every number also as text.
- [ ] **Step 4: Run** `npx vitest run`, `npm run typecheck`, `npm run test:web-smoke`. Expected: pass, `SMOKE PASSED`.
- [ ] **Step 5: Commit** `feat(stats): the statistics page on the phone and the Mac`

### Task 6: The gym coach sees the pairs

**Files:**
- Modify: `src/coach/gym/muscle-volume.ts`, `src/coach/gym/prompt.ts`
- Test: `tests/coach/gym/muscle-volume.test.ts`

**Interfaces:**
- Consumes: `pairVerdicts` (Task 4), `muscleVolume` (exists).
- Produces: the prompt data block `muskelvolumen` stays; a new block `muskelpaare` = `pairVerdicts` over the 4-week sums of `muscleVolume` (`perWeek4Weeks × 4`), as `{ paar, seiteA, seiteB, zuKurz: <label or null> }`. The system prompt sentence about `muskelvolumen` gets: `"Steht in muskelpaare eine Seite unter zuKurz, plane sie in den nächsten Trainings bevorzugt ein; das ist ein Hinweis, keine Pflicht."`

- [ ] **Step 1: Write the failing test** — a history with 14 chest and 6 back sets in 4 weeks gives a `muskelpaare` block with `"zuKurz":"Rücken"`; the system prompt contains `muskelpaare`.
- [ ] **Step 2: Run** `npx vitest run tests/coach/gym/muscle-volume.test.ts` — Expected: FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run** `npx vitest run`, `npm run typecheck`. Expected: pass.
- [ ] **Step 5: Commit** `feat(gym): the gym coach sees which side of a muscle pair falls short`
