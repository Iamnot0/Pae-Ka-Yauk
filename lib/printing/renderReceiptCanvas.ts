'use client';

/**
 * Client-side bitmap renderer for bilingual receipts.
 *
 * Epson TM-series firmware has no Myanmar codepage, so sending UTF-8 Burmese
 * bytes directly prints boxes. Instead, we draw the entire slip (Latin +
 * Myanmar + all formatting) into an offscreen `<canvas>` using the fonts
 * the app already loads (`Padauk` / `Noto Sans Myanmar`), then convert the
 * result to 1-bit-per-pixel raster bytes and POST to `/api/print`. The
 * server wraps those bytes with the native barcode + cut commands.
 *
 * This keeps Myanmar rendering entirely in the browser (which already does
 * it correctly for on-screen display) and keeps the server dependency-free.
 *
 * Width: 576 pixels is the canonical TM-series 80mm-paper dot count (TM-m30,
 * TM-T88VI, TM-T82III, etc.). If Boss ends up with a 512-dot model later,
 * set `NEXT_PUBLIC_PRINTER_WIDTH_DOTS=512` in .env.
 */

export interface ReceiptMeta {
  /**
   * Receipt number stamped on the slip. Null when printing an offline
   * sale before its outbox row has drained — caller passes the ULID
   * fallback for the BARCODE, but the human-readable line above can stay
   * empty (renderer handles null by printing "—").
   */
  receiptNumber: string | null;
  createdAt: string;    // ISO
  subtotal: number;
  taxTotal: number;
  deliveryFee?: number;
  total: number;
  tenderType: string;   // 'CASH' | 'CARD' | 'MOBILE_MONEY' | 'BANK_TRANSFER'
  amountTendered: number;
  changeGiven: number;
}

export interface BilingualLine {
  qty: number;
  name: string;                    // Latin (always present)
  nameLocal: string | null;        // Myanmar (optional — shown only if set)
  unitPrice: number;
  lineTotal: number;
}

import type { DictKey } from '@/lib/i18n/dict';

export interface RenderInput {
  sale: ReceiptMeta;
  lines: BilingualLine[];
  t: (key: DictKey) => string;      // locale resolver (uses whichever locale UI is in)
  tEnMy: (key: DictKey) => { en: string; my: string }; // always returns both languages
}

export interface RenderOutput {
  bitmapBase64: string;
  widthPx: number;
  heightPx: number;
}

const DEFAULT_WIDTH = 576;
const SIDE_PAD = 10;

// Font stacks: mirror the CSS variables defined in app/globals.css so the
// canvas uses the same typefaces the on-screen receipt uses.
const FONT_MY = "'Padauk', 'Noto Sans Myanmar', 'Myanmar Text', sans-serif";
const FONT_EN = "'Courier New', 'Courier', 'Menlo', monospace";

const fmtMoney = (n: number) => Math.round(n).toLocaleString('en-US');

const prettyTender = (raw: string, t: (k: DictKey) => string): string => {
  switch (raw) {
    case 'CASH': return t('slip.cash');
    case 'CARD': return t('slip.card');
    case 'MOBILE_MONEY': return t('slip.mobile');
    case 'BANK_TRANSFER': return t('slip.bank');
    default: return raw.replace(/_/g, ' ').toLowerCase();
  }
};

const fmtDate = (iso: string): string => {
  const d = new Date(iso);
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
};

export async function renderReceiptCanvas(input: RenderInput): Promise<RenderOutput> {
  // Canvas fonts race hydration — wait until the browser has actually
  // rasterized Padauk/Noto so ctx.measureText + fillText use the right glyphs.
  if (typeof document !== 'undefined' && 'fonts' in document) {
    try { await document.fonts.ready; } catch { /* older browsers: skip */ }
  }

  const widthDots = DEFAULT_WIDTH;
  // Provision tall canvas; we trim to actual content height before emitting bytes.
  const canvas = document.createElement('canvas');
  canvas.width = widthDots;
  canvas.height = 2400;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('Canvas 2D context unavailable');

  // White background — ESC/POS treats dark pixels as "print".
  ctx.fillStyle = 'white';
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.fillStyle = 'black';
  ctx.textBaseline = 'alphabetic';

  // ── drawing helpers ───────────────────────────────────────
  const center = (text: string, font: string, y: number, lineHeight: number) => {
    ctx.font = font;
    const m = ctx.measureText(text);
    ctx.fillText(text, (widthDots - m.width) / 2, y);
    return y + lineHeight;
  };

  const twoCol = (left: string, right: string, font: string, y: number, lineHeight: number) => {
    ctx.font = font;
    ctx.fillText(left, SIDE_PAD, y);
    const rw = ctx.measureText(right).width;
    ctx.fillText(right, widthDots - SIDE_PAD - rw, y);
    return y + lineHeight;
  };

  const leftOnly = (text: string, font: string, y: number, lineHeight: number) => {
    ctx.font = font;
    ctx.fillText(text, SIDE_PAD, y);
    return y + lineHeight;
  };

  // Full-width hyphen divider — matches the traditional thermal-slip look
  // (the old text-mode version produced exactly this). Extra vertical
  // breathing room below because Myanmar ascenders in the next row can
  // rise higher than Latin ones and would otherwise clip the dash line.
  const divider = (y: number) => {
    ctx.font = `normal 18px ${FONT_EN}`;
    const dashW = ctx.measureText('-').width || 8;
    const count = Math.max(1, Math.floor((widthDots - 2 * SIDE_PAD) / dashW));
    const baselineY = y + 14;
    ctx.fillText('-'.repeat(count), SIDE_PAD, baselineY);
    return baselineY + 18;
  };

  // Bilingual header row (English / Myanmar) with an aligned right-hand value.
  // Layout: "English" on line 1, "Myanmar" on line 2 (smaller), value on line 1 right.
  const twoColBilingual = (
    leftEn: string, leftMy: string, right: string, y: number,
  ) => {
    ctx.font = `500 22px ${FONT_EN}`;
    ctx.fillText(leftEn, SIDE_PAD, y);
    const rw = ctx.measureText(right).width;
    ctx.fillText(right, widthDots - SIDE_PAD - rw, y);
    y += 26;
    if (leftMy) {
      ctx.font = `normal 20px ${FONT_MY}`;
      ctx.fillText(leftMy, SIDE_PAD, y);
      y += 22;
    }
    return y + 4;
  };

  // ── draw the receipt ──────────────────────────────────────
  let y = 36;

  // Shop header (brand strings — fixed, not locale-dependent)
  y = center('PAE KA YAUK', `bold 44px ${FONT_EN}`, y, 50);
  y = center('ပဲကရောက်', `700 34px ${FONT_MY}`, y, 38);
  // English-only subtitle (owner pref — no Myanmar equivalent on this line)
  y = center(input.tEnMy('slip.subtitle').en, `normal 20px ${FONT_EN}`, y + 2, 24);
  y += 4;
  y = divider(y);

  // Meta — Date only. Receipt number is rendered below the barcode at the
  // bottom of the slip; printing it twice was noisy so we removed the top row.
  const mDate = input.tEnMy('slip.date');
  y = twoColBilingual(`${mDate.en}:`, mDate.my, fmtDate(input.sale.createdAt), y);
  y = divider(y);

  // Line items — single-row layout: "English (Myanmar) x qty" on the left,
  // `lineTotal` on the right, `@ unit price` in a smaller muted row below.
  // Mixed-script font stack falls back from monospace Latin to Padauk for
  // Burmese glyphs, so qty/numerals stay aligned while Myanmar renders too.
  const ITEM_FONT = `500 22px 'Courier New','Courier','Padauk','Noto Sans Myanmar',monospace`;
  for (const line of input.lines) {
    const label = line.nameLocal
      ? `${line.name} (${line.nameLocal}) x ${line.qty}`
      : `${line.name} x ${line.qty}`;
    const amount = fmtMoney(line.lineTotal);

    ctx.font = ITEM_FONT;
    const amountW = ctx.measureText(amount).width;
    const maxLabelW = widthDots - 2 * SIDE_PAD - amountW - 12;

    // Truncate with '…' if the label would overlap the amount column
    let labelOut = label;
    if (ctx.measureText(labelOut).width > maxLabelW) {
      while (labelOut.length > 3 && ctx.measureText(labelOut + '…').width > maxLabelW) {
        labelOut = labelOut.slice(0, -1);
      }
      labelOut += '…';
    }

    ctx.fillText(labelOut, SIDE_PAD, y);
    ctx.fillText(amount, widthDots - SIDE_PAD - amountW, y);
    y += 28;

    // Unit-price detail row — indented, smaller, same monospace
    ctx.font = `normal 18px ${FONT_EN}`;
    ctx.fillText(`  @ ${fmtMoney(line.unitPrice)}`, SIDE_PAD, y);
    y += 22;
  }

  y = divider(y);

  // Totals
  const mSub = input.tEnMy('slip.subtotal');
  y = twoColBilingual(mSub.en, mSub.my, fmtMoney(input.sale.subtotal), y);
  if (input.sale.taxTotal > 0) {
    // Slip shows "Tax (5%)" label only — no kyat figure (owner brief
    // 2026-04-28). Total below is tax-inclusive so customers can verify
    // by arithmetic. Empty third arg → twoColBilingual prints just the
    // bilingual label with no right-aligned amount column.
    const mTax = input.tEnMy('slip.tax');
    y = twoColBilingual(mTax.en, mTax.my, '', y);
  }
  if ((input.sale.deliveryFee ?? 0) > 0) {
    const mDel = input.tEnMy('slip.delivery');
    y = twoColBilingual(mDel.en, mDel.my, fmtMoney(input.sale.deliveryFee ?? 0), y);
  }
  y = divider(y);

  // TOTAL — larger, bolder
  const mTot = input.tEnMy('slip.total');
  ctx.font = `900 30px ${FONT_EN}`;
  ctx.fillText(mTot.en, SIDE_PAD, y);
  const totalStr = fmtMoney(input.sale.total);
  const totalW = ctx.measureText(totalStr).width;
  ctx.fillText(totalStr, widthDots - SIDE_PAD - totalW, y);
  y += 34;
  ctx.font = `700 22px ${FONT_MY}`;
  ctx.fillText(mTot.my, SIDE_PAD, y);
  y += 30;
  y = divider(y);

  // Tender (with inline payment-method suffix in both languages)
  const mTen = input.tEnMy('slip.tendered');
  const tenderMethod = prettyTender(input.sale.tenderType, input.t);
  const methodMy = (() => {
    switch (input.sale.tenderType) {
      case 'CASH': return input.tEnMy('slip.cash').my;
      case 'CARD': return input.tEnMy('slip.card').my;
      case 'MOBILE_MONEY': return input.tEnMy('slip.mobile').my;
      case 'BANK_TRANSFER': return input.tEnMy('slip.bank').my;
      default: return '';
    }
  })();
  y = twoColBilingual(
    `${mTen.en} (${tenderMethod})`,
    `${mTen.my} (${methodMy})`,
    fmtMoney(input.sale.amountTendered),
    y,
  );
  if (input.sale.changeGiven > 0) {
    const mCh = input.tEnMy('slip.change');
    y = twoColBilingual(mCh.en, mCh.my, fmtMoney(input.sale.changeGiven), y);
  }
  y = divider(y);

  // Thank you — centered, bilingual. Myanmar string is long; allow wrap by
  // splitting on the natural break before `ကျေးဇူးတင်` if it overflows.
  const mThanks = input.tEnMy('slip.thankYou');
  y = center(mThanks.en, `500 22px ${FONT_EN}`, y + 6, 28);
  ctx.font = `normal 22px ${FONT_MY}`;
  const myText = mThanks.my;
  const myW = ctx.measureText(myText).width;
  if (myW <= widthDots - 2 * SIDE_PAD) {
    y = center(myText, `normal 22px ${FONT_MY}`, y, 30);
  } else {
    // Soft-wrap: split on a break point around the middle of the string
    const splitAt = Math.floor(myText.length * 0.55);
    const lineA = myText.slice(0, splitAt);
    const lineB = myText.slice(splitAt);
    y = center(lineA, `normal 22px ${FONT_MY}`, y, 28);
    y = center(lineB, `normal 22px ${FONT_MY}`, y, 30);
  }

  // Bottom padding so the cut isn't flush against the last character
  y += 16;

  const heightPx = Math.min(y, canvas.height);

  // ── Convert the used area of the canvas into 1-bpp MSB-first bytes ───
  const imgData = ctx.getImageData(0, 0, widthDots, heightPx);
  const oneBpp = rgbaTo1bpp(imgData.data, widthDots, heightPx);

  return {
    bitmapBase64: uint8ToBase64(oneBpp),
    widthPx: widthDots,
    heightPx,
  };
}

/**
 * RGBA pixel array → MSB-first 1-bpp packed bytes.
 * A pixel counts as "on" (black ink) when it's visibly dark (R<128) and
 * not transparent (A>128). Everything else stays white (paper).
 */
function rgbaTo1bpp(rgba: Uint8ClampedArray, widthPx: number, heightPx: number): Uint8Array {
  const xBytes = widthPx / 8;
  const out = new Uint8Array(xBytes * heightPx);
  for (let y = 0; y < heightPx; y++) {
    for (let x = 0; x < widthPx; x++) {
      const pi = (y * widthPx + x) * 4;
      const isDark = rgba[pi + 3] > 128 && rgba[pi] < 128;
      if (isDark) {
        out[y * xBytes + (x >>> 3)] |= 1 << (7 - (x & 7));
      }
    }
  }
  return out;
}

/** Large-array safe base64 encoder (btoa() has a per-call arg-length limit). */
function uint8ToBase64(bytes: Uint8Array): string {
  const CHUNK = 0x8000;
  let bin = '';
  for (let i = 0; i < bytes.length; i += CHUNK) {
    const slice = bytes.subarray(i, i + CHUNK);
    bin += String.fromCharCode.apply(null, slice as unknown as number[]);
  }
  return btoa(bin);
}
