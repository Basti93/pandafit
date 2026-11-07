import { clampTargetW } from '../shared/guardrails';
import type { RideEvent, Sample } from '../shared/sample';
import { stepFtpFraction, type Session, type Step } from '../shared/session';
import { zoneBounds } from '../shared/hr-zones';
import type { Reading } from './ble/device-manager';

const GAP_THRESHOLD_MS = 5000;
const HR_HOLD_S = 30;
// Heart rate follows power with a delay, see docs/hr-zones.md.
const HR_ZONE_SETTLE_S = 180;
const HR_ZONE_HOLD_S = 60;
const CADENCE_HOLD_S = 20;
const CADENCE_FLOOR_RPM = 50;
const AUTO_STEP_PCT = 5;
const AUTO_MAX_PCT = 20;
const RAMP_ID = 'ramp-test';
const CLIMB_ENTRY_S = 25;
// Riding by heart rate, our own choice: see docs/hr-zones.md.
const HOLD_EVERY_S = 30;
const HOLD_UP_PCT = 2;
const HOLD_DOWN_PCT = 3;
const HOLD_MAX_UP_PCT = 15;
const HOLD_MAX_DOWN_PCT = 40;
const HOLD_CEILING_FRACTION = 0.8;
// Like Auuki: pause after 4 s at 0 W, resume above 40 W.
const PAUSE_AFTER_S = 4;
const RESUME_ABOVE_W = 40;

export type EngineState = {
  stepIndex: number; stepRemainingS: number; rideElapsedS: number;
  targetW: number | null; gradePct: number | null; gear: number | null;
  label: string; nextLabel: string | null; secondsToNext: number; autoReducedPct: number; paused: boolean;
};
export type TrainerCommand = { targetW: number };
export type EngineOptions = {
  session: Session; ftpW: number; resumeAtS?: number; skippedS?: number; startSeq?: number; nowMs: () => number; maxHrBpm?: number; hrMaxBpm?: number;
};

export class RideEngine {
  /** The real, continuous ride clock (written into every sample). */
  private elapsedS: number;
  /** Seconds of the session skipped so far; the session position is elapsedS + skippedS. */
  private skippedS: number;
  private seq: number;
  private adjustPct = 0;
  private adjustedStep = -1;
  private autoPct = 0;
  private autoStep = -1;
  private hrHighS = 0;
  private hrZoneHighS = 0;
  private holdPct = 0;
  private holdLowS = 0;
  private holdHighS = 0;
  private cadenceLowS = 0;
  private paused = false;
  private zeroPowerS = 0;
  private lastMs: number | null = null;
  private lastSent: string | null = null;
  private latest: Required<{ [K in keyof Reading]: number | null }> = { powerW: null, cadenceRpm: null, speedKph: null, hrBpm: null };

  constructor(private opts: EngineOptions) {
    this.elapsedS = opts.resumeAtS ?? 0;
    this.skippedS = opts.skippedS ?? 0;
    this.seq = opts.startSeq ?? 0;
  }

  tick(reading: Reading): { sample: Sample; command: TrainerCommand | null; events: RideEvent[] } {
    const now = this.opts.nowMs();
    const events: RideEvent[] = [];
    if (this.lastMs !== null && now - this.lastMs > GAP_THRESHOLD_MS) {
      events.push({ wallClockMs: this.lastMs, type: 'gap-start' }, { wallClockMs: now, type: 'gap-end' });
    }
    this.lastMs = now;
    this.latest = {
      powerW: reading.powerW ?? null, cadenceRpm: reading.cadenceRpm ?? null,
      speedKph: reading.speedKph ?? null, hrBpm: reading.hrBpm ?? null,
    };
    this.updatePause(now, events);
    if (!this.paused) {
      this.applyAutoReduction(now, events);
      this.elapsedS += 1;
    }
    const targets = this.targets(Math.max(0, this.sessionS() - (this.paused ? 0 : 1)));
    const sample: Sample = {
      seq: this.seq++, wallClockMs: now, rideElapsedS: this.elapsedS, ...this.latest,
      targetW: targets, gradePct: null, gear: null,
    };
    const command: TrainerCommand = { targetW: targets };
    const key = JSON.stringify(command);
    const changed = key !== this.lastSent;
    this.lastSent = key;
    return { sample, command: changed ? command : null, events };
  }

  adjustTarget(deltaPct: number): RideEvent {
    const { index } = this.position(this.sessionS());
    this.adjustPct = (index === this.adjustedStep ? this.adjustPct : 0) + deltaPct;
    this.adjustedStep = index;
    return { wallClockMs: this.opts.nowMs(), type: 'target-adjust', detail: `${deltaPct}` };
  }

  /** Ends the current step now and continues with the next one. Null (nothing happens) on the last step or while paused. */
  skipStep(): RideEvent | null {
    if (this.paused) return null;
    const steps = this.opts.session.steps;
    const { index, remainingS } = this.position(this.sessionS());
    if (this.isDone() || index >= steps.length - 1) return null;
    this.skippedS += remainingS;
    return { wallClockMs: this.opts.nowMs(), type: 'skip', detail: `${index}:${remainingS}` };
  }

  state(): EngineState {
    const at = Math.min(this.sessionS(), this.totalS() - 1);
    const { step, index, remainingS } = this.position(at);
    const next = this.opts.session.steps[index + 1];
    const t = this.targets(at);
    return {
      stepIndex: index, stepRemainingS: remainingS, rideElapsedS: this.elapsedS,
      targetW: t, gradePct: null, gear: null,
      label: step.label, nextLabel: next?.label ?? null, secondsToNext: remainingS,
      autoReducedPct: index === this.autoStep ? this.autoPct : 0,
      paused: this.paused,
    };
  }

  isDone(): boolean { return this.sessionS() >= this.totalS(); }

  private sessionS(): number { return this.elapsedS + this.skippedS; }

  private updatePause(now: number, events: RideEvent[]): void {
    const { powerW } = this.latest;
    this.zeroPowerS = powerW === 0 ? this.zeroPowerS + 1 : 0;
    if (!this.paused && this.zeroPowerS >= PAUSE_AFTER_S) {
      this.paused = true;
      this.hrHighS = 0;
      this.cadenceLowS = 0;
      this.holdLowS = 0;
      this.holdHighS = 0;
      events.push({ wallClockMs: now, type: 'pause' });
    } else if (this.paused && powerW !== null && powerW > RESUME_ABOVE_W) {
      this.paused = false;
      this.zeroPowerS = 0;
      events.push({ wallClockMs: now, type: 'resume' });
    }
  }

  /** Decision without AI: heart rate above the limit for too long, or collapsing cadence. */
  private applyAutoReduction(now: number, events: RideEvent[]): void {
    const { step, index, remainingS } = this.position(this.sessionS());
    if (index !== this.autoStep) { this.autoStep = index; this.autoPct = 0; this.hrHighS = 0; this.hrZoneHighS = 0; this.cadenceLowS = 0; this.holdPct = 0; this.holdLowS = 0; this.holdHighS = 0; }
    if (this.opts.session.id === RAMP_ID) return;
    const { hrBpm, cadenceRpm } = this.latest;
    const limit = this.opts.maxHrBpm;
    this.hrHighS = limit !== undefined && hrBpm !== null && hrBpm > limit ? this.hrHighS + 1 : 0;
    this.cadenceLowS = cadenceRpm !== null && cadenceRpm > 0 && cadenceRpm < CADENCE_FLOOR_RPM ? this.cadenceLowS + 1 : 0;
    const holding = !!(step.kind === 'erg' && step.hrHold && step.hrZone && this.opts.hrMaxBpm);
    if (holding) this.applyHold(step, step.durationS - remainingS, hrBpm, now, events);
    const zoneTop = !holding && step.hrZone && this.opts.hrMaxBpm ? zoneBounds(step.hrZone, this.opts.hrMaxBpm).toBpm : null;
    const settled = step.durationS - remainingS >= HR_ZONE_SETTLE_S;
    this.hrZoneHighS = zoneTop !== null && settled && hrBpm !== null && hrBpm > zoneTop ? this.hrZoneHighS + 1 : 0;
    const cause = this.hrHighS > HR_HOLD_S - 1 ? 'hr' : this.hrZoneHighS >= HR_ZONE_HOLD_S ? 'hr-zone' : this.cadenceLowS > CADENCE_HOLD_S - 1 ? 'cadence' : null;
    if (!cause) return;
    this.hrHighS = 0;
    this.hrZoneHighS = 0;
    this.cadenceLowS = 0;
    if (this.autoPct >= AUTO_MAX_PCT) return;
    this.autoPct += AUTO_STEP_PCT;
    events.push({ wallClockMs: now, type: 'target-adjust', detail: `auto:${cause}` });
  }

  /** The watts follow the heart rate slowly and within narrow limits. After the heart rate limit has acted they no longer rise. */
  private applyHold(step: Step, inStepS: number, hrBpm: number | null, now: number, events: RideEvent[]): void {
    if (inStepS < HR_ZONE_SETTLE_S || hrBpm === null) { this.holdLowS = 0; this.holdHighS = 0; return; }
    const { fromBpm, toBpm } = zoneBounds(step.hrZone!, this.opts.hrMaxBpm!);
    this.holdLowS = hrBpm < fromBpm ? this.holdLowS + 1 : 0;
    this.holdHighS = hrBpm > toBpm ? this.holdHighS + 1 : 0;
    if (this.holdHighS >= HOLD_EVERY_S) {
      this.holdHighS = 0;
      if (this.holdPct <= -HOLD_MAX_DOWN_PCT) return;
      this.holdPct = Math.max(-HOLD_MAX_DOWN_PCT, this.holdPct - HOLD_DOWN_PCT);
      events.push({ wallClockMs: now, type: 'target-adjust', detail: 'hold:down' });
    } else if (this.holdLowS >= HOLD_EVERY_S) {
      this.holdLowS = 0;
      const ceiling = Math.min(HOLD_MAX_UP_PCT, (HOLD_CEILING_FRACTION / stepFtpFraction(step) - 1) * 100);
      if (this.autoPct > 0 || this.holdPct >= ceiling) return;
      this.holdPct = Math.min(ceiling, this.holdPct + HOLD_UP_PCT);
      events.push({ wallClockMs: now, type: 'target-adjust', detail: 'hold:up' });
    }
  }

  private totalS(): number { return this.opts.session.steps.reduce((sum, s) => sum + s.durationS, 0); }

  private position(atS: number): { step: Step; index: number; remainingS: number } {
    const steps = this.opts.session.steps;
    let start = 0;
    for (let index = 0; index < steps.length; index++) {
      const end = start + steps[index].durationS;
      if (atS < end) return { step: steps[index], index, remainingS: end - atS };
      start = end;
    }
    return { step: steps[steps.length - 1], index: steps.length - 1, remainingS: 0 };
  }

  private targets(atS: number): number {
    const { step, index, remainingS } = this.position(atS);
    const manual = index === this.adjustedStep ? 1 + this.adjustPct / 100 : 1;
    const factor = manual * (index === this.autoStep ? (1 - this.autoPct / 100) * (1 + this.holdPct / 100) : 1);
    return Math.round(clampTargetW(this.entryFraction(step, index, step.durationS - remainingS) * this.opts.ftpW * factor, this.opts.ftpW));
  }

  /** Climbs are entered gently: linearly from the previous section to the target. */
  private entryFraction(step: Step, index: number, inStepS: number): number {
    const goal = stepFtpFraction(step);
    const previous = this.opts.session.steps[index - 1];
    if (step.kind !== 'grade' || step.sudden || !previous || inStepS >= CLIMB_ENTRY_S) return goal;
    const from = stepFtpFraction(previous);
    return from + (goal - from) * (inStepS / CLIMB_ENTRY_S);
  }
}
