import { describe, expect, it, vi } from 'vitest';
import { apiFetch, jsonInit } from '../../src/tracking/ui/data/api';

describe('apiFetch', () => {
  it('sends same-origin, refuses redirects and sets a timeout signal', async () => {
    const f = vi.fn(async (_p: string, _i?: RequestInit) => new Response('{}'));
    await apiFetch(f as unknown as typeof fetch, '/me', { method: 'GET' });
    const [path, init] = f.mock.calls[0]!;
    expect(path).toBe('/me');
    expect(init!).toMatchObject({ method: 'GET', credentials: 'same-origin', redirect: 'error' });
    expect(init!.signal).toBeInstanceOf(AbortSignal);
  });
  it('a caller cannot weaken the credentials or redirect policy', async () => {
    const f = vi.fn(async (_p: string, _i?: RequestInit) => new Response('{}'));
    await apiFetch(f as unknown as typeof fetch, '/x', { credentials: 'include', redirect: 'follow' });
    expect(f.mock.calls[0]![1]).toMatchObject({ credentials: 'same-origin', redirect: 'error' });
  });
  it('jsonInit makes a JSON POST', () => {
    expect(jsonInit('POST', { a: 1 })).toEqual({ method: 'POST', headers: { 'content-type': 'application/json' }, body: '{"a":1}' });
  });
});
