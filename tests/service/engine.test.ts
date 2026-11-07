import { RideEngine } from '../../src/service/engine';
import type { Session } from '../../src/shared/session';

const session: Session = { id: 's', name: 'x', steps: [
  { kind: 'erg', durationS: 60, ftpFraction: 0.5, label: 'A' },
  { kind: 'grade', durationS: 60, gradePct: 5, scale: 0.8, label: 'B' },
] };
const clock = () => { let t = 0; const now = () => t; return { now, set: (v: number) => { t = v; }, step: () => { t += 1000; } }; };
const make = (c: ReturnType<typeof clock>, extra = {}) => new RideEngine({ session, ftpW: 200, nowMs: c.now, ...extra });
const run = (e: RideEngine, c: ReturnType<typeof clock>, n: number) => { let r; for (let i = 0; i < n; i++) { c.step(); r = e.tick({}); } return r!; };

test('erg step targets fraction of FTP', () => {
  const c = clock();
  expect(run(make(c), c, 1).command?.targetW).toBe(100);
});
test('moves to next step exactly on duration', () => {
  const c = clock(); const e = make(c);
  run(e, c, 59);
  expect(e.state().stepIndex).toBe(0);
  run(e, c, 1);
  expect(e.state().stepIndex).toBe(1);
});
test('resume starts at given second with correct step and seq', () => {
  const c = clock(); const e = make(c, { resumeAtS: 90, startSeq: 91 });
  const r = run(e, c, 1);
  expect(r.sample.seq).toBe(91);
  expect(e.state().stepIndex).toBe(1);
  expect(r.command).toEqual({ targetW: 150 });
});
test('gap over 5s of wall clock emits gap events and does not advance ride time', () => {
  const c = clock(); const e = make(c);
  run(e, c, 3);
  c.set(c.now() + 300000);
  const r = e.tick({});
  expect(r.sample.rideElapsedS).toBe(4);
  expect(r.events.map((x) => x.type)).toEqual(['gap-start', 'gap-end']);
});
test('adjustTarget is clamped and logged', () => {
  const c = clock(); const e = make(c);
  expect(e.adjustTarget(500).type).toBe('target-adjust');
  expect(run(e, c, 1).sample.targetW).toBe(300);
});
test('adjustTarget lasts only for the current step', () => {
  const c = clock(); const e = new RideEngine({ session: { ...session, steps: [session.steps[0], session.steps[0]] }, ftpW: 200, nowMs: c.now });
  e.adjustTarget(10);
  expect(run(e, c, 1).sample.targetW).toBe(110);
  expect(run(e, c, 60).sample.targetW).toBe(100);
});
test('a climb is ridden at a watt target from its scaled grade, never as a simulated grade', () => {
  const c = clock(); const e = make(c, { resumeAtS: 90 });
  const r = run(e, c, 1);
  expect(r.sample.targetW).toBe(150);
  expect(r.sample.gradePct).toBeNull();
  expect(r.sample.gear).toBeNull();
  expect(e.state().gradePct).toBeNull();
});
test('a climb is entered gently over 25 seconds', () => {
  const c = clock(); const e = make(c, { resumeAtS: 60 });
  const first = run(e, c, 1).sample.targetW!;
  const middle = run(e, c, 12).sample.targetW!;
  const end = run(e, c, 13).sample.targetW!;
  expect(first).toBeLessThan(105);
  expect(middle).toBeGreaterThan(115);
  expect(middle).toBeLessThan(135);
  expect(end).toBe(150);
});
test('the heart rate limit also lowers the target on a climb', () => {
  const c = clock(); const e = make(c, { resumeAtS: 60, maxHrBpm: 170 });
  for (let i = 0; i < 40; i++) { c.step(); e.tick({ hrBpm: 180 }); }
  expect(e.state().autoReducedPct).toBe(5);
  expect(e.state().targetW).toBe(143);
});
test('null readings still produce a sample', () => {
  const c = clock();
  const r = run(make(c), c, 1);
  expect(r.sample.powerW).toBeNull();
  expect(r.sample.hrBpm).toBeNull();
});
test('is done after all steps', () => {
  const c = clock(); const e = make(c);
  run(e, c, 120);
  expect(e.isDone()).toBe(true);
});
test('a new step does not inherit an earlier adjustment', () => {
  const c = clock(); const e = new RideEngine({ session: { ...session, steps: [session.steps[0], session.steps[0]] }, ftpW: 200, nowMs: c.now });
  e.adjustTarget(10);
  run(e, c, 60);
  e.adjustTarget(5);
  expect(run(e, c, 1).sample.targetW).toBe(105);
});
describe('lowering during the ride', () => {
  const long: Session = { id: 's', name: 'x', steps: [{ kind: 'erg', durationS: 1000, ftpFraction: 1, label: 'A' }] };
  const auto = (c: ReturnType<typeof clock>, extra = {}) => new RideEngine({ session: long, ftpW: 200, nowMs: c.now, maxHrBpm: 170, ...extra });
  const feed = (e: RideEngine, c: ReturnType<typeof clock>, n: number, r: object) => {
    let last; const events: string[] = [];
    for (let i = 0; i < n; i++) { c.step(); last = e.tick(r); events.push(...last.events.map((x) => `${x.type}:${x.detail}`)); }
    return { last: last!, events };
  };
  test('heart rate above limit for 30 s lowers target by 5 %', () => {
    const c = clock(); const e = auto(c);
    expect(feed(e, c, 29, { hrBpm: 175, cadenceRpm: 90 }).last.sample.targetW).toBe(200);
    const { last, events } = feed(e, c, 2, { hrBpm: 175, cadenceRpm: 90 });
    expect(last.sample.targetW).toBe(190);
    expect(events).toContain('target-adjust:auto:hr');
  });
  test('short spike does nothing', () => {
    const c = clock(); const e = auto(c);
    feed(e, c, 20, { hrBpm: 175, cadenceRpm: 90 });
    feed(e, c, 5, { hrBpm: 150, cadenceRpm: 90 });
    expect(feed(e, c, 20, { hrBpm: 175, cadenceRpm: 90 }).last.sample.targetW).toBe(200);
  });
  test('cadence collapse lowers target', () => {
    const c = clock(); const e = auto(c);
    const { last, events } = feed(e, c, 21, { cadenceRpm: 40 });
    expect(last.sample.targetW).toBe(190);
    expect(events).toContain('target-adjust:auto:cadence');
  });
  test('reduction stops at 20 %', () => {
    const c = clock(); const e = auto(c);
    expect(feed(e, c, 500, { hrBpm: 190, cadenceRpm: 90 }).last.sample.targetW).toBe(160);
  });
  test('missing readings never reduce', () => {
    const c = clock(); const e = auto(c);
    expect(feed(e, c, 200, {}).last.sample.targetW).toBe(200);
  });
  test('no pulse limit means no pulse reduction', () => {
    const c = clock(); const e = auto(c, { maxHrBpm: undefined });
    expect(feed(e, c, 100, { hrBpm: 200, cadenceRpm: 90 }).last.sample.targetW).toBe(200);
  });
  test('ramp test is never reduced', () => {
    const c = clock();
    const e = new RideEngine({ session: { ...long, id: 'ramp-test' }, ftpW: 200, nowMs: c.now, maxHrBpm: 170 });
    expect(feed(e, c, 100, { hrBpm: 190, cadenceRpm: 30 }).last.sample.targetW).toBe(200);
  });
  test('a new step starts without the reduction', () => {
    const c = clock();
    const e = new RideEngine({ session: { ...long, steps: [{ ...long.steps[0], durationS: 40 }, { ...long.steps[0], durationS: 100 }] }, ftpW: 200, nowMs: c.now, maxHrBpm: 170 });
    feed(e, c, 35, { hrBpm: 190, cadenceRpm: 90 });
    expect(feed(e, c, 6, { hrBpm: 150, cadenceRpm: 90 }).last.sample.targetW).toBe(200);
  });
});
describe('lowering: pauses and display', () => {
  const long: Session = { id: 's', name: 'x', steps: [{ kind: 'erg', durationS: 1000, ftpFraction: 1, label: 'A' }] };
  const run = (e: RideEngine, c: ReturnType<typeof clock>, n: number, r: object) => { let last; for (let i = 0; i < n; i++) { c.step(); last = e.tick(r); } return last!; };
  test('not pedalling is a pause, not a collapse', () => {
    const c = clock(); const e = new RideEngine({ session: long, ftpW: 200, nowMs: c.now });
    expect(run(e, c, 60, { cadenceRpm: 0, powerW: 0 }).sample.targetW).toBe(200);
  });
  test('state reports the automatic reduction', () => {
    const c = clock(); const e = new RideEngine({ session: long, ftpW: 200, nowMs: c.now });
    expect(e.state().autoReducedPct).toBe(0);
    run(e, c, 21, { cadenceRpm: 40 });
    expect(e.state().autoReducedPct).toBe(5);
  });
  test('counters restart with a new step', () => {
    const c = clock();
    const steps = [{ kind: 'erg' as const, durationS: 25, ftpFraction: 1, label: 'A' }, { kind: 'erg' as const, durationS: 100, ftpFraction: 1, label: 'B' }];
    const e = new RideEngine({ session: { ...long, steps }, ftpW: 200, nowMs: c.now, maxHrBpm: 170 });
    run(e, c, 26, { hrBpm: 180, cadenceRpm: 90 });
    expect(run(e, c, 10, { hrBpm: 180, cadenceRpm: 90 }).sample.targetW).toBe(200);
  });
});
describe('Pause', () => {
  const session: Session = { id: 's', name: 'x', steps: [{ kind: 'erg', durationS: 1000, ftpFraction: 1, label: 'A' }] };
  const setup = () => { const c = clock(); return { c, e: new RideEngine({ session, ftpW: 200, nowMs: c.now }) }; };
  const run = (e: RideEngine, c: ReturnType<typeof clock>, n: number, r: object) => { const ev: string[] = []; let last; for (let i = 0; i < n; i++) { c.step(); last = e.tick(r); ev.push(...last.events.map((x) => x.type)); } return { last: last!, ev }; };
  test('zero power for 4 s pauses the clock and the step', () => {
    const { c, e } = setup();
    run(e, c, 10, { powerW: 150 });
    const { ev } = run(e, c, 30, { powerW: 0 });
    expect(ev).toContain('pause');
    expect(e.state().paused).toBe(true);
    expect(e.state().rideElapsedS).toBeLessThanOrEqual(14);
  });
  test('samples keep being recorded while paused', () => {
    const { c, e } = setup();
    const a = run(e, c, 10, { powerW: 0 }).last.sample.seq;
    expect(run(e, c, 5, { powerW: 0 }).last.sample.seq).toBe(a + 5);
  });
  test('more than 40 W resumes where it stopped', () => {
    const { c, e } = setup();
    run(e, c, 10, { powerW: 0 });
    const at = e.state().rideElapsedS;
    expect(run(e, c, 3, { powerW: 20 }).last.sample.rideElapsedS).toBe(at);
    const { ev } = run(e, c, 1, { powerW: 100 });
    expect(ev).toContain('resume');
    expect(e.state().paused).toBe(false);
    expect(e.state().rideElapsedS).toBe(at + 1);
  });
  test('missing power never pauses', () => {
    const { c, e } = setup();
    run(e, c, 30, {});
    expect(e.state().paused).toBe(false);
    expect(e.state().rideElapsedS).toBe(30);
  });
});
describe('heart rate zone', () => {
  const steady = (hrZone?: number): Session => ({ id: 'z', name: 'x', steps: [{ kind: 'erg', durationS: 600, ftpFraction: 0.5, label: 'A', ...(hrZone ? { hrZone } : {}) }] });
  const ride = (session: Session, seconds: number, hrBpm: number | undefined, extra = {}) => {
    const c = clock(); const e = new RideEngine({ session, ftpW: 200, nowMs: c.now, hrMaxBpm: 200, ...extra });
    for (let i = 0; i < seconds; i++) { c.step(); e.tick({ ...(hrBpm ? { hrBpm } : {}) }); }
    return e;
  };
  test('above the set zone for a minute lowers the target, after the heart had time to settle', () => {
    expect(ride(steady(2), 200, 150).state().autoReducedPct).toBe(0);
    expect(ride(steady(2), 245, 150).state().autoReducedPct).toBe(5);
  });
  test('inside the zone nothing changes', () => {
    expect(ride(steady(2), 400, 135).state().autoReducedPct).toBe(0);
  });
  test('only sections with a set zone are regulated', () => {
    expect(ride(steady(), 400, 180).state().autoReducedPct).toBe(0);
  });
  test('without a heart rate the ride just runs on watts', () => {
    expect(ride(steady(2), 400, undefined).state().autoReducedPct).toBe(0);
  });
  test('without a known maximum nothing is regulated', () => {
    expect(ride(steady(2), 400, 180, { hrMaxBpm: undefined }).state().autoReducedPct).toBe(0);
  });
  test('it never lowers by more than a fifth', () => {
    expect(ride(steady(2), 600, 190).state().autoReducedPct).toBeLessThanOrEqual(20);
  });
});
test('a climb marked sudden starts at full target at once', () => {
  const sudden: Session = { id: 's', name: 'x', steps: [session.steps[0], { ...session.steps[1], sudden: true } as Session['steps'][number]] };
  const c = clock(); const e = new RideEngine({ session: sudden, ftpW: 200, nowMs: c.now, resumeAtS: 60 });
  expect(run(e, c, 1).sample.targetW).toBe(150);
});

describe('holding a heart rate', () => {
  const hold: Session = { id: 'h', name: 'Puls', steps: [{ kind: 'erg', durationS: 1200, ftpFraction: 0.6, label: 'Puls halten', hrZone: 2, hrHold: true }] };
  // Maximum heart rate 200: zone 2 is 120 to 140 bpm.
  const setup = (s = hold, extra = {}) => { const c = clock(); return { c, e: new RideEngine({ session: s, ftpW: 200, nowMs: c.now, hrMaxBpm: 200, ...extra }) }; };
  const ride = (e: RideEngine, c: ReturnType<typeof clock>, n: number, hrBpm?: number) => {
    const events = [];
    for (let i = 0; i < n; i++) { c.step(); events.push(...e.tick({ powerW: 120, ...(hrBpm === undefined ? {} : { hrBpm }) }).events); }
    return events;
  };

  test('leaves the watts alone for the first 3 minutes, heart rate lags', () => {
    const { c, e } = setup();
    ride(e, c, 179, 100);
    expect(e.state().targetW).toBe(120);
  });
  test('adds watts slowly while the heart rate stays below the zone', () => {
    const { c, e } = setup();
    ride(e, c, 180, 100);
    const events = ride(e, c, 30, 100);
    expect(e.state().targetW).toBe(122);
    expect(events).toContainEqual(expect.objectContaining({ type: 'target-adjust', detail: 'hold:up' }));
  });
  test('takes watts away while the heart rate stays above the zone', () => {
    const { c, e } = setup();
    ride(e, c, 180, 100);
    const events = ride(e, c, 30, 150);
    expect(e.state().targetW).toBe(116);
    expect(events).toContainEqual(expect.objectContaining({ type: 'target-adjust', detail: 'hold:down' }));
  });
  test('does nothing inside the zone', () => {
    const { c, e } = setup();
    ride(e, c, 600, 130);
    expect(e.state().targetW).toBe(120);
  });
  test('never rises more than 15 % above the start, however low the heart rate', () => {
    const { c, e } = setup();
    ride(e, c, 1190, 80);
    expect(e.state().targetW).toBe(138);
  });
  test('never rises above 80 % of FTP, even from a high start', () => {
    const high: Session = { id: 'h', name: 'x', steps: [{ kind: 'erg', durationS: 1200, ftpFraction: 0.75, label: 'A', hrZone: 3, hrHold: true }] };
    const { c, e } = setup(high);
    ride(e, c, 1190, 80);
    expect(e.state().targetW).toBe(160);
  });
  test('without a heart rate the watts stay where they are', () => {
    const { c, e } = setup();
    ride(e, c, 600);
    expect(e.state().targetW).toBe(120);
  });
  test('without a known maximum heart rate it is an ordinary watt section', () => {
    const c = clock(); const e = new RideEngine({ session: hold, ftpW: 200, nowMs: c.now });
    ride(e, c, 600, 80);
    expect(e.state().targetW).toBe(120);
  });
  test('after the heart rate limit has lowered the target it never rises again in this section', () => {
    const { c, e } = setup(hold, { maxHrBpm: 145 });
    ride(e, c, 180, 150);
    expect(e.state().autoReducedPct).toBeGreaterThan(0);
    const before = e.state().targetW!;
    ride(e, c, 300, 100);
    expect(e.state().targetW).toBeLessThanOrEqual(before);
  });
  test('a pause does not count as seconds below the zone', () => {
    const { c, e } = setup();
    ride(e, c, 200, 100);
    const before = e.state().targetW;
    for (let i = 0; i < 120; i++) { c.step(); e.tick({ powerW: 0, hrBpm: 100 }); }
    expect(e.state().paused).toBe(true);
    expect(e.state().targetW).toBe(before);
  });
  test('the next section starts from its own watts again', () => {
    const two: Session = { id: 'h', name: 'x', steps: [hold.steps[0], { kind: 'erg', durationS: 600, ftpFraction: 0.45, label: 'B' }] };
    const { c, e } = setup(two);
    ride(e, c, 1205, 100);
    expect(e.state().targetW).toBe(90);
  });
});

test('skipStep ends the step, keeps the ride clock continuous and switches the target at once', () => {
  const c = clock(); const e = make(c);
  run(e, c, 10);
  const ev = e.skipStep();
  expect(ev).toMatchObject({ type: 'skip', detail: '0:50' });
  expect(e.state().stepIndex).toBe(1);
  expect(e.state().rideElapsedS).toBe(10);
  const a = run(e, c, 1), b = run(e, c, 1);
  expect([a.sample.rideElapsedS, b.sample.rideElapsedS]).toEqual([11, 12]);
  expect(e.state().label).toBe('B');
});
test('skipStep ends the session earlier in real time', () => {
  const c = clock(); const e = make(c);
  run(e, c, 10); e.skipStep();
  run(e, c, 59);
  expect(e.isDone()).toBe(false);
  run(e, c, 1);
  expect(e.isDone()).toBe(true);
  expect(e.state().rideElapsedS).toBe(70);
});
test('resume after a skip continues in the right step', () => {
  const c = clock(); const e = make(c, { resumeAtS: 20, skippedS: 50 });
  expect(e.state().stepIndex).toBe(1);
  expect(e.state().stepRemainingS).toBe(50);
  expect(run(e, c, 1).sample.rideElapsedS).toBe(21);
});
test('skipStep drops a manual adjustment of the skipped step', () => {
  const c = clock(); const e = new RideEngine({ session: { ...session, steps: [session.steps[0], session.steps[0]] }, ftpW: 200, nowMs: c.now });
  run(e, c, 1); e.adjustTarget(10); e.skipStep();
  expect(run(e, c, 1).sample.targetW).toBe(100);
});
test('skipStep is ignored on the last step and at the end', () => {
  const c = clock(); const e = make(c, { resumeAtS: 70 });
  expect(e.skipStep()).toBeNull();
  expect(e.state().rideElapsedS).toBe(70);
  expect(make(c, { resumeAtS: 20, skippedS: 50 }).skipStep()).toBeNull();
  const done = make(c, { resumeAtS: 120 });
  expect(done.skipStep()).toBeNull();
});
test('skipStep is ignored while paused', () => {
  const c = clock(); const e = make(c);
  run(e, c, 1);
  for (let i = 0; i < 4; i++) { c.step(); e.tick({ powerW: 0 }); }
  expect(e.state().paused).toBe(true);
  expect(e.skipStep()).toBeNull();
  expect(e.state().stepIndex).toBe(0);
});
