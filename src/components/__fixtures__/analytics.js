/**
 * Synthetic example data for the Today / Habits / Plan / Accounts views, shaped exactly like the
 * §3.2 and §3.3 library outputs (subscriptions, priceCreep, drift, basket, fees, savingsFinder;
 * upcoming, incomeProfile, vitals, direction, cashToPayday; the §3.1.3 solver) and the account
 * records of §4 — for the render tests and for a first look at the views before every library
 * lands. Nothing here is real: round numbers, invented labels, one bank called "Example".
 *
 * The fake solver returns a deterministic Solution so the sentence templates can be asserted
 * without the plan engine; it makes no claim to the library's arithmetic.
 */

const D = (y, m, d) => new Date(y, m - 1, d);
const ISO = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
const addMonths = (d, n) => new Date(d.getFullYear(), d.getMonth() + n, Math.min(d.getDate(), 28));
const monthKey = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
const monthsBack = (n, from = D(2026, 7, 1)) =>
  Array.from({ length: n }, (_, i) => monthKey(addMonths(from, -(n - 1 - i))));

export const TODAY = D(2026, 8, 22);
export const DATA_THROUGH = D(2026, 8, 20);
export const NEXT_PAY = D(2026, 8, 23);
export const CYCLE_START = D(2026, 7, 23);
export const CYCLE_END = D(2026, 8, 22);

/** The last twelve complete cycles, oldest first: 2025-08 … 2026-07. */
export const CYCLES = monthsBack(12);

// ---- accounts (§4) ----------------------------------------------------------------------------

const record = (over) => ({
  bank: 'Example',
  typeOverride: null,
  seenThrough: '2026-08-20',
  label: null,
  hidden: false,
  creditLimit: null,
  overdraftLimit: null,
  balanceAsOf: null,
  interestRate: null,
  minimumPayment: null,
  termMonths: null,
  balloon: null,
  feesMonthly: null,
  external: false,
  source: 'csv',
  statementName: null,
  ...over,
  seenNames: over.seenNames ?? [over.rawName],
});

export const fixtureAccounts = [
  record({
    id: 'example|1234',
    type: 'Bank',
    mask: '1234',
    rawName: 'Example Bank *1234',
    label: 'Example Cheque',
    isLiability: false,
    currentBalance: 2500,
    balanceAsOf: '2026-08-22',
    overdraftLimit: 5000,
    source: 'statement',
    statementName: 'Example summary.pdf',
  }),
  record({
    id: 'example|5678',
    type: 'Savings',
    mask: '5678',
    rawName: 'Example Savings *5678',
    label: 'Example Savings',
    isLiability: false,
    currentBalance: null,
  }),
  record({
    id: 'example|9012',
    type: 'Credit Card',
    mask: '9012',
    rawName: 'Example Credit Card *9012',
    label: 'Example Card',
    isLiability: true,
    currentBalance: -62000,
    balanceAsOf: '2026-08-10',
    creditLimit: 100000,
    source: 'manual',
  }),
  record({
    id: 'example|3456',
    type: 'Loan',
    mask: '3456',
    rawName: 'Example Loan *3456',
    label: 'Example Bond',
    isLiability: true,
    currentBalance: -600000,
    balanceAsOf: '2026-05-01',
    source: 'csv',
  }),
  record({
    id: 'example|1412',
    type: 'Savings',
    mask: '1412',
    rawName: 'Example Savings *1412',
    label: 'Example Retirement Annuity',
    isLiability: false,
    currentBalance: 17227.87,
    balanceAsOf: '2026-08-22',
    external: true,
    source: 'statement',
    statementName: 'Example summary.pdf',
    seenThrough: null,
  }),
];

// ---- recurring lines (recurring.js shape) ---------------------------------------------------

const perCycleSeries = (amount, n = 12) => Array.from({ length: n }, () => amount);

const line = (over) => {
  const amount = over.amount ?? 0;
  const perYear = over.perYear ?? 12;
  return {
    key: over.label.toLowerCase().replace(/\s+/g, ' '),
    source: 'charge',
    kind: 'optional',
    category: 'Software & Services',
    spendingGroup: 'Lifestyle',
    accountId: 'example|1234',
    payingAccountId: 'example|1234',
    loanAccountId: null,
    cardAccountId: null,
    cadence: 'monthly',
    medianGap: 30,
    gapMad: 1,
    perYear,
    observations: 12,
    tentative: false,
    amount,
    amountStable: true,
    regular: true,
    range: [amount, amount],
    regimes: [{ from: CYCLES[0], to: CYCLES[11], amount, count: 12 }],
    outliers: 0,
    priceChange: null,
    perCycle: (amount * perYear) / 12,
    perYearAmount: amount * perYear,
    perCycleAmounts: perCycleSeries(amount),
    firstSeen: D(2025, 8, 1),
    lastSeen: D(2026, 8, 1),
    cyclesPresent: 12,
    cyclesSinceFirst: 12,
    presence: 1,
    dom: 1,
    domIqr: 1,
    gapIqr: 1,
    weekendShift: null,
    nextDate: D(2026, 9, 1),
    dueCycle: '2026-08',
    dueThisCycle: true,
    status: 'active',
    cycleStatus: 'due',
    landedKey: null,
    confidence: 0.92,
    level: 'high',
    items: [],
    ...over,
  };
};

export const lineStream = line({
  id: 'example stream|example|1234|0',
  label: 'Example Stream',
  category: 'Entertainment',
  amount: 199,
  regimes: [
    { from: CYCLES[0], to: CYCLES[6], amount: 159, count: 7 },
    { from: CYCLES[7], to: CYCLES[11], amount: 199, count: 5 },
  ],
  priceChange: { from: 159, to: 199, pct: 0.2516, since: CYCLES[7] },
  perCycleAmounts: [...perCycleSeries(159, 7), ...perCycleSeries(199, 5)],
});
export const lineFibre = line({
  id: 'example fibre|example|1234|0',
  label: 'Example Fibre',
  category: 'Other Phone & Internet',
  amount: 899,
  dom: 1,
  regimes: [
    { from: CYCLES[0], to: CYCLES[5], amount: 699, count: 6 },
    { from: CYCLES[6], to: CYCLES[8], amount: 799, count: 3 },
    { from: CYCLES[9], to: CYCLES[11], amount: 899, count: 3 },
  ],
  priceChange: { from: 699, to: 899, pct: 0.286, since: CYCLES[9] },
  perCycleAmounts: [...perCycleSeries(699, 6), ...perCycleSeries(799, 3), ...perCycleSeries(899, 3)],
});
export const lineInsurer = line({
  id: 'example insurer|example|1234|0',
  label: 'Example Insurer',
  kind: 'insurance',
  category: 'Other Insurance',
  amount: 1450,
  dom: 25,
  lastSeen: D(2026, 7, 25),
  nextDate: D(2026, 8, 25),
});
export const lineGym = line({
  id: 'example gym|example|1234|0',
  label: 'Example Gym',
  category: 'Sport & Fitness',
  amount: 549,
  dom: 3,
  lastSeen: D(2026, 7, 3),
  nextDate: D(2026, 8, 3),
  cycleStatus: 'overdue',
});
export const lineBankFee = line({
  id: 'example bank fee|example|1234|0',
  label: 'Example Cheque fee',
  kind: 'fee',
  category: 'Bank Charges',
  amount: 119,
  dom: 1,
  regimes: [
    { from: CYCLES[0], to: CYCLES[10], amount: 99, count: 11 },
    { from: CYCLES[11], to: CYCLES[11], amount: 119, count: 2 },
  ],
  priceChange: { from: 99, to: 119, pct: 0.202, since: CYCLES[11] },
  level: 'medium',
  confidence: 0.7,
});
export const lineCloud = line({
  id: 'example cloud|example|9012|0',
  label: 'Example Cloud',
  amount: 1299,
  accountId: 'example|9012',
  payingAccountId: 'example|9012',
  observations: 3,
  cyclesPresent: 3,
  cyclesSinceFirst: 3,
  presence: 1,
  firstSeen: D(2026, 6, 21),
  lastSeen: D(2026, 7, 21),
  dom: 21,
  nextDate: D(2026, 8, 21),
  regimes: [{ from: CYCLES[9], to: CYCLES[11], amount: 1299, count: 3 }],
  perCycleAmounts: perCycleSeries(1299, 3),
  cycleStatus: 'unobservable',
  level: 'medium',
  confidence: 0.64,
});
export const lineBond = line({
  id: 'example bond|example|1234|0',
  label: 'Example Bond',
  source: 'instalment',
  kind: 'instalment',
  category: 'Home Loan',
  amount: 22855,
  dom: 24,
  lastSeen: D(2026, 7, 24),
  nextDate: D(2026, 8, 24),
  regimes: [
    { from: CYCLES[0], to: CYCLES[4], amount: 24868, count: 5 },
    { from: CYCLES[5], to: CYCLES[11], amount: 22855, count: 7 },
  ],
  loanAccountId: 'example|3456',
});
export const lineCar = line({
  id: 'example car|example|1234|0',
  label: 'Example Car',
  source: 'instalment',
  kind: 'instalment',
  category: 'Car Loan',
  amount: 4990,
  dom: 27,
  lastSeen: D(2026, 7, 27),
  nextDate: D(2026, 8, 27),
});
export const lineRepayment = line({
  id: 'example card repayment|example|1234|0',
  label: 'Example Card repayment',
  source: 'repayment',
  kind: 'repayment',
  category: 'Credit Card Repayment',
  amount: 6000,
  dom: 26,
  cardAccountId: 'example|9012',
  lastSeen: D(2026, 7, 26),
  nextDate: D(2026, 8, 26),
  level: 'medium',
});
export const lineDomain = line({
  id: 'example domain|example|1234|0',
  label: 'Example Domain',
  cadence: 'annual',
  perYear: 1,
  amount: 1200,
  observations: 2,
  medianGap: 365,
  regimes: [{ from: CYCLES[3], to: CYCLES[3], amount: 1200, count: 2 }],
  perCycleAmounts: [0, 0, 0, 1200, 0, 0, 0, 0, 0, 0, 0, 0],
  lastSeen: D(2025, 11, 12),
  nextDate: D(2026, 11, 12),
  level: 'medium',
});
export const lineMagazine = line({
  id: 'example magazine|example|1234|0',
  label: 'Example Magazine',
  category: 'Books & Stationery',
  amount: 89,
  status: 'lapsed',
  lastSeen: D(2026, 4, 5),
  nextDate: null,
  cycleStatus: null,
  observations: 9,
  cyclesPresent: 9,
});

export const fixtureLines = [
  lineBond,
  lineRepayment,
  lineCar,
  lineInsurer,
  lineCloud,
  lineFibre,
  lineGym,
  lineStream,
  lineBankFee,
  lineDomain,
];

// ---- §3.2 savings ---------------------------------------------------------------------------

export const fixtureSubscriptions = {
  lines: fixtureLines,
  byKind: {
    optional: { count: 4, perCycle: 2946, perYear: 35352 },
    insurance: { count: 1, perCycle: 1450, perYear: 17400 },
    fee: { count: 1, perCycle: 119, perYear: 1428 },
    utility: { count: 0, perCycle: 0, perYear: 0 },
    instalment: { count: 2, perCycle: 27845, perYear: 334140 },
    repayment: { count: 1, perCycle: 6000, perYear: 72000 },
    person: { count: 0, perCycle: 0, perYear: 0 },
    other: { count: 1, perCycle: 100, perYear: 1200 },
  },
  byCadence: { weekly: 0, fortnightly: 0, monthly: 9, bimonthly: 0, quarterly: 0, annual: 1, irregular: 0 },
  optionalPerCycle: 2946,
  optionalPerYear: 35352,
  insurancePerCycle: 1450,
  feePerCycle: 119,
  utilityPerCycle: 0,
  annualItems: [{ ...lineDomain, setAsidePerCycle: 100 }],
  dueSoon: [lineInsurer],
  newLines: [{ ...lineCloud, cyclesSeen: 3, trialConverted: false, wording: 'new monthly charge', headline: true }],
  newSince: { cycle: CYCLES[9], label: 'May 2026', start: D(2026, 4, 23) },
  lapsedLines: [{ ...lineMagazine, savedPerCycle: 89, since: CYCLES[9], savedSoFar: 267, byOverride: false }],
  downgrades: [],
  realisedPerCycle: 89,
  realisedPerYear: 1068,
  realisedSoFar: 267,
  cycles: CYCLES,
  assumptions: ['Savings totals leave out instalments, card repayments and lines marked keep.'],
};

export const fixturePriceCreep = {
  rising: [
    {
      lineId: lineFibre.id,
      label: 'Example Fibre',
      kind: 'optional',
      category: 'Other Phone & Internet',
      first: { cycle: CYCLES[0], amount: 699, count: 6 },
      last: { cycle: CYCLES[11], amount: 899, count: 3 },
      steps: [
        { cycle: CYCLES[6], from: 699, to: 799, pct: 0.143, count: 3 },
        { cycle: CYCLES[9], from: 799, to: 899, pct: 0.125, count: 3 },
      ],
      totalPct: 0.286,
      extraPerCycle: 200,
      extraPerYear: 2400,
      slopePerYear: 190,
      cyclesObserved: 12,
      countsInTotal: true,
    },
    {
      lineId: lineStream.id,
      label: 'Example Stream',
      kind: 'optional',
      category: 'Entertainment',
      first: { cycle: CYCLES[0], amount: 159, count: 7 },
      last: { cycle: CYCLES[11], amount: 199, count: 5 },
      steps: [{ cycle: CYCLES[7], from: 159, to: 199, pct: 0.2516, count: 5 }],
      totalPct: 0.2516,
      extraPerCycle: 40,
      extraPerYear: 480,
      slopePerYear: 36,
      cyclesObserved: 12,
      countsInTotal: true,
    },
    {
      lineId: lineBankFee.id,
      label: 'Example Cheque fee',
      kind: 'fee',
      category: 'Bank Charges',
      first: { cycle: CYCLES[0], amount: 99, count: 11 },
      last: { cycle: CYCLES[11], amount: 119, count: 2 },
      steps: [{ cycle: CYCLES[11], from: 99, to: 119, pct: 0.202, count: 2 }],
      totalPct: 0.202,
      extraPerCycle: 20,
      extraPerYear: 240,
      slopePerYear: 8,
      cyclesObserved: 12,
      countsInTotal: true,
    },
  ],
  falling: [
    {
      lineId: lineBond.id,
      label: 'Example Bond',
      kind: 'instalment',
      category: 'Home Loan',
      first: { cycle: CYCLES[0], amount: 24868, count: 5 },
      last: { cycle: CYCLES[11], amount: 22855, count: 7 },
      steps: [{ cycle: CYCLES[5], from: 24868, to: 22855, pct: -0.081, count: 7 }],
      totalPct: -0.081,
      extraPerCycle: -2013,
      extraPerYear: -24156,
      slopePerYear: -1500,
      cyclesObserved: 12,
      countsInTotal: false,
    },
  ],
  variable: [
    { lineId: 'example pharmacy|example|1234|0', label: 'Example Pharmacy', kind: 'other', singletonShare: 0.45 },
    { lineId: 'example fuel|example|1234|0', label: 'Example Fuel', kind: 'other', singletonShare: 0.4 },
  ],
  extraPerCycle: 260,
  extraPerYear: 3120,
  assumptions: ['Instalments, card repayments and interest lines are listed but never totalled: a rate move is not a price.'],
};

const driftSeries = (baseline, recent) => [
  ...CYCLES.slice(0, 12).map((month, i) => ({ month, total: baseline + (i % 2 ? 60 : -60) })),
  ...['2026-05', '2026-06', '2026-07'].map((month) => ({ month, total: recent })),
];
const driftRow = (over) => ({
  flagged: true,
  share: 0.12,
  topMerchants: [],
  ...over,
  perYear: over.delta * 12,
});
const driftGroceries = driftRow({
  category: 'Groceries',
  baselineMedian: 6000,
  baselineSd: 450,
  recentMedian: 7800,
  delta: 1800,
  z: 4,
  direction: 'up',
  share: 0.18,
  series: driftSeries(6000, 7800),
  topMerchants: [
    { label: 'Example Grocer', recentPerCycle: 5200 },
    { label: 'Example Market', recentPerCycle: 1400 },
  ],
});
const driftPets = driftRow({
  category: 'Pets',
  baselineMedian: 900,
  baselineSd: 140,
  recentMedian: 1300,
  delta: 400,
  z: 2.86,
  direction: 'up',
  series: driftSeries(900, 1300),
  topMerchants: [{ label: 'Example Vet', recentPerCycle: 900 }],
});
const driftCellphone = driftRow({
  category: 'Cellphone',
  baselineMedian: 1100,
  baselineSd: 110,
  recentMedian: 750,
  delta: -350,
  z: -3.2,
  direction: 'down',
  series: driftSeries(1100, 750),
  topMerchants: [{ label: 'Example Mobile', recentPerCycle: 750 }],
});
export const fixtureDrift = {
  categories: [driftGroceries, driftPets, driftCellphone],
  flagged: [driftGroceries, driftPets, driftCellphone],
  upPerCycle: 2200,
  downPerCycle: 350,
  recent: ['2026-05', '2026-06', '2026-07'],
  baseline: CYCLES.slice(0, 12),
  assumptions: ['Per category, the median of the last 3 complete cycles against the median and robust spread of the 12 before.'],
};

const basketSeries = (visits, ticket, n) =>
  Array.from({ length: n }, (_, i) => ({ month: CYCLES[i] ?? `2026-${String(8 + i).padStart(2, '0')}`, visits, meanTicket: ticket, spend: visits * ticket }));
const family = (over) => ({
  merchantFamily: null,
  early: { visitsPerCycle: 4, meanTicket: 500, medianTicket: 480, spendPerCycle: 2000 },
  late: { visitsPerCycle: 8, meanTicket: 500, medianTicket: 490, spendPerCycle: 4000 },
  delta: { spend: 2000, frequency: 2000, ticket: 0 },
  driver: 'frequency',
  frequencyPerCycle: 2000,
  seriesByCycle: [...basketSeries(4, 500, 6), ...basketSeries(8, 500, 6)],
  ...over,
});
export const fixtureBasket = {
  windowNote: 'cycles 12–7 back against the last 6',
  early: { cycles: CYCLES.slice(0, 6) },
  late: { cycles: CYCLES.slice(6, 12) },
  families: [
    family({ category: 'Groceries', label: 'Groceries' }),
    family({ category: 'Groceries', merchantFamily: 'example', label: 'Example Grocer' }),
    family({
      category: 'Eating Out & Takeaways',
      label: 'Eating Out & Takeaways',
      early: { visitsPerCycle: 4, meanTicket: 500, medianTicket: 450, spendPerCycle: 2000 },
      late: { visitsPerCycle: 4, meanTicket: 600, medianTicket: 560, spendPerCycle: 2400 },
      delta: { spend: 400, frequency: 0, ticket: 400 },
      driver: 'ticket',
      frequencyPerCycle: 0,
      seriesByCycle: [...basketSeries(4, 500, 6), ...basketSeries(4, 600, 6)],
    }),
  ],
  cycles: CYCLES,
  assumptions: ['A visit is a row of R 20 or more; spend counts every row.'],
};

const feeKinds = (over) => Object.fromEntries(Object.entries(over).map(([k, perCycle]) => [k, { perCycle, perYear: perCycle * 12, trend: 0, total: perCycle * 6 }]));
export const fixtureFees = {
  byAccount: [
    {
      accountId: 'example|9012',
      label: 'Example Card',
      type: 'Credit Card',
      kinds: feeKinds({ account: 69, cardInterest: 1700, embeddedInsurance: 85 }),
      totalPerYear: (69 + 1700 + 85) * 12,
      spendRows6: 180,
    },
    {
      accountId: 'example|3456',
      label: 'Example Bond',
      type: 'Loan',
      kinds: feeKinds({ loanInterest: 4700, loanInsurance: 130 }),
      totalPerYear: (4700 + 130) * 12,
      spendRows6: 0,
    },
    {
      accountId: 'example|1234',
      label: 'Example Cheque',
      type: 'Bank',
      kinds: feeKinds({ account: 119, transaction: 25, atm: 10 }),
      totalPerYear: (119 + 25 + 10) * 12,
      spendRows6: 240,
    },
    {
      accountId: 'example|5678',
      label: 'Example Savings Cheque',
      type: 'Bank',
      kinds: feeKinds({ account: 120 }),
      totalPerYear: 1440,
      spendRows6: 3,
    },
  ],
  byKind: feeKinds({ account: 239, transaction: 25, atm: 10, cardInterest: 1700, embeddedInsurance: 85, loanInterest: 4700, loanInsurance: 130 }),
  avoidablePerYear: 420,
  accountFeesPerYear: 2868,
  consolidation: { closeCandidate: 'Example Savings Cheque', keepCandidate: 'Example Cheque', closeAccountId: 'example|5678', keepAccountId: 'example|1234', savingPerYear: 1440 },
  ppi: { perYear: 1020, perCycle: 85, accounts: ['Example Card'], byAccount: [{ accountId: 'example|9012', label: 'Example Card', perCycle: 85, perYear: 1020 }] },
  cardInterest: { perCycle: 1700, perYear: 20400, cyclesWithInterest: 5, series: CYCLES.map((month) => ({ month, amount: 1700 })), runRatePerCycle: 1700 },
  overdraftInterestPerYear: 0,
  loanCostPerYear: 57960,
  steps: [{ lineId: lineBankFee.id, label: 'Example Cheque', accountId: 'example|1234', feeKind: 'account', from: 99, to: 119, pct: 0.202, cycle: '2026-07' }],
  totalPerYear: 82476,
  cycles: CYCLES.slice(6),
  assumptions: ['Run rates are the median of the last 6 complete cycles; the initiation fee is listed but never in a run rate.'],
};

const finderItem = (over) => ({ kinds: [over.kind], evidence: [], lineId: null, perYear: over.perCycle * 12, ...over });
export const fixtureFinder = {
  items: [
    finderItem({ id: 'new-charge:cloud', kind: 'new-charge', bucket: 'cancellable', label: 'Example Cloud', perCycle: 1299, confidence: 'medium', action: 'check whether you meant to keep it', lineId: lineCloud.id }),
    finderItem({ id: 'subscription:gym', kind: 'subscription', bucket: 'cancellable', label: 'Example Gym', perCycle: 549, confidence: 'high', action: 'cancel', lineId: lineGym.id }),
    finderItem({ id: 'creep:fibre', kind: 'creep', kinds: ['subscription', 'creep'], bucket: 'cancellable', label: 'Example Fibre', perCycle: 200, confidence: 'high', action: 'query or renegotiate', lineId: lineFibre.id }),
    finderItem({ id: 'subscription:stream', kind: 'subscription', bucket: 'cancellable', label: 'Example Stream', perCycle: 199, confidence: 'high', action: 'cancel', lineId: lineStream.id }),
    finderItem({ id: 'consolidation', kind: 'consolidation', bucket: 'cancellable', label: 'Second current account', perCycle: 120, confidence: 'medium', action: 'close the Example Savings Cheque' }),
    finderItem({ id: 'ppi:card', kind: 'ppi', bucket: 'cancellable', label: 'Payment protection on the Example Card', perCycle: 85, confidence: 'medium', action: 'cancel the cover' }),
    finderItem({ id: 'avoidable-fees', kind: 'avoidable-fees', bucket: 'cancellable', label: 'Transaction, ATM and penalty fees', perCycle: 35, confidence: 'high', action: 'use the bundle' }),
    finderItem({ id: 'drift:groceries', kind: 'drift', bucket: 'behavioural', label: 'Groceries', perCycle: 1800, confidence: 'medium', action: 'see what changed' }),
    finderItem({ id: 'basket:groceries', kind: 'basket', bucket: 'behavioural', label: 'Groceries trips', perCycle: 2000, confidence: 'low', action: 'fewer trips' }),
  ],
  found: 2487,
  foundPerYear: 29844,
  behaviouralPotential: 3800,
  informational: [
    finderItem({
      id: 'card-interest',
      kind: 'card-interest',
      bucket: 'informational',
      label: 'Card interest',
      perCycle: 1700,
      confidence: 'high',
      action: 'becomes a saving only once the balance is paid down — see Debt',
      sentence: 'Card interest: R 1 700 a cycle — becomes a saving only once the balance is paid down — see Debt',
    }),
  ],
  deficit: 17000,
  cover: 0.146,
  realised: 89,
  realisedPerYear: 1068,
  cycles: CYCLES,
  assumptions: ['Found counts only cancellable items at high or medium confidence; behavioural potential is shown separately.'],
};

// ---- §3.3 cashflow --------------------------------------------------------------------------

const upcomingItem = (l, status = 'due') => ({ lineId: l.id, label: l.label, kind: l.kind, amount: l.amount, level: l.level, payingAccountId: l.payingAccountId, status });
export const fixtureUpcoming = {
  entries: [
    { date: D(2026, 8, 21), cycleDay: 30, cycle: 'current', items: [upcomingItem(lineCloud, 'unobservable')], total: 1299, lowTotal: 0, payday: false, income: 0 },
    { date: D(2026, 8, 23), cycleDay: 1, cycle: 'next', items: [], total: 0, lowTotal: 0, payday: true, income: 75000 },
    { date: D(2026, 8, 24), cycleDay: 2, cycle: 'next', items: [upcomingItem(lineBond)], total: 22855, lowTotal: 0, payday: false, income: 0 },
    { date: D(2026, 8, 25), cycleDay: 3, cycle: 'next', items: [upcomingItem(lineInsurer)], total: 1450, lowTotal: 0, payday: false, income: 0 },
    { date: D(2026, 8, 26), cycleDay: 4, cycle: 'next', items: [upcomingItem(lineRepayment)], total: 6000, lowTotal: 0, payday: false, income: 0 },
    { date: D(2026, 8, 27), cycleDay: 5, cycle: 'next', items: [upcomingItem(lineCar)], total: 4990, lowTotal: 0, payday: false, income: 0 },
    { date: D(2026, 9, 1), cycleDay: 10, cycle: 'next', items: [upcomingItem(lineFibre), upcomingItem(lineStream)], total: 1098, lowTotal: 0, payday: false, income: 0 },
    { date: D(2026, 9, 15), cycleDay: 24, cycle: 'next', items: [{ lineId: 'tentative|x', label: 'Example Tentative', kind: 'other', amount: 320, level: 'low', payingAccountId: 'example|1234', status: 'due' }], total: 0, lowTotal: 320, payday: false, income: 0 },
  ],
  dueBeforePayday: 1299,
  dueAfterPayday: 30393,
  lowConfidenceExtra: 320,
  overdue: [lineGym],
  landed: [],
  unobservable: [lineCloud],
  coverage: { explained: 60000, total: 80000, share: 0.75, cycle: '2026-07' },
  horizon: { from: D(2026, 8, 21), to: D(2026, 9, 21), nextPayDate: NEXT_PAY },
  assumptions: ['Totals count high- and medium-confidence lines only.', 'The data ends 2 days before today; charges due in that gap are marked "not yet in the data".'],
};

const salaryTiming = { typicalCycleDay: 3, lateRisk: 0.17, lateDelayP90: 4, missingCycles: ['2026-01'], doubleCycles: ['2026-02'], lateCycles: ['2025-11'] };
export const fixtureIncomeProfile = {
  sources: [
    { id: 'salary-1', label: 'Example Employer', kind: 'salary', category: 'Salaries', accountId: 'example|1234', presence: 1, cyclesPresent: 12, cyclesSinceFirst: 12, occurrences: 12, dom: 25, domIqr: 1, expectedAmount: 75000, expectedNext: D(2026, 8, 25), lastReceived: D(2026, 7, 24), regular: true, share: 0.93, total: 900000, timing: salaryTiming },
    { id: 'rent-1', label: 'Example Tenant', kind: 'rent', category: 'Rent', accountId: 'example|1234', presence: 0.92, cyclesPresent: 11, cyclesSinceFirst: 12, occurrences: 11, dom: 2, domIqr: 2, expectedAmount: 5500, expectedNext: D(2026, 9, 2), lastReceived: D(2026, 8, 2), regular: true, share: 0.07, total: 60500, timing: null },
  ],
  salary: { sourceIds: ['salary-1'], expectedAmount: 75000, expectedNext: D(2026, 8, 25), lastReceived: D(2026, 7, 24), cycles: 12, ...salaryTiming },
  totalPerCycle: 80500,
  sourceCount: 2,
  hhi: 0.87,
  stabilityScore: 62,
  tone: 'warn',
  interestIncome: 120,
  refundsRemoved: 1,
  cycles: CYCLES,
  assumptions: ['Stability score is a heuristic: 40 points for a steady salary amount, 35 for punctuality, 25 for spread across sources.'],
};

const vitalSeries = (values, shifted = []) => CYCLES.map((month, i) => ({ month, value: values[i] ?? values[values.length - 1], incomeShifted: shifted.includes(month) }));
const vital = (over) => ({ delta: over.short - over.long, ...over, value: over.value ?? over.short });
export const fixtureVitals = {
  window: { short: CYCLES.slice(-3), long: CYCLES, complete: 12 },
  exceptionIncome: 578000,
  vitals: {
    savingsRate: vital({ short: -0.22, long: -0.15, direction: 'worsening', tone: 'bad', series: vitalSeries([-0.1, -0.12, -0.08, -0.15, -0.2, 0.4, -0.18, -0.14, -0.16, -0.2, -0.24, -0.22], ['2026-01']), thresholds: { amber: 0.1, red: 0 } }),
    debtServiceRatio: vital({ short: 0.46, long: 0.43, direction: 'worsening', tone: 'bad', series: vitalSeries([0.4, 0.41, 0.42, 0.42, 0.43, 0.2, 0.44, 0.44, 0.45, 0.45, 0.46, 0.47], ['2026-01']), thresholds: { amber: 0.3, red: 0.4 }, partial: true, components: { instalments: 27845, cardCost: 1700, cardMinimum: 3100 } }),
    interestBurden: vital({ short: 0.36, long: 0.33, direction: 'worsening', tone: 'bad', series: vitalSeries([0.3, 0.31, 0.32, 0.32, 0.33, 0.15, 0.34, 0.34, 0.35, 0.35, 0.36, 0.37], ['2026-01']), thresholds: { amber: 0.1, red: 0.2 }, components: { loans: 4830, cards: 1700, bank: 30 } }),
    liquidityRunway: vital({ short: 0.6, long: 0.9, direction: 'worsening', tone: 'bad', series: vitalSeries([1.2, 1.1, 1.0, 1.0, 0.9, 0.9, 0.8, 0.8, 0.7, 0.7, 0.6, 0.6]), thresholds: { amber: 1, red: 1 }, liquidAssets: 48000, medianSpend: 80000, knownCount: 3, totalCount: 4 }),
    creditRunway: vital({ short: 1.8, long: 2.4, direction: 'worsening', tone: 'bad', series: vitalSeries([3, 2.8, 2.6, 2.5, 2.4, 2.3, 2.2, 2.1, 2.0, 1.9, 1.8, 1.8]), thresholds: { amber: 3, red: 3 }, liquidAssets: 48000, cardAvailable: 38000, overdraftAvailable: 5000, medianSpend: 80000 }),
    cardUtilisation: vital({ short: 0.62, long: 0.5, direction: 'worsening', tone: 'warn', series: vitalSeries([0.3, 0.34, 0.38, 0.4, 0.44, 0.46, 0.5, 0.52, 0.55, 0.58, 0.6, 0.62]), thresholds: { amber: 0.3, red: 0.75 }, perCard: [{ account: 'Example Card', used: 62000, available: 38000, limit: 100000 }] }),
    deficitPerCycle: vital({ short: 17000, long: 12000, direction: 'worsening', tone: 'bad', series: vitalSeries([8000, 9000, 7000, 11000, 14000, 0, 12000, 10000, 12000, 15000, 18000, 17000], ['2026-01']), fundedBy: [{ account: 'Example Card', windowChange: -51000 }] }),
  },
  worst: ['debtServiceRatio', 'interestBurden', 'savingsRate'],
  assumptions: ['Income excludes one-off inflows (R 578 000 over the window).'],
};
/** The same vitals before any balance is typed: runway and utilisation unknown. */
export const fixtureVitalsUnanchored = {
  ...fixtureVitals,
  vitals: {
    ...fixtureVitals.vitals,
    liquidityRunway: { ...fixtureVitals.vitals.liquidityRunway, value: null, short: null, long: null, series: [] },
    creditRunway: { ...fixtureVitals.vitals.creditRunway, value: null, short: null, long: null, series: [] },
    cardUtilisation: { ...fixtureVitals.vitals.cardUtilisation, value: null, short: null, long: null, series: [], perCard: [] },
  },
};

const directionSeries = (from, to, n = 24) => Array.from({ length: n }, (_, i) => Math.round(from + ((to - from) * i) / (n - 1)));
const metric = (id, label, short, long, prior, tone, series, note = null) => ({ id, label, short, long, prior, delta: short - long, deltaPct: long !== 0 ? (short - long) / Math.abs(long) : null, tone, series, note });
export const fixtureDirection = {
  metrics: [
    metric('income', 'Income', 70000, 72000, 68000, 'neutral', directionSeries(66000, 70000)),
    metric('spend', 'Spend', 85000, 80000, 72000, 'bad', directionSeries(70000, 85000)),
    metric('net', 'Net', -15000, -8000, -4000, 'bad', directionSeries(-4000, -15000)),
    metric('instalments', 'Instalments', 27845, 28500, 29800, 'good', directionSeries(29800, 27845)),
    metric('interestFees', 'Interest and fees', 30000, 28000, 25000, 'bad', directionSeries(25000, 30000)),
    metric('standingCharges', 'Standing charges', 4600, 4300, 4000, 'bad', directionSeries(4000, 4600)),
    metric('cardBalanceChange', 'Card balance change', -5000, -3000, -1000, 'bad', directionSeries(-1000, -5000)),
  ],
  summary: { netShort: -15000, netLong: -8000, netPrior: -4000, widening: true },
  cycles: monthsBack(24),
  assumptions: ['Income here includes one-off inflows but is summarised by the median, which a single windfall cannot move.'],
};

const day = (date, cycleDay, cycle, balance, over = {}) => ({ date, cycleDay, cycle, observed: over.observed ?? false, elapsed: false, scheduled: [], income: 0, discretionary: -500, balance, low: balance - 900, high: balance + 600, ...over });
const chequeDays = [
  day(D(2026, 8, 20), 29, 'current', 2500, { observed: true, discretionary: 0 }),
  day(D(2026, 8, 21), 30, 'current', 700, { scheduled: [{ label: 'Example Cloud', amount: -1299, level: 'medium', kind: 'optional' }] }),
  day(D(2026, 8, 22), 31, 'current', 200),
  day(D(2026, 8, 23), 1, 'next', 74700, { income: 75000 }),
  day(D(2026, 8, 24), 2, 'next', 51345, { scheduled: [{ label: 'Example Bond', amount: -22855, level: 'high', kind: 'instalment' }] }),
  day(D(2026, 8, 25), 3, 'next', 49395, { scheduled: [{ label: 'Example Insurer', amount: -1450, level: 'high', kind: 'insurance' }] }),
  day(D(2026, 8, 26), 4, 'next', 42895, { scheduled: [{ label: 'Example Card repayment', amount: -6000, level: 'medium', kind: 'repayment' }] }),
  day(D(2026, 8, 27), 5, 'next', 37405, { scheduled: [{ label: 'Example Car', amount: -4990, level: 'high', kind: 'instalment' }] }),
  day(D(2026, 8, 28), 6, 'next', 36905),
  day(D(2026, 8, 29), 7, 'next', 36405),
  day(D(2026, 8, 30), 8, 'next', 35905),
];
const savingsDays = chequeDays.map((d) => ({ ...d, scheduled: [], income: 0, discretionary: 0, balance: 500, low: 500, high: 500 }));
const totalDays = chequeDays.map((d, i) => ({ date: d.date, cycleDay: d.cycleDay, cycle: d.cycle, observed: d.observed, elapsed: false, balance: d.balance + savingsDays[i].balance, low: d.low + 500, high: d.high + 500, income: d.income, scheduled: d.scheduled.reduce((s, x) => s + x.amount, 0) }));
export const fixtureCashPath = {
  anchored: true,
  buffer: 2000,
  horizon: { from: D(2026, 8, 21), to: D(2026, 8, 30), nextPayDate: NEXT_PAY },
  dataThrough: DATA_THROUGH,
  asOf: TODAY,
  estimate: true,
  accounts: [
    { accountId: 'example|1234', label: 'Example Cheque', type: 'Bank', start: 2500, floor: -5000, known: true, external: false, days: chequeDays, firstBelowFloor: null, firstBelowBuffer: { date: D(2026, 8, 21), cycleDay: 30, value: 700 }, min: { date: D(2026, 8, 22), cycleDay: 31, value: 200 }, daysUnderBuffer: 2 },
    { accountId: 'example|5678', label: 'Example Savings', type: 'Savings', start: 500, floor: 0, known: true, external: false, days: savingsDays, firstBelowFloor: null, firstBelowBuffer: null, min: { date: D(2026, 8, 20), cycleDay: 29, value: 500 }, daysUnderBuffer: 0 },
  ],
  cards: [{ accountId: 'example|9012', label: 'Example Card', start: -62000, limit: 100000, days: chequeDays.map((d, i) => ({ date: d.date, cycleDay: d.cycleDay, balance: -62000 - i * 400 })), firstLimit: null }],
  total: {
    days: totalDays,
    firstBelowFloor: null,
    firstBelowBuffer: { date: D(2026, 8, 21), cycleDay: 30, value: 1200 },
    min: { date: D(2026, 8, 22), cycleDay: 31, value: 700 },
    atPayday: { before: 700, after: 75200 },
    endOfHorizon: 36405,
    daysUnderBuffer: 2,
  },
  lateSalary: { probability: 0.17, delayDays: 4, firstBelowFloor: { date: D(2026, 8, 24), cycleDay: 2, value: -23000 }, min: { date: D(2026, 8, 27), cycleDay: 5, value: -37000 } },
  assumptions: ['Balances as of 22 Aug from your Example summary.', 'Daily spend is the recency-weighted pace of the last 6 complete cycles at the same day of the cycle.', '2 medium-confidence items (R 7 299) are counted.'],
};
/** No balance typed anywhere: every path is the change since today. */
export const fixtureCashPathUnanchored = {
  ...fixtureCashPath,
  anchored: false,
  accounts: fixtureCashPath.accounts.map((a) => ({ ...a, known: false, start: 0, days: a.days.map((d) => ({ ...d, balance: d.balance - a.start })) })),
  total: { ...fixtureCashPath.total, days: totalDays.map((d) => ({ ...d, balance: d.balance - 3000, low: d.low - 3000, high: d.high - 3000 })) },
  lateSalary: null,
};

// ---- §3.1 the shortfall-closing categories --------------------------------------------------

export const fixtureGapClosers = {
  gap: 17000,
  found: 9000,
  closed: false,
  shortfall: 8000,
  plan: [
    { name: 'Eating Out & Takeaways', typical: 5000, available: 3000, share: 0.6, spread: 800, isBill: false, cut: 3000, cutPercent: 0.6 },
    { name: 'Entertainment', typical: 4000, available: 2400, share: 0.6, spread: 600, isBill: false, cut: 2400, cutPercent: 0.6 },
    { name: 'Groceries', typical: 7800, available: 2340, share: 0.3, spread: 900, isBill: false, cut: 2340, cutPercent: 0.3 },
    { name: 'Coffee', typical: 2100, available: 1260, share: 0.6, spread: 300, isBill: false, cut: 1260, cutPercent: 0.6 },
  ],
  candidates: [],
  totalAvailable: 9000,
};


// ---- the existing views' props ----------------------------------------------------------------

export const fixtureSummary = {
  start: CYCLE_START,
  end: CYCLE_END,
  nextPayDate: NEXT_PAY,
  cycleLength: 31,
  cycleDay: 31,
  daysToPayday: 1,
  progress: 1,
  isProjectedEnd: false,
  dataThrough: DATA_THROUGH,
  staleDays: 2,
  staleLevel: 'fresh',
  income: { received: 75000, remaining: 0, projected: 75000, typical: 72000 },
  expense: { spent: 88000, remaining: 2000, projected: 90000, typical: 80000, pace: 1.08 },
  projectedClose: -15000,
  netExpected: -15000,
  forecastPerDay: 2000,
  missedPayments: [],
  cycleCount: 12,
};

export const fixtureSafe = {
  safe: -4200,
  perDay: 0,
  daysLeft: 1,
  bills: [{ name: 'Example Insurer', amount: 1450 }],
  incomeStillExpected: 0,
  committed: 1450,
  discretionaryForecast: 2000,
  forecastGap: -4200,
};

const merchant = (key, label, category, perCycle, count) => ({ key, label, category, count, cyclesPresent: 12, perCycle, perCycleTotals: perCycleSeries(perCycle), lastSeen: D(2026, 8, 18) });
export const fixtureHabits = {
  months: CYCLES,
  topMerchants: [merchant('example grocer', 'Example Grocer', 'Groceries', 5200, 96), merchant('example fuel', 'Example Fuel', 'Transport & Fuel', 2800, 40), merchant('example cafe', 'Example Cafe', 'Coffee', 900, 60)],
  byFrequency: [merchant('example grocer', 'Example Grocer', 'Groceries', 5200, 96), merchant('example cafe', 'Example Cafe', 'Coffee', 900, 60), merchant('example fuel', 'Example Fuel', 'Transport & Fuel', 2800, 40)],
  movers: [
    { category: 'Groceries', delta: 1800, early: 6000, late: 7800, perCycle: 7800 },
    { category: 'Transport & Fuel', delta: -300, early: 3100, late: 2800, perCycle: 2800 },
  ],
  weekday: ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'].map((d, i) => ({ day: d, perCycle: [9000, 6000, 8000, 9500, 14000, 12000, 7000][i], count: 20 + i })),
  busiest: { day: 'Fri', perCycle: 14000 },
  quietest: { day: 'Tue', perCycle: 6000 },
  subscriptions: { total: 4600, byGroup: [], cancellable: [], cancellableTotal: 2946, items: [] },
};

export const fixtureNetWorth = { net: -700000, change: -12000, knownCount: 4 };
export const fixtureCostOfDebt = {
  total: 180000,
  perCycle: 30000,
  perYear: 360000,
  trend: 800,
  accounts: [
    { account: 'Example Bond', total: 96000, perCycle: 16000 },
    { account: 'Example Card', total: 10200, perCycle: 1700 },
  ],
};
export const fixturePositions = [
  { account: 'Example Card', type: 'Credit Card', positionByMonth: { '2026-08': -62000, '2026-07': -55000 }, deltaByMonth: { '2026-08': -7000 }, openingPosition: -42000, windowChange: -20000, currentMonthKey: '2026-08' },
];

export const fixtureBudgets = {
  rows: [
    { category: 'Groceries', typical: 6000, spent: 7000, projected: 7800, target: 6500, status: 'over', over: 1300, isBill: false },
    { category: 'Transport & Fuel', typical: 3000, spent: 2000, projected: 2900, target: null, status: 'none', over: 0, isBill: false },
    { category: 'Example Insurer', typical: 1450, spent: 0, projected: 1450, target: null, status: 'none', over: 0, isBill: true },
  ],
  withTargets: [{ category: 'Groceries' }],
  status: 'over',
  totalProjected: 7800,
  totalTarget: 6500,
  overBy: 1300,
};

export const fixtureCategoryPlan = {
  income: 75000,
  planned: 10850,
  leftover: 64150,
  targetedCount: 1,
  totalCount: 3,
};

export const fixtureTrajectory = {
  points: Array.from({ length: 12 }, (_, i) => ({ cycle: i, date: addMonths(NEXT_PAY, i), net: -700000 - i * 12000, debt: 737000 + i * 13000, assets: 37000 + i * 1000 })),
  horizon: 12,
  endNet: -832000,
  change: -132000,
  events: [{ type: 'limit', account: 'Example Card', cycle: 4, date: addMonths(NEXT_PAY, 4) }],
  absorber: 'Example Card',
};

export const fixtureGoals = {
  goals: [{ id: 'g1', name: 'Example fund', target: 50000, saved: 10000, progress: 0.2, reachable: false, cycles: null, eta: null }],
};

// ---- props per view ---------------------------------------------------------------------------

export const todayProps = (over = {}) => ({
  summary: fixtureSummary,
  safe: fixtureSafe,
  curve: null,
  balances: null,
  netWorth: fixtureNetWorth,
  costOfDebt: fixtureCostOfDebt,
  positions: fixturePositions,
  habits: fixtureHabits,
  vitals: fixtureVitals,
  upcoming: fixtureUpcoming,
  cashPath: fixtureCashPath,
  incomeProfile: fixtureIncomeProfile,
  onOpenLedger: () => {},
  onOpenAccounts: () => {},
  ...over,
});

export const habitsProps = (over = {}) => ({
  habits: fixtureHabits,
  finder: fixtureFinder,
  subscriptions: fixtureSubscriptions,
  priceCreep: fixturePriceCreep,
  drift: fixtureDrift,
  basket: fixtureBasket,
  lineOverrides: { [lineStream.id]: 'keep' },
  onSetLineOverride: () => {},
  asOf: TODAY,
  ...over,
});

export const planProps = (over = {}) => ({
  budgets: fixtureBudgets,
  categoryPlan: fixtureCategoryPlan,
  onSetTarget: () => {},
  trajectory: fixtureTrajectory,
  monthlySaving: 3000,
  onMonthlySavingChange: () => {},
  gapClosers: fixtureGapClosers,
  goals: fixtureGoals,
  onAddGoal: () => {},
  onRemoveGoal: () => {},
  direction: fixtureDirection,
  ...over,
});

export const accountsProps = (over = {}) => ({
  series: { accounts: [] },
  summaries: [],
  positions: [],
  months: CYCLES,
  currentMonth: '2026-08',
  dataThrough: DATA_THROUGH,
  accounts: fixtureAccounts,
  onSaveAccount: () => {},
  onDeleteAccount: () => {},
  costOfDebt: fixtureCostOfDebt,
  fees: fixtureFees,
  ...over,
});

export const NEW_PROPS = {
  today: ['vitals', 'upcoming', 'cashPath', 'incomeProfile', 'onOpenAccounts'],
  habits: ['finder', 'subscriptions', 'priceCreep', 'drift', 'basket', 'lineOverrides', 'onSetLineOverride'],
  plan: ['direction', 'categoryPlan'],
  accounts: ['fees', 'onDeleteAccount', 'dataThrough'],
};

export { ISO as isoOf };
