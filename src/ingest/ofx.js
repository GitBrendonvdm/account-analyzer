/**
 * OFX / QIF parsing.
 *
 * Both banks already export machine-readable transaction data — FNB gives PDF, CSV, QIF, OFC and
 * OFX from Transaction History (capped at 90 days or 150 transactions), Nedbank gives the same set
 * going back five years from Statements & Documents. So replacing an aggregator does not require
 * inventing a data format; it requires reading the one that has existed since Quicken.
 *
 * OFX comes in two shapes and this handles both:
 *
 *   OFX 1.x  SGML-ish, unclosed tags, headers as `KEY:VALUE` lines. What SA banks emit.
 *   OFX 2.x  Real XML.
 *
 * The parser is deliberately tolerant. Bank files are frequently malformed — unclosed tags,
 * inconsistent casing, stray whitespace, DOS line endings — and refusing to read a statement
 * because a tag isn't closed would be useless. Rows come out in the app's own shape so everything
 * downstream (merge, dedupe, categorise) is unchanged.
 */

/** OFX dates are YYYYMMDD, optionally with HHMMSS and a bracketed timezone. */
function parseOfxDate(raw) {
  const digits = (raw ?? '').replace(/\[.*$/, '').trim();
  if (digits.length < 8) return null;
  return `${digits.slice(0, 4)}-${digits.slice(4, 6)}-${digits.slice(6, 8)}`;
}

/** Pull the value of a tag from one transaction block, closed or not. */
function tag(block, name) {
  const closed = block.match(new RegExp(`<${name}>([\\s\\S]*?)</${name}>`, 'i'));
  if (closed) return closed[1].trim();
  // OFX 1.x leaves tags unclosed: the value runs to the next tag or end of line.
  const open = block.match(new RegExp(`<${name}>([^<\\r\\n]*)`, 'i'));
  return open ? open[1].trim() : '';
}

/**
 * OFX puts the useful label in different places depending on the bank and transaction type:
 * NAME for card purchases, MEMO for fees and transfers, PAYEE for beneficiary payments. Take the
 * longest — the shorter ones are usually truncations of the same string.
 */
function describe(block) {
  const candidates = [tag(block, 'NAME'), tag(block, 'MEMO'), tag(block, 'PAYEE')]
    .map((s) => s.replace(/\s+/g, ' ').trim())
    .filter(Boolean);
  if (candidates.length === 0) return '';
  return candidates.sort((a, b) => b.length - a.length)[0];
}

/** Account label from the statement header, e.g. "FNB Bank *9986" if we can infer the type. */
function accountFrom(text, fallback) {
  const acctId = tag(text, 'ACCTID');
  const acctType = tag(text, 'ACCTTYPE').toUpperCase();
  const bank = tag(text, 'ORG') || tag(text, 'FID') || '';
  if (!acctId) return fallback ?? '';

  const mask = acctId.slice(-4);
  const type =
    acctType === 'CREDITLINE' || text.includes('<CCSTMTRS>')
      ? 'Credit Card'
      : acctType === 'SAVINGS'
        ? 'Savings'
        : acctType === 'MONEYMRKT'
          ? 'Savings'
          : 'Bank';
  const bankName = /fnb|first ?national/i.test(bank)
    ? 'FNB'
    : /nedbank/i.test(bank)
      ? 'Nedbank'
      : bank.trim() || 'Bank';
  return `${bankName} ${type} *${mask}`;
}

/**
 * @param text        the OFX file contents
 * @param accountHint used when the file omits ACCTID (some exports do)
 * @returns rows in the app's canonical shape, minus Category and Pay Month — those are filled by
 *   the normaliser, since a bank statement carries neither.
 */
export function parseOfx(text, { accountHint = null } = {}) {
  if (!text || !/<STMTTRN>/i.test(text)) return [];
  const account = accountFrom(text, accountHint);
  const currency = tag(text, 'CURDEF') || 'ZAR';

  const blocks = text.split(/<STMTTRN>/i).slice(1);
  return blocks
    .map((raw) => {
      const block = raw.split(/<\/STMTTRN>/i)[0];
      const date = parseOfxDate(tag(block, 'DTPOSTED') || tag(block, 'DTUSER'));
      const amount = parseFloat(tag(block, 'TRNAMT'));
      if (!date || !Number.isFinite(amount)) return null;
      return {
        Date: date,
        Description: describe(block),
        Account: account,
        Amount: String(amount),
        AmountNum: amount,
        Currency: currency,
        Type: amount < 0 ? 'Expense' : 'Income',
        Status: 'Completed',
        Category: '',
        'Spending Group': '',
        // The bank's own id, kept for provenance — dedupe still uses the app's key so that rows
        // arriving by notification and by statement collapse onto each other.
        fitid: tag(block, 'FITID'),
        source: 'ofx',
      };
    })
    .filter(Boolean);
}

/**
 * QIF, for the cases where a bank offers it and not OFX.
 * Records are `!Type:` sections of single-letter fields terminated by a lone `^`.
 */
export function parseQif(text, { account = '' } = {}) {
  if (!text) return [];
  const rows = [];
  let current = {};

  text.split(/\r?\n/).forEach((line) => {
    const code = line[0];
    const value = line.slice(1).trim();
    if (line.startsWith('!')) return;
    if (code === '^') {
      if (current.Date && Number.isFinite(current.AmountNum)) rows.push({ ...current });
      current = {};
      return;
    }
    switch (code) {
      case 'D': {
        // QIF dates are ambiguous by design; SA exports use D/M/YY or D/M/YYYY.
        const parts = value.replace(/'/g, '/').split(/[/\-.]/).map((p) => p.trim());
        if (parts.length === 3) {
          const [d, m, y] = parts;
          const year = y.length === 2 ? `20${y}` : y;
          current.Date = `${year}-${m.padStart(2, '0')}-${d.padStart(2, '0')}`;
        }
        break;
      }
      case 'T':
      case 'U': {
        const amount = parseFloat(value.replace(/[^\d.-]/g, ''));
        if (Number.isFinite(amount)) {
          current.AmountNum = amount;
          current.Amount = String(amount);
          current.Type = amount < 0 ? 'Expense' : 'Income';
        }
        break;
      }
      case 'P':
        current.Description = value;
        break;
      case 'M':
        if (!current.Description) current.Description = value;
        break;
      case 'L':
        current.Category = value;
        break;
      default:
        break;
    }
    current.Account = account;
    current.Status = 'Completed';
    current.source = 'qif';
  });

  return rows;
}

/** Route a downloaded file to the right parser by extension, then content. */
export function parseStatement(filename, text, options = {}) {
  const name = (filename ?? '').toLowerCase();
  if (name.endsWith('.ofx') || name.endsWith('.ofc') || /<STMTTRN>/i.test(text)) {
    return parseOfx(text, options);
  }
  if (name.endsWith('.qif') || /^!Type:/im.test(text)) {
    return parseQif(text, options);
  }
  return [];
}
