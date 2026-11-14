import { describe, expect, it } from 'vitest';
import { Decoder, Stream } from '@garmin/fitsdk';
import { exportStrengthFit } from '../../src/ride-format/export/strength-fit';

describe('exportStrengthFit', () => {
  it('schreibt eine Aktivität Krafttraining mit Start und Dauer', () => {
    const startMs = Date.UTC(2026, 10, 14, 9, 0, 0);
    const buf = exportStrengthFit({ startMs, endMs: startMs + 45 * 60_000 });
    const d = new Decoder(Stream.fromBuffer(buf));
    expect(Decoder.isFIT(Stream.fromBuffer(buf))).toBe(true);
    expect(d.checkIntegrity()).toBe(true);
    const { messages } = d.read();
    expect(messages.fileIdMesgs[0].type).toBe('activity');
    const s = messages.sessionMesgs[0];
    expect(s.sport).toBe('training');
    expect(s.subSport).toBe('strengthTraining');
    expect(s.totalElapsedTime).toBe(2700);
    expect(s.totalTimerTime).toBe(2700);
    expect(s.startTime).toEqual(new Date(startMs));
    expect(messages.activityMesgs).toHaveLength(1);
    expect(messages.recordMesgs ?? []).toHaveLength(0);
  });
});
