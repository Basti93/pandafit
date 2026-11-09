# Fundament (technische Schulden) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Pandafit wird einfacher wartbar und erweiterbar, und die Qualität steigt, ohne dass sich für die Nutzer etwas anders anfühlt (außer: sicherer).

**Architecture:** Erst gemeinsame Bausteine (atomares Schreiben, Logger, Eingabeprüfung, Python-Runner), dann Sicherheitslücken schließen, dann Modulgrenzen ziehen und mit einem Architekturtest festhalten, dann Gottdateien aufteilen (Coach-Runtime, Web-App), zuletzt Design-Tokens, Bundles und Werkzeuge (ESLint, CI).

**Tech Stack:** TypeScript 7, React 19, Electron 45, Fastify 5, node:sqlite, zod 4, vitest 5.

**Spec:** Die Schuldenliste aus der Sitzung vom 09.11.2026, zusammengefasst in `docs/roadmap.md`, Meilenstein „Fundament“.

## Global Constraints

- Top-Regel: Eine Fahrt geht nie verloren. Jede Änderung an `src/service/**` braucht einen Test, der Datenerhalt zeigt.
- Kein Deploy, kein Push, kein `npm run app`. Nur lokal in einem Branch arbeiten.
- Keine Änderung am sichtbaren Verhalten der UI, außer wo eine Aufgabe es sagt. UI-Texte bleiben Deutsch in ganzen Sätzen.
- Gespeicherte Daten bleiben lesbar: alte Dateien ohne neue Felder müssen weiter funktionieren (fehlendes Feld = alte Version).
- Code-Kommentare auf Englisch, kurz, wie im Bestand.
- Commit-Präfixe wie im Bestand (`refactor(…)`, `fix(…)`, `feat(…)`, `chore(…)`, `test(…)`), jeder Commit endet mit `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.
- Nach jeder Aufgabe grün: `npm run typecheck && npm test && npm run test:chaos`.
- Keine neuen Laufzeit-Abhängigkeiten außer den in einer Aufgabe genannten.

## Review Focus

1. Eine Fahrt, deren `meta.json` beim Absturz leer oder kaputt ist, muss nach dem Neustart wieder auftauchen (Task 2).
2. Die Mac-App, `npm run dev`, `npm run live:adjust`/`live:mark` und das Handy als Begleiter (über den Coach-Relay) müssen nach dem Token-Umbau weiter verbinden (Task 3).
3. Ein älterer Client mit Records in der Offline-Warteschlange darf durch die neue Prüfung nicht hängen bleiben: nur der eine gefährliche Fall wird abgewiesen (Task 4).
4. Bestehende SQLite-Datenbanken auf dem Server starten mit der neuen Migrationslogik ohne Datenverlust (Task 5).
5. Die Web-App bleibt offline bedienbar und aktualisiert sich nach jedem Schreiben weiter richtig, auch mit dem neuen Cache (Task 10).

---

### Task 1: Aufräumen

**Files:**
- Delete: `src/tracking/ui/PandaPortrait.tsx.bak`
- Move: `src/ui/coachTrackingPort.ts` → `tests/support/coachTrackingPort.ts` (nur Tests nutzen ihn), Imports in `tests/tracking/*` anpassen
- Modify: `src/service/ble/device-manager.ts` (`setGrade` weg), `src/service/ride-service.ts` (`subscribeActiveProfile`, `isRiding`, `close` weg, wenn unbenutzt; verwaisten Kommentar Z. 16 weg), `src/service/engine.ts` (`gradePct`/`gear` nur weg, wenn kein Leser in `src/ui`, `src/shared/protocol.ts`, Tests)
- Modify: `src/ui/style.css` (Klassen ohne Nutzer in `src/` löschen)
- Modify: `src/service/ble/noble-adapter.ts:29-32` (veralteten Kommentar „Not yet tested…“ weg)
- Modify: `scripts/live-undo.ts`
- Test: `tests/scripts/live-undo.test.ts` (neu, wenn noch keiner existiert)

- [ ] **Step 1:** Prüfe jede Löschung mit `grep -rn` über `src tests scripts web-server`. Lösche nur, was keinen Nutzer hat.
- [ ] **Step 2:** Tote CSS-Klassen: Schreibe ein kurzes Wegwerf-Skript im Scratchpad, das jede Klasse aus `src/ui/style.css` in `src/**/*.tsx` sucht (auch in Template-Strings, `className={`…`}`). Lösche nur Klassen ohne Treffer.
- [ ] **Step 3:** `live:undo` soll den neuesten `live:`-Commit revertieren, der noch nicht revertiert ist. Ein Commit gilt als revertiert, wenn ein späterer Commit `This reverts commit <sha>` enthält. Test: zwei `live:`-Commits in einem Temp-Repo, zweimal undo → beide revertiert. Lege die Auswahl in eine exportierte Funktion `pickUndoTarget(log: { sha: string; subject: string; body: string }[]): string | null` (neueste zuerst) und teste diese.
- [ ] **Step 4:** Alles grün, Commit `chore: remove dead code and fix live:undo picking an already reverted commit`.

### Task 2: Atomares Schreiben an einer Stelle, Fahrt-Metadaten sicher

**Files:**
- Create: `src/shared/node/atomic-write.ts`
- Modify: alle Stellen mit `writeFileSync(… .tmp …)` + `renameSync` und die eigenen Helfer `writeSynced` (`src/coach/server/migration.ts:100`, `src/coach/server/ride-store.ts:11`, `src/coach/remote/ride-restore.ts:26`), `writeAtomic` (`src/coach/remote/remote-coach.ts:55`), `writeJson` (`src/coach/server/household.ts:63`), dazu `src/service/recorder.ts:102-106`, `src/service/ride-service.ts:100-101`, `src/service/ble/noble-adapter.ts:104-107` (devices.json), `src/coach/ai-gate.ts:48`
- Modify: `src/service/recovery.ts`, `src/service/recorder.ts` (Versionsfeld)
- Test: `tests/shared/atomic-write.test.ts`, `tests/service/recovery.test.ts`

**Interfaces:**
- Produces: `writeFileAtomic(file: string, data: string | Uint8Array, opts?: { mode?: number }): void` und `writeJsonAtomic(file: string, value: unknown, opts?: { mode?: number }): void`. Ablauf: eindeutige Temp-Datei im selben Ordner (`<name>.<pid>.<random>.tmp`), schreiben, `fsyncSync`, schließen, `renameSync`, dann den Ordner öffnen und `fsyncSync` (Fehler beim Ordner-fsync ignorieren, Windows/manche FS). Bei Fehler Temp-Datei löschen und Fehler weiterwerfen. `mode` wird beim Anlegen gesetzt (Standard 0o644, Geheimnisse bleiben bei ihrem bisherigen Modus, z. B. 0o600).
- Produces: `RideMeta.formatVersion?: number`; neue Fahrten schreiben `formatVersion: 1`; fehlend = 0.

- [ ] **Step 1: Tests für den Helfer:** Inhalt landet; keine `.tmp`-Reste nach Erfolg; bei Fehler im Schreiben bleibt die alte Datei unverändert und die Temp-Datei ist weg; `mode: 0o600` ergibt Dateirechte 0600.
- [ ] **Step 2:** Helfer bauen, Tests grün.
- [ ] **Step 3: Recovery-Test (Datenerhalt):** Ein Fahrtordner mit `samples.jsonl` (gültige Zeilen) und leerem oder kaputtem `meta.json` → `findOpenRides` liefert die Fahrt als offen, mit einer aus den Samples rekonstruierten Meta (`id` = Ordnername, `status: 'open'`, Startzeit aus dem ersten Sample). Ohne Samples und ohne lesbare Meta wird der Ordner weiter übersprungen. Prüfe in `readMeta`/`RideMeta`, welche Pflichtfelder es gibt, und fülle fehlende neutral (z. B. Profil `null` → Standardprofil wie heute beim Start ohne Profil). Rekonstruierte Meta wird sofort mit `writeJsonAtomic` gespeichert.
- [ ] **Step 4:** Recovery umbauen, Test grün.
- [ ] **Step 5:** Alle Schreibstellen auf den Helfer umstellen. In `noble-adapter.ts` `devices.json` schreiben, bevor `ready = true` gesetzt wird; ein Fehler beim Schreiben trennt das Gerät nicht, sondern wird geloggt (vorerst `console.error`; Task 6 ersetzt das).
- [ ] **Step 6:** `formatVersion: 1` in neue `meta.json` und `session.json`; Lesepfade akzeptieren fehlendes Feld. Test: alte Meta ohne Feld wird gelesen.
- [ ] **Step 7:** `grep -rn "\.tmp" src web-server` zeigt nur noch den Helfer. Alles grün, Commit `refactor: one fsynced atomic write helper; a ride with a broken meta.json is recovered`.

### Task 3: Lokale WebSockets mit Token

**Files:**
- Create: `src/shared/node/local-token.ts`
- Modify: `src/main/index.ts` (Token erzeugen, an Kindprozesse und Fenster geben, `will-navigate`-Schutz), `src/main/film-window.ts` (nur eigene Renderer-URL zulassen), `src/service/ws-server.ts`, `src/service/main.ts`, `src/coach/main.ts`, `src/coach/remote/live-relay.ts`, `src/ui/useRide.ts`, `src/ui/useCoach.ts`, `scripts/live-client.ts`, `scripts/install-app.sh`, alle anderen Skripte, die 7410/7411 öffnen
- Test: `tests/service/ws-server.test.ts`, `tests/main/*` (falls vorhanden), `tests/shared/local-token.test.ts`

**Interfaces:**
- Produces: `ensureLocalToken(dataDir: string): string` liest `<dataDir>/local-token` oder legt es an (32 Byte zufällig, hex, Datei 0600 über `writeFileAtomic`). `readLocalToken(dataDir: string): string | null`.
- Produces: `originAllowed(devOrigin?: string)` erlaubt nur noch `'file://'` und `devOrigin`; `verifyClient` verlangt zusätzlich `?t=<token>` in der URL (konstanter Vergleich mit `crypto.timingSafeEqual`). Verbindungen ohne Origin (Node-Skripte, Coach-Relay) brauchen nur das Token. `'null'` ist nie erlaubt.
- Port-Variable einheitlich: `PANDAFIT_SERVICE_PORT` und `PANDAFIT_COACH_PORT`; alte Namen (`BIKE_PORT`, `BIKE_SERVICE_PORT`, `BIKE_COACH_PORT`) bleiben als Rückfall lesbar.

- [ ] **Step 1: Tests:** Verbindung mit falschem/fehlendem Token → abgelehnt; `Origin: null` mit gültigem Token → abgelehnt; ohne Origin mit Token → angenommen; `file://` mit Token → angenommen. Gleiches für den Coach-Port.
- [ ] **Step 2:** Main erzeugt das Token mit `ensureLocalToken(userData)` vor dem Start der Kindprozesse und reicht es per Umgebungsvariable `PANDAFIT_LOCAL_TOKEN` weiter; Service und Coach lesen erst die Variable, sonst die Datei. Das Fenster bekommt das Token über die Query (`loadFile(…, { query: { t } })` bzw. `?t=` an die Dev-URL); `useRide`/`useCoach` lesen es aus `location.search`.
- [ ] **Step 3:** Skripte lesen das Token mit `readLocalToken` aus dem Datenordner (`~/Library/Application Support/bike-coach`). `install-app.sh` ebenso (Node-Einzeiler liest die Datei).
- [ ] **Step 4:** `will-navigate` im Hauptfenster: nur die eigene Renderer-URL; alles andere `preventDefault` und, wenn erlaubt, extern öffnen wie im WindowOpenHandler. `openFilmWindow` nur mit derselben Basis-URL wie das Hauptfenster. In `BrowserWindow` `webPreferences: { contextIsolation: true, sandbox: true, nodeIntegration: false }` ausdrücklich setzen.
- [ ] **Step 5:** `npm run dev:sim` 20 s starten (Hintergrund), prüfen, dass `scripts/live-client.ts` verbindet (z. B. `npm run live:mark` antwortet ohne Fehler) und im Log keine abgelehnten Verbindungen der UI stehen; danach beenden. Ist eine echte Fahrt offen, diesen Schritt auslassen und melden.
- [ ] **Step 6:** Alles grün, Commit `fix(security): local WebSockets need a per-machine token, origin null is refused`.

### Task 4: Eingaben an den Grenzen prüfen

**Files:**
- Create: `src/shared/ride-messages.ts` (zod-Schema für `ClientMessage`), `src/shared/coach-messages.ts` (zod-Schema für `CoachClientMessage`)
- Modify: `src/service/ws-server.ts:31`, `src/coach/server/http.ts:316`, `src/coach/runtime.ts` (handle), `src/shared/guardrails.ts` (`clampTargetW`), `web-server/records.ts` (Chat-Records), `src/coach/coach.ts:258` (Notizen), `src/coach/claude-client.ts:38`
- Test: `tests/service/ws-server.test.ts`, `tests/shared/guardrails.test.ts`, `tests/web-server/records.test.ts` (oder bestehende), `tests/coach/coach.test.ts`, `tests/coach/claude-client.test.ts`

**Interfaces:**
- Produces: `parseClientMessage(raw: string): ClientMessage | null`, `parseCoachClientMessage(raw: unknown): CoachClientMessage | null`. Die TS-Typen werden aus den Schemas abgeleitet (`z.infer`) und in `protocol.ts`/`coach-protocol.ts` re-exportiert, damit es nur eine Quelle gibt. Unbekannte oder ungültige Nachricht → Antwort `{ type: 'error', message }` wie heute bei Fehlern, Verbindung bleibt offen.

- [ ] **Step 1: Tests:** `adjust` mit `deltaPct: "x"`, `NaN` oder `1e9` → abgelehnt bzw. begrenzt; `clampTargetW(NaN, …)` liefert den letzten gültigen bzw. den Basiswert, nie NaN; unbekannter `type` → Fehlerantwort.
- [ ] **Step 2:** Schemas schreiben, Server umstellen, `clampTargetW` gegen NaN härten.
- [ ] **Step 3: Chat-Records:** Ein Client darf über `POST /records` keinen `chat`-Record mit Rolle des Coachs oder `push: true` schreiben (prüfe in `records.ts:82` die genauen Feldnamen). Nur dieser Fall wird mit 400 abgewiesen; alle anderen Records bleiben wie heute (Rückwärtskompatibilität der Offline-Warteschlange). Der interne Coach-Weg (`internal.ts`) darf es weiter. Test für beide Wege.
- [ ] **Step 4: Notizen:** Höchstens 50 Notizen pro Profil, jede höchstens 500 Zeichen (ältere fallen raus, Text wird gekürzt). Test.
- [ ] **Step 5: Prompt:** Den Prompt per stdin an die `claude`-CLI geben statt als argv (prüfe die Aufrufform in `claude-client.ts`; `claude -p` liest stdin, wenn kein Prompt-Argument da ist). Test mit Fake-Prozess: Prompt > 200 KiB kommt vollständig an.
- [ ] **Step 6:** Alles grün, Commit `fix: validate WebSocket messages with zod; guard NaN power, coach chat records and note growth`.

### Task 5: Server: Login-Sperre, Schlüssel getrennt, versionierte Migrationen

**Files:**
- Modify: `web-server/auth.ts:80-89`, `web-server/db.ts`, `web-server/index.ts:46`, `web-server/internal.ts:29`, `web-server/mac/pull-backups.sh`, `web-server/README.md`
- Test: `tests/web-server/auth.test.ts`, `tests/web-server/db.test.ts` (neu oder bestehend)

**Interfaces:**
- Produces: `openDb(file: string): DatabaseSync` führt Migrationen über `PRAGMA user_version` aus: `MIGRATIONS: ((db: DatabaseSync) => void)[]`, Index + 1 = Version. Migration 1 = heutiges Schema inklusive aller heutigen Sonderfälle (eine bestehende DB mit `user_version = 0` und vorhandenen Tabellen wird ohne Datenverlust auf 1 gehoben). Jede Migration in einer Transaktion. Der Prozess öffnet die DB einmal und gibt das Handle an `index.ts` und `internal.ts`.

- [ ] **Step 1: Login-Sperre:** Pro IP bleibt das Limit 10 in 15 Minuten. Pro Konto zählt nur noch mit Limit 100 in 15 Minuten (bremst verteiltes Raten, sperrt das Konto aber nicht mehr durch wenige Versuche). Test: 10 Fehlversuche von IP A sperren A, IP B kann sich beim selben Konto weiter anmelden.
- [ ] **Step 2: Migrationen:** Tests: frische DB → `user_version` = aktuelle Version, alle Tabellen da; DB im Zustand vor der Umstellung (Fixture mit altem Schema und Daten, inklusive dem Fall ohne `meal_weeks`) → Daten bleiben, `user_version` gesetzt; zweimal öffnen ist idempotent.
- [ ] **Step 3:** `db.ts` umbauen; einmal öffnen in `index.ts` und an `internal.ts` weitergeben.
- [ ] **Step 4: Schlüssel:** `pull-backups.sh` legt die Zugangsdateien nicht mehr unter dem Sicherungsordner ab, sondern in `SECRETS_DIR` (Standard `$HOME/.pandafit-secrets`, Rechte 700). Das Skript warnt einmal, wenn unter `$TARGET/secrets` noch alte Kopien liegen (löscht nichts). README-Abschnitt anpassen.
- [ ] **Step 5:** Alles grün, Commit `fix(server): per-IP login lock, versioned migrations, secrets apart from backups`.

### Task 6: Fehler sichtbar machen, ein Python-Runner

**Files:**
- Create: `src/shared/node/log.ts`, `src/coach/python-runner.ts`
- Modify: `web-server/index.ts:49`, `web-server/internal.ts:31`, `src/coach/server/http.ts:61`, `src/coach/runtime.ts` (`.catch(() => {})`), die Integrationen Hevy, Garmin (`garmin.ts`, `garmin-sync.ts`, `garmin-uploader.ts`, `run/garmin-workouts.ts`), KI-Client, Mail
- Test: `tests/shared/log.test.ts`, `tests/coach/python-runner.test.ts`

**Interfaces:**
- Produces: `createLogger(scope: string): { info(msg: string, data?: object): void; warn(msg: string, data?: object): void; error(msg: string, err?: unknown, data?: object): void }`. Eine Zeile JSON pro Eintrag auf stderr (`{ t, level, scope, msg, err?: { name, message }, ...data }`). Keine Bodies, keine Tokens, keine Gesundheitsdaten im Log; `data` nur mit IDs, Zählern, Dauer.
- Produces: `runPython(script: string, args: string[], opts: { input?: string; timeoutMs: number; env?: NodeJS.ProcessEnv }): Promise<{ code: number; stdout: string; stderr: string }>`. Timeout beendet den Prozess (SIGTERM, nach 5 s SIGKILL) und liefert einen Fehler. stderr wird gesammelt (höchstens 64 KiB) und bei Fehlern geloggt.
- Fastify: `logger: { level: 'warn' }` plus ein eigener `onResponse`-Hook, der 5xx-Antworten mit Methode, Route (nicht URL mit Parametern) und Dauer über `createLogger('http')` loggt.

- [ ] **Step 1:** Tests für Logger (Format, Fehlerobjekt) und Runner (Timeout beendet einen `sleep`-Prozess; stderr wird zurückgegeben; Exit-Code ungleich 0 → Fehler mit stderr-Auszug).
- [ ] **Step 2:** Bauen, die vier Garmin-Aufrufe auf `runPython` umstellen, Timeouts übernehmen (garmin-sync: 10 Minuten).
- [ ] **Step 3:** In `runtime.ts` jedes `.catch(() => {})` durch `.catch((e) => log.error('<was>', e))` ersetzen. Leere `catch {}` nur dort ersetzen, wo ein externer Dienst oder ein Schreibvorgang scheitert; erwartete Fälle (Datei fehlt, ENOENT, JSON-Parse einer optionalen Datei) bleiben mit Kommentar.
- [ ] **Step 4:** Alles grün, Commit `feat: structured error log for servers and integrations; one python runner with timeout`.

### Task 7: Fahrt robuster: Wiederherstellung und stilles Gerät

**Files:**
- Modify: `src/service/recovery.ts`, `src/service/ride-service.ts:204-213`, `src/service/engine.ts`, `src/service/ble/device-manager.ts`
- Test: `tests/service/recovery.test.ts`, `tests/service/engine.test.ts`, `tests/service/ble/device-manager.test.ts`

**Interfaces:**
- Produces: `resumePoint(ride)` liefert zusätzlich `adjustPct: number` (Summe der geloggten `adjust`-Events, geklemmt wie im Live-Betrieb); die Engine startet nach einer Wiederherstellung mit diesem Wert. Prüfe in `engine.ts:45-55`, welche weiteren Zustände (HR-Hold, Auto-Reduktion) aus Events rekonstruierbar sind; nur Rekonstruierbares übernehmen, den Rest in den Parkplatz.
- Produces: Watchdog im `DeviceManager`: Ein verbundenes Gerät ohne Messwert seit `SILENT_MS = 10_000` gilt als verloren (gleicher Pfad wie `disconnect`, Event `device-lost`, Reconnect). Reconnect mit Backoff 2 s, 4 s, 8 s … höchstens 30 s, zurück auf 2 s nach Erfolg.

- [ ] **Step 1: Tests:** Absturz nach `adjust +5` und `adjust +5` → nach Recovery Ziel = Basis × 1,10 (geklemmt); stiller Trainer (Fake-Adapter sendet nichts) → nach 10 s `device-lost` und Reconnect-Versuch; Backoff-Folge.
- [ ] **Step 2:** Bauen. Chaos-Tests laufen weiter grün.
- [ ] **Step 3:** Alles grün, Commit `fix(service): recovery keeps manual power changes; a silent device is reconnected`.

### Task 8: Modulgrenzen ziehen und festhalten

**Files:**
- Create: `tests/architecture/boundaries.test.ts`
- Create: `src/ride-format/` (Dateiformat einer Fahrt: Typen `RideMeta`, `Sample`, `RideEvent`, Lesen `readRide`, `readMeta`, `findOpenRides`, `resumePoint`, FIT-Export-Anbindung, Fahrt-ID-Muster)
- Move: `src/service/recorder.ts` (Format- und Leseteile), `src/service/recovery.ts`, `src/service/export/**` nach `src/ride-format/` (Service behält den Schreib-Recorder, nutzt das Format)
- Move: Gym-Domänentypen `src/coach/gym/types.ts` → `src/shared/gym/types.ts`; reine Funktionen, die der Mac-Renderer nutzt (`rampTest`, `estimateTss`, `progressText`, `uploadSettings` u. a.), dorthin, wo sie ohne `coach/`-Laufzeit liegen können (`src/shared/<domäne>/`)
- Modify: `src/shared/protocol.ts`, `src/shared/coach-protocol.ts`, `src/shared/changes.ts` (keine Imports aus `service/`/`coach/` mehr: die gebrauchten Typen nach `shared` bzw. `ride-format` verschieben)
- Modify: `web-server/Dockerfile`, `web-server/Dockerfile.coach` (ganze Ordner `src/shared`, `src/ride-format` kopieren statt Einzeldateien); den Test, der die Dateiliste prüft, anpassen
- Merge: `src/shared/guardrails.ts` und `src/coach/guardrails.ts` umbenennen, sodass die Namen den Inhalt sagen; doppelte Konstanten (`RAMP_ID`, Lücke 5000 ms, Fahrt-ID-Muster) je einmal

**Interfaces:**
- Produces: Architekturtest mit diesen Regeln (Pfadpräfixe, nur echte `import`/`export … from`, auch `import type`):
  - `src/shared/**` importiert nur `src/shared/**` und `src/ride-format/**`
  - `src/ride-format/**` importiert nur `src/shared/**`
  - `src/coach/**` importiert nicht `src/service/**`, `src/ui/**`, `src/web/**`, `src/main/**`
  - `src/ui/**` und `src/web/**` importieren aus `src/coach/**` nur `import type`
  - `src/tracking/**` importiert nicht `src/coach/**` außer `import type`
  - `web-server/**` importiert aus `src/` nur `src/shared/**`
  - `src/service/**` importiert nicht `src/coach/**`, `src/ui/**`, `src/web/**`
- Ausnahmen nur als benannte Liste im Test mit Begründung; Ziel ist eine leere Liste.

- [ ] **Step 1:** Architekturtest schreiben, laufen lassen, die Verstöße zählen (Test schlägt fehl).
- [ ] **Step 2:** Verschieben und Imports anpassen, bis der Test grün ist. Reine Verschiebungen als eigene Commits (`refactor: move … (no change)`), damit die Historie lesbar bleibt.
- [ ] **Step 3:** Docker-Builds lokal prüfen, wenn Docker da ist: `docker build -f web-server/Dockerfile .` und `-f web-server/Dockerfile.coach .`; sonst den bestehenden Dateilisten-Test grün halten und melden.
- [ ] **Step 4:** Alles grün, Commit `test: architecture boundaries; ride file format is its own module`.

### Task 9: Coach-Runtime aufteilen, ein Zustandsspeicher, Store-Cache, gemeinsame Server-Helfer

**Files:**
- Modify: `src/coach/runtime.ts` → `src/coach/runtime/` (`index.ts` Zusammenbau, `handlers.ts` Nachrichtentabelle, `scan.ts` Liste der Teilsysteme, je Teilsystem eine Datei, wo sinnvoll)
- Create: `src/coach/state-file.ts`
- Modify: `src/coach/state.ts`, `src/coach/gym/state.ts`, `src/coach/run/state.ts`, `src/coach/tracking/store.ts`
- Create: `src/shared/node/server-kit.ts` (Token-Digest, Fastify-Error-Handler, WS-Heartbeat, Konto-Regex, Body-Grenzen), genutzt von `web-server/*` und `src/coach/server/http.ts`
- Test: bestehende Runtime-/Coach-Tests bleiben unverändert grün; neu `tests/coach/state-file.test.ts`, `tests/coach/tracking/store-cache.test.ts`

**Interfaces:**
- Produces: `type Handler<T extends CoachClientMessage['type']> = (msg: Extract<CoachClientMessage, { type: T }>, ctx: RuntimeCtx) => Promise<void> | void`; `handlers: { [T in CoachClientMessage['type']]: Handler<T> }` (der Compiler erzwingt, dass jeder Typ einen Handler hat).
- Produces: `type ScanStep = { name: string; run(ctx: RuntimeCtx, profileId: string): Promise<void> }`; `scan()` läuft die Liste ab, jeder Schritt mit eigenem try/catch und `log.error(name, e)`, ein Fehler stoppt die anderen nicht. Reihenfolge wie heute.
- Produces: `createStateFile<T>(file: string, opts: { empty: () => T; migrate?: (raw: unknown) => T; mode?: number }): { load(): T; save(value: T): void }` mit `writeJsonAtomic`. Ersetzt die drei kopierten Zustandsdateien (Legacy-`rules`-Migration wandert in `migrate`).
- Produces: Der Record-Store hält die geparsten Records im Speicher und liest die Datei nur neu, wenn sich `mtimeMs` oder `size` geändert haben. Schreiben aktualisiert den Speicher direkt. Test: zweimal `all()` ohne Änderung → Datei nur einmal gelesen (Fake-fs oder Spy); externer Schreiber ändert die Datei → nächstes `all()` sieht die Änderung.

- [ ] **Step 1:** Store-Cache mit Test (größter Nutzen, kleinster Eingriff).
- [ ] **Step 2:** `createStateFile` mit Test, drei Zustände umstellen.
- [ ] **Step 3:** `runtime.ts` aufteilen: erst reine Verschiebung in den Ordner (`refactor: … (no change)`), dann Handler-Tabelle, dann Scan-Liste. Bestehende Tests müssen ohne inhaltliche Änderung grün bleiben (Imports dürfen sich ändern).
- [ ] **Step 4:** Server-Helfer zusammenlegen; doppelte Stellen aus dem Audit: Records-POST mit Push-Trio (`web-server/index.ts:224-233` = `internal.ts:69-79`), Token-Digest (`internal.ts:16` = `http.ts:35`), Error-Handler (`index.ts:69` = `internal.ts:36`), WS-Heartbeat (`coach-proxy.ts:147` = `http.ts:383`), `rideTarget` inline in `http.ts:126-129`.
- [ ] **Step 5:** Alles grün, Commit pro Schritt.

### Task 10: Web-App: eine Datenschicht

**Files:**
- Create: `src/tracking/ui/data/RecordsProvider.tsx`, `src/tracking/ui/data/api.ts`, `src/shared/record-bodies.ts`
- Modify: `src/tracking/ui/hooks.ts` (`usePortRecords`), `src/tracking/idbStore.ts:75/228` (Benachrichtigung pro Kind), `src/web/App.tsx:77-81`, `src/tracking/webPort.ts:63`, `src/web/RecipesScreen.tsx:38`, die Aufrufer mit `body as X`
- Test: `tests/tracking/records-cache.test.tsx`, `tests/web/api.test.ts`

**Interfaces:**
- Produces: Port-Abo pro Kind: `port.subscribe(kind: RecordKind, cb: () => void): () => void` (zusätzlich zum bisherigen globalen Abo, das bleibt für `syncState`).
- Produces: `RecordsProvider` hält pro Kind eine Liste im Speicher, lädt sie beim ersten Abonnenten einmal und bei Änderungen dieses Kinds neu. `usePortRecords(port, kind)` behält seine Signatur und Rückgabe (`{ records, failed, retry, … }`, prüfe die heutige Form) und liest aus dem Provider. Ohne Provider (Tests, die ihn nicht setzen) fällt der Hook auf das heutige Verhalten zurück.
- Produces: `AppContext` mit `{ port, env, account, fetchFn }` und `useApp()`. Props `port`, `env`, `fetchFn`, `account` werden in den Komponenten durch `useApp()` ersetzt, wo die Komponente nicht in Tests mit eigenem Port gerendert wird; sonst bleibt die Prop optional mit Rückfall auf den Context.
- Produces: `apiFetch(path: string, init?: RequestInit & { timeoutMs?: number }): Promise<Response>` mit `credentials: 'same-origin'`, `redirect: 'error'`, Timeout; einziger Fetch-Wrapper der Web-App. `RecipesScreen` zeigt Fehler wie andere Screens statt still `null`.
- Produces: `type RecordBodies = { workout: LoggedWorkout; …; daytext: … }` und `bodyOf<K extends RecordKind>(r: TrackedRecord & { kind: K }): RecordBodies[K]` (nur Typen, keine Laufzeitprüfung). Die `body as X`-Casts im Frontend werden dadurch ersetzt.
- `syncState`-Abo: `port.subscribeSync(cb)` ersetzt die Re-Render-Hacks (`App.tsx:455`, `SyncNote.tsx:6`, `App.tsx:588` `setTimeout`-Tick). Der 60-s-Tick für die Uhrzeit bleibt, aber nur in der Komponente, die die Zeit anzeigt.

- [ ] **Step 1: Tests:** 13 Abonnenten desselben Kinds → ein IDB-Read; Schreiben in Kind A lädt Kind B nicht neu; nach einem Schreiben sehen alle Abonnenten von A den neuen Stand; offline (Port ohne Netz) funktioniert unverändert.
- [ ] **Step 2:** Bauen; `tests/web/app.test.tsx` und `tests/tracking/*` bleiben grün.
- [ ] **Step 3:** Ein gemeinsamer Lesefehler-Hinweis: Komponente `ReadFailed({ retry })` mit dem Text, den die 6 heutigen Stellen schon nutzen (prüfe den Wortlaut, nimm den häufigsten). Alle Aufrufer, die `failed` heute ignorieren und eine Liste als Hauptinhalt zeigen, nutzen sie.
- [ ] **Step 4:** `npm run test:web-smoke` grün. Commit pro Teil.

### Task 11: Web-App: Gottdateien aufteilen

**Files:**
- Modify: `src/web/App.tsx` → `src/web/app/` (`LoginForm.tsx`, `ErrorBoundary.tsx`, `Heute.tsx`, `Training.tsx`, `Push.tsx` mit `usePush`, `PushCard`, `PushSettings`, `Ausdauer.tsx`, `Profil.tsx`, `Shell.tsx`, `Boot.tsx`); `src/web/App.tsx` re-exportiert nur noch, was andere importieren
- Modify: `src/tracking/ui/WorkoutScreen.tsx` → Zustand von `ActiveWorkout` in einen Hook `useActiveWorkout` mit `useReducer` (`src/tracking/ui/workout/useActiveWorkout.ts`), Teile als Komponenten im selben Ordner
- Modify: `useWakeLock` nur noch einmal (`src/tracking/ui/hooks.ts`), `LiveRide.tsx:23` nutzt ihn; `MealsScreen.tsx:245/255/349` nutzt `nextUpdatedMs`; `App.tsx:616` nur `aria-current`
- Modify: `tests/web/app.test.tsx` → nach Screens aufteilen (`tests/web/app/*.test.tsx`) mit gemeinsamem Helfer; Server-Teile (Coach-Imports) in eigene Integrationsdatei
- Test: alle bestehenden

- [ ] **Step 1:** Reine Verschiebung der Komponenten (`refactor(web): split App.tsx (no change)`), Tests grün.
- [ ] **Step 2:** `useActiveWorkout` mit Reducer; die 10 `eslint-disable`-Stellen in `WorkoutScreen.tsx` dabei auflösen (richtige Dependencies statt Unterdrückung). Tests grün.
- [ ] **Step 3:** Kleinteile (WakeLock, `nextUpdatedMs`, aria). Testdatei aufteilen. Commit pro Schritt.

### Task 12: Design-Tokens für Mac und Web, Bundles schlanker

**Files:**
- Create: `src/design/tokens.css` (aus `src/web/tokens.css` hierher verschoben, inkl. `@font-face`), Schriftgrößen-Skala `--text-xs … --text-2xl` (6–7 Stufen, die die heutigen Werte abdecken)
- Modify: `src/web/*` Imports, `src/ui/style.css` (nutzt die gemeinsamen Tokens; eigene Farbwerte und `@font-face` weg; `--high` → `--danger`), `src/tracking/ui/tracking.css` (Aliase `--tk-*` durch die echten Tokens ersetzen)
- Modify: `electron.vite.config.ts:13` (`publicDir` nur noch ein eigener kleiner Ordner mit Schrift/Brand, z. B. `src/ui/public` mit Kopie oder Verweis auf `src/web/public/brand`), `package.json` (`app` ohne `media:fedb`)
- Modify: `src/tracking/ui/hooks.ts:4` (Katalog-JSON per dynamischem `import()` laden, mit Ladezustand), große Screens per `React.lazy` (Rezepte, Katalog, Gesundheit; prüfe die größten im Build-Report)
- Test: bestehender Token-Test erweitern: keine Hex-Farben und keine `font-size` mit festen Werten in `src/ui/style.css`, `src/web/*.css`, `src/tracking/ui/*.css`

- [ ] **Step 1:** Test erweitern (rot), Tokens zusammenlegen, Skala einführen, Werte auf die nächste Stufe runden. Die Optik soll gleich bleiben: bei Abweichung > 1 px die nähere Stufe nehmen.
- [ ] **Step 2:** `npm run ui:shots` und `npm run ui:web-shots` vor und nach dem Umbau, Bilder vergleichen (selbst ansehen), Abweichungen nur im Rahmen der Rundung.
- [ ] **Step 3:** Mac-`publicDir` verkleinern; `npm run build` und prüfen: `out/renderer` ohne `exercises/`.
- [ ] **Step 4:** Katalog lazy; `npm run build:web`, Hauptbundle-Größe vorher/nachher notieren (Ziel: unter 700 KB).
- [ ] **Step 5:** Alles grün plus `npm run test:web-smoke`, Commit pro Schritt.

### Task 13: Werkzeuge: ESLint, CI, Versionen

**Files:**
- Create: `eslint.config.js`
- Modify: `package.json` (devDependencies `eslint`, `typescript-eslint`, `eslint-plugin-react-hooks`; Script `lint`), `.github/workflows/ci.yml`, `web-server/package.json` (exakte Versionen wie im Root-Lockfile), `web-server/Dockerfile*` (Node-Version)

- [ ] **Step 1:** ESLint flat config: `typescript-eslint` recommended (ohne type-checked), `react-hooks` recommended, `no-empty: ['error', { allowEmptyCatch: false }]` nur als `warn`. Ignoriert: `out`, `release`, `dist`, `node_modules`, `.claude`, `src/web/public`.
- [ ] **Step 2:** `npm run lint` bis 0 Fehler (Warnungen erlaubt). Echte Hook-Fehler richtig lösen, nicht unterdrücken. Bestehende `eslint-disable`-Kommentare prüfen: nötige behalten, unnötige entfernen.
- [ ] **Step 3:** CI: Schritte `npm run lint`, `npm run build:web`, `npm run test:web-smoke` im bestehenden Job; neuer Job `docker` auf `ubuntu-latest`, der beide Images baut (ohne Push).
- [ ] **Step 4:** Node-Version: Container und CI auf dieselbe Hauptversion (die aus `.github/workflows/ci.yml`, 26; prüfe, dass `node:26-slim` existiert, sonst beide auf 24).
- [ ] **Step 5:** Alles grün, Commit `chore: eslint with react-hooks, CI builds web and images, one node version`.

---

## Parkplatz (bewusst nicht in diesem Meilenstein)

- Coach-Store ganz auf SQLite: erst nach dem Cache aus Task 9 messen, ob nötig.
- Laufzeitprüfung aller 26 Record-Arten (nur Typen in Task 10, nur Chat-Schutz in Task 4).
- Geräte-Tokens im macOS-Schlüsselbund (`safeStorage`).
- URL-Routing in der Web-App.
- Sicherungen von API und Coach zum selben Zeitpunkt.
- Rest-Alarme über Neustarts retten.
- Hevy-/Garmin-Einstellungen am Mac nur noch in der Web-App (Produktfrage zu Q).
- Container mit Build-Schritt statt `tsx`.
- `deploy.sh` (lokal, nicht im Repo): Coach-Gesundheit abwarten, Coach-Restore-Probe, Image-Tags für Rollback.
