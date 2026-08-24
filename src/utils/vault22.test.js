import { describe, expect, it } from 'vitest';
import { parseCsv, parseExport } from './csv';
import { isVault22Export, maskIndex, resolveAccountName } from './vault22';
import { assignKeys } from '../db/txnKey';

/**
 * The 2026 Vault22 export, in the shapes that mattered.
 *
 * Every fixture here is synthetic — the masks match the real accounts so that identity is tested
 * realistically, but no amount, merchant or date is taken from anyone's data.
 */

const NEW_HEADER =
  'Date,PostDate,Description,OriginalDescription,Account,AccountNumber,SpendingGroup,Category,PayMonth,IsSplit,Type,Amount,Currency,OriginalAmount,OriginalCurrency,Status,Tags,Note';
const OLD_HEADER =
  'Date,Description,Account,Spending Group,Category,Pay Month,Split Transaction,Currency,Amount,Original Currency,Original Amount,Type,Status,Tags,Notes';

const newRow = ({ date = '2026-08-20', desc = 'Woolworths', account = 'FNB Gold Cheque Account', number = '*9986', group = 'Day-to-day', category = 'Groceries', month = '2026-08', type = 'debit', amount = '109.99', status = 'posted', post = '' } = {}) =>
  `${date},${post},${desc},,${account},${number},${group},${category},${month},False,${type},${amount},ZAR,,,${status},,`;

const newCsv = (rows) => [NEW_HEADER, ...rows].join('\n');
const KNOWN = ['FNB Bank *9986', 'FNB Credit Card *2000', 'Nedbank Credit Card *4714', 'Nedbank Loan *2801'];

describe('recognising the export', () => {
  it('tells the two formats apart by their columns', () => {
    expect(isVault22Export(NEW_HEADER.split(','))).toBe(true);
    expect(isVault22Export(OLD_HEADER.split(','))).toBe(false);
  });

  it('leaves the old format exactly as it was', () => {
    const csv = [OLD_HEADER, '2026-08-20,Woolworths,FNB Bank *9986,Day-to-day,Groceries,2026-08,No,ZAR,-109.99,ZAR,-109.99,Expense,Completed,,No Notes'].join('\n');
    const { rows, format, duplicatesIgnored } = parseExport(csv);
    expect(format).toBe('legacy');
    expect(duplicatesIgnored).toBe(0);
    expect(rows[0].AmountNum).toBe(-109.99);
    expect(rows[0].Account).toBe('FNB Bank *9986');
  });
});

describe('the direction of the money', () => {
  it('reads a debit as money out and a credit as money in', () => {
    const rows = parseCsv(newCsv([newRow({ type: 'debit', amount: '109.99' }), newRow({ type: 'credit', amount: '2000', desc: 'Salary' })]), { accounts: KNOWN });
    expect(rows.map((r) => r.AmountNum)).toEqual([-109.99, 2000]);
    expect(rows.map((r) => r.Type)).toEqual(['Expense', 'Income']);
    // The Amount column is written back out signed, so an export of this data round-trips.
    expect(rows[0].Amount).toBe('-109.99');
  });

  it('translates the renamed columns and the lowercase status', () => {
    const [row] = parseCsv(newCsv([newRow({ status: 'pending' })]), { accounts: KNOWN });
    expect(row['Pay Month']).toBe('2026-08');
    expect(row['Spending Group']).toBe('Day-to-day');
    expect(row['Split Transaction']).toBe('No');
    expect(row.Status).toBe('Pending');
    expect(row.Notes).toBe('');
  });
});

describe('keeping an account its own account', () => {
  it('gives a known mask the name the app already uses, whatever the bank now calls it', () => {
    const index = maskIndex(KNOWN);
    expect(resolveAccountName('FNB Gold Cheque Account', '*9986', index)).toBe('FNB Bank *9986');
    // The bank is nowhere in this name; only the mask can find it.
    expect(resolveAccountName('Credit Card Plastic', '*4714', index)).toBe('Nedbank Credit Card *4714');
    expect(resolveAccountName('BOND', '*2801', index)).toBe('Nedbank Loan *2801');
  });

  it('reads a mask through an account record and its older names', () => {
    const index = maskIndex([{ id: 'fnb|9547', mask: '9547', rawName: 'FNB Bank *9547', seenNames: ['FNB Savings *9547', 'FNB Bank *9547'] }]);
    expect(resolveAccountName('Day To Day Savings', '*9547', index)).toBe('FNB Bank *9547');
  });

  it('names an unknown account from what the file says, and keeps it parseable', () => {
    const index = maskIndex(KNOWN);
    expect(resolveAccountName('FNB Money Market', '*7777', index)).toBe('FNB Savings *7777');
    // A name the vocabulary cannot type at all is called a Bank account, so that it still parses
    // into a bank and a mask rather than becoming an account with no identity.
    expect(resolveAccountName('FNB Something New', '*7776', index)).toBe('FNB Bank *7776');
    // No bank anywhere in the name: the name becomes the bank rather than one being invented.
    expect(resolveAccountName('Credit Card Plastic', '*8888', index)).toBe('Credit Card Plastic Credit Card *8888');
  });

  it('produces the same transaction key the old format produced', () => {
    const fromNew = parseCsv(newCsv([newRow()]), { accounts: KNOWN });
    const fromOld = parseCsv([OLD_HEADER, '2026-08-20,Woolworths,FNB Bank *9986,Day-to-day,Groceries,2026-08,No,ZAR,-109.99,ZAR,-109.99,Expense,Completed,,No Notes'].join('\n'));
    assignKeys(fromNew);
    assignKeys(fromOld);
    expect(fromNew[0].key).toBe(fromOld[0].key);
  });
});

describe('the copies the file makes of itself', () => {
  it('drops a pending row once the same transaction has settled', () => {
    const { rows, duplicatesIgnored } = parseExport(
      newCsv([newRow({ status: 'posted' }), newRow({ status: 'pending' })]),
      { accounts: KNOWN },
    );
    expect(rows).toHaveLength(1);
    expect(rows[0].Status).toBe('Completed');
    expect(duplicatesIgnored).toBe(1);
  });

  it('drops it even when the reference was re-masked in the meantime', () => {
    const { rows, duplicatesIgnored } = parseExport(
      newCsv([
        newRow({ desc: 'Toyota_Fin *0627 Toyota_Fin *1001', amount: '4990.67', status: 'posted' }),
        newRow({ desc: 'Toyota_Fin *0627 Toyota_Fin *7408', amount: '4990.67', status: 'pending' }),
      ]),
      { accounts: KNOWN },
    );
    expect(rows).toHaveLength(1);
    expect(rows[0].Description).toBe('Toyota_Fin *0627 Toyota_Fin *1001');
    expect(duplicatesIgnored).toBe(1);
  });

  it('drops every pending copy, however many the file makes', () => {
    const { rows, duplicatesIgnored } = parseExport(
      newCsv([
        newRow({ desc: 'Payfnb', amount: '5000', status: 'posted' }),
        ...Array.from({ length: 5 }, () => newRow({ desc: 'Payfnb', amount: '5000', status: 'pending' })),
      ]),
      { accounts: KNOWN },
    );
    expect(rows).toHaveLength(1);
    expect(duplicatesIgnored).toBe(5);
  });

  it('keeps a pending row that has not settled anywhere in the file', () => {
    const { rows, duplicatesIgnored } = parseExport(
      newCsv([newRow({ desc: 'Prepaid Electricity', amount: '1500', status: 'pending' })]),
      { accounts: KNOWN },
    );
    expect(rows).toHaveLength(1);
    expect(rows[0].Status).toBe('Pending');
    expect(duplicatesIgnored).toBe(0);
  });

  it('collapses a row the file repeats verbatim, and counts it', () => {
    const { rows, repeatsCollapsed } = parseExport(
      newCsv([
        newRow({ desc: 'Interest', amount: '387.36' }),
        newRow({ desc: 'Interest', amount: '387.36' }),
        newRow({ desc: 'Interest', amount: '387.36' }),
      ]),
      { accounts: KNOWN },
    );
    expect(rows).toHaveLength(1);
    expect(repeatsCollapsed).toBe(2);
  });

  it('keeps settled rows that differ anywhere at all', () => {
    const { rows, repeatsCollapsed } = parseExport(
      newCsv([
        newRow({ desc: 'Makro', amount: '3387.10' }),
        newRow({ desc: 'Makro', amount: '3387.10', post: '2024-10-21' }),
        newRow({ desc: 'Uber', amount: '192' }),
        newRow({ desc: 'Uber', amount: '254' }),
      ]),
      { accounts: KNOWN },
    );
    expect(rows).toHaveLength(4);
    expect(repeatsCollapsed).toBe(0);
  });

  it('numbers the rows it keeps from zero, in file order', () => {
    const rows = parseCsv(
      newCsv([newRow({ desc: 'A', amount: '10' }), newRow({ desc: 'B', amount: '20', status: 'pending' }), newRow({ desc: 'C', amount: '30' })]),
      { accounts: KNOWN },
    );
    expect(rows.map((r) => r.id)).toEqual([0, 1, 2]);
    expect(rows.map((r) => r.Description)).toEqual(['A', 'B', 'C']);
  });
});
