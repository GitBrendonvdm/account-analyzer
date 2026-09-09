import { describe, expect, it } from 'vitest';
import { effectiveOverrides, isByRule, matchesOf, matchesRule, ruleIsUsable } from './txnRules';

const t = (key, over = {}) => ({
  key,
  Description: 'Builders Warehouse Brackenfell',
  Category: 'Home Improvement',
  Account: 'FNB Cheque *2000',
  AmountNum: -4200,
  ...over,
});

const rule = (over = {}) => ({ description: 'builders', set: { category: 'Home Maintenance' }, ...over });

describe('ruleIsUsable', () => {
  it('demands both something to match on and something to do', () => {
    expect(ruleIsUsable(rule())).toBe(true);
    // A rule with no conditions would rewrite the entire file.
    expect(ruleIsUsable({ set: { category: 'X' } })).toBe(false);
    expect(ruleIsUsable({ description: 'builders' })).toBe(false);
    expect(ruleIsUsable({ description: 'builders', set: { flag: 'nonsense' } })).toBe(false);
    expect(ruleIsUsable({ minAmount: 5000, set: { flag: 'unexpected' } })).toBe(true);
    expect(ruleIsUsable(null)).toBe(false);
  });
});

describe('matchesRule', () => {
  it('matches description as a substring, case-insensitively', () => {
    expect(matchesRule(t('a'), rule())).toBe(true);
    expect(matchesRule(t('a', { Description: 'BUILDERS EXPRESS' }), rule())).toBe(true);
    expect(matchesRule(t('a', { Description: 'Woolworths' }), rule())).toBe(false);
  });

  it('matches category and account exactly, because a substring would catch neighbours', () => {
    const byCategory = { category: 'Other Insurance', set: { flag: 'expected' } };
    expect(matchesRule(t('a', { Category: 'Other Insurance' }), byCategory)).toBe(true);
    // "Insurance" must not swallow "Other Insurance", nor the reverse.
    expect(matchesRule(t('a', { Category: 'Insurance' }), byCategory)).toBe(false);
    const byAccount = { account: 'FNB Cheque *2000', set: { flag: 'expected' } };
    expect(matchesRule(t('a'), byAccount)).toBe(true);
    expect(matchesRule(t('a', { Account: 'FNB Cheque *2001' }), byAccount)).toBe(false);
  });

  it('matches on magnitude, so income and spend read the same way', () => {
    const big = { minAmount: 5000, set: { flag: 'unexpected' } };
    expect(matchesRule(t('a', { AmountNum: -6000 }), big)).toBe(true);
    expect(matchesRule(t('a', { AmountNum: 6000 }), big)).toBe(true);
    expect(matchesRule(t('a', { AmountNum: -4000 }), big)).toBe(false);
    const band = { minAmount: 100, maxAmount: 200, set: { flag: 'expected' } };
    expect(matchesRule(t('a', { AmountNum: -150 }), band)).toBe(true);
    expect(matchesRule(t('a', { AmountNum: -250 }), band)).toBe(false);
  });

  it('requires every condition present to hold', () => {
    const both = { description: 'builders', minAmount: 5000, set: { flag: 'unexpected' } };
    expect(matchesRule(t('a'), both)).toBe(false); // matches the name, not the amount
    expect(matchesRule(t('a', { AmountNum: -9000 }), both)).toBe(true);
  });

  it('ignores a disabled rule', () => {
    expect(matchesRule(t('a'), rule({ enabled: false }))).toBe(false);
    expect(matchesOf([t('a'), t('b')], rule({ enabled: false }))).toEqual([]);
    expect(matchesOf([t('a'), t('b', { Description: 'Woolworths' })], rule())).toHaveLength(1);
  });
});

describe('effectiveOverrides', () => {
  const data = [t('a'), t('b'), t('c', { Description: 'Woolworths', Category: 'Groceries' })];

  it('applies a rule to every payment it matches', () => {
    const out = effectiveOverrides(data, [rule()], null);
    expect(out.a.category).toBe('Home Maintenance');
    expect(out.b.category).toBe('Home Maintenance');
    expect(out.c).toBeUndefined();
    expect(isByRule(t('a'), out)).toBe(true);
  });

  it('lets a later rule beat an earlier one, field by field', () => {
    const out = effectiveOverrides(data, [
      rule({ set: { category: 'Home Maintenance', flag: 'unexpected' } }),
      rule({ set: { category: 'Renovations' } }),
    ], null);
    expect(out.a.category).toBe('Renovations');
    // The first rule's flag survives: the second said nothing about it.
    expect(out.a.flag).toBe('unexpected');
  });

  it("lets the reader's own correction beat a rule, so 'all of these except that one' is sayable", () => {
    const out = effectiveOverrides(data, [rule({ set: { category: 'Home Maintenance', flag: 'unexpected' } })], {
      a: { flag: 'expected' },
    });
    expect(out.a.flag).toBe('expected');
    expect(out.a.source.flag).toBe('manual');
    // Only the field they touched — the rule still supplies the category.
    expect(out.a.category).toBe('Home Maintenance');
    expect(out.a.source.category).toBe('rule');
    expect(out.b.flag).toBe('unexpected');
  });

  it('returns the manual map untouched when there are no usable rules', () => {
    const manual = { a: { flag: 'expected' } };
    expect(effectiveOverrides(data, [], manual)).toBe(manual);
    expect(effectiveOverrides(data, [{ set: { category: 'X' } }], manual)).toBe(manual);
    expect(effectiveOverrides(data, null, null)).toEqual({});
  });

  it('keeps a manual correction on a payment no rule touches', () => {
    const out = effectiveOverrides(data, [rule()], { c: { flag: 'unexpected' } });
    expect(out.c.flag).toBe('unexpected');
    expect(isByRule(t('c'), out)).toBe(false);
  });
});
