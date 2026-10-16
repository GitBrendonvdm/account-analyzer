/**
 * Reading an uploaded .zip, in the browser or in Node, with no dependency.
 *
 * FNB's "download transaction history" gives one zip per account with a single CSV inside, and
 * downloading five accounts gives five zips. Asking the reader to unpack them first is a chore that
 * belongs to the computer, so the upload takes the zips as they came.
 *
 * Only what those archives need is read: the central directory, then each entry stored or deflated.
 * The platform does the inflating — `DecompressionStream('deflate-raw')` is in every browser the
 * app supports and in Node — so there is no inflate implementation to carry or to get wrong.
 *
 * The archive is somebody else's file, so it is read defensively. Sizes are taken from the central
 * directory and bounded before anything is inflated, an entry that inflates to more than it
 * declared is refused, an encrypted or zip64 archive is refused rather than half-read, and a name
 * is only ever a label — nothing here touches a file system.
 */

const EOCD = 0x06054b50;
const CENTRAL = 0x02014b50;
const LOCAL = 0x04034b50;

const MAX_ENTRIES = 200;
const MAX_ENTRY_BYTES = 25 * 1024 * 1024;
const MAX_TOTAL_BYTES = 100 * 1024 * 1024;

export class ZipError extends Error {
  constructor(message) {
    super(message);
    this.name = 'ZipError';
  }
}

/** The four bytes every zip begins with (a spanned or empty archive begins differently, and is not read). */
export function isZip(bytes) {
  return bytes?.length >= 4 && bytes[0] === 0x50 && bytes[1] === 0x4b && bytes[2] === 0x03 && bytes[3] === 0x04;
}

function viewOf(data) {
  const bytes = data instanceof Uint8Array ? data : new Uint8Array(data);
  return { bytes, view: new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength) };
}

function findEndOfCentralDirectory(view, length) {
  // The record is 22 bytes plus a comment of up to 65 535, and sits at the very end.
  const floor = Math.max(0, length - 22 - 0xffff);
  for (let i = length - 22; i >= floor; i -= 1) {
    if (view.getUint32(i, true) === EOCD) return i;
  }
  throw new ZipError('This does not look like a zip file');
}

async function inflateRaw(compressed, expected) {
  const stream = new Blob([compressed]).stream().pipeThrough(new DecompressionStream('deflate-raw'));
  const reader = stream.getReader();
  const chunks = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > expected) {
      await reader.cancel();
      throw new ZipError('A file inside the zip is larger than the zip says it is');
    }
    chunks.push(value);
  }
  const out = new Uint8Array(total);
  let at = 0;
  for (const chunk of chunks) {
    out.set(chunk, at);
    at += chunk.byteLength;
  }
  return out;
}

/** True for the entries that are bookkeeping, not files: folders, macOS resource forks, Finder droppings. */
function isNoise(name) {
  return name.endsWith('/') || /(^|\/)__MACOSX\//.test(name) || /(^|\/)(\.DS_Store|Thumbs\.db)$/i.test(name) || /(^|\/)\._/.test(name);
}

/**
 * @param {ArrayBuffer|Uint8Array} data the archive
 * @returns {Promise<{ name: string, bytes: Uint8Array }[]>} every real file in it, in archive order
 */
export async function unzip(data) {
  const { bytes, view } = viewOf(data);
  if (!isZip(bytes) && !(bytes.length >= 22 && view.getUint32(bytes.length - 22, true) === EOCD)) {
    throw new ZipError('This does not look like a zip file');
  }
  const eocd = findEndOfCentralDirectory(view, bytes.length);
  const count = view.getUint16(eocd + 10, true);
  const centralSize = view.getUint32(eocd + 12, true);
  const centralAt = view.getUint32(eocd + 16, true);
  if (count === 0xffff || centralSize === 0xffffffff || centralAt === 0xffffffff) {
    throw new ZipError('Zip64 archives are not supported');
  }
  if (count > MAX_ENTRIES) throw new ZipError(`The zip holds ${count} files — more than the ${MAX_ENTRIES} this reads`);

  const decoder = new TextDecoder('utf-8');
  const files = [];
  let total = 0;
  let at = centralAt;
  for (let n = 0; n < count; n += 1) {
    if (at + 46 > bytes.length || view.getUint32(at, true) !== CENTRAL) throw new ZipError('The zip is damaged');
    const flags = view.getUint16(at + 8, true);
    const method = view.getUint16(at + 10, true);
    const compressedSize = view.getUint32(at + 20, true);
    const size = view.getUint32(at + 24, true);
    const nameLength = view.getUint16(at + 28, true);
    const extraLength = view.getUint16(at + 30, true);
    const commentLength = view.getUint16(at + 32, true);
    const localAt = view.getUint32(at + 42, true);
    const name = decoder.decode(bytes.subarray(at + 46, at + 46 + nameLength));
    at += 46 + nameLength + extraLength + commentLength;

    if (isNoise(name)) continue;
    if (flags & 1) throw new ZipError(`${name} is password-protected`);
    if (compressedSize === 0xffffffff || size === 0xffffffff) throw new ZipError('Zip64 archives are not supported');
    if (size > MAX_ENTRY_BYTES) throw new ZipError(`${name} is too large to read`);
    total += size;
    if (total > MAX_TOTAL_BYTES) throw new ZipError('The zip is too large to read');

    if (localAt + 30 > bytes.length || view.getUint32(localAt, true) !== LOCAL) throw new ZipError('The zip is damaged');
    const start = localAt + 30 + view.getUint16(localAt + 26, true) + view.getUint16(localAt + 28, true);
    if (start + compressedSize > bytes.length) throw new ZipError('The zip is damaged');
    const raw = bytes.subarray(start, start + compressedSize);

    if (method === 0) files.push({ name, bytes: raw.slice() });
    else if (method === 8) files.push({ name, bytes: await inflateRaw(raw, size) });
    else throw new ZipError(`${name} uses a compression method this cannot read`);
  }
  return files;
}

const textOf = (bytes) => new TextDecoder('utf-8').decode(bytes).replace(/^\uFEFF/, '');
const baseName = (name) => name.split('/').pop();

/**
 * Everything an upload can contain, flattened to the files the app understands.
 *
 * @param {{ name: string, arrayBuffer(): Promise<ArrayBuffer> }[]} files what the file input gave
 * @returns {Promise<{ files: { name: string, kind: 'csv'|'pdf', text?: string, bytes?: Uint8Array, from: string }[], ignored: { name: string, reason: string }[] }>}
 *   `from` is the file the entry came out of — the zip's name, or its own — so a summary can say
 *   which download a line belongs to. Anything not recognised is reported, never silently dropped.
 */
export async function expandUploads(files) {
  const out = [];
  const ignored = [];
  const take = (name, bytes, from) => {
    const lower = name.toLowerCase();
    if (lower.endsWith('.csv') || lower.endsWith('.txt')) out.push({ name: baseName(name), kind: 'csv', text: textOf(bytes), from });
    else if (lower.endsWith('.pdf')) out.push({ name: baseName(name), kind: 'pdf', bytes, from });
    else ignored.push({ name: baseName(name), reason: 'not a CSV or PDF' });
  };
  for (const file of files) {
    const bytes = new Uint8Array(await file.arrayBuffer());
    if (isZip(bytes) || file.name?.toLowerCase().endsWith('.zip')) {
      try {
        for (const entry of await unzip(bytes)) take(entry.name, entry.bytes, file.name);
      } catch (err) {
        ignored.push({ name: file.name, reason: err instanceof ZipError ? err.message : 'could not be unzipped' });
      }
    } else {
      take(file.name ?? 'upload', bytes, file.name);
    }
  }
  return { files: out, ignored };
}
