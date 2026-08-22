import { register } from 'node:module';
import { isMainThread } from 'node:worker_threads';

/**
 * Lets plain Node load the browser's modules.
 *
 * The merge rules the server needs — row keys, account identity, the CSV parser — live in src/
 * and are written the way Vite likes them: `import { accountIdOf } from './accounts'`, no
 * extension. Node's ESM loader refuses that, and the alternatives are all worse: a bundler for a
 * hundred lines of server, a second copy of the rules that drifts from the first, or adding `.js`
 * to every import in src/ and fighting the project's own conventions. A resolve hook is the
 * smallest fix: when a relative specifier with no extension fails to resolve, try it with `.js`.
 *
 * Registered once from the main thread; the hooks thread re-imports this file to read the hook,
 * and must not register itself again.
 *
 *   node --import ./server/resolve.mjs server/index.mjs
 */
if (isMainThread) register(import.meta.url);

const RELATIVE_NO_EXTENSION = /^\.{1,2}\/[^?#]*$/;

export async function resolve(specifier, context, nextResolve) {
  try {
    return await nextResolve(specifier, context);
  } catch (err) {
    const bare = RELATIVE_NO_EXTENSION.test(specifier) && !/\.[a-z]+$/i.test(specifier);
    if (err?.code === 'ERR_MODULE_NOT_FOUND' && bare) {
      return nextResolve(`${specifier}.js`, context);
    }
    throw err;
  }
}
