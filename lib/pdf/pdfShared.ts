import { jsPDF } from 'jspdf';
import { loadLogoForPdf } from './embedLogo';

export const BRAND_BROWN: [number, number, number] = [139, 94, 52];   // matches --color-primary
export const MUTED_GREY: [number, number, number] = [136, 136, 136];

export const fmtInt = (n: number) => new Intl.NumberFormat('en-US').format(Math.round(n));
export const fmtMmk = (n: number) => `${new Intl.NumberFormat('en-US').format(Math.round(n))} MMK`;
export const fmtQty = (n: number) =>
  new Intl.NumberFormat('en-US', { maximumFractionDigits: 2 }).format(n);

export function afterTable(doc: jsPDF): number {
  const lastY = (doc as jsPDF & { lastAutoTable?: { finalY?: number } }).lastAutoTable?.finalY;
  return typeof lastY === 'number' ? lastY : 0;
}

export function sectionHeader(doc: jsPDF, title: string, y: number): number {
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(13);
  doc.setTextColor(0);
  doc.text(title, 14, y);
  doc.setDrawColor(BRAND_BROWN[0], BRAND_BROWN[1], BRAND_BROWN[2]);
  doc.setLineWidth(0.5);
  doc.line(14, y + 1.5, 196, y + 1.5);
  return y + 6;
}

export function kpiStrip(doc: jsPDF, pairs: Array<[string, string]>, startY: number): number {
  const cols = pairs.length;
  const cellWidth = 182 / cols;
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(8);
  doc.setTextColor(MUTED_GREY[0], MUTED_GREY[1], MUTED_GREY[2]);
  pairs.forEach(([label], i) => {
    doc.text(label.toUpperCase(), 14 + i * cellWidth, startY);
  });
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(13);
  doc.setTextColor(0);
  pairs.forEach(([, value], i) => {
    doc.text(value, 14 + i * cellWidth, startY + 6);
  });
  return startY + 12;
}

/**
 * Standard cover header — logo (top-right, ~22mm square), shop name (top-left,
 * brand brown 18pt), report title + period (muted grey 10pt under name).
 *
 * `logoUrl` is fetched + converted to a data URL via embedLogo.ts. If the
 * fetch fails or no URL is given, we just skip the logo block — the rest
 * of the cover still renders cleanly.
 *
 * Returns the y coordinate where body content should start.
 */
export async function pdfCoverHeader(
  doc: jsPDF,
  opts: {
    shopName: string;
    reportTitle: string;
    periodLabel: string;
    generatedAt: string;
    logoUrl: string | null;
  },
): Promise<number> {
  const { shopName, reportTitle, periodLabel, generatedAt, logoUrl } = opts;

  // Logo (top-right). Square 22mm.
  if (logoUrl) {
    const logo = await loadLogoForPdf(logoUrl);
    if (logo) {
      doc.addImage(logo.dataUrl, logo.format, 173, 12, 22, 22);
    }
  }

  // Shop name (brand brown, 18pt)
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(18);
  doc.setTextColor(BRAND_BROWN[0], BRAND_BROWN[1], BRAND_BROWN[2]);
  doc.text(shopName, 14, 20);

  // Subtitle: report title · period · generated stamp
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(10);
  doc.setTextColor(MUTED_GREY[0], MUTED_GREY[1], MUTED_GREY[2]);
  doc.text(`${reportTitle} · ${periodLabel}`, 14, 26);
  doc.text(`Generated: ${generatedAt}`, 14, 31);

  return 40;
}

/**
 * Humanize a sellable_items.category enum value for display in the PDF.
 * The on-screen UI uses the i18n dict, but the PDF generator runs outside
 * that context — passing the dict in would add a lot of plumbing for one
 * lookup. The mapping here matches the English `item.cat.*` values.
 */
export function humanizeCategory(cat: string): string {
  switch (cat) {
    case 'BAKERY_BREAD':   return 'Bread';
    case 'BAKERY_CAKE':    return 'Cake';
    case 'BAKERY_PASTRY':  return 'Pastry';
    case 'BAKERY_SAVORY':  return 'Savory';
    case 'COFFEE_HOT':     return 'Hot Drink';
    case 'COFFEE_COLD':    return 'Cold Coffee';
    case 'TEA':            return 'Tea';
    case 'COLD_DRINK':     return 'Cold Drink';
    case 'DESSERT':        return 'Dessert';
    case 'OTHER':          return 'Other';
    default:               return cat;
  }
}

/**
 * Closing-summary callout — a bordered box with 3-4 headline numbers,
 * placed right under the cover so the owner gets the gist before reading
 * any table. Brand-brown thin border + bold value + muted label below.
 *
 * Layout: 4 equal-width columns spanning content width (182mm).
 * Returns next y.
 */
export function closingSummaryCallout(
  doc: jsPDF,
  pairs: Array<[string, string]>,
  startY: number,
): number {
  const boxX = 14;
  const boxY = startY;
  const boxW = 182;
  const boxH = 22;

  // Border
  doc.setDrawColor(BRAND_BROWN[0], BRAND_BROWN[1], BRAND_BROWN[2]);
  doc.setLineWidth(0.4);
  doc.roundedRect(boxX, boxY, boxW, boxH, 1.5, 1.5);

  const cols = pairs.length;
  const cellWidth = boxW / cols;
  pairs.forEach(([label, value], i) => {
    const cx = boxX + i * cellWidth + cellWidth / 2;

    // Value (bold, brand brown, 14pt)
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(14);
    doc.setTextColor(BRAND_BROWN[0], BRAND_BROWN[1], BRAND_BROWN[2]);
    doc.text(value, cx, boxY + 11, { align: 'center' });

    // Label (muted, 8pt, uppercase)
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(8);
    doc.setTextColor(MUTED_GREY[0], MUTED_GREY[1], MUTED_GREY[2]);
    doc.text(label.toUpperCase(), cx, boxY + 17, { align: 'center' });

    // Vertical separator (skip after last cell)
    if (i < cols - 1) {
      doc.setDrawColor(232, 223, 210); // --color-border
      doc.line(boxX + (i + 1) * cellWidth, boxY + 4, boxX + (i + 1) * cellWidth, boxY + boxH - 4);
    }
  });

  // Reset color so subsequent text isn't tinted
  doc.setTextColor(0);
  return boxY + boxH + 6;
}

/**
 * Section divider — a thin brand line + extra spacing. Used between the
 * Stock-Activity and Sales/Finance halves of the closing report so the eye
 * registers "this is a different topic, not just another sub-heading."
 */
export function sectionDivider(doc: jsPDF, y: number): number {
  doc.setDrawColor(BRAND_BROWN[0], BRAND_BROWN[1], BRAND_BROWN[2]);
  doc.setLineWidth(0.3);
  doc.line(14, y, 196, y);
  return y + 4;
}

export function pageFooters(doc: jsPDF, shopName: string, periodLabel: string): void {
  const pageCount = doc.getNumberOfPages();
  const pageWidth = doc.internal.pageSize.getWidth();
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(8);
  doc.setTextColor(MUTED_GREY[0], MUTED_GREY[1], MUTED_GREY[2]);
  for (let i = 1; i <= pageCount; i++) {
    doc.setPage(i);
    doc.text(
      `${shopName} · ${periodLabel} · Page ${i} of ${pageCount}`,
      pageWidth / 2,
      290,
      { align: 'center' },
    );
  }
}
