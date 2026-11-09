# Dojo 3 Kraft und Ausdauer Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Vor und während des Trainings ist klar, was jetzt dran ist: Kraft zeigt das nächste Training als Hauptkarte, das laufende Training den nächsten Satz groß, und Ausdauer schaltet Rad und Laufen oben um.

**Architecture:** Erst wächst das Kit um allgemeine Bausteine (`PillButton` als die eine Pille, auch für die Zurück-Pille; `Mark` als der eine Zustandspunkt; `Band` als der eine Teilbalken; `StandCard` als Orientierungskarte „… · diese Woche“; `Segments` als die Komponente zur vorhandenen `.tk-seg`-Pille) und neue Icons. Dann bekommen Kraft, Rad und Laufen **eine** Wochenstand-Quelle (`sport-week.ts` auf `useWeekDays`). Danach werden die Screens nur noch aus Kit-Bausteinen zusammengesetzt: Kraft-Start (`Training.tsx`, `WorkoutScreen`), das laufende Training (Fokuskarte, Sätze-Sheet, Rahmen), Rad (`BikeScreen`) und Laufen (`RunScreen`). Jede Schreibaktion des laufenden Trainings läuft weiter über `act(...)` mit den bestehenden Funktionen aus `src/tracking/session.ts`; nur die Oberfläche ändert sich.

**Tech Stack:** React 19, Vite, vitest mit @testing-library/react (ohne jest-dom: nur einfache Assertions wie `toBeTruthy()`, `textContent`, `toBe`), CSS-Tokens.

**Spec:** `docs/design/DESIGN.md` (bindend, auch „Im Code: eine Stelle pro Sache“), Brief „Dojo 3 Kraft und Ausdauer“ in `docs/roadmap.md`. Bilder: `docs/design/moodboard/{kraft,kraft-aktiv,ausdauer}.html` im Browser öffnen; der HTML-Kommentar oben in jeder Datei sagt, wohin jede heutige Funktion wandert (er ist Teil der Abnahme).

## Global Constraints

- **Texte:** natürliche deutsche ganze Sätze, keine abgehackten Fragmente mit Gedankenstrich (`docs/language.md`). Bo duzt. Bo heißt „Sensei“, nie „Coach“ (`tests/web/sensei-wording.test.ts` bleibt grün). Feste Bo-Texte nur aus `src/tracking/ui/bo.ts`.
- **Leicht bleiben:** keine Gamification (keine Punkte, Streaks, Abzeichen, kein „Rekord“), keine Zahlenflut. Wochenstand und Entwicklung stehen als Satz in Worten; Zahlen nur dort, wo man sie zum Trainieren braucht (kg, Wdh, Minuten, Puls-Grenze) und in den bestehenden Sheets.
- **Optional:** Garmin und Hevy sind nie Pflicht. Ohne Rad-Plan kein Rad-Umschalter, ohne Laufen kein Laufen; keine leere Hülle.
- **Öffentliches Repo:** keine persönlichen Daten in Code, Texten oder Fixtures (Studio „Nord“, Übungen aus dem Katalog).
- **Ein Training geht nie verloren** (die Fahrt-Regel gilt auch hier): keine Änderung an `src/tracking/{session,store,registry,plan-draft,workout-change,studios}.ts`, `src/shared/**` und an keinem Record-Format. Die Tests `tests/tracking/{store,registry,lost-write,sync,sync-conflict,session,plan-draft,two-devices}*` werden **nicht** angefasst und bleiben grün. UI-Tests, die Datenerhalt prüfen (`screens.test.tsx`: Tippen bei langsamem Speichern, Doppeltipp beim Entfernen, Notiz vor dem Beenden, Fehler beim Speichern), werden nur in der Navigation angepasst, ihre Erwartungen an Records bleiben wörtlich gleich.
- **Eine Stelle pro Sache:** Farben nur als Token in `src/design/tokens.css` (dunkel auf `:root`, hell nur unter `@media (prefers-color-scheme: light)`, sonst `/* shared */`); nie handgeschriebene `[data-theme]`-Blöcke. Keine Farb-Literale in CSS oder TSX (`tests/web/style-tokens.test.ts`). Bausteine nur in `src/tracking/ui/kit/`, UI-Icons nur in `kit/Icon.tsx` (`currentColor`). Kein Screen baut sich eine eigene Karte, Blase, Zeile oder einen eigenen Umschalter.
- **Schriftgewicht:** nur 400, 500, 700.
- **Knöpfe:** mindestens 44 px; pro Screen eine Hauptaktion (`primary`, über `MainCard` oder Sheet-Aktionen). Parkplatz Dojo 1: in jeder Datei, die eine Aufgabe anfasst, hat kein Knopf mehr eine leere Klasse (Haupt = `primary`, sonst `secondary`/`link`).
- **Nicht anfassen:** `src/main/**`, `src/ui/**`, `src/service/**`. Keine Änderung an Progression oder Planung (`src/coach/**`, `src/shared/**`).
- **Stand von `main`:** Der Design-Parkplatz ist in diesen Branch gemergt. `useBackEntry(onBack: () => void): void` gibt es in `kit/Sheet.tsx` (Export über `kit/index.ts`); `HealthPage` und `TogetherScreen` nutzen ihn schon, dort abschauen. `kit/Sheet.tsx`, `CoachScreen`, `TogetherScreen`, `vite.web.config.ts` nicht ändern. `Shell.tsx` ändert nur Task 5, und nur an zwei Stellen; die Zeile `CoachScreen … onChatClosed` (Chat von Heute zurück nach Heute) bleibt wörtlich.
- **Aussehen nur im Kit:** Screen-Dateien setzen nur Layout-Klassen (Abstand, Raster, `sticky`); Farbe, Rand, Radius, Schatten und Schein kommen nur aus Kit-Bausteinen und Tokens. `style` nur für berechnete Breiten (wie in `WeekPath`). Satzkreise, Fortschrittsbalken und Ablaufband sind Kit-Bausteine (`MarkDot`, `Band`), keine Screen-CSS.
- **Tests nach Zweck** (`docs/roadmap.md`, Arbeitsweise 6): neue Tests nur für Abnahmesätze und Review-Focus-Fälle. Tests ersetzter Wege (Kraft-Umschalter, aufklappbare Übungen, langes Drücken zum Verschieben, `withWatts`) werden gelöscht, nicht angepasst.
- **Smoke:** `scripts/web-smoke.ts` klickt Kraft-Abläufe. Die Aufgabe, die ein dort benutztes Label ändert, passt das Skript im selben Commit an (Task 3 und 4).
- Befehle: `npm run typecheck`, `rtk proxy npm run lint` (0 Fehler), `npm test`. Einzeltest: `npx vitest run <datei>`.

## Entscheidungen

Vorab entschieden, damit niemand beim Bauen raten muss:

1. **Kraft und Ausdauer haben keinen sichtbaren Seitentitel**, nur `<h1 className="tk-sr">` (Kraft, Ausdauer) für Screenreader. Die erste Karte (`StandCard`, Kicker „Kraft · diese Woche“) sagt, wo man ist. Grund: Moodboards; Heute macht es seit Dojo 2 genauso.
2. **Wochenstand in Worten, Punkte ohne Zahl:** `StandCard` zeigt einen Satz („Ein Krafttraining hast du geschafft. Das nächste kommt am Freitag.“) und kleine Punkte (erledigt, heute, offen). „1 von 2“ steht nur im `aria-label`. Grund: keine Zahlenflut.
3. **Routinen und Übungen sind Unterseiten von Kraft** (lokaler Zustand in `Training.tsx`, `PageHead` mit Zurück-Pille „Kraft“, Browser-Zurück über `useBackEntry`). Grund: Muster von Gesundheit in Dojo 2, keine Kollision mit dem Sheet-Umbau.
4. **„Anderes Training“** ersetzt „Routine oder leeres Training“ (Knopf und Sheet-Titel). Mit Plan immer da; ohne Plan ist „Leeres Training starten“ der Hauptknopf und „Anderes Training“ erscheint nur mit Routinen.
5. **Studio ist immer eine ruhige Pille** („Nord“, sonst „Studio wählen“; Name `Studio Nord` bzw. `Studio wählen`), auch bei nur einem Studio. Ausblenden/Entfernen bleibt nur außerhalb des laufenden Trainings. Grund: Das Studio des laufenden Trainings trägt seine Gewichte; Parkplatz „nur auf dem Startbildschirm“ wird als bewusst gestrichen.
6. **Bos Begründung des Plans** (`planMeta.reason`, sonst `note`) steht in `BoBubble portrait="mini"` unter den Pillen; ohne Text keine Blase. „Plan vom Montag“ bleibt im Plan-Sheet. Bo bewegt sich auf Kraft nicht (DESIGN: verspielt nur auf Heute und im Chat).
7. **Angepasster Plan:** in `more` der Hauptkarte „Du hast den Plan angepasst.“ mit `link` „Zurücksetzen“ (statt „Angepasst“ / „Änderungen verwerfen“). Der Hinweis „Deine Anpassungen passen nicht mehr …“ bleibt wörtlich.
8. **Heute bleibt unverändert** (`TodayCard` sagt weiter „Ansehen und anpassen“); auf Kraft heißt der Nebenknopf „Ansehen“ wie im Moodboard. Die Zeile „Krafttraining, etwa 45 Minuten, 6 Übungen“ kommt für beide aus `gymLine` (eine Stelle).
9. **Fokus im laufenden Training = die geöffnete Übung** (`ui.openRid`, das schon heute dem nächsten offenen Satz folgt). Die Fokuskarte zeigt deren ersten offenen Satz (Aufwärmsatz eingeschlossen). Eine Zeile unter „Danach“ antippen setzt `openRid`.
10. **Sätze als Kreise, Tabelle im Sheet:** Ein Kreis antippen öffnet `SetsSheet` der Übung mit der bestehenden Satz-Tabelle (`SetHead` + `SetRow`, gleiche Labels „Gewicht Satz 2“, „Satz 2 erledigt“, Satztyp, Entfernen im Bearbeiten-Modus). „Sätze bearbeiten“ im Menü öffnet dasselbe Sheet im Bearbeiten-Modus. Grund: `SetRow` mit seiner geprüften Eingabelogik bleibt die eine Stelle für Satzwerte.
11. **Große Zahlen sind Eingabefelder:** Gewicht und Wiederholungen (bzw. Sekunden) des Fokussatzes sind `NumField big` mit denselben Namen wie in der Tabelle („Gewicht Satz 3“). Tippen ändert sie wie heute. „Satz geschafft“ ruft `confirmSet` für genau diesen Satz.
12. **Verschieben nur noch über das Menü** („Reihenfolge ändern“ öffnet `ReorderSheet`, dort Ziehen und Pfeile wie heute). Langes Drücken auf Übungen fällt weg, `useHold.ts` wird gelöscht. Grund: versteckte Geste, und die Übungsköpfe gibt es nicht mehr.
13. **Notizen stehen in der Fokuskarte** (offen auf Wunsch über „Notiz“ im Menü, vorhandene immer sichtbar). **Die Frage „Wie viele hättest du noch geschafft?“** ist eine eigene ruhige Karte über der Fokuskarte, solange `asksEffort` gilt; nach der Antwort steht dort einmal „Danke! Das fließt in den nächsten Vorschlag ein.“ bis zum nächsten bestätigten Satz. „Noch möglich: …“ steht im Sätze-Sheet.
14. **Pause:** eine schmale Karte (sticky oben) über der Fokuskarte: „Pause, noch 0:48“ ist der Knopf „Pause überspringen“, daneben `secondary` „30 s mehr“ (statt „+30 s“).
15. **Verkleinern** verlässt die Trainingsansicht wie heute das Wechseln des Tabs (der Store bleibt in der Registry und schreibt weiter). Kraft zeigt dann die Hauptkarte „Läuft noch“ mit „Weitermachen“. Tab-Leiste, Profil-Knopf und Schriftzug sind nur ausgeblendet, solange die Trainingsansicht zu sehen ist (`Training` meldet es an `Shell`). Die Pause läuft im Record weiter (`w.rest`); der Pausen-Wecker (`port.restAlarm`) endet beim Verkleinern wie heute beim Tab-Wechsel. Das bleibt so und kommt als Parkplatz-Zeile in Task 8.
16. **Nach dem Beenden:** `WorkoutSummary` wird `MainCard` (Kicker „Gespeichert“, Titel = Trainingstitel, Text „{n} Übungen in {min} Minuten.“, Hauptknopf „Fertig“, `more` = die „Nächstes Mal“-Zeilen), darunter `BoBubble portrait="mini"` mit dem Abschluss-Satz aus `finisherLine`. Die Karte „Zum Abschluss“ (`Finisher`) bleibt für Heute. Grund: eine Hauptkarte pro Screen.
17. **Ausdauer-Umschalter oben** über den Kit-Baustein `Segments` (Gruppe mit `aria-pressed`, Icons `ausdauer`/`lauf`), als erstes Element. `Segments` ist kein neues Aussehen, sondern die Komponente zur vorhandenen `.tk-seg`-Pille: die Regeln ziehen aus `web.css` in den Kit-Block von `tracking.css`, und Profil („Darstellung“) und Essen („Ansicht“ Tage/Einkauf) rendern ab Task 1 auch `Segments` (gleiche Labels, gleiches `aria-pressed`). Danach schreibt kein Screen mehr `className="tk-seg"`.
18. **Rad-Watt aus `block.pct`** statt aus dem Text: im Ablauf-Sheet steht rechts gedämpft „etwa 190 W“ (`Math.round(ftpW * pct / 100)`), nur bei kräftigen Blöcken (`pct > 65`, dieselbe Grenze wie im Ablaufband); lockere Blöcke, Blöcke ohne `pct` und Fahrten ohne FTP zeigen keine Watt. So stehen höchstens so viele Zahlen da wie heute, nicht mehr. `withWatts` wird gelöscht. Grund: `pct` ist schon der gerundete `ftpFraction` der Schritte; keine Textanalyse.
19. **Ablaufband** in der Rad-Hauptkarte: ein Balken pro Block (Breite = Minuten, hoch = `pct > 65`, sonst niedrig), `aria-label` „Ablauf: “ + Blocktexte. Kein eigener Satz darunter; die Worte stehen im Sheet „Ablauf ansehen“.
20. **Entwicklung als ein Satz ohne Zahl** (Rad aus `ftpHistory`, Laufen aus `easyPace`) auf einer `RowCard` „Deine Entwicklung“; das Sheet dahinter bleibt wie heute. Das Stundenband steht nur im Sheet.
21. **Laufen:** Hauptkarte nächster Lauf mit `primary` „Lauf eintragen“; ohne Lauf in dieser Woche Titel „Freier Lauf“. „Lauftage ändern“ ist die Aktion der `StandCard`. Der letzte Lauf ist eine eigene Karte mit der Frage, solange sie offen ist, sonst eine ruhige `RowCard`.
22. **Katalog-Gruppen** (Parkplatz L) bleiben unangetastet: die Übungen-Seite zeigt `ExercisesScreen` wie heute.

## Review Focus

1. **Verkleinern oder Tab wechseln mitten im Training**, auch während eine Speicherung hängt oder eine Pause läuft: „Weitermachen“ bringt dasselbe Training mit allen bestätigten Sätzen zurück, die Pause läuft weiter. (Test in Task 5.)
2. **Supersatz und Aufwärmsatz:** Die Fokuskarte folgt `currentSet` im Wechsel; „Satz geschafft“ bestätigt genau den gezeigten Satz, nie einen der Partnerübung; der Aufwärmsatz ist Kreis „A“. (Test in Task 4.)
3. **Ungültige Eingabe in den großen Feldern** („abc“, „8,5“ Wdh): „Satz geschafft“ ist gesperrt, nichts wird geschrieben; schnelles Tippen bei langsamem Speichern verliert keine Ziffer. (Test in Task 4.)
4. **Training ohne offene Sätze oder ohne Übungen:** keine leere Fokuskarte, sondern „Alle Sätze geschafft.“ bzw. „Noch keine Übung im Training.“ mit „Übung hinzufügen“; „Training beenden“ fragt wie bisher nach offenen Sätzen. (Test in Task 4.)
5. **Nur eine Ausdauer-Sportart, Rad ohne Plan, Laufen pausiert:** kein Umschalter, keine leere Hauptkarte, die `StandCard` sagt die Woche; „Lauf eintragen“ bleibt in der Pause erreichbar. (Tests in Task 6 und 7.)

---

### Task 1: Kit für Dojo 3

**Files:**
- Modify: `src/design/tokens.css`, `src/tracking/ui/tracking.css` (Kit-Block; `.tk-seg`-Regeln aus `src/web/web.css` hierher; `.tk-roundbtn.pill` wird `.tk-pill`; neue Layout-Regel `.tk-pills`), `src/web/web.css`, `src/tracking/ui/kit/{Dojo.tsx,Icon.tsx,WeekPath.tsx,index.ts}`, `src/web/app/Profil.tsx` und `src/web/MealsScreen.tsx` (nur der Umschalter wird `Segments`)
- Create: `src/tracking/ui/kit/StandCard.tsx` (mit `Mark`, `Band`), `src/tracking/ui/kit/Segments.tsx`
- Test: `tests/web/dojo-kit.test.tsx`, `tests/web/style-tokens.test.ts`

**Interfaces:**
- Produces (Token, dunkel / hell): `--focus-glow` `rgba(239,171,118,.14)` / `rgba(224,140,80,.16)` (Schein der Fokuskarte). Alles andere aus vorhandenen Tokens: Satzkreis erledigt `--good`, dran `--accent`, offen `--field-line`; Ablaufband kräftig `--accent`, locker `--field-line`.
- Produces (Icons): `IconName` um `'studio' | 'wechsel' | 'mehr' | 'info' | 'pause' | 'plus' | 'verkleinern' | 'routinen' | 'uebungen' | 'entwicklung'` erweitert. Pfade aus `kraft.html` (Studio-Haus, Anderes Training, Kacheln Routinen/Übungen), `kraft-aktiv.html` (Verkleinern, Menü-Punkte, Anleitung „i“, Pause, Plus bei „Übung hinzufügen“) und `ausdauer.html` (Entwicklung). Farbige Füllungen werden `currentColor` oder `fill="none"`.
- Produces (Kit):
  - `Card({ soft, focus, label, children })`: neu `focus?: boolean` (Klasse `card focus`: Rand `--accent`, Schein `--focus-glow`). Nur die Fokuskarte des laufenden Trainings nutzt es.
  - `PillButton({ icon, label, name, onClick }: { icon: IconName; label: string; name?: string; onClick: () => void })` in `Dojo.tsx`: **die eine Pille** (`button.tk-pill`: 44 px, transparent, Rand `--field-line`, `--muted`-Schrift 500, Icon links), `aria-label={name}` nur wenn gesetzt. `BackButton` mit `label` rendert künftig `PillButton icon="zurueck"`; die Regel `.tk-roundbtn.pill` wird gelöscht, die Zurück-Pille („Woche“, „Kraft“) bekommt damit bewusst dasselbe ruhige Aussehen (eine Pille, ein Aussehen; Sichtprüfung in Task 8). `.tk-pagehead > .tk-roundbtn` gilt auch für `.tk-pill`. `RoundButton` bleibt der runde Icon-Knopf ohne Text; Chips (`.tk-chips`) bleiben Auswahl, nicht Aktion.
  - `export type Mark = 'done' | 'now' | 'open'` (ein Wortschatz für Wochenstand, Satzkreise und Fortschritt). `MarkDot({ state, short, name, onClick }: { state: Mark; short?: string; name?: string; onClick?: () => void })` in `StandCard.tsx`: **der eine Zustandspunkt** (`span.tk-mark.{state}`, mit `onClick` ein `button.tk-mark` mit `aria-label={name}`, 44 px Tippfläche). Erledigt `--good` mit Haken (ohne `short`), dran `--accent`-Ring, offen `--field-line`. Die Punkte des Wochenwegs bekommen dieselbe Grundregel (`.tk-pathdot-mark` erweitert `.tk-mark`, nur der Heute-Schein bleibt eigen), nicht kopieren.
  - `Band({ parts, label }: { parts: { grow: number; fill: number; tall?: boolean }[]; label?: string })` in `StandCard.tsx`: **der eine Teilbalken** (`div.tk-band`, Teil-Breite = `grow`-Anteil, gefüllter Anteil `fill` 0–1 in `--accent`, Rest `--field-line`, `tall` höher). Mit `label` `role="img"` und `aria-label`, sonst `aria-hidden`. Nutzer: Fortschritt des laufenden Trainings (Task 5) und Ablaufband (Task 6).
  - `StandCard({ kicker, text, marks, marksLabel, action }: { kicker: string; text: string; marks: Mark[]; marksLabel: string; action?: { label: string; onClick: () => void } })`: `Card` mit Region-Name `kicker`, links Kicker und Satz, rechts die Punkte als `MarkDot` in `<span role="img" aria-label={marksLabel}>` (ohne Punkte kein Element), darunter optional ein `secondary`-Knopf. Kein Ersatz für `WeekPath` (sieben antippbare Tage mit Linie); `StandCard` zeigt nur die Tage einer Sportart.
  - `Segments<T extends string>({ label, options, value, onChange }: { label: string; options: { value: T; label: string; icon?: IconName }[]; value: T; onChange: (v: T) => void })`: `<div className="tk-seg" role="group" aria-label={label}>` mit Knöpfen (`aria-pressed`, Icon vor dem Text).
  - `kit/index.ts` exportiert `PillButton`, `StandCard`, `MarkDot`, `Mark`, `Band`, `Segments`; Kopfkommentar: `StandCard` ist die eine Orientierungskarte „… · diese Woche“ (Kraft, Rad, Laufen), `Segments` der eine Umschalter zwischen Unterseiten, `PillButton` die eine Pille (ruhige Nebenaktion und Zurück), `MarkDot` der eine Zustandspunkt, `Band` der eine Teilbalken. Der Satz „Switch between sub pages (.tk-seg, web.css)“ wird „Segments (kit)“, der Satz zu `BackButton` sagt „or a PillButton with a label“.

- [ ] **Step 1: Write the failing tests.** In `tests/web/style-tokens.test.ts`: `--focus-glow` in beiden Schemata (wie der Dojo-2-Test). In `tests/web/dojo-kit.test.tsx`:

```tsx
it('draws every registered icon with currentColor only', () => {
  // bestehender Test: die Namensliste um die 10 neuen Namen erweitern
});
it('a focus card has the accent line', () => { render(<Card focus label="Bankdrücken"><p>x</p></Card>); expect(screen.getByRole('region', { name: 'Bankdrücken' }).className).toBe('card focus'); });
it('a stand card says the week in words and keeps the count for screen readers', () => {
  render(<StandCard kicker="Kraft · diese Woche" text="Ein Krafttraining hast du geschafft." marks={['done', 'now']} marksLabel="1 von 2 Krafttrainings" action={{ label: 'Lauftage ändern', onClick: () => {} }} />);
  const card = screen.getByRole('region', { name: 'Kraft · diese Woche' });
  expect(within(card).getByRole('img', { name: '1 von 2 Krafttrainings' })).toBeTruthy();
  expect(card.textContent).not.toMatch(/\d/);
  expect(within(card).getByRole('button', { name: 'Lauftage ändern' }).className).toBe('secondary');
});
it('segments switch with aria-pressed and an icon', () => {
  const pick = vi.fn();
  render(<Segments label="Ausdauer" value="rad" onChange={pick} options={[{ value: 'rad', label: 'Rad', icon: 'ausdauer' }, { value: 'laufen', label: 'Laufen', icon: 'lauf' }]} />);
  const g = screen.getByRole('group', { name: 'Ausdauer' });
  expect(within(g).getByRole('button', { name: 'Rad' }).getAttribute('aria-pressed')).toBe('true');
  fireEvent.click(within(g).getByRole('button', { name: 'Laufen' }));
  expect(pick).toHaveBeenCalledWith('laufen');
});
it('a pill button carries its icon and an optional name; the back pill is the same pill', () => {
  render(<><PillButton icon="studio" label="Nord" name="Studio Nord" onClick={() => {}} /><BackButton label="Woche" onClick={() => {}} /></>);
  expect(screen.getByRole('button', { name: 'Studio Nord' }).querySelector('svg[data-icon="studio"]')).toBeTruthy();
  expect(screen.getByRole('button', { name: 'Woche' }).className).toBe('tk-pill');
});
it('a mark dot is a button only with onClick', () => {
  render(<><MarkDot state="done" /><MarkDot state="now" short="2" name="Satz 2: dran" onClick={() => {}} /></>);
  expect(screen.getAllByRole('button')).toHaveLength(1);
  expect(screen.getByRole('button', { name: 'Satz 2: dran' }).className).toBe('tk-mark now');
});
it('a band names itself only with a label', () => {
  render(<Band label="Ablauf: locker, hart" parts={[{ grow: 10, fill: 0 }, { grow: 30, fill: 1, tall: true }]} />);
  expect(screen.getByRole('img', { name: 'Ablauf: locker, hart' })).toBeTruthy();
});
```

- [ ] **Step 2: Run** `npx vitest run tests/web/dojo-kit.test.tsx tests/web/style-tokens.test.ts` — Expected: FAIL.
- [ ] **Step 3: Implement** Token, Icons, Bausteine und ihre CSS-Regeln (nur Tokens). `.tk-seg` umziehen, ohne das Aussehen von Profil und Essen zu ändern; Profil und Essen auf `Segments` umstellen (ihre Tests laufen unverändert).
- [ ] **Step 4: Run** die beiden Tests, dann `npm test` — Expected: PASS.
- [ ] **Step 5: Commit** `feat(design): Dojo 3 kit (stand card, mark, band, segments, pill button, icons)`.

### Task 2: Wochenstand pro Sportart

**Files:**
- Create: `src/tracking/ui/sport-week.ts`
- Modify: `src/tracking/ui/week-path.ts` (`numberWord` exportieren statt privatem `word`; `weekSentence` nutzt es weiter)
- Test: `tests/tracking/sport-week.test.ts`

**Interfaces:**
- Consumes: `useWeekDays` (`rows`, `today`, `current`, `spontaneous`, `runs`, `loaded`), `DayRow.kinds`, `hasSport` aus `src/shared/week-plan`, `Mark` (Task 1), `weekdayOfKey`.
- Produces (rein):
  - `export type SportKey = 'kraft' | 'rad' | 'lauf'`; `export type SportWeek = { marks: Mark[]; done: number; planned: number | null; next: string | null }`.
  - `sportWeekOf({ done, planned, today }: { done: string[]; planned: string[] | null; today: string }): SportWeek`: `done` = verschiedene Tage bis heute; Punkte: je erledigter Tag `done`, dann je geplanter, noch nicht erledigter Tag ab heute `now` (heute) bzw. `open` (später); verpasste Tage vor heute erscheinen nicht. `next` = erster geplanter, nicht erledigter Tag ab heute. `planned = null` ohne Plan.
  - `sportWeekText(sport: SportKey, w: SportWeek, today: string): string`. Teil 1: 0 → „Diese Woche ist noch {kein Krafttraining | keine Fahrt | kein Lauf} erledigt.“, 1 → „{Ein Krafttraining | Eine Fahrt | Einen Lauf} hast du geschafft.“, n → „{Zwei} {Krafttrainings | Fahrten | Läufe} hast du geschafft.“ (über `numberWord`, großgeschrieben). Teil 2: `next === today` → „Heute ist {ein Krafttraining | eine Fahrt | ein Lauf} dran.“; `next` später → „{Das | Die | Der} nächste kommt am {Freitag}.“; kein `next`, `planned !== null` und `done >= planned` → „Damit ist alles geschafft, was geplant war.“; sonst nichts.
  - `sportWeekLabel(sport: SportKey, w: SportWeek): string` → „1 von 2 Krafttrainings“ / „Fahrten“ / „Läufen“; ohne Plan oder `done > planned` → „1 geschafft“.
  - `useSportWeek(port: TrackingPort, nowMs: number, sport: SportKey): SportWeek & { text: string; label: string; loaded: boolean }`: `done` = Zeilen, deren `kinds` die Art enthält (`kraft`, `rad`, `lauf`); `planned` = Plantage mit `hasSport(plan, 'gym' | 'bike' | 'run')`, bei `lauf` dazu die Tage aus `runs`; `null`, wenn es keinen Wochenplan gibt oder Spontan gilt (bei `lauf` reichen `runs`).

- [ ] **Step 1: Write the failing test** `tests/tracking/sport-week.test.ts` (Tage einer Woche als Konstanten `MO … SO`):

```ts
it('counts done days and marks today and later plan days', () => {
  const w = sportWeekOf({ done: [MO], planned: [MO, DO, SA], today: DO });
  expect(w.marks).toEqual(['done', 'now', 'open']);
  expect(w.next).toBe(DO);
});
it('says the week in words for each sport', () => {
  expect(sportWeekText('kraft', sportWeekOf({ done: [MO], planned: [MO, FR], today: MI }), MI)).toBe('Ein Krafttraining hast du geschafft. Das nächste kommt am Freitag.');
  expect(sportWeekText('rad', sportWeekOf({ done: [], planned: [MI], today: MI }), MI)).toBe('Diese Woche ist noch keine Fahrt erledigt. Heute ist eine Fahrt dran.');
  expect(sportWeekText('lauf', sportWeekOf({ done: [MO, MI], planned: [MO, MI], today: DO }), DO)).toBe('Zwei Läufe hast du geschafft. Damit ist alles geschafft, was geplant war.');
});
it('without a plan there are only done dots and no "von"', () => {
  const w = sportWeekOf({ done: [MO], planned: null, today: MI });
  expect(w.marks).toEqual(['done']);
  expect(sportWeekLabel('kraft', w)).toBe('1 geschafft');
  expect(sportWeekText('kraft', w, MI)).toBe('Ein Krafttraining hast du geschafft.');
});
it('a missed day before today is not a dot', () => {
  expect(sportWeekOf({ done: [], planned: [MO, FR], today: MI }).marks).toEqual(['open']);
});
```

- [ ] **Step 2: Run** `npx vitest run tests/tracking/sport-week.test.ts` — Expected: FAIL.
- [ ] **Step 3: Implement** `sport-week.ts`; `numberWord` aus `week-path.ts` exportieren.
- [ ] **Step 4: Run** den Test und `npx vitest run tests/tracking/week-path.test.ts` — Expected: PASS.
- [ ] **Step 5: Commit** `feat(week): one week stand per sport`.

### Task 3: Kraft vor dem Training

**Files:**
- Modify: `src/web/app/Training.tsx`, `src/tracking/ui/WorkoutScreen.tsx` (nur der Zustand ohne laufendes Training), `src/tracking/ui/workout/OpenCard.tsx`, `src/tracking/ui/ExercisesScreen.tsx` (eigenes `<h2>` „Deine Übungen“ raus, Liste behält `label`), `src/tracking/ui/RoutinesScreen.tsx` und `src/tracking/ui/StudioSheet.tsx` (Knöpfe mit Klasse, `StudioRow` löschen), `src/tracking/ui/plan-text.ts` (`gymLine`), `src/web/app/Heute.tsx` (nutzt `gymLine`), `tracking.css` (alte `.tk-plan-preview`, `.tk-studio-line`, `.tk-open` löschen, sobald unbenutzt), `scripts/web-smoke.ts`
- Create: `src/tracking/ui/kraft-view.ts`
- Test: `tests/tracking/kraft-start.test.tsx` (neu), `tests/web/app/run.test.tsx` (Test „Kraft: one page head …“ ersetzen), `tests/tracking/{screens,studio-records,live-workout,summary-and-feel,plates-steps}.test.tsx`, `tests/web/app/shell.test.tsx` (nur Labels)

**Interfaces:**
- Consumes: `MainCard`, `PillButton`, `StandCard`, `RowCard`, `BoBubble`, `PageHead`, `useBackEntry` (Kit); `useSportWeek` (Task 2).
- Produces:
  - `gymLine(w: GymWorkout, catalog?: readonly Exercise[]): string | null` in `plan-text.ts` → „Krafttraining, etwa {gymMinutes} Minuten, {n} Übungen“ (eine Übung: „1 Übung“), ohne Übungen `null`. `Heute.tsx` baut die Zeile nicht mehr selbst.
  - `kraft-view.ts`: `routinesSentence(n: number): string` → 0 „Leg feste Abläufe an, zum Beispiel für das Hotel.“, 1 „Ein fester Ablauf liegt bereit.“, n „{Zwei} feste Abläufe liegen bereit.“; `exercisesSentence(trends: Map<string, Trend>): string` → mehr als die Hälfte `steigt` „Bei den meisten Übungen wirst du gerade stärker.“, sonst mit Einträgen „Deine Übungen halten gerade ihr Niveau.“, leer „Hier findest du alle Übungen mit Anleitung.“
  - `OpenCard` rendert `MainCard` (`kicker="Läuft noch"`, Titel = Trainingstitel, Text „Gestartet {dateLabel}. Alles ist gespeichert.“, `primary` „Weitermachen“, `secondary` „Training beenden“, `more` = `ConfirmLink` „Training verwerfen“ mit der bisherigen Frage). Ein zweites offenes Training (selten) ist eine `RowCard` (icon `kraft`, kicker „Läuft noch“, Titel + Datum) mit denselben Aktionen in einem kleinen Sheet; die Labels mit Suffix („Weitermachen Beine Gestern“) bleiben dort.
- `Training({ entry, onEntryDone, onDone, onLive })` (`onLive` kommt in Task 5): Zustand `page: 'start' | 'routines' | 'exercises'`. Seite `start` von oben nach unten:
  1. `<h1 className="tk-sr">Kraft</h1>`, `StandCard kicker="Kraft · diese Woche"` mit `useSportWeek(port, now, 'kraft')` (erst nach `loaded`).
  2. `WorkoutScreen` (Inhalt siehe unten).
  3. `div.tk-tiles` mit zwei `RowCard` ohne Kicker, `end="none"`: „Deine Routinen“ (icon `routinen`, `sub=routinesSentence`) und „Deine Übungen“ (icon `uebungen`, `sub=exercisesSentence(liftTrends(...))`).
  Seiten `routines`/`exercises`: `PageHead title="Deine Routinen"` bzw. „Deine Übungen“ mit `back={{ label: 'Kraft', onClick }}`, darunter `RoutinesScreen` bzw. `ExercisesScreen`; `useBackEntry` hält solange einen Verlaufseintrag. Eine Routine starten setzt `page` auf `start` wie heute.
- `WorkoutScreen` ohne laufendes Training: Meldung → Zusammenfassung (Task 5 baut sie um) → `SyncNote` → offene Trainings (`OpenCard`) **oder**: mit Plan `MainCard kicker="Nächstes Training" title={plan.name} text={gymLine(...)}`, `primary` „Training starten“, `secondary` „Ansehen“ (öffnet das Plan-Sheet wie bisher), `more` = Entscheidung 7; ohne Plan `MainCard kicker="Freies Training" title="Kraft"` mit Text „Bo hat gerade kein Training für dich geplant. Du kannst frei trainieren oder eine Routine starten.“ und `primary` „Leeres Training starten“. Darunter `div.tk-pills` mit `PillButton icon="studio" label={studio ?? 'Studio wählen'} name={`Studio ${studio ?? 'wählen'}`}` und (Entscheidung 4) `PillButton icon="wechsel" label="Anderes Training"`. Dann `BoBubble portrait="mini"` (Entscheidung 6). Sheet „Anderes Training“: `RowList` mit „{Routine} starten“ und „Leeres Training starten“ (`Row`).

- [ ] **Step 1: Write the failing tests** `tests/tracking/kraft-start.test.tsx` (mit `fakePort`, Training über die `boot`-Hilfe aus `tests/web/app/helpers.tsx`, wo die App nötig ist):

```tsx
it('Kraft shows the week stand, the next workout as the main card, studio and Anderes Training as pills, Bo and two tiles', async () => {
  await boot({ account: 'anna', seed: [planRec('Oberkörper', 6), weekplanWithGymToday, doneMondayGym] });
  fireEvent.click(await screen.findByRole('button', { name: 'Kraft' }));
  const stand = await screen.findByRole('region', { name: 'Kraft · diese Woche' });
  const main = screen.getByRole('region', { name: 'Nächstes Training' });
  expect(before(stand, main)).toBe(true);
  expect(main.textContent).toContain('Krafttraining, etwa');
  expect(within(main).getByRole('button', { name: 'Training starten' }).className).toBe('primary');
  expect(within(main).getByRole('button', { name: 'Ansehen' }).className).toBe('secondary');
  expect(screen.getByRole('button', { name: /^Studio / })).toBeTruthy();
  expect(screen.getByRole('button', { name: 'Anderes Training' })).toBeTruthy();
  expect(screen.getByRole('button', { name: /Deine Routinen/ })).toBeTruthy();
  expect(screen.getByRole('button', { name: /Deine Übungen/ })).toBeTruthy();
  expect(screen.queryByRole('group', { name: 'Kraft' })).toBeNull();
  expect(document.querySelectorAll('.tk-screen button:not([class])')).toHaveLength(0);
});
it('Deine Übungen is a page with a back pill; Kraft comes back', async () => { /* Kachel → h1 „Deine Übungen“, „Anleitungen nachschlagen“; Knopf „Kraft“ → Region „Nächstes Training“ */ });
it('Deine Routinen is a page; starting a routine goes back to Kraft and runs it', async () => { /* Routine → „Training starten“ im Sheet → Trainingsansicht */ });
it('without a plan the main button is Leeres Training starten; Anderes Training only with routines', async () => { /* … */ });
it('Anderes Training lists the routines and Leeres Training starten', async () => { /* Sheet „Anderes Training“ */ });
it('an adjusted plan says so in the card and Zurücksetzen drops the draft', async () => { /* „Du hast den Plan angepasst.“ → link → readDraft null */ });
it('the plan reason is in Bo’s bubble, not in the card', async () => { /* .tk-bo enthält reason; Region „Nächstes Training“ nicht */ });
it('an open workout is the main card Läuft noch with Weitermachen; verwerfen asks first', async () => { /* … */ });
```

`kraft-view` als kleiner reiner Test in derselben Datei (`routinesSentence(2)` → „Zwei feste Abläufe liegen bereit.“; `exercisesSentence` mit drei von vier `steigt`).

- [ ] **Step 2: Run** `npx vitest run tests/tracking/kraft-start.test.tsx` — Expected: FAIL.
- [ ] **Step 3: Implement.** In den bestehenden Tests nur Labels anpassen: „Routine oder leeres Training“ → „Anderes Training“, „{Name} starten“ → `within(region 'Nächstes Training')` „Training starten“, „Ansehen und anpassen“ auf Kraft → „Ansehen“, Studio-Zeile → Pille `/^Studio /`, Segment „Übungen“/„Routinen“ → Kachel. `tests/web/app/run.test.tsx`: den Test „Kraft: one page head, then three sub-pages …“ löschen (ersetzt durch `kraft-start`). `scripts/web-smoke.ts`: `anderes` sucht `'Anderes Training'`; `seeWorkout` klickt statt `seg(p, 'Übungen')` die Kachel `p.getByRole('button', { name: /Deine Übungen/ })`; `seg` löschen.
- [ ] **Step 4: Run** `npx vitest run tests/tracking tests/web` — Expected: PASS. `npm run typecheck` — Expected: PASS.
- [ ] **Step 5: Commit** `feat(kraft): next workout as the main card, quiet pills, Bo and two tiles`.

### Task 4: Laufendes Training, der nächste Satz groß

**Files:**
- Create: `src/tracking/ui/workout/live-view.ts`, `src/tracking/ui/workout/FocusCard.tsx`, `src/tracking/ui/workout/SetsSheet.tsx`, `src/tracking/ui/workout/ExerciseMenu.tsx` (Menü-Sheet aus `ExerciseSection` verschoben, unverändert im Inhalt), `tests/tracking/live-helpers.ts`
- Modify: `src/tracking/ui/workout/ActiveWorkout.tsx`, `src/tracking/ui/workout/useActiveWorkout.ts` (`UiState`: `info: ReadonlySet<string>` → `infoRid: string | null`, neu `setsRid: string | null`, `thanked: string | null`; `holdProps`/`held` raus), `src/tracking/ui/SetRow.tsx` (`NumField` exportieren, Prop `big?: { unit: string }`), `tracking.css` (alte `.tk-ex*`-Regeln löschen, sobald unbenutzt), `scripts/web-smoke.ts`
- Delete: `src/tracking/ui/workout/ExerciseSection.tsx`, `src/tracking/ui/workout/useHold.ts`
- Test: `tests/tracking/live-focus.test.tsx` (neu), `tests/tracking/live-workout.test.tsx`, `tests/tracking/screens.test.tsx`, `tests/tracking/{plates-steps,exercise-info,exercise-proposals,workout-coach}.test.tsx`

**Interfaces:**
- Consumes: `currentSet`, `confirmSet`, `editSet`, `presetOf`, `filled`, `lastValues`, `asksEffort`, `setLabels`, `setTargetHint`, `plateLine`, `lastTimeLine`, `exerciseHasNoWeight` (alle bestehend, unverändert); `BrushTitle`, `Card`, `Kicker`, `MarkDot`, `Mark`, `RoundButton`, `Row`, `RowList`, `Sheet` (Kit).
- Produces (`live-view.ts`, rein):
  - `type SetMark = { rid: string; index: number; short: string; state: Mark }`; `setMarks(e: TrackedExercise): SetMark[]` (`short` aus `setLabels`, „Aufw.“ wird „A“; `now` = erster offener Satz); `markName(m: SetMark): string` → „Satz 3: dran“, „Satz 1: geschafft“, „Aufwärmsatz: offen“.
  - `focusSet(e: TrackedExercise): { index: number; kicker: string } | null` → erster offener Satz (Aufwärmen eingeschlossen); Kicker „Nächster Satz · 3 von 4“ (Zählung nur über Arbeitssätze) bzw. „Aufwärmsatz“; alle erledigt → `null`.
  - `upNext(w: TrackedWorkout, focusRid: string | null): { rid: string; title: string; sub: string }[]`: Übungen nach der Fokusübung mit offenen Sätzen, dann offene davor; ein Supersatz ist eine Zeile „A und B“ mit „Im Wechsel, je 3 Sätze“, sonst „3 Sätze“ / „1 Satz“.
- Produces (Komponenten):
  - `FocusCard({ a }: { a: ActiveWorkoutApi })`: `Card focus label={e.title}` (Region-Name = Übungstitel). Inhalt: `Kicker` (`focusSet().kicker`), `BrushTitle` Übungstitel, Satz „Letztes Mal hast du {lastTime} geschafft.“ (ohne Verlauf nichts), bei Supersatz „Im Wechsel mit {Partner}.“, „Gewicht nach Gefühl“ wie bisher; zwei `NumField big` mit `key={set.rid}` (der Entwurf und die Sperre gehören zu genau einem Satz; nach „Satz geschafft“ starten die Felder des nächsten Satzes frisch) (`Gewicht Satz {index+1}` / „Kilogramm“, `Wiederholungen Satz {index+1}` / „Wiederholungen“; zeitlich: nur `Sekunden Satz {index+1}` / „Sekunden“) mit dem Platzhalter aus `filled(set, presetOf(...))`; Ziel-Hinweis (`setTargetHint`) und Scheiben-Zeile (`plateLine`, nur Langhantel) klein darunter; `button.primary` „Satz geschafft“ (`Icon haken`, gesperrt bei ungültigem Feld) → `act((x) => confirmSet(x, e.rid, set.rid, now(), catalog))` und `thanked: null`; Zeile mit Satzkreisen (je ein `MarkDot` mit `short`, `name=markName` und `onClick`, öffnet `SetsSheet`: `set({ setsRid: e.rid })`; keine eigene Kreis-CSS), `RoundButton icon="info" name="Anleitung"` (öffnet ein Sheet mit `ExerciseInfo` + `StepLine` wie bisher inline) und `RoundButton icon="mehr" name={`Mehr zu ${e.title}`}` (öffnet `ExerciseMenu`); darunter `NotesField` (Entscheidung 13). Ohne offenen Satz: Kicker „Alle Sätze geschafft“, Text „Du kannst einen Satz anhängen oder zur nächsten Übung gehen.“, kein Feld, `secondary` „Satz hinzufügen“ (`addSet`). Ohne Übung im Training: `Card` mit „Noch keine Übung im Training.“ und `primary` „Übung hinzufügen“.
  - `SetsSheet({ a, rid }: …)`: `Sheet title={e.title}` mit dem bisherigen Inhalt des aufgeklappten Übungsteils ohne Info und Notiz: „Zuletzt …“, `SetHead`, alle `SetRow` (Bearbeiten-Modus, wenn `ui.editing === rid`), „Noch möglich: …“. Schließen setzt `setsRid` und `editing` auf `null`.
  - `ExerciseMenu({ a, e })`: das bisherige Menü-Sheet; „Notiz“ öffnet die Notiz in der Fokuskarte und setzt `openRid`, „Sätze bearbeiten“ setzt `editing` und `setsRid`, „Reihenfolge ändern“ öffnet `ReorderSheet` wie bisher.
- `ActiveWorkout` (bis Task 5 mit dem alten Kopf): … → `WorkoutCoach` → Effort-Karte(n) (Entscheidung 13; `EffortQuestion` unverändert; nach der Antwort `set({ thanked: rid })`) → `FocusCard` für `openRid ?? currentRid` → `Card soft` mit `Kicker` „Danach“, `RowList` aus `upNext` (Tipp → `set({ openRid })`) und `button.secondary` „Übung hinzufügen“ (`Icon plus`) → `button.secondary` „Training beenden“.

- [ ] **Step 1: Write the helpers and the failing tests.** `tests/tracking/live-helpers.ts` (dazu die Fabriken `rec`, `open2()` mit Bankdrücken 2 Sätze und Rudern 3 Sätze, `bodyOf`, `ids` aus `screens.test.tsx` hierher ziehen, damit Task 5 sie mitnutzt):

```ts
/** "Satz geschafft" on the focus card. */
export const doneNow = () => fireEvent.click(screen.getByRole('button', { name: 'Satz geschafft' }));
/** Opens the sets sheet of the focus exercise by its circle n (1-based row) and returns the dialog. */
export async function setsSheet(n = 1): Promise<HTMLElement> {
  fireEvent.click(screen.getByRole('button', { name: new RegExp(`^(Satz ${n}|Aufwärmsatz):`) }));
  return screen.findByRole('dialog');
}
```

`tests/tracking/live-focus.test.tsx`:

```tsx
it('the next set stands large with weight, reps and Satz geschafft; the other exercises wait quietly below', async () => {
  const { port, map } = fakePort([rec(open2())]); // Bankdrücken 2 Sätze, Rudern 3 Sätze
  render(<WorkoutScreen port={port} {...ids} />);
  fireEvent.click(await screen.findByRole('button', { name: 'Weitermachen' }));
  const focus = screen.getByRole('region', { name: 'Bankdrücken' });
  expect(within(focus).getByText('Nächster Satz · 1 von 2')).toBeTruthy();
  expect((within(focus).getByLabelText('Gewicht Satz 1') as HTMLInputElement).value).toBe('62,5');
  fireEvent.click(within(focus).getByRole('button', { name: 'Satz geschafft' }));
  await waitFor(() => expect(bodyOf(map, 'workout:open1').exercises[0].sets[0].doneMs).not.toBeNull());
  expect(within(screen.getByRole('region', { name: 'Bankdrücken' })).getByText('Nächster Satz · 2 von 2')).toBeTruthy();
  expect(screen.getByRole('button', { name: /Rudern/ }).closest('.card.soft')).toBeTruthy();
});
it('a tap on a set circle opens the set table; a later set can be ticked there', async () => {
  // … const sheet = await setsSheet(2); fireEvent.click(within(sheet).getByRole('button', { name: 'Satz 2 erledigt' })); → sets[1].doneMs gesetzt, sets[0] offen
});
it('in a superset the focus follows the rounds and Satz geschafft ticks only the shown set', async () => { /* A1 → B1 → A2, Partner bleibt offen */ });
it('a warm-up is circle A and comes first', async () => { /* markName „Aufwärmsatz: dran“, Kicker „Aufwärmsatz“ */ });
it('unreadable input blocks Satz geschafft and writes nothing', async () => {
  // 'abc' in „Wiederholungen Satz 1“ → button disabled; Record unverändert
});
it('all sets done: no empty card, Satz hinzufügen instead; no exercise: Übung hinzufügen', async () => { /* … */ });
it('tapping a row under Danach makes it the focus', async () => { /* Rudern → Region „Rudern“ */ });
it('the effort question is its own card after the last set and thanks once', async () => { /* Gruppe „Wie viele hättest du bei Bankdrücken noch geschafft?“ → „1–2“ → Danke-Satz; im Sätze-Sheet „Noch möglich: 1–2“ */ });
```

Bestehende Tests umstellen: in `screens.test.tsx` und `live-workout.test.tsx` `getByRole('button', { name: 'Satz N erledigt' })` → `doneNow()`, wenn N der Fokussatz ist, sonst `within(await setsSheet(N))…`; Felder des Fokussatzes behalten ihre Namen. Löschen (ersetzter Weg): „only the current exercise is open …“, „tapping a row opens it and closes the previous one“, „the open exercise follows the next open set after a confirm“ (deckt der erste neue Test ab), `describe` „long press“ bis auf „the arrow buttons move one place“ (über „Reihenfolge ändern“ im Menü öffnen). Die Datenerhalt-Tests („typing with slow saves keeps every digit …“, „a double tap on remove never removes the next row“, „removing a confirmed set asks first …“, „a note typed right before finishing …“, „a failing save shows a calm message …“) bleiben mit gleichen Record-Erwartungen; nur der Weg zum Feld ändert sich (Fokusfeld oder `setsSheet`).

- [ ] **Step 2: Run** `npx vitest run tests/tracking/live-focus.test.tsx` — Expected: FAIL.
- [ ] **Step 3: Implement** `live-view.ts`, `FocusCard`, `SetsSheet`, `ExerciseMenu`, `ActiveWorkout`. `scripts/web-smoke.ts`: `'Satz 1 erledigt'` → `'Satz geschafft'` (die Felder „Gewicht Satz 1“ und „Wiederholungen Satz 1“ stehen jetzt in der Fokuskarte).
- [ ] **Step 4: Run** `npx vitest run tests/tracking tests/web` und `npm run typecheck` — Expected: PASS. Die Datenerhalt-Tests aus Global Constraints laufen unverändert grün.
- [ ] **Step 5: Commit** `feat(kraft): the next set large with Satz geschafft, sets in a sheet`.

### Task 5: Rahmen des laufenden Trainings, Verkleinern, Abschluss

**Files:**
- Modify: `src/tracking/ui/workout/ActiveWorkout.tsx` (Kopf, Fortschritt, Pause), `src/tracking/ui/WorkoutScreen.tsx` (`onMinimize`), `src/web/app/Training.tsx` (`onLive`), `src/web/app/Shell.tsx` (zwei Stellen: Zustand `live`, Kopf/Profil/Nav nur ohne `live`), `src/tracking/ui/WorkoutSummary.tsx`, `src/tracking/ui/finisher.ts` (`finisherLine`), `src/tracking/ui/FinisherCard.tsx` (nutzt `finisherLine`), `src/tracking/ui/workout/live-view.ts` (`progressOf`, `doneSentence`), `tracking.css` (alte `.tk-live-head`, `.tk-rest`, `.tk-end` löschen, sobald unbenutzt)
- Test: `tests/tracking/live-frame.test.tsx` (neu), `tests/web/app/shell.test.tsx`, `tests/tracking/summary-and-feel.test.tsx`, `tests/tracking/live-workout.test.tsx` (Pausen-Test, Kopfmenü)

**Interfaces:**
- Consumes: `FocusCard`, `live-view.ts` (Task 4); `RoundButton`, `MainCard`, `BoBubble`, `Card`, `Kicker`, `Band`, `Sheet` (Kit).
- Produces:
  - `progressOf(w: TrackedWorkout, focusRid: string | null): { index: number; total: number; parts: { grow: 1; fill: number }[]; doneTitles: string[] }` (direkt die Teile für `Band`: erledigte Übung `fill` 1, Fokusübung erledigte Arbeitssätze / alle, offene 0).
  - `doneSentence(titles: string[]): string | null` → 0 `null`, 1 „Kniebeuge hast du schon geschafft.“, 2 „Kniebeuge und Rudern hast du schon geschafft.“, ab 3 „{Drei} Übungen hast du schon geschafft.“
  - `finisherLine(f: Finisher): string`: der bisherige Text aus `FinisherCard` (Cardio-Satz plus Grund), ohne Cardio und ohne Grund „Dehn ein paar Minuten, was sich fest anfühlt.“
  - `ActiveWorkoutProps` + `onMinimize: () => void`. `Training` + `onLive?: (live: boolean) => void` (gleicher Wert wie das bisherige `running`).
- Aufbau `ActiveWorkout` von oben: Kopf `div.tk-livehead`: `RoundButton icon="verkleinern" name="Verkleinern, Training läuft weiter"` → `onMinimize`; Mitte `BrushTitle level={1}` Trainingstitel und `<p role="timer" aria-label="Trainingsdauer">Läuft seit {sinceLabel}</p>`; rechts `RoundButton icon="mehr" name="Mehr zum Training"` (Kopfmenü wie bisher, ohne die „Läuft seit“-Zeile) → Speicher-Hinweis und `ui.notice` (Start-Hinweise) → Pausen-Karte (Entscheidung 14; `role="timer"` `aria-label="Satzpause"`, `position: sticky`) → `Card` „Dein Training“: `Kicker` links, „Übung {index} von {total}“ rechts, `Band parts={parts}` ohne `label` (`aria-hidden`), `doneSentence` als `link`-Knopf, der ein kleines Sheet „Geschafft“ öffnet (`Row` je erledigte Übung, Tipp setzt `openRid` und schließt) → `WorkoutCoach` → Effort → `FocusCard` → „Danach“ → „Training beenden“. Die Sheets „offene Sätze“ und „nichts erledigt“ bleiben wörtlich gleich (Knöpfe bekommen `primary`/`secondary`).
- `WorkoutScreen`: `onMinimize={() => setStore(null)}` (kein `closeStore`; der Abbau gibt den Store wie beim Tab-Wechsel an die Registry).
- `Shell`: `const [live, setLive] = useState(false)`; `web-top`, `web-profile` und `nav` nur bei `!(tab === 'training' && live)`; `Training onLive={setLive}`.
- `WorkoutSummary` (Entscheidung 16): Region-Name bleibt „Zusammenfassung“.

- [ ] **Step 1: Write the failing tests** `tests/tracking/live-frame.test.tsx`:

```tsx
it('Verkleinern leaves the workout running; Weitermachen brings back every confirmed set and the rest', async () => {
  const { port, map } = fakePort([rec(open2())]);
  render(<WorkoutScreen port={port} {...ids} />);
  fireEvent.click(await screen.findByRole('button', { name: 'Weitermachen' }));
  doneNow();
  await waitFor(() => expect(bodyOf(map, 'workout:open1').exercises[0].sets[0].doneMs).not.toBeNull());
  fireEvent.click(screen.getByRole('button', { name: 'Verkleinern, Training läuft weiter' }));
  const card = await screen.findByRole('region', { name: 'Läuft noch' });
  fireEvent.click(within(card).getByRole('button', { name: 'Weitermachen' }));
  expect(within(screen.getByRole('region', { name: 'Bankdrücken' })).getByText('Nächster Satz · 2 von 2')).toBeTruthy();
  expect(screen.getByRole('timer', { name: 'Satzpause' })).toBeTruthy();
  expect(bodyOf(map, 'workout:open1').endMs).toBeNull();
});
it('Verkleinern while a save fails keeps the workout and writes it later', async () => { /* port.put wirft einmal → Verkleinern → Weitermachen → Satz ist bestätigt; nach erfolgreichem Retry im Record */ });
it('the head says how long it runs; the progress card says what is done and opens Geschafft', async () => { /* „Läuft seit“, „Übung 2 von 2“, „Bankdrücken hast du schon geschafft.“ → Sheet „Geschafft“ */ });
it('the rest is a slim card: tapping skips, 30 s mehr adds', async () => { /* aus live-workout „the rest bar …“ übernommen */ });
it('the start notices show on the live screen: without legs and a second session today', async () => {
  // weekplan heute: gym, legs: false, also: { sport: 'bike', minutes: 20, hardness: 'easy' }; Plan mit Kniebeuge und Bankdrücken
  // „Training starten“ → role note enthält „Heute geht es ohne Beine, wie abgesprochen.“ und „Dazu heute: 20 Min.“
});
it('after Training beenden: Gespeichert as the main card with Fertig, and Bo says the stretch', async () => { /* Region „Zusammenfassung“, .tk-bo enthält finisherLine */ });
```

In `tests/web/app/shell.test.tsx`:

```tsx
it('the tab bar and the profile button step aside while the workout is shown and come back after Verkleinern', async () => {
  await boot({ account: 'anna', seed: [planRec('Oberkörper', 2)] });
  fireEvent.click(await screen.findByRole('button', { name: 'Kraft' }));
  fireEvent.click(within(await screen.findByRole('region', { name: 'Nächstes Training' })).getByRole('button', { name: 'Training starten' }));
  await screen.findByRole('button', { name: 'Satz geschafft' });
  expect(screen.queryByRole('navigation', { name: 'Seiten' })).toBeNull();
  expect(screen.queryByRole('button', { name: 'Profil' })).toBeNull();
  fireEvent.click(screen.getByRole('button', { name: 'Verkleinern, Training läuft weiter' }));
  expect(await screen.findByRole('navigation', { name: 'Seiten' })).toBeTruthy();
});
```

`tests/tracking/live-workout.test.tsx`: den Pausen-Test nach `live-frame` verschieben („+30 s“ → „30 s mehr“); „Läuft seit“ steht jetzt im Kopf, nicht im Menü.

- [ ] **Step 2: Run** `npx vitest run tests/tracking/live-frame.test.tsx tests/web/app/shell.test.tsx` — Expected: FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run** `npx vitest run tests/tracking tests/web` und `npm run typecheck` — Expected: PASS.
- [ ] **Step 5: Commit** `feat(kraft): calm frame of the running workout, Verkleinern, closing card`.

### Task 6: Ausdauer oben umschalten, Rad

**Files:**
- Modify: `src/web/app/Ausdauer.tsx`, `src/tracking/ui/BikeScreen.tsx`, `src/tracking/ui/bike-view.ts` (`bikeTrendSentence`, `blockWatts`), `tracking.css` (alte `.tk-bike`-Kartenregeln löschen, sobald unbenutzt)
- Test: `tests/tracking/bike-screen.test.tsx`, `tests/web/app/bike.test.tsx`

**Interfaces:**
- Consumes: `Segments`, `StandCard`, `MainCard`, `Band`, `BoBubble`, `RowCard`, `Row`, `RowList`, `Sheet` (Kit); `useSportWeek(port, now, 'rad')` (Task 2).
- Produces (`bike-view.ts`, rein):
  - `blockWatts(b: BikeBlock, ftpW: number | null): string | null` → „etwa 190 W“ nur bei `pct > 65`; locker, ohne `pct` oder ohne `ftpW` `null` (Entscheidung 18).
  - `blockBand(blocks: BikeBlock[]): { grow: number; fill: number; tall: boolean }[]` → `grow` = Minuten, `fill` und `tall` aus `pct > 65` (Teile für `Band`).
  - `bikeTrendSentence(b: BikeBody): string | null`: ältester Wert der `ftpHistory`, der mindestens 14 Tage vor dem neuesten liegt (Logik wie `ftpSentence`); mehr → „Seit {Monat} trittst du kräftiger.“, weniger → „Seit {Monat} ist deine Dauerleistung etwas gesunken.“, gleich → „Seit {Monat} hältst du deine Dauerleistung.“; sonst `null`.
- `Ausdauer`: `<h1 className="tk-sr">Ausdauer</h1>`; mit Rad und Laufen zuerst `Segments label="Ausdauer"` (`rad`/Icon `ausdauer`, `laufen`/Icon `lauf`), sonst nichts; kein `PageHead`.
- `BikeScreen` von oben: `StandCard kicker="Rad · diese Woche"` → mit `next`: `MainCard kicker={day ?? 'Nächste Fahrt'} title={next.name}` (`day` = „Heute“ oder `${weekdayOfKey(d)}, ${dayMonthLongOfKey(d)}` des nächsten Rad-Tags, z. B. „Freitag, 13. November“), `label="Nächste Fahrt"`, Text „{minutes} Minuten, {HARDNESS_LABEL}. Du fährst sie in der Mac-App.“, `more` = `Band label={`Ablauf: ${…}`} parts={blockBand(blocks)}` (Entscheidung 19, nur mit Blöcken), `primary` „Ablauf ansehen“ nur mit Blöcken; ohne `next` keine Hauptkarte → `BoBubble portrait="mini"` mit `next.reason` (nur mit Text) → `RowCard icon="entwicklung" kicker="Deine Entwicklung" title={bikeTrendSentence ?? 'Entwicklung ansehen'}` → Entwicklungs-Sheet wie bisher → `RowCard icon="ausdauer" kicker={`Letzte Fahrt · ${Wochentag}`} title="{rideName}, {Minuten} Minuten"` → `RideSheet` wie bisher. Ablauf-Sheet: `Row title={b.label} value={blockWatts(b, ftpW)}`.

- [ ] **Step 1: Write the failing tests** in `tests/tracking/bike-screen.test.tsx` (alte Tests ersetzen):

```tsx
test('Rad shows the week stand, the next ride as the main card with the band, and Ablauf ansehen with watts only for the hard blocks', async () => {
  const { port } = fakePort([bikeRec({ ftpW: 200, next: { name: 'Intervalle', minutes: 60, hardness: 'hard', reason: 'Die Beine sind frisch.', blocks: [{ label: '10 Min locker', minutes: 10, pct: 55 }, { label: '3 × 8 Min bei 95 %, dazwischen 4 Min locker', minutes: 36, pct: 95 }] } }), weekplanBikeFriday]);
  render(<BikeScreen port={port} now={() => THURSDAY} />);
  expect(await screen.findByRole('region', { name: 'Rad · diese Woche' })).toBeTruthy();
  const main = screen.getByRole('region', { name: 'Nächste Fahrt' });
  expect(main.textContent).toContain('Du fährst sie in der Mac-App.');
  expect(within(main).getByLabelText(/^Ablauf: 10 Min locker/)).toBeTruthy();
  expect(document.querySelector('.tk-bo')!.textContent).toContain('Die Beine sind frisch.');
  fireEvent.click(within(main).getByRole('button', { name: 'Ablauf ansehen' }));
  const sheet = await screen.findByRole('dialog', { name: 'Intervalle' });
  expect(sheet.textContent).toContain('etwa 190 W');
  expect(sheet.textContent).not.toContain('110 W'); // lockere Blöcke ohne Watt
});
test('without a next ride there is no empty main card', async () => { /* nur Stand, Entwicklung, Letzte Fahrt */ });
test('Deine Entwicklung is one sentence without a number; the sheet keeps FTP, phase and hours', async () => { /* … */ });
test('the last ride is a row card that opens the ride sheet', async () => { /* … */ });
```

`tests/web/app/bike.test.tsx`: „with Rad and Laufen a switch shows …“ prüft zusätzlich, dass die Gruppe „Ausdauer“ vor der Region „Rad · diese Woche“ steht und es kein sichtbares `<h1>` gibt (`.tk-sr`); mit nur Rad gibt es keine Gruppe. Tests zu „bei 95 % (195 W)“ werden gelöscht.

- [ ] **Step 2: Run** `npx vitest run tests/tracking/bike-screen.test.tsx tests/web/app/bike.test.tsx` — Expected: FAIL.
- [ ] **Step 3: Implement**; `withWatts` löschen.
- [ ] **Step 4: Run** die Tests und `npm run typecheck` — Expected: PASS.
- [ ] **Step 5: Commit** `feat(ausdauer): switch on top, the next ride as the main card`.

### Task 7: Laufen

**Files:**
- Modify: `src/tracking/ui/RunScreen.tsx`, `src/tracking/ui/run-view.ts` (`runTrendSentence`), `src/tracking/ui/RunFeel.tsx` (nur Knopfklassen, falls leer), `tracking.css` (alte `.tk-weekcard`, `.tk-weekinfo`, `.tk-lastrun`, `.tk-entry` löschen, sobald unbenutzt)
- Test: `tests/tracking/run-screen.test.tsx`, `tests/web/app/run.test.tsx`

**Interfaces:**
- Consumes: `StandCard`, `MainCard`, `BoBubble`, `Card`, `Kicker`, `RowCard` (Kit); `useSportWeek(port, now, 'lauf')` (Task 2).
- Produces: `runTrendSentence(n: RunNumbers): string | null` in `run-view.ts` (Vergleich wie `Progress`): schneller → „Du wirst bei gleichem Puls schneller.“, langsamer → „Du bist gerade etwas langsamer als {vor 12 Wochen | vor 4 Wochen}.“, gleich → „Dein ruhiges Tempo ist gleich geblieben.“, ohne Vergleich `null`.
- `RunScreen` von oben (Sonderfälle zuerst, wie bisher): Vorschlag „Laufen einschalten“ als `MainCard kicker="Laufen"` mit `primary` „Laufen einschalten“ und `more` = `link` „Nicht jetzt“; erste Fragen (`Questions` unverändert, Speichern `primary`); Pause- und Sanft-Hinweis als `.tk-note`; „Auf deiner Uhr sind noch …“ in `Card`. Danach: `StandCard kicker="Laufen · diese Woche"` mit `action` „Lauftage ändern“ (öffnet `Questions` als Sheet; nicht während der ersten Fragen) → `MainCard` (`label` „Heute“ bzw. „Nächster Lauf“ wie bisher, `kicker` „Heute“ oder Wochentag mit Datum wie beim Rad, `title` = `KIND`, Text „{minutes} Minuten, Puls bis {hrCap}, {counts}.“ in ganzen Sätzen, `primary` „Lauf eintragen“); ohne Lauf ab heute `kicker="Laufen"`, `title="Freier Lauf"`, Text „Für diese Woche ist kein Lauf mehr geplant. Trag einen Lauf ein, wenn du gelaufen bist.“ und dieselbe Hauptaktion; in der Pause keine Hauptkarte, aber `secondary` „Lauf eintragen“ unter dem Hinweis → `BoBubble portrait="mini"` mit `week.reason` / `week.note` (nur mit Text) → `GarminBlock` in einer `Card` (unverändert) → letzter Lauf: mit offener Frage `Card` (`Kicker` „Letzter Lauf“, Ergebnis, Satz, `RunFeelQuestion`), sonst `RowCard icon="lauf" kicker={`Letzter Lauf · ${Wochentag}`} title={result} sub={sentence} end="none"` → `RowCard icon="entwicklung" kicker="Deine Entwicklung" title={runTrendSentence ?? 'Entwicklung ansehen'}` (nur wenn es heute schon die Zeile gäbe) → Entwicklungs-Sheet unverändert.

- [ ] **Step 1: Write the failing tests** in `tests/tracking/run-screen.test.tsx`:

```tsx
test('Laufen shows the week stand with Lauftage ändern, the next run as the main card with Lauf eintragen, and Bo says the week', async () => {
  const { port } = fakePort([statusOn(), weekWithRuns([{ date: SA, kind: 'easy', minutes: 35, hrCap: 155 }], { reason: 'Zwei ruhige Läufe halten dich frisch.' })]);
  render(<RunScreen port={port} now={() => THURSDAY} newId={() => 'n1'} />);
  const stand = await screen.findByRole('region', { name: 'Laufen · diese Woche' });
  expect(within(stand).getByRole('button', { name: 'Lauftage ändern' })).toBeTruthy();
  const main = screen.getByRole('region', { name: 'Nächster Lauf' });
  expect(main.textContent).toContain('35 Minuten, Puls bis 155');
  expect(within(main).getByRole('button', { name: 'Lauf eintragen' }).className).toBe('primary');
  expect(document.querySelector('.tk-bo')!.textContent).toContain('Zwei ruhige Läufe');
});
test('without a run ahead the main card is Freier Lauf with the same button', async () => { /* … */ });
test('during a pause there is no main card, but Lauf eintragen is still there', async () => { /* … */ });
test('the feel question is its own card while open; answered, the last run is a quiet row', async () => { /* … */ });
test('Deine Entwicklung is one sentence without digits and opens the sheet as before', async () => { /* … */ });
```

Bestehende Tests anpassen: „Lauftage“ → „Lauftage ändern“, „Entwicklung“ (Row) → `RowCard` mit Namen `/Deine Entwicklung/`, „the feel question sits inside "Letzter Lauf" …“ → Region „Letzter Lauf“; „with no run ahead the page shows one week card …“ löschen (ersetzt durch Stand + Freier Lauf). Die Schreib-Tests (Settings, `manual-<id>`, `send-<week>`, Feel) bleiben mit gleichen Erwartungen. `tests/web/app/run.test.tsx`: Laufen-Ansicht über die Gruppe „Ausdauer“ wie bisher.

- [ ] **Step 2: Run** `npx vitest run tests/tracking/run-screen.test.tsx` — Expected: FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run** `npx vitest run tests/tracking tests/web` und `npm run typecheck` — Expected: PASS.
- [ ] **Step 5: Commit** `feat(ausdauer): Laufen with the week stand and the next run as the main card`.

### Task 8: Abschluss

- [ ] **Step 1:** `npm run typecheck`, `rtk proxy npm run lint` (0 Fehler), `npm test` — Expected: alles grün. `grep -rn "ExerciseSection\|useHold\|withWatts\|StudioRow\|Routine oder leeres Training\|aria-label=\"Kraft\"" src tests scripts` und `grep -rn 'className="tk-seg"\|tk-roundbtn pill' src` — Expected: keine Treffer. `git diff main --stat -- src/main src/ui src/service src/shared src/tracking/session.ts src/tracking/store.ts src/tracking/registry.ts` — Expected: leer.
- [ ] **Step 2:** Sichtprüfung: `npm run build:web`, dann `/private/tmp/claude-501/-Users-sbinder-Projects-bike-coach/76e854cd-52f8-4db9-8605-4ff1597ea055/scratchpad/vis3/shoot.cjs` nach `…/scratchpad/vis4/shoot.cjs` kopieren (`/bin/cp`), `R` auf diesen Worktree setzen und die Records um einen `bike`-Record (`next` mit Blöcken und `pct`, `ftpHistory` über drei Monate), einen `ride`, `run`-Records (`status` an, `week` mit einem Lauf am Samstag) und eine `routine` ergänzen. Aufnahmen bei 390 px und 1200 px, dunkel und hell: Kraft, Deine Routinen, Deine Übungen, laufendes Training (ein Satz bestätigt, Pause läuft, Supersatz unter „Danach“), Zusammenfassung, Ausdauer Rad, Ablauf-Sheet, Ausdauer Laufen. Mit `docs/design/moodboard/{kraft,kraft-aktiv,ausdauer}.html` vergleichen: Fokuskarte mit Schein, Satzkreise, schmale Pause, Pillen (auch die Zurück-Pille auf Gesundheit und Gemeinsam), Kacheln, Umschalter oben, Ablaufband, hell lesbar. Abweichungen nur über Tokens in `tokens.css` oder den Kit-Block beheben; was die Abnahme nicht betrifft, in den Parkplatz.
- [ ] **Step 3:** `npm run test:web-smoke`, falls ein Testserver verfügbar ist — Expected: alle Schritte grün; sonst im Bericht sagen, dass der Smoke nicht lief.
- [ ] **Step 4:** Roadmap: Zeile Dojo 3 auf ✅; im Abschnitt „Dojo — Briefs“ den Verweis auf diesen Plan ergänzen. Parkplatz: Dojo-1-Punkt „Hauptknöpfe ohne `class="primary"`“ auf „Heute, Woche, Kraft, Ausdauer erledigt; Essen folgt in Dojo 4“ kürzen; durchstreichen mit „Erledigt mit Dojo 3“: „Ausblenden/Entfernen eines Studios nur auf dem Startbildschirm“ (als „bewusst“, Entscheidung 5), „Umschalter „Rad | Laufen“ steht über dem Seitentitel“, „Die Start-Hinweise … haben keinen Oberflächentest“, „Der Rad-Verlauf zeigt Wattbereiche nur bei „bei N %“-Bezeichnungen“. „Katalog: große Gruppen …“ bleibt offen. Neu: „Verkleinern stoppt den Pausen-Wecker wie der Tab-Wechsel; die Pause selbst läuft im Record weiter.“ Plan nach `docs/archive/plans/` verschieben (`git mv`).
- [ ] **Step 5: Commit** `docs: Dojo 3 done`.
