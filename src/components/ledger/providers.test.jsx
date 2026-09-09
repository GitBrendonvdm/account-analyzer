import { describe, expect, it } from 'vitest';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { ProvidersPanel } from './ProvidersPanel';

/**
 * The panel that folds branch names onto shops. The detector is tested in lib/providerSuggest;
 * what matters here is that the reader can see what a one-click accept is about to do — the shop's
 * name, how much it covers, and the names it would swallow — before they click it.
 */

const txn = (Description, Category, over = {}) => ({
  key: `${Description}|${Math.random()}`,
  Date: '2026-09-10',
  Description,
  Category,
  Account: 'FNB Cheque *2000',
  AmountNum: -310,
  'Pay Month': '2026-09',
  ...over,
});

const many = (description, n, category) => Array.from({ length: n }, () => txn(description, category));
const spend = [
  ...many('Engen De Bron Convenie Brackenfell Za', 3, 'Transport & Fuel'),
  ...many('Engen Winelds Stp Sou Kraaifontein Za', 3, 'Transport & Fuel'),
  ...many('Nedbhl Repayment', 8, 'Home Loan / Bond'),
];

const render = (el) =>
  renderToStaticMarkup(el)
    .replace(/&#x27;/g, "'")
    .replace(/&quot;/g, '"')
    .replace(/&amp;/g, '&')
    .replace(/[  ]/g, ' ');

const props = (over = {}) => ({
  providers: [],
  data: spend,
  spend,
  onChange: () => {},
  draft: null,
  onDraft: () => {},
  ...over,
});

describe('ProvidersPanel', () => {
  it('explains why a shop is not the same thing as a row', () => {
    const html = render(createElement(ProvidersPanel, props()));
    expect(html).toContain('New provider');
    expect(html).toContain('three rows and one shop');
  });

  it('offers the shops it is confident about, with what each one covers', () => {
    const html = render(createElement(ProvidersPanel, props()));
    expect(html).toContain('1 shops');
    expect(html).toContain('Engen');
    expect(html).toContain('2 names · 6 payments · Transport &amp; Fuel'.replace('&amp;', '&'));
    // The names it would swallow are on the card, because that is what makes one click safe.
    expect(html).toContain('Engen De Bron Convenie Brackenfell Za');
    expect(html).toContain('Group all 1');
  });

  it('does not offer the bank talking about itself', () => {
    expect(render(createElement(ProvidersPanel, props()))).not.toContain('Nedbhl');
  });

  it('stops offering a shop once it is grouped', () => {
    const providers = [{ name: 'Engen', synonyms: ['engen'] }];
    const html = render(createElement(ProvidersPanel, props({ providers })));
    expect(html).not.toContain('Group all');
    expect(html).toContain('Providers (1)');
    expect(html).toContain('6 payments');
  });

  it('leads with the rows a grouping folds away, which is the reason to bother', () => {
    const providers = [{ name: 'Engen', synonyms: ['engen'] }];
    expect(render(createElement(ProvidersPanel, props({ providers })))).toContain('folding 1 row');
  });

  it('counts a draft before it is saved, and lists the names it will catch', () => {
    const draft = { name: 'Engen', synonyms: ['engen'] };
    const html = render(createElement(ProvidersPanel, props({ draft })));
    expect(html).toContain('catches');
    expect(html).toContain('>6<');
    // The preview lists the names it will swallow, lower-cased as the matcher sees them.
    expect(html).toContain('engen winelds stp sou kraaifontein za');
  });

  it('opens a saved provider onto the fields it was made with', () => {
    // A provider is never finished: next month's export spells a branch a way this one has not
    // seen, and without this the only recourse is to delete the shop and type it again.
    const providers = [{ name: 'Engen', synonyms: ['engen'] }];
    const html = render(createElement(ProvidersPanel, props({ providers })));
    expect(html).toContain('Edit Engen');
    expect(html).toContain('aria-expanded="false"');
  });

  it('refuses a provider with nothing to match on', () => {
    const draft = { name: 'Engen', synonyms: [] };
    const html = render(createElement(ProvidersPanel, props({ draft })));
    expect(html).toContain('Needs a name, and at least one thing to match on');
  });
});
