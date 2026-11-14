// @vitest-environment jsdom
import { beforeEach, describe, expect, it } from 'vitest';
import { restBeepAt, restSoundOn, saveRestSound } from '../../src/tracking/ui/workout/restSound';

describe('restBeepAt', () => {
  it('beeps for 3, 2, 1 and 0 when one second passes', () => {
    expect(restBeepAt(4, 3)).toBe(3);
    expect(restBeepAt(3, 2)).toBe(2);
    expect(restBeepAt(2, 1)).toBe(1);
    expect(restBeepAt(1, 0)).toBe(0);
  });
  it('stays silent for the same second, early seconds and the first look', () => {
    expect(restBeepAt(3, 3)).toBeNull();
    expect(restBeepAt(10, 9)).toBeNull();
    expect(restBeepAt(null, 2)).toBeNull();
  });
  it('stays silent for jumps and extensions', () => {
    expect(restBeepAt(40, 0)).toBeNull();
    expect(restBeepAt(2, 32)).toBeNull();
  });
});

describe('restSoundOn', () => {
  beforeEach(() => localStorage.clear());
  it('is on by default and off after saving off', () => {
    expect(restSoundOn()).toBe(true);
    saveRestSound(false);
    expect(restSoundOn()).toBe(false);
    saveRestSound(true);
    expect(restSoundOn()).toBe(true);
  });
});
