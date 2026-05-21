/**
 * Tax policy — single source of truth for the tenant's tax rate.
 *
 * Policy (owner-confirmed 2026-05-21): the rate is still 5%, but tax is
 * NO LONGER applied to every sale automatically. Most customers do not ask
 * for a tax slip and the shop does not remit tax on those sales. Tax is now
 * opt-in PER TRANSACTION via a Tax toggle on the POS. When the cashier
 * enables it for a given cart, 5% of subtotal is added; otherwise zero.
 * The cart's `taxApplied` boolean is the single signal, threaded through
 * the outbox payload to /api/sales and persisted as `sale_transactions.taxApplied`.
 *
 * The pure rate constant and computation helper remain unchanged — callers
 * decide whether to call them based on `taxApplied`. The previous
 * "every-slip flat 5%" behavior is preserved as a CALLER choice (pass
 * taxApplied=true) for any future automation, but the cashier UI defaults
 * to taxApplied=false.
 *
 * Phase 2 multi-tenant: swap this for `getTaxRate(tenantId)` reading from
 * `tenant_config.taxRate` in Neon. The opt-in flag stays per-transaction.
 */

export const TAX_RATE = 0.05;

/** Compute the tax amount for a given subtotal. MMK is integer — round to whole kyats. */
export function computeTax(subtotal: number): number {
  return Math.round(subtotal * TAX_RATE);
}

/**
 * Apply tax conditionally based on the per-sale opt-in flag. Centralizes the
 * `taxApplied ? computeTax(x) : 0` pattern so caller sites stay declarative
 * and the policy switch lives in exactly one place.
 */
export function applyTaxIf(taxApplied: boolean, subtotal: number): number {
  return taxApplied ? computeTax(subtotal) : 0;
}
