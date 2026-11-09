# Pandafit: own strength tracking, web app and mobility

Status: awaiting the rider's approval. "[Rider]" marks what the rider decided, "[Builder's call]" what was settled on their behalf and can be overruled.

## Why

Pandafit is a household app for two people. Until now strength training needs Hevy: without it there is no strength page. The rider wants the app to do everything itself and Hevy to be only an extension [Rider]. In the gym the phone is what's at hand, so tracking must run there, installed like an app, and also in the Mac app [Rider]. The coach should also keep mobility in mind: welcome after a bike or strength session, never a must [Rider].

## Goals

- Log strength workouts as comfortably as in Hevy, on the phone and in the Mac app [Rider].
- The gym coach works for a person with no Hevy, from this own history.
- Hevy stays optional: connecting it adds its history and the routine export, and removing it loses nothing.
- Mobility offered by the coach, in the app, without Hevy [Rider].

## Non-goals

- No registration, no strangers, no sharing, no social features. Two accounts are enough [Rider].
- No product polish beyond what the two of us use: "we don't have to overdo it" [Rider].
- Bike rides do not move. Recording stays on the Mac, and the existing sync stays as it is.
- No AI on the server. No native phone app. No push notifications in this version.
- No mobility in Hevy or Garmin [Rider].

## Anti-goals

- A workout in progress is lost: through a dead spot in the gym, a reload, a phone lock or a closed tab. This is the equivalent of "A ride is never lost" and has the same weight.
- Rides, Garmin data or keys become reachable from the internet.
- Gym tracking slowing down or endangering a ride.
- Pressure: no streaks, no comparison between the two people, no guilt text.

## Tracking

Same concepts as the existing `GymWorkout` and `StrengthWorkout`: exercises with sets, set types (warmup, normal, failure, drop set), weight, reps, supersets, notes. A workout is started from the coach's plan, from a saved routine or empty.

In a running workout:
- Each exercise shows the values of last time, prefilled from the plan or history. One tap confirms a set, numbers are quick to change.
- A rest timer starts after a set, with no sound dependency.
- The screen stays on while a workout runs, where the browser allows it.
- Exercises can be swapped, added and removed during the workout. What really happened counts, not the plan.
- Every change is saved locally straight away.
- Saved routines can be created and edited.
- A history of past workouts per exercise, with last values and a simple progress view. Past workouts can be edited and deleted.

Exercise list [Builder's call]: Pandafit brings its own list of common gym exercises with muscle group, equipment and type, German names first, about 100 to start. Anyone can add their own. Hevy's 491 templates cannot be the base, because a person without Hevy has none. Where an exercise matches a Hevy template, it stores that id, so existing history and the Hevy export keep working. Unmatched Hevy exercises from an import become own exercises.

## Web app and installation

The web app is a PWA: installable to the home screen, opens full screen with its own icon (a panda), works offline after the first load [Rider]. iPhones install through Share, "Zum Home-Bildschirm". The page tells how, once.

The UI is shared React code with `src/ui` where it fits, with its own entry point and build for the PWA and service worker, so live changes to the ride interface do not reach the phone. The Mac app shows the same tracking screens and talks to the same server. Without a network, or without a server config, the Mac app logs locally and catches up later.

Offline and sync [Builder's call]:
- Devices store in the browser's IndexedDB (in Electron likewise) and send changes in the background. A workout never waits for the server.
- Ids are generated on the device and sends can be repeated with no duplicates.
- Two devices changing one workout: per workout, the last change wins, with a kept copy of the overwritten version on the server. With two people each on their own data this is rare enough.
- The storage of an installed PWA is asked to be persistent. If the server has not confirmed a finished workout, the page shows that calmly, and does not drop it.
- A new app version does not reload during a running workout.

## Server and access

Like the Dog Territory setup [Rider]: its own Docker Compose project on the home server with its own Tailscale sidecar node, Tailscale Funnel on 443, with the rules in `~/SERVER.md` on the server (occupied ports table, memory limits, log rotation, no touching of the host node, no pruning). Reachable from the phone without Tailscale, but useless without a login [Rider: not meant to be open to others].

Separate from the existing sync node [Builder's call]: Funnel opens a whole node, and the sync node holds rides and stays tailnet only. So a new node `pandafit` runs only the web app and its own SQLite database with the training data. If this service had a hole, rides, Garmin data and Hevy keys would still not be there.

Container like Dog Territory: read-only file system apart from the data volume, no capabilities, limits on memory and CPU, port only on 127.0.0.1, no secrets in the process it does not need. Backup once a day with the pull to the Mac, as the existing `server/backup.sh` and `server/mac` do. A restore has been tried once before use. Kill switch documented: stop the service, or remove `AllowFunnel`. Key expiry off for the node, or Funnel silently dies after about 180 days.

Login [Rider: two people; details Builder's call]:
- Two accounts, created by a command on the server. There is no registration route.
- Passwords stored with scrypt. Session in an HttpOnly, Secure, SameSite=Strict cookie, valid for 90 days, renewed on use. A phone stays logged in.
- Attempts limited per IP and account, with the client IP read as in Dog Territory (only trusting the sidecar network).
- Each person sees only their own data. An API test covers this for every route.
- No page or API answer without a login except the login page itself, static files and `/healthz`.
- The Mac app links a profile by logging in once: server address, name, password. The server then issues a device token bound to that one account, which the Mac stores per profile in the data folder, never in the repo. It uses the public address with the same limits as the phone, and a command on the server can revoke it [Builder's call].

## Coach

Storage on the Mac [Builder's call]: the coach process keeps its own local store of workouts in the data folder, and this is what the coach reads. It syncs with the server when a profile is linked, and works alone when not. So `src/service/**` and `src/main/**` stay out of it, and the Mac app's tracking screens talk to the coach process like the other pages do.

A profile is linked to one account through the login above. `GymCoach` reads a merged history instead of Hevy only: own workouts plus, if connected, Hevy workouts, without counting one twice. `gym` in the coach state is no longer null without Hevy: it is null only if a profile has neither account nor Hevy. A profile with neither sees everything as today.

AI stays on the Mac [Rider's existing rule: `claude -p` on the Mac]. The Mac reads workouts from the server, plans and sends the plan and the coach's note back. The phone shows the last plan with its date. When the Mac is off, the phone still works fully and logs against the last plan. A plan is not produced then. The rule workout could run on the server too, but stays on the Mac for one implementation only [Builder's call].

The limits of `src/coach/gym/limits.ts` and `checkWorkout` keep applying to all plans. With no Hevy templates, the own exercise list is the template list.

Hevy as an extension: its data is imported into the merged history. The Mac uploads imported Hevy workouts to the person's account, so the phone can show last values from the whole history; the Hevy key itself never leaves the Mac [Builder's call]. A Hevy workout keeps its Hevy id, and a Pandafit workout overlapping it in time by at least half counts once, with the Pandafit one winning. Routine export keeps using Hevy template ids; an exercise without one is left out, and the preview says so. "Nach Hevy" stays with its preview and confirmation, only for those who connected it. No workout logged in Pandafit is pushed to Hevy automatically; whether that is wanted is left for later [Builder's call].

During an open ride the existing rule applies on the Mac: no planning, no calls. Syncing tracking data waits too. The server and phone do not know about rides and need not.

## Mobility

Research summary: over weeks, stretching measurably improves range of motion. Static and PNF stretching did better than dynamic, and volume, intensity and frequency made no clear difference (Konrad 2024). Strength training did as well as stretching (Afonso 2021). Gains partly remain after 2 to 6 weeks off (Konrad 2025). Stretching after training did not reduce soreness (Afonso 2021, weak data) and showed no injury prevention (Lauersen 2014, few studies).

So the coach offers it as training for mobility, and never promises quicker recovery or fewer injuries.

Behaviour [Builder's call, agreed in chat apart from the Hevy part, which the rider ruled out]:
- After a bike or strength session, a card offers a short session if none was done in the last 2 days. That is about two to three times a week. After strength training with full range of motion, it may leave it out.
- 5 to 10 minutes, 3 to 5 exercises from a fixed list, each with a short description. Mainly calm stretching. The duration is a choice, not a research figure.
- Focus: after riding hip flexors, back of the thigh, calves and chest. After strength the muscles that were used.
- One tap on "Gemacht". Skipping needs no answer and nothing moves to another day.
- Open complaints leave out that area, for both coaches, with no diagnosis.
- About every 6 weeks the coach asks once whether it feels more mobile. No score and no streak.
- The AI picks only from the list and rules take over when it is unavailable.

Mobility history, the 6-week question and open complaints are kept locally on the Mac and synced like workouts, so the 2-day rule works offline and a finished session shows on both devices. Complaints already exist in the coach; the phone shows the open ones and can add or close them, and these changes reach the Mac at the next sync.

The mobility card lives on the bike page and on the strength page, in the Mac app and on the phone. "Gemacht" syncs like a workout.

Both coaches may suggest mobility. This is no exception to "the bike coach never creates strength workouts".

## Constraints

- A ride is never lost. Nothing here touches `src/service/**` beyond what is needed, and nothing during a ride. Everything server-related is optional: with no config the app runs locally as today.
- Hevy and Garmin stay optional. Each integration has a test for "not there".
- Public repo: no names, hostnames, tokens or real data in commits, tests or docs.
- The Mac app keeps its data folder `bike-coach`.
- German text without guilt, pressure, streaks or comparisons, and no medical conclusions.

## Left to the builder

Tech stack on the server (following the existing `server/`), screen layout and details of the screens, table structure, sync protocol details, icon, exact exercise list, merging of existing Hevy history into the new data on first start, and the order of the work. A sensible order puts mobility and the coach's data source on the Mac first, then the server and tracking, then the PWA shell.

## Sources

- Konrad et al. 2024, Chronic effects of stretching on range of motion, J Sport Health Sci: https://doaj.org/article/ac88f2436f38432d942f3a34ecd30e2a
- Afonso et al. 2021, Strength training versus stretching, Healthcare: https://repositorio.umayor.cl/xmlui/handle/sibum/9045
- Konrad et al. 2025, Detraining after stretching, Sports Medicine - Open: https://www.ncbi.nlm.nih.gov/pmc/articles/PMC12638565/
- Afonso et al. 2021, Post-exercise stretching and soreness, Frontiers in Physiology: https://www.frontiersin.org/journals/physiology/articles/10.3389/fphys.2021.677581/pdf
- Lauersen et al. 2014, Exercise and sports injuries, BJSM: https://bjsm.bmj.com/content/48/11/871
