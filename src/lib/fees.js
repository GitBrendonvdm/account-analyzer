import { FEES_RUN_RATE_CYCLES } from '../constants';
import { formatCurrencyAbs } from '../utils/format';
import { accountIdOf } from './accounts';
import { isCost } from './costOfDebt';
import { accountTypeOf, completeMonths, spendRows } from './flows';
import { median, mode, theilSen } from './stats';

/**
 * The fees audit: what the accounts themselves cost, by kind, and which of it is avoidable.
 *
 * `costOfDebt` answers "what does the debt cost" as one number per account. This module answers
 * the question underneath it — WHAT KIND of cost — because the kinds have different remedies. An
 * account fee is avoided by closing an account; a transaction fee by using the bundled payment
 * options; a penalty by not bouncing a debit order; card interest by paying the balance down,
 * which is a debt decision and not a fee one; and payment protection on a card is optional cover
 * that can simply be cancelled. Lumped together they are "bank charges, R1 460 a cycle" and
 * nothing follows from that.
 *
 * It reads EVERY account, loans and cards included, whatever the account chips say — the chips
 * are a view of spending and a loan's service fee is not spending, but it is still a fee. Run
 * rates are medians over the last FEES_RUN_RATE_CYCLES complete cycles, so one reversed fee or one
 * cycle of bounced debits cannot set the level; the one exception is card interest, which is lumpy
 * by nature (a budget purchase posts its finance charge in bursts) and is reported as the last
 * twelve cycles' actual total. Initiation fees are listed and left out of every run rate: a once-
 * off is not a rate. And the honest finding on this data is that the avoidable part is small —
 * the audit says so rather than inflating it.
 */

const R = (n) => formatCurrencyAbs(n);
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const LIQUID = new Set(['Bank', 'Savings']);
const DEPOSIT_OR_CARD = new Set(['Bank', 'Savings', 'Credit Card']);
const TREND_CYCLES = 12;

export const FEE_KINDS = [
  'initiation',
  'account',
  'transaction',
  'penalty',
  'atm',
  'crossBorder',
  'embeddedInsurance',
  'overdraftInterest',
  'cardInterest',
  'loanInterest',
  'loanInsurance',
  'otherFee',
];
const AVOIDABLE_KINDS = ['transaction', 'penalty', 'atm', 'crossBorder'];

const INITIATION_RE = /initiation fee/i;
const ACCOUNT_RE =
  /monthly account|maintenance fee|admin fee|service fee|credit card account fee|credit facility|nca service|monthly credit fee/i;
const TRANSACTION_RE =
  /instant payment|send-imali|send money fee|electronic (trf|payment)|debit transaction|payments bundle|immediate|vat on fee/i;
const PENALTY_RE = /declined|returned|unpaid|insufficient|honour|penalty/i;
const ATM_RE = /\ba ?t ?m\b|cash withdrawal|cash advance/i;
const CROSS_BORDER_RE = /cross border|int pymt|intl|foreign|currency conv/i;
const EMBEDDED_INSURANCE_RE = /protection ins|payment protection/i;
const LOAN_INSURANCE_RE = /cpp insurance|credit life|insurance premium/i;
const OVERDRAFT_RE = /int on debit/i;
const FINANCE_CHARGE_RE = /finance charge/i;
/** A row the export did not file as a cost still has to call itself a fee before a regex can claim it. */
const FEE_WORD_RE = /\bfees?\b|charge|penalt|levy/i;

function cycleLabel(key) {
  if (!key) return '';
  const [y, m] = key.split('-').map(Number);
  return `${MONTHS[m - 1] ?? ''} ${y}`.trim();
}

/**
 * Classify one row. The row must be money out and either a cost by the export's own filing
 * (`isCost`) or a description that names a fee and matches one of the patterns; first match wins,
 * in the order listed. `accountType` is the effective type of the row's account.
 * @returns 'initiation'|'account'|'transaction'|'penalty'|'atm'|'crossBorder'|'embeddedInsurance'|
 *          'overdraftInterest'|'cardInterest'|'loanInterest'|'loanInsurance'|'otherFee'|null
 */
export function feeKind(t, accountType) {
  if (!(t?.AmountNum < 0)) return null;
  const d = (t.Description ?? '').toString();
  const category = t.Category ?? '';
  const cost = isCost(t);
  // Cover filed as insurance is classified by the account it sits in, so it passes the gate too.
  if (!cost && !FEE_WORD_RE.test(d) && category !== 'Other Insurance') return null;
  const card = accountType === 'Credit Card';
  const loan = accountType === 'Loan';
  const liquid = LIQUID.has(accountType);

  if (INITIATION_RE.test(d)) return 'initiation';
  if (ACCOUNT_RE.test(d)) return 'account';
  if (TRANSACTION_RE.test(d)) return 'transaction';
  if (PENALTY_RE.test(d)) return 'penalty';
  if (ATM_RE.test(d)) return 'atm';
  if (CROSS_BORDER_RE.test(d)) return 'crossBorder';
  if (card && EMBEDDED_INSURANCE_RE.test(d)) return 'embeddedInsurance';
  if (loan && (LOAN_INSURANCE_RE.test(d) || category === 'Other Insurance')) return 'loanInsurance';
  if (liquid && (category === 'Interest' || OVERDRAFT_RE.test(d))) return 'overdraftInterest';
  if (card && (category === 'Interest' || FINANCE_CHARGE_RE.test(d))) return 'cardInterest';
  if (loan && category === 'Interest') return 'loanInterest';
  return cost ? 'otherFee' : null;
}

/** Run-rate figures for one per-cycle series (ascending, last TREND_CYCLES complete cycles, zero-filled). */
function rates(series, total, kind) {
  if (kind === 'initiation') return { perCycle: 0, perYear: 0, trend: 0, total };
  const recent = series.slice(-FEES_RUN_RATE_CYCLES);
  const perCycle = median(recent);
  return { perCycle, perYear: perCycle * 12, trend: theilSen(series).slope * 12, total };
}

function emptySeries(cycles) {
  return Object.fromEntries(cycles.map((c) => [c, 0]));
}

/**
 * @param data      every row, every account
 * @param accounts  AccountRecord[] (labels and type overrides); may be empty
 * @param opts      transfers: buildFullTransfers(data); calendar: buildCycleCalendar(...);
 *                  lines: RecurringLine[] (kind 'fee' lines supply the price steps)
 * @returns {{
 *   byAccount: [{ accountId, label, type, kinds: { [kind]: { perCycle, perYear, trend, total } }, totalPerYear, spendRows6 }],
 *   byKind: { [kind]: { perCycle, perYear, trend, total } },
 *   avoidablePerYear,                 // transaction + penalty + atm + crossBorder
 *   accountFeesPerYear,               // `account` fees on Bank / Savings / Credit Card accounts
 *   consolidation: { closeCandidate, keepCandidate, closeAccountId, keepAccountId, savingPerYear, sentence } | null,
 *   ppi: { perYear, perCycle, accounts: [label], byAccount: [{ accountId, label, perCycle, perYear }], sentence } | null,
 *   cardInterest: { perCycle, perYear, cyclesWithInterest, series: [{ month, amount }], runRatePerCycle, sentence },
 *                                     // perYear = the last 12 complete cycles' actual total; runRatePerCycle = median of the last 6
 *   overdraftInterestPerYear, loanCostPerYear, steps: [{ lineId, label, accountId, feeKind, from, to, pct, cycle }],
 *   totalPerYear, cycles: string[], sentences: { accountFees, consolidation, cardInterest, ppi, avoidable },
 *   assumptions: string[],
 * }}
 * Run rates: perCycle = median of the last FEES_RUN_RATE_CYCLES complete cycles, perYear = ×12,
 * trend = Theil–Sen slope over the last 12 complete cycles × 12 (rand per cycle, per year).
 */
export function buildFeesAudit(data, accounts, { transfers, calendar, lines = [] } = {}) {
  const complete = completeMonths(calendar);
  const cycles = complete.slice(-TREND_CYCLES);
  const recent = complete.slice(-FEES_RUN_RATE_CYCLES);
  const cycleSet = new Set(cycles);
  const recordById = new Map((accounts ?? []).map((a) => [a.id, a]));
  const assumptions = [
    `Run rates are medians over the last ${FEES_RUN_RATE_CYCLES} complete cycles; card interest is the last ${TREND_CYCLES} cycles' actual total.`,
    'Initiation fees are listed but left out of every run rate.',
  ];

  // ---- classify every negative row on every account -------------------------------------------
  const byAccount = new Map();
  const byKindSeries = Object.fromEntries(FEE_KINDS.map((k) => [k, emptySeries(cycles)]));
  const byKindTotal = Object.fromEntries(FEE_KINDS.map((k) => [k, 0]));
  const accountOf = (rawName) => {
    const id = accountIdOf(rawName);
    if (!byAccount.has(id)) {
      const record = recordById.get(id);
      byAccount.set(id, {
        accountId: id,
        label: record?.label || record?.rawName || rawName,
        type: accountTypeOf(rawName, accounts),
        series: Object.fromEntries(FEE_KINDS.map((k) => [k, emptySeries(cycles)])),
        totals: Object.fromEntries(FEE_KINDS.map((k) => [k, 0])),
        spendRows6: 0,
      });
    }
    return byAccount.get(id);
  };
  (data ?? []).forEach((t) => {
    if (!(t.AmountNum < 0)) return;
    const account = accountOf(t.Account);
    const kind = feeKind(t, account.type);
    if (!kind) return;
    const amount = -t.AmountNum;
    account.totals[kind] += amount;
    byKindTotal[kind] += amount;
    const cycle = t['Pay Month'];
    if (cycleSet.has(cycle)) {
      account.series[kind][cycle] += amount;
      byKindSeries[kind][cycle] += amount;
    }
  });
  // Activity on an account is spend that is not itself a fee: a dormant account still pays to exist.
  spendRows(data, { transfers, accounts, months: recent }).forEach((t) => {
    const account = accountOf(t.Account);
    if (!feeKind(t, account.type)) account.spendRows6 += 1;
  });

  const toSeries = (byCycle) => cycles.map((c) => byCycle[c]);
  const accountsOut = [...byAccount.values()]
    .map((a) => {
      const kinds = {};
      FEE_KINDS.forEach((k) => {
        if (a.totals[k] > 0) kinds[k] = rates(toSeries(a.series[k]), a.totals[k], k);
      });
      const totalPerYear = Object.values(kinds).reduce((s, k) => s + k.perYear, 0);
      return { accountId: a.accountId, label: a.label, type: a.type, kinds, totalPerYear, spendRows6: a.spendRows6 };
    })
    .filter((a) => Object.keys(a.kinds).length > 0)
    .sort((a, b) => b.totalPerYear - a.totalPerYear);

  const byKind = Object.fromEntries(
    FEE_KINDS.map((k) => [k, rates(toSeries(byKindSeries[k]), byKindTotal[k], k)]),
  );
  const perYearOf = (kind) => byKind[kind]?.perYear ?? 0;
  const avoidablePerYear = AVOIDABLE_KINDS.reduce((s, k) => s + perYearOf(k), 0);
  const accountFeesPerYear = accountsOut
    .filter((a) => DEPOSIT_OR_CARD.has(a.type))
    .reduce((s, a) => s + (a.kinds.account?.perYear ?? 0), 0);
  const totalPerYear = FEE_KINDS.filter((k) => k !== 'initiation').reduce((s, k) => s + perYearOf(k), 0);
  const loanCostPerYear = accountsOut.filter((a) => a.type === 'Loan').reduce((s, a) => s + a.totalPerYear, 0);

  // ---- consolidation: two current accounts each paying to exist -------------------------------
  const feePaying = accountsOut
    .filter((a) => LIQUID.has(a.type) && (a.kinds.account?.perYear ?? 0) > 0)
    .sort((a, b) => a.spendRows6 - b.spendRows6 || b.kinds.account.perYear - a.kinds.account.perYear);
  let consolidation = null;
  if (feePaying.length >= 2) {
    const close = feePaying[0];
    const keep = feePaying[feePaying.length - 1];
    const savingPerYear = close.kinds.account.perYear;
    consolidation = {
      closeCandidate: close.label,
      keepCandidate: keep.label,
      closeAccountId: close.accountId,
      keepAccountId: keep.accountId,
      savingPerYear,
      sentence: `Consolidating to one current account: ${R(savingPerYear)}/yr (close the ${close.label}, keep the ${keep.label})`,
    };
  }

  // ---- payment protection sold inside the cards ----------------------------------------------
  const ppiAccounts = accountsOut
    .filter((a) => (a.kinds.embeddedInsurance?.perYear ?? 0) > 0)
    .map((a) => ({
      accountId: a.accountId,
      label: a.label,
      perCycle: a.kinds.embeddedInsurance.perCycle,
      perYear: a.kinds.embeddedInsurance.perYear,
    }));
  const ppiPerYear = ppiAccounts.reduce((s, a) => s + a.perYear, 0);
  const ppi = ppiAccounts.length
    ? {
        perYear: ppiPerYear,
        perCycle: ppiPerYear / 12,
        accounts: ppiAccounts.map((a) => a.label),
        byAccount: ppiAccounts,
        sentence: `Payment protection on the ${ppiAccounts.map((a) => a.label).join(' and ')}: ${R(ppiPerYear)}/yr, optional cover`,
      }
    : null;

  // ---- card interest: lumpy, so the last year's actual total rather than a median ------------
  const interestSeries = toSeries(byKindSeries.cardInterest);
  const interestPerYear = interestSeries.reduce((s, x) => s + x, 0);
  const cyclesWithInterest = interestSeries.slice(-FEES_RUN_RATE_CYCLES).filter((x) => x > 0).length;
  const cardInterest = {
    perCycle: cycles.length ? interestPerYear / cycles.length : 0,
    perYear: interestPerYear,
    cyclesWithInterest,
    series: cycles.map((month, i) => ({ month, amount: interestSeries[i] })),
    runRatePerCycle: byKind.cardInterest.perCycle,
    sentence: `Card interest ${R(interestPerYear)}/yr — charged in ${cyclesWithInterest} of the last ${Math.min(FEES_RUN_RATE_CYCLES, cycles.length)} cycles`,
  };

  // ---- price steps on fee lines, from the recurring engine ------------------------------------
  const steps = (lines ?? [])
    .filter((l) => l.kind === 'fee' && l.priceChange)
    .map((l) => {
      const type = accountTypeOf(l.items?.[0]?.Account ?? '', accounts);
      const kinds = (l.items ?? []).map((t) => feeKind(t, type)).filter(Boolean);
      return {
        lineId: l.id,
        label: l.label,
        accountId: l.accountId,
        feeKind: mode(kinds) ?? 'otherFee',
        from: l.priceChange.from,
        to: l.priceChange.to,
        pct: l.priceChange.pct,
        cycle: l.priceChange.since,
      };
    })
    .sort((a, b) => (a.cycle < b.cycle ? 1 : a.cycle > b.cycle ? -1 : 0));
  const accountStep = steps.find((s) => s.feeKind === 'account');
  const accountFeesSentence =
    `Account fees ${R(accountFeesPerYear)}/yr` +
    (accountStep
      ? ` — the ${accountStep.label} fee rose from ${R(accountStep.from)} to ${R(accountStep.to)} in ${cycleLabel(accountStep.cycle)}`
      : '');

  return {
    byAccount: accountsOut,
    byKind,
    avoidablePerYear,
    accountFeesPerYear,
    consolidation,
    ppi,
    cardInterest,
    overdraftInterestPerYear: perYearOf('overdraftInterest'),
    loanCostPerYear,
    steps,
    totalPerYear,
    cycles,
    sentences: {
      accountFees: accountFeesSentence,
      consolidation: consolidation?.sentence ?? null,
      cardInterest: cardInterest.sentence,
      ppi: ppi?.sentence ?? null,
      avoidable: `Transaction, ATM and penalty fees: ${R(avoidablePerYear)}/yr.`,
    },
    assumptions,
  };
}
