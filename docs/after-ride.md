# To implement after the ride

## Requests from the test ride (2026-11-01)

1. **Gentle transition, sudden only on request:** Climbs now run on a power target and begin with a 25 s ramp (not yet verified on the bike). Open: a per-segment setting for a sudden rise, selectable by the coach, with advance notice.
2. **Hints on what Plus and Minus do:** Now only needed for vocabulary: "Plus: Wusste ich · Minus: Nochmal" ("Plus: I knew it · Minus: Again") after revealing, and "Gleich kannst du antworten" ("You can answer in a moment") before.
3. **Heart rate as part of training instead of just a display:**
   - Suggest heart rate zones from Garmin data, with confirmation on the profile page. The heart rate limit is not a medical limit.
   - Target zone per segment with live display; the coach can steer easy sessions entirely by heart rate.
   - If heart rate stays above the zone or limit for too long, power drops in small steps with an announcement and can be overridden. Above `maxHrBpm` the engine already reduces today after 30 s by 5% at a time, at most 20%, and since the rework also on climbs.
   - For each segment the coach receives time in zone, rise at constant power and recovery after hard segments.
   - Without a strap the ride continues by power, the control pauses, and the app shows this openly.
4. **Cadence (suggestion, not a firm task):** Target ranges per segment and coach analysis. Today only display and recording, not in `RideSummary`.

## Profile from the Garmin export (request from 2026-11-01, waiting for the real ZIP)

- New profile: choose the Garmin ZIP, prefill values, ask only for what is missing. The manual form stays as the route without Garmin.
- The preview shows each value with its origin and stays editable; nothing is saved until confirmed.
- Never adopt FTP and heart rate limit silently: both control training and safety. The estimate's caution rule (starting value, `ftpCapW`) also stays in place with Garmin data.
- The approach and storage have since been decided: `python-garminconnect` instead of the ZIP, the home server after confirmation per profile, only concise daily values for the coach.
- Which fields the export contains is unverified: settle this only against the real ZIP.


## Coach assessment (2026-10-31, trial run without a real ride)

Checked with the real `claude -p` and two invented ramp tests (FTP 210 W and 128 W): both profiles received their own easy sessions of around 40 minutes at 62–65% FTP and a cautious forecast (around 1% per month). This looks reasonable but proves no training quality. Only real weeks will show that.

- Notable: The text under "Was der Coach geändert hat" ("What the coach changed") also reports "Keine Änderung" ("No change"). Such entries should be reviewed after real rides and hidden if appropriate.
- Notable: Without Claude, the rule set already suggests 4 × 4 minutes just two days after the first ramp test. That is rather too hard for getting started.

## Comparison with established projects (2026-10-31)

Sources: Auuki, GoldenCheetah, qdomyos-zwift, BikeControl, clickbridge, wattroom, ZoneBuddy, Claude Code docs. None of this has been verified on the real Hub One.

- Own setting with no precedent: automatic reduction (20 s, 30 s, 5%, −20%), intervals from 3 rides in 28 days, 0.5% grade per gear.
- Open: automatic end of the ramp test (wattroom), required fields for the Garmin upload, quirks of noble on macOS.
- Clicker: Zwift Click first generation built in, behaviour based on BikeControl and zwiftplay, no code taken over. Not verified on the real device. According to zwiftplay, very old firmware is encrypted; in that case update it first in the Zwift Companion app.
- FTP without a test: The ramp test is optional, the estimate is described in `docs/ftp-estimate.md`. Formulas taken only from abstracts and secondary sources, the chain is not validated, the error is more likely above ±22%. The adjustment rule (+5%/−10%) is an own setting.
- Rides under 5 minutes do not count as training (own setting). Discarded rides stay locally on disk (status `discarded`) but do not count, with no FIT and no further upload. The server filter for this has not yet been deployed on the home server.
- Lessons from Domestique, Apex Velo Lab, Enduragent and ai-cycling-coach (ideas only, no code): sensor filter for analysis only (up to 2500 W, heart rate 25 to 240, spikes of up to 2 s above 2.5 times the surrounding values and above 400 W), target vs. actual per interval, a second AI attempt, a weekly limit, remembered rules. All thresholds are own settings, not verified on real rides.
- Together: Every riding minute counts as 10 metres of elevation (a game rule, not a measurement), mountains and elevations are rounded guide values. Leaderboard without power and FTP.
- Dutch: see `docs/language.md`. Speech output still has to be verified on the real Mac. No vocabulary appears on climbs.

## Garmin recovery (2026-11-01)

Own settings, to be verified over real weeks: resting heart rate ≥ 5 bpm above the 28-day median on 2 consecutive days, load from other sports over the last 3 days above 1.5 times the average (from 100 points, so that a single normal run does not trigger a warning), sleep under 5 h only with sleep data. On "careful" the rule set suggests recovery, and the AI receives the assessment as a note. The result is cached for 5 minutes.

## Motivation through the coach (built on 2026-11-01)

Foundations and own settings are in `docs/motivation.md`. Open: verify with the real AI and over real weeks whether the wording fits and the follow-up questions are not annoying.

## Coach tips during the ride (live, 2026-11-02)

Tips currently come from fixed rules in `src/ui/ride-tips.ts`. Tips from the AI, fitted to the person and their complaints, need the coach process and the protocol, so they are for after the ride.

## Coach debrief after the ride (requested live, 2026-11-02)

The feedback screen (`src/ui/views/FeedbackView.tsx`) already shows numbers, charts, progress and the rating, but no words from the coach. Wanted there, written by the AI from this ride and the person's history:

- Summary of what happened in the ride, not just the figures.
- Tips for next time, based on the actual ride.
- Motivation, in the person's own words where motives are known (`encouragement` rules in `src/coach/coach.ts`).
- Outlook: what comes next and why.
- Follow-up questions the person can answer or skip (reuse `answer-question`, at most one or two, everything skippable).

Needs a new field in the coach answer and state, so `src/coach/**` and the coach protocol change and the app has to restart. The coach must not invent anything: no claims without data in the summary. The screen must also work without the AI (offline, error): show a rule-based short version, and never block the rating or the saved ride.

## Garmin upload under the rider's control (requested live, 2026-11-02)

Upload rides to Garmin Connect from the FIT files in `rides/exports/`, with the rider deciding whether and what:

- Off by default, a setting per profile. Nothing leaves the Mac without it being switched on.
- Choice per ride: an upload button on the feedback screen and in the history, showing whether a ride is already uploaded.
- Optional setting "always ask" or "upload automatically". Possibly a minimum duration, so test rides stay local.
- Verify first that `garminconnect` can upload activities; it is an unofficial API, so a failed upload stays marked as open and can be retried. A ride stays safe locally either way, and an upload never blocks ending a ride.
- Remember uploaded rides, so nothing goes up twice.
- The coach must recognize its own uploaded rides in the Garmin data and not count them again as load from other sports. Warn about duplicates if a watch recorded the same ride.

## Main window hidden after the ride (seen live, 2026-11-02)

The film window floats over a fullscreen video on every Space, but the main window stays on its own Space. When a ride ends the film window only says "Keine laufende Fahrt" and the rating is out of sight. Wanted: when the ride ends, the film window offers a button that brings the main window forward, without pulling the rider out of the video by itself. Needs `src/main/**`, so it goes with the next restart.

## Transparency about the AI (requested 2026-11-02)

- Token usage: show what the coach's AI calls use, per coach and over time, and which call used how much.
- AI login: show in the app which account `claude` is logged in with, and whether the login works.

## Mountain stops moving while the main window is hidden (seen live, 2026-11-12)

`PassView` moves the rider with a 1 s `setInterval` and caps each step at 5 s (`Math.min(5, …)`). When the film window covers the main window, Chromium throttles the hidden window's timers (after a few minutes to about once per minute). Each late tick then adds only 5 s of riding, so most of the distance is lost and the mountain looks frozen.

- Drive the position from the ride itself, not from a UI timer: the service already has every second's power, so it (or the UI from `engine.rideElapsedS`) can integrate the distance without gaps.
- At least: integrate the full gap since the last tick instead of capping at 5 s, and set `backgroundThrottling: false` on the main window (`src/main/index.ts`).
- Needs `src/main/**` or `src/service/**`, so it goes with the next restart, not during a ride.
