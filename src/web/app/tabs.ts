import { Env } from './env';

export type Tab = 'heute' | 'coach' | 'training' | 'essen' | 'ausdauer' | 'profil';
// At most five tabs in a fixed order: the look back (Rückblick) is on Woche, the profile is the round button at the top right.
export const TABS: [Tab, string][] = [['heute', 'Heute'], ['coach', 'Woche'], ['training', 'Kraft'], ['essen', 'Essen'], ['ausdauer', 'Ausdauer']];

/** The "Essensplan" switch lives with the account's coach; the last value seen is kept per account, so Essen shows from the start. */
export const mealsOnKey = (account: string) => `pandafit.essensplan.${account}`;
export const readMealsOn = (env: Env, account: string): boolean => { try { return env.storage.getItem(mealsOnKey(account)) === 'on'; } catch { return false; } };
export const saveMealsOn = (env: Env, account: string, on: boolean): void => { try { env.storage.setItem(mealsOnKey(account), on ? 'on' : 'off'); } catch { /* shown again once the plan is there */ } };
export const NO_LINK = { view: null, unavailable: false };
/** How long the app start waits for the coach's switches before it lets the link go. */
export const COACH_ASK_MS = 30_000;
export const noSub = () => () => {};

/**
 * Which tabs show. They follow the profile switches, and data that is there: Essen once "Essensplan" is on or a plan is there;
 * Ausdauer once "Laufen planen" is on, the run coach suggests running, or there is a bike plan or ride. Heute, Woche and Kraft always.
 */
export const visibleTabs = (o: { meals: boolean; endurance: boolean }): Tab[] =>
  TABS.map(([t]) => t).filter((t) => (t !== 'essen' || o.meals) && (t !== 'ausdauer' || o.endurance));

export type Endurance = 'rad' | 'laufen';
export const enduranceKey = (account: string) => `pandafit.ausdauer.${account}`;
export const readEndurance = (env: Env, account: string): Endurance | null => { try { const v = env.storage.getItem(enduranceKey(account)); return v === 'rad' || v === 'laufen' ? v : null; } catch { return null; } };
export const saveEndurance = (env: Env, account: string, v: Endurance): void => { try { env.storage.setItem(enduranceKey(account), v); } catch { /* the choice is just not remembered */ } };
/** The tab a start link or notification names. 'laufen' is the old name of Ausdauer; it and 'rad' also pick the half. */
export const tabFor = (t: string | null | undefined): Tab | null => (t === 'essen' || t === 'coach' ? t : t === 'laufen' || t === 'rad' || t === 'ausdauer' ? 'ausdauer' : null);
