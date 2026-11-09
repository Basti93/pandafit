// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { BoBubble, MainCard } from '../../src/tracking/ui/kit';
import { BO } from '../../src/tracking/ui/bo';

afterEach(cleanup);

describe('Dojo kit', () => {
  it('builds the main card from the shared card, kicker and brush title', () => {
    const go = vi.fn();
    render(<MainCard kicker="Jetzt dran" title="Oberkörper" text="Krafttraining, etwa 45 Minuten" primary={{ label: 'Training starten', onClick: go }} secondary={{ label: 'Ansehen', onClick: () => {} }} />);
    const card = screen.getByRole('region', { name: 'Jetzt dran' });
    expect(card.classList.contains('card')).toBe(true);
    expect(card.querySelector('.tk-kicker')?.textContent).toBe('Jetzt dran');
    expect(within(card).getByRole('heading', { level: 2, name: 'Oberkörper' })).toBeTruthy();
    fireEvent.click(within(card).getByRole('button', { name: 'Training starten' }));
    expect(go).toHaveBeenCalled();
  });
  it('lets Bo speak in a bubble, with or without his portrait', () => {
    const { rerender } = render(<BoBubble actions={<button type="button">{BO.ask}</button>}>Heute kommt das dritte Training.</BoBubble>);
    expect(document.querySelector('.tk-bubble')?.textContent).toContain('Heute kommt das dritte Training.');
    expect(screen.getByRole('button', { name: 'Frag Bo, deinen Sensei' })).toBeTruthy();
    expect(document.querySelector('.tk-panda')).not.toBeNull();
    rerender(<BoBubble portrait="none">Nur die Blase.</BoBubble>);
    expect(document.querySelector('.tk-panda')).toBeNull();
    expect(document.querySelector('.tk-bubble-tail')).not.toBeNull();
  });
});
