const BEEP_S = 0.12;
const VOLUME = 0.2;

let context: AudioContext | null = null;

/** Wakes the audio context. Call it inside a tap: iOS starts audio only there. Never throws. */
export const primeBeep = (): void => {
  try {
    context ??= new AudioContext();
    if (context.state !== 'running') void context.resume();
  } catch { context = null; }
};

/** One short beep. A missing or blocked sound must never disturb the ride or the workout. */
export const beepHz = (hz: number): void => {
  try {
    primeBeep();
    if (!context) return;
    const oscillator = context.createOscillator();
    const gain = context.createGain();
    oscillator.frequency.value = hz;
    gain.gain.value = VOLUME;
    oscillator.connect(gain);
    gain.connect(context.destination);
    oscillator.start(context.currentTime);
    oscillator.stop(context.currentTime + BEEP_S);
  } catch { context = null; }
};
