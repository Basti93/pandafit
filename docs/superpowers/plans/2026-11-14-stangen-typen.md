# Stangen-Typen – Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development. Steps use checkbox (`- [ ]`) syntax.

**Goal:** Langhantel-Übungen rechnen mit dem Gewicht ihres Stangen-Typs (Langhantel oder SZ-Stange) im jeweiligen Studio statt immer mit 20 kg.

**Architecture:** Produktwerte (Standardgewichte, Typ je Katalog-Übung) in Regeln und Katalog; persönliche Werte (Gewicht je Typ und Studio, geänderter Typ einer Übung) in der neuen Record-Art `bar`. Eine reine Funktion `barKgFor` liefert das Stangengewicht; alle Rechnungen, die heute `ruleNumber('load.bar-kg')` nutzen, bekommen es als Wert übergeben.

**Spec:** `docs/superpowers/specs/2026-11-14-stangen-typen-design.md`

## Global Constraints

- Ohne `bar`-Records verhält sich alles genau wie heute, außer bei `pf-preacher-curl` und `pf-skullcrusher` (Standard SZ 10 kg).
- Gewichte sind Gesamtgewichte mit Stange.
- App und Coach rechnen gleich (gleiche reine Funktionen aus `src/shared`).
- `tests/architecture/boundaries.test.ts` bleibt grün. 16 bekannte tsc-Fehler nur in `src/coach/runtime/index.ts`.
- UI-Texte: natürliche deutsche Sätze, „du“.

## Review Focus

1. Studio-Umbenennungen: ein Gewicht für „Gym A“ gilt nach Umbenennung weiter (gleiche Auflösung wie `loadstep`, `resolveStudio`/`studioKey`). → Test in Task 1.
2. Ungültige Eingaben (0, negativ, > 30 kg, nicht auf 0,25-kg-Raster) werden nicht gespeichert. → Test in Task 1.
3. Eine Nicht-Langhantel-Übung hat Stange 0, auch wenn ein `bar`-Record sie fälschlich nennt. → Test in Task 1.
4. Scheiben-Zeile bei Gewicht unter der Stange: „Leichter als die Stange (8,5 kg)“. → Test in Task 2.
5. Aufwärmen beim Scott-Curl beginnt mit 8,5 kg statt 20 kg; kein Satz darunter. → Test in Task 2.

---

### Task 1: Modell – Typen, Regeln, Katalog, Records, `barKgFor`

**Files:**
- Create: `src/shared/bars.ts`, `tests/shared/bars.test.ts`
- Modify: `src/shared/training-policy/rules.ts` (Regel `load.sz-bar-kg`, 10 kg, neben `load.bar-kg`), `src/shared/exercises.ts` (Typ `sz` für `pf-preacher-curl`, `pf-skullcrusher`; Feld oder Tabelle nach Muster der Datei), `src/shared/records.ts` (`'bar'` in `RECORD_KINDS`; prüfen, wo neue Arten sonst noch registriert werden müssen, z. B. Server-Validierung und Sync)

**Interfaces (Produces):**
- `type BarType = 'langhantel' | 'sz'`
- `type Bars = { weights: Map<string, number>; uses: Map<string, BarType> }` (Schlüssel wie bei `LoadStepOverrides`)
- `readBars(records: readonly TrackedRecord[], renames?: Renames): Bars`
- `barTypeOf(exerciseId: string, bars: Bars): BarType` (Person vor Katalog vor `langhantel`)
- `barKgFor(exerciseId: string, equipment: string, studio: string, bars: Bars): number` – 0 wenn `equipment !== 'barbell'`
- `barWeightRecord(type: BarType, studio: string, kg: number, nowMs: number): TrackedRecord`, `barUseRecord(exerciseId: string, type: BarType, nowMs: number): TrackedRecord` (IDs per `titleHash` wie `loadStepId`)
- `BAR_LABEL: Record<BarType, string>` = `{ langhantel: 'Langhantel', sz: 'SZ-Stange' }`

- [ ] Failing tests: Standard 20/10; Katalog-SZ für Scott-Curl; Record-Gewicht 8,5 im Studio gilt nur dort; Umbenennung; Typ-Wechsel per Record; ungültige Gewichte verworfen; Nicht-Langhantel = 0.
- [ ] Implementieren, Tests grün, ganze Suite, Commit `feat(training): Stangen-Typen mit Gewicht pro Studio`.

### Task 2: Rechnungen und Übungs-Info

**Files:**
- Modify: `src/shared/loads.ts` (`learnLadder`, `extendDown`, `platesPerSide` bekommen `barKg: number` statt `ruleNumber('load.bar-kg')`), `src/shared/warmup.ts` (`warmupRamp` bekommt `barKg`), `src/shared/gym/progression.ts`, `src/tracking/session.ts`, `src/tracking/steps.ts` (`plateLine(totalKg, barKg)`, `ladderHere` mit `barKg`), `src/tracking/ui/workout/FocusCard.tsx`, `src/tracking/ui/workout/SetsSheet.tsx`, Coach-Planung (alle Aufrufer finden: `rtk grep -rn "load.bar-kg\|extendDown\|platesPerSide\|warmupRamp\|learnLadder\|plateLine" src`)
- Modify: `src/tracking/ui/ExerciseInfo.tsx` bzw. die `StepLine`-Stelle in FocusCard: Zeile „Stange: SZ-Stange, 8,5 kg“ nur bei Langhantel-Übungen; Tippen öffnet ein kleines Sheet: Typ wählen (gilt für die Übung) und Gewicht dieses Typs im aktuellen Studio eingeben; speichert per `barUseRecord`/`barWeightRecord`.
- Test: bestehende Tests anpassen; neue Tests für Scheiben-Zeile (8,5 kg Stange, 22,5 kg → „Scheiben je Seite: 5 + 2“ je nach Scheiben-Regel; unter Stange → „Leichter als die Stange (8,5 kg)“), Aufwärmen Scott-Curl startet bei 8,5, Leiter geht bis 8,5 hinunter, UI-Test für die Info-Zeile und das Speichern.

- [ ] Failing tests, implementieren, ganze Suite, tsc, Commit `feat(training): Rechnungen nutzen das Gewicht der Stange`.
