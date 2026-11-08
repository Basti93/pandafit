# Style-Tokens Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development. Steps use checkbox (`- [ ]`) syntax.

**Goal:** One place for the web app's colours (light and dark), radii, font sizes and spacing; no hard-coded colour in `web.css` or `tracking.css`; the app looks exactly as before.

**Architecture:** A new `src/web/tokens.css` holds every design token on `:root` (dark is the default, light under `@media (prefers-color-scheme: light)`, as today). `web.css` imports it first. `tracking.css` keeps its `--tk-*` aliases in one block and uses tokens everywhere else. A test guards the rules.

**Tech Stack:** CSS custom properties, vitest (file scan), Playwright shots for the before/after check.

**Spec:** User wish of 08.11.2026 (`.superpowers/next-after-v.md`): „Style-System aufräumen: alle Farben als Tokens mit hell/dunkel (163 feste #-Werte in web.css/tracking.css), wenige Tokens für Abstände, Schriftgrößen, Radien; Mac-style.css bleibt getrennt.“ Autonomy granted by the user.

## Global Constraints

- **No visual change.** Screens before and after must render the same pixels in light and dark (the controller compares shots). Replace a value with a token only when the token has exactly that value.
- `src/ui/**` (Mac) and its `style.css` are not touched. `src/web/public/**` (icon, manifest) and `index.html` `theme-color` stay as they are.
- Colour tokens are named by role, not by hue (`--chip-warm`, `--seg-on`, `--switch-knob`, …). Every colour token has a dark value on `:root` and a light value in the light block — even when both are the same, write it once on `:root` and add a comment that it is shared.
- Few size tokens, only for values that occur often: radii (`--radius-s` .5rem, `--radius-card` 1.1rem, `--radius-pill` 999px, plus any other radius used ≥ 5 times), font sizes (the sizes used ≥ 5 times, named `--fs-xs` … `--fs-xl` by size), spacing (`--space-1` .25rem, `--space-2` .5rem, `--space-3` .75rem, `--space-4` 1rem). Replace only exact matches in `border-radius`, `font-size`, `gap`, `padding`, `margin`.
- `mask-image` black stops become the keyword `black` (not a token: it is a mask, not a colour).
- `npm test`, `npm run typecheck`, `npm run test:web-smoke` pass before each commit.

## Review Focus

1. The light scheme: a token defined only in the dark `:root` block makes a light screen keep a dark colour.
2. `!important` overrides in the light block (`.tk-pick`, `.gm-bar`) must keep their effect.
3. Specificity: moving `:root` blocks between files must not change their order relative to rules that read them.
4. Charts and inline styles in TSX that read CSS variables by name (`var(--pc0)`, `var(--slot-…)`, `--tk-*`) still find them.
5. The meal-plan person colours and slot colours keep their per-scheme values.

---

### Task 1: Tokens file, replacements, guard test

**Files:**
- Create: `src/web/tokens.css`, `tests/web/style-tokens.test.ts`
- Modify: `src/web/web.css`, `src/tracking/ui/tracking.css`

- [ ] Write `tests/web/style-tokens.test.ts`:
  - no `#rgb`/`#rrggbb`/`#rrggbbaa` and no `rgb(`/`rgba(` in `web.css` or `tracking.css` (allowed: none);
  - every `var(--name` used in `web.css`, `tracking.css` and `src/**/*.tsx` is defined in `tokens.css` or in the `--tk-*` block of `tracking.css`, or is set inline by the component (allow-list the ones set from TSX, e.g. `--slot`, `--c`, found by grep);
  - every colour token defined on bare `:root` in `tokens.css` is also defined in its light block, or carries the comment `/* shared */` on its line.
- [ ] Run it; it fails.
- [ ] Create `tokens.css`: move the `:root` blocks (dark and light) from `web.css` into it; add role tokens for every remaining literal colour of both CSS files (`rgba(...)` included); add the size tokens. `web.css` starts with `@import './tokens.css';` (check how Vite bundles it; the import must come first).
- [ ] `tracking.css`: one block defines the `--tk-*` aliases from the global tokens; replace every `var(--x, #hex)` with `var(--x)` or the `--tk-*` alias; replace literal colours with tokens; replace exact size matches with size tokens.
- [ ] `web.css`: replace literal colours and exact size matches with tokens.
- [ ] Run the test, the full suite, typecheck and web-smoke.
- [ ] Commit `refactor(web): one tokens file for colours and sizes`.

### Task 2: Check and close (controller)

- [ ] Take shots light (390×844) and dark (`SHOTS_DARK=1`) after the change; compare byte for byte with the shots taken before (`cmp`). Look at every differing pair; fix until none differs, or explain a difference that is only antialiasing.
- [ ] `docs/roadmap.md`: a row and a short brief; in `.superpowers/next-after-v.md` mark the wish done.
- [ ] Commit `docs(roadmap): style tokens done`.
