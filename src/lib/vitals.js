import {
  BURDEN_AMBER,
  BURDEN_RED,
  CARD_MINIMUM_FLOOR,
  CREDIT_RUNWAY_AMBER,
  CREDIT_RUNWAY_GREEN,
  DEFICIT_RED_SHARE,
  DIRECTION_NOISE_RAND,
  DIRECTION_NOISE_SHARE,
  DSR_AMBER,
  DSR_RED,
  INCOME_SHIFTED_SHARE,
  LOAN_CATEGORIES,
  RUNWAY_AMBER,
  RUNWAY_GREEN,
  RUNWAY_NOISE,
  SAVINGS_RATE_AMBER,
  SAVINGS_RATE_GREEN,
  UTIL_AMBER,
  UTIL_NOISE,
  UTIL_RED,
  VITALS_LONG,
  VITALS_NOISE_PP,
  VITALS_SHORT,
} from '../constants';
import { isCost } from './costOfDebt';
import { accountTypeOf, completeMonths, isIncomeRow, isSpendRow, loanAccountsOf } from './flows';
import { accountRows, balanceAt } from './ledger';
import { mean, median } from './stats';

/**
 * Six numbers that say whether the household is solvent, and which way it is going.
 *
 * Every ratio is POOLED over its window — sums over sums — never an average of per-cycle ratios.
 * A cycle with no income (the salary slipped past the 22nd) has an undefined ratio, and a cycle
 * with two salaries has a flattering one; averaging those would report noise. Pooling twelve
 * cycles of income against twelve of spend reports what actually happened.
 *
 * Income here EXCLUDES the Income Exceptions group. There is a R578k windfall in 2026-01, and with
 * it inside the twelve-cycle window the savings rate turns positive and the debt-service ratio
 * halves — a picture that is true of one month and false of the year. The one-offs are reported
 * beside the vitals (`exceptionIncome`) and stated in the assumptions, never counted.
 *
 * Debt service is the paying leg of every loan instalment (by category or by the full-file pair)
 * plus what the cards cost to carry plus the typed card minimums; liquidity is what the Bank and
 * Savings records say they hold, typeOverride honoured, external accounts included. Every
 * liability account is read regardless of the account chips: deselecting the loans hides them
 * from the table, not from the truth.
 *
 * `buildDirection` is the longer view: every complete cycle the file holds, three against twelve
 * against the twelve before, on full-file transfers so that the export's 2026-06 relabelling of
 * its spending groups cannot move a line. Income there includes the one-offs but takes the MEDIAN,
 * which a single windfall cannot move either.
 */

const LIQUID = new Set(['Bank', 'Savings']);
const LOAN_CATEGORY_SET = new Set(LOAN_CATEGORIES);
const MAX_DIRECTION_CYCLES = 25;
const MIN_PRIOR_CYCLES = 6;
const EMPTY_SERIES = [];

function formatRand(n) {
  return `R${Math.round(Math.abs(n)).toLocaleString('en-ZA').replace(/,/g, ' ')}`;
}

const sum = (xs) => xs.reduce((s, x) => s + x, 0);
const sumOver = (W, f) => sum(W.map(f));
const ratio = (n, d) => (d > 0 ? n / d : null);

/** Debt service rows: money out of a non-loan account that is a loan instalment. */
function instalmentsByMonth(data, { transfers, accounts, months }) {
  const loans = transfers?.loanAccounts ?? loanAccountsOf(data, accounts);
  const visible = new Set(months);
  const out = Object.fromEntries(months.map((m) => [m, 0]));
  (data ?? []).forEach((t) => {
    const m = t['Pay Month'];
    if (!visible.has(m) || !(t.AmountNum < 0) || loans.has(t.Account)) return;
    if (LOAN_CATEGORY_SET.has(t.Category) || transfers?.loanInstalmentIds?.has(t.id)) out[m] += -t.AmountNum;
  });
  return out;
}

/** Tone from the thresholds: amber on equality, red strictly past red. */
function toneOf(value, { amber, red, higherIsBetter }) {
  if (value == null || !Number.isFinite(value)) return 'neutral';
  if (higherIsBetter) {
    if (value >= amber) return 'good';
    if (value >= red) return 'warn';
    return 'bad';
  }
  if (value < amber) return 'good';
  if (value <= red) return 'warn';
  return 'bad';
}

function directionOf(short, long, { noise, higherIsBetter }) {
  if (short == null || long == null) return 'flat';
  const delta = short - long;
  if (Math.abs(delta) <= noise) return 'flat';
  const better = higherIsBetter ? delta > 0 : delta < 0;
  return better ? 'improving' : 'worsening';
}

/** One vital: the pooled short and long values, the trend between them, and the tone of the short. */
function vital({ short, long, series, thresholds, higherIsBetter, noise, extras = {} }) {
  const tone = toneOf(short, { ...thresholds, higherIsBetter });
  const redDistance =
    tone === 'bad' && short != null ? (higherIsBetter ? thresholds.red - short : short - thresholds.red) : 0;
  return {
    value: short,
    short,
    long,
    delta: short != null && long != null ? short - long : null,
    direction: directionOf(short, long, { noise, higherIsBetter }),
    tone,
    series,
    thresholds: { amber: thresholds.amber, red: thresholds.red },
    redDistance,
    ...extras,
  };
}

/**
 * @param options.processedLong   processTransactionData(data, selectedAccounts, min(13, months), asOf)
 * @param options.data            every row
 * @param options.accounts        AccountRecord[] — every record, selected or not
 * @param options.balanced        applyBalances(...) with external accounts appended
 * @param options.costOfDebtLong  buildCostOfDebt(data, everyAccountName, processedLong.months)
 * @param options.transfers       buildFullTransfers(data)
 * @param options.calendar        buildCycleCalendar(data, allMonths, asOf)
 * @returns {Vitals|null} — shape at the foot of this file; null without a complete cycle
 */
export function buildVitals(options) {
  const {
    processedLong,
    data,
    accounts = null,
    balanced = [],
    costOfDebtLong = null,
    transfers,
    calendar,
    short = VITALS_SHORT,
    long = VITALS_LONG,
  } = options ?? {};
  if (!processedLong?.rows || !calendar?.starts || !data?.length) return null;
  const visible = new Set(processedLong.months);
  const cycles = completeMonths(calendar).filter((m) => visible.has(m));
  if (!cycles.length) return null;
  const longCycles = cycles.slice(-long);
  const shortCycles = cycles.slice(-short);

  const row = (name) => processedLong.rows.find((r) => r.name === name)?.totalsByMonth ?? {};
  const incomeRow = row('Income');
  const incomeExceptions = row('Income Exceptions');
  const expenseRow = row('Expense');
  const expenseExceptions = row('Expense Exceptions');
  const income = (m) => incomeRow[m] ?? 0;
  const spend = (m) => Math.abs(expenseRow[m] ?? 0) + Math.abs(expenseExceptions[m] ?? 0);
  const exceptionIncome = sumOver(longCycles, (m) => incomeExceptions[m] ?? 0);

  const instalments = instalmentsByMonth(data, { transfers, accounts, months: longCycles });
  const cardAccounts = (costOfDebtLong?.accounts ?? []).filter(
    (a) => accountTypeOf(a.account, accounts) === 'Credit Card',
  );
  const cardCost = (m) => sum(cardAccounts.map((a) => a.byMonth[m] ?? 0));
  const costSeries = new Map((costOfDebtLong?.series ?? []).map((s) => [s.month, s.cost]));
  const interestFees = (m) => costSeries.get(m) ?? 0;
  const costByType = (type, W) =>
    sum(
      (costOfDebtLong?.accounts ?? [])
        .filter((a) => accountTypeOf(a.account, accounts) === type)
        .map((a) => sumOver(W, (m) => a.byMonth[m] ?? 0)),
    );

  // Card minimums: only cards with a typed minimum and a known balance; the balance at each
  // cycle end comes from the ledger, anchored at the record's as-of date.
  const typeOfRecord = (a) => a.typeOverride ?? a.type;
  const cards = (accounts ?? []).filter((a) => typeOfRecord(a) === 'Credit Card');
  let partial = false;
  const cardMinimumByMonth = Object.fromEntries(longCycles.map((m) => [m, 0]));
  cards.forEach((card) => {
    const known = card.currentBalance != null && Number.isFinite(card.currentBalance);
    if (!known || card.minimumPayment == null) {
      partial = true;
      return;
    }
    const rows = accountRows(data, { accountId: card.id });
    longCycles.forEach((m) => {
      const balance = balanceAt(rows, card, calendar.ends[m]);
      const owed = balance == null ? 0 : Math.max(0, -balance);
      cardMinimumByMonth[m] += owed > 0 ? Math.max(CARD_MINIMUM_FLOOR, (card.minimumPayment / 100) * owed) : 0;
    });
  });
  const cardMinimum = (m) => cardMinimumByMonth[m] ?? 0;
  const debtService = (m) => (instalments[m] ?? 0) + cardCost(m) + cardMinimum(m);

  // Sparkline flags: a cycle whose income is a fraction of the usual is a shifted salary, drawn hollow.
  const incomeMedian = median(longCycles.map(income));
  const shifted = (m) => income(m) < INCOME_SHIFTED_SHARE * incomeMedian;
  const seriesOf = (f) => longCycles.map((m) => ({ month: m, value: f(m), incomeShifted: shifted(m) }));

  // Balances, from the records: liquid assets, card and overdraft headroom.
  const liquid = balanced.filter((b) => LIQUID.has(b.type) && !b.hidden);
  const liquidKnown = liquid.filter((b) => b.known);
  const liquidAssets = liquidKnown.length ? sum(liquidKnown.map((b) => Math.max(0, b.balance))) : null;
  const cardRows = balanced.filter((b) => b.type === 'Credit Card' && b.known);
  const cardsWithLimit = cardRows.filter((b) => b.creditLimit > 0);
  const cardAvailable = sum(cardsWithLimit.map((b) => Math.max(0, b.creditLimit - Math.max(0, -b.balance))));
  const overdrafts = balanced.filter((b) => b.type === 'Bank' && b.known && b.overdraftLimit > 0);
  const overdraftAvailable = sum(overdrafts.map((b) => Math.max(0, b.overdraftLimit + Math.min(0, b.balance))));
  const medianSpend = (W) => median(W.map(spend));

  const pooled = {
    savingsRate: (W) => ratio(sumOver(W, income) - sumOver(W, spend), sumOver(W, income)),
    debtServiceRatio: (W) => ratio(sumOver(W, debtService), sumOver(W, income)),
    interestBurden: (W) => ratio(sumOver(W, interestFees), sumOver(W, income)),
    liquidityRunway: (W) => (liquidAssets == null ? null : ratio(liquidAssets, medianSpend(W))),
    creditRunway: (W) =>
      liquidAssets == null && !cardsWithLimit.length && !overdrafts.length
        ? null
        : ratio((liquidAssets ?? 0) + cardAvailable + overdraftAvailable, medianSpend(W)),
    cardUtilisation: () =>
      cardsWithLimit.length
        ? ratio(sum(cardsWithLimit.map((b) => Math.abs(Math.min(0, b.balance)))), sum(cardsWithLimit.map((b) => b.creditLimit)))
        : null,
    deficitPerCycle: (W) => (W.length ? Math.max(0, -(sumOver(W, income) - sumOver(W, spend))) / W.length : null),
  };
  const perCycle = {
    savingsRate: (m) => ratio(income(m) - spend(m), income(m)),
    debtServiceRatio: (m) => ratio(debtService(m), income(m)),
    interestBurden: (m) => ratio(interestFees(m), income(m)),
    deficitPerCycle: (m) => Math.max(0, spend(m) - income(m)),
  };

  const incomePerCycle = longCycles.length ? sumOver(longCycles, income) / longCycles.length : 0;
  const deficitRed = DEFICIT_RED_SHARE * incomePerCycle;
  const shortV = (id) => pooled[id](shortCycles);
  const longV = (id) => pooled[id](longCycles);

  const vitals = {
    savingsRate: vital({
      short: shortV('savingsRate'),
      long: longV('savingsRate'),
      series: seriesOf(perCycle.savingsRate),
      thresholds: { amber: SAVINGS_RATE_GREEN, red: SAVINGS_RATE_AMBER },
      higherIsBetter: true,
      noise: VITALS_NOISE_PP,
    }),
    debtServiceRatio: vital({
      short: shortV('debtServiceRatio'),
      long: longV('debtServiceRatio'),
      series: seriesOf(perCycle.debtServiceRatio),
      thresholds: { amber: DSR_AMBER, red: DSR_RED },
      higherIsBetter: false,
      noise: VITALS_NOISE_PP,
      extras: {
        partial,
        components: {
          instalments: sumOver(shortCycles, (m) => instalments[m] ?? 0),
          cardCost: sumOver(shortCycles, cardCost),
          cardMinimum: sumOver(shortCycles, cardMinimum),
        },
      },
    }),
    interestBurden: vital({
      short: shortV('interestBurden'),
      long: longV('interestBurden'),
      series: seriesOf(perCycle.interestBurden),
      thresholds: { amber: BURDEN_AMBER, red: BURDEN_RED },
      higherIsBetter: false,
      noise: VITALS_NOISE_PP,
      extras: {
        components: {
          loans: costByType('Loan', shortCycles),
          cards: costByType('Credit Card', shortCycles),
          bank: costByType('Bank', shortCycles) + costByType('Savings', shortCycles) + costByType('Other', shortCycles),
        },
      },
    }),
    liquidityRunway: vital({
      short: shortV('liquidityRunway'),
      long: longV('liquidityRunway'),
      series: EMPTY_SERIES,
      thresholds: { amber: RUNWAY_GREEN, red: RUNWAY_AMBER },
      higherIsBetter: true,
      noise: RUNWAY_NOISE,
      extras: {
        liquidAssets,
        medianSpend: medianSpend(longCycles),
        knownCount: liquidKnown.length,
        totalCount: liquid.length,
      },
    }),
    creditRunway: vital({
      short: shortV('creditRunway'),
      long: longV('creditRunway'),
      series: EMPTY_SERIES,
      thresholds: { amber: CREDIT_RUNWAY_GREEN, red: CREDIT_RUNWAY_AMBER },
      higherIsBetter: true,
      noise: RUNWAY_NOISE,
      extras: { liquidAssets, cardAvailable, overdraftAvailable, medianSpend: medianSpend(longCycles) },
    }),
    cardUtilisation: vital({
      short: shortV('cardUtilisation'),
      long: longV('cardUtilisation'),
      series: EMPTY_SERIES,
      thresholds: { amber: UTIL_AMBER, red: UTIL_RED },
      higherIsBetter: false,
      noise: UTIL_NOISE,
      extras: {
        perCard: cardsWithLimit.map((b) => ({
          account: b.label ?? b.account,
          used: Math.abs(Math.min(0, b.balance)),
          available: Math.max(0, b.creditLimit - Math.abs(Math.min(0, b.balance))),
          limit: b.creditLimit,
        })),
      },
    }),
    deficitPerCycle: vital({
      short: shortV('deficitPerCycle'),
      long: longV('deficitPerCycle'),
      series: seriesOf(perCycle.deficitPerCycle),
      thresholds: { amber: 0, red: deficitRed },
      higherIsBetter: false,
      noise: Math.max(DIRECTION_NOISE_RAND, DIRECTION_NOISE_SHARE * incomePerCycle),
      extras: {
        fundedBy: balanced
          .filter((b) => b.isLiability && b.windowChange < 0)
          .map((b) => ({ account: b.label ?? b.account, windowChange: b.windowChange }))
          .sort((a, b) => a.windowChange - b.windowChange),
      },
    }),
  };
  // A deficit of exactly zero is green; anything up to the red share is amber.
  const deficit = vitals.deficitPerCycle;
  deficit.tone = deficit.value == null ? 'neutral' : deficit.value <= 0 ? 'good' : deficit.value < deficitRed ? 'warn' : 'bad';
  deficit.redDistance = deficit.tone === 'bad' ? deficit.value - deficitRed : 0;

  const worst = Object.entries(vitals)
    .filter(([, v]) => v.tone === 'bad')
    .sort((a, b) => b[1].redDistance - a[1].redDistance)
    .map(([id]) => id);

  const assumptions = [
    `Income excludes one-off inflows (${formatRand(exceptionIncome)} over the window).`,
    'Ratios are pooled over each window — sums over sums — not averaged cycle by cycle.',
  ];
  if (partial) {
    assumptions.push('Card minimums count only cards with a typed minimum payment and a balance; the rest count 0.');
  }
  if (liquid.length) {
    assumptions.push(`Liquidity counts Bank and Savings balances as entered (${liquidKnown.length} of ${liquid.length} known).`);
  } else {
    assumptions.push('No Bank or Savings balance has been entered, so the runway vitals are empty.');
  }

  return {
    window: { short: shortCycles, long: longCycles, complete: cycles.length },
    exceptionIncome,
    vitals,
    worst,
    assumptions,
  };
}

const DIRECTION_LABELS = {
  income: 'Income',
  spend: 'Spend',
  net: 'Net',
  instalments: 'Instalments',
  interestFees: 'Interest & fees',
  standingCharges: 'Standing charges',
  cardBalanceChange: 'Card balance change',
};
const HIGHER_IS_BETTER = new Set(['income', 'net', 'cardBalanceChange']);
const MEDIAN_METRICS = new Set(['income']);

/**
 * @param options.lines          RecurringLine[] (optional): standing charges are reported only when given
 * @param options.incomeProfile  buildIncomeProfile(...) (optional): a salary that missed a cycle in
 *                               the short window marks income and net as shifted
 * @returns {Direction} — shape at the foot of this file
 */
export function buildDirection(options) {
  const { data, accounts = null, transfers, calendar, lines = null, incomeProfile = null } = options ?? {};
  const empty = { metrics: [], summary: { netShort: null, netLong: null, netPrior: null, widening: false }, cycles: [], assumptions: [] };
  if (!data?.length || !calendar?.starts || !transfers) return empty;
  const cycles = completeMonths(calendar).slice(-MAX_DIRECTION_CYCLES);
  if (!cycles.length) return empty;
  const index = new Map(cycles.map((m, i) => [m, i]));
  const zeros = () => new Array(cycles.length).fill(0);
  const series = {
    income: zeros(),
    spend: zeros(),
    net: zeros(),
    instalments: zeros(),
    interestFees: zeros(),
    standingCharges: zeros(),
    cardBalanceChange: zeros(),
  };

  const loans = transfers.loanAccounts ?? loanAccountsOf(data, accounts);
  const ctx = { transfers, loanAccounts: loans };
  const cardNames = new Set(
    [...new Set(data.map((t) => t.Account))].filter((name) => accountTypeOf(name, accounts) === 'Credit Card'),
  );
  data.forEach((t) => {
    const i = index.get(t['Pay Month']);
    if (i == null) return;
    if (isIncomeRow(t, ctx)) series.income[i] += t.AmountNum;
    if (isSpendRow(t, ctx)) series.spend[i] += -t.AmountNum;
    if (
      t.AmountNum < 0 &&
      !loans.has(t.Account) &&
      (LOAN_CATEGORY_SET.has(t.Category) || transfers.loanInstalmentIds?.has(t.id))
    ) {
      series.instalments[i] += -t.AmountNum;
    }
    if (isCost(t)) series.interestFees[i] += -t.AmountNum;
    if (cardNames.has(t.Account)) series.cardBalanceChange[i] += t.AmountNum;
  });
  cycles.forEach((_, i) => {
    series.net[i] = series.income[i] - series.spend[i];
  });
  if (lines) {
    lines
      .filter((line) => line.status === 'active' && !line.tentative && line.kind !== 'instalment' && line.kind !== 'repayment')
      .forEach((line) => {
        (line.items ?? []).forEach((t) => {
          const i = index.get(t['Pay Month']);
          if (i != null) series.standingCharges[i] += Math.abs(t.AmountNum);
        });
      });
  }

  const shortCycles = cycles.slice(-VITALS_SHORT);
  const shortSet = new Set(shortCycles);
  const salaryShifted = (incomeProfile?.salary?.missingCycles ?? []).some((c) => shortSet.has(c));
  const stat = (id, values) => (MEDIAN_METRICS.has(id) ? median(values) : mean(values));
  const window = (values, from, to) => values.slice(from, to);

  const metrics = Object.keys(series)
    .filter((id) => id !== 'standingCharges' || lines)
    .map((id) => {
      const values = series[id];
      const n = values.length;
      const short = stat(id, window(values, -VITALS_SHORT));
      const long = stat(id, window(values, -VITALS_LONG));
      const priorValues = window(values, Math.max(0, n - 2 * VITALS_LONG), Math.max(0, n - VITALS_LONG));
      const prior = priorValues.length >= MIN_PRIOR_CYCLES ? stat(id, priorValues) : null;
      const delta = short - long;
      const deltaPct = long !== 0 ? delta / Math.abs(long) : null;
      const band = Math.max(DIRECTION_NOISE_SHARE * Math.abs(long), DIRECTION_NOISE_RAND);
      const higherIsBetter = HIGHER_IS_BETTER.has(id);
      const shifted = salaryShifted && (id === 'income' || id === 'net');
      let tone = 'neutral';
      if (!shifted && Math.abs(delta) > band) tone = (higherIsBetter ? delta > 0 : delta < 0) ? 'good' : 'bad';
      return {
        id,
        label: DIRECTION_LABELS[id],
        short,
        long,
        prior,
        delta,
        deltaPct,
        tone,
        series: values,
        note: shifted ? 'A salary landed outside its cycle in this window, so the short figure is not comparable.' : null,
      };
    });

  const net = metrics.find((m) => m.id === 'net');
  const summary = {
    netShort: net?.short ?? null,
    netLong: net?.long ?? null,
    netPrior: net?.prior ?? null,
    widening: net ? net.short - net.long < -DIRECTION_NOISE_RAND : false,
  };

  const assumptions = [
    'Income here includes one-off inflows but is summarised by the median, which a single windfall cannot move.',
    `Over ${cycles.length} complete cycles, with transfers classified across the whole file.`,
  ];
  if (salaryShifted) assumptions.push('A salary missed a cycle inside the last three, so income and net are marked shifted.');

  return { metrics, summary, cycles, assumptions };
}

/**
 * Vitals = {
 *   window: { short: string[], long: string[], complete: number }, exceptionIncome,
 *   vitals: {
 *     savingsRate:      { value, short, long, delta, direction, tone, series: [{ month, value, incomeShifted }], thresholds: { amber, red } },
 *     debtServiceRatio: { …, partial, components: { instalments, cardCost, cardMinimum } },
 *     interestBurden:   { …, components: { loans, cards, bank } },
 *     liquidityRunway:  { value|null, …, liquidAssets, medianSpend, knownCount, totalCount },
 *     creditRunway:     { value|null, …, liquidAssets, cardAvailable, overdraftAvailable, medianSpend },
 *     cardUtilisation:  { value|null, …, perCard: [{ account, used, available, limit }] },
 *     deficitPerCycle:  { value, short, long, delta, direction, tone, fundedBy: [{ account, windowChange }] },
 *   },
 *   worst: string[], assumptions: string[],
 * }
 * `value` is the short-window figure; `direction` is the short against the long, toward green.
 *
 * Direction = {
 *   metrics: [{ id, label, short, long, prior, delta, deltaPct, tone: 'good'|'bad'|'neutral', series: number[], note }],
 *   summary: { netShort, netLong, netPrior, widening }, cycles: string[], assumptions: string[],
 * }
 */
