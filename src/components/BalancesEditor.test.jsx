import { describe, expect, it } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { BalancesEditor } from './BalancesEditor';

/**
 * The Balances table is where accounts are looked after: a Close and a Hide on every row, the ones the
 * app thinks are finished pointed out, one line to hide what has been quiet for good, and a way to
 * the closed and hidden ones. The dialogs themselves are portals and are checked in the browser; what
 * is checked here is what the reader sees before opening one.
 */

const render = (el) =>
  renderToStaticMarkup(el)
    .replace(/&#x27;/g, "'")
    .replace(/&quot;/g, '"')
    .replace(/&amp;/g, '&')
    .replace(/[\u00a0\u202f]/g, ' ');

const account = (id, type, over = {}) => ({
  id,
  bank: id.split('|')[0],
  mask: id.split('|')[1],
  type,
  isLiability: type === 'Credit Card' || type === 'Loan',
  rawName: `${id} ${type}`,
  label: null,
  currentBalance: 0,
  balanceAsOf: '2026-10-15',
  ...over,
});

const CHEQUE = account('fnb|9986', 'Bank', { label: 'FNB Cheque *9986' });
const OLD_CARD = account('fnb|2000', 'Credit Card', { label: 'FNB Credit Card *2000' });
const DISCOVERY = account('discovery|0759', 'Bank', { label: 'Discovery Bank *0759' });

const manage = (over = {}) => ({
  suggestions: [],
  dormant: [],
  closed: [],
  hidden: [],
  today: '2026-10-16',
  preview: () => null,
  onClose: () => {},
  onDismiss: () => {},
  onReopen: () => {},
  onHide: () => {},
  onShow: () => {},
  ...over,
});

describe('BalancesEditor account actions', () => {
  it('is just balances when nothing is given to manage', () => {
    const html = render(<BalancesEditor accounts={[CHEQUE]} onSave={() => {}} dataThrough="2026-10-15" />);
    expect(html).not.toContain('aria-label="Close FNB Cheque *9986"');
    expect(html).not.toContain('aria-label="Hide FNB Cheque *9986"');
    expect(html).not.toContain('Manage');
  });

  it('puts a Close and a Hide on every row', () => {
    const html = render(
      <BalancesEditor accounts={[CHEQUE, OLD_CARD]} onSave={() => {}} dataThrough="2026-10-15" manage={manage()} />,
    );
    for (const name of ['FNB Cheque *9986', 'FNB Credit Card *2000']) {
      expect(html).toContain(`aria-label="Close ${name}"`);
      expect(html).toContain(`aria-label="Hide ${name}"`);
    }
  });

  it('says why the app is pointing at an account, and lights its Close button', () => {
    const suggestion = { accountId: 'fnb|2000', kind: 'idle', closedOn: '2026-08-17', reason: 'no activity since 2026-08-17' };
    const html = render(
      <BalancesEditor
        accounts={[CHEQUE, OLD_CARD]}
        onSave={() => {}}
        dataThrough="2026-10-15"
        manage={manage({ suggestions: [suggestion] })}
      />,
    );
    expect(html).toContain('Looks closed — no activity since 2026-08-17');
    const lit = html.match(/<button[^>]*aria-label="Close FNB Credit Card \*2000"[^>]*>/)[0];
    const plain = html.match(/<button[^>]*aria-label="Close FNB Cheque \*9986"[^>]*>/)[0];
    expect(lit).toContain('text-info');
    expect(plain).not.toContain('text-info');
    // A paid-off loan reads differently from one that merely went quiet.
    const paid = render(
      <BalancesEditor
        accounts={[OLD_CARD]}
        onSave={() => {}}
        dataThrough="2026-10-15"
        manage={manage({ suggestions: [{ ...suggestion, kind: 'paid-off', reason: 'a payment of 63 727 matches what it owed' }] })}
      />,
    );
    expect(paid).toContain('Looks paid off — a payment of 63 727 matches what it owed');
  });

  it('offers one line to hide what has been quiet for good, counting only what is in the table', () => {
    const closedDormant = account('nedbank|5284', 'Savings', { label: 'Nedbank Savings *5284', closedOn: '2026-10-15' });
    const html = render(
      <BalancesEditor
        accounts={[CHEQUE, DISCOVERY]}
        onSave={() => {}}
        dataThrough="2026-10-15"
        manage={manage({ dormant: [DISCOVERY, closedDormant] })}
      />,
    );
    expect(html).toContain('<b class="font-semibold text-label">1</b> account has had no');
    expect(html).toContain('Hide it');
    expect(html).toContain('No activity for over a year');

    const two = render(
      <BalancesEditor
        accounts={[CHEQUE, DISCOVERY, OLD_CARD]}
        onSave={() => {}}
        dataThrough="2026-10-15"
        manage={manage({ dormant: [DISCOVERY, OLD_CARD] })}
      />,
    );
    expect(two).toContain('<b class="font-semibold text-label">2</b> accounts have had no');
    expect(two).toContain('Hide them');
  });

  it('counts what is closed and hidden and offers to manage it, and says nothing when there is none', () => {
    const closed = [account('fnb|1143', 'Loan', { closedOn: '2026-10-15' })];
    const hidden = [DISCOVERY, account('discovery|2160', 'Credit Card')];
    const html = render(
      <BalancesEditor accounts={[CHEQUE]} onSave={() => {}} dataThrough="2026-10-15" manage={manage({ closed, hidden })} />,
    );
    expect(html).toContain('1 closed · 2 hidden');
    expect(html).toContain('Manage');

    const onlyHidden = render(
      <BalancesEditor accounts={[CHEQUE]} onSave={() => {}} dataThrough="2026-10-15" manage={manage({ hidden })} />,
    );
    expect(onlyHidden).toContain('2 hidden');
    expect(onlyHidden).not.toContain('closed ·');

    const none = render(
      <BalancesEditor accounts={[CHEQUE]} onSave={() => {}} dataThrough="2026-10-15" manage={manage()} />,
    );
    expect(none).not.toContain('Manage');
  });
});
