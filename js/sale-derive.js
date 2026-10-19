// ============================================================
//  sale-derive.js — single source of truth for a sale's payment state
//
//  amountReceived / balanceOwing / paymentStatus on a sale doc are a CACHE,
//  not truth — the real record is `payments[]` (+ totalRevenue). Multiple
//  write paths (trade edits, queued offline replays) can leave that cache
//  stale or wrong; see docs/BUG_LOG.md BUG-014/BUG-015 and the
//  NGPKT202607122D54C incident.
//
//  normalizeSale() re-derives the cache from payments[] the moment a sale
//  enters memory (Firestore snapshot, staff bootstrap, localStorage
//  rehydrate) so every reader — table, dashboard, receipt — sees the same,
//  correct number without having to know about this. Field names are kept
//  identical to the stored ones so no read site needs to change.
//
//  Do NOT call this on editHistory[] snapshots — those are historical
//  records and must render as they were, not re-derived.
// ============================================================

const round = n => Math.round((n || 0) * 100) / 100;

// Net amount actually paid, from the trade's own payment history.
// type:'refund' entries subtract. Removed entries (removed:true) stay in the
// list so the history keeps a trace, but count for nothing. Not clamped — an overpayment legitimately
// produces a value greater than totalRevenue, same as the original
// amountReceived semantics.
export function netPaid(sale) {
  return round((sale?.payments || []).reduce(
    (sum, p) => p.removed ? sum : p.type === 'refund' ? sum - (p.amount || 0) : sum + (p.amount || 0), 0
  ));
}

export function deriveSaleTotals(sale) {
  const total = sale?.totalRevenue ?? sale?.revenue ?? 0;
  const paid = netPaid(sale);
  const balanceOwing = Math.max(0, round(total - paid));
  const paymentStatus = balanceOwing <= 0 ? 'paid' : paid <= 0 ? 'credit' : 'partial';
  return { amountReceived: paid, balanceOwing, paymentStatus };
}

// Re-derives one sale's cache fields. Non-destructive — returns a new
// object; never mutates the input. `_pkCacheDrift` is local-only diagnostic
// (stripped before any Firestore write by write-gateway's _clean(), same
// treatment as _pkSyncPending) recording how far the stored cache had
// drifted from the real payment history, so drift is visible in the console
// instead of only being found by hand weeks later.
export function normalizeSale(sale) {
  if (!sale || typeof sale !== 'object') return sale;
  const derived = deriveSaleTotals(sale);
  const storedBalance = sale.balanceOwing || 0;
  const drift = round(Math.abs(storedBalance - derived.balanceOwing));
  if (drift > 0.5) {
    console.warn(
      `[sale-derive] cache drift on trade ${sale.id}: stored balanceOwing=${storedBalance}, ` +
      `derived=${derived.balanceOwing} (Δ${drift}). Displaying the derived value.`
    );
  }
  return { ...sale, ...derived, _pkCacheDrift: drift > 0.5 ? drift : 0 };
}

export function normalizeSales(sales) {
  return (sales || []).map(normalizeSale);
}
