import { useCallback, useEffect, useState } from 'react';
import * as api from '../api/client';

/**
 * Targets, goals and the scenario slider.
 *
 * All three live on the server rather than in component state for one reason: they are things the
 * user authored, and the whole point of moving off the localStorage blob was that authored data
 * has to survive the next import — and now, the next browser.
 *
 * Nothing is fetched here. The analyzer hook's bootstrap already carries budgets, goals and
 * settings, and this hook subscribes to it (see api/client.js) rather than asking for the same
 * dataset twice. Writes go straight to the API and the local copy is updated from the reply.
 */

const byCategory = (a, b) => (a.category < b.category ? -1 : a.category > b.category ? 1 : 0);
const byCreated = (a, b) => (a.createdAt < b.createdAt ? -1 : a.createdAt > b.createdAt ? 1 : a.id - b.id);

export function usePlanState() {
  const [targets, setTargets] = useState([]);
  const [goals, setGoals] = useState([]);
  const [monthlySaving, setMonthlySavingState] = useState(0);

  useEffect(
    () =>
      api.subscribeBootstrap((payload) => {
        if (!payload) {
          setTargets([]);
          setGoals([]);
          setMonthlySavingState(0);
          return;
        }
        setTargets((payload.budgets ?? []).filter((b) => b.scope === 'default').sort(byCategory));
        setGoals([...(payload.goals ?? [])].sort(byCreated));
        setMonthlySavingState(payload.settings?.monthlySaving ?? 0);
      }),
    [],
  );

  /** Passing null clears the target rather than storing a zero. */
  const setTarget = useCallback(async (category, amount) => {
    if (amount == null) {
      await api.deleteBudget('default', category);
      setTargets((prev) => prev.filter((t) => t.category !== category));
    } else {
      const row = await api.putBudget('default', category, amount);
      setTargets((prev) => [...prev.filter((t) => t.category !== category), row].sort(byCategory));
    }
  }, []);

  const addGoal = useCallback(async (goal) => {
    const created = await api.addGoal(goal);
    setGoals((prev) => [...prev, created].sort(byCreated));
  }, []);

  const removeGoal = useCallback(async (id) => {
    await api.deleteGoal(id);
    setGoals((prev) => prev.filter((g) => g.id !== id));
  }, []);

  const setMonthlySaving = useCallback((value) => {
    setMonthlySavingState(value);
    api.putSetting('monthlySaving', value).catch(() => {});
  }, []);

  return { targets, setTarget, goals, addGoal, removeGoal, monthlySaving, setMonthlySaving };
}
