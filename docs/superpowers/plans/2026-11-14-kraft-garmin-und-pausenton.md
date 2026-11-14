# Krafttraining zu Garmin und Ton in der Pause – Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ein Pandafit-Krafttraining lässt sich freiwillig als „Krafttraining“ (Start, Dauer) zu Garmin hochladen; die Pause hat Pieptöne kurz vor und am Ende.

**Architecture:** Der Coach-Server erzeugt aus dem `workout`-Record eine minimale FIT-Datei und schickt sie über den vorhandenen `GarminUploader`/`garmin_upload.py`. Der Status liegt neben dem der Fahrten in `CoachState.garminUpload`. Die Web-App zeigt Knopf und Vorschau auf Heute (Abschluss-Karte) und im Verlauf. Der Pausenton nutzt die Pieptöne vom Rad im Browser.

**Tech Stack:** TypeScript, React, `@garmin/fitsdk`, Vitest.

**Spec:** `docs/superpowers/specs/2026-11-14-kraft-garmin-und-pausenton-design.md`

## Global Constraints

- Garmin ist nie Pflicht: ohne Verbindung oder bei Hochlade-Modus `off` ist nichts sichtbar.
- Nichts geht von allein hoch; jedes Hochladen nach Vorschau und Bestätigung.
- Garmin bekommt nur: Sportart Krafttraining, Start, Dauer, Name „Krafttraining“, optional `REPO_DESCRIPTION`. Keine Übungen, Sätze, Gewichte, kein Puls.
- Nur Trainings mit `source: 'pandafit'` und `endMs !== null`. Ein Training geht nie zweimal hoch.
- UI-Texte: natürliche deutsche Sätze, „du“, keine Gedankenstrich-Fragmente.
- Die Grenzen in `tests/architecture/boundaries.test.ts` gelten; der Test muss grün bleiben.
- Keine persönlichen Daten im Repo.

## Review Focus

1. Ein Training, das gerade hochlädt, wenn der Server neu startet: Status wird `failed`, nicht ewig `uploading` (wie bei Fahrten in `state.ts:66`). → Test in Task 2.
2. Doppelklick oder zweites Gerät: zweiter Auftrag für dasselbe Training startet nicht. → Test in Task 2.
3. Hevy-Training, gelöschtes oder offenes Training (`endMs: null`): kein Hochladen, kein Knopf. → Tests in Task 2 und 3.
4. iPhone: `AudioContext` startet nur nach einer Berührung. Er wird beim Tippen auf „Satz geschafft“ geweckt, sonst bleibt die Pause stumm. → Task 4.
5. Der Ton spielt jede Sekunde höchstens einmal, auch wenn die Seite öfter neu zeichnet; nach „Pause überspringen“ oder Verlängern kommt kein falscher Ton. → Test in Task 4.

---

### Task 1: FIT-Datei für ein Krafttraining

**Files:**
- Create: `src/ride-format/export/strength-fit.ts`
- Test: `tests/ride-format/strength-fit.test.ts`

**Interfaces:**
- Produces: `exportStrengthFit(w: { startMs: number; endMs: number }): Buffer`

- [ ] **Step 1: Failing test** – Datei mit `Decoder` aus `@garmin/fitsdk` lesen:
  - `fileIdMesgs[0].type === 'activity'`
  - `sessionMesgs[0].sport === 'training'`, `subSport === 'strengthTraining'`
  - `sessionMesgs[0].totalElapsedTime === 2700` und `totalTimerTime === 2700` für 45 Minuten
  - `sessionMesgs[0].startTime` gleich `new Date(startMs)`
  - `activityMesgs.length === 1`, `Decoder.checkIntegrity()` ist true
- [ ] **Step 2:** `npx vitest run tests/ride-format/strength-fit.test.ts` → FAIL.
- [ ] **Step 3:** Implementieren nach dem Muster von `src/ride-format/export/fit.ts`: file_id, Timer-Event start/stopAll, ein LAP, eine SESSION, ACTIVITY. Keine RECORD-Nachrichten.
- [ ] **Step 4:** Test → PASS.
- [ ] **Step 5:** Commit `feat(garmin): FIT-Datei für ein Krafttraining`.

### Task 2: Server – Krafttraining hochladen und Status führen

**Files:**
- Modify: `src/shared/garmin-upload.ts` (Typ `GarminUploadSettings` um `workouts?: Record<string, RideUpload>`; `uploadSettings` liefert `workouts: {}` als Default)
- Modify: `src/coach/state.ts:66` (auch `workouts` mit `uploading` → `failed`)
- Modify: `src/coach/coach.ts` (`markWorkoutUpload(profileId, workoutId, upload)`)
- Modify: `src/coach/garmin-upload.ts` (`canUploadWorkout`)
- Modify: `src/shared/coach-messages.ts`, `src/coach/runtime/handlers.ts`, `src/coach/runtime/index.ts`, `src/coach/server/http.ts` (`takesEffect`), `src/web/coachLink.ts` (`SettingsMessage`)
- Test: `tests/coach/garmin-workout-upload.test.ts`

**Interfaces:**
- Consumes: `exportStrengthFit` (Task 1), `GarminUploader.upload(profileId, fileId, name, startMs, description?)` (vorhanden; `fileId` ist der Dateiname ohne `.fit` im Export-Ordner).
- Produces:
  - Nachricht `{ type: 'garmin-upload-workout', profileId, workoutId: string, repoLink?: boolean }`
  - `canUploadWorkout(s: CoachState, workout: { id: string; source: string; endMs: number | null; deleted?: boolean } | undefined): boolean`
  - Status in `coachState.garminUpload.workouts[workoutId]`, Typ `RideUpload`
  - Konstante `STRENGTH_ACTIVITY_NAME = 'Krafttraining'` in `src/shared/garmin-upload.ts`

- [ ] **Step 1: Failing tests**
  - `canUploadWorkout`: false für `undefined`, für `source: 'hevy'`, für `endMs: null`, für gelöscht, für Status `uploading` oder `uploaded`; true für `failed` und ohne Status.
  - Neustart: ein Zustand mit `workouts.w1.status === 'uploading'` wird beim Laden zu `failed`/`failed`.
  - `uploadSettings({})` liefert `workouts: {}`.
- [ ] **Step 2:** Tests → FAIL.
- [ ] **Step 3:** Implementieren. In `runtime/index.ts` `startWorkoutUpload(profileId, workoutId, repoLink)`:
  1. Workout-Record des Profils lesen (wie andere Stellen im Runtime, die `kind: 'workout'` lesen).
  2. Bei `canUploadWorkout` die FIT-Datei als `kraft-<workoutId>.fit` in den Export-Ordner schreiben.
  3. `uploader.upload(profileId, 'kraft-' + workoutId, STRENGTH_ACTIVITY_NAME, startMs, repoLink ? REPO_DESCRIPTION : undefined)`; bei true `markWorkoutUpload(..., { status: 'uploading' })`.
  4. `onResult` des Uploaders: `fileId` mit Präfix `kraft-` geht an `markWorkoutUpload`, sonst wie bisher an `markUpload`.
  - Ist die Workout-ID nicht `SAFE_ID`-tauglich (`/^[A-Za-z0-9-]+$/`), startet nichts.
- [ ] **Step 4:** `npx vitest run tests/coach` und `npx vitest run tests/architecture` → PASS.
- [ ] **Step 5:** Commit `feat(garmin): Krafttraining über den Server hochladen`.

### Task 3: Web – Knopf und Vorschau

**Files:**
- Create: `src/tracking/ui/GarminWorkoutUpload.tsx`
- Modify: `src/web/app/Heute.tsx` (in/unter der Abschluss-Karte `Finisher` für `latestFinishedStrength`)
- Modify: `src/tracking/ui/HistoryScreen.tsx` (Detail eines Pandafit-Trainings)
- Test: `tests/tracking/garmin-workout-upload.test.tsx`

**Interfaces:**
- Consumes: Nachricht und Status aus Task 2 über die vorhandene Coach-Verbindung der Web-App (`CoachLink`, Snapshot `view.upload`, `view.garmin`).
- Produces: `GarminWorkoutUpload({ workout, status, connected, mode, onUpload }: { workout: { id: string; startMs: number; endMs: number }; status?: RideUpload; connected: boolean; mode: 'off' | 'ask'; onUpload: (repoLink: boolean) => void })`

Verhalten wie `src/ui/views/GarminUploadButton.tsx` (dieselben Texte für Fehler, Status, Projekt-Link-Häkchen mit demselben localStorage-Schlüssel). Vorschau-Zeilen: Name „Krafttraining“, Start (Datum und Uhrzeit), Dauer in Minuten. Hinweistext: „Garmin bekommt nur die Sportart, den Start und die Dauer, keine Übungen. Hat deine Uhr das Training aufgezeichnet, steht es danach doppelt in Garmin Connect.“ Gemeinsame Teile (Fehlertexte, Projekt-Link-Häkchen) einmal ablegen, wo beide Seiten sie laut Grenztest importieren dürfen.

- [ ] **Step 1: Failing tests**
  - Nichts gerendert bei `connected: false` oder `mode: 'off'`.
  - Erster Klick auf „Zu Garmin hochladen“ zeigt die Vorschau mit „Krafttraining“ und „45 Min.“; `onUpload` noch nicht gerufen.
  - „Jetzt hochladen“ ruft `onUpload(false)`; mit Häkchen `onUpload(true)`.
  - Status `uploaded` zeigt deaktiviert „Bei Garmin“; `failed` mit `reauth` zeigt den Anmelde-Text und „Erneut versuchen“.
- [ ] **Step 2:** Tests → FAIL.
- [ ] **Step 3:** Implementieren und auf Heute und im Verlauf einbauen (nur `source: 'pandafit'`, `endMs !== null`).
- [ ] **Step 4:** `npx vitest run tests/tracking tests/web tests/architecture` → PASS.
- [ ] **Step 5:** Commit `feat(garmin): Krafttraining in der Web-App zu Garmin hochladen`.

### Task 4: Ton in der Pause

**Files:**
- Move: Ton-Erzeugung aus `src/ui/countdown.ts` (`beep`) an eine Stelle, die `src/ui` und `src/tracking/ui` laut Grenztest importieren dürfen; `src/ui/countdown.ts` nutzt sie weiter.
- Create: `src/tracking/ui/workout/restSound.ts`
- Modify: `src/tracking/ui/workout/useActiveWorkout.ts` (Ton im Takt der Pause; AudioContext beim „Satz geschafft“-Tippen wecken)
- Modify: `src/tracking/ui/CoachPrefs.tsx` oder die Stelle mit dem Schalter für die Tempo-Frage: Schalter „Ton in der Pause“
- Test: `tests/tracking/rest-sound.test.ts`

**Interfaces:**
- Produces:
  - `restBeepAt(prevLeftS: number | null, leftS: number): 3 | 2 | 1 | 0 | null` – liefert die Sekunde, die beim Übergang von `prevLeftS` zu `leftS` (ganze Sekunden, aufgerundet) erreicht wurde, wenn sie in {3, 2, 1, 0} liegt; sonst null.
  - `restSoundOn(): boolean`, `saveRestSound(on: boolean): void`, Schlüssel `pandafit.rest-sound`, Default an.
  - `primeSound(): void` – weckt den AudioContext in einer Nutzer-Geste, wirft nie.

- [ ] **Step 1: Failing tests**
  - `restBeepAt(4, 3) === 3`, `restBeepAt(3, 3) === null` (kein Doppelton), `restBeepAt(1, 0) === 0`, `restBeepAt(10, 9) === null`.
  - Sprung durch Überspringen: `restBeepAt(40, 0) === null` (nur Schritte von genau einer Sekunde klingen).
  - Verlängern: `restBeepAt(2, 32) === null`.
  - `restSoundOn()` ist true ohne Eintrag und false nach `saveRestSound(false)`.
- [ ] **Step 2:** Tests → FAIL.
- [ ] **Step 3:** Implementieren. Ton bei 3, 2, 1 mit 880 Hz, bei 0 mit 1320 Hz (Werte vom Rad). Nur wenn `restSoundOn()` und die Seite sichtbar ist.
- [ ] **Step 4:** `npx vitest run` (ganze Suite) → PASS; `npx tsc --noEmit -p .` ohne neue Fehler außerhalb von `src/coach/runtime/index.ts` (dort 16 alte Fehler).
- [ ] **Step 5:** Commit `feat(training): Ton kurz vor und am Ende der Pause`.
