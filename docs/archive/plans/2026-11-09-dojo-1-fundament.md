# Dojo 1 Fundament Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Das Aussehen „Abend im Dojo“ steckt an je **einer** Stelle im Code (Tokens, Basisregeln, Kit-Bausteine, Icon-Register, Bo-Texte), sodass Dojo 2–5 nur noch Bausteine zusammensetzen und spätere Änderungen an einer Stelle passieren.

**Architecture:** Farben, Schrift, Radien, Breiten und der Seitenhintergrund sind Tokens in `src/design/tokens.css` (dunkel auf `:root`, hell nur unter `@media (prefers-color-scheme: light)`; `themeChoice()` in `src/web/theme-css.ts` erzeugt daraus die Profil-Auswahl Hell/Dunkel). Bestehende Basisklassen (`.card`, Knöpfe in `.tk-screen`) bekommen den neuen Look, statt dass ein zweites Kartensystem entsteht. Neue Bausteine und alle UI-Icons liegen in `src/tracking/ui/kit/`, damit Web- und Tracking-Screens sie teilen. Bos Name und feste Bo-Texte kommen aus einem Modul.

**Tech Stack:** React 19, Vite (Web-Build; alles in `src/web/public/` landet automatisch im Offline-Precache), vitest mit Testing Library, CSS-Tokens.

**Spec:** `docs/design/DESIGN.md`, Brief „Dojo 1 Fundament“ in `docs/roadmap.md`. Bilder: `docs/design/moodboard/heute.html` im Browser öffnen.

## Global Constraints

- Keine festen Farbwerte in `src/web/web.css`, `src/tracking/ui/tracking.css`, `src/ui/style.css` (Test `tests/web/style-tokens.test.ts`); neue Werte nur als Token in `src/design/tokens.css`, mit hellem Wert oder `/* shared */`.
- **Ein Theme-Mechanismus:** helle Werte nur unter `@media (prefers-color-scheme: light)`. Nie handgeschriebene `:root[data-theme=…]`-Blöcke; die erzeugt `themeChoice()`.
- Schriftgrößen nur aus der Typskala `--text-*`.
- Fließtext: `'Zen Kaku Gothic New'` 400/500/700, selbst gehostet in `src/web/public/brand/`, Lizenz OFL daneben. Überschriften: Shojumaru (`--font-display`).
- Texte: natürliche deutsche ganze Sätze (`docs/language.md`); in der Oberfläche heißt Bo „Sensei“, nie „Coach“.
- Mindestens 44 px Tippfläche je Knopf.
- **Ablage für Dojo 2–5:** UI-Icons nur in `src/tracking/ui/kit/Icon.tsx` (ein Register, `currentColor`). Größere Bilder (Mahlzeit-Typen, Bos Szenen, Logo) als SVG-Dateien in `src/web/public/brand/`. Farben nur aus Tokens oder `currentColor`.
- Mac-App (`src/ui/**`, `src/main/**`) wird nicht angefasst. Geteilte Tokens trägt sie mit: `--bg` wird dunkler (`#18231b`) für Cockpit, Sheets, `.tk-seg` und Chat-Eingabe; das ist gewollt. Ihre Tests bleiben grün.
- Interne Namen bleiben: Tab-ID `'coach'`, `CoachScreen`, `CoachChat`, `src/coach/`. Nur sichtbarer Text ändert sich.
- Nicht während einer offenen Fahrt bauen oder `npm run app` ausführen (CLAUDE.md).

## Review Focus

1. Helles Schema (System hell oder Profil „Hell“): Bambus, Karten, Knöpfe lesbar; keine dunkle Kachel auf Papier.
2. Ohne Netz (PWA aus dem Precache): Schrift und Bambus laden trotzdem.
3. Sehr lange Seiten (Rezept, Verlauf): Bambus ohne Naht bis unten; der helle Verlauf oben bleibt oben (feste Höhe), statt sich über die Seite zu strecken.
4. Breite Bildschirme: Bambus liegt am rechten Rand der 640-px-Spalte, nicht am Fensterrand.
5. Ebenen: Profil-Knopf, Pausenleiste `.tk-rest`, Sheets und die feste Chat-Eingabe liegen unverändert übereinander (der Bambus darf keine neuen Stacking-Kontexte erzeugen).

---

### Task 1: Schrift, Tokens, Seitenhintergrund

**Files:**
- Create: `src/web/public/brand/zen-kaku-gothic-new-{400,500,700}.woff2`, `src/web/public/brand/OFL-ZenKakuGothicNew.txt`
- Modify: `src/design/tokens.css`, `src/web/web.css` (`html`, `body`, die 640-px-Literale), `src/tracking/ui/tracking.css:3` (`.tk-screen`), `.tk-picker` (gleiche Datei), übrige 640-px-Literale
- Test: `tests/web/style-tokens.test.ts`

**Interfaces:**
- Produces (Custom Properties, dunkel und hell): `--font-text`, `--bg-top`, `--page-bg` (das komplette Hintergrund-Rezept), `--card-soft`, `--kicker`, `--brush`, `--glow`, `--radius-button` (`.75rem`), `--content-max` (`640px`, shared). `--radius-card` wird `1.125rem`.

- [ ] **Step 1: Write the failing test** in `tests/web/style-tokens.test.ts`:

```ts
it('hosts Zen Kaku Gothic New itself and uses it for all web text', () => {
  const tokens = read(TOKENS);
  for (const w of [400, 500, 700]) {
    expect(tokens).toContain(`url('/brand/zen-kaku-gothic-new-${w}.woff2')`);
    expect(statSync(`src/web/public/brand/zen-kaku-gothic-new-${w}.woff2`).size).toBeGreaterThan(10_000);
  }
  expect(tokens).toMatch(/--font-text:\s*'Zen Kaku Gothic New'/);
  expect(read(WEB)).toMatch(/body\s*\{[^}]*font-family:\s*var\(--font-text\)/);
  expect(read(TRACKING)).toMatch(/\.tk-screen\s*\{[^}]*font-family:\s*var\(--font-text\)/);
});
it('defines the Dojo tokens in both schemes, light only under the media query', () => {
  const css = read(TOKENS);
  const [dark, light] = css.split('@media (prefers-color-scheme: light)');
  for (const t of ['--bg-top', '--card-soft', '--kicker', '--brush', '--glow', '--bamboo-tile', '--bamboo-shoot']) {
    expect(dark).toContain(`${t}:`);
    expect(light).toContain(`${t}:`);
  }
  expect(css).not.toMatch(/\[data-theme="(light|dark)"\]\s*\{[^}]*--/);
});
it('keeps the page background in one token with a fixed-height glow', () => {
  expect(read(TOKENS)).toMatch(/--page-bg:\s*radial-gradient\([^;]*600px[^;]*\)[^;]*var\(--bg\)/);
  expect(read(WEB)).toMatch(/html\s*\{[^}]*background:\s*var\(--page-bg\)/);
});
it('uses one content width token instead of 640px literals', () => {
  for (const f of [WEB, TRACKING]) expect(read(f).replace(/\/\*[\s\S]*?\*\//g, '')).not.toContain('640px');
});
```

- [ ] **Step 2: Run** `npx vitest run tests/web/style-tokens.test.ts` — Expected: FAIL.
- [ ] **Step 3: Fonts holen:** Latin-Subset der drei Schnitte als woff2 (CSS von `https://fonts.googleapis.com/css2?family=Zen+Kaku+Gothic+New:wght@400;500;700&display=swap` mit Browser-User-Agent abrufen, die `latin`-Dateien laden), OFL-Text dazulegen.
- [ ] **Step 4: Tokens und Regeln:** drei `@font-face` (`font-display: swap`); `--font-text: 'Zen Kaku Gothic New', var(--font-ui);`. Dunkel: `--bg-top: #2a3d2e; --bg: #18231b; --card-soft: rgba(245,236,216,.06); --kicker: #f2bd55; --brush: #f2bd55; --glow: rgba(239,171,118,.38);`. Hell: `--bg-top: #fffaf0; --card-soft: rgba(34,55,43,.05); --kicker: #9a6a00; --brush: #e0a83a; --glow: rgba(239,171,118,.30);`. `--page-bg: radial-gradient(120% 600px at 50% 0, var(--bg-top), transparent) no-repeat, var(--bg);` `html { background: var(--page-bg); }`, `body` und `.tk-screen`/`.tk-picker` auf `var(--font-text)`. Alle `640px` in `web.css`/`tracking.css` durch `var(--content-max)` ersetzen (in `calc()` gleichwertig).
- [ ] **Step 5: Run** den Test, dann `npm test` — Expected: PASS.
- [ ] **Step 6: Commit** `feat(design): Zen Kaku Gothic New, Dojo tokens, page background`.

### Task 2: Bambus, der mitwächst

**Files:**
- Create: `src/web/public/brand/bamboo-tile-{dark,light}.svg`, `bamboo-shoot-{dark,light}.svg` (Kopien aus `docs/design/assets/`; die Farben dort sind die einzigen Bambusfarben)
- Modify: `src/design/tokens.css` (`--bamboo-tile`, `--bamboo-shoot`), `src/web/web.css` (`.web-main`)
- Test: `tests/web/bamboo.test.ts`

**Interfaces:**
- Produces: Tokens `--bamboo-tile`, `--bamboo-shoot` (je `url(...)`, dunkel auf `:root`, hell unter der Media-Query).

- [ ] **Step 1: Write the failing test** `tests/web/bamboo.test.ts`:

```ts
it('ships seamless bamboo tiles for both schemes', () => {
  for (const s of ['dark', 'light']) {
    expect(readFileSync(`src/web/public/brand/bamboo-tile-${s}.svg`, 'utf8')).toMatch(/viewBox="0 0 390 900"/);
    expect(readFileSync(`src/web/public/brand/bamboo-shoot-${s}.svg`, 'utf8')).toContain('<svg');
  }
  const [dark, light] = readFileSync('src/design/tokens.css', 'utf8').split('@media (prefers-color-scheme: light)');
  expect(dark).toContain("--bamboo-tile: url('/brand/bamboo-tile-dark.svg')");
  expect(light).toContain("--bamboo-tile: url('/brand/bamboo-tile-light.svg')");
});
it('paints the bamboo as backgrounds of .web-main, scrolling with the content, without new layers', () => {
  const rule = readFileSync('src/web/web.css', 'utf8').match(/\.web-main\s*\{[^}]*\}/g)!.join(' ');
  expect(rule).toMatch(/background:[^;]*var\(--bamboo-shoot\)[^;]*no-repeat[^;]*var\(--bamboo-tile\)[^;]*repeat-y/);
  expect(rule).not.toMatch(/z-index|isolation/);
  expect(readFileSync('src/web/web.css', 'utf8')).not.toMatch(/\.web-main::(before|after)/);
});
```

- [ ] **Step 2: Run** `npx vitest run tests/web/bamboo.test.ts` — Expected: FAIL.
- [ ] **Step 3: Implement:** Dateien kopieren, Tokens setzen. `.web-main { background: var(--bamboo-shoot) left bottom / 40px 240px no-repeat, var(--bamboo-tile) min(100%, calc(50% + var(--content-max) / 2 - 195px)) top / 390px 900px repeat-y; min-height: 100dvh; }` — die x-Position legt die rechte Kante der Kachel an die rechte Kante der Inhaltsspalte (Prozent in `background-position` beziehen sich auf Container minus Bild). Kein Pseudo-Element, kein `z-index`.
- [ ] **Step 4: Run** den Test — Expected: PASS. Dann `npm run dev:sim`, Web-App bei 390 px und bei 1200 px Breite öffnen: Bambus rechts an der Spalte, lange Seite ohne Naht bis unten, Profil „Hell“ zeigt die helle Kachel, Pausenleiste und Profil-Knopf liegen wie vorher.
- [ ] **Step 5: Commit** `feat(design): bamboo grows with the page`.

### Task 3: Bausteine (Karte, Kicker, Pinseltitel, Hauptkarte, Sprechblase, Knöpfe)

**Files:**
- Create: `src/tracking/ui/kit/Dojo.tsx`, `src/tracking/ui/bo.ts`
- Modify: `src/tracking/ui/kit/index.ts` (Export und Kopfkommentar), `src/tracking/ui/tracking.css` (`.card`, Basisknopf in `.tk-screen`, neue Klassen `tk-kicker`, `tk-brush`, `tk-bubble`, `tk-bubble-tail`), `src/web/today/CoachLine.tsx`; tote Regeln `.tk-coachline`, `.tk-coachask` (und `.tk-pandahead`, falls danach unbenutzt) löschen
- Test: `tests/web/dojo-kit.test.tsx`

**Interfaces:**
- Produces:
  - `src/tracking/ui/bo.ts`: `export const BO = { name: 'Bo', role: 'Sensei', ask: 'Frag Bo, deinen Sensei', title: 'Bo, dein Sensei' } as const;`
  - `Card({ soft = false, label, children }: { soft?: boolean; label?: string; children: ReactNode })` → `<section className={soft ? 'card soft' : 'card'} aria-label={label}>`. Die vorhandene Klasse `.card` bekommt den Dojo-Look (Radius `--radius-card`, 1 px `--line`, Hintergrund `--card`; `.card.soft` mit `--card-soft`). Kein zweites Kartensystem.
  - `Kicker({ children })` → `<p className="tk-kicker">`.
  - `BrushTitle({ children, level = 2 }: { children: ReactNode; level?: 2 | 3 })` → Überschrift in `--font-display`, Großbuchstaben per CSS, darunter Pinsel-SVG (`aria-hidden`, Farbe `--brush`), Pfad aus `docs/design/moodboard/heute.html` („OBERKÖRPER“).
  - `MainCard({ kicker, title, text, primary, secondary }: { kicker: string; title: string; text?: ReactNode; primary: { label: string; onClick: () => void }; secondary?: { label: string; onClick: () => void } })` → `Card` mit `Kicker`, `BrushTitle`, Text, Hauptknopf und Nebenknopf (Rahmen). Das ist die „Jetzt dran“-Karte, die auf allen Screens gleich aussieht.
  - `Bubble({ children, actions, tail = 'left' }: { children: ReactNode; actions?: ReactNode; tail?: 'left' | 'none' })` → `.tk-bubble` mit Dreieck `.tk-bubble-tail`.
  - `BoBubble({ children, actions, pose, portrait = 'full' }: { …; pose?: PandaGesture | null; portrait?: 'full' | 'mini' | 'none' })` → `PandaPortrait` mit Lichtschein `--glow` (nur bei `full`/`mini`) plus `Bubble`. Dojo 2 stellt `ChatBubble`/`.tk-msg` auf `Bubble` um.
  - Knöpfe: Der Basisknopf in `.tk-screen` (heute schon der Hauptknopf im Kit) bekommt Höhe ≥ 50 px, Radius `--radius-button`, Schatten mit `--glow`; `button.primary` bleibt Alias derselben Regel. Nebenknopf = vorhandene Rahmenvariante mit `--radius-button`.
  - Reserviert für Dojo 2 (noch nicht bauen, nur im Kopfkommentar nennen): `RowCard`, `WeekPath`.

- [ ] **Step 1: Write the failing test** `tests/web/dojo-kit.test.tsx`:

```tsx
it('builds the main card from the shared card, kicker and brush title', () => {
  const go = vi.fn();
  render(<MainCard kicker="Jetzt dran" title="Oberkörper" text="Krafttraining, etwa 45 Minuten" primary={{ label: 'Training starten', onClick: go }} secondary={{ label: 'Ansehen', onClick: () => {} }} />);
  const card = screen.getByRole('region', { name: 'Jetzt dran' });
  expect(card).toHaveClass('card');
  expect(card.querySelector('.tk-kicker')?.textContent).toBe('Jetzt dran');
  expect(within(card).getByRole('heading', { level: 2, name: 'Oberkörper' })).toBeInTheDocument();
  fireEvent.click(within(card).getByRole('button', { name: 'Training starten' }));
  expect(go).toHaveBeenCalled();
});
it('lets Bo speak in a bubble, with or without his portrait', () => {
  const { rerender } = render(<BoBubble actions={<button type="button">{BO.ask}</button>}>Heute kommt das dritte Training.</BoBubble>);
  expect(document.querySelector('.tk-bubble')).toHaveTextContent('Heute kommt das dritte Training.');
  expect(screen.getByRole('button', { name: 'Frag Bo, deinen Sensei' })).toBeInTheDocument();
  expect(document.querySelector('.tk-panda')).not.toBeNull();
  rerender(<BoBubble portrait="none">Nur die Blase.</BoBubble>);
  expect(document.querySelector('.tk-panda')).toBeNull();
  expect(document.querySelector('.tk-bubble-tail')).not.toBeNull();
});
```

- [ ] **Step 2: Run** `npx vitest run tests/web/dojo-kit.test.tsx` — Expected: FAIL.
- [ ] **Step 3: Implement** `bo.ts`, `Dojo.tsx`, die CSS-Regeln (nur Tokens). `CoachLine` nutzt `BoBubble` mit `BO.ask` als Knopftext (Props nach außen unverändert). Kopfkommentar in `kit/index.ts` ergänzen: wann `Row`, wann `Card`, `MainCard` als einzige „Jetzt dran“-Karte, Bo spricht nur über `Bubble`/`BoBubble`, Icons nur über `Icon`, Hauptknopf/Nebenknopf-Rollen.
- [ ] **Step 4: Run** den Test und `npx vitest run tests/web/heute-panda.test.tsx` (dort sucht ein Test `'Satz vom Coach'`; er wird in Task 5 umgestellt, hier nur prüfen, dass das Verhalten gleich bleibt) — Expected: PASS.
- [ ] **Step 5: Commit** `feat(design): shared Dojo cards, main card, Bo's bubble and buttons`.

### Task 4: Icon-Register, Tab-Leiste, Profil als Panda-Knopf

**Files:**
- Create: `src/tracking/ui/kit/Icon.tsx`
- Modify: `src/tracking/ui/kit/index.ts`, `src/web/app/Shell.tsx:113-145`, `src/web/web.css` (`.web-nav`, `.web-profile`)
- Test: `tests/web/app/shell.test.tsx`, `tests/web/dojo-kit.test.tsx`

**Interfaces:**
- Produces: `export type IconName = 'heute' | 'woche' | 'kraft' | 'essen' | 'ausdauer' | 'profil';` und `Icon({ name, size = 24 }: { name: IconName; size?: number })` → SVG `aria-hidden`, `data-icon={name}`, nur `currentColor`. Pfade aus `docs/design/moodboard/heute.html` (`<nav aria-label="Seiten">` und Profil-Knopf). Dojo 2–5 erweitern nur dieses Register.
- Tab → Icon in `Shell.tsx`: `heute→heute`, `coach→woche`, `training→kraft`, `essen→essen`, `ausdauer→ausdauer`.

- [ ] **Step 1: Write the failing tests.** In `tests/web/dojo-kit.test.tsx`:

```tsx
it('draws every registered icon with currentColor only', () => {
  for (const name of ['heute', 'woche', 'kraft', 'essen', 'ausdauer', 'profil'] as const) {
    const { container, unmount } = render(<Icon name={name} />);
    const svg = container.querySelector(`svg[data-icon="${name}"]`)!;
    expect(svg.getAttribute('aria-hidden')).toBe('true');
    expect(svg.outerHTML).not.toMatch(/#[0-9a-f]{3,8}/i);
    unmount();
  }
});
```

In `tests/web/app/shell.test.tsx` (mit `boot()` aus `tests/web/app/helpers.tsx`; Essen über `flags: { 'pandafit.essensplan.anna': 'on' }`, Ausdauer über einen `seed` mit einem Lauf- oder Rad-Record wie in `tests/web/app/run.test.tsx`):

```tsx
it('shows every tab with its icon and the profile as a panda button', async () => {
  await boot({ flags: { 'pandafit.essensplan.anna': 'on' }, seed: [aRun] });
  const nav = await screen.findByRole('navigation', { name: 'Seiten' });
  const buttons = within(nav).getAllByRole('button');
  expect(buttons.map((b) => b.textContent)).toEqual(['Heute', 'Woche', 'Kraft', 'Essen', 'Ausdauer']);
  expect(buttons.map((b) => b.querySelector('svg')?.getAttribute('data-icon'))).toEqual(['heute', 'woche', 'kraft', 'essen', 'ausdauer']);
  expect(screen.getByRole('button', { name: 'Profil' }).querySelector('svg[data-icon="profil"]')).not.toBeNull();
});
```

- [ ] **Step 2: Run** `npx vitest run tests/web/dojo-kit.test.tsx tests/web/app/shell.test.tsx` — Expected: FAIL.
- [ ] **Step 3: Implement:** Nav-Knopf = `Icon` über Label (Spalte, Label `--text-xs`), aktiv in `--accent-text` ohne Kartenfläche; Profil-Knopf mit `Icon name="profil"`, Rand `--field-line`.
- [ ] **Step 4: Run** die Tests, dann `npm test` — Expected: PASS.
- [ ] **Step 5: Commit** `feat(design): icon registry, tab bar with icons, panda profile button`.

### Task 5: Bo heißt Sensei

**Files:**
- Modify: sichtbare Texte mit „Coach“ in `src/web/**` und `src/tracking/ui/**` (`.ts` und `.tsx`, z. B. `src/web/swLogic.ts:38`); Push- und E-Mail-Texte in `src/coach/**` und `web-server/**`; Bos Persona im System-Prompt (`grep -rn "Coach" src/coach --include=*.ts`), damit er sich „Sensei“ nennt. Feste Bo-Texte kommen aus `BO` (`src/tracking/ui/bo.ts`); der Server spiegelt `BO.role` in seinen Texten.
- Modify (Tests mit alten Texten): `tests/web/heute-panda.test.tsx` (`'Satz vom Coach'`) und jeder weitere Test, den `grep -rln "Coach" tests/web tests/coach` mit sichtbarem Text findet.
- Test: `tests/web/sensei-wording.test.ts`

- [ ] **Step 1: Write the failing test** `tests/web/sensei-wording.test.ts` (`files(dir, exts)` sammelt rekursiv; `read` wie in `style-tokens.test.ts`):

```ts
// Sichtbarer Text: JSX-Text zwischen > und < (auch über Zeilen) und String-Literale. Bezeichner wie CoachScreen zählen nicht.
const VISIBLE = /(?:>[^<>{}]*\bCoach(?:es)?\b[^<>{}]*<)|(?:(['"`])(?:(?!\1)[\s\S])*?\bCoach(?:es)?\b(?:(?!\1)[\s\S])*?\1)/g;
const hits = (paths: string[]) => paths.flatMap((f) => [...read(f).replace(/^\s*import .*$/gm, '').matchAll(VISIBLE)].map((m) => `${f}: ${m[0].slice(0, 80)}`));

it('never calls Bo a coach in the web app', () => {
  expect(hits([...files('src/web', ['.ts', '.tsx']), ...files('src/tracking/ui', ['.ts', '.tsx'])])).toEqual([]);
});
it('never calls Bo a coach in push and e-mail texts', () => {
  expect(hits([...files('src/coach', ['.ts']), ...files('web-server', ['.ts'])].filter((f) => /push|mail|notif/i.test(f)))).toEqual([]);
});
it('takes the fixed Bo texts from one place', () => {
  expect(read('src/web/today/CoachLine.tsx')).toContain('BO.ask');
});
```

- [ ] **Step 2: Run** `npx vitest run tests/web/sensei-wording.test.ts` — Expected: FAIL mit der Liste der heutigen Stellen.
- [ ] **Step 3: Implement:** jede Stelle in natürlichem Deutsch, z. B. „Bo, dein Coach“ → `BO.title`, „Nachricht an den Coach“ → „Nachricht an Bo“, „Wann sich der Coach meldet“ → „Wann sich Bo meldet“, „Der Coach denkt nach …“ → „Bo denkt nach …“, „Dein Coach hat dir geschrieben.“ → „Bo hat dir geschrieben.“. Wo „Bo“ natürlicher ist als „Sensei“, „Bo“ nehmen. Falls der zweite Test Dateien trifft, deren Namen nicht zu `push|mail|notif` passen, die Filterliste im Test um diese Dateien erweitern.
- [ ] **Step 4: Run** `npm test` — Expected: PASS (umgestellte Tests eingeschlossen).
- [ ] **Step 5: Commit** `feat(copy): Bo is the Sensei`.

### Task 6: Abschluss

- [ ] **Step 1:** `npm run lint` und `npm test` — Expected: 0 Fehler, alles grün.
- [ ] **Step 2:** `npm run dev:sim`, Web-App bei 390 px mit `docs/design/moodboard/heute.html` vergleichen (Hintergrund, Schrift, Tab-Leiste, Profil-Knopf, Karten, Sprechblase), dunkel und hell, plus 1200 px Breite. Abweichungen, die die Abnahme nicht betreffen, in den Parkplatz.
- [ ] **Step 3:** Roadmap: Dojo 1 auf ✅, Plan nach `docs/archive/plans/`.
- [ ] **Step 4: Commit** `docs: Dojo 1 done`.
