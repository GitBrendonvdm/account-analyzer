import { describe, expect, it } from 'vitest';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { TodayView } from './TodayView';
import { HabitsView } from './HabitsView';
import { AccountsView } from './AccountsView';
import {
  NEW_PROPS,
  accountsProps,
  fixtureCashPathUnanchored,
  fixtureVitalsUnanchored,
  habitsProps,
  lineStream,
  todayProps,
} from './__fixtures__/analytics';

/**
 * Static markup with React's entities put back and Intl's no-break spaces flattened, so the
 * sentence templates can be matched as typed.
 */
const render = (View, props) =>
  renderToStaticMarkup(createElement(View, props))
    .replace(/&#x27;/g, "'")
    .replace(/&quot;/g, '"')
    .replace(/&amp;/g, '&')
    .replace(/[\u00a0\u202f]/g, ' ');

const expectClean = (html) => {
  expect(html).not.toMatch(/undefined/);
  expect(html).not.toMatch(/NaN/);
  expect(html).not.toMatch(/\[object Object\]/);
};

/** The same props with every new prop null, and with every new prop left out entirely. */
const nulled = (props, keys) => ({ ...props, ...Object.fromEntries(keys.map((k) => [k, null])) });
const without = (props, keys) => {
  const out = { ...props };
  for (const k of keys) delete out[k];
  return out;
};

/**
 * The subscriptions fixture padded to 61 lines. Every pad costs less than the smallest real line so
 * the list keeps the engine's perCycle order; the aggregates (byKind, optionalPerYear) are left as
 * they are, because they are the engine's figures over every line and the folded cards must show
 * those rather than a sum over the rows on screen.
 */
const padLines = (subscriptions, n = 51) => ({
  ...subscriptions,
  lines: [
    ...subscriptions.lines,
    ...Array.from({ length: n }, (_, i) => {
      const amount = 60 - i;
      return {
        ...lineStream,
        id: `pad ${i}|example|1234|0`,
        label: `Pad line ${i}`,
        amount,
        perCycle: amount,
        perYearAmount: amount * 12,
        range: [amount, amount],
        regimes: [{ ...lineStream.regimes[1], amount }],
        perCycleAmounts: Array.from({ length: 12 }, () => amount),
        priceChange: null,
      };
    }),
  ],
});

const VIEWS = [
  { name: 'TodayView', View: TodayView, props: todayProps, keys: NEW_PROPS.today, keep: ['Safe to spend before payday', 'Came in', 'Went out', 'Where it goes'] },
  { name: 'HabitsView', View: HabitsView, props: habitsProps, keys: NEW_PROPS.habits, keep: ['Where the money goes', 'When you spend'] },
  { name: 'AccountsView', View: AccountsView, props: accountsProps, keys: NEW_PROPS.accounts, keep: ['Your accounts', 'What the debt costs'] },
];

describe.each(VIEWS)('$name', ({ View, props, keys, keep }) => {
  it('renders with the fixtures', () => {
    const html = render(View, props());
    for (const h of keep) expect(html, h).toContain(h);
    expectClean(html);
  });

  it('renders with every new prop null', () => {
    const html = render(View, nulled(props(), keys));
    for (const h of keep) expect(html, h).toContain(h);
    expectClean(html);
  });

  it('renders with every new prop left out', () => {
    const html = render(View, without(props(), keys));
    for (const h of keep) expect(html, h).toContain(h);
    expectClean(html);
  });
});

describe('TodayView at a glance', () => {
  const trend = {
    now: -12447,
    sinceLast: 9120,
    rows: [
      { month: '2026-08', net: -30000, change: -4000, partial: false },
      { month: '2026-09', net: -21567, change: 8433, partial: false },
      { month: '2026-10', net: -12447, change: 9120, partial: true },
    ],
    up: 1,
    of: 2,
    complete: true,
    missing: [],
    estimated: ['Nedbank Loan *2801'],
  };
  const everyday = {
    rows: [
      { month: '2026-08', income: 90000, spend: 100000, net: -10000, partial: false },
      { month: '2026-09', income: 90000, spend: 98000, net: -8000, partial: false },
      { month: '2026-10', income: 20000, spend: 15000, net: 5000, partial: true },
    ],
    typical: { income: 90000, spend: 99000, net: -9000 },
    verdict: 'short',
    cycles: 2,
    shortCycles: 2,
  };
  const accounts = [{ id: 'fnb|9986', rawName: 'FNB Bank *9986', label: 'FNB Cheque *9986' }];

  it('leads with whether net worth is up or down and whether the everyday accounts spend more than they take in', () => {
    const html = render(TodayView, todayProps({ trend, everyday, everydayAccounts: accounts }));
    expect(html).toContain('Up R 9 120 so far this cycle');
    expect(html).toContain('Up in 1 of the last 2 full cycles');
    expect(html).toContain('Includes an estimate for Nedbank Loan *2801.');
    expect(html).toContain('Spending more than comes in');
    expect(html).toContain('R 9 000 short in a typical cycle');
    expect(html).toContain('2 of the last 2 ended short');
    expect(html).toContain('FNB Cheque *9986; moves between your own accounts are left out.');
    const order = ['Net worth', 'Everyday accounts', 'Safe to spend before payday'].map((h) => html.indexOf(h));
    expect(order.every((i) => i >= 0)).toBe(true);
    expect([...order].sort((a, b) => a - b)).toEqual(order);
    expectClean(html);
  });

  it('names the accounts it counts, and says how many closed lately are counted with them', () => {
    const html = render(
      TodayView,
      todayProps({
        trend,
        everyday,
        everydayAccounts: [
          { id: 'a', rawName: 'FNB Bank *9986', label: 'FNB Cheque *9986' },
          { id: 'b', rawName: 'FNB Credit Card *0000' },
          { id: 'c', rawName: 'Nedbank Credit Card *4714', closedOn: '2026-10-15' },
          { id: 'd', rawName: 'FNB Credit Card *2000', closedOn: '2026-08-17' },
        ],
      }),
    );
    expect(html).toContain('FNB Cheque *9986 and FNB Credit Card *0000, and 2 accounts closed lately; moves between your own accounts');
  });

  it('says down when it is down, and ahead when the everyday accounts have room', () => {
    const html = render(
      TodayView,
      todayProps({
        trend: { ...trend, sinceLast: -2500 },
        everyday: { ...everyday, verdict: 'ahead', typical: { income: 90000, spend: 80000, net: 10000 }, shortCycles: 0 },
      }),
    );
    expect(html).toContain('Down R 2 500 so far this cycle');
    expect(html).toContain('Spending less than comes in');
    expect(html).toContain('R 10 000 to spare in a typical cycle');
  });

  it('folds the explanations away: each is a closed bar until it is opened', () => {
    const html = render(TodayView, todayProps({ trend, everyday }));
    for (const title of ['Health check', 'Bills and cash path', 'This cycle so far', 'Where it goes']) {
      expect(html).toMatch(new RegExp(`<details class="group[^"]*"><summary[^>]*>.*?${title}`));
    }
    expect(html).not.toMatch(/<details[^>]* open/);
  });

  it('is the old page, minus the new cards, when there is nothing to say about net worth or everyday money', () => {
    const html = render(TodayView, todayProps({ trend: null, everyday: null }));
    expect(html).not.toContain('Everyday accounts');
    expect(html).toContain('Safe to spend before payday');
  });
});

describe('TodayView blocks', () => {
  it('puts the salary caption under the dial', () => {
    const html = render(TodayView, todayProps());
    expect(html).toContain('Salary R 75 000 usually lands the 24th–26th · last received 24 Jul · late in 2 of 12 cycles');
  });

  it('renders six vitals with sparks, direction chips and the assumption line', () => {
    const html = render(TodayView, todayProps());
    for (const label of ['Savings rate', 'Debt service', 'Interest burden', 'Runway', 'Card utilisation', 'Deficit']) {
      expect(html, label).toContain(label);
    }
    expect(html).toContain('over 3 cycles');
    expect(html).toContain('Income excludes one-off inflows (R 578 000 over the window).');
    expect(html).toContain('card minimums not typed');
    expect(html).not.toContain('Add balances');
  });

  it('says "Add balances" on a vital that cannot be computed', () => {
    const html = render(TodayView, todayProps({ vitals: fixtureVitalsUnanchored }));
    expect(html).toContain('Add balances');
    expectClean(html);
  });

  it('lists the coming month with the payday row, statuses and the footer', () => {
    const html = render(TodayView, todayProps());
    expect(html).toContain('Coming up');
    expect(html).toContain('Payday');
    expect(html).toContain('not yet in the data');
    expect(html).toContain('overdue 17d');
    expect(html).toContain('next cycle');
    expect(html).toContain('Usually landed by now');
    expect(html).toMatch(/R 1 299<\/b> due before payday · <b[^>]*>R 30 393<\/b> in the first week after/);
    expect(html).toContain('plus R 320 at low confidence');
  });

  it('writes the cash-path sentence, the late-salary line and the estimate chip', () => {
    const html = render(TodayView, todayProps());
    expect(html).toContain('Cash drops to R 700 on 22 Aug — 2 days under your R 2 000 buffer before the salary on the 23rd.');
    expect(html).toContain('If the salary is 4 days late (it has been in 2 of 12 cycles), you are under zero from the 24 Aug.');
    expect(html).toContain('Estimate — not yet validated against past cycles');
    expect(html).toContain('Example Cheque');
    expect(html).toContain('Drag across the chart to zoom in');
  });

  it('falls back to "stays above" and "change since today" when there is no dip or no anchor', () => {
    const html = render(TodayView, todayProps({ cashPath: fixtureCashPathUnanchored }));
    expect(html).toContain('change since today');
    expect(html).toContain('Add balances');
    expectClean(html);
    const calm = render(TodayView, todayProps({ cashPath: { ...fixtureCashPathUnanchored, anchored: true, buffer: 0, total: { ...fixtureCashPathUnanchored.total, firstBelowBuffer: null, firstBelowFloor: null } } }));
    expect(calm).toContain('Stays above zero; R 36 405 left on 30 Aug.');
  });
});

describe('HabitsView blocks', () => {
  it('replaces the standing-commitments and movers blocks', () => {
    const html = render(HabitsView, habitsProps());
    expect(html).not.toContain('Standing commitments');
    expect(html).not.toContain("What's changing");
    expect(html).toContain('Standing charges');
    expect(html).toContain('What changed');
  });

  it('has no savings-finder hero re-totalling what the cards below already say', () => {
    const html = render(HabitsView, habitsProps());
    expect(html).not.toContain('Savings finder');
    // The audit leads instead, and its own totals are the only arithmetic on the page.
    expect(html.indexOf('Standing charges')).toBeGreaterThan(-1);
    expect(html.indexOf('Standing charges')).toBeLessThan(html.indexOf('What changed'));
  });

  it('renders the standing charges with cadence chips, overrides and the sentence', () => {
    const html = render(HabitsView, habitsProps());
    expect(html).toContain('4 optional services cost R 2 946 a cycle — R 35 352 a year.');
    expect(html).toContain('>monthly<');
    expect(html).toContain('not a subscription');
    expect(html).toContain('>replaced<');
    expect(html).toMatch(new RegExp(`aria-label="Override for ${lineStream.label}"[\\s\\S]*?aria-pressed="true"[^>]*>keep<`));
    expect(html).toContain('+25% since Mar 26');
    expect(html).toContain('set aside <b');
    expect(html).toContain('Instalments and repayments — debt, not subscriptions');
  });

  it('folds to the top 12 standing charges, with the totals still over every line', () => {
    const html = render(HabitsView, habitsProps({ subscriptions: padLines(habitsProps().subscriptions) }));
    expect(html).toContain('Show all 61 standing charges');
    expect(html).toContain('12 of 61 shown · totals cover all');
    expect(html).not.toContain('Show fewer');
    expect(html.match(/minmax\(0,14rem\)_auto_auto/g)).toHaveLength(12);
    expect(html).toContain('Override for Pad line 1"');
    expect(html).not.toContain('Pad line 2');
    // The header and per-kind figures are the engine's aggregates, not a sum over the shown rows.
    expect(html).toContain('4 optional services cost R 2 946 a cycle — R 35 352 a year.');
    expect(html).toContain('Instalments and repayments — debt, not subscriptions');
    expectClean(html);
    expect(render(HabitsView, habitsProps())).not.toMatch(/Show all \d+ standing charges/);
  });

  it('folds the price-trend leftovers into standing charges, and clarifies drift and basket', () => {
    const html = render(HabitsView, habitsProps());
    // Price creep no longer has its own card; only the "too erratic to compare" list, which
    // SubscriptionsCard's inline step badges don't cover, is folded in.
    expect(html).toContain('Too erratic to price-trend');
    expect(html).toContain('2 lines vary too much to compare');
    expect(html).not.toContain('The same things cost R 260 more a cycle than when you started');
    expect(html).not.toContain('R 699 → R 899');
    // Drift gets a plain-English line ahead of the stats for its top two flagged categories.
    expect(html).toContain('Groceries cost about R 1 800 more than usual this cycle.');
    expect(html).toContain('Groceries: R 7 800 a cycle, far outside the usual R 6 000 ± R 450');
    expect(html).toContain('Pets cost about R 400 more than usual this cycle.');
    expect(html).toContain('Pets: R 1 300 a cycle, well outside the usual R 900 ± R 140');
    expect(html).toContain('New since May 2026');
    expect(html).toContain('Example Cloud: new monthly charge — R 1 299 a cycle');
    expect(html).toContain('You stopped 1 subscription and 0 got cheaper: R 89 a cycle, R 267 saved so far.');
    // Basket is retitled and scoped to the categories Drift flagged (Groceries); "Eating Out &
    // Takeaways" has a family in the fixture but was never flagged by drift, so it drops out.
    expect(html).toContain('More visits, or bigger baskets?');
    expect(html).toContain('Trips or tickets?');
    expect(html).toContain('Groceries: 4 → 8 trips a cycle, basket R 500 → R 500. More trips explain R 2 000 of the R 2 000 change (cycles 12–7 back against the last 6).');
    expect(html).not.toContain('Eating Out & Takeaways');
  });

  it('renders the analytics alone when the legacy habits are missing, and nothing with nothing', () => {
    const html = render(HabitsView, habitsProps({ habits: null }));
    expect(html).toContain('Standing charges');
    expect(html).not.toContain('Where the money goes');
    expectClean(html);
    expect(render(HabitsView, nulled(habitsProps({ habits: null }), NEW_PROPS.habits))).toBe('');
  });
});

describe('AccountsView blocks', () => {
  it('is a list you read: each account says what it holds and where that came from, with an Edit to change it', () => {
    const html = render(AccountsView, accountsProps());
    expect(html).not.toContain('type="date"');
    expect(html).not.toContain('<input');
    expect(html).toContain('aria-label="Edit Example Cheque"');
    expect(html).toContain('aria-label="Edit Example Card"');
    expect(html).toContain('as of 22 Aug · from your Example summary');
    expect(html).toContain('typed 10 Aug');
    expect(html).toContain('Not set');
    expect(html).toContain('days older than the data');
    expect(html).toContain("Upload your bank's account summary PDF to fill these in one go.");
  });

  it('folds every explanation under its own closed bar', () => {
    const html = render(AccountsView, accountsProps());
    for (const title of ['Balance at each pay cycle', 'What the debt costs', 'Cash in and out, by account', 'Account movement']) {
      expect(html).toMatch(new RegExp(`<details class="group[^"]*"><summary[^>]*>.*?${title}`));
    }
    expect(html).not.toMatch(/<details[^>]* open/);
  });

  it('lists external accounts with a delete control and none for CSV-backed accounts', () => {
    const html = render(AccountsView, accountsProps());
    expect(html).toContain('Not in your transaction export');
    expect(html).toContain('Example Retirement Annuity');
    expect(html.match(/aria-label="Delete /g)).toHaveLength(1);
    expect(html).toContain('aria-label="Delete Example Retirement Annuity"');
    const noDelete = render(AccountsView, accountsProps({ onDeleteAccount: null }));
    expect(noDelete).not.toContain('aria-label="Delete ');
  });

  it('merges the fees audit into the cost panel with the callouts', () => {
    const html = render(AccountsView, accountsProps());
    expect(html).toContain('Account fees R 2 868/yr — the Example Cheque fee rose from R 99 to R 119 in Jul 2026');
    expect(html).toContain('Consolidating to one current account: R 1 440/yr (close the Example Savings Cheque, keep the Example Cheque)');
    expect(html).toContain('Card interest R 20 400/yr — charged in 5 of the last 6 cycles');
    expect(html).toContain('Payment protection on the Example Card: R 1 020/yr, optional cover');
    expect(html).toContain('Transaction, ATM and penalty fees: R 420/yr.');
    expect(html).toContain('Interest and fees inside the loans');
  });

  it('still renders the fees audit when the cost-of-debt panel has nothing', () => {
    const html = render(AccountsView, accountsProps({ costOfDebt: null }));
    expect(html).toContain('What the debt costs');
    expect(html).toContain('Fees, by kind');
    expectClean(html);
  });
});
