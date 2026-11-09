# Dojo 2 Heute, Woche, Sensei Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Heute und Woche geben sofort Orientierung (erledigt, heute, kommt noch), Bo sitzt auf Heute im Bambusnest, Gesundheit steht als Karte auf der Woche und hat eine eigene Seite, und das Gespräch mit dem Sensei ist ein ruhiger Chat mit Sprechblasen.

**Architecture:** Erst wächst das Kit (Tokens, Icons, `RowCard`, `WordTile`, `WeekPath`, `BoScene`, Sheet als Seite), dann bekommen beide Seiten **eine** Wochen-Datenquelle (`useWeekDays` plus reine Funktionen in `week-path.ts`) und **ein** Tages-Sheet (`DaySheet`). Die Screens setzen danach nur noch Kit-Bausteine zusammen; keine Farbe, kein Kartenrezept und kein Icon-Pfad steht in einer Screen-Datei. Vorschläge (Übernehmen, Nein danke, Rückgängig) wandern aus `CoachChat` in einen eigenen Baustein, den Chat-Blase, Vorschläge-Sheet auf der Woche und Heute gemeinsam nutzen.

**Tech Stack:** React 19, Vite, vitest mit @testing-library/react (ohne jest-dom: nur einfache Assertions wie `toBeTruthy()`, `textContent`, `toBe`), CSS-Tokens.

**Spec:** `docs/design/DESIGN.md` (bindend, auch „Im Code: eine Stelle pro Sache“), Brief „Dojo 2 Heute, Woche, Sensei“ in `docs/roadmap.md`. Bilder: `docs/design/moodboard/{heute,woche,sensei,gesundheit}.html` im Browser öffnen; der HTML-Kommentar oben in `woche`, `sensei` und `gesundheit` sagt, wohin jede heutige Funktion wandert.

## Global Constraints

- **Texte:** natürliche deutsche ganze Sätze, keine abgehackten Fragmente mit Gedankenstrich (`docs/language.md`). Bo duzt. In der Oberfläche heißt Bo „Sensei“, nie „Coach“ (Test `tests/web/sensei-wording.test.ts` bleibt grün). Feste Bo-Texte nur aus `src/tracking/ui/bo.ts`.
- **Leicht bleiben:** keine Gamification (keine Punkte, Streaks, Abzeichen), keine Zahlenflut. Gesundheit zeigt Wörter, keine Messwerte auf der Fläche; Zahlen nur im Verlauf-Sheet wie bisher.
- **Optional:** Garmin und Hevy sind nie Pflicht. Ohne Health-Record gibt es keine Gesundheitskarte und keine leere Hülle. Schlaf/HRV erscheinen ohne Daten nur als ruhiger Hinweis ohne Bewertung.
- **Öffentliches Repo:** keine persönlichen Daten in Code, Texten oder Fixtures (keine echten Namen, Werte, Adressen). Der Schlaf-Hinweis spricht allgemein („wenn die Uhr nachts nicht getragen wird“).
- **Eine Stelle pro Sache:** Farben nur als Token in `src/design/tokens.css` (dunkel auf `:root`, hell nur unter `@media (prefers-color-scheme: light)`, sonst `/* shared */`); nie handgeschriebene `[data-theme]`-Blöcke (`themeChoice()` in `src/web/theme-css.ts` erzeugt sie). Keine Farb-Literale in CSS oder TSX (`tests/web/style-tokens.test.ts`). Bausteine nur in `src/tracking/ui/kit/`, UI-Icons nur in `kit/Icon.tsx` (`currentColor`), Bos Szenen als SVG in `src/web/public/brand/`. Kein Screen baut sich eine eigene Karte, Blase oder Zeile.
- **Schriftgewicht:** nur 400, 500, 700 (Zen Kaku hat kein 600).
- **Knöpfe:** mindestens 44 px; pro Screen eine Hauptaktion (`primary`), Sprünge an einen anderen Ort als `secondary`.
- **Nicht anfassen:** `src/ui/**`, `src/main/**` (Mac-App). Keine neuen Coach-Funktionen, keine Änderung an Prompts.
- **Datenformate bleiben:** kein Record-Typ und kein Feld auf Server oder Gerät ändert sich. Einzige Typ-Erweiterung: das UI-Hilfsobjekt `DayRow` (nicht gespeichert) bekommt `kinds`.
- **Interne Namen bleiben:** Tab-ID `'coach'`, `CoachScreen`, `CoachChat`, Dialogname des Chats `BO.title` („Bo, dein Sensei“).
- **Tests nach Zweck** (`docs/roadmap.md`, Arbeitsweise 6): Datenerhalt streng; neue Tests nur für Abnahmesätze und die Review-Focus-Fälle. Tests ersetzter Wege (Tag-Pfeile, Wischen, „Dein Körper“, Gesundheit im Rückblick, Vorschlag-Karte) werden gelöscht, nicht angepasst.
- Befehle: `npm run typecheck`, `rtk proxy npm run lint` (0 Fehler; etwa 53 Warnungen gibt es schon), `npm test`. Einzeltest: `npx vitest run <datei>`.

## Entscheidungen

Vorab entschieden, damit niemand beim Bauen raten muss:

1. **Gestern/Morgen-Tagesseiten fallen weg** (Pfeile, Wischen, `DayHead`, `day-nav.ts`). Den Inhalt bekommt man über `DaySheet`: Tipp auf einen Punkt im Wochenweg (Heute) oder auf eine Tageszeile (Woche); die Karte „Morgen“ auf Heute öffnet dasselbe Sheet. Grund: Der Brief legt Heute fest („darunter nur Essen und Morgen“), und der Wochenweg zeigt jeden Tag.
2. **Essen von gestern und morgen** steht nur noch im Essen-Tab (Tagesauswahl). `DayMeals` verliert `offset`. Grund: Das Tages-Sheet liegt in `src/tracking`, das nicht aus `src/web` importieren soll.
3. **„Dein Körper“ fällt von Heute weg.** Ein Arzt-Hinweis steht ganz oben auf der Gesundheitskarte der Woche und auf der Gesundheitsseite. Grund: Der Brief erlaubt unter der Hauptkarte nur Essen und Morgen.
4. **Gemeinsam** zieht als ruhige Kachel neben „Rückblick“ und „Was Bo beachtet“ auf die Woche (`TogetherScreen.tsx` zieht nach `src/tracking/ui/`; es braucht nur `src/shared`). Grund: Es ist ein Wochenblick.
5. **„Jetzt dran“ hat eine feste Rangfolge:** offenes Training („Weitermachen“), dann „Zum Abschluss“ (innerhalb der 3 Stunden), dann der Tag aus dem Plan (`TodayCard`), sonst „Was soll Pandafit planen?“. Alles ist eine `MainCard`. Das Beweglichkeitsangebot steht im `more`-Bereich dieser Karte.
6. **Ein wartender Vorschlag** ist keine eigene Karte mehr: Auf Heute und Woche bekommt Bos Blase den Hauptknopf „Vorschlag ansehen“ (Heute öffnet den Chat, die Woche das Vorschläge-Sheet). `WaitingProposal.tsx` fällt weg.
7. **Im Chat** steht der erste offene Vorschlag (Wochenplan zuerst, sonst der neueste) mit „Übernehmen“ und „Nein danke“ in seiner Blase. Weitere offene Vorschläge stehen hinter dem Streifen „Bo hat noch … weitere Vorschläge.“ Das automatische Öffnen des Vorschläge-Sheets entfällt.
8. **Zeit pro Nachricht bleibt** klein in der Blase (Meilenstein H „Chat mit Datum/Zeit“). Bo hat in jeder Blase sein kleines Standbild ohne Canvas. Grund: nur ein bewegter Bo pro Seite, und 30 Canvas-Player wären teuer.
9. **Der Chat bleibt ein Sheet** (über der Tab-Leiste), bekommt aber oben links „Zurück“ statt ×. Grund: Die feste Eingabe mit Tastatur funktioniert so schon; das Moodboard zeigt die Leiste nur zur Orientierung.
10. **Gesundheit ist eine Unterseite im Woche-Tab** (lokaler Zustand in `CoachScreen`, Tab Woche bleibt aktiv, Knopf „‹ Woche“), wie heute `TogetherPage` auf Heute. Browser-Zurück schließt sie nicht; das kommt in den Parkplatz.
11. **Bos Nest gilt für hell und dunkel** (eine SVG-Fassung, über `/* shared */`-Tokens). Grund: Die Szene hat eigene Objektfarben auf eigenem Lichtschein, wie `panda-still.svg`. Braucht hell später eine Variante, ist das nur ein Token-Wert.
12. **Bo auf der Woche** ist das kleine Standbild (`portrait="mini"`), bewegt nur auf Heute. Grund: DESIGN, verspielt nur auf Heute und im Gespräch.
13. **Zähler „2 von 5 geschafft“** steht auf Heute und Woche gleich: erledigte Tage dieser Woche von den Trainingstagen im Wochenplan. Ohne Plan steht nur „2 geschafft“, bei 0 ohne Plan nichts.
14. **Seitentitel** bekommen überall den Pinselstrich: `PageHead` rendert seinen Titel über `BrushTitle level={1}`. Heute hat keinen sichtbaren Titel (Moodboard), nur ein `<h1>` für Screenreader und die Datumszeile.
15. **„Was Bo beachtet“** zeigt keine Anzahl mehr, „Nächste Woche“ ist eine ruhige Zeile unter „Kommt noch“, die ein kleines Sheet mit dem Plan öffnet. `CoachPrefs` fällt aus `CoachScreen` (die Web-App zeigt es im Profil; `showPrefs` entfällt).
16. **Parkplatz aus Dojo 1:** `font-weight: 600` wird überall 700 (der Browser zeigt schon 700, also keine sichtbare Änderung). Die Hauptknöpfe von Heute und Woche laufen über `MainCard`.

## Review Focus

1. **Neue Person oder Woche ohne Plan / Modus Spontan:** Wochenweg zeigt sieben ruhige Punkte, kein „0 von 0“, keine leere Karte; Woche bietet „Woche planen“ in Bos Blase. (Test in Task 3 und Task 7.)
2. **Helles Schema:** Nest, Blase „du“, Kacheln, Heute-Ring mit Glühen sind auf Papier lesbar. (Token-Test in Task 1, Sichtprüfung in Task 8.)
3. **Arzt-Hinweis:** steht auf der Gesundheitskarte und der Seite immer zuerst, nie hinter dem ruhigen Satz versteckt. (Test in Task 5.)
4. **Mehrere offene Vorschläge** (Woche, Regel, Übungstausch): genau einer in der Blase, die anderen hinter dem Streifen; Übernehmen schreibt dieselben Records wie bisher, nichts doppelt. (Test in Task 6.)
5. **Teilweise Gesundheitsdaten** (nur Ruhepuls, kein Schlaf): Kacheln nur für vorhandene Bereiche, Schlaf-Hinweis ohne Daten, ohne Health-Record gar keine Karte. (Test in Task 5.)

---

### Task 1: Kit und Tokens für Dojo 2

**Files:**
- Modify: `src/design/tokens.css`, `src/tracking/ui/tracking.css` (Kit-Block), `src/web/web.css` (nur `600` → `700`), `src/tracking/ui/kit/{Dojo.tsx,Icon.tsx,Sheet.tsx,PageHead.tsx,index.ts}`
- Create: `src/tracking/ui/kit/RowCard.tsx`
- Test: `tests/web/dojo-kit.test.tsx`, `tests/web/style-tokens.test.ts`

**Interfaces:**
- Produces (Tokens, dunkel / hell): `--tile` `#2f4033` / `rgba(34,55,43,.08)`; `--today-glow` `rgba(242,189,85,.55)` / `rgba(224,168,58,.45)`; `--bubble-me` `#3a3a2a` / `#f6e3cf`; `--bubble-me-line` `#7a5a3e` / `#e0b48c`; `--good-wash` `rgba(156,186,114,.16)` / `rgba(94,130,60,.14)`.
- Produces (Icons): `IconName` um `'lauf' | 'herz' | 'spross' | 'mond' | 'ziel' | 'stift' | 'sprechen' | 'senden' | 'zurueck' | 'haken' | 'rueckblick' | 'regeln' | 'aenderung'` erweitert. Pfade aus den Moodboards (`woche.html`: Lauf-Schuh, Ziel, Stift, Haken, Rückblick-Rolle, Regel-Buch; `gesundheit.html`: Herz, Spross, Mond; `sensei.html`: Zurück, Senden, Liste „Zuletzt geändert“; `heute.html`: Sprechblase im Knopf „Frag Bo“). Farbige Füllungen der Vorlage werden `currentColor` oder `fill="none"`.
- Produces (Kit):
  - `BrushTitle({ children, level = 2 }: { children: ReactNode; level?: 1 | 2 | 3 })`.
  - `PageHead({ title, subtitle, back }: { title: string; subtitle?: ReactNode; back?: { label: string; onClick: () => void } })`: Titel über `BrushTitle level={1}`; `back` ist ein runder Pillenknopf `‹ {label}` über dem Titel.
  - `MainCard({ kicker, title, text, primary, secondary, more, label }: { kicker: string; title: string; text?: ReactNode; primary?: Action; secondary?: Action; more?: ReactNode; label?: string })`: `primary` jetzt optional; `more` steht unter den Knöpfen (ruhige Zusätze); `label` überschreibt den Regionsnamen (Standard `kicker`).
  - `Bubble({ children, actions, tail = 'left', foot }: { …; tail?: 'left' | 'right' | 'none'; foot?: ReactNode })`: `tail="right"` ist die Blase „du“ (Fläche `--bubble-me`, Rand `--bubble-me-line`, rechts ausgerichtet); `foot` ist eine kleine gedämpfte Zeile (Uhrzeit, Etikett).
  - `Tag({ children }: { children: ReactNode })` in `Dojo.tsx`: kleines grünes Etikett mit Haken (`--good-wash`, `--good-text`), z. B. „Im Training berücksichtigt“.
  - `RowCard({ icon, kicker, title, sub, lead, end = 'chevron', flat = false, highlight = false, onClick }: { icon: IconName; kicker?: string; title: string; sub?: string; lead?: string; end?: 'chevron' | 'done' | 'none'; flat?: boolean; highlight?: boolean; onClick?: () => void })`: die Zeilenkarte aus DESIGN (Icon-Kachel `--tile` links, Kicker, Titel, Untertitel, rechts `›` oder grüner Haken). `flat` ohne eigenen Kartenrand (Zeile innerhalb einer `Card`), `lead` ist das Tageskürzel links („Mo“), `highlight` der goldene Rahmen für heute. Mit `onClick` ein `<button>`, sonst ein `<div>`.
  - `WordTile({ icon, label, word, tone = 'calm' }: { icon: IconName; label: string; word: string; tone?: 'calm' | 'note' })`: Kachel `.tk-wordtile` mit Icon, Großbuchstaben-Label und einem Wort (`calm` in `--good-text`, `note` in `--accent-text`).
  - `Sheet` bekommt `page?: boolean`: oben links ein runder Knopf mit `Icon name="zurueck"` und `aria-label="Zurück"` statt ×; er ruft `onClose`.
  - `kit/index.ts` exportiert `RowCard`, `WordTile`, `Tag`; Kopfkommentar ergänzt: `RowCard` ist die einzige Zeilenkarte, `WordTile` die einzige Wort-Kachel, `Sheet page` für Seiten wie den Chat; „Reserviert für Dojo 2“ wird ersetzt.

- [ ] **Step 1: Write the failing tests.** In `tests/web/style-tokens.test.ts`:

```ts
it('uses only the weights Zen Kaku has', () => {
  for (const f of [WEB, TRACKING]) expect(read(f)).not.toMatch(/font-weight:\s*600/);
});
it('defines the Dojo 2 tokens in both schemes', () => {
  const [dark, light] = read(TOKENS).split('@media (prefers-color-scheme: light)');
  for (const t of ['--tile', '--today-glow', '--bubble-me', '--bubble-me-line', '--good-wash']) {
    expect(dark).toContain(`${t}:`);
    expect(light).toContain(`${t}:`);
  }
});
```

In `tests/web/dojo-kit.test.tsx`:

```tsx
it('draws every registered icon with currentColor only', () => {
  // bestehender Test: die Namensliste um die 13 neuen Namen erweitern
});
it('builds a row card with icon tile, kicker, title and the end mark', () => {
  const go = vi.fn();
  render(<RowCard icon="lauf" kicker="Morgen" title="Lockere Radfahrt" sub="Rad, ganz entspannt" onClick={go} />);
  const b = screen.getByRole('button', { name: /Lockere Radfahrt/ });
  expect(b.querySelector('svg[data-icon="lauf"]')).toBeTruthy();
  expect(b.textContent).toContain('Morgen');
  fireEvent.click(b);
  expect(go).toHaveBeenCalled();
  cleanup();
  render(<RowCard flat lead="Mo" icon="kraft" title="Beine" end="done" />);
  expect(screen.queryByRole('button')).toBeNull();
  expect(document.querySelector('svg[data-icon="haken"]')).toBeTruthy();
});
it('lets a main card go without a primary button and carry quiet extras', () => {
  render(<MainCard kicker="Jetzt dran" title="Ruhetag" text="Erholung gehört zum Training." more={<button type="button" className="secondary">Etwas anderes heute?</button>} />);
  const card = screen.getByRole('region', { name: 'Jetzt dran' });
  expect(card.querySelector('button.primary')).toBeNull();
  expect(within(card).getByRole('button', { name: 'Etwas anderes heute?' })).toBeTruthy();
});
it('shows the own message as a right bubble and a sheet page with a back button', () => {
  render(<Bubble tail="right" foot="14:05">Am Samstag habe ich keine Zeit.</Bubble>);
  expect(document.querySelector('.tk-bubble.right')).toBeTruthy();
  expect(document.querySelector('.tk-bubble')!.textContent).toContain('14:05');
  cleanup();
  const close = vi.fn();
  render(<Sheet page title="Bo, dein Sensei" onClose={close}><p>x</p></Sheet>);
  expect(screen.queryByRole('button', { name: 'Schließen' })).toBeNull();
  fireEvent.click(screen.getByRole('button', { name: 'Zurück' }));
  expect(close).toHaveBeenCalled();
});
it('gives every page title the brush stroke', () => {
  render(<PageHead title="Deine Woche" back={{ label: 'Woche', onClick: () => {} }} />);
  const h1 = screen.getByRole('heading', { level: 1, name: 'Deine Woche' });
  expect(h1.closest('.tk-brush')).toBeTruthy();
  expect(screen.getByRole('button', { name: /Woche/ })).toBeTruthy();
});
```

- [ ] **Step 2: Run** `npx vitest run tests/web/dojo-kit.test.tsx tests/web/style-tokens.test.ts` — Expected: FAIL.
- [ ] **Step 3: Implement** Tokens, Icons, Kit-Bausteine und ihre CSS-Regeln im Kit-Block von `tracking.css` (nur Tokens). Alle `font-weight: 600` in `web.css` und `tracking.css` auf `700`. `PageHead` auf `BrushTitle level={1}` umstellen; Tests, die eine Überschrift über `.tk-title` suchen, finden sie weiter, weil das `<h1>` die Klasse behält.
- [ ] **Step 4: Run** die beiden Tests, dann `npm test` — Expected: PASS (Screens sehen außer dem Pinselstrich unter Seitentiteln gleich aus).
- [ ] **Step 5: Commit** `feat(design): Dojo 2 kit (row card, word tile, tag, sheet page, icons, tokens)`.

### Task 2: Bos Bambusnest

**Files:**
- Create: `src/web/public/brand/bo-nest-back.svg` (Laube aus gebogenen Halmen, Laterne an einem Halm, Rückseite der Schale), `src/web/public/brand/bo-nest-front.svg` (geflochtener Schalenrand vor Bo), `src/tracking/ui/kit/BoScene.tsx`. Formen und Farben aus `docs/design/moodboard/heute.html` (Block vor der ersten Sprechblase: die SVGs vor und nach `panda-still.svg`); die Maske „oben ausblenden“ wird ein Verlauf im SVG selbst.
- Modify: `src/design/tokens.css` (`--scene-nest-back`, `--scene-nest-front`, beide `/* shared */`), `src/tracking/ui/kit/Dojo.tsx` (`BoBubble`), `src/tracking/ui/kit/index.ts`, `src/tracking/ui/tracking.css`
- Test: `tests/web/bo-scene.test.tsx`

**Interfaces:**
- Produces:
  - `export type BoPlace = 'nest';` und `BoScene({ place, children }: { place: BoPlace; children: ReactNode })` → `<span className="tk-scene" data-place={place}>` mit drei Ebenen: `.tk-scene-back` (Hintergrund `var(--scene-nest-back)`), Lichtschein `--glow`, `children` (Bo), `.tk-scene-front` (`var(--scene-nest-front)`). Pro Ort genau eine CSS-Zeile je Ebene (`.tk-scene[data-place="nest"] .tk-scene-back { background-image: var(--scene-nest-back) }`). Kopfkommentar: „Dojo 5 fügt hier die übrigen Orte aus DESIGN.md (Bos Orte) hinzu: ein Name in `BoPlace`, zwei SVGs, zwei Tokens, zwei CSS-Zeilen.“
  - `BoBubble({ …, place }: { …; place?: BoPlace })`: mit `place` steht das Porträt in `BoScene`. `portrait="mini"` zeigt nur das Standbild `/brand/panda-still.svg` (kein Canvas, kein Player-Import).

- [ ] **Step 1: Write the failing test** `tests/web/bo-scene.test.tsx`:

```tsx
it('sets Bo into his nest, with the scene behind and the basket rim in front', () => {
  render(<BoBubble place="nest" pose="greet">Heute kommt das dritte Training.</BoBubble>);
  const scene = document.querySelector('.tk-scene[data-place="nest"]')!;
  const layers = [...scene.children].map((c) => c.className);
  expect(layers[0]).toContain('tk-scene-back');
  expect(layers.at(-1)).toContain('tk-scene-front');
  expect(scene.querySelector('.tk-panda')).toBeTruthy();
});
it('keeps the scene in one asset per layer, referenced only through tokens', () => {
  for (const f of ['bo-nest-back', 'bo-nest-front']) expect(readFileSync(`src/web/public/brand/${f}.svg`, 'utf8')).toContain('<svg');
  const tokens = readFileSync('src/design/tokens.css', 'utf8');
  expect(tokens).toMatch(/--scene-nest-back:\s*url\('\/brand\/bo-nest-back\.svg'\);\s*\/\* shared \*\//);
  expect(readFileSync('src/tracking/ui/tracking.css', 'utf8')).not.toContain('bo-nest');
});
it('draws a mini Bo as the still picture only', () => {
  render(<BoBubble portrait="mini">Alles gut.</BoBubble>);
  expect(document.querySelector('.tk-bo img')).toBeTruthy();
  expect(document.querySelector('canvas')).toBeNull();
});
```

- [ ] **Step 2: Run** `npx vitest run tests/web/bo-scene.test.tsx` — Expected: FAIL.
- [ ] **Step 3: Implement** SVGs, Tokens, `BoScene`, `BoBubble`. Die Szene ist `aria-hidden`; Größe wie im Moodboard (116 × 176 px Feld, Bo etwa 94 px breit).
- [ ] **Step 4: Run** den Test und `npx vitest run tests/web/heute-panda.test.tsx tests/tracking/panda-portrait.test.tsx` — Expected: PASS.
- [ ] **Step 5: Commit** `feat(design): Bo's bamboo nest as a reusable scene`.

### Task 3: Eine Wochenquelle, Wochenweg und Tages-Sheet

**Files:**
- Create: `src/tracking/ui/week-path.ts`, `src/tracking/ui/week-days.ts`, `src/tracking/ui/kit/WeekPath.tsx`, `src/tracking/ui/DaySheet.tsx`
- Modify: `src/tracking/ui/done-days.ts` (`DayRow.kinds`, `activitiesOn` aus `src/web/today/day-data.ts` hierher), `src/tracking/ui/plan-text.ts` (`planDayLabel` aus `TodayCard.tsx` hierher; `TodayCard.tsx` und `src/web/today/TomorrowTraining.tsx` importieren von dort), `src/tracking/ui/kit/index.ts`, `tracking.css`
- Delete: `src/web/today/day-data.ts` (Import in `YesterdayTraining.tsx` umbiegen); `tests/web/day-data.test.ts` → `tests/tracking/done-days.test.ts` übernehmen
- Test: `tests/tracking/week-path.test.ts`, `tests/tracking/day-sheet.test.tsx`

**Interfaces:**
- Produces (`done-days.ts`): `DayRow = { date; done: string[]; kinds: ActivityKind[]; plan: PlanDay | null; rest: boolean }`; `activitiesOn(merged, date)` unverändert.
- Produces (`week-path.ts`, rein):
  - `type PathState = 'done' | 'today' | 'planned' | 'rest'`; `type PathDay = { date: string; short: string /* 'Mo' */; state: PathState; done: boolean }`.
  - `weekPathOf(dates: string[], rows: DayRow[], today: string): PathDay[]`: vor heute `done` mit Erledigtem, sonst `rest`; heute immer `today` (`done` wahr, wenn heute etwas erledigt ist); danach `planned`, wenn der Plantag kein Ruhetag ist, sonst `rest`; fehlende Zeile = `rest`.
  - `weekCount(rows: DayRow[], planDays: PlanDay[] | null): { done: number; planned: number | null }` und `weekCountText(c): string | null` → `"2 von 5 geschafft"`, ohne Plan `"2 geschafft"`, ohne Plan und 0 → `null`.
  - `weekSentence(rows: DayRow[], today: string): string`: drei Teile. Erledigt: 0 → „Die Woche fängt gerade an.“, 1 → „Eine Einheit hast du schon geschafft.“, n → „{Zahlwort} Einheiten hast du schon geschafft.“ (Zahlwörter zwei bis sieben). Heute: offener Plan → „Heute ist {planDayLabel} dran.“, Ruhetag → „Heute ist Ruhetag.“, sonst nichts. Danach: Trainingstage nach heute 0 → nichts, 1 → „Danach kommt noch eine Einheit.“, n → „Danach kommen noch {Zahlwort} Einheiten.“
  - `restDaysText(rows: DayRow[], today: string): string | null`: Ruhetage nach heute; „Samstag ist ein Ruhetag.“, „Dienstag und Samstag sind Ruhetage.“, drei und mehr mit Kommas und „und“.
  - `weekRangeText(monday: string): string` → `"9. bis 15. November"`, über den Monat `"30. November bis 6. Dezember"`.
  - `SPORT_ICON: Record<Sport, IconName>` (`gym→kraft`, `bike→ausdauer`, `run→lauf`, `mobility→spross`, `rest→mond`) und `KIND_ICON: Record<ActivityKind, IconName>` (`kraft→kraft`, `rad→ausdauer`, `lauf→lauf`, `andere→spross`).
- Produces (`week-days.ts`): `useWeekDays(port: TrackingPort, nowMs: number): { today: string; monday: string; dates: string[]; rows: DayRow[]; current: ReturnType<typeof planOfWeek>; next: ReturnType<typeof planOfWeek>; runs: PlannedRun[]; spontaneous: boolean; loaded: boolean; frame: ReturnType<typeof useTodayAdvice> }`. Die Logik ist die heutige aus `CoachScreen` (Zeilen Montag bis heute im Modus Spontan oder ohne Plan, sonst ganze Woche; `mergedActivities(…, true)`).
- Produces (Kit): `WeekPath({ days, onPick }: { days: PathDay[]; onPick?: (date: string) => void })`: sieben Punkte auf einer Linie (DESIGN „Wochenweg“: erledigt Apricot mit Haken, heute Gold-Ring mit `--today-glow`, geplant Ring, Ruhetag kleiner Punkt), Linie bis zum letzten erledigten Tag in Apricot. Jeder Punkt ist ein Knopf mit `aria-label` „{Wochentag}, {Zustand}“ (z. B. „Mittwoch, erledigt“), 44 px Tippfläche; `ol` mit `aria-label="Wochenweg"`.
- Produces: `DaySheet({ port, date, now, onClose }: { port: TrackingPort; date: string; now: () => number; onClose: () => void })`: kleines Sheet, Titel „Mittwoch, 11. November“. Liest seine Records selbst. Vergangen und heute: was gemacht wurde (Text und Minuten, bei eigenem Krafttraining die Übungen gedämpft, „Beweglichkeit“), sonst „Das war ein Ruhetag.“ oder „Für diesen Tag sind noch keine Daten da.“. Heute und später: der Plantag (`planDayLabel`, `note`, bei `fixed` „Dieser Tag ist fest eingeplant.“, geplante Läufe mit `runText`), am ersten Krafttag ab heute Name und Übungen des Plans aus dem Record `plan/current`; ohne Plan „Für diesen Tag ist noch nichts geplant.“. Kein Startknopf.

- [ ] **Step 1: Write the failing tests.** `tests/tracking/week-path.test.ts` (Zeilen mit einer kleinen Fabrik `row(date, { done, plan })`):

```ts
it('walks the week: done before today, the ring today, plans after, small dots for rest', () => {
  const p = weekPathOf(WEEK, [row(MO, { done: ['Kraft'] }), row(DI, {}), row(MI, { done: ['Kraft'] }), row(DO, { plan: gym }), row(FR, { plan: bike }), row(SA, { plan: rest }), row(SO, { plan: run })], DO);
  expect(p.map((d) => d.state)).toEqual(['done', 'rest', 'done', 'today', 'planned', 'rest', 'planned']);
  expect(p[0]!.short).toBe('Mo');
});
it('a week without a plan is seven calm dots and no count', () => {
  const p = weekPathOf(WEEK, [row(MO, {}), row(DI, {})], DI);
  expect(p.map((d) => d.state)).toEqual(['rest', 'today', 'rest', 'rest', 'rest', 'rest', 'rest']);
  expect(weekCountText(weekCount([row(MO, {}), row(DI, {})], null))).toBeNull();
});
it('counts done days against the planned training days', () => {
  expect(weekCountText({ done: 2, planned: 5 })).toBe('2 von 5 geschafft');
  expect(weekCountText({ done: 2, planned: null })).toBe('2 geschafft');
});
it('says the week in whole sentences', () => {
  expect(weekSentence([row(MO, { done: ['Kraft'] }), row(MI, { done: ['Kraft'] }), row(DO, { plan: gym }), row(FR, { plan: bike }), row(SO, { plan: run })], DO))
    .toBe('Zwei Einheiten hast du schon geschafft. Heute ist Kraft, mittel dran. Danach kommen noch zwei Einheiten.');
  expect(restDaysText([row(DI, { plan: rest }), row(SA, { plan: rest })], MO)).toBe('Dienstag und Samstag sind Ruhetage.');
  expect(weekRangeText('2026-11-30')).toBe('30. November bis 6. Dezember');
});
```

(Der genaue Text von `planDayLabel(gym)` ergibt sich aus der heutigen Funktion; die Erwartung übernimmt ihn.)

`tests/tracking/day-sheet.test.tsx` mit `fakePort` (Szenarien aus `tests/web/heute-yesterday-tomorrow.test.tsx`, die dort mit Task 4 gelöscht werden):

```tsx
it('a past day lists what was done with minutes, and the exercises of an own strength workout muted', async () => { /* … */ });
it('a past day is a rest day only when the activities are known; unknown says there is no data', async () => { /* … */ });
it('a later day shows the plan without a start button, and a calm line without a plan', async () => {
  // …
  expect(within(sheet).queryByRole('button', { name: /starten|Zum Krafttraining/ })).toBeNull();
});
```

- [ ] **Step 2: Run** `npx vitest run tests/tracking/week-path.test.ts tests/tracking/day-sheet.test.tsx` — Expected: FAIL.
- [ ] **Step 3: Implement** die Dateien. `CoachScreen` nutzt ab jetzt `useWeekDays` (gleiche Anzeige, nur die Herkunft der Zeilen ändert sich).
- [ ] **Step 4: Run** die Tests und `npm test` — Expected: PASS.
- [ ] **Step 5: Commit** `feat(week): one week source, the week path and the day sheet`.

### Task 4: Heute

**Files:**
- Modify: `src/web/app/Heute.tsx`, `src/web/today/CoachLine.tsx`, `src/tracking/ui/TodayCard.tsx`, `src/tracking/ui/FinisherCard.tsx`, `src/web/MealsScreen.tsx` (`DayMeals` ohne `offset`, Zeilen als `RowCard`), `src/tracking/ui/WaitingProposal.tsx` → ersetzt durch `useOpenProposals` (siehe unten), `src/web/web.css` / `tracking.css` (alte Regeln `.tk-daypage`, `.tk-dayhead`, `.tk-dayarrow`, `.tk-bodyrows`, `.tk-waiting-card` löschen)
- Create: `src/tracking/ui/proposals.ts`
- Delete: `src/web/today/{DayHead.tsx,day-nav.ts,YesterdayTraining.tsx,TomorrowTraining.tsx,BodyCard.tsx}`, `src/tracking/ui/WaitingProposal.tsx`, `tests/web/day-nav.test.ts`, `tests/web/heute-yesterday-tomorrow.test.tsx`
- Test: `tests/web/heute-day.test.tsx` (umschreiben), `tests/web/heute-panda.test.tsx` (Gestern-Teil streichen), `tests/tracking/today-card.test.tsx` (an `MainCard` anpassen)

**Interfaces:**
- Consumes: `useWeekDays`, `weekPathOf`, `weekCount`, `weekCountText`, `SPORT_ICON`, `WeekPath`, `DaySheet` (Task 3); `BoBubble place="nest"`, `MainCard`, `RowCard`, `Icon` (Task 1–2).
- Produces (`proposals.ts`): `useOpenProposals(port: TrackingPort, nowMs: number): ChatEntry[]` (offene Vorschläge, Wochenplan zuerst; Logik aus `WaitingProposal.tsx` und der Sortierung in `CoachChat`).
- Produces: `CoachLine({ text, onAsk, pose, onProposal })`: `BoBubble place="nest"`; Aktionen: mit `onProposal` Hauptknopf „Vorschlag ansehen“, dazu immer `BO.ask` als `secondary` mit `Icon name="sprechen"`. Regionsname bleibt „Satz von Bo“; die Zeile `Bo · Sensei` entfällt (Bo steht im Bild).
- `TodayCard` rendert `MainCard` mit `kicker="Jetzt dran"`, `label` „Heute“ bzw. „Heute laut Wochenplan“ wie bisher. Statt `gym: ReactNode` bekommt es `gym?: { name: string | null; line: string | null; notes?: ReactNode; start: () => void; view?: () => void }` (`line` = „Krafttraining, etwa 45 Minuten, 6 Übungen“ aus `gymMinutes` und der Übungszahl; `notes` = „Angepasst“, „Der Plan ist schon etwas älter …“, offene Fragen) und `extra?: ReactNode` (Beweglichkeitsangebot) für `more`. Titel: Krafttag → Name des Trainings, sonst `planDayLabel` bzw. der Satz des Vorschlags; Hauptknopf „Training starten“ / „Zum Laufen“; Radtag: Nebenknopf „Ansehen“, Text „Gestartet wird am Mac.“; Ruhetag ohne Hauptknopf. „Etwas anderes heute?“ bleibt als `secondary` in `more`. Erledigt: Kicker „Heute erledigt“, Titel „Gut gemacht“, Text „Du hast heute schon trainiert.“.
- `Finisher` rendert `MainCard` mit `kicker="Zum Abschluss"`, Titel „Locker ausklingen“ (mit Cardio) oder „Dehnen“, Text wie bisher, `more` = Beweglichkeitszeile oder „Dehn ein paar Minuten, was sich fest anfühlt.“.

Reihenfolge auf Heute (fest): Datumszeile (`<h1 className="tk-sr">Heute</h1>` nur für Screenreader; `.tk-sr` im Kit-Block anlegen, falls es keine solche Klasse gibt) → Kopf mit `Kicker` „Dein Weg diese Woche“ und `weekCountText` rechts → `WeekPath` (Tipp öffnet `DaySheet`) → `CoachLine` → **eine** „Jetzt dran“-Karte nach Entscheidung 5 (offenes Training: `MainCard` kicker „Läuft noch“, Titel = Trainingstitel, Text „Seit {sinceText}“, Hauptknopf „Weitermachen“; ohne Plan: kicker „Jetzt dran“, Titel „Dein Plan“, Text „Krafttraining, Laufen und Essen schaltest du im Profil ein. Die Woche planst du dann mit Bo.“, Hauptknopf „Woche planen“, Nebenknopf „Im Profil auswählen“) → `DayMeals` (nur mit Essensplan) → `RowCard` „Morgen“ (Kicker „Morgen“, Titel `planDayLabel`, Icon `SPORT_ICON`, öffnet `DaySheet`; ohne Plan für morgen keine Karte) → bis Task 7: `TogetherCard` als letztes.

- [ ] **Step 1: Write the failing tests** in `tests/web/heute-day.test.tsx` (vorhandenes `boot`; die Tests zu Pfeilen, Wischen, neuem Kalendertag und „Dein Körper“ löschen):

```tsx
it('shows the week path, Bo in his nest, one Jetzt dran card, then only meals and tomorrow', async () => {
  await boot([daytext, weekplanWithGymToday, planRecord]);
  const path = await screen.findByRole('list', { name: 'Wochenweg' });
  const bo = screen.getByLabelText('Satz von Bo');
  const now = screen.getByRole('region', { name: /^Heute/ });
  expect(before(path, bo) && before(bo, now)).toBe(true);
  expect(bo.querySelector('.tk-scene[data-place="nest"]')).toBeTruthy();
  expect(screen.getAllByText('Jetzt dran')).toHaveLength(1);
  expect(screen.queryByRole('region', { name: 'Dein Körper' })).toBeNull();
  expect(screen.queryByRole('button', { name: 'Tag vor' })).toBeNull();
});
it('a dot of the week path opens that day', async () => {
  await boot([weekplanWithGymToday, yesterdayActivities]);
  fireEvent.click(await screen.findByRole('button', { name: /^Dienstag/ }));
  expect(await screen.findByRole('dialog', { name: /^Dienstag/ })).toBeTruthy();
});
it('tomorrow is one row card that opens the day sheet', async () => { /* RowCard „Morgen“ → dialog */ });
it('an open workout takes the Jetzt dran place with Weitermachen', async () => { /* kein „Training starten“ daneben */ });
it('a waiting proposal turns Bo’s bubble into Vorschlag ansehen, which opens the chat', async () => {
  await boot([riderMsg, coachMsgWithProposal]);
  fireEvent.click(await screen.findByRole('button', { name: 'Vorschlag ansehen' }));
  expect(await screen.findByRole('dialog', { name: 'Bo, dein Sensei' })).toBeTruthy();
});
```

Die bestehenden Tests „Frag Bo, deinen Sensei opens the real coach composer“, „a daytext of yesterday shows a saying“ und „Zum Abschluss“ bleiben (Selektoren an `MainCard` anpassen, Regionsname „Zum Abschluss“ bleibt).

- [ ] **Step 2: Run** `npx vitest run tests/web/heute-day.test.tsx` — Expected: FAIL.
- [ ] **Step 3: Implement** `proposals.ts`, `TodayCard`, `Finisher`, `CoachLine`, `DayMeals`, `Heute`. Pose wie bisher über `dayClip({ …, offset: 0 })`.
- [ ] **Step 4: Run** `npx vitest run tests/web tests/tracking/today-card.test.tsx` und dann `npm test` — Expected: PASS.
- [ ] **Step 5: Commit** `feat(heute): week path, Bo in his nest, one Jetzt dran card`.

### Task 5: Gesundheit als Karte und eigene Seite

**Files:**
- Create: `src/tracking/ui/HealthPage.tsx` (enthält `HealthCard`, `HealthPage`, das bisherige `Spark` und `SourcesSheet`)
- Modify: `src/tracking/ui/health-view.ts`, `src/tracking/ui/StatsScreen.tsx` (Gesundheitszeile und `HealthSheet`-Import raus), `src/tracking/ui/CoachScreen.tsx` (Karte unter dem Plan, Unterseite)
- Delete: `src/tracking/ui/HealthSheet.tsx`, `healthWord` in `health-view.ts`
- Test: `tests/tracking/health-screen.test.tsx` → umschreiben als `tests/tracking/health-page.test.tsx`

**Interfaces:**
- Produces (`health-view.ts`): `HealthRow` bekommt `short: string` („Ruhepuls“, „Fitness“, „Bewegung“, „Schlaf“), `icon: IconName` (`herz`, `spross`, `lauf`, `mond`) und `tone: 'calm' | 'note'` (`note` bei „beachten“ und „Hinweis“). `SLEEP_HINT = 'Für Schlaf und HRV gibt es keine Daten, zum Beispiel weil die Uhr nachts nicht getragen wird. Das ist in Ordnung: Pandafit liest deine Erholung aus Ruhepuls und Training.'`
- Produces: `HealthCard({ health, onOpen }: { health: HealthBody; onOpen: () => void })`: `Card` mit `Kicker` „Gesundheit“; erster Satz = Arzt-Hinweis als `.tk-note` (falls da), sonst `firstLine(health)`; bis zu drei `WordTile` für `rhr`, `vo2`, `move` (nur vorhandene); `secondary` „Gesundheit ansehen“ mit `›`.
- Produces: `HealthPage({ health, onBack }: { health: HealthBody; onBack: () => void })`: `PageHead title="Gesundheit" back={{ label: 'Woche', onClick: onBack }}`; Kopfkarte mit `Kicker` (`standLine` ohne „Stand: “ wird „Diese Woche, Stand Montag, 3. November“; ohne Zeit nur „Diese Woche“) und `firstLine` (bei Arzt-Hinweis entfällt der ruhige Satz wie bisher); je Bereich eine Karte (Icon-Kachel, Kicker `title`, Wort, Satz, Knopf „Verlauf“ → kleines Sheet mit `facts` und `Spark`s); Ruhepuls-Karte zeigt den Arzt-Hinweis oben als `.tk-note`; Schlaf: mit Daten die Karte wie die anderen (Wort „Verlauf“, ohne Bewertung), ohne Daten eine ruhige Karte mit `SLEEP_HINT`; Schlusskarte „Gut zu wissen“: „Diese Seite ist Orientierung und keine Diagnose. Liegt dein Ruhepuls länger deutlich über deinem üblichen Wert, sagt Pandafit es dir hier und rät dir, das ärztlich abklären zu lassen.“ und `secondary` „Quellen ansehen“ → `SourcesSheet`.
- `CoachScreen`: `const [page, setPage] = useState<'week' | 'health'>('week')`; bei `'health'` rendert es nur `HealthPage`. Die Karte steht vorerst direkt unter der Wochenkarte (Task 7 setzt sie an ihren endgültigen Platz).

- [ ] **Step 1: Write the failing tests** in `tests/tracking/health-page.test.tsx` (Fabriken aus dem alten Test übernehmen; `CoachScreen` mit `fakePort` rendern):

```tsx
it('Woche shows a health card with one sentence and the areas as words, no digits', async () => {
  await showWeek([healthRec(body())]);
  const card = await screen.findByRole('region', { name: 'Gesundheit' });
  expect(card.textContent).toContain('Ruhepuls');
  expect(card.textContent).not.toMatch(/\d/);
  expect(card.querySelectorAll('.tk-wordtile')).toHaveLength(3);
});
it('a doctor finding leads the card and the page, never hidden behind the calm sentence', async () => {
  await showWeek([healthRec(body({ findings: [arzt] }))]);
  const card = await screen.findByRole('region', { name: 'Gesundheit' });
  expect(card.querySelector('.tk-note')!.textContent).toContain('ärztlich abklären');
  fireEvent.click(within(card).getByRole('button', { name: /Gesundheit ansehen/ }));
  const page = await screen.findByRole('heading', { level: 1, name: 'Gesundheit' });
  expect(page).toBeTruthy();
  expect(document.querySelector('.tk-note')!.textContent).toContain('ärztlich abklären');
  expect(document.body.textContent).not.toMatch(/ruhige Woche/);
});
it('only present areas get tiles; without sleep data the page shows the calm hint', async () => {
  await showWeek([healthRec(body({ weeks: weeks.map(({ vo2: _v, steps: _s, activeMin: _a, sleepH: _h, hrv: _r, ...w }) => w) }))]);
  expect((await screen.findByRole('region', { name: 'Gesundheit' })).querySelectorAll('.tk-wordtile')).toHaveLength(1);
  fireEvent.click(screen.getByRole('button', { name: /Gesundheit ansehen/ }));
  expect(await screen.findByText(SLEEP_HINT)).toBeTruthy();
});
it('without a health record there is no card at all, and Rückblick has no health row', async () => { /* … */ });
it('Verlauf opens the lines of one area; Quellen and Zurück work as before; Woche brings the week back', async () => { /* Spark-img, „‹ Zurück“ im Quellen-Sheet, Knopf „Woche“ */ });
it('rows exist only with data, and Body Battery and stress appear nowhere', () => { /* aus dem alten Test übernehmen */ });
```

- [ ] **Step 2: Run** `npx vitest run tests/tracking/health-page.test.tsx` — Expected: FAIL.
- [ ] **Step 3: Implement** und `tests/tracking/health-screen.test.tsx` löschen; in `tests/tracking/stats-screen.test.tsx` nichts zur Gesundheit erwarten.
- [ ] **Step 4: Run** `npx vitest run tests/tracking` — Expected: PASS.
- [ ] **Step 5: Commit** `feat(health): health card on Woche and its own page`.

### Task 6: Sensei, ein ruhiger Chat

**Files:**
- Create: `src/tracking/ui/ProposalCard.tsx`
- Modify: `src/tracking/ui/CoachChat.tsx`, `src/tracking/ui/ChatBubble.tsx`, `src/tracking/ui/proposals.ts`, `src/tracking/ui/NextChangeCard.tsx` (Etikett „Im Training berücksichtigt“ über `Tag`), `src/tracking/ui/bo.ts`, `tracking.css` (alte `.tk-msg*`, `.tk-pin*`, `.tk-notes` löschen, sobald unbenutzt)
- Test: `tests/tracking/open-chat.ts`, `tests/tracking/coach-screen.test.tsx` (Chat-Teile), `tests/tracking/week-take.test.tsx`, `tests/personal/chat-proposals.test.tsx`, `tests/weeks/chat-dates-tasks.test.tsx`, `tests/tracking/next-changes.test.tsx`

**Interfaces:**
- Consumes: `useOpenProposals` (Task 4), `Bubble`, `BoBubble portrait="mini"`, `Tag`, `RowCard`, `Sheet page` (Task 1–2).
- Produces (`proposals.ts`): `useProposalActions(port: TrackingPort, now: () => number, newId: () => string): { take: (m: WeekEntry) => Promise<void>; undo: (m: WeekEntry) => Promise<void>; decline: (m: ChatEntry) => void; error: string | null }` (Code aus `CoachChat` verschoben, gleiche Records, gleiche Fehlertexte); `export type WeekEntry = ChatEntry & { proposal: WeekProposal }`.
- Produces (`ProposalCard.tsx`): `ProposalCard({ port, now, newId, m }: { …; m: ChatEntry })`: liest seine Records selbst; Wochenplan = `role="group"`, `aria-label` „Vorschlag Wochenplan ab {Datum}“ wie bisher, Satz, `Week brief`, Warnung, `primary` „Übernehmen“, `secondary` „Nein danke“; Übungstausch/Regel = `NextChangeCard`/`RuleCard` ohne `history`. `ProposalsSheet({ port, now, newId, entries, onClose }: { …; entries: ChatEntry[]; onClose: () => void })`: kleines Sheet „Vorschlag“/„Vorschläge“ mit einer `ProposalCard` je Eintrag; schließt sich, wenn `entries` leer wird.
- Produces (`bo.ts`): `BO_LINES = { weekCalm: 'Wenn du an der Woche etwas ändern willst, sag es mir einfach.', weekEmpty: 'Für diese Woche steht noch kein Plan. Sollen wir zusammen einen machen?', proposal: 'Ich habe einen Vorschlag für dich. Schau ihn dir in Ruhe an.', thinking: 'Ich denke gerade über deine Nachricht nach.', subtitle: 'Dein Sensei kennt deinen Plan.', suggestions: ['Schlag mir eine Woche vor', 'Mir tut etwas weh', 'Diese Woche habe ich weniger Zeit'] } as const`.
- `ChatBubble({ m, children })`: Bo → `BoBubble portrait="mini"`, du → `Bubble tail="right"`; `foot` = Uhrzeit (`timeLabel`). `ChatNote` = Bo-Blase mit drei Punkten (`.tk-typing`, `aria-hidden`) und dem Text, `role="status"` bleibt. `WorkoutCoach` nutzt dieselbe Blase und ändert sich mit.

Aufbau von `CoachChat` (oben nach unten): `Sheet page display title={BO.title}` mit `lead` = Mini-Bo und Untertitel `BO_LINES.subtitle` → `RowCard` (icon `aenderung`, kicker „Zuletzt geändert“, Titel neueste Notiz mit Grund) öffnet ein kleines Sheet „Zuletzt geändert“ mit den fünf neuesten → `link` „Frühere Nachrichten zeigen“ → Tagestrenner als Pille → Blasen; der erste offene Vorschlag (`useOpenProposals(...)[0]`) rendert in seiner Blase `ProposalCard` statt `ProposalLine`; beantwortete bleiben eine Zeile mit Rückgängig wie bisher → unten: Streifen „Bo hat noch einen weiteren Vorschlag.“ / „Bo hat noch {n} weitere Vorschläge.“ (öffnet `ProposalsSheet` mit den übrigen), Chips aus `BO_LINES.suggestions` (nur bei leerem Feld; Tipp schreibt den Satz ins Feld), Eingabe mit Platzhalter „Schreib Bo, was ansteht“ und rundem Sendeknopf (`Icon name="senden"`, `aria-label="Senden"`). Der leere Verlauf zeigt keinen Beispielsatz mehr (die Chips ersetzen ihn).

- [ ] **Step 1: Write the failing tests.** `tests/tracking/open-chat.ts`: `openProposals()` wird zu `proposalIn(chat: HTMLElement)` (sucht die Gruppe in der Blase) und `openMoreProposals()` (Streifen `/^Bo hat noch/` → Dialog `/^Vorschl(ag|äge)$/`). In `tests/tracking/coach-screen.test.tsx`:

```tsx
it('the open week plan stands in Bo’s bubble with Übernehmen and Nein danke; taking it writes the plan once', async () => {
  const { port, map } = fakePort([riderMsg, coachMsg]);
  render(<CoachScreen port={port} {...env} />);
  const chat = await openChat();
  const group = within(chat).getByRole('group', { name: /^Vorschlag Wochenplan/ });
  expect(group.closest('.tk-bubble')).toBeTruthy();
  fireEvent.click(within(group).getByRole('button', { name: 'Übernehmen' }));
  await waitFor(() => expect(records(map, 'weekplan')).toHaveLength(1));
  expect(records(map, 'chat').filter((r) => (r.body as { takes?: string }).takes === 'c1')).toHaveLength(1);
  expect(await within(chat).findByText(/^Du hast den Wochenplan ab .* übernommen\./)).toBeTruthy();
});
it('more open proposals wait behind one strip; exactly one stands in a bubble', async () => {
  const { port } = fakePort([riderMsg, coachMsg, ruleMsg, proposedRule]);
  render(<CoachScreen port={port} {...env} />);
  const chat = await openChat();
  expect(within(chat).getAllByRole('button', { name: 'Übernehmen' })).toHaveLength(1);
  fireEvent.click(within(chat).getByRole('button', { name: /^Bo hat noch einen weiteren Vorschlag/ }));
  expect(await screen.findByRole('dialog', { name: 'Vorschlag' })).toBeTruthy();
});
it('Bo speaks left with his still picture, you speak right, each with the time', async () => { /* .tk-bubble.right, img, timeLabel */ });
it('a chip writes its sentence into the field', async () => { /* Tipp „Mir tut etwas weh“ → textarea.value */ });
it('Zuletzt geändert is a card on top that opens the list', async () => { /* RowCard → dialog „Zuletzt geändert“ */ });
```

Die bestehenden Tests (senden, „Gesendet. Bo antwortet …“, alter Vorschlag „Diese Woche ist vorbei.“, Ablehnen, Escape) bleiben; „Schließen“ wird „Zurück“, „Ältere anzeigen“ wird „Frühere Nachrichten zeigen“, `openProposals()` wird `proposalIn(chat)`. Den Test „Escape in the proposal sheet …“ über `openMoreProposals()` mit zwei offenen Vorschlägen führen.

- [ ] **Step 2: Run** `npx vitest run tests/tracking/coach-screen.test.tsx` — Expected: FAIL.
- [ ] **Step 3: Implement.** `PinnedWeek` geht in `ProposalCard` auf, `ProposalLine` bleibt in `CoachChat`.
- [ ] **Step 4: Run** `npx vitest run tests/tracking tests/personal tests/weeks tests/web` — Expected: PASS.
- [ ] **Step 5: Commit** `feat(sensei): a calm chat with bubbles and the proposal in Bo's bubble`.

### Task 7: Woche

**Files:**
- Modify: `src/tracking/ui/CoachScreen.tsx`, `src/tracking/ui/GoalRules.tsx` (`goalSentence`), `src/tracking/ui/StatsScreen.tsx` (`LookBack` ohne eigenes `<h2>`, als Sheet-Inhalt), `src/web/app/Shell.tsx` (`showPrefs` raus), `src/web/app/Heute.tsx` (Gemeinsam raus), `tracking.css` (alte `.tk-coach .tk-week`-Regeln löschen, sobald unbenutzt)
- Move: `src/web/TogetherScreen.tsx` → `src/tracking/ui/TogetherScreen.tsx` (`git mv`, Importe anpassen)
- Test: `tests/tracking/coach-screen.test.tsx` (Wochen-Teile), `tests/web/app/review.test.tsx`, `tests/web/together.test.tsx`, `tests/tracking/stats-screen.test.tsx`

**Interfaces:**
- Consumes: `useWeekDays`, `weekPathOf`, `weekCount(Text)`, `weekSentence`, `restDaysText`, `weekRangeText`, `SPORT_ICON`, `KIND_ICON`, `WeekPath`, `DaySheet` (Task 3); `HealthCard`, `HealthPage` (Task 5); `useOpenProposals`, `ProposalsSheet`, `BO_LINES` (Task 4, 6); `RowCard`, `Card`, `Kicker`, `BoBubble`, `PageHead` (Task 1).
- Produces: `goalSentence(goal: { strength: Strength; focus: readonly string[] }): string` neben `goalSummary`: `{ muscle: 'Du baust Muskeln auf', strength: 'Du wirst stärker', fitness: 'Du bleibst fit' }` plus bei Fokus „, vor allem {Gruppen aus `focusLabel`, die letzte mit „und“ verbunden}“ und Punkt, z. B. „Du baust Muskeln auf, vor allem Rücken und Schultern.“
- `CoachScreen({ port, now, newId, openChat })` (ohne `showPrefs`). Seite von oben nach unten:
  1. `PageHead title="Deine Woche"`.
  2. Wochenkarte (`Card`, Region „Diese Woche“): `Kicker` `weekRangeText(monday)` mit `weekCountText` rechts, `WeekPath` (Tipp → `DaySheet`), `weekSentence`; im Modus Spontan statt dessen `Heute: {frame.advice.line}` als Satz; ohne Plan und nicht spontan „Für diese Woche gibt es noch keinen Plan.“. Darunter, durch eine Linie getrennt: `Icon ziel`, „**Dein Ziel:** {goalSentence}“ (nicht gewählt: dahinter gedämpft „Das ist ein Vorschlag.“) und runder Knopf `Icon stift` mit `aria-label="Ziel und Planung"` → `GoalSheet`.
  3. Tageskarte (`Card`, Region „Tage“): Abschnitte „Erledigt“ (vergangene Tage mit Erledigtem: `RowCard flat lead="Mo" icon={KIND_ICON} end="done"`), „Heute“ (`RowCard flat highlight`), „Kommt noch“ mit `restDaysText` rechts (Plantage nach heute ohne Ruhetage; ohne Plan die geplanten Läufe mit `runText`). Jede Zeile öffnet `DaySheet`. Ruhetage vor heute stehen nur im Wochenweg. Gibt es `next` und nicht Spontan: `RowCard flat icon="woche" title="Nächste Woche"` → kleines Sheet mit `Week rows={planRows(next.days)}`.
  4. `HealthCard` (nur mit Health-Record) → Unterseite `HealthPage`.
  5. Bo: `BoBubble portrait="mini"`; Text nach Lage: wartet eine Antwort → `BO_LINES.thinking`; offener Vorschlag → `BO_LINES.proposal` mit `primary` „Vorschlag ansehen“ (`ProposalsSheet` mit allen offenen); kein Plan und nicht Spontan → `BO_LINES.weekEmpty` mit `primary` „Woche planen“ (öffnet den Chat); sonst `BO_LINES.weekCalm`. Immer `secondary` `BO.ask` → Chat.
  6. Ruhige Kacheln (zwei bis drei `RowCard` ohne Kicker in einer Zeile, CSS-Raster): „Rückblick“ (`Icon rueckblick`) → `Sheet title="Rückblick"` mit `LookBack`; „Was Bo beachtet“ (`Icon regeln`) → `RulesSheet`; „Gemeinsam“ (nur mit Together-Record, `Icon ausdauer`) → Unterseite `TogetherPage`.
- `Heute` zeigt kein `TogetherCard` mehr.

- [ ] **Step 1: Write the failing tests** in `tests/tracking/coach-screen.test.tsx` (Tests zu „Coach row previews“, „waiting proposal gets a card“, „Was Bo beachtet … nichts“ und „coach writes by itself“ löschen; den letzten als Render-Test von `CoachPrefs` in `tests/tracking/coach-prefs.test.tsx` erhalten):

```tsx
it('Woche shows the week card, the days as Erledigt, Heute, Kommt noch, and the goal in one sentence', async () => {
  const { port } = fakePort([takenPlan, doneMonday]);
  render(<CoachScreen port={port} {...env} />);
  const week = await screen.findByRole('region', { name: 'Diese Woche' });
  expect(within(week).getByRole('list', { name: 'Wochenweg' })).toBeTruthy();
  expect(week.textContent).toContain('Dein Ziel:');
  const days = screen.getByRole('region', { name: 'Tage' });
  for (const t of ['Erledigt', 'Heute', 'Kommt noch']) expect(days.textContent).toContain(t);
  expect(days.textContent).not.toMatch(/fest eingeplant|Puls bis/); // Details erst im Tages-Sheet
});
it('a day row opens the day sheet with the details', async () => { /* „Dieser Tag ist fest eingeplant.“ nur im Dialog */ });
it('the pencil opens Ziel und Planung', async () => { /* aria-label → dialog */ });
it('a waiting proposal: Bo says so and Vorschlag ansehen opens the proposals sheet with Übernehmen', async () => {
  const { port } = fakePort([riderMsg, coachMsg]);
  render(<CoachScreen port={port} {...env} />);
  fireEvent.click(await screen.findByRole('button', { name: 'Vorschlag ansehen' }));
  const sheet = await screen.findByRole('dialog', { name: 'Vorschlag' });
  expect(within(sheet).getByRole('button', { name: 'Übernehmen' })).toBeTruthy();
});
it('without a plan: seven calm dots, no count, and Bo offers Woche planen', async () => {
  const { port } = fakePort();
  render(<CoachScreen port={port} {...env} />);
  fireEvent.click(await screen.findByRole('button', { name: 'Woche planen' }));
  expect(await screen.findByRole('dialog', { name: 'Bo, dein Sensei' })).toBeTruthy();
  expect(screen.queryByText(/von \d+ geschafft/)).toBeNull();
});
it('Rückblick and Was Bo beachtet are quiet tiles that open their sheets', async () => { /* … */ });
```

`tests/tracking/open-chat.ts`: `openChat()` klickt `BO.ask` („Frag Bo, deinen Sensei“). `tests/web/app/review.test.tsx`: Rückblick über die Kachel öffnen, Rest gleich. `tests/web/together.test.tsx`: Gemeinsam liegt auf der Woche, „Zurück“ führt zur Woche.

- [ ] **Step 2: Run** `npx vitest run tests/tracking/coach-screen.test.tsx` — Expected: FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run** `npm run typecheck` und `npm test` — Expected: PASS.
- [ ] **Step 5: Commit** `feat(woche): Erledigt, Heute, Kommt noch, goal sentence, Bo and quiet tiles`.

### Task 8: Abschluss

- [ ] **Step 1:** `npm run typecheck`, `rtk proxy npm run lint` (0 Fehler), `npm test` — Expected: alles grün. `grep -rn "font-weight: *600\|HealthSheet\|WaitingProposal\|DayHead\|day-nav" src tests` — Expected: keine Treffer.
- [ ] **Step 2:** `npm run dev:sim`, Web-App bei 390 px und 1200 px, dunkel und hell (Profil „Hell“ und „Dunkel“), mit `docs/design/moodboard/{heute,woche,sensei,gesundheit}.html` vergleichen: Nest mit Lichtschein, Wochenweg-Zustände und Heute-Glühen, Blase „du“, Kacheln, Gesundheit, Chat-Eingabe über der Tastatur. Lesbarkeit im hellen Schema ist der Review-Focus 2; ein unlesbares Nest bekommt hier eine helle Variante (zweiter Token-Wert, zwei SVGs). Abweichungen, die die Abnahme nicht betreffen, in den Parkplatz.
- [ ] **Step 3:** Roadmap: Zeile Dojo 2 auf ✅; im Parkplatz die Dojo-1-Punkte zu `font-weight` und Hauptknöpfen (für Heute/Woche) als erledigt markieren; neu in den Parkplatz: „Gesundheit und Gemeinsam sind Unterseiten ohne Browser-Zurück“. Plan nach `docs/archive/plans/` verschieben (`git mv`), Verweis im Abschnitt „Dojo — Briefs“ ergänzen.
- [ ] **Step 4: Commit** `docs: Dojo 2 done`.
