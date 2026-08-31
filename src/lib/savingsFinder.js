import { SAVINGS_CONFIDENCE_WEIGHT } from '../constants';
import { formatCurrencyAbs } from '../utils/format';

/**
 * The Savings Finder: one ranked list of the money the other modules found, and one honest total.
 *
 * This is an aggregator and nothing else — it computes no new figure from rows, it reads the
 * recurring audit, price creep, the fees audit, drift and the basket, and it sorts what they said
 * into three buckets that must never be added together:
 *
 *   cancellable    something you could stop paying next cycle: an optional subscription, a price
 *                  increase to query, a second account fee, payment protection on a card. This is
 *                  `found`, and only the high- and medium-confidence items count.
 *   behavioural    a category that drifted up, or more grocery trips — an explanation of where the
 *                  money went, which might change if the habit does. Reported as potential, shown
 *                  beside `found`, never inside it.
 *   informational  card interest. It is the largest avoidable cost in the house and it is not a
 *                  saving anyone can make by cancelling anything: it becomes one only once the
 *                  balance is paid down, which is the Debt view's job. Listing it under "found"
 *                  would be the single most misleading number the app could print.
 *
 * A line that is both a subscription and a price increase is one item, not two. The ranking
 * weights each figure by how sure the source was, so a R1 000 guess sorts under a R300 certainty.
 */

const R = (n) => formatCurrencyAbs(n);
const COUNTED = new Set(['high', 'medium']);
const AVOIDABLE_MIN_PER_CYCLE = 20;
const item = (fields) => ({
  lineId: null,
  evidence: [],
  ...fields,
  perYear: fields.perCycle * 12,
  sentence: `${fields.label}: ${R(fields.perCycle)} a cycle — ${fields.action}`,
});

/** Below this, a single line isn't worth its own decision — matches the fees floor below. */
const MIN_INDIVIDUAL_PER_CYCLE = AVOIDABLE_MIN_PER_CYCLE;

function subscriptionItems(subscriptions) {
  const out = [];
  const minor = [];

  (subscriptions?.lines ?? []).forEach((line) => {
    if (line.kind !== 'optional' || line.override) return;
    if (line.perCycle < MIN_INDIVIDUAL_PER_CYCLE) {
      minor.push({
        kind: 'subscription',
        label: line.label,
        perCycle: line.perCycle,
        sentence: `${line.label}: ${R(line.perCycle)} a cycle`,
        action: 'cancel or downgrade',
      });
      return;
    }
    out.push(
      item({
        id: `subscription|${line.id}`,
        kind: 'subscription',
        bucket: 'cancellable',
        label: line.label,
        perCycle: line.perCycle,
        confidence: 'high',
        action: 'cancel or downgrade',
        evidence: [`${line.cadence}, ${R(line.amount)} since ${line.regimes?.[0]?.from ?? '?'}, ${line.level} confidence`],
        lineId: line.id,
      }),
    );
  });

  (subscriptions?.newLines ?? []).forEach((line) => {
    if (line.override) return;
    // `headline` already means established and material enough (subscriptions.js's own gate);
    // anything short of that is a two-observation guess and belongs with the rest of the minor
    // pile below, not its own row demanding its own decision.
    if (line.headline) {
      out.push(
        item({
          id: `new-charge|${line.id}`,
          kind: 'new-charge',
          bucket: 'cancellable',
          label: line.label,
          perCycle: line.perCycle,
          confidence: 'medium',
          action: 'check that you meant to keep it',
          evidence: [line.sentence, line.trialConverted ? 'a trial that converted' : null].filter(Boolean),
          lineId: line.id,
        }),
      );
      return;
    }
    minor.push({
      kind: 'new-charge',
      label: line.label,
      perCycle: line.perCycle,
      sentence: line.sentence,
      action: 'check that you meant to keep it',
    });
  });

  // Small or unproven lines don't each deserve their own row: three R30-R100 guesses read as three
  // chores, when "3 smaller or unproven charges — R225 a cycle" is one glance. Tried grouping these
  // by category first; it didn't help — on real data "Credit Card" and "Credit Facility" are two
  // different categories, so every minor line still stood alone in its own group of one. Collapsed
  // to a single row instead, regardless of category: every name still appears, in the row itself
  // when there are few enough to read at a glance and in full in the evidence either way, so nothing
  // about what's inside it is hidden, only folded.
  if (minor.length === 1) {
    const m = minor[0];
    out.push(
      item({
        id: `minor|${m.label}`,
        kind: m.kind,
        bucket: 'cancellable',
        label: m.label,
        perCycle: m.perCycle,
        confidence: 'low',
        action: m.action,
        evidence: [m.sentence],
      }),
    );
  } else if (minor.length > 1) {
    const names = minor.map((m) => m.label);
    const shown = names.length <= 3 ? names.join(', ') : `${names.slice(0, 2).join(', ')} and ${names.length - 2} more`;
    out.push(
      item({
        id: 'minor',
        kind: 'minor',
        bucket: 'cancellable',
        label: `${minor.length} smaller or unproven charges — ${shown}`,
        perCycle: minor.reduce((s, m) => s + m.perCycle, 0),
        confidence: 'low',
        action: 'worth a glance together',
        evidence: minor.map((m) => m.sentence),
      }),
    );
  }

  return out;
}

function creepItems(priceCreep) {
  return (priceCreep?.rising ?? [])
    .filter((r) => r.countsInTotal && r.extraPerCycle > 0)
    .map((r) =>
      item({
        id: `creep|${r.lineId}`,
        kind: 'creep',
        bucket: 'cancellable',
        label: r.label,
        perCycle: r.extraPerCycle,
        confidence: r.steps.length >= 1 && r.first.count >= 3 && r.last.count >= 3 ? 'high' : 'medium',
        action: 'query or renegotiate',
        evidence: [r.sentence],
        lineId: r.lineId,
      }),
    );
}

function feeItems(fees) {
  const out = [];
  if (!fees) return out;
  (fees.ppi?.byAccount ?? []).forEach((a) => {
    out.push(
      item({
        id: `ppi|${a.accountId}`,
        kind: 'ppi',
        bucket: 'cancellable',
        label: `Payment protection on the ${a.label}`,
        perCycle: a.perCycle,
        confidence: 'medium',
        action: 'optional cover — ask the card issuer to remove it',
        evidence: [fees.ppi.sentence],
      }),
    );
  });
  if (fees.consolidation && fees.consolidation.savingPerYear > 0) {
    out.push(
      item({
        id: 'consolidation',
        kind: 'consolidation',
        bucket: 'cancellable',
        label: 'Second account fee',
        perCycle: fees.consolidation.savingPerYear / 12,
        confidence: 'medium',
        action: `close the ${fees.consolidation.closeCandidate}, keep the ${fees.consolidation.keepCandidate}`,
        evidence: [fees.consolidation.sentence],
      }),
    );
  }
  if ((fees.avoidablePerYear ?? 0) / 12 >= AVOIDABLE_MIN_PER_CYCLE) {
    out.push(
      item({
        id: 'avoidable-fees',
        kind: 'avoidable-fees',
        bucket: 'cancellable',
        label: 'Transaction, ATM and penalty fees',
        perCycle: fees.avoidablePerYear / 12,
        confidence: 'high',
        action: 'use the bundled payment options; avoid instant payments, ATM draws and bounced debits',
        evidence: [fees.sentences?.avoidable].filter(Boolean),
      }),
    );
  }
  return out;
}

function behaviouralItems(drift, basket) {
  const out = [];
  (drift?.flagged ?? [])
    .filter((c) => c.direction === 'up')
    .forEach((c) => {
      out.push(
        item({
          id: `drift|${c.category}`,
          kind: 'drift',
          bucket: 'behavioural',
          label: c.category,
          perCycle: c.delta,
          confidence: 'medium',
          action: 'what changed, not money found',
          evidence: [c.sentence, ...(c.topMerchants ?? []).map((m) => `${m.label} ${R(m.recentPerCycle)} a cycle`)],
        }),
      );
    });
  (basket?.families ?? [])
    .filter((f) => f.merchantFamily == null && f.driver === 'frequency' && f.frequencyPerCycle > 0)
    .forEach((f) => {
      out.push(
        item({
          id: `basket|${f.category}`,
          kind: 'basket',
          bucket: 'behavioural',
          label: `${f.category} trips`,
          perCycle: f.frequencyPerCycle,
          confidence: 'low',
          action: 'fewer trips at the same basket',
          evidence: [f.sentence],
        }),
      );
    });
  return out;
}

function informationalItems(fees) {
  if (!fees?.cardInterest || !(fees.cardInterest.perCycle > 0)) return [];
  return [
    item({
      id: 'card-interest',
      kind: 'card-interest',
      bucket: 'informational',
      label: 'Card interest',
      perCycle: fees.cardInterest.perCycle,
      confidence: 'high',
      action: 'becomes a saving only once the balance is paid down — see Debt',
      evidence: [fees.cardInterest.sentence],
    }),
  ];
}

/** Items sharing a line collapse to one: the larger figure, both evidences, every kind named. */
function dedupe(items) {
  const byLine = new Map();
  const out = [];
  items.forEach((it) => {
    if (!it.lineId) {
      out.push({ ...it, kinds: [it.kind] });
      return;
    }
    const existing = byLine.get(it.lineId);
    if (!existing) {
      const merged = { ...it, kinds: [it.kind] };
      byLine.set(it.lineId, merged);
      out.push(merged);
      return;
    }
    const keep = it.perCycle > existing.perCycle ? it : existing;
    Object.assign(existing, keep, {
      kinds: [...existing.kinds, it.kind],
      evidence: [...existing.evidence, ...it.evidence],
      perYear: keep.perCycle * 12,
    });
  });
  return out;
}

const weightOf = (it) => it.perCycle * (SAVINGS_CONFIDENCE_WEIGHT[it.confidence] ?? 0);

/**
 * @param inputs  subscriptions: buildSubscriptions; priceCreep: buildPriceCreep; drift: buildDrift;
 *                fees: buildFeesAudit; basket: buildBasket; debtBudget: { deficitPerCycle } | null;
 *                processed: { netAvg } | null
 * @returns {{
 *   items: [{ id, kind, kinds: string[], bucket: 'cancellable'|'behavioural', label, perCycle, perYear,
 *             confidence: 'high'|'medium'|'low', action, evidence: string[], lineId: string|null, sentence }],
 *                                              // ranked by perCycle × SAVINGS_CONFIDENCE_WEIGHT[confidence]
 *   found, foundPerYear,                       // Σ cancellable items at high or medium confidence
 *   behaviouralPotential,                      // Σ behavioural items — shown beside found, never inside it
 *   informational: [item],                     // card interest; never in found
 *   deficit, cover,                            // cover = found / deficit, null when there is no deficit
 *   realised, realisedPerYear,                 // from the recurring audit's lapsed and cheaper lines
 *   cycles: string[], sentence, caption, realisedSentence, assumptions: string[],
 * }}
 */
export function buildSavingsFinder({
  subscriptions = null,
  priceCreep = null,
  drift = null,
  fees = null,
  basket = null,
  debtBudget = null,
  processed = null,
} = {}) {
  const items = dedupe([
    ...subscriptionItems(subscriptions),
    ...creepItems(priceCreep),
    ...feeItems(fees),
    ...behaviouralItems(drift, basket),
  ]).sort((a, b) => weightOf(b) - weightOf(a) || b.perCycle - a.perCycle);
  const informational = informationalItems(fees);

  const found = items
    .filter((it) => it.bucket === 'cancellable' && COUNTED.has(it.confidence))
    .reduce((s, it) => s + it.perCycle, 0);
  const behaviouralPotential = items
    .filter((it) => it.bucket === 'behavioural')
    .reduce((s, it) => s + it.perCycle, 0);
  const deficit = debtBudget?.deficitPerCycle ?? Math.max(0, -(processed?.netAvg ?? 0));
  const cover = deficit > 0 ? found / deficit : null;
  const realised = subscriptions?.realisedPerCycle ?? 0;
  const pct = cover == null ? null : Math.round(cover * 100);

  return {
    items,
    found,
    foundPerYear: found * 12,
    behaviouralPotential,
    informational,
    deficit,
    cover,
    realised,
    realisedPerYear: realised * 12,
    cycles: subscriptions?.cycles ?? [],
    sentence: `Found ${R(found)} a cycle`,
    caption:
      (cover == null ? '' : `${pct}% of the ${R(deficit)} gap · `) +
      `${R(behaviouralPotential)} more if the trips and drift below change`,
    realisedSentence: `Already saved ${R(realised)} a cycle`,
    assumptions: [
      'Found counts only cancellable items at high or medium confidence; behavioural potential is shown separately.',
      'Card interest is informational: it becomes a saving only once the balance is paid down.',
    ],
  };
}
