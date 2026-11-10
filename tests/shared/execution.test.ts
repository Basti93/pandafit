import { describe, expect, it } from 'vitest';
import { EXERCISES, type Exercise } from '../../src/shared/exercises';
import { FEDB_EXERCISES } from '../../src/shared/fedb';
import { executionKey } from '../../src/shared/execution';

const byId = (id: string): Exercise => [...EXERCISES, ...FEDB_EXERCISES].find((e) => e.id === id)!;
const key = (id: string) => executionKey(byId(id));

describe('executionKey', () => {
  it('rope and cable pushdown are the same execution', () => {
    expect(key('pf-triceps-rope')).not.toBeNull();
    expect(key('pf-triceps-rope')).toBe(key('pf-triceps-pushdown'));
  });
  it('pushdown and overhead extension differ', () => {
    expect(key('pf-triceps-rope')).not.toBe(key('pf-overhead-triceps-cable'));
  });
  it('cable crunch and decline-bench crunch differ', () => {
    expect(key('pf-crunch-cable')).not.toBe(key('fedb-decline-crunch'));
  });
  it('preacher curl and behind-the-back cable curl differ', () => {
    expect(key('pf-preacher-curl')).not.toBe(key('pf-behind-back-curl-cable'));
  });
  it('family other has no key', () => {
    expect(executionKey({ title: 'Irgendwas am Kabel', primaryMuscle: 'triceps' })).toBeNull();
    expect(executionKey({ title: 'Irgendwas', family: 'nonsense', primaryMuscle: 'triceps' })).toBeNull();
  });
});
