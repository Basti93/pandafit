# Milestone O: Bike in the web app

Brief: `docs/roadmap.md`, Meilenstein O (row in the table; the brief is written with this plan below).

## Global Constraints

- Before each task, check that no ride is open.
- No npm install, no new dependencies, no push, no deploy.
- **Public repo:** no personal data. Tests use invented rides.
- A ride is never lost. Publishing is read-only on ride files.
- **Light UI**, following the milestone L design rules (`docs/archive/plans/2026-11-07-milestone-l-calm-ui.md` "Design rules"; kit in `src/tracking/ui/kit/`):
  - one line per item;
  - numbers only on demand;
  - sheets for details;
  - one primary per screen.
- General mechanisms; product values go in the register.
- Commits end with `Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>`. `npm test` and `npm run typecheck` are green after each task.

## Today (from exploration)

- **Server-side bike coaching:** moved profiles are coached on the server.
  - `household.ts:134` builds `createCoachRuntime` per account with root `<root>/accounts/<id>`; rides are in `<dir>/rides`.
  - `Coach.scan` keeps `CoachState.summaries: RideSummary[]` (`coach/metrics.ts:6`), `ftpW`, `ftpHistory`, `phase`, `next {session, reason, source}`, `alternatives`, `feedback`, `debriefs`.
- **What reaches the web:** only records do (`TrackingPort`); the `coach-state` websocket message is not used by the web.
  - The `stats` record (`shared/stats.ts`, `exportStats` `runtime.ts:698`) already has `days[].minutes.bike`, hardness and legs, `ftp` (half a year), `advice`, and `changes`.
- **Web day ratings** (`frame-hooks.ts:38` `ratingsFromRecords`) ignore bike; the published advice knows it.
- **Session shape:** `shared/session.ts` has `Session {id, name, description?, steps}`, `Step erg|grade`, and `stepFtpFraction`. `RideDetail` points come via `Coach.rideDetail` (`coach.ts:359`).
- **Ride helpers** in `coach/metrics.ts`, `coach/stats.ts` and `coach/progress.ts` are not in `shared`.
- **Web tabs** (`src/web/App.tsx:316,378,382,438`): `laufen` shows when `hasRun`. `RunScreen` lives in `src/tracking/ui/RunScreen.tsx`.
- **Week chat:** it sees bike only as the next session name/minutes (`sessionsOf` `runtime.ts:324`). Tasks to `bike` already work (`COACH_IDS`), and the chat replans the bike at once.

## Design

### Records (published by the server coach runtime, written only on change, like stats)

- **`bike`**, one per profile, id `bike`. Body:
  - `ftpW`;
  - `ftpHistory` (last 12 months, `{atMs, ftpW, source}`);
  - `phase {name, weeksLeft, goal} | null`;
  - `next` (or `null`): `{ name, reason, minutes, hardness, blocks: {label, minutes, pct?: number}[] }`, where blocks are steps merged into readable blocks (repeats collapsed to "3 × 8 Min");
  - `alternatives: {name, minutes, why}[]` (≤ 3);
  - `weekHours: {week, hours}[]` (last 12 weeks);
  - `atMs`.
- **`ride`**, one per counted ride, id = rideId. Body:
  - `{ startedAtMs, sessionName?, durationS, hardness, avgPowerW, normalizedPowerW, avgHrBpm, maxHrBpm, tss, completedFraction, feedback?, debrief?: string (one short sentence), curve: {t, powerW, hrBpm}[] }`, with at most 150 points (downsampled; reuse the `rideDetail` downsampling).
  - It is published for all summaries; a removed or replaced ride updates or tombstones it.
- Validate both kinds in `validate.ts` (body ≤ 64 KiB each) and add them to `RECORD_KINDS`.
- Move the pure helpers the web needs into `src/shared/` (re-export from the old place so nothing else changes):
  - block merging;
  - curve downsampling;
  - `rateIntensity` (already shared).

### Web: "Ausdauer" tab

- **Tabs:** `laufen` becomes `ausdauer` ("Ausdauer"). It is visible when `hasRun || hasBike`.
  - `hasBike` means the `bike` record exists with a `next` or at least one `ride` record.
  - Inside is a small segmented control "Rad | Laufen", shown only when both exist; it remembers the last choice (localStorage, try/catch).
  - Remap `startTab` / `onOpenTab` / `goRun` ('laufen' still accepted as an alias).
- **BikeScreen** (`src/tracking/ui/BikeScreen.tsx`):
  - `PageHead` "Rad".
  - **Next ride card:** "Schwellen-Intervalle · 60 Min · hart", plus the reason muted in one line. "Aufbau ›" opens a sheet with one row per block ("10 Min locker", "3 × 8 Min bei 95 %", …).
  - **"Letzte Fahrt" row:** "Di., 3. Nov. · Grundlage · 52 Min · locker ›" opens the ride sheet.
  - **"Entwicklung ›" sheet:**
    - the FTP sentence ("FTP 245 W – seit Sept. 10 W mehr");
    - the phase line;
    - hours per week as bars with dates only (palette colours, like Statistik).
  - **"Fahrten ›" sheet:**
    - list rows by month: date · name · minutes;
    - a tap opens the ride sheet.
  - **Ride sheet:**
    - one muted facts line (Ø Leistung, Ø Puls, Belastung, "geschafft 100 %");
    - the debrief sentence;
    - a small inline SVG chart (power line in accent, heart rate muted, no axis numbers except start and end time);
    - no new deps.
  - Read-only: no bike controls here.
- **Heute:** on a day whose plan or advice says bike, the today card shows the bike session name and minutes, with a button "Ansehen", which opens Ausdauer › Rad.
- **Woche:** the day rows already show bike from the week plan. When a ride was done that day, show "· gefahren" (from the `ride` records).

### Day ratings and chat

- **Web ratings:** `useTodayAdvice` merges bike days from the `ride` records (`rateIntensity` of the stored hardness and minutes), so the own advice knows rides even without a fresh published advice. That closes parking item F.
- **Week chat data:** add `radFahrten`, the last 5 rides as `{datum, name, minuten, haerte}`, plus `rad: {ftp, phase}` to its data block (`sessionsOf`/`dataBlock`).
  - Bike wishes keep going through tasks (already working).
  - The Regeln sheet shows them as "für Rad" (check the label mapping).

## Tasks

### Task 1: Publish the `bike` and `ride` records

**Files:**
- `src/shared/records.ts`, `validate.ts`;
- new `src/shared/bike.ts` (types, readers, block merge, downsample);
- `src/coach/runtime.ts` / a new `src/coach/tracking/bike-export.ts`;
- tests.

**Tests:**
- blocks merge repeats;
- the curve has ≤ 150 points;
- records are written on change only;
- a replaced ride updates its record;
- a removed ride is tombstoned;
- validation limits.

Commit: `feat(bike): the server publishes the bike plan and rides for the web`.

### Task 2: The Ausdauer tab and BikeScreen

**Files:** `src/web/App.tsx`, `src/tracking/ui/BikeScreen.tsx` (new), `RunScreen` wiring, `scripts/web-shots.ts` (seed `bike` + `ride` records; shots `rad`, `rad-aufbau`, `rad-fahrt`, `rad-entwicklung`, `ausdauer-umschalter`), tests.

**Tests:**
- tab visibility rules;
- the segmented switch;
- the next card and the Aufbau sheet;
- the ride sheet with the chart;
- the Fahrten list grouped by month;
- the alias 'laufen'.

The shots must render; look at them.

Commit: `feat(bike): see the bike plan and rides in the web app`.

### Task 3: Heute, Woche, ratings and chat know rides

**Files:** `frame-hooks.ts`, `TodayCard.tsx`, the CoachScreen week rows, `src/coach/chat/chat-coach.ts` + `runtime.ts` `sessionsOf`, tests.

**Tests:**
- own advice after a hard ride yesterday says no hard legs today;
- the Heute bike card opens Rad;
- the Woche "gefahren" mark;
- the chat data block contains the last rides.

Commit: `feat(bike): today, week and the coach chat know your rides`.

### Task 4: Independent UX review of the new screens

- A fresh reviewer (`.superpowers/sdd/2026-11-07-milestone-l-calm-ui/REVIEW-BRIEF.md` pattern, after folder `/private/tmp/claude-501/web-shots-o/`) scores the Rad screens.
- Fix findings below 7.

Commit: `fix(bike): review findings`.
