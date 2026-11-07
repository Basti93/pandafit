# Milestone S: Real recipes instead of only AI creations

The meal plan should use real, vegetarian recipes from a recipe collection on the private home server.

- **Collection:** it grows slowly (an external fetcher in the private heimserver repo delivers about 50 per day) and is unlocked for planning from 10,000 recipes.
- **Own links:** each person can add their own recipes by link, and those work at once.
- **Public repo:**
  - only generic code: an importer for schema.org Recipe data, storage, checks and UI;
  - no recipe data, no site-specific crawler, no site names in code, tests or docs.

## Global Constraints

- Before each task, check that no ride is open (`rides/live/current.jsonl` older than 1 h, no open `rides/ride-*/meta.json`); if one is open, stop.
- Do not touch `src/service/**`, AGENTS.md or `.superpowers/`.
- No npm install, no deps, no push, no deploy, no ssh.
- **Public repo:**
  - tests use invented recipes;
  - no real recipe texts;
  - no mention of specific recipe websites;
  - the recipe data lives only in the coach volume on the server (`<root>/recipes/`), never in git (check `.gitignore` and the Docker build context).
- **Vegetarian only:**
  - every imported recipe passes a deterministic check against a meat/fish word list in the register (Fleisch, Hähnchen, Speck, Schinken, Wurst, Hack, Fisch, Lachs, Thunfisch, Garnelen, Sardellen, Gelatine, Fischsauce, Brühe vom Rind/Huhn, …, with plurals and compounds, while "vegetarisch"/"veggie"/"Soja-" variants pass);
  - a hit means the recipe is rejected and counted as rejected.
- Light UI with the kit.
- Commits end with `Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>`. `npm test`, `npm run typecheck`, `npm run test:web-smoke` and `npm run test:chaos` are green after each task.

## Today (verify)

- **Meal coach:** `src/coach/meals/` (`meal-coach.ts`, `recipes.ts` with the built-in vegetarian `RECIPES` in the `Recipe` shape, `check.ts`, `prompt.ts`, `chat.ts`, `rules.ts`).
  - The AI creates dishes and `check.ts` validates them.
  - The built-in recipes are the fallback.
- **Shopping:** sections (`Obst und Gemüse`, `Kühlregal`, …), units, and the `raw` flag in `src/shared/meals.ts`.
- **Server:** the coach container runs the meal coach for the household (find where: household runtime).
- **AI:** the coach has an AI client (homeserver-ai).

## Design

### Collection store (server, coach volume)

- **Location:** `<root>/recipes/recipes.db` (node:sqlite, like other stores in the repo; check what is already used) or JSONL plus an index.
  - Each recipe is stored in the `Recipe` shape plus `{ source: 'collection'|'link', sourceUrl, importedAtMs, owner?: profileId (for link imports) }`.
  - It is deduplicated by URL and by normalized title + ingredient set.
- **Inbox:** `<root>/recipes/inbox/*.jsonl`. Each line is one schema.org `Recipe` object (as found in a page's JSON-LD) plus `url`.
  - The runtime picks up new files on its scan and imports line by line.
  - The file is moved to `inbox/done/`, or to `inbox/failed/` with a reason, so it is never imported twice.
  - The import happens only when no ride is open, and at most 200 recipes per scan.

### Import pipeline (pure, tested)

1. **Parse:** read the schema.org fields (`name`, `recipeIngredient[]`, `recipeInstructions` (string | HowToStep[] | HowToSection[]), `recipeYield`, `totalTime`/`prepTime`/`cookTime` (ISO 8601 durations), `recipeCategory`, `keywords`, `nutrition.proteinContent`).
2. **Vegetarian check** (deterministic, see above).
3. **Normalize ingredients:**
   - a deterministic parser first ("200 g Mehl", "1 EL Öl", "2 Zwiebeln", "Salz und Pfeffer", "1 Prise …", "½ Bund …", ranges "2-3") into `{name, amount, unit, section}`;
   - per portion, divided by the yield;
   - section by a word list in the register;
   - **AI only as a fallback:** when the parser leaves more than 20 % of the lines unclear, the AI client is asked to structure them. Its output is validated with the same checks as AI dishes (`check.ts`); without AI the recipe stays in a "pending" state and is retried later.
4. **Derive:**
   - minutes;
   - slots (by category and keywords: Frühstück / Mittag / Abend, the default being Mittag + Abend);
   - `proteinG` (from nutrition if present, else estimated from a small protein table per ingredient in the register; null if too uncertain, and a recipe without a protein estimate is never chosen for protein targets);
   - `keepsDays` (default 2 for cooked dishes, 0 for salads or eggs per word list);
   - `vegan`.
5. **Store**, and count imported, rejected (non-veg) and failed.

### Unlock

- Register value `meals.collection-unlock` = 10000 (the number of stored collection recipes, not counting link imports).
- Below it, planning uses the AI and the built-in recipes as today; link-imported recipes of the household are already candidates.
- From it, the meal coach chooses dishes from the collection plus the link imports:
  - filtered by slot, minutes, the person's food rules and dislikes (existing preferences), and protein;
  - by a deterministic shortlist (e.g. 30 candidates), with the AI choosing and combining from the shortlist only;
  - for the plan, the AI may only scale portions and suggest small swaps that the checks validate. The dish keeps its title and gets "nach Rezept" / "angepasst".
  - Invented dishes remain the fallback only when nothing fits, marked as `ai`.
- The meal card shows the source: a small muted "Rezept ›" link to `sourceUrl`, and for invented dishes "vom Coach".

### Link import (works at once)

- **Web Essen:** "Rezept hinzufügen ›" opens a small sheet with a URL field.
- **Server:**
  - fetches the page with a timeout of 10 s, at most 2 MB, https only, and no private IPs or localhost (an SSRF guard: resolve the host and refuse private ranges);
  - extracts the JSON-LD `Recipe` (also inside `@graph` and arrays);
  - runs the same pipeline.
- **Answers:**
  - "Gespeichert: <Titel>";
  - "Nicht vegetarisch – nicht gespeichert";
  - "Auf der Seite ist kein Rezept zu finden".
- **Limit:** at most 20 link imports per day and household.
- **Delete:** link recipes can be deleted from a "Eigene Rezepte ›" list.

### Status

- The web Profil, in the Essen area (where "Essen anpassen" is), gets a muted line "Rezeptsammlung: 1.234 von 10.000" before the unlock, and "Rezeptsammlung: 10.512 Rezepte" after it.
- A small `recipes` stats body is part of the existing meal records or the household state (choose the smallest fit; no new record kind if avoidable).

## Tasks

### Task 1: Pipeline and store

**Work:** schema.org parsing, the vegetarian check, the ingredient parser, the derive step, the AI fallback for unclear lines, the store with dedupe, the inbox processing with done/failed, and the register entries.

**Tests:**
- parsing all instruction shapes and ISO durations;
- the veg word list, including tricky ones ("Hähnchenbrustfilet", "Speckwürfel", "vegetarischer Speck", "Gemüsebrühe", "Fischsauce", "Sojahack");
- ingredient lines ("1 ½ EL", "2-3 Zwiebeln", "Salz, Pfeffer", "1 Dose (400 g) Tomaten");
- the yield scaling;
- dedupe;
- an inbox file being imported once and moved;
- a bad line failing without stopping the rest;
- never while a ride is open.

Commit: `feat(meals): a recipe collection from schema.org recipes`.

### Task 2: Link import and planning from the collection

**Work:** the endpoint and coach message for the link import with the SSRF guard and limits, the web sheet, the Eigene Rezepte list, the unlock logic and the shortlist planning, and the source on the meal card.

**Tests:**
- SSRF refusals (localhost, 10.x, 192.168.x, http);
- the size and time limits;
- JSON-LD in `@graph`;
- the non-veg answer;
- planning below the unlock ignores the collection but uses link recipes;
- above it, the plan picks from the shortlist and invents only as a fallback;
- the source link shows.

Shots `essen-rezept-hinzufuegen`, `essen-gericht-quelle`; look at them.

Commit: `feat(meals): plan with real recipes and add your own by link`.

### Task 3: Status

**Work:** the Profil line; tests; and a `web-server/README.md` paragraph on the inbox format (generic, no site names).

Commit: `feat(meals): show how big the recipe collection is`.
