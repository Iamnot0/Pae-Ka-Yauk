/**
 * Byte-level ESC/POS helpers for Epson TM-series thermal receipt printers.
 *
 * Reference: Epson ESC/POS Command Reference (public spec).
 * Every export returns a `Buffer` so callers can `Buffer.concat([...])` them
 * in order to produce a complete print job. No dependencies — pure Node.
 *
 * Receipt width: 48 chars @ Font A (default), 32 chars @ Font B. We assume
 * Font A throughout. All user-facing formatting (columns, dividers) must
 * honor the 48-char width to align cleanly on 80mm paper.
 */

const ESC = 0x1b;
const GS = 0x1d;

export const RECEIPT_WIDTH = 48;

/** Reset printer to default state (clears prior formatting). */
export const init = (): Buffer => Buffer.of(ESC, 0x40);

export const alignLeft = (): Buffer => Buffer.of(ESC, 0x61, 0);
export const alignCenter = (): Buffer => Buffer.of(ESC, 0x61, 1);
export const alignRight = (): Buffer => Buffer.of(ESC, 0x61, 2);

export const boldOn = (): Buffer => Buffer.of(ESC, 0x45, 1);
export const boldOff = (): Buffer => Buffer.of(ESC, 0x45, 0);

export const underlineOn = (): Buffer => Buffer.of(ESC, 0x2d, 1);
export const underlineOff = (): Buffer => Buffer.of(ESC, 0x2d, 0);

/**
 * Character size via GS ! n. Bits 0-3 = height multiplier (1-8),
 * bits 4-7 = width multiplier. Common combos below.
 */
export const sizeNormal = (): Buffer => Buffer.of(GS, 0x21, 0x00);
export const sizeDoubleWidth = (): Buffer => Buffer.of(GS, 0x21, 0x10);
export const sizeDoubleHeight = (): Buffer => Buffer.of(GS, 0x21, 0x01);
export const sizeLarge = (): Buffer => Buffer.of(GS, 0x21, 0x11); // 2x × 2x

export const text = (s: string): Buffer => Buffer.from(s, 'utf8');
export const lf = (n = 1): Buffer => Buffer.alloc(n, 0x0a);

/** Feed n lines (ESC d n). */
export const feed = (n: number): Buffer => Buffer.of(ESC, 0x64, Math.max(0, Math.min(255, n)));

/** Partial cut with 3-dot paper feed (GS V A n). */
export const cut = (): Buffer => Buffer.of(GS, 0x56, 0x41, 3);

/** Pulse drawer-kick pin #2 (ESC p 0 50 200). Pin #1 = `Buffer.of(ESC, 0x70, 0, 50, 200)`. */
export const openDrawer = (): Buffer => Buffer.of(ESC, 0x70, 0, 50, 200);

/**
 * Raster bitmap print via GS v 0 — the broadest-compatibility ESC/POS image
 * command (works on every TM model from TM-T20 onward). Input is packed
 * 1-bit-per-pixel MSB-first, `widthPx` wide (MUST be divisible by 8),
 * `heightPx` tall.
 *
 * Why chunked: a single GS v 0 accepts up to 65535 rows in theory, but most
 * TM firmwares have a ~4KB input buffer that overflows on tall single
 * commands. Splitting into 128-row slices keeps each command safely under
 * the buffer and lets the printer feed smoothly between slices.
 *
 * Command format:
 *   GS v 0 m xL xH yL yH d1 d2 ... dN
 *     m = 0          (normal mode, no scaling)
 *     xL xH          width in BYTES, little-endian
 *     yL yH          height in PIXELS, little-endian
 *     data           xBytes × y rows, MSB-first bit-packed
 */
export const rasterBitmap = (
  oneBppData: Uint8Array,
  widthPx: number,
  heightPx: number,
  chunkRows = 128,
): Buffer => {
  if (widthPx % 8 !== 0) {
    throw new Error(`rasterBitmap: widthPx must be a multiple of 8 (got ${widthPx})`);
  }
  const xBytes = widthPx / 8;
  const expected = xBytes * heightPx;
  if (oneBppData.length !== expected) {
    throw new Error(`rasterBitmap: data length ${oneBppData.length} ≠ expected ${expected}`);
  }
  const chunks: Buffer[] = [];
  for (let y = 0; y < heightPx; y += chunkRows) {
    const h = Math.min(chunkRows, heightPx - y);
    const slice = oneBppData.subarray(y * xBytes, (y + h) * xBytes);
    chunks.push(
      Buffer.of(
        GS, 0x76, 0x30, 0x00,                // GS v 0 m (m=0 normal)
        xBytes & 0xff, (xBytes >> 8) & 0xff, // xL xH (width in bytes)
        h & 0xff, (h >> 8) & 0xff,           // yL yH (height in pixels)
      ),
      Buffer.from(slice),
    );
  }
  return Buffer.concat(chunks);
};

/**
 * CODE128 barcode with human-readable text below.
 *   GS H 2       — HRI position = below barcode
 *   GS f 0       — HRI font A
 *   GS h 80      — barcode height in dots (~10mm)
 *   GS w 2       — module width (1-6)
 *   GS k 73 n {B data — code set B (full ASCII)
 *
 * `data` must be printable ASCII. Receipt numbers (`PKY00001`) qualify.
 */
export const barcodeCode128 = (data: string): Buffer => {
  const ascii = Buffer.from(data, 'ascii');
  return Buffer.concat([
    Buffer.of(GS, 0x48, 2),
    Buffer.of(GS, 0x66, 0),
    Buffer.of(GS, 0x68, 80),
    Buffer.of(GS, 0x77, 2),
    // GS k 73: length byte = ascii.length + 2 (for the {B prefix)
    Buffer.of(GS, 0x6b, 73, ascii.length + 2, 0x7b, 0x42),
    ascii,
  ]);
};
