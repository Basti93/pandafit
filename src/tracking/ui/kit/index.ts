/**
 * The calm UI kit. Every screen builds from these few pieces; the CSS is the "Calm UI kit" block in ../tracking.css.
 *
 * Dojo pieces (Dojo.tsx): Card (the one .card; `soft` for a quieter group), Kicker, BrushTitle, MainCard, Bubble, BoBubble.
 *   MainCard is the only "Jetzt dran" card: every screen shows its main next thing through it, never a hand-built copy.
 *   Role, ask and title come only from ../bo.ts; sentences may name Bo directly. Icons come only through Icon.
 *   Main button = filled (MainCard `primary`), side button = outline (`secondary`). Tag is the small green label with a check.
 *   RowCard (RowCard.tsx) is the only row card with an icon tile (DESIGN "Zeilenkarte"); Row stays the plain text row without icon (lists, settings). WordTile is the only word tile.
 *   StandCard is the one orientation card "… · diese Woche" (Kraft, Rad, Laufen); Segments the one switch between sub pages; PillButton the one pill (quiet side action and back);
 *   MarkDot the one state dot (done, now, open; button dots in a row need a gap of at least 16 px); Band the one part bar.
 *   RoundButton is the one round icon button; BackButton is the one back button of pages (RoundButton, or a PillButton with a label); Sheet `page` is for pages like the chat (BackButton instead of ×).
 * Rows, not cards: a list item is a Row (title left, short muted value right, "›" when it opens a new page, "⌄" when it opens in place) inside a RowList.
 *   Cards are for the one main thing on a screen or a group. Never a card inside a card (a nested .card is flattened by the CSS).
 * Buttons (plain <button> classes), one look per role:
 *   "primary"            filled accent, 50 px, glow: the one main action of a card or sheet (start, resume, save, take a proposal). Unclassed buttons are filled, 44 px, no glow (old screens; Dojo 2-5 add class="primary").
 *   "secondary"          outline: every other real action and every jump to another place ("Bo fragen", "Ansehen", "Woche planen").
 *   "link"               text: only quiet, optional or dismissing actions ("Heute nicht", "Abbrechen", "Details", "Später"). No side padding: it lines up with the text.
 *   ".tk-textseg"        a text switch between two views ("Diese Woche" / "Nächste Woche"): link look with aria-pressed; the pressed one is bold.
 *   "danger-link"        muted red text: only delete and remove. Use ConfirmLink; never next to the primary button.
 *   Exception: the ride display (LiveRide) keeps 64 px outline buttons for use on the bike.
 * Other controls, one look each (CSS in ../tracking.css unless said):
 *   Chips (.tk-chips > button, aria-pressed)  every toggle choice: thin pill, chosen = accent ring and bold. Only tappable things are pills; a tag is muted text.
 *   Segments (kit)  Kraft, Ausdauer, Essen Tage/Einkauf, Darstellung: one pill with segments.
 *   Stepper (button.tk-step-btn)  − count +: a 44 px round outline button.
 *   Round icon buttons (day arrows, profile)  44 px, card fill, thin line.
 *   Callout (.tk-note)  card fill with a 4 px bar on the left, for a note or a warning; never a card inside a card.
 * Sheet: forms, pickers, chat and edit dialogs. Full screen, title, × top right, sticky action area, body behind stays put, Back or Escape closes.
 *   One close pattern: × closes; a sub-sheet (a full sheet over another, or `onBack`) has "‹ Zurück" top left instead. "Fertig" only where it really saves.
 *   It sits above all app chrome (header, profile button, rest bar, nav) with an opaque background.
 *   size="small": a bottom sheet of auto height (max 70 %) over a dimmed backdrop, for option lists of up to about six entries
 *   (studio, Anderes Training, the menus, Etwas anderes heute, ChoiceRow). A sheet that opens in the same commit as another closes never pops the new one.
 * PageHead: the page title, an optional muted subtitle, and room for the profile button; 16 px before the first card.
 *   One pattern: the title on top, a Segments switch below it, no second title for the chosen half.
 * Switch: a row with the label left and the switch right, the whole row taps. It replaces checkboxes.
 * ChoiceRow: "Label  Wert ›" that opens a small Sheet with the options. It replaces selects with more than a couple of options.
 * Details on demand: numbers, statistics, explanations and credits sit behind "Details" or in the opened row. Muted help text is one line.
 * Only one open: expandable rows pass `expanded`; the "⌄" turns, and the parent keeps a single open id.
 * Spacing is a 8 px grid (.5rem steps), headings are one title (.tk-title) and small section headings (.tk-section). Dates: ../../shared/dates.ts (de-DE).
 */
export { ExpandMark, Row, RowList } from './Row';
export { Sheet, useBackEntry } from './Sheet';
export { PageHead } from './PageHead';
export { Switch } from './Switch';
export { ChoiceRow } from './ChoiceRow';
export { ConfirmLink } from './ConfirmLink';
export { AskBoButton, BackButton, BrushTitle, BoBubble, Bubble, Card, Kicker, MainCard, PillButton, RoundButton, SeeProposalButton, Tag } from './Dojo';
export { BoScene } from './BoScene';
export type { BoPlace } from './BoScene';
export { RowCard, WordTile } from './RowCard';
export { WeekPath } from './WeekPath';
export { Band, MarkDot, StandCard } from './StandCard';
export type { Mark } from './StandCard';
export { Segments } from './Segments';
export { Icon } from './Icon';
export type { IconName } from './Icon';
