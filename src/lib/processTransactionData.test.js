import { describe, expect, it } from 'vitest';
import { processTransactionData } from './processTransactionData';
import { groupTransactionsByDescription } from './groupTransactions';
import { buildExceptionClusters } from './exceptions';
import { buildDescriptionClusters } from './descriptionClustering';
import { enrichWithEffectivePayMonths, getPayMonth } from './effectivePayMonth';
import { parseAccount } from './accounts';
import {
  EXCEPTION_MONTH_RATIO,
  INCOME_EXCEPTION_MONTH_RATIO,
  OUTLIER_MIN_AMOUNT,
  OUTLIER_MULTIPLIER,
  UNCATEGORIZED_CATEGORY_LABELS,
} from '../constants';
import { loadRealExport } from '../test/realData';

const real = loadRealExport();
const iso = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;

/**
 * The last date the export actually reaches. Derived, not hard-coded: exports are refreshed
 * regularly and each one ends on a different day, so asserting a literal date here made the suite
 * fail every time the fixture was updated — punishing exactly the habit the app depends on.
 */
const lastDate = (rows) => rows.map((t) => t.Date).sort().at(-1);

describe.skipIf(!real)('processTransactionData against the real export', () => {
  const accounts = [...new Set(real?.map((t) => t.Account) ?? [])];
  const asOf = new Date(2026, 7, 6); // Thu 6 Aug 2026
  const processed = processTransactionData(real, accounts, 6, asOf);

  it('anchors the current cycle on the pay-month boundary', () => {
    expect(processed.currentMonth).toBe('2026-08');
    expect(iso(processed.currentCycleStart)).toBe('2026-07-23');
    expect(iso(processed.currentCycleEnd)).toBe('2026-08-22');
    expect(iso(processed.nextPayDate)).toBe('2026-08-23');
    expect(processed.cycleLength).toBe(31);
    expect(processed.cycleDay).toBe(15);
    expect(processed.daysToPayday).toBe(16);
    expect(processed.isProjectedCycleEnd).toBe(true);
    // Clamped to the as-of date: the export may reach further than the moment being simulated.
    expect(iso(processed.dataThrough) <= lastDate(real)).toBe(true);
    expect(iso(processed.dataThrough) <= '2026-08-06').toBe(true);
  });

  it('surfaces only weeks that fall inside the pay cycle', () => {
    const labels = processed.cycleWeeks.map((w) => w.label);
    // The old payday rule (25th rolled forward to Monday) produced a trailing "24 Aug" column
    // covering 24-30 Aug — entirely outside the 23 Jul - 22 Aug pay month.
    expect(labels).toEqual(['03 Aug', '10 Aug', '17 Aug']);
    expect(labels).not.toContain('24 Aug');
  });

  it('marks the week containing today as current', () => {
    const current = processed.cycleWeeks.filter((w) => w.isCurrent);
    expect(current).toHaveLength(1);
    expect(current[0].label).toBe('03 Aug');
  });

  it('keeps each row\'s Remaining equal to the sum of its weekly split', () => {
    processed.rows.forEach((row) => {
      const summed = (row.weeklyRemaining ?? []).reduce((s, x) => s + x, 0);
      expect(summed).toBeCloseTo(row.expected ?? 0, 6);
      (row.sub ?? []).forEach((sub) => {
        const subSummed = (sub.weeklyRemaining ?? []).reduce((s, x) => s + x, 0);
        expect(subSummed).toBeCloseTo(sub.expected ?? 0, 6);
      });
    });
  });

  it('nests categories under the export\'s Spending Group column', () => {
    const expense = processed.rows.find((r) => r.name === 'Expense');
    expect(expense.sub.every((s) => s.isSpendingGroup)).toBe(true);
    expect(expense.sub.map((s) => s.name)).toContain('Day-to-day');
    // The whole point: far fewer rows at the top than the ~24 bare categories it replaced.
    expect(expense.sub.length).toBeLessThan(12);

    // A spending group is purely the sum of its categories — it runs no model of its own.
    expense.sub.forEach((sg) => {
      expect(sg.sub.length).toBeGreaterThan(0);
      const childSum = sg.sub.reduce((s, c) => s + c.expected, 0);
      expect(childSum).toBeCloseTo(sg.expected, 6);
    });

    // Transfers and Exceptions stay flat rather than gaining a level of one-child groups.
    processed.rows
      .filter((r) => r.isTransfer || r.isException)
      .forEach((r) => expect(r.sub.every((s) => !s.isSpendingGroup)).toBe(true));
  });

  it('charges loan instalments as spend, so switching loan accounts off changes nothing', () => {
    const noLoans = accounts.filter((a) => !/\bLoan\b/i.test(a));
    expect(noLoans.length).toBeLessThan(accounts.length);
    const without = processTransactionData(real, noLoans, 6, asOf);

    // The instalment is charged to the account it left, and a loan account holds nothing else that
    // counts — so the flows are identical with the loan chips on or off. This was the whole bug:
    // dropping the loan accounts previously removed ~R30k/cycle of cost from the table.
    expect(without.totalsByMonth.Expense).toEqual(processed.totalsByMonth.Expense);
    expect(without.totalsByMonth.Income).toEqual(processed.totalsByMonth.Income);

    // ...and the instalment is counted once, as an expense, not as an internal movement.
    const loanAccounts = accounts.filter((a) => /\bLoan\b/i.test(a));
    const cents = (n) => Math.round(Math.abs(n) * 100);
    const credited = new Set(
      real
        .filter((t) => loanAccounts.includes(t.Account) && t.AmountNum > 0)
        .map((t) => `${t['Pay Month']}|${cents(t.AmountNum)}`),
    );
    const instalments = real.filter(
      (t) =>
        !loanAccounts.includes(t.Account) &&
        t.AmountNum < 0 &&
        processed.months.includes(t['Pay Month']) &&
        credited.has(`${t['Pay Month']}|${cents(t.AmountNum)}`),
    );
    expect(instalments.length).toBeGreaterThan(0);
    expect(instalments.filter((t) => processed.transferIds.has(t.id))).toEqual([]);

    // Nothing inside a loan account reaches a flow — the interest and fees are already inside the
    // instalment, and counting both would bill the same money twice.
    const loanRows = processed.rows.flatMap((g) =>
      (g.sub ?? []).flatMap((s) => (s.isSpendingGroup ? (s.sub ?? []) : [s])),
    );
    expect(
      loanRows.flatMap((c) => (c.items ?? []).filter((t) => loanAccounts.includes(t.Account))),
    ).toEqual([]);
  });

  it('keeps the export Transfer label only where the row is a movement', () => {
    const labelled = real.filter(
      (t) => (t['Spending Group'] ?? '').trim() === 'Transfer' && processed.months.includes(t['Pay Month']),
    );
    expect(labelled.length).toBeGreaterThan(0);

    // Pair-matching alone left labelled rows behind — including a R30 561 credit-card repayment
    // that surfaced as Income Exceptions — because their other leg never matched. Those still get
    // the label from their category.
    const movements = labelled.filter((t) => /transfer|repayment/i.test(t.Category ?? ''));
    expect(movements.length).toBeGreaterThan(0);
    expect(movements.filter((t) => !processed.transferIds.has(t.id))).toEqual([]);

    // But a labelled row whose category is real spending stays spending — the label is wrong on
    // groceries, and honouring it deleted them from Expense.
    const groceries = labelled.filter(
      (t) => t.Category === 'Groceries' && !processed.transferIds.has(t.id),
    );
    expect(groceries.length).toBeGreaterThan(0);

    // ...and no spending group named Transfer is left sitting inside a flow.
    processed.rows
      .filter((r) => !r.isTransfer)
      .forEach((r) => expect(r.sub.map((s) => s.name)).not.toContain('Transfer'));
  });

  it('falls back to flat categories when the export has no Spending Group column', () => {
    const stripped = real.map((t) => {
      const copy = { ...t };
      delete copy['Spending Group'];
      return copy;
    });
    const flat = processTransactionData(stripped, accounts, 6, asOf);
    const expense = flat.rows.find((r) => r.name === 'Expense');
    expect(expense.sub.some((s) => s.isSpendingGroup)).toBe(false);
    expect(expense.sub.length).toBeGreaterThan(12);
  });

  it('splits a category forecast across its description rows without losing any', () => {
    // These rows used to run an entirely different estimate, so they never summed to their parent.
    const expense = processed.rows.find((r) => r.name === 'Expense');
    const withForecast = expense.sub
      .flatMap((sg) => sg.sub ?? [sg])
      .filter((s) => Math.abs(s.expected) > 1);
    expect(withForecast.length).toBeGreaterThan(3);

    withForecast.forEach((sub) => {
      const rows = groupTransactionsByDescription(sub.items, processed.months, false, sub);
      const summed = rows.reduce((s, r) => s + r.expected, 0);
      expect(summed).toBeCloseTo(sub.expected, 6);

      processed.cycleWeeks.forEach(({ index }) => {
        const weekSum = rows.reduce((s, r) => s + (r.weeklyRemaining?.[index] ?? 0), 0);
        expect(weekSum).toBeCloseTo(sub.weeklyRemaining[index], 6);
      });
    });
  });

  it('scopes every total AND every average to the selected accounts', () => {
    // Previously only the sub-row month cells were filtered: group rows, the Net Total and all
    // averages were computed over every account regardless of the chips.
    const subset = accounts.filter((a) => a.startsWith('FNB'));
    const few = processTransactionData(real, subset, 6, asOf);
    const all = processed.rows.find((r) => r.name === 'Expense');
    const some = few.rows.find((r) => r.name === 'Expense');

    expect(Math.abs(some.totalsByMonth['2026-07'])).toBeLessThan(
      Math.abs(all.totalsByMonth['2026-07']),
    );
    expect(Math.abs(some.avg)).toBeLessThan(Math.abs(all.avg));
    expect(Math.abs(few.expenseAvg)).toBeLessThan(Math.abs(processed.expenseAvg));
    expect(Math.abs(some.expected)).toBeLessThan(Math.abs(all.expected));
  });

  it('scopes the average to the month-range slider', () => {
    // expected.js claimed the selector controlled the window; it never did, because every average
    // read calcMonths (the whole file) rather than the visible slice.
    const wide = processTransactionData(real, accounts, 12, asOf);
    expect(wide.months).toHaveLength(12);
    expect(processed.months).toHaveLength(6);
    expect(wide.expenseAvg).not.toBeCloseTo(processed.expenseAvg, 2);
  });

  it('keeps every group Remaining equal to the sum of its subcategories', () => {
    processed.rows
      .filter((r) => !r.isException && !r.isTransfer)
      .forEach((row) => {
        const childSum = (row.sub ?? []).reduce((s, x) => s + (x.expected ?? 0), 0);
        expect(childSum).toBeCloseTo(row.expected ?? 0, 6);
      });
  });

  it('exposes the calendar, the cycle lengths and the loan-instalment legs', () => {
    expect(processed.calendar.starts['2026-08']).toBeInstanceOf(Date);
    expect(processed.calendar.boundaryDom).toBe(23);
    expect(processed.cycleLengths['2026-08']).toBe(31);
    expect(processed.cycleLengths).toBe(processed.calendar.lengths);
    expect(processed.loanInstalmentIds.size).toBeGreaterThan(0);
    // The paying legs are spend, never transfers.
    [...processed.loanInstalmentIds].forEach((id) => expect(processed.transferIds.has(id)).toBe(false));
  });

  it('gives every category row its cadence verdict and weekly averages', () => {
    const categories = processed.rows
      .filter((r) => !r.isTransfer && !r.isException)
      .flatMap((g) => g.sub.flatMap((s) => (s.isSpendingGroup ? s.sub : [s])));
    expect(categories.length).toBeGreaterThan(10);
    categories.forEach((c) => {
      expect(typeof c.discrete).toBe('boolean');
      expect(c.weeklyAvg).toHaveLength(c.weeklyRemaining.length);
      expect(typeof c.nextCycleAvg).toBe('number');
    });
    expect(categories.some((c) => c.discrete)).toBe(true);
    expect(categories.some((c) => !c.discrete)).toBe(true);
  });

  it('describes the next cycle: 23 Aug – 22 Sep 2026, 31 days, with its expected flows', () => {
    expect(iso(processed.nextCycle.start)).toBe('2026-08-23');
    expect(iso(processed.nextCycle.end)).toBe('2026-09-22');
    expect(processed.nextCycle.length).toBe(31);
    expect(processed.nextCycle.dayRanges[0].lo).toBe(1);
    expect(processed.nextCycle.dayRanges.at(-1).hi).toBe(31);
    expect(processed.nextCycleExpected.expense).toBeLessThan(0);
    expect(processed.nextCycleExpected.income).toBeGreaterThan(0);
    expect(processed.nextCycleExpected.net).toBeCloseTo(
      processed.nextCycleExpected.income + processed.nextCycleExpected.expense,
      6,
    );
  });
});

/* ---- reference: the exception rules as they stood before the one-pass precompute (§3.3.7) ----
 * Kept verbatim so the precomputed profile can be checked against them on the real export. */
const refCategoryName = (t) => t.Category || 'Uncategorized';
function refIsUncategorized(t) {
  const raw = t.Category;
  if (!raw || raw.trim() === '') return true;
  return UNCATEGORIZED_CATEGORY_LABELS.some((label) => label.toLowerCase() === raw.trim().toLowerCase());
}
function refMedian(values) {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 1 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}
function refActiveMonths(items, category) {
  const months = new Set();
  items.forEach((t) => {
    if (refCategoryName(t) === category) months.add(getPayMonth(t));
  });
  return months;
}
function refIsSparse(items, category, visibleMonths, monthRatio) {
  const currentMonth = visibleMonths[visibleMonths.length - 1];
  const monthSet = refActiveMonths(items, category);
  const activeCount = monthSet.size;
  if (activeCount === 0) return false;
  const ratio = activeCount / visibleMonths.length;
  const onlyInCurrentMonth = activeCount === 1 && monthSet.has(currentMonth);
  return onlyInCurrentMonth || ratio < monthRatio;
}
function refMonthlyTotals(items, category, months) {
  const totals = Object.fromEntries(months.map((m) => [m, 0]));
  items.forEach((t) => {
    const m = getPayMonth(t);
    if (refCategoryName(t) !== category || !months.includes(m)) return;
    totals[m] += Math.abs(t.AmountNum);
  });
  return totals;
}
function refIsOutlier(t, items, category, months) {
  const priorMonths = months.slice(0, -1);
  const monthlyTotals = refMonthlyTotals(items, category, months);
  const priorValues = priorMonths.map((m) => monthlyTotals[m]).filter((v) => v > 0.001);
  const baseline = priorValues.length > 0 ? refMedian(priorValues) : 0;
  const amount = Math.abs(t.AmountNum);
  if (baseline < 0.001) return amount >= OUTLIER_MIN_AMOUNT * OUTLIER_MULTIPLIER;
  return amount >= OUTLIER_MULTIPLIER * baseline && amount >= OUTLIER_MIN_AMOUNT;
}
function refSparseSet(items, months, monthRatio) {
  const sparse = new Set();
  new Set(items.map(refCategoryName)).forEach((category) => {
    if (refIsSparse(items, category, months, monthRatio)) sparse.add(category);
  });
  return sparse;
}
function refHasStableDescription(items) {
  if (items.length < 2) return false;
  const { clusterInfo } = buildDescriptionClusters(items.map((t) => t.Description));
  return [...clusterInfo.values()].some((info) => {
    const clusterItems = items.filter((t) => info.variants.includes(t.Description));
    const clusterMonths = new Set(clusterItems.map(getPayMonth));
    return clusterItems.length / items.length >= 0.8 && clusterMonths.size >= 2;
  });
}
function refOutliers(items, months, recurringCategories) {
  const out = new Set();
  const currentMonth = months[months.length - 1];
  recurringCategories.forEach((category) => {
    items
      .filter((t) => refCategoryName(t) === category && getPayMonth(t) === currentMonth)
      .forEach((t) => {
        if (refIsOutlier(t, items, category, months)) out.add(t.id);
      });
  });
  return out;
}
function refExceptionSets(items, months, transferIds) {
  const scoped = items.filter((t) => months.includes(getPayMonth(t)) && !transferIds.has(t.id));
  const incomeItems = scoped.filter((t) => t.AmountNum > 0);
  const expenseItems = scoped.filter((t) => t.AmountNum < 0);
  const incomeSparse = refSparseSet(incomeItems, months, INCOME_EXCEPTION_MONTH_RATIO);
  const expenseSparse = refSparseSet(expenseItems, months, EXCEPTION_MONTH_RATIO);
  incomeSparse.forEach((category) => {
    if (refHasStableDescription(incomeItems.filter((t) => refCategoryName(t) === category))) incomeSparse.delete(category);
  });
  incomeItems.forEach((t) => {
    if (refIsUncategorized(t)) incomeSparse.add(refCategoryName(t));
  });
  const recurringIncome = [...new Set(incomeItems.map(refCategoryName))].filter((c) => !incomeSparse.has(c));
  const recurringExpense = [...new Set(expenseItems.map(refCategoryName))].filter((c) => !expenseSparse.has(c));
  const outliers = new Set([...refOutliers(incomeItems, months, recurringIncome), ...refOutliers(expenseItems, months, recurringExpense)]);
  return { incomeSparse, expenseSparse, outliers };
}

describe.skipIf(!real)('buildExceptionClusters — the one-pass profile matches the old rules', () => {
  const accounts = [...new Set(real?.map((t) => t.Account) ?? [])];
  const allMonths = [...new Set(real?.map((t) => t['Pay Month']) ?? [])].sort();
  const loans = new Set(accounts.filter((a) => parseAccount(a).type === 'Loan'));
  const asOf = new Date(2026, 7, 22);
  const sorted = (set) => [...set].sort();

  [26, 6].forEach((range) => {
    it(`returns the same sparse categories and outliers at range ${range}`, () => {
      const months = allMonths.slice(-range);
      const processed = processTransactionData(real, accounts, range, asOf);
      const scoped = enrichWithEffectivePayMonths(real, months).filter((t) => !loans.has(t.Account));
      const fast = buildExceptionClusters(scoped, months, processed.transferIds);
      const ref = refExceptionSets(scoped, months, processed.transferIds);
      expect(sorted(fast.incomeSparseCategories)).toEqual(sorted(ref.incomeSparse));
      expect(sorted(fast.expenseSparseCategories)).toEqual(sorted(ref.expenseSparse));
      expect(sorted(fast.outlierTransactionIds)).toEqual(sorted(ref.outliers));
      expect(fast.expenseSparseCategories.size).toBeGreaterThan(0);
      expect(fast.currentMonth).toBe(months.at(-1));
      // The display clustering is still there for anyone who asks for it.
      expect(fast.descToCluster).toBeInstanceOf(Map);
      expect(fast.descToCluster.size).toBeGreaterThan(0);
    });
  });
});
