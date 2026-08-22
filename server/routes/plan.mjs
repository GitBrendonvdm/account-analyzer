import { addGoal, bumpVersion, deleteBudget, deleteGoal, putBudget, putSetting } from '../db/data.mjs';

/**
 * Targets, goals and the odd setting — the small authored things that used to live in Dexie and
 * have to outlive every import. Each write is one transaction that also bumps the data version,
 * so another browser's next bootstrap sees it.
 */
export default async function planRoutes(app) {
  const { store } = app;

  app.put('/budgets/:scope/:category', async (request, reply) => {
    const amount = request.body?.amount;
    if (typeof amount !== 'number' || !Number.isFinite(amount)) {
      return reply.code(400).send({ error: 'Send { amount } as a number' });
    }
    const { scope, category } = request.params;
    await store.transaction(async (tx) => {
      await putBudget(tx, scope, category, amount);
      await bumpVersion(tx);
    });
    return { scope, category, amount };
  });

  app.delete('/budgets/:scope/:category', async (request) => {
    const { scope, category } = request.params;
    const removed = await store.transaction(async (tx) => {
      const gone = await deleteBudget(tx, scope, category);
      if (gone) await bumpVersion(tx);
      return gone;
    });
    return { ok: true, removed };
  });

  app.post('/goals', async (request, reply) => {
    const goal = request.body?.goal;
    if (!goal || typeof goal !== 'object' || Array.isArray(goal)) return reply.code(400).send({ error: 'Send { goal }' });
    const { id: _ignored, ...fields } = goal;
    const created = await store.transaction(async (tx) => {
      const row = await addGoal(tx, { ...fields, createdAt: new Date().toISOString() });
      await bumpVersion(tx);
      return row;
    });
    return reply.code(201).send(created);
  });

  app.delete('/goals/:id', async (request, reply) => {
    const id = Number(request.params.id);
    if (!Number.isInteger(id)) return reply.code(400).send({ error: 'Goal ids are integers' });
    const removed = await store.transaction(async (tx) => {
      const gone = await deleteGoal(tx, id);
      if (gone) await bumpVersion(tx);
      return gone;
    });
    if (!removed) return reply.code(404).send({ error: 'No such goal' });
    return { ok: true };
  });

  app.put('/settings/:key', async (request, reply) => {
    if (!request.body || !('value' in request.body)) return reply.code(400).send({ error: 'Send { value }' });
    const { key } = request.params;
    await store.transaction(async (tx) => {
      await putSetting(tx, key, request.body.value);
      await bumpVersion(tx);
    });
    return { key, value: request.body.value };
  });
}
