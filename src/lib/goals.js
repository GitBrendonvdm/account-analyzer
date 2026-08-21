/**
 * Savings goals, with an honest arrival date.
 *
 * The usual version of this feature divides what's left by what you save and prints a month. That
 * only works when there's a surplus. On a cycle that closes at −R17 000 the truthful answer is that
 * the goal never arrives, and saying so — along with how much a cycle would have to be found first
 * — is more useful than a date computed from a number that doesn't exist.
 */

export function projectGoal(goal, surplusPerCycle, fromDate = new Date()) {
  const target = Math.abs(goal.target ?? 0);
  const saved = Math.abs(goal.saved ?? 0);
  const contribution = goal.contribution != null ? Math.abs(goal.contribution) : surplusPerCycle;
  const remaining = Math.max(0, target - saved);
  const progress = target > 0 ? Math.min(1, saved / target) : 0;

  if (remaining === 0) {
    return { ...goal, remaining: 0, progress: 1, reachable: true, cycles: 0, eta: fromDate, contribution };
  }
  if (!(contribution > 0)) {
    return {
      ...goal,
      remaining,
      progress,
      reachable: false,
      cycles: null,
      eta: null,
      contribution,
      // What it would take to make this goal move at all.
      needed: goal.deadlineCycles ? remaining / goal.deadlineCycles : null,
    };
  }

  const cycles = Math.ceil(remaining / contribution);
  const eta = new Date(fromDate.getFullYear(), fromDate.getMonth() + cycles, fromDate.getDate());
  return { ...goal, remaining, progress, reachable: true, cycles, eta, contribution };
}

export function summariseGoals(goals, surplusPerCycle, fromDate = new Date()) {
  const projected = (goals ?? []).map((g) => projectGoal(g, surplusPerCycle, fromDate));
  return {
    goals: projected,
    totalTarget: projected.reduce((s, g) => s + Math.abs(g.target ?? 0), 0),
    totalSaved: projected.reduce((s, g) => s + Math.abs(g.saved ?? 0), 0),
    committed: projected.reduce((s, g) => s + (g.contribution ?? 0), 0),
    anyUnreachable: projected.some((g) => !g.reachable),
  };
}
