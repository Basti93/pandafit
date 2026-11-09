# Milestone T: Browse recipes, with pictures and favourites

The recipe collection (milestone S) becomes visible in the web app. Each recipe has a picture and can be added to the plan. Each person can mark favourites, and the plan prefers them.

## Global Constraints

- Before each task, check that no ride is open (`rides/live/current.jsonl` older than 1 h, no open `rides/ride-*/meta.json`); if one is open, stop.
- Do not touch `src/service/**`, AGENTS.md or `.superpowers/`.
- No npm install, no deps, no push, no deploy, no ssh.
- **Public repo:**
  - no recipe data and no pictures in git or images (check `.gitignore` and `.dockerignore`);
  - no names of recipe websites or apps;
  - tests use invented data and tiny generated images (a few bytes of a valid JPEG/PNG header).
- **Light UI** following the L design rules and the kit:
  - one line per item;
  - calm chips;
  - sheets for details;
  - pictures are welcome here (a recipe browser lives from them), but no clutter.
- Commits end with `Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>`. `npm test`, `npm run typecheck` and `npm run test:web-smoke` are green after each task.

## Today (verify)

- **Server store:** `src/coach/meals/recipe-store.ts` (SQLite in the coach volume `<root>/recipes/`, inbox, states, `vegCheckedBy`), `recipe-search.ts` (`searchRecipes`, FTS5 + facets), `recipe-import.ts`, `recipe-link.ts` (link import with the SSRF guard: reuse it for picture fetching), `recipe-plan.ts` (shortlist planning).
- **Web side:** `src/web/MealsScreen.tsx`.
  - **Link import:** "Rezept hinzufügen ›" and "Eigene Rezepte ›" go through `mealplan` records (`link-<id>`, `recipe-<storeId>`).
  - The meal card shows "nach Rezept · Rezept ›".
- **How the web reaches the coach:**
  - records;
  - coach WebSocket messages via the web-server proxy (`src/web/coachLink.ts`, `web-server/coach-proxy.ts`).
  - **Search and pictures need request/response.** Prefer HTTP GET routes on the coach server proxied by the web-server with the existing auth (like `GET /rides`); find the cleanest existing pattern.

## Design

### Pictures

- **Inbox line:** it may carry `"imageData": "<base64>"` with `"imageType": "image/jpeg"|"image/webp"|"image/png"`, at most 400 KB decoded. The fetchers download the picture themselves, because some sources need keys. As an alternative the line may carry `"image": "https://…"`.
  - **Download rules for a URL:** pandafit downloads it at import with the link-import guard (https, public IP, 10 s, at most 1.5 MB).
  - **Type check:** only JPEG, WebP or PNG pass, checked by magic bytes and not by the header.
- **Link import:** take the JSON-LD `image` (string, array, or ImageObject.url); the same rules apply.
- **Storage:** `<root>/recipes/images/<recipeId>.<ext>`, written atomically. The size is not changed (no image library); a picture over the limit is skipped and the recipe is kept without one.
- **Serving:** `GET /recipes/:id/image` on the coach server, proxied for logged-in users of the household, with `Cache-Control: private, max-age=604800` and an ETag. A missing picture answers 404 and the UI shows a calm placeholder (a soft colour block with the first letter, no icon wall).
- **Backfill:** a recipe without a picture whose raw source has an `image` URL gets it fetched in the background, at most 20 per scan and never with a ride open.

### Favourites (per person)

- **Storage:** a record kind is not needed if one fits: store per profile in a `mealplan`-style record `fav-<storeId>` (deleted = not a favourite), or a single per-profile record `recipe-favs` with an id list. Choose the one that syncs most simply and survives offline toggling; explain the choice.
- **Planning:**
  - favourites of the people who eat the meal get a clear preference in the shortlist (a register value, e.g. weight ×3);
  - below the unlock, favourites are candidates like own recipes;
  - never the same favourite twice in one week unless the user put it there.
- **UI:** a heart toggle in the recipe view and in list rows (small, aria-labelled), and a "Favoriten" filter chip.

### Browse

- **Entry:** Essen › "Rezepte ›".
- **Screen:**
  - a search field;
  - chips (single row, horizontally scrollable): Favoriten, Eigene, Frühstück, Mittag, Abend, schnell, proteinreich, Saison (the current season);
  - the list: thumbnail (56 px, rounded), title, and a muted line "25 Min · proteinreich";
  - paged with "Mehr anzeigen" (20 per page).
- **Server:** `GET /recipes/search?q=&tags=&own=&fav=&limit=&offset=`, which uses `searchRecipes`, returns only plannable (AI-checked) recipes, and checks the household.
- **Recipe view** (full sheet):
  - the picture on top (16:9, cover);
  - title and muted facts (minutes · protein per portion · keeps n days);
  - tags as calm chips;
  - a portion stepper (1–4) that scales the ingredients;
  - the ingredients;
  - the steps;
  - the source link "Zum Originalrezept ›".
  - **Buttons:** primary "In den Plan ›" opens a small sheet to pick a day and slot of the current/next week, with the persons as in the plan; it replaces that meal and writes through the same path the chat/swap uses (find it), with the checks. Secondary: the heart.
- **Meal card in the plan:** a small picture when there is one; tapping the title opens the recipe view.

### Fetchers (private repo, done separately by Opus)

They will add `imageData`/`imageType`. pandafit must work with and without pictures.

## Tasks

### Task 1: Pictures on the server

**Work:** import (`imageData` / `image` URL), link import, storage, the GET route with proxy and auth, and the backfill.

**Tests:**
- magic-byte check;
- size limits;
- SSRF refusals reused;
- atomic write;
- the route needs auth and the household;
- 404 without a picture;
- backfill limits;
- no picture → the recipe is still imported.

Commit: `feat(meals): recipes keep a picture`.

### Task 2: Search route and favourites

**Work:** the search route, the favourites storage and sync, and the planner preference.

**Tests:**
- only AI-checked recipes;
- the household boundary;
- paging;
- the fav filter;
- favourites preferred in planning and not repeated within a week;
- offline toggle sync.

Commit: `feat(meals): search recipes and keep favourites`.

### Task 3: The web screens

**Work:** Rezepte browse, the recipe view, In den Plan, the heart, and pictures on meal cards.

**Shots:** seed invented recipes with generated colour-block pictures in `scripts/web-shots.ts`. Shots: `essen-rezepte`, `essen-rezepte-favoriten`, `essen-rezept`, `essen-rezept-in-den-plan`, `essen-tage` (with a picture). Look at them.

**Tests:** for each interaction.

Commit: `feat(meals): browse recipes with pictures and plan them`.
