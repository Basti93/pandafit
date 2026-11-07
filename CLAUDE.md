# Pandafit

Spec: `docs/superpowers/specs/2026-10-31-bike-coach-design.md`. Top rule: A ride is never lost.
Roadmap of the rebuild (the one work order, milestones, parking lot): `docs/roadmap.md`.

## Live improvement during a ride

The user is on the bike and dictates feedback into the terminal using macOS dictation.

- Read live: `~/Library/Application Support/bike-coach/rides/live/current.jsonl` (per-second values, markers, events). The user sets markers with the `m` key.
- Off-limits while a ride is open: `src/service/**`, `src/shared/**`, `src/main/**`. No restarts of the service, no `npm install`.
- Allowed: `src/ui/**` and `npm run live:adjust -- <deltaPct>`; the guardrails limit the value.
- Every change is its own commit with the prefix `live:`. To undo: `npm run live:undo`.
- Larger rework goes into `docs/after-ride.md` and is implemented after the ride.

## Operation

- Test without a bike: `npm run dev:sim` simulates the trainer and strap.
- Data: `~/Library/Application Support/bike-coach/rides/`, FIT files under `rides/exports/`.
- Home server: rides go there through the account link of the profile (Profile > Konto) after the ride, and a Mac without rides gets them back from there. Without a link, everything runs locally. A leftover `config.json` is ignored.
- Hevy is optional and per profile: everyone enters their own API key in the app. It lives in `hevy/<profileId>/api-key` in the data folder, never in the repo.
- To pair other devices: delete `rides/devices.json` while no ride is running.

## Mac app

- Build and install to `/Applications`: `npm run app`, never during an open ride. The app uses the same data folder as `npm run dev`; the single-instance lock prevents both running at the same time.
- Live improvement of the interface during a ride only works with `npm run dev`. In the packaged app, Claude can read live data and use `live:adjust`, but cannot change the interface.
