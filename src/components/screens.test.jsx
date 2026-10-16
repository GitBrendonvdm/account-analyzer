import { describe, expect, it } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { ChartsView } from './ChartsView';
import { Headlines } from './Headlines';
import { DebtLead } from './debt/DebtLead';
import { Disclosure, Heading } from './ui/Disclosure';

/**
 * The shared shape of every screen: the answer first, the explanation folded under a bar. These pin
 * that shape — a bar is closed until opened, a bar can be forced open while something inside needs
 * seeing, a card inside a merged bar does not announce itself twice — and the Debt page's lead, the
 * Trends page's chart, and the headlines that fold to one.
 */

const render = (el) =>
  renderToStaticMarkup(el)
    .replace(/&#x27;/g, "'")
    .replace(/&quot;/g, '"')
    .replace(/&amp;/g, '&')
    .replace(/[\u00a0\u202f]/g, ' ');

describe('Disclosure', () => {
  it('is closed until it is opened, and keeps what is inside in the page', () => {
    const html = render(
      <Disclosure title="Health check" summary="Six measures">
        <p>the contents</p>
      </Disclosure>,
    );
    expect(html).toMatch(/^<details class="group /);
    expect(html).not.toContain(' open');
    expect(html).toContain('Health check');
    expect(html).toContain('Six measures');
    expect(html).toContain('the contents');
  });

  it('can be forced open while something inside needs seeing, or opened by default', () => {
    expect(render(<Disclosure title="Rules" forceOpen><i /></Disclosure>)).toMatch(/<details[^>]* open/);
    expect(render(<Disclosure title="Rules" defaultOpen><i /></Disclosure>)).toMatch(/<details[^>]* open/);
    expect(render(<Disclosure title="Rules" forceOpen={false}><i /></Disclosure>)).not.toMatch(/<details[^>]* open/);
  });

  it('does not say a card’s title twice when the card inside is the section, but does when it is not', () => {
    const card = <Heading>What the debt costs</Heading>;
    const merged = render(<Disclosure title="What the debt costs" merge>{card}</Disclosure>);
    expect(merged.match(/What the debt costs/g)).toHaveLength(1);
    const plain = render(<Disclosure title="Bills and cash path">{card}</Disclosure>);
    expect(plain).toContain('<h2 class="t-head">What the debt costs</h2>');
  });
});

describe('Headlines', () => {
  const headlines = [
    { id: 'a', tone: 'critical', text: 'Your cash covers 0.0 cycles of spending', detail: 'R 300 against R 104 801' },
    { id: 'b', tone: 'warning', text: 'Debt service takes 47% of income' },
    { id: 'c', tone: 'good', text: 'Net worth is up' },
  ];

  it('shows the first and folds the rest under one line, at every size', () => {
    const html = render(<Headlines headlines={headlines} />);
    expect(html).toContain('Your cash covers 0.0 cycles of spending');
    expect(html).toContain('R 300 against R 104 801');
    expect(html).not.toContain('Debt service takes 47% of income');
    expect(html).toContain('2 more things worth knowing');
    expect(html).not.toContain('md:hidden');
  });

  it('says "1 more thing" for one, and nothing at all for none', () => {
    expect(render(<Headlines headlines={headlines.slice(0, 2)} />)).toContain('1 more thing worth knowing');
    expect(render(<Headlines headlines={headlines.slice(0, 1)} />)).not.toContain('more thing');
    expect(render(<Headlines headlines={[]} />)).toBe('');
  });
});

describe('DebtLead', () => {
  const terms = [
    { accountId: 'a', balanceOwed: 2_767_321, rateNominal: 0.0933, feeMonthly: 69 },
    { accountId: 'b', balanceOwed: 603_423, rateNominal: 0.0951, feeMonthly: 69 },
    { accountId: 'c', type: 'Credit Card', rateNominal: 0.2075 },
  ];

  it('says what is owed, what it costs a cycle and when it is gone', () => {
    const html = render(<DebtLead terms={terms} plan={{ debtFreeDate: new Date(2056, 4, 1) }} />);
    expect(html).toContain('You owe');
    expect(html).toContain('R 3 370 744');
    expect(html).toContain('3 debts, 1 without a balance');
    expect(html).toContain('It costs a cycle');
    expect(html).toContain('R 26 298 interest, R 138 fees');
    expect(html).toContain('Debt-free');
    expect(html).toContain('May 2056');
  });

  it('says so when the plan never clears, and says nothing without debts', () => {
    expect(render(<DebtLead terms={terms} plan={{ debtFreeDate: null }} />)).toContain('Not in 50 years');
    expect(render(<DebtLead terms={terms} plan={null} />)).toContain('once a debt has a balance and a rate');
    expect(render(<DebtLead terms={[]} plan={null} />)).toBe('');
  });
});

describe('ChartsView', () => {
  const trend = {
    now: -162443,
    sinceLast: 73851,
    rows: [
      { month: '2026-09', net: -236294, change: -7000, partial: false },
      { month: '2026-10', net: -162443, change: 73851, partial: true },
    ],
    up: 0,
    of: 1,
    complete: true,
    missing: [],
    estimated: [],
    owned: ['Our house'],
  };

  it('leads with net worth month by month and folds the two cash-flow charts', () => {
    const html = render(<ChartsView chartData={{}} trend={trend} />);
    expect(html).toContain('Net worth, month by month');
    expect(html).toContain('Up R 73 851 so far this cycle');
    expect(html).toContain('Counts Our house.');
    for (const title of ['Net total over time', 'Net per month']) {
      expect(html).toMatch(new RegExp(`<details class="group[^"]*"><summary[^>]*>.*?${title}`));
    }
    expect(html).not.toMatch(/<details[^>]* open/);
    expect(html.indexOf('Net worth, month by month')).toBeLessThan(html.indexOf('Net total over time'));
  });

  it('says what it needs when no account has a balance', () => {
    expect(render(<ChartsView chartData={{}} trend={null} />)).toContain('Net worth needs a balance on at least one account.');
  });
});
