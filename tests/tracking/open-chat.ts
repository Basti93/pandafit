import { fireEvent, screen, waitFor, within } from '@testing-library/react';

/** The Woche page has a row "Coach" that opens the chat sheet; without a week plan the button "Woche planen" does. */
export async function openChat(): Promise<HTMLElement> {
  const row = await screen.findAllByRole('button', { name: /^(Bo|Woche planen)/ });
  fireEvent.click(row.find((b) => b.textContent?.startsWith("Bo")) ?? row[0]!);
  return screen.findByRole('dialog', { name: 'Bo, dein Sensei' });
}

/** The first open proposal stands in Bo's bubble in the chat; this finds it there (a week plan is a group, the others are their cards). */
export async function proposalIn(chat?: HTMLElement): Promise<HTMLElement> {
  const bubble = await within(chat ?? (await screen.findByRole('dialog', { name: 'Bo, dein Sensei' }))).findByRole('button', { name: 'Übernehmen' });
  await waitFor(() => expect((bubble as HTMLButtonElement).disabled).toBe(false)); // the card reads its records first
  return (bubble.closest('.tk-bubble') as HTMLElement | null) ?? bubble;
}

/** More open proposals wait behind one strip above the input; it opens them in a small sheet. */
export async function openMoreProposals(): Promise<HTMLElement> {
  fireEvent.click(await screen.findByRole('button', { name: /^Bo hat noch/ }));
  return screen.findByRole('dialog', { name: /^Vorschl(ag|äge)$/ });
}
