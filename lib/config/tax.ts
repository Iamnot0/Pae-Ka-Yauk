/**
 * Tax policy — single source of truth for the tenant's tax rate.
 *
 * Decision (owner confirmed 2026-04-25): flat 5% applied to every sale's
 * subtotal, regardless of items in the basket or their individual
 * `sellable_items.taxRate` column (that column is effectively dead; kept for
 * Phase 2 when we might support per-item overrides in some jurisdictions).
 *
 * Why a constant instead of env var:
 *   - Tax rate is not infrastructure config — it's a business policy that
 *     belongs in code review, not an .env file anyone can edit silently.
 *   - Changes should go through the normal PR process so the finance team
 *     can sign off, and the receipt's printed "Tax (X%)" label updates in
 *     lockstep (see dict.ts → `slip.tax`).
 *
 * Phase 2 multi-tenant: swap this for `getTaxRate(tenantId)` reading from
 * `tenant_config.taxRate` in Neon.
 */

export const TAX_RATE = 0.05;

/** Compute the tax amount for a given subtotal. MMK is integer — round to whole kyats. */
export function computeTax(subtotal: number): number {
  return Math.round(subtotal * TAX_RATE);
}
