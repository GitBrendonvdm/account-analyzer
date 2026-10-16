import { describe, expect, it } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { AccountsList } from './AccountsList';

/**
 * The accounts list is a page you read: one line per account, grouped by type, with an Edit on each,
 * a Close where the app thinks an account is finished, one line to hide what has been quiet for good,
 * and a way to the closed and hidden ones. The dialogs are portals and are checked in the browser;
 * what is checked here is what the reader sees before opening one.
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

const CHEQUE = account('fnb|9986', 'Bank', { label: 'FNB Cheque *9986', currentBalance: 288.85 });
const OLD_CARD = account('fnb|2000', 'Credit Card', { label: 'FNB Credit Card *2000' });
const BOND = account('fnb|6996', 'Loan', { label: 'FNB Loan *6996', currentBalance: -603423.2, source: 'history' });
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

const list = (props) => render(<AccountsList onSave={() => {}} dataThrough="2026-10-15" {...props} />);

describe('AccountsList', () => {
  it('says what each account holds in the way people say it, grouped by type, with no form on the page', () => {
    const html = list({ accounts: [CHEQUE, BOND, OLD_CARD] });
    expect(html).toContain('Your accounts');
    expect(html).toContain('owe R 603 423');
    expect(html).toContain('R 289');
    expect(html).toContain('as of 15 Oct · from your fnb history');
    const order = ['Cards', 'Loans', 'Bank accounts'].map((h) => html.indexOf(h));
    expect(order.every((i) => i >= 0)).toBe(true);
    expect([...order].sort((a, b) => a - b)).toEqual(order);
    expect(html).not.toContain('<input');
  });

  it('puts an Edit on every line and a Close only where the app thinks the account is finished', () => {
    const suggestion = { accountId: 'fnb|2000', kind: 'idle', closedOn: '2026-08-17', reason: 'no activity since 2026-08-17' };
    const html = list({ accounts: [CHEQUE, OLD_CARD], manage: manage({ suggestions: [suggestion] }) });
    expect(html).toContain('aria-label="Edit FNB Cheque *9986"');
    expect(html).toContain('aria-label="Edit FNB Credit Card *2000"');
    expect(html).toContain('aria-label="Close FNB Credit Card *2000"');
    expect(html).not.toContain('aria-label="Close FNB Cheque *9986"');
    expect(html).toContain('Looks closed — no activity since 2026-08-17');
    // A paid-off loan reads differently from one that merely went quiet.
    const paid = list({
      accounts: [BOND],
      manage: manage({ suggestions: [{ accountId: 'fnb|6996', kind: 'paid-off', closedOn: '2026-10-15', reason: 'a payment of 63 727 matches what it owed' }] }),
    });
    expect(paid).toContain('Looks paid off — a payment of 63 727 matches what it owed');
  });

  it('flags a balance nobody has given yet', () => {
    const html = list({ accounts: [account('discovery|9980', 'Bank', { currentBalance: null })] });
    expect(html).toContain('Not set');
    expect(html).toContain('1 still to fill in.');
  });

  it('offers one line to hide what has been quiet for good, counting only what is on the list', () => {
    const closedDormant = account('nedbank|5284', 'Savings', { label: 'Nedbank Savings *5284', closedOn: '2026-10-15' });
    const one = list({ accounts: [CHEQUE, DISCOVERY], manage: manage({ dormant: [DISCOVERY, closedDormant] }) });
    expect(one).toContain('<b class="font-semibold text-label">1</b> account has had no');
    expect(one).toContain('Hide it');
    expect(one).toContain('No activity for over a year');

    const two = list({ accounts: [CHEQUE, DISCOVERY, OLD_CARD], manage: manage({ dormant: [DISCOVERY, OLD_CARD] }) });
    expect(two).toContain('<b class="font-semibold text-label">2</b> accounts have had no');
    expect(two).toContain('Hide them');
  });

  it('counts what is closed and hidden and offers to manage it, and says nothing when there is none', () => {
    const closed = [account('fnb|1143', 'Loan', { closedOn: '2026-10-15' })];
    const hidden = [DISCOVERY, account('discovery|2160', 'Credit Card')];
    const both = list({ accounts: [CHEQUE], manage: manage({ closed, hidden }) });
    expect(both).toContain('1 closed · 2 hidden');
    expect(both).toContain('Manage');
    const onlyHidden = list({ accounts: [CHEQUE], manage: manage({ hidden }) });
    expect(onlyHidden).toContain('2 hidden');
    expect(onlyHidden).not.toContain('closed ·');
    expect(list({ accounts: [CHEQUE], manage: manage() })).not.toContain('Manage');
  });

  it('puts net worth and which way it is moving at the head of the list', () => {
    const up = list({ accounts: [CHEQUE], trend: { now: -12447, sinceLast: 9120 } });
    expect(up).toMatch(/-R 12 447\s*<span[^>]*>net worth/);
    expect(up).toContain('Up R 9 120 this cycle');
    expect(list({ accounts: [CHEQUE], trend: { now: 500, sinceLast: -80 } })).toContain('Down R 80 this cycle');
    expect(list({ accounts: [CHEQUE] })).not.toContain('net worth');
  });

  it('says so when there is nothing yet', () => {
    expect(list({ accounts: [] })).toContain('No accounts yet');
  });
});
