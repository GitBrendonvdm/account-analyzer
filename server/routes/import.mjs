import { parseExport } from '../../src/utils/csv.js';
import { listAccounts } from '../db/data.mjs';
import { importBankFiles } from '../bankImport.mjs';
import { importRows } from '../importer.mjs';

/**
 * A CSV arrives as text inside JSON rather than as a multipart upload: the files are half a
 * megabyte, JSON keeps the one content-type rule the API has, and the browser already had the
 * text in hand from reading the file. The server parses it with the same parser the browser used.
 *
 * The accounts already held are handed to the parser because the 2026 Vault22 export no longer
 * writes the bank into the account name: an account is recognised by its mask and keeps the
 * identity it already had, instead of arriving as a stranger and splitting its own history.
 */
export default async function importRoutes(app) {
  app.post('/import', async (request, reply) => {
    const { text, fileName } = request.body ?? {};
    if (typeof text !== 'string' || !text.trim()) {
      return reply.code(400).send({ error: 'Send { fileName, text } with the CSV as text' });
    }
    const accounts = await listAccounts(app.store);
    const { rows, format, duplicatesIgnored, repeatsCollapsed } = parseExport(text, { accounts });
    if (!rows.length) return reply.code(400).send({ error: 'No rows found in that file' });
    return importRows(
      app.store,
      rows,
      typeof fileName === 'string' && fileName ? fileName : 'upload.csv',
      { format, duplicatesIgnored, repeatsCollapsed },
    );
  });

  /**
   * FNB's own transaction-history files, unzipped by the browser and sent together. Together
   * matters: the files of one account overlap, and the account's lines are merged across them
   * before anything is compared with what is held.
   */
  app.post('/import/bank', async (request, reply) => {
    const files = request.body?.files;
    if (!Array.isArray(files) || files.length === 0 || files.length > 50) {
      return reply.code(400).send({ error: 'Send { files: [{ name, text }] } with between 1 and 50 files' });
    }
    const clean = [];
    for (const f of files) {
      if (typeof f?.text !== 'string' || f.text.length > 5_000_000) {
        return reply.code(400).send({ error: 'Each file needs its text, and none may be over 5 MB' });
      }
      clean.push({
        name: typeof f.name === 'string' && f.name ? f.name : 'history.csv',
        from: typeof f.from === 'string' && f.from ? f.from : undefined,
        text: f.text,
      });
    }
    return importBankFiles(app.store, clean);
  });
}
