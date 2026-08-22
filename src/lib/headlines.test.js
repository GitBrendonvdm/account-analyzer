import { describe, expect, it } from 'vitest';
import { buildHeadlines } from './headlines';

/** The currency formatter uses non-breaking spaces; sentences are compared in plain ones. */
const plain = (s) => s.replace(/\s/g, ' ');
const ids = (hs) => hs.map((h) => h.id);
const byId = (hs, id) => hs.find((h) => h.id === id);

// ---- the seven legacy inputs ----------------------------------------------------------------
const summary = { staleLevel: 'ok', staleDays: 1, missedPayments: [] };
const processed = { months: ['2026-05', '2026-06', '2026-07'], netAvg: -5000, incomeAvg: 50000, expenseAvg: 55000 };
const positions = [
  {
    accountId: 'fnb|1234',
    account: 'FNB Loan *1234',
    label: 'Home loan',
    type: 'Loan',
    isLiability: true,
    balance: -1000000,
    windowChange: 3000,
  },
  {
    accountId: 'fnb|9999',
    account: 'FNB Credit Card *9999',
    label: 'Gold card',
    type: 'Credit Card',
    isLiability: true,
    balance: -40000,
    windowChange: -9000,
  },
];
const headroom = [{ account: 'Gold card', used: 0.8, available: 10000 }];
const netWorth = { knownCount: 2, totalCount: 3, net: -1040000, change: -6000, complete: false, missing: ['Savings'], assets: 0, debt: 1040000 };
const costOfDebt = { perCycle: 30000, perYear: 360000, total: 90000, accounts: [{ account: 'FNB Loan *1234', short: 'Home loan', total: 60000, perCycle: 20000 }] };
const habits = {
  movers: [{ category: 'Groceries', delta: 1200, early: 6000, late: 7200 }],
  subscriptions: { count: 14, total: 63000 },
};
const legacy = { summary, processed, positions, netWorth, costOfDebt, headroom, habits };

// ---- the new builders, one minimal fixture each --------------------------------------------
const debtBudget = { deficitPerCycle: 5000, deficitCost12: 6700, absorberLabel: 'Gold card', absorberRate: 0.2075 };
const plans = {
  best: { byInterest: 'avalanche' },
  table: [
    { strategy: 'minimum', months: 350, debtFreeDate: new Date(2055, 9, 23), totalInterest: 2000000, interestSavedVsMinimum: 0, monthsSavedVsMinimum: 0 },
    { strategy: 'avalanche', months: 290, debtFreeDate: new Date(2050, 2, 23), totalInterest: 1700000, interestSavedVsMinimum: 300000, monthsSavedVsMinimum: 60 },
  ],
  minimum: { order: ['fnb|1234'], reachedCap: false, labels: { 'fnb|1234': 'Home loan' }, perDebt: { 'fnb|1234': { clearedMonth: 350 } } },
  avalanche: { order: ['fnb|1234'], reachedCap: false },
};
const rateSteps = [
  { id: 'fnb|1234|2026-03-25|rateStep', date: new Date(2026, 2, 25), from: 0.1033, to: 0.0933, kind: 'rateStep' },
  { id: 'fnb|1234|2025-06-25|instalmentRecast', date: new Date(2025, 5, 25), from: 23000, to: 22854.88, kind: 'instalmentRecast' },
];
const vitals = {
  window: { short: ['2026-05', '2026-06', '2026-07'], long: [], complete: 12 },
  vitals: {
    debtServiceRatio: { value: 0.45, tone: 'bad', direction: 'worsening', components: { instalments: 60000, cardCost: 6000, cardMinimum: 0 } },
    liquidityRunway: { value: 0.4, tone: 'bad', medianSpend: 50000, liquidAssets: 20000, knownCount: 1, totalCount: 1 },
  },
};
const direction = { summary: { netShort: -8000, netLong: -3000, netPrior: 1000, widening: true }, metrics: [] };
const upcoming = { overdue: [{ label: 'Gym', amount: 600, perCycle: 600 }, { label: 'Insurance', amount: 1400 }] };
const subscriptions = {
  newSince: { label: 'Jun' },
  newLines: [
    { label: 'Streaming', perCycle: 1200, wording: 'new monthly charge', headline: true, sentence: 'Streaming: new monthly charge — R1 200 a cycle' },
    { label: 'Coffee', perCycle: 300, wording: 'charged twice, about a month apart', headline: false },
  ],
};
const finder = { found: 3200, foundPerYear: 38400, cover: 0.64, deficit: 5000, behaviouralPotential: 900 };
const drift = {
  flagged: [{ category: 'Pets', delta: 900, direction: 'up', baselineMedian: 1500, recentMedian: 2400, sentence: 'Pets: R2 400 a cycle, well outside the usual R1 500 ± R120' }],
  recent: ['2026-05', '2026-06', '2026-07'],
};
const everything = { ...legacy, debtBudget, plans, rateSteps, vitals, direction, upcoming, subscriptions, finder, drift };

describe('buildHeadlines — legacy contract', () => {
  it('still works with only the seven original inputs', () => {
    const hs = buildHeadlines(legacy);
    expect(hs.length).toBeGreaterThan(0);
    expect(hs.length).toBeLessThanOrEqual(5);
    expect(ids(hs)).toContain('deficit');
    expect(ids(hs)).toContain('cost-of-debt');
    hs.forEach((h) => {
      expect(h).toMatchObject({ id: expect.any(String), tone: expect.any(String), weight: expect.any(Number), text: expect.any(String) });
    });
  });

  it('never throws on missing or null inputs', () => {
    expect(buildHeadlines()).toEqual([]);
    expect(buildHeadlines({})).toEqual([]);
    expect(buildHeadlines({ summary, processed })).toEqual(expect.any(Array));
    expect(() =>
      buildHeadlines({
        summary,
        processed,
        positions: null,
        netWorth: null,
        costOfDebt: null,
        headroom: null,
        habits: null,
        vitals: null,
        direction: null,
        plans: null,
        debtBudget: null,
        rateSteps: null,
        upcoming: null,
        subscriptions: null,
        finder: null,
        drift: null,
      }),
    ).not.toThrow();
    expect(() =>
      buildHeadlines({
        summary,
        processed,
        vitals: {},
        direction: {},
        plans: {},
        debtBudget: {},
        rateSteps: [{}, null, [{ kind: 'rateStep' }]],
        upcoming: { overdue: [{}] },
        subscriptions: { newLines: [{ headline: true }] },
        finder: { found: 'x' },
        drift: { flagged: [{}] },
      }),
    ).not.toThrow();
  });

  it('keeps the legacy templates', () => {
    const hs = buildHeadlines({ ...legacy, processed: { ...processed, netAvg: 4000 }, netWorth: { ...netWorth, change: 2000 } });
    expect(ids(hs)).toContain('surplus');
    expect(ids(hs)).toContain('card-limit');
    expect(ids(hs)).toContain('net-worth');
    const grew = buildHeadlines({ summary, processed, positions: [positions[0], { ...positions[0], windowChange: -2000 }] });
    expect(ids(grew)).toContain('debt-growing');
  });

  it('puts stale first and returns at most five', () => {
    const hs = buildHeadlines({ ...everything, summary: { ...summary, staleLevel: 'alarm', staleDays: 12 } });
    expect(hs).toHaveLength(5);
    expect(hs[0].id).toBe('stale');
    expect(hs[0].text).toContain('12 days old');
    const weights = hs.slice(1).map((h) => h.weight);
    expect([...weights].sort((a, b) => b - a)).toEqual(weights);
  });

  it('ranks by weight', () => {
    const hs = buildHeadlines(everything);
    expect(hs).toHaveLength(5);
    const weights = hs.map((h) => h.weight);
    expect([...weights].sort((a, b) => b - a)).toEqual(weights);
    // A year of median spend (the runway's weight) outranks a year of interest and fees.
    expect(hs[0].id).toBe('runway');
    expect(hs[1].id).toBe('cost-of-debt');
  });
});

describe('buildHeadlines — new templates', () => {
  it('deficit-cost reads the debt budget', () => {
    const h = byId(buildHeadlines({ summary, processed, debtBudget }), 'deficit-cost');
    expect(h).toBeDefined();
    expect(h.tone).toBe('critical');
    expect(h.weight).toBe(6700);
    expect(plain(h.text)).toBe('Running R 5 000 a cycle short costs about R 6 700 in card interest over the next year.');
    expect(h.detail).toContain('Gold card');
    expect(byId(buildHeadlines({ summary, processed, debtBudget: { deficitPerCycle: 0, deficitCost12: 0 } }), 'deficit-cost')).toBeUndefined();
  });

  it('debt-plan names the best strategy by interest', () => {
    const h = byId(buildHeadlines({ summary, processed, plans }), 'debt-plan');
    expect(h).toBeDefined();
    expect(h.tone).toBe('good');
    expect(h.weight).toBe(300000);
    expect(plain(h.text)).toMatch(/^Avalanche clears everything by \w+ 2050, R 300 000 less interest than paying only the minimums\.$/);
    expect(h.detail).toContain('60 months sooner');
  });

  it('debt-plan stays silent without a debt, at the cap, or when minimum is best', () => {
    const noDebt = { ...plans, avalanche: { order: [], reachedCap: false } };
    expect(byId(buildHeadlines({ summary, processed, plans: noDebt }), 'debt-plan')).toBeUndefined();
    const capped = { ...plans, avalanche: { order: ['fnb|1234'], reachedCap: true } };
    expect(byId(buildHeadlines({ summary, processed, plans: capped }), 'debt-plan')).toBeUndefined();
    const minimumBest = { ...plans, best: { byInterest: 'minimum' } };
    expect(byId(buildHeadlines({ summary, processed, plans: minimumBest }), 'debt-plan')).toBeUndefined();
  });

  it('rate-step uses the latest rate move, never an instalment recast', () => {
    const h = byId(buildHeadlines({ summary, processed, positions, plans, rateSteps }), 'rate-step');
    expect(h).toBeDefined();
    expect(h.tone).toBe('neutral');
    expect(h.text).toMatch(/^Your Home loan rate moved to 9\.33% in \w+ 2026; at the unchanged instalment the term is now 350 months\.$/);
    expect(h.weight).toBeCloseTo(0.01 * 1000000, 0);
    expect(h.detail).toContain('10.33%');
    const recastOnly = buildHeadlines({ summary, processed, positions, rateSteps: [rateSteps[1]] });
    expect(byId(recastOnly, 'rate-step')).toBeUndefined();
  });

  it('rate-step accepts a nested list and a termDrift with its own term', () => {
    const nested = [[{ id: 'fnb|1234|2026-05-25|termDrift', date: new Date(2026, 4, 25), from: 0.0933, to: 0.0958, kind: 'termDrift', remainingMonths: 358.4 }]];
    const h = byId(buildHeadlines({ summary, processed, positions, rateSteps: nested }), 'rate-step');
    expect(h.text).toContain('moved to 9.58%');
    expect(h.text).toContain('the term is now 358 months');
    const unknown = byId(buildHeadlines({ summary, processed, rateSteps: nested }), 'rate-step');
    expect(unknown.text).toContain('Your loan rate moved');
    expect(unknown.weight).toBe(0);
  });

  it('dsr is critical when red and warning when amber', () => {
    const h = byId(buildHeadlines({ summary, processed, vitals }), 'dsr');
    expect(h).toBeDefined();
    expect(h.tone).toBe('critical');
    expect(plain(h.text)).toBe('Debt service takes 45% of income — R 22 000 of R 48 889 a cycle goes to instalments and card interest.');
    expect(h.weight).toBe(22000 * 12);
    const amber = { ...vitals, vitals: { ...vitals.vitals, debtServiceRatio: { ...vitals.vitals.debtServiceRatio, value: 0.35, tone: 'warn' } } };
    expect(byId(buildHeadlines({ summary, processed, vitals: amber }), 'dsr').tone).toBe('warning');
    const green = { ...vitals, vitals: { ...vitals.vitals, debtServiceRatio: { ...vitals.vitals.debtServiceRatio, value: 0.2, tone: 'good' } } };
    expect(byId(buildHeadlines({ summary, processed, vitals: green }), 'dsr')).toBeUndefined();
  });

  it('runway is critical under one cycle', () => {
    const h = byId(buildHeadlines({ summary, processed, vitals }), 'runway');
    expect(h).toBeDefined();
    expect(h.tone).toBe('critical');
    expect(h.text).toBe('Your cash covers 0.4 cycles of spending; one late salary is a crisis.');
    expect(h.weight).toBe(50000 * 12);
    const amber = { ...vitals, vitals: { ...vitals.vitals, liquidityRunway: { ...vitals.vitals.liquidityRunway, value: 1.8, tone: 'warn' } } };
    const w = byId(buildHeadlines({ summary, processed, vitals: amber }), 'runway');
    expect(w.tone).toBe('warning');
    expect(w.text).toBe('Your cash covers 1.8 cycles of spending.');
    const none = { ...vitals, vitals: { ...vitals.vitals, liquidityRunway: { value: null, tone: 'neutral' } } };
    expect(byId(buildHeadlines({ summary, processed, vitals: none }), 'runway')).toBeUndefined();
  });

  it('direction fires only when widening', () => {
    const h = byId(buildHeadlines({ summary, processed, direction }), 'direction');
    expect(h).toBeDefined();
    expect(h.tone).toBe('warning');
    expect(h.weight).toBe(5000 * 12);
    expect(plain(h.text)).toBe('The gap is widening: R 8 000 a cycle over the last 3 cycles against R 3 000 over the last 12, and R 1 000 the year before.');
    const flat = { summary: { ...direction.summary, widening: false } };
    expect(byId(buildHeadlines({ summary, processed, direction: flat }), 'direction')).toBeUndefined();
    const noPrior = { summary: { ...direction.summary, netPrior: null } };
    expect(plain(byId(buildHeadlines({ summary, processed, direction: noPrior }), 'direction').text)).toMatch(/over the last 12\.$/);
  });

  it('overdue comes from the recurring engine, not summary.missedPayments', () => {
    const h = byId(buildHeadlines({ summary, processed, upcoming }), 'overdue');
    expect(h).toBeDefined();
    expect(h.tone).toBe('warning');
    expect(h.weight).toBe(2000);
    expect(h.text).toBe("2 payments usually landed by now and haven't: Gym, Insurance.");
    const one = byId(buildHeadlines({ summary, processed, upcoming: { overdue: [upcoming.overdue[0]] } }), 'overdue');
    expect(one.text).toBe("1 payment usually landed by now and hasn't: Gym.");
    const legacyMissed = { ...summary, missedPayments: [{ name: 'Car loan', expected: -4990 }] };
    expect(byId(buildHeadlines({ summary: legacyMissed, processed }), 'overdue')).toBeUndefined();
    expect(byId(buildHeadlines({ summary: legacyMissed, processed, upcoming: { overdue: [] } }), 'overdue')).toBeUndefined();
  });

  it('new-charge reports only headline lines', () => {
    const h = byId(buildHeadlines({ summary, processed, subscriptions }), 'new-charge');
    expect(h).toBeDefined();
    expect(h.tone).toBe('warning');
    expect(h.weight).toBe(1200 * 12);
    expect(plain(h.text)).toBe('New since Jun: Streaming — new monthly charge, R 1 200 a cycle.');
    expect(h.text).not.toContain('Coffee');
    const two = { ...subscriptions, newLines: subscriptions.newLines.map((l) => ({ ...l, headline: true })) };
    const both = byId(buildHeadlines({ summary, processed, subscriptions: two }), 'new-charge');
    expect(plain(both.text)).toBe('2 new charges since Jun: Streaming, Coffee — together R 1 500 a cycle.');
    const quiet = { ...subscriptions, newLines: [subscriptions.newLines[1]] };
    expect(byId(buildHeadlines({ summary, processed, subscriptions: quiet }), 'new-charge')).toBeUndefined();
  });

  it('found replaces subscriptions and never co-exists with it', () => {
    const withFinder = buildHeadlines({ ...legacy, finder });
    const h = byId(withFinder, 'found');
    expect(h).toBeDefined();
    expect(h.tone).toBe('good');
    expect(h.weight).toBe(3200 * 12);
    expect(plain(h.text)).toBe('R 3 200 a cycle of cancellable spend found — 64% of the gap.');
    expect(ids(withFinder)).not.toContain('subscriptions');
    // The old merchants-that-bill-you line is gone even when nothing replaces it.
    expect(ids(buildHeadlines(legacy))).not.toContain('subscriptions');
    expect(ids(buildHeadlines({ summary, processed, habits }))).not.toContain('subscriptions');
    const noGap = byId(buildHeadlines({ summary, processed, finder: { ...finder, cover: null } }), 'found');
    expect(plain(noGap.text)).toBe('R 3 200 a cycle of cancellable spend found.');
    expect(byId(buildHeadlines({ summary, processed, finder: { ...finder, found: 0 } }), 'found')).toBeUndefined();
  });

  it('category-move reads drift first and habits only when drift is absent', () => {
    const h = byId(buildHeadlines({ summary, processed, habits, drift }), 'category-move');
    expect(h).toBeDefined();
    expect(h.tone).toBe('warning');
    expect(h.weight).toBe(900 * 6);
    expect(plain(h.text)).toBe('Pets is up R 900 a cycle against its usual R 1 500.');
    expect(h.detail).toBe(drift.flagged[0].sentence);
    const down = { ...drift, flagged: [{ ...drift.flagged[0], category: 'Cellphone', delta: -700, direction: 'down' }] };
    const d = byId(buildHeadlines({ summary, processed, drift: down }), 'category-move');
    expect(d.tone).toBe('good');
    expect(plain(d.text)).toContain('Cellphone is down R 700');
    // Drift present but nothing flagged: no headline, and no fall-through to the old movers.
    expect(byId(buildHeadlines({ summary, processed, habits, drift: { flagged: [] } }), 'category-move')).toBeUndefined();
    const fallback = byId(buildHeadlines({ summary, processed, habits }), 'category-move');
    expect(fallback).toBeDefined();
    expect(plain(fallback.text)).toContain('Groceries is up R 1 200');
  });
});

describe('buildHeadlines — every template is reachable and prints clean text', () => {
  const EXPECTED = [
    'deficit',
    'deficit-cost',
    'cost-of-debt',
    'debt-plan',
    'rate-step',
    'dsr',
    'runway',
    'direction',
    'overdue',
    'new-charge',
    'found',
    'category-move',
    'card-limit',
    'net-worth',
  ];

  it('each template fires on the combined fixture', () => {
    // The combined fixture produces more than five; each one is checked by isolating its inputs.
    const isolated = {
      deficit: { summary, processed },
      'deficit-cost': { summary, processed, debtBudget },
      'cost-of-debt': { summary, processed, costOfDebt },
      'debt-plan': { summary, processed, plans },
      'rate-step': { summary, processed, positions, rateSteps },
      dsr: { summary, processed, vitals },
      runway: { summary, processed, vitals },
      direction: { summary, processed, direction },
      overdue: { summary, processed, upcoming },
      'new-charge': { summary, processed, subscriptions },
      found: { summary, processed, finder },
      'category-move': { summary, processed, drift },
      'card-limit': { summary, processed, positions, headroom },
      'net-worth': { summary, processed, netWorth },
    };
    EXPECTED.forEach((id) => {
      expect(ids(buildHeadlines(isolated[id])), id).toContain(id);
    });
  });

  it('no template prints undefined or NaN', () => {
    const fixtures = [
      everything,
      { ...everything, summary: { ...summary, staleLevel: 'alarm', staleDays: 9 } },
      { summary, processed, debtBudget: { deficitPerCycle: 100, deficitCost12: 50 } },
      { summary, processed, plans: { best: { byInterest: 'snowball' }, table: [{ strategy: 'snowball', debtFreeDate: '2049-01-23', interestSavedVsMinimum: 10, monthsSavedVsMinimum: 1 }] } },
      { summary, processed, rateSteps: [{ id: 'x', date: '2026-01-25', from: 0.1, to: 0.11, kind: 'rateStep' }] },
      { summary, processed, vitals: { vitals: { debtServiceRatio: { value: 0.5, tone: 'bad' }, liquidityRunway: { value: 0.2, tone: 'bad' } } } },
      { summary, processed, direction: { summary: { widening: true, netShort: -1, netLong: 0 } } },
      { summary, processed, upcoming: { overdue: [{ perCycle: 12 }] } },
      { summary, processed, subscriptions: { newLines: [{ headline: true, perCycle: 5 }] } },
      { summary, processed, finder: { found: 1 } },
      { summary, processed, drift: { flagged: [{ delta: 400 }] } },
      { summary, processed, netWorth: { knownCount: 1, totalCount: 1, complete: true } },
    ];
    fixtures.forEach((inputs) => {
      buildHeadlines(inputs).forEach((h) => {
        expect(h.text, h.id).not.toMatch(/undefined|NaN|null/);
        expect(h.detail ?? '', h.id).not.toMatch(/undefined|NaN/);
        expect(Number.isFinite(h.weight) || h.id === 'stale', h.id).toBe(true);
      });
    });
  });
});
