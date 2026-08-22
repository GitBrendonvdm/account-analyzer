import {
  CARD_MINIMUM_FLOOR,
  CARD_MINIMUM_PCT_DEFAULT,
  DEBT_BUDGET_CYCLES,
  DEBT_EPS,
  DEBT_HORIZON_CAP,
  MARGINAL_AMOUNT_DEFAULT,
  MARGINAL_HORIZON_MONTHS,
  RATE_SENSITIVITY_SHIFTS_BP,
  DEFAULT_RATE_BY_KIND,
} from '../constants';
import { addMonthsToKey } from './effectivePayMonth';
import { annuity } from './inferRates';
import { accountIdOf } from './accounts';
import { mean } from './stats';

export { annuity, remainingTerm } from './inferRates';

/**
 * The one amortisation engine.
 *
 * Every question the Debt view asks — which debt to attack first, what a rand of extra payment is
 * worth, when the household is debt-free, what a rate move does, what a lump sum buys — is the
 * same question asked of the same machine with one input changed. So there is one machine.
 * `simulatePlan` walks every debt forward one pay cycle at a time; `amortise` is that walk with a
 * single debt, `comparePlans` is that walk under five orderings, `marginalValue` is two walks that
 * differ by exactly one lump, the solver bisects over it. Nothing else in the tree amortises.
 * Two engines would disagree by a rounding rule within a week, and the disagreement would show up
 * as a strategy tile that does not match its own chart.
 *
 * A period is one pay cycle, and one cycle holds exactly one interest posting and one instalment
 * on every liability in the real data. Inside a period the order is: extra money lands first
 * (lumps, the plan's extra, a deficit landing on a card), interest posts on what is then owed, and
 * the scheduled payment follows. That overstates bond interest by roughly the interest on the
 * instalment's principal for the days after it lands — about R30 a month — and the day-count
 * backtest in inferRates bounds the error.
 *
 * The cascade is the whole point of ordering. When a debt clears, its instalment is free cash, and
 * under every strategy but `minimum` that cash rolls onto the next debt in the order the same
 * period. `minimum` is the control: every instalment at its contractual amount, nothing rolled,
 * nothing extra, so that every saving a strategy claims is measured against the same baseline.
 *
 * A debt whose instalment does not cover its interest is flagged, not looped on: the engine notes
 * `neverClears`, reports what the instalment would have to be, and carries on to the horizon cap
 * so the rest of the plan still gets an answer.
 */

export const HORIZON_CAP = DEBT_HORIZON_CAP;
const STRATEGIES = ['minimum', 'avalanche', 'snowball', 'lifetime', 'shortTerm'];

/** rateNominal / 12. */
export function monthlyRate(rateNominal) {
  return (rateNominal ?? 0) / 12;
}

/** (1 + e)^(1/12) − 1: the monthly rate that compounds to an effective annual `e`. */
export function monthlyFromEffective(rateEffective) {
  return (1 + (rateEffective ?? 0)) ** (1 / 12) - 1;
}

/** date + n calendar months, the day clamped to the target month's length; null for no date. */
export function addCycles(date, n) {
  if (!date) return null;
  const year = date.getFullYear();
  const month = date.getMonth() + n;
  const lastDay = new Date(year, month + 1, 0).getDate();
  return new Date(year, month, Math.min(date.getDate(), lastDay));
}

const fmt = (x) => `R${String(Math.round(Math.abs(x))).replace(/\B(?=(\d{3})+(?!\d))/g, ' ')}`;
const pct = (rate) => `${(rate * 100).toFixed(2)}%`;

// ---- orderings ----------------------------------------------------------------------------------

const byRateDesc = (a, b) => b.rateNominal - a.rateNominal || a.balance - b.balance;
const feeAdjusted = (d) => d.rateNominal + (12 * (d.feeMonthly ?? 0)) / d.balance;

/**
 * The order debts are attacked in. `minimum` keeps the input order; `avalanche` is rate desc (ties:
 * the smaller balance first); `snowball` balance asc; `lifetime` fee-adjusted rate desc;
 * `shortTerm` the 12-month marginal value of R1 000 desc (ties: earlier cash relief); `custom`
 * is `options.order` with unknown ids appended in avalanche order.
 *
 * @returns accountId[]
 */
export function payoffOrder(debts, strategy, options = {}) {
  const active = (debts ?? []).filter((d) => Number.isFinite(d.balance) && d.balance > 0);
  const ids = (xs) => xs.map((d) => d.id);
  const avalanche = ids([...active].sort(byRateDesc));
  switch (strategy) {
    case 'minimum':
      return ids(active);
    case 'snowball':
      return ids([...active].sort((a, b) => a.balance - b.balance || b.rateNominal - a.rateNominal));
    case 'lifetime':
      return ids([...active].sort((a, b) => feeAdjusted(b) - feeAdjusted(a) || a.balance - b.balance));
    case 'shortTerm': {
      const rows = marginalValue(active, {
        amount: MARGINAL_AMOUNT_DEFAULT,
        horizon: MARGINAL_HORIZON_MONTHS,
        strategy: 'custom',
        order: avalanche,
        cascade: true,
      });
      const byId = new Map(rows.map((r) => [r.id, r]));
      return [...avalanche].sort((a, b) => {
        const ra = byId.get(a);
        const rb = byId.get(b);
        return (rb?.lump12 ?? 0) - (ra?.lump12 ?? 0) || (rb?.cashReliefMonths ?? 0) - (ra?.cashReliefMonths ?? 0);
      });
    }
    case 'custom': {
      const known = new Set(avalanche);
      const chosen = (options.order ?? []).filter((id) => known.has(id));
      const seen = new Set(chosen);
      return [...chosen, ...avalanche.filter((id) => !seen.has(id))];
    }
    case 'avalanche':
    default:
      return avalanche;
  }
}

// ---- the engine ---------------------------------------------------------------------------------

const cardMinimum = (s, balance) => Math.max(CARD_MINIMUM_FLOOR, (s.minimumPct / 100) * balance);
const cardScheduled = (s, balance) => Math.max(cardMinimum(s, balance), s.plannedPayment ?? 0);

function missingOf(debt) {
  const missing = [];
  if (!Number.isFinite(debt.balance)) missing.push('balance');
  if (debt.source?.rate === 'default' || debt.rateNominal == null) missing.push('rate');
  if (debt.type === 'Credit Card' && !(debt.creditLimit > 0)) missing.push('limit');
  if (debt.type !== 'Credit Card' && !(debt.instalment > 0)) missing.push('instalment');
  return missing;
}

function scheduleAt(series, k) {
  if (Array.isArray(series)) return series[k - 1] ?? series[series.length - 1] ?? 0;
  return Number.isFinite(series) ? series : 0;
}

/**
 * Walk every debt forward one pay cycle at a time.
 *
 * @param debts    Debt[] (inferRates.toDebt): balance is a positive magnitude
 * @param options  {
 *   strategy: 'minimum'|'avalanche'|'snowball'|'lifetime'|'shortTerm'|'custom' = 'avalanche',
 *   order: accountId[] (custom), extraPerMonth: number|number[] = 0 (array indexed by period − 1; the
 *   last value carries), lumps: [{ month, amount, targetId: null|accountId }] = [],
 *   inflows: { [accountId]: number|number[] } = {} (a deficit landing on a card each period),
 *   cascade: boolean = strategy !== 'minimum', rateShiftBp: number = 0 (rateVariable debts only),
 *   recast: boolean = false (re-amortise shifted loans to the same remainingMonths),
 *   horizon: number = HORIZON_CAP, currentMonth: 'YYYY-MM', nextPayDate: Date,
 * }
 * @returns {{
 *   strategy, order: accountId[], horizon, cap, cascade,
 *   months, debtFreeDate: Date|null, reachedCap,
 *   neverClears: [{ id, minimumToClear }],
 *   totalInterest, totalFees, totalPaid, totalExtra,
 *   schedule: [{ month, payMonth, date, pool, totalPayment, totalInterest, totalFees, debtTotal,
 *                byDebt: { [id]: { open, extra, inflow, interest, fee, payment, principal, close, cleared } } }],
 *   perDebt: { [id]: { clearedMonth, clearedDate, interest, fees, paid, extra, scheduled, instalmentDelta } },
 *   instalmentDelta: { [id]: number },
 *   events: [{ type: 'cleared'|'rolled'|'neverClears'|'balloon'|'limit', id, month, date, amount, to?, unfunded?, freed? }],
 *   freedTimeline: [{ month, date, id, freed, cumulativeFreed, rolledTo }],
 *   labels: { [id]: label },
 *   excluded: [{ id, label, reason, missing }],
 *   assumptions: string[],
 * }}
 */
export function simulatePlan(debts, options = {}) {
  const {
    strategy = 'avalanche',
    rateShiftBp = 0,
    recast = false,
    horizon = HORIZON_CAP,
    currentMonth = null,
    nextPayDate = null,
    inflows = {},
  } = options;
  const isMinimum = strategy === 'minimum';
  const cascade = isMinimum ? false : (options.cascade ?? true);
  const extraPerMonth = isMinimum ? 0 : (options.extraPerMonth ?? 0);
  const lumps = isMinimum ? [] : (options.lumps ?? []);
  const cap = Math.max(0, Math.min(HORIZON_CAP, Math.floor(horizon)));

  const assumptions = new Set();
  const excluded = [];
  const active = [];
  (debts ?? []).forEach((d) => {
    const isCard = d.type === 'Credit Card';
    if (!Number.isFinite(d.balance) || d.balance <= 0) {
      excluded.push({ id: d.id, label: d.label, reason: 'no balance', missing: missingOf(d) });
      return;
    }
    if (!isCard && !(d.instalment > 0)) {
      excluded.push({ id: d.id, label: d.label, reason: 'no instalment', missing: missingOf(d) });
      return;
    }
    active.push(d);
    (d.assumptions ?? []).forEach((a) => assumptions.add(a));
  });

  const order = payoffOrder(active, strategy, options);
  const byId = new Map(active.map((d) => [d.id, d]));
  const state = order.map((id) => {
    const d = byId.get(id);
    const isCard = d.type === 'Credit Card';
    const shift = d.rateVariable ? rateShiftBp / 10000 : 0;
    const rM = Math.max(0, (d.rateNominal ?? 0) + shift) / 12;
    const fee = d.feeMonthly ?? 0;
    let instalment = isCard ? null : d.instalment;
    let instalmentDelta = 0;
    if (!isCard && recast && rateShiftBp !== 0 && shift !== 0) {
      const n = Number.isFinite(d.remainingMonths) && d.remainingMonths > 0 ? d.remainingMonths : 360;
      const recastInstalment = annuity(d.balance, rM, n) + fee;
      instalmentDelta = recastInstalment - instalment;
      instalment = recastInstalment;
    }
    if (shift !== 0) assumptions.add(`${d.label}: rate shifted ${rateShiftBp > 0 ? '+' : ''}${rateShiftBp}bp from the observed ${pct(d.rateNominal)}`);
    return {
      id,
      label: d.label,
      isCard,
      balance: d.balance,
      rM,
      fee,
      instalment,
      instalmentDelta,
      minimumPct: d.minimumPct ?? CARD_MINIMUM_PCT_DEFAULT,
      plannedPayment: d.plannedPayment ?? null,
      creditLimit: d.creditLimit ?? null,
      balloon: d.balloon ?? null,
      contractEnd: d.balloon > 0 && Number.isFinite(d.termMonths) && d.termMonths > 0 ? Math.round(d.termMonths) : null,
      scheduledAtStart: isCard ? cardScheduled({ minimumPct: d.minimumPct ?? CARD_MINIMUM_PCT_DEFAULT, plannedPayment: d.plannedPayment }, d.balance) : instalment,
      cleared: false,
      clearedMonth: null,
      clearedDate: null,
      neverClears: false,
      minimumToClear: null,
      interest: 0,
      fees: 0,
      paid: 0,
      extra: 0,
      limitFlagged: false,
      balloonDone: false,
    };
  });
  Object.entries(inflows).forEach(([id, amount]) => {
    const s = state.find((x) => x.id === id);
    const perCycle = scheduleAt(amount, 1);
    if (s && perCycle > 0) assumptions.add(`Deficit of ${fmt(perCycle)} a cycle lands on the ${s.label}`);
  });

  const schedule = [];
  const events = [];
  const freedTimeline = [];
  let freedPool = 0;
  let cumulativeFreed = 0;
  let months = 0;
  let debtFreeDate = null;
  let reachedCap = false;
  let totalInterest = 0;
  let totalFees = 0;
  let totalPaid = 0;
  let totalExtra = 0;

  const zeroRow = { open: 0, extra: 0, inflow: 0, interest: 0, fee: 0, payment: 0, principal: 0, close: 0, cleared: true };

  for (let k = 1; k <= cap && state.length; k += 1) {
    const payMonth = currentMonth ? addMonthsToKey(currentMonth, k) : null;
    const date = nextPayDate ? addCycles(nextPayDate, k - 1) : null;
    const untargeted = lumps.filter((l) => l.month === k && l.targetId == null).reduce((s, l) => s + l.amount, 0);
    let pool = Math.max(0, scheduleAt(extraPerMonth, k)) + untargeted + (cascade ? freedPool : 0);
    const periodPool = pool;
    const byDebt = {};
    const newlyCleared = [];
    let periodPayment = 0;
    let periodInterest = 0;
    let periodFees = 0;
    let debtTotal = 0;

    for (const s of state) {
      if (s.cleared) {
        byDebt[s.id] = { ...zeroRow };
        continue;
      }
      const targeted = lumps.filter((l) => l.month === k && l.targetId === s.id).reduce((acc, l) => acc + l.amount, 0);
      const extraAvailable = pool + targeted;
      const applied = Math.min(extraAvailable, s.balance);
      pool = extraAvailable - applied;
      const inflow = scheduleAt(inflows[s.id], k);
      const open = s.balance;
      const afterExtra = s.balance - applied + inflow;
      let row;

      if (afterExtra <= DEBT_EPS) {
        const unused = s.isCard ? cardScheduled(s, open) : s.instalment;
        row = { open, extra: applied, inflow, interest: 0, fee: 0, payment: 0, principal: applied, close: 0, cleared: true };
        if (cascade) pool += unused;
        newlyCleared.push({ s, freed: s.isCard ? (s.plannedPayment ?? cardMinimum(s, open)) : s.instalment });
        s.balance = 0;
      } else {
        const interest = s.rM * afterExtra;
        const fee = s.fee;
        const balloonDue = s.contractEnd === k && !s.balloonDone && s.balloon > 0 ? s.balloon : 0;
        const due = afterExtra + interest + fee + balloonDue;
        const scheduled = (s.isCard ? cardScheduled(s, afterExtra) : s.instalment) + balloonDue;
        const pay = Math.min(scheduled, due);
        const principal = pay - interest - fee;
        let close = due - pay;
        const cleared = close <= DEBT_EPS;
        if (cleared) close = 0;

        if (!s.neverClears && !cleared && scheduled - fee <= interest && applied === 0) {
          s.neverClears = true;
          s.minimumToClear = Math.ceil(interest + fee + 1);
          events.push({ type: 'neverClears', id: s.id, month: k, date, amount: s.minimumToClear });
        }
        if (balloonDue) {
          s.balloonDone = true;
          events.push({ type: 'balloon', id: s.id, month: k, date, amount: balloonDue, unfunded: pay < due });
        }
        if (cleared) {
          if (cascade) pool += scheduled - pay;
          newlyCleared.push({ s, freed: s.isCard ? (s.plannedPayment ?? cardMinimum(s, open)) : s.instalment });
        } else if (s.creditLimit > 0 && close > s.creditLimit && !s.limitFlagged) {
          s.limitFlagged = true;
          events.push({ type: 'limit', id: s.id, month: k, date, amount: s.creditLimit });
        }
        row = { open, extra: applied, inflow, interest, fee, payment: pay, principal, close, cleared };
        s.balance = close;
        s.interest += interest;
        s.fees += fee;
        s.paid += pay;
      }

      s.extra += row.extra;
      byDebt[s.id] = row;
      periodPayment += row.payment;
      periodInterest += row.interest;
      periodFees += row.fee;
      debtTotal += row.close;
    }

    newlyCleared.forEach(({ s, freed }) => {
      s.cleared = true;
      s.clearedMonth = k;
      s.clearedDate = date;
      freedPool += freed;
      cumulativeFreed += freed;
      const next = cascade ? state.find((o) => !o.cleared) : null;
      events.push({ type: 'cleared', id: s.id, month: k, date, amount: freed, freed });
      if (next) events.push({ type: 'rolled', id: s.id, from: s.id, to: next.id, month: k, date, amount: freed });
      freedTimeline.push({ month: k, date, id: s.id, freed, cumulativeFreed, rolledTo: next?.id ?? null });
    });

    totalPaid += periodPayment;
    totalInterest += periodInterest;
    totalFees += periodFees;
    totalExtra += Object.values(byDebt).reduce((acc, r) => acc + r.extra, 0);
    schedule.push({
      month: k,
      payMonth,
      date,
      pool: periodPool,
      totalPayment: periodPayment,
      totalInterest: periodInterest,
      totalFees: periodFees,
      debtTotal,
      byDebt,
    });

    if (state.every((s) => s.cleared)) {
      months = k;
      debtFreeDate = date;
      break;
    }
    if (k === cap) {
      months = k;
      reachedCap = true;
    }
  }

  const perDebt = {};
  const instalmentDelta = {};
  const labels = {};
  state.forEach((s) => {
    perDebt[s.id] = {
      clearedMonth: s.clearedMonth,
      clearedDate: s.clearedDate,
      interest: s.interest,
      fees: s.fees,
      paid: s.paid,
      extra: s.extra,
      scheduled: s.scheduledAtStart,
      instalmentDelta: s.instalmentDelta,
    };
    instalmentDelta[s.id] = s.instalmentDelta;
    labels[s.id] = s.label;
  });

  return {
    strategy,
    order,
    horizon: cap,
    cap: HORIZON_CAP,
    cascade,
    months,
    debtFreeDate,
    reachedCap,
    neverClears: state.filter((s) => s.neverClears).map((s) => ({ id: s.id, minimumToClear: s.minimumToClear })),
    totalInterest,
    totalFees,
    totalPaid,
    totalExtra,
    schedule,
    perDebt,
    instalmentDelta,
    events,
    freedTimeline,
    labels,
    excluded,
    assumptions: [...assumptions],
  };
}

/**
 * One debt in isolation: the engine with a single debt, an optional extra per month and a lump in
 * month 1.
 *
 * @returns {{ schedule: [{ month, open, extra, interest, fee, payment, principal, close }],
 *             months, totalInterest, totalFees, totalPaid, neverClears, minimumToClear, cleared }}
 */
export function amortise(debt, { extra = 0, lump = 0, months = HORIZON_CAP } = {}) {
  const id = debt.id ?? 'debt';
  const single = { type: 'Loan', label: id, ...debt, id };
  const plan = simulatePlan([single], {
    strategy: 'custom',
    order: [id],
    cascade: false,
    extraPerMonth: extra,
    lumps: lump > 0 ? [{ month: 1, amount: lump, targetId: id }] : [],
    horizon: months,
  });
  const flagged = plan.neverClears.find((n) => n.id === id);
  return {
    schedule: plan.schedule.map((p) => ({ month: p.month, ...p.byDebt[id] })),
    months: plan.months,
    totalInterest: plan.totalInterest,
    totalFees: plan.totalFees,
    totalPaid: plan.totalPaid,
    neverClears: Boolean(flagged),
    minimumToClear: flagged?.minimumToClear ?? null,
    cleared: plan.perDebt[id]?.clearedMonth != null,
  };
}

// ---- comparisons ----------------------------------------------------------------------------------

/** Σ (interest + fees) over the schedule periods [from, to] inclusive (1-based months). */
function costBetween(plan, from = 1, to = Infinity) {
  let total = 0;
  plan.schedule.forEach((p) => {
    if (p.month >= from && p.month <= to) total += p.totalInterest + p.totalFees;
  });
  return total;
}

function feesBetween(plan, from = 1, to = Infinity) {
  let total = 0;
  plan.schedule.forEach((p) => {
    if (p.month >= from && p.month <= to) total += p.totalFees;
  });
  return total;
}

function firstCleared(plan) {
  return plan.events.find((e) => e.type === 'cleared') ?? null;
}

/**
 * Every strategy on the same inputs, with `minimum` as the baseline.
 *
 * @returns {{ minimum, avalanche, snowball, lifetime, shortTerm, custom?,
 *   table: [{ strategy, months, debtFreeDate, totalInterest, totalFees, interestSavedVsMinimum, monthsSavedVsMinimum, firstPayoffMonth, firstPayoffId }],
 *   best: { byInterest, byDate, byFirstRelief } }}
 */
export function comparePlans(debts, options = {}) {
  const names = options.order?.length ? [...STRATEGIES, 'custom'] : STRATEGIES;
  const plans = {};
  names.forEach((strategy) => {
    plans[strategy] = simulatePlan(debts, { ...options, strategy });
  });
  const minimum = plans.minimum;
  const table = names.map((strategy) => {
    const plan = plans[strategy];
    const first = firstCleared(plan);
    return {
      strategy,
      months: plan.months,
      debtFreeDate: plan.debtFreeDate,
      totalInterest: plan.totalInterest,
      totalFees: plan.totalFees,
      interestSavedVsMinimum: minimum.totalInterest - plan.totalInterest,
      monthsSavedVsMinimum: minimum.months - plan.months,
      firstPayoffMonth: first?.month ?? null,
      firstPayoffId: first?.id ?? null,
    };
  });
  const candidates = table.filter((r) => r.strategy !== 'minimum');
  const pick = (score) => {
    let best = null;
    candidates.forEach((r) => {
      const value = score(r);
      if (value == null) return;
      if (!best || value < best.value) best = { strategy: r.strategy, value };
    });
    return best?.strategy ?? 'minimum';
  };
  return {
    ...plans,
    table,
    best: {
      byInterest: pick((r) => r.totalInterest),
      byDate: pick((r) => r.months),
      byFirstRelief: pick((r) => r.firstPayoffMonth ?? Infinity),
    },
  };
}

function rankBy(rows, key, desc = true) {
  const sorted = [...rows].sort((a, b) => (desc ? (b[key] ?? -Infinity) - (a[key] ?? -Infinity) : (a[key] ?? Infinity) - (b[key] ?? Infinity)));
  const rank = new Map();
  sorted.forEach((r, i) => rank.set(r.id, i + 1));
  return rank;
}

/**
 * What R`amount` is worth on each debt: the interest and fees it saves over the next `horizon`
 * months and over the whole run, as a single lump in month 1 and as the same amount every month.
 * Base and alternative runs share every setting — strategy, order, cascade, inflows, extra — and
 * differ only in that lump.
 *
 * Closed forms (nothing clearing inside the horizon, r_m the monthly rate): a lump X saves
 * X·((1+r_m)^12 − 1) in twelve months; X every month saves X·Σ_{j=1..12}((1+r_m)^j − 1).
 *
 * @returns [{ id, label, lump12, lumpLife, monthly12, monthlyLife, monthsSavedLump, monthsSavedMonthly,
 *             feeSavedLife, cashReliefMonths, reliefAmount, rank12, rankLife, rankSnowball, rankAvalanche }]
 */
export function marginalValue(debts, { amount = MARGINAL_AMOUNT_DEFAULT, horizon = MARGINAL_HORIZON_MONTHS, ...planOptions } = {}) {
  const base = simulatePlan(debts, planOptions);
  const baseLumps = planOptions.lumps ?? [];
  const baseRelief = firstCleared(base);
  const rows = base.order.map((id) => {
    const altLump = simulatePlan(debts, { ...planOptions, lumps: [...baseLumps, { month: 1, amount, targetId: id }] });
    const monthlyLumps = Array.from({ length: horizon }, (_, i) => ({ month: i + 1, amount, targetId: id }));
    const altMonthly = simulatePlan(debts, { ...planOptions, lumps: [...baseLumps, ...monthlyLumps] });
    const cleared = (plan) => plan.perDebt[id]?.clearedMonth ?? null;
    const saved = (a, b) => (a == null || b == null ? null : a - b);
    const altRelief = firstCleared(altLump);
    return {
      id,
      label: base.labels[id],
      lump12: costBetween(base, 1, horizon) - costBetween(altLump, 1, horizon),
      lumpLife: costBetween(base) - costBetween(altLump),
      monthly12: costBetween(base, 1, horizon) - costBetween(altMonthly, 1, horizon),
      monthlyLife: costBetween(base) - costBetween(altMonthly),
      monthsSavedLump: saved(cleared(base), cleared(altLump)),
      monthsSavedMonthly: saved(cleared(base), cleared(altMonthly)),
      feeSavedLife: feesBetween(base) - feesBetween(altLump),
      cashReliefMonths: saved(baseRelief?.month ?? null, altRelief?.month ?? null),
      reliefAmount: altRelief?.freed ?? null,
    };
  });
  const rank12 = rankBy(rows, 'lump12');
  const rankLife = rankBy(rows, 'lumpLife');
  const snowball = payoffOrder(debts, 'snowball');
  const avalanche = payoffOrder(debts, 'avalanche');
  return rows.map((r) => ({
    ...r,
    rank12: rank12.get(r.id),
    rankLife: rankLife.get(r.id),
    rankSnowball: snowball.indexOf(r.id) + 1,
    rankAvalanche: avalanche.indexOf(r.id) + 1,
  }));
}

/**
 * A lump of `amount` in period `month`, aimed at each debt in turn and at the strategy's current
 * target (`id: null`), against the same plan without it. A lump larger than its target clears it
 * and the remainder continues down the order the same period; `overflowTo` names where it went.
 *
 * @returns {{ rows: [{ id, label, interestSaved, interestSaved12, monthsSaved, debtFreeDate, firstReliefDate, overflowTo }],
 *             best12: id|null, bestLife: id|null }}
 */
export function lumpWhatIf(debts, { amount, month = 1, ...planOptions } = {}) {
  const base = simulatePlan(debts, planOptions);
  const baseLumps = planOptions.lumps ?? [];
  const targets = [...base.order, null];
  const rows = targets.map((target) => {
    const alt = simulatePlan(debts, { ...planOptions, lumps: [...baseLumps, { month, amount, targetId: target }] });
    const period = alt.schedule[month - 1];
    const basePeriod = base.schedule[month - 1];
    let overflowTo = null;
    if (target && period?.byDebt[target]?.cleared) {
      overflowTo =
        alt.order.find((id) => id !== target && (period.byDebt[id]?.extra ?? 0) > (basePeriod?.byDebt[id]?.extra ?? 0) + DEBT_EPS) ??
        null;
    }
    const relief = firstCleared(alt);
    return {
      id: target,
      label: target ? base.labels[target] : 'Current target',
      interestSaved: costBetween(base) - costBetween(alt),
      interestSaved12: costBetween(base, month, month + 11) - costBetween(alt, month, month + 11),
      monthsSaved: base.reachedCap || alt.reachedCap ? null : base.months - alt.months,
      debtFreeDate: alt.debtFreeDate,
      firstReliefDate: relief?.date ?? null,
      overflowTo,
    };
  });
  const bestOf = (key) => rows.reduce((best, r) => (!best || r[key] > best[key] ? r : best), null);
  return { rows, best12: bestOf('interestSaved12')?.id ?? null, bestLife: bestOf('interestSaved')?.id ?? null };
}

/**
 * The freed-cash story of a plan: each clearing as a step, what is committed each period, and
 * what is back in the household's pocket — under a cascade nothing until debt-free, then all of it.
 *
 * @returns {{ steps: [{ month, date, id, label, freed, cumulativeFreed, rolledTo }],
 *             committedByMonth: number[] (index = month), reliefByMonth: number[], finalRelief }}
 */
export function cascadeTimeline(plan) {
  const steps = plan.freedTimeline.map((f) => ({ ...f, label: plan.labels[f.id] }));
  const finalRelief = Object.values(plan.perDebt).reduce((s, d) => s + (d.scheduled ?? 0), 0);
  const length = plan.schedule.length + 1;
  const committedByMonth = new Array(length).fill(0);
  const reliefByMonth = new Array(length).fill(0);
  plan.schedule.forEach((p) => {
    committedByMonth[p.month] = p.totalPayment;
  });
  let freed = 0;
  let step = 0;
  for (let k = 1; k < length; k += 1) {
    while (step < steps.length && steps[step].month <= k) {
      freed = steps[step].cumulativeFreed;
      step += 1;
    }
    if (plan.cascade) reliefByMonth[k] = !plan.reachedCap && k >= plan.months ? finalRelief : 0;
    else reliefByMonth[k] = freed;
  }
  return { steps, committedByMonth, reliefByMonth, finalRelief };
}

/**
 * The plan under each rate shift (basis points, applied to rateVariable debts relative to their
 * observed rate), with the instalment held and with it recast to the same term.
 *
 * @returns [{ bp, recast, months, debtFreeDate, totalInterest, year1Interest, instalmentDelta: { [id]: ΔP }, neverClears: id[] }]
 */
export function rateSensitivity(debts, options = {}, shiftsBp = RATE_SENSITIVITY_SHIFTS_BP) {
  const rows = [];
  shiftsBp.forEach((bp) => {
    [false, true].forEach((recast) => {
      const plan = simulatePlan(debts, { ...options, rateShiftBp: bp, recast });
      rows.push({
        bp,
        recast,
        months: plan.months,
        debtFreeDate: plan.debtFreeDate,
        reachedCap: plan.reachedCap,
        totalInterest: plan.totalInterest,
        year1Interest: plan.schedule.slice(0, 12).reduce((s, p) => s + p.totalInterest, 0),
        instalmentDelta: plan.instalmentDelta,
        neverClears: plan.neverClears.map((n) => n.id),
      });
    });
  });
  return rows;
}

// ---- the budget -----------------------------------------------------------------------------------

/**
 * How much is honestly available for extra payments, and where the shortfall lands when there is
 * none. `surplus` is the more pessimistic of the average excluding exception rows and the plain
 * six-cycle mean including them; the deficit lands on the absorber card — the liability growing
 * fastest on `balanced`, else the largest card — as an inflow every period.
 *
 * @param processed  processTransactionData output (netAvg, months, currentMonth, totalsByMonth, nextPayDate)
 * @returns {{ surplus, surplusExcl, surplusIncl, adjusted, extraSchedule: number[], deficitPerCycle, breakEvenExtra,
 *             absorberId, absorberLabel, absorberRate, inflows: { [id]: number }, deficitCost12, limitMonth, limitDate,
 *             message, assumptions: string[] }}
 */
export function buildDebtBudget(processed, { monthlySaving = 0, cuts = 0, debts = [], balanced = [] } = {}) {
  const assumptions = [];
  const surplusExcl = Number.isFinite(processed?.netAvg) ? processed.netAvg : 0;
  const months = processed?.months ?? [];
  const prior = months.filter((m) => m !== processed?.currentMonth).slice(-DEBT_BUDGET_CYCLES);
  const totals = processed?.totalsByMonth ?? { Income: {}, Expense: {} };
  const surplusIncl = prior.length
    ? mean(prior.map((m) => (totals.Income?.[m] ?? 0) + (totals.Expense?.[m] ?? 0)))
    : surplusExcl;
  const surplus = Math.min(surplusExcl, surplusIncl);
  const adjusted = surplus + (monthlySaving ?? 0) + (cuts ?? 0);
  const extraSchedule = new Array(HORIZON_CAP).fill(Math.max(0, adjusted));
  const deficitPerCycle = Math.max(0, -adjusted);
  assumptions.push(`Surplus is the lower of ${fmt(surplusExcl)} (excluding one-offs) and ${fmt(surplusIncl)} (last ${prior.length || DEBT_BUDGET_CYCLES} cycles)`);
  if (monthlySaving) assumptions.push(`${fmt(monthlySaving)} a cycle of planned saving counted`);
  if (cuts) assumptions.push(`${fmt(cuts)} a cycle of cuts counted`);

  const cards = (debts ?? []).filter((d) => d.type === 'Credit Card' && Number.isFinite(d.balance));
  const cardIds = new Set(cards.map((d) => d.id));
  const absorberFromBalances = (balanced ?? [])
    .filter((b) => b.isLiability && b.typicalDelta < 0 && cardIds.has(b.accountId ?? accountIdOf(b.account)))
    .sort((a, b) => a.typicalDelta - b.typicalDelta)[0];
  const absorber = absorberFromBalances
    ? cards.find((d) => d.id === (absorberFromBalances.accountId ?? accountIdOf(absorberFromBalances.account)))
    : [...cards].sort((a, b) => b.balance - a.balance)[0] ?? null;
  // With no card balance typed there is no absorber to name, but the gap still costs money: it
  // goes onto a card somewhere, and a card rate is the one default worth assuming for the figure.
  const absorberRate = absorber?.rateNominal ?? DEFAULT_RATE_BY_KIND.card;
  const rM = monthlyRate(absorberRate ?? 0);
  const inflows = absorber && deficitPerCycle > 0 ? { [absorber.id]: deficitPerCycle } : {};
  const deficitCost12 = deficitPerCycle > 0 ? 78 * deficitPerCycle * rM : 0;
  if (absorber && deficitPerCycle > 0) {
    assumptions.push(`Deficit of ${fmt(deficitPerCycle)} a cycle lands on the ${absorber.label} at ${pct(absorberRate)}`);
  } else if (deficitPerCycle > 0) {
    assumptions.push(
      `No card balance is typed, so the cost of the gap assumes a card at ${pct(absorberRate)} — type a card balance and rate to replace it`,
    );
  }

  let limitMonth = null;
  let limitDate = null;
  if (absorber && deficitPerCycle > 0) {
    const plan = simulatePlan(debts, {
      strategy: 'minimum',
      inflows,
      horizon: 120,
      currentMonth: processed?.currentMonth ?? null,
      nextPayDate: processed?.nextPayDate ?? null,
    });
    const limit = plan.events.find((e) => e.type === 'limit' && e.id === absorber.id);
    if (limit) {
      limitMonth = limit.month;
      limitDate = limit.date;
    }
  }

  let message;
  if (deficitPerCycle > 0) {
    message = absorber
      ? `You are ${fmt(deficitPerCycle)} a cycle short. That lands on the ${absorber.label} and costs about ${fmt(deficitCost12)} in interest over the next year. The plans below assume no extra payments until the gap closes.`
      : `You are ${fmt(deficitPerCycle)} a cycle short. The plans below assume no extra payments until the gap closes.`;
  } else if (monthlySaving > 0) {
    message = `After the ${fmt(monthlySaving)} you plan to save, ${fmt(adjusted)} a cycle is available for extra payments.`;
  } else {
    message = `${fmt(adjusted)} a cycle is available for extra payments.`;
  }

  return {
    surplus,
    surplusExcl,
    surplusIncl,
    adjusted,
    extraSchedule,
    deficitPerCycle,
    breakEvenExtra: deficitPerCycle,
    absorberId: absorber?.id ?? null,
    absorberLabel: absorber?.label ?? null,
    absorberRate,
    inflows,
    deficitCost12,
    limitMonth,
    limitDate,
    message,
    assumptions,
  };
}
