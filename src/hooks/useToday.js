import { useEffect, useState } from 'react';

const dayKey = (d) => `${d.getFullYear()}-${d.getMonth()}-${d.getDate()}`;

/**
 * "Today", as a value that actually changes when the day does.
 *
 * processTransactionData defaulted `asOf` to `new Date()` internally, which meant it was invisible
 * to useMemo: a tab left open overnight — or over a payday — kept projecting against the day it was
 * opened. Returning a stable Date that only changes identity when the calendar day rolls over keeps
 * the memo honest without recomputing on every render.
 */
export function useToday() {
  const [today, setToday] = useState(() => new Date());

  useEffect(() => {
    const check = () => {
      const now = new Date();
      setToday((prev) => (dayKey(prev) === dayKey(now) ? prev : now));
    };
    // Re-check when the tab is looked at again, and hourly for a window left open in view.
    document.addEventListener('visibilitychange', check);
    window.addEventListener('focus', check);
    const timer = setInterval(check, 60 * 60 * 1000);
    return () => {
      document.removeEventListener('visibilitychange', check);
      window.removeEventListener('focus', check);
      clearInterval(timer);
    };
  }, []);

  return today;
}
