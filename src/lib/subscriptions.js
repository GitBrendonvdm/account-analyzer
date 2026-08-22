import {
  DUE_SOON_DAYS,
  NEW_LINE_CYCLES,
  NEW_LINE_HEADLINE_MIN,
  PRICE_STEP_MIN_PCT,
  TRIAL_MAX_FIRST,
  TRIAL_MIN_RATIO,
} from '../constants';
import { parseTransactionDate } from '../utils/date';
import { formatCurrencyAbs } from '../utils/format';
import { completeMonths } from './flows';
import { isInternalMovementCategory } from './transfers';

/**
 * The recurring audit: what bills you, what is new, what stopped, and what got cheaper.
 *
 * Everything here is read off the lines `recurring.js` builds — this module never looks at a row
 * to decide whether something repeats. Its job is the bookkeeping around those lines that the
 * Habits view needs to say anything useful: a total by KIND, so that "R63 352 a cycle in
 * subscriptions" can never again invite the reader to imagine cancelling a bond; the handful of
 * lines that appeared in the last three cycles, because a charge that is new is the one most
 * worth a second look; the lines that have gone quiet, because money you stopped spending is the
 * only saving the app can actually prove; and the lines whose price dropped, for the same reason.
 *
 * The user's own verdicts come in through `lineOverrides`: `keep` takes a line out of every
 * savings total without hiding it, `cancelled` moves an active line into the wins as of today, and
 * `ignore` removes it from the audit altogether (a line the engine got wrong). Instalments and
 * card repayments are reported — they are lines too — but never counted as something to cancel.
 */

const R = (n) => formatCurrencyAbs(n);
const DAY_MS = 86400000;
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

const KINDS = ['optional', 'insurance', 'fee', 'utility', 'instalment', 'repayment', 'person', 'other'];
const CADENCES = ['weekly', 'fortnightly', 'monthly', 'bimonthly', 'quarterly', 'annual', 'irregular'];
/** Debt, not a subscription: reported by kind, never counted as cancellable. */
const DEBT_KINDS = new Set(['instalment', 'repayment']);
/** A line that stopped charging is a win only when it was something optional to begin with. */
const LAPSED_KINDS = new Set(['optional', 'insurance', 'utility', 'other', 'person']);
/** A new charge earns a headline only when it is the kind of thing a person might not have meant. */
const HEADLINE_KINDS = new Set(['optional', 'insurance', 'utility', 'fee', 'other']);
/**
 * A subscription charges on a schedule. Three visits to one shop inside a fortnight form a line
 * too (the engine keeps them for presence), but they are neither "new monthly charge" nor a win
 * when they stop, so the new-line and lapsed-line lists demand a cadence the word fits.
 */
const SCHEDULED = new Set(['weekly', 'fortnightly', 'monthly', 'bimonthly', 'quarterly', 'annual']);
const MONTHLY_OR_SLOWER = new Set(['monthly', 'bimonthly', 'quarterly', 'annual']);
const CADENCE_WORD = {
  weekly: 'new weekly charge',
  fortnightly: 'new fortnightly charge',
  monthly: 'new monthly charge',
  bimonthly: 'new charge every two months',
  quarterly: 'new quarterly charge',
  annual: 'new annual charge',
  irregular: 'new regular charge',
  insufficient: 'new charge',
};

const midnight = (d) => new Date(d.getFullYear(), d.getMonth(), d.getDate());
const addDays = (d, n) => new Date(d.getFullYear(), d.getMonth(), d.getDate() + n);
const daysBetween = (from, to) => Math.round((midnight(to) - midnight(from)) / DAY_MS);
const toDay = (v) => {
  if (!v) return null;
  const d = v instanceof Date ? v : parseTransactionDate(String(v));
  return d && !Number.isNaN(d.getTime()) ? midnight(d) : null;
};
const dateOf = (t) => toDay(t.DateObj ?? t.Date);
const sum = (xs, f) => xs.reduce((s, x) => s + (f(x) || 0), 0);
const byPerCycleDesc = (a, b) => b.perCycle - a.perCycle || (a.id < b.id ? -1 : 1);
const plural = (n, word) => `${n} ${word}${n === 1 ? '' : 's'}`;

/** 'YYYY-MM' → 'Jun 2026'; null-safe. */
function cycleLabel(key) {
  if (!key) return '';
  const [y, m] = key.split('-').map(Number);
  return `${MONTHS[m - 1] ?? ''} ${y}`.trim();
}

function kindTotals(lines) {
  const out = {};
  KINDS.forEach((kind) => {
    const of = lines.filter((l) => l.kind === kind);
    const perCycle = sum(of, (l) => l.perCycle);
    out[kind] = { count: of.length, perCycle, perYear: perCycle * 12 };
  });
  return out;
}

/**
 * Did a token charge turn into a full one a month later? The first charge is at most
 * TRIAL_MAX_FIRST and a later charge of at least TRIAL_MIN_RATIO times it lands 25–35 days after.
 */
function trialConvertedOf(line) {
  const items = (line.items ?? [])
    .map((t) => ({ date: dateOf(t), amount: Math.abs(t.AmountNum) }))
    .filter((x) => x.date)
    .sort((a, b) => a.date - b.date);
  if (items.length < 2) return false;
  const first = items[0];
  if (!(first.amount > 0) || first.amount > TRIAL_MAX_FIRST) return false;
  return items.slice(1).some((x) => {
    const gap = daysBetween(first.date, x.date);
    return x.amount >= TRIAL_MIN_RATIO * first.amount && gap >= 25 && gap <= 35;
  });
}

/**
 * @param {RecurringLine[]} lines   from buildRecurringLines
 * @param {object} options
 *   calendar:      buildCycleCalendar(data, allMonths, asOf)
 *   dataThrough:   Date (defaults to the calendar's)
 *   asOf:          Date (defaults to dataThrough) — the day a `cancelled` override takes effect
 *   lineOverrides: { [lineId]: 'keep'|'cancelled'|'ignore' } (settings.lineOverrides)
 * @returns {{
 *   lines: RecurringLine[],                      // active, not tentative, override ≠ ignore; `override` attached; perCycle desc
 *   byKind: { [kind]: { count, perCycle, perYear } },   // optional insurance fee utility instalment repayment person other
 *   byCadence: { [cadence]: number },            // weekly fortnightly monthly bimonthly quarterly annual irregular
 *   optionalPerCycle, optionalPerYear, insurancePerCycle, feePerCycle, utilityPerCycle,
 *   annualItems: [line & { setAsidePerCycle, sentence }],
 *   dueSoon: [line],                             // nextDate within DUE_SOON_DAYS after dataThrough
 *   newLines: [line & { cyclesSeen, trialConverted, wording, headline, sentence }],
 *   newSince: { cycle, label, start } | null,    // the window a "new" line must start in
 *   lapsedLines: [line & { savedPerCycle, since, savedSoFar, byOverride, sentence }],
 *   downgrades: [line & { savedPerCycle, since, sentence }],
 *   realisedPerCycle, realisedPerYear, realisedSoFar,
 *   sentence, winsSentence, cycles: string[], assumptions: string[],
 * }}
 *
 * Savings totals (`optionalPerCycle` and friends, `byKind`) leave out lines overridden `keep` or
 * `cancelled` and every instalment / repayment; `byCadence` and `lines` describe every active line.
 */
export function buildSubscriptions(lines, options = {}) {
  const { calendar = null, lineOverrides = {} } = options;
  const cycles = completeMonths(calendar);
  const through = toDay(options.dataThrough ?? calendar?.dataThrough);
  const asOf = toDay(options.asOf) ?? through;
  const assumptions = [];
  const overrideOf = (line) => lineOverrides?.[line.id] ?? null;

  const considered = (lines ?? [])
    .filter((line) => overrideOf(line) !== 'ignore')
    .map((line) => ({ ...line, override: overrideOf(line) }));
  const active = considered.filter((l) => l.status === 'active' && !l.tentative).sort(byPerCycleDesc);
  const countable = active.filter((l) => !l.override);

  const byKind = kindTotals(countable);
  const byCadence = Object.fromEntries(
    CADENCES.map((c) => [c, active.filter((l) => l.cadence === c).length]),
  );
  const perCycleOf = (kind) => (DEBT_KINDS.has(kind) ? 0 : byKind[kind].perCycle);
  const optionalPerCycle = perCycleOf('optional');

  const annualItems = active
    .filter((l) => l.cadence === 'annual')
    .map((l) => ({
      ...l,
      setAsidePerCycle: l.amount / 12,
      sentence: `${l.label}: ${R(l.amount)} a year — set aside ${R(l.amount / 12)} a cycle.`,
    }));

  const dueSoon = through
    ? active.filter((l) => {
        if (!l.nextDate) return false;
        const days = daysBetween(through, l.nextDate);
        return days >= 0 && days <= DUE_SOON_DAYS;
      })
    : [];

  // ---- new lines: first seen in the last NEW_LINE_CYCLES complete cycles, or since ----------
  const windowKey = cycles.length ? cycles[Math.max(0, cycles.length - NEW_LINE_CYCLES)] : null;
  const windowStart = windowKey ? toDay(calendar.starts[windowKey]) : null;
  const newSince = windowKey
    ? { cycle: windowKey, label: MONTHS[Number(windowKey.split('-')[1]) - 1], start: windowStart }
    : null;
  const cyclesSeenOf = (l) => new Set((l.items ?? []).map((t) => t['Pay Month']).filter(Boolean)).size;
  const newLines = windowStart
    ? considered
        .filter(
          (l) =>
            l.source === 'charge' &&
            !DEBT_KINDS.has(l.kind) &&
            !isInternalMovementCategory(l.category ?? '') &&
            (l.observations ?? 0) >= 2 &&
            l.firstSeen &&
            toDay(l.firstSeen) >= windowStart &&
            (l.tentative || (SCHEDULED.has(l.cadence) && cyclesSeenOf(l) >= 2)),
        )
        .map((l) => {
          const wording =
            l.observations === 2
              ? 'charged twice, about a month apart'
              : (CADENCE_WORD[l.cadence] ?? CADENCE_WORD.irregular);
          const headline =
            l.perCycle >= NEW_LINE_HEADLINE_MIN &&
            l.observations >= 3 &&
            HEADLINE_KINDS.has(l.kind) &&
            SCHEDULED.has(l.cadence);
          return {
            ...l,
            cyclesSeen: cyclesSeenOf(l),
            trialConverted: trialConvertedOf(l),
            wording,
            headline,
            sentence: `${l.label}: ${wording} — ${R(l.perCycle)} a cycle`,
          };
        })
        .sort(byPerCycleDesc)
    : [];

  // ---- lapsed lines and cancellations: the only savings the data can prove --------------------
  // A cycle counts as saved once it is complete and ends on or after the day the next charge was
  // due — the cycle that would have carried the charge, and every complete one after it.
  const completeCyclesSince = (since) =>
    since ? cycles.filter((c) => calendar.ends[c] && midnight(calendar.ends[c]) >= since).length : 0;
  const lapsedNaturally = considered
    .filter(
      (l) =>
        l.status === 'lapsed' &&
        (l.observations ?? 0) >= 3 &&
        LAPSED_KINDS.has(l.kind) &&
        MONTHLY_OR_SLOWER.has(l.cadence) &&
        l.regular,
    )
    .map((l) => {
      const since = l.lastSeen ? addDays(toDay(l.lastSeen), Math.round(l.medianGap ?? 30)) : null;
      const savedSoFar = completeCyclesSince(since) * l.perCycle;
      return { ...l, savedPerCycle: l.perCycle, since, savedSoFar, byOverride: false };
    });
  const cancelled = active
    .filter((l) => l.override === 'cancelled' && !DEBT_KINDS.has(l.kind))
    .map((l) => ({
      ...l,
      savedPerCycle: l.perCycle,
      since: asOf,
      savedSoFar: completeCyclesSince(asOf) * l.perCycle,
      byOverride: true,
    }));
  const lapsedLines = [...lapsedNaturally, ...cancelled]
    .map((l) => ({
      ...l,
      sentence: l.byOverride
        ? `${l.label}: cancelled — ${R(l.savedPerCycle)} a cycle from now on.`
        : `${l.label}: last charged ${cycleLabel(l.regimes?.at(-1)?.to)} — ${R(l.savedPerCycle)} a cycle, ${R(l.savedSoFar)} saved so far.`,
    }))
    .sort((a, b) => b.savedPerCycle - a.savedPerCycle);

  const downgrades = active
    .filter((l) => l.priceChange && l.priceChange.pct <= -PRICE_STEP_MIN_PCT && !DEBT_KINDS.has(l.kind))
    .map((l) => {
      const perYear = l.perYear ?? 12;
      const savedPerCycle = ((l.priceChange.from - l.priceChange.to) * perYear) / 12;
      return {
        ...l,
        savedPerCycle,
        since: l.priceChange.since,
        sentence: `${l.label}: ${R(l.priceChange.from)} → ${R(l.priceChange.to)} since ${cycleLabel(l.priceChange.since)} — ${R(savedPerCycle)} a cycle cheaper.`,
      };
    })
    .sort((a, b) => b.savedPerCycle - a.savedPerCycle);
  if (downgrades.some((l) => l.perYear == null)) {
    assumptions.push('An irregular line that got cheaper is counted as if it charged monthly.');
  }
  assumptions.push(
    'A stopped line counts as a win only when it charged monthly or slower at a regular amount; a shop you stopped visiting is not a subscription.',
  );

  const realisedPerCycle = sum(lapsedLines, (l) => l.savedPerCycle) + sum(downgrades, (l) => l.savedPerCycle);
  const realisedSoFar = sum(lapsedLines, (l) => l.savedSoFar);

  return {
    lines: active,
    byKind,
    byCadence,
    optionalPerCycle,
    optionalPerYear: optionalPerCycle * 12,
    insurancePerCycle: perCycleOf('insurance'),
    feePerCycle: perCycleOf('fee'),
    utilityPerCycle: perCycleOf('utility'),
    annualItems,
    dueSoon,
    newLines,
    newSince,
    lapsedLines,
    downgrades,
    realisedPerCycle,
    realisedPerYear: realisedPerCycle * 12,
    realisedSoFar,
    sentence: `${plural(byKind.optional.count, 'optional service')} cost ${R(optionalPerCycle)} a cycle — ${R(optionalPerCycle * 12)} a year.`,
    winsSentence: `You stopped ${plural(lapsedLines.length, 'subscription')} and ${downgrades.length} got cheaper: ${R(realisedPerCycle)} a cycle, ${R(realisedSoFar)} saved so far.`,
    cycles,
    assumptions,
  };
}
