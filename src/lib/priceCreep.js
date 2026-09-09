import {
  PRICE_BASE_REGIME_MIN,
  PRICE_CREEP_MIN_CYCLES,
  PRICE_STEP_MIN_PCT,
  PRICE_STEP_MIN_RAND,
  PRICE_VARIABLE_MAX_SINGLETON_SHARE,
} from '../constants';
import { formatCurrencyAbs } from '../utils/format';
import { theilSen } from './stats';

/**
 * Price creep: the same things costing more than when you started paying for them.
 *
 * Nobody decides to pay 36% more for the same internet line; it happens one letter at a time, and
 * a per-category view hides it completely because the category total moves for a dozen other
 * reasons. The recurring engine already splits every line into price REGIMES — runs of the same
 * amount — so a price change is simply two regimes in a row, and the whole history of a line is
 * the staircase of its regimes. This module reads that staircase: first price, last price, the
 * steps between, and what the difference costs a cycle.
 *
 * Three guards keep it honest. A regime seen only once is not a price — it is a one-off, an outlier
 * the engine kept for presence — so only regimes with two or more observations are steps, and a
 * line where most observations are singletons (the pharmacy, the fuel station) is set aside as
 * "varies too much to compare" rather than reported as creeping. And the instalments are listed
 * but never totalled: the bond's instalment fell with every rate cut, which is not a price.
 *
 * The third guard is time. "The same things cost more" is a claim about what you are paying NOW,
 * so a line has to still be charging to make it: one you cancelled two years ago, or a gym you
 * left, is not costing you anything more a cycle and listing it was the single most confusing
 * thing this module did. A line qualifies when the engine still calls it active, the user has not
 * ended it, and its CURRENT price has been charged inside the recent window — long enough to cover
 * the line's own rhythm, so a quarterly or annual charge is not called stale between charges.
 */

const R = (n) => formatCurrencyAbs(n);
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const CREEP_CADENCES = new Set(['monthly', 'bimonthly', 'quarterly', 'annual']);
const DEBT_KINDS = new Set(['instalment', 'repayment']);
/**
 * How recently the current price must have been charged, in complete cycles. Three covers a
 * monthly line that has skipped one and an export a fortnight behind; slower cadences get their
 * own gap plus one, so a quarterly line needs four cycles and an annual one thirteen.
 */
const RECENT_CYCLES_MIN = 3;
/**
 * The base rule, shared with recurring.js's inline badge (see PRICE_BASE_REGIME_MIN). A later step
 * may still be fresh — two charges at the new price is a step worth reporting, the account fee that
 * doubled last cycle — so only the base is held to it.
 */
const BASE_REGIME_MIN_COUNT = PRICE_BASE_REGIME_MIN;

function cycleLabel(key) {
  if (!key) return '';
  const [y, m] = key.split('-').map(Number);
  return `${MONTHS[m - 1] ?? ''} ${y}`.trim();
}

const pctLabel = (pct) => `${pct >= 0 ? '+' : '−'}${Math.round(Math.abs(pct) * 100)}%`;

/** The window, in complete cycles, inside which this line's latest price must have been charged. */
function recentCyclesFor(line) {
  const perYear = line.perYear > 0 ? line.perYear : 12;
  return Math.max(RECENT_CYCLES_MIN, Math.ceil(12 / perYear) + 1);
}

/**
 * @param {RecurringLine[]} lines  from buildRecurringLines
 * @param {object} options
 *   cycles: string[] — the complete pay-cycle keys, oldest first (completeMonths(calendar)). Given
 *     them, a line whose current price stopped being charged before the window is left out; without
 *     them the check falls back to the engine's own active/ended flags alone.
 * @returns {{
 *   rising: CreepItem[], falling: CreepItem[],
 *   variable: [{ lineId, label, kind, singletonShare }],   // too many one-off amounts to compare
 *   stale,                                                 // lines skipped for no longer charging
 *   extraPerCycle, extraPerYear,                           // Σ rising, instalments and repayments left out
 *   sentence, variableSentence, assumptions: string[],
 * }}
 * CreepItem = { lineId, label, kind, category, first: { cycle, amount, count }, last: { cycle, amount, count },
 *               steps: [{ cycle, from, to, pct, count }], totalPct, extraPerCycle, extraPerYear,
 *               slopePerYear, cyclesObserved, countsInTotal, sentence }
 * `extraPerCycle` on a falling item is negative (what the drop saves a cycle).
 */
export function buildPriceCreep(lines, options = {}) {
  const cycles = options.cycles ?? [];
  const rising = [];
  const falling = [];
  const variable = [];
  let stale = 0;

  (lines ?? []).forEach((line) => {
    if (!CREEP_CADENCES.has(line.cadence) || (line.cyclesPresent ?? 0) < PRICE_CREEP_MIN_CYCLES) return;
    // Gone, by the engine's reckoning or by the user's.
    if (line.status !== 'active' || line.ended) {
      stale += 1;
      return;
    }
    const regimes = line.regimes ?? [];
    const singletons = regimes.filter((r) => r.count < 2).reduce((s, r) => s + r.count, 0);
    const singletonShare = line.observations ? ((line.outliers ?? 0) + singletons) / line.observations : 0;
    if (singletonShare > PRICE_VARIABLE_MAX_SINGLETON_SHARE) {
      variable.push({ lineId: line.id, label: line.label, kind: line.kind, singletonShare });
      return;
    }
    const kept = regimes.filter((r) => r.count >= 2 && r.amount > 0);
    if (!kept.length) return;

    const baseIndex = kept.findIndex((r) => r.count >= BASE_REGIME_MIN_COUNT);
    if (baseIndex < 0) return;
    const run = kept.slice(baseIndex);
    const first = run[0];
    const last = run[run.length - 1];
    // The current price has to be current. `last.to` is the newest cycle that price was charged in.
    if (cycles.length) {
      const cutoff = cycles[Math.max(0, cycles.length - recentCyclesFor(line))];
      if (!last.to || last.to < cutoff) {
        stale += 1;
        return;
      }
    }
    const steps = run.slice(1).map((r, i) => ({
      cycle: r.from,
      from: run[i].amount,
      to: r.amount,
      pct: r.amount / run[i].amount - 1,
      count: r.count,
    }));
    const totalPct = last.amount / first.amount - 1;
    const diff = last.amount - first.amount;
    const perYear = line.perYear ?? 12;
    const extraPerCycle = (diff * perYear) / 12;
    let direction = null;
    if (totalPct >= PRICE_STEP_MIN_PCT && diff >= PRICE_STEP_MIN_RAND) direction = 'rising';
    else if (totalPct <= -PRICE_STEP_MIN_PCT && -diff >= PRICE_STEP_MIN_RAND) direction = 'falling';
    if (!direction) return;

    const change = `${R(first.amount)} → ${R(last.amount)} (${pctLabel(totalPct)}) since ${cycleLabel(last.from)}`;
    const item = {
      lineId: line.id,
      label: line.label,
      kind: line.kind,
      category: line.category ?? null,
      first: { cycle: first.from, amount: first.amount, count: first.count },
      last: { cycle: last.from, amount: last.amount, count: last.count },
      steps,
      totalPct,
      extraPerCycle,
      extraPerYear: extraPerCycle * 12,
      slopePerYear: theilSen(line.perCycleAmounts ?? []).slope * 12,
      cyclesObserved: line.cyclesPresent,
      // Interest is a cost of a balance, not a price; an instalment moves with the rate.
      countsInTotal: !DEBT_KINDS.has(line.kind) && line.category !== 'Interest',
      sentence:
        direction === 'rising'
          ? `${line.label}: ${change} — ${R(extraPerCycle * 12)} a year more.`
          : `${line.label}: ${change} — ${R(-extraPerCycle * 12)} a year less.`,
    };
    (direction === 'rising' ? rising : falling).push(item);
  });

  const byExtra = (a, b) => Math.abs(b.extraPerCycle) - Math.abs(a.extraPerCycle);
  rising.sort(byExtra);
  falling.sort(byExtra);
  variable.sort((a, b) => b.singletonShare - a.singletonShare);

  const extraPerCycle = rising.filter((r) => r.countsInTotal).reduce((s, r) => s + r.extraPerCycle, 0);

  return {
    rising,
    falling,
    variable,
    extraPerCycle,
    extraPerYear: extraPerCycle * 12,
    sentence: `The same things cost ${R(extraPerCycle)} more a cycle than when you started — ${R(extraPerCycle * 12)} a year.`,
    variableSentence: `${variable.length} line${variable.length === 1 ? '' : 's'} vary too much to compare`,
    stale,
    assumptions: [
      'Instalments, card repayments and interest lines are listed but never totalled: a rate move is not a price.',
      `The starting price is the first amount charged at least ${BASE_REGIME_MIN_COUNT} times; a one- or two-off opening charge is not a price.`,
      'Only lines still charging count: a price you no longer pay is not costing you more.',
      ...(stale ? [`${stale} line${stale === 1 ? '' : 's'} left out for having stopped charging.`] : []),
    ],
  };
}
