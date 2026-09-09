import { describe, it, expect } from 'vitest';
import { suggestProviders, SUGGEST_MIN_PAYMENTS } from './providerSuggest';

/** n rows of one description, all in one category. */
const rows = (description, n, Category = 'Groceries', extra = {}) =>
  Array.from({ length: n }, () => ({ Description: description, Category, ...extra }));

const engen = [
  ...rows('Engen De Bron Convenie Brackenfell Za', 3, 'Transport & Fuel'),
  ...rows('Engen Winelds Stp Sou Kraaifontein Za', 3, 'Transport & Fuel'),
];

describe('suggestProviders', () => {
  it('proposes a shop whose branch names all file under one category', () => {
    const [engenSuggestion, ...rest] = suggestProviders(engen);
    expect(rest).toEqual([]);
    expect(engenSuggestion).toMatchObject({
      name: 'Engen',
      synonyms: ['engen'],
      names: 2,
      payments: 6,
      purity: 1,
      category: 'Transport & Fuel',
    });
    // The names it would swallow travel with it, because a one-click accept is only safe if what
    // it will do is visible before the click.
    expect(engenSuggestion.sample).toHaveLength(2);
  });

  it('says nothing about a shop seen once or twice', () => {
    expect(suggestProviders(rows('Engen De Bron Za', SUGGEST_MIN_PAYMENTS - 1, 'Transport & Fuel'))).toEqual([]);
  });

  it('says nothing when every payment carries the same name — there is nothing to fold', () => {
    expect(suggestProviders(rows('Engen De Bron Za', 20, 'Transport & Fuel'))).toEqual([]);
  });

  it('leaves alone a word whose payments are spread across categories', () => {
    const spread = [
      ...rows('Int Charge One', 4, 'Bank Charges'),
      ...rows('Int Something Else', 4, 'General Purchases'),
    ];
    expect(suggestProviders(spread)).toEqual([]);
  });

  it('never proposes banking language, however pure its category', () => {
    const pure = [
      ...rows('Budget Facility Fee One', 8, 'Home & Garden'),
      ...rows('Budget Facility Fee Two', 8, 'Home & Garden'),
    ];
    expect(suggestProviders(pure)).toEqual([]);
  });

  it('never proposes a payment gateway — it names the card machine, not the shop', () => {
    const gateway = [
      ...rows('Paygate Cape Town Za', 5, 'Eating Out & Takeaways'),
      ...rows('Paygate Somerset Za', 5, 'Eating Out & Takeaways'),
    ];
    expect(suggestProviders(gateway)).toEqual([]);
  });

  it('never proposes a category that is the bank talking about itself', () => {
    const bank = [
      ...rows('Nedbhl Repayment One', 6, 'Home Loan / Bond'),
      ...rows('Nedbhl Repayment Two', 6, 'Home Loan / Bond'),
    ];
    expect(suggestProviders(bank)).toEqual([]);
  });

  it('skips payments to people, whose key would be somebody’s name', () => {
    const people = [
      ...rows('1Sa Jane Doe Rent', 6, 'Housekeeping'),
      ...rows('1Sa Jane Doe Extra', 6, 'Housekeeping'),
    ];
    expect(suggestProviders(people)).toEqual([]);
  });

  it('does not re-offer a shop that is already grouped', () => {
    const existing = [{ name: 'Engen', synonyms: ['engen'] }];
    expect(suggestProviders(engen, existing)).toEqual([]);
  });

  it('folds every spelling of one brand into a single suggestion', () => {
    const pnp = [
      ...rows('Pnp Crp Glengarry Cape Town Za', 4),
      ...rows('Pnp Hpr Brackenfell Brackenfell Za', 4),
      ...rows('Pick N Pay Asap Kenilworth Za', 4),
    ];
    const [suggestion] = suggestProviders(pnp);
    expect(suggestion.name).toBe('Pick n Pay');
    expect(suggestion.synonyms).toEqual(['pnp', 'pick n pay']);
    expect(suggestion.payments).toBe(12);
  });

  it('drops a brand alias the file never uses, so no synonym catches nothing', () => {
    const [suggestion] = suggestProviders([
      ...rows('Pnp Crp Glengarry Cape Town Za', 4),
      ...rows('Pnp Hpr Brackenfell Brackenfell Za', 4),
    ]);
    expect(suggestion.synonyms).toEqual(['pnp']);
  });

  it('offers the broader shop only, when one name already contains the other', () => {
    const spar = [
      ...rows('Spar Brackenfell Western Cape Za', 4),
      ...rows('Spar Vredekloof Western Cape Za', 4),
      ...rows('Superspar Cape Gate 2 Western Cape Za', 4),
      ...rows('Superspar Kraaifontein Western Cape Za', 4),
    ];
    const names = suggestProviders(spar).map((s) => s.name);
    expect(names).toEqual(['Spar']);
  });

  it('ranks by how many payments each shop accounts for', () => {
    const many = [
      ...engen,
      ...rows('Clicks Cape Gate Za', 5, 'Personal Care'),
      ...rows('Clicks Brackenfell Za', 5, 'Personal Care'),
    ];
    expect(suggestProviders(many).map((s) => s.name)).toEqual(['Clicks', 'Engen']);
  });

  it('survives an empty or absent file', () => {
    expect(suggestProviders(null)).toEqual([]);
    expect(suggestProviders([])).toEqual([]);
    expect(suggestProviders([{}, { Description: '' }])).toEqual([]);
  });
});
