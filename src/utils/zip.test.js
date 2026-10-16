import { deflateRawSync } from 'node:zlib';
import { describe, expect, it } from 'vitest';
import { ZipError, expandUploads, isZip, unzip } from './zip';

/** A minimal zip writer — enough to make the archives the reader has to cope with. */
function makeZip(entries, { comment = '' } = {}) {
  const enc = new TextEncoder();
  const local = [];
  const central = [];
  let offset = 0;
  for (const { name, data, method = 8, flags = 0 } of entries) {
    const nameBytes = enc.encode(name);
    const raw = typeof data === 'string' ? enc.encode(data) : data;
    const body = method === 8 ? new Uint8Array(deflateRawSync(raw)) : raw;
    const head = new DataView(new ArrayBuffer(30));
    head.setUint32(0, 0x04034b50, true);
    head.setUint16(4, 20, true);
    head.setUint16(6, flags, true);
    head.setUint16(8, method, true);
    head.setUint32(18, body.length, true);
    head.setUint32(22, raw.length, true);
    head.setUint16(26, nameBytes.length, true);
    local.push(new Uint8Array(head.buffer), nameBytes, body);

    const entry = new DataView(new ArrayBuffer(46));
    entry.setUint32(0, 0x02014b50, true);
    entry.setUint16(4, 20, true);
    entry.setUint16(6, 20, true);
    entry.setUint16(8, flags, true);
    entry.setUint16(10, method, true);
    entry.setUint32(20, body.length, true);
    entry.setUint32(24, raw.length, true);
    entry.setUint16(28, nameBytes.length, true);
    entry.setUint32(42, offset, true);
    central.push(new Uint8Array(entry.buffer), nameBytes);
    offset += 30 + nameBytes.length + body.length;
  }
  const centralBytes = central.reduce((n, c) => n + c.length, 0);
  const commentBytes = enc.encode(comment);
  const end = new DataView(new ArrayBuffer(22));
  end.setUint32(0, 0x06054b50, true);
  end.setUint16(8, entries.length, true);
  end.setUint16(10, entries.length, true);
  end.setUint32(12, centralBytes, true);
  end.setUint32(16, offset, true);
  end.setUint16(20, commentBytes.length, true);
  const parts = [...local, ...central, new Uint8Array(end.buffer), commentBytes];
  const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
  let at = 0;
  for (const p of parts) {
    out.set(p, at);
    at += p.length;
  }
  return out;
}

const text = (bytes) => new TextDecoder().decode(bytes);

describe('unzip', () => {
  it('reads a deflated and a stored entry', async () => {
    const zip = makeZip([
      { name: 'a.csv', data: 'Date, Amount\n2026/10/15, -5.00\n'.repeat(50) },
      { name: 'b.csv', data: 'stored as is', method: 0 },
    ]);
    expect(isZip(zip)).toBe(true);
    const files = await unzip(zip);
    expect(files.map((f) => f.name)).toEqual(['a.csv', 'b.csv']);
    expect(text(files[0].bytes)).toContain('2026/10/15, -5.00');
    expect(text(files[1].bytes)).toBe('stored as is');
  });

  it('skips folders and macOS droppings', async () => {
    const zip = makeZip([
      { name: 'folder/', data: '', method: 0 },
      { name: '__MACOSX/._a.csv', data: 'junk', method: 0 },
      { name: '.DS_Store', data: 'junk', method: 0 },
      { name: 'folder/a.csv', data: 'real' },
    ]);
    expect((await unzip(zip)).map((f) => f.name)).toEqual(['folder/a.csv']);
  });

  it('finds the directory behind a trailing comment', async () => {
    const zip = makeZip([{ name: 'a.csv', data: 'x' }], { comment: 'made by someone' });
    expect((await unzip(zip)).map((f) => f.name)).toEqual(['a.csv']);
  });

  it('refuses what it cannot read rather than half-reading it', async () => {
    await expect(unzip(new TextEncoder().encode('Date,Amount\n1,2\n'))).rejects.toThrow(ZipError);
    await expect(unzip(makeZip([{ name: 'a.csv', data: 'x', flags: 1 }]))).rejects.toThrow(/password/);
    const truncated = makeZip([{ name: 'a.csv', data: 'x'.repeat(200) }]).slice(0, 40);
    await expect(unzip(truncated)).rejects.toThrow(ZipError);
  });

  it('does not inflate an entry past the size it declared', async () => {
    const zip = makeZip([{ name: 'a.csv', data: 'x'.repeat(5000) }]);
    // Lie in the central directory: say it inflates to 10 bytes.
    const view = new DataView(zip.buffer);
    const central = zip.length - 22 - (46 + 5);
    view.setUint32(central + 24, 10, true);
    await expect(unzip(zip)).rejects.toThrow(/larger than the zip says/);
  });
});

describe('expandUploads', () => {
  const upload = (name, bytes) => ({ name, arrayBuffer: async () => bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) });

  it('flattens zips, csvs and pdfs and says what it could not use', async () => {
    const zip = makeZip([{ name: '62513359986.csv', data: `${String.fromCharCode(0xfeff)}ACCOUNT TRANSACTION HISTORY\n` }, { name: 'readme.md', data: 'hi' }]);
    const csv = new TextEncoder().encode('Date,Amount\n');
    const pdf = new TextEncoder().encode('%PDF-1.4');
    const { files, ignored } = await expandUploads([
      upload('transaction_history_FNB.zip', zip),
      upload('loose.csv', csv),
      upload('statement.pdf', pdf),
      upload('notes.docx', csv),
    ]);
    expect(files.map((f) => [f.name, f.kind, f.from])).toEqual([
      ['62513359986.csv', 'csv', 'transaction_history_FNB.zip'],
      ['loose.csv', 'csv', 'loose.csv'],
      ['statement.pdf', 'pdf', 'statement.pdf'],
    ]);
    expect(files[0].text.startsWith('ACCOUNT')).toBe(true); // BOM stripped
    expect(ignored.map((i) => i.name)).toEqual(['readme.md', 'notes.docx']);
  });

  it('reports a damaged zip instead of throwing', async () => {
    const { files, ignored } = await expandUploads([upload('broken.zip', new Uint8Array([0x50, 0x4b, 0x03, 0x04, 1, 2, 3]))]);
    expect(files).toEqual([]);
    expect(ignored[0].name).toBe('broken.zip');
  });
});
