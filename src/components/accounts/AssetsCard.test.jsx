import { describe, expect, it } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { AssetsCard } from './AssetsCard';

/**
 * What you own, on the Accounts page: a short list with the total, what is left of each thing once the
 * loans against it are paid, and a way to add another. The dialog is a portal and is checked in the
 * browser.
 */

const render = (el) =>
  renderToStaticMarkup(el)
    .replace(/&#x27;/g, "'")
    .replace(/&quot;/g, '"')
    .replace(/&amp;/g, '&')
    .replace(/[\u00a0\u202f]/g, ' ');

const HOUSE = {
  id: 'asset-house',
  name: 'Our house',
  kind: 'house',
  valuations: [
    { date: '2026-03-01', value: 3_500_000 },
    { date: '2026-09-01', value: 3_600_000 },
  ],
  loanIds: ['nedbank|2801'],
};
const CAR = { id: 'asset-car', name: 'Toyota', kind: 'car', valuations: [{ date: '2026-10-01', value: 180_000 }], loanIds: [] };
const BOND = { id: 'nedbank|2801', type: 'Loan', rawName: 'Nedbank Loan *2801', label: 'Nedbank home loan' };

const card = (props) => render(<AssetsCard today="2026-10-16" onSave={() => {}} accounts={[BOND]} {...props} />);

describe('AssetsCard', () => {
  it('lists what is owned with the total, and what is left of each once its loans are paid', () => {
    const html = card({ assets: [HOUSE, CAR], loanOwed: new Map([['nedbank|2801', 2_747_083]]) });
    expect(html).toContain('What you own');
    expect(html).toContain('R 3 780 000 in 2 things, counted in net worth.');
    expect(html).toContain('Our house');
    expect(html).toMatch(/House · valued 0?1 Sept 2026/);
    expect(html).toContain('R 3 600 000');
    expect(html).toContain('R 2 747 083 owed on it');
    expect(html).toContain('R 852 917 yours');
    expect(html).toContain('aria-label="Edit Our house"');
    expect(html).toContain('aria-label="Edit Toyota"');
    expect(html).toContain('Add something');
  });

  it('says which loans it has no balance for rather than pretending the equity is whole', () => {
    const html = card({ assets: [{ ...HOUSE, loanIds: ['nedbank|2801', 'fnb|9999'] }], loanOwed: new Map([['nedbank|2801', 2_747_083]]) });
    expect(html).toContain('no balance for fnb|9999');
  });

  it('shows a car losing value as the date moves on, not only the latest figure', () => {
    const car = { ...CAR, valuations: [{ date: '2026-01-01', value: 200_000 }, { date: '2026-10-01', value: 180_000 }] };
    expect(card({ assets: [car] })).toContain('R 180 000');
    expect(render(<AssetsCard today="2026-06-01" onSave={() => {}} accounts={[]} assets={[car]} />)).toContain('R 200 000');
  });

  it('is one line that says why it is worth adding when there is nothing yet', () => {
    const html = card({ assets: [] });
    expect(html).toContain('A house or a car is worth money your accounts do not show.');
    expect(html).toContain('Add something');
    expect(html).not.toContain('<ul');
  });
});
