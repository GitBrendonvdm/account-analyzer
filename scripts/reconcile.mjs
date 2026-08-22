/**
 * Reconciles the derived numbers against the hand-checked figures in the design (§9).
 *
 * Builds everything the way App.jsx does — the calendar, the full-file transfers, both processed
 * windows, the recurring lines, the liability terms, the plans, the vitals, the savings finders —
 * on the newest real export, and prints one table of aggregates beside the range each is expected
 * to fall in. PASS means inside the range; WARN means look. Nothing printed is a description, a
 * merchant or a person: the export is personal data and the table is meant to be pasted into a PR.
 *
 * `--time` reruns the chain five times and prints each builder's median milliseconds against the
 * §7 budget (≤ 150 ms in total). `--asof YYYY-MM-DD` moves "today" (default 2026-08-22, the date
 * the expected figures were read at).
 *
 * Run with:  npx vite-node scripts/reconcile.mjs [--time] [--asof 2026-08-22]
 * Requires a real export in the gitignored test-data/ directory.
 */
import { performance } from 'node:perf_hooks';
import { accountIdOf, buildAccountRecord } from '../src/db/accountIdentity.js';
import { buildAccountPositions } from '../src/lib/accountSeries.js';
import { buildBasket } from '../src/lib/basket.js';
import { buildCashToPayday } from '../src/lib/cashToPayday.js';
import { buildCostOfDebt } from '../src/lib/costOfDebt.js';
import { buildCycleCalendar } from '../src/lib/cycleCurve.js';
import { deriveCycleSummary } from '../src/lib/cycleSummary.js';
import { amortise, buildDebtBudget, comparePlans, marginalValue } from '../src/lib/debtPlan.js';
import { buildDrift } from '../src/lib/drift.js';
import { buildFeesAudit } from '../src/lib/fees.js';
import { buildFullTransfers } from '../src/lib/flows.js';
import { buildHabits } from '../src/lib/habits.js';
import { buildHeadlines } from '../src/lib/headlines.js';
import { buildIncomeProfile } from '../src/lib/incomeProfile.js';
import { buildLiabilityTerms, rateSteps, toDebt } from '../src/lib/inferRates.js';
import { applyBalances, cardHeadroom, summariseNetWorth } from '../src/lib/netWorth.js';
import { buildPriceCreep } from '../src/lib/priceCreep.js';
import { processTransactionData } from '../src/lib/processTransactionData.js';
import { buildRecurringLines } from '../src/lib/recurring.js';
import { buildSavingsFinder } from '../src/lib/savingsFinder.js';
import { buildSubscriptions } from '../src/lib/subscriptions.js';
import { buildUpcoming } from '../src/lib/upcoming.js';
import { buildDirection, buildVitals } from '../src/lib/vitals.js';
import { parseTransactionDate } from '../src/utils/date.js';
import { loadRealExport } from '../src/test/realData.js';

// ---- arguments ------------------------------------------------------------------------------------

const argv = process.argv.slice(2);
const TIME = argv.includes('--time');
const RUNS = 5;
const TOTAL_BUDGET_MS = 150;
const STRATEGIES = ['minimum', 'avalanche', 'snowball', 'lifetime', 'shortTerm'];
/** Lines the old missed-payments judge flagged every month; the recurring engine must not. */
const FALSE_FLAGS = ['vehicle loan', 'car loan', 'other phone & internet', 'bank charges'];

function parseAsOf(s) {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(s ?? '');
  if (!m) {
    console.error(`--asof wants YYYY-MM-DD, got "${s}".`);
    process.exit(2);
  }
  return new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
}
const asOfIndex = argv.indexOf('--asof');
const asOf = parseAsOf(asOfIndex >= 0 ? argv[asOfIndex + 1] : '2026-08-22');

// ---- data -----------------------------------------------------------------------------------------

const data = loadRealExport();
if (!data) {
  console.error('No CSV found in test-data/ — nothing to reconcile. Put the newest real export there and rerun.');
  process.exit(1);
}
data.forEach((t) => {
  t.DateObj = parseTransactionDate(t.Date);
});

const iso = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;

/** One record per account identity, every raw name it has carried folded in, newest name last. */
function buildAccounts(rows) {
  const latestByName = new Map();
  rows.forEach((t) => {
    if (!t.DateObj) return;
    const prev = latestByName.get(t.Account);
    if (!prev || t.DateObj > prev) latestByName.set(t.Account, t.DateObj);
  });
  const byId = new Map();
  [...latestByName.entries()]
    .sort((a, b) => a[1] - b[1])
    .forEach(([name, through]) => {
      const id = accountIdOf(name);
      if (!byId.has(id)) byId.set(id, { names: [], through });
      const entry = byId.get(id);
      entry.names.push(name);
      if (through > entry.through) entry.through = through;
    });
  return [...byId.values()].map((e) => buildAccountRecord(e.names, null, iso(e.through)));
}

// ---- the chain, in App.jsx's order ----------------------------------------------------------------

function buildAll(rows, today, tick = () => {}) {
  const step = (name, fn) => {
    const t0 = performance.now();
    const value = fn();
    tick(name, performance.now() - t0);
    return value;
  };
  const accounts = step('accounts', () => buildAccounts(rows));
  const allNames = accounts.flatMap((a) => a.seenNames ?? [a.rawName]);
  const accountsById = new Map(accounts.map((a) => [a.id, a]));
  const allMonths = [...new Set(rows.map((t) => t['Pay Month']))].sort();
  const availableMonthCount = allMonths.length;

  const calendar = step('calendar', () => buildCycleCalendar(rows, allMonths, today));
  const transfers = step('transfers', () => buildFullTransfers(rows, { accounts }));
  const processed = step('processed', () => processTransactionData(rows, allNames, 6, today));
  const processedLong = step('processedLong', () =>
    processTransactionData(rows, allNames, Math.min(13, Math.max(3, availableMonthCount)), today),
  );
  const summary = deriveCycleSummary(processed, today);
  const costOfDebt = step('costOfDebt', () => buildCostOfDebt(rows, allNames, processed.months));
  const costOfDebtLong = step('costOfDebtLong', () => buildCostOfDebt(rows, allNames, processedLong.months));
  const balanced = step('balances', () =>
    applyBalances(buildAccountPositions(rows, allNames, processed.months), accountsById, processed.months, { data: rows }),
  );
  const netWorth = summariseNetWorth(balanced, processed.months);
  const headroom = cardHeadroom(balanced);
  const dataThrough = processed.dataThrough ?? null;

  const recurring = step('lines', () => buildRecurringLines(rows, { accounts, calendar, transfers, asOf: today, dataThrough }));
  const lines = recurring.lines;
  const incomeProfile = step('incomeProfile', () =>
    buildIncomeProfile(rows, { accounts, calendar, transfers, asOf: today, dataThrough }),
  );
  const upcoming = step('upcoming', () =>
    buildUpcoming(lines, { calendar, asOf: today, dataThrough, incomeProfile, explained: recurring.explained, data: rows, transfers }),
  );

  const terms = step('terms', () => buildLiabilityTerms(rows, accounts, { asOf: today, primeRate: null, transfers }));
  const debts = terms.map(toDebt).filter(Boolean);
  const rateStepList = terms.flatMap((t) => rateSteps(t));
  const debtBudget = step('debtBudget', () => buildDebtBudget(processed, { monthlySaving: 0, cuts: 0, debts, balanced }));
  const planOptions = {
    currentMonth: processed.currentMonth,
    nextPayDate: processed.nextPayDate ?? null,
    inflows: debtBudget.inflows ?? {},
    extraPerMonth: debtBudget.extraSchedule ?? 0,
  };
  const plans = step('plans', () => (debts.length ? comparePlans(debts, { ...planOptions, strategy: 'avalanche' }) : null));
  const marginal = step('marginal', () => (debts.length ? marginalValue(debts, planOptions) : null));

  const vitals = step('vitals', () =>
    buildVitals({ processedLong, data: rows, accounts, balanced, costOfDebtLong, transfers, calendar, asOf: today }),
  );
  const direction = step('direction', () => buildDirection({ data: rows, accounts, transfers, calendar, lines, incomeProfile }));
  const cashPath = step('cashPath', () =>
    buildCashToPayday({
      data: rows,
      accounts,
      calendar,
      transfers,
      lines,
      explained: recurring.explained,
      upcoming,
      incomeProfile,
      asOf: today,
      dataThrough,
      buffer: 0,
    }),
  );

  const subscriptions = step('subscriptions', () => buildSubscriptions(lines, { calendar, dataThrough, asOf: today, lineOverrides: {} }));
  const priceCreep = step('priceCreep', () => buildPriceCreep(lines));
  const drift = step('drift', () => buildDrift(rows, { transfers, calendar, accounts, selectedAccounts: allNames }));
  const basket = step('basket', () => buildBasket(rows, { transfers, calendar, accounts, selectedAccounts: allNames }));
  const fees = step('fees', () => buildFeesAudit(rows, accounts, { transfers, calendar, lines }));
  const finder = step('finder', () => buildSavingsFinder({ subscriptions, priceCreep, drift, fees, basket, debtBudget, processed }));
  const habits = step('habits', () => buildHabits(rows, allNames, processed, { transfers }));
  const headlines = step('headlines', () =>
    buildHeadlines({
      summary,
      processed,
      positions: balanced,
      netWorth,
      costOfDebt,
      headroom,
      habits,
      vitals,
      direction,
      plans,
      debtBudget,
      rateSteps: rateStepList,
      upcoming,
      subscriptions,
      finder,
      drift,
    }),
  );

  return {
    accounts,
    calendar,
    transfers,
    processed,
    processedLong,
    costOfDebt,
    balanced,
    lines,
    upcoming,
    terms,
    debts,
    rateSteps: rateStepList,
    debtBudget,
    plans,
    marginal,
    vitals,
    direction,
    cashPath,
    subscriptions,
    priceCreep,
    drift,
    basket,
    fees,
    finder,
    habits,
    headlines,
  };
}

// ---- the table ------------------------------------------------------------------------------------

const rows = [];
let section = '';
const row = (label, value, expected, ok) => rows.push({ section, label, value: String(value), expected, ok });
const within = (x, lo, hi) => Number.isFinite(x) && x >= lo && x <= hi;
const near = (x, target, tolerance) => Number.isFinite(x) && Math.abs(x - target) <= tolerance;
/** "101 268.25": thousands spaced, a point for the decimals — the locale formatter would swap them. */
function num(x, digits = 2) {
  if (x == null || Number.isNaN(x)) return '—';
  if (!Number.isFinite(x)) return '∞';
  const [whole, fraction] = Math.abs(x).toFixed(digits).split('.');
  const grouped = whole.replace(/\B(?=(\d{3})+(?!\d))/g, ' ');
  return `${x < 0 ? '−' : ''}${grouped}${fraction ? `.${fraction}` : ''}`;
}
const pct = (x) => (Number.isFinite(x) ? `${(x * 100).toFixed(2)}%` : '—');
const ratio = (x) => (Number.isFinite(x) ? x.toFixed(3) : '—');
const yearOf = (d) => (d instanceof Date && !Number.isNaN(d.getTime()) ? d.getFullYear() : null);

function printTable() {
  const width = (key, cap = Infinity) => Math.min(cap, Math.max(...rows.map((r) => String(r[key]).length)));
  const wLabel = width('label');
  // A long value (the headline ids) overflows its column rather than widening every row.
  const wValue = width('value', 24);
  const wExpected = width('expected');
  let current = null;
  rows.forEach((r) => {
    if (r.section !== current) {
      current = r.section;
      console.log(`\n${current}`);
      console.log('-'.repeat(current.length));
    }
    const mark = r.ok == null ? 'INFO' : r.ok ? 'PASS' : 'WARN';
    console.log(`  ${r.label.padEnd(wLabel)}  ${r.value.padStart(wValue)}  ${r.expected.padEnd(wExpected)}  ${mark}`);
  });
  const passed = rows.filter((r) => r.ok === true).length;
  const warned = rows.filter((r) => r.ok === false).length;
  console.log(`\n${passed} PASS, ${warned} WARN, ${rows.length - passed - warned} INFO`);
}

// ---- 1. amortisation hand-checks ------------------------------------------------------------------

section = 'Amortisation hand-checks';
{
  const a = amortise({ balance: 10000, rateNominal: 0.12, instalment: 1000 });
  row('10 000 @ 12% / 1 000 a month: months to clear', a.months, '11', a.months === 11);
  row('  total interest', num(a.totalInterest), '589.85', near(a.totalInterest, 589.85, 0.01));
  const b = amortise({ balance: 10000, rateNominal: 0.12, instalment: 1000, feeMonthly: 69 });
  row('  with a 69 fee: months to clear', b.months, '12', b.months === 12);
  row('  total fees', num(b.totalFees), '828.00', near(b.totalFees, 828, 0.01));
  const c = amortise({ balance: 100000, rateNominal: 0.12, instalment: 900 }, { months: 12 });
  const close12 = c.schedule[11]?.close;
  row('100 000 @ 12% / 900 a month: never clears', c.neverClears, 'true', c.neverClears === true);
  row('  balance after 12 months', num(close12), '101 268.25', near(close12, 101268.25, 0.01));
}

// ---- 2. the real export -----------------------------------------------------------------------------

const built = buildAll(data, asOf);
const { terms, debts, plans, costOfDebt, fees, vitals, direction, lines, upcoming, priceCreep, finder, headlines } = built;

section = `Input (as of ${iso(asOf)})`;
row('rows', data.length, '—', null);
row('accounts', built.accounts.length, '—', null);
row('pay cycles in the file', built.processedLong.months.length, '—', null);
row('data through', built.processed.dataThrough ? iso(new Date(built.processed.dataThrough)) : '—', '—', null);

section = 'Liability terms (4 loans; no typed balances)';
const loans = terms.filter((t) => t.type === 'Loan');
row('loan accounts', loans.length, '4', loans.length === 4);
const EXPECTED_BONDS = [
  { instalment: 22854.88, remaining: [300, 420], note: '358 (hypersensitive: 300–420)' },
  { instalment: 6674.53, remaining: [150, 180], note: '≈ 166' },
];
const bonds = loans.filter((t) => t.kind === 'bond');
const claimedBonds = new Set();
const loanRows = (label, t, e) => {
  row(`${label}: rate`, pct(t.rateNominal), `${pct(e.rate[0])}–${pct(e.rate[1])} (${e.variable ? 'variable' : 'fixed'}, ${t.rateSource})`, within(t.rateNominal, e.rate[0], e.rate[1]));
  row(`${label}: variable`, t.rateVariable, String(e.variable), t.rateVariable === e.variable);
  if (e.r2 != null) row(`${label}: regression R²`, ratio(t.regression?.r2), `≥ ${e.r2}`, (t.regression?.r2 ?? 0) >= e.r2);
  else row(`${label}: regression R²`, ratio(t.regression?.r2), '—', null);
  row(`${label}: instalment`, num(t.instalment), num(e.instalment), near(t.instalment, e.instalment, 0.01));
  row(`${label}: fee a month`, num(t.feeMonthly), e.fee == null ? '—' : num(e.fee), e.fee == null ? null : near(t.feeMonthly, e.fee, 0.01));
  row(`${label}: remaining months`, num(t.remainingMonths, 1), e.note, within(t.remainingMonths, e.remaining[0], e.remaining[1]));
  row(`${label}: confidence`, t.confidence, '—', null);
};
bonds.forEach((t, i) => {
  const expected = EXPECTED_BONDS.filter((_, k) => !claimedBonds.has(k))
    .map((e, k) => ({ e, k: EXPECTED_BONDS.indexOf(e), gap: Math.abs((t.instalment ?? 0) - e.instalment) }))
    .sort((a, b) => a.gap - b.gap)[0];
  if (expected) claimedBonds.add(expected.k);
  const e = expected?.e ?? EXPECTED_BONDS[0];
  loanRows(`bond ${i + 1}`, t, { rate: [0.093, 0.096], variable: true, instalment: e.instalment, fee: 69, remaining: e.remaining, note: e.note });
});
const vehicle = loans.find((t) => t.kind === 'vehicle');
if (vehicle) loanRows('vehicle', vehicle, { rate: [0.093, 0.097], variable: vehicle.rateVariable, r2: 0.99, instalment: 4990.67, fee: null, remaining: [14, 18], note: '≈ 16' });
else row('vehicle loan', 'missing', 'present', false);
const personal = loans.find((t) => t.kind === 'personal');
if (personal) loanRows('personal', personal, { rate: [0.17, 0.174], variable: false, instalment: 5139.85, fee: 676.04, remaining: [50, 56], note: '50–56' });
else row('personal loan', 'missing', 'present', false);
loans
  .filter((t) => t !== vehicle && t !== personal && t.kind !== 'bond')
  .forEach((t, i) => row(`other loan ${i + 1}: kind`, t.kind, 'bond / vehicle / personal', false));
row('rate steps across all liabilities', built.rateSteps.length, '≥ 1 (the 2026 move on the bonds)', built.rateSteps.length >= 1);

section = 'Debt-free sanity (comparePlans on the inferred debts)';
if (!plans) {
  row('plans', 'none', 'five strategies', false);
} else {
  const minimum = plans.minimum;
  const year = yearOf(minimum.debtFreeDate);
  row('debts in the plan / excluded', `${minimum.order.length} / ${minimum.excluded.length}`, '4 loans in; cards out until balances are typed', null);
  row('minimum: debt-free year', year ?? (minimum.reachedCap ? 'cap' : '—'), '2055–2056', within(year, 2055, 2056));
  row('minimum: months', minimum.months, '—', null);
  STRATEGIES.filter((s) => s !== 'minimum').forEach((s) => {
    const plan = plans[s];
    row(`${s}: months (vs minimum ${minimum.months})`, plan.months, 'earlier than minimum', !plan.reachedCap && plan.months < minimum.months);
  });
  plans.table.forEach((r) => {
    row(`${r.strategy}: interest saved vs minimum`, num(r.interestSavedVsMinimum, 0), '≥ 0', r.interestSavedVsMinimum >= -0.005);
  });
  if (vehicle) {
    STRATEGIES.forEach((s) => {
      const cleared = plans[s]?.perDebt?.[vehicle.accountId]?.clearedMonth ?? null;
      row(`${s}: vehicle clears in (months)`, cleared ?? '—', '14–18 (≈ late 2027)', within(cleared, 14, 18));
    });
  }
  const cards = terms.filter((t) => t.type === 'Credit Card');
  const inPlan = new Set(minimum.order);
  const excluded = new Set(minimum.excluded.map((e) => e.id));
  const counts = {
    inPlan: cards.filter((c) => inPlan.has(c.accountId)).length,
    excluded: cards.filter((c) => excluded.has(c.accountId)).length,
    noBalance: cards.filter((c) => !Number.isFinite(c.balanceOwed)).length,
  };
  row(
    'cards: in the plan / excluded / without a balance',
    `${counts.inPlan} / ${counts.excluded} / ${counts.noBalance} of ${cards.length}`,
    'none in the plan until balances are typed',
    counts.inPlan === 0,
  );
  row('debts handed to the engine (toDebt)', debts.length, '—', null);
}

section = 'Cost of debt and fees (all accounts)';
row('cost of debt per cycle (6-cycle window)', num(costOfDebt?.perCycle, 0), '28 000–35 000', within(costOfDebt?.perCycle, 28000, 35000));
row('cost of debt per year', num(costOfDebt?.perYear, 0), '—', null);
row('fees.cardInterest.perYear (last 12 complete cycles)', num(fees?.cardInterest?.perYear, 0), '15 000–30 000', within(fees?.cardInterest?.perYear, 15000, 30000));
row('fees.cardInterest: cycles with interest of the last 6', fees?.cardInterest?.cyclesWithInterest ?? '—', '—', null);
row('fees.avoidablePerYear', num(fees?.avoidablePerYear, 0), '< 1 000', Number.isFinite(fees?.avoidablePerYear) && fees.avoidablePerYear < 1000);
row('fees.accountFeesPerYear', num(fees?.accountFeesPerYear, 0), '—', null);

section = 'Vitals (last 3 complete cycles, pooled) and direction';
const v = vitals?.vitals ?? {};
row('vitals window (short / long / complete)', vitals ? `${vitals.window.short.length} / ${vitals.window.long.length} / ${vitals.window.complete}` : '—', '3 / 12 / ≥ 12', vitals?.window?.short?.length === 3 && vitals?.window?.long?.length === 12);
row('debt service ratio', ratio(v.debtServiceRatio?.value), '0.40–0.52', within(v.debtServiceRatio?.value, 0.4, 0.52));
row('debt service ratio: tone', v.debtServiceRatio?.tone ?? '—', 'bad (red)', v.debtServiceRatio?.tone === 'bad');
row('interest burden', ratio(v.interestBurden?.value), '0.30–0.42', within(v.interestBurden?.value, 0.3, 0.42));
row('savings rate', ratio(v.savingsRate?.value), '−0.35 to −0.10', within(v.savingsRate?.value, -0.35, -0.1));
row('deficit per cycle (short window)', num(v.deficitPerCycle?.value, 0), '—', null);
row('direction: widening', direction?.summary?.widening ?? '—', 'true', direction?.summary?.widening === true);
row(
  'direction: net last 3 vs last 12',
  `${num(direction?.summary?.netShort, 0)} vs ${num(direction?.summary?.netLong, 0)}`,
  'last 3 more negative',
  Number.isFinite(direction?.summary?.netShort) && direction.summary.netShort < direction.summary.netLong,
);

section = 'Recurring engine';
const monthlyHigh = lines.filter((l) => l.cadence === 'monthly' && l.level === 'high');
row('monthly lines at level high (active)', `${monthlyHigh.length} (${monthlyHigh.filter((l) => l.status === 'active').length})`, '≥ 12', monthlyHigh.length >= 12);
const instalmentLines = lines.filter((l) => l.kind === 'instalment');
row('instalment lines', instalmentLines.length, '4', instalmentLines.length === 4);
row(
  '  distinct loan accounts / active / tentative',
  `${new Set(instalmentLines.map((l) => l.loanAccountId ?? l.accountId)).size} / ${instalmentLines.filter((l) => l.status === 'active').length} / ${instalmentLines.filter((l) => l.tentative).length}`,
  '4 loan accounts',
  null,
);
row('lines in total / active', `${lines.length} / ${lines.filter((l) => l.status === 'active').length}`, '—', null);
const steep = (priceCreep?.rising ?? []).filter((r) => r.totalPct >= 0.9 && r.steps.length >= 3);
row('rising lines with totalPct ≥ 0.9 and ≥ 3 steps (the ISP)', steep.length, '≥ 1', steep.length >= 1);
if (steep[0]) row('  steepest: totalPct / steps', `${pct(steep[0].totalPct)} / ${steep[0].steps.length}`, '—', null);
const accountStep = (fees?.steps ?? []).find((s) => s.feeKind === 'account' && s.cycle === '2026-07');
row('account-fee step in cycle 2026-07', accountStep ? `${num(accountStep.from)} → ${num(accountStep.to)}` : 'none', 'present', Boolean(accountStep));
const vehicleLine =
  (vehicle && instalmentLines.find((l) => l.loanAccountId === vehicle.accountId)) ??
  instalmentLines.find((l) => near(l.amount, 4990.67, 1));
const vehicleSteps = vehicleLine
  ? [...(priceCreep?.rising ?? []), ...(priceCreep?.falling ?? [])].find((r) => r.lineId === vehicleLine.id)?.steps.length ?? 0
  : null;
row('vehicle instalment line: price steps', vehicleLine ? vehicleSteps : 'line missing', '0', vehicleSteps === 0);
const overdueFlags = (upcoming?.overdue ?? []).filter((l) => FALSE_FLAGS.some((f) => (l.label ?? '').toLowerCase().includes(f))).length;
row('upcoming.overdue: lines / false flags among them', `${upcoming?.overdue?.length ?? 0} / ${overdueFlags}`, '0 false flags', overdueFlags === 0);
row('upcoming: landed / not yet in the data', `${upcoming?.landed?.length ?? 0} / ${upcoming?.unobservable?.length ?? 0}`, '—', null);
row('upcoming: coverage of last cycle’s spend', upcoming?.coverage ? pct(upcoming.coverage.share) : '—', '—', null);

section = 'Savings finder';
row('found per cycle', num(finder?.found, 0), '2 000–5 000', within(finder?.found, 2000, 5000));
row('cover of the gap', finder?.cover == null ? '—' : pct(finder.cover), '—', null);
row('behavioural potential per cycle (reported separately)', num(finder?.behaviouralPotential, 0), '—', null);
const cardInterestInItems = (finder?.items ?? []).some((it) => it.kind === 'card-interest' || (it.kinds ?? []).includes('card-interest'));
row('card interest only in informational', `${finder?.informational?.length ?? 0} informational, in items: ${cardInterestInItems}`, 'in items: false', !cardInterestInItems);
row('realised per cycle', num(finder?.realised, 0), '—', null);

section = 'Headlines';
row('headlines (ids, ranked)', headlines.map((h) => h.id).join(', ') || 'none', 'stale first when stale; ≤ 5', headlines.length <= 5);
row('cash path built', built.cashPath ? 'yes' : 'no', 'yes', Boolean(built.cashPath));

printTable();

// ---- 3. timing ---------------------------------------------------------------------------------------

if (TIME) {
  const samples = new Map();
  for (let run = 0; run < RUNS; run += 1) {
    buildAll(data, asOf, (name, ms) => {
      if (!samples.has(name)) samples.set(name, []);
      samples.get(name).push(ms);
    });
  }
  const median = (xs) => {
    const s = [...xs].sort((a, b) => a - b);
    const mid = Math.floor(s.length / 2);
    return s.length % 2 ? s[mid] : (s[mid - 1] + s[mid]) / 2;
  };
  const ms = Object.fromEntries([...samples.entries()].map(([name, xs]) => [name, median(xs)]));
  const BUDGET = [
    { label: 'processed', steps: ['processed'], budget: 16 },
    { label: 'processedLong', steps: ['processedLong'], budget: 27 },
    { label: 'transfers', steps: ['transfers'], budget: 6 },
    { label: 'calendar', steps: ['calendar'], budget: 2 },
    { label: 'lines', steps: ['lines'], budget: 30 },
    { label: 'vitals/direction', steps: ['vitals', 'direction'], budget: 10 },
    { label: 'upcoming/cash', steps: ['incomeProfile', 'upcoming', 'cashPath'], budget: 15 },
    { label: 'terms/plans', steps: ['terms', 'debtBudget', 'plans', 'marginal'], budget: 10 },
    { label: 'savings', steps: ['subscriptions', 'priceCreep', 'drift', 'basket', 'fees', 'finder'], budget: 20 },
    { label: 'habits', steps: ['habits'], budget: 5 },
    { label: 'other', steps: ['accounts', 'costOfDebt', 'costOfDebtLong', 'balances', 'headlines'], budget: null },
  ];
  console.log(`\nTiming (median of ${RUNS} runs, ms)`);
  console.log('----------------------------------');
  let total = 0;
  BUDGET.forEach((group) => {
    const groupMs = group.steps.reduce((s, name) => s + (ms[name] ?? 0), 0);
    total += groupMs;
    const mark = group.budget == null ? 'INFO' : groupMs <= group.budget ? 'PASS' : 'WARN';
    const parts = group.steps.length > 1 ? `  (${group.steps.map((name) => `${name} ${(ms[name] ?? 0).toFixed(1)}`).join(', ')})` : '';
    console.log(`  ${group.label.padEnd(18)} ${groupMs.toFixed(1).padStart(7)}  budget ${group.budget == null ? '   —' : String(group.budget).padStart(4)}  ${mark}${parts}`);
  });
  console.log(`  ${'total'.padEnd(18)} ${total.toFixed(1).padStart(7)}  budget ${String(TOTAL_BUDGET_MS).padStart(4)}  ${total <= TOTAL_BUDGET_MS ? 'PASS' : 'WARN'}`);
}
