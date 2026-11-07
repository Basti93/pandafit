/** How deeply a source was read: abstract only, relevant full-text passages, or an official guideline summary. */
export type SourceDepth = 'abstract' | 'fulltext-excerpts' | 'guideline-summary';

export type PolicySource = {
  /** 'S01' … 'S26', as in docs/research/2026-11-06-training-science-foundation.md §12. */
  id: string;
  citation: string; url: string; studyType: string; depth: SourceDepth;
  population: string; endpoint: string; limits: string;
  /** YYYY-MM-DD */
  checkedOn: string;
};

/** orientation: fachliche Orientierung; product: Produktheuristik; personal: persönliche Vorgabe; technical: technische Bedingung. */
export type RuleClass = 'orientation' | 'product' | 'personal' | 'technical';
/** checked: code enforces it; weighed: the AI weighs it and it is shown. */
export type Enforcement = 'checked' | 'weighed';
export type RuleStatus =
  | { state: 'active' }
  | { state: 'to-replace'; task: number; replacement: string; untilThen: string }
  /** A fixed start value that is not in effect before that follow-up task. */
  | { state: 'planned'; task: number };
export type RuleValue = number | { min: number; max: number };

export type PolicyRule = {
  id: string;
  domain: 'gym' | 'muscle' | 'rest' | 'bike' | 'run' | 'planner' | 'endurance' | 'data' | 'health';
  statement: string; decision: string; class: RuleClass; enforcement: Enforcement;
  value?: RuleValue; unit?: string;
  /** Further named ranges of the same rule, e.g. the sets for other goals and the reps of a muscle target. */
  ranges?: Record<string, { min: number; max: number }>;
  /** Named lists of the same rule, e.g. which groups work as synergists of a muscle group. */
  lists?: Record<string, string[]>;
  /** Named single numbers of the same rule, e.g. the default weight step per kind of equipment. */
  values?: Record<string, number>;
  /** A plain list of numbers, e.g. the offered weight steps or the plate sizes. */
  numbers?: number[];
  /** A ramp of steps, each a share of the working weight and its reps, e.g. the warm-up ramp. */
  ramp?: { pct: number; reps: number }[];
  /** A source id proves neither a threshold nor an individual optimum. */
  sourceIds: string[];
  /** Code paths that apply the rule today or will apply it. */
  where: string[];
  status: RuleStatus; scenarioIds: string[];
};

/** An acceptance scenario from the foundation §11 or the concept §18, owned by a follow-up task. */
export type Scenario = { id: string; situation: string; expectation: string; task: number };
