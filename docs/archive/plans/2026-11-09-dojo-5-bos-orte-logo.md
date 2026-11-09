# Dojo 5 Bos Orte und Logo Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Bo steht auf Heute zu jeder Pose aus `dayClip` an seinem eigenen Ort (Dojo, Hügel, Wald, Matte, Bücher, Kissen, sonst das Nest), auch bei reduzierter Bewegung als Standbild, und die App trägt überall das neue Logo „Bo als Teetrinker“ (Dock, Handy, Favicon).

**Architecture:** Erst entstehen die Logo-Entwürfe im Moodboard, damit der Nutzer früh wählen kann (Abnahme-Gate: der Controller fragt den Nutzer, kein Subagent; Tasks 2–7 laufen solange weiter, Task 8 und danach Task 9 warten). Dann bekommt Bo Standbilder pro Pose: ein reines Modul rechnet aus denselben Bewegungsdaten wie die Canvas (`panda-motion.ts`) die gehaltene Pose als SVG, ein Skript schreibt sie nach `brand/bo-pose-{pose}.svg`, ein Test hält Datei und Daten gleich. `PandaPortrait` zeigt dieses Standbild bei reduzierter Bewegung und nach einem Ladefehler und meldet die Pose, die Bo nimmt (`onTake`). Das Kit lernt die Orte: `BoPlace` wächst, `PLACE_POSES` bekommt pro Ort eine eigene Pose, `placeOf(pose)` nennt den Ort einer Pose, und `BoBubble place="own"` stellt Bo dorthin, wo die Pose hingehört, festgelegt im selben Moment wie die Pose. Die Szenen sind flache SVGs wie das Nest (`brand/bo-{ort}.svg`, `back`/`front`, nur `--scene-*`-Tokens). Heute schaltet auf `place="own"`. Zum Schluss wird aus dem gewählten Entwurf das Logo in allen Formaten gebaut.

**Tech Stack:** React 19, Vite, vitest mit @testing-library/react (ohne jest-dom: nur einfache Assertions wie `toBeTruthy()`, `textContent`, `toBe`), CSS-Tokens, SVG, `tsx` für Skripte, Electron (`scripts/icon/render.cjs`) und macOS `sips`/`qlmanage`/`iconutil` für die Icon-PNGs.

**Spec:** `docs/design/DESIGN.md` (bindend: „Bo, dein Sensai“ mit Tabelle „Bos Orte“, `PLACE_POSES`-Regel, `ACTIVITY_SPANS`-Regel, „Logo“, „Im Code: eine Stelle pro Sache“), Brief „Dojo 5 Bos Orte und Logo“ in `docs/roadmap.md` (Abschnitt „Dojo — Briefs“ und Tabellenzeile). Bilder: `docs/design/moodboard/bos-orte.html` (die neun Szenen), `heute.html` (Bo auf Heute), `sensai.html` (Bo im Chat), Posen `docs/design/moodboard/poses/*.png`, Logo-Entwürfe `docs/design/moodboard/logo.html` (Task 1).

## Global Constraints

- **Texte:** natürliche deutsche ganze Sätze, keine abgehackten Fragmente mit Gedankenstrich (`docs/language.md`). Bo heißt „Sensai“, nie „Coach“ und nie „Sensei“ (`tests/web/sensai-wording.test.ts` bleibt grün). Bo ist warm und unterstützt. Dieser Meilenstein ändert keine Bo-Texte.
- **Leicht bleiben:** keine Gamification, keine Zahlenflut. Orte sind Bilder, keine Belohnung: kein Freischalten, keine Sammlung.
- **Flach und gezeichnet wie das Nest:** keine 3D-Welt (verworfen), keine Verläufe mit Tiefe außer dem warmen Lichtschein. Keine neuen Posen-Animationen; alle Bewegung kommt aus den zehn vorhandenen Clips in `panda-motion.ts`.
- **Eine Stelle pro Sache:** Farben der App nur als Token in `src/design/tokens.css` (dunkel auf `:root`, hell nur unter `@media (prefers-color-scheme: light)`, sonst `/* shared */`). Keine Farb-Literale in CSS oder TSX (`tests/web/style-tokens.test.ts`). Szenen-SVGs `brand/bo-{ort}.svg` färben **nur** über `var(--scene-*)` und vorhandene Tokens (wie `bo-nest.svg`, `tests/web/bo-scene.test.tsx`). Eigene Farben behalten nur Bilder, die in beiden Schemata gleich aussehen: Bos Standbilder `brand/bo-pose-*.svg` (Farben aus `panda-motion.ts`, wie `panda-still.svg`), das Logo und die Icons. Jede Regel oben in `src/tracking/ui/tracking.css` beginnt mit `.tk-`. Bausteine nur in `src/tracking/ui/kit/`.
- **Bo bewegt nur auf Heute und im Chat.** Alle übrigen Bo-Blasen bleiben das kleine Standbild ohne Ort (`portrait="mini"`).
- **Daten bleiben sicher:** Kein Task schreibt Records oder ändert, wie sie geschrieben werden. Nicht anfassen: `src/shared/**`, `src/service/**`, `src/coach/**`, `src/tracking/{session,store,registry,plan-draft,workout-change,studios}.ts`. `src/main/**` und `src/ui/**` bleiben unverändert (das Mac-Icon kommt nur über `resources/`). `npm run app` (Installation nach `/Applications`) startet nur der Nutzer, nie während einer offenen Fahrt.
- **Öffentliches Repo:** keine persönlichen Daten in Code, Bildern oder Fixtures (Namen wie „anna“ wie in den bestehenden Tests).
- **Tests nach Zweck** (`docs/roadmap.md`, Arbeitsweise 6): neue Tests nur für Abnahmesätze und Review-Focus-Fälle. Der Test „in the nest Bo sits: a bike day keeps the greeting …“ in `tests/web/heute-panda.test.tsx` wird ersetzt (Task 6).
- **Skripte:** `scripts/web-smoke.ts` und `scripts/web-shots.ts` klicken keine Bo-Szene; ändert ein Task ein Label, das sie nutzen, passt er sie im selben Commit an.
- Befehle: `npm run typecheck`, `rtk proxy npm run lint` (0 Fehler, höchstens 52 Warnungen), `npm test`, `npm run test:web-smoke`. Einzeltest: `npx vitest run <datei>`.

## Entscheidungen

Zur Abnahme durch den Nutzer:

1. **Sechs neue Orte für die Posen aus `dayClip`**, Namen auf Deutsch wie die Icons: `dojo` (flex: Dojo, kleine Hantel, Arnold-Comicporträt), `huegel` (bike: Hügel, Bambus, Mond), `wald` (run: Weg quer durch den Bambuswald), `matte` (yoga: Matte, Räucherstäbchen, Mond), `buecher` (read: Laterne, Bücherstapel), `kissen` (knit: dickes Sitzkissen, Wollregal). `greet` bleibt im `nest`.
2. **Zuhören und Durchatmen bekommen jetzt noch keinen Ort.** Keine Fläche zeigt Bo dabei groß: Der Chat hat oben nur einen kleinen Kopf (3,4 rem, Pose `listen`), Durchatmen spielt nirgends. Beide Szenen bleiben im Moodboard und gehen in den Parkplatz. Nicken braucht keinen Ort (Moodboard).
3. **Der Ort folgt der Pose** (`BoBubble place="own"`) und wird im selben Moment festgelegt wie die Pose: wenn Bo in seine Pose gleitet, bei reduzierter Bewegung kurz nach dem Öffnen (`SETTLE_MS`). Kommen die Daten später, wechselt weder Pose noch Ort bis zum nächsten Öffnen (Ruhe-Regel aus `PandaPortrait`). Gibt es beim Festlegen keine Pose, nimmt Bo nichts, und `own` bleibt beim Nest (greet), auch wenn später eine Pose kommt.
4. **Welche Posen wohin passen** (`PLACE_POSES`, die erste ist die eigene Pose des Orts und der Ersatz, wenn eine Pose nicht passt): `nest` greet, listen, nod, breathe, flex, read, knit (unverändert); `dojo` flex, greet, nod, listen, breathe; `huegel` nur bike; `wald` nur run; `matte` yoga, breathe, nod; `buecher` read, greet, nod, listen; `kissen` knit, greet, nod, listen. `poseIn` fällt auf die erste Pose des Orts zurück statt immer auf greet (für das Nest bleibt es greet). `placeOf` wird aus dieser einen Tabelle abgeleitet (der Ort, dessen erste Pose es ist, sonst `nest`). Nach Task 6 nutzt Heute nur `place="own"`; `PLACE_POSES`, `poseIn` und der Zweig mit festem Ort bleiben, weil `DESIGN.md` die Regel nennt und ein Ort mehr als eine Pose tragen kann (ein Kommentar in `BoScene.tsx` sagt das).
5. **Reduzierte Bewegung zeigt den Ort mit Bo als Standbild seiner Pose.** Das Standbild ist genau die Pose, in die Bo sonst gleitet: der stärkste Moment des Clips (`holdFrame`), bei Tätigkeiten der Anfang ihrer Spanne (`ACTIVITY_SPANS`). Stricken und Lesen stehen dann still. Dasselbe Standbild zeigt Bo, wenn der Player nicht lädt (alter Browser, kein `Path2D`).
6. **Die Standbilder werden erzeugt, nicht gezeichnet:** `npm run panda:stills` schreibt aus `panda-motion.ts` zehn Dateien `brand/bo-pose-{pose}.svg`. Ein Test vergleicht jede Datei mit der Ausgabe und nennt im Fehlerfall den Befehl, so laufen Animation und Standbild nie auseinander. Die Deckung steht kumuliert auf jeder Form (wie `globalAlpha` der Canvas), nicht auf Gruppen. Canvas und Standbild laufen über denselben Knoten-Durchgang in `panda-canvas.ts`. Bei Bewegung bleibt unter der Canvas das bisherige Ruhebild `panda-still.svg`, weil Bo aus der Ruhe in die Pose gleitet.
7. **`portrait="mini"` zeigt nie einen Ort**, auch wenn `place` gesetzt ist; das kleine Standbild bleibt `panda-still.svg`. Damit ist der Parkplatz-Punkt „`BoBubble` mit `portrait="mini"` und `place`“ erledigt (die Szene ist 116 × 176 px, eine Mini-Blase 3,4 rem).
8. **Alle Szenenfarben sind Tokens** (`--scene-*`), wie beim Nest. Was auf dem Boden liegt (Hügel, Boden, Wand, Wasser, Mond), hat einen hellen Wert; Dinge, die in beiden Schemata gleich aussehen (Bücher, Wolle, Kissen, Hantel, Porträt), sind `/* shared */`. Gibt es eine Farbe schon als Token, wird es genutzt (Gold der Wolle = `--low`). Das Arnold-Porträt wird für 116 px auf Rahmen, Papier, Linie und Hautton vereinfacht.
9. **Jede Szene nutzt den Rahmen des Nests** (116 × 176, `back` hinter dem Lichtschein, `front` vor Bo, Bo unten links 12 px, unten 9 px, 94 px breit). Die Moodboard-Szenen (390 × 240) werden für das hohe Format neu angeordnet (Mond, Laterne, Porträt rücken nach oben in den Rahmen), nicht 1 : 1 verkleinert.
10. **Der Chat-Kopf bleibt ohne Ort** (kleines `PandaPortrait` mit `listen` und rundem Lichtschein).
11. **Logo: drei einfache Entwürfe in `docs/design/moodboard/logo.html`**, nur Bos Gesicht mit Stirnband, flach, höchstens vier Farben, ein Grund ohne Verlauf, ein Bild für alle Größen (keine kleine Fassung): D „Das bisherige Gesicht, aufgeräumt“ (das heutige Panda-Logo ohne Brauen und Schweißtropfen; der Rückfall des Nutzers), E „Mit einer kleinen Tasse“ (geschlossene Augen wie Bo, kleine Tasse mit Dampf unten rechts), F „Aprikose“ (größeres Gesicht auf apricotfarbenem Grund, Stirnband grün; weicht vom dunkelgrünen Grund in DESIGN.md ab). Je in 1024 (Dock), 180 (Handy), 32 und 16 (Tab), hell und dunkel. Die erste Runde A, B, C war zu verspielt und ist verworfen. **Empfehlung: E**, weil es so einfach bleibt wie D, aber als einziges den Tee aus „Bo als Teetrinker“ zeigt; D ist der sichere Rückfall. Der Controller fragt den Nutzer (kein Subagent); Task 8 wartet darauf und prüft es in Step 0.
12. **Logo-Dateien:** `resources/icon.svg` (macOS-Raster: 824 von 1024, Radius 185, wie heute), `src/web/public/icons/icon.svg` (randlos, für PWA, Apple-Touch, maskable und als SVG-Favicon; alles Wichtige in den mittleren 80 %). Die PNG-Namen bleiben (`icon-192.png`, `icon-512.png`, `apple-touch-icon.png`; die Benachrichtigungen nutzen `icon-192.png`), neu ist `favicon-32.png` für Browser ohne SVG-Favicon. `icons/panda.svg` fällt weg. Das Logo hat in beiden Schemata seinen eigenen Grund (dunkelgrün, bei F apricot), keine helle Fassung.
13. **Aus dem Parkplatz mitgenommen: „Essen heute“ auf Heute zeigt das Bild der Mahlzeit** (`MealImage`, Rezeptfoto oder Zeichnung nach Mahlzeit-Typ) statt des Icons. Klein und auf derselben Seite wie Bo; die Zeile bleibt sonst gleich.

**Aus dem Parkplatz übernommen:** „`BoBubble` mit `portrait="mini"` und `place`“ (Entscheidung 7, Task 4) und „‚Essen heute‘ auf Heute zeigt noch das Icon statt des Bilds“ (Entscheidung 13, Task 7). Nicht übernommen: `SubPage` als Kit-Rahmen, Tab bei offener Unterseite, „‹ Zurück“ in Sheets aus dem Übungsmenü, Pausen-Wecker beim Verkleinern (alle nicht Bo oder Logo).

## Review Focus

1. **Daten kommen spät** (langsame IndexedDB, Heute öffnet vor dem Wochenplan): Bo hat schon gegrüßt, dann kommt „Radtag“. Erwartet: Bo bleibt grüßend im Nest bis zum nächsten Öffnen; nie grüßt er auf dem Hügel ohne Rad. Ohne Pose beim Festlegen bleibt er im Nest. (Tests in Task 4.)
2. **Reduzierte Bewegung:** jede Pose aus `dayClip` steht als Standbild an ihrem Ort, keine Canvas, der Player wird nie geladen. (Tests in Task 3 und Task 6.)
3. **Player lädt nicht** (kein `Path2D`, kein 2D-Kontext, Fehler beim Import): Bo steht als Standbild seiner Pose an seinem Ort, nicht als sitzendes Ruhebild auf dem Hügel. (Test in Task 3.)
4. **Helles Schema:** jede Szene ist auf Papier lesbar; jedes `--scene-*`-Token einer Szene hat einen hellen Wert oder ist `shared`. (Tests in Task 4 und Task 5, Sichtprüfung in Task 9.)
5. **Altes Icon im Cache und tote Verweise:** nach dem Update zeigen Tab, Startbildschirm und Benachrichtigung das neue Logo; `index.html` und das Manifest verweisen nur auf Dateien, die es gibt, mit der genannten Größe. (Test in Task 8.)

---

### Task 1: Logo-Entwürfe im Moodboard (Abnahme-Gate)

**Files:**
- Create: `docs/design/moodboard/logo.html` (schon gezeichnet beim Schreiben dieses Plans; im Browser öffnen)

**Interfaces:**
- Produces: drei Entwürfe als `<symbol id="d|e|f">` (randlos, `viewBox="0 0 1024 1024"`, ein Bild für alle Größen). Task 8 übernimmt die Formen des gewählten Entwurfs wörtlich.

- [x] **Step 1:** `docs/design/moodboard/logo.html` im Browser öffnen und prüfen: drei Karten D, E, F; je Dock (verkleinert), Handy 180, Tab 32 und 16, hell und dunkel. Keine verworfene Richtung (Ensō, Nest, Panda und Maus, Monogramm, die erste Runde A, B, C).
- [x] **Step 2: Commit** — schon beim Planen erledigt (`docs: simpler logo drafts`, zusammen mit diesem Plan).
- [ ] **Step 3: Gate (nur der Controller).** Der Controller fragt den Nutzer nach dem Entwurf (Entscheidung 11); ein Implementierungs-Subagent fragt nie selbst, er endet nach Step 2. Seine Wahl und jede Änderung in `logo.html` nachziehen (nur in diesem Moodboard), dann in `DESIGN.md` unter „Logo“ die Beschreibung an den gewählten Entwurf anpassen (heute steht dort „Kopf und Tasse, warmer Lichtschein“; D hat keine Tasse, F keinen grünen Grund), A, B, C bei den verworfenen Entwürfen ergänzen und einen Satz anfügen: „Gewählt: Entwurf X (`moodboard/logo.html`).“ Commit `docs(design): logo chosen`. Tasks 2–7 laufen bis dahin weiter; Task 8 startet erst danach, Task 9 nach Task 8.

### Task 2: Bos Standbilder pro Pose

**Files:**
- Modify: `src/tracking/ui/panda-canvas.ts` (Posen und Knoten-Durchgang als reine Funktionen auf Modulebene), `package.json` (Skript `panda:stills`), `design/panda-rive/README.md` (eine Zeile)
- Create: `src/tracking/ui/panda-still-url.ts`, `src/tracking/ui/panda-stills.ts`, `scripts/panda-stills.ts`, `src/web/public/brand/bo-pose-{greet,listen,nod,breathe,flex,bike,run,yoga,read,knit}.svg`
- Test: `tests/tracking/panda-canvas.test.ts`, `tests/tracking/panda-stills.test.ts` (neu)

**Interfaces:**
- Produces:
  - In `panda-canvas.ts`, alles auf Modulebene (heute Closures in `mountPanda`): `export type Pose`; `export function posesAt(motion: PandaMotion, clip: Clip | undefined, frame: number): Map<number, Pose>` (aus der Closure gelöst, `valueAt` bleibt modul-lokal); `export function heldPoses(motion: PandaMotion, gesture: PandaGesture): Map<number, Pose>` = die Ziel-Pose von `hold` (bei `ACTIVITY_SPANS` der Anfang der Spanne, sonst `holdFrame`).
  - **Ein Knoten-Durchgang:** `export type NodeVisit = { enter(x: number, y: number, rotation: number, sx: number, sy: number): void; shape(paint: Paint, alpha: number): void; leave(): void }` und `export function walkNodes(motion: PandaMotion, poses: Map<number, Pose>, visit: NodeVisit): void`: Reihenfolge `roots` → `children`, Knoten mit Deckung ≤ 0 samt Kindern übersprungen, `alpha` = Produkt der Deckungen bis zu diesem Knoten. `paint()` in `mountPanda` nutzt ihn (`enter` = `save`/`translate`/`rotate`/`scale`, `shape` setzt `globalAlpha = alpha` und füllt/zieht, `leave` = `restore`); `hold()` nutzt `heldPoses`. Verhalten der Canvas unverändert.
  - `export function stillSvg(gesture: PandaGesture): string` in `panda-stills.ts`: über `walkNodes(pandaMotion, heldPoses(pandaMotion, gesture), …)` ein SVG `viewBox="0 0 198 164"` (gleicher Rahmen wie die Canvas, `.tk-panda` hat `aspect-ratio: 198 / 164`). `enter` → `<g transform="translate(x y) rotate(°) scale(sx sy)">` (Grad = Radiant · 180/π), `leave` → `</g>`, `shape` → `<path d fill stroke stroke-width stroke-linecap stroke-linejoin opacity>` aus `paint`, `opacity` = kumuliertes `alpha` auf jeder Form (nur wenn ≠ 1), nie auf Gruppen. Eine Zahl-Formatierung für alles (drei Stellen, `-0` → `0`), Zeilenende `\n`, deterministisch.
  - In `panda-still-url.ts` (klein, ohne Bewegungsdaten, damit das App-Bundle `panda-motion.ts` nicht in den Haupt-Chunk zieht): `export const STILL_POSES: readonly PandaGesture[]` = alle zehn Gesten; `export const stillUrl = (g: PandaGesture) => \`/brand/bo-pose-${g}.svg\``. Alle importieren sie von dort (kein Re-Export).
  - `scripts/panda-stills.ts` schreibt für jede Geste `stillSvg(g)` nach `src/web/public/brand/bo-pose-{g}.svg`. `package.json`: `"panda:stills": "tsx scripts/panda-stills.ts"`. `design/panda-rive/README.md`: „Nach jedem Export von `panda-motion.ts`: `npm run panda:stills` (Bos Standbilder).“
  - `panda-stills.ts` importieren nur das Skript und Tests; `PandaPortrait` importiert nur `panda-still-url.ts`.

- [ ] **Step 1: Write the failing tests.** In `tests/tracking/panda-canvas.test.ts`:

```ts
test('every gesture has its own held pose', () => {
  const held = STILL_POSES.map((g) => JSON.stringify([...heldPoses(pandaMotion, g)]));
  for (const h of held) expect(h).not.toBe('[]');
  expect(new Set(held).size).toBe(STILL_POSES.length);
});
```

Die bestehenden `hold`-Tests („a held activity … keeps moving“, „every clip has a held pose …“) bleiben unverändert grün; sie sichern, dass `hold` nach dem Umbau dasselbe tut.

`tests/tracking/panda-stills.test.ts`:

```ts
it('has one still per gesture, equal to what the motion data draws', () => {
  expect([...STILL_POSES].sort()).toEqual(Object.keys(pandaMotion.clips).sort());
  for (const g of STILL_POSES) expect(readFileSync(`src/web/public/brand/bo-pose-${g}.svg`, 'utf8'), `${g}: run npm run panda:stills`).toBe(stillSvg(g));
});
it('puts the opacity on each shape, never on a group', () => {
  for (const g of STILL_POSES) expect(stillSvg(g)).not.toMatch(/<g[^>]*opacity/);
});
it('draws each still in the canvas frame, and every gesture differently', () => {
  const all = STILL_POSES.map(stillSvg);
  for (const s of all) expect(s).toContain('viewBox="0 0 198 164"');
  expect(new Set(all).size).toBe(STILL_POSES.length);
});
```

- [ ] **Step 2: Run** `npx vitest run tests/tracking/panda-canvas.test.ts tests/tracking/panda-stills.test.ts` — Expected: FAIL (`heldPoses`, `stillSvg` fehlen).
- [ ] **Step 3: Implement** `posesAt`, `heldPoses`, `walkNodes` (und `paint`/`hold` darauf umstellen), `panda-still-url.ts`, `panda-stills.ts`, das Skript, die README-Zeile, dann `npm run panda:stills`.
- [ ] **Step 4:** Zwei Standbilder im Browser öffnen (`bike`, `knit`) und mit `docs/design/moodboard/poses/{bike,knit}.png` vergleichen: gleiche Pose, gleiche Farben, gleiche Deckung.
- [ ] **Step 5: Run** die Tests und `npm run typecheck` — Expected: PASS.
- [ ] **Step 6: Commit** `feat(bo): a still picture per pose, drawn from the motion data`.

### Task 3: Bo als Standbild seiner Pose

**Files:**
- Modify: `src/tracking/ui/PandaPortrait.tsx`
- Test: `tests/tracking/panda-portrait.test.tsx`

**Interfaces:**
- Consumes: `stillUrl` aus `panda-still-url.ts` (Task 2).
- Produces: `PandaPortrait({ pose, className, onTake }: { pose?: PandaGesture | null; className?: string; onTake?: (pose: PandaGesture | null) => void })`. `onTake` kommt genau einmal pro Öffnen, mit der genommenen Pose oder mit `null`, wenn keine da war.
  - **Bewegung:** wie heute; im Moment, in dem der Timer nach `SETTLE_MS` feuert, ruft es `onTake?.(p ?? null)` (mit Pose direkt neben `h.hold(p, GLIDE_MS)`). Unter der Canvas bleibt `panda-still.svg`.
  - **Reduzierte Bewegung oder Ladefehler** (der `catch`-Zweig setzt einen Zustand `failed`): das `<img>` zeigt `stillUrl(pose)`, solange es eine Pose gibt, sonst `panda-still.svg`. `SETTLE_MS` nach dem Öffnen (bei Ladefehler: nach dem Fehler, frühestens `SETTLE_MS` nach dem Öffnen) wird die Pose festgehalten (`taken`), `onTake?.(taken)` einmal gerufen; spätere Änderungen von `pose` warten auf das nächste Öffnen. Ist beim Festlegen keine Pose da, wird nichts genommen und `onTake(null)` gerufen. Der `catch`-Zweig und der Festlege-Timer prüfen `alive`, damit nach dem Schließen kein Zustand mehr gesetzt wird. Keine Canvas bei reduzierter Bewegung, kein Import des Players (wie heute).
  - Kommentar oben am Bauteil um diese Regel ergänzen.

- [ ] **Step 1: Write the failing tests** (Hilfen `setReduced`, `wait`, `settle`, `fake` wie in der Datei):

```tsx
test('reduced motion shows the still of the pose and keeps it, telling which pose Bo took', async () => {
  setReduced(true);
  const took = vi.fn();
  const { container, rerender } = render(<PandaPortrait pose="bike" onTake={took} />);
  expect(container.querySelector('img')!.getAttribute('src')).toBe('/brand/bo-pose-bike.svg');
  await wait(800);
  expect(took).toHaveBeenCalledWith('bike');
  rerender(<PandaPortrait pose="run" onTake={took} />);
  await wait(5000);
  expect(container.querySelector('img')!.getAttribute('src')).toBe('/brand/bo-pose-bike.svg');
  expect(took).toHaveBeenCalledTimes(1);
  expect(m.factory).toBe(0);
});
test('when the player fails, Bo stands as the still of his pose', async () => {
  m.mount.mockRejectedValue(new Error('Panda needs vector paths'));
  const took = vi.fn();
  const { container } = render(<PandaPortrait pose="run" onTake={took} />);
  await settle(); await wait(800);
  expect(container.querySelector('img')!.getAttribute('src')).toBe('/brand/bo-pose-run.svg');
  expect(took).toHaveBeenCalledWith('run');
});
test('with motion the rest still lies under the canvas and onTake comes with the glide', async () => {
  const f = fake(); m.mount.mockResolvedValue(f);
  const took = vi.fn();
  const { container } = render(<PandaPortrait pose="flex" onTake={took} />);
  expect(container.querySelector('img')!.getAttribute('src')).toBe('/brand/panda-still.svg');
  await settle(); await wait(800);
  expect(f.hold).toHaveBeenCalledWith('flex', expect.any(Number));
  expect(took).toHaveBeenCalledWith('flex');
});
test('with no pose when it settles, Bo takes nothing', async () => {
  setReduced(true);
  const took = vi.fn();
  render(<PandaPortrait onTake={took} />);
  await wait(5000);
  expect(took).toHaveBeenCalledTimes(1);
  expect(took).toHaveBeenCalledWith(null);
});
```

Der bestehende Test „reduced motion never imports the player and keeps the still“ bleibt (mit `pose="greet"` ist das Bild jetzt `bo-pose-greet.svg`; die Erwartung „ein `img`“ bleibt).
- [ ] **Step 2: Run** `npx vitest run tests/tracking/panda-portrait.test.tsx` — Expected: FAIL.
- [ ] **Step 3: Implement** in `PandaPortrait.tsx`.
- [ ] **Step 4: Run** den Test, dann `npx vitest run tests/tracking tests/web/heute-panda.test.tsx` — Expected: PASS.
- [ ] **Step 5: Commit** `feat(bo): reduced motion shows Bo as the still of his pose`.

### Task 4: Orte im Kit, mit Dojo, Hügel und Wald

**Files:**
- Modify: `src/tracking/ui/kit/BoScene.tsx`, `src/tracking/ui/kit/Dojo.tsx` (`BoBubble`), `src/tracking/ui/kit/index.ts`, `src/design/tokens.css`
- Create: `src/web/public/brand/bo-dojo.svg`, `src/web/public/brand/bo-huegel.svg`, `src/web/public/brand/bo-wald.svg`
- Test: `tests/web/bo-scene.test.tsx`, `tests/web/bo-scene-late.test.tsx` (neu)

**Interfaces:**
- Consumes: `PandaPortrait` mit `onTake` (Task 3).
- Produces:
  - `export type BoPlace = 'nest' | 'dojo' | 'huegel' | 'wald'` (Task 5 ergänzt `'matte' | 'buecher' | 'kissen'`). `export const PLACES: readonly BoPlace[]`.
  - `PLACE_POSES` nach Entscheidung 4 (erste Pose = eigene Pose des Orts).
  - `poseIn(place, wanted)`: `wanted`, wenn es passt, sonst `PLACE_POSES[place][0]`.
  - `export function placeOf(pose: PandaGesture | null | undefined): BoPlace`: abgeleitet aus `PLACE_POSES`, der Ort, dessen erste Pose `pose` ist, sonst `nest`. Ergibt nach Task 4 `flex` → `dojo`, `bike` → `huegel`, `run` → `wald`; Task 5 ändert nur `PLACE_POSES`. Für alle zehn Gesten gilt `PLACE_POSES[placeOf(g)].includes(g)`.
  - `BoBubble({ …, place }: { …; place?: BoPlace | 'own' })`: mit `'own'` merkt sich die Blase die Pose aus `onTake` (`useState<PandaGesture | null>`) und zeigt `BoScene place={placeOf(taken ?? pose)}`; das Porträt bekommt `pose` unverändert. Zustand `taken: PandaGesture | null | undefined` (`undefined` = noch nicht festgelegt): Ort = `taken === undefined ? placeOf(pose) : placeOf(taken)`. Kam `onTake(null)`, bleibt die Blase also beim Nest, auch wenn später eine Pose kommt. Ein Porträt, das nie `onTake` ruft (Test-Mocks), lässt den Ort der Pose folgen. Mit einem festen Ort wie heute `poseIn(place, pose)`. Mit `portrait="mini"` nie eine Szene (Entscheidung 7). Kommentar an `BoBubble` entsprechend.
  - Kopfkommentar von `BoScene.tsx`: der Satz „Dojo 5 fügt die übrigen Orte … hinzu“ wird zur Regel „Ein Ort ist ein Name in `BoPlace`, eine Zeile in `PLACE_POSES` und eine Datei `brand/bo-{place}.svg` mit `back` und `front`, gefärbt nur über Tokens.“ Zweiter Kommentar an `PLACE_POSES`/`poseIn`: „Heute nutzt `place="own"`; der feste Ort und die weiteren Posen pro Ort bleiben für Orte, die mehr als eine Pose tragen (DESIGN.md).“
  - `kit/index.ts` exportiert `placeOf`, `PLACES`.
  - **Tokens** (dunkel aus `bos-orte.html`; hell: ein Papierton in der Familie der hellen Nest-Werte): `--scene-moon` `#f2e3bf` / `#e6d3a2`, `--scene-moon-glow` `rgba(242,227,191,.25)` / `rgba(200,170,110,.25)`, `--scene-hill` `#22332a` / `#cfd8bf`, `--scene-hill-far` `#2c4031` / `#dde2cd`, `--scene-floor` `#2b2418` / `#e5d8b9`, `--scene-floor-line` `#3a3020` / `#cdbb91`, `--scene-wall` `#3b4a3e` / `#dfe3d2`, `--scene-path` `#5e5230` / `#c9b98c`; geteilt (`/* shared */`): `--scene-iron` `#1b1b1b`, `--scene-paper` `#d9cfbf`, `--scene-skin` `#d08a5a`, `--scene-frame` `#6b4226`. Farben, die schon ein Token haben (Halme, Blätter, Laterne, `--accent`, `--low` (Gold)), nutzen dieses. Kommentar über der Gruppe: „Bo's places (BoScene, brand/bo-*.svg)“.
  - **Szenen:** je `<svg>` mit `<symbol id="back">` und `<symbol id="front">`, `viewBox="0 0 116 176"`, `overflow="hidden"`, Formen aus der passenden Karte in `bos-orte.html`, neu angeordnet nach Entscheidung 9. `dojo`: Boden mit Dielen, Wand, Arnold-Porträt oben (vereinfacht, Entscheidung 8), Hantel vorn (`front`). `huegel`: zwei Hügel, Bambus seitlich, Mond oben; vorn eine Hügelkante. `wald`: Halme hinten, Weg quer von links nach rechts, vorn ein paar Halme am Rand. Keine Bo-Figur in den Szenen (Bo ist das Porträt).

- [ ] **Step 1: Write the failing tests** in `tests/web/bo-scene.test.tsx`. Den Nest-Farbtest zu einem Test über alle Orte machen:

```tsx
it('paints every place only through tokens that exist in both schemes', () => {
  const [dark, light] = readFileSync('src/design/tokens.css', 'utf8').split('@media (prefers-color-scheme: light)');
  for (const p of PLACES) {
    const svg = readFileSync(`src/web/public/brand/bo-${p}.svg`, 'utf8');
    expect(svg, p).toContain('<symbol id="back"'); expect(svg, p).toContain('<symbol id="front"');
    expect(svg.match(/#[0-9a-fA-F]{3,8}\b|\brgba?\(/g) ?? [], p).toEqual([]);
    for (const t of new Set(svg.match(/--[a-z0-9-]+/g))) {
      expect(dark, `${p} ${t}`).toContain(`${t}:`);
      if (!new RegExp(`${t}:[^;]+;\\s*/\\* shared \\*/`).test(dark!)) expect(light, `${p} ${t}`).toContain(`${t}:`);
    }
  }
});
it('gives each pose its own place, and every place its own pose first', () => {
  expect([placeOf('greet'), placeOf('flex'), placeOf('bike'), placeOf('run'), placeOf(null)]).toEqual(['nest', 'dojo', 'huegel', 'wald', 'nest']);
  for (const p of PLACES) expect(placeOf(PLACE_POSES[p][0]), p).toBe(p);
  for (const g of STILL_POSES) expect(PLACE_POSES[placeOf(g)], g).toContain(g);
  expect(poseIn('huegel', 'greet')).toBe('bike');
  expect(poseIn('nest', 'bike')).toBe('greet');
});
it('puts Bo where his pose belongs with place="own"', () => {
  render(<BoBubble place="own" pose="bike">Heute fährst du Rad.</BoBubble>);
  expect(document.querySelector('.tk-scene')!.getAttribute('data-place')).toBe('huegel');
  expect(document.querySelector('.tk-scene-back use')!.getAttribute('href')).toBe('/brand/bo-huegel.svg#back');
});
it('a mini Bo never stands in a place', () => {
  render(<BoBubble portrait="mini" place="dojo">Alles gut.</BoBubble>);
  expect(document.querySelector('.tk-scene')).toBeNull();
  expect(document.querySelector('.tk-bo img')!.getAttribute('src')).toBe('/brand/panda-still.svg');
});
```

Review Focus 1 in einer eigenen Datei `tests/web/bo-scene-late.test.tsx` (echtes `PandaPortrait`, `panda-canvas` gemockt und Hilfen `fake`, `settle`, `wait` wie in `tests/tracking/panda-portrait.test.tsx`, Fake-Timer):

```tsx
it('keeps place and pose together when the day arrives after Bo took his pose', async () => {
  const { rerender } = render(<BoBubble place="own" pose="greet">…</BoBubble>);
  await settle(); await wait(800);            // Bo glides into greet
  rerender(<BoBubble place="own" pose="bike">…</BoBubble>);
  await wait(5000);
  expect(document.querySelector('.tk-scene')!.getAttribute('data-place')).toBe('nest');
});
it('stays in the nest when there was no pose to take', async () => {
  const { rerender } = render(<BoBubble place="own">…</BoBubble>);
  await settle(); await wait(800);
  rerender(<BoBubble place="own" pose="run">…</BoBubble>);
  await wait(5000);
  expect(document.querySelector('.tk-scene')!.getAttribute('data-place')).toBe('nest');
});
```

Den alten Test „lets Bo take only poses that fit his place …“ behalten (Nest unverändert). `tests/web/style-tokens.test.ts` bleibt: „gives every colour token on :root a light value, or marks it shared“ erfasst die neuen Tokens schon; die Handliste in „defines Bo's place tokens“ wird nicht erweitert.
- [ ] **Step 2: Run** `npx vitest run tests/web/bo-scene.test.tsx tests/web/bo-scene-late.test.tsx` — Expected: FAIL.
- [ ] **Step 3: Implement** Kit, Tokens und die drei SVGs. Für jede Szene das Bild prüfen: `docs/design/moodboard/bos-orte.html` neben eine kleine Testseite legen (im Scratchpad, nicht im Repo), die `BoScene`-Rahmen mit `bo-pose-{pose}.svg` in dunkel und hell zeigt.
- [ ] **Step 4: Run** die Tests, `npx vitest run tests/web tests/tracking` und `npm run typecheck` — Expected: PASS.
- [ ] **Step 5: Commit** `feat(bo): places in the kit, with Dojo, Hügel and Wald`.

### Task 5: Matte, Bücher und Kissen

**Files:**
- Modify: `src/tracking/ui/kit/BoScene.tsx`, `src/design/tokens.css`
- Create: `src/web/public/brand/bo-matte.svg`, `src/web/public/brand/bo-buecher.svg`, `src/web/public/brand/bo-kissen.svg`
- Test: `tests/web/bo-scene.test.tsx`

**Interfaces:**
- Produces: `BoPlace` + `'matte' | 'buecher' | 'kissen'`, in `PLACES` und `PLACE_POSES` (Entscheidung 4). `placeOf` ändert sich nicht; aus der Tabelle folgt `yoga` → `matte`, `read` → `buecher`, `knit` → `kissen`.
  - **Tokens:** `--scene-mat` `#8a7a46` / `#c9b077`, `--scene-smoke` `#b7c5ae` / `#9aa58c`; geteilt: `--scene-book-1` `#8a4524`, `--scene-book-2` `#e8c37a`, `--scene-book-3` `#5f7f4a`, `--scene-wool-1` `#c0392b`, `--scene-wool-3` `#7fa25c` (das goldene Knäuel nutzt `--low`), `--scene-cushion` `#8e3b2a`, `--scene-cushion-top` `#c0563b`, `--scene-seam` `#e8964a`, `--scene-shelf` `#8a6a3a`. Mond und Boden aus Task 4.
  - **Szenen:** `matte`: Matte vorn (`front`), gerade (nicht schräg) und etwas größer als im Moodboard (Wunsch des Nutzers), Räucherstäbchen mit Rauch seitlich, Mond oben. `buecher`: Laterne oben links mit Lichtschein, Bücherstapel neben Bo (`front`). `kissen`: dickes Kissen unter Bo (`front` mit Naht), Wollregal oben mit drei Knäueln.

- [ ] **Step 1: Write the failing tests.** In `tests/web/bo-scene.test.tsx` im Test „gives each pose its own place …“ ergänzen: `expect([placeOf('yoga'), placeOf('read'), placeOf('knit')]).toEqual(['matte', 'buecher', 'kissen'])` und `expect(PLACES).toHaveLength(7)`. Der Farbtest aus Task 4 läuft über `PLACES` (Regex mit Ziffern) und erfasst die neuen Dateien und Tokens von selbst; `style-tokens.test.ts` bleibt.
- [ ] **Step 2: Run** `npx vitest run tests/web/bo-scene.test.tsx` — Expected: FAIL.
- [ ] **Step 3: Implement** Kit-Zeilen, Tokens und die drei SVGs; Bildprüfung wie in Task 4, Step 3.
- [ ] **Step 4: Run** die Tests, `npx vitest run tests/web/style-tokens.test.ts` und `npm run typecheck` — Expected: PASS.
- [ ] **Step 5: Commit** `feat(bo): places for yoga, reading and knitting`.

### Task 6: Heute stellt Bo an seinen Ort

**Files:**
- Modify: `src/web/today/CoachLine.tsx`, `docs/design/DESIGN.md`
- Test: `tests/web/heute-panda.test.tsx`, `tests/web/heute-day.test.tsx`, `tests/web/heute-reduced.test.tsx` (neu)

**Interfaces:**
- Consumes: `BoBubble place="own"` (Task 4), `dayClip` unverändert.
- Produces: `CoachLine` rendert `<BoBubble place="own" pose={pose} …>`; Kommentar: „Bo stands at the place of his pose (DESIGN.md, Bos Orte)“. `Heute.tsx` bleibt unverändert.
  - `DESIGN.md`, Abschnitt „Bo, dein Sensai“: Satz „Im Nest sitzt Bo; Posen im Stehen … bis dahin begrüßt er im Nest.“ ersetzen durch „Auf Heute steht Bo an dem Ort seiner Pose (`placeOf`); Ort und Pose wählt er einmal beim Öffnen. Bei reduzierter Bewegung steht er dort als Standbild seiner Pose (`brand/bo-pose-*.svg`).“ In der Tabelle bei listen und breathe in der Spalte „Ort“ ergänzen: „(noch nicht gebaut)“.

- [ ] **Step 1: Write the failing tests** in `tests/web/heute-panda.test.tsx`. Den Test „in the nest Bo sits: a bike day keeps the greeting …“ ersetzen:

```tsx
it('on a bike day Bo rides on the hills', async () => {
  await boot([week('bike')]);
  await waitFor(() => expect(log.last.pose).toBe('bike'));
  expect(document.querySelector('.tk-scene')!.getAttribute('data-place')).toBe('huegel');
});
it('each kind of day has its place', async () => {
  for (const [sport, place] of [['gym', 'dojo'], ['run', 'wald'], ['mobility', 'matte']] as const) {
    await boot([week(sport)]);
    await waitFor(() => expect(document.querySelector('.tk-scene')!.getAttribute('data-place')).toBe(place));
    cleanup();
  }
});
```

In `tests/web/heute-day.test.tsx:61` („shows the week path, Bo in his nest, …“, Krafttag) wird `.tk-scene[data-place="nest"]` zu `.tk-scene[data-place="dojo"]` und der Testname zu „…, Bo at his place, …“. Der Mock von `PandaPortrait` in `heute-panda.test.tsx` ruft kein `onTake`; der Ort folgt also `pose` (gewollt, Task 4). Review Focus 2 als eigener Test in einer neuen Datei `tests/web/heute-reduced.test.tsx` (ohne Mock, `matchMedia` mit `reduce`, Boot-Hilfe wie in `heute-panda.test.tsx`): Ruhetag mit geradem Datum → `.tk-scene[data-place="buecher"] img[src="/brand/bo-pose-read.svg"]` da, keine `canvas`.
- [ ] **Step 2: Run** `npx vitest run tests/web/heute-panda.test.tsx tests/web/heute-day.test.tsx tests/web/heute-reduced.test.tsx` — Expected: FAIL.
- [ ] **Step 3: Implement** `CoachLine` und `DESIGN.md`.
- [ ] **Step 4: Run** die Tests und `npx vitest run tests/web` — Expected: PASS.
- [ ] **Step 5: Commit** `feat(heute): Bo stands at the place of his pose`.

### Task 7: „Essen heute“ mit Bild

**Files:**
- Modify: `src/web/MealsScreen.tsx` (nur `DayMeals`)
- Test: `tests/web/app/essen.test.tsx`

**Interfaces:**
- Consumes: `MealImage({ recipeId, slot })` aus `src/web/essen/MealImage.tsx`.
- Produces: in `DayMeals` statt `icon="essen"` `picture={<MealImage recipeId={m.dish.recipeId} slot={m.slot} />}`. Text, Reihenfolge und Ziel des Tipps bleiben.

- [ ] **Step 1: Write the failing test** in `tests/web/app/essen.test.tsx` (Seeds wie im Test bei Zeile ~101):

```tsx
it('Essen heute shows the picture of each meal, not the icon', async () => {
  // Plan mit drei Mahlzeiten heute, keine mit recipeId
  const list = await screen.findByRole('list', { name: 'Essen heute' });
  expect(list.querySelectorAll('svg.tk-meal use')).toHaveLength(3);
  expect(list.querySelector('svg[data-icon="essen"]')).toBeNull();
});
```
- [ ] **Step 2: Run** `npx vitest run tests/web/app/essen.test.tsx` — Expected: FAIL.
- [ ] **Step 3: Implement** die eine Zeile.
- [ ] **Step 4: Run** `npx vitest run tests/web` — Expected: PASS.
- [ ] **Step 5: Commit** `feat(heute): Essen heute shows the meal pictures`.

### Task 8: Das Logo als App-Icon (erst nach dem Gate in Task 1)

**Files:**
- Modify: `resources/icon.svg`, `resources/icon.png`, `resources/icon.icns`, `scripts/web-icons.sh`, `src/web/index.html`, `src/web/public/icons/{icon-192.png,icon-512.png,apple-touch-icon.png}`, `docs/design/DESIGN.md` („Logo“)
- Create: `src/web/public/icons/icon.svg`, `src/web/public/icons/favicon-32.png`
- Delete: `src/web/public/icons/panda.svg`
- Test: `tests/web/logo.test.ts` (neu)

**Interfaces:**
- Consumes: das Symbol `d`, `e` oder `f` des gewählten Entwurfs aus `docs/design/moodboard/logo.html`.
- Produces:
  - **Gemeinsame Zeichnung:** Die Zeichnung des Entwurfs steht in jeder Datei in genau einem markierten Block `<!-- bo-logo -->…<!-- /bo-logo -->`, der die `<defs>` (die Clip-Form des Gesichts für das Stirnband, feste ID `bo-face`) **und** die Gruppe `<g id="bo-logo">` mit Grund und Gesicht enthält; der Block ist in beiden Dateien Zeichen für Zeichen gleich. `resources/icon.svg`: Kommentar „macOS-Raster: 824 von 1024“ bleibt, `<clipPath>` mit `rect x=100 y=100 width=824 height=824 rx=185`, darin `<g transform="translate(100 100) scale(.8047)">` + `bo-logo`. `icons/icon.svg`: randlos `viewBox="0 0 1024 1024"` + `bo-logo`, alles Wichtige in den mittleren 80 % (maskable); dieselbe Datei ist das SVG-Favicon.
  - `scripts/web-icons.sh` rendert aus `icons/icon.svg` `icon-512.png`, `icon-192.png`, `apple-touch-icon.png` (wie heute) und `favicon-32.png`. Kopfkommentar anpassen.
  - Mac: `npx electron scripts/icon/render.cjs` schreibt `resources/icon.png` und `icon.icns` (Skript unverändert).
  - `src/web/index.html`: `<link rel="icon" type="image/svg+xml" href="/icons/icon.svg" />`, `<link rel="icon" type="image/png" sizes="32x32" href="/icons/favicon-32.png" />`, Apple-Touch wie heute. Manifest unverändert (Namen bleiben).
  - `DESIGN.md` „Logo“: Satz zu den Dateien (die zwei SVGs, wofür jede) und dass `npm run app` das Dock-Icon erst bei der nächsten Installation übernimmt.

- [ ] **Step 0: Gate prüfen.** `grep -n "Gewählt: Entwurf" docs/design/DESIGN.md` — Expected: ein Treffer. Fehlt er, nichts bauen, sondern stoppen und dem Controller melden: „Logo noch nicht gewählt (Task 1, Step 3).“
- [ ] **Step 1: Write the failing test** `tests/web/logo.test.ts`:

```ts
const png = (f: string) => { const b = readFileSync(f); return [b.readUInt32BE(16), b.readUInt32BE(20)]; };
const art = (f: string, id: string) => readFileSync(f, 'utf8').match(new RegExp(`<!-- ${id} -->[\\s\\S]*?<!-- /${id} -->`))?.[0];
it('links only icons that exist, in the sizes they claim', () => {
  const html = readFileSync('src/web/index.html', 'utf8');
  for (const [, href] of html.matchAll(/<link rel="(?:icon|apple-touch-icon)"[^>]*href="([^"]+)"/g)) expect(existsSync(`src/web/public${href}`), href).toBe(true);
  const manifest = JSON.parse(readFileSync('src/web/public/manifest.webmanifest', 'utf8'));
  for (const i of manifest.icons) expect(png(`src/web/public${i.src}`), i.src).toEqual(i.sizes.split('x').map(Number));
  expect(png('src/web/public/icons/apple-touch-icon.png')).toEqual([180, 180]);
  expect(png('src/web/public/icons/favicon-32.png')).toEqual([32, 32]);
  expect(png('resources/icon.png')).toEqual([1024, 1024]);
});
it('draws the same Bo in the Mac icon and the web icon, and the old logo is gone', () => {
  expect(art('resources/icon.svg', 'bo-logo')).toBeTruthy();
  expect(art('resources/icon.svg', 'bo-logo')).toBe(art('src/web/public/icons/icon.svg', 'bo-logo'));
  expect(existsSync('src/web/public/icons/panda.svg')).toBe(false);
});
```

(Der Vergleich schließt die `<defs>` ein, so können Verläufe von Mac- und Web-Icon nicht auseinanderlaufen.)
- [ ] **Step 2: Run** `npx vitest run tests/web/logo.test.ts` — Expected: FAIL.
- [ ] **Step 3: Implement** die drei SVGs, dann `bash scripts/web-icons.sh` und `npx electron scripts/icon/render.cjs`; `index.html`, `panda.svg` löschen, `DESIGN.md`.
- [ ] **Step 4:** Die PNGs ansehen (`resources/icon.png`, `apple-touch-icon.png`, `favicon-32.png`) und mit `logo.html` vergleichen: gleiche Formen, keine Ränder, das Favicon mit 16 und 32 px noch als Panda lesbar. `grep -rn "icons/panda.svg" src scripts tests` — Expected: keine Treffer.
- [ ] **Step 5: Run** die Tests, `npx vitest run tests/web/sw.test.ts` und `npm run build:web` — Expected: PASS, `out/web/icons/icon.svg` und `favicon-32.png` vorhanden.
- [ ] **Step 6: Commit** `feat(brand): new logo Bo als Teetrinker for Dock, phone and tab`.

### Task 9: Abschluss (nach Task 8)

Task 9 wartet auf Task 8 (Logo); die Logo-Prüfungen (Favicon-Aufnahme, `icons/panda.svg`-grep) bleiben deshalb drin.

- [ ] **Step 1:** `npm run typecheck`, `rtk proxy npm run lint` (0 Fehler, höchstens 52 Warnungen), `npm test` — Expected: alles grün. `npx vitest run tests/web/sensai-wording.test.ts` — Expected: PASS. `grep -rn "Dojo 5 fügt\|bis dahin begrüßt\|icons/panda.svg" src docs/design tests scripts` — Expected: keine Treffer. `git diff main --stat -- src/main src/ui src/service src/shared src/coach src/tracking/session.ts src/tracking/store.ts src/tracking/registry.ts src/tracking/plan-draft.ts src/tracking/workout-change.ts src/tracking/studios.ts` — Expected: leer.
- [ ] **Step 2:** Sichtprüfung: `npm run build:web`, dann `/private/tmp/claude-501/-Users-sbinder-Projects-bike-coach/76e854cd-52f8-4db9-8605-4ff1597ea055/scratchpad/vis3/shoot.cjs` nach `/private/tmp/claude-501/-Users-sbinder-Projects-bike-coach/76e854cd-52f8-4db9-8605-4ff1597ea055/scratchpad/vis8/shoot.cjs` kopieren (`/bin/cp`), `R` auf diesen Worktree setzen und Heute für jede Art von Tag aufnehmen: Krafttag, Radtag, Lauftag, Beweglichkeit, Ruhetag mit geradem und mit ungeradem Datum, ohne Plan (über `NOWD` und den Wochenplan). Je bei 390 px und 1200 px, dunkel und hell, einmal normal (nach 4 s, wenn Bo seine Pose hält) und einmal mit `reducedMotion: 'reduce'` im Kontext. Dazu Chat und Essen (Bo klein, ohne Ort) und der Browser-Tab mit Favicon; den Chat auch mit `reducedMotion: 'reduce'`. Das Skript liegt im Scratchpad dieser Sitzung (nicht im Repo); fehlt es, dieselben Aufnahmen mit `scripts/web-shots.ts` als Vorlage bauen. Mit `docs/design/moodboard/bos-orte.html` vergleichen: Bo steht vor seinem Lichtschein, die Szene liegt hinter ihm, vorn verdeckt nichts sein Gesicht, die Szene ist hell auf Papier lesbar, das Standbild steht an derselben Stelle wie die Canvas. Größe prüfen: Die neuen Standbilder nutzen den ganzen Canvas-Rahmen (`0 0 198 164`), das alte `panda-still.svg` einen engeren Ausschnitt; bei reduzierter Bewegung ist Bo im Chat-Kopf (`listen`, 3,4 rem) und auf Heute deshalb kleiner als vorher. Ist er im Chat-Kopf zu klein, nur die Breite von `.tk-sheet-head .tk-pandahead-mini` anpassen, nicht die Standbilder. Abweichungen nur über Tokens oder die Szenen-SVGs beheben; was die Abnahme nicht betrifft, in den Parkplatz.
- [ ] **Step 3:** `npm run test:web-smoke` — Expected: alle Schritte grün; läuft kein Testserver, im Bericht sagen, dass der Smoke nicht lief.
- [ ] **Step 4:** Roadmap: Zeile Dojo 5 auf ✅; im Abschnitt „Dojo — Briefs“ den Satz „Der Plan für Dojo 5 entsteht nach Abnahme von Dojo 4.“ durch den Verweis auf diesen Plan ersetzen (wie bei Dojo 1–4). Parkplatz: „`BoBubble` mit `portrait="mini"` und `place` …“ durchstreichen mit „Erledigt mit Dojo 5 (mini zeigt nie einen Ort).“; „‚Essen heute‘ auf Heute zeigt noch das Icon …“ durchstreichen mit „Erledigt mit Dojo 5.“ Neu: „Aus Dojo 5: Orte für Zuhören (Laternen, Tisch, Tee) und Durchatmen (Wasser, Mond) sind im Moodboard, aber nicht gebaut; erst wenn eine Fläche Bo dabei groß zeigt.“ Plan nach `docs/archive/plans/` verschieben (`git mv docs/superpowers/plans/2026-11-09-dojo-5-bos-orte-logo.md docs/archive/plans/`).
- [ ] **Step 5: Commit** `docs: Dojo 5 done`.
