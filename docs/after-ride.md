# To implement after the ride

Audit of 2026-11-19. Built entries are removed; see git history (debrief 3af7fb8/529efe3, Garmin upload de11d05/aebfd46, way back from the film window aebfd46, sudden climbs and heart rate zones 8d62400, Garmin profile 29ba04c, no intervals for beginners 4786c27).

## Built by the plan 2026-11-19-after-ride-rest

Plan: `docs/superpowers/plans/2026-11-19-after-ride-rest.md`. Remove each line when its task is merged.

- Vocabulary: "Gleich kannst du antworten." before the reveal, plus/minus hint with a clicker after it.
- No change note "Keine Änderung" when the coach changes nothing.
- Cadence: average cadence in the ride summary for the coach and the debrief (no target ranges).
- Heart rate: the coach can plan easy sections by heart rate (`hrHold`) within fixed limits.
- Ramp test ends by itself when the rider can no longer hold the target.
- Personal tips from the coach during the ride, written with the next session.

## Needs a real device test

Not buildable without the bike, the clicker or the real Mac:

- Gentle 25 s ramp into climbs and the warning before a sudden climb, on the real Hub One.
- Zwift Click (first generation) on the real device; very old firmware may be encrypted, then update it in the Zwift Companion app.
- Quirks of noble on macOS with the real devices.
- Dutch speech output on the real Mac.
- Phone companion in a real ride; WebSocket under CSP `default-src 'self'` in Safari.
- Garmin ride upload: check with a real upload that Garmin Connect accepts the FIT file with all required fields.

## Needs real weeks of use

Own settings that only real rides and weeks can confirm or change:

- Training quality of the coach (trial run of 2026-10-31 with invented ramp tests only).
- Automatic reduction (20 s, 30 s, 5 %, at most −20 %), intervals from 3 rides in 28 days, 0.5 % grade per gear.
- FTP estimate without a test (`docs/ftp-estimate.md`, error likely above ±22 %) and the adjustment rule (+5 %/−10 %).
- Rides under 5 minutes do not count; sensor filter and thresholds for analysis.
- Garmin recovery: resting heart rate ≥ 5 bpm above the 28-day median on 2 days, other-sports load above 1.5 times the average (from 100 points), sleep under 5 h only with sleep data.
- Motivation (`docs/motivation.md`): whether the wording fits and the follow-up questions are not annoying.
- Heart rate rules in `docs/hr-zones.md` (zone bounds, hold steps, drift and recovery values).

## Needs work outside this repo

- AI transparency per coach: token use per call and per coach, and the account name of the AI login. The home server AI service (`heimserver/ki`) logs tokens per client and shows them in the overview, but its answer to Pandafit carries no tokens and no account. It first has to return them.

## Mountain stops moving while the main window is hidden (seen live, 2026-11-12)

Status: vorbereitet in fix/after-ride (full gap integrated in sub-steps, `backgroundThrottling: false` on both windows).

`PassView` moves the rider with a 1 s `setInterval` and caps each step at 5 s (`Math.min(5, …)`). When the film window covers the main window, Chromium throttles the hidden window's timers (after a few minutes to about once per minute). Each late tick then adds only 5 s of riding, so most of the distance is lost and the mountain looks frozen.

- Drive the position from the ride itself, not from a UI timer: the service already has every second's power, so it (or the UI from `engine.rideElapsedS`) can integrate the distance without gaps.
- At least: integrate the full gap since the last tick instead of capping at 5 s, and set `backgroundThrottling: false` on the main window (`src/main/index.ts`).
- Needs `src/main/**` or `src/service/**`, so it goes with the next restart, not during a ride.

## BLE-Verbindung hängt nach Zeitüberschreitung (19.11.2026)

Status: vorbereitet in fix/after-ride (Zeitgrenzen und Namens-Abgleich bei neuer ID).

- Symptom: Nach `connect-try` für hr um 20:08:08 kam kein Ergebnis mehr. Danach gab es keine Verbindungsversuche mehr für hr und clicker, bis die App neu startete.
- Vermutete Ursache: `src/service/ble/noble-adapter.ts` wartet im catch auf `peripheral.disconnectAsync()` oder in `find()` auf `stopScanningAsync()`, ohne Zeitgrenze. Wenn das nicht zurückkommt, bleibt `busy` true und die Warteschlange steht.
- Fix: Zeitgrenze für disconnectAsync und stopScanningAsync. Test: hängendes disconnectAsync blockiert die nächsten Versuche nicht.
- Zweites Problem am selben Abend: macOS gab dem Polar H10 eine neue Peripheral-ID. `find()` ignoriert jedes Gerät mit anderer ID als in `devices.json`, also blieb der Gurt „nicht gefunden“. Fix: Wenn das bekannte Gerät eine Zeit lang fehlt, auch ein Gerät mit gleichem Namen annehmen und die ID neu speichern.
