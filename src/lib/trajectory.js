/**
 * Where this ends up.
 *
 * The forecast stops at the next payday, which answers "will I make it to the 23rd" and nothing
 * about the direction of travel. With two years of history there's enough to say where the next
 * twelve cycles go if nothing changes — and "if nothing changes" is exactly the claim worth putting
 * in front of someone running a deficit.
 *
 * The model is deliberately dull: every account continues at the average pace it has actually been
 * moving. That reproduces what the data shows — cards climbing, loans amortising down — without
 * inventing a behavioural theory. It is a projection of the recent past, not a prediction, and the
 * UI says so.
 *
 * A scenario adds a monthly saving, applied to whichever account is absorbing the shortfall, so
 * "what if I cut takeaways by R2 000" moves the card line rather than a category cell.
 */

import { flattenCategories } from './categoryRows';

const MAX_CYCLES = 24;

/** Which account is absorbing the gap: the liability growing fastest. */
export function fundingAccount(balanced) {
  return (
    balanced
      .filter((b) => b.isLiability && b.typicalDelta < 0)
      .sort((a, b) => a.typicalDelta - b.typicalDelta)[0] ?? null
  );
}

function addCycles(date, n) {
  if (!date) return null;
  const d = new Date(date.getFullYear(), date.getMonth(), date.getDate());
  d.setMonth(d.getMonth() + n);
  return d;
}

/**
 * @param balanced   positions decorated with real balances (netWorth.applyBalances)
 * @param options    cycles to project, monthly saving to apply, and the cycle-end date to count from
 */
export function buildTrajectory(balanced, { cycles = 12, monthlySaving = 0, fromDate = null } = {}) {
  const horizon = Math.min(MAX_CYCLES, Math.max(1, cycles));
  const accounts = balanced.filter((b) => b.known);
  if (accounts.length === 0) return null;

  const absorber = fundingAccount(accounts);
  const points = [];
  const running = new Map(accounts.map((a) => [a.accountId ?? a.account, a.balance]));

  for (let i = 0; i <= horizon; i += 1) {
    if (i > 0) {
      accounts.forEach((a) => {
        const id = a.accountId ?? a.account;
        let delta = a.typicalDelta ?? 0;
        // The saving lands wherever the shortfall is landing: less borrowed, not more spent.
        if (absorber && id === (absorber.accountId ?? absorber.account)) delta += monthlySaving;
        running.set(id, running.get(id) + delta);
      });
    }
    const balances = Object.fromEntries([...running.entries()]);
    const values = [...running.values()];
    points.push({
      cycle: i,
      date: addCycles(fromDate, i),
      net: values.reduce((s, v) => s + v, 0),
      assets: values.filter((v) => v > 0).reduce((s, v) => s + v, 0),
      debt: values.filter((v) => v < 0).reduce((s, v) => s - v, 0),
      balances,
    });
  }

  // Where a card meets its limit, or a debt reaches zero.
  const events = [];
  accounts.forEach((a) => {
    const id = a.accountId ?? a.account;
    const limit = a.creditLimit;
    for (let i = 1; i <= horizon; i += 1) {
      const before = points[i - 1].balances[id];
      const after = points[i].balances[id];
      if (limit && before > -limit && after <= -limit) {
        events.push({ type: 'limit', account: a.label ?? a.account, cycle: i, date: points[i].date, amount: limit });
        break;
      }
      if (before < 0 && after >= 0) {
        events.push({ type: 'cleared', account: a.label ?? a.account, cycle: i, date: points[i].date, amount: 0 });
        break;
      }
    }
  });

  const first = points[0];
  const last = points[horizon];
  return {
    points,
    events: events.sort((a, b) => a.cycle - b.cycle),
    absorber: absorber ? (absorber.label ?? absorber.account) : null,
    horizon,
    monthlySaving,
    startNet: first.net,
    endNet: last.net,
    change: last.net - first.net,
    perCycle: (last.net - first.net) / horizon,
  };
}

/**
 * The smallest set of cuts that closes the gap.
 *
 * Ranked by how much a category could plausibly give up, not just by size: the bond is the largest
 * line in the data and suggesting you cut it would be useless, so contractual categories score zero
 * and never enter a plan. Everything else is scored by how much of it is genuinely a decision.
 *
 * When the flexible categories don't add up to the gap, the plan says so rather than padding itself
 * with cuts nobody can make. On this data that is the finding: the shortfall is structural.
 */
/**
 * Contractual. You cannot decide to pay 10% less bond this month, so these contribute nothing to a
 * plan — listing them at all would make the plan look achievable when it isn't.
 */
const FIXED = new Set([
  'Home Loan / Bond',
  'Vehicle Loan / Car Loan',
  'Personal Loan',
  'Rent',
  'Tax',
  'Interest',
  'Bank Charges',
]);

/** Reducible, but only deliberately and over time — a cheaper plan, a smaller policy. */
const CONSTRAINED = new Set([
  'Medical',
  'Other Insurance',
  'Education',
  'Home Utility & Service',
  'Cellphone',
  'Other Phone & Internet',
]);

/** Spend that is a decision every time. */
const FLEXIBLE = new Set([
  'Eating Out & Takeaways',
  'Alcohol',
  'Entertainment',
  'Lotto & Gambling',
  'Coffee',
  'Clothing',
  'Holidays & Travel',
  'Software & Services',
  'TV',
  'Cigarettes',
  'Sport & Fitness',
  'General Purchases',
  'Tech & Appliances',
]);

function flexibility(category) {
  if (FIXED.has(category)) return 0;
  if (CONSTRAINED.has(category)) return 0.15;
  if (FLEXIBLE.has(category)) return 0.6;
  return 0.3;
}

/**
 * @param processed the pipeline output — category rows carry their typical spend
 * @param gap       how much a cycle needs to be found, as a positive number
 */
export function buildGapClosers(processed, gap) {
  if (!processed || !(gap > 0)) return null;
  const categories = flattenCategories(processed);

  const candidates = categories
    .map((c) => {
      const typical = Math.abs(c.avg ?? 0);
      const share = flexibility(c.name);
      const monthly = Object.values(c.totalsByMonth ?? {}).map((v) => Math.abs(v));
      const spread = monthly.length > 1 ? Math.max(...monthly) - Math.min(...monthly) : 0;
      return {
        name: c.name,
        typical,
        // How much this category could give up without disappearing.
        available: typical * share,
        share,
        spread,
        isBill: !!c.isBill,
      };
    })
    // A category is off the table if it is contractual, or if the part of it still due this cycle
    // is a bill already committed.
    .filter((c) => c.available > 50 && !c.isBill && (c.committed ?? 0) === 0)
    .sort((a, b) => b.available - a.available);

  const plan = [];
  let found = 0;
  for (const c of candidates) {
    if (found >= gap) break;
    const take = Math.min(c.available, gap - found);
    plan.push({ ...c, cut: take, cutPercent: c.typical > 0 ? take / c.typical : 0 });
    found += take;
  }

  return {
    gap,
    found,
    closed: found >= gap - 1,
    shortfall: Math.max(0, gap - found),
    plan,
    // Everything that could contribute, whether or not the plan needed it.
    candidates: candidates.slice(0, 12),
    totalAvailable: candidates.reduce((s, c) => s + c.available, 0),
  };
}
