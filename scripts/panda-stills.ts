// Writes Bo's still pictures (one SVG per pose) from the motion data. Run after every export of panda-motion.ts.
import { writeFileSync } from 'node:fs';
import { stillSvg } from '../src/tracking/ui/panda-stills';
import { STILL_POSES } from '../src/tracking/ui/panda-still-url';

for (const gesture of STILL_POSES) writeFileSync(`src/web/public/brand/bo-pose-${gesture}.svg`, stillSvg(gesture));
