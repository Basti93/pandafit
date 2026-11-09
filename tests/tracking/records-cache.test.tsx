// @vitest-environment jsdom
import { act, cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import type { TrackedRecord } from '../../src/shared/records';
import { RecordsProvider } from '../../src/tracking/ui/data/RecordsProvider';
import { usePortRecords } from '../../src/tracking/ui/hooks';
import type { TrackingPort } from '../../src/tracking/ports';
import { fakePort } from './fake-port';

const rec = (kind: TrackedRecord['kind'], id: string, updatedMs = 1): TrackedRecord => ({ kind, id, updatedMs, deleted: false, body: { id } });
const flush = () => act(async () => { await new Promise((r) => setTimeout(r, 0)); });

function Count({ port, kind, tag }: { port: TrackingPort; kind: TrackedRecord['kind']; tag: string }) {
  const { records } = usePortRecords(port, kind);
  return <span data-testid={tag}>{records === null ? 'null' : records.length}</span>;
}

afterEach(cleanup);

describe('records cache', () => {
  it('13 subscribers of one kind cause one read', async () => {
    const { port, state } = fakePort([rec('workout', 'a')]);
    render(<RecordsProvider port={port}>{Array.from({ length: 13 }, (_, i) => <Count key={i} port={port} kind="workout" tag={`c${i}`} />)}</RecordsProvider>);
    await flush();
    expect(state.lists).toEqual(['workout']);
    expect(screen.getByTestId('c12').textContent).toBe('1');
  });

  it('a write to kind A does not reload kind B, and all subscribers of A see it', async () => {
    const { port, state } = fakePort();
    render(<RecordsProvider port={port}><Count port={port} kind="workout" tag="w1" /><Count port={port} kind="workout" tag="w2" /><Count port={port} kind="routine" tag="r" /></RecordsProvider>);
    await flush();
    state.lists.length = 0;
    await act(async () => { await port.put(rec('workout', 'x')); });
    await flush();
    expect(state.lists).toEqual(['workout']);
    expect(screen.getByTestId('w1').textContent).toBe('1');
    expect(screen.getByTestId('w2').textContent).toBe('1');
    expect(screen.getByTestId('r').textContent).toBe('0');
  });

  it('a failed first read is reported and retry loads again', async () => {
    const { port, state } = fakePort([rec('workout', 'a')]);
    state.failList = true;
    function Probe() { const r = usePortRecords(port, 'workout'); return <button onClick={r.retry}>{r.failed ? 'failed' : String(r.records?.length ?? 'null')}</button>; }
    render(<RecordsProvider port={port}><Probe /></RecordsProvider>);
    await flush();
    expect(screen.getByRole('button').textContent).toBe('failed');
    state.failList = false;
    await act(async () => { screen.getByRole('button').click(); });
    await flush();
    expect(screen.getByRole('button').textContent).toBe('1');
  });

  it('a read that overlaps a write is dropped, so a reader never sees a list older than the write', async () => {
    const { port, state } = fakePort();
    render(<RecordsProvider port={port}><Count port={port} kind="workout" tag="w" /></RecordsProvider>);
    await flush();
    let release!: () => void;
    state.gate = new Promise<void>((r) => { release = r; });
    const slow = port.list;
    port.list = async (k) => { const before = await slow(k); await state.gate; return before; };
    await act(async () => { port.list('workout'); });
    port.list = slow;
    state.gate = null;
    release();
    await act(async () => { await port.put(rec('workout', 'x')); });
    await flush();
    expect(screen.getByTestId('w').textContent).toBe('1');
  });

  it('works without a provider and without per-kind notices', async () => {
    const { port } = fakePort([rec('workout', 'a')]);
    delete (port as { subscribeKind?: unknown }).subscribeKind;
    render(<Count port={port} kind="workout" tag="n" />);
    await flush();
    expect(screen.getByTestId('n').textContent).toBe('1');
    await act(async () => { await port.put(rec('workout', 'b')); });
    await flush();
    expect(screen.getByTestId('n').textContent).toBe('2');
  });

  it('cached records are frozen outside production', async () => {
    const { port } = fakePort([rec('workout', 'a')]);
    let got: TrackedRecord | undefined;
    function P() { got = usePortRecords(port, 'workout').records?.[0]; return null; }
    render(<RecordsProvider port={port}><P /></RecordsProvider>);
    await flush();
    expect(() => { (got!.body as { id: string }).id = 'z'; }).toThrow();
  });
});
