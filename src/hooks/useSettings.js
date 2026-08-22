import { useCallback, useEffect, useState } from 'react';
import * as api from '../api/client';

/**
 * The small things the user types that are not about one account or one category: the prime
 * rate, which payoff strategy to show, the extra and lump amounts on the Debt view, the cash
 * buffer, and the keep/cancelled/ignore overrides on recurring lines.
 *
 * They live on the server for the same reason targets and goals do — authored data has to
 * survive the next import and the next browser — and they are read the same way: nothing is
 * fetched here. The analyzer's bootstrap already carries `settings`, so this subscribes to it
 * (see api/client.js) and hands back a reader and a writer. Writes are optimistic: the local copy
 * changes at once and the PUT follows, because a slider that waits for a round trip feels broken,
 * and the next bootstrap reconciles whatever the server actually holds.
 *
 * Keys used by the debt / savings / cash-flow build: `primeRate` (percentage, null until typed),
 * `debtStrategy`, `debtExtra`, `debtLump`, `cashBuffer`, `lineOverrides` ({ [lineId]: 'keep' |
 * 'cancelled' | 'ignore' }). `get` takes a fallback so callers never see `undefined`.
 */
export function useSettings() {
  // null until the first bootstrap lands (or after sign-out), so `ready` can say so.
  const [settings, setSettings] = useState(null);

  useEffect(
    () =>
      api.subscribeBootstrap((payload) => {
        setSettings(payload ? { ...(payload.settings ?? {}) } : null);
      }),
    [],
  );

  const get = useCallback(
    (key, fallback = null) => {
      const value = settings?.[key];
      return value === undefined || value === null ? fallback : value;
    },
    [settings],
  );

  const set = useCallback((key, value) => {
    setSettings((prev) => ({ ...(prev ?? {}), [key]: value }));
    return api.putSetting(key, value).catch(() => {});
  }, []);

  return { get, set, ready: settings !== null, settings };
}
