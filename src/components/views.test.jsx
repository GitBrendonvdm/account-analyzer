import { describe, expect, it } from 'vitest';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { TodayView } from './TodayView';
import { HabitsView } from './HabitsView';
import { PlanView } from './PlanView';
import { AccountsView } from './AccountsView';
import {
  NEW_PROPS,
  accountsProps,
  fixtureCashPathUnanchored,
  fixtureVitalsUnanchored,
  habitsProps,
  lineStream,
  planProps,
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
  { name: 'PlanView', View: PlanView, props: planProps, keys: NEW_PROPS.plan, keep: ['Safe to spend', 'Targets', 'Closing the gap', 'If nothing changes', 'Goals'] },
  { name: 'AccountsView', View: AccountsView, props: accountsProps, keys: NEW_PROPS.accounts, keep: ['Balances', 'What the debt costs'] },
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

  it('renders the finder hero with the found figure and the split', () => {
    const html = render(HabitsView, habitsProps());
    expect(html).toContain('Savings finder');
    expect(html).toContain('R 2 487');
    expect(html).toContain('15% of the R 17 000 gap · R 3 800 more if the trips and drift below change');
    expect(html).toContain('Already saved R 89 a cycle');
    expect(html).toContain('query or renegotiate');
    expect(html).toContain('becomes a saving only once the balance is paid down');
  });

  it('renders the standing charges with cadence chips, overrides and the sentence', () => {
    const html = render(HabitsView, habitsProps());
    expect(html).toContain('4 optional services cost R 2 946 a cycle — R 35 352 a year.');
    expect(html).toContain('>monthly<');
    expect(html).toContain('not a subscription');
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

  it('renders price creep, drift, wins and basket with their sentences', () => {
    const html = render(HabitsView, habitsProps());
    expect(html).toContain('The same things cost R 260 more a cycle than when you started — R 3 120 a year.');
    expect(html).toContain('R 699 → R 899');
    expect(html).toContain('2 lines vary too much to compare');
    expect(html).toContain('Groceries: R 7 800 a cycle, far outside the usual R 6 000 ± R 450');
    expect(html).toContain('Pets: R 1 300 a cycle, well outside the usual R 900 ± R 140');
    expect(html).toContain('New since May 2026');
    expect(html).toContain('Example Cloud: new monthly charge — R 1 299 a cycle');
    expect(html).toContain('You stopped 1 subscription and 0 got cheaper: R 89 a cycle, R 267 saved so far.');
    expect(html).toContain('Trips or tickets?');
    expect(html).toContain('Groceries: 4 → 8 trips a cycle, basket R 500 → R 500. More trips explain R 2 000 of the R 2 000 change (cycles 12–7 back against the last 6).');
  });

  it('renders the analytics alone when the legacy habits are missing, and nothing with nothing', () => {
    const html = render(HabitsView, habitsProps({ habits: null }));
    expect(html).toContain('Savings finder');
    expect(html).not.toContain('Where the money goes');
    expectClean(html);
    expect(render(HabitsView, nulled(habitsProps({ habits: null }), NEW_PROPS.habits))).toBe('');
  });
});

describe('PlanView blocks', () => {
  it('orders the direction table and the solver above the targets', () => {
    const html = render(PlanView, planProps());
    const at = (s) => html.indexOf(s);
    expect(at('Direction')).toBeGreaterThan(-1);
    expect(at('Direction')).toBeLessThan(at('What would it take'));
    expect(at('What would it take')).toBeLessThan(at('Targets'));
    // "Standing charges" is also a Direction metric label; the section is found by its heading.
    expect(at('If nothing changes')).toBeLessThan(at('<h2 class="t-head">Standing charges</h2>'));
    expect(at('<h2 class="t-head">Standing charges</h2>')).toBeLessThan(at('<h2 class="t-head">Goals</h2>'));
  });

  it('writes the widening sentence', () => {
    const html = render(PlanView, planProps());
    expect(html).toMatch(/The gap is widening: -?R 15 000 a cycle over the last 3 cycles against -?R 8 000 over the last 12, and -?R 4 000 the year before\./);
    expect(html).toContain('Standing charges');
  });

  it('writes the solver sentence with the break-even clause, the unreachable clause and the flexible line', () => {
    const html = render(PlanView, planProps());
    // en-ZA abbreviates September as "Sept", hence 3–4 letters.
    expect(html).toMatch(/To clear everything by \w{3,4} \d{4} you need R [\d ]+ a cycle more than now — R 17 000 of it just to stop borrowing\./);
    expect(html).toMatch(/The Example Bond is not reachable by then \(R 410 000 at 9\.5%; it clears in \d{4} on the current instalment\)\./);
    expect(html).toContain('Your flexible categories can give at most R 9 000');
    expect(html).toMatch(/With R 3 000 more a cycle, everything clears by \w{3,4} \d{4}\./);
    expect(html).toContain('type="date"');
  });

  it('explains when there is nothing to solve', () => {
    const html = render(PlanView, planProps({ debts: [], solverInputs: null }));
    expect(html).toContain('Nothing to solve yet');
    expectClean(html);
  });

  it('uses the Aurora tones and the interaction kit on the trajectory', () => {
    const html = render(PlanView, planProps());
    for (const hex of ['#10b981', '#ef4444', '#d1fae5', '#fee2e2', 'accent-blue-600']) expect(html).not.toContain(hex);
    expect(html).toContain('accent-info');
    expect(html).toContain('Drag across the chart to zoom in');
  });

  it('renders the standing charges table with the override menu', () => {
    const html = render(PlanView, planProps());
    expect(html).toContain("engine's call");
    expect(html).toContain('Override for Example Stream');
    expect(html).toContain('+29% since May 26');
  });

  it('folds the standing charges table to the top 12, with the total over every line', () => {
    const html = render(PlanView, planProps({ subscriptions: padLines(planProps().subscriptions) }));
    expect(html).toContain('R 40 245');
    expect(html).toContain('a cycle across 61 lines');
    expect(html).toContain('Show all 61 standing charges');
    expect(html).toContain('12 of 61 shown · totals cover all');
    expect(html).not.toContain('Show fewer');
    expect(html.match(/max-w-\[16rem\] truncate/g)).toHaveLength(12);
    expect(html).toContain('Override for Pad line 1"');
    expect(html).not.toContain('Pad line 2');
    expectClean(html);
    expect(render(PlanView, planProps())).not.toMatch(/Show all \d+ standing charges/);
  });
});

describe('AccountsView blocks', () => {
  it('shows the as-of date, overdraft field and provenance chips', () => {
    const html = render(AccountsView, accountsProps());
    expect(html).toMatch(/type="date"[^>]*value="2026-08-22"/);
    expect(html).toContain('Overdraft limit for Example Cheque');
    expect(html).toContain('Credit limit for Example Card');
    expect(html).toContain('as of 22 Aug · from your Example summary');
    expect(html).toContain('typed 10 Aug');
    expect(html).toContain('not set');
    expect(html).toContain('days older than the data');
    expect(html).toContain("Upload your bank's account summary PDF to fill these in one go.");
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
