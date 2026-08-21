import { useCallback, useEffect, useState } from 'react';
import { db, getSetting, setSetting } from '../db/db';

/**
 * Targets, goals and the scenario slider.
 *
 * All three live in the database rather than component state for one reason: they are things the
 * user authored, and the whole point of moving off the localStorage blob was that authored data
 * has to survive the next import.
 */
export function usePlanState() {
  const [targets, setTargets] = useState([]);
  const [goals, setGoals] = useState([]);
  const [monthlySaving, setMonthlySavingState] = useState(0);

  const reloadTargets = useCallback(async () => {
    setTargets(await db.budgets.where('scope').equals('default').toArray());
  }, []);
  const reloadGoals = useCallback(async () => {
    setGoals(await db.goals.orderBy('createdAt').toArray());
  }, []);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const [budgetRows, goalRows, saving] = await Promise.all([
        db.budgets.where('scope').equals('default').toArray(),
        db.goals.orderBy('createdAt').toArray(),
        getSetting('monthlySaving', 0),
      ]);
      if (cancelled) return;
      setTargets(budgetRows);
      setGoals(goalRows);
      setMonthlySavingState(saving ?? 0);
    })();
    return () => { cancelled = true; };
  }, []);

  /** Passing null clears the target rather than storing a zero. */
  const setTarget = useCallback(
    async (category, amount) => {
      if (amount == null) await db.budgets.delete(['default', category]);
      else await db.budgets.put({ scope: 'default', category, amount });
      await reloadTargets();
    },
    [reloadTargets],
  );

  const addGoal = useCallback(
    async (goal) => {
      await db.goals.add({ ...goal, createdAt: new Date().toISOString() });
      await reloadGoals();
    },
    [reloadGoals],
  );

  const removeGoal = useCallback(
    async (id) => {
      await db.goals.delete(id);
      await reloadGoals();
    },
    [reloadGoals],
  );

  const setMonthlySaving = useCallback((value) => {
    setMonthlySavingState(value);
    setSetting('monthlySaving', value);
  }, []);

  return { targets, setTarget, goals, addGoal, removeGoal, monthlySaving, setMonthlySaving };
}
