import { describe, expect, it } from 'vitest';
import { contactOf, contactRecord, isEmail, readContact, updatesOf } from '../../src/shared/contact';
import { RECORD_KINDS } from '../../src/shared/records';
import { validBody } from '../../src/web/validate';
import { contactOfProfile } from '../../src/coach/tracking/contact';

describe('isEmail', () => {
  it('accepts simple addresses', () => {
    for (const a of ['a@example.org', 'anna.b+pf@mail.example.org', 'x_y-z%1@a-b.co']) expect(isEmail(a)).toBe(true);
  });
  it('refuses anything else', () => {
    const long = `${'a'.repeat(64)}@${'b'.repeat(190)}.org`;
    for (const a of ['', 'a', 'a@b', 'a@@b.org', 'a@b.org ', ' a@b.org', 'a b@c.org', 'a@b.org\n', 'a@b.org\r\nBcc: x@y.org', 'a@b.org,c@d.org', 'a@b.org;c@d.org', '@b.org', 'a@.org', 'a@b..org', 'a@b.org.', long, 5, null, ['a@b.org']]) expect(isEmail(a)).toBe(false);
  });
});

describe('contact record: updates', () => {
  it('an old body without updates is valid and reads as on; a non-boolean is refused', () => {
    const old = { email: null, weekly: false, atMs: 1 };
    expect(validBody('contact', old)).toBe(true);
    expect(readContact(old)).toEqual(old);
    expect(updatesOf([{ kind: 'contact', id: 'contact', updatedMs: 1, deleted: false, body: old }])).toBe(true);
    expect(updatesOf([])).toBe(true);
    expect(validBody('contact', { ...old, updates: false })).toBe(true);
    expect(validBody('contact', { ...old, updates: 'no' })).toBe(false);
  });
  it('is kept when not given, replaced when given, and stays missing when never set', () => {
    const off = contactRecord({ email: null, weekly: false, updates: false }, 10);
    expect(updatesOf([off])).toBe(false);
    const again = contactRecord({ email: 'a@example.org', weekly: true }, 20, off);
    expect(updatesOf([again])).toBe(false);
    expect(updatesOf([contactRecord({ email: null, weekly: false, updates: true }, 30, again)])).toBe(true);
    expect('updates' in (contactRecord({ email: null, weekly: false }, 1).body as object)).toBe(false);
  });
});

describe('contact record', () => {
  it('is a known, validated kind', () => {
    expect(RECORD_KINDS).toContain('contact');
    expect(validBody('contact', { email: 'a@example.org', weekly: true, atMs: 1 })).toBe(true);
    expect(validBody('contact', { email: null, weekly: false, atMs: 1 })).toBe(true);
    expect(validBody('contact', { email: 'nope', weekly: false, atMs: 1 })).toBe(false);
    expect(validBody('contact', { email: 'a@example.org', weekly: 'yes', atMs: 1 })).toBe(false);
    expect(validBody('contact', { email: 'a@example.org', weekly: true })).toBe(false);
    expect(readContact(undefined)).toBeNull();
  });
  it('is stamped above the stored one; without a record there is no address', () => {
    const first = contactRecord({ email: 'a@example.org', weekly: true }, 100);
    expect(contactRecord({ email: null, weekly: false }, 50, first).updatedMs).toBe(101);
    expect(contactOf([])).toEqual({ email: null, weekly: false });
    expect(contactOf([first])).toEqual({ email: 'a@example.org', weekly: true });
    expect(contactOf([{ ...first, deleted: true }])).toEqual({ email: null, weekly: false });
    expect(contactOf([{ ...first, body: { junk: 1 } }])).toEqual({ email: null, weekly: false });
  });
  it('the coach reads it, and a broken store means no address', () => {
    const rec = contactRecord({ email: 'a@example.org', weekly: true }, 1);
    expect(contactOfProfile({ all: () => [rec] }, 'p1')).toEqual({ email: 'a@example.org', weekly: true });
    expect(contactOfProfile({ all: () => { throw new Error('x'); } }, 'p1')).toEqual({ email: null, weekly: false });
  });
});
