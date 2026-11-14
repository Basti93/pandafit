import { beepHz } from '../shared/beep';

export const SOUND_KEY = 'bike-coach.sound';
const BEEP_FROM_S = 3;
const LAST_BEEP_HZ = 1320;
const BEEP_HZ = 880;

export const beepsAt = (secondsToNext: number, engine: { nextLabel: string | null; paused: boolean }): boolean =>
  !!engine.nextLabel && !engine.paused && secondsToNext >= 1 && secondsToNext <= BEEP_FROM_S;

export const soundEnabled = (): boolean => { try { return localStorage.getItem(SOUND_KEY) !== 'off'; } catch { return true; } };
export const saveSoundEnabled = (on: boolean): void => { try { localStorage.setItem(SOUND_KEY, on ? 'on' : 'off'); } catch { /* then it only applies until the restart */ } };

/** A missing or blocked sound must never disturb the ride. */
export const beep = (secondsToNext: number): void => beepHz(secondsToNext === 1 ? LAST_BEEP_HZ : BEEP_HZ);
