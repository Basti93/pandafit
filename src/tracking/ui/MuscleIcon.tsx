import { MUSCLE_TARGETS, type MuscleGroup } from '../../shared/muscle-targets';

/** One body part: x, y, width, height on a 24×24 grid, the group it shows (null: just body), and whether it comes in a pair. */
type Part = [x: number, y: number, w: number, h: number, region: MuscleGroup | null, pair: boolean];

const FRONT: Part[] = [
  [10.4, 4.4, 3.2, 1.6, null, false], // neck
  [6.4, 5.6, 2.6, 2.6, 'front_delts', true],
  [9.2, 5.8, 5.6, 4.2, 'chest', false],
  [9.6, 10.2, 4.8, 3.5, 'abs', false],
  [6.2, 8.4, 2.2, 3.8, 'biceps', true],
  [5.8, 12.4, 2, 3.6, 'forearms', true],
  [9.2, 13.9, 5.6, 2, null, false], // hips
  [9.2, 16, 2.6, 3.8, 'quads', true],
  [9.4, 20, 2.2, 3.6, null, true], // shins
];

const BACK: Part[] = [
  [10.4, 4.4, 3.2, 1.6, 'traps', false],
  [6.4, 5.6, 2.6, 2.6, 'rear_delts', true],
  [9.2, 5.8, 5.6, 7.9, 'back', false],
  [6.2, 8.4, 2.2, 3.8, 'triceps', true],
  [5.8, 12.4, 2, 3.6, null, true], // forearms from behind
  [9.2, 13.9, 5.6, 2, 'glutes', false],
  [9.2, 16, 2.6, 3.8, 'hamstrings', true],
  [9.4, 20, 2.2, 3.6, 'calves', true],
];

/** The side shoulder has no part of its own; it lights up the shoulder cap of the front view (no new art). */
const SHAPE_OF: Partial<Record<MuscleGroup, MuscleGroup>> = { side_delts: 'front_delts' };

const BACK_GROUPS: ReadonlySet<MuscleGroup> = new Set(['back', 'rear_delts', 'triceps', 'glutes', 'hamstrings', 'calves', 'traps']);

/**
 * A small body silhouette with the trained group in the accent colour: front view for the muscles you see from the front,
 * back view for the rest. "other" is a plain silhouette; null (muscle not known) is a plain silhouette with a question
 * mark, so an unknown exercise never looks like one that trains nothing. Own drawing, no external assets.
 */
export function MuscleIcon({ group, size = 22 }: { group: MuscleGroup | null; size?: number }) {
  const shown = group === null ? null : SHAPE_OF[group] ?? group;
  const parts = shown !== null && BACK_GROUPS.has(shown) ? BACK : FRONT;
  const rect = (x: number, w: number, y: number, h: number, region: MuscleGroup | null, key: string) => {
    const on = region !== null && region === shown;
    return <rect key={key} x={x} y={y} width={w} height={h} rx={Math.min(w, h) / 2.4} data-region={region ?? undefined}
      fill={on ? 'var(--accent)' : 'var(--text)'} fillOpacity={on ? 1 : 0.4} />;
  };
  return (
    <svg className="tk-muscle-icon" role="img" aria-label={group === null ? 'Muskel unbekannt' : MUSCLE_TARGETS[group].label} width={size} height={size} viewBox="0 0 24 24">
      <circle cx={12} cy={2.6} r={1.9} fill="var(--text)" fillOpacity={0.4} />
      {parts.flatMap(([x, y, w, h, region, pair], i) => [
        rect(x, w, y, h, region, `${i}`),
        ...(pair ? [rect(24 - x - w, w, y, h, region, `${i}m`)] : []),
      ])}
      {group === null && <text className="tk-muscle-unknown" x={12} y={11.6} textAnchor="middle" fontSize={8} fontWeight={700} fill="var(--text)">?</text>}
    </svg>
  );
}
