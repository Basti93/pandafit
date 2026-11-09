// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { BackButton, BoBubble, Band, Bubble, Card, HeadCard, Icon, Kicker, MainCard, MarkDot, MealPicture, PageHead, PillButton, RoundButton, Row, RowCard, RowList, Segments, Sheet, StandCard, Switch } from '../../src/tracking/ui/kit';
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
  it('a head card names its region by the title and carries kicker, h1 and sentence', () => {
    render(<HeadCard kicker="Montag, 9. November" title="Essen" text="Als Nächstes gibt es um 13 Uhr Skyr." />);
    const card = screen.getByRole('region', { name: 'Essen' });
    expect(within(card).getByRole('heading', { level: 1, name: 'Essen' })).toBeTruthy();
    expect(card.textContent).toContain('Als Nächstes gibt es um 13 Uhr Skyr.');
  });
  it('a head card with an icon shows the round avatar and a level-2 title', () => {
    render(<HeadCard icon="profil" level={2} title="anna" />);
    expect(screen.getByRole('heading', { level: 2, name: 'anna' })).toBeTruthy();
    expect(screen.getByRole('region', { name: 'anna' }).querySelector('svg[data-icon="profil"]')).toBeTruthy();
  });
  it('a meal picture uses its symbol from brand/meals.svg', () => {
    const { container } = render(<MealPicture slot="abend" size="big" />);
    expect(container.querySelector('use')!.getAttribute('href')).toBe('/brand/meals.svg#abend');
  });
  it('a row card can carry a picture instead of an icon; a main card a picture on top', () => {
    render(<><RowCard picture={<MealPicture slot="mittag" />} kicker="Mittagessen · 13 Uhr" title="Linsen-Bolognese" onClick={() => {}} /><MainCard kicker="Jetzt dran" title="Skyr" picture={<MealPicture slot="mittag" size="big" />} /></>);
    expect(screen.getByRole('button', { name: /Linsen-Bolognese/ }).querySelector('use')).toBeTruthy();
    expect(screen.getByRole('region', { name: 'Jetzt dran' }).querySelector('svg.tk-meal.big')).toBeTruthy();
  });
  it('a row and a switch can carry an icon tile and a hint', () => {
    render(<><RowList><Row icon="uhr" title="Garmin" hint="Ruhepuls und Läufe übernehmen" value="optional" onClick={() => {}} /></RowList><Switch icon="glocke" label="Benachrichtigungen" checked={false} onChange={() => {}} /></>);
    expect(screen.getByRole('button', { name: /Garmin/ }).querySelector('svg[data-icon="uhr"]')).toBeTruthy();
    expect(screen.getByRole('switch', { name: 'Benachrichtigungen' }).closest('label')!.querySelector('svg[data-icon="glocke"]')).toBeTruthy();
  });
  it('a row without onClick is a calm row without a button, and shows its hint', () => {
    render(<RowList><Row icon="kraft" title="Kraftsatz" hint="Gewichte in Kilogramm" value="4" /></RowList>);
    expect(screen.queryByRole('button')).toBeNull();
    expect(screen.getByText('Gewichte in Kilogramm').className).toContain('tk-row-sub');
    expect(document.querySelector('svg[data-icon="kraft"]')).toBeTruthy();
  });
  it('a kicker can be a heading', () => {
    render(<Kicker heading>Nachrichten</Kicker>);
    expect(screen.getByRole('heading', { level: 2, name: 'Nachrichten' }).className).toBe('tk-kicker');
  });
  it('a round button can be pressed', () => {
    render(<RoundButton icon="favorit" name="Skyr aus den Favoriten nehmen" pressed onClick={() => {}} />);
    expect(screen.getByRole('button', { name: 'Skyr aus den Favoriten nehmen' }).getAttribute('aria-pressed')).toBe('true');
  });
  it('a page head without a title is only the back pill', () => {
    render(<PageHead back={{ label: 'Rezepte', onClick: () => {} }} />);
    expect(screen.queryByRole('heading')).toBeNull();
    expect(screen.getByRole('button', { name: 'Rezepte' }).className).toBe('tk-pill');
  });
  it('lets Bo speak in a bubble, with or without his portrait', () => {
    const { rerender } = render(<BoBubble actions={<button type="button">{BO.ask}</button>}>Heute kommt das dritte Training.</BoBubble>);
    expect(document.querySelector('.tk-bubble')?.textContent).toContain('Heute kommt das dritte Training.');
    expect(screen.getByRole('button', { name: 'Frag Bo, deinen Sensai' })).toBeTruthy();
    expect(document.querySelector('.tk-panda')).not.toBeNull();
    rerender(<BoBubble portrait="none">Nur die Blase.</BoBubble>);
    expect(document.querySelector('.tk-panda')).toBeNull();
    expect(document.querySelector('.tk-bubble-tail')).toBeNull();
  });
  it('draws every registered icon with currentColor only', () => {
    for (const name of ['heute', 'woche', 'kraft', 'essen', 'ausdauer', 'profil', 'lauf', 'herz', 'spross', 'mond', 'ziel', 'stift', 'sprechen', 'senden', 'zurueck', 'haken', 'rueckblick', 'regeln', 'aenderung', 'studio', 'wechsel', 'mehr', 'info', 'pause', 'plus', 'verkleinern', 'routinen', 'uebungen', 'entwicklung', 'rezepte', 'einkauf', 'favorit', 'blatt', 'uhr', 'brief', 'glocke', 'laterne'] as const) {
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
    render(<Sheet page title="Bo, dein Sensai" onClose={close}><p>x</p></Sheet>);
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
  it('a focus card has the accent line', () => {
    render(<Card focus label="Bankdrücken"><p>x</p></Card>);
    expect(screen.getByRole('region', { name: 'Bankdrücken' }).className).toBe('card focus');
  });
  it('a stand card says the week in words and keeps the count for screen readers', () => {
    render(<StandCard kicker="Kraft · diese Woche" text="Ein Krafttraining hast du geschafft." marks={['done', 'now']} marksLabel="1 von 2 Krafttrainings" action={{ label: 'Lauftage ändern', onClick: () => {} }} />);
    const card = screen.getByRole('region', { name: 'Kraft · diese Woche' });
    expect(within(card).getByRole('img', { name: '1 von 2 Krafttrainings' })).toBeTruthy();
    expect(card.textContent).not.toMatch(/\d/);
    expect(within(card).getByRole('button', { name: 'Lauftage ändern' }).className).toBe('secondary');
  });
  it('segments switch with aria-pressed and an icon', () => {
    const pick = vi.fn();
    render(<Segments label="Ausdauer" value="rad" onChange={pick} options={[{ value: 'rad', label: 'Rad', icon: 'ausdauer' }, { value: 'laufen', label: 'Laufen', icon: 'lauf' }]} />);
    const g = screen.getByRole('group', { name: 'Ausdauer' });
    expect(within(g).getByRole('button', { name: 'Rad' }).getAttribute('aria-pressed')).toBe('true');
    fireEvent.click(within(g).getByRole('button', { name: 'Laufen' }));
    expect(pick).toHaveBeenCalledWith('laufen');
  });
  it('a pill button carries its icon and an optional name; the back pill is the same pill', () => {
    render(<><PillButton icon="studio" label="Nord" name="Studio Nord" onClick={() => {}} /><BackButton label="Woche" onClick={() => {}} /></>);
    expect(screen.getByRole('button', { name: 'Studio Nord' }).querySelector('svg[data-icon="studio"]')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Woche' }).className).toBe('tk-pill');
  });
  it('a mark dot is a button only with onClick', () => {
    render(<><MarkDot state="done" /><MarkDot state="now" short="2" name="Satz 2: dran" onClick={() => {}} /></>);
    expect(screen.getAllByRole('button')).toHaveLength(1);
    expect(screen.getByRole('button', { name: 'Satz 2: dran' }).className).toBe('tk-mark now');
  });
  it('a band names itself only with a label', () => {
    render(<Band label="Ablauf: locker, hart" parts={[{ grow: 10, fill: 0 }, { grow: 30, fill: 1, tall: true }]} />);
    expect(screen.getByRole('img', { name: 'Ablauf: locker, hart' })).toBeTruthy();
  });
});
