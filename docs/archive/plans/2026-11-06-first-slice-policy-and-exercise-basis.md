# First Slice: Policy Register and Exercise Basis Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Steps 0 and 1 of the migration: one versioned evidence/rule register that the gym limits already read from, and an exercise identity that no longer borrows instructions, pictures or muscles from a look-alike with other equipment, shown correctly in the workout screen and the statistics.

**Architecture:** The register is plain typed data in `src/shared/training-policy/` (sources, rules, acceptance scenarios) with small lookup functions; `src/coach/gym/limits.ts` takes its numbers from there, so prompt, guardrails and suggestions keep exactly today's behaviour but from one source. Exercise identity becomes one pure function `resolveExercise` in `src/tracking/exercise-identity.ts` (id, then exact known titles, then an external muscle hint, else visibly unknown); the movement-family heuristic in `similar.ts` stays for swap suggestions only. The catalog gains the variants that are actually logged but missing.

**Tech Stack:** TypeScript, React 19, Vitest (+ jsdom, Testing Library), shared tracking UI for Mac and PWA.

**Spec:** `docs/superpowers/specs/2026-11-06-adaptive-training-coach-design.md` (§7, §8, §15, §17, §18 "Übungswissen", §19 Auftrag 0 and 1), with `docs/research/2026-11-06-training-science-foundation.md` (§3, §4, §5, §10, §11, §12) and `docs/research/2026-11-06-migration-assessment.md` (§4, §5 steps 0–1, §6).

## Global Constraints

- Before every task: no ride is open (`~/Library/Application Support/bike-coach/rides/live/current.jsonl` not written in the last hour and no running `npm run dev`). This plan touches `src/shared/**`, which is off-limits during an open ride. No `npm install`.
- Public repo: no personal data in code, tests or fixtures. Exercise names are generic catalog content; no counts, dates or weights from real logs.
- "Bis eine geprüfte Migration umgesetzt ist, bleiben die aktuellen ausführbaren Grenzen bestehen." Task 1–2 change no planning behaviour; every existing coach test passes unchanged.
- Existing exercise ids (`pf-*`), workout and set ids stay. Logged workouts are never rewritten; identity is resolved at read time.
- A registered number is one of: `orientation` (fachliche Orientierung), `product` (Produktheuristik), `personal` (persönliche Vorgabe), `technical` (technische Bedingung). A source id proves neither a threshold nor an individual optimum.
- No new runtime dependency, no rule DSL, no plugin mechanism.
- User-facing text German, code and comments English, commit prefixes as in the repo (`feat(...)`, `docs:`).

## Review Focus

1. A Hevy title with German equipment ("Seitheben (Kurzhantel)") must still resolve to its own exercise, now that the base-name fallback is gone → test in Task 4.
2. An external muscle map with keys like `__proto__` or `constructor` as exercise id must not resolve to a muscle or throw → test in Task 4.
3. A workout screen without a stats record, or with a malformed one, must still render every exercise with an icon (unknown where unknown) → test in Task 5.
4. Two catalog entries claiming the same title, Hevy title or alias would make identity depend on list order → uniqueness test in Task 3.
5. A Smith-machine or machine variant must not show a free-weight text or picture just because the movement name matches → tests in Task 4 and Task 5.

---

### Task 1: Evidence and rule register

**Files:**
- Create: `src/shared/training-policy/types.ts`, `src/shared/training-policy/sources.ts`, `src/shared/training-policy/rules.ts`, `src/shared/training-policy/scenarios.ts`, `src/shared/training-policy/index.ts`
- Test: `tests/shared/training-policy.test.ts`

**Interfaces:**
- Produces (in `types.ts`, re-exported from `index.ts`):

```ts
export type SourceDepth = 'abstract' | 'fulltext-excerpts' | 'guideline-summary';
export type PolicySource = {
  id: string;            // 'S01' … 'S26', as in the foundation §12
  citation: string; url: string; studyType: string; depth: SourceDepth;
  population: string; endpoint: string; limits: string; checkedOn: string; // 'YYYY-MM-DD'
};
export type RuleClass = 'orientation' | 'product' | 'personal' | 'technical';
export type Enforcement = 'checked' | 'weighed';   // checked: code enforces it; weighed: the AI weighs it and it is shown
export type RuleStatus =
  | { state: 'active' }
  | { state: 'to-replace'; task: number; replacement: string; untilThen: string }
  | { state: 'planned'; task: number };            // fixed start value, not in effect before that task
export type RuleValue = number | { min: number; max: number };
export type PolicyRule = {
  id: string; domain: 'gym' | 'muscle' | 'rest' | 'bike' | 'run' | 'planner' | 'endurance' | 'data';
  statement: string; decision: string; class: RuleClass; enforcement: Enforcement;
  value?: RuleValue; unit?: string; sourceIds: string[]; where: string[]; status: RuleStatus; scenarioIds: string[];
};
export type Scenario = { id: string; situation: string; expectation: string; task: number };
```

- Produces (in `index.ts`): `POLICY_VERSION = '2026-11-06.1'`, `SOURCES`, `RULES`, `SCENARIOS`, `policyRule(id: string): PolicyRule` (throws `Error('unknown policy rule: <id>')`), `ruleNumber(id: string): number` and `ruleRange(id: string): { min: number; max: number }` (both throw when the value has the other shape or is missing).

- [ ] **Step 1: Write the failing tests** in `tests/shared/training-policy.test.ts`:

```ts
import { POLICY_VERSION, RULES, SCENARIOS, SOURCES, policyRule, ruleNumber, ruleRange } from '../../src/shared/training-policy';

describe('training policy register', () => {
  it('has a version and unique ids', () => {
    expect(POLICY_VERSION).toBe('2026-11-06.1');
    for (const list of [SOURCES, RULES, SCENARIOS]) expect(new Set(list.map((x) => x.id)).size).toBe(list.length);
  });
  it('registers all 26 sources of the foundation with population, endpoint and limits', () => {
    expect(SOURCES.map((s) => s.id)).toEqual(Array.from({ length: 26 }, (_, i) => `S${String(i + 1).padStart(2, '0')}`));
    for (const s of SOURCES) for (const k of ['citation', 'url', 'population', 'endpoint', 'limits'] as const) expect(s[k].length).toBeGreaterThan(0);
  });
  it('only cites registered sources, and every orientation rule cites one', () => {
    const ids = new Set(SOURCES.map((s) => s.id));
    for (const r of RULES) {
      for (const s of r.sourceIds) expect(ids.has(s)).toBe(true);
      if (r.class === 'orientation') expect(r.sourceIds.length).toBeGreaterThan(0);
    }
  });
  it('gives every rule that will change a follow-up task between 1 and 12', () => {
    for (const r of RULES) if (r.status.state !== 'active') expect(r.status.task).toBeGreaterThanOrEqual(1), expect(r.status.task).toBeLessThanOrEqual(12);
  });
  it('assigns every scenario to a task and only links known scenarios', () => {
    const ids = new Set(SCENARIOS.map((s) => s.id));
    for (const s of SCENARIOS) expect(s.task).toBeGreaterThanOrEqual(1);
    for (const r of RULES) for (const s of r.scenarioIds) expect(ids.has(s)).toBe(true);
  });
  it('keeps today\'s gym limits as product heuristics with their current values', () => {
    expect(ruleRange('gym.rep-range')).toEqual({ min: 6, max: 12 });
    expect(ruleNumber('gym.min-step-kg')).toBe(2.5);
    expect(policyRule('gym.rep-range')).toMatchObject({ class: 'product', enforcement: 'checked', status: { state: 'to-replace', task: 4 } });
    expect(policyRule('gym.min-step-kg').status).toMatchObject({ state: 'to-replace', task: 3 });
  });
  it('fixes the proposed start values as planned, not active', () => {
    expect(ruleRange('hypertrophy.isolation-reps')).toEqual({ min: 10, max: 20 });
    expect(ruleNumber('muscle.indirect-weight')).toBe(0.5);
    expect(policyRule('muscle.indirect-weight').status).toEqual({ state: 'planned', task: 2 });
  });
  it('throws on unknown ids and on the wrong value shape', () => {
    expect(() => policyRule('nope')).toThrow('unknown policy rule: nope');
    expect(() => ruleNumber('gym.rep-range')).toThrow();
    expect(() => ruleRange('gym.min-step-kg')).toThrow();
  });
});
```

- [ ] **Step 2: Run** `npx vitest run tests/shared/training-policy.test.ts` — Expected: FAIL, module not found.

- [ ] **Step 3: Write `types.ts`, `sources.ts`, `scenarios.ts`, `rules.ts`, `index.ts`.**

`sources.ts`: one entry per row of foundation §12 (S01–S26), `checkedOn: '2026-11-06'`, `depth` from the "Lesetiefe" column (`Abstract` → `abstract`, `Volltextauszüge` → `fulltext-excerpts`, WHO → `guideline-summary`; "Abstract und Volltextauszüge" → `fulltext-excerpts`). `population`, `endpoint`, `limits` in German, taken from §4–§9 and the "wichtigste Grenze" column; do not add claims that are not in the foundation.

`scenarios.ts`: the 14 rows of foundation §11 as `F01`–`F14` plus `U01` "Maschinen-Reverse-Fly" → passende Maschinenanleitung, `U02` "Behind-the-Back-Curl" → hat Beschreibung, `U03` "bekannte Ruderübungen" → zeigen den Rücken, `U04` "unbekannte Importübung" → Muskel als unbekannt gekennzeichnet. Tasks: F01→5, F02→4, F03→2, F04→2, F05→6, F06→7, F07→7, F08→7, F09→5, F10→6, F11→7, F12→12, F13→12, F14→12, U01–U04→1.

`rules.ts`: German `statement`. Entries with exactly these ids, values and statuses (`where` = the code paths named in the foundation §10 or below):

| id | class / enforcement | value | sources | status |
|---|---|---|---|---|
| `gym.rep-range` | product / checked | 6–12 | – | to-replace 4 (übungsbezogene Bereiche) |
| `gym.min-step-kg` | product / checked | 2.5 kg | – | to-replace 3 (erreichbare Geräteschritte) |
| `gym.max-step-pct` | product / checked | 5 % | – | to-replace 3 |
| `gym.step-back-share` | product / checked | 0.9 | – | active (nach langer Pause) |
| `gym.effort-step-back-count` | product / checked | 3 | – | to-replace 4 (Leistung und Kontext statt −10 %), scenario F02 |
| `gym.long-break-days` | product / checked | 28 | – | active |
| `gym.recent-days` | product / checked | 120 | – | active |
| `gym.min-comparable` | product / checked | 2 | – | to-replace 4 (echte Trainingsgelegenheiten statt Übungsinstanzen) |
| `gym.comparable-days` | product / checked | 56 | – | to-replace 4 |
| `gym.max-exercises`, `gym.max-sets`, `gym.max-failure-sets`, `gym.max-widowmakers` | product / checked | 10, 30, 4, 1 | – | active |
| `muscle.weekly-set-targets` | product / weighed | – | S03 | to-replace 2 (gemeinsames Budget statt Mindestquoten), F04 |
| `bike.hard-gap-48h` | product / checked | 48 h | – | to-replace 7, F10 |
| `planner.two-hard-days` | product / checked | 2 | – | to-replace 7, F11 |
| `hr.fixed-zones` | product / checked | – | S14 | to-replace 12 |
| `run.distance-before-pace` | personal / weighed | – | – | active, F09 |
| `run.weekly-growth-pct` | product / checked | 10 % | S25 | to-replace 12, F13 |
| `run.deload-every-4th` | product / checked | 0.7 | – | to-replace 12 |
| `run.test-every-days` | product / checked | 28 | – | to-replace 12 |
| `run.cross-sport-minutes` | product / checked | – | – | to-replace 6 |
| `strength.main-lift-reps` | product / weighed | 3–6 | S01, S02, S04 | planned 4, F01 |
| `hypertrophy.compound-reps` | product / weighed | 6–15 | S01, S04 | planned 4, F01 |
| `hypertrophy.isolation-reps` | product / weighed | 10–20 | S01, S04 | planned 4, F03 |
| `hypertrophy.target-rir` | product / weighed | 1–3 | S05 | planned 4, F02 |
| `muscle.direct-weight` / `muscle.indirect-weight` | product / checked | 1 / 0.5 | S03 | planned 2, F04 |
| `rest.compound-s`, `rest.isolation-s`, `rest.heavy-strength-s` | product / weighed | 120–180, 60–120, 180–300 | S06, S07 | planned 10 |
| `prep.per-movement-block` | product / weighed | – | S11 | planned 10, F10 |
| `superset.any-partner` | product / weighed | – | S10 | planned 9 |
| `progression.double` | product / checked | – | S12 | planned 4 |
| `endurance.no-forced-distribution` | orientation / weighed | – | S16, S17, S18 | planned 6, F05 |
| `endurance.health-minutes` | orientation / weighed | 150–300 min | S13 | planned 6, F05 |
| `hiit.full-dose` | orientation / weighed | – | S19, S20, S21, S22, S23 | planned 7, F06, F07, F08 |
| `data.unknown-rir-stays-unknown` | technical / checked | – | – | planned 2, F03 |
| `data.identity-not-from-name` | technical / checked | – | – | planned 1, U01–U04 |

`untilThen` for every to-replace rule: "Gilt unverändert in Vorschlag, Prüfer und Prompt." `index.ts` implements the lookups over a `Map` built once.

- [ ] **Step 4: Run** `npx vitest run tests/shared/training-policy.test.ts && npm run typecheck` — Expected: PASS, no type errors.

- [ ] **Step 5: Commit**

```bash
git add src/shared/training-policy tests/shared/training-policy.test.ts
git commit -m "feat(policy): register sources, rules and acceptance scenarios with their follow-up tasks"
```

### Task 2: Gym limits read from the register

**Files:**
- Modify: `src/coach/gym/limits.ts` (all constants), `src/coach/gym/history.ts:55` (`EFFORT_STEP_BACK`), `docs/gym-foundations.md` ("Limits" section)
- Test: `tests/coach/gym/limits.test.ts` (create)

**Interfaces:**
- Consumes: `ruleNumber`, `ruleRange`, `POLICY_VERSION` from Task 1.
- Produces: unchanged export names of `limits.ts` (`RECENT_DAYS`, `LONG_BREAK_DAYS`, `MIN_COMPARABLE`, `COMPARABLE_DAYS`, `STEP_BACK`, `MAX_STEP_PCT`, `MIN_STEP_KG`, `REP_MIN`, `REP_MAX`, `MAX_EXERCISES`, `MAX_SETS`, `MAX_FAILURE_SETS`, `MAX_WIDOWMAKERS`) plus new `EFFORT_STEP_BACK` and `GYM_POLICY_VERSION`.

- [ ] **Step 1: Write the failing test** `tests/coach/gym/limits.test.ts`:

```ts
import * as L from '../../../src/coach/gym/limits';
import { POLICY_VERSION, ruleNumber, ruleRange } from '../../../src/shared/training-policy';

it('takes every gym limit from the policy register, with today\'s values', () => {
  expect([L.REP_MIN, L.REP_MAX]).toEqual([ruleRange('gym.rep-range').min, ruleRange('gym.rep-range').max]);
  expect({ step: L.MIN_STEP_KG, pct: L.MAX_STEP_PCT, back: L.STEP_BACK, effort: L.EFFORT_STEP_BACK })
    .toEqual({ step: 2.5, pct: 5, back: 0.9, effort: 3 });
  expect(L.EFFORT_STEP_BACK).toBe(ruleNumber('gym.effort-step-back-count'));
  expect(L.GYM_POLICY_VERSION).toBe(POLICY_VERSION);
});
```

- [ ] **Step 2: Run** `npx vitest run tests/coach/gym/limits.test.ts` — Expected: FAIL (`EFFORT_STEP_BACK` / `GYM_POLICY_VERSION` undefined).

- [ ] **Step 3: Rewrite `limits.ts`** so each constant is `ruleNumber(...)` / `ruleRange(...)` of its Task 1 id; keep the export names and the comment that these are own choices. Move `EFFORT_STEP_BACK` from `history.ts` into `limits.ts` and import it there. Replace the "Limits" table in `docs/gym-foundations.md` with one sentence pointing to `src/shared/training-policy/rules.ts` as the single source, keeping the meaning column as a short list.

- [ ] **Step 4: Run** `npx vitest run tests/coach && npm run typecheck` — Expected: PASS, including the unchanged `tests/coach/gym/history.test.ts` and guardrail tests.

- [ ] **Step 5: Commit**

```bash
git add src/coach/gym/limits.ts src/coach/gym/history.ts docs/gym-foundations.md tests/coach/gym/limits.test.ts
git commit -m "refactor(gym): gym limits come from the policy register, behaviour unchanged"
```

### Task 3: Catalog variants that are logged but missing

**Files:**
- Modify: `src/shared/exercises.ts` (type, `EXERCISES`, `linkHevyTemplates`, `exerciseTitles`), `src/shared/exercise-descriptions.ts`, `src/shared/muscle-targets.ts:41` (`REAR_OR_SIDE_IDS`)
- Test: `tests/shared/exercises.test.ts` (create). The existing `tests/shared/exercise-descriptions.test.ts` already demands a description for every catalog id and checks that texts are plain, short and calm; the new texts must pass it unchanged.

**Interfaces:**
- Produces: `Exercise` gains `aliases?: string[]` — further exact titles under which the very same exercise (same movement, same equipment) is logged. `exerciseTitles(e)` returns `[title, hevyTitle, hevyTitle with German equipment, ...aliases]`. `linkHevyTemplates` matches on `hevyTitle` and `aliases`.

New entries (`id`, `title`, `type`, `primaryMuscle`, `equipment`, `hevyTitle`):

| id | title | muscle | equipment | hevyTitle |
|---|---|---|---|---|
| `pf-rear-delt-fly-machine` | Reverse Butterfly an der Maschine | shoulders | machine | Rear Delt Reverse Fly (Machine) |
| `pf-bent-over-lateral-raise-cable` | Vorgebeugtes Seitheben am Kabel | shoulders | machine | Bent Over Lateral Raise (Cable) |
| `pf-behind-back-curl-cable` | Curl hinter dem Rücken am Kabel | biceps | machine | Behind the Back Curl (Cable) |
| `pf-seated-row-machine` | Rudern sitzend an der Maschine | upper_back | machine | Seated Row (Machine) |
| `pf-seated-row-cable-v` | Rudern am Kabel mit V-Griff | upper_back | machine | Seated Cable Row - V Grip (Cable) |
| `pf-seated-row-cable-close` | Rudern am Kabel eng | upper_back | machine | Seated Cable Row (Close Grip) |
| `pf-overhead-triceps-cable` | Trizepsstrecken über Kopf am Kabel | triceps | machine | Overhead Triceps Extension (Cable) |

All `type: 'weight_reps'`. Aliases: `pf-cable-curl` → `['Cable Curl']`, `pf-one-arm-row` → `['Single Arm Dumbbell Row']`, `pf-dip` → `['Dip']`. Add `pf-rear-delt-fly-machine` and `pf-bent-over-lateral-raise-cable` to `REAR_OR_SIDE_IDS`.

- [ ] **Step 1: Write the failing tests** `tests/shared/exercises.test.ts`:

```ts
import { EXERCISES, exerciseTitles, linkHevyTemplates } from '../../src/shared/exercises';
import { exerciseDescription } from '../../src/shared/exercise-descriptions';
import { muscleGroupOf } from '../../src/shared/muscle-targets';

const byId = (id: string) => EXERCISES.find((e) => e.id === id)!;

it('no title, Hevy title or alias belongs to two exercises', () => {
  const seen = new Map<string, string>();
  for (const e of EXERCISES) for (const t of new Set(exerciseTitles(e))) {
    expect(seen.get(t) ?? e.id).toBe(e.id);
    seen.set(t, e.id);
  }
});
it('the machine reverse fly is its own exercise with a machine text and counts for the rear shoulder', () => {
  const e = byId('pf-rear-delt-fly-machine');
  expect(e.equipment).toBe('machine');
  expect(exerciseDescription(e.id)?.text).toMatch(/Maschine|Griff|Polster/);
  expect(exerciseDescription(e.id)?.text).not.toMatch(/Kurzhantel/);
  expect(muscleGroupOf(e)).toBe('side_rear_delts');
});
it('the behind-the-back curl has a description', () => {
  expect(exerciseDescription('pf-behind-back-curl-cable')?.source).toEqual({ kind: 'own' });
});
it('every new row variant counts for the back', () => {
  for (const id of ['pf-seated-row-machine', 'pf-seated-row-cable-v', 'pf-seated-row-cable-close']) expect(muscleGroupOf(byId(id))).toBe('back');
});
it('links Hevy templates by alias as well', () => {
  expect(linkHevyTemplates([{ id: 'h1', title: 'Cable Curl' }, { id: 'h2', title: 'Rear Delt Reverse Fly (Machine)' }]))
    .toEqual(new Map([['h1', 'pf-cable-curl'], ['h2', 'pf-rear-delt-fly-machine']]));
});
```

- [ ] **Step 2: Run** `npx vitest run tests/shared/exercises.test.ts` — Expected: FAIL.

- [ ] **Step 3: Add the entries, aliases, ids and seven own descriptions** (`o(...)`, two to three calm German sentences in the style of the file, describing the actual equipment: seat/pad/handle for machines, cable height and handle for cable variants; no weights, no promises).

- [ ] **Step 4: Run** `npx vitest run tests/shared tests/coach && npm run typecheck` — Expected: PASS. If a coach test counted catalog size or links, update its expected number only and say so in the commit body.

- [ ] **Step 5: Commit**

```bash
git add src/shared/exercises.ts src/shared/exercise-descriptions.ts src/shared/muscle-targets.ts tests/shared/exercises.test.ts
git commit -m "feat(gym): own entries for logged machine and cable variants, with their own instructions"
```

### Task 4: One exercise identity, no look-alike borrowing

**Files:**
- Create: `src/tracking/exercise-identity.ts`
- Modify: `src/tracking/similar.ts` (remove `exactExercise`, `ownExerciseFor`; `describeExercise` returns only by identity), `src/tracking/stats.ts:60-66` (`groupOf`)
- Test: `tests/tracking/exercise-identity.test.ts` (create), `tests/tracking/similar.test.ts` (remove the `describeExercise` fallback test at line 47 and the `ownExerciseFor` block at line 72; port their exact-title cases to the new test), `tests/tracking/stats.test.ts`

**Interfaces:**
- Consumes: `exerciseTitles`, `Exercise` (Task 3); `muscleGroupOf`, `MUSCLE_TARGETS`, `MuscleGroup`.
- Produces:

```ts
export type MuscleSource = 'catalog' | 'external' | 'unknown';
export type ResolvedExercise = { exercise: Exercise | null; group: MuscleGroup | null; muscleSource: MuscleSource };
export function resolveExercise(
  logged: { exerciseId: string; title: string },
  catalog: Exercise[],
  externalMuscles?: Record<string, string> | null,
): ResolvedExercise;
```

Order: catalog entry with `id === exerciseId`; else the entry with `exerciseTitles(e).includes(title)` (exact, case-sensitive, trimmed); never by base name. Found → `group: muscleGroupOf(e)`, `'catalog'`. Else, if `Object.hasOwn(externalMuscles, exerciseId)` and the value is a non-empty string → `group` = the value itself when it is a `MUSCLE_TARGETS` key, else `muscleGroupOf({ id: exerciseId, title, primaryMuscle: value })`, `'external'`. Else `{ exercise: null, group: null, muscleSource: 'unknown' }`.

`describeExercise(current, catalog): ExerciseDescription | null` — `exerciseDescription(resolveExercise(current, catalog).exercise?.id ?? current.exerciseId)`.

- [ ] **Step 1: Write the failing tests** `tests/tracking/exercise-identity.test.ts`:

```ts
import { EXERCISES, type Exercise } from '../../src/shared/exercises';
import { resolveExercise } from '../../src/tracking/exercise-identity';
import { describeExercise } from '../../src/tracking/similar';

const r = (exerciseId: string, title: string, ext?: Record<string, string>) => resolveExercise({ exerciseId, title }, EXERCISES, ext);

it('finds the own exercise by id, by German, English and German-equipment Hevy title', () => {
  expect(r('pf-squat', 'egal').exercise?.id).toBe('pf-squat');
  expect(r('h', 'Lat Pulldown - Close Grip (Cable)').exercise?.id).toBe('pf-lat-pulldown-close');
  expect(r('h', 'Seitheben (Kurzhantel)').exercise?.id).toBe('pf-lateral-raise');
  expect(r('h', 'Cable Curl').exercise?.id).toBe('pf-cable-curl');
});
it('never takes a look-alike with other equipment as the same exercise', () => {
  expect(r('h', 'Squat (Smith Machine)')).toEqual({ exercise: null, group: null, muscleSource: 'unknown' });
  expect(describeExercise({ exerciseId: 'h', title: 'Squat (Smith Machine)' }, EXERCISES)).toBeNull();
});
it('gives the machine reverse fly its own machine text', () => {
  expect(describeExercise({ exerciseId: 'h', title: 'Rear Delt Reverse Fly (Machine)' }, EXERCISES)?.text).not.toMatch(/Kurzhantel/);
});
it('uses an external muscle for an unknown exercise and says where it came from', () => {
  expect(r('h9', 'Squat (Smith Machine)', { h9: 'quadriceps' })).toEqual({ exercise: null, group: 'quads', muscleSource: 'external' });
  expect(r('h9', 'X', { h9: 'back' }).group).toBe('back');
});
it('ignores inherited keys and empty values of the external map', () => {
  expect(r('__proto__', 'X', {}).muscleSource).toBe('unknown');
  expect(r('constructor', 'X', {}).muscleSource).toBe('unknown');
  expect(r('h', 'X', { h: '' }).muscleSource).toBe('unknown');
});
it('finds a user-created exercise in the catalog passed in', () => {
  const mine: Exercise = { id: 'my-own-uuid', title: 'Meine Übung', type: 'weight_reps', primaryMuscle: 'chest', equipment: 'machine' };
  expect(resolveExercise({ exerciseId: 'my-own-uuid', title: 'Meine Übung' }, [...EXERCISES, mine])).toMatchObject({ group: 'chest', muscleSource: 'catalog' });
});
```

In `tests/tracking/stats.test.ts` add: a finished workout with `{ exerciseId: 'h-smith', title: 'Squat (Smith Machine)' }` and stats muscles `{ 'h-smith': 'quadriceps' }` counts under `quads`; without the muscles entry it counts under "Sonstiges" (same as the existing unknown case at line 77).

- [ ] **Step 2: Run** `npx vitest run tests/tracking/exercise-identity.test.ts tests/tracking/stats.test.ts` — Expected: FAIL.

- [ ] **Step 3: Implement `resolveExercise`**, switch `describeExercise` and `stats.ts` `groupOf` to it (`groupOf` returns `resolved.group`), delete `exactExercise`, `ownExerciseFor` and the `via` result. `similarExercises` and `matchesSearch` stay unchanged: they suggest substitutes, they do not claim identity.

- [ ] **Step 4: Run** `npx vitest run tests/tracking && npm run typecheck` — Expected: the only failures are in `WorkoutScreen` call sites and `exercise-info.test.tsx` `via` cases, fixed in Task 5; everything else passes. Do not commit a red typecheck: if `WorkoutScreen.tsx` breaks the build, do the minimal call-site switch here (`described` = `describeExercise(e, catalog)`, `own` = `resolveExercise(e, catalog).exercise`) and leave the stats muscles and unknown icon to Task 5.

- [ ] **Step 5: Commit**

```bash
git add src/tracking tests/tracking
git commit -m "feat(gym): one exercise identity by id and exact titles; look-alikes only as swap ideas"
```

### Task 5: Workout screen shows the resolved muscle, unknown stays visible

**Files:**
- Modify: `src/tracking/ui/WorkoutScreen.tsx:140-185`, `src/tracking/ui/MuscleIcon.tsx`, `src/tracking/ui/ExerciseInfo.tsx` (drop `via`), `src/tracking/ui/tracking.css` (unknown mark), `docs/research/2026-11-06-migration-assessment.md` (§5 status line for steps 0 and 1)
- Test: `tests/tracking/exercise-info.test.tsx`

**Interfaces:**
- Consumes: `resolveExercise`, `describeExercise` (Task 4); `readStats`, `STATS_ID` from `src/shared/stats.ts`; `usePortRecords(port, 'stats')` from `hooks.ts`.
- Produces: `MuscleIcon({ group: MuscleGroup | null; size?: number })` — `null` draws the front silhouette all muted plus a centred "?" and has `aria-label="Muskel unbekannt"`.

- [ ] **Step 1: Write the failing tests** in `tests/tracking/exercise-info.test.tsx` (add the stats record to `fakePort` where needed: `{ kind: 'stats', id: 'stats', updatedMs: 1, deleted: false, body: { type: 'stats', atMs: 1, goal: null, days: [], muscles: { 'h-row': 'upper_back' } } }`):

```ts
test('a Hevy row unknown to the catalog shows the back from the stats muscles', async () => { /* exercise ('h-row', 'Cable Row Custom') → img name 'Rücken' */ });
test('without a stats record the same exercise shows "Muskel unbekannt", not Sonstiges', async () => { /* → getByRole('img', { name: 'Muskel unbekannt' }) */ });
test('a malformed stats record is ignored', async () => { /* body: { type: 'stats' } → 'Muskel unbekannt', no throw */ });
test('a Smith machine squat shows no free-weight text and no pictures', async () => {
  /* open Ausführung for ('h-smith', 'Squat (Smith Machine)') → note contains 'Für diese Übung gibt es noch keine Beschreibung.' and no <img> inside the note, no 'Beschrieben am Beispiel' */
});
test('the machine reverse fly from Hevy shows its machine text', async () => {
  /* ('h-rdf', 'Rear Delt Reverse Fly (Machine)') → note text matches the Task 3 description, not /Kurzhantel/ */
});
test('MuscleIcon with null is labelled as unknown', () => {
  render(<MuscleIcon group={null} />);
  expect(screen.getByRole('img', { name: 'Muskel unbekannt' })).toBeTruthy();
});
```

Remove or rewrite existing tests that expect `Beschrieben am Beispiel` for an other-equipment variant; the text must no longer appear anywhere.

- [ ] **Step 2: Run** `npx vitest run tests/tracking/exercise-info.test.tsx` — Expected: FAIL.

- [ ] **Step 3: Implement.** In `WorkoutScreen` read the stats muscles once (`readStats` on the record with id `STATS_ID`, `null` when missing or malformed), resolve each exercise once with `resolveExercise(e, catalog, muscles)`, and use the result for icon (`group`), pictures (`exerciseImages` of `exercise.id` only) and video (`hevyTitle` of `exercise`). `ExercisePicker` keeps `muscleGroupOf(e)` (catalog entries are always known). Update the migration assessment §5 rows 0 and 1 with "umgesetzt in <commit range>" and one line of remaining work: shoulders still split front vs. side+rear only (three groups in step 2); the title regex in `muscleGroupOf` for external shoulder exercises stays until step 2; user-custom Hevy names without template need a confirmed per-profile link (step 8 territory).

- [ ] **Step 4: Run** `npm test && npm run typecheck` — Expected: all PASS. Then `npm run dev:web`, start a workout with a logged "Rear Delt Reverse Fly (Machine)" and a "Squat (Smith Machine)" from fake data and check icon and Ausführung by eye; or `npm run ui:shots` if it covers the workout screen.

- [ ] **Step 5: Commit**

```bash
git add src/tracking/ui tests/tracking/exercise-info.test.tsx docs/research/2026-11-06-migration-assessment.md
git commit -m "feat(gym): workout screen shows the resolved muscle and marks unknown ones"
```
