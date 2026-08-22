import { describe, expect, it } from 'vitest';
import { buildSavingsFinder } from './savingsFinder';
import { buildBasket } from './basket';
import { buildCycleCalendar } from './cycleCurve';
import { buildDrift } from './drift';
import { buildFeesAudit } from './fees';
import { buildFullTransfers } from './flows';
import { buildPriceCreep } from './priceCreep';
import { processTransactionData } from './processTransactionData';
import { buildRecurringLines } from './recurring';
import { buildSubscriptions } from './subscriptions';
import { loadRealExport } from '../test/realData';

/** The currency formatter uses non-breaking spaces; sentences are compared in plain ones. */
const plain = (s) => s.replace(/[\u00a0\u202f]/g, ' ');

/** The finder only aggregates, so its inputs are the other modules' shapes, hand-built. */
const optional = (id, perCycle, over = {}) => ({
  id,
  label: id,
  kind: 'optional',
  cadence: 'monthly',
  amount: perCycle,
  perCycle,
  level: 'high',
  regimes: [{ from: '2025-09' }],
  override: null,
  ...over,
});
const subs = (lines = [], extra = {}) => ({ lines, newLines: [], realisedPerCycle: 0, cycles: ['2026-07'], ...extra });
const creep = (rising = []) => ({ rising });
const risingItem = (lineId, extraPerCycle, over = {}) => ({
  lineId,
  label: lineId,
  kind: 'optional',
  extraPerCycle,
  steps: [{ count: 3 }],
  first: { count: 3 },
  last: { count: 3 },
  countsInTotal: true,
  sentence: `${lineId} rose`,
  ...over,
});
const fees = (over = {}) => ({
  consolidation: null,
  ppi: null,
  avoidablePerYear: 0,
  cardInterest: { perCycle: 0, perYear: 0, cyclesWithInterest: 0, series: [], sentence: '' },
  sentences: { avoidable: 'Transaction, ATM and penalty fees: R 0/yr.' },
  ...over,
});

describe('buildSavingsFinder', () => {
  it('collapses a subscription and its price creep into one item', () => {
    const out = buildSavingsFinder({
      subscriptions: subs([optional('isp', 450)]),
      priceCreep: creep([risingItem('isp', 60)]),
    });
    expect(out.items).toHaveLength(1);
    expect(out.items[0].perCycle).toBe(450);
    expect(out.items[0].kinds).toEqual(['subscription', 'creep']);
    expect(out.items[0].evidence).toHaveLength(2);
    expect(out.items[0].confidence).toBe('high');
    expect(out.found).toBe(450);
    expect(out.foundPerYear).toBe(5400);
    expect(plain(out.sentence)).toBe('Found R 450 a cycle');
  });

  it('keeps card interest informational and out of found', () => {
    const out = buildSavingsFinder({
      subscriptions: subs([optional('netflix', 199)]),
      fees: fees({ cardInterest: { perCycle: 1700, perYear: 20400, cyclesWithInterest: 6, series: [], sentence: 'Card interest' } }),
    });
    expect(out.found).toBe(199);
    expect(out.informational).toHaveLength(1);
    expect(out.informational[0]).toEqual(expect.objectContaining({ kind: 'card-interest', perCycle: 1700, bucket: 'informational' }));
    expect(out.items.some((i) => i.kind === 'card-interest')).toBe(false);
  });

  it('reports drift as behavioural potential, never as found', () => {
    const out = buildSavingsFinder({
      subscriptions: subs([optional('netflix', 199)]),
      drift: { flagged: [{ category: 'Groceries', direction: 'up', delta: 3600, sentence: 'Groceries up', topMerchants: [] }, { category: 'Fuel', direction: 'down', delta: -500, sentence: '', topMerchants: [] }] },
      basket: { families: [{ category: 'Groceries', merchantFamily: null, driver: 'frequency', frequencyPerCycle: 800, sentence: 'trips' }, { category: 'Pets', merchantFamily: null, driver: 'ticket', frequencyPerCycle: 0, sentence: '' }] },
    });
    expect(out.behaviouralPotential).toBe(4400);
    expect(out.found).toBe(199);
    expect(out.items.filter((i) => i.bucket === 'behavioural').map((i) => i.kind)).toEqual(['drift', 'basket']);
    expect(plain(out.caption)).toBe('R 4 400 more if the trips and drift below change');
  });

  it('covers the deficit in proportion', () => {
    const out = buildSavingsFinder({ subscriptions: subs([optional('a', 3000)]), debtBudget: { deficitPerCycle: 17000 } });
    expect(out.deficit).toBe(17000);
    expect(out.cover).toBeCloseTo(0.176, 3);
    expect(plain(out.caption)).toBe('18% of the R 17 000 gap · R 0 more if the trips and drift below change');
    const fromProcessed = buildSavingsFinder({ subscriptions: subs([optional('a', 3000)]), processed: { netAvg: -12000 } });
    expect(fromProcessed.deficit).toBe(12000);
    expect(fromProcessed.cover).toBe(0.25);
    expect(buildSavingsFinder({ subscriptions: subs([optional('a', 3000)]), processed: { netAvg: 500 } }).cover).toBeNull();
  });

  it('ranks by confidence-weighted value', () => {
    const out = buildSavingsFinder({
      subscriptions: subs([optional('small', 300)], {
        newLines: [{ id: 'big', label: 'big', perCycle: 1000, headline: false, sentence: 'big: new', override: null }],
      }),
    });
    expect(out.items.map((i) => i.kind)).toEqual(['subscription', 'new-charge']);
    expect(out.items[1].confidence).toBe('low');
    expect(out.found).toBe(300);
    const headline = buildSavingsFinder({
      subscriptions: subs([], { newLines: [{ id: 'big', label: 'big', perCycle: 1000, headline: true, sentence: 'big: new', override: null }] }),
    });
    expect(headline.items[0].confidence).toBe('medium');
    expect(headline.found).toBe(1000);
  });

  it('reads the fee audit: consolidation, protection cover and avoidable fees above R20 a cycle', () => {
    const out = buildSavingsFinder({
      fees: fees({
        consolidation: { closeCandidate: 'Savings', keepCandidate: 'Cheque', savingPerYear: 1200, sentence: 'close' },
        ppi: { perYear: 1440, perCycle: 120, accounts: ['Gold card'], byAccount: [{ accountId: 'n|1', label: 'Gold card', perCycle: 120, perYear: 1440 }], sentence: 'ppi' },
        avoidablePerYear: 240,
      }),
    });
    expect(out.items.map((i) => [i.kind, i.confidence, i.perCycle])).toEqual([
      ['ppi', 'medium', 120],
      ['consolidation', 'medium', 100],
      ['avoidable-fees', 'high', 20],
    ]);
    expect(out.found).toBe(240);
    expect(out.items[1].action).toBe('close the Savings, keep the Cheque');
    expect(buildSavingsFinder({ fees: fees({ avoidablePerYear: 228 }) }).items).toHaveLength(0);
  });

  it('respects the user: kept lines and medium-confidence creep', () => {
    const out = buildSavingsFinder({
      subscriptions: subs([optional('kept', 500, { override: 'keep' }), optional('a', 100)]),
      priceCreep: creep([risingItem('b', 80, { last: { count: 2 } }), risingItem('loan', 900, { kind: 'instalment', countsInTotal: false })]),
    });
    expect(out.items.map((i) => [i.kind, i.confidence, i.perCycle])).toEqual([
      ['subscription', 'high', 100],
      ['creep', 'medium', 80],
    ]);
    expect(out.found).toBe(180);
    expect(out.realised).toBe(0);
    expect(plain(out.items[1].sentence)).toBe('b: R 80 a cycle — query or renegotiate');
  });

  it('is empty, not broken, with nothing to read', () => {
    const out = buildSavingsFinder({});
    expect(out.items).toEqual([]);
    expect(out.found).toBe(0);
    expect(out.cover).toBeNull();
    expect(out.informational).toEqual([]);
  });
});

const real = loadRealExport();

describe.skipIf(!real)('the savings finder on the real export', () => {
  const asOf = new Date(2026, 7, 22);
  const allMonths = [...new Set((real ?? []).map((t) => t['Pay Month']))].sort();
  const calendar = buildCycleCalendar(real, allMonths, asOf);
  const transfers = buildFullTransfers(real);
  const { lines } = buildRecurringLines(real, { calendar, transfers, asOf });
  const accounts = [...new Set((real ?? []).map((t) => t.Account))];
  const processed = processTransactionData(real, accounts, 6, asOf);
  const finder = buildSavingsFinder({
    subscriptions: buildSubscriptions(lines, { calendar, asOf }),
    priceCreep: buildPriceCreep(lines),
    drift: buildDrift(real, { transfers, calendar }),
    fees: buildFeesAudit(real, [], { transfers, calendar, lines }),
    basket: buildBasket(real, { transfers, calendar }),
    processed,
  });

  it('finds between R2 000 and R5 000 a cycle of cancellable spend', () => {
    expect(finder.found).toBeGreaterThanOrEqual(2000);
    expect(finder.found).toBeLessThanOrEqual(5000);
    expect(finder.deficit).toBeGreaterThan(0);
    expect(finder.cover).toBeGreaterThan(0);
    expect(finder.cover).toBeLessThan(1);
    finder.items
      .filter((i) => i.bucket === 'cancellable' && ['high', 'medium'].includes(i.confidence))
      .forEach((i) => expect(['subscription', 'creep', 'consolidation', 'ppi', 'avoidable-fees', 'new-charge']).toContain(i.kind));
  });

  it('keeps behaviour and card interest out of the figure', () => {
    expect(finder.behaviouralPotential).toBeGreaterThan(0);
    expect(finder.informational.map((i) => i.kind)).toEqual(['card-interest']);
    expect(finder.informational[0].perCycle).toBeGreaterThan(1000);
    expect(finder.items.some((i) => i.kind === 'card-interest' || i.kinds.includes('card-interest'))).toBe(false);
    const behavioural = finder.items.filter((i) => i.bucket === 'behavioural').reduce((s, i) => s + i.perCycle, 0);
    expect(behavioural).toBeCloseTo(finder.behaviouralPotential, 6);
    expect(finder.realised).toBeGreaterThanOrEqual(0);
  });
});
