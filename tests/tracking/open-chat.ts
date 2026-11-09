import { fireEvent, screen } from '@testing-library/react';

/** The Woche page has a row "Coach" that opens the chat sheet; without a week plan the button "Woche planen" does. */
export async function openChat(): Promise<HTMLElement> {
  const row = await screen.findAllByRole('button', { name: /^(Bo|Woche planen)/ });
  fireEvent.click(row.find((b) => b.textContent?.startsWith("Bo")) ?? row[0]!);
  return screen.findByRole('dialog', { name: 'Bo, dein Sensei' });
}

/** Open proposals sit behind one slim strip above the chat input ("1 Vorschlag ›"); it opens them in a small sheet. */
export async function openProposals(): Promise<HTMLElement> {
  fireEvent.click(await screen.findByRole('button', { name: /^\d Vorschl(ag|äge)/ }));
  return screen.findByRole('dialog', { name: /^Vorschl(ag|äge)$/ });
}
