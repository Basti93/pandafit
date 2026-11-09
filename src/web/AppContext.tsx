import { createContext, useContext } from 'react';
import type { Env } from './App';
import type { WebPort } from './webPort';

/** What every screen of a signed-in session needs. Set once by the shell. */
export type AppValue = { port: WebPort; env: Env; account: string; fetchFn: typeof fetch };
export const AppContext = createContext<AppValue | null>(null);

export function useApp(): AppValue {
  const v = useContext(AppContext);
  if (!v) throw new Error('useApp outside of a signed-in session');
  return v;
}
