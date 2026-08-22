import { describe, expect, it } from 'vitest';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { DebtView } from '../DebtView';
import {
  fakeSettings,
  fixtureDebts,
  fixtureEngine,
  fixturePlanOptions,
  fixturePlans,
  fixtureProps,
  fixtureSurplusBudget,
  fixtureTerms,
} from './fixtures';

/**
 * Static markup, with the entities React escapes put back and the no-break spaces Intl puts in
 * "R 3 000" flattened, so sentences can be matched as typed.
 */
const render = (props) =>
  renderToStaticMarkup(createElement(DebtView, props))
    .replace(/&#x27;/g, "'")
    .replace(/&quot;/g, '"')
    .replace(/&amp;/g, '&')
    .replace(/[\u00a0\u202f]/g, ' ');

/** Every block the view is made of, by the heading it renders. */
const HEADINGS = [
  'Your debts',
  'Plan',
  'Strategies',
  'Balances over the plan',
  'Freed cash',
  'What R',
  'A lump sum',
  'Cards',
  'If rates move',
];

const expectClean = (html) => {
  expect(html).not.toMatch(/undefined/);
  expect(html).not.toMatch(/NaN/);
  expect(html).not.toMatch(/\[object Object\]/);
};

describe('DebtView', () => {
  it('renders every block from the fixtures', () => {
    const html = render(fixtureProps());
    for (const h of HEADINGS) expect(html, h).toContain(h);
    expectClean(html);
  });

  it('renders the same blocks when the engine recomputes locally', () => {
    const html = render(fixtureProps({ engine: fixtureEngine, planOptions: fixturePlanOptions }));
    for (const h of HEADINGS) expect(html, h).toContain(h);
    expectClean(html);
    // The local run at the defaults is App's first-paint plan: same debt-free date.
    const local = fixtureEngine.comparePlans(fixtureDebts, {
      ...fixturePlanOptions,
      strategy: 'avalanche',
      extraPerMonth: 0,
      cascade: true,
      lumps: [],
    });
    expect(local.avalanche.months).toBe(fixturePlans.avalanche.months);
  });

  it('puts the deficit first and makes it the extra slider floor', () => {
    const html = render(fixtureProps());
    expect(html).toContain('You are R');
    expect(html).toContain('a cycle short');
    expect(html).toContain('stops the bleed');
    expect(html).toMatch(/type="range"[^>]*min="9500"/);
    expect(html).toContain('Close it');
  });

  it('says what is available when the cycles close with a surplus', () => {
    const html = render(fixtureProps({ debtBudget: fixtureSurplusBudget }));
    expect(html).toContain('a cycle is available for extra payments');
    expect(html).toMatch(/type="range"[^>]*min="3000"/);
    expectClean(html);
  });

  it('shows provenance and a missing-numbers line for the card the export never sees', () => {
    const html = render(fixtureProps());
    expect(html).toContain("from the loan's own ledger");
    expect(html).toContain('from your Example summary');
    expect(html).toContain('fitted, R² 0.99');
    expect(html).toContain('assumed — type the rate to replace it');
    expect(html).toContain('from you');
    expect(html).toContain('numbers missing');
    expect(html).toContain('Example Store Card');
  });

  it('lays the liabilities out twice: a table from md up, stacked cards below it', () => {
    const html = render(fixtureProps());
    expect(html).toMatch(/<div class="hidden overflow-x-auto md:block"><table/);
    expect(html).toMatch(/<ul class="md:hidden" aria-label="Your debts">/);
    const stacked = html.split('aria-label="Your debts"')[1];
    for (const label of ['Example Bond', 'Example Card', 'Example Store Card']) expect(stacked).toContain(label);
    expect(stacked).toContain('Fee-adjusted');
    // And the marginal table the same way.
    expect(html).toMatch(/<ol class="md:hidden" aria-label="Where the rand does the most">/);
  });

  it('lists the rate steps and the debt cost line', () => {
    const html = render(fixtureProps());
    expect(html).toContain('Example Bond rate moved to 9.45%');
    expect(html).toContain('Your debt costs');
    expect(html).toContain('interest,');
  });

  it('renders the empty state when no debt has a balance', () => {
    const html = render(
      fixtureProps({
        terms: fixtureTerms.filter((t) => t.accountId === 'ex|store'),
        debts: [],
        plans: null,
        marginal: [],
        sensitivity: [],
        rateSteps: [],
      }),
    );
    expect(html).toContain('Upload your account summary under Accounts, or type a balance and a rate');
    expect(html).not.toContain('Balances over the plan');
    expectClean(html);
  });

  it('renders with nothing at all', () => {
    const html = render({ terms: [], debts: [], debtBudget: null, plans: null });
    expect(html).toContain('Your debts');
    expect(html).toContain('Upload your account summary under Accounts');
    expectClean(html);
  });

  it('honours a persisted strategy and extra, and tolerates a missing settings object', () => {
    const settings = fakeSettings({ debtStrategy: 'snowball', debtExtra: 15000 });
    const html = render(fixtureProps({ settings }));
    expect(html).toMatch(/aria-pressed="true"[^>]*>Snowball</);
    expect(html).toMatch(/type="range"[^>]*value="15000"/);
    expectClean(render(fixtureProps({ settings: undefined })));
  });

  it('prints the strategy narrative and the marginal sentence', () => {
    // With the deficit landing on the card every cycle nothing clears — the narrative must say so.
    const deficit = render(
      fixtureProps({
        settings: fakeSettings({ debtStrategy: 'avalanche' }),
        engine: fixtureEngine,
        planOptions: fixturePlanOptions,
      }),
    );
    expect(deficit).toContain('Avalanche: the Example Card does not clear within 50 years');
    expect(deficit).toContain('Short term, R');
    expect(deficit).toContain('Each 0.25% on your variable-rate debt');

    // With a surplus the plan clears, and the sentence names the first two targets and the saving.
    const surplus = render(
      fixtureProps({
        settings: fakeSettings({ debtStrategy: 'avalanche' }),
        engine: fixtureEngine,
        debtBudget: fixtureSurplusBudget,
        planOptions: { ...fixturePlanOptions, inflows: {} },
      }),
    );
    expect(surplus).toContain('Avalanche: R 3 000 extra a month goes to the Example Card first, then the Example Personal Loan from');
    expect(surplus).toContain('than paying only the minimums');
    expect(surplus).toMatch(/Example Card cleared, (<[^>]+>)?R 6 000/);
    expect(surplus).toContain('rolls to the Example Personal Loan');
    expectClean(surplus);
  });

  it('renders the lump what-if from the engine when an amount is set', () => {
    const settings = fakeSettings({ debtLump: 20000 });
    const html = render(fixtureProps({ settings, engine: fixtureEngine, planOptions: fixturePlanOptions }));
    expect(html).toContain('on the Example');
    expect(html).toContain('this year and');
    expect(html).not.toContain('an approximation');
    expectClean(html);
  });
});
