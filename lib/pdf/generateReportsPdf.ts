import { jsPDF } from 'jspdf';
import autoTable from 'jspdf-autotable';
import type {
  ReportPeriod,
  TransactionsReport,
  StockActivityReport,
  InventorySnapshot,
} from '@/lib/repos/reports';

interface Input {
  shopName: string;
  period: ReportPeriod;
  periodLabel: string;
  generatedAt: string;
  transactions: TransactionsReport;
  stockActivity: StockActivityReport;
  inventory: InventorySnapshot;
}

const BRAND_BROWN: [number, number, number] = [139, 94, 52];   // matches --color-primary
const MUTED_GREY: [number, number, number] = [136, 136, 136];

const fmtInt = (n: number) => new Intl.NumberFormat('en-US').format(Math.round(n));
const fmtMmk = (n: number) => `${new Intl.NumberFormat('en-US').format(Math.round(n))} MMK`;
const fmtQty = (n: number) =>
  new Intl.NumberFormat('en-US', { maximumFractionDigits: 2 }).format(n);

function afterTable(doc: jsPDF): number {
  const lastY = (doc as jsPDF & { lastAutoTable?: { finalY?: number } }).lastAutoTable?.finalY;
  return typeof lastY === 'number' ? lastY : 0;
}

function sectionHeader(doc: jsPDF, title: string, y: number): number {
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(13);
  doc.setTextColor(0);
  doc.text(title, 14, y);
  doc.setDrawColor(BRAND_BROWN[0], BRAND_BROWN[1], BRAND_BROWN[2]);
  doc.setLineWidth(0.5);
  doc.line(14, y + 1.5, 196, y + 1.5);
  return y + 6;
}

function kpiStrip(doc: jsPDF, pairs: Array<[string, string]>, startY: number): number {
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

export function generateReportsPdf(input: Input): void {
  const doc = new jsPDF({ orientation: 'portrait', unit: 'mm', format: 'a4' });
  const pageWidth = doc.internal.pageSize.getWidth();

  // ─── Cover / header ──────────────────────────────────────────────
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(18);
  doc.setTextColor(BRAND_BROWN[0], BRAND_BROWN[1], BRAND_BROWN[2]);
  doc.text(input.shopName, 14, 20);

  doc.setFont('helvetica', 'normal');
  doc.setFontSize(10);
  doc.setTextColor(MUTED_GREY[0], MUTED_GREY[1], MUTED_GREY[2]);
  doc.text(`Operations report · ${input.periodLabel}`, 14, 26);
  doc.text(`Generated: ${input.generatedAt}`, 14, 31);

  let y = 40;

  // ─── 1. Transactions ─────────────────────────────────────────────
  y = sectionHeader(doc, '1. Transactions', y);

  const tx = input.transactions;
  y = kpiStrip(
    doc,
    [
      ['Revenue', fmtMmk(tx.summary.revenue)],
      ['Sales',   fmtInt(tx.summary.saleCount)],
      ['Avg sale', fmtMmk(tx.summary.avgSale)],
      ['Voids',   fmtInt(tx.summary.voidCount)],
    ],
    y
  );
  y += 2;

  if (tx.topItems.length > 0) {
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(10);
    doc.setTextColor(0);
    doc.text('Top items by revenue', 14, y);
    y += 2;
    autoTable(doc, {
      startY: y,
      head: [['Item', 'Qty', 'Revenue']],
      body: tx.topItems.map((r) => [r.name, fmtQty(r.qty), fmtMmk(r.revenue)]),
      theme: 'striped',
      headStyles: { fillColor: BRAND_BROWN, textColor: 255, fontSize: 9 },
      bodyStyles: { fontSize: 9 },
      columnStyles: {
        1: { halign: 'right' },
        2: { halign: 'right' },
      },
      margin: { left: 14, right: 14 },
    });
    y = afterTable(doc) + 6;
  }

  if (tx.recentSales.length > 0) {
    if (y > 230) { doc.addPage(); y = 20; }
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
        // PDF gets the same browser-tz format the on-screen table uses;
        // the user generated it on their device, so honoring their tz
        // is the right call.
        new Date(r.createdAtIso).toLocaleString(undefined, {
          year: 'numeric', month: '2-digit', day: '2-digit',
          hour: '2-digit', minute: '2-digit', hour12: false,
        }),
        String(r.itemCount),
        r.tenderType,
        r.status,
        fmtMmk(r.total),
      ]),
      theme: 'striped',
      headStyles: { fillColor: BRAND_BROWN, textColor: 255, fontSize: 9 },
      bodyStyles: { fontSize: 8 },
      columnStyles: {
        2: { halign: 'right' },
        5: { halign: 'right' },
      },
      margin: { left: 14, right: 14 },
    });
    y = afterTable(doc) + 6;
  } else {
    doc.setFont('helvetica', 'italic');
    doc.setFontSize(9);
    doc.setTextColor(MUTED_GREY[0], MUTED_GREY[1], MUTED_GREY[2]);
    doc.text('No sales in this period.', 14, y);
    y += 8;
  }

  // ─── 2. Stock activity ───────────────────────────────────────────
  doc.addPage();
  y = 20;
  y = sectionHeader(doc, '2. Stock activity', y);

  const sa = input.stockActivity;
  y = kpiStrip(
    doc,
    [
      ['Received',  fmtQty(sa.summary.receivedQty)],
      ['Baked',     fmtQty(sa.summary.bakedQty)],
      ['Sold',      fmtQty(sa.summary.soldQty)],
      ['Damaged',   fmtQty(sa.summary.damagedQty)],
    ],
    y
  );
  y = kpiStrip(
    doc,
    [
      ['Receive events',  fmtInt(sa.summary.receivedEvents)],
      ['Bake events',     fmtInt(sa.summary.bakedEvents)],
      ['FOC',             fmtQty(sa.summary.focQty)],
      ['', ''],
    ],
    y + 2
  );
  y += 2;

  if (sa.topMoved.length > 0) {
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
      columnStyles: {
        1: { halign: 'right' },
        2: { halign: 'right' },
        3: { halign: 'right' },
        4: { halign: 'right' },
      },
      margin: { left: 14, right: 14 },
    });
    y = afterTable(doc) + 6;
  } else {
    doc.setFont('helvetica', 'italic');
    doc.setFontSize(9);
    doc.setTextColor(MUTED_GREY[0], MUTED_GREY[1], MUTED_GREY[2]);
    doc.text('No stock movement in this period.', 14, y);
    y += 8;
  }

  // ─── 3. Inventory snapshot ───────────────────────────────────────
  doc.addPage();
  y = 20;
  y = sectionHeader(doc, '3. Inventory snapshot', y);

  const inv = input.inventory;
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(9);
  doc.setTextColor(MUTED_GREY[0], MUTED_GREY[1], MUTED_GREY[2]);
  doc.text(`As of: ${new Date(inv.asOf).toISOString().replace('T', ' ').slice(0, 16)} UTC`, 14, y);
  y += 4;

  y = kpiStrip(
    doc,
    [
      ['Materials',   fmtInt(inv.kpis.totalMaterials)],
      ['Stock value', fmtMmk(inv.kpis.stockValueMmk)],
      ['Low stock',   fmtInt(inv.kpis.lowStockCount)],
      ['Out',         fmtInt(inv.kpis.outOfStockCount)],
    ],
    y + 2
  );

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
      columnStyles: {
        1: { halign: 'right' },
        2: { halign: 'right' },
      },
      margin: { left: 14, right: 14 },
    });
    y = afterTable(doc) + 6;
  }

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
      columnStyles: {
        2: { halign: 'right' },
        3: { halign: 'right' },
      },
      margin: { left: 14, right: 14 },
    });
    y = afterTable(doc) + 6;
  }

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

  // ─── Page footers ────────────────────────────────────────────────
  const pageCount = doc.getNumberOfPages();
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(8);
  doc.setTextColor(MUTED_GREY[0], MUTED_GREY[1], MUTED_GREY[2]);
  for (let i = 1; i <= pageCount; i++) {
    doc.setPage(i);
    doc.text(
      `${input.shopName} · ${input.periodLabel} · Page ${i} of ${pageCount}`,
      pageWidth / 2,
      290,
      { align: 'center' }
    );
  }

  const filename = `pae-ka-yauk-report-${input.period}-${new Date().toISOString().slice(0, 10)}.pdf`;
  doc.save(filename);
}
