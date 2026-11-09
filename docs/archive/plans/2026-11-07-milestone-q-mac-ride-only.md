# Milestone Q: The Mac app only for the bike

The web app is the main app. The Mac app is there for Bluetooth and the ride: pair, choose and start, ride, a short summary afterwards, and the ride settings. Everything else opens in the web app.

## Global Constraints

- **A ride is never lost.**
  - `src/service/**` stays untouched.
  - Recording, recovery offer, upload, restore and companion stay as they are.
- Before each task, check that no ride is open: `~/Library/Application Support/bike-coach/rides/live/current.jsonl` is older than 1 h, and no `rides/ride-*/meta.json` has status "open". If a ride is open, stop.
- **No feature is lost without a home.** A non-ride feature leaves the Mac only when the web app has it, or gets it in Task 1. If neither is possible, it stays on the Mac profile screen under "Verbindungen". List each case in the report.
- No npm install, no new deps, no push, no deploy, no ssh. Do not touch AGENTS.md or `.superpowers/`.
- Public repo: no personal data.
- Light UI with the kit.
- Commits end with `Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>`. `npm test`, `npm run typecheck`, `npm run test:web-smoke` and `npm run test:chaos` are green after each task.

## Today (exploration, verify)

- **Mac renderer:**
  - `src/ui/App.tsx` (routing).
  - Menu in `src/ui/nav.ts:24,61,76` (start|coach|rad|kraft|laufen|essen|verlauf|statistik|gesundheit|gemeinsam|profil) and `views/MenuBar.tsx`.
  - It imports `src/tracking/ui` screens at `App.tsx:20-27`.
- **Ride screens (keep):** RideView, RecoveryDialog, StatusBar, ProblemReport, FilmView, ProfileView, pass/*, WordCard, RouteProfile, WorkoutBar, FeedbackView, DebriefCard/DebriefView (RideCharts, GarminUploadButton), TrainingCard.
- **CoachView is mixed:**
  - the start part stays: next session, Los, Leichter/Härter/Kürzer;
  - the chat, MotivationCard, TogetherCard and MobilityCard go (the web has them);
  - ReadinessNote and the Garmin banner: decide per the rule above.
- **Non-ride screens (go):** Overview/TodayCard, Gym/Strength, the tracking sub-screens, Meals, Together, Statistik, HistoryView (the web has the rides under Ausdauer; the line "Alle Fahrten gesichert" moves to the start screen), CoachLog, LoadChart.
- **Settings:**
  - **Stay on the Mac profile screen** (they are ride settings or Mac-side by nature): FTP, birth date, heart-rate limit, avatar, profile delete, account link (AccountCard/MovingNote), Sprachen lernen, Berg.
  - **Check for each item whether the server coach uses it for moved profiles:**
    - Hevy key (HevyCard, stored in `hevy/<profileId>/api-key` on the Mac);
    - Garmin (GarminCard, HealthView, ReadinessNote, GarminProfileReview);
    - "Krafttraining starten" (gym enable);
    - MealSettingsCard (meal plan on).
  - **What happens to each item:**
    - If the server uses it, the setting moves to the web Profil (Task 1).
    - If the Mac process does the work, it stays on the Mac under "Verbindungen".
- **Web app URL:**
  - The account link URL (`src/coach/tracking/link.ts:15,88`) is the web app's address.
  - It is not in `AccountStatus` (`src/shared/coach-protocol.ts:27`).
  - External links pass `src/main/external-links.ts:2-8` (allow-list).
- **Unmoved profiles:** none exist on this Mac today, but the code must handle them. An unlinked profile can ride. Its profile screen says once: "Kraft, Laufen, Essen und Statistik gibt es in der Web-App – dafür das Konto verbinden."

## Tasks

### Task 1: The web app gets what only the Mac had (where the server uses it)

- Per the rule above, for example the Hevy key, the gym switch, the meal plan switch, and the Garmin health view or readiness note if the server has the data.
- Keep the web Profil calm: rows plus sheets.
- Tests.
- Commit: `feat(web): settings that only the Mac had`.

### Task 2: The slim Mac app

**Menu:** Fahren (start), Profil. Nothing else.

**Start screen:**
- the next session with Los, Leichter / Härter / Kürzer;
- the line "Alle Fahrten gesichert" / "N Fahrten warten auf Upload";
- the button "Web-App öffnen" (only with a link).

**After a ride:** the summary stays, plus "Mehr in der Web-App ›".

**Web-App öffnen:**
- `AccountStatus` gets the link's origin (https only).
- `external-links.ts` allows exactly that origin, taken from the coach, not a typed wildcard.
- It is tested.

**Clean-up:**
- Delete the non-ride Mac views, their tests and dead code. Keep anything still used by the web app, the coach or the remaining views; run the typecheck and search for imports.
- Update `tests/ui/nav.test.ts`, `coach-home.test.tsx` and `tests/coach/gym/own-history.test.ts` (it imports `homeScreen` from OverviewView: move that helper if still needed).
- The `src/ui` code that the service or the coach still needs stays.

**Docs and check:**
- Update CLAUDE.md "Mac app" (one line: the Mac is for riding, everything else is in the web app) and the README.
- Check how the Mac UI can be looked at without a bike (`npm run dev:sim`, or existing screenshot tooling for the Mac UI if any). If there is screenshot tooling, shoot the start, profile and after-ride screens to `/private/tmp/claude-501/mac-shots-q/` and look at them.

Commit: `feat(mac): the Mac app is only for the ride`.
