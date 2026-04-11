// Builds the advisor-ready `spendingInsights` block for exported payloads.
// Pure and idempotent: given the same (normalized) store + currentDate, returns
// the same structure. Computed at export time, not persisted to localStorage.

export function buildSpendingInsights(store, options = {}) {
  const currentDate = options.currentDate || new Date();
  const asOf = currentDate.toISOString().slice(0, 10);
  return {
    asOf,
    windowMonths: 12
  };
}
