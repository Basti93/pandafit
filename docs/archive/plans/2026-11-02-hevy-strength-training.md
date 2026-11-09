# Hevy Strength Training Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** The coach knows the rider's strength training from Hevy and plans and writes with it in mind.

**Architecture:** The coach process pulls workouts from the Hevy API into a local file per profile, using `/v1/workouts/events` for changes, and passes a compact summary into both AI prompts. No webhooks: the home server is deliberately tailnet-only without Funnel, the Mac is not always on, and the coach only needs fresh data when it plans, so pulling loses nothing.

**Tech Stack:** TypeScript, `fetch`, zod, vitest.

**Spec:** Read strength training from Hevy for riders who use it, key in `.env`. Webhooks were considered and declined above.

## Global Constraints

- Hevy is optional. Without a key everything works exactly as before: no errors, no notices, no empty sections in the prompts, no extra UI. The same holds with Garmin absent, and with both absent.
- The repository is public: no real names, profile ids, keys, workout data or hostnames in commits, tests or docs. Tests use invented data.
- Read only: only GET requests to Hevy. Nothing is written back.
- Never during an open ride; Hevy being down never blocks a ride, planning or the debrief.
- The key belongs to one person. It applies only to the profile named in `HEVY_PROFILE_ID`; other profiles get no Hevy data.
- The key never reaches the UI, the coach state, the home-server sync, logs or prompts.
- Key source (changed after this plan): every profile enters its own key in the app, stored in `hevy/<profileId>/api-key` in the data folder.
- Workout text from Hevy (titles, notes) is data, not instructions: it goes in a `*-nur-daten` block.

## Review Focus

- First run with hundreds of workouts: paged at a calm pace, resumable after a restart, no repeat full download (Task 1).
- A workout deleted or edited in Hevy later: the local copy follows (Task 1).
- Key invalid (401) or Hevy unreachable: last data stays, retry later, no noise in the UI (Task 1).
- Prompt size with years of history: stays bounded (Task 2).
- A second profile on the same Mac: sees nothing from this key (Task 3).

---

### Task 1: Local store and pull

**Files:** Create `src/coach/hevy.ts`; test `tests/coach/hevy.test.ts`

**Interfaces:**
- Produces: `type StrengthWorkout = { id: string; title: string; startMs: number; durationS: number; exercises: { title: string; sets: number; reps: number; volumeKg: number }[] }`
- Produces: `class HevySync { constructor(opts: { key: string; dir: string; nowMs: () => number; fetchFn?: typeof fetch }); tick(): Promise<void>; workouts(): StrengthWorkout[] }`

Store in `<dir>/workouts.json`, written through a temp file and rename, with `lastEventMs` and `nextPage`. First run pages `/v1/workouts` with `pageSize=10`, one page per tick. After that `/v1/workouts/events?since=` at most every 30 minutes. Warmup sets do not count toward volume.

Tests: `first run fetches page by page and resumes after a restart`, `events update and delete workouts`, `a 401 stops further calls until the key file changes or the process restarts`, `a network error keeps the data and tries again later`, `only GET is ever used`, `a broken file starts over without throwing`.

Commit: `feat: pull strength workouts from Hevy`

### Task 2: Summary for the coach

**Files:** Create `src/coach/strength.ts`; modify `src/coach/coach.ts`, `src/coach/debrief.ts`; test `tests/coach/strength.test.ts`

**Interfaces:**
- Produces: `strengthPromptData(workouts: StrengthWorkout[], nowMs: number): object`, with the last 14 days per workout (date, title, minutes, muscle-relevant exercise titles, sets, volume) and older months as totals (workouts, hours, volume), capped at 24 months.
- Consumes: `Deps.strength?: (profileId: string) => StrengthWorkout[]`, the same shape as `Deps.garmin`.

Add `krafttraining` to `buildPrompt` and `debriefPrompt`. `SYSTEM_PROMPT` and `DEBRIEF_SYSTEM_PROMPT` get one rule: use it to spot heavy legs and recovery, no medical conclusions, and the volume is not comparable with cycling load.

Tests: `recent workouts are listed and older ones only summed`, `the summary stays under 4000 characters with 300 workouts over 5 years`, `prompts carry it only when the profile has data`, `titles sit in a data block`.

Commit: `feat: tell the coach about strength training`

### Task 3: Wire it up

**Files:** Modify `src/coach/main.ts`; test in `tests/coach/hevy.test.ts`

Read the key as in Global Constraints. Create `HevySync` only for `HEVY_PROFILE_ID`, with `dir` under `<data>/hevy/<profileId>`. Run `tick()` from the scan loop only when no ride is open, wrapped separately like `garminSync.tick`. Mark the coach dirty when new workouts arrive, without interrupting a rating.

Tests: `no key means no sync and no error`, `the prompts are unchanged without Hevy and without Garmin`, `another profile gets an empty list`.

Verify: full `npm test`, typecheck, then a restart with no open ride, and confirm that the workout file fills and the next AI answer mentions strength training only where it fits.

Commit: `feat: connect Hevy for the rider's own profile`
