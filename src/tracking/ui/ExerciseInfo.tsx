import { useState, type ReactNode, type SyntheticEvent } from 'react';
import { descriptionCredit, type ExerciseDescription } from '../../shared/exercise-descriptions';
import type { ExerciseImage } from '../../shared/exercise-images';
import { ruleNumbers } from '../../shared/training-policy';
import { BAR_NAME_MAX, barChoices, barLabel, barWeightOf, isCustomBarId, type BarType, type Bars } from '../../shared/bars';
import { formatDecimal, parseDecimal } from '../session';
import { Sheet } from './kit';
import { stepLine } from '../steps';
import { imageSrc } from '../media';

const external = { target: '_blank', rel: 'noopener noreferrer' } as const;

/**
 * How to do an exercise, inline: the bundled pictures (if any) above the text, then a YouTube search the person opens
 * themselves. wger texts and pictures carry their credit line in small muted text. Without a text it still shows the
 * video link, so every exercise has somewhere to look.
 */
/** A picture that is not there (generated media missing) takes its frame with it. */
const hideFigure = (e: SyntheticEvent<HTMLImageElement>) => { const f = e.currentTarget.closest('figure'); if (f) f.hidden = true; };

/** The whole text, never clamped. */
function DescriptionText({ text }: { text: string }) {
  return <div className="tk-desc"><p>{text}</p></div>;
}

/** Picture and text credits as one small muted line at the end. */
function Credits({ images, text }: { images: ExerciseImage[]; text: string | null }) {
  const pics = images.filter((img, i) => images.findIndex((o) => o.sourceUrl === img.sourceUrl && o.author === img.author && o.licence === img.licence) === i);
  if (pics.length === 0 && !text) return null;
  // Picture and text from the same public-domain source: one credit.
  const fedb = (a: string) => a.startsWith('free-exercise-db');
  if (pics.length > 0 && pics.every((p) => fedb(p.author)) && text && fedb(text.replace(/^Quelle: /, ''))) {
    return <small className="muted tk-credit">Bild und Text: free-exercise-db, gemeinfrei</small>;
  }
  return (
    <small className="muted tk-credit">
      {pics.map((img, i) => (
        <span key={img.file}>{i > 0 && ' · '}
          {img.sourceUrl.includes('wger.de')
            ? <>Bild: <a href={img.sourceUrl} {...external}>wger.de</a>{img.author === 'wger.de' ? '' : `, ${img.author}`}, {img.licence}</>
            : <>Bild: <a href={img.sourceUrl} {...external}>{img.author}</a></>}
        </span>
      ))}
      {pics.length > 0 && text && ' · '}{text}
    </small>
  );
}

export function ExerciseInfo({ title, description, images = [], video, icon, children }: {
  title: string; description: ExerciseDescription | null; images?: ExerciseImage[]; video: string;
  icon?: ReactNode; children?: ReactNode;
}) {
  const credit = description && descriptionCredit(description);
  return (
    <div className="tk-info" role="note" aria-label={`Anleitung ${title}`}>
      {images.length > 0 && (
        <div className="tk-info-pics">
          {images.map((img) => (
            <figure key={img.file} className="tk-info-pic">
              <img src={imageSrc(img.file)} alt={`${title}, Ausführung`} loading="lazy" decoding="async" onError={hideFigure} />
            </figure>
          ))}
        </div>
      )}
      {description ? <DescriptionText text={description.text} /> : <p className="tk-info-empty">{icon}<span className="muted">Für diese Übung gibt es noch keine Beschreibung.</span></p>}
      <a className="tk-video" href={video} {...external}>Video ansehen</a>
      {children}
      <Credits images={images} text={credit} />
    </div>
  );
}

const LEARNED = '';

/** One light line with the weight step here and a small select: "gelernt" or one of the offered steps. */
export function StepLine({ title, step, onChoose }: { title: string; step: { stepKg: number; own: boolean }; onChoose: (stepKg: number | null) => void }) {
  return (
    <p className="muted tk-step">
      <span>{stepLine(step)}</span>
      <select aria-label={`Gewichtsstufe ${title}`} value={step.own ? String(step.stepKg) : LEARNED}
        onChange={(e) => onChoose(e.target.value === LEARNED ? null : Number(e.target.value))}>
        <option value={LEARNED}>gelernt</option>
        {[...new Set([...ruleNumbers('load.step-choices'), ...(step.own ? [step.stepKg] : [])])].sort((a, b) => a - b).map((n) => <option key={n} value={String(n)}>{formatDecimal(n)} kg</option>)}
      </select>
    </p>
  );
}

/** The kg a bar can weigh: the register's range, on the 0.25 kg grid. */
const validBarKg = (kg: number | null | undefined): kg is number => {
  if (typeof kg !== 'number' || !Number.isFinite(kg)) return false;
  const [lo, hi] = ruleNumbers('load.bar-range-kg');
  return kg >= lo && kg <= hi && Math.abs(kg * 4 - Math.round(kg * 4)) < 1e-9;
};

/**
 * One light line with the bar of a barbell exercise here ("Stange: SZ-Stange, 8,5 kg"). Tapping opens a small sheet: the type
 * (for this exercise) and the weight of that type in this studio.
 */
type BarHandlers = { onType: (t: BarType) => void; onKg: (type: BarType, kg: number) => void; onAdd: (name: string, kg: number) => void; onRename: (id: string, name: string) => void; onDelete: (id: string) => void };

export function BarLine({ title, type, bars, studio, ...h }: { title: string; type: BarType; bars: Bars; studio: string } & BarHandlers) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <p className="muted tk-step">
        <button type="button" className="link" aria-label={`Stange ${title}`} onClick={() => setOpen(true)}>{`Stange: ${barLabel(type, bars)}, ${formatDecimal(barWeightOf(type, studio, bars))} kg`}</button>
      </p>
      {open && <BarSheet title={title} type={type} bars={bars} studio={studio} {...h} onClose={() => setOpen(false)} />}
    </>
  );
}

function BarSheet({ title, type, bars, studio, onType, onKg, onAdd, onRename, onDelete, onClose }: { title: string; type: BarType; bars: Bars; studio: string; onClose: () => void } & BarHandlers) {
  const kgOf = (t: BarType) => barWeightOf(t, studio, bars);
  const [draft, setDraft] = useState(formatDecimal(kgOf(type)));
  // The weight shown belongs to the type shown: after a switch the field holds the new type's weight.
  const [shownType, setShownType] = useState(type);
  const [adding, setAdding] = useState(false);
  const [newName, setNewName] = useState('');
  const [newKg, setNewKg] = useState('');
  const [renaming, setRenaming] = useState<string | null>(null);
  const [renameDraft, setRenameDraft] = useState('');
  const [deleting, setDeleting] = useState<string | null>(null);
  const parsed = parseDecimal(draft);
  const bad = draft.trim() !== '' && !validBarKg(parsed);
  const parsedNew = parseDecimal(newKg);
  const badNew = newKg.trim() !== '' && !validBarKg(parsedNew);
  const [lo, hi] = ruleNumbers('load.bar-range-kg');
  const range = `Bitte ein Gewicht zwischen ${formatDecimal(lo)} und ${formatDecimal(hi)} kg in Viertelkilo-Schritten.`;
  // A deleted type falls back to what the exercise uses without it.
  const shown = bars.custom.has(shownType) || !isCustomBarId(shownType) ? shownType : type;
  return (
    <Sheet size="small" title={`Stange ${title}`} onClose={onClose}>
      <div className="tk-sets">
        <div role="radiogroup" aria-label="Stangentyp">
          {barChoices(bars).map((c) => (
            <div key={c.id}>
              <label className="tk-row">
                <input type="radio" name="bar-type" checked={shown === c.id} onChange={() => { setShownType(c.id); setDraft(formatDecimal(kgOf(c.id))); onType(c.id); }} />
                <span>{c.label}</span>
              </label>
              {c.custom && renaming !== c.id && deleting !== c.id && (
                <span className="tk-row">
                  <button type="button" className="link" aria-label={`${c.label} umbenennen`} onClick={() => { setRenaming(c.id); setRenameDraft(c.label); }}>Umbenennen</button>
                  <button type="button" className="link" aria-label={`${c.label} löschen`} onClick={() => setDeleting(c.id)}>Löschen</button>
                </span>
              )}
              {c.custom && renaming === c.id && (
                <span className="tk-row">
                  <input aria-label="Neuer Name der Stange" maxLength={BAR_NAME_MAX} value={renameDraft} onChange={(e) => setRenameDraft(e.target.value)} />
                  <button type="button" className="primary" disabled={renameDraft.trim() === ''} onClick={() => { onRename(c.id, renameDraft.trim()); setRenaming(null); }}>Übernehmen</button>
                </span>
              )}
              {c.custom && deleting === c.id && (
                <span role="note">
                  <small>Die Stange wird gelöscht. Übungen mit dieser Stange nutzen wieder den Standard.</small>
                  <button type="button" className="link" aria-label={`${c.label} endgültig löschen`} onClick={() => { onDelete(c.id); setDeleting(null); if (shownType === c.id) { setShownType(type); setDraft(formatDecimal(kgOf(type))); } }}>Löschen bestätigen</button>
                  <button type="button" className="link" onClick={() => setDeleting(null)}>Abbrechen</button>
                </span>
              )}
            </div>
          ))}
        </div>
        <label className="tk-field-wrap">
          <span className="muted">{`Gewicht der ${barLabel(shown, bars)} in diesem Studio (kg)`}</span>
          <input className="tk-num" aria-label="Gewicht der Stange" inputMode="decimal" autoComplete="off" aria-invalid={bad} value={draft} onChange={(e) => setDraft(e.target.value)} />
        </label>
        {bad && <small className="tk-invalid" role="note">{range}</small>}
        <button type="button" className="primary" disabled={!validBarKg(parsed)} onClick={() => { if (validBarKg(parsed)) { onKg(shown, parsed); onClose(); } }}>Speichern</button>
        {!adding && <button type="button" className="link" onClick={() => setAdding(true)}>Eigene Stange hinzufügen</button>}
        {adding && (
          <div className="tk-sets">
            <label className="tk-field-wrap">
              <span className="muted">Name</span>
              <input aria-label="Name der neuen Stange" maxLength={BAR_NAME_MAX} autoComplete="off" value={newName} onChange={(e) => setNewName(e.target.value)} />
            </label>
            <label className="tk-field-wrap">
              <span className="muted">Gewicht (kg)</span>
              <input className="tk-num" aria-label="Gewicht der neuen Stange" inputMode="decimal" autoComplete="off" aria-invalid={badNew} value={newKg} onChange={(e) => setNewKg(e.target.value)} />
            </label>
            {badNew && <small className="tk-invalid" role="note">{range}</small>}
            <button type="button" className="primary" disabled={newName.trim() === '' || !validBarKg(parsedNew)} onClick={() => { if (newName.trim() !== '' && validBarKg(parsedNew)) { onAdd(newName.trim(), parsedNew); setAdding(false); setNewName(''); setNewKg(''); } }}>Hinzufügen</button>
          </div>
        )}
      </div>
    </Sheet>
  );
}
