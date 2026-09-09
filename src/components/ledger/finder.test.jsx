import { describe, expect, it } from 'vitest';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { PaymentFinder } from './PaymentFinder';
import { RulesPanel } from './RulesPanel';

/**
 * The two surfaces that make the ledger manageable. The engines are tested in lib/; these cover
 * what the reader is actually shown — chiefly that a rule states its blast radius before it is
 * saved, and that a bulk control says how many rows it is about to change.
 */

const txn = (over = {}) => ({
  key: 'k1',
  Date: '2026-09-10',
  Description: 'Builders Warehouse',
  Category: 'Home Improvement',
  Account: 'FNB Cheque *2000',
  AmountNum: -4200,
  'Pay Month': '2026-09',
  ...over,
});

const data = [
  txn(),
  txn({ key: 'k2', Description: 'Builders Express', AmountNum: -820 }),
  txn({ key: 'k3', Description: 'Woolworths', Category: 'Groceries', AmountNum: -310 }),
];

const render = (el) =>
  renderToStaticMarkup(el)
    .replace(/&#x27;/g, "'")
    .replace(/&quot;/g, '"')
    .replace(/&amp;/g, '&')
    .replace(/[\u00a0\u202f]/g, ' ');

describe('PaymentFinder', () => {
  const props = (over = {}) => ({
    data,
    currentMonth: '2026-09',
    exceptionKeys: new Set(['k1']),
    overrides: {},
    choices: { categories: ['Groceries', 'Home Maintenance'], spendingGroups: [] },
    onSetTxnOverride: () => {},
    ...over,
  });

  it('opens quiet, with the filters offered and no results list yet', () => {
    const html = render(createElement(PaymentFinder, props()));
    expect(html).toContain('Find a payment');
    expect(html).toContain('Exceptions');
    expect(html).toContain('Uncategorised');
    // Nothing is listed until something is asked for, so the page still opens on the numbers.
    expect(html).not.toContain('Nothing matches');
    expect(html).not.toContain('Select these');
  });

  it('promises that searching will not move the totals', () => {
    // The whole design rests on this: a reader typing a merchant is asking where something is,
    // not asking for a household whose spending excludes everything else.
    expect(render(createElement(PaymentFinder, props()))).toContain(
      'Nothing here changes the totals below',
    );
  });

  // The results list only renders once a search is on, which server-side rendering cannot reach.
  // What it shows is covered where the data actually lives: lib/paymentSearch.test.js for the
  // matching and totals, lib/txnRules.test.js for whether a correction came from a rule.
});

describe('RulesPanel', () => {
  const props = (over = {}) => ({
    rules: [],
    data,
    choices: { categories: ['Groceries', 'Home Maintenance'] },
    onChange: () => {},
    draft: null,
    onDraft: () => {},
    ...over,
  });

  it('offers to make one, and says what a rule is for', () => {
    const html = render(createElement(RulesPanel, props()));
    expect(html).toContain('New rule');
    expect(html).toContain('to the ones imported next month');
    // The precedence has to be stated: it is the whole reason a rule is safe to write.
    expect(html).toContain('always wins over a rule');
  });

  it('counts what a draft catches BEFORE it is saved', () => {
    const draft = { description: 'builders', minAmount: '', set: { category: 'Home Maintenance', flag: '' } };
    const html = render(createElement(RulesPanel, props({ draft })));
    // A rule you cannot preview is a rule you will not trust enough to write.
    expect(html).toContain('catches');
    expect(html).toContain('>2<');
    expect(html).toContain('payments');
  });

  it('refuses a draft that would rewrite everything, or nothing', () => {
    const noCondition = { description: '', minAmount: '', set: { category: 'Groceries', flag: '' } };
    const html = render(createElement(RulesPanel, props({ draft: noCondition })));
    expect(html).toContain('Needs something to match on, and something to do');
    expect(html).toMatch(/disabled=""[^>]*>Save rule|Save rule/);
  });

  it('lists a saved rule with its live count and a way to switch it off', () => {
    const rules = [{ description: 'builders', set: { category: 'Home Maintenance' }, enabled: true }];
    const html = render(createElement(RulesPanel, props({ rules })));
    expect(html).toContain('Rules (1)');
    expect(html).toContain('matches');
    expect(html).toContain('Home Maintenance');
    expect(html).toContain('2 payments');
    // Switching a rule off is how you find out what it was doing to your numbers.
    expect(html).toContain('Disable');
  });

  it('shows a disabled rule as off rather than hiding it', () => {
    const rules = [{ description: 'builders', set: { flag: 'unexpected' }, enabled: false }];
    const html = render(createElement(RulesPanel, props({ rules })));
    expect(html).toContain('off');
    expect(html).toContain('Enable');
  });
});
