export function parseTransactionDate(value) {
  if (!value) return null;
  const iso = value.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (iso) return new Date(Number(iso[1]), Number(iso[2]) - 1, Number(iso[3]));

  const dmy = value.match(/^(\d{2})\/(\d{2})\/(\d{4})/);
  if (dmy) return new Date(Number(dmy[3]), Number(dmy[2]) - 1, Number(dmy[1]));

  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

export function startOfDay(date) {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate());
}

export function endOfDay(date) {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate(), 23, 59, 59, 999);
}

export function startOfMonth(year, monthIndex) {
  return new Date(year, monthIndex, 1);
}

export function endOfMonth(year, monthIndex) {
  return new Date(year, monthIndex + 1, 0, 23, 59, 59, 999);
}

/**
 * A pay-month key as numbers. A row that carries no key at all is not a crash: an export whose
 * columns had been renamed once wrote thousands of rows without one, and the whole app went blank
 * on the first of them. Unusable in, NaN out, and the callers decide what that means.
 */
export function parseMonthKey(monthKey) {
  const [year, month] = String(monthKey ?? '').split('-').map(Number);
  return { year, monthIndex: month - 1 };
}

export function monthKeyFromDate(date) {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  return `${y}-${m}`;
}

export function isoWeekKey(date) {
  const d = startOfDay(date);
  const day = d.getDay() || 7;
  d.setDate(d.getDate() + 4 - day);
  const yearStart = new Date(d.getFullYear(), 0, 1);
  const week = Math.ceil(((d - yearStart) / 86400000 + 1) / 7);
  return `${d.getFullYear()}-W${String(week).padStart(2, '0')}`;
}

export function formatBucketLabel(key, granularity) {
  if (granularity === 'month') {
    const [y, m] = key.split('-');
    return new Date(Number(y), Number(m) - 1, 1).toLocaleDateString('en-ZA', {
      month: 'short',
      year: '2-digit',
    });
  }
  if (granularity === 'week') {
    return key.replace('-W', ' W');
  }
  const date = parseTransactionDate(key);
  if (!date) return key;
  return date.toLocaleDateString('en-ZA', { day: 'numeric', month: 'short' });
}
