import { describe, expect, it } from 'vitest';
import { loadRealExport } from '../test/realData';
import { assignKeys } from '../db/txnKey';
import { groupTransactionsByDescription } from './groupTransactions';
import { getPayMonth } from './effectivePayMonth';
import {
  paymentsOf,
  providerIsUsable,
  providerOf,
  rowsSaved,
  suggestName,
  suggestSynonyms,
} from './providers';

/** The real shape of the problem: two shops, six rows. */
const DESCRIPTIONS = [
  'Pick N Pay Asap Kenilworth Za',
  'Pnp Crp Glengarry Cape Town Za',
  'Pnp Hpr Brackenfell Brackenfell Za',
  'Kwikspar Vierlanden Mi Western Cape Za',
  'Spar Vredekloof Western Cape Za',
  'Spar Brackenfell Western Cape Za',
];
const data = DESCRIPTIONS.map((Description, i) => ({ key: `k${i}`, Description, AmountNum: -100 }));

const pnp = { name: 'Pick n Pay', synonyms: ['pnp ', 'pick n pay'] };
const spar = { name: 'Spar', synonyms: ['spar'] };

describe('providerIsUsable', () => {
  it('needs a name and a synonym worth matching on', () => {
    expect(providerIsUsable(pnp)).toBe(true);
    expect(providerIsUsable({ name: 'Spar', synonyms: [] })).toBe(false);
    expect(providerIsUsable({ name: '', synonyms: ['spar'] })).toBe(false);
    // A one-character synonym would swallow most of the file.
    expect(providerIsUsable({ name: 'Spar', synonyms: ['s'] })).toBe(false);
    expect(providerIsUsable(null)).toBe(false);
  });
});

describe('providerOf', () => {
  it('folds the branches of one chain onto one name', () => {
    const found = DESCRIPTIONS.map((d) => providerOf(d, [pnp, spar]));
    expect(found).toEqual(['Pick n Pay', 'Pick n Pay', 'Pick n Pay', 'Spar', 'Spar', 'Spar']);
  });

  it('catches Kwikspar under Spar, because a substring is what a person means', () => {
    expect(providerOf('Kwikspar Vierlanden Mi Western Cape Za', [spar])).toBe('Spar');
  });

  it('leaves anything it does not recognise alone', () => {
    expect(providerOf('Woolworths Brackenfell', [pnp, spar])).toBeNull();
    expect(providerOf('', [pnp])).toBeNull();
    expect(providerOf('Spar', [])).toBeNull();
  });

  it('takes the first match, so a narrower synonym can be listed above a broader one', () => {
    const superSpar = { name: 'SuperSpar', synonyms: ['superspar'] };
    expect(providerOf('Superspar Durbanville', [superSpar, spar])).toBe('SuperSpar');
    expect(providerOf('Superspar Durbanville', [spar, superSpar])).toBe('Spar');
  });

  it('lists what it covers', () => {
    expect(paymentsOf(data, pnp)).toHaveLength(3);
    expect(paymentsOf(data, { name: 'x', synonyms: [] })).toEqual([]);
  });
});

describe('suggestSynonyms', () => {
  it('finds the opening the selected rows share', () => {
    expect(suggestSynonyms(['Pnp Crp Glengarry Cape Town Za', 'Pnp Hpr Brackenfell Brackenfell Za'])).toEqual(['pnp']);
    expect(suggestSynonyms(['Spar Vredekloof Western Cape Za', 'Spar Brackenfell Western Cape Za'])).toEqual(['spar']);
  });

  it('falls back to one synonym each when they share no opening', () => {
    // "Pick N Pay ..." and "Pnp Crp ..." share nothing, so neither can speak for the other.
    const out = suggestSynonyms(['Pick N Pay Asap Kenilworth Za', 'Pnp Crp Glengarry Cape Town Za']);
    expect(out).toEqual(['pick n', 'pnp crp']);
  });

  it('never offers an opening too short to be safe', () => {
    // A shared "za" would match most of a South African export.
    expect(suggestSynonyms(['Za One Thing', 'Za Other Thing'])).not.toContain('za');
    expect(suggestSynonyms([])).toEqual([]);
  });

  it('names the provider from the same shared opening', () => {
    expect(suggestName(['Pnp Crp Glengarry', 'Pnp Hpr Brackenfell'])).toBe('Pnp');
    expect(suggestName(['Spar Vredekloof', 'Spar Brackenfell'])).toBe('Spar');
    expect(suggestName([])).toBe('');
  });
});

describe('rowsSaved', () => {
  it('counts the rows the ledger loses — the reason the feature exists', () => {
    // Six descriptions, two providers: six rows become two.
    expect(rowsSaved(data, [pnp, spar])).toBe(4);
    expect(rowsSaved(data, [spar])).toBe(2);
    expect(rowsSaved(data, [])).toBe(0);
  });

  it('counts nothing for a provider that covers one description', () => {
    expect(rowsSaved([data[0]], [pnp])).toBe(0);
  });
});

const real = loadRealExport();
describe.skipIf(!real)('providers on the real export', () => {
  const providers = [
    { name: 'Pick n Pay', synonyms: ['pnp ', 'pick n pay'] },
    { name: 'Spar', synonyms: ['spar'] },
    { name: 'Checkers', synonyms: ['checkers'] },
    { name: 'Engen', synonyms: ['engen'] },
  ];

  it('folds dozens of branch names onto a handful of shops', () => {
    const rows = assignKeys(loadRealExport());
    // One petrol chain banks under 27 different strings; one grocer under 22. No string-similarity
    // measure relates "Pnp Hpr Brackenfell" to "Pick N Pay Asap Kenilworth" — only a person can.
    const namesFor = (p) =>
      new Set(rows.filter((t) => providerOf(t.Description, [p])).map((t) => t.Description)).size;
    expect(namesFor(providers[1])).toBeGreaterThan(10);
    expect(namesFor(providers[3])).toBeGreaterThan(10);
    expect(rowsSaved(rows, providers)).toBeGreaterThan(40);
  });

  it('actually collapses the ledger rows, which is the point', () => {
    const rows = assignKeys(loadRealExport());
    const months = [...new Set(rows.map(getPayMonth))].filter(Boolean).sort().slice(-13);
    const groceries = rows.filter((t) => t.Category === 'Groceries');
    const before = groupTransactionsByDescription(groceries, months, true, {});
    const after = groupTransactionsByDescription(groceries, months, true, {}, providers);
    expect(after.length).toBeLessThan(before.length);
    // And each folded row keeps the real names beneath it as variants, so nothing is hidden.
    const folded = after.find((g) => g.provider === 'Spar');
    expect(folded.variants.length).toBeGreaterThan(1);
    expect(folded.keys.length).toBeGreaterThan(folded.variants.length);
  });
});
