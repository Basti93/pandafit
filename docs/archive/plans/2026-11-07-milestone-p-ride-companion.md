# Milestone P: Ride companion in the web app

The phone shows the running ride large, like a second screen. It can adjust power (±5 %), set a marker and skip an interval. The Mac stays in charge.

## Global Constraints

- **Top rule: a ride is never lost and never disturbed.**
  - The phone and the server are optional. Losing them, slow answers or bad messages never block, crash or slow down the recorder or engine.
  - Everything companion-related runs outside the ride-critical path (the service records; the relay only reads its state and sends the same messages the Mac UI sends).
- Before each task, check that no ride is open: `~/Library/Application Support/bike-coach/rides/live/current.jsonl` is older than 1 h, and no `rides/ride-*/meta.json` has status "open". If a ride is open, stop and report.
- No npm install, no new deps, no push, no deploy, no ssh. Do not touch AGENTS.md or `.superpowers/`.
- Public repo: no personal data. Tests use invented values.
- Light UI with the kit (`src/tracking/ui/kit/`). Big numbers are fine here: this is the ride display.
- Commits end with `Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>`. `npm test`, `npm run typecheck` and `npm run test:web-smoke` are green after each task.
- If `web-server` needs new `src/shared` files, add them to the Dockerfile COPY line (`tests/web-server/api-image.test.ts`).

## Today (verify, may be slightly off)

- **Mac service:** it serves the local WebSocket `ws://127.0.0.1:7410` (`src/service/ws-server.ts`).
  - The protocol is in `src/shared/protocol.ts`: `adjust{deltaPct}`, `mark{note}`, `stop`; `state` carries the ride, `engine` (`EngineState`) and devices.
  - The guardrail is `clampTargetW` (0.3–1.5 FTP).
  - There is no interval-skip message.
- **Mac coach process** (`src/coach/main.ts`): it talks to the server coach for moved profiles via `src/coach/remote/` (`remote-coach.ts`, `coach-http.ts`, `router.ts`). Find out whether it already holds a connection to the service and to the server that can carry the companion. Prefer reusing them over new sockets.
- **Server:** the coach `/ws` (`src/coach/server/http.ts`) carries the coach protocol (`src/shared/coach-protocol.ts`). The web-server proxies it (`web-server/coach-proxy.ts`), and the web app is a client of it.

## Design

### Flow

1. **Mac relay → server** (in the Mac coach process, for a moved profile whose ride is open):
   - About once per second it sends `live-state`: `{rideId, profileId, atMs, elapsedS, powerW, hrBpm, cadenceRpm, targetW, step: {name?, index, count, remainingS}, nextStep?: {label, targetW?}, paused?}`.
   - When the ride closes, it sends `live-end`.
   - Sending is fire-and-forget. A queue keeps only the latest state, never a backlog.
2. **Server:** it keeps the last `live-state` per account in memory only (nothing on disk) and forwards it to that account's web clients on the coach ws. Data older than 10 s counts as gone.
3. **Phone → server → Mac:** the phone sends `live-command {id, kind: 'adjust', deltaPct: ±5} | {id, kind: 'mark'} | {id, kind: 'skip'}`. The server forwards it only to the Mac of the same account that owns the live ride.
4. **The Mac relay checks every command:**
   - the ride is still the same;
   - the command is at most 10 s old;
   - the id has not been seen before (dedupe);
   - at most 5 commands per 10 s;
   - `deltaPct` is exactly ±5.
   - It sends the normal service message: `adjust` / `mark {note: 'Handy'}` / the new `skip`.
   - It answers `live-ack {id, ok, reason?}`, which the server relays to the phone.
   - The service's own guardrail still clamps.
5. **New service message `skip`:** it ends the current step and continues with the next one, like the end of a step in time.
   - It is ignored for the last step, when no ride is running, and while paused.
   - It is recorded as an event in the ride (like a marker), so the ride file shows it.
   - Engine tests cover it.

### Web: "Fahrt läuft"

- While fresh live data exists, a slim strip "Fahrt läuft ›" shows at the top of every tab. It opens a full-screen view.
- **Full-screen view:**
  - **Big:** Leistung (W) with the target below it; Puls; Trittfrequenz.
  - **Interval line:** name, "noch 3:20", and "danach: 5 Min locker".
  - **Buttons:** "−5 %", "+5 %", "Marker", "Intervall überspringen". Skip uses a small confirm sheet: "Überspringen" / "Abbrechen".
  - After a tap, the button shows "…". On the ack it shows "✓" for 1.5 s; on a refusal or after 5 s without an ack it shows "nicht angekommen".
  - Without live data for more than 10 s, the numbers grey out with "Verbindung zum Mac weg". The view closes itself 30 s after `live-end`.
  - Screen wake lock while the view is open: `navigator.wakeLock` in try/catch, released on close.
- The Mac app itself needs no change except the new skip being possible (a skip button in the Mac ride UI is not required).

## Tasks

### Task 1: Service `skip`

- Protocol message, engine handling and event in the ride file. Tests.
- Commit: `feat(ride): skip to the next interval`.

### Task 2: Relay and server channel

- Shared types in `src/shared/coach-protocol.ts` (or a new `src/shared/live.ts`).
- The Mac relay: rate-limited, latest-only, and stopped when the ride ends or the link drops.
- Server memory and forwarding per account, plus the proxy pass-through.
- **Tests:**
  - the state reaches only the same account;
  - stale data counts as gone;
  - commands are refused across accounts;
  - dedupe, age and rate limits;
  - the ack round trip;
  - the relay never throws into the service client;
  - a broken server link does not affect the service connection.
- Commit: `feat(ride): the Mac shares the running ride with the server`.

### Task 3: Web "Fahrt läuft" view

- The strip, the full-screen view, the commands with ack states, the stale state, and the wake lock.
- Seed a fake live state in `scripts/web-shots.ts` (shots `fahrt-laeuft`, `fahrt-laeuft-weg`) and look at them.
- Tests for the strip visibility, the buttons sending the right commands, the ack and timeout states, and the stale state.
- Commit: `feat(ride): follow and steer the ride from the phone`.
