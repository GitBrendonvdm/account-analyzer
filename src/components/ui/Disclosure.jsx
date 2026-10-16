import { createContext, useContext } from 'react';
import { ChevronDown } from 'lucide-react';

const InsideDisclosure = createContext(false);

/**
 * A card's own title — unless it sits inside a Disclosure, which already says what it is. Without this
 * every folded section would announce itself twice, once on the bar and once on the card under it.
 */
export function Heading({ children, className = '' }) {
  return useContext(InsideDisclosure) ? null : <h2 className={`t-head ${className}`}>{children}</h2>;
}

/**
 * Detail the reader can ask for. The page leads with the few things that answer the question the
 * screen is for; everything that explains them folds under one of these, closed until it is wanted.
 *
 * A native `<details>`: it works without script, the keyboard and screen readers already know it, and
 * the folded content stays in the page so what is inside is measured and searchable the moment it
 * opens. The bar is plain, not a card — the cards inside are the surfaces, and a card on a card turns
 * both to mud. `merge` says the one card inside is this section, so its own title is not repeated.
 */
export function Disclosure({ title, summary, merge = false, defaultOpen = false, className = '', children }) {
  return (
    <details open={defaultOpen || undefined} className={`group ${className}`}>
      <summary className="flex cursor-pointer list-none items-center justify-between gap-4 rounded-2xl px-2 py-3 select-none hover:bg-fill/50 max-md:min-h-11 [&::-webkit-details-marker]:hidden">
        <span className="min-w-0">
          <span className="t-head block">{title}</span>
          {summary && <span className="t-caption mt-0.5 block">{summary}</span>}
        </span>
        <ChevronDown size={16} className="shrink-0 text-label-3 transition-transform group-open:rotate-180" />
      </summary>
      <InsideDisclosure.Provider value={merge}>
        <div className="mt-2 flex flex-col gap-5">{children}</div>
      </InsideDisclosure.Provider>
    </details>
  );
}
