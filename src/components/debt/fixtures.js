/**
 * Synthetic Debt-view data, shaped exactly like §3.1's LiabilityTerms / Debt / PlanResult /
 * MarginalRow / SensitivityRow / DebtBudget — for the render tests and for a first look at the
 * view before the real engine lands. Nothing here is real: round balances, invented labels.
 *
 * It carries a miniature plan engine (`fixtureEngine`) that implements §3.1.2's period model
 * faithfully enough for the shapes to be honest — extra, lumps and inflows on day 0, interest on
 * the balance after them, the scheduled payment last, freed instalments cascading from the next
 * period — so the charts and tables render from a schedule that actually amortises rather than
 * from hand-typed rows. It is NOT the library and makes no claim to its precision.
 */

const HORIZON = 600;
const EPS = 0.005;
const CARD_FLOOR = 50;
const CURRENT_MONTH = '2026-08';
const NEXT_PAY = new Date(2026, 7, 23);
const AS_OF = new Date(2026, 7, 22);
const SHIFTS = [-100, -50, -25, 0, 25, 50, 100];

// ---- calendar ---------------------------------------------------------------------------------

export function addCycles(date, n) {
  const d = new Date(date);
  const day = d.getDate();
  d.setDate(1);
  d.setMonth(d.getMonth() + n);
  const last = new Date(d.getFullYear(), d.getMonth() + 1, 0).getDate();
  d.setDate(Math.min(day, last));
  return d;
}

function addMonthsToKey(key, n) {
  const [y, m] = key.split('-').map(Number);
  const d = new Date(y, m - 1 + n, 1);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
}

// ---- maths ------------------------------------------------------------------------------------

export function annuity(balance, rM, n) {
  if (n <= 0) return 0;
  if (rM === 0) return balance / n;
  return (balance * rM) / (1 - (1 + rM) ** -n);
}

function remainingTerm(balance, rateNominal, instalment, fee = 0) {
  const rM = rateNominal / 12;
  const p = instalment - fee;
  if (rM === 0) return p > 0 ? balance / p : Infinity;
  const x = (rM * balance) / p;
  if (p <= rM * balance) return Infinity;
  return -Math.log(1 - x) / Math.log(1 + rM);
}

const feeAdjusted = (d) => d.rateNominal + (12 * (d.feeMonthly ?? 0)) / d.balance;

// ---- the miniature engine ---------------------------------------------------------------------

function payoffOrder(debts, strategy, order) {
  const avalanche = debts
    .slice()
    .sort((a, b) => b.rateNominal - a.rateNominal || a.balance - b.balance)
    .map((d) => d.id);
  switch (strategy) {
    case 'minimum':
      return debts.map((d) => d.id);
    case 'snowball':
      return debts
        .slice()
        .sort((a, b) => a.balance - b.balance)
        .map((d) => d.id);
    case 'lifetime':
      return debts
        .slice()
        .sort((a, b) => feeAdjusted(b) - feeAdjusted(a))
        .map((d) => d.id);
    case 'custom': {
      const known = (order ?? []).filter((id) => debts.some((d) => d.id === id));
      return [...known, ...avalanche.filter((id) => !known.includes(id))];
    }
    default:
      return avalanche;
  }
}

const seq = (v, k) => {
  const arr = [].concat(v ?? 0);
  return arr[Math.min(k - 1, arr.length - 1)] ?? 0;
};

export function simulatePlan(debts, options = {}) {
  const {
    strategy = 'avalanche',
    order,
    lumps = [],
    inflows = {},
    rateShiftBp = 0,
    recast = false,
    horizon = HORIZON,
    currentMonth = CURRENT_MONTH,
    nextPayDate = NEXT_PAY,
  } = options;
  const minimum = strategy === 'minimum';
  const extraPerMonth = minimum ? 0 : (options.extraPerMonth ?? 0);
  const lumpList = minimum ? [] : lumps;
  const cascade = minimum ? false : (options.cascade ?? true);

  const live = debts.filter((d) => Number.isFinite(d.balance) && d.balance > 0);
  const excluded = debts
    .filter((d) => !live.includes(d))
    .map((d) => ({ id: d.id, label: d.label, reason: 'no balance', missing: ['balance'] }));
  const ids = payoffOrder(live, strategy, order);

  const state = {};
  for (const d of live) {
    const rM = Math.max(0, d.rateNominal + (d.rateVariable ? rateShiftBp / 10000 : 0)) / 12;
    let scheduled = d.instalment ?? null;
    if (scheduled != null && recast && rateShiftBp !== 0 && Number.isFinite(d.remainingMonths)) {
      scheduled = annuity(d.balance, rM, d.remainingMonths) + (d.feeMonthly ?? 0);
    }
    state[d.id] = {
      debt: d,
      balance: d.balance,
      rM,
      scheduled,
      cleared: false,
      interest: 0,
      fees: 0,
      paid: 0,
      extra: 0,
      clearedMonth: null,
      clearedDate: null,
      neverClears: false,
      limitHit: false,
    };
  }

  const schedule = [];
  const events = [];
  const freedTimeline = [];
  const neverClears = [];
  let freedPool = 0;
  let cumulativeFreed = 0;
  let months = 0;
  let debtFreeDate = null;
  let reachedCap = false;
  let totalInterest = 0;
  let totalFees = 0;
  let totalPaid = 0;
  let totalExtra = 0;

  for (let k = 1; k <= horizon; k++) {
    const date = addCycles(nextPayDate, k - 1);
    const payMonth = addMonthsToKey(currentMonth, k);
    let pool =
      seq(extraPerMonth, k) +
      lumpList.filter((l) => l.month === k && l.targetId == null).reduce((s, l) => s + l.amount, 0) +
      (cascade ? freedPool : 0);
    const periodPool = pool;
    const byDebt = {};
    let totalPayment = 0;
    let periodInterest = 0;
    let periodFees = 0;
    let periodExtra = 0;
    let debtTotal = 0;
    let freedNow = 0;

    for (const id of ids) {
      const s = state[id];
      if (s.cleared) {
        byDebt[id] = { open: 0, extra: 0, inflow: 0, interest: 0, fee: 0, payment: 0, principal: 0, close: 0, cleared: true };
        continue;
      }
      const d = s.debt;
      const isCard = s.scheduled == null;
      const minimumOf = (b) => Math.max(CARD_FLOOR, ((d.minimumPct ?? 5) / 100) * b);
      const scheduledOf = (b) => (isCard ? Math.max(minimumOf(b), d.plannedPayment ?? 0) : s.scheduled);
      const targeted = lumpList.filter((l) => l.month === k && l.targetId === id).reduce((a, l) => a + l.amount, 0);
      const extraI = pool + targeted;
      const inflow = seq(inflows[id], k);
      const applied = Math.min(extraI, s.balance);
      pool = extraI - applied;
      const open = s.balance;
      const B = s.balance - applied + inflow;
      let row;
      let freed = 0;

      if (B <= EPS) {
        row = { open, extra: applied, inflow, interest: 0, fee: 0, payment: 0, principal: 0, close: 0, cleared: true };
        pool += scheduledOf(open);
        freed = isCard ? (d.plannedPayment ?? minimumOf(open)) : s.scheduled;
      } else {
        const I = s.rM * B;
        const fee = d.feeMonthly ?? 0;
        const balloon = d.balloon > 0 && k === d.termMonths ? d.balloon : 0;
        const due = B + I + fee + balloon;
        const scheduled = scheduledOf(B);
        const pay = Math.min(scheduled, due);
        const close = due - pay;
        const cleared = close <= EPS;
        if (scheduled - fee <= I && extraI === 0 && !s.neverClears) {
          s.neverClears = true;
          const m = Math.ceil(I + fee + 1);
          neverClears.push({ id, minimumToClear: m });
          events.push({ type: 'neverClears', id, month: k, date, amount: m });
        }
        row = { open, extra: applied, inflow, interest: I, fee, payment: pay, principal: pay - I - fee, close: cleared ? 0 : close, cleared };
        s.interest += I;
        s.fees += fee;
        s.paid += pay;
        periodInterest += I;
        periodFees += fee;
        totalPayment += pay;
        if (cleared) {
          pool += scheduled - pay;
          freed = isCard ? (d.plannedPayment ?? minimumOf(open)) : s.scheduled;
        }
        if (balloon > 0) events.push({ type: 'balloon', id, month: k, date, amount: balloon, unfunded: pay < due });
        if (d.creditLimit && close > d.creditLimit && !s.limitHit) {
          s.limitHit = true;
          events.push({ type: 'limit', id, month: k, date, amount: d.creditLimit });
        }
      }

      if (row.cleared) {
        s.cleared = true;
        s.clearedMonth = k;
        s.clearedDate = date;
        freedNow += freed;
        events.push({ type: 'cleared', id, month: k, date, amount: freed, freed });
      }
      s.extra += applied;
      periodExtra += applied;
      s.balance = row.close;
      debtTotal += row.close;
      byDebt[id] = row;
    }

    if (freedNow > 0) {
      freedPool += freedNow;
      cumulativeFreed += freedNow;
      const next = ids.find((id) => !state[id].cleared) ?? null;
      for (const e of events.filter((x) => x.type === 'cleared' && x.month === k)) {
        if (cascade && next) events.push({ type: 'rolled', id: e.id, from: e.id, to: next, month: k, date, amount: e.freed });
      }
      freedTimeline.push({ month: k, date, freed: freedNow, cumulativeFreed, rolledTo: cascade ? next : null });
    }

    totalInterest += periodInterest;
    totalFees += periodFees;
    totalPaid += totalPayment + periodExtra;
    totalExtra += periodExtra;
    schedule.push({ month: k, payMonth, date, pool: periodPool, totalPayment, totalInterest: periodInterest, totalFees: periodFees, debtTotal, byDebt });

    if (ids.every((id) => state[id].cleared)) {
      months = k;
      debtFreeDate = date;
      break;
    }
    if (k === horizon) {
      months = horizon;
      reachedCap = true;
    }
  }

  const perDebt = Object.fromEntries(
    ids.map((id) => {
      const s = state[id];
      return [id, { clearedMonth: s.clearedMonth, clearedDate: s.clearedDate, interest: s.interest, fees: s.fees, paid: s.paid, extra: s.extra }];
    }),
  );

  const assumptions = [];
  for (const d of live) if (d.source?.rate === 'default') assumptions.push(`${d.label} rate ${(d.rateNominal * 100).toFixed(2)}% (default)`);
  for (const [id, v] of Object.entries(inflows)) {
    const amount = seq(v, 1);
    const d = live.find((x) => x.id === id);
    if (d && amount > 0) assumptions.push(`Deficit of R${Math.round(amount).toLocaleString('en-ZA')} a cycle lands on the ${d.label}`);
  }

  return {
    strategy,
    order: ids,
    horizon,
    cap: HORIZON,
    months,
    debtFreeDate,
    reachedCap,
    neverClears,
    totalInterest,
    totalFees,
    totalPaid,
    totalExtra,
    schedule,
    perDebt,
    events,
    freedTimeline,
    excluded,
    assumptions,
  };
}

const STRATEGIES = ['minimum', 'avalanche', 'snowball', 'lifetime', 'shortTerm'];

export function comparePlans(debts, options = {}) {
  const out = {};
  const names = options.order ? [...STRATEGIES, 'custom'] : STRATEGIES;
  for (const strategy of names) out[strategy] = simulatePlan(debts, { ...options, strategy });
  const base = out.minimum;
  const table = names.map((strategy) => {
    const p = out[strategy];
    const first = p.events.filter((e) => e.type === 'cleared').sort((a, b) => a.month - b.month)[0];
    return {
      strategy,
      months: p.months,
      debtFreeDate: p.debtFreeDate,
      totalInterest: p.totalInterest,
      totalFees: p.totalFees,
      interestSavedVsMinimum: base.totalInterest + base.totalFees - (p.totalInterest + p.totalFees),
      monthsSavedVsMinimum: base.reachedCap || p.reachedCap ? null : base.months - p.months,
      firstPayoffMonth: first?.month ?? null,
      firstPayoffId: first?.id ?? null,
    };
  });
  const pick = (key, dir = 1) =>
    table
      .filter((r) => r.strategy !== 'minimum' && r[key] != null)
      .sort((a, b) => dir * (a[key] - b[key]))[0]?.strategy ?? 'avalanche';
  const best = {
    byInterest: pick('totalInterest'),
    byDate: pick('months'),
    byFirstRelief: pick('firstPayoffMonth'),
  };
  return { ...out, table, best };
}

const costTo = (plan, upto) =>
  plan.schedule.slice(0, upto).reduce((s, p) => s + p.totalInterest + p.totalFees, 0);
const firstFreed = (plan) => plan.freedTimeline[0] ?? null;

export function marginalValue(debts, { amount = 1000, horizon = 12, ...planOptions } = {}) {
  const base = simulatePlan(debts, planOptions);
  const live = debts.filter((d) => Number.isFinite(d.balance) && d.balance > 0);
  const lumps = planOptions.lumps ?? [];
  const rows = live.map((d) => {
    const altLump = simulatePlan(debts, { ...planOptions, lumps: [...lumps, { month: 1, amount, targetId: d.id }] });
    const every = Array.from({ length: horizon }, (_, i) => ({ month: i + 1, amount, targetId: d.id }));
    const altMonthly = simulatePlan(debts, { ...planOptions, lumps: [...lumps, ...every] });
    const bc = base.perDebt[d.id]?.clearedMonth ?? null;
    const lc = altLump.perDebt[d.id]?.clearedMonth ?? null;
    const mc = altMonthly.perDebt[d.id]?.clearedMonth ?? null;
    const bf = firstFreed(base);
    const af = firstFreed(altLump);
    return {
      id: d.id,
      label: d.label,
      lump12: costTo(base, horizon) - costTo(altLump, horizon),
      lumpLife: costTo(base, Infinity) - costTo(altLump, Infinity),
      monthly12: costTo(base, horizon) - costTo(altMonthly, horizon),
      monthlyLife: costTo(base, Infinity) - costTo(altMonthly, Infinity),
      monthsSavedLump: bc != null && lc != null ? bc - lc : null,
      monthsSavedMonthly: bc != null && mc != null ? bc - mc : null,
      feeSavedLife: (base.perDebt[d.id]?.fees ?? 0) - (altLump.perDebt[d.id]?.fees ?? 0),
      cashReliefMonths: bf && af ? bf.month - af.month : null,
      reliefAmount: af?.freed ?? null,
    };
  });
  const rank = (key) => {
    const sorted = rows.slice().sort((a, b) => b[key] - a[key]);
    return Object.fromEntries(sorted.map((r, i) => [r.id, i + 1]));
  };
  const r12 = rank('lump12');
  const rLife = rank('lumpLife');
  const snow = payoffOrder(live, 'snowball');
  const aval = payoffOrder(live, 'avalanche');
  return rows.map((r) => ({
    ...r,
    rank12: r12[r.id],
    rankLife: rLife[r.id],
    rankSnowball: snow.indexOf(r.id) + 1,
    rankAvalanche: aval.indexOf(r.id) + 1,
  }));
}

export function lumpWhatIf(debts, { amount, month = 1, ...planOptions } = {}) {
  const base = simulatePlan(debts, planOptions);
  const live = debts.filter((d) => Number.isFinite(d.balance) && d.balance > 0);
  const targets = [...live.map((d) => d.id), null];
  const lumps = planOptions.lumps ?? [];
  const rows = targets.map((id) => {
    const alt = simulatePlan(debts, { ...planOptions, lumps: [...lumps, { month, amount, targetId: id }] });
    const bc = id == null ? base.months : (base.perDebt[id]?.clearedMonth ?? null);
    const ac = id == null ? alt.months : (alt.perDebt[id]?.clearedMonth ?? null);
    const overflow = id == null ? null : (alt.events.find((e) => e.type === 'rolled' && e.from === id && e.month === month)?.to ?? null);
    return {
      id,
      label: id == null ? 'the plan’s current target' : live.find((d) => d.id === id).label,
      interestSaved: costTo(base, Infinity) - costTo(alt, Infinity),
      interestSaved12: costTo(base, 12) - costTo(alt, 12),
      monthsSaved: bc != null && ac != null ? bc - ac : null,
      debtFreeDate: alt.debtFreeDate,
      firstReliefDate: firstFreed(alt)?.date ?? null,
      overflowTo: overflow,
    };
  });
  const best = (key) => rows.slice().sort((a, b) => b[key] - a[key])[0]?.id ?? null;
  return { rows, best12: best('interestSaved12'), bestLife: best('interestSaved') };
}

export function cascadeTimeline(plan) {
  const committedByMonth = [0];
  const reliefByMonth = [0];
  const finalRelief = Object.values(plan.schedule[0]?.byDebt ?? {}).reduce((s, b) => s + b.payment, 0);
  let cumulative = 0;
  let fi = 0;
  const freed = plan.freedTimeline;
  const cascade = plan.events.some((e) => e.type === 'rolled');
  for (const s of plan.schedule) {
    committedByMonth[s.month] = Object.values(s.byDebt).reduce((sum, b) => sum + b.payment, 0);
    while (fi < freed.length && freed[fi].month <= s.month) cumulative = freed[fi++].cumulativeFreed;
    reliefByMonth[s.month] = cascade ? (s.month >= plan.months && !plan.reachedCap ? finalRelief : 0) : cumulative;
  }
  const steps = plan.events
    .filter((e) => e.type === 'cleared')
    .map((e) => {
      const f = freed.find((x) => x.month === e.month);
      return { month: e.month, date: e.date, id: e.id, freed: e.freed, cumulativeFreed: f?.cumulativeFreed ?? null, rolledTo: f?.rolledTo ?? null };
    });
  return { steps, committedByMonth, reliefByMonth, finalRelief };
}

export function rateSensitivity(debts, options = {}, shiftsBp = SHIFTS) {
  const rows = [];
  for (const bp of shiftsBp) {
    for (const recast of [false, true]) {
      const plan = simulatePlan(debts, { ...options, rateShiftBp: bp, recast });
      const instalmentDelta = {};
      for (const d of debts) {
        if (!d.rateVariable || d.instalment == null) continue;
        const rM = Math.max(0, d.rateNominal + bp / 10000) / 12;
        instalmentDelta[d.id] =
          recast && bp !== 0 && Number.isFinite(d.remainingMonths)
            ? annuity(d.balance, rM, d.remainingMonths) + (d.feeMonthly ?? 0) - d.instalment
            : 0;
      }
      rows.push({
        bp,
        recast,
        months: plan.months,
        debtFreeDate: plan.debtFreeDate,
        totalInterest: plan.totalInterest,
        year1Interest: plan.schedule.slice(0, 12).reduce((s, p) => s + p.totalInterest, 0),
        instalmentDelta,
        neverClears: plan.neverClears.map((n) => n.id),
      });
    }
  }
  return rows;
}

export const fixtureEngine = { comparePlans, marginalValue, lumpWhatIf, rateSensitivity, cascadeTimeline };

// ---- the liabilities ---------------------------------------------------------------------------

const d = (y, m, day) => new Date(y, m - 1, day);

function loanTerms({ accountId, label, kind, balance, rate, instalment, fee, feeItems, postings, balanceSource, confidence, variable, extra = {} }) {
  const remaining = remainingTerm(balance, rate, instalment, fee);
  const rM = rate / 12;
  const clearWithin = (n) => Math.max(0, annuity(balance, rM, n) + fee - instalment);
  return {
    accountId,
    label,
    type: 'Loan',
    kind,
    external: false,
    balanceOwed: balance,
    balanceSource,
    balanceAsOf: d(2026, 8, 20),
    rateNominal: rate,
    rateEffective: (1 + rM) ** 12 - 1,
    rateSource: balanceSource === 'regression' ? 'regression' : 'inferred',
    rateVariable: variable,
    margin: null,
    rateHistory: Array.from({ length: Math.min(postings, 6) }, (_, i) => ({
      date: d(2026, 8 - i, 5),
      days: 30,
      interest: (balance * rate * 30) / 365,
      balanceBefore: balance,
      rate: rate + (variable ? (i % 2 ? 0.0004 : -0.0003) : 0),
    })),
    rateSpread: variable ? 0.0007 : 0.0002,
    rateLowerBound: null,
    instalment,
    instalmentSource: 'paired',
    instalmentChanged: false,
    instalmentDay: 25,
    instalmentHistory: [{ from: '2025-09', amount: instalment, count: postings }],
    payingAccountId: 'ex|cheque',
    payingCategory: kind === 'bond' ? 'Home Loan / Bond' : kind === 'vehicle' ? 'Vehicle Loan / Car Loan' : 'Personal Loan',
    typicalRepayment: null,
    repaymentDay: null,
    feeMonthly: fee,
    feeSource: 'inferred',
    feeItems,
    initiationFee: 0,
    feeAdjustedRate: rate + (12 * fee) / balance,
    extraToClearWithin: { 6: Math.round(clearWithin(6)), 12: Math.round(clearWithin(12)), 24: Math.round(clearWithin(24)) },
    minimumPct: null,
    budget: null,
    payInFull: null,
    financeChargeMonthly: null,
    balloon: null,
    termMonths: null,
    termSource: 'inferred',
    remainingMonths: remaining,
    totalTermMonths: Number.isFinite(remaining) ? Math.ceil(remaining) + postings : null,
    neverClears: remaining === Infinity,
    minimumToClear: remaining === Infinity ? Math.ceil(rM * balance + fee + 1) : null,
    disbursementDate: balanceSource === 'ledger' ? d(2024, 9, 5) : null,
    lastPostingDate: d(2026, 8, 5),
    nextPostingDate: d(2026, 9, 5),
    accruedThisCycle: (balance * rate * 31) / 365,
    postings,
    confidence,
    warnings: [],
    assumptions: [
      balanceSource === 'regression'
        ? `Balance fitted from ${postings} interest postings (R² 0.99)`
        : `Rate inferred from ${postings} interest postings (ACT/365)`,
    ],
    ...extra,
  };
}

export const fixtureTerms = [
  loanTerms({
    accountId: 'ex|bond',
    label: 'Example Bond',
    kind: 'bond',
    balance: 1850000,
    rate: 0.0945,
    instalment: 16400,
    fee: 69,
    feeItems: [{ label: 'service fee', amount: 69 }],
    postings: 24,
    balanceSource: 'ledger',
    confidence: 'high',
    variable: true,
  }),
  loanTerms({
    accountId: 'ex|flat',
    label: 'Example Flat Bond',
    kind: 'bond',
    balance: 420000,
    rate: 0.096,
    instalment: 4600,
    fee: 69,
    feeItems: [{ label: 'service fee', amount: 69 }],
    postings: 18,
    balanceSource: 'ledger',
    confidence: 'high',
    variable: true,
  }),
  loanTerms({
    accountId: 'ex|car',
    label: 'Example Vehicle',
    kind: 'vehicle',
    balance: 61000,
    rate: 0.095,
    instalment: 4300,
    fee: 69,
    feeItems: [{ label: 'service fee', amount: 69 }],
    postings: 12,
    balanceSource: 'regression',
    confidence: 'medium',
    variable: false,
    extra: { r2: 0.995 },
  }),
  loanTerms({
    accountId: 'ex|loan',
    label: 'Example Personal Loan',
    kind: 'personal',
    balance: 132000,
    rate: 0.172,
    instalment: 4400,
    fee: 520,
    feeItems: [
      { label: 'nca service fee', amount: 69 },
      { label: 'cpp insurance premium', amount: 451 },
    ],
    postings: 9,
    balanceSource: 'ledger',
    confidence: 'high',
    variable: false,
    extra: { warnings: ['Typed rate differs from the inferred 16.9% by 0.3 pp'], rateSource: 'user' },
  }),
  {
    accountId: 'ex|card',
    label: 'Example Card',
    type: 'Credit Card',
    kind: 'card',
    external: false,
    balanceOwed: 48000,
    balanceSource: 'statement',
    balanceAsOf: d(2026, 8, 20),
    rateNominal: 0.2075,
    rateEffective: 0.2284,
    rateSource: 'default',
    rateVariable: false,
    margin: null,
    rateHistory: [],
    rateSpread: null,
    rateLowerBound: 0.2075,
    instalment: null,
    instalmentSource: null,
    instalmentChanged: false,
    instalmentDay: null,
    instalmentHistory: [],
    payingAccountId: 'ex|cheque',
    payingCategory: null,
    typicalRepayment: 6000,
    repaymentDay: 26,
    feeMonthly: 400,
    feeSource: 'inferred',
    feeItems: [
      { label: 'monthly account fee', amount: 99 },
      { label: 'cpp insurance', amount: 301 },
    ],
    initiationFee: 0,
    feeAdjustedRate: 0.2075 + (12 * 400) / 48000,
    extraToClearWithin: { 6: 8300, 12: 4200, 24: 2100 },
    minimumPct: 5,
    budget: { instalment: 1200, interestMonthly: 310 },
    payInFull: false,
    financeChargeMonthly: 830,
    balloon: null,
    termMonths: null,
    termSource: 'inferred',
    remainingMonths: 9.4,
    totalTermMonths: null,
    neverClears: false,
    minimumToClear: null,
    disbursementDate: null,
    lastPostingDate: d(2026, 8, 3),
    nextPostingDate: d(2026, 9, 3),
    accruedThisCycle: 830,
    postings: 6,
    confidence: 'low',
    warnings: [],
    assumptions: ['Card rate 20.75% (default)'],
  },
  {
    accountId: 'ex|store',
    label: 'Example Store Card',
    type: 'Credit Card',
    kind: 'card',
    external: true,
    balanceOwed: null,
    balanceSource: null,
    balanceAsOf: null,
    rateNominal: 0.2075,
    rateEffective: null,
    rateSource: 'default',
    rateVariable: false,
    margin: null,
    rateHistory: [],
    rateSpread: null,
    rateLowerBound: null,
    instalment: null,
    instalmentSource: null,
    instalmentChanged: false,
    instalmentDay: null,
    instalmentHistory: [],
    payingAccountId: null,
    payingCategory: null,
    typicalRepayment: null,
    repaymentDay: null,
    feeMonthly: null,
    feeSource: 'inferred',
    feeItems: [],
    initiationFee: 0,
    feeAdjustedRate: null,
    extraToClearWithin: {},
    minimumPct: 5,
    budget: null,
    payInFull: null,
    financeChargeMonthly: null,
    balloon: null,
    termMonths: null,
    termSource: 'inferred',
    remainingMonths: null,
    totalTermMonths: null,
    neverClears: false,
    minimumToClear: null,
    disbursementDate: null,
    lastPostingDate: null,
    nextPostingDate: null,
    accruedThisCycle: null,
    postings: 0,
    confidence: 'low',
    warnings: [],
    assumptions: ['Card rate 20.75% (default)'],
  },
];

export function toDebt(t) {
  if (!Number.isFinite(t.balanceOwed)) return null;
  return {
    id: t.accountId,
    label: t.label,
    type: t.type,
    kind: t.kind,
    balance: t.balanceOwed,
    rateNominal: t.rateNominal,
    rateVariable: t.rateVariable,
    instalment: t.instalment,
    feeMonthly: t.feeMonthly ?? 0,
    plannedPayment: t.typicalRepayment,
    minimumPct: t.minimumPct,
    creditLimit: t.accountId === 'ex|card' ? 90000 : null,
    balloon: t.balloon,
    termMonths: t.termMonths,
    remainingMonths: t.remainingMonths,
    confidence: t.confidence,
    source: { balance: t.balanceSource, rate: t.rateSource, instalment: t.instalmentSource },
    assumptions: t.assumptions,
  };
}

export const fixtureDebts = fixtureTerms.map(toDebt).filter(Boolean);

export const fixtureAccounts = [
  { id: 'ex|cheque', bank: 'Example', type: 'Bank', label: 'Example Cheque', mask: '1825', currentBalance: 1761, balanceAsOf: '2026-08-20', source: 'statement' },
  { id: 'ex|bond', bank: 'Example', type: 'Loan', label: 'Example Bond', mask: '2801', currentBalance: null, interestRate: null, termMonths: null, feesMonthly: null, source: 'csv' },
  { id: 'ex|flat', bank: 'Example', type: 'Loan', label: 'Example Flat Bond', mask: '6996', source: 'csv' },
  { id: 'ex|car', bank: 'Example', type: 'Loan', label: 'Example Vehicle', mask: '4081', balloon: null, source: 'csv' },
  { id: 'ex|loan', bank: 'Example', type: 'Loan', label: 'Example Personal Loan', mask: '1143', interestRate: 17.2, source: 'csv' },
  { id: 'ex|card', bank: 'Example', type: 'Credit Card', label: 'Example Card', mask: '4714', currentBalance: -48000, balanceAsOf: '2026-08-20', creditLimit: 90000, minimumPayment: null, source: 'statement', statementName: 'Example Platinum Card' },
  { id: 'ex|store', bank: 'Example', type: 'Credit Card', label: 'Example Store Card', mask: '0001', external: true, source: 'manual' },
];

// ---- budget, plans, marginal, sensitivity, rate steps ------------------------------------------

const DEFICIT = 9500;
const ABSORBER = 'ex|card';
const fixtureInflows = { [ABSORBER]: DEFICIT };
const basePlanOptions = { strategy: 'avalanche', extraPerMonth: 0, inflows: fixtureInflows, cascade: true, currentMonth: CURRENT_MONTH, nextPayDate: NEXT_PAY };

const limitRun = simulatePlan(fixtureDebts, basePlanOptions);
const limitEvent = limitRun.events.find((e) => e.type === 'limit' && e.id === ABSORBER) ?? null;

export const fixtureDebtBudget = {
  surplus: -DEFICIT,
  surplusExcl: -DEFICIT,
  surplusIncl: -9100,
  adjusted: -DEFICIT,
  extraSchedule: Array.from({ length: 12 }, () => 0),
  deficitPerCycle: DEFICIT,
  breakEvenExtra: DEFICIT,
  absorberId: ABSORBER,
  absorberLabel: 'Example Card',
  absorberRate: 0.2075,
  deficitCost12: 78 * DEFICIT * (0.2075 / 12),
  limitMonth: limitEvent?.month ?? null,
  limitDate: limitEvent?.date ?? null,
  assumptions: ['Surplus is the smaller of the 6-cycle mean with and without one-off rows'],
};

export const fixtureSurplusBudget = {
  surplus: 3000,
  surplusExcl: 3000,
  surplusIncl: 3400,
  adjusted: 3000,
  extraSchedule: Array.from({ length: 12 }, () => 3000),
  deficitPerCycle: 0,
  breakEvenExtra: 0,
  absorberId: null,
  absorberLabel: null,
  absorberRate: null,
  deficitCost12: 0,
  limitMonth: null,
  limitDate: null,
  assumptions: [],
};

export const fixturePlanOptions = { inflows: fixtureInflows, currentMonth: CURRENT_MONTH, nextPayDate: NEXT_PAY };
export const fixturePlans = comparePlans(fixtureDebts, basePlanOptions);
export const fixtureMarginal = marginalValue(fixtureDebts, { ...basePlanOptions, amount: 1000, horizon: 12 });
export const fixtureSensitivity = rateSensitivity(fixtureDebts, basePlanOptions);

export const fixtureRateSteps = [
  { id: 'step-1', accountId: 'ex|bond', date: d(2026, 2, 5), from: 0.092, to: 0.0945, kind: 'rateStep' },
  { id: 'step-2', accountId: 'ex|flat', date: d(2026, 3, 5), from: 0.0935, to: 0.096, kind: 'termDrift' },
];

export const fixtureAsOf = AS_OF;

/** A fake settings object: reads return the fallback (or a seeded value), writes are recorded. */
export function fakeSettings(seed = {}) {
  const store = { ...seed };
  const writes = [];
  return {
    get: (key, fallback = null) => (store[key] == null ? fallback : store[key]),
    set: (key, value) => {
      store[key] = value;
      writes.push([key, value]);
    },
    ready: true,
    settings: store,
    writes,
  };
}

/** Everything DebtView takes, in one spread. */
export function fixtureProps(overrides = {}) {
  return {
    terms: fixtureTerms,
    debts: fixtureDebts,
    debtBudget: fixtureDebtBudget,
    plans: fixturePlans,
    marginal: fixtureMarginal,
    sensitivity: fixtureSensitivity,
    rateSteps: fixtureRateSteps,
    accounts: fixtureAccounts,
    settings: fakeSettings(),
    onPatchAccount: () => {},
    onOpenPlan: () => {},
    onOpenAccounts: () => {},
    asOf: AS_OF,
    ...overrides,
  };
}
