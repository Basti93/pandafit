import { RULES } from './rules';
import type { PolicyRule } from './types';

export * from './types';
export { SOURCES } from './sources';
export { RULES } from './rules';
export { SCENARIOS } from './scenarios';

/** Bumped whenever a rule, value or status changes. Plans can name the version they were made with. */
export const POLICY_VERSION = '2026-11-10.5';

const BY_ID = new Map(RULES.map((r) => [r.id, r]));

export function policyRule(id: string): PolicyRule {
  const rule = BY_ID.get(id);
  if (!rule) throw new Error(`unknown policy rule: ${id}`);
  return rule;
}

export function ruleNumber(id: string): number {
  const v = policyRule(id).value;
  if (typeof v !== 'number') throw new Error(`policy rule ${id} has no single number`);
  return v;
}

export function ruleRange(id: string): { min: number; max: number } {
  const v = policyRule(id).value;
  if (v === undefined || typeof v === 'number') throw new Error(`policy rule ${id} has no range`);
  return v;
}

export function ruleValues(id: string): Record<string, number> {
  const v = policyRule(id).values;
  if (!v) throw new Error(`policy rule ${id} has no value map`);
  return v;
}

export function ruleNumbers(id: string): number[] {
  const v = policyRule(id).numbers;
  if (!v) throw new Error(`policy rule ${id} has no number list`);
  return v;
}

export function ruleRamp(id: string): { pct: number; reps: number }[] {
  const v = policyRule(id).ramp;
  if (!v) throw new Error(`policy rule ${id} has no ramp`);
  return v;
}

export function ruleNamedRange(id: string, name: string): { min: number; max: number } {
  const v = policyRule(id).ranges?.[name];
  if (!v) throw new Error(`policy rule ${id} has no range ${name}`);
  return v;
}
