import {
  AMOUNT_CLUSTER_MIN_GAP,
  AMOUNT_CLUSTER_TOLERANCE,
  CONFIDENCE_HIGH,
  CONFIDENCE_MEDIUM,
  LAPSED_GAP_FACTOR,
  LAPSED_IRREGULAR_DAYS,
  LOAN_CATEGORIES,
  PRICE_BASE_REGIME_MIN,
  PRICE_STEP_MIN_PCT,
  PRICE_STEP_MIN_RAND,
  RECURRING_MIN_PRESENCE_MONTHLY,
  RECURRING_MIN_PRESENCE_WEEKLY,
  RECURRING_PRESENCE_WINDOW,
  REGIME_CHAIN_MAX_GAP_DAYS,
  STATUS_LANDED_WINDOW_DAYS,
  STATUS_OVERDUE_GRACE_DAYS,
} from '../constants';
import { parseTransactionDate } from '../utils/date';
import { accountIdOf } from './accounts';
import { classifyCadence, dayOfMonthMode, nextExpected, stepForward } from './cadence';
import { completeMonths, cycleKeyOf, spendRows } from './flows';
import {
  isPersonPayment,
  merchantKeyOf,
  merchantLabel,
  mergePrefixKeys,
  PERSON_LABEL,
} from './merchants';
import { isRegularAmount } from './missedPayments';
import { spendingGroupOf } from './spendingGroups';
import { providerOf } from './providers';
import { dispersion, median, mode, quantile } from './stats';

/**
 * THE recurring-charge engine.
 *
 * Everything the app says about things that repeat — the subscriptions audit, price creep, new
 * and lapsed charges, the bills calendar, overdue detection, cash-to-payday — reads from the lines
 * this module builds, and nothing else re-derives recurrence. Before it, three places each had
 * their own idea of "recurring": the habits view counted merchants present in 80% of cycles (so
 * the bond, the car and Netflix were one list), the missed-payment rule keyed on (Spending Group,
 * Category) and produced three false flags the month the export relabelled its groups, and the
 * standing-commitments total could not tell a R199 subscription from a R22 855 instalment.
 *
 * A LINE is one thing that charges one account at one price level: the merchant key (with the
 * bank's truncation variants folded together), the account it hits, and an amount band. Two
 * prices of the same merchant charged in the same months are two products; the same merchant
 * stepping from R449 to R519 is one product with a price change. That distinction — overlap in
 * time means two lines, a gap of at most 45 days means a regime change — is the whole engine, and
 * the rest is bookkeeping: how often (cadence.js), how reliably (presence over the last twelve
 * complete cycles), on what day (mode of day-of-month, with the Friday-before / Monday-after
 * weekend habit learned per line), and whether this cycle's charge has landed, is due, is overdue,
 * or simply cannot be seen yet because the export is older than today.
 *
 * Loan instalments and card repayments are lines too, marked by `source` and `kind` so that a
 * total of "subscriptions" can leave them out without a second engine. Card repayments are dated
 * by the DEBIT — the day cash leaves the bank — because that is the day the cash path cares about.
 *
 * Line ids are `key|accountId|bandIndex` and never a row id: a row's `id` is positional and
 * re-assigned on every load, while a merchant, an account and a price band survive an import.
 *
 * THE USER OUTRANKS THE ENGINE. Two things the data cannot show arrive as options. `settled`
 * ({ lineId: 'YYYY-MM' }) is the user saying "this cycle's charge did land" — the home loan that
 * came off as two odd payments the matcher could not pair to one predicted date, which the engine
 * would otherwise keep calling overdue forever. `overrides` carries the verdicts from the
 * standing-charges audit, of which two END a line: `cancelled` (stopped, and the money is saved)
 * and `replaced` (stopped, but something else now charges instead — a new insurer, so no saving to
 * claim). An ended line keeps its history and its place in the audit, but has no next date, is
 * never due and never overdue, and is gone from the bills calendar and the cash path. `ignore` and
 * `keep` are the audit's own business and do not reach the calendar.
 */

/** Descriptions of cover and fees charged INSIDE a loan account, where no category marks them. */
export const EMBEDDED_RE =
  /protection ins|cpp insurance|credit life|service fee|admin fee|account fee|monthly fee/i;

const DIRECT_PAYMENT_RE = /budget facility direct payment/i;
const EMBEDDED_CATEGORIES = new Set(['Other Insurance', 'Bank Charges']);

// Kind allow-lists. Never the export's Spending Group, which was relabelled in 2026-06.
const INSURANCE_CATEGORIES = new Set(['Other Insurance', 'Medical']);
const INSURANCE_RE = /insur|assur|funeral|protection|cpp/i;
const FEE_RE = /service fee|admin fee|account fee|monthly fee|vat on fee/i;
const UTILITY_CATEGORIES = new Set(['Home Utility & Service', 'Rent']);
const UTILITY_RE = /levy|municipal|easypay|prepaid elec/i;
const OPTIONAL_CATEGORIES = new Set([
  'Entertainment',
  'Software & Services',
  'TV',
  'Sport & Fitness',
  'Books & Stationery',
  'Other Phone & Internet',
  'Cellphone',
]);
const OPTIONAL_RE = /\.com|\.ai|google|apple|microsoft|netflix|spotify|youtube|showmax|dstv|premium|subscr/i;

const DAY_MS = 86400000;
const WEEKLY_LIKE = new Set(['weekly', 'fortnightly']);
const LOAN_CATEGORY_SET = new Set(LOAN_CATEGORIES);
/** The verdicts that stop a line charging. Everything else is the audit's own bookkeeping. */
export const ENDING_OVERRIDES = new Set(['cancelled', 'replaced']);

const dateOf = (t) => t.DateObj ?? parseTransactionDate(t.Date);
const midnight = (d) => new Date(d.getFullYear(), d.getMonth(), d.getDate());
const addDays = (d, n) => new Date(d.getFullYear(), d.getMonth(), d.getDate() + n);
const daysBetween = (from, to) => Math.round((midnight(to) - midnight(from)) / DAY_MS);
const isWeekend = (d) => d.getDay() === 0 || d.getDay() === 6;
const toDay = (v) => {
  if (!v) return null;
  const d = v instanceof Date ? v : parseTransactionDate(String(v));
  return d && !Number.isNaN(d.getTime()) ? midnight(d) : null;
};

/** `dom` within the calendar month `offset` months from `d`'s, clamped to that month's length. */
function domIn(d, dom, offset = 0) {
  const year = d.getFullYear();
  const monthIndex = d.getMonth() + offset;
  const lastDay = new Date(year, monthIndex + 1, 0).getDate();
  return new Date(year, monthIndex, Math.min(dom, lastDay));
}

/** Friday before a Saturday/Sunday, or the Monday after, when the line is known to move. */
function applyWeekendShift(date, shift) {
  if (!date || !shift || !isWeekend(date)) return date;
  const saturday = date.getDay() === 6;
  if (shift === 'earlier') return addDays(date, saturday ? -1 : -2);
  return addDays(date, saturday ? 2 : 1);
}

// ---- step 1: candidate observations -----------------------------------------------------------

/**
 * One observation = one row that might belong to a line, with the few facts every later step
 * needs pulled off it once. `amount` is a magnitude; `extraRows` carries the far leg of a card
 * repayment so that `explained` can include it.
 */
function observation(row, source, overrides = {}) {
  const date = dateOf(row);
  return {
    row,
    date: date ? midnight(date) : null,
    amount: Math.abs(row.AmountNum),
    cycle: row['Pay Month'],
    source,
    accountId: accountIdOf(row.Account),
    payingAccountId: null,
    loanAccountId: null,
    cardAccountId: null,
    extraRows: [],
    ...overrides,
  };
}

function candidates(data, { transfers, accounts, includeRepayments }) {
  const loanOf = new Map();
  transfers.loanPairs.forEach((pair) => {
    const loanName = transfers.loanAccounts.has(pair.toAccount) ? pair.toAccount : pair.fromAccount;
    const loanId = accountIdOf(loanName);
    pair.items.forEach((t) => {
      if (!transfers.loanAccounts.has(t.Account)) loanOf.set(t, loanId);
    });
  });

  const out = [];
  spendRows(data, { transfers, accounts }).forEach((t) => {
    if (transfers.reversalIds.has(t.id)) return;
    if (DIRECT_PAYMENT_RE.test(t.Description ?? '')) return;
    const instalment = transfers.loanInstalmentIds.has(t.id) || LOAN_CATEGORY_SET.has(t.Category);
    const o = observation(t, instalment ? 'instalment' : 'charge');
    if (instalment) {
      o.loanAccountId = loanOf.get(t) ?? null;
      o.payingAccountId = o.accountId;
    } else {
      o.payingAccountId = o.accountId;
    }
    out.push(o);
  });

  data.forEach((t) => {
    if (!transfers.loanAccounts.has(t.Account) || !(t.AmountNum < 0)) return;
    if (!EMBEDDED_CATEGORIES.has(t.Category) && !EMBEDDED_RE.test(t.Description ?? '')) return;
    const o = observation(t, 'embedded');
    o.payingAccountId = o.accountId;
    out.push(o);
  });

  if (includeRepayments) {
    transfers.cardRepayments.forEach((r) => {
      if (!r.date) return;
      out.push(
        observation(r.debit, 'repayment', {
          date: midnight(r.date),
          amount: r.amount,
          cycle: r.debit['Pay Month'],
          accountId: r.payingAccountId,
          payingAccountId: r.payingAccountId,
          cardAccountId: r.cardAccountId,
          extraRows: [r.credit],
        }),
      );
    });
  }

  return out.filter((o) => o.date);
}

// ---- step 2: identity and amount clusters -----------------------------------------------------

/**
 * A PROVIDER OUTRANKS THE MERCHANT KEY, because it is the reader saying "these are one thing".
 *
 * A bill can change its name and its price at once and still be the same bill: the City of Cape
 * Town rates arrived as "Easypay *City Of C…" at R3 000 a cycle and now arrive as "Coc Rates And
 * Taxes *2693" at R4 100. Read as strings those are two merchants, so the engine saw a line that
 * lapsed and a brand-new charge — reporting a cancellation that never happened, and a new
 * commitment that is really an old one that went up by R1 100. Keyed on the provider it is one
 * line, three cycles at R3 000 followed by one at R4 100, which is a price rise the engine already
 * knows how to read.
 *
 * This is why a provider is worth more than tidier rows: it is the only place a person can tell the
 * app that two unrelated strings are the same commitment, and nothing else can infer it.
 */
function identify(observations, providers) {
  const rawKeys = observations
    .filter((o) => o.source === 'charge' || o.source === 'embedded')
    .map((o) => merchantKeyOf(o.row.Description));
  const canonical = mergePrefixKeys(rawKeys);

  observations.forEach((o) => {
    if (o.source === 'instalment') {
      o.identity = o.loanAccountId
        ? `loan|${o.loanAccountId}`
        : `loan|${o.row.Category ?? ''}|${o.accountId}`;
      o.key = o.identity;
      return;
    }
    if (o.source === 'repayment') {
      o.identity = `repayment|${o.cardAccountId}|${o.payingAccountId}`;
      o.key = o.identity;
      return;
    }
    const provider = providerOf(o.row.Description, providers);
    const key = provider
      ? `provider|${provider}`
      : (canonical.get(merchantKeyOf(o.row.Description)) ?? '');
    const base = key || `ref|${o.row.Category || 'Uncategorised'}`;
    o.key = base;
    o.identity = isPersonPayment(o.row.Description) ? `person|${base}` : base;
  });

  const groups = new Map();
  observations.forEach((o) => {
    const groupKey = `${o.identity}|${o.accountId}`;
    if (!groups.has(groupKey)) {
      groups.set(groupKey, { identity: o.identity, key: o.key, accountId: o.accountId, source: o.source, obs: [] });
    }
    groups.get(groupKey).obs.push(o);
  });
  return [...groups.values()];
}

function makeCluster(obs) {
  const sorted = [...obs].sort((a, b) => a.date - b.date);
  return {
    obs: sorted,
    firstDate: sorted[0].date,
    lastDate: sorted[sorted.length - 1].date,
    amount: median(sorted.map((o) => o.amount)),
    count: sorted.length,
  };
}

/** Sort |amounts| ascending and start a new cluster at each gap wider than the tolerance. */
function clusterByAmount(obs) {
  const sorted = [...obs].sort((a, b) => a.amount - b.amount);
  const clusters = [];
  let current = null;
  let previous = null;
  sorted.forEach((o) => {
    const gap = previous == null ? 0 : o.amount - previous;
    if (!current || gap > Math.max(AMOUNT_CLUSTER_MIN_GAP, AMOUNT_CLUSTER_TOLERANCE * previous)) {
      current = [];
      clusters.push(current);
    }
    current.push(o);
    previous = o.amount;
  });
  return clusters.map(makeCluster);
}

const byFirstDateThenSize = (a, b) => a.firstDate - b.firstDate || b.count - a.count;

// ---- step 3: chaining clusters into lines -----------------------------------------------------

/**
 * Within one key|accountId, walk the clusters by first date. A cluster joins the line whose latest
 * cluster it follows without overlap and within REGIME_CHAIN_MAX_GAP_DAYS (a price step);
 * otherwise it starts a line. A cluster with fewer than two observations that falls inside an
 * existing line's span is absorbed as outliers — counted for dates and presence, left out of the
 * amount and the regimes.
 */
function chainClusters(clusters) {
  const lines = [];
  const latest = (line) => line.clusters[line.clusters.length - 1];
  [...clusters].sort(byFirstDateThenSize).forEach((B) => {
    if (B.count < 2) {
      const host = lines.find(
        (L) => B.firstDate >= L.clusters[0].firstDate && B.lastDate <= latest(L).lastDate,
      );
      if (host) {
        host.outliers.push(...B.obs);
        return;
      }
    }
    let best = null;
    lines.forEach((L) => {
      const A = latest(L);
      if (B.firstDate <= A.lastDate) return;
      if (daysBetween(A.lastDate, B.firstDate) > REGIME_CHAIN_MAX_GAP_DAYS) return;
      if (!best || A.lastDate > latest(best).lastDate) best = L;
    });
    if (best) best.clusters.push(B);
    else lines.push({ clusters: [B], outliers: [] });
  });
  return lines;
}

/**
 * Instalments: one line per identity. Amount clusters still give the regimes (the bond's
 * instalment fell with every rate cut), singletons inside another cluster's span are outliers (a
 * doubled instalment), and every remaining cluster chains in date order whatever the gap.
 */
function singleLineOfClusters(clusters) {
  const sorted = [...clusters].sort(byFirstDateThenSize);
  const kept = [];
  const outliers = [];
  sorted.forEach((c) => {
    const host =
      c.count < 2 && kept.find((k) => c.firstDate >= k.firstDate && c.lastDate <= k.lastDate);
    if (host) outliers.push(...c.obs);
    else kept.push(c);
  });
  return [{ clusters: kept, outliers }];
}

function linesOfGroup(group) {
  if (group.source === 'repayment') {
    // Repayments are ad hoc by nature: one regime at the median, no price steps to report.
    return [{ clusters: [makeCluster(group.obs)], outliers: [] }];
  }
  const clusters = clusterByAmount(group.obs);
  return group.source === 'instalment' ? singleLineOfClusters(clusters) : chainClusters(clusters);
}

// ---- steps 4–12: describing a line ------------------------------------------------------------

function regimeOf(cluster) {
  const cycles = cluster.obs.map((o) => o.cycle).filter(Boolean).sort();
  return {
    from: cycles[0] ?? null,
    to: cycles[cycles.length - 1] ?? null,
    amount: cluster.amount,
    count: cluster.count,
  };
}

/**
 * The line's price then versus now, for the "+29% since Jul 26" badge on the audit.
 *
 * The base has to be a price the line actually settled at — PRICE_BASE_REGIME_MIN charges, the
 * same bar priceCreep.js holds its own base to. Without it a pro-rata opening month or a trial
 * became the "from", and the badge and the price-creep list quoted two different increases for the
 * same line. A later step is not held to it: two charges at a new price is a real step.
 */
function priceChangeOf(regimes) {
  const multi = regimes.filter((r) => r.count >= 2);
  if (multi.length < 2) return null;
  const baseIndex = multi.findIndex((r) => r.count >= PRICE_BASE_REGIME_MIN);
  if (baseIndex < 0 || baseIndex === multi.length - 1) return null;
  const first = multi[baseIndex];
  const last = multi[multi.length - 1];
  if (first.amount <= 0) return null;
  const pct = last.amount / first.amount - 1;
  if (Math.abs(pct) < PRICE_STEP_MIN_PCT || Math.abs(last.amount - first.amount) < PRICE_STEP_MIN_RAND) {
    return null;
  }
  return { from: first.amount, to: last.amount, pct, since: last.from };
}

/**
 * Does this line move off weekends? Each observed date is compared with the `dom` date nearest to
 * it (this month's, or the neighbouring months' when the anchor sits at a month edge). A weekday
 * charge within three days of a weekend anchor is a shift, earlier or later; a charge ON the
 * weekend anchor is evidence the line does not move.
 */
function weekendShiftOf(dates, dom) {
  if (dom == null) return null;
  let earlier = 0;
  let later = 0;
  let unshifted = 0;
  dates.forEach((d) => {
    const anchor = [-1, 0, 1]
      .map((offset) => domIn(d, dom, offset))
      .sort((a, b) => Math.abs(a - d) - Math.abs(b - d))[0];
    if (!isWeekend(anchor)) return;
    const delta = daysBetween(anchor, d);
    if (delta === 0) unshifted += 1;
    else if (!isWeekend(d) && Math.abs(delta) <= 3) {
      if (delta < 0) earlier += 1;
      else later += 1;
    }
  });
  if (earlier + later < 2 || earlier + later < unshifted) return null;
  return later >= earlier ? 'later' : 'earlier';
}

function kindOf({ source, category, spendingGroup, description, key }) {
  const text = `${description} ${key}`;
  if (source === 'instalment') return 'instalment';
  if (source === 'repayment') return 'repayment';
  if (INSURANCE_CATEGORIES.has(category) || INSURANCE_RE.test(text)) return 'insurance';
  if (category === 'Bank Charges' || spendingGroup === 'Bank Fees' || FEE_RE.test(text)) return 'fee';
  if (UTILITY_CATEGORIES.has(category) || UTILITY_RE.test(text)) return 'utility';
  if (OPTIONAL_CATEGORIES.has(category) || OPTIONAL_RE.test(text)) return 'optional';
  if (isPersonPayment(description)) return 'person';
  return 'other';
}

/**
 * Where this cycle's charge stands, judged against what the DATA has seen (dataThrough), never the
 * wall clock — a stale export must read "not yet in the data", not "overdue". The prediction for
 * the current cycle steps forward from the last observation before the cycle began, so the charge
 * that landed this cycle can be matched against it rather than against the next one.
 */
function cycleStatusOf({ dates, cadence, dom, shift, currentStart, currentEnd, dataThrough, asOf, obs }) {
  if (!currentStart || !currentEnd) return { cycleStatus: null, landedKey: null };
  const landedAt = (predicted) =>
    obs.find(
      (o) =>
        Math.abs(daysBetween(predicted, o.date)) <= STATUS_LANDED_WINDOW_DAYS && o.date <= dataThrough,
    );
  const prior = dates.filter((d) => d < currentStart);
  if (!prior.length) {
    const seen = obs.find((o) => o.date >= currentStart && o.date <= currentEnd && o.date <= dataThrough);
    return { cycleStatus: seen ? 'landed' : null, landedKey: seen?.row.key ?? null };
  }
  let predicted = prior[prior.length - 1];
  for (let i = 0; i < 24 && predicted < currentStart; i += 1) {
    predicted = applyWeekendShift(stepForward(predicted, cadence, { dayOfMonth: dom }), shift);
  }
  if (!predicted || predicted < currentStart || predicted > currentEnd) {
    return { cycleStatus: null, landedKey: null };
  }
  const landed = landedAt(predicted);
  if (landed) return { cycleStatus: 'landed', landedKey: landed.row.key ?? null };
  if (predicted > dataThrough) {
    return { cycleStatus: asOf && predicted <= asOf ? 'unobservable' : 'due', landedKey: null };
  }
  if (daysBetween(predicted, dataThrough) > STATUS_OVERDUE_GRACE_DAYS) {
    return { cycleStatus: 'overdue', landedKey: null };
  }
  return { cycleStatus: 'due', landedKey: null };
}

function describeLine(line, group, bandIndex, ctx) {
  const { calendar, cycles, dataThrough, asOf, currentStart, currentEnd, currentMonth, overrides, settled } = ctx;
  const regular = line.clusters.flatMap((c) => c.obs);
  const all = [...regular, ...line.outliers].sort((a, b) => a.date - b.date);
  const dates = all.map((o) => o.date);
  const amounts = regular.map((o) => o.amount);
  const firstSeen = dates[0];
  const lastSeen = dates[dates.length - 1];
  const rows = all.map((o) => o.row);

  const regimes = line.clusters.map(regimeOf);
  const latest = line.clusters[line.clusters.length - 1];
  const amount = latest.amount;

  const cad = classifyCadence(dates);
  const { cadence, medianGap, gapMad, perYear } = cad;
  const tentative =
    cadence === 'insufficient' && all.length === 2 && medianGap != null && medianGap >= 26 && medianGap <= 35;
  if (cadence === 'insufficient' && !tentative) return null;
  const weeklyLike = WEEKLY_LIKE.has(cadence);

  // Presence over the last RECURRING_PRESENCE_WINDOW complete cycles since the line was first seen.
  const firstCycle = all.map((o) => o.cycle).filter(Boolean).sort()[0] ?? null;
  const window = firstCycle ? cycles.filter((c) => c >= firstCycle).slice(-RECURRING_PRESENCE_WINDOW) : [];
  const cyclesSinceFirst = window.length;
  const byCycle = new Map();
  all.forEach((o) => byCycle.set(o.cycle, (byCycle.get(o.cycle) ?? 0) + o.amount));
  const perCycleAmounts = window.map((c) => byCycle.get(c) ?? 0);
  const cyclesPresent = window.filter((c) => byCycle.has(c)).length;
  let presence;
  if (weeklyLike) {
    const expected = medianGap ? daysBetween(firstSeen, lastSeen) / medianGap : 0;
    presence = expected > 0 ? Math.min(1, all.length / expected) : 1;
  } else {
    // Slower cadences are owed fewer charges per cycle: a quarterly line present in 4 of 12 is whole.
    const expected = perYear ? (cyclesSinceFirst * perYear) / 12 : cyclesSinceFirst;
    presence = expected > 0 ? Math.min(1, cyclesPresent / expected) : tentative ? 1 : 0;
  }
  if (!tentative) {
    if (cyclesSinceFirst === 0) return null;
    if (presence < (weeklyLike ? RECURRING_MIN_PRESENCE_WEEKLY : RECURRING_MIN_PRESENCE_MONTHLY)) return null;
  }

  const cyclesObserved = Math.max(1, cyclesSinceFirst);
  const perCycle = perYear
    ? (amount * perYear) / 12
    : perCycleAmounts.reduce((s, x) => s + x, 0) / cyclesObserved || amount;
  const perYearAmount = perCycle * 12;

  // Day anchor.
  const dom = dayOfMonthMode(dates);
  const doms = dates.map((d) => d.getDate());
  const gaps = [];
  for (let i = 1; i < dates.length; i += 1) gaps.push(daysBetween(dates[i - 1], dates[i]));
  const domIqr = weeklyLike ? null : quantile(doms, 0.75) - quantile(doms, 0.25);
  const gapIqr = weeklyLike ? quantile(gaps, 0.75) - quantile(gaps, 0.25) : null;
  const weekendShift = weeklyLike || tentative ? null : weekendShiftOf(dates, dom);
  const predicted = weeklyLike
    ? nextExpected(dates, cadence)
    : perYear
      ? nextExpected(dates, cadence, { dayOfMonth: dom })
      : null;
  const nextDate = applyWeekendShift(predicted, weekendShift);

  // Status against the data, never the clock.
  const lapseLimit = cadence === 'irregular' ? LAPSED_IRREGULAR_DAYS : LAPSED_GAP_FACTOR * (medianGap ?? 30);
  const sinceLast = daysBetween(lastSeen, dataThrough);
  const status = sinceLast <= lapseLimit ? 'active' : 'lapsed';
  const judged =
    status === 'active' && !tentative && !weeklyLike && perYear && lastSeen <= dataThrough
      ? cycleStatusOf({
          dates,
          cadence,
          dom,
          shift: weekendShift,
          currentStart,
          currentEnd,
          dataThrough,
          asOf,
          obs: all,
        })
      : { cycleStatus: null, landedKey: null };
  const dueCycle = nextDate ? cycleKeyOf(nextDate, calendar) : null;
  const dueThisCycle = Boolean(nextDate && currentEnd && nextDate <= currentEnd);

  // Confidence.
  const dayScore = weeklyLike ? 1 - Math.min(1, (gapIqr ?? 0) / 7) : 1 - Math.min(1, (domIqr ?? 7) / 7);
  const amountScore = 1 - Math.min(1, dispersion(amounts) / 0.5);
  const cadenceDays = cadence === 'irregular' ? LAPSED_IRREGULAR_DAYS : (medianGap ?? 30);
  const recency = sinceLast <= LAPSED_GAP_FACTOR * cadenceDays ? 1 : 0.5;
  const confidence = presence * (0.5 * dayScore + 0.3 * amountScore + 0.2) * recency;
  let level = confidence >= CONFIDENCE_HIGH ? 'high' : confidence >= CONFIDENCE_MEDIUM ? 'medium' : 'low';
  if (group.source === 'repayment' && level === 'high') level = 'medium';
  if (tentative) level = 'low';

  // The user's verdict, applied last so it overrules everything the engine just worked out.
  // Ending a line leaves its history intact — the audit still lists it, and the wins card still
  // reads `override` — but takes it off every forward-looking calendar.
  const id = `${group.identity}|${group.accountId}|${bandIndex}`;
  const override = overrides?.[id] ?? null;
  const ended = ENDING_OVERRIDES.has(override);
  const settledCycle = settled?.[id] ?? null;
  const settledByUser = Boolean(currentMonth && settledCycle === currentMonth);
  const cycleStatus = ended ? null : settledByUser ? 'landed' : judged.cycleStatus;

  const category = mode(rows.map((t) => t.Category ?? ''));
  const spendingGroup = mode(rows.map((t) => spendingGroupOf(t)));
  const description = mode(rows.map((t) => (t.Description ?? '').toString())) ?? '';
  const kind = kindOf({ source: group.source, category, spendingGroup, description, key: group.key });

  let label;
  if (group.identity.startsWith('person|')) label = PERSON_LABEL;
  else if (group.key.startsWith('ref|')) label = category || 'Uncategorised';
  else if (group.source === 'repayment') label = 'Card repayment';
  else if (group.source === 'instalment') {
    const merchant = merchantKeyOf(description);
    label = merchant ? merchantLabel(merchant) : category || 'Loan instalment';
  } else label = merchantLabel(group.key);

  const sample = all[0];
  return {
    id,
    key: group.key,
    label,
    source: group.source,
    kind,
    category,
    spendingGroup,
    accountId: group.accountId,
    payingAccountId: sample.payingAccountId ?? group.accountId,
    loanAccountId: sample.loanAccountId ?? null,
    cardAccountId: sample.cardAccountId ?? null,
    cadence,
    medianGap,
    gapMad,
    perYear,
    observations: all.length,
    tentative,
    amount,
    amountStable: dispersion(latest.obs.map((o) => o.amount)) <= 0.05,
    regular: isRegularAmount(perCycleAmounts),
    range: [quantile(amounts, 0.25), quantile(amounts, 0.75)],
    regimes,
    outliers: line.outliers.length,
    priceChange: group.source === 'repayment' ? null : priceChangeOf(regimes),
    perCycle,
    perYearAmount,
    perCycleAmounts,
    firstSeen,
    lastSeen,
    cyclesPresent,
    cyclesSinceFirst,
    presence,
    dom,
    domIqr,
    gapIqr,
    weekendShift,
    nextDate: ended ? null : nextDate,
    dueCycle: ended ? null : dueCycle,
    dueThisCycle: ended ? false : dueThisCycle,
    status,
    ended,
    endedReason: ended ? override : null,
    override,
    settledByUser,
    cycleStatus,
    landedKey: judged.landedKey,
    confidence,
    level,
    items: rows,
    explainedRows: [...rows, ...all.flatMap((o) => o.extraRows)],
  };
}

/**
 * @param data       every row (all accounts)
 * @param options    accounts: AccountRecord[]; calendar: buildCycleCalendar(data, allMonths, asOf);
 *                   transfers: buildFullTransfers(data); asOf: Date; dataThrough: Date (defaults to
 *                   the calendar's); includeRepayments = true;
 *                   overrides: { [lineId]: 'keep'|'ignore'|'cancelled'|'replaced' } (settings.lineOverrides);
 *                   settled: { [lineId]: 'YYYY-MM' } (settings.lineSettled) — cycles the user has
 *                   confirmed landed, for charges that arrived in a shape the matcher cannot pair
 * @returns {{ lines: RecurringLine[], explained: Set<Transaction>, cycles: string[] }}
 *   `lines` sorted by perCycle descending; `cycles` = the complete cycles the presence window draws on.
 */
export function buildRecurringLines(data, options = {}) {
  const {
    accounts = null,
    calendar,
    transfers,
    includeRepayments = true,
    overrides = null,
    settled = null,
    providers = null,
  } = options;
  const empty = { lines: [], explained: new Set(), cycles: [] };
  if (!data?.length || !calendar?.starts || !transfers) return empty;
  const dataThrough = toDay(options.dataThrough ?? calendar.dataThrough);
  if (!dataThrough) return empty;
  const asOf = toDay(options.asOf) ?? dataThrough;
  const cycles = completeMonths(calendar);
  const currentMonth = calendar.currentMonth;
  const ctx = {
    calendar,
    cycles,
    dataThrough,
    asOf,
    currentMonth,
    currentStart: currentMonth ? calendar.starts[currentMonth] : null,
    currentEnd: currentMonth ? calendar.ends[currentMonth] : null,
    overrides,
    settled,
  };

  const groups = identify(candidates(data, { transfers, accounts, includeRepayments }), providers);
  const lines = [];
  const explained = new Set();
  groups.forEach((group) => {
    const chained = linesOfGroup(group).filter((line) => line.clusters.length);
    // Band index: rank of the line's first-cluster amount within the group, so the id is stable
    // across imports and independent of which lines survive the filters below.
    const ranked = [...chained].sort((a, b) => a.clusters[0].amount - b.clusters[0].amount);
    chained.forEach((line) => {
      const described = describeLine(line, group, ranked.indexOf(line), ctx);
      if (!described) return;
      const { explainedRows, ...rest } = described;
      explainedRows.forEach((row) => explained.add(row));
      lines.push(rest);
    });
  });

  lines.sort((a, b) => b.perCycle - a.perCycle || (a.id < b.id ? -1 : 1));
  return { lines, explained, cycles };
}

/**
 * The subset due in [from, to] (Dates, inclusive) by nextDate, ascending; used by upcoming.js and
 * cashToPayday.js. Ended lines carry no nextDate, so they fall out here without a second check.
 */
export function linesDueBetween(lines, from, to) {
  const lo = toDay(from);
  const hi = toDay(to);
  if (!lo || !hi) return [];
  return (lines ?? [])
    .filter((line) => line.nextDate && line.nextDate >= lo && line.nextDate <= hi)
    .sort((a, b) => a.nextDate - b.nextDate);
}
