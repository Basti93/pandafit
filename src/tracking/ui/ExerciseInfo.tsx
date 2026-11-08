import { useState, type ReactNode, type SyntheticEvent } from 'react';
import { descriptionCredit, type ExerciseDescription } from '../../shared/exercise-descriptions';
import type { ExerciseImage } from '../../shared/exercise-images';
import { ruleNumbers } from '../../shared/training-policy';
import { formatDecimal } from '../session';
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

const LONG = 36;

/** Up to three lines of the text; a longer one has a "mehr" toggle. The stored text is never shortened, only clamped. */
function DescriptionText({ text }: { text: string }) {
  const [open, setOpen] = useState(false);
  const long = text.split(/\s+/).filter(Boolean).length > LONG;
  return (
    <div className="tk-desc">
      <p className={long && !open ? 'tk-clamp' : undefined}>{text}</p>
      {long && <button type="button" className="link" aria-expanded={open} onClick={() => setOpen(!open)}>{open ? 'weniger' : 'mehr'}</button>}
    </div>
  );
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
