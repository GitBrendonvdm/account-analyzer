import { parseCsv } from '../../src/utils/csv.js';
import { importRows } from '../importer.mjs';

/**
 * A CSV arrives as text inside JSON rather than as a multipart upload: the files are half a
 * megabyte, JSON keeps the one content-type rule the API has, and the browser already had the
 * text in hand from reading the file. The server parses it with the same parser the browser used.
 */
export default async function importRoutes(app) {
  app.post('/import', async (request, reply) => {
    const { text, fileName } = request.body ?? {};
    if (typeof text !== 'string' || !text.trim()) {
      return reply.code(400).send({ error: 'Send { fileName, text } with the CSV as text' });
    }
    const rows = parseCsv(text);
    if (!rows.length) return reply.code(400).send({ error: 'No rows found in that file' });
    return importRows(app.store, rows, typeof fileName === 'string' && fileName ? fileName : 'upload.csv');
  });
}
