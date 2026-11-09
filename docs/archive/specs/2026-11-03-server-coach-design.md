# Pandafit: the coach moves to the home server

Status: approved in chat by the rider. "[Rider]" marks what the rider decided, "[Builder's call]" what was settled on their behalf and can be overruled.

## Why

The Mac is often off. Today the coach runs only in the Mac's coach process (`src/coach`), so without the Mac there is no new strength plan, no meal plan on Saturday, no Hevy or Garmin sync and no reaction to a complaint added on the phone. The riders want the coach to run on the home server, with all data there, so the phone works fully on its own [Rider].

## Goals

- The coach runs on the home server: bike coach, strength coach, meal plan and mobility, with its own Claude login [Rider].
- All data lives on the server: rides, Garmin data, strength workouts, complaints, notes, meal settings, coach state, and the Hevy key and Garmin login, encrypted [Rider].
- The server syncs Hevy and Garmin itself, so plans stay fresh with the Mac off.
- The Mac and the phone are clients of the server coach. Both show the same state.

## Non-goals

- Ride recording stays on the Mac: trainer and heart-rate strap are Bluetooth devices on the Mac. The ride service (`src/service`) is not moved.
- No new public features beyond what the coach does today; this is a move, not a redesign.
- No multi-household or registration: still two accounts created on the server.

## Anti-goals

- A ride is lost. Recording, saving and recovery stay local on the Mac exactly as today; upload happens after the ride, retried until confirmed, and the local copy stays.
- A ride is disturbed: nothing of this runs or uploads during an open ride on the Mac.
- Secrets or health data are readable from the internet without a login, or by the other account.
- The app stops working when the server or the Claude login is down: the Mac still records, and the existing rule-based planning covers the gap.

## Where it runs [Builder's call]

A new container `coach` in the existing `pandafit` Compose project on the home server, following `~/SERVER.md`: own memory limit, no published port, no Funnel, read-only root, no capabilities, `restart: unless-stopped`, heavy runs not between 02:00 and 06:00. It reaches the internet only for Claude, Hevy and Garmin, and the `api` container over the internal Compose network.

Its data (coach state, ride summaries and samples it needs, Garmin database, Hevy store, secrets) lives in its own volume that the public `api` container does not mount. The `api` container stays the only public door: it authenticates the account and forwards coach requests to the `coach` container over the internal network, passing the resolved account id. Every coach route is scoped to that account. So a hole in the API's static or record routes does not expose the coach volume directly, and the other account's data is never reachable [Rider asked for it on the server; separation is the builder's call].

The Claude CLI is logged in once inside the container (`docker compose exec coach claude login`), its credentials in the coach volume, never in the repo or image [Rider].

## Secrets [Rider: encrypted]

The Hevy key and the Garmin login (tokens, not the password, where Garmin allows) are stored encrypted (AES-256-GCM) in the coach volume. The key comes from the server's `.env` (`PANDAFIT_SECRET_KEY`, generated at setup, mode 600), not from the volume. This protects backups and copied database files; it cannot protect against someone who controls the running server, because the coach must use the secrets unattended. Say so in the README.

Secrets are write-only from the clients: the Mac and the phone can set or remove them, never read them back. They never appear in logs, prompts, records or backups pulled to the Mac in clear.

## What moves

- Bike coach: plans, debriefs, notes, complaints, motives, rules, FTP history and Garmin upload choices. The Mac uploads every finished ride (summary and samples, and the FIT export) after the ride is closed. The bike coach on the server plans from these as it does today.
- Garmin: sync and the optional upload of rides with the existing confirmation rule ("no automatic upload without confirmation before" [Rider's standing rule]). The Python bridge (`scripts/garmin`) runs in the coach image.
- Hevy: read sync and the routine export with preview and confirmation, as today.
- Strength coach, mobility, meal plan, together page, health page data.
- Push notifications for the meal plan are sent by the server when the plan is written (already built in the web server).

## Migration [Builder's call, rider agreed]

When a profile is linked to an account and the server coach is available, the Mac uploads once everything it holds for that profile: coach state, rides, Garmin database, Hevy store and key, Garmin tokens, meal settings. The upload is resumable and checked (counts and hashes) before the server coach takes over that profile. After that the server is the source of truth; the Mac keeps its local files untouched as a fallback copy.

## The Mac after the move

- The Mac app shows coach state from the server through the existing coach UI, so screens stay the same.
- Ride recording and the ride screen are unchanged. The next session to ride is fetched from the server before the ride and kept locally, so a ride starts even when the server is down.
- Without the server (offline, server down, Claude not logged in) the Mac falls back to the existing local rule-based planning and queues its uploads.
- A profile not linked to an account keeps working fully locally, exactly as today.

## Constraints

- Public repo: no names, tokens, hostnames or real data in commits, tests or docs.
- Hevy and Garmin stay optional; each has a test for "not there".
- `src/service/**` is not changed except what the upload of finished rides needs, and never while a ride is open.
- Memory: the home server is tight (see `~/SERVER.md`); the coach container gets a limit, and Claude runs one at a time.
- Backups: the coach volume is backed up daily alongside the existing backup, encrypted secrets stay encrypted in the backup, and the restore drill covers it.

## Settled after the builder check [Builder's call]

- **Household.** The two accounts form one household, as the profiles on one Mac do today. Within the household the coach may combine data exactly where it does today: the meal plan (diets, dislikes, who eats, training days) and the together page (derived values such as rides per week, streak-free summaries, climbed mountains). Nothing else crosses: one account never reads the other's rides, health data, notes, complaints or secrets. Requests are scoped to the account; household features are computed by the coach and returned only as their combined result.
- **Mac while the server is down.** For a migrated profile the Mac's own Claude, Hevy sync, Garmin sync, Garmin upload and Hevy export are off; only the server does them, so nothing runs twice. While the server is unreachable the Mac shows the last server state and, for the next ride, the last fetched session or the local rule session, marked as such. Writes made meanwhile (ride feedback, notes, complaints, debrief answers, FTP changes, ticks) are queued as changes and sent when the server is back; the server applies them in order, last change wins per item, as records do today. A local fallback plan is never sent; the server's plan replaces it.
- **Profile values.** FTP, max heart rate, weight, height, birth date, sex, name and avatar are owned by the server for a migrated profile. Edits on the Mac are sent to the server. Before each ride the Mac fetches the current profile and next session and keeps them locally, so the ride service rides with the same FTP the server plans with, also when the server is down.
- **Push.** The Web Push branch is merged before this work starts; the coach calls the api to send the meal plan notification.
- **Memory.** `~/SERVER.md` allows a new project about 2 GiB in total unless agreed otherwise; Pandafit uses 384 MiB today. The coach container starts with a 768 MiB limit, runs one Claude call at a time across all coaches, and keeps Garmin and Hevy syncs out of Claude runs. Measure with `docker stats` during a real planning run and adjust, staying inside the 2 GiB.

## Left to the builder

The coach protocol between api and coach containers, how the Mac UI switches between local and server coach, ride upload format, Garmin token handling in the container, the order of the work, and how the existing tailnet-only sync node (`server/`) relates to this (it may stay as an extra ride backup).
