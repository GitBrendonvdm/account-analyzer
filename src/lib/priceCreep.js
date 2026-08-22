import {
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
 * Two guards keep it honest. A regime seen only once is not a price — it is a one-off, an outlier
 * the engine kept for presence — so only regimes with two or more observations are steps, and a
 * line where most observations are singletons (the pharmacy, the fuel station) is set aside as
 * "varies too much to compare" rather than reported as creeping. And the instalments are listed
 * but never totalled: the bond's instalment fell with every rate cut, which is not a price.
 */

const R = (n) => formatCurrencyAbs(n);
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const CREEP_CADENCES = new Set(['monthly', 'bimonthly', 'quarterly', 'annual']);
const DEBT_KINDS = new Set(['instalment', 'repayment']);
/**
 * The price "when you started" must itself have been charged this many times. Two charges are a
 * pro-rata first month or a trial, and anchoring on them turned a 13% increase into a 193% one on
 * the real data; a later step may still be fresh (two charges at the new price is a step worth
 * reporting — the account fee that doubled last cycle), so only the base is held to it.
 */
const BASE_REGIME_MIN_COUNT = 3;

function cycleLabel(key) {
  if (!key) return '';
  const [y, m] = key.split('-').map(Number);
  return `${MONTHS[m - 1] ?? ''} ${y}`.trim();
}

const pctLabel = (pct) => `${pct >= 0 ? '+' : '−'}${Math.round(Math.abs(pct) * 100)}%`;

/**
 * @param {RecurringLine[]} lines  from buildRecurringLines
 * @returns {{
 *   rising: CreepItem[], falling: CreepItem[],
 *   variable: [{ lineId, label, kind, singletonShare }],   // too many one-off amounts to compare
 *   extraPerCycle, extraPerYear,                           // Σ rising, instalments and repayments left out
 *   sentence, variableSentence, assumptions: string[],
 * }}
 * CreepItem = { lineId, label, kind, category, first: { cycle, amount, count }, last: { cycle, amount, count },
 *               steps: [{ cycle, from, to, pct, count }], totalPct, extraPerCycle, extraPerYear,
 *               slopePerYear, cyclesObserved, countsInTotal, sentence }
 * `extraPerCycle` on a falling item is negative (what the drop saves a cycle).
 */
export function buildPriceCreep(lines) {
  const rising = [];
  const falling = [];
  const variable = [];

  (lines ?? []).forEach((line) => {
    if (!CREEP_CADENCES.has(line.cadence) || (line.cyclesPresent ?? 0) < PRICE_CREEP_MIN_CYCLES) return;
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
    assumptions: [
      'Instalments, card repayments and interest lines are listed but never totalled: a rate move is not a price.',
      `The starting price is the first amount charged at least ${BASE_REGIME_MIN_COUNT} times; a one- or two-off opening charge is not a price.`,
    ],
  };
}
