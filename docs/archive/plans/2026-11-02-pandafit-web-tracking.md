# Pandafit Tracking, Web App and Mobility Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Strength training and mobility work without Hevy, logged on the phone (installable PWA) and in the Mac app, with a small login-protected server for two people.

**Architecture:** All tracked data is one kind of versioned record, kept in a local store on each device and synced with one small protocol. The Mac's coach process reads its local store and keeps planning with AI; the server only stores records per account. The PWA has its own build and shares tracking logic and screens with the Mac app.

**Tech Stack:** TypeScript, React, Vite, vitest; server: Fastify and `node:sqlite` as in `server/`; `fake-indexeddb` as a dev dependency for tests; no PWA plugin, a small hand-written service worker.

**Spec:** `docs/archive/specs/2026-11-02-pandafit-web-tracking-design.md`

## Global Constraints

- A ride is never lost. No Hevy call, AI call or sync from the Mac during an open ride. `src/service/**` stays untouched.
- A workout in progress is never lost: every change is stored locally before anything else.
- Optional: with no linked account and no Hevy, a profile sees everything as today. Each integration has a test for "not there". Hevy keys never leave the Mac.
- The Mac app keeps its data folder `bike-coach`, bundle id and package name.
- Only two accounts, created by a server command. There is no registration route.
- Each person sees only their own data. Without login, only the login page, static files and `/healthz` answer.
- Limits in `src/coach/gym/limits.ts` and `checkWorkout` apply to every AI plan. The bike coach never creates strength workouts; both coaches may suggest mobility.
- Mobility makes no promise of quicker recovery or fewer injuries, and never goes to Hevy or Garmin.
- German text without guilt, pressure, streaks, comparisons between people, or medical conclusions. Decimal comma.
- Public repo: invented test data; no names, hostnames, tokens or real values in commits.

## Review Focus

- The phone locks, the tab is killed or the network drops mid-workout: on reopening the workout is there, with every set (Tasks 5, 9).
- The same record sent twice, or an old device syncing after a newer change: no duplicates, the newest stays, and the overwritten copy is kept (Tasks 1, 7).
- A session cookie or device token of person A asking for records of person B on every route: refused (Task 7).
- A new PWA version arriving during a workout: no reload until it is finished (Task 9).
- A rider with long Hevy history and new own workouts: one performed workout counts once, and last values come from the newest of both (Tasks 1, 3).

---

### Task 1: Records and merged history

**Files:** Create `src/shared/records.ts`, `src/coach/tracking/merge.ts`, `src/shared/exercises.ts`; test `tests/shared/records.test.ts`, `tests/coach/tracking/merge.test.ts`

**Interfaces:**
- Produces: `type RecordKind = 'workout' | 'routine' | 'exercise' | 'mobility' | 'complaint' | 'plan'`; `type TrackedRecord = { kind: RecordKind; id: string; updatedMs: number; deleted: boolean; body: unknown }`.
- Produces: `applyRecord(current: TrackedRecord | undefined, incoming: TrackedRecord): { keep: TrackedRecord; overwritten: TrackedRecord | null }`. Newer `updatedMs` wins; a tie is broken by the greater JSON text so every device agrees.
- Produces: `type LoggedSet = { type: 'warmup' | 'normal' | 'failure' | 'dropset'; weightKg: number | null; reps: number | null; durationS: number | null; doneMs: number | null }`, `type LoggedExercise = { exerciseId: string; title: string; supersetId: number | null; notes: string; sets: LoggedSet[] }`, `type LoggedWorkout = { id: string; title: string; startMs: number; endMs: number | null; source: 'pandafit' | 'hevy'; exercises: LoggedExercise[] }`.
- Produces: `EXERCISES: ExerciseTemplate[]` with about 100 entries (`id` such as `pf-squat`, German title), and `hevyId?: string` where known; `toStrengthWorkout(w: LoggedWorkout): StrengthWorkout`; `mergeHistory(own: StrengthWorkout[], hevy: StrengthWorkout[]): StrengthWorkout[]`.

- [ ] **Step 1: Write failing tests:** `the newer record wins and returns the overwritten one`, `the same record twice changes nothing`, `an older record never replaces a newer one`, `a tie ends the same in either order`, `a deleted record stays as a tombstone`, `a Pandafit workout overlapping a Hevy one by at least half counts once and Pandafit wins`, `back-to-back workouts both stay`, `an open workout is left out of the history`, `warmup sets do not count toward volume`, `exercise ids are unique and each has a known type, muscle and equipment`, `every Hevy id in the list matches one exercise`.
- [ ] **Step 2: Run** `npx vitest run tests/shared/records.test.ts tests/coach/tracking/merge.test.ts`. Expected: FAIL.
- [ ] **Step 3: Implement.** Only rep-based types are used in the list, plus a few timed ones for tracking, using `isRepBased` semantics from `src/coach/gym/history.ts`.
- [ ] **Step 4: Run** it. Expected: PASS.
- [ ] **Step 5: Commit** `feat: add tracked records, own exercises and a merged history`.

### Task 2: Local store on the Mac

**Files:** Create `src/coach/tracking/store.ts`; test `tests/coach/tracking/store.test.ts`

**Interfaces:**
- Produces: `class RecordStore { constructor(opts: { dir: string }); put(profileId: string, r: TrackedRecord): void; all(profileId: string, kind?: RecordKind): TrackedRecord[]; changedSince(profileId: string, cursor: number): { records: TrackedRecord[]; cursor: number }; }`, in `<data>/coach/tracking/<profileId>.json`, written through a temp file and rename.

- [ ] **Step 1: Write failing tests:** `a put survives a restart`, `a broken file starts empty and keeps the broken file aside`, `profiles do not see each other`, `changedSince returns only later local changes`, `a crash between temp file and rename keeps the old data`.
- [ ] **Step 2: Run.** Expected: FAIL.
- [ ] **Step 3: Implement,** using `encodeURIComponent` for profile ids as `src/coach/gym/state.ts` does.
- [ ] **Step 4: Run.** Expected: PASS.
- [ ] **Step 5: Commit** `feat: keep tracked records on the Mac`.

### Task 3: The gym coach without Hevy

**Files:** Modify `src/coach/gym/gym-coach.ts`, `src/coach/gym/public.ts`, `src/coach/main.ts`, `src/ui/views/CoachView.tsx`, `src/ui/views/GymView.tsx`, `src/ui/App.tsx`; test `tests/coach/gym/own-history.test.ts`

**Interfaces:**
- Consumes: `mergeHistory`, `EXERCISES`, `RecordStore`.
- Produces: `gymPublic` takes `enabled: boolean` in place of the Hevy status. `enabled` is true with Hevy connected, a linked account, or a finished own workout. `GymPublic` gains `hevy: boolean`. A new action on the bike page, "Krafttraining starten", enables it for a profile by writing a local flag, so a person with neither can begin.

- [ ] **Step 1: Write failing tests:** `a profile with neither sees no gym`, `after enabling it plans from own exercises with no Hevy call`, `an own workout changes the next suggestion`, `with Hevy the merged history is used`, `"Nach Hevy" is not offered without Hevy`, `removing Hevy keeps own workouts and imported ones`, `a Hevy export leaves out an exercise without a Hevy id and the preview says so`, `the overview's home screen rule holds for an enabled profile`.
- [ ] **Step 2: Run.** Expected: FAIL.
- [ ] **Step 3: Implement.** `templates` returns `EXERCISES` plus own `exercise` records, plus Hevy's list when connected, with Hevy ids mapped to one entry. Imported Hevy workouts are also written to the store as `workout` records with `source: 'hevy'` and the Hevy id as `id`.
- [ ] **Step 4: Run** `npm test && npm run typecheck`. Expected: PASS.
- [ ] **Step 5: Commit** `feat: let the gym coach plan without Hevy`.

### Task 4: Mobility

**Files:** Create `src/coach/mobility/exercises.ts`, `src/coach/mobility/mobility.ts`, `src/ui/views/MobilityCard.tsx`; modify `src/coach/main.ts`, `src/coach/coach.ts`, `src/coach/gym/prompt.ts`, `src/shared/coach-protocol.ts`, `src/ui/views/CoachView.tsx`, `src/ui/views/GymView.tsx`; test `tests/coach/mobility/mobility.test.ts`, `tests/ui/mobility-card.test.tsx`

**Interfaces:**
- Produces: `MobilitySession = { id: string; forSession: 'bike' | 'strength'; minutes: number; exercises: { id: string; title: string; howTo: string; area: string }[]; reason: string }`.
- Produces: `suggestMobility(input: { nowMs: number; lastRideMs: number | null; lastStrengthMs: number | null; lastMobilityMs: number | null; complaints: Complaint[]; usedMuscles: string[] }): MobilitySession | null`. It returns a session only if a bike or strength session ended within the last 24 hours and no mobility was done within 2 days.
- Produces messages: `{ type: 'mobility-done'; profileId; sessionId }`, `{ type: 'mobility-feel'; profileId; text }`; `coach-state` gains `mobility?: { session: MobilitySession | null; askFeel: boolean } | null`.

- [ ] **Step 1: Write failing tests:** `after a ride it offers hips, back of the thigh, calves and chest`, `after strength it focuses on the muscles used`, `none within 2 days of the last one`, `no session means no offer`, `3 to 5 exercises and 5 to 10 minutes`, `an open knee complaint leaves out that area, with no diagnosis`, `skipping leaves no debt`, `"Gemacht" stores a mobility record`, `asks about feeling once about every 6 weeks of use`, `the text never claims recovery or injury prevention`, `the coaches' prompts carry recent mobility as data`, `the AI text cannot pick an exercise outside the list`.
- [ ] **Step 2: Run.** Expected: FAIL.
- [ ] **Step 3: Implement.** The session is rule-based; the existing coach prompts only mention it. The list has 10 to 14 calm, mainly static stretches with short German descriptions.
- [ ] **Step 4: Run** `npm test && npm run typecheck`. Expected: PASS.
- [ ] **Step 5: Commit** `feat: offer mobility after a session`.

### Task 5: Tracking logic and screens

**Files:** Create `src/tracking/session.ts`, `src/tracking/ports.ts`, `src/tracking/ui/WorkoutScreen.tsx`, `RoutinesScreen.tsx`, `HistoryScreen.tsx`, `ExercisePicker.tsx`, `tracking.css`; test `tests/tracking/session.test.ts`, `tests/tracking/screens.test.tsx`

**Interfaces:**
- Produces: `type TrackingPort = { list(kind: RecordKind): Promise<TrackedRecord[]>; put(r: TrackedRecord): Promise<void>; subscribe(fn: () => void): () => void; syncState(): { pending: number; lastOkMs: number | null } }`.
- Produces pure functions: `startFromPlan(w: GymWorkout, history, nowMs, id): LoggedWorkout`, `startFromRoutine`, `startEmpty`, `confirmSet(w, ex, set, nowMs)`, `editSet`, `addExercise`, `removeExercise`, `swapExercise`, `addSet`, `removeSet`, `finish(w, nowMs)`, `lastValues(exerciseId, history): LoggedSet[]`.

- [ ] **Step 1: Write failing tests:** `prefills last values, with weight empty when there are none`, `plan values win for a planned exercise`, `confirming marks the set done and starts the rest timer`, `an exercise can be swapped and what happened counts`, `finish without confirmed sets asks first and never deletes silently`, `every action calls put before the UI updates`, `reopening with an open workout offers to continue it`, `the rest timer survives a reload through its stored start`, `shows 62,5 kg`, `past workouts can be edited and deleted`, `a routine can be created, edited and started`, `custom exercises can be added`, `shows calmly that a finished workout is not on the server yet`.
- [ ] **Step 2: Run.** Expected: FAIL.
- [ ] **Step 3: Implement.** Screens only use `TrackingPort`, with large touch targets. The screen wake lock is requested while a workout runs, ignoring failures.
- [ ] **Step 4: Run** `npm test && npm run typecheck`. Expected: PASS.
- [ ] **Step 5: Commit** `feat: add workout tracking screens`.

### Task 6: Tracking in the Mac app

**Files:** Modify `src/coach/main.ts`, `src/shared/coach-protocol.ts`, `src/ui/useCoach.ts`, `src/ui/views/GymView.tsx`, `src/ui/App.tsx`; create `src/ui/coachTrackingPort.ts`; test `tests/ui/mac-tracking.test.tsx`

**Interfaces:**
- Consumes: `TrackingPort`, `RecordStore`.
- Produces messages: `{ type: 'records-put'; profileId; record }`, `{ type: 'records-list'; profileId; kind }`, server `{ type: 'records'; kind; records }` and `{ type: 'records-changed'; profileId }`.

- [ ] **Step 1: Write failing tests:** `a set reaches the store before the UI confirms`, `a lost socket queues puts in localStorage and replays them`, `a finished workout marks the gym coach dirty`, `an open ride shows RideView and does not start planning from it`, `a malformed record is refused`.
- [ ] **Step 2: Run.** Expected: FAIL.
- [ ] **Step 3: Implement.** Add "Training starten" to `GymView`.
- [ ] **Step 4: Run** `npm test && npm run typecheck`. Expected: PASS.
- [ ] **Step 5: Commit** `feat: track workouts in the Mac app`.

### Task 7: The server

**Files:** Create `web-server/package.json`, `web-server/index.ts`, `web-server/db.ts`, `web-server/auth.ts`, `web-server/cli.ts`; test `tests/web-server/api.test.ts`, `tests/web-server/auth.test.ts`

**Interfaces:**
- Consumes: `TrackedRecord`, `applyRecord`.
- Produces: `buildServer(opts: { dbPath: string; staticDir?: string; nowMs?: () => number; trustProxyCidr?: string }): FastifyInstance`.
- Routes: `POST /login {name, password}` sets the cookie; `POST /logout`; `POST /device-token {name, password, deviceName}` returns a token; `POST /records {records}` returns `{ accepted: number }`; `GET /records?since=<cursor>` returns `{ records, cursor }`; `GET /me`; `GET /healthz`.
- CLI: `create-account --name <name>` (reads the password from stdin), `set-password`, `list-devices`, `revoke-device --id <id>`.

- [ ] **Step 1: Write failing tests:** `no route answers without login except login, static files and healthz`, `there is no registration route`, `person A cannot read or overwrite records of person B on any route`, `the same id from two accounts stays separate`, `a repeated send creates no duplicate`, `an older send does not win and the overwritten copy is kept`, `passwords are stored with scrypt, never in plain text`, `the cookie is HttpOnly, Secure and SameSite=Strict and lasts 90 days, renewed on use`, `10 failed logins per IP or account within 15 minutes are refused for 15 minutes, with the same answer for an unknown name`, `X-Forwarded-For is trusted only from the proxy network`, `a revoked token no longer works`, `tokens are stored hashed`, `a body over 5 MB or a malformed record is refused`, `a third account cannot be created without the command`.
- [ ] **Step 2: Run** `npx vitest run tests/web-server`. Expected: FAIL.
- [ ] **Step 3: Implement.** The cursor is a per-account sequence number. Cookie and token resolve to an account id, and every query is bound to it. Records are size-limited, with the body stored as JSON and validated for kind and shape.
- [ ] **Step 4: Run** it, then `npm run typecheck`. Expected: PASS.
- [ ] **Step 5: Commit** `feat: add the Pandafit server`.

### Task 8: Sync and linking on the Mac

**Files:** Create `src/tracking/sync.ts`, `src/coach/tracking/link.ts`, `src/ui/views/AccountCard.tsx`; modify `src/coach/main.ts`, `src/coach/gym/gym-coach.ts`, `src/shared/coach-protocol.ts`, `src/ui/views/CoachView.tsx`; test `tests/tracking/sync.test.ts`, `tests/coach/tracking/link.test.ts`

**Interfaces:**
- Produces: `syncRecords(opts: { local: { changedSince(cursor: number): Promise<{ records: TrackedRecord[]; cursor: number }>; apply(r: TrackedRecord): Promise<void> }; send: (rs: TrackedRecord[]) => Promise<void>; fetchSince: (cursor: number) => Promise<{ records: TrackedRecord[]; cursor: number }>; cursors: { get(): Promise<{ sent: number; received: number }>; set(c: { sent: number; received: number }): Promise<void> } }): Promise<void>`, shared by Mac and PWA.
- Produces: `class AccountLinks { link(profileId, url, name, password): Promise<void>; unlink(profileId): void; status(profileId): { state: 'idle' | 'linked' | 'rejected'; name: string | null }; token(profileId): string | null }`, stored in `<data>/accounts/<profileId>`. The password is never stored.

- [ ] **Step 1: Write failing tests:** `sends local changes and fetches remote ones`, `a failure keeps the cursors and retries`, `a remote record does not get sent back forever`, `no sync during an open ride`, `no account means no call and no error`, `a rejected token shows calmly and stops calling`, `the token never reaches coach state, logs or prompts`, `imported Hevy workouts are sent, the Hevy key is not`, `the plan and open complaints go to the server as records`, `a complaint added or closed on the phone reaches the bike coach and the gym coach`, `a mobility session done on the phone counts on the Mac`.
- [ ] **Step 2: Run.** Expected: FAIL.
- [ ] **Step 3: Implement.** Sync runs from the scan loop, separately guarded, when no ride is open, at most once a minute and after a local change.
- [ ] **Step 4: Run** `npm test && npm run typecheck`. Expected: PASS.
- [ ] **Step 5: Commit** `feat: sync tracked data between Mac and server`.

### Task 9: The installable web app

**Files:** Create `src/web/index.html`, `src/web/main.tsx`, `src/web/App.tsx`, `src/web/idbStore.ts`, `src/web/webPort.ts`, `src/web/sw.ts`, `src/web/manifest.webmanifest`, `src/web/icons/*`, `vite.web.config.ts`; modify `package.json`; test `tests/web/idb-store.test.ts`, `tests/web/app.test.tsx`, `tests/web/sw.test.ts`

**Interfaces:**
- Consumes: `TrackingPort`, screens, `syncRecords`, the server's routes.
- Produces: `npm run build:web`, which writes to `out/web`, and pages Heute (plan, note, mobility card, open complaints), Training, Verlauf, Abmelden.

- [ ] **Step 1: Write failing tests:** `records survive closing the database`, `a set is in IndexedDB before the UI confirms`, `login failure shows a calm message`, `offline after the first load the app and an open workout work`, `sync resumes on coming back online`, `an expired login keeps unsent data and asks to log in again`, `a new service worker waits while a workout is open and activates afterwards`, `the plan shows its date and says calmly when it is older than a week`, `storage persistence is requested`, `the install hint shows once on iPhone in the browser and never when installed`, `Hevy, Garmin and ride pages are not part of the web build`.
- [ ] **Step 2: Run.** Expected: FAIL.
- [ ] **Step 3: Implement.** The manifest sets name `Pandafit`, `display: standalone`, and German language, with a panda icon drawn as SVG and exported to 192, 512 and an iOS apple-touch icon. The service worker caches the static build only, never API answers. Never import from `src/service`, `src/main` or Electron.
- [ ] **Step 4: Run** `npm run build:web && npm test && npm run typecheck`. Expected: PASS.
- [ ] **Step 5: Commit** `feat: add the installable web app`.

### Task 10: Deployment files

**Files:** Create `web-server/Dockerfile`, `web-server/compose.yaml`, `web-server/serve.json`, `web-server/.env.example`, `web-server/backup.sh`, `web-server/restore-drill.sh`, `web-server/mac/install-pull.sh`, `web-server/mac/pull-backups.sh`, `web-server/README.md`; test `tests/web-server/deploy-files.test.ts`

Compose project and node `pandafit`, on the free port listed in `~/SERVER.md`, `127.0.0.1` only. Follow `server/compose.yaml` and the Dog Territory pattern: own Tailscale sidecar in userspace mode, `tailscale/tailscale:v1.76.1`, `AllowFunnel` true, `read_only`, `cap_drop: [ALL]`, `no-new-privileges`, `pids_limit`, `mem_limit` 256m for the API and 128m for Tailscale, log rotation 3 x 10 MB, data in one volume, and no `env_file`.

- [ ] **Step 1: Write failing test:** `the sync compose still has no Funnel and the new one has its own node`, `no secret or host name appears in the deploy files`, `the API container has read_only, no capabilities and only a localhost port`.
- [ ] **Step 2: Run.** Expected: FAIL.
- [ ] **Step 3: Write the files.** The README covers the first start, disabling key expiry, the `funnel` ACL attribute, adding lines to `SERVER.md` before starting, checking the client IP, accounts, the backup cron, a restore drill and the kill switch.
- [ ] **Step 4: Run** `docker compose -f web-server/compose.yaml config -q` with dummy values and the test. Expected: PASS.
- [ ] **Step 5: Commit** `feat: add deployment for the Pandafit server`.

### Task 11: Roll out

- [ ] **Step 1:** Confirm that no ride is open. Merge to `main` and restart the app. Check a profile without account or Hevy, using a screenshot.
- [ ] **Step 2:** Stop and show the rider what will be exposed. With their confirmation, deploy: read `~/SERVER.md` first, follow `web-server/README.md`, and use the Tailscale CLI where allowed. If the console is needed for the auth key or key expiry, ask the rider to do that step.
- [ ] **Step 3:** Check from outside the tailnet: `/healthz` answers, and `/records` without login gives 401. Confirm with `tailscale funnel status` that only the new node is public and the sync node is not.
- [ ] **Step 4:** The rider creates both accounts by entering passwords themselves, then logs in on a phone, installs the PWA, logs a test workout, goes offline during it, kills the app, reopens it, and finishes. Confirm it reaches the Mac and the coach.
- [ ] **Step 5:** Run one backup and a restore drill. Update `docs/after-ride.md` and `README.md` with what stayed open.
