import { BO } from '../../src/shared/bo';
import { fireEvent, screen, waitFor, within } from '@testing-library/react';

/** Bo's bubble on the Woche page has the button "Frag Bo, deinen Sensai"; it opens the chat. */
export async function openChat(): Promise<HTMLElement> {
  fireEvent.click(await screen.findByRole('button', { name: BO.ask }));
  return screen.findByRole('dialog', { name: 'Bo, dein Sensai' });
}

/** The first open proposal stands in Bo's bubble in the chat; this finds it there (a week plan is a group, the others are their cards). */
export async function proposalIn(chat?: HTMLElement): Promise<HTMLElement> {
  const bubble = await within(chat ?? (await screen.findByRole('dialog', { name: 'Bo, dein Sensai' }))).findByRole('button', { name: 'Übernehmen' });
  await waitFor(() => expect((bubble as HTMLButtonElement).disabled).toBe(false)); // the card reads its records first
  return (bubble.closest('.tk-bubble') as HTMLElement | null) ?? bubble;
}

/** More open proposals wait behind one strip above the input; it opens them in a small sheet. */
export async function openMoreProposals(): Promise<HTMLElement> {
  fireEvent.click(await screen.findByRole('button', { name: /^Bo hat noch/ }));
  return screen.findByRole('dialog', { name: /^Vorschl(ag|äge)$/ });
}
