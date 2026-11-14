import { beepHz, primeBeep } from '../../../shared/beep';

const KEY = 'pandafit.rest-sound';
const BEEP_HZ = 880;
const LAST_BEEP_HZ = 1320;

/** On unless switched off on this device. */
export const restSoundOn = (): boolean => { try { return localStorage.getItem(KEY) !== 'off'; } catch { return true; } };
export const saveRestSound = (on: boolean): void => { try { localStorage.setItem(KEY, on ? 'on' : 'off'); } catch { /* private mode: applies until the reload only */ } };

/** The second reached (3, 2, 1, 0) when the countdown moves by exactly one second. A jump (skip, extension, first look) stays silent. */
export const restBeepAt = (prevLeftS: number | null, leftS: number): 3 | 2 | 1 | 0 | null =>
  prevLeftS !== null && prevLeftS - leftS === 1 && (leftS === 3 || leftS === 2 || leftS === 1 || leftS === 0) ? leftS : null;

/** Wakes the audio context inside a tap. Never throws. */
export const primeSound = (): void => { primeBeep(); };

/** Beeps for the second reached, when the switch is on and the page is visible. */
export const playRestBeep = (second: 3 | 2 | 1 | 0): void => {
  if (!restSoundOn() || document.visibilityState !== 'visible') return;
  beepHz(second === 0 ? LAST_BEEP_HZ : BEEP_HZ);
};
