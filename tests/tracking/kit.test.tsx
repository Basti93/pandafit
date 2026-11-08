// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { useState } from 'react';
import { afterEach, expect, test, vi } from 'vitest';
import { ChoiceRow, ConfirmLink, Row, RowList, Sheet, Switch } from '../../src/tracking/ui/kit';

afterEach(cleanup);

function Opener({ onClose = () => {} }: { onClose?: () => void }) {
  const [open, setOpen] = useState(false);
  return <><button type="button" onClick={() => setOpen(true)}>Öffnen</button>{open && <Sheet title="Eintrag" onClose={() => { setOpen(false); onClose(); }} actions={<button type="button">Speichern</button>}><p>Inhalt</p></Sheet>}</>;
}

test('the sheet opens with focus on it, locks the page behind, and closes on × and on Escape', () => {
  const closed = vi.fn();
  render(<Opener onClose={closed} />);
  const opener = screen.getByRole('button', { name: 'Öffnen' });
  opener.focus();
  fireEvent.click(opener);
  const dialog = screen.getByRole('dialog', { name: 'Eintrag' });
  expect(document.activeElement).toBe(dialog);
  expect(document.body.style.overflow).toBe('hidden');
  expect(screen.getByRole('button', { name: 'Speichern' })).toBeTruthy();
  fireEvent.click(screen.getByRole('button', { name: 'Schließen' }));
  expect(screen.queryByRole('dialog')).toBeNull();
  expect(document.body.style.overflow).toBe('');
  expect(document.activeElement).toBe(opener);
  fireEvent.click(opener);
  fireEvent.keyDown(document, { key: 'Escape' });
  expect(screen.queryByRole('dialog')).toBeNull();
  expect(closed).toHaveBeenCalledTimes(2);
});

/** The history of an earlier test (a closed sheet gives its entry back a moment later) has settled. */
const settled = () => new Promise((r) => setTimeout(r, 60));

test('the browser Back closes the sheet', async () => {
  await settled();
  render(<Opener />);
  fireEvent.click(screen.getByRole('button', { name: 'Öffnen' }));
  expect(screen.getByRole('dialog')).toBeTruthy();
  await waitFor(() => expect((history.state as { sheet?: string } | null)?.sheet).toBeTruthy()); // it has taken its history entry
  history.back();
  await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
});

function Swap() {
  const [which, setWhich] = useState<'a' | 'b' | null>(null);
  return (
    <>
      <button type="button" onClick={() => setWhich('a')}>A öffnen</button>
      {which === 'a' && <Sheet title="Blatt A" onClose={() => setWhich(null)}><button type="button" onClick={() => setWhich('b')}>Weiter zu B</button></Sheet>}
      {which === 'b' && <Sheet title="Blatt B" onClose={() => setWhich(null)}><p>Inhalt B</p></Sheet>}
    </>
  );
}

test('closing one sheet while another opens in the same handler leaves the new one open; Back then closes it', async () => {
  await settled();
  render(<Swap />);
  fireEvent.click(screen.getByRole('button', { name: 'A öffnen' }));
  await waitFor(() => expect((history.state as { sheet?: string } | null)?.sheet).toBeTruthy());
  fireEvent.click(screen.getByRole('button', { name: 'Weiter zu B' }));
  expect(screen.getByRole('dialog', { name: 'Blatt B' })).toBeTruthy();
  await new Promise((r) => setTimeout(r, 120)); // the old sheet's history.back() has long arrived
  expect(screen.getByRole('dialog', { name: 'Blatt B' })).toBeTruthy();
  await waitFor(() => expect((history.state as { sheet?: string } | null)?.sheet).toBeTruthy());
  history.back();
  await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
});

test('a small sheet is a dialog with a backdrop that closes it', () => {
  const closed = vi.fn();
  render(<Sheet size="small" title="Studio" onClose={closed}><p>Liste</p></Sheet>);
  expect(screen.getByRole('dialog', { name: 'Studio' }).className).toContain('tk-sheet-small');
  fireEvent.click(document.querySelector('.tk-sheet-backdrop')!);
  expect(closed).toHaveBeenCalled();
});

test('a switch row toggles from its label and states its hint', () => {
  const change = vi.fn();
  render(<Switch label="Benachrichtigungen" hint="Nur wenige." checked={false} onChange={change} />);
  const sw = screen.getByRole('switch', { name: 'Benachrichtigungen' });
  expect(sw.getAttribute('aria-describedby')).toBeTruthy();
  fireEvent.click(screen.getByText('Benachrichtigungen'));
  expect(change).toHaveBeenCalledWith(true);
});

test('the confirm link needs a second tap, and can be cancelled', () => {
  const go = vi.fn();
  render(<ConfirmLink label="Training löschen" onConfirm={go} />);
  fireEvent.click(screen.getByRole('button', { name: 'Training löschen' }));
  expect(go).not.toHaveBeenCalled();
  expect(screen.getByText('Wirklich löschen?')).toBeTruthy();
  fireEvent.click(screen.getByRole('button', { name: 'Abbrechen' }));
  expect(screen.getByRole('button', { name: 'Training löschen' })).toBeTruthy();
  fireEvent.click(screen.getByRole('button', { name: 'Training löschen' }));
  fireEvent.click(screen.getByRole('button', { name: 'Ja' }));
  expect(go).toHaveBeenCalledTimes(1);
});

test('a choice row shows the value, opens the options in a sheet and closes after choosing', () => {
  const change = vi.fn();
  render(<ChoiceRow label="Uhrzeit" value={19} options={[{ value: 18, label: '18:00' }, { value: 19, label: '19:00' }]} onChange={change} />);
  fireEvent.click(screen.getByRole('button', { name: /Uhrzeit/ }));
  fireEvent.click(screen.getByRole('button', { name: '18:00' }));
  expect(change).toHaveBeenCalledWith(18);
  expect(screen.queryByRole('dialog')).toBeNull();
});

test('a row with onClick is a button with a chevron and shows its details only while expanded', () => {
  const { rerender } = render(<RowList><Row title="Bankdrücken" value="70 kg" onClick={() => {}} expanded={false}>Details</Row></RowList>);
  expect(screen.getByRole('button', { name: /Bankdrücken/ }).getAttribute('aria-expanded')).toBe('false');
  expect(screen.queryByText('Details')).toBeNull();
  rerender(<RowList><Row title="Bankdrücken" value="70 kg" onClick={() => {}} expanded>Details</Row></RowList>);
  expect(screen.getByText('Details')).toBeTruthy();
});

test('row language: "›" opens a new page, "⌄" opens the row in place', () => {
  render(<RowList><Row title="Muskeln" onClick={() => {}} /><Row title="Ruhepuls" onClick={() => {}} expanded={false}>mehr</Row></RowList>);
  expect(screen.getByRole('button', { name: /^Muskeln/ }).textContent).toBe('Muskeln›');
  expect(screen.getByRole('button', { name: 'Ruhepuls' }).textContent).toBe('Ruhepuls⌄');
});

function Nested() {
  const [inner, setInner] = useState(false);
  const [outer, setOuter] = useState(true);
  return outer ? (
    <Sheet title="Außen" onClose={() => setOuter(false)}>
      <button type="button" onClick={() => setInner(true)}>Weiter</button>
      {inner && <Sheet title="Innen" onClose={() => setInner(false)}><p>Unterseite</p></Sheet>}
    </Sheet>
  ) : null;
}

test('one close pattern: × closes a sheet; a full sheet over another has "‹ Zurück" instead and leads back', () => {
  render(<Nested />);
  const outer = screen.getByRole('dialog', { name: 'Außen' });
  expect(screen.getByRole('button', { name: 'Schließen' })).toBeTruthy();
  expect(screen.queryByRole('button', { name: '‹ Zurück' })).toBeNull();
  fireEvent.click(screen.getByRole('button', { name: 'Weiter' }));
  const inner = screen.getByRole('dialog', { name: 'Innen' });
  expect(inner.querySelector('.tk-sheet-x')).toBeNull();
  fireEvent.click(screen.getByRole('button', { name: '‹ Zurück' }));
  expect(screen.queryByRole('dialog', { name: 'Innen' })).toBeNull();
  expect(outer.isConnected).toBe(true);
});

test('a sheet with onBack shows "‹ Zurück", and Escape goes back instead of closing', () => {
  const back = vi.fn();
  function Paged() { return <Sheet title="Verlauf" onClose={() => {}} onBack={back}><p>Training</p></Sheet>; }
  render(<Paged />);
  expect(screen.queryByRole('button', { name: 'Schließen' })).toBeNull();
  fireEvent.keyDown(document, { key: 'Escape' });
  expect(back).toHaveBeenCalledTimes(1);
  fireEvent.click(screen.getByRole('button', { name: '‹ Zurück' }));
  expect(back).toHaveBeenCalledTimes(2);
});
