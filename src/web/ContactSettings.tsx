import { useState } from 'react';
import { contactOf, contactRecord, isEmail, updatesOf } from '../shared/contact';
import { Row, RowList, Sheet, Switch } from '../tracking/ui/kit';
import { usePortRecords } from '../tracking/ui/hooks';
import type { WebPort } from './webPort';

/** The sub switch for the new-version notice; it keeps email and weekly as they are. */
export function UpdatesSwitch({ port, now }: { port: WebPort; now: () => number }) {
  const all = usePortRecords(port, 'contact').all;
  const have = (all ?? []).find((r) => r.kind === 'contact' && r.id === 'contact');
  const contact = contactOf(all ?? []);
  return (
    <div className="tk-group tk-indent">
      <Switch label="Neue Version" hint="Hinweis, wenn Pandafit aktualisiert wurde" checked={updatesOf(all ?? [])}
        onChange={(updates) => void port.put(contactRecord({ ...contact, updates }, now(), have))} />
    </div>
  );
}

/** The address for the weekly overview, and its switch. Writes go through the normal record put, stamped above the stored one. */
export function ContactSettings({ port, now }: { port: WebPort; now: () => number }) {
  const all = usePortRecords(port, 'contact').all;
  const have = (all ?? []).find((r) => r.kind === 'contact' && r.id === 'contact');
  const contact = contactOf(all ?? []);
  const [open, setOpen] = useState(false);
  const [text, setText] = useState('');
  const [bad, setBad] = useState(false);
  const save = (next: { email: string | null; weekly: boolean }) => port.put(contactRecord(next, now(), have));
  const show = () => { setText(contact.email ?? ''); setBad(false); setOpen(true); };
  const submit = () => {
    const email = text.trim();
    if (!isEmail(email)) { setBad(true); return; }
    void save({ email, weekly: contact.weekly });
    setOpen(false);
  };
  const remove = () => { void save({ email: null, weekly: false }); setOpen(false); };
  return (
    <>
      <RowList>
        <Row title="E-Mail" value={contact.email ?? 'keine'} onClick={show} />
      </RowList>
      <Switch label="Wochenübersicht per E-Mail" hint="Sonntagabend: Rückblick und nächste Woche"
        checked={contact.weekly && contact.email !== null} disabled={contact.email === null}
        onChange={(weekly) => void save({ email: contact.email, weekly })} />
      {open && (
        <Sheet title="E-Mail" size="small" onClose={() => setOpen(false)}
          actions={<><button type="button" className="primary" onClick={submit}>Speichern</button>{contact.email !== null && <button type="button" className="link" onClick={remove}>Entfernen</button>}</>}>
          <form onSubmit={(e) => { e.preventDefault(); submit(); }}>
            <input type="email" autoComplete="email" aria-label="E-Mail-Adresse" autoFocus value={text} onChange={(e) => { setText(e.target.value); setBad(false); }} />
            {bad && <p role="alert" className="muted">Bitte eine gültige Adresse</p>}
          </form>
        </Sheet>
      )}
    </>
  );
}
