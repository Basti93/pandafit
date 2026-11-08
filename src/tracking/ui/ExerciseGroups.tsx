import { useMemo, useState, type ReactNode } from 'react';
import type { Exercise } from '../../shared/exercises';
import { Row, RowList } from './kit';
import { CATALOG_GROUPS, catalogGroup } from './labels';

/** The exercises by the catalog's display groups (about eight), the exercises of each sorted by title. Empty groups are left out. */
export function groupExercises(list: readonly Exercise[]): (readonly [string, Exercise[]])[] {
  const by = new Map<string, Exercise[]>();
  for (const e of list) { const g = catalogGroup(e.primaryMuscle); by.set(g, [...(by.get(g) ?? []), e]); }
  for (const l of by.values()) l.sort((a, b) => a.title.localeCompare(b.title, 'de'));
  return CATALOG_GROUPS.filter((g) => by.has(g.label)).map((g) => [g.label, by.get(g.label)!] as const);
}

/**
 * The one accordion of exercises by group (catalog and picker): one group open at a time. An open group lists the built-in and
 * the used exercises first; the base entries of the free catalog follow behind "Alle N anzeigen". While searching every group is open and shows all hits.
 */
export function ExerciseGroups({ exercises, used, searching, label = 'Muskelgruppen', item }: {
  exercises: readonly Exercise[]; used: ReadonlySet<string>; searching: boolean; label?: string; item: (e: Exercise) => ReactNode;
}) {
  const [openGroup, setOpenGroup] = useState<string | null>(null);
  const [all, setAll] = useState<ReadonlySet<string>>(new Set());
  const groups = useMemo(() => groupExercises(exercises), [exercises]);
  // A search lists the hits plainly: a group head over them says nothing.
  if (searching) return <RowList label={label}>{groups.flatMap(([, list]) => list.map(item))}</RowList>;
  return (
    <RowList label={label}>
      {groups.map(([group, list]) => {
        const open = openGroup === group;
        const first = list.filter((e) => e.source !== 'fedb' || used.has(e.id));
        const showAll = first.length === 0 || first.length === list.length || all.has(group);
        const shown = showAll ? list : first;
        return (
          <Row key={group} title={group} expanded={open} onClick={() => setOpenGroup(openGroup === group ? null : group)}>
            <RowList label={group}>{shown.map(item)}</RowList>
            {!showAll && <button type="button" className="link" onClick={() => setAll(new Set([...all, group]))}>Alle {list.length} anzeigen</button>}
          </Row>
        );
      })}
    </RowList>
  );
}
