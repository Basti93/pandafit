import { describe, expect, it } from 'vitest';
import { strengthFacts } from '../../../src/coach/gym/review-facts';
import type { StrengthWorkout } from '../../../src/coach/hevy';

const DAY = 86_400_000;
const NOW = new Date(2026, 10, 4, 12).getTime(); // Wednesday, week of 2026-11-02
const templates = [
  { id: 'BP', title: 'Bench Press (Barbell)', type: 'weight_reps', primaryMuscle: 'chest', equipment: 'barbell' },
  { id: 'LR', title: 'Lateral Raise (Dumbbell)', type: 'weight_reps', primaryMuscle: 'side_delts', equipment: 'dumbbell' },
];
const goal = { strength: 'muscle' as const, focus: [] };
const workout = (daysAgo: number, templateId: string, title: string, kg: number, sets = 3): StrengthWorkout => ({
  id: `w${daysAgo}${templateId}`, title: 'T', startMs: NOW - daysAgo * DAY, durationS: 3600,
  exercises: [{ title, templateId, sets, reps: 10, volumeKg: 0, workSets: Array.from({ length: sets }, () => ({ type: 'normal' as const, weightKg: kg, reps: 10 })) }],
});

describe('strengthFacts', () => {
  it('zählt Krafttrainings je Woche über 13 Wochen', () => {
    const f = strengthFacts([workout(1, 'BP', 'Bench Press (Barbell)', 40), workout(2, 'BP', 'Bench Press (Barbell)', 40), workout(80, 'BP', 'Bench Press (Barbell)', 40), workout(100, 'BP', 'Bench Press (Barbell)', 40)], templates, [], goal, NOW);
    expect(f.wochen).toHaveLength(13);
    expect(f.wochen[12]).toEqual({ montag: '2026-11-02', kraft: 2 });
    expect(f.wochen[0]!.montag).toBe('2026-08-10');
    expect(f.wochen[0]!.kraft).toBe(1);
    expect(f.wochen.reduce((a, w) => a + w.kraft, 0)).toBe(3);
  });

  it('erkennt eine steigende Übung', () => {
    const f = strengthFacts([workout(60, 'BP', 'Bench Press (Barbell)', 40), workout(30, 'BP', 'Bench Press (Barbell)', 45), workout(2, 'BP', 'Bench Press (Barbell)', 50)], templates, [], goal, NOW);
    expect(f.uebungen).toEqual([{ titel: 'Bench Press (Barbell)', trend: 'steigt', einheiten: 3 }]);
  });

  it('erkennt fallende und gleiche Übungen und nimmt höchstens fünf', () => {
    const f = strengthFacts([workout(40, 'BP', 'Bench Press (Barbell)', 50), workout(2, 'BP', 'Bench Press (Barbell)', 40), workout(40, 'LR', 'Lateral Raise (Dumbbell)', 8), workout(2, 'LR', 'Lateral Raise (Dumbbell)', 8)], templates, [], goal, NOW);
    expect(f.uebungen.map((u) => u.trend).sort()).toEqual(['faellt', 'gleich']);
    const many = Array.from({ length: 7 }, (_, i) => workout(3, `X${i}`, `Übung ${i}`, 10));
    expect(strengthFacts(many, templates, [], goal, NOW).uebungen).toHaveLength(5);
  });

  it('nennt nur dauerhaft niedrige Muskeln', () => {
    // Brust ist heute im Ziel (18 Sätze), vor 28 und 56 Tagen aber nicht; Seitliche Schulter nur heute zu wenig.
    const lasting = [workout(1, 'LR', 'Lateral Raise (Dumbbell)', 8, 1)];
    const f = strengthFacts(lasting, templates, [], goal, NOW);
    expect(f.untenDauerhaft).toContain('Brust');
    const chestNow = strengthFacts([workout(1, 'BP', 'Bench Press (Barbell)', 40, 14)], templates, [], goal, NOW);
    expect(chestNow.untenDauerhaft).not.toContain('Brust');
    const sideOnlyNow = strengthFacts([workout(29, 'LR', 'Lateral Raise (Dumbbell)', 8, 14), workout(57, 'LR', 'Lateral Raise (Dumbbell)', 8, 14)], templates, [], goal, NOW);
    expect(sideOnlyNow.untenDauerhaft).not.toContain('Schulter seitlich');
  });
});
