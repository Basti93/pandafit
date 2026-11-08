# Meilenstein U „Was ich gemacht habe“ Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Die Wochenseite zeigt rückwirkend das Gemachte oder „Ruhetag“, ein Verlauf zeigt alle Sportarten, und eine neue Garmin-Aktivität ist nach spätestens einer Stunde in der App.

**Architecture:** Der Coach-Server veröffentlicht die schon vorhandene Zusammenführung `allActivities` als neuen Datensatz `activities` (Muster wie `exportHealth`). Die Web-App mischt diesen Datensatz mit lokal abgeschlossenen Krafttrainings (sofort sichtbar, auch offline) und baut daraus die Woche und den Verlauf. Der Garmin-Abgleich bekommt einen leichten stündlichen Modus `--quick`, der nur neue Aktivitäten holt.

**Tech Stack:** TypeScript, React, Vitest, Node (Coach-Server), Python 3 (`scripts/garmin/garmin_sync.py`, unittest).

**Spec:** `docs/roadmap.md`, Abschnitt „Meilenstein U — Brief“.

## Global Constraints

- Während einer offenen Fahrt wird weder abgeglichen noch veröffentlicht (`rideOpen()` / `noOpenRide()`), wie bei Health und Stats.
- Jede Aktivität zählt nur einmal (Regeln von `allActivities` / `trainingSessions` / `dedupeSessions`).
- Vergangener Tag ohne Aktivität: Text genau `Ruhetag`. Kein „verpasst“, kein Nachholen.
- Ruhig: eine Zeile pro Tag und pro Aktivität, keine Zahlenflut. Zahlen (Strecke, Puls) nur im Detailblatt.
- Neue Datensatzart `activities` in `RECORD_KINDS`: ändert die Sync-Signatur, jedes Gerät holt einmal alles neu (bewusst akzeptiert).
- Tests ersetzter Anzeigen (Kraft-„Trainings“-Liste, „Fahrten“-Zeile, „gefahren“) werden gelöscht, nicht angepasst.
- UI-Texte deutsch, mit Umlauten.

## Review Focus

1. **Datensatz fehlt noch** (Server nicht erreichbar, erste Synchronisation): Vergangene Tage dürfen dann nicht „Ruhetag“ behaupten. Erwartet: ohne `activities`-Datensatz zeigen vergangene Tage nur lokal bekannte Krafttrainings, sonst nichts. → Test in Task 5.
2. **Lokales Training und Server-Liste doppelt:** Ein eben beendetes Krafttraining steht lokal und später im Datensatz. Erwartet: einmal. → Test in Task 5.
3. **Später Abend / Zeitzone:** Eine Aktivität um 23:30 Ortszeit gehört zu ihrem lokalen Tag (`localDayKey`), nicht zum UTC-Tag. → Test in Task 5.
4. **Schneller Abgleich verschiebt den großen nicht:** Nach `--quick` bleibt der Zeitpunkt des großen Abgleichs gleich; eine Sperre (rate limit) gilt für beide. → Test in Task 2.
5. **Gelöschtes Krafttraining** verschwindet aus Woche und Verlauf, auch wenn der Server-Datensatz es noch enthält. → Test in Task 5.

---

### Task 1: Garmin-Skript lernt `--quick`

**Files:**
- Modify: `scripts/garmin/garmin_sync.py` (`run`, `main`)
- Test: `scripts/garmin/test_garmin_sync.py`

**Interfaces:**
- Produces: CLI-Flag `--quick`. Mit dem Flag ruft `run()` nur `self.catch_up()` (unabhängig davon, ob der Strom `activities` schon vollständig ist) und `self.recent_files()`. Keine Singletons, keine Tage, keine alten Dateien, kein `retry_errors`. Exit-Codes wie bisher (10 reauth, 11 rate limit). Die Statuszeile meldet `complete` nicht (sonst überschreibt der Node-Teil den Stand).

- [ ] **Step 1: Failing tests** `test_quick_stores_only_new_activities` (Fake-Client mit 2 neuen + 1 bekannter Aktivität: genau 2 neue in `activities`, `daily` unverändert, keine Aufrufe an Tages-Endpunkte) und `test_quick_runs_before_backfill_complete` (Strom `activities` noch nicht vollständig: neue Aktivität der ersten Seite wird trotzdem gespeichert, Cursor des Stroms bleibt gleich). Muster der vorhandenen Fake-Clients im Testfile nutzen.
- [ ] **Step 2:** `npm run test:garmin` → beide FAIL.
- [ ] **Step 3:** Option `quick` in `options`, Flag in `main()`, Verzweigung in `run()`.
- [ ] **Step 4:** `npm run test:garmin` → alle PASS.
- [ ] **Step 5:** Commit `feat(garmin): quick mode fetches only new activities`.

### Task 2: Stündlicher schneller Abgleich in `GarminSync`

**Files:**
- Modify: `src/coach/garmin-sync.ts`
- Test: `tests/coach/garmin-sync.test.ts`

**Interfaces:**
- Consumes: `--quick` aus Task 1.
- Produces: `Meta` bekommt `lastQuickMs: number | null` (Default `null`). Konstante `QUICK_MS = HOUR`.

Regeln in `tick(id)`:
- Ist der große Abgleich fällig (`due`), läuft er wie bisher (ohne `--quick`).
- Sonst startet ein schneller Lauf mit `--quick`, wenn `m.problem` nicht `reauth` oder `rate-limit` ist und `now - max(lastQuickMs, lastTryMs) >= QUICK_MS`.
- Schneller Lauf: setzt beim Start `lastQuickMs`; ändert nie `lastTryMs` und `complete`. Exit 0 setzt `lastRunMs`. Exit 10 → `problem: 'reauth'`, Exit 11 → `problem: 'rate-limit'` mit `lastTryMs` = Startzeit (gleiche Sperre wie groß). Andere Fehler ändern nichts außer `lastQuickMs`.
- Offene Fahrt: wie bisher nie starten, laufenden Lauf beenden.

- [ ] **Step 1: Failing tests:** `quick check runs one hour after the last try and passes --quick`; `quick check leaves lastTryMs and complete alone`; `full sync wins when it is due`; `rate limit from a quick check blocks both for six hours`; `no quick check while a ride is open`. Zeit über `nowMs` steuern, `spawnFn`-Fake wie im vorhandenen Test.
- [ ] **Step 2:** `npx vitest run tests/coach/garmin-sync.test.ts` → FAIL.
- [ ] **Step 3:** Implementieren; `start(id, mtime, quick: boolean)`.
- [ ] **Step 4:** Test → PASS; `npm run typecheck` sauber.
- [ ] **Step 5:** Commit `feat(garmin): hourly quick check for new activities`.

### Task 3: Datensatz `activities` (shared)

**Files:**
- Create: `src/shared/activities.ts`
- Modify: `src/shared/records.ts` (`'activities'` an `RECORD_KINDS` anhängen)
- Test: `tests/shared/activities.test.ts`

**Interfaces:**
- Produces:
  ```ts
  export const ACTIVITIES_ID = 'activities';
  export const MAX_ACTIVITIES = 60;
  export type ActivityKind = 'kraft' | 'rad' | 'lauf' | 'andere';
  export type ActivityItem = {
    key: string;            // wie TrainingSession.key: 'kraft-<id>', 'rad-<rideId>', 'garmin-<id>', 'lauf-<id>'
    kind: ActivityKind;
    title: string | null;   // Trainingsname, Fahrtname oder Garmin-Name
    sport: string | null;   // Garmin-Sportart, sonst null
    startMs: number;
    minutes: number;        // gerundet
    distanceM: number | null;
    avgHr: number | null;
    ref: string | null;     // Record-ID von workout bzw. ride, sonst null
  };
  export type ActivitiesBody = { type: 'activities'; atMs: number; items: ActivityItem[] };
  export function readActivities(body: unknown): ActivitiesBody | null;
  ```
- `readActivities` prüft Form und Typen, verwirft ungültige Einträge einzeln, lehnt mehr als `MAX_ACTIVITIES` Einträge ab. Stil wie `readHealth`.

- [ ] **Step 1: Failing tests:** gültiger Body kommt gleich zurück; falscher `type` → `null`; Eintrag mit `startMs: 'x'` wird verworfen, der Rest bleibt; 61 Einträge → `null`.
- [ ] **Step 2:** `npx vitest run tests/shared/activities.test.ts` → FAIL.
- [ ] **Step 3:** Implementieren, `RECORD_KINDS` ergänzen.
- [ ] **Step 4:** `npm test` (ganze Suite, weil Kind-Listen in Tests geprüft werden) → PASS; Tests, die die Kind-Liste fest aufzählen, auf die neue Liste bringen.
- [ ] **Step 5:** Commit `feat(records): activities record kind`.

### Task 4: Server veröffentlicht `activities`

**Files:**
- Create: `src/coach/activities-export.ts`
- Modify: `src/coach/runtime.ts` (Scan-Schleife neben `exportHealthNow`, ca. Zeile 715)
- Test: `tests/coach/activities-export.test.ts`

**Interfaces:**
- Consumes: `ActivityItem`, `ActivitiesBody`, `ACTIVITIES_ID`, `MAX_ACTIVITIES`, `readActivities` (Task 3); `allActivities` und `activitiesOf` in `runtime.ts`; `garminData(id)?.activities` (hat `distanceM`, `avgHr`).
- Produces:
  ```ts
  export function activityItems(sessions: TrainingSession[], garmin: { id: string; distanceM: number | null; avgHr: number | null }[]): ActivityItem[];
  export function exportActivities(d: { store: Pick<RecordStore, 'all' | 'put'>; profileIds: string[]; coachHere: (id: string) => boolean; noOpenRide: () => boolean; nowMs: number; content: (id: string) => ActivityItem[] | null }): string[];
  ```
- `activityItems`: neueste zuerst, höchstens `MAX_ACTIVITIES`. `kind`: Quelle `kraft` → `kraft`; Quelle `rad` → `rad`; Schlüssel `lauf-` oder Sportart passt auf `/run/i` → `lauf`; `CYCLING` → `rad`; `STRENGTH` → `kraft`; sonst `andere`. `ref`: Teil nach `kraft-` bzw. `rad-`, sonst `null`. Strecke und Puls nur für `garmin-<id>` aus der Garmin-Liste. Vorher prüfen, dass die IDs aus `gym.history(id)` die Record-IDs der `workout`-Datensätze sind; sonst dort `ref: null`.
- `exportActivities`: genau wie `exportHealth` (nur bei Änderung ohne `atMs`, nie bei offener Fahrt, nur `coachHere`, wirft nie, gibt geschriebene Profile zurück).
- In `runtime.ts`: `if (free) mealsChanged(exportActivities({ … content: (id) => activityItems(activitiesOf(id), garminData(id)?.activities ?? []) }))`.

- [ ] **Step 1: Failing tests:** `activityItems` ordnet Garmin-Lauf als `lauf` mit Strecke/Puls ein, Yoga als `andere`, Kraft mit `ref`; begrenzt auf 60; `exportActivities` schreibt nicht bei offener Fahrt, nicht bei gleichem Inhalt, schreibt bei neuem Eintrag.
- [ ] **Step 2:** `npx vitest run tests/coach/activities-export.test.ts` → FAIL.
- [ ] **Step 3:** Implementieren und in `runtime.ts` einhängen.
- [ ] **Step 4:** Test → PASS; `npm run typecheck`.
- [ ] **Step 5:** Commit `feat(coach): publish all activities for the web`.

### Task 5: Woche zeigt das Gemachte

**Files:**
- Create: `src/tracking/ui/done-days.ts` (reine Logik und Texte)
- Modify: `src/tracking/ui/WeekList.tsx`, `src/tracking/ui/CoachScreen.tsx`
- Test: `tests/tracking/done-days.test.ts`

**Interfaces:**
- Consumes: `readActivities`, `ActivityItem` (Task 3); `dedupeSessions`, `LoggedWorkout`; `localDayKey`.
- Produces:
  ```ts
  /** Server-Liste plus lokal beendete Krafttrainings, jede Aktivität einmal, neueste zuerst. known: false, wenn kein activities-Datensatz da ist. */
  export function mergedActivities(activities: TrackedRecord[] | null, workouts: TrackedRecord[] | null): { items: ActivityItem[]; known: boolean };
  /** Kurzer Tagestext: „Lauf 6 km“, „Kraft Oberkörper“, „Rad 45 Min“, „Yoga 30 Min“. */
  export function activityText(a: ActivityItem): string;
  export type DayRow = { date: string; done: string[]; plan: PlanDay | null; rest: boolean };
  export function doneDays(dates: string[], today: string, plan: PlanDay[] | null, merged: { items: ActivityItem[]; known: boolean }): DayRow[];
  ```
- `mergedActivities`: lokale Workouts = nicht gelöscht, `endMs !== null`, durch `dedupeSessions`; Schlüssel `kraft-<record.id>`. Lokal gewinnt bei gleichem Schlüssel; Server-Einträge `kraft` mit `ref`, deren Record lokal gelöscht ist, fallen weg. Ein lokales Workout, das sich mit einem Server-`kraft`-Eintrag zur Hälfte überschneidet (`overlapsByHalf`-Regel), zählt einmal.
- `activityText`: Lauf mit Strecke → `Lauf 6 km` (auf ganze km, unter 10 km eine Nachkommastelle erlaubt: `Lauf 5,5 km`); Kraft → `Kraft <Titel>` oder `Kraft`; sonst `<Sportname> <Min> Min`. Sportnamen: running → Lauf, cycling/biking → Rad, strength → Kraft, yoga → Yoga, walking → Gehen, hiking → Wandern, swimming → Schwimmen, sonst `Aktivität`.
- `doneDays` je Datum (Tag über `localDayKey(startMs)`):
  - vor heute: `done` = Texte des Tages, `plan: null`; `rest = done.length === 0 && known`.
  - heute: `done` = Texte; `plan` = Plantag, außer eine Aktivität gleicher Art (Plan-Sportart ↔ `kind`) ist heute schon da.
  - nach heute: `done: []`, `plan` = Plantag.
- `Week`: neue Prop `rows: DayRow[]` statt `days`/`rode`; Erledigtes mit ruhigem Haken (`✓`), `Ruhetag` gedämpft; Plantext und Läufe des Lauf-Coaches für `plan` wie bisher. Prop `rode` und „· gefahren“ entfallen.
- `CoachScreen`: Zeilen aus `doneDays` für die aktuelle Woche; ohne Wochenplan (`current === null`) und im Modus „Spontan“ trotzdem die Woche mit Montag bis heute (Plan `null`). Die Karte „Heute: …“ im Spontan-Modus bleibt über der Woche. „Nächste Woche“ unverändert.

- [ ] **Step 1: Failing tests** (`doneDays`/`mergedActivities`/`activityText`):
  - `past day shows only what was done` (Plan Kraft, gemacht Lauf → `done: ['Lauf 6 km']`, `plan: null`).
  - `past day without activity is Ruhetag`.
  - `without the activities record no past day claims Ruhetag` (Review Focus 1).
  - `today shows done and the remaining plan` (Lauf morgens, Plan Kraft → beides).
  - `today hides the plan once the planned sport is done`.
  - `a local workout and its server copy count once` (Review Focus 2).
  - `an activity at 23:30 local time belongs to that day` (Review Focus 3, Test mit `TZ=Europe/Berlin` wie vorhandene Datums-Tests).
  - `a deleted local workout disappears although the server still lists it` (Review Focus 5).
  - `activityText` für Lauf 6 km, Lauf 5,5 km, Kraft mit Titel, Yoga 30 Min.
- [ ] **Step 2:** `npx vitest run tests/tracking/done-days.test.ts` → FAIL.
- [ ] **Step 3:** Implementieren, `Week` und `CoachScreen` umstellen; Tests, die „gefahren“ prüfen, löschen.
- [ ] **Step 4:** `npm test` und `npm run typecheck` → PASS.
- [ ] **Step 5:** Commit `feat(week): past days show what was done or Ruhetag`.

### Task 6: Gemeinsamer Verlauf

**Files:**
- Create: `src/tracking/ui/ActivityHistory.tsx`
- Modify: `src/tracking/ui/HistoryScreen.tsx` (Detail exportieren), `src/tracking/ui/BikeScreen.tsx` (`RideSheet` exportieren), `src/tracking/ui/CoachScreen.tsx` (Zeile „Verlauf“), `src/tracking/ui/index.ts`
- Test: `tests/tracking/activity-history.test.tsx`

**Interfaces:**
- Consumes: `mergedActivities`, `activityText` (Task 5); `RideSheet`, `ridesOf`; die Workout-Detailansicht aus `HistoryScreen`.
- Produces: `export function ActivityHistory({ port, now, onClose }: { port: TrackingPort; now: () => number; onClose: () => void })`; `export function WorkoutDetail({ port, record, now, onBack }: { port: TrackingPort; record: TrackedRecord; now: () => number; onBack: () => void })` aus `HistoryScreen.tsx` (umschließt das vorhandene `Detail` samt `acquireStore`, `next`, `latest`).
- Liste: nach Monat gruppiert (`monthLabel`), Zeile = `activityText` + `dateLabel`, neueste oben, alle Einträge aus `mergedActivities` (höchstens 60 + lokale). Leer: „Hier erscheinen deine Aktivitäten.“
- Antippen: `kraft` mit lokalem Record → `WorkoutDetail`; `rad` mit `ref` und vorhandenem `ride`-Record → `RideSheet`; sonst neues Blatt `ActivitySheet` (in derselben Datei) mit Titel `activityText`, Datum und Uhrzeit, Dauer, Strecke und Ø Puls nur wenn vorhanden.
- `CoachScreen`: Zeile `Verlauf` direkt unter der Wochenkarte (vor den übrigen Zeilen), Wert = Text der neuesten Aktivität; öffnet `ActivityHistory` als eigene Ansicht wie der Chat (`sheet === 'history'`).

- [ ] **Step 1: Failing tests:** Liste zeigt Lauf, Yoga und Kraft neueste zuerst; Antippen eines Garmin-Laufs zeigt Strecke und Puls; Antippen von Kraft öffnet die Detailansicht mit dem Trainingsnamen; Zeile „Verlauf“ auf der Wochenseite öffnet die Liste.
- [ ] **Step 2:** `npx vitest run tests/tracking/activity-history.test.tsx` → FAIL.
- [ ] **Step 3:** Implementieren.
- [ ] **Step 4:** Test, `npm test`, `npm run typecheck` → PASS.
- [ ] **Step 5:** Commit `feat(history): one history across all sports`.

### Task 7: Alte Listen entfernen

**Files:**
- Modify: `src/web/App.tsx` (Kraft-Segment), `src/tracking/ui/HistoryScreen.tsx`, `src/tracking/ui/BikeScreen.tsx`, `scripts/web-shots.ts` (falls es die alten Ansichten fotografiert)
- Test: vorhandene Tests zu Kraft-Verlauf und „Fahrten“ löschen; `tests/web/*` auf neue Segmentnamen prüfen.

**Interfaces:**
- Kraft-Segment `Verlauf` heißt jetzt `Entwicklung` und zeigt nur noch die Übungsliste „Je Übung“ mit `Development` (Begriff aus L: Entwicklung = eine Übung über Zeit). `HistoryScreen` wird zu `DevelopmentScreen` (Datei darf bleiben); die Trainingsliste, der Umschalter „Trainings / Je Übung“ und „Ältere anzeigen“ fallen weg. `WorkoutDetail` bleibt exportiert.
- `BikeScreen`: Zeile „Fahrten“ und das Blatt „Fahrten“ entfernen; „Letzte Fahrt“ bleibt. `RunScreen` bleibt unverändert.

- [ ] **Step 1:** Entfernen und umbenennen.
- [ ] **Step 2:** `npm test`, `npm run typecheck`, `npm run test:web-smoke` → PASS.
- [ ] **Step 3:** `grep -rn "gefahren\|ridesByMonth" src` → keine toten Reste (ungenutzte Helfer löschen).
- [ ] **Step 4:** Commit `refactor: one history replaces the lists in Kraft and Ausdauer`.

### Task 8: Abnahme und Roadmap

- [ ] **Step 1:** Ganze Suite: `npm test && npm run typecheck && npm run test:garmin`.
- [ ] **Step 2:** `docs/roadmap.md`: U auf ✅, Brief-Überschrift „umgesetzt 08.11.2026“; Parkplatz-Notizen ergänzen, falls beim Bau etwas auffiel.
- [ ] **Step 3:** Commit `docs(roadmap): U done`. Deploy (`deploy.sh`) nur nach Rückfrage, nie während einer offenen Fahrt.
