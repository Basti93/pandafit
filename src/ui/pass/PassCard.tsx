import type { CoachClientMessage } from '../../coach/protocol';
import { PASSES, passById, type PassState } from '../../shared/passes';
import { heightAt, topOf } from './riding';

const num = (v: number) => Math.round(v).toLocaleString('de-DE');

/** Your own mountain, climbed across rides. The trainer keeps following the session. */
export const PassCard = ({ profileId, pass: state, send }: { profileId: string; pass?: PassState; send: (m: CoachClientMessage) => void }) => {
  const pass = passById(state?.selectedId);
  const done = state?.distanceM?.[pass.id] ?? 0;
  const count = (id: string) => state?.summits?.filter((s) => s.passId === id).length ?? 0;
  return (
    <section className="card" data-testid="pass-card">
      <h3>Dein Berg</h3>
      <label className="pass-pick">
        <span className="sr-only">Berg wählen</span>
        <select aria-label="Berg wählen" value={pass.id} onChange={(e) => send({ type: 'pass-select', profileId, passId: e.target.value })}>
          {PASSES.map((p) => <option key={p.id} value={p.id}>{p.name}, {p.country}{count(p.id) ? ` · ${count(p.id)}× oben` : ''}</option>)}
        </select>
      </label>
      <p className="muted">{(pass.lengthM / 1000).toLocaleString('de-DE', { maximumFractionDigits: 1 })} km, {num(pass.gainM)} Höhenmeter. {done > 0 ? `Du bist auf ${num(heightAt(pass, done))} m, noch ${num(Math.max(0, topOf(pass) - heightAt(pass, done)))} Höhenmeter.` : 'Du fährst ihn über mehrere Fahrten hinauf.'}</p>
    </section>
  );
};
