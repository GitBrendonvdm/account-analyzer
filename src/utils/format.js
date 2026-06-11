export function formatMonthLabel(month, currentMonth) {
  return month === currentMonth ? 'Current' : month;
}

export function formatCurrency(val) {
  return new Intl.NumberFormat('en-ZA', {
    style: 'currency',
    currency: 'ZAR',
    maximumFractionDigits: 0,
  }).format(val || 0);
}

export function formatCurrencyAbs(val) {
  return formatCurrency(Math.abs(val || 0));
}
