# Pandafit Coach on the Home Server Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** The bike coach, strength coach, mobility and meal plan run in a `coach` container on the home server with all data there, and the Mac and phone become clients, while a profile not linked to an account works exactly as today.

**Architecture:** `src/coach/main.ts` is split into a runtime factory that the Mac and the server both use. On the server, one coach process holds a household of account runtimes, each with its own data folder laid out like the Mac's. The public `api` container authenticates the account and passes the existing coach WebSocket protocol, plus two bulk HTTP routes for rides and the migration, through to the `coach` container on an internal network. The Mac's coach process, not its UI, decides per profile whether to use the local coach or the server coach. It caches the server state and queues writes while offline.

**Tech Stack:** TypeScript, Node 24, vitest, Fastify 5 and `ws` (both already in the repo), `node:sqlite`, `node:crypto` AES-256-GCM, Python 3 with `garminconnect==0.3.20`, the Claude CLI, and Docker Compose.

**Spec:** `docs/archive/specs/2026-11-03-server-coach-design.md`

## Global Constraints

- Top rule: A ride is never lost. "Recording, saving and recovery stay local on the Mac exactly as today; upload happens after the ride, retried until confirmed, and the local copy stays."
- "nothing of this runs or uploads during an open ride on the Mac."
- Never: "Secrets or health data are readable from the internet without a login, or by the other account."
- Never: "The app stops working when the server or the Claude login is down: the Mac still records, and the existing rule-based planning covers the gap."
- "Public repo: no names, tokens, hostnames or real data in commits, tests or docs."
- "Hevy and Garmin stay optional; each has a test for "not there"."
- "`src/service/**` is not changed except what the upload of finished rides needs, and never while a ride is open." This plan needs no change there. `src/main/**` stays untouched as well.
- "Memory: the home server is tight (see `~/SERVER.md`); the coach container gets a limit, and Claude runs one at a time."
- "Backups: the coach volume is backed up daily alongside the existing backup, encrypted secrets stay encrypted in the backup, and the restore drill covers it."
- Container: "own memory limit, no published port, no Funnel, read-only root, no capabilities, `restart: unless-stopped`, heavy runs not between 02:00 and 06:00."
- Secrets: "stored encrypted (AES-256-GCM)", key `PANDAFIT_SECRET_KEY` from the server's `.env` ("generated at setup, mode 600"), "Secrets are write-only from the clients", "They never appear in logs, prompts, records or backups pulled to the Mac in clear."
- "The coach container starts with a 768 MiB limit, runs one Claude call at a time across all coaches, and keeps Garmin and Hevy syncs out of Claude runs." Measure, "staying inside the 2 GiB".
- "no automatic upload without confirmation before" (Garmin).
- "A profile not linked to an account keeps working fully locally, exactly as today."
- "A local fallback plan is never sent; the server's plan replaces it."
- "one account never reads the other's rides, health data, notes, complaints or secrets."
- From `CLAUDE.md`: no `npm install`, `npm run app` or coach restart while a ride is open.
- German text without guilt or pressure, with a decimal comma.

## Review Focus

- The server is down or Claude is logged out right before a ride: the ride starts at once with the cached session and FTP, the screen says which session it is, and nothing waits for the network (Task 9: `offline: coach-state comes from the cache, marked online false and session cached`, `offline without a cache: the next session is the local rule session, marked rules`; Task 11: `start uses the cached session and FTP when offline`).
- Account A's login, or a message carrying B's profile id, reaches B's coach, rides, migration or health data: it is refused everywhere (Task 4: `a message for another profile id is refused and changes nothing`; Task 7: `account A cannot reach account B's coach data on any coach route`).
- A migration is cut off (the Mac sleeps, the network drops, a ride starts) and later resumed: nothing is duplicated, and the profile switches only once counts and hashes match (Task 6: `finish lists what is missing or differs and switches nothing`; Task 10: `a cut-off migration resumes and skips what the server already has`).
- A complaint is changed on the phone while an older change to the same complaint waits in the Mac's offline queue: the newer change stays (Task 4: `queued: a change older than the item's last change is skipped`).
- A ride closes while the server is down, or an upload is sent twice: it arrives later exactly once, the local files stay byte for byte, and an open ride is never sent (Task 5: `the same upload twice answers same: true and writes nothing`; Task 10: `an open ride is never uploaded; a discarded one neither`, `a failed upload retries on a later run`).

## Rulings (builder's calls the spec leaves open)

1. **api↔coach protocol.** The coach speaks the existing `CoachClientMessage`/`CoachServerMessage` over a WebSocket. The api exposes it at `GET /coach`, authenticated by device token or session cookie, with an Origin check for cookies. It opens one connection per client to `ws://coach:8090/ws` and sets `x-pandafit-internal: <PANDAFIT_INTERNAL_TOKEN>` and `x-pandafit-account: <id>`, so the account always comes from the login and never from the client. Bulk data goes over HTTP under `/coach/*` and is passed through as raw bytes; the api never parses coach bodies. Protocol additions: client `profile-update` and `queued`, and `coach-state` gains `profile?` and `coachHome?`. The Mac and, later, the phone talk the same protocol. The phone itself is unchanged in this plan: it already works from records the server coach now writes.
2. **Multi-tenant coach.** There is one Node process. A `Household` holds one `CoachRuntime` per moved account. Each runtime gets its own data root `/data/accounts/<accountId>/` with the Mac's layout (`rides/`, `coach/`, `garmin/`, `hevy/`), so the existing classes run unchanged. An account has exactly one profile. Its id is the Mac profile id, bound at the first migration call, and every message's `profileId` must equal it. The meal plan (`/data/household/meals`) and the together page are household-level and return only their combined result.
3. **Records stay owned by the api database.** The server coach syncs each account's `RecordStore` with the api through the unchanged `AccountSync`, pointed at internal routes `GET|POST /internal/accounts/:id/records` on a second, unpublished api listener (`:8081`). This is how the plan, complaints and meal plans reach the phone. The meal-plan push fires through the existing new-meal-week trigger, so "the coach calls the api" is a record write.
4. **Ride upload format.** The body is one JSON document `RideUpload`, holding the four recorder files as text (`meta.json`, `session.json`, `samples.jsonl`, `events.jsonl`), the FIT file as base64 when the Mac has one, and a SHA-256 over the four texts. The server stores the ride in the recorder layout, so `Coach.scanRides` reads it unchanged, and builds the FIT itself with `exportFit` when none came. Only `finished` and `aborted` rides are sent. The Mac's coach process reads the ride files, so `src/service/**` does not change.
5. **Secrets module.** `src/coach/secrets/secret-box.ts` uses AES-256-GCM with a random 12-byte IV, stored as `pfs1.<iv>.<tag>.<ciphertext>` in base64url. The additional authenticated data is `"<accountId>:<kind>"`, so a sealed file copied to the other account does not open. `PANDAFIT_SECRET_KEY` must be 64 hex characters, and the coach refuses to start without it. Only the `coach` service gets this variable. Garmin tokens stay sealed at rest. They are decrypted into tmpfs `/run/pandafit-secrets/<profileId>/` only while a Python run lasts, then sealed back and wiped. On the Mac both default to plain, as today.
6. **Garmin bridge in the image.** The image has `python3` and a venv at `/opt/garmin-venv` with `garminconnect==0.3.20`, and `scripts/garmin/*.py` is copied to `/app/scripts/garmin`. The runtime takes the `python` path and the scripts folder as options.
7. **Migration.** It runs from the Mac's scan with no ride open: snapshot, `begin` (manifest with hashes; the server answers what it already has), items and rides, a fresh hash of the live items, then `finish`. The server switches only when every item and ride hash matches, and it answers with counts. Records are not migrated. The switch waits until `AccountSync` has nothing unsent. The meal plan moves last, in one step, once every person in the Mac's meal plan has moved.
8. **Switch on the Mac.** The switch lives in the Mac's coach process. A profile uses the server when it is linked and `<coachDir>/remote/<profileId>/moved.json` exists; otherwise it is local and unchanged. The local runtime coaches only local profiles, so nothing runs twice. The remote client caches the last `coach-state` on disk. It queues writes (in a file, in order, each with its time) while offline or while a ride is open, and the server applies them through a per-item change clock: last change wins. Unlinking removes the marker and the profile is local again.
9. **Profile values.** The server keeps `profile.json` per account, and `coach-state.profile` carries it with `ftpW` from the coach state. The Mac UI writes server values into the ride service through the existing `save-profile` message, only with no ride open. Mac edits go out as `profile-update`. The ride itself starts from the cached `coach-state` (session and FTP), as today.
10. **Container.** The `coach` service has `mem_limit: 768m`, `cpus: 1.0`, `pids_limit: 256`, `read_only`, `cap_drop: [ALL]`, `no-new-privileges`, `restart: unless-stopped`, no `ports`, and tmpfs for `/tmp` and `/run/pandafit-secrets`. It uses volume `pandafit_coach` (mounted only by `coach`) and `HOME=/data/home` for the Claude login. Networks: `internal` (`internal: true`, shared with `api`) plus `default` for Claude, Hevy and Garmin. Quiet hours (02:00 to 06:00, container `TZ`) pause scan-driven runs only; a message from a person still gets its answer.
11. **Backups.** `backup-coach.sh` runs daily next to `backup.sh`. It `VACUUM INTO`s each Garmin database, then makes `pandafit-coach-<ts>.tar.gz` (kept 14 days) without the Claude login, the WAL files or `work/`. It refuses to keep a copy holding a secret file that does not start with `pfs1.`. `restore-drill-coach.sh` unpacks into a throwaway volume, starts the image with `--network none -e PANDAFIT_COACH_DRY=1`, and compares counts.
12. **The old `server/` sync node** stays as an extra ride backup, untouched.
13. **Order.** Tasks 1 and 2 are refactors whose defaults keep the Mac identical. Tasks 3 to 8 touch only the server. Tasks 9 to 11 change the Mac behind the `moved.json` marker, which only a finished migration writes.

---

### Task 1: One coach runtime for Mac and server

**Files:** Create `src/coach/runtime.ts`; modify `src/coach/main.ts`, `src/coach/tracking/link.ts`, `src/coach/tracking/mac-sync.ts`, `src/shared/coach-protocol.ts`; test `tests/coach/runtime.test.ts`, existing `tests/coach/coach-process.test.ts`

**Interfaces:**
- Produces in `coach-protocol.ts`: `type CoachStateMessage = Extract<CoachServerMessage, { type: 'coach-state' }>`.
- Produces in `link.ts`: `type RecordLinks = Pick<AccountLinks, 'link' | 'unlink' | 'status' | 'token' | 'url' | 'reject' | 'cursors'>`. `AccountSync` deps take `links: RecordLinks`.
- Produces `createCoachRuntime(opts: RuntimeOptions): CoachRuntime`, where:
  - `RuntimeOptions = { root: string; profiles: () => Profile[]; noOpenRide: () => boolean; scheduled?: () => boolean; heavyBusy?: () => boolean; ask: (input: { prompt: string; systemPrompt: string; schema: object }) => Promise<unknown>; python: string; garminScripts: string; links: RecordLinks; meals: 'own' | MealCoach | null; together: () => Together; legacyPush?: (s: CoachState) => void; nowMs?: () => number }`.
  - `root` holds `rides/`, `coach/`, `garmin/`, `hevy/` and `accounts/`.
  - `CoachRuntime = { handle(m: CoachClientMessage, reply: (m: CoachServerMessage) => void): void; view(profileId: string): CoachStateMessage | null; scan(): void; onChange(fn: (profileId: string | null) => void): () => void; coachState(profileId: string): CoachState | null; profileIds(): string[]; records: RecordStore; accountSync: AccountSync }`.
- `main.ts` keeps only the env, `findClaude`, the old tailnet push, the WebSocket server (`originAllowed`, the subs map, sending a view only when it changed), and `setInterval(runtime.scan, SCAN_MS)`.

- [ ] **Step 1: Write failing tests** in `tests/coach/runtime.test.ts`, using a temp root seeded like `coach-process.test.ts` and a fake `ask`:
  - `subscribe answers with the coach-state keys main.ts sent before`: the reply keys equal `['type','state','thinking','hevy','debriefing','together','garmin','garminSync','garminReadiness','garminSuggestion','gym','strengthHealth','mobility','account','meals']`.
  - `a profile outside profiles() gets no view and its messages change nothing`: `view('x')` is `null`; after `handle({ type: 'note', profileId: 'x', text: 'a' })` no file `coach/x.json` exists.
  - `scan with scheduled() false asks no Claude and starts no Hevy or Garmin run`: `ask` and `spawnFn` are not called; the same holds with `noOpenRide()` false.
  - `heavyBusy() true skips the Hevy and Garmin ticks but not planning`.
  - `meals null: meals messages are ignored and the view has meals null`.
- [ ] **Step 2: Run** `npx vitest run tests/coach/runtime.test.ts`. Expected: FAIL, "Cannot find module '../../src/coach/runtime'".
- [ ] **Step 3: Implement.** Move the body of `main.ts` into the factory without changing behavior. The Mac passes `root = path.dirname(BIKE_DATA_DIR)`, `meals: 'own'`, `scheduled: () => true`, its `AccountLinks` and `legacyPush`. `profiles()` reads `rides/profiles.json` as today.
- [ ] **Step 4: Run** `npx vitest run tests/coach && npm run typecheck`. Expected: PASS, including the unchanged `coach-process.test.ts`.
- [ ] **Step 5: Commit** `refactor(coach): build the coach from one runtime factory`.

### Task 2: Sealed secrets for Hevy and Garmin

**Files:** Create `src/coach/secrets/secret-box.ts`, `src/coach/secrets/garmin-tokens.ts`; modify `src/coach/hevy.ts`, `src/coach/garmin.ts`, `src/coach/garmin-sync.ts`, `src/coach/garmin-uploader.ts`, `src/coach/runtime.ts`; test `tests/coach/secrets/secret-box.test.ts`, `tests/coach/secrets/garmin-tokens.test.ts`, `tests/coach/hevy.test.ts`, `tests/coach/garmin-sync.test.ts`

**Interfaces:**
- Produces from `secret-box.ts`:
  - `secretKeyFrom(env: string | undefined): Buffer`, which throws `PANDAFIT_SECRET_KEY fehlt oder ist ungültig` unless given exactly 64 hex characters.
  - `sealText(key: Buffer, label: string, plain: string): string` and `openText(key: Buffer, label: string, sealed: string): string`.
  - `type SecretCodec = { seal(plain: string): string; open(stored: string): string }`, plus `PLAIN_CODEC: SecretCodec` and `sealedCodec(key: Buffer, label: string): SecretCodec`.
- Produces from `garmin-tokens.ts`:
  - `type GarminTokens = { has(id: string): boolean; mtimeMs(id: string): number | null; checkout(id: string): string; checkin(id: string): void; remove(id: string): void }`.
  - `plainTokens(garminDir: string): GarminTokens` uses `<garminDir>/tokens/<id>`, as today.
  - `sealedTokens(opts: { garminDir: string; runDir: string; codec: (id: string) => SecretCodec }): GarminTokens` keeps `<garminDir>/tokens/<id>/garmin_tokens.json.sealed`.
- Options: `HevyLinks` gains `codec?: SecretCodec`. `GarminLink`, `GarminSync` and `GarminUploader` gain `tokens?: GarminTokens`. `RuntimeOptions` gains `hevyCodec?: (profileId: string) => SecretCodec` and `garminTokens?: GarminTokens`. All default to plain.

- [ ] **Step 1: Write failing tests:**
  - `seal then open returns the text, and the output starts with pfs1. and does not contain the text`.
  - `two seals of the same text differ`.
  - `a flipped byte, another key or another label throws`.
  - `secretKeyFrom refuses a missing, 63-character or non-hex key`.
  - `plain tokens use <garmin>/tokens/<id> and checkin changes nothing`.
  - `sealed checkout writes garmin_tokens.json under runDir with mode 0600; checkin seals a changed file back and removes the run folder`.
  - `with sealed tokens no file under garminDir contains the token text`.
  - `a sync run checks out before the spawn and checks in after the child exits, also when it fails`.
  - `Hevy with a sealed codec: api-key on disk starts with pfs1., apiKey() returns the key, status() never contains it`.
  - `Hevy without a codec writes the key in plain as today` (Mac unchanged).
  - `not there: no tokens means has() is false and no Python run starts`.
- [ ] **Step 2: Run** `npx vitest run tests/coach/secrets tests/coach/hevy.test.ts tests/coach/garmin-sync.test.ts`. Expected: FAIL.
- [ ] **Step 3: Implement.** `GarminSync` uses `tokens.mtimeMs` where it stats `garmin_tokens.json` today. Never log a token or a key, not even in an error.
- [ ] **Step 4: Run** `npm test && npm run typecheck && npm run test:garmin`. Expected: PASS.
- [ ] **Step 5: Commit** `feat(coach): seal the Hevy key and Garmin tokens when a key is given`.

### Task 3: The household on the server

**Files:** Create `src/coach/server/household.ts`, `src/coach/server/heavy.ts`, `src/coach/server/internal-links.ts`; test `tests/coach/server/household.test.ts`, `tests/coach/server/heavy.test.ts`

**Interfaces:**
- Consumes: `createCoachRuntime`, `sealedCodec`, `sealedTokens`, `RecordLinks`, `MealCoach`, `computeTogether`.
- Produces from `heavy.ts`:
  - `class HeavyLock { run<T>(fn: () => Promise<T>): Promise<T>; busy(): boolean }`, which queues calls first in, first out.
  - `inQuietHours(nowMs: number, fromHour = 2, toHour = 6): boolean`, in the process's local time.
- Produces `internalLinks(opts: { apiUrl: string; token: string; accountId: number; profileId: string; dir: string }): RecordLinks`. Its `url()` is `${apiUrl}/internal/accounts/${accountId}` and its `token()` is the internal token. Cursors live in `dir`.
- Produces `class Household`:
  - Constructor takes `HouseholdOptions = { root: string; secretKey: Buffer; runDir: string; python: string; garminScripts: string; apiUrl: string; internalToken: string; ask: (input) => Promise<unknown>; nowMs?: () => number }`.
  - Methods: `account(accountId: number): AccountCoach | null`, `start(accountId: number): void`, `scan(): void` and `together(): Together`.
  - `AccountCoach = { accountId: number; profileId: string; runtime: CoachRuntime; profile(): Profile; setProfile(p: Profile): void }`.
- Layout: `<root>/accounts/<id>/{profile.json, moved.json, rides/, coach/, garmin/, hevy/, links/}` and `<root>/household/meals/` (`moved.json` there switches the meal plan on).
- Wiring: every account's `ask` goes through one `HeavyLock`. `heavyBusy` is `lock.busy`, `scheduled` is `() => !inQuietHours(now)`, `noOpenRide` is `() => true`, and `meals` is one shared `MealCoach` whose `profiles()` covers moved accounts and whose `store` writes to each account's own `RecordStore`. Codec labels are `"<accountId>:hevy"` and `"<accountId>:garmin"`.

- [ ] **Step 1: Write failing tests:**
  - `an account without moved.json has no coach`: `account(1)` is `null`.
  - `each account reads only its own folder`: a ride under account 1 is absent from account 2's `summaries`, and account 1's note text is absent from `JSON.stringify(account(2).runtime.view(p2))`.
  - `together combines both accounts and carries no note, complaint or ride id of the other`.
  - `two planning runs from two accounts never overlap`: the fake `ask` sees a peak concurrency of `1`.
  - `Garmin and Hevy ticks skip while Claude runs`.
  - `scheduled runs pause from 02:00 to 06:00`: `inQuietHours` is true at 02:00 and 05:59 and false at 06:00 and 01:59.
  - `a person's message still plans in quiet hours`: a `note` at 03:00 calls `ask`.
  - `the meal plan waits until the household's meals moved, then plans for both and writes each mealplan record to its own account store`.
  - `not there: an account without Hevy and Garmin coaches with no fetch and no spawn`.
  - `the records link points at /internal/accounts/1 with the internal token`.
- [ ] **Step 2: Run** `npx vitest run tests/coach/server`. Expected: FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run** `npx vitest run tests/coach/server && npm run typecheck`. Expected: PASS.
- [ ] **Step 5: Commit** `feat(coach): run one coach per account in a household`.

### Task 4: The coach server on the internal network

**Files:** Create `src/coach/server/http.ts`, `src/coach/server/main.ts`, `src/coach/server/change-clock.ts`; modify `src/shared/coach-protocol.ts`; test `tests/coach/server/http.test.ts`, `tests/coach/server/change-clock.test.ts`

**Interfaces:**
- Produces in `coach-protocol.ts`:
  - Client messages `{ type: 'profile-update'; profileId: string; profile: Profile }` and `{ type: 'queued'; atMs: number; message: CoachClientMessage }`.
  - `QUEUEABLE: ReadonlySet<CoachClientMessage['type']>`, listing exactly: `feedback`, `skip-feedback`, `note`, `complaint-update`, `answer-question`, `skip-question`, `debrief-seen`, `debrief-answer`, `debrief-skip-question`, `remove-motive`, `set-ftp`, `adjust`, `skip-ramp`, `remove-rule`, `word-result`, `pass-select`, `pass-progress`, `pass-summit`, `gym-adjust`, `gym-note`, `gym-answer`, `gym-skip-question`, `gym-remove-rule`, `mobility-done`, `mobility-feel`, `meals-settings`, `meals-eater`, `meals-item`, `garmin-upload-settings`, `profile-update`.
  - `type CoachHome = { where: 'local' } | { where: 'moving'; done: number; total: number; problem: 'other-profile' | 'offline' | null } | { where: 'server'; online: boolean; sinceMs: number | null; session: 'server' | 'cached' | 'rules'; queued: number }`.
  - `coach-state` gains `profile?: Profile; coachHome?: CoachHome`.
- Produces from `change-clock.ts`:
  - `changeKey(m: CoachClientMessage): string | null` maps `complaint-update` to `complaint:<id>`, `set-ftp` to `ftp`, `feedback` to `feedback:<rideId>`, `meals-item` to `meal:<week>:<item>`, `meals-eater` to `eater:<week>:<meal>:<person>`, `meals-settings` to `meals-settings`, `garmin-upload-settings` to `garmin-upload`, and `profile-update` to `profile`. Every other message maps to `null` (append-only, always applied).
  - `class ChangeClock { constructor(file: string); admit(key: string, atMs: number): boolean }`, kept in `<account>/clock.json`. A live message (not queued) stamps `nowMs`.
- Produces `buildCoachServer(opts: { household: Household; internalToken: string; nowMs?: () => number }): FastifyInstance`, with:
  - `GET /healthz`, which gives `{ ok: true }` without a token.
  - `GET /status`, which gives `{ profileId: string | null; moved: boolean }`.
  - The WebSocket path `/ws`. Close codes: `4401` for a bad token, `4404` for an account not yet moved.
  - Every route except `/healthz` requires `x-pandafit-internal` and an integer `x-pandafit-account`.
- `main.ts` reads `PORT` (8090), `PANDAFIT_COACH_DATA` (`/data`), `PANDAFIT_SECRET_KEY`, `PANDAFIT_INTERNAL_TOKEN`, `PANDAFIT_API_INTERNAL` (`http://api:8081`), `BIKE_CLAUDE_BIN`, `PANDAFIT_GARMIN_PYTHON`, `PANDAFIT_GARMIN_SCRIPTS` and `PANDAFIT_COACH_DRY`. With `PANDAFIT_COACH_DRY=1` there is no scan, no Claude, no Hevy and no Garmin, and `/healthz?counts=1` (with the token) returns per-account counts for the drill. It refuses to start without a valid key or a token of 64 hex characters.

- [ ] **Step 1: Write failing tests:**
  - `without the internal token every route but /healthz answers 401 and the socket closes with 4401`.
  - `a socket for an account that has not moved closes with 4404`.
  - `subscribe with the account's profile id answers coach-state with profile`.
  - `a message for another profile id is refused and changes nothing`: account 1 sends a `note` for account 2's profile; account 2's `notes` stay the same, and no frame goes to either socket.
  - `a socket of account 2 never receives account 1's coach-state`.
  - `hevy-connect stores the key sealed and no frame ever carries it`.
  - `profile-update stores profile.json; coach-state.profile carries it with ftpW from the coach state`.
  - `queued: a change older than the item's last change is skipped`: a live `complaint-update` to `over` stamps time 2000, then a `queued` change to `healing` at time 1000 leaves the status `over`.
  - `queued: notes and answers are always applied, in order`.
  - `queued messages outside QUEUEABLE are ignored`.
  - The `changeKey` table, one assertion per row.
- [ ] **Step 2: Run** `npx vitest run tests/coach/server/http.test.ts tests/coach/server/change-clock.test.ts`. Expected: FAIL.
- [ ] **Step 3: Implement.** Use `ws` with `noServer` on `app.server`'s `upgrade` event and `maxPayload: 256 * 1024`. Never log a message body.
- [ ] **Step 4: Run** `npx vitest run tests/coach/server && npm run typecheck`. Expected: PASS.
- [ ] **Step 5: Commit** `feat(coach): serve the household coach on the internal network`.

### Task 5: Rides on the server

**Files:** Create `src/coach/ride-upload-format.ts`, `src/coach/server/ride-store.ts`; modify `src/coach/server/http.ts`; test `tests/coach/server/ride-store.test.ts`

**Interfaces:**
- Produces from `ride-upload-format.ts`:
  - `RIDE_ID = /^ride-[0-9]+(-[0-9a-f]{8})?$/`.
  - `type RideFiles = { 'meta.json': string; 'session.json': string; 'samples.jsonl': string; 'events.jsonl': string }`.
  - `type RideUpload = { v: 1; rideId: string; files: RideFiles; fit: string | null; sha256: string }`.
  - `rideHash(files: RideFiles): string`, the SHA-256 hex of the four texts in that order, each followed by `\0`.
  - `readRideUpload(ridesDir: string, rideId: string): RideUpload`, which takes the FIT from `<ridesDir>/exports/<rideId>.fit` when it exists.
- Produces `storeRide(opts: { ridesDir: string; profileId: string; upload: unknown; nowMs: number }): { ok: true; sha256: string; same: boolean } | { ok: false; reason: 'invalid' | 'hash' | 'open' | 'profile' }`. It writes through `<ridesDir>/.incoming-<rideId>` and a rename.
- Route: `PUT /rides/:rideId` takes a JSON body of at most 32 MiB and answers `200 { sha256, same }`, `409 { reason }` or `413`.

- [ ] **Step 1: Write failing tests:**
  - `a finished ride is stored in the recorder layout and the account's coach summarizes it`.
  - `the same upload twice answers same: true and writes nothing`.
  - `a changed upload keeps the old copy as <rideId>.replaced-<ms>`.
  - `an open or discarded ride is refused with open`.
  - `a ride of another profile id is refused with profile`.
  - `a wrong hash, the ride id ../x or a body over 32 MiB is refused and nothing is written`.
  - `without a FIT file one is made from the samples`: `exports/<rideId>.fit` is not empty.
  - `a crash between the temp folder and the rename leaves no half ride the coach reads`.
  - `storing a ride never starts a Garmin upload`.
- [ ] **Step 2: Run** `npx vitest run tests/coach/server/ride-store.test.ts`. Expected: FAIL.
- [ ] **Step 3: Implement.** Import `exportFit` and `readRide` from `src/service` read-only, as `coach.ts` already does.
- [ ] **Step 4: Run** it. Expected: PASS.
- [ ] **Step 5: Commit** `feat(coach): take finished rides from the Mac`.

### Task 6: The migration desk on the server

**Files:** Create `src/coach/server/migration.ts`; modify `src/coach/server/http.ts`, `src/coach/server/household.ts`; test `tests/coach/server/migration.test.ts`

**Interfaces:**
- Produces:
  - `type MigrationItem = 'coach-state' | 'gym-state' | 'garmin-db' | 'garmin-sync-meta' | 'hevy-workouts' | 'hevy-templates' | 'hevy-key' | 'garmin-tokens'`.
  - `type Manifest = { profile: Profile; rides: { rideId: string; sha256: string }[]; items: { name: MigrationItem; sha256: string; bytes: number }[] }`.
- Produces `class MigrationDesk`:
  - Constructor takes `{ root: string; secretKey: Buffer; onMoved: (accountId: number) => void }`.
  - `begin(accountId: number, m: Manifest)` returns `{ state: 'open'; haveItems: MigrationItem[]; haveRides: string[] } | { state: 'done'; profileId: string } | { state: 'refused'; reason: 'other-profile' }`.
  - `putItem(accountId: number, name: string, body: NodeJS.ReadableStream, sha256: string): Promise<'ok' | 'hash' | 'unknown' | 'closed'>`.
  - `finish(accountId: number, m: Manifest)` returns `{ state: 'done'; counts: { rides: number; items: number } } | { state: 'missing'; items: MigrationItem[]; rides: string[] }`.
  - `meals(accountId: number, body: Buffer): 'ok' | 'not-moved'`.
- Install paths, all under the account root, with `<p>` the profile id:
  - `coach-state` goes to `coach/<p>.json` and `gym-state` to `coach/gym/<p>.json`.
  - `garmin-db` goes to `garmin/data/<p>/garmin.db`; `PRAGMA integrity_check` must be `ok` first.
  - `garmin-sync-meta` goes to `garmin/data/<p>/sync-meta.json`.
  - `hevy-workouts` goes to `hevy/<p>/workouts.json` and `hevy-templates` to `hevy/<p>/templates.json`.
  - `hevy-key` is sealed into `hevy/<p>/api-key`, and `garmin-tokens` is sealed into `garmin/tokens/<p>/garmin_tokens.json.sealed`.
  - Every item is optional. Items wait in `migrate/incoming/`, and rides arrive through `PUT /rides/:rideId`.
- Routes: `POST /migrate/begin`, `PUT /migrate/item/:name` (raw body, header `x-sha256`, at most 128 MiB), `POST /migrate/finish`, `POST /migrate/meals`.
- Meals rule: if the household has no meal file yet, take the uploaded file whole. Otherwise add only `settings[<p>]`, when it is absent. Write `household/meals/moved.json` once every person in the file has moved.

- [ ] **Step 1: Write failing tests:**
  - `begin binds the profile id to the account; another profile id is refused with other-profile`.
  - `begin reports the items and rides the server holds with the same hash`.
  - `an item with a wrong hash is refused and not kept`.
  - `finish lists what is missing or differs and switches nothing`: the answer is `{ state: 'missing', items: ['garmin-db'], rides: ['ride-2'] }` and `account(1)` is `null`.
  - `finish with everything matching installs, seals and starts the account's coach`: `counts` is `{ rides: 2, items: 5 }`, `account(1)` is not `null`, and `api-key` starts with `pfs1.`.
  - `not there: a profile without Hevy or Garmin moves with neither item`.
  - `after done, begin answers done with the profile id and changes nothing`.
  - `a broken Garmin database is refused at finish`.
  - `meals: the first upload is taken whole, a later one adds only that person's settings, and planning starts once everyone in the file has moved`.
- [ ] **Step 2: Run** `npx vitest run tests/coach/server/migration.test.ts`. Expected: FAIL.
- [ ] **Step 3: Implement.** Hash while streaming to disk. Never hold a whole item in memory.
- [ ] **Step 4: Run** `npx vitest run tests/coach/server && npm run typecheck`. Expected: PASS.
- [ ] **Step 5: Commit** `feat(coach): take over a profile from the Mac after a checked upload`.

### Task 7: The api as the only door

**Files:** Create `web-server/records.ts`, `web-server/internal.ts`, `web-server/coach-proxy.ts`; modify `web-server/index.ts`, `web-server/package.json` (add `ws`), `web-server/package-lock.json`; test `tests/web-server/coach-proxy.test.ts`, `tests/web-server/internal.test.ts`

**Interfaces:**
- Produces `putRecords(db: DatabaseSync, accountId: number, list: unknown[], nowMs: number): { accepted: number; refused: { kind: unknown; id: unknown; reason: string }[]; newMealWeek: boolean }` and `listRecords(db, accountId, since: number, limit: number)`. These move the bodies of today's `/records` routes without changing them.
- Produces `buildInternal(opts: { dbPath: string; token: string; push?: PushOptions; nowMs?: () => number }): FastifyInstance`, with `GET|POST /internal/accounts/:id/records` under `Authorization: Bearer <PANDAFIT_INTERNAL_TOKEN>`. It uses its own database handle and listens on `0.0.0.0:8081` only when the token is set.
- Produces `registerCoachProxy(app: FastifyInstance, opts: { coachUrl: string; token: string; resolve: (req: IncomingMessage) => Promise<number | null> })`. `resolve` is today's `requireAuth`, factored out as `resolveAccount`.
  - Routes: the WebSocket at `GET /coach` and HTTP at `/coach/*`, mapped to the coach's `/*`. Both are active only when `PANDAFIT_COACH_URL` is set.
  - Body caps: 32 MiB for `/coach/rides/*`, 128 MiB for `/coach/migrate/item/*`, 1 MiB otherwise.

- [ ] **Step 1: Write failing tests,** against a fake coach that records the headers and paths it receives:
  - `without login every /coach route answers 401 and the socket upgrade is refused`.
  - `the account comes from the login: a client-sent x-pandafit-account is replaced`.
  - `account A cannot reach account B's coach data on any coach route`: the fake coach only ever sees A's id.
  - `a cookie socket from another origin is refused`.
  - `bodies pass through unparsed, and over the cap answer 413`.
  - `coach down: 503, and the socket closes with 1013`.
  - `the internal routes answer 401 without the token and do not exist on the public app`.
  - `internal records behave like the public ones, and a new meal week sends one push`.
- [ ] **Step 2: Run** `npx vitest run tests/web-server`. Expected: FAIL for the new files; the existing tests still PASS.
- [ ] **Step 3: Implement.** Use one upstream socket per client socket. Close both sides together, and allow at most 8 coach sockets per account.
- [ ] **Step 4: Run** `npx vitest run tests/web-server && npm run typecheck`. Expected: PASS.
- [ ] **Step 5: Commit** `feat(web-server): forward coach requests to the coach container`.

### Task 8: Coach container, backups and restore drill

**Files:** Create `web-server/Dockerfile.coach`, `web-server/Dockerfile.coach.dockerignore`, `web-server/backup-coach.sh`, `web-server/restore-drill-coach.sh`; modify `web-server/compose.yaml`, `web-server/.env.example`, `web-server/README.md`, `web-server/mac/pull-backups.sh`, `tests/web-server/deploy-files.test.ts`

**Decisions:**
- Image `pandafit-coach:local` is based on `node:24-slim`:
  - Python: `python3`, `python3-venv`, and `/opt/garmin-venv` with `garminconnect==0.3.20`.
  - Node: the root dependencies via `npm ci --omit=dev --ignore-scripts`, plus `tsx`, plus the Claude CLI pinned to the version current on the build day and written into the Dockerfile.
  - It copies `src/coach`, `src/shared`, `src/service/recorder.ts`, `src/service/recovery.ts`, `src/service/export` and `scripts/garmin`.
  - It runs as user `node` with `HOME=/data/home` and `BIKE_CLAUDE_BIN` set to the installed binary.
- Compose service `coach`: the settings in Ruling 10, plus a healthcheck on `/healthz`.
  - Environment: `PANDAFIT_SECRET_KEY: ${PANDAFIT_SECRET_KEY:?...}` (coach only), `PANDAFIT_INTERNAL_TOKEN: ${PANDAFIT_INTERNAL_TOKEN:?...}` (coach and api), and `TZ: ${TZ:-UTC}`.
  - `api` gains `PANDAFIT_COACH_URL: http://coach:8090` and the `internal` network.
  - Totals: 256 + 128 + 768 = 1152 MiB.
- `pull-backups.sh` also pulls `pandafit-coach-*.tar.gz`.
- README, in German:
  - Setup: `openssl rand -hex 32` twice into `.env` (mode 600), `docker compose exec coach claude login`, and lines for `SERVER.md`.
  - Operations: the measurement with `docker stats`, and the kill switch `docker compose stop coach` (the Mac falls back).
  - The sentence that encryption protects backups and copied files but not against someone who controls the running server.

- [ ] **Step 1: Write failing tests** in `deploy-files.test.ts`:
  - `the coach has no ports, read_only, cap_drop ALL, mem_limit 768m and restart unless-stopped, and serve.json does not name it`.
  - `only the coach gets PANDAFIT_SECRET_KEY and only the coach mounts pandafit_coach`.
  - `the project's memory limits add up to at most 2048 MiB`.
  - `the coach backup leaves out the Claude login and refuses unsealed secrets`: the script contains the `home/.claude` exclusion and the `pfs1.` check.
  - `the coach restore drill runs with --network none and PANDAFIT_COACH_DRY=1`.
  - The existing test `no secret or host name appears in the deploy files` covers the new files.
- [ ] **Step 2: Run** `npx vitest run tests/web-server/deploy-files.test.ts`. Expected: FAIL.
- [ ] **Step 3: Write the files.**
- [ ] **Step 4: Run** `PANDAFIT_SECRET_KEY=$(printf '0%.0s' $(seq 64)) PANDAFIT_INTERNAL_TOKEN=$(printf '1%.0s' $(seq 64)) docker compose -f web-server/compose.yaml config -q && npx vitest run tests/web-server`. Expected: no output from `config -q`; tests PASS. If Docker runs locally, also run `docker build -f web-server/Dockerfile.coach -t pandafit-coach:local .`. Expected: build succeeds.
- [ ] **Step 5: Commit** `feat(web-server): add the coach container with backups and a restore drill`.

### Task 9: The Mac uses the server coach for a moved profile

**Files:** Create `src/coach/remote/home.ts`, `src/coach/remote/remote-coach.ts`, `src/coach/remote/router.ts`; modify `src/coach/main.ts`, `src/coach/tracking/mac-sync.ts`; test `tests/coach/remote/remote-coach.test.ts`, `tests/coach/remote/router.test.ts`

**Interfaces:**
- Consumes: `CoachRuntime`, `QUEUEABLE`, `CoachHome`, `AccountLinks`, and `ruleBasedSession` from `src/coach/rules.ts`.
- Produces from `home.ts`: `homeOf(coachDir: string, profileId: string, linked: boolean): 'local' | 'server'`, `markMoved(coachDir: string, profileId: string, info: { atMs: number; counts: { rides: number; items: number } }): void`, and `clearMoved(coachDir: string, profileId: string): void`.
- Produces `class RemoteCoach`:
  - Constructor takes `{ dir: string; profileId: string; url: () => string | null; token: () => string | null; mayWrite: () => boolean; fallback: () => CoachState; nowMs: () => number; WebSocketImpl?: typeof WebSocket; onMessage: (m: CoachServerMessage) => void }`.
  - Methods: `start(): void`, `stop(): void`, `send(m: CoachClientMessage): 'sent' | 'queued' | 'refused'`, `view(): CoachStateMessage` and `status(): { online: boolean; sinceMs: number | null; queued: number }`.
  - Files: `<dir>/state.json` (last coach-state) and `<dir>/queue.json` (at most 1000 entries, written through a temp file and rename).
  - Connection: `ws(s)://<host>/coach` with `Authorization: Bearer <token>`. Backoff runs from 1 s to 60 s. A 401 calls `AccountLinks.reject`.
- Produces `createRouter(opts: { local: CoachRuntime; remote: (profileId: string) => RemoteCoach | null; mealsLocal: () => boolean }): { handle(m: CoachClientMessage, reply: (m: CoachServerMessage) => void): void; view(profileId: string): CoachStateMessage | null }`.
  - Records messages and `account-link` stay local. `account-unlink` calls `clearMoved`.
  - While `mealsLocal()` holds, the router lays the local meals view over the remote coach-state and keeps `meals-*` local.
- `AccountSync` gains `coachHere?: (id: string) => boolean` (default true). When it returns false, AccountSync syncs records only and neither writes plan or complaint records nor imports complaints into the local coach.
- In `main.ts`, the local runtime's `profiles()` excludes profiles whose home is `'server'`. `together` uses local states plus the cached states of moved profiles.

- [ ] **Step 1: Write failing tests:**
  - `an unlinked profile goes to the local coach exactly as today, and no socket is opened`.
  - `a moved profile subscribes to the server and gets its coach-state with coachHome { where: 'server', online: true, session: 'server' }`.
  - `the local coach does not plan, sync Hevy or Garmin, or upload to Garmin for a moved profile`.
  - `offline: coach-state comes from the cache, marked online false and session cached`.
  - `offline without a cache: the next session is the local rule session, marked rules`.
  - `writes while offline are queued in order with their time and sent as queued messages when back`.
  - `with a ride open nothing is sent: writes are queued and the subscription stays`.
  - `the queue survives a restart`.
  - `gym-preview and gym-confirm offline answer null and failed at once; hevy-connect offline is refused`.
  - `a local fallback plan is never sent`: the queue holds only messages the UI sent.
  - `records stay local and sync as before, but no plan or complaint record is written for a moved profile`.
  - `unlinking a moved profile returns it to the local coach`.
  - `meals stay local until every person in the meal plan has moved`.
- [ ] **Step 2: Run** `npx vitest run tests/coach/remote`. Expected: FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run** `npm test && npm run typecheck`. Expected: PASS, including `coach-process.test.ts`.
- [ ] **Step 5: Commit** `feat(coach): use the server coach for a moved profile, with a local fallback`.

### Task 10: Ride upload and migration from the Mac

**Files:** Create `src/coach/remote/coach-http.ts`, `src/coach/remote/ride-upload.ts`, `src/coach/remote/migrate.ts`; modify `src/coach/main.ts`, `src/coach/tracking/mac-sync.ts`; test `tests/coach/remote/ride-upload.test.ts`, `tests/coach/remote/migrate.test.ts`

**Interfaces:**
- Consumes: `readRideUpload`, `Manifest`, `MigrationItem`, `markMoved`, and `AccountLinks.url`/`token`.
- Produces `coachHttp(opts: { url: string; token: string; fetchFn?: typeof fetch }): CoachHttp`, with `status()`, `putRide(u: RideUpload)`, `begin(m: Manifest)`, `putItem(name: MigrationItem, file: string, sha256: string)`, `finish(m: Manifest)` and `meals(file: string)`. Every call has a 60 s timeout, and a 401 rejects the link.
- Produces `class RideUploads`:
  - Constructor takes `{ ridesDir: string; dir: string; http: (profileId: string) => CoachHttp | null; noOpenRide: () => boolean }`.
  - Methods: `pending(profileId: string): string[]` and `tick(profileId: string): Promise<void>`.
  - The ledger lives in `<coachDir>/remote/<profileId>/rides.json`.
- Produces `migrate(opts: { root: string; profileId: string; http: CoachHttp; uploads: RideUploads; recordsSettled: () => boolean; noOpenRide: () => boolean; progress: (done: number, total: number) => void }): Promise<{ state: 'done' } | { state: 'refused'; reason: 'other-profile' } | { state: 'paused' } | { state: 'failed' }>`.
- `AccountSync` gains `settled(profileId: string): boolean`: the last run succeeded, and nothing changed locally since.
- Rules:
  - Run from the scan, with no ride open, one job at a time, and at most once a minute per profile after a failure.
  - The snapshot goes to `<coachDir>/remote/<profileId>/staging/`. The Garmin database is copied there with `VACUUM INTO`.
  - Re-hash the live items before `finish`, and start over if one changed.
  - `markMoved` only on `done`. Meals go up through `http.meals` once every person in `household.json` has moved.

- [ ] **Step 1: Write failing tests:**
  - `an open ride is never uploaded; a discarded one neither`.
  - `a closed ride uploads once, the ledger keeps it, and the local files stay byte for byte`.
  - `a failed upload retries on a later run`.
  - `a ride that opens mid-list stops the uploads before the next request`.
  - `migration uploads everything once, finishes and marks the profile moved`.
  - `a cut-off migration resumes and skips what the server already has`.
  - `a coach change during the upload restarts the snapshot and does not switch`.
  - `unsent records hold the switch until they are on the server`.
  - `other-profile keeps the profile local and coachHome says why`.
  - `not there: without Hevy and Garmin, migration sends neither item and succeeds`.
  - `the Hevy key and Garmin tokens go only to the migration route and never into a log`: console spies never see the key.
  - `server unreachable: nothing changes locally, and it tries again`.
- [ ] **Step 2: Run** `npx vitest run tests/coach/remote`. Expected: FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run** `npm test && npm run typecheck`. Expected: PASS.
- [ ] **Step 5: Commit** `feat(coach): move a linked profile to the server and upload rides after the ride`.

### Task 11: Mac screens

**Files:** Create `src/ui/useServerProfile.ts`, `src/ui/views/CoachHomeNote.tsx`; modify `src/ui/useCoach.ts`, `src/ui/App.tsx`, `src/ui/views/CoachView.tsx`, `src/ui/views/AccountCard.tsx`, `src/ui/views/ProfileSettingsView.tsx`; test `tests/ui/coach-home.test.tsx`

**Interfaces:**
- Consumes: `coach-state.profile`, `coach-state.coachHome`.
- Produces: `useCoach` also returns `coachHome: CoachHome` (default `{ where: 'local' }`) and `serverProfile: Profile | null`.
- Produces `useServerProfile(local: Profile | null, server: Profile | null, riding: boolean, sendRide: (m: ClientMessage) => void): void`. It sends `save-profile` with the server values when they differ and no ride is open.
- `ProfileSettingsView` also sends `profile-update` to the coach when `coachHome.where === 'server'`.
- German copy:
  - Offline: `Server nicht erreichbar. Stand von <HH:MM>.`
  - Session labels: `Gespeicherte Einheit vom Server` and `Einheit nach Regeln`.
  - Queued writes: `<n> Änderungen werden gesendet, sobald der Server erreichbar ist.`
  - Moving: `Umzug zum Server: <done> von <total>`.
  - Other profile: `Dieses Konto gehört schon zu einem anderen Profil.`

- [ ] **Step 1: Write failing tests:**
  - `a moved profile's server values reach the ride service`: `save-profile` is sent with the server `ftpW`.
  - `no save-profile while a ride is open`.
  - `an edit on the Mac sends profile-update to the coach and save-profile to the ride service`.
  - `offline shows the time of the last state and which session it is`.
  - `start uses the cached session and FTP when offline`.
  - `moving shows the progress in the account card`.
  - `an unlinked profile shows no note and the coach page renders as before`.
- [ ] **Step 2: Run** `npx vitest run tests/ui/coach-home.test.tsx`. Expected: FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run** `npm test && npm run typecheck`. Expected: PASS.
- [ ] **Step 5: Commit** `feat(ui): show where the coach runs and keep server profile values for the ride`.

### Task 12: Roll out

- [ ] **Step 1:** Confirm that no ride is open (`findOpenRides`, or check that `rides/live/current.jsonl` is not growing). Merge to `main`. With the rider's agreement, run `npm run app`. Check an unlinked profile with a screenshot: it is unchanged.
- [ ] **Step 2:** Read `~/SERVER.md`, add the coach lines, then deploy per `web-server/README.md`, never between 02:00 and 06:00. Run `docker compose build && docker compose up -d`, then `docker compose exec coach claude login` (the rider confirms in the browser).
- [ ] **Step 3:** Run `./backup.sh && ./backup-coach.sh && ./restore-drill.sh && ./restore-drill-coach.sh`. Expected: both end with "Restore drill ok". From outside, `curl -si https://pandafit.<tailnet>.ts.net/coach/status` gives 401.
- [ ] **Step 4:** Link and move the first profile with no ride open. Compare the Mac's ride count with `counts.rides`. Watch `docker stats pandafit-coach-1` during one real planning run, set `mem_limit` to about 1.5 times the peak (staying within 2 GiB for the project), and note the result in `SERVER.md`.
- [ ] **Step 5:** With `npm run dev:sim`: stop the coach (`docker compose stop coach`), start a simulated ride, and confirm it starts with the cached session and the note. Add a note during the ride, end the ride, and start the coach. The ride arrives once and the note follows.
- [ ] **Step 6:** Move the second profile and check that the meal plan is planned on the server with the Mac off. Update `docs/after-ride.md` and `README.md` with anything that stayed open.
