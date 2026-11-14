import { useState, type ReactNode, type SyntheticEvent } from 'react';
import { descriptionCredit, type ExerciseDescription } from '../../shared/exercise-descriptions';
import type { ExerciseImage } from '../../shared/exercise-images';
import { ruleNumbers } from '../../shared/training-policy';
import { BAR_LABEL, BAR_TYPES, type BarType } from '../../shared/bars';
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
export function BarLine({ title, type, kgOf, onType, onKg }: { title: string; type: BarType; kgOf: (t: BarType) => number; onType: (t: BarType) => void; onKg: (type: BarType, kg: number) => void }) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <p className="muted tk-step">
        <button type="button" className="link" aria-label={`Stange ${title}`} onClick={() => setOpen(true)}>{`Stange: ${BAR_LABEL[type]}, ${formatDecimal(kgOf(type))} kg`}</button>
      </p>
      {open && <BarSheet title={title} type={type} kgOf={kgOf} onType={onType} onKg={onKg} onClose={() => setOpen(false)} />}
    </>
  );
}

function BarSheet({ title, type, kgOf, onType, onKg, onClose }: { title: string; type: BarType; kgOf: (t: BarType) => number; onType: (t: BarType) => void; onKg: (type: BarType, kg: number) => void; onClose: () => void }) {
  const [draft, setDraft] = useState(formatDecimal(kgOf(type)));
  // The weight shown belongs to the type shown: after a switch the field holds the new type's weight.
  const [shownType, setShownType] = useState(type);
  const parsed = parseDecimal(draft);
  const bad = draft.trim() !== '' && !validBarKg(parsed);
  const [lo, hi] = ruleNumbers('load.bar-range-kg');
  return (
    <Sheet size="small" title={`Stange ${title}`} onClose={onClose}>
      <div className="tk-sets">
        <div role="radiogroup" aria-label="Stangentyp">
          {BAR_TYPES.map((t) => (
            <label key={t} className="tk-row">
              <input type="radio" name="bar-type" checked={shownType === t} onChange={() => { setShownType(t); setDraft(formatDecimal(kgOf(t))); onType(t); }} />
              <span>{BAR_LABEL[t]}</span>
            </label>
          ))}
        </div>
        <label className="tk-field-wrap">
          <span className="muted">{`Gewicht der ${BAR_LABEL[shownType]} in diesem Studio (kg)`}</span>
          <input className="tk-num" aria-label="Gewicht der Stange" inputMode="decimal" autoComplete="off" aria-invalid={bad} value={draft} onChange={(e) => setDraft(e.target.value)} />
        </label>
        {bad && <small className="tk-invalid" role="note">{`Bitte ein Gewicht zwischen ${formatDecimal(lo)} und ${formatDecimal(hi)} kg in Viertelkilo-Schritten.`}</small>}
        <button type="button" className="primary" disabled={!validBarKg(parsed)} onClick={() => { if (validBarKg(parsed)) { onKg(shownType, parsed); onClose(); } }}>Speichern</button>
      </div>
    </Sheet>
  );
}
