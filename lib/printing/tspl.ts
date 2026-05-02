/**
 * TSPL (Taiwan Semi Page Language) builder for the NipponPOS / RONGTA-OEM
 * thermal label printer — 3-up horizontal layout.
 *
 * Roll spec (Pae Ka Yauk roll, 2026-05-01):
 *   - 100 mm wide roll, 3 sticker cells across.
 *   - Each cell: 32 mm × 20 mm (W × H).
 *   - Column gap: 2 mm. Row gap: 2 mm.
 *
 * If your roll has different dimensions, change the constants in the Roll
 * geometry block — barcode height, text positions, name truncation all
 * auto-scale from there.
 *
 * Print model:
 *   We compose all 3 cells of one row in a single TSPL frame, with
 *   `SIZE = 100mm × cellH`. The printer's gap sensor advances one ROW
 *   per print copy, so PRINT 1,N prints N rows × 3 cells = 3N stickers.
 *   For an odd qty (e.g. 5) we emit two frames: a full row of 3 cells
 *   followed by a partial row of 2 cells (remainder column blank).
 *
 * Cell layout, top to bottom (centered horizontally inside each cell):
 *   - Item name                                     (top, font "2")
 *   - CODE128 of the SKU                            (middle)
 *   - 8-digit SKU human-readable                    (bottom, font "2")
 *
 * Burmese text is stripped — TSPL built-in fonts have no Myanmar
 * codepage. The sticker is for staff scanning; English + numeric is
 * sufficient. The bilingual customer slip uses a different code path.
 */

const TSPL_DPI = 203;
const MM_TO_DOTS = TSPL_DPI / 25.4;          // ≈ 8 dots/mm
const dot = (mm: number) => Math.round(mm * MM_TO_DOTS);

// ── Roll geometry ─────────────────────────────────────────────────
const LABEL_WIDTH_MM   = 32;
const LABEL_HEIGHT_MM  = 20;
const COL_COUNT        = 3;
const COL_GAP_MM       = 2;
const ROW_GAP_MM       = 2;
const ROLL_WIDTH_MM    = LABEL_WIDTH_MM * COL_COUNT + COL_GAP_MM * (COL_COUNT - 1); // 100

const LABEL_WIDTH_DOTS  = dot(LABEL_WIDTH_MM);                      // 256
const LABEL_HEIGHT_DOTS = dot(LABEL_HEIGHT_MM);                     // 160
const COL_PITCH_DOTS    = dot(LABEL_WIDTH_MM + COL_GAP_MM);         // 272

// ── Fonts (RONGTA / TSPL built-in — empirically calibrated against
//   our NipponPOS unit, 2026-05-01) ─────────────────────────────────
//   font "2" renders at ~12 wide × ~24 tall, NOT the 16×32 the
//   generic spec sometimes lists. Using 16 here caused all printed
//   text to land left-of-cell-center.
const TEXT_FONT     = '2';
const TEXT_CHAR_W   = 12;
const TEXT_CHAR_H   = 24;

// ── CODE128 (8-digit numeric) ─────────────────────────────────────
//   ~79 modules × 2 dots/module ≈ 158 dots wide.
const BARCODE_NARROW     = 2;
const BARCODE_WIDE       = 2;
const BARCODE_WIDTH_DOTS = 158;

// Vertical padding around each element. Bumped to 8 dots (~1 mm) per side
// after a print test showed the SKU digits row landing too close to the
// cell's bottom edge — even a small printer-side offset clipped the
// descenders. 1 mm of breathing room above + below absorbs that.
const TEXT_PAD_DOTS       = 8;
const BARCODE_HEIGHT_DOTS = Math.max(
  32,                                                                // ~4 mm minimum for reliable Code128 decode
  LABEL_HEIGHT_DOTS - 2 * TEXT_CHAR_H - 4 * TEXT_PAD_DOTS,
);

interface StickerInput {
  /** Item name (English). Truncated to fit the cell. */
  name: string;
  /** 8-digit numeric SKU. */
  sku: string;
  /** Number of physical stickers requested. */
  qty: number;
}

/**
 * Centered-X for a string of width `text.length × charWidth` inside a cell
 * placed at `cellOffsetDots`. TSPL TEXT positions by the LEFT edge — there
 * is no portable alignment param across RONGTA firmware revisions — so we
 * compute it ourselves.
 */
function centeredX(text: string, charWidthDots: number, cellOffsetDots: number): number {
  const textWidth = text.length * charWidthDots;
  const xInCell = Math.max(0, Math.floor((LABEL_WIDTH_DOTS - textWidth) / 2));
  return cellOffsetDots + xInCell;
}

/**
 * Emit the 3 commands (name, barcode, sku) for one sticker cell.
 */
function buildCell(cellOffsetDots: number, displayName: string, sku: string): string[] {
  // Vertical positions inside the cell (0 = top edge).
  //   name  starts at TEXT_PAD_DOTS
  //   barcode starts after the name + a pad
  //   sku digits end TEXT_PAD_DOTS from the bottom
  const nameY    = TEXT_PAD_DOTS;
  const barcodeY = nameY + TEXT_CHAR_H + TEXT_PAD_DOTS;
  const skuY     = LABEL_HEIGHT_DOTS - TEXT_CHAR_H - TEXT_PAD_DOTS;

  const nameX    = centeredX(displayName, TEXT_CHAR_W, cellOffsetDots);
  const skuX     = centeredX(sku,         TEXT_CHAR_W, cellOffsetDots);
  const barcodeX = cellOffsetDots + Math.floor((LABEL_WIDTH_DOTS - BARCODE_WIDTH_DOTS) / 2);

  return [
    `TEXT ${nameX},${nameY},"${TEXT_FONT}",0,1,1,"${displayName}"`,
    `BARCODE ${barcodeX},${barcodeY},"128",${BARCODE_HEIGHT_DOTS},0,0,${BARCODE_NARROW},${BARCODE_WIDE},"${sku}"`,
    `TEXT ${skuX},${skuY},"${TEXT_FONT}",0,1,1,"${sku}"`,
  ];
}

/**
 * Emit a CLS / cells / PRINT block — one TSPL "frame" of `cellsInRow`
 * stickers, repeated `copies` times.
 */
function buildFrame(cellsInRow: number, copies: number, displayName: string, sku: string): string[] {
  const lines: string[] = ['CLS'];
  for (let col = 0; col < cellsInRow; col++) {
    lines.push(...buildCell(col * COL_PITCH_DOTS, displayName, sku));
  }
  lines.push(`PRINT 1,${copies}`);
  return lines;
}

/**
 * Build the byte stream for one sticker print job. TSPL is plain ASCII —
 * the printer parses CRLF-terminated commands. We use \r\n for max
 * compatibility across firmware revisions.
 */
export function buildStickerTspl({ name, sku, qty }: StickerInput): Buffer {
  if (qty < 1) qty = 1;

  // Strip non-ASCII (TSPL built-in fonts have no Myanmar codepage). Trim
  // resulting whitespace, drop double-quotes which would terminate the TEXT
  // command's quoted argument. If what's left has no English letters at all
  // — happens for items whose `name` is Burmese-only — fall back to the SKU
  // so the sticker always has a readable top label. (Owner directive
  // 2026-05-03: stickers stay English-only; no canvas/bitmap path for now.)
  const stripped = (name || '')
    .replace(/[^\x20-\x7E]/g, '')
    .replace(/"/g, "'")
    .trim();
  const usable = /[A-Za-z]/.test(stripped) ? stripped : `Item ${sku}`;
  const maxNameChars = Math.max(1, Math.floor(LABEL_WIDTH_DOTS / TEXT_CHAR_W) - 1);
  const displayName = usable.length > maxNameChars
    ? usable.slice(0, maxNameChars - 1) + '.'
    : usable;

  const fullRows  = Math.floor(qty / COL_COUNT);   // rows fully filled
  const remainder = qty % COL_COUNT;               // leftover cells in last row

  // Header order matters in TSPL: SIZE / GAP must precede REFERENCE; CLS at
  // the end clears any state left over from a prior job. REFERENCE 0,0 +
  // SHIFT 0 + OFFSET 0 explicitly reset origin/spacing so the print can't
  // drift right (regression seen 2026-05-02 + 2026-05-03 — the printer was
  // remembering offsets from a previous job between power-cycles, pushing
  // every cell into column 3 and clipping it off the right edge).
  const program: string[] = [
    `SIZE ${ROLL_WIDTH_MM} mm, ${LABEL_HEIGHT_MM} mm`,
    `GAP ${ROW_GAP_MM} mm, 0 mm`,
    `DIRECTION 1,0`,
    `REFERENCE 0,0`,
    `SHIFT 0`,
    `OFFSET 0 mm`,
    `DENSITY 8`,
    `SPEED 4`,
    `CLS`,
  ];

  if (fullRows > 0) {
    program.push(...buildFrame(COL_COUNT, fullRows, displayName, sku));
  }
  if (remainder > 0) {
    program.push(...buildFrame(remainder, 1, displayName, sku));
  }

  return Buffer.from(program.join('\r\n') + '\r\n', 'ascii');
}
