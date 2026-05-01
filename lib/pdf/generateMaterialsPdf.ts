/**
 * Materials PDF — raw-material inventory snapshot.
 * Owner uses this for procurement + storeroom review.
 *
 * Sections (in order):
 *   1. Inventory KPIs (Total / Stock value / Low / Out / Expiring)
 *   2. By category breakdown
 *   3. Out of stock list
 *   4. Low stock list
 *   5. Expiring ≤ 7 days list
 */

import { jsPDF } from 'jspdf';
import autoTable from 'jspdf-autotable';
import type { InventorySnapshot } from '@/lib/repos/reports';
import { formatDateTimeInTz } from '@/lib/format/datetime';
import {
  BRAND_BROWN, MUTED_GREY, fmtInt, fmtMmk, fmtQty,
  afterTable, sectionHeader, kpiStrip, pdfCoverHeader, pageFooters,
} from './pdfShared';

const TENANT_TZ = 'Asia/Yangon';

interface Input {
  shopName: string;
  logoUrl: string | null;
  /** Pre-formatted date-range label, e.g. "21 – 27 Apr 2026". */
  periodLabel: string;
  inventory: InventorySnapshot;
}

export async function generateMaterialsPdf(input: Input): Promise<void> {
  const doc = new jsPDF({ orientation: 'portrait', unit: 'mm', format: 'a4' });

  // Pinned to tenant tz so PDFs from two laptops in different time zones
  // read identical generated-at stamps.
  const generatedAt = formatDateTimeInTz(new Date(), TENANT_TZ);

  let y = await pdfCoverHeader(doc, {
    shopName: input.shopName,
    reportTitle: 'Materials',
    periodLabel: input.periodLabel,
    generatedAt,
    logoUrl: input.logoUrl,
  });

  // ─── 1. KPIs ─────────────────────────────────────────────────────
  y = sectionHeader(doc, 'Inventory snapshot', y);

  const inv = input.inventory;
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(9);
  doc.setTextColor(MUTED_GREY[0], MUTED_GREY[1], MUTED_GREY[2]);
  doc.text(`As of: ${formatDateTimeInTz(inv.asOf, TENANT_TZ)}`, 14, y);
  y += 4;

  y = kpiStrip(
    doc,
    [
      ['Materials',   fmtInt(inv.kpis.totalMaterials)],
      ['Stock value', fmtMmk(inv.kpis.stockValueMmk)],
      ['Low stock',   fmtInt(inv.kpis.lowStockCount)],
      ['Out',         fmtInt(inv.kpis.outOfStockCount)],
      ['Expiring',    fmtInt(inv.kpis.expiringSoonCount)],
    ],
    y + 2,
  );

  // ─── 2. By category ──────────────────────────────────────────────
  if (inv.byCategory.length > 0) {
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(10);
    doc.setTextColor(0);
    doc.text('By category', 14, y);
    y += 2;
    autoTable(doc, {
      startY: y,
      head: [['Category', 'Materials', 'Value']],
      body: inv.byCategory.map((r) => [
        r.category.replace(/_/g, ' '),
        fmtInt(r.materialCount),
        fmtMmk(r.valueMmk),
      ]),
      theme: 'striped',
      headStyles: { fillColor: BRAND_BROWN, textColor: 255, fontSize: 9 },
      bodyStyles: { fontSize: 9 },
      columnStyles: { 1: { halign: 'right' }, 2: { halign: 'right' } },
      margin: { left: 14, right: 14 },
    });
    y = afterTable(doc) + 6;
  }

  // ─── 3. Out of stock ─────────────────────────────────────────────
  if (inv.outOfStock.length > 0) {
    if (y > 230) { doc.addPage(); y = 20; }
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(10);
    doc.setTextColor(0);
    doc.text(`Out of stock (${inv.outOfStock.length})`, 14, y);
    y += 2;
    autoTable(doc, {
      startY: y,
      head: [['Material', 'Unit', 'Par']],
      body: inv.outOfStock.map((r) => [
        r.name,
        r.unit,
        r.parLevel != null ? fmtQty(r.parLevel) : '—',
      ]),
      theme: 'striped',
      headStyles: { fillColor: BRAND_BROWN, textColor: 255, fontSize: 9 },
      bodyStyles: { fontSize: 8 },
      columnStyles: { 2: { halign: 'right' } },
      margin: { left: 14, right: 14 },
    });
    y = afterTable(doc) + 6;
  }

  // ─── 4. Low stock ────────────────────────────────────────────────
  if (inv.lowStock.length > 0) {
    if (y > 230) { doc.addPage(); y = 20; }
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(10);
    doc.setTextColor(0);
    doc.text(`Low stock (${inv.lowStock.length})`, 14, y);
    y += 2;
    autoTable(doc, {
      startY: y,
      head: [['Material', 'Unit', 'On hand', 'Par']],
      body: inv.lowStock.map((r) => [
        r.name,
        r.unit,
        fmtQty(r.onHand),
        fmtQty(r.parLevel),
      ]),
      theme: 'striped',
      headStyles: { fillColor: BRAND_BROWN, textColor: 255, fontSize: 9 },
      bodyStyles: { fontSize: 8 },
      columnStyles: { 2: { halign: 'right' }, 3: { halign: 'right' } },
      margin: { left: 14, right: 14 },
    });
    y = afterTable(doc) + 6;
  }

  // ─── 5. Expiring ─────────────────────────────────────────────────
  if (inv.expiring.length > 0) {
    if (y > 230) { doc.addPage(); y = 20; }
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(10);
    doc.setTextColor(0);
    doc.text(`Expiring ≤ 7 days (${inv.expiring.length})`, 14, y);
    y += 2;
    autoTable(doc, {
      startY: y,
      head: [['Material', 'Qty', 'Unit', 'Expires']],
      body: inv.expiring.map((r) => [
        r.name,
        fmtQty(r.remainingQty),
        r.unit,
        r.expiryDate,
      ]),
      theme: 'striped',
      headStyles: { fillColor: BRAND_BROWN, textColor: 255, fontSize: 9 },
      bodyStyles: { fontSize: 8 },
      columnStyles: { 1: { halign: 'right' } },
      margin: { left: 14, right: 14 },
    });
  }

  pageFooters(doc, input.shopName, input.periodLabel);

  const filename = `pae-ka-yauk-materials-${new Date().toISOString().slice(0, 10)}.pdf`;
  doc.save(filename);
}
