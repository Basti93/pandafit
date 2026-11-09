import { useState } from 'react';
import { feelAsked, RunFeelQuestion } from './RunFeel';
import { ReviewList } from './RunLookBack';
import { BoBubble, Card, Kicker, MainCard, Row, RowCard, RowList, Sheet, StandCard, Switch } from './kit';
import { BO_LINES } from './bo';
import { useSportWeek } from './sport-week';
import { dayMonthLongOfKey, shortDateOfKey, weekdayOfKey } from '../../shared/dates';
import type { TrackedRecord } from '../../shared/records';
import { manualRunId, paceText, runSendId, weekFp, type PlannedRun, type RunGarmin, type RunNumbers, type RunSendBody, type RunFeelBody, runFeelId, type RunWeekBody, type RunReviewBody, type ManualRunBody } from '../../shared/run';
import type { TrackingPort } from '../ports';
import { usePortRecords } from './hooks';
import { writeSettings } from './RunSettingsCard';
import { DAY_NAMES, DAY_SHORT, dateKeyOf, kmFromKm, nextUpdatedMs, runTrendSentence, runView } from './run-view';

const KIND: Record<PlannedRun['kind'], string> = { easy: 'Ruhiger Lauf', long: 'Langer, ruhiger Lauf', test: 'Testlauf über 30 Minuten' };
const CHANGED = 'Der Plan hat sich geändert. Bitte bestätige noch einmal, dann geht die neue Version an Garmin.';
const STALE = 'Inzwischen gibt es einen neueren Plan. Bitte schau ihn dir an und bestätige noch einmal.';
const LEFT_ON_WATCH = 'Auf deiner Uhr sind noch geplante Läufe. Sollen sie entfernt werden?';
const FIRST_PLAN = 'Laufen ist an. Dein Laufplan erscheint hier, sobald Bo ihn angelegt hat.';
const PAUSE = 'Laufen pausiert, solange die Beschwerde offen ist. Sobald sie vorbei ist, geht es ruhig weiter.';
const GENTLE = 'Wir planen gerade sanft.';
const FAILED = 'Das Senden hat gerade nicht geklappt. Du kannst es später noch einmal versuchen.';

/** "{minutes} Minuten, Puls bis {cap}." In whole sentences; only a test run adds what counts, and "Heute" there becomes the weekday on another day. */
const runText = (r: PlannedRun, todayKey: string): string => {
  const counts = r.kind !== 'test' || !r.counts ? '' : r.date === todayKey ? r.counts : r.counts.replace(/(^|\. )Heute /g, `$1Am ${weekdayOfKey(r.date)} `);
  return `${r.minutes} Minuten${r.hrCap !== null ? `, Puls bis ${r.hrCap}` : ''}.${counts ? ` ${counts}` : ''}`;
};

/** "Di und Sa", "Di, Do und Sa". */
const dayList = (days: number[]): string => { const n = days.map((d) => DAY_SHORT[d]!); return n.length < 2 ? n.join('') : `${n.slice(0, -1).join(', ')} und ${n.at(-1)}`; };

const num = (s: string): number | null => {
  const n = Number(s.trim().replace(',', '.'));
  return s.trim() !== '' && Number.isFinite(n) ? n : null;
};

function Suggestion({ onAnswer }: { onAnswer: (on: boolean) => void }) {
  return (
    <MainCard kicker="Laufen" title="Laufen mitplanen"
      text="Pandafit hat Läufe von deiner Uhr gefunden. Soll Pandafit dein Laufen mitplanen?"
      primary={{ label: 'Laufen einschalten', onClick: () => onAnswer(true) }}
      more={<button type="button" className="link" onClick={() => onAnswer(false)}>Nicht jetzt</button>} />
  );
}

type Answers = { runsPerWeek: number; usualMinutes: number; pain: boolean };
/** The questions on running. First time they sit on the page; later they open as a sheet ("Lauftage"). */
function Questions({ suggested, saved, onSave, onCancel }: {
  suggested: number[]; saved: { answers: Answers | null; weekdays: number[] | null } | null;
  onSave: (a: Answers, days: number[]) => void; onCancel?: () => void;
}) {
  const start = saved?.weekdays?.length ? saved.weekdays : suggested;
  const [perWeek, setPerWeek] = useState(String(saved?.answers?.runsPerWeek ?? (start.length || 3)));
  const [minutes, setMinutes] = useState(String(saved?.answers?.usualMinutes ?? 30));
  const [pain, setPain] = useState(saved?.answers?.pain ?? false);
  const [days, setDays] = useState<number[]>(start);
  const toggle = (d: number) => setDays((x) => (x.includes(d) ? x.filter((y) => y !== d) : [...x, d].sort((a, b) => a - b)));
  const p = num(perWeek);
  const m = num(minutes);
  const ok = days.length > 0 && p !== null && p >= 1 && p <= 7 && m !== null && m >= 5 && m <= 300;
  const save = <button type="button" className="primary" disabled={!ok} onClick={() => ok && onSave({ runsPerWeek: Math.round(p), usualMinutes: Math.round(m), pain }, days)}>Speichern</button>;
  const fields = (
    <>
      <div role="group" aria-label="An welchen Tagen möchtest du laufen?" className="tk-field">
        <span>An welchen Tagen möchtest du laufen?</span>
        <div className="tk-dayrow">
          {DAY_NAMES.map((n, d) => (
            <button key={n} type="button" aria-label={n} aria-pressed={days.includes(d)} className={`tk-day${days.includes(d) ? '' : ' secondary'}`} onClick={() => toggle(d)}>{DAY_SHORT[d]}</button>
          ))}
        </div>
      </div>
      <label className="tk-field">Wie oft läufst du zurzeit?
        <input inputMode="numeric" value={perWeek} onChange={(e) => setPerWeek(e.target.value)} />
      </label>
      <label className="tk-field">Wie lange dauert ein Lauf meist (Minuten)?
        <input inputMode="numeric" value={minutes} onChange={(e) => setMinutes(e.target.value)} />
      </label>
      <Switch label="Hast du beim Laufen gerade Schmerzen?" hint="Dann plant Bo sanfter." checked={pain} onChange={setPain} />
    </>
  );
  if (onCancel) return <Sheet title="Lauftage" onClose={onCancel} actions={save}><div className="tk-form">{fields}</div></Sheet>;
  return <Card><div className="tk-form">{fields}<div className="tk-row">{save}</div></div></Card>;
}

function GarminBlock({ week, pending, onSend }: { week: RunWeekBody; pending: boolean; onSend: () => void }) {
  const g: RunGarmin | null = week.garmin;
  if (!g) return null; // no Garmin object: the bridge is not ready, so nothing is offered
  const status = g.status;
  if (status === 'sent') return <p className="tk-garmin">Auf deiner Uhr</p>;
  return (
    <div className="tk-garmin">
      {status === 'changed' && <p role="status">{CHANGED}</p>}
      {status === 'stale' && <p role="status">{STALE}</p>}
      {status === 'failed' && <p role="status">{FAILED}</p>}
      <button type="button" className="secondary" disabled={status === 'sending' || pending} onClick={onSend}>An Garmin senden</button>
    </div>
  );
}

const minKm = (sPerKm: number): string => paceText(sPerKm).replace(' /km', ' min/km');

/** One sentence: the easy pace now, against the oldest value there is (12 weeks, else 4). */
function Progress({ n }: { n: RunNumbers }) {
  const { now, weeks4, weeks12 } = n.easyPace;
  const [then, label] = weeks12 !== null ? [weeks12, 'vor 12 Wochen'] : [weeks4, 'vor 4 Wochen'];
  if (now === null && then === null) return null;
  let text: string;
  if (now === null) text = `Ruhiges Tempo bei gleichem Puls ${label}: ${minKm(then!)}.`;
  else if (then === null) text = `Ruhiges Tempo bei gleichem Puls: ${minKm(now)}.`;
  else {
    const d = Math.round(then) - Math.round(now);
    text = d === 0 ? `Dein Tempo ist gleich geblieben: ${minKm(now)}, wie ${label}.`
      : `${d > 0 ? 'Du wirst schneller' : 'Du bist etwas langsamer'}: ${minKm(now)}, ${Math.abs(d)} Sek. ${d > 0 ? 'schneller' : 'langsamer'} als ${label}.`;
  }
  return (
    <section>
      <h3 className="tk-section">Dein Fortschritt</h3>
      <p>{text}</p>
    </section>
  );
}

function Longest({ n }: { n: RunNumbers }) {
  const { blockKm, lastBlockKm } = n.longest;
  if (blockKm === null) return null;
  return (
    <section>
      <h3 className="tk-section">Längster Lauf</h3>
      <dl className="tk-pace">
        <div><dt>Letzte 4 Wochen</dt><dd>{kmFromKm(blockKm)}</dd></div>
        {lastBlockKm !== null && <div><dt>4 Wochen davor</dt><dd>{kmFromKm(lastBlockKm)}</dd></div>}
      </dl>
    </section>
  );
}

const hasWeeklyKm = (n: RunNumbers) => n.weeks.slice(-8).some((w) => w.km > 0);
function WeeklyKm({ n }: { n: RunNumbers }) {
  const weeks = n.weeks.slice(-8);
  if (!hasWeeklyKm(n)) return null;
  const max = Math.max(1, ...weeks.map((w) => w.km));
  return (
    <section>
      <h3 className="tk-section">Kilometer pro Woche</h3>
      <ul className="tk-progress">
        {weeks.map((w) => (
          <li key={w.week}><span>ab {shortDateOfKey(w.week).replace(/^[^,]+, /, '')}</span><span className="tk-bar" style={{ width: `${Math.max(4, (w.km / max) * 100)}%` }} /><span>{kmFromKm(w.km)}</span></li>
        ))}
      </ul>
    </section>
  );
}

const hasProgress = (n: RunNumbers) => n.easyPace.now !== null || n.easyPace.weeks4 !== null || n.easyPace.weeks12 !== null;

/** Everything about how it goes over the weeks, in one sheet: nothing of it is on the page itself. */
function Development({ n, reviews, onClose }: { n: RunNumbers; reviews: RunReviewBody[]; onClose: () => void }) {
  const [more, setMore] = useState(false);
  const hasMore = n.longest.blockKm !== null || reviews.length > 0;
  return (
    <Sheet title="Entwicklung" onClose={onClose}>
      <Progress n={n} />
      <WeeklyKm n={n} />
      {hasMore && (
        <RowList>
          <Row title="Ältere Wochen" expanded={more} onClick={() => setMore(!more)}>
            <Longest n={n} />
            {reviews.length > 0 && <section><h3 className="tk-section">Wochenrückblick</h3><ReviewList reviews={reviews} /></section>}
          </Row>
        </RowList>
      )}
    </Sheet>
  );
}

/** "Heute" or "Sa., 7. Nov." for a date key. */
const dateLabel = (key: string, todayKey: string) => (key === todayKey ? 'Heute' : shortDateOfKey(key));

function ManualForm({ plannedOn, now, onSave, onClose }: { plannedOn: (date: string) => PlannedRun | null; now: number; onSave: (r: Omit<ManualRunBody, 'type' | 'runType'>) => void; onClose: () => void }) {
  const d = new Date(now);
  const todayKey = dateKeyOf(now);
  const [date, setDate] = useState(todayKey);
  const [time, setTime] = useState(`${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`);
  const [minutes, setMinutes] = useState('');
  const [km, setKm] = useState('');
  const [hr, setHr] = useState('');
  const [open, setOpen] = useState<'date' | 'more' | null>(null);
  const testDay = plannedOn(date)?.kind === 'test';
  const dur = num(minutes);
  const dist = num(km);
  const avg = num(hr);
  const startMs = new Date(`${date}T${time}`).getTime();
  const ok = dur !== null && dur > 0 && dist !== null && dist >= 0 && Number.isFinite(startMs) && (hr.trim() === '' || (avg !== null && avg > 0));
  const save = () => {
    if (!ok) return;
    onSave({ startMs, durationS: Math.round(dur * 60), distanceM: Math.round(dist * 1000), avgHr: avg === null ? null : Math.round(avg) });
    onClose();
  };
  const missing = dur === null || dur <= 0 ? (dist === null || dist < 0 ? 'Strecke und Dauer fehlen' : 'Dauer fehlt') : dist === null || dist < 0 ? 'Strecke fehlt' : null;
  return (
    <Sheet title="Lauf eintragen" onClose={onClose} actions={<button type="button" disabled={!ok} onClick={save}>Lauf speichern</button>}>
      <div className="tk-form">
        <label className="tk-field">{testDay ? 'Strecke in den 30 Minuten' : 'Strecke in km'}<input inputMode="decimal" autoFocus placeholder="z. B. 5,2" value={km} onChange={(e) => setKm(e.target.value)} /></label>
        <label className="tk-field">Dauer in Minuten<input inputMode="decimal" placeholder="z. B. 32" value={minutes} onChange={(e) => setMinutes(e.target.value)} /></label>
        {!ok && missing && (km.trim() !== '' || minutes.trim() !== '') && <p className="muted" role="status">{missing}.</p>}
        {testDay && <p className="muted">An diesem Tag ist ein Testlauf geplant. Trag die Strecke ein, die du in 30 Minuten geschafft hast, in km.</p>}
      </div>
      <RowList>
        <Row title="Datum" value={dateLabel(date, todayKey)} expanded={open === 'date'} onClick={() => setOpen(open === 'date' ? null : 'date')}>
          <input type="date" aria-label="Datum" lang="de-DE" value={date} onChange={(e) => e.target.value && setDate(e.target.value)} />
        </Row>
        <Row title="Mehr" expanded={open === 'more'} onClick={() => setOpen(open === 'more' ? null : 'more')}>
          <div className="tk-form">
            <label className="tk-field">Beginn<input type="time" lang="de-DE" value={time} onChange={(e) => setTime(e.target.value)} /></label>
            <label className="tk-field">Puls im Schnitt (Schläge pro Minute, optional)<input inputMode="numeric" value={hr} onChange={(e) => setHr(e.target.value)} /></label>
          </div>
        </Row>
      </RowList>
    </Sheet>
  );
}

/** The run page, shared by the phone and the Mac. Only records in, only records out. */
export function RunScreen({ port, now, newId }: { port: TrackingPort; now: () => number; newId: () => string }) {
  const q = usePortRecords(port, 'run');
  const [sheet, setSheet] = useState<'entry' | 'development' | 'settings' | null>(null);
  const [savedNote, setSavedNote] = useState<string | null>(null);
  const [thanked, setThanked] = useState<string | null>(null);
  const view = runView(q.records ?? [], now());
  const stand = useSportWeek(port, now(), 'lauf');
  if (q.records === null) return null;
  // "Laufen planen" is on, but the run coach has not answered yet: one sentence, so the page is not empty.
  if (!view.status || !view.visible) return view.settings?.on ? <div className="tk-screen tk-run"><p className="muted">{FIRST_PLAN}</p></div> : null;
  const { status, week } = view;
  const all = q.all ?? [];
  const byId = (id: string): TrackedRecord | undefined => all.find((r) => r.id === id);
  const put = (id: string, body: object) => { void port.put({ kind: 'run', id, updatedMs: nextUpdatedMs(now(), byId(id)), deleted: false, body }).catch(() => {}); };

  const answeredFeels = new Set(all.filter((r) => !r.deleted && (r.body as { type?: string }).type === 'feel').map((r) => (r.body as RunFeelBody).runId));
  const paused = status.complaint === 'pause';
  const gentle = status.complaint === 'half' || view.settings?.answers?.pain === true;
  const todayKey = dateKeyOf(now());
  const today = !paused ? week?.runs.find((r) => r.date === todayKey) ?? null : null;
  // The card always names its day: today's run, else the next one ahead.
  const upcoming = !paused ? week?.runs.filter((r) => r.date >= todayKey).sort((a, b) => a.date.localeCompare(b.date))[0] ?? null : null;
  const fp = week ? weekFp(week.runs) : '';
  const sendRec = week ? byId(runSendId(week.week)) : undefined;
  const sendBody = sendRec && !sendRec.deleted ? (sendRec.body as RunSendBody) : null;
  const pending = !!(week && sendBody && sendBody.week === week.week && sendBody.fp === fp && sendBody.atMs > (week.garmin?.confirmedMs ?? 0));
  const send = () => { if (week) put(runSendId(week.week), { type: 'send', week: week.week, fp, atMs: now() } satisfies RunSendBody); };
  // Workouts sent before the pause that are still ahead on the watch: the same confirmation, with the paused week, removes them.
  const leftOnWatch = paused && status.garmin && !!week?.garmin && Object.keys(week.garmin.sent).some((d) => d >= todayKey);

  // The coach's status lags behind a save: once the settings hold days and answers, the questions are done here.
  const answered = !!(view.settings?.answers && view.settings.weekdays?.length);
  const firstQuestions = status.needsAnswers && !answered;
  const close = () => setSheet(null);
  const saveSettings = (answers: Answers, days: number[]) => {
    close(); setSavedNote(`Plan wird angepasst: ${dayList(days)}.`);
    void writeSettings(port, all, now(), (old) => ({ type: 'settings', on: old?.on ?? true, weekdays: days, answers })).catch(() => setSavedNote(null));
  };
  const numbers = status.numbers;
  const hasDevelopment = hasProgress(numbers) || numbers.longest.blockKm !== null || hasWeeklyKm(numbers) || view.reviews.length > 0;
  const sheetEntry = () => setSheet('entry');
  const trend = runTrendSentence(numbers);
  const card = status.card;
  const enter = { label: 'Lauf eintragen', onClick: sheetEntry };
  const showGarmin = status.on && !paused && !!week && week.runs.length > 0 && status.garmin && !!week.garmin;
  const bo = week && !paused && upcoming && week.runs.length > 0 ? [week.reason, upcoming?.hrCap == null ? week.note : null].filter((t): t is string => !!t) : [];

  return (
    <div className="tk-screen tk-run">
      {status.suggest && !status.on && <Suggestion onAnswer={(on) => { void writeSettings(port, all, now(), (old) => ({ type: 'settings', on, weekdays: old?.weekdays ?? null, answers: old?.answers ?? null })).catch(() => {}); }} />}
      {status.on && firstQuestions && <Questions suggested={status.suggestedDays} saved={view.settings ?? null} onSave={saveSettings} />}
      {status.on && paused && <p role="status" className="tk-note">{PAUSE}</p>}
      {status.on && paused && <button type="button" className="secondary" onClick={enter.onClick}>{enter.label}</button>}
      {status.on && leftOnWatch && week && (
        <Card>
          <div className="tk-garmin">
            <p>{LEFT_ON_WATCH}</p>
            <button type="button" className="secondary" disabled={week.garmin?.status === 'sending' || pending} onClick={send}>Entfernen</button>
          </div>
        </Card>
      )}
      {status.on && gentle && !paused && <p role="status" className="tk-note">{GENTLE}</p>}
      {status.on && stand.loaded && (
        <StandCard kicker="Laufen · diese Woche" text={stand.text} marks={stand.marks} marksLabel={stand.label}
          action={firstQuestions ? undefined : { label: 'Lauftage ändern', onClick: () => { setSavedNote(null); setSheet('settings'); } }} />
      )}
      {status.on && !paused && upcoming && (
        <MainCard label={upcoming === today ? 'Heute' : 'Nächster Lauf'} kicker={upcoming === today ? 'Heute' : `${weekdayOfKey(upcoming.date)}, ${dayMonthLongOfKey(upcoming.date)}`}
          title={KIND[upcoming.kind]} text={runText(upcoming, todayKey)} primary={enter} />
      )}
      {status.on && !paused && !upcoming && !firstQuestions && (
        <MainCard kicker="Laufen" title="Freier Lauf" text="Für diese Woche ist kein Lauf mehr geplant. Trag einen Lauf ein, wenn du gelaufen bist." primary={enter} />
      )}
      {status.on && !paused && week && week.runs.length > 0 && <BoBubble portrait="mini">{bo.length > 0 ? bo.join(' ') : BO_LINES.weekCalm}</BoBubble>}
      {showGarmin && week && <Card><GarminBlock week={week} pending={pending} onSend={send} /></Card>}
      {status.on && card && thanked === card.runId && <p role="status" className="muted">Danke! Das fließt in den nächsten Laufplan ein.</p>}
      {status.on && card && feelAsked(card, answeredFeels, now()) && (
        <Card label="Letzter Lauf">
          <Kicker>{`Letzter Lauf · ${weekdayOfKey(card.date)}`}</Kicker>
          <p><b>{card.result}</b></p>
          <p className="muted">{card.sentence}</p>
          <RunFeelQuestion
            onAnswer={(feel) => {
              const runId = card.runId;
              if (byId(runFeelId(runId))) return;
              put(runFeelId(runId), { type: 'feel', runId, feel, atMs: now() } satisfies RunFeelBody);
              if (feel !== null) setThanked(runId);
            }} />
        </Card>
      )}
      {status.on && card && !feelAsked(card, answeredFeels, now()) && (
        <RowCard icon="lauf" kicker={`Letzter Lauf · ${weekdayOfKey(card.date)}`} title={card.result} sub={card.sentence} end="none" />
      )}
      {status.on && hasDevelopment && <RowCard icon="entwicklung" kicker="Deine Entwicklung" title={trend ?? 'Entwicklung ansehen'} onClick={() => setSheet('development')} />}
      {status.on && savedNote && !firstQuestions && <p role="status" className="muted">{savedNote}</p>}
      {status.on && sheet === 'entry' && (
        <ManualForm plannedOn={(d) => (paused ? null : week?.runs.find((r) => r.date === d) ?? null)} now={now()} onClose={close}
          onSave={(r) => put(manualRunId(newId()), { type: 'manual', ...r, runType: 'running' } satisfies ManualRunBody)} />
      )}
      {status.on && sheet === 'development' && <Development n={numbers} reviews={view.reviews} onClose={close} />}
      {status.on && sheet === 'settings' && <Questions suggested={status.suggestedDays} saved={view.settings ?? null} onCancel={close} onSave={saveSettings} />}
    </div>
  );
}
