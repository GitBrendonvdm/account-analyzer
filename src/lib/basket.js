import { BASKET_CATEGORIES, BASKET_MIN_TICKET, BASKET_WINDOW } from '../constants';
import { formatCurrencyAbs } from '../utils/format';
import { completeMonths, spendRows } from './flows';
import { merchantKeyOf, merchantLabel } from './merchants';
import { mean, median } from './stats';

/**
 * Trips versus ticket: is the grocery bill up because you shop more often, or because each shop
 * costs more?
 *
 * A category total that rose by R2 000 a cycle is a fact without a handle on it. The same R2 000
 * split into "four more trips a cycle at the old basket" and "the same trips at a dearer basket"
 * is something a person can act on — or decide not to, because a dearer basket is mostly
 * inflation and more trips is mostly habit. The split is exact. With n̄ the mean visits a cycle
 * and t̄ = S̄/n̄ the MEAN ticket over a window,
 *
 *     ΔS = S̄_late − S̄_early
 *     F  = (n̄_late − n̄_early) × t̄_early       more (or fewer) trips, priced at the old basket
 *     T  = n̄_late × (t̄_late − t̄_early)        the same trips, at the new basket
 *
 * and F + T = ΔS to the cent, which a median ticket would not give. The median is reported
 * alongside because it is the better description of a typical shop; it just cannot be summed.
 *
 * Visits count rows of at least BASKET_MIN_TICKET — a R12 packet of chips is not a shopping trip,
 * though its R12 is still spend. The windows are two runs of BASKET_WINDOW complete cycles: the
 * last six against the six before them, so that the comparison is year-on-half-year rather than
 * against a distant past the household no longer resembles. Everything here is an EXPLANATION of
 * a change, never a saving: the finder reports the frequency share as behavioural potential and
 * leaves it out of the money it claims to have found.
 */

const R = (n) => formatCurrencyAbs(n);
const CATEGORY_SET = new Set(BASKET_CATEGORIES);
const trips = (n) => (Number.isInteger(n) ? String(n) : n.toFixed(1));

/** Per-cycle visits, spend and mean ticket for one run of cycles. */
function cycleSeries(rows, cycles) {
  const byCycle = new Map(cycles.map((c) => [c, { visits: 0, spend: 0, tickets: [] }]));
  rows.forEach((t) => {
    const slot = byCycle.get(t['Pay Month']);
    if (!slot) return;
    const amount = Math.abs(t.AmountNum);
    slot.spend += amount;
    if (amount >= BASKET_MIN_TICKET) {
      slot.visits += 1;
      slot.tickets.push(amount);
    }
  });
  return cycles.map((month) => {
    const { visits, spend, tickets } = byCycle.get(month);
    return { month, visits, spend, tickets, meanTicket: visits > 0 ? spend / visits : 0 };
  });
}

/** Window means: n̄, S̄, t̄ = S̄/n̄ (0 when there were no visits), and the descriptive median ticket. */
function windowStats(series) {
  const visitsPerCycle = mean(series.map((c) => c.visits));
  const spendPerCycle = mean(series.map((c) => c.spend));
  return {
    visitsPerCycle,
    spendPerCycle,
    meanTicket: visitsPerCycle > 0 ? spendPerCycle / visitsPerCycle : 0,
    medianTicket: median(series.flatMap((c) => c.tickets)),
  };
}

function describeFamily({ category, merchantFamily, label, rows, early, late, windowNote }) {
  const earlySeries = cycleSeries(rows, early);
  const lateSeries = cycleSeries(rows, late);
  const e = windowStats(earlySeries);
  const l = windowStats(lateSeries);
  const spend = l.spendPerCycle - e.spendPerCycle;
  const frequency = (l.visitsPerCycle - e.visitsPerCycle) * e.meanTicket;
  // T = n̄_late × (t̄_late − t̄_early) whenever both windows saw visits; written as the remainder so
  // that F + T = ΔS holds to the cent even when a window had spend but no qualifying visit.
  const ticket = spend - frequency;
  const absF = Math.abs(frequency);
  const absT = Math.abs(ticket);
  let driver = 'both';
  if (absF + absT > 0) {
    if (absF >= 2 * absT) driver = 'frequency';
    else if (absT >= 2 * absF) driver = 'ticket';
  }
  const strip = ({ month, visits, meanTicket, spend: s }) => ({ month, visits, meanTicket, spend: s });
  return {
    category,
    merchantFamily,
    label,
    early: e,
    late: l,
    delta: { spend, frequency, ticket },
    driver,
    frequencyPerCycle: Math.max(0, frequency),
    seriesByCycle: [...earlySeries, ...lateSeries].map(strip),
    sentence:
      `${label}: ${trips(e.visitsPerCycle)} → ${trips(l.visitsPerCycle)} trips a cycle, ` +
      `basket ${R(e.meanTicket)} → ${R(l.meanTicket)}. ` +
      `${frequency >= 0 ? 'More' : 'Fewer'} trips explain ${R(frequency)} of the ${R(spend)} change (${windowNote}).`,
  };
}

/**
 * @param data  every row
 * @param opts  transfers: buildFullTransfers(data); calendar: buildCycleCalendar(...);
 *              accounts: AccountRecord[] (type overrides); selectedAccounts: raw names to keep
 * @returns {{
 *   windowNote: string, early: { cycles: string[] }, late: { cycles: string[] },
 *   families: [{
 *     category, merchantFamily: null|string, label,
 *     early: { visitsPerCycle, meanTicket, medianTicket, spendPerCycle }, late: { … },
 *     delta: { spend, frequency, ticket },     // frequency + ticket === spend
 *     driver: 'frequency'|'ticket'|'both', frequencyPerCycle,   // max(0, frequency) — an explanation, not a saving
 *     seriesByCycle: [{ month, visits, meanTicket, spend }], sentence,
 *   }],                                          // category rows (merchantFamily null) by |Δspend| desc, each followed by its merchant families
 *   cycles: string[], assumptions: string[],
 * }}
 */
export function buildBasket(data, { transfers, calendar, accounts = null, selectedAccounts = null } = {}) {
  const cycles = completeMonths(calendar);
  const assumptions = [
    `A visit is a row of at least ${R(BASKET_MIN_TICKET)}; smaller rows count in spend but not as trips.`,
  ];
  if (cycles.length < 2) {
    return { windowNote: 'not enough complete cycles', early: { cycles: [] }, late: { cycles: [] }, families: [], cycles, assumptions };
  }

  let early;
  let late;
  let windowNote;
  if (cycles.length >= BASKET_WINDOW * 2) {
    early = cycles.slice(-BASKET_WINDOW * 2, -BASKET_WINDOW);
    late = cycles.slice(-BASKET_WINDOW);
    windowNote = `cycles ${BASKET_WINDOW * 2}–${BASKET_WINDOW + 1} back against the last ${BASKET_WINDOW}`;
  } else {
    const half = Math.floor(cycles.length / 2);
    early = cycles.slice(0, half);
    late = cycles.slice(half);
    windowNote = 'first half against second half';
    assumptions.push(`Fewer than ${BASKET_WINDOW * 2} complete cycles: the file is split in half instead.`);
  }

  const rows = spendRows(data, { transfers, accounts, selectedAccounts, months: [...early, ...late] }).filter(
    (t) => CATEGORY_SET.has(t.Category),
  );

  // Descriptions repeat (the same till, week after week); the key is derived once per distinct one.
  const familyCache = new Map();
  const familyOf = (description) => {
    if (!familyCache.has(description)) familyCache.set(description, merchantKeyOf(description).split(' ')[0]);
    return familyCache.get(description);
  };
  const byCategory = new Map();
  rows.forEach((t) => {
    if (!byCategory.has(t.Category)) byCategory.set(t.Category, { rows: [], merchants: new Map() });
    const entry = byCategory.get(t.Category);
    entry.rows.push(t);
    const family = familyOf(t.Description);
    if (!family) return;
    if (!entry.merchants.has(family)) entry.merchants.set(family, []);
    entry.merchants.get(family).push(t);
  });

  const byDelta = (a, b) => Math.abs(b.delta.spend) - Math.abs(a.delta.spend);
  const families = [];
  const categoryRows = [...byCategory.entries()]
    .map(([category, { rows: catRows, merchants }]) => ({
      head: describeFamily({ category, merchantFamily: null, label: category, rows: catRows, early, late, windowNote }),
      merchants,
    }))
    .sort((a, b) => byDelta(a.head, b.head));
  // A merchant seen in only one window has no old basket to price its trips at; the check is made
  // before describing, because most merchant families fail it and a description costs real time.
  const earlySet = new Set(early);
  const lateSet = new Set(late);
  const visitedInBoth = (famRows) => {
    let e = false;
    let l = false;
    for (const t of famRows) {
      if (Math.abs(t.AmountNum) < BASKET_MIN_TICKET) continue;
      if (earlySet.has(t['Pay Month'])) e = true;
      else if (lateSet.has(t['Pay Month'])) l = true;
      if (e && l) return true;
    }
    return false;
  };
  categoryRows.forEach(({ head, merchants }) => {
    families.push(head);
    const sub = [...merchants.entries()]
      .filter(([, famRows]) => visitedInBoth(famRows))
      .map(([family, famRows]) =>
        describeFamily({
          category: head.category,
          merchantFamily: family,
          label: merchantLabel(family),
          rows: famRows,
          early,
          late,
          windowNote,
        }),
      )
      .sort(byDelta);
    families.push(...sub);
  });

  return { windowNote, early: { cycles: early }, late: { cycles: late }, families, cycles, assumptions };
}
