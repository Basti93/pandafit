import type { TrackedRecord } from '../shared/records';
import { readTogether, TOGETHER_ID, type TogetherBody, type TogetherPerson } from '../shared/together';

const WEEK_MS = 7 * 86_400_000;
const LONG = { day: 'numeric', month: 'long', year: 'numeric' } as const;

/** The readable together record, or null: no Mac export yet, unlinked, or a shape this phone cannot draw. */
export const togetherOf = (records: TrackedRecord[] | null): TogetherBody | null => {
  const r = (records ?? []).find((x) => x.id === TOGETHER_ID);
  return r && !r.deleted ? readTogether(r.body) : null;
};

const standText = (atMs: number) => `Stand: ${new Date(atMs).toLocaleDateString('de-DE', { weekday: 'long', day: 'numeric', month: 'long' })}`;
const isThisWeek = (t: TogetherBody, now: number) => now >= t.week && now < t.week + WEEK_MS;
/** "Diese Woche" only while the record's week is the current one; an old snapshot names its week. */
const weekTitle = (t: TogetherBody, now: number) => (isThisWeek(t, now) ? 'Diese Woche' : `Woche vom ${new Date(t.week).toLocaleDateString('de-DE', { day: 'numeric', month: 'short' })}`);
/** The own person first, the others in the Mac's order. Never sorted by numbers. */
const ordered = (t: TogetherBody): TogetherPerson[] => [...t.people.filter((p) => p.profileId === t.you), ...t.people.filter((p) => p.profileId !== t.you)];
const rides = (n: number) => (n === 1 ? '1 Fahrt' : `${n} Fahrten`);
const shortDate = (ms: number) => new Date(ms).toLocaleDateString('de-DE', { weekday: 'short', day: 'numeric', month: 'short' });
const pct = (t: TogetherBody) => Math.max(0, Math.min(100, (t.peak.done / t.peak.total) * 100));

const PeakBar = ({ t }: { t: TogetherBody }) => (
  <div className="gm-bar" role="img" aria-label={`${t.peak.done} von ${t.peak.total} Höhenmetern`}><i style={{ width: `${pct(t)}%` }} /></div>
);

/** Compact, on Heute: this week for both, the latest rides, the mountain. The whole card opens the page. */
export function TogetherCard({ t, now, onOpen }: { t: TogetherBody; now: number; onOpen: () => void }) {
  return (
    <button type="button" className="card gm-card" aria-label={`Gemeinsam: ${weekTitle(t, now)}, ${t.peak.name}. Öffnen`} onClick={onOpen}>
      <span className="gm-head"><b>Gemeinsam</b><span aria-hidden="true">›</span></span>
      <span className="tk-section gm-label">{weekTitle(t, now)}</span>
      <span className="gm-people">
        {ordered(t).map((p) => (
          <span key={p.profileId} className="gm-person"><b>{p.name}</b><span>{p.ridesThisWeek === 0 ? 'noch frei' : `${rides(p.ridesThisWeek)}, ${p.minutesThisWeek} Min`}</span></span>
        ))}
      </span>
      {t.recent.length > 0 && (
        <span className="gm-recent">
          {t.recent.slice(0, 2).map((r, i) => <span key={i}>{shortDate(r.startedAtMs)}: {r.name}, {r.sessionName ?? 'Fahrt'}, {r.minutes} Min</span>)}
        </span>
      )}
      <span className="gm-peak">Auf dem Weg zum <b>{t.peak.name}</b>: {t.peak.done} von {t.peak.total} Hm</span>
      <PeakBar t={t} />
      <span className="gm-stand">{standText(t.atMs)}</span>
    </button>
  );
}

/** The Mac's together page for the phone: the same sections, one column. Only time and regularity, no watts. */
export function TogetherPage({ t, now, onBack }: { t: TogetherBody; now: number; onBack: () => void }) {
  const people = ordered(t);
  const max = Math.max(30, ...people.flatMap((p) => p.weeks));
  return (
    <div className="tk-screen gm">
      <div className="tk-row"><h1 className="tk-title">Gemeinsam</h1><span className="spacer" /><button type="button" className="link" onClick={onBack}>Zurück</button></div>
      <p className="muted gm-stand">{standText(t.atMs)}{isThisWeek(t, now) ? '' : '. Neue Zahlen kommen, sobald der Mac wieder an ist.'}</p>
      <section className="card">
        <h2>Euer Berg</h2>
        <p>Auf dem Weg zum <b>{t.peak.name}</b></p>
        <PeakBar t={t} />
        <p className="muted">Ihr habt {t.peak.done} von {t.peak.total} Höhenmetern geschafft. Jede Minute zählt 10 Höhenmeter, für alle gleich. Danach: {t.peak.next}.</p>
        <h3 className="tk-section gm-label">{weekTitle(t, now)}</h3>
        <ul className="gm-list">
          {people.map((p) => (
            <li key={p.profileId}><b>{p.name}</b><span>{rides(p.ridesThisWeek)}, {p.minutesThisWeek} Min{p.wordsLearned > 0 ? `, ${p.wordsLearned} Wörter` : ''}</span></li>
          ))}
        </ul>
      </section>
      {t.climbing.length > 0 && (
        <section className="card">
          <h2>Unterwegs am Berg</h2>
          <ul className="gm-list">
            {t.climbing.map((c, i) => <li key={i}><b>{c.name}</b><span>{c.who}, {c.pct} %</span><div className="gm-bar gm-bar-thin"><i style={{ width: `${Math.max(0, Math.min(100, c.pct))}%` }} /></div></li>)}
          </ul>
        </section>
      )}
      {t.climbed.length > 0 && (
        <section className="card">
          <h2>Bezwungene Berge</h2>
          <ul className="gm-list gm-stack">
            {t.climbed.map((c, i) => <li key={i}><b>{c.name}</b><span>{c.who}, {new Date(c.atMs).toLocaleDateString('de-DE', LONG)}</span></li>)}
          </ul>
        </section>
      )}
      {t.summits.length > 0 && (
        <section className="card">
          <h2>Euer Gipfelbuch</h2>
          <ul className="gm-list gm-stack">
            {[...t.summits].reverse().map((s, i) => <li key={i}><b>{s.name}</b><span>gemeinsam erreicht am {new Date(s.atMs).toLocaleDateString('de-DE', LONG)}</span></li>)}
          </ul>
        </section>
      )}
      <section className="card">
        <h2>Die letzten 12 Wochen</h2>
        <table className="gm-rhythm">
          <tbody>
            {people.map((p) => (
              <tr key={p.profileId}>
                <th>{p.name}</th>
                {p.weeks.map((m, i) => (
                  <td key={i} title={`${m} Minuten, ${i === p.weeks.length - 1 ? 'diese Woche' : `vor ${p.weeks.length - 1 - i} Wochen`}`}>
                    <div className="gm-cell" style={m ? { background: 'var(--good)', opacity: 0.25 + 0.75 * (m / max) } : undefined} />
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
        <p className="muted">Je kräftiger, desto mehr Minuten in der Woche. Rechts ist die Woche vom Stand.</p>
      </section>
      <section className="card">
        <h2>Zuletzt gefahren</h2>
        {t.recent.length === 0 && <p className="muted">Noch keine Fahrt.</p>}
        <ul className="gm-list">
          {t.recent.map((r, i) => <li key={i}><b>{r.name}</b><span>{shortDate(r.startedAtMs)}, {r.sessionName ?? 'Fahrt'}, {r.minutes} Min</span></li>)}
        </ul>
      </section>
    </div>
  );
}
