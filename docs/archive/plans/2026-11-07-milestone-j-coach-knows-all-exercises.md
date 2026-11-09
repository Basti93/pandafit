# Milestone J: The coach knows all exercises

Brief and acceptance: `docs/roadmap.md`, section "Meilenstein J — Brief".

## Global Constraints

- Before each task, check that no ride is open: the live file must be older than 1 h, and no `ride-*/meta.json` may have status open.
- No npm install, no new dependencies, no push, no deploy.
- Public repo: no personal data.
- The free-exercise-db is under the Unlicense (public domain). Its images are NOT committed; they are generated.
- A workout is never lost. Old workouts and records stay readable.
- Light UI: one line per item, plain German, and no number walls.
- General mechanisms only. Name examples appear only in tests and in exercise data.
- Commits end with `Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>`. `npm test` and `npm run typecheck` are green after each task. Tests pinning replaced behaviour are deleted.

## Today (from exploration)

- **Week chat** (`src/coach/chat/chat-coach.ts`):
  - There is no catalog block. `naechstesKrafttraining` (`nextExercises`, ~l.324) lists only the plan's exercises.
  - `readNextOps` (`src/shared/changes.ts:25`) drops the whole op list when a swap `toId` is unknown.
  - Rule drafts already retry once with `dataBlock('katalog', …)` when an exclude draft has no valid id (`needsCatalog` ~l.260, retry ~l.186).
  - The in-workout chat always sends the full catalog with `{id, titel, muskel, geraet}` (~l.231).
  - The catalog is `catalogOf(id) = mergeCatalog(EXERCISES, FEDB_EXERCISES, exercise records)` (`runtime.ts:196`).
- **Exercise model** (`src/shared/exercises.ts`): there is no movement-pattern field.
  - The fedb importer is `scripts/fedb-import.ts`. It reads `<clone>/dist/exercises.json` and drops `force`, `mechanic`, `category` and `images`. Its output is `src/shared/fedb-exercises.json` (660 entries).
  - Built-ins: 122 `x(...)` entries. AI and own exercises come in as `exercise` records.
  - `similarExercises` (`src/tracking/similar.ts`) guesses movement from title words.
- **Exclude:** `isExcluded` (`src/shared/excluded.ts`) matches ids, Hevy links and exact titles. The exclude rule body is `exerciseIds` 1–30 (`src/shared/personal.ts`, `MAX_EXCLUDED`).
- **Images:**
  - Only wger drawings for built-ins exist: `EXERCISE_IMAGES` (`src/shared/exercise-images.ts`), with files in `src/web/public/exercises/`.
  - `exerciseImages(id)` and `imageSrc(file)` are in `src/tracking/media.ts`. They render lazily in `ExerciseInfo`.
  - The service worker precache excludes `/exercises/*` (`vite.web.config.ts`).
  - The static server is `web-server/index.ts`; check `TYPES` and CSP for jpg.
  - The reference clone is `~/Projects/pandafit-references/free-exercise-db/exercises/<SourceId>/{0,1}.jpg` (~101 MB).
- **Navigation:**
  - The Kraft sub-nav (`src/web/App.tsx` ~l.165–175) has `screen` 'workout' | 'routines' | 'history'.
  - `ExercisePicker` (`src/tracking/ui/ExercisePicker.tsx`) is search plus muscle groups, with fedb entries behind "more".
  - `ExerciseInfo` shows images, the description and a YouTube link.
  - The Mac app has its own views in `src/ui` (leave them unless they share these components).

## Tasks

### Task 1: The week chat finds exercises in the catalog

- Generalize the existing retry: `needsCatalog` is also true when the next-change draft has a swap whose `toId` is not in the catalog. It is also true when the AI gives a swap with `toTitle` instead of an id.
  - Allow an optional `toTitle` in the AI schema. Resolve it by exact title, alias or Hevy title through `exerciseTitles` on the merged catalog before validating.
- **The retry** sends the same compact catalog block as the rule retry: `{id, titel, muskel}`, without excluded ones, built by one shared helper. Use it in both places, and in the in-workout coach too.
- **Prompt:** "Für Tausch fürs nächste Training: nenne toId aus katalog oder toTitle; kennst du die id nicht, nenne toTitle."
- After the retry, an op that is still unknown is not dropped silently. The answer gets the existing "Geht nicht: …" line ("Übung nicht im Katalog").
- **Tests (mocked AI):**
  - a swap with an unknown id, then the retry, then a valid change record;
  - a `toTitle` resolves without a retry;
  - an excluded target is refused;
  - still unknown after the retry → the "Geht nicht" line.

Commit: `feat(catalog): the week chat swaps from the whole catalog`.

### Task 2: Movement families and family exclusion

- **New module `src/shared/families.ts`.**
  - `FAMILIES`: a fixed list of `{ id, label }` (German). The ids are about: squat, lunge, hinge (deadlift family), hip-thrust, leg-press, leg-curl, leg-extension, calf, bench-press, incline-press, fly, dip, push-up, overhead-press, lateral-raise, rear-delt, row, pulldown, pull-up, curl, triceps, shrug, core, carry, other.
  - `familyOf(exercise)`: the data field `family`, else `'other'`.
- **`Exercise.family?: string`.**
  - Built-ins: set by hand in `exercises.ts` (data).
  - fedb:
    - the importer derives it from the English source name through a keyword table in `scripts/` (data generation, e.g. "squat" → squat, "romanian deadlift" → hinge);
    - unmatched entries are `other`;
    - regenerate `fedb-exercises.json`.
    - If regenerating is impossible (the clone is missing), add a one-off script that patches the json from the same table and commit the result.
  - AI exercise proposals and `exercise` records may carry `family` (validated against `FAMILIES`).
  - The catalog merge keeps it.
- **Exclude rule body** gets optional `families?: string[]` (1–5 ids from `FAMILIES`). An exclude rule needs `exerciseIds` or `families`.
  - `excludedIds` / `isExcluded`: an exercise is excluded when its family is in an active rule's families. Use one resolver, the same everywhere (planners, picker suggestions, start from plan, chat ops).
  - `other` can never be excluded as a family.
- **Chat rule drafts** may give `families`. The prompt says: "Will die Person eine Bewegung ganz meiden ('keine Kniebeugen'), nenne families; sonst exerciseIds."
- **UI:**
  - `RuleCard` and `RulesCard` show family rules as "Alle Varianten: Kniebeuge".
  - `RulesCard` "Übung ausschließen": after picking, offer two buttons: "Nur diese Übung" and "Alle Varianten (<Familie>)". The second appears when the family is not `other`.
- **`similarExercises`:** a same family counts as a movement match, before the title-word heuristic. Keep the heuristic as the fallback.
- **Tests:**
  - built-in squats share the family;
  - the importer table maps the example names;
  - a family rule excludes a variant added later (an AI exercise with the family);
  - `other` cannot be excluded;
  - the chat family draft;
  - the UI two buttons.

Commit: `feat(catalog): exercises have a movement family, a whole family can be excluded`.

### Task 3: Images for the exercise base

- **`scripts/fedb-import.ts`** keeps the source id as `fedbId` (or `images: string[]`, the source-relative paths) on each fedb entry. Regenerate, or patch as in Task 2.
- **New `scripts/fedb-media.ts`** (`npm run media:fedb`):
  - It copies the images of the imported entries from the reference clone into `src/web/public/exercises/fedb/<appId>-<n>.jpg`, resized with macOS `sips -Z 480` (no npm deps).
  - It skips files that already exist.
  - Without the clone, it prints a note and exits 0.
  - Add the folder to `.gitignore`.
- **`exerciseImages(id)`** returns the fedb images for fedb entries, when the entry has them, with the credit "free-exercise-db (gemeinfrei)".
  - `ExerciseInfo` already loads lazily. A missing file hides itself (`onError`), so builds without the media still work.
- **`deploy.sh` and `npm run app`:** run `media:fedb` before the build when the folder is empty and the clone exists. Do not fail without it.
- **Check `web-server/index.ts`:** jpg is served and the CSP allows same-origin images. The precache keeps excluding `/exercises/*`.
- **Tests:**
  - `exerciseImages` for a fedb entry;
  - a missing image hides itself;
  - the media script's path mapping is a pure function (do not test the real copying).

Commit: `feat(catalog): exercises from the base show their pictures`.

### Task 4: The exercise catalog page

- **A fourth Kraft sub-screen, "Übungen"**, in `src/web/App.tsx`. The Mac app's Kraft view gets it too if it uses the same Training component; otherwise leave the Mac app alone.
- **New `src/tracking/ui/CatalogScreen.tsx`:**
  - a search field (`matchesSearch`);
  - then the muscle groups, collapsed, each with a count;
  - on opening, one line per exercise: the title with the equipment label, and the "ausgeschlossen" mark when excluded;
  - tapping opens `ExerciseInfo` inline, with the family label and two small buttons, "Ausschließen" and "Alle Varianten ausschließen". Both write exclude rules through the same helper as `RulesCard`, with source person.
  - For an excluded exercise, the button is "Wieder erlauben". It pauses or deletes the matching person rule, or tells the person which rule excludes it when it is a family rule from the chat.
  - fedb entries show without a "more" gate; search and the groups keep it manageable.
- **Shot:** add `catalog` to `scripts/ui-shots/run.ts`. It must render (`npm run build && npm run ui:shots -- /private/tmp/claude-501/ui-shots-j catalog`).
- **Tests:**
  - search filters;
  - a group opens;
  - "Ausschließen" writes the rule;
  - "Alle Varianten" writes a family rule;
  - the excluded mark;
  - "Wieder erlauben".

Commit: `feat(catalog): browse all exercises under Kraft, exclude from there`.
