# Rollender Essensplan Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Bo always keeps the next days planned (no Saturday plan any more). The shopping list always shows what is still needed for the next 7 days. Ticks stay until the meal is eaten. "Neu planen" replans from tomorrow and uses what is already bought.

**Architecture:** The storage stays per week (`week-YYYY-MM-DD`, `state-YYYY-MM-DD`), so the server needs no migration. A rolling window of days spans two week records. Pure day and window arithmetic lives in `src/shared/meal-window.ts`. The cross-week list, ticks and stock live in `src/shared/meal-list.ts`. Both are used by the coach and the web app. A tick stores *which meals it covered* (`cover`) in each week's state entry. The coach fills the gap up to `today + 7` on its tick. "Neu planen" is a `replan-…` record from the web app, answered by the coach like `place-…` records.

**Tech Stack:** TypeScript, React 19, vitest, jsdom, zod.

**Spec:** this plan (product decisions by the user, 19.11.2026) and `docs/superpowers/specs/2026-10-31-bike-coach-design.md` (top rule: a ride is never lost).

## Where the meal coach runs

- Server (`src/coach/server/household.ts`): one shared `MealCoach` once the household moved. `noOpenRide` is always true there. `tick({ plan: !quiet })`: no scheduled planning from 02:00 to 06:00.
- Mac (`src/coach/runtime/scan.ts`): `ownCoach.tick()` only while the meal plan is not moved yet (`mealsHere`). `noOpenRide` is real there.
- The web app talks to the coach only through `mealplan` records (`port.put`). It has no `canPlan`.

## Global Constraints

- Work in a git worktree off `main`: `git worktree add .worktrees/rollender-essensplan -b feat/rollender-essensplan main`, then `cd .worktrees/rollender-essensplan && npm ci`. No symlinks to ignored folders (`node_modules`, `out`, data). When all tasks are done, merge into `main` locally. Do not push.
- Tests: `PANDAFIT_UNSAFE_NO_FSYNC=1 npx vitest run <file>` per task; at the end `PANDAFIT_UNSAFE_NO_FSYNC=1 npm test`, `npm run typecheck`, `npm run lint`, `npm run build:web`.
- Module rules (`tests/architecture/boundaries.test.ts`): `src/shared` imports only `src/shared` and `src/ride-format`. `src/coach` never imports `src/web`, `src/ui`, `src/service`, `src/main`. `src/web` imports `src/coach` only as types. So every rule both sides need goes into `src/shared`.
- Record readers never throw: unknown or bad data is skipped (pattern: `readMealState`, `readPlaceRequest` in `src/shared/meals.ts`).
- Planning never with a ride open (`deps.noOpenRide()`), never next to another planning run (`this.planning`).
- UI copy: natural German, full sentences, no dash fragments. Exact strings are given in the tasks.
- No new settings. No new server endpoint. The `meals-replan` message type in `src/shared/coach-messages.ts` stays (the `week` field is ignored).
- Each task ends with its own commit (`feat(essen): …`, `test: …`). Attribution lines from the session apply.

## Von Claude entschieden

1. **Horizon:** Bo keeps today through `today + 7` planned (8 days). So the list "7 days from tomorrow" is complete also in the evening. `today + 7` is always in next week's record.
2. **Evening:** the list starts tomorrow once the last planned meal of today is over (`mealOver`: slot time + 2 h, as `MEAL_OVER_MS` today). Without a meal today the last slot counts as `abend` (21:00).
3. **Fill rhythm:** the coach fills at its first tick of each day (after 06:00 on the server). Usually this is one new day (3 meals, one small AI call). A slot that already has a meal (for example from "In den Plan" or the chat) is kept, not replanned.
4. **Bookkeeping:** `FileData.plannedUntil` (date key `YYYY-MM-DD`). An old file without it counts as planned through the Sunday of its newest plan week. `lastAuto` is no longer read or written.
5. **Cover model:** a tick entry `{ state, atMs, cover?: Record<mealKey, number> }` per week state. `cover` holds the amount per meal that the tick covered. The list compares per item the sum of needs with the sum of covers over the window meals (pooled), so one purchase covers the same ingredient in both week records. An entry without `cover` (old records, old clients, `meals-item` messages from the Mac) covers its whole week, as before. Untick (`offen`) clears the cover.
6. **Shown amount:** a partly covered item shows only the missing amount, as an open row. Pack rounding is not counted as stock (the cover is the need, not the pack).
7. **Re-tie only after "Neu planen":** after a replan, the bought amounts are moved onto the new dishes. After a single swap ("Tauschen", chat, "In den Plan") the cover stays on the meal key. This goes to the parking lot.
8. **"Neu planen" on the web:** a `replan-<id>` record. Several open requests are served by one replan. The button is not disabled on the web, because the web has no ride signal and the server coach never sees a ride. The Mac's own coach answers only with no ride open (existing guard). It is also answered in quiet hours, because a person asked for it.
9. **Stock in the planner:** bought, not yet used items (`stockOf`) go as a data block `vorrat` into the AI prompts and move fitting recipes to the front of the shortlist and the rule plan.
10. **Own items:** shown from all week records in view. A new one goes into the week of the last planned day of the window, so it lives longest.
11. **Essen start page:** "Der Rest der Woche" and "Nächste Woche" become one card "Die nächsten Tage" (tomorrow through the last planned day). "Diese Woche bisher" and "Letzte Woche" stay. The coach page week switcher (training, commit 2d4d2ef) is not affected.
12. **Commits:** Task 2 and Task 3 share one commit, because `stockOf` and `retieStock` sit in the same file as the list and share its need and cover helpers.
13. **Stock count:** `stockOf` sums the cover keys of an entry from `from` on, also when the dish on that key changed meanwhile (a swap keeps the cover on the key, decision 7). So a swap does not lose bought amounts.
14. **Chat week:** "Plan ändern" writes for the week of the first day the list shows (`firstWeek`: today until its last meal is over, then tomorrow). The old rule "from Saturday next week" is gone with the Saturday plan.
15. **Replan records:** the newest `LINK_KEEP` replan records are kept in `exportAll` for every synced profile, not in `keepRecipeRecords`, which only runs with a recipe folder.
16. **`MealCoach.setItem`** takes an optional `cover` (used by tests and by later callers that know it). The `meals-item` message from the Mac does not send one and keeps covering its whole week.
17. **Test clock:** the old tests that planned "the coming week" on Saturday 06:00 now run on Monday 09.11.2026 06:00, so the first tick plans the whole current week.

## Review Focus

1. **Week edge and clock change:** a window from Thursday to Wednesday, and the night of 25.10.2026 (end of summer time). Days are computed by keys, never by `+ 24 h`. Test in Task 1.
2. **Old and mixed records:** a state written by an old phone (no `cover`, or `cover` dropped on rewrite) must read and act like the whole week is covered. Test in Task 2.
3. **Same ingredient in both weeks:** it shows as one row, one tick writes into both week records. Test in Task 2.
4. **Placed meal in a gap day:** a meal put "In den Plan" on a day that is not filled yet survives the fill. Test in Task 4.
5. **Replan request during a ride or during a planning run:** it waits and is answered once afterwards. Two requests produce one replan. Test in Task 6.

---

### Task 1: Day window helpers

**Files:**
- Create: `src/shared/meal-window.ts`
- Modify: `src/web/essen/meals-view.ts:48-56` (`isOver` delegates to `mealOver`, `MEAL_OVER_MS` re-exported)
- Test: `tests/shared/meal-window.test.ts`

**Interfaces:**
- Produces:
  - `type DayRef = { week: string; day: number }` (week key Monday, day 0–6)
  - `dayRefOf(ms: number): DayRef`
  - `addDays(ref: DayRef, n: number): DayRef` (key arithmetic via `dateOf`/`dateKey`, like `tomorrowOf` in meals-view)
  - `dayKeyOf(ref: DayRef): string` (`YYYY-MM-DD`), `cmpRef(a, b): number`
  - `MEAL_OVER_MS = 2 * 3_600_000`, `mealOver(slot: Slot, nowMs: number): boolean` (moved from meals-view)
  - `splitByWeek(from: DayRef, to: DayRef): { week: string; fromDay: number; toDay: number }[]` (`to` inclusive, `toDay` exclusive; empty when `from > to`)
  - `type PlanWeek = { plan: MealPlan; state: MealState }`
  - `listStart(weeks: PlanWeek[], nowMs: number): DayRef`
  - `windowMeals(weeks: PlanWeek[], nowMs: number, days = 7): { week: PlanWeek; meal: Meal; at: DayRef }[]` (from `listStart`, `days` days, today's meals only when not over; sorted by date, then slot order)
  - `FILL_DAYS = 7` (planned through `today + FILL_DAYS`)

- [ ] **Step 1: Write the failing tests**

```ts
const at = (d: number, h: number, m = 0) => new Date(2026, 10, d, h, m).getTime(); // 19.11.2026 is a Thursday
it('adds days across Sunday and across the end of summer time', () => {
  expect(addDays({ week: '2026-11-16', day: 6 }, 1)).toEqual({ week: '2026-11-23', day: 0 });
  expect(addDays({ week: '2026-10-19', day: 6 }, 1)).toEqual({ week: '2026-10-26', day: 0 });
  expect(addDays({ week: '2026-11-16', day: 3 }, 7)).toEqual({ week: '2026-11-23', day: 3 });
});
it('splits a range into week parts', () => {
  expect(splitByWeek({ week: '2026-11-16', day: 4 }, { week: '2026-11-23', day: 3 }))
    .toEqual([{ week: '2026-11-16', fromDay: 4, toDay: 7 }, { week: '2026-11-23', fromDay: 0, toDay: 4 }]);
  expect(splitByWeek({ week: '2026-11-23', day: 1 }, { week: '2026-11-23', day: 0 })).toEqual([]);
});
it('a meal is over two hours after its time', () => {
  expect(mealOver('abend', at(19, 20, 59))).toBe(false);
  expect(mealOver('abend', at(19, 21))).toBe(true);
});
it('the list starts tomorrow once the last meal of today is over', () => {
  // weeks: a plan for 2026-11-16 with meals on day 3 (all three slots) and 2026-11-23
  expect(listStart(weeks, at(19, 20))).toEqual({ week: '2026-11-16', day: 3 });
  expect(listStart(weeks, at(19, 21))).toEqual({ week: '2026-11-16', day: 4 });
  expect(listStart([], at(19, 21))).toEqual({ week: '2026-11-16', day: 4 });
});
it('window meals: today only what is not over, then six more days', () => {
  const keys = windowMeals(weeks, at(19, 16)).map((x) => `${x.at.week}/${x.meal.day}-${x.meal.slot}`);
  expect(keys[0]).toBe('2026-11-16/3-abend');
  expect(keys).toContain('2026-11-23/2-abend');
  expect(keys.some((k) => k.startsWith('2026-11-23/3-'))).toBe(false);
});
```

- [ ] **Step 2:** Run `PANDAFIT_UNSAFE_NO_FSYNC=1 npx vitest run tests/shared/meal-window.test.ts`. Expected: FAIL (module missing).
- [ ] **Step 3:** Implement `src/shared/meal-window.ts` with the signatures above. In `meals-view.ts`, `isOver` becomes `export const isOver = mealOver;` and `MEAL_OVER_MS` is re-exported, so existing callers do not change.
- [ ] **Step 4:** Run the new test and `tests/web/meals-view.test.ts`. Expected: PASS.
- [ ] **Step 5:** Commit `feat(essen): Tagesfenster über zwei Wochen`.

---

### Task 2: Cover model and the rolling shopping list

**Files:**
- Modify: `src/shared/meals.ts` (`MealState.items` entry type, `withItem`, `readMealState`)
- Create: `src/shared/meal-list.ts`
- Test: `tests/shared/meal-list.test.ts`, extend `tests/shared/meals.test.ts` ("state merge and reading")

**Interfaces:**
- Consumes: Task 1 (`PlanWeek`, `DayRef`, `windowMeals`, `listStart`).
- Produces:
  - `type ItemEntry = { state: ItemState; atMs: number; cover?: Record<string, number> }`. `MealState.items: Record<string, ItemEntry>`.
  - `withItem(state, item, s, atMs, cover?: Record<string, number>): MealState` (cover stored only when `s !== 'offen'`).
  - `readMealState` keeps `cover` when it is an object: only keys with `parseMealKey(k)` and finite values `>= 0`. Anything else is skipped. `mergeStates` stays (whole entry wins).
  - `type WindowList = ShopList & { start: DayRef; lastDay: DayRef | null; people: number }`. `ShopItem` gets an optional `week?: string` (set for own items: the week whose state holds them).
  - `windowShoppingList(weeks: PlanWeek[], nowMs: number): WindowList`
  - `tickWrites(weeks: PlanWeek[], nowMs: number, key: string, state: ItemState): { week: string; cover?: Record<string, number> }[]`
  - `ownWeekOf(weeks: PlanWeek[], nowMs: number): string | null` (week of the last window day with a plan; else the current week if planned; else null)

Rules for `windowShoppingList` (same grouping, sorting, `SECTIONS`, pantry and `have` as `shoppingList`):
- Need per item and window meal: like `shoppingList` (source meals only, `cookPortions(...).total`, side included). A rest in the window whose source is before the window needs nothing.
- Cover per item and window meal: entry of that meal's week. `offen` → 0. With `cover` → `cover[mealKey] ?? 0`. Without `cover` → the full need (old entry covers its week).
- `remaining = Σ need − Σ cover`. `remaining > 1e-9` → row `offen` with `shopAmount(name, unit, remaining)`. Else the state of the newest (`atMs`) non-`offen` entry with cover > 0.
- `open` = rows with state `offen`. `total` = rows. `lastDay` = last window day with a meal. `people` = `plan.people.length` of the newest week in the window.
- Own items: from every week in `weeks`, not removed, with `week` set.

Rules for `tickWrites`:
- `gekauft` / `da`: one write per week that has a window meal needing `key`. Its `cover` = the need per window meal of that week, plus the old entry's cover keys outside the window that are not past.
- `offen`: one write without cover per week that has an entry for `key` or a window meal needing it.

- [ ] **Step 1: Write the failing tests.** Fixture: week A `2026-11-16` with `Tofu natur 100 g` at `4-abend` (eaters max, lena). Week B `2026-11-23` with the same at `0-abend` (max, lena). `now = at(19, 9)`.

```ts
const apply = (weeks: PlanWeek[], writes: ReturnType<typeof tickWrites>, s: ItemState, t: number) =>
  weeks.map((w) => { const x = writes.find((o) => o.week === w.plan.week); return x ? { ...w, state: withItem(w.state, KEY, s, t, x.cover) } : w; });
const row = (l: WindowList) => [...l.sections.flatMap((s) => s.items), ...l.have].find((i) => i.key === KEY)!;

it('sums the same ingredient across both week records into one row', () => {
  expect(row(windowShoppingList(weeks, now))).toMatchObject({ amount: '2 Packungen à 200 g', state: 'offen' });
});
it('one tick writes the covered meals into each week record', () => {
  const w = tickWrites(weeks, now, KEY, 'gekauft');
  expect(w).toEqual([{ week: '2026-11-16', cover: { '4-abend': 200 } }, { week: '2026-11-23', cover: { '0-abend': 200 } }]);
  const l = windowShoppingList(apply(weeks, w, 'gekauft', now), now);
  expect(row(l).state).toBe('gekauft'); expect(l.open).toBe(0);
});
it('after buying, only what is new shows: a new meal, or one more eater', () => {
  const bought = apply(weeks, tickWrites(weeks, now, KEY, 'gekauft'), 'gekauft', now);
  const more = withMeal(bought, '2026-11-23', { day: 1, slot: 'abend', dish: tofu, eaters: ['max'] });
  expect(row(windowShoppingList(more, now))).toMatchObject({ state: 'offen', amount: '1 Packung à 200 g' });
});
it('a tick stays until its meal is past, then leaves with it', () => {
  const bought = apply(weeks, tickWrites(weeks, now, KEY, 'gekauft'), 'gekauft', now);
  expect(row(windowShoppingList(bought, at(20, 21, 30))).state).toBe('gekauft'); // Friday's dinner is over, Monday's still covered
});
it('an old entry without cover covers its whole week', () => {
  const old = weeks.map((w) => (w.plan.week === '2026-11-16' ? { ...w, state: { ...w.state, items: { [KEY]: { state: 'gekauft' as const, atMs: 1 } } } } : w));
  expect(row(windowShoppingList(old, now))).toMatchObject({ state: 'offen', amount: '1 Packung à 200 g' });
});
it('untick clears the cover in every week that has it', () => {
  const bought = apply(weeks, tickWrites(weeks, now, KEY, 'gekauft'), 'gekauft', now);
  expect(tickWrites(bought, now, KEY, 'offen')).toEqual([{ week: '2026-11-16' }, { week: '2026-11-23' }]);
});
it('own items come from both weeks; a new one goes to the week of the last planned day', () => {
  expect(ownWeekOf(weeks, now)).toBe('2026-11-23');
});
```

In `tests/shared/meals.test.ts`: `readMealState({ items: { k: { state: 'gekauft', atMs: 1, cover: { '4-abend': 200, '9-x': 1, '1-mittag': -1, '2-abend': 'x' } } } }).items.k` equals `{ state: 'gekauft', atMs: 1, cover: { '4-abend': 200 } }`. A `cover` that is not an object is dropped, and the entry stays.

- [ ] **Step 2:** Run both test files. Expected: FAIL.
- [ ] **Step 3:** Implement. Keep `shoppingList(plan, state)` unchanged (old tests and old callers).
- [ ] **Step 4:** Run both test files and `tests/shared/mealplan-records.test.ts`. Expected: PASS.
- [ ] **Step 5:** Commit `feat(essen): Einkaufsliste über sieben Tage, Haken pro Mahlzeit`.

---

### Task 3: Stock and re-tie after a replan

**Files:**
- Modify: `src/shared/meal-list.ts`
- Test: `tests/shared/meal-list.test.ts` (new `describe('stock')`)

**Interfaces:**
- Consumes: Task 2 cover rules (the same need and cover functions, not copied).
- Produces:
  - `type StockItem = { key: string; name: string; unit: Unit; amount: number; state: 'gekauft' | 'da' }`
  - `stockOf(weeks: PlanWeek[], from: DayRef): StockItem[]`: per item, the cover on meals at or after `from` (any week). An entry without `cover` counts the full need of those meals in its week. `offen` counts 0. Only `amount > 1e-9`.
  - `retieStock(weeks: PlanWeek[], from: DayRef, stock: StockItem[], atMs: number): Record<string, MealState>`: the new state per changed week. For each stock item, walk the meals at or after `from` in date and slot order that need it. Give each `min(need, left)` as cover. Keep the old cover keys before `from`; an old entry without cover becomes the full need of its meals before `from`. When nothing is left to cover in a week, write `{ state: 'offen', atMs }`. The remainder is dropped.
  - `stockNames(stock: StockItem[]): string[]` (names for the prompts).

- [ ] **Step 1: Write the failing tests**

```ts
it('stock is what is bought for meals from tomorrow on', () => {
  const bought = apply(weeks, tickWrites(weeks, now, KEY, 'gekauft'), 'gekauft', now);
  expect(stockOf(bought, { week: '2026-11-16', day: 4 })).toEqual([{ key: KEY, name: 'Tofu natur', unit: 'g', amount: 400, state: 'gekauft' }]);
});
it('after a replan the stock moves onto the new dishes; what still is missing shows open', () => {
  // the new plan: tofu 100 g at 6-mittag for max and lena (200), and at 1-abend in week B for max, lena and a third meal (300)
  const states = retieStock(replanned, { week: '2026-11-16', day: 4 }, stock400, 5);
  expect(states['2026-11-16']!.items[KEY]).toEqual({ state: 'gekauft', atMs: 5, cover: { '6-mittag': 200 } });
  expect(states['2026-11-23']!.items[KEY]).toEqual({ state: 'gekauft', atMs: 5, cover: { '1-abend': 200 } });
  // with these states: one row, open, '1 Packung à 200 g'
});
it('stock that no new dish needs leaves the list', () => {
  const states = retieStock(withoutTofu, { week: '2026-11-16', day: 4 }, stock400, 5);
  expect(states['2026-11-16']!.items[KEY]).toEqual({ state: 'offen', atMs: 5 });
});
```

- [ ] **Step 2:** Run the test file. Expected: FAIL.
- [ ] **Step 3:** Implement.
- [ ] **Step 4:** Run the test file. Expected: PASS.
- [ ] **Step 5:** Commit `feat(essen): Gekauftes zieht beim Neuplanen mit`.

---

### Task 4: Rolling fill instead of the Saturday plan

**Files:**
- Modify: `src/coach/meals/rules.ts` (`skeleton`), `src/coach/meals/meal-coach.ts` (constants, `FileData`, `load`, `tick`, `planWeek` → `planDays`, `realMeals`, class comment)
- Test: `tests/coach/meals/meal-coach.test.ts` (replace `describe('when the plan is made')`), fix the other suites that relied on Saturday 06:00. Find them with `grep -rln "tick(" tests | xargs grep -ln "MealCoach\|meals"` (expected: `tests/coach/runtime.test.ts`, `tests/coach/server/household.test.ts`, `tests/coach/server/http.test.ts`, `tests/web/app/essen-coach-integration.test.tsx`, `tests/coach/meals/chat.test.ts`).

**Interfaces:**
- Consumes: Task 1 (`dayRefOf`, `addDays`, `dayKeyOf`, `splitByWeek`, `FILL_DAYS`).
- Produces:
  - `skeleton(members, fromDay, pairs, toDay = 7): Slotted[]` (days `fromDay` to `toDay − 1`)
  - `private async planDays(week: string, fromDay: number, toDay: number, o: { keepExisting: boolean; stock: StockItem[] }): Promise<void>` (used by Task 5)
  - `FileData.plannedUntil: string | null`
  - `private fillGap(): Promise<boolean>` called from `tick` where the Saturday block was. It runs only when `opts.plan !== false`, `noOpenRide()`, `!this.planning`, and members exist.

Rules:
- Target = `dayKeyOf(addDays(today, FILL_DAYS))`. Gap = from `max(plannedUntil + 1 day, today)` to the target. Set `plannedUntil = target` and `save()` *before* planning (like `lastAuto` before), then `planDays` for each `splitByWeek` part, `keepExisting: true`, `stock: []`.
- `load()`: `plannedUntil` missing or not a date key → the Sunday (`dayKeyOf({ week, day: 6 })`) of the newest week in `plans`, or null.
- `planDays` keeps the meals outside `[fromDay, toDay)`. With `keepExisting`, it also keeps every meal inside, and plans only the slots without one. A kept meal after `toDay` whose `reuseOf` points into the range gets `reuseOf: null` (it keeps its dish).
- Variety: `lastIds`/`lastWeek` take the meals of `addWeeks(week, -1)`, the kept meals of `week`, and the meals of `addWeeks(week, 1)`. `treatsInWeek` counts treats among the kept meals of `week`.
- Remove `PLAN_DAY`, `PLAN_HOUR`, the `lastAuto` logic, and the Saturday words in comments.

- [ ] **Step 1: Write the failing tests** (`at(day, hour)` as in the file; 19.11.2026 is a Thursday)

```ts
it('a new household gets today through the seventh day after, whatever the weekday', async () => {
  const { coach } = setup({ now: at(19, 9) });
  coach.setSettings('max', ON());
  await coach.tick();
  const w = coach.view('max').weeks;
  expect(w.map((x) => x.plan.week)).toEqual(['2026-11-16', '2026-11-23']);
  expect([...new Set(w[0]!.plan.meals.map((m) => m.day))]).toEqual([3, 4, 5, 6]);
  expect([...new Set(w[1]!.plan.meals.map((m) => m.day))]).toEqual([0, 1, 2, 3]);
});
it('the next day only the new day is added; the planned days stay as they are', async () => {
  // tick at(19, 9), remember titles of week B, clock to at(20, 9), tick
  // week B days === [0,1,2,3,4]; titles of days 0..3 unchanged
});
it('an old file with only a Saturday plan gets the missing days of next week', async () => {
  // write household.json with plans['2026-11-16'] (days 0..6), lastAuto '2026-11-16', no plannedUntil; tick at(19, 9)
  // week B days === [0,1,2,3]; week A meals unchanged
});
it('a meal already in a gap day stays when the day is filled', async () => {
  // after the first tick, put a meal with title 'Mein Wunsch' at week B '4-abend' into household.json, new MealCoach on the same dir, clock at(20, 9), tick
  // week B '4-abend' title === 'Mein Wunsch'; the other two slots of day 4 are planned
});
it('never with a ride open, and not in quiet hours; then at the next tick', async () => {
  // ride open: tick → weeks []; tick({ plan: false }) with ride closed → weeks []; tick() → two weeks
});
```

- [ ] **Step 2:** Run `PANDAFIT_UNSAFE_NO_FSYNC=1 npx vitest run tests/coach/meals/meal-coach.test.ts`. Expected: the new tests FAIL.
- [ ] **Step 3:** Implement as above.
- [ ] **Step 4:** Run `PANDAFIT_UNSAFE_NO_FSYNC=1 npx vitest run tests/coach tests/web/app/essen-coach-integration.test.tsx`. Fix the tests that expected a Saturday-only plan. Change their expectations, not the product rule. Expected: PASS.
- [ ] **Step 5:** Commit `feat(essen): Bo hält die nächsten Tage geplant`.

---

### Task 5: "Neu planen" from tomorrow, with the stock

**Files:**
- Modify: `src/coach/meals/meal-coach.ts` (`replan`), `src/coach/runtime/handlers.ts:93`, `src/coach/meals/prompt.ts` (`buildMealPrompt`), `src/coach/meals/recipe-plan.ts` (`PlanInput`, `planFromRecipes`, `buildChoicePrompt`), `src/coach/meals/rules.ts` (`PickInput`, `pickRecipe`, `ruleMeals`)
- Test: `tests/coach/meals/meal-coach.test.ts` (`describe('Neu planen')`), `tests/coach/meals/recipe-plan.test.ts`, a rules test next to the existing rule-plan tests

**Interfaces:**
- Consumes: Task 3 (`stockOf`, `retieStock`, `stockNames`), Task 4 (`planDays`).
- Produces:
  - `replan(id: string): Promise<void>`. Handler: `'meals-replan': meals((m, c, _at, sync) => { void c.replan(m.profileId).catch(...).finally(sync); })`.
  - `buildMealPrompt({ ..., stock?: string[] })`: with a non-empty stock, an extra `dataBlock('vorrat', stock)` and the sentence `Nutze Zutaten aus vorrat-nur-daten bevorzugt, damit nichts übrig bleibt.`
  - `buildChoicePrompt({ ..., stock?: string[] })`: the same block and sentence.
  - `PlanInput.stock?: readonly string[]`: each shortlist is stable-sorted by the number of ingredients whose `itemKey` name part is in the stock, most first.
  - `PickInput.stock?: ReadonlySet<string>`: score `+ 0.5` when one ingredient name is in the stock. `ruleMeals(..., used, stock?)`.

Rules for `replan(id)`:
- Guard as today (enabled, `noOpenRide`, not planning). `importStates()` first.
- `from = addDays(today, 1)`, `to = addDays(today, FILL_DAYS)`. `stock = stockOf(current weeks, from)`.
- `planDays` for each `splitByWeek(from, to)` part, with `keepExisting: false` and the stock. Then `plannedUntil = dayKeyOf(to)`.
- Then `retieStock(new weeks, from, stock, nowMs())` into `d.states` (merge with `mergeStates`, so the newer entries win), `save()`, `exportAll()`.
- Today's meals never change.

- [ ] **Step 1: Write the failing tests**

```ts
it('replans from tomorrow through the seventh day after; today stays', async () => {
  // Thursday at(19, 9): tick, note today's titles and week B createdMs; clock +1 min; replan('max')
  // today's titles equal; week B createdMs changed; week A has days 3..6, week B days 0..3
});
it('on a Sunday it replans only next week', async () => {
  // at(22, 9): tick, replan → week A '2026-11-16' unchanged createdMs, week B '2026-11-23' days 0..6
});
it('bought, not yet eaten ingredients go to Bo as vorrat and stay ticked on the new dishes', async () => {
  // AI answer with tofu everywhere; tick; mark tofu gekauft through tickWrites on the view weeks; replan
  // the last ask prompt contains 'vorrat-nur-daten' and 'Tofu natur'
  // windowShoppingList(view weeks, now) row tofu: state 'gekauft' when the new need is not larger
});
```

In `recipe-plan.test.ts`: `a recipe that uses stock comes first in its shortlist` (two fitting recipes, stock `['tofu natur']`, without AI → the tofu recipe is picked). In the rules tests: `pickRecipe prefers a recipe with a stock ingredient` (fixed `random: () => 0.5`).

- [ ] **Step 2:** Run the three test files. Expected: FAIL.
- [ ] **Step 3:** Implement. Old test calls `replan('max', week)` become `replan('max')`. `tests/coach/runtime.test.ts` and `tests/coach/server/http.test.ts` keep sending `week` in the message.
- [ ] **Step 4:** Run `PANDAFIT_UNSAFE_NO_FSYNC=1 npx vitest run tests/coach`. Expected: PASS.
- [ ] **Step 5:** Commit `feat(essen): Neu planen ab morgen nutzt Gekauftes`.

---

### Task 6: "Neu planen" as a record from the web app

**Files:**
- Modify: `src/shared/meals.ts` (request record), `src/coach/meals/meal-coach.ts` (`answerReplans`, `tick`, `keepRecipeRecords`)
- Test: `tests/coach/meals/meal-coach.test.ts` (`describe('Neu planen vom Handy')`), `tests/shared/meals.test.ts`

**Interfaces:**
- Produces (shared):
  - `type ReplanRequest = { id: string; atMs: number; answeredMs: number | null }`
  - `isReplanRecordId(id): boolean` (`/^replan-[a-z0-9]{4,40}$/`), `newReplanId(nowMs, random = Math.random): string` (pattern as `newPlaceId`)
  - `readReplanRequest(id: string, body: unknown): ReplanRequest | null`
- Produces (coach): `private async answerReplans(): Promise<boolean>`

Rules:
- In `tick`, after `answerPlacements()`, also with `plan: false`. Collect the unanswered requests of every synced profile. When there is one and `noOpenRide()` and `!this.planning`: `await this.replan(<profile of the newest request>)`, then write `answeredMs: now` into every collected record (`updatedMs: Math.max(now, r.updatedMs + 1)`), `onExport` for the touched profiles.
- `keepRecipeRecords`: keep the newest `LINK_KEEP` replan records (not tombstoned as unknown).

- [ ] **Step 1: Write the failing tests**

```ts
it('a replan record from the phone is answered once: new plan from tomorrow, answeredMs set', async () => {
  // linked: ['max']; tick at(19, 9); store.putMany('max', [{ kind: 'mealplan', id: 'replan-abcd1234', updatedMs: now, deleted: false, body: { atMs: now, answeredMs: null } }], 'remote'); tick
  // week B createdMs changed; readReplanRequest of the stored record has answeredMs !== null; a second tick does not replan again
});
it('two open requests make one replan', async () => { /* ask spy: one meal-plan call per week part, not two */ });
it('waits while a ride is open, then answers', async () => { /* ride open: answeredMs null; ride closed: answered */ });
```

In `meals.test.ts`: `readReplanRequest('replan-abcd1234', { atMs: 1, answeredMs: null })` reads; a bad id, a missing `atMs` or a string body gives `null`.

- [ ] **Step 2:** Run both files. Expected: FAIL.
- [ ] **Step 3:** Implement.
- [ ] **Step 4:** Run both files. Expected: PASS.
- [ ] **Step 5:** Commit `feat(essen): Neu planen geht vom Handy an Bo`.

---

### Task 7: Einkauf without the week switch

**Files:**
- Modify: `src/web/essen/ShoppingPage.tsx`, `src/web/essen/meals-view.ts` (remove `shoppingWeek`, new `openCount`, `shoppingSentence`), `src/web/essen/EssenStart.tsx` (tile), `src/web/MealsScreen.tsx` (import)
- Test: `tests/web/app/essen.test.tsx` (shopping cases), `tests/web/meals-view.test.ts`

**Interfaces:**
- Consumes: Task 2 (`windowShoppingList`, `tickWrites`, `ownWeekOf`, `withItem` with cover).
- Produces:
  - `openCount(weeks: Week[], nowMs: number): number` (plan rows open + own rows open)
  - `shoppingSentence(list: WindowList, nowMs: number): string`
  - `ShoppingPage` props stay `{ weeks, nowMs, change, onBack }`.

Behaviour:
- No `tk-textseg` week group. One list from `windowShoppingList(weeks, nowMs)`.
- A tick on a plan row: for each `tickWrites(...)` entry call `change(w.week, (s, at) => withItem(s, key, next, at, w.cover))`. The same for "Haben wir" (`da`) and "Doch kaufen" (`offen`).
- Own rows: ticks and "Entfernen" go to `item.week`. "Hinzufügen" goes to `ownWeekOf(weeks, nowMs)`.

Copy (exact):
- `shoppingSentence`, list starts today: `Die Liste reicht bis ${DAY_LONG[lastDay.day]} und ist für ${people === 1 ? 'eine Person' : `${numberWord(people)} Personen`}.`
- List starts tomorrow: `Die Liste beginnt morgen, reicht bis ${DAY_LONG[lastDay.day]} und ist für … .` (same person part).
- Without `lastDay`: no sentence.
- Empty list: `Für die nächsten Tage gibt es nichts einzukaufen.`
- No plan at all stays: `Es gibt noch keinen Plan, also auch keine Liste.`

- [ ] **Step 1: Write the failing tests**

```ts
it('Einkauf has no week switch and shows both weeks in one list', async () => {
  // seed week A and B with tofu (see Task 2 fixture), open Einkauf
  expect(screen.queryByRole('group', { name: 'Woche' })).toBeNull();
  expect(await screen.findByText('2 Packungen à 200 g')).toBeTruthy();
});
it('a tick writes the cover into both week records', async () => {
  // click checkbox 'Tofu natur gekauft'; port records state-2026-11-16 and state-2026-11-23 have items[KEY].cover
});
it('in the evening the list starts tomorrow', () => {
  // weeks: the Task 2 fixture plus a tofu dinner at week B '3-abend' (Thursday 26.11.)
  expect(shoppingSentence(windowShoppingList(weeks, at(19, 21)), at(19, 21))).toBe('Die Liste beginnt morgen, reicht bis Donnerstag und ist für zwei Personen.');
});
```

- [ ] **Step 2:** Run both files. Expected: FAIL.
- [ ] **Step 3:** Implement. Delete the old shopping-week tests that test the removed switch.
- [ ] **Step 4:** Run `PANDAFIT_UNSAFE_NO_FSYNC=1 npx vitest run tests/web`. Expected: PASS.
- [ ] **Step 5:** Commit `feat(essen): Einkauf zeigt immer die nächsten sieben Tage`.

---

### Task 8: Essen start page: "Neu planen", the next days, new texts

**Files:**
- Modify: `src/web/MealsScreen.tsx` (`useMealData`: `replan`, `replanPending`), `src/web/essen/EssenStart.tsx`, `src/web/essen/meals-view.ts` (`NEXT_PLAN`, `NO_PLAN`, `comingDays`; remove `restOfWeek`, `nextWeekRows` when unused), `src/web/ConnectionSettings.tsx:128` (hint)
- Test: `tests/web/app/essen-start.test.tsx`, `tests/web/meals-view.test.ts`, `tests/web/app/essen-coach-integration.test.tsx` (one end-to-end case)

**Interfaces:**
- Consumes: Task 6 (`newReplanId`, `isReplanRecordId`, `readReplanRequest`).
- Produces:
  - `useMealData(...)` returns also `replan: () => Promise<void>` (puts `{ kind: 'mealplan', id: newReplanId(at), updatedMs: at, deleted: false, body: { atMs: at, answeredMs: null } }`) and `replanPending: boolean` (the newest replan record has `answeredMs === null`).
  - `comingDays(weeks: Week[], nowMs: number): DayRow[]`: tomorrow through `today + 7`, only days whose week has a plan, cut after the last day with a meal.

UI:
- `BoBubble` actions: the existing "Plan ändern" button, then `<ConfirmLink label="Neu planen" question="Ab morgen alles neu planen?" onConfirm={() => void data.replan()} />`.
- While `replanPending`: `<p className="muted" role="status">Bo plant ab morgen neu. Gleich steht der neue Plan hier.</p>` below the bubble.
- One `DaysCard` with the label `Die nächsten Tage` and `comingDays(...)` replaces "Der Rest der Woche" and "Nächste Woche". "Diese Woche bisher" and "Letzte Woche" stay unchanged.
- `NEXT_PLAN = 'Bo plant die nächsten Tage bald.'`; `NO_PLAN` stays `` `Noch gibt es keinen Essensplan. ${NEXT_PLAN}` ``.
- Settings hint: `Bo plant immer die nächsten sieben Tage, mit Einkaufsliste.`

- [ ] **Step 1: Write the failing tests**

```ts
it('Neu planen asks first, then writes one replan record and shows that Bo is planning', async () => {
  fireEvent.click(await screen.findByRole('button', { name: 'Neu planen' }));
  expect(screen.getByText('Ab morgen alles neu planen?')).toBeTruthy();
  fireEvent.click(screen.getByRole('button', { name: 'Ja' }));
  expect(await screen.findByText('Bo plant ab morgen neu. Gleich steht der neue Plan hier.')).toBeTruthy();
  // port: exactly one record with isReplanRecordId and answeredMs null
});
it('Abbrechen writes nothing', async () => { /* no replan record */ });
it('the next days are one card from tomorrow across the week edge', () => {
  expect(comingDays(weeks, at(19, 9)).map((r) => r.lead)).toEqual(['Fr 20.', 'Sa 21.', 'So 22.', 'Mo 23.', 'Di 24.', 'Mi 25.', 'Do 26.']);
});
it('without a plan the head says that Bo plans soon', () => {
  expect(NO_PLAN).toBe('Noch gibt es keinen Essensplan. Bo plant die nächsten Tage bald.');
});
```

In `essen-coach-integration.test.tsx`: `Neu planen on the phone reaches the coach and the new plan comes back`. The phone writes the record, `store.putMany(..., 'remote')`, `mac.tick()`, re-boot: the status line is gone.

- [ ] **Step 2:** Run the three files. Expected: FAIL.
- [ ] **Step 3:** Implement. Update old assertions on "Der Rest der Woche", "Nächste Woche" and "Samstagmorgen".
- [ ] **Step 4:** Run `PANDAFIT_UNSAFE_NO_FSYNC=1 npx vitest run tests/web`. Expected: PASS.
- [ ] **Step 5:** Commit `feat(essen): Neu planen und die nächsten Tage auf Essen`.

---

### Finish

- [ ] Run `PANDAFIT_UNSAFE_NO_FSYNC=1 npm test`, `npm run typecheck`, `npm run lint`, `npm run build:web`. Expected: all green (architecture test included).
- [ ] Run `rtk proxy grep -rn -e Samstagmorgen -e lastAuto -e PLAN_DAY -e shoppingWeek src`. Expected: no hit.
- [ ] `docs/roadmap.md`: set "Rollender Essensplan" to ✅. Add to the parking lot under "Aus Rollender Essensplan": "Nach Tauschen, Chat oder „In den Plan“ bleibt Gekauftes an der alten Mahlzeit hängen (nur Neu planen bindet es neu)."
- [ ] Commit `docs(roadmap): Rollender Essensplan fertig`. Merge the branch into `main` locally (`git merge --no-ff feat/rollender-essensplan`). Remove the worktree. Do not push and do not deploy.
