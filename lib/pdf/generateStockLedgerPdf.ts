/**
 * Stock Ledger PDF — refined 2026-04-28.
 *
 * The PDF mirrors the on-screen Stock Ledger tab (Stock Activity primary)
 * and appends Sales/Finance as a secondary section so closing review is a
 * single document. Order:
 *
 *   Cover  — logo + shop name + date-range + tenant-tz generated stamp
 *   Box    — closing-summary callout (Revenue / Sold / Net stock / Voids)
 *   §1     — Stock Activity
 *              · 5-card KPI strip (Received / Baked / Sold / Damaged / FOC)
 *              · Most-moved items table
 *              · By Category drill-down table
 *              · Out of Stock drill-down table
 *   §2     — Sales / Finance Appendix (own page)
 *              · 6-card KPI strip (Revenue / Sales / Avg / Tax / Delivery / Voids)
 *              · Tender mix table
 *              · Mode mix table
 *              · Top items by revenue
 *              · Recent sales
 *
 * Page footer on every page: "Shop · Period · Page N of M".
 */

import { jsPDF } from 'jspdf';
import autoTable from 'jspdf-autotable';
import type { ReportPeriod, TransactionsReport, StockActivityReport } from '@/lib/repos/reports';
import { formatDateTimeInTz } from '@/lib/format/datetime';
import {
  BRAND_BROWN, fmtInt, fmtMmk, fmtQty,
  afterTable, sectionHeader, kpiStrip, pdfCoverHeader, pageFooters,
  closingSummaryCallout, sectionDivider,
} from './pdfShared';
import {
  toDisplayCategory,
  displayCategoryLabelEn,
  type DisplayCategory,
} from '@/lib/categories';
import type { ItemCategory } from '@/lib/repos/items';

const TENANT_TZ = 'Asia/Yangon';

interface Input {
  shopName: string;
  logoUrl: string | null;
  period: ReportPeriod;
  /** Pre-formatted date-range label, e.g. "21 – 27 Apr 2026". */
  periodLabel: string;
  transactions: TransactionsReport;
  stockActivity: StockActivityReport;
}

export async function generateStockLedgerPdf(input: Input): Promise<void> {
  const doc = new jsPDF({ orientation: 'portrait', unit: 'mm', format: 'a4' });

  // Generated-at pinned to tenant tz so two managers comparing the same
  // PDF read the same timestamp regardless of laptop time zone.
  const generatedAt = formatDateTimeInTz(new Date(), TENANT_TZ);

  let y = await pdfCoverHeader(doc, {
    shopName: input.shopName,
    reportTitle: 'Stock Ledger',
    periodLabel: input.periodLabel,
    generatedAt,
    logoUrl: input.logoUrl,
  });

  // ─── Closing-summary callout ────────────────────────────────────
  // Headline numbers above any section so the owner gets the gist on
  // page 1 before reading tables. Net stock = received + baked − sold.
  const sa = input.stockActivity;
  const tx = input.transactions;
  const netStock = (sa.summary.receivedQty + sa.summary.bakedQty) - sa.summary.soldQty;
  y = closingSummaryCallout(
    doc,
    [
      ['Revenue',     fmtMmk(tx.summary.revenue)],
      ['Sold (qty)',  fmtQty(sa.summary.soldQty)],
      ['Net stock',   fmtQty(netStock)],
      ['DMG + FOC',   fmtQty(sa.summary.damagedQty + sa.summary.focQty)],
    ],
    y,
  );

  // ─── §1. Stock Activity ─────────────────────────────────────────
  y = sectionHeader(doc, '1. Stock activity (baked goods)', y);

  y = kpiStrip(
    doc,
    [
      ['Received', fmtQty(sa.summary.receivedQty)],
      ['Baked',    fmtQty(sa.summary.bakedQty)],
      ['Sold',     fmtQty(sa.summary.soldQty)],
      ['Damaged',  fmtQty(sa.summary.damagedQty)],
      ['FOC',      fmtQty(sa.summary.focQty)],
    ],
    y,
  );
  y += 2;

  // BATCH-only note — same explanatory line as the on-screen tab.
  doc.setFont('helvetica', 'italic');
  doc.setFontSize(8);
  doc.setTextColor(120);
  doc.text(
    'Stock Activity counts BATCH (made-in-advance) items only — drinks are made to order.',
    14, y,
  );
  y += 5;

  // Most-moved items
  if (sa.topMoved.length > 0) {
    y = pageBreakIfNeeded(doc, y, 60);
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(10);
    doc.setTextColor(0);
    doc.text('Most-moved items', 14, y);
    y += 2;
    autoTable(doc, {
      startY: y,
      head: [['Item', 'Received', 'Baked', 'Sold', 'Net']],
      body: sa.topMoved.map((r) => [
        r.name,
        fmtQty(r.receivedQty),
        fmtQty(r.bakedQty),
        fmtQty(r.soldQty),
        fmtQty(r.netQty),
      ]),
      theme: 'striped',
      headStyles: { fillColor: BRAND_BROWN, textColor: 255, fontSize: 9 },
      bodyStyles: { fontSize: 9 },
      columnStyles: { 1: { halign: 'right' }, 2: { halign: 'right' }, 3: { halign: 'right' }, 4: { halign: 'right' } },
      margin: { left: 14, right: 14 },
    });
    y = afterTable(doc) + 6;
  }

  // By Category drill-down
  if (sa.fgByCategory.length > 0) {
    y = pageBreakIfNeeded(doc, y, 50);
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(10);
    doc.setTextColor(0);
    doc.text('By category', 14, y);
    y += 2;
    autoTable(doc, {
      startY: y,
      head: [['Category', 'Items', 'On hand']],
      body: sa.fgByCategory.map((r) => [
        // r.category is already a display-bucket value (consolidated in
        // lib/repos/reports.ts). humanizeCategory was for raw enums; this
        // PDF now mirrors the on-screen rolled-up labels directly.
        displayCategoryLabelEn(r.category as DisplayCategory),
        fmtInt(r.itemCount),
        fmtQty(r.onHandQty),
      ]),
      theme: 'striped',
      headStyles: { fillColor: BRAND_BROWN, textColor: 255, fontSize: 9 },
      bodyStyles: { fontSize: 9 },
      columnStyles: { 1: { halign: 'right' }, 2: { halign: 'right' } },
      margin: { left: 14, right: 14 },
    });
    y = afterTable(doc) + 6;
  }

  // Out of Stock drill-down — English-only. jsPDF's Helvetica has no
  // Myanmar codepage so rendering a bilingual cell (`name · nameLocal`)
  // produces garbled `B u t t e r  C a k e  · ;-:7` output for any row
  // whose nameLocal is set. Cashier sees both languages on /stocks; PDF
  // is for printing/email so English-only keeps it legible everywhere.
  if (sa.fgOutOfStock.length > 0) {
    y = pageBreakIfNeeded(doc, y, 50);
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(10);
    doc.setTextColor(0);
    doc.text(`Out of stock (${sa.fgOutOfStock.length})`, 14, y);
    y += 2;
    autoTable(doc, {
      startY: y,
      head: [['Item', 'Category']],
      body: sa.fgOutOfStock.map((r) => [
        r.name,
        // Out-of-stock list is per-item, not aggregated → r.category is the
        // raw enum. Roll up to display bucket for label consistency with
        // the By Category table above.
        displayCategoryLabelEn(toDisplayCategory(r.category as ItemCategory)),
      ]),
      theme: 'striped',
      headStyles: { fillColor: BRAND_BROWN, textColor: 255, fontSize: 9 },
      bodyStyles: { fontSize: 9 },
      margin: { left: 14, right: 14 },
    });
    y = afterTable(doc) + 6;
  }

  // ─── §2. Sales / Finance appendix ───────────────────────────────
  // Always start on a fresh page — this is "page two of the closing
  // doc," not a continuation of stock movement.
  doc.addPage();
  y = 20;
  y = sectionDivider(doc, y);
  y = sectionHeader(doc, '2. Sales & finance', y);

  y = kpiStrip(
    doc,
    [
      ['Revenue',  fmtMmk(tx.summary.revenue)],
      ['Sales',    fmtInt(tx.summary.saleCount)],
      ['Avg sale', fmtMmk(tx.summary.avgSale)],
      ['Tax',      fmtMmk(tx.summary.taxTotal)],
      ['Delivery', fmtMmk(tx.summary.deliveryFeeTotal)],
      ['Voids',    fmtInt(tx.summary.voidCount)],
    ],
    y,
  );
  y += 2;

  // Tender mix
  if (tx.tenderMix.length > 0) {
    y = pageBreakIfNeeded(doc, y, 40);
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(10);
    doc.setTextColor(0);
    doc.text('Tender mix', 14, y);
    y += 2;
    autoTable(doc, {
      startY: y,
      head: [['Tender', 'Count', 'Total']],
      body: tx.tenderMix.map((r) => [r.tenderType, fmtInt(r.count), fmtMmk(r.total)]),
      theme: 'striped',
      headStyles: { fillColor: BRAND_BROWN, textColor: 255, fontSize: 9 },
      bodyStyles: { fontSize: 9 },
      columnStyles: { 1: { halign: 'right' }, 2: { halign: 'right' } },
      margin: { left: 14, right: 14 },
    });
    y = afterTable(doc) + 6;
  }

  // Mode mix
  if (tx.modeMix.length > 0) {
    y = pageBreakIfNeeded(doc, y, 40);
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(10);
    doc.setTextColor(0);
    doc.text('Mode mix', 14, y);
    y += 2;
    autoTable(doc, {
      startY: y,
      head: [['Mode', 'Count', 'Total']],
      body: tx.modeMix.map((r) => [
        r.modeAtCreation === 'POS_PAUSED' ? 'POS only' : 'Full inventory',
        fmtInt(r.count),
        fmtMmk(r.total),
      ]),
      theme: 'striped',
      headStyles: { fillColor: BRAND_BROWN, textColor: 255, fontSize: 9 },
      bodyStyles: { fontSize: 9 },
      columnStyles: { 1: { halign: 'right' }, 2: { halign: 'right' } },
      margin: { left: 14, right: 14 },
    });
    y = afterTable(doc) + 6;
  }

  // Top items by revenue
  if (tx.topItems.length > 0) {
    y = pageBreakIfNeeded(doc, y, 60);
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(10);
    doc.setTextColor(0);
    doc.text('Top items by revenue', 14, y);
    y += 2;
    autoTable(doc, {
      startY: y,
      head: [['Item', 'Qty', 'Unit price', 'Revenue']],
      body: tx.topItems.map((r) => [
        r.name,
        fmtQty(r.qty),
        fmtMmk(r.unitPrice),
        fmtMmk(r.revenue),
      ]),
      theme: 'striped',
      headStyles: { fillColor: BRAND_BROWN, textColor: 255, fontSize: 9 },
      bodyStyles: { fontSize: 9 },
      columnStyles: { 1: { halign: 'right' }, 2: { halign: 'right' }, 3: { halign: 'right' } },
      margin: { left: 14, right: 14 },
    });
    y = afterTable(doc) + 6;
  }

  // Recent sales — formatted in tenant tz to match other PDF timestamps.
  if (tx.recentSales.length > 0) {
    y = pageBreakIfNeeded(doc, y, 70);
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(10);
    doc.setTextColor(0);
    doc.text(`Recent sales (up to ${tx.recentSales.length})`, 14, y);
    y += 2;
    autoTable(doc, {
      startY: y,
      head: [['Receipt', 'Time', 'Items', 'Tender', 'Status', 'Total']],
      body: tx.recentSales.map((r) => [
        r.receiptNumber,
        formatDateTimeInTz(r.createdAtIso, TENANT_TZ),
        String(r.itemCount),
        r.tenderType,
        r.status,
        fmtMmk(r.total),
      ]),
      theme: 'striped',
      headStyles: { fillColor: BRAND_BROWN, textColor: 255, fontSize: 9 },
      bodyStyles: { fontSize: 8 },
      columnStyles: { 2: { halign: 'right' }, 5: { halign: 'right' } },
      margin: { left: 14, right: 14 },
    });
    y = afterTable(doc) + 6;
  }

  // ─── Slip Details — per-receipt drill-down with line items ──────
  // Each completed sale gets its own header row (receipt # · date · total)
  // immediately followed by a small line-items table. Capped at 50 sales
  // upstream so the PDF stays a sane size on busy months. Defensive `?? []`
  // tolerates old fallback shapes that don't carry the field yet.
  const slips = tx.salesWithLines ?? [];
  if (slips.length > 0) {
    y = pageBreakIfNeeded(doc, y, 30);
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(11);
    doc.setTextColor(0);
    doc.text(`Slip details (${slips.length})`, 14, y);
    y += 5;

    for (const slip of slips) {
      y = pageBreakIfNeeded(doc, y, 30);
      // Slip header line — bold receipt # + date + total.
      doc.setFont('helvetica', 'bold');
      doc.setFontSize(9);
      doc.setTextColor(0);
      const headerLine = `${slip.receiptNumber}  ·  ${formatDateTimeInTz(slip.createdAtIso, TENANT_TZ)}  ·  ${slip.tenderType}  ·  Total ${fmtMmk(slip.total)}`;
      doc.text(headerLine, 14, y);
      y += 2;
      // Line items table immediately under the header.
      autoTable(doc, {
        startY: y,
        head: [['Item', 'Qty', 'Unit price', 'Line total']],
        body: slip.lines.map((ln) => [
          ln.name,
          fmtQty(ln.qty),
          fmtMmk(ln.unitPrice),
          fmtMmk(ln.lineTotal),
        ]),
        theme: 'plain',
        headStyles: { fillColor: [240, 240, 240], textColor: 60, fontSize: 8 },
        bodyStyles: { fontSize: 8 },
        columnStyles: { 1: { halign: 'right' }, 2: { halign: 'right' }, 3: { halign: 'right' } },
        margin: { left: 18, right: 14 },
      });
      y = afterTable(doc) + 4;
    }
  }

  // ─── DMG / FOC log — per-entry drill-down ───────────────────────
  // Mirrors the on-screen "Recent entries" panel inside the DMG dialog.
  // Aggregates over the report period; capped at 200 upstream. Defensive
  // `?? []` tolerates old fallback shapes.
  const adjustments = sa.adjustments ?? [];
  if (adjustments.length > 0) {
    y = pageBreakIfNeeded(doc, y, 60);
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(11);
    doc.setTextColor(0);
    doc.text(`DMG / FOC log (${adjustments.length})`, 14, y);
    y += 2;
    autoTable(doc, {
      startY: y,
      head: [['Time', 'Item', 'Type', 'Qty', 'Reason', 'By']],
      body: adjustments.map((r) => [
        formatDateTimeInTz(r.createdAtIso, TENANT_TZ),
        r.itemName,
        r.category,
        fmtQty(r.qty),
        [r.reason, r.note].filter(Boolean).join(' · ') || '—',
        r.byName ?? '—',
      ]),
      theme: 'striped',
      headStyles: { fillColor: BRAND_BROWN, textColor: 255, fontSize: 9 },
      bodyStyles: { fontSize: 8 },
      columnStyles: { 3: { halign: 'right' } },
      margin: { left: 14, right: 14 },
    });
  }

  // ─── Footers ────────────────────────────────────────────────────
  pageFooters(doc, input.shopName, input.periodLabel);

  const filename = `pae-ka-yauk-stock-ledger-${input.period}-${new Date().toISOString().slice(0, 10)}.pdf`;
  doc.save(filename);
}

/**
 * If `y + neededHeight` would overflow the printable area, push to a new
 * page. Avoids the awkward "table starts on this page, then immediately
 * breaks one row in" autoTable produces when content is too tall.
 */
function pageBreakIfNeeded(doc: jsPDF, y: number, neededHeight: number): number {
  const printableBottom = 280; // 297mm A4 − 17mm bottom margin
  if (y + neededHeight > printableBottom) {
    doc.addPage();
    return 20;
  }
  return y;
}
