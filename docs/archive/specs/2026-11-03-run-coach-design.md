# Pandafit: the run coach

Status: approved in chat; the riders asked for autonomous implementation. "[Rider]" marks what the riders decided, "[Builder's call]" what was settled on their behalf and can be overruled.

## Why

One rider runs regularly and is driven by numbers. Numbers motivate her, but chasing a faster time on every run turns each run into a race, which is unhealthy and frustrating [Rider: "das kann auch schnell ungesund werden"]. Pandafit plans bike rides, strength and mobility, but knows nothing about running. Her runs already arrive through the Garmin sync and are unused.

The run coach is an optional extension [Rider]. It plans runs, evaluates them, and shows numbers that prove progress against herself, not against a stopwatch every day.

## Goals

- Show progress with numbers that stay healthy [Rider]: pace at an easy heart rate compared with 4 and 12 weeks ago, kilometres per week, longest run. Best times appear only for planned test runs.
- Show this right after a run (short) and in a weekly look back (trend) [Rider: "beides ist gut"].
- Plan runs [Rider: "Lauf Coach als Erweiterung"]. Get fit again first, then distance before speed [Rider].
- Coordinate runs with bike, strength and mobility, and respect open complaints.
- Send planned runs to Garmin as workouts, only after confirmation [Rider: yes; the standing rule "no automatic upload without confirmation before"].
- Make it work for any person, not only this household [Rider's standing rule].

## Non-goals

- No comparison between people, no rankings, no social features.
- No race-specific plans (marathon programs and the like) in this version.
- No recording of runs in Pandafit. The watch records, and Pandafit reads.
- No medical advice or diagnosis.

## Anti-goals

- A run becomes a race every time: the app never asks for a new record on an ordinary run.
- Guilt: a slower run is explained (heat, a hard day before, a short night if known), never judged. There are no streaks.
- Too much at once: the run coach must not stack hard running on hard leg days or ramp up volume quickly.
- A person without Garmin, or one who does not run, sees anything of this.

## Who gets it

Running is switched on per profile. It is suggested when the Garmin sync finds runs in the last 8 weeks, and it can be switched on by hand. Without Garmin data, switching it on asks a few short questions in the app: runs per week, usual duration, and whether there is any pain while running [Rider: "kann alles in der App abgefragt werden oder aus den Garmin Daten gelesen werden"]. A person without Garmin can also enter a finished run by hand (date, duration, distance, optional average heart rate) [Builder's call].

## Start point and plan [Builder's call, from the rider's goals]

- The start point is read from the last 8 weeks of runs: frequency, typical duration, longest run, and pace at an easy heart rate.
- Phase 1, "wieder fit": mostly easy runs at a conversational effort, with a heart-rate cap derived from max heart rate in the profile. Weekly time rises slowly, about 10 % per week at most, and every third or fourth week is lighter.
- Phase 2, "Distanz": the long run grows step by step. Most runs stay easy.
- Speed (intervals, tempo runs) is not part of this version beyond the occasional planned test run. The rider asked for distance before speed.
- A test run every 4 to 6 weeks (for example a steady 5 km or 30 minutes at an even hard effort) gives a fair best time. It is planned on a fresh day and can be skipped.
- The coach states before each run which number counts today, for example "ruhig, Puls unter 145; schneller als im September bei gleichem Puls ist dein Fortschritt".
- The plan uses the existing pattern: rules make a plan, and Claude may adjust it inside the limits and explain it. When Claude is unavailable, the rule plan stands.

## Coordination with the other coaches [Builder's call]

- Each training day has one hard thing at most across bike, strength and run. No hard run the day after heavy legs, and no hard run before a planned hard ride.
- Total weekly load counts across sports, so a big bike week means a lighter run week.
- Open complaints in the knee, foot, ankle, shin, hip or lower back reduce or pause running, with no diagnosis. Closing the complaint restores the plan gradually.
- Mobility after a run focuses on calves, hip flexors and the back of the thigh, using the existing mobility list.
- "The bike coach never creates strength workouts" stays as it is. The run coach does not create strength or bike workouts either. It only takes them into account.

## The numbers [Rider's wish, builder's selection]

- **Pace at an easy heart rate:** the average pace of the easy parts of runs within a heart-rate band, smoothed over the last runs, shown against 4 and 12 weeks ago. Heat and hills distort it, so it is shown as a trend line, never as a verdict on one run.
- **Kilometres and time per week**, against the plan.
- **Longest run** in the current block, against the last block.
- **Best times** only from planned test runs.
- After a run there is a short card: what counted today, how it went, and one sentence from the coach. The weekly look back shows trends and the next week's focus.
- The look back sits beside the existing weekly summaries. Push notifications follow the existing rules, which are on by default.

## Sending to Garmin [Rider]

Planned runs can be sent to Garmin Connect as structured workouts (warm-up, main part with a heart-rate or pace target, cool-down) and scheduled on their day, so they appear on the watch. Nothing is sent without confirmation: the week's runs are shown with a "An Garmin senden" button, as the existing upload flow does. Changes to an already sent run require a new confirmation. Without a Garmin login this button does not exist.

## Where it runs

On the coach server from the server-coach work (`docs/archive/specs/2026-11-03-server-coach-design.md`), so plans are made with the Mac off. The phone and the Mac show the same screens. A new record kind is likely needed for run plans and manual runs. Older app versions must refetch it, as the kinds-signature fix does.

## Constraints

- Public repo: no names, real run data, tokens or hostnames in commits, tests or docs.
- Garmin stays optional, and there is a test for "not there".
- German text without guilt, pressure, streaks or comparisons, and without medical conclusions.
- "A ride is never lost" and the open-ride rules are unaffected. Nothing here touches ride recording.
- Built after the server-coach work is merged.

## Settled after the builder check [Builder's call; the riders asked for autonomous implementation]

- **Data per run.** The contract is the activity summary (distance, duration, average heart rate, elevation gain, typeKey) plus the downloaded FIT when it exists. The easy-pace metric uses the FIT's per-second heart rate and speed: seconds inside the easy band, after the first 5 minutes, on stretches without a steep grade. When there is no FIT or no heart rate, the run counts for kilometres, time and longest run, but not for the easy-pace trend. The card then says "ohne Puls" and nothing more.
- **Which runs.** `running`, `trail_running`, `track_running` and `treadmill_running` count for volume. Only `running` and `track_running` feed the easy-pace trend, because hills and treadmills distort pace. Walking and hiking do not count.
- **Hard and easy.** Each coach already knows its day: the bike session's planned type and the gym plan's muscle groups. A small shared helper rates a day as `easy`, `moderate` or `hard`, and `legs` is set when a gym day trains the legs. It reads existing plan data and changes no other coach's decisions. Run load is minutes, weighted 1 for easy and 2 for test runs. Weekly cross-sport load is total training minutes from all three sources: a week whose bike and gym minutes are above the person's 4-week average lowers the run minutes by that excess, by 20 % at most.
- **Complaints.** Complaints are free text. A region match (knee, foot, ankle, shin, Achilles, calf, hip, lower back, in German and English) extends the existing body-word matching. An active complaint pauses running, a healing one halves the run minutes and removes test runs. After the complaint is closed, the plan restarts at 50 % for one week.
- **Server branch.** Built after `feat/server-coach` is merged into main. It uses the runtime factory and the record sync as they are then. Run plans travel in a new record kind `run` (plan id `week-YYYY-MM-DD`, manual runs `manual-<uuid>`), with the kinds-signature refetch.
- **Garmin workouts.** The current bridge only reads. Checked on 2026-11-03: the installed `garminconnect` offers `upload_running_workout`, `schedule_workout`, `unschedule_workout` and `delete_workout`. A spike still comes first: check that the installed `garminconnect` library can create and schedule a running workout. If it cannot, the send button stays out and the rest ships. Sending replaces a run that was already sent: the old one is deleted, then the new one is created, both after confirmation. Garmin workout ids are kept in the plan record.
- **Heart-rate cap.** The cap is 75 % of the profile's max heart rate, the highest value seen, else the profile's entered value. Without a max heart rate, runs are planned by feel ("so, dass du dich noch unterhalten kannst") and by time. Heart rate is never required.
- **Horizon.** The plan covers the current week and is made on Sunday evening, or right away when running is switched on. It is remade when a complaint changes or a run is missed, but runs already sent to Garmin only change after confirmation. Running days come from the person's choice in the settings (weekdays, defaulting to the days they ran over the last 8 weeks). The questionnaire asks for them too.
- **Manual runs and duplicates.** A manual run and a Garmin run of the same type that overlap in time by at least half count once, and the Garmin one wins. Manual runs feed the easy-pace trend only when they have a heart rate. Even then they count as one value, with no samples.
- **Matching plan and run.** A run on a planned day matches that day's plan. A run on another day counts toward the weekly numbers as unplanned. A planned test run is a steady 30 minutes. Its best value is the distance covered in those 30 minutes, which works for any fitness level. Its result is the run matched to the test day.
- **Phases.** The plan moves from phase 1 to phase 2 when the person has run at least 3 times a week for 4 of the last 5 weeks without an active complaint. It moves back when there is a 3-week gap.
- **Look back.** It is a section in the existing weekly view, built from the same records. The push goes out on Sunday evening with the new plan, under the existing notification rules.

## Left to the builder

The exact heart-rate bands and how max heart rate is estimated when missing, the smoothing, the screen layout on phone and Mac, the record format, the Garmin workout format and scheduling call in the Python bridge, how manual runs are entered, and the order of the work.
