/**
 * The calm UI kit. Every screen builds from these few pieces; the CSS is the "Calm UI kit" block in ../tracking.css.
 *
 * Rows, not cards: a list item is a Row (title left, short muted value right, "›" when it opens a new page, "⌄" when it opens in place) inside a RowList.
 *   Cards are for the one main thing on a screen or a group. Never a card inside a card (a nested .card is flattened by the CSS).
 * Buttons (plain <button> classes):
 *   (none) or "primary"  filled orange; at most one per screen or sheet, the next action.
 *   "secondary"          outline.
 *   "link" (or "ghost")  a text link, for the quiet third choice.
 *   "danger-link"        muted red text link for Löschen, Verwerfen, Entfernen. Use ConfirmLink; never next to the primary button.
 * Sheet: forms, pickers, chat and edit dialogs. Full screen, title, × top right, sticky action area, body behind stays put, Back or Escape closes.
 *   One close pattern: × closes; a sub-sheet (a full sheet over another, or `onBack`) has "‹ Zurück" top left instead. "Fertig" only where it really saves.
 *   It sits above all app chrome (header, profile button, rest bar, nav) with an opaque background.
 *   size="small": a bottom sheet of auto height (max 70 %) over a dimmed backdrop, for option lists of up to about six entries
 *   (studio, Anderes Training, the menus, Etwas anderes heute, ChoiceRow). A sheet that opens in the same commit as another closes never pops the new one.
 * PageHead: the page title, an optional muted subtitle, and room for the profile button; 16 px before the first card.
 *   One pattern: the title on top, a switch (.tk-seg) below it, no second title for the chosen half.
 * Switch: a row with the label left and the switch right, the whole row taps. It replaces checkboxes.
 * ChoiceRow: "Label  Wert ›" that opens a small Sheet with the options. It replaces selects with more than a couple of options.
 * Details on demand: numbers, statistics, explanations and credits sit behind "Details" or in the opened row. Muted help text is one line.
 * Only one open: expandable rows pass `expanded`; the "⌄" turns, and the parent keeps a single open id.
 * Spacing is a 8 px grid (.5rem steps), headings are one title (.tk-title) and small section headings (.tk-section). Dates: ../../shared/dates.ts (de-DE).
 */
export { ExpandMark, Row, RowList } from './Row';
export { Sheet } from './Sheet';
export { PageHead } from './PageHead';
export { Switch } from './Switch';
export { ChoiceRow } from './ChoiceRow';
export { ConfirmLink } from './ConfirmLink';
