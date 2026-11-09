# Milestone R: Health in the web app, evaluated on an evidence basis

Garmin health data, which today only the Mac shows (HealthView), goes into the web app. It is calm and evidence-based, with a weekly coach evaluation, and it never diagnoses.

## Global Constraints

- Before each task, check that no ride is open (`rides/live/current.jsonl` older than 1 h, no open `rides/ride-*/meta.json`); if one is open, stop.
- Do not touch `src/service/**`, AGENTS.md or `.superpowers/` (except the SDD ledger, if you keep one).
- No npm install, no deps, no push, no deploy, no ssh.
- **Public repo:** no personal data. Tests use invented values.
- **Light UI** (L design rules, kit): sentences first, numbers only on tap, no score, no traffic-light wall, no gamification.
- **Medical safety:**
  - Never a diagnosis. Never "du hast …".
  - Conspicuous findings say "ärztlich abklären lassen" with a calm tone.
  - Every rule has a source in the register.
  - The AI text may only rephrase the computed findings. It invents no numbers or causes.
- Commits end with `Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>`. `npm test`, `npm run typecheck`, `npm run test:web-smoke` and `npm run test:chaos` are green after each task.

## Today (from exploration; verify)

- **Fetching:**
  - `scripts/garmin/garmin_sync.py` fetches the daily stats, sleep, hrv, max_metrics, training_status and training_readiness endpoints into `garmin.db` `daily(date, endpoint, json)`.
  - `src/coach/garmin-db.ts:20-39` `toDay` extracts resting HR, HRV, sleep (+deep/REM, score), body battery, stress, VO2max, steps, Garmin readiness, acute load and recovery hours.
  - **Intensity minutes are in the stats JSON but not extracted:** add them (moderate + 2× vigorous, as Garmin and WHO count them).
- **Server:** the server runs the same runtime for moved accounts (Garmin sync in the coach container). The web app gets no health data today.
- **Readiness:** `src/coach/readiness.ts`.
  - Three rules: resting HR ≥ 5 bpm over the 28-day median on the last 2 days; external load spike; sleep < 5 h.
  - It feeds the bike rules, the prompts and `shared/today.ts` (`restingHrRaised`).
  - It is not in the policy register (`src/shared/training-policy/rules.ts`).
- **Mac:** HealthView (`src/ui/views/HealthView.tsx`, reached from the profile screen under "Verbindungen") and ReadinessNote (the start screen).

## Evidence base (put into the register with these sources; short German text per rule)

| Rule | Value | Source |
|---|---|---|
| `health.rhr-raised` | Resting HR ≥ 5 bpm above the personal 28-day median on 2 days in a row means "heute eher locker" (exists; move it into the register) | Buchheit 2014, Front Physiol 5:73 (judge changes against personal normal variation); Mishra et al. 2020 Nat Biomed Eng / Alavi et al. 2022 Nat Med (elevated RHR before illness; not a validated individual early warning) |
| `health.rhr-persist` | Resting HR ≥ 10 bpm above the personal median for ≥ 7 days → "Wenn das anhält, ärztlich abklären lassen." | same, conservative |
| `health.rhr-high` | Resting HR > 100 on ≥ 3 of the last 7 days → "ärztlich abklären lassen" (resting tachycardia definition) | Clinical definition of tachycardia (> 100/min at rest) |
| `health.rhr-longterm` | Trend over months only, as a sentence ("leicht gesunken seit …"). Higher RHR is a marker, not a cause. | Zhang et al. 2016, CMAJ 188:E53 (RR 1.09 per 10 bpm) |
| `health.vo2-trend` | VO2max only as a trend over ≥ 8 weeks, with a change of at least 2 ml/kg/min (≈ the device error); never shown as an absolute assessment | Kodama et al. 2009, JAMA 301:2024 (−13 % mortality per MET); wearable error 5–10 % (Firstbeat white papers; independent validations) |
| `health.steps-band` | Weekly average steps compared to 8,000–10,000 (under 60) / 6,000–8,000 (60+); above that, no extra praise | Paluch et al. 2022, Lancet Public Health 7:e219 |
| `health.activity-minutes` | Weekly minutes compared to WHO 150–300 moderate (vigorous counts double); muscle strengthening ≥ 2 days/week from the workout records | Bull et al. 2020, Br J Sports Med 54:1451 (WHO guidelines) |
| `health.sleep` | Sleep only when data exists; < 5 h on the day stays a readiness reason (exists) | existing rule |
| `health.not-used` | Body Battery, stress score and ACWR are not shown or rated (no independent validation, or methodologically disputed) | Impellizzeri et al. 2020/2021 (ACWR) |

Birth year / age for the step band: use the profile's birth date if it is known on the server; otherwise use the under-60 band.

## Design

### Record `health` (one per profile, id `health`, published by the coach runtime like `stats`/`bike`, only on change, never with a ride open)

- `today`: `{ level: 'normal'|'careful'|'unknown', reasons: string[] }`, which is the readiness.
- `findings`: `{ rule, text, tone: 'info'|'gut'|'achtung'|'arzt' }[]`, deterministic German sentences from the rules above.
- `weeks`: the last 52 ISO weeks of `{ week, rhr?, vo2?, steps?, activeMin?, strengthDays?, sleepH?, hrv? }` (medians or sums, rounded).
- `days`: the last 28 days of `{ date, rhr?, steps?, sleepH? }`.
- `coachText?`: `{ week, text }`, see below.
- `atMs`.
- It is at most 64 KiB, validated in `validate.ts`, and added to `RECORD_KINDS`.

### Weekly coach text

- **When:** once per ISO week per profile (Monday morning, or the first scan after it), and only when health data exists.
- **How:** the AI client the coach already uses (`homeserver-ai`) gets only the findings and the week summary.
- **Prompt:**
  - "Fasse in 2–4 kurzen Sätzen auf Deutsch zusammen. Keine Diagnose, keine neuen Zahlen oder Ursachen, nichts Dramatisches. Wenn ein Befund `arzt` ist, sage ruhig, dass es sinnvoll ist, das ärztlich abklären zu lassen."
  - The sources are named in the system text, not in the output.
- **Guard:**
  - Reject output with digits that do not appear in the input, or with words from a small diagnosis list ("Erkrankung", "Infektion", "Herzrhythmus", …), or longer than 600 characters.
  - On rejection or without AI, use a deterministic fallback (the findings joined).
- **Storage:** kept in the coach state file, so it is sent once per week and never re-generated in a loop.

### Web: Statistik › "Gesundheit ›"

- **Placement:** a row in the Statistik top area ("Gesundheit ›"), shown only when a `health` record exists.
- **Sheet "Gesundheit":**
  - The first line is the coach text, or the first finding.
  - Then up to 4 rows, each with one sentence and a small sparkline on tap (52 weeks; for resting HR also the 28 days):
    - Ruhepuls;
    - Fitness (VO2max), only if there is data;
    - Bewegung im Alltag (steps band + WHO minutes + strength days);
    - Schlaf & HRV, only if there is data.
  - At the end, a muted line: "Keine Diagnose. Grundlage: WHO-Empfehlungen und Studien zu Ruhepuls, Fitness und Schritten." plus "Quellen ›", a small sheet listing the register sources.
- **Heute:** when the readiness is `careful`, the existing day advice already says it. Nothing extra.
- Tone `arzt` findings show once as a calm row at the top of the Gesundheit sheet, not as a banner elsewhere.

### Mac

- Remove HealthView and its route; the web has it now.
- Keep ReadinessNote on the start screen (it is ride-relevant).
- `garmin-health` message: keep it only if something else uses it; otherwise remove it with its tests.

## Tasks

### Task 1: Health facts and the register

**Work:**
- Extract the intensity minutes in `garmin-db.ts`.
- New `src/coach/health/` with:
  - `weeksOf`/`daysOf`, the aggregation;
  - `findingsOf(days, weeks, profile, workouts, nowMs)`, the pure rules from the table;
  - the register entries with sources (`src/shared/training-policy/rules.ts`); move the existing readiness thresholds there without changing behaviour.
- Shared types and the reader in `src/shared/health.ts`; validation.

**Tests:** each rule with its edges:
- 2 vs 1 day raised;
- 7 days at +10;
- 3 of 7 days over 100;
- VO2 change under and over 2;
- the step band by age and without age;
- WHO minutes with vigorous counted double;
- strength days;
- missing data → no finding.

Commit: `feat(health): evidence-based health findings`.

### Task 2: The record and the weekly coach text

**Work:**
- `exportHealth`, like `exportBike` (on change only, never with a ride open, never throws).
- The weekly text with the guard and the fallback, stored once per week.

**Tests:** the record is written on change only; the size limit; the guard rejects invented numbers and diagnosis words and falls back; once per week; AI down → fallback.

Commit: `feat(health): the server publishes health and a weekly coach note`.

### Task 3: Web Gesundheit and Mac clean-up

**Work:**
- The Statistik row and sheet, the sparklines, the sources sheet.
- Seed `scripts/web-shots.ts` (shots `gesundheit`, `gesundheit-ruhepuls`, `gesundheit-quellen`, `gesundheit-arzt`) and look at them.
- Remove the Mac HealthView.
- Update CLAUDE.md/README if they mention it.

**Tests:** the row shows only with a record; the sheet content; the `arzt` row; the sources sheet; no Body Battery or stress anywhere.

Commit: `feat(health): health in the web app`.
