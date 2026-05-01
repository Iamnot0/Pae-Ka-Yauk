/**
 * Unit conversion — scalar, dimension-aware.
 *
 * Handles the common cases a bakery/cafe actually needs:
 *   - weight ↔ weight  (G ↔ KG)
 *   - volume ↔ volume  (ML ↔ L)
 *   - count preserved  (PCS, BOX, PACK, CARTON, BOTTLE, CAN are self-only)
 *
 * Weight ↔ volume (density conversions — e.g. 1 kg flour = 1.67 L) is a
 * material-specific concern that lives in the `unit_conversions` table.
 * For the first sell demo we don't need density yet — recipes stay in the
 * same dimension as the material's baseUnit.
 *
 * Pure function, no DB. Throws on impossible conversions so callers can't
 * silently produce wrong numbers.
 */

import type { Unit } from '@/lib/repos/materials';

// Canonical factor to the dimension's base unit.
// Weight base = G, Volume base = ML, Count bases = themselves.
const WEIGHT_TO_G: Partial<Record<Unit, number>> = {
  G: 1,
  KG: 1000,
};

const VOLUME_TO_ML: Partial<Record<Unit, number>> = {
  ML: 1,
  L: 1000,
};

const COUNT_UNITS: Unit[] = ['PCS', 'BOX', 'CUP', 'PACK', 'CARTON', 'BOTTLE', 'CAN'];

type Dimension = 'WEIGHT' | 'VOLUME' | 'COUNT';

function dimensionOf(u: Unit): Dimension {
  if (u in WEIGHT_TO_G) return 'WEIGHT';
  if (u in VOLUME_TO_ML) return 'VOLUME';
  if (COUNT_UNITS.includes(u)) return 'COUNT';
  throw new Error(`Unknown unit: ${u}`);
}

/**
 * Convert `qty` from `from` → `to`.
 *
 * - Same unit            → pass through
 * - Same dimension       → scale through the canonical base
 * - Cross-dimension      → throw (density conversions belong elsewhere)
 * - Count cross-type     → throw (1 BOX ≠ 1 PCS without a pack-size table)
 */
export function convert(qty: number, from: Unit, to: Unit): number {
  if (from === to) return qty;

  const fromDim = dimensionOf(from);
  const toDim = dimensionOf(to);
  if (fromDim !== toDim) {
    throw new Error(
      `Cannot convert ${from} → ${to}: different dimensions (${fromDim} vs ${toDim}). ` +
      `Weight↔volume conversions need a material-specific density entry in unit_conversions.`
    );
  }

  if (fromDim === 'WEIGHT') {
    return (qty * WEIGHT_TO_G[from]!) / WEIGHT_TO_G[to]!;
  }
  if (fromDim === 'VOLUME') {
    return (qty * VOLUME_TO_ML[from]!) / VOLUME_TO_ML[to]!;
  }
  // COUNT — must match exactly (handled by `from === to` at top)
  throw new Error(`Cannot convert count unit ${from} → ${to}: pack sizes require unit_conversions entry.`);
}

/** Convenience: true if `a` and `b` are in the same dimension. */
export function sameDimension(a: Unit, b: Unit): boolean {
  return dimensionOf(a) === dimensionOf(b);
}
