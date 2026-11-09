# Meilenstein X „Erster Eindruck“ Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development. Steps use checkbox (`- [ ]`) syntax.

**Goal:** A person who opens the web app for the first time understands what Pandafit can do and where to tap. The app gets simpler. No important function goes away.

**Architecture:** Web UI only (`src/web/**`, `src/tracking/ui/**`, shared label helpers in `src/shared/**` where a label lives there). No new record kinds and no server change, unless an item needs a field that already exists on the server.

**Spec:** `docs/archive/ux-review/2026-11-08-synthese.md` (84 items in 10 themes, 8 structure decisions, rejected and wrong lists). Method: `docs/archive/plans/2026-11-08-ux-review-method.md`. Each task names its spec items; the item text (Problem, Änderung, Dateien) is the requirement.

## Global Constraints

- Simpler, not more complex: a change that adds a control removes at least as much. No new features. Nothing from „Verworfen“ or „Falsch / nicht bestätigt“.
- No important function is removed. A function that moves keeps a path that a first-time person finds.
- UI copy is German, calm, short. No new numbers in the UI (Leitsatz „keine Zahlenflut“).
- A workout and a ride are never lost. Logging works offline.
- Light and dark scheme both work. Phone 360 px up to desktop 1440 px.
- `scripts/web-shots.ts` and `scripts/web-smoke.ts` must keep passing: update their labels and steps when a label or tab changes (`npm run test:web-smoke`).
- Tests: update tests that pin changed copy or layout; delete tests of removed UI paths; add a test for each new behavior (tab rules, empty states).
- Run `npm test` and `npm run typecheck` before each commit.

## Review Focus

1. A new account (no data): which tabs show, what Heute and Woche say, the path to Profil > Planen.
2. 360 px width: the tab bar, Kraft sub-tabs and long German words fit without overlap.
3. Dark scheme: every changed component uses the existing colour tokens, no hard-coded light colours.
4. Statistik moved into Woche: every former Statistik row (Gesundheit, Muskeln, Details, time per week) is still reachable.
5. The running workout: no change makes a set harder to log with one tap.

---

### Task 1: Tabs and page structure

Spec items: Entscheidungen 1, 2, 3, 4, 6 · 1.2 · 2.1–2.5 · 10.1 · 10.2.
- Tabs follow the profile switches (decision 2), fixed order Heute, Woche, Kraft, Essen, Ausdauer. Test the visibility rules for a new account and for each switch.
- Statistik becomes a „Rückblick“ block in Woche (decision 1); the tab goes away; every row stays reachable.
- Kraft sub-tabs: Entwicklung and Übungen become one „Übungen“ (decision 3).
- One page head pattern and one close pattern (decisions 4, 6).
- Bottom padding under the tab bar; wide screens keep head and sheets in the content column.
- Update `scripts/web-shots.ts` and `scripts/web-smoke.ts`.
- Commit: `feat(web): simpler tabs, Rückblick in Woche`.

### Task 2: First start and Heute

Spec items: 1.1, 1.3–1.9 · 3.1–3.6.
- Commit: `feat(web): a first start that explains itself`.

### Task 3: Woche

Spec items: 4.1–4.7 (Rückblick block from Task 1 stays as built).
- Commit: `feat(web): clearer week`.

### Task 4: Kraft in the gym

Spec items: 5.1–5.16. The running workout is used with sweaty hands: keep one-tap logging, keep touch targets ≥ 44 px.
- Commit: `feat(web): calmer strength screens`.

### Task 5: Ride companion

Spec items: 6.1–6.7. Wording on lost connection must calm: the ride goes on on the Mac and nothing is lost.
- Commit: `feat(web): ride companion in words`.

### Task 6: Essen

Spec items: 7.1–7.12 (decision 8 for the shopping week).
- Commit: `feat(web): simpler food screens`.

### Task 7: Ausdauer

Spec items: 8.1–8.8 (decision 7 for days on plan cards).
- Commit: `feat(web): clearer bike and run`.

### Task 8: Gesundheit, Profil, charts, dark scheme

Spec items: 9.1–9.10 · 10.3 · 10.4.
- Commit: `feat(web): ordered profile and readable health`.

### Task 9: Check and close

- [ ] Run `npm run ui:web-shots` for the variants A (390×844), B (360×740), E (dark) and F (empty account) into the scratchpad. Compare with the earlier shots. Fix what regressed.
- [ ] Add milestone X to `docs/roadmap.md` (row ✅ and a short brief: goal, method, what went, what is parked).
- [ ] `npm test`, `npm run test:web-smoke`. Commit `docs(roadmap): X done`.
