import type { PandaGesture } from './panda-canvas';

export const STILL_POSES: readonly PandaGesture[] = ['greet', 'listen', 'nod', 'breathe', 'flex', 'bike', 'run', 'yoga', 'read', 'knit'];

/** The still picture of Bo in a pose, written by `npm run panda:stills`. */
export const stillUrl = (gesture: PandaGesture): string => `/brand/bo-pose-${gesture}.svg`;
