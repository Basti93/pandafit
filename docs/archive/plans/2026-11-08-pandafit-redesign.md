# Pandafit Redesign and Panda Coach Implementation Plan

> **For agentic workers:** Use superpowers:executing-plans to implement this plan task by task. Use superpowers:subagent-driven-development if the user explicitly delegates the implementation that way. Track the checkboxes and keep each task independently reviewable.

**Goal** — Carry the training-journal design into the real Pandafit web and Mac apps, with Panda as the face of the existing coach and with every current training, planning and recovery path reachable.

**Architecture** — Restyle the current React entry points and shared controls in place. Ship the web journal and its static Panda first, extend the styling to secondary flows, then integrate a separately reviewable Canvas portrait. Restyle the Mac renderer independently. Keep state, data and commands in their current owners.

**Tech stack** — React 19, TypeScript, Vite PWA, Electron, shared tracking UI, CSS tokens, Vitest and Playwright. Canvas 2D and locally generated vector motion data for the web portrait.

**Design references**

- [Design and motion study](../../../design/reference/pandafit-panda-in-bewegung.html) (copied into the repo 08.11.2026). The HTML contains the original Panda drawing, motion poses, typeface bytes and visual tokens. Treat the app around it as a sketch with sample data.
- [Bike Coach design](../../superpowers/specs/2026-10-31-bike-coach-design.md), [Today day pages](../specs/2026-11-08-heute-day-pages-design.md), [strength plan preview and edits](2026-11-08-plan-preview-edit.md) and [web UX review](../ux-review/2026-11-08-synthese.md) describe the real flows. This plan covers design parity and animation. Use the code at implementation HEAD to resolve any drift between the review and the shipped behavior.
- [Panda drawing, clips and local Canvas conversion](../../../design/panda-rive/README.md).

## Global constraints

- “A ride is never lost.” Keep ride recording, recovery, device control, FIT export, AI fallback, sync, data shapes and account boundaries in their existing owners. The UI can fail independently of the ride.
- Check for an open ride before implementation or dependency changes. Follow `AGENTS.md`: during a ride no service restart, installation or changes to `src/service/**`, `src/shared/**` or `src/main/**`. Schedule the redesign outside the ride window. Use fixtures for screenshots and browser verification. The installed Mac app and real ride data are outside the test setup.
- Warm paper, forest green, restrained apricot and real training content carry the design. **Decision 08.11.2026: cards stay.** Restyle the existing `.card` surfaces with the new tokens instead of replacing them with thin rules. At wide widths, the session leads the left column and Panda sits to the right. At phone widths, keep the established reading order. Keep a single clear primary action per context and preserve the three to five existing web tabs.
- **Decision 08.11.2026: the display face is Shojumaru** (Google Fonts, SIL OFL; replaces Bambus Display). Use it on the wordmark, Panda's name and short page/section headings only. It sets everything in capitals and renders ß as „SS“; that is accepted. It has no `×`, so headings never carry measures like „4×8“; numbers, data and controls stay in the UI font. Bundle the WOFF2 locally with its OFL licence file (no Google Fonts request at runtime). Keep day and ride data visually stronger than the brand.
- **Decision 08.11.2026: Panda may be playful on Heute and in the coach chat.** Animations live only there; Kraft during a workout, Essen, Ausdauer, Profil and the Mac cockpit stay calm. More Panda animations are in production and will extend the gesture set (see Task 5).
- Panda is the face of the existing coach. Chat, proposals, explicit confirmations, offline queues and warnings stay as HTML. The example conversation and simulated ride controls from the mockup are design references.
- Check light and dark themes, 360 px and 390 px phones, a 320 px overflow check and a 1024 px desktop. Use minimum 44 px targets for main touch controls, accessible names, visible focus and the shared sheet close/back behavior. Keep native scrolling and keyboard input working.

## Inventory and design gaps

Audited at `29919c4` on 8 November 2026. The animated mockup covers the visual direction, a sample day, abbreviated tab content and a demo Mac interval. The table maps omitted or simplified real functionality to its intended place.

| Surface | What the mockup still needs to account for | Design placement and code owner | Task |
| --- | --- | --- | --- |
| Web shell and login | First login and install hint, boot and retry, no IndexedDB, reauthentication, offline, sync pending/refused, sign-out guard, push permission and unsupported browser, conditional Essen and Ausdauer tabs | Keep page-level alerts visible above content. Profil holds the sync/account rows. Keep the sticky mobile navigation and hide it when typing as today. `src/web/App.tsx`, `web.css`, `tokens.css` | 1, 4 |
| Heute | Open session from either device, finished today, rest, spontaneous mode, no plan, coach waiting or stale plan, day-specific Rad/Laufen, plan preview and edit, “Etwas anderes heute?”, finisher/mobility, waiting proposal | Open workout gets the first full-width row and “Weitermachen”. One training section uses real state. Put mobility/finisher under the day's essentials. Use `App.tsx`, `src/web/today/*`, `TodayCard.tsx` and `FinisherCard.tsx`. | 1 |
| Gestern / Morgen, body and Together | Yesterday's actual mixed activities or rest, read-only past meal details, next plan across Sunday/Monday, no meal/health data, doctor's note first, Together detail and back | Preserve the three-day arrows and touch swipe. Yesterday and tomorrow keep their existing date-specific rows. On today, “Dein Körper” and “Gemeinsam” remain conditional and Together is last. `src/web/today/*`, `MealsScreen.tsx`, `TogetherScreen.tsx` | 1 |
| Woche and coach | Plan vs spontaneous view, no-plan entry, chat history and compose, send error, pending proposals, accept/decline/undo with outdated/refused states, exercise/rule proposals, goal, time/rules/complaints, stats and health, merged activity history | Existing weekly list leads. “Panda fragen” opens the real coach sheet. Keep proposal review a separate decision surface. Keep goals/rules and Rückblick reachable from Woche. `CoachScreen.tsx`, `CoachChat.tsx`, `GoalRules.tsx`, `StatsScreen.tsx`, `ActivityHistory.tsx` | 2, 5 |
| Kraft before training | Preview plan, edit sets/reps/load, swap/add/remove, draft “Angepasst” and discard/stale notice, choose studio, routines or empty training, exercise catalog and history | Training/Routinen/Übungen stay as three sections under Kraft. The editable preview stays a sheet from both entry points. `WorkoutScreen.tsx`, `PlanSheet.tsx`, `StudioSheet.tsx`, `RoutinesScreen.tsx`, `ExercisesScreen.tsx` | 3 |
| Kraft during and after training | Set entry and completed sets, rest and optional effort question, next exercise, warm-up/superset where present, session edits, coach suggestions and guarded undo, active/offline resume, finish/cancel, summary and next step | Full-height training layout with readable inputs and one current exercise expanded. Keep summary/effort and confirmation flows. No moving Panda over the set UI. `WorkoutScreen.tsx`, `SetRow.tsx`, `WorkoutCoach.tsx`, `WorkoutSummary.tsx` | 3 |
| Essen | Week/day choice, portions and who eats, ingredients, preparation, changes, shopping states/own items, recipes search/filter/favourites, add by link, recipe placement with pending/error states | Days and shopping stay in existing sections, recipes and changes use sheets. Actual meal content and shopping states take precedence over brand graphics. `src/web/MealsScreen.tsx`, `src/web/RecipesScreen.tsx` | 4 |
| Ausdauer | Dated ride/run plan, ride details and history, FTP/development, run settings and first plan, complaint pause, manual run, Garmin plan transfer/confirmation/removal and progress | Existing Rad/Laufen switch, only when both are present. Rad shows “Fahren am Mac”. Plan, Verlauf and Entwicklung remain reachable. `BikeScreen.tsx`, `RunScreen.tsx`, `RunSettingsCard.tsx` | 4 |
| Profil | Planning toggles, connection status, Garmin login/MFA/reauth/upload settings, Hevy connect/disconnect, meal preferences, e-mail and coach notifications, push and logout | Group Konto/Planen/Verbindungen/Nachrichten with existing rows, switches and sheets. Preserve local sync wording and guards. `src/web/App.tsx`, `ConnectionSettings.tsx`, `ContactSettings.tsx` | 4 |
| Phone ride companion | Global strip, connected/paused/stale/ended, wake lock, watts/pulse/cadence, current/next interval, adjust/mark/skip with acknowledgement or failure and skip confirmation | Dedicated `LiveRide` sheet, distinct from the Mac cockpit. Preserve “Beenden am Mac” and “Keine Verbindung zum Mac. Die Fahrt läuft dort weiter und wird gespeichert.” Controls stay off when stale/ended. `src/web/LiveRide.tsx`, `live.ts` | 4 |
| Mac before a ride | Profile selection/creation and settings, trainer/pulse/clicker pairing, recovery offer, coach unavailable/rule-based plan, start, ramp test, alternatives, readiness, mountain choice, Garmin/Hevy/account, diagnostics | Keep Fahren and Profil. Put “Los” and the selected unit first, fallback and device state in clear text, recovery above all other actions. `src/ui/App.tsx`, `nav.ts`, `views/CoachView.tsx`, `ProfileView.tsx`, `RecoveryDialog.tsx`, `StatusBar.tsx` | 6 |
| Mac during and after a ride | Automatic pause/resume, reconnect and storage warning, target/actual/interval/time, heart zones/HR hold, grade/gears, clicker, sound, film mode, mountain, vocabulary, end/save/discard; debrief, feedback, charts, mobility, next ride, Garmin upload consent and backup status | Keep a high-contrast cockpit with current instructions and warnings taking precedence. Preserve compact film window and all controls. Give the saved ride summary its own surface. `src/ui/views/RideView.tsx`, `FilmView.tsx`, `FeedbackView.tsx`, `DebriefCard.tsx`, `GarminUploadButton.tsx`, `src/ui/pass/*` | 6 |

Paths without a directory in the Web rows above refer to `src/tracking/ui/` for tracking components and `src/web/` for shell, meals, connections and live companion.

## Review focus

- Open workout synced from a second device and a dated/stale plan compete for the same slot. The open workout wins and “Weitermachen” opens that session. Task 1.
- A proposal or draft goes stale on a different device or after a plan refresh. The current refusal or discard path remains visible and never starts/applies the wrong plan. Tasks 2 and 3.
- Optional modules are off or the service worker has only the previous build cached. The correct tabs and first-use states still render. A missing Canvas chunk, unsupported vector drawing or reduced motion leaves a static portrait and usable chat. Tasks 1 and 5.
- Phone relay goes stale or the current ride/step changes with a skip confirmation already open. The old confirmation cannot skip anything. Task 4.
- Storage warning, trainer loss or recovery overrides friendly copy during a Mac ride. Existing recovery and save/discard actions remain reachable and send the same messages. Task 6.

## Task 0 — Establish a baseline

- [ ] Read `AGENTS.md` and the linked specs. Record `git rev-parse --short HEAD`, `git status --short --branch` and the ride state. Start from a suitable clean checkout at execution time. Preserve unrelated staged/untracked files and ongoing work. The plan-preview merge `29919c4` is part of the baseline.
- [ ] Run `npm run typecheck`, `npm test` and `npm run test:web-smoke` in a permitted local environment. Record pre-existing failures separately. At the audit baseline, typecheck and 111 focused tests passed (Today, day navigation, live companion, plan sheet, week proposals, active strength, Mac ride and feedback). The sandboxed full run hit EPERM on local sockets and pipes. Recheck the full baseline in an environment that allows the test listeners.
- [ ] Capture the state inventory with existing fake-data harnesses. Use `npm run ui:web-shots -- /tmp/pandafit-web-before` and `npm run build && npm run ui:shots -- /tmp/pandafit-mac-before`. For the web reruns use `SHOTS_SIZE=360x800`, `SHOTS_DARK=1` and `SHOTS_EMPTY=1` as appropriate with separate output directories. Inspect the important states in the table rather than treating generated files as review.

## Task 1 — Web journal, shell and static Panda

**Files** — `src/web/App.tsx`, `src/web/web.css`, `src/web/tokens.css`, `src/web/today/{CoachLine,DayHead}.tsx`, new `src/web/public/brand/{shojumaru.woff2,OFL.txt,panda-still.svg}`, `tests/web/{app,heute-day,heute-yesterday-tomorrow}.test.tsx`, `scripts/web-shots.ts`.

**Interface** — Extend `CoachLine({ text, onAsk }: { text: string; onAsk: () => void })`. Use `Heute.goCoach` for “Panda fragen”. Reuse the existing “Ansehen und anpassen” and “Weitermachen” handlers.

- [ ] Extend the tests with a 2-device fixture. When `endMs === null` on the synced latest workout, assert “Weitermachen” opens that workout and neither a new workout action nor “Ansehen und anpassen” appears. Assert the new “Panda fragen” button opens the existing real composer, and is absent on Gestern/Morgen.
- [ ] Run `npx --no-install vitest run tests/web/{app,heute-day,heute-yesterday-tomorrow}.test.tsx`. Confirm the Panda CTA test fails before changing the code. Keep the existing assertions for day boundaries, swipe exclusions and health priority.
- [ ] Add the local TTF and a transparent still derived from the approved Panda artwork, with headband and mug. Style the top rail/desktop tabs, mobile bottom tabs and the Today day header. Style the desktop columns with CSS; keep semantic order open workout, coach, training, meals, mobility, body, together. Use the existing optional tab and day predicates. Preserve waiting proposal, finisher and open-ride strip.
- [ ] Re-run the focused tests and `npm run build:web`. Capture the Today cases in light/dark at 360 px and desktop, including first use, running, rest, completed and edit preview. Confirm open workouts and high-priority messages beat decoration.
- [ ] Commit the independently shippable static journal.

## Task 2 — Woche and actual Panda conversation

**Files** — `src/tracking/ui/{CoachScreen,CoachChat,GoalRules,StatsScreen,ActivityHistory}.tsx` only where markup needs an existing surface exposed, shared `tracking.css` and `kit` styles, `tests/tracking/{coach-screen,week-take,frame-ui,kit}.test.tsx`.

- [ ] Preserve or extend assertions that a pending proposal does not change `weekplan` before “Übernehmen”, and a stale take or undo still shows the existing refusal. Verify “Panda fragen” opened from Heute and “Coach” from Woche use the same chat, and nested proposal sheet back/escape leaves the composer open.
- [ ] Re-run `npx --no-install vitest run tests/tracking/{coach-screen,week-take,frame-ui,kit}.test.tsx` and the Today entry test. Establish the regression baseline before styling.
- [ ] Retain the weekly list, spontaneous mode, single coach thread, pinned proposal sheet and mobile composer. Use Panda as speaker/title where appropriate without duplicating the message history. Render goals, rules, complaints, changed notes and Rückblick using the existing rows. Leave health descriptions and alerts in the existing components.
- [ ] Re-run the focused tests. Review a long thread with the keyboard open, multiple proposals, stale/refused actions, no plan and Rückblick without a training record. Commit.

## Task 3 — Strength plan and workout

**Files** — `src/tracking/ui/{WorkoutScreen,PlanSheet,WorkoutCoach,SetRow,WorkoutSummary,RoutinesScreen,ExercisesScreen}.tsx` where markup needs it, `tracking.css`, `tests/ui/plan-sheet.test.tsx`, `tests/tracking/{plan-draft,live-workout,workout-coach,summary-and-feel}.test.*`.

- [ ] Run the named tests. Confirm they cover plan draft invalidation, the edited reps/weight reaching the workout, a blocked undo after a completed set and the existing finish flow. Add a missing parity assertion only if the behavior is untested.
- [ ] Carry the journal's typography and row treatments into the three Kraft tabs, studio/plan/routine sheets, active exercise, rest controls and summary. Keep edit, start, resume, local save, end and discard commands in their existing handlers. Keep the two strength entry paths to the same plan sheet.
- [ ] Re-run the named tests and the web smoke. Inspect open workout, long exercise names, changed plan, a completed set, rest, coach change confirmation and finish on a 360 px fixture with keyboard. Commit.

## Task 4 — Secondary web flows and the phone ride companion

**Files** — `src/web/{MealsScreen,RecipesScreen,ConnectionSettings,ContactSettings,LiveRide}.tsx`, `src/web/web.css`, `src/tracking/ui/{BikeScreen,RunScreen,RunSettingsCard}.tsx` as needed, `tests/web/{connection-settings,push-ui,live-ride}.test.tsx`, `tests/tracking/{bike-screen,run-screen}.test.tsx`, `scripts/{web-smoke,web-shots}.ts`.

- [ ] Add a `tests/web/live-ride.test.tsx` case that opens “Überspringen?”, then advances past `LIVE_FRESH_MS` (10 s), ends the ride, switches rides or advances the current step. In each case assert the confirmation closes or becomes disabled and there are zero `client.command('skip')` calls. Reuse the fake clock and mocked client. Run the test first. The current nested confirmation stays actionable in some of these cases even though `LiveClient` already refuses stale/ended commands.
- [ ] Restyle the existing meal, shopping, recipe, endurance and profile surfaces. Keep module flags, consent and action handlers in place. In `LiveRide.tsx`, reuse the distinct sheet and capture `{ rideId: string; stepIndex: number }` when opening confirmation. Guard the final skip against the latest snapshot, captured ride and step, freshness, end, pause and final-step conditions. A stale sheet retains the existing explanation and no longer exposes a usable skip action. Do not introduce a Mac-only action into this sheet.
- [ ] Run `npx --no-install vitest run tests/web/{connection-settings,push-ui,live-ride}.test.tsx tests/tracking/{bike-screen,run-screen}.test.tsx` and `npm run test:web-smoke`. Review recipe placement, own shopping item, Garmin confirmation, logout with unsent items and the companion's fresh, stale and ended screenshots. Commit.

## Task 5 — Panda animation in Web

**Decision 08.11.2026** — Pandafit plays the ten existing Panda clips with Canvas 2D. The editable RML remains the animation source. `python3 design/panda-rive/export-canvas.py` converts its paths and keyframes to `src/tracking/ui/panda-motion.ts` without running Rive. The app bundles the data in a lazy, precached same-origin JavaScript chunk.

- `greet` once when Heute opens, `listen` when the real chat opens, and `nod` on a newly arrived coach reply.
- The day clip plays once after the greeting. Use `bike` for riding, `run` for running, `flex` for strength, `yoga` for mobility or the finisher, and alternate `read` and `knit` on a plain rest day. Gestern, Morgen and open workouts have no day clip.
- `breathe` plays at most every 30–45 seconds while the portrait is visible and idle. Reduced motion and unavailable Canvas use the static portrait.

**Interfaces** — `PandaPortrait` takes an optional event with a gesture kind and unique ID. It owns scheduling, duplicate events, day choice and visibility. `mountPanda(canvas: HTMLCanvasElement): Promise<{ play(gesture: PandaGesture): void; dispose(): void }>` draws the rest pose, then asks the browser for frames only while a clip plays. Chat and training records stay in their current owners.

- [ ] When the artboard changes, regenerate the Canvas data and verify all ten gestures against the reference art. Keep the generated data and editable source together.
- [ ] Run `tests/tracking/panda-{canvas,day}.test.ts`, `tests/tracking/panda-portrait.test.tsx`, `tests/tracking/chat-nod.test.tsx` and `tests/web/heute-panda.test.tsx`. Keep the existing rules for duplicate events, clip order, reduced motion, chat history and cleanup.
- [ ] Run `npm run test:web-smoke` against the real static server and check the offline Panda greeting. Confirm the lazy Canvas chunk is in the service worker's build cache and that the web build has no Rive or WASM assets.

## Task 6 — Mac ride renderer and release verification

**Files** — `src/ui/style.css`, `src/ui/App.tsx` and existing `src/ui/views/` components where needed for layout, `scripts/ui-shots/run.ts`, `tests/ui/{ride-view,feedback-view,mac-slim,profile-settings,use-ride-reconnect}.test.tsx`, `tests/service/recovery.test.ts`.

- [ ] Pin storage-error and trainer-loss states using existing RideView fixtures. Verify both the warning and “Beenden” remain accessible, saving still sends `stop`, discard still requires the existing explicit path, and recovery still has the distinct resume/end choices. Run the named tests before styling.
- [ ] Restyle the ride renderer with a compact status band and large, tabular actual power, target and interval countdown. Preserve next/total, HR hold, auto-reduction, warnings and all controls, including keyboard shortcuts. Keep film mode legible in the compact window; retain mountain and vocabulary layout variants. On Fahren and the debrief, use the same brand typography with a static Panda where it helps orientation. Reuse the brand font and still through the renderer public directory configured in `electron.vite.config.ts`. Verify local packaged-path loading in the Electron screenshot run. Scope animated Panda to the web for this rollout.
- [ ] Run the named tests, `npm run typecheck`, `npm test`, `npm run test:web-smoke` and `npm run build`. Capture fake-data screenshots of profile picker, coach unavailable, recovery, plain ride, mountain, film, paused, missing devices, storage warning, save/discard, feedback and Garmin consent. Inspect the views before any installed-app or deployment step. Commit the Mac changes separately.

## Done when

Every row of the inventory has an owner and a passing interaction check or inspected fixture. The web journal uses the static portrait when Canvas is unavailable. The Mac cockpit can ship independently of the web styling. Report any remaining environment-specific test failure explicitly.
