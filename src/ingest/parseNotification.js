/**
 * Reading a transaction out of a bank notification.
 *
 * This is what makes the backend live rather than daily. FNB's inContact and Nedbank's alerts send
 * a message on every transaction, free, seconds after it happens — so a mailbox receiving them is a
 * transaction stream that needs no credentials, no aggregator and no download. Poll it every few
 * minutes and the app is never more than minutes stale.
 *
 * What a notification does NOT carry is a category or a pay-cycle key, which is why the categoriser
 * exists: it fills those from your own labelled history.
 *
 * Nor is a notification authoritative. A card authorisation can settle at a different amount, and a
 * message you never received leaves a hole. Notifications are the fast path; the monthly OFX
 * reconcile is the correct one, and because both collapse onto the same transaction key, the
 * statement silently corrects whatever the notification got wrong.
 *
 * FORMATS ARE BEST-EFFORT. These patterns are built from the documented shape of inContact and
 * Nedbank alerts, but banks reword them without warning and per-account wording varies. Every
 * parse reports which pattern matched and how confident it is; `unparsed` messages are kept rather
 * than dropped, so nothing is silently lost while a pattern is being fixed.
 */

const AMOUNT = String.raw`R\s?([\d\s,]+\.?\d{0,2})`;

/**
 * Each pattern names the bank, a regex, and how to read the captures.
 * Ordered most-specific first.
 */
const PATTERNS = [
  {
    id: 'fnb-card-purchase',
    bank: 'FNB',
    // "FNB :-) Card purchase of R249.99 at CHECKERS CAPEGATE on 21 Aug. Avail bal R12 345.67. Acc *9986"
    re: new RegExp(
      String.raw`FNB[\s\S]{0,40}?(?:card )?(purchase|payment|withdrawal|deposit)\s+of\s+${AMOUNT}\s+(?:at|to|from)\s+(.+?)(?:\s+on\s+(\d{1,2}\s*\w{3}))?\.`,
      'i',
    ),
    read: (m) => ({ kind: m[1], amount: m[2], merchant: m[3], when: m[4] }),
  },
  {
    id: 'fnb-generic',
    bank: 'FNB',
    // "FNB :-) R1 200.00 paid to VODACOM from acc *9986."
    re: new RegExp(String.raw`FNB[\s\S]{0,40}?${AMOUNT}\s+(paid|received|transferred)\s+(?:to|from)\s+(.+?)[.\r\n]`, 'i'),
    read: (m) => ({ amount: m[1], kind: m[2], merchant: m[3] }),
  },
  {
    id: 'nedbank-alert',
    bank: 'Nedbank',
    // "Nedbank: Card purchase R450.00 at WOOLWORTHS. Card ending 4714."
    re: new RegExp(
      String.raw`Nedbank[\s\S]{0,40}?(purchase|payment|withdrawal|deposit|transfer)\s+(?:of\s+)?${AMOUNT}\s+(?:at|to|from)\s+(.+?)[.\r\n]`,
      'i',
    ),
    read: (m) => ({ kind: m[1], amount: m[2], merchant: m[3] }),
  },
  {
    id: 'generic-amount-at-merchant',
    bank: null,
    // Last resort: any "R123.45 at MERCHANT" in a message from a bank sender.
    re: new RegExp(String.raw`${AMOUNT}\s+at\s+(.+?)[.\r\n]`, 'i'),
    read: (m) => ({ amount: m[1], merchant: m[2] }),
  },
];

/** Money in, money out. Deposits and refunds are credits; everything else is a debit. */
const CREDIT = /\b(deposit|received|refund|reversal|credit|salary|transfer in)\b/i;

function toAmount(raw) {
  const n = parseFloat((raw ?? '').replace(/[\s,]/g, ''));
  return Number.isFinite(n) ? n : null;
}

/** "*9986", "acc 9986", "card ending 4714" — whatever the message used to name the account. */
function findMask(text) {
  const patterns = [
    /(?:acc(?:ount)?|card)\s*(?:ending|no\.?|number)?\s*\*?\s*(\d{4})\b/i,
    /\*(\d{4})\b/,
  ];
  for (const re of patterns) {
    const m = text.match(re);
    if (m) return m[1];
  }
  return null;
}

/** Available balance, when the bank includes it — this is real balance data, arriving free. */
function findBalance(text) {
  const m = text.match(new RegExp(String.raw`(?:avail(?:able)?\.?\s*bal(?:ance)?)\s*:?\s*${AMOUNT}`, 'i'));
  return m ? toAmount(m[1]) : null;
}

/**
 * The date the message arrived, in LOCAL time.
 *
 * Not toISOString(): a notification at 00:30 SAST converts to 22:30 UTC the previous day, which
 * files the transaction under yesterday — and near a cycle boundary, under the wrong pay cycle
 * entirely. Every other date in this app is a local calendar date, so this must be too.
 */
function localDate(value) {
  const d = value instanceof Date ? value : new Date(value ?? Date.now());
  if (Number.isNaN(d.getTime())) return new Date().toISOString().slice(0, 10);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

function cleanMerchant(raw) {
  return (raw ?? '')
    .replace(/\s+/g, ' ')
    .replace(/[.,;]+$/, '')
    // "EAGLEWOOD RENT to acc *9986" — the account is already a field of its own, so trailing
    // account references are noise that would otherwise split one merchant into many.
    .replace(/\s+\b(on|to|from|into|using|with)\s+(card|acc(?:ount)?)\b.*$/i, '')
    .replace(/\s+\*?\d{4}\s*$/, '')
    .trim();
}

/**
 * @param message { subject, text, from, date } — one email
 * @param options.accountsByMask map of "9986" → "FNB Bank *9986", so a four-digit mask resolves to
 *   the account the rest of the app already knows about
 * @returns a canonical row, or { unparsed: true } with the raw message kept for inspection
 */
export function parseNotification(message, { accountsByMask = new Map() } = {}) {
  // Bank mailers are full of non-breaking spaces, especially inside amounts ("R1 200.00"),
  // so they are folded to ordinary spaces before any pattern runs.
  const body = [message.subject ?? String(), message.text ?? String()].join(String.fromCharCode(10)).replace(new RegExp(String.fromCharCode(160), "g"), " ");
  if (!body.trim()) return { unparsed: true, reason: 'empty', message };

  for (const pattern of PATTERNS) {
    const match = body.match(pattern.re);
    if (!match) continue;

    const parts = pattern.read(match);
    const amount = toAmount(parts.amount);
    if (amount == null || amount === 0) continue;

    const mask = findMask(body);
    const account =
      (mask && accountsByMask.get(mask)) ||
      (mask ? `${pattern.bank ?? 'Bank'} Bank *${mask}` : null);
    if (!account) return { unparsed: true, reason: 'no-account', pattern: pattern.id, message };

    const isCredit = CREDIT.test(parts.kind ?? '') || CREDIT.test(body);
    const signed = isCredit ? Math.abs(amount) : -Math.abs(amount);
    const date = localDate(message.date);

    return {
      Date: date,
      Description: cleanMerchant(parts.merchant) || (parts.kind ?? 'Transaction'),
      Account: account,
      Amount: String(signed),
      AmountNum: signed,
      Currency: 'ZAR',
      Type: signed < 0 ? 'Expense' : 'Income',
      // A notification is an authorisation, not a settled entry. Marking it Pending means the
      // monthly statement is allowed to revise it — the merge rules already handle exactly that.
      Status: 'Pending',
      Category: '',
      'Spending Group': '',
      source: 'notification',
      pattern: pattern.id,
      availableBalance: findBalance(body),
    };
  }

  return { unparsed: true, reason: 'no-pattern', message };
}

/** Parse a batch, keeping the failures so patterns can be improved against real messages. */
export function parseNotifications(messages, options = {}) {
  const rows = [];
  const unparsed = [];
  messages.forEach((m) => {
    const result = parseNotification(m, options);
    if (result.unparsed) unparsed.push(result);
    else rows.push(result);
  });
  return { rows, unparsed, parsedRate: messages.length ? rows.length / messages.length : 0 };
}
