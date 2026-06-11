const BUDGET_FACILITY = /budget\s*facility/i;
const TRANSFER = /\btransfer\b/i;

export function isBudgetFacilityDescription(description) {
  return BUDGET_FACILITY.test(description || '');
}

/** e.g. "Transfer To Budget Facility Cr" — money movement, not a purchase. */
export function isBudgetFacilityTransferDescription(description) {
  const d = description || '';
  return isBudgetFacilityDescription(d) && TRANSFER.test(d);
}
