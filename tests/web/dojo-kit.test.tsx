// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { BoBubble, Bubble, Icon, MainCard, PageHead, RowCard, Sheet } from '../../src/tracking/ui/kit';
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
    expect(document.querySelector('.tk-bubble-tail')).toBeNull();
  });
  it('draws every registered icon with currentColor only', () => {
    for (const name of ['heute', 'woche', 'kraft', 'essen', 'ausdauer', 'profil', 'lauf', 'herz', 'spross', 'mond', 'ziel', 'stift', 'sprechen', 'senden', 'zurueck', 'haken', 'rueckblick', 'regeln', 'aenderung'] as const) {
      const { container, unmount } = render(<Icon name={name} />);
      const svg = container.querySelector(`svg[data-icon="${name}"]`)!;
      expect(svg.getAttribute('aria-hidden')).toBe('true');
      expect(svg.outerHTML).not.toMatch(/#[0-9a-f]{3,8}/i);
      unmount();
    }
  });
  it('builds a row card with icon tile, kicker, title and the end mark', () => {
    const go = vi.fn();
    render(<RowCard icon="lauf" kicker="Morgen" title="Lockere Radfahrt" sub="Rad, ganz entspannt" onClick={go} />);
    const b = screen.getByRole('button', { name: /Lockere Radfahrt/ });
    expect(b.querySelector('svg[data-icon="lauf"]')).toBeTruthy();
    expect(b.textContent).toContain('Morgen');
    fireEvent.click(b);
    expect(go).toHaveBeenCalled();
    cleanup();
    render(<RowCard flat lead="Mo" icon="kraft" title="Beine" end="done" />);
    expect(screen.queryByRole('button')).toBeNull();
    expect(document.querySelector('svg[data-icon="haken"]')).toBeTruthy();
  });
  it('lets a main card go without a primary button and carry quiet extras', () => {
    render(<MainCard kicker="Jetzt dran" title="Ruhetag" text="Erholung gehört zum Training." more={<button type="button" className="secondary">Etwas anderes heute?</button>} />);
    const card = screen.getByRole('region', { name: 'Jetzt dran' });
    expect(card.querySelector('button.primary')).toBeNull();
    expect(within(card).getByRole('button', { name: 'Etwas anderes heute?' })).toBeTruthy();
  });
  it('shows the own message as a right bubble and a sheet page with a back button', () => {
    render(<Bubble tail="right" foot="14:05">Am Samstag habe ich keine Zeit.</Bubble>);
    expect(document.querySelector('.tk-bubble.right')).toBeTruthy();
    expect(document.querySelector('.tk-bubble')!.textContent).toContain('14:05');
    cleanup();
    const close = vi.fn();
    render(<Sheet page title="Bo, dein Sensei" onClose={close}><p>x</p></Sheet>);
    expect(screen.queryByRole('button', { name: 'Schließen' })).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Zurück' }));
    expect(close).toHaveBeenCalled();
  });
  it('gives every page title the brush stroke', () => {
    render(<PageHead title="Deine Woche" back={{ label: 'Woche', onClick: () => {} }} />);
    const h1 = screen.getByRole('heading', { level: 1, name: 'Deine Woche' });
    expect(h1.closest('.tk-brush')).toBeTruthy();
    expect(screen.getByRole('button', { name: /Woche/ })).toBeTruthy();
  });
});
