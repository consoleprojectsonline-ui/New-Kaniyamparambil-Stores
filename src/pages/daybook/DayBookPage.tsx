import { useState, useEffect, useCallback, useMemo } from "react";
import {
  BookOpen,
  Plus,
  Search,
  Filter,
  Trash2,
  AlertTriangle,
  Check,
  Database,
  TrendingUp,
  TrendingDown,
  FileSpreadsheet,
  Eye,
  Download,
  Printer,
  X,
  Edit,
  Calendar,
  FileText,
} from "lucide-react";
import { supabase } from "@/lib/supabase";
import { formatCurrency } from "@/lib/utils";
import html2canvas from "html2canvas";
import { jsPDF } from "jspdf";

const DAYBOOK_STORE_DETAILS = {
  storeName: "NEW KANIYAMPARAMBIL STORES",
  location: "THOPRAMKUDY PO, THOPRAMKUDY, KERALA",
  gstin: "32AWJPJ1371N1ZE",
  phone: "9544363171",
} as const;

const DAYBOOK_FRAME_STYLE: Partial<CSSStyleDeclaration> = {
  position: "fixed",
  top: "0",
  left: "-20000px",
  width: "794px",
  height: "auto",
  minHeight: "400px",
  opacity: "0",
  pointerEvents: "none",
  border: "0",
  background: "transparent",
  overflow: "visible",
};

const generateTxId = () => `tx-${Date.now()}-${Math.floor(Math.random() * 1000)}`;
const LOCAL_STORAGE_KEY = "kaniyamparambil_daybook_entries";

type EntryType = "Income" | "Expense";
type EntryCategory = "General" | "Sales" | "Purchase" | "Other";
type EntrySource = "manual" | "sales" | "purchase";

interface ManualEntry {
  id?: string;
  entry_date: string;
  description: string;
  type: EntryType;
  category: EntryCategory;
  amount: number;
  payment_mode: string;
  source: EntrySource;
  reference_no?: string;
  notes?: string;
  created_at?: string;
}

interface DayBookRow {
  id: string;
  date: string;
  description: string;
  type: EntryType;
  amount: number;
  bill_total?: number;
  payment_mode: string;
  category: EntryCategory;
  source: EntrySource;
  reference_no?: string;
  editable: boolean;
}

function computeDayTotals(rows: DayBookRow[]) {
  const totalIncome = rows
    .filter((tx) => tx.type === "Income")
    .reduce((sum, tx) => sum + tx.amount, 0);
  const totalExpense = rows
    .filter((tx) => tx.type === "Expense")
    .reduce((sum, tx) => sum + tx.amount, 0);
  const salesTotal = rows
    .filter((tx) => tx.category === "Sales")
    .reduce((sum, tx) => sum + (tx.bill_total ?? 0), 0);
  const purchaseTotal = rows
    .filter((tx) => tx.category === "Purchase")
    .reduce((sum, tx) => sum + (tx.bill_total ?? 0), 0);
  return {
    totalIncome,
    totalExpense,
    netBalance: totalIncome - totalExpense,
    salesTotal,
    purchaseTotal,
  };
}

function saleToDayBookRow(sale: Record<string, unknown>): DayBookRow {
  const paymentAmount = Number(sale.payment_amount) || 0;
  const grandTotal = Number(sale.grand_total) || 0;
  const billDate = String(sale.bill_date ?? "").slice(0, 10);
  const isCredit = sale.payment_status === "Credit" && paymentAmount <= 0;

  return {
    id: `sale-${sale.bill_no}`,
    date: billDate,
    description: `Sales · ${sale.bill_no} · ${sale.customer_name}${isCredit ? " (Credit)" : ""}`,
    type: "Income",
    amount: paymentAmount,
    bill_total: grandTotal,
    payment_mode: String(sale.payment_mode ?? "Cash"),
    category: "Sales",
    source: "sales",
    reference_no: String(sale.bill_no ?? ""),
    editable: false,
  };
}

function purchaseToDayBookRow(purchase: Record<string, unknown>): DayBookRow {
  const paidAmount = Number(purchase.paid_amount) || 0;
  const netAmount = Number(purchase.net_amount) || 0;
  const entryDate = String(purchase.entry_date ?? purchase.invoice_date ?? "").slice(0, 10);
  const isPending = purchase.payment_status === "Pending" && paidAmount <= 0;

  return {
    id: `purchase-${purchase.invoice_no}`,
    date: entryDate,
    description: `Purchase · ${purchase.invoice_no} · ${purchase.supplier_name}${isPending ? " (Pending)" : ""}`,
    type: "Expense",
    amount: paidAmount,
    bill_total: netAmount,
    payment_mode: "Bank",
    category: "Purchase",
    source: "purchase",
    reference_no: String(purchase.invoice_no ?? ""),
    editable: false,
  };
}

function todayIso(): string {
  return new Date().toISOString().split("T")[0];
}

function isMissingTableError(error: { code?: string; message?: string }): boolean {
  const message = (error.message ?? "").toLowerCase();
  if (error.code === "PGRST205" || error.code === "42P01") return true;
  if (message.includes("could not find the table")) return true;
  if (message.includes("column") && message.includes("does not exist")) return false;
  return message.includes("relation") && message.includes("does not exist");
}

function normalizeManualRow(row: Record<string, unknown>): ManualEntry {
  return {
    id: row.id ? String(row.id) : undefined,
    entry_date: String(row.entry_date ?? row.date ?? todayIso()),
    description: String(row.description ?? ""),
    type: (row.type as EntryType) ?? "Income",
    category: (row.category as EntryCategory) ?? "General",
    amount: Number(row.amount) || 0,
    payment_mode: String(row.payment_mode ?? "Cash"),
    source: (row.source as EntrySource) ?? "manual",
    reference_no: row.reference_no ? String(row.reference_no) : undefined,
    notes: row.notes ? String(row.notes) : undefined,
    created_at: row.created_at ? String(row.created_at) : undefined,
  };
}

function manualToDayBookRow(entry: ManualEntry): DayBookRow {
  return {
    id: entry.id ?? generateTxId(),
    date: entry.entry_date,
    description: entry.description,
    type: entry.type,
    amount: entry.amount,
    payment_mode: entry.payment_mode,
    category: entry.category,
    source: entry.source,
    reference_no: entry.reference_no,
    editable: entry.source === "manual",
  };
}

function formatDisplayDate(value: string): string {
  const date = new Date(`${value}T00:00:00`);
  if (Number.isNaN(date.getTime())) return value;
  return new Intl.DateTimeFormat("en-IN", {
    weekday: "short",
    day: "2-digit",
    month: "short",
    year: "numeric",
  }).format(date);
}

function formatReportDate(value?: string): string {
  const date = value ? new Date(value) : new Date();
  if (Number.isNaN(date.getTime())) return "—";
  return new Intl.DateTimeFormat("en-GB", {
    day: "2-digit",
    month: "short",
    year: "numeric",
  }).format(date).replace(/ /g, "-");
}

function monthEnd(monthYm: string): string {
  const [year, month] = monthYm.split("-").map(Number);
  const d = new Date(year, month, 0);
  return `${year}-${String(month).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

function formatMonthLabel(monthYm: string): string {
  const [year, month] = monthYm.split("-");
  const d = new Date(Number(year), Number(month) - 1, 1);
  if (Number.isNaN(d.getTime())) return monthYm;
  return new Intl.DateTimeFormat("en-GB", { month: "long", year: "numeric" }).format(d);
}

type DayBookReportMode = "day" | "month" | "range" | "current";

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

interface DayBookStatementMeta {
  reportTitle: string;
  periodLabel: string;
  reportType: string;
  typeFilter: string;
  sourceFilter: string;
  searchQuery: string;
  generatedOn: string;
}

interface DayBookReportData {
  meta: DayBookStatementMeta;
  entries: DayBookRow[];
  totalIncome: number;
  totalExpense: number;
  netBalance: number;
  salesTotal: number;
  purchaseTotal: number;
}

type DayBookDocOptions = {
  autoPrint?: boolean;
  helperText?: string;
  renderMode?: "print" | "pdf";
  voucher?: DayBookRow;
};

function buildDayBookHtml(data: DayBookReportData, options: DayBookDocOptions = {}): string {
  const store = DAYBOOK_STORE_DETAILS;
  const isPdfMode = options.renderMode === "pdf";
  const isVoucher = Boolean(options.voucher);
  const voucher = options.voucher;
  const meta = data.meta;

  const rowMarkup = data.entries.map((entry, index) => `
    <tr>
      <td class="col-index">${index + 1}</td>
      <td class="col-date">${escapeHtml(formatReportDate(entry.date))}</td>
      <td class="col-source">${escapeHtml(entry.category)}</td>
      <td class="col-desc">${escapeHtml(entry.description)}</td>
      <td class="col-ref">${escapeHtml(entry.reference_no || "—")}</td>
      <td class="col-mode">${escapeHtml(entry.payment_mode)}</td>
      <td class="col-receipt align-right">${entry.type === "Income" ? escapeHtml(formatCurrency(entry.amount)) : "—"}</td>
      <td class="col-payment align-right">${entry.type === "Expense" ? escapeHtml(formatCurrency(entry.amount)) : "—"}</td>
      <td class="col-bill align-right">${entry.bill_total != null && entry.bill_total > 0 ? escapeHtml(formatCurrency(entry.bill_total)) : "—"}</td>
    </tr>
  `).join("");

  const voucherBody = voucher ? `
    <table class="voucher-table">
      <tr><td class="label">Voucher ID</td><td>${escapeHtml(voucher.id)}</td></tr>
      <tr><td class="label">Date</td><td>${escapeHtml(formatReportDate(voucher.date))}</td></tr>
      <tr><td class="label">Source</td><td>${escapeHtml(voucher.category)}</td></tr>
      <tr><td class="label">Reference</td><td>${escapeHtml(voucher.reference_no || "—")}</td></tr>
      <tr><td class="label">Description</td><td>${escapeHtml(voucher.description)}</td></tr>
      <tr><td class="label">Type</td><td>${escapeHtml(voucher.type)}</td></tr>
      <tr><td class="label">Payment Mode</td><td>${escapeHtml(voucher.payment_mode)}</td></tr>
      <tr><td class="label">Cash Amount</td><td class="amount">${escapeHtml(formatCurrency(voucher.amount))}</td></tr>
      ${voucher.bill_total != null && voucher.bill_total > 0 ? `<tr><td class="label">Bill Total</td><td class="amount">${escapeHtml(formatCurrency(voucher.bill_total))}</td></tr>` : ""}
    </table>
  ` : "";

  return `<!DOCTYPE html>
  <html lang="en">
    <head>
      <meta charset="UTF-8" />
      <title>${escapeHtml(isVoucher ? "Day Book Voucher" : meta.reportTitle)}</title>
      <style>
        * { box-sizing: border-box; }
        body {
          margin: 0;
          background: ${isPdfMode ? "#fff" : "#f3f4f6"};
          font-family: Arial, Helvetica, sans-serif;
          color: #111;
          font-size: ${isPdfMode ? "7.5px" : "11px"};
          line-height: 1.28;
          padding: ${isPdfMode ? "0" : "20px"};
        }
        .daybook-toolbar {
          width: ${isPdfMode ? "794px" : "860px"};
          margin: 0 auto 12px;
          padding: 12px 16px;
          border: 1px solid #ccc;
          background: #fff;
          display: ${isPdfMode ? "none" : "flex"};
          align-items: center;
          justify-content: space-between;
          gap: 12px;
        }
        .toolbar-text { margin: 0; color: #555; font-size: 12px; }
        .toolbar-actions { display: flex; gap: 8px; }
        .toolbar-btn {
          border: 1px solid #ccc;
          border-radius: 4px;
          padding: 8px 14px;
          font-family: inherit;
          font-size: 12px;
          font-weight: 600;
          cursor: pointer;
          background: #fff;
        }
        .toolbar-btn.primary { background: #b45309; color: #fff; border-color: #b45309; }
        .daybook-sheet {
          width: ${isPdfMode ? "794px" : "860px"};
          margin: 0 auto;
          background: #fff;
          border: 1px solid #000;
        }
        .doc-title {
          text-align: center;
          font-size: ${isPdfMode ? "13px" : "16px"};
          font-weight: 700;
          color: #b45309;
          letter-spacing: 0.05em;
          padding: ${isPdfMode ? "7px 8px" : "10px"};
          border-bottom: 1px solid #000;
        }
        .period-banner {
          text-align: center;
          font-weight: 700;
          padding: ${isPdfMode ? "5px 8px" : "8px 12px"};
          border-bottom: 1px solid #000;
          background: #fef3c7;
          font-size: ${isPdfMode ? "9px" : "12px"};
        }
        .meta-grid {
          display: grid;
          grid-template-columns: 1fr 1fr 1fr;
          border-bottom: 1px solid #000;
        }
        .meta-grid > div {
          padding: ${isPdfMode ? "5px 7px" : "8px 10px"};
          border-right: 1px solid #000;
        }
        .meta-grid > div:last-child { border-right: none; }
        .meta-label { font-weight: 700; margin-bottom: 2px; font-size: ${isPdfMode ? "7.5px" : "10px"}; text-transform: uppercase; }
        .meta-line { margin-bottom: 1px; }
        .statement-table {
          width: 100%;
          border-collapse: collapse;
        }
        .statement-table th,
        .statement-table td {
          border: 1px solid #000;
          padding: ${isPdfMode ? "2px 3px" : "4px 5px"};
          vertical-align: top;
        }
        .statement-table thead th {
          background: #fef3c7;
          font-weight: 700;
          text-align: center;
        }
        .col-index { width: 20px; text-align: center; }
        .col-date { width: 52px; text-align: center; white-space: nowrap; }
        .col-source { width: 48px; text-align: center; }
        .col-ref { width: 56px; text-align: center; font-family: monospace; font-size: ${isPdfMode ? "7px" : "10px"}; }
        .col-mode { width: 44px; text-align: center; }
        .col-desc { min-width: 90px; }
        .col-receipt, .col-payment, .col-bill { width: 52px; white-space: nowrap; }
        .align-right { text-align: right; }
        .summary-grid {
          display: grid;
          grid-template-columns: 1fr 1fr 1fr 1fr;
          border-top: 1px solid #000;
        }
        .summary-box {
          padding: ${isPdfMode ? "5px 7px" : "8px 10px"};
          border-right: 1px solid #000;
          font-weight: 600;
        }
        .summary-box:last-child { border-right: none; }
        .summary-box b { display: block; font-size: ${isPdfMode ? "9px" : "12px"}; margin-top: 2px; }
        .net-balance-row {
          border-top: 1px solid #000;
          padding: ${isPdfMode ? "5px 7px" : "8px 10px"};
          font-weight: 700;
          display: flex;
          justify-content: space-between;
          gap: 12px;
          background: #fffbeb;
        }
        .voucher-meta {
          padding: ${isPdfMode ? "6px 8px" : "10px 12px"};
          border-bottom: 1px solid #000;
          font-size: ${isPdfMode ? "8px" : "11px"};
        }
        .voucher-table {
          width: 100%;
          border-collapse: collapse;
        }
        .voucher-table td {
          border: 1px solid #000;
          padding: ${isPdfMode ? "5px 7px" : "8px 10px"};
        }
        .voucher-table .label {
          width: 34%;
          font-weight: 700;
          background: #fef3c7;
        }
        .voucher-table .amount {
          font-weight: 700;
          font-size: ${isPdfMode ? "10px" : "13px"};
        }
        .footer-note {
          border-top: 1px solid #000;
          padding: ${isPdfMode ? "5px 7px" : "8px 10px"};
          font-size: ${isPdfMode ? "7.5px" : "10px"};
          color: #444;
        }
        .signatory {
          border-top: 1px solid #000;
          padding: ${isPdfMode ? "6px 8px" : "10px 12px"};
          text-align: right;
          font-weight: 700;
          font-size: ${isPdfMode ? "8px" : "11px"};
        }
        @page { size: A4 landscape; margin: 8mm; }
        @media print {
          body { background: #fff; padding: 0; }
          .daybook-toolbar { display: none; }
          .daybook-sheet { width: 100%; border: none; }
        }
      </style>
    </head>
    <body>
      <div class="daybook-toolbar">
        <p class="toolbar-text">${escapeHtml(options.helperText || "Use Print / Save as PDF from your browser.")}</p>
        <div class="toolbar-actions">
          <button class="toolbar-btn" onclick="window.close()">Close</button>
          <button class="toolbar-btn primary" onclick="window.print()">Print / Save PDF</button>
        </div>
      </div>

      <div class="daybook-sheet">
        <div class="doc-title">${escapeHtml(isVoucher ? "DAY BOOK VOUCHER" : meta.reportTitle)}</div>
        ${isVoucher ? `
          <div class="period-banner">Voucher Date: ${escapeHtml(formatReportDate(voucher!.date))}</div>
          <div class="meta-grid">
            <div>
              <div class="meta-label">${escapeHtml(store.storeName)}</div>
              <div class="meta-line">${escapeHtml(store.location)}</div>
              <div class="meta-line"><b>GSTIN:</b> ${escapeHtml(store.gstin)}</div>
              <div class="meta-line"><b>Phone:</b> ${escapeHtml(store.phone)}</div>
            </div>
            <div>
              <div class="meta-label">Voucher Details</div>
              <div class="meta-line"><b>Source:</b> ${escapeHtml(voucher!.category)}</div>
              <div class="meta-line"><b>Ref:</b> ${escapeHtml(voucher!.reference_no || "—")}</div>
              <div class="meta-line"><b>Mode:</b> ${escapeHtml(voucher!.payment_mode)}</div>
            </div>
            <div>
              <div class="meta-label">Generated</div>
              <div class="meta-line"><b>Date:</b> ${escapeHtml(meta.generatedOn)}</div>
              <div class="meta-line"><b>Type:</b> ${escapeHtml(voucher!.type)}</div>
            </div>
          </div>
          <div class="voucher-meta">Single voucher copy — internal cash book record, not a tax invoice</div>
          ${voucherBody}
        ` : `
          <div class="period-banner">Statement Period: ${escapeHtml(meta.periodLabel)}</div>

          <div class="meta-grid">
            <div>
              <div class="meta-label">${escapeHtml(store.storeName)}</div>
              <div class="meta-line">${escapeHtml(store.location)}</div>
              <div class="meta-line"><b>GSTIN:</b> ${escapeHtml(store.gstin)}</div>
              <div class="meta-line"><b>Phone:</b> ${escapeHtml(store.phone)}</div>
            </div>
            <div>
              <div class="meta-label">Report Details</div>
              <div class="meta-line"><b>Type:</b> ${escapeHtml(meta.reportType)}</div>
              <div class="meta-line"><b>Type Filter:</b> ${escapeHtml(meta.typeFilter)}</div>
              <div class="meta-line"><b>Source Filter:</b> ${escapeHtml(meta.sourceFilter)}</div>
              <div class="meta-line"><b>Search:</b> ${escapeHtml(meta.searchQuery || "—")}</div>
            </div>
            <div>
              <div class="meta-label">Generated</div>
              <div class="meta-line"><b>Date:</b> ${escapeHtml(meta.generatedOn)}</div>
              <div class="meta-line"><b>Entries:</b> ${data.entries.length}</div>
            </div>
          </div>

          <table class="statement-table">
            <thead>
              <tr>
                <th>#</th>
                <th>Date</th>
                <th>Source</th>
                <th>Description</th>
                <th>Ref</th>
                <th>Mode</th>
                <th>Receipt (₹)</th>
                <th>Payment (₹)</th>
                <th>Bill Amt (₹)</th>
              </tr>
            </thead>
            <tbody>
              ${rowMarkup || `<tr><td colspan="9" style="text-align:center;padding:12px;">No entries for this statement period.</td></tr>`}
            </tbody>
          </table>

          <div class="summary-grid">
            <div class="summary-box">Total Receipts (Cash In)<b>${escapeHtml(formatCurrency(data.totalIncome))}</b></div>
            <div class="summary-box">Total Payments (Cash Out)<b>${escapeHtml(formatCurrency(data.totalExpense))}</b></div>
            <div class="summary-box">Sales Bills<b>${escapeHtml(formatCurrency(data.salesTotal))}</b></div>
            <div class="summary-box">Purchase Bills<b>${escapeHtml(formatCurrency(data.purchaseTotal))}</b></div>
          </div>
          <div class="net-balance-row">
            <span>Closing Balance (Net)</span>
            <span>${escapeHtml(formatCurrency(data.netBalance))}</span>
          </div>
        `}

        <div class="footer-note">
          ${isVoucher
    ? "Computer-generated day book voucher. Receipts and payments reflect actual cash movement; bill amounts are shown for sales and purchase references."
    : "Day book statement lists daily receipts, payments, and linked sales/purchase bill values. Cash columns show amounts actually received or paid."}
        </div>

        <div class="signatory">
          <div>${escapeHtml(store.storeName)}</div>
          <div>Authorized Cash Book Signatory</div>
        </div>
      </div>

      <script>
        ${options.autoPrint ? "window.addEventListener('load', () => { setTimeout(() => window.print(), 250); });" : ""}
      </script>
    </body>
  </html>`;
}

async function waitForDayBookFrame(html: string): Promise<HTMLIFrameElement> {
  const iframe = document.createElement("iframe");
  Object.assign(iframe.style, DAYBOOK_FRAME_STYLE);
  iframe.setAttribute("aria-hidden", "true");
  document.body.appendChild(iframe);

  const frameDocument = iframe.contentDocument;
  if (!frameDocument) {
    iframe.remove();
    throw new Error("Unable to prepare the day book document.");
  }

  frameDocument.open();
  frameDocument.write(html);
  frameDocument.close();

  await new Promise<void>((resolve, reject) => {
    const startedAt = Date.now();
    const checkReady = () => {
      const readyState = iframe.contentDocument?.readyState;
      if (readyState === "interactive" || readyState === "complete") {
        resolve();
        return;
      }
      if (Date.now() - startedAt > 5000) {
        reject(new Error("Day book preview took too long to load."));
        return;
      }
      window.setTimeout(checkReady, 50);
    };
    checkReady();
  });

  const sheet = iframe.contentDocument?.querySelector(".daybook-sheet");
  if (sheet instanceof HTMLElement) {
    iframe.style.height = `${sheet.scrollHeight + 40}px`;
  }

  await new Promise((resolve) => window.setTimeout(resolve, 120));
  return iframe;
}

async function exportDayBookPdf(html: string, filename: string): Promise<void> {
  let iframe: HTMLIFrameElement | null = null;
  try {
    iframe = await waitForDayBookFrame(html);
    const sheet = iframe.contentDocument?.querySelector(".daybook-sheet");
    if (!(sheet instanceof HTMLElement)) {
      throw new Error("Unable to prepare the day book layout for PDF export.");
    }

    const canvas = await html2canvas(sheet, {
      scale: 2,
      useCORS: true,
      backgroundColor: "#ffffff",
    });

    const pdf = new jsPDF({ orientation: "portrait", unit: "pt", format: "a4" });
    const pageWidth = pdf.internal.pageSize.getWidth();
    const pageHeight = pdf.internal.pageSize.getHeight();
    const margin = 12;
    const imgWidth = pageWidth - margin * 2;
    const imgHeight = (canvas.height * imgWidth) / canvas.width;
    const imgData = canvas.toDataURL("image/png");
    let heightLeft = imgHeight;
    let position = margin;

    pdf.addImage(imgData, "PNG", margin, position, imgWidth, imgHeight);
    heightLeft -= pageHeight - margin * 2;

    while (heightLeft > 0) {
      pdf.addPage();
      position = margin - (imgHeight - heightLeft);
      pdf.addImage(imgData, "PNG", margin, position, imgWidth, imgHeight);
      heightLeft -= pageHeight - margin * 2;
    }

    pdf.save(filename);
  } finally {
    iframe?.remove();
  }
}

async function printDayBookHtml(html: string): Promise<void> {
  let iframe: HTMLIFrameElement | null = null;
  try {
    iframe = await waitForDayBookFrame(html);
    const printWindow = iframe.contentWindow;
    if (!printWindow) throw new Error("Unable to open the print dialog.");
    printWindow.focus();
    printWindow.print();
  } finally {
    window.setTimeout(() => iframe?.remove(), 1200);
  }
}

function buildDayBookStatementData(
  entries: DayBookRow[],
  meta: Pick<DayBookStatementMeta, "periodLabel" | "reportType"> & Partial<DayBookStatementMeta>,
  totals?: ReturnType<typeof computeDayTotals>,
): DayBookReportData {
  const computed = totals ?? computeDayTotals(entries);
  return {
    meta: {
      reportTitle: "DAY BOOK / CASH BOOK STATEMENT",
      typeFilter: "All",
      sourceFilter: "All",
      searchQuery: "—",
      generatedOn: formatReportDate(),
      ...meta,
    },
    entries,
    ...computed,
  };
}

function mergeDayBookRows(
  salesRows: DayBookRow[],
  purchaseRows: DayBookRow[],
  manualRows: DayBookRow[],
): DayBookRow[] {
  return [...salesRows, ...purchaseRows, ...manualRows].sort((a, b) => {
    const dateDiff = a.date.localeCompare(b.date);
    if (dateDiff !== 0) return dateDiff;
    const categoryOrder = { Sales: 0, Purchase: 1, General: 2, Other: 3 };
    const orderDiff = categoryOrder[a.category] - categoryOrder[b.category];
    if (orderDiff !== 0) return orderDiff;
    return a.description.localeCompare(b.description);
  });
}

export default function DayBookPage() {
  const [manualEntries, setManualEntries] = useState<ManualEntry[]>([]);
  const [dayBookRows, setDayBookRows] = useState<DayBookRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [isFormOpen, setIsFormOpen] = useState(false);
  const [dbStatus, setDbStatus] = useState<"connected" | "local">("connected");
  const [editingTransaction, setEditingTransaction] = useState<ManualEntry | null>(null);
  const [selectedDate, setSelectedDate] = useState(todayIso);

  // Search & Filters
  const [searchQuery, setSearchQuery] = useState("");
  const [typeFilter, setTypeFilter] = useState("All");
  const [sourceFilter, setSourceFilter] = useState("All");
  const [currentPage, setCurrentPage] = useState(1);
  const itemsPerPage = 10;

  // Reset pagination to page 1 on search or filter change
  useEffect(() => {
    const timer = setTimeout(() => {
      setCurrentPage(1);
    }, 0);
    return () => clearTimeout(timer);
  }, [searchQuery, typeFilter, sourceFilter, selectedDate]);

  // Form states
  const [description, setDescription] = useState("");
  const [type, setType] = useState("Income");
  const [amount, setAmount] = useState("");
  const [paymentMode, setPaymentMode] = useState("Cash");
  const [date, setDate] = useState(todayIso());

  const [formError, setFormError] = useState<string | null>(null);
  const [successMsg, setSuccessMsg] = useState<string | null>(null);

  const [viewingTransaction, setViewingTransaction] = useState<DayBookRow | null>(null);

  const [isReportModalOpen, setIsReportModalOpen] = useState(false);
  const [reportMode, setReportMode] = useState<DayBookReportMode>("day");
  const [reportDate, setReportDate] = useState(todayIso());
  const [reportMonth, setReportMonth] = useState(todayIso().slice(0, 7));
  const [reportFrom, setReportFrom] = useState(`${todayIso().slice(0, 7)}-01`);
  const [reportTo, setReportTo] = useState(todayIso());
  const [reportError, setReportError] = useState<string | null>(null);
  const [reportBusy, setReportBusy] = useState(false);

  const loadLocalManualEntriesRange = useCallback((from: string, to: string) => {
    const local = localStorage.getItem(LOCAL_STORAGE_KEY);
    if (local) {
      try {
        const parsed = JSON.parse(local) as Record<string, unknown>[];
        return parsed
          .map(normalizeManualRow)
          .filter((entry) => entry.entry_date >= from && entry.entry_date <= to);
      } catch {
        return [];
      }
    }
    return [];
  }, []);

  const loadLocalManualEntries = useCallback((forDate: string) => {
    return loadLocalManualEntriesRange(forDate, forDate);
  }, [loadLocalManualEntriesRange]);

  const saveLocalManualEntries = useCallback((allEntries: ManualEntry[]) => {
    localStorage.setItem(LOCAL_STORAGE_KEY, JSON.stringify(allEntries));
  }, []);

  const fetchManualEntries = useCallback(async (forDate: string): Promise<ManualEntry[]> => {
    const daybookResult = await supabase
      .from("daybook_entries")
      .select("*")
      .eq("entry_date", forDate)
      .eq("source", "manual")
      .order("created_at", { ascending: false });

    if (!daybookResult.error && daybookResult.data) {
      return daybookResult.data.map((row) => normalizeManualRow(row as Record<string, unknown>));
    }

    if (daybookResult.error && !isMissingTableError(daybookResult.error)) {
      throw daybookResult.error;
    }

    const legacyResult = await supabase
      .from("transactions")
      .select("*")
      .eq("date", forDate)
      .order("created_at", { ascending: false });

    if (!legacyResult.error && legacyResult.data) {
      return legacyResult.data.map((row) => normalizeManualRow(row as Record<string, unknown>));
    }

    if (legacyResult.error && !isMissingTableError(legacyResult.error)) {
      throw legacyResult.error;
    }

    return [];
  }, []);

  const fetchManualEntriesRange = useCallback(async (from: string, to: string): Promise<ManualEntry[]> => {
    const daybookResult = await supabase
      .from("daybook_entries")
      .select("*")
      .gte("entry_date", from)
      .lte("entry_date", to)
      .eq("source", "manual")
      .order("entry_date", { ascending: true });

    if (!daybookResult.error && daybookResult.data) {
      return daybookResult.data.map((row) => normalizeManualRow(row as Record<string, unknown>));
    }

    if (daybookResult.error && !isMissingTableError(daybookResult.error)) {
      throw daybookResult.error;
    }

    const legacyResult = await supabase
      .from("transactions")
      .select("*")
      .gte("date", from)
      .lte("date", to)
      .order("date", { ascending: true });

    if (!legacyResult.error && legacyResult.data) {
      return legacyResult.data.map((row) => normalizeManualRow(row as Record<string, unknown>));
    }

    if (legacyResult.error && !isMissingTableError(legacyResult.error)) {
      throw legacyResult.error;
    }

    return [];
  }, []);

  const fetchSalesRows = useCallback(async (forDate: string): Promise<DayBookRow[]> => {
    const { data, error } = await supabase
      .from("sales")
      .select("bill_no, bill_date, customer_name, payment_amount, grand_total, payment_mode, payment_status")
      .eq("bill_date", forDate)
      .order("created_at", { ascending: false });

    if (error) {
      if (!isMissingTableError(error)) console.error("Day book sales load error:", error);
      return [];
    }

    return (data ?? []).map((sale) => saleToDayBookRow(sale as Record<string, unknown>));
  }, []);

  const fetchSalesRowsRange = useCallback(async (from: string, to: string): Promise<DayBookRow[]> => {
    const { data, error } = await supabase
      .from("sales")
      .select("bill_no, bill_date, customer_name, payment_amount, grand_total, payment_mode, payment_status")
      .gte("bill_date", from)
      .lte("bill_date", to)
      .order("bill_date", { ascending: true });

    if (error) {
      if (!isMissingTableError(error)) console.error("Day book sales range load error:", error);
      return [];
    }

    return (data ?? []).map((sale) => saleToDayBookRow(sale as Record<string, unknown>));
  }, []);

  const fetchPurchaseRows = useCallback(async (forDate: string): Promise<DayBookRow[]> => {
    const { data, error } = await supabase
      .from("purchases")
      .select("invoice_no, entry_date, supplier_name, paid_amount, net_amount, payment_status")
      .eq("entry_date", forDate)
      .order("created_at", { ascending: false });

    if (error) {
      if (!isMissingTableError(error)) console.error("Day book purchases load error:", error);
      return [];
    }

    return (data ?? []).map((purchase) => purchaseToDayBookRow(purchase as Record<string, unknown>));
  }, []);

  const fetchPurchaseRowsRange = useCallback(async (from: string, to: string): Promise<DayBookRow[]> => {
    const { data, error } = await supabase
      .from("purchases")
      .select("invoice_no, entry_date, supplier_name, paid_amount, net_amount, payment_status")
      .gte("entry_date", from)
      .lte("entry_date", to)
      .order("entry_date", { ascending: true });

    if (error) {
      if (!isMissingTableError(error)) console.error("Day book purchases range load error:", error);
      return [];
    }

    return (data ?? []).map((purchase) => purchaseToDayBookRow(purchase as Record<string, unknown>));
  }, []);

  const loadLocalSalesRowsRange = useCallback((from: string, to: string): DayBookRow[] => {
    const local = localStorage.getItem("kaniyamparambil_sales_v2");
    if (!local) return [];
    try {
      return (JSON.parse(local) as Record<string, unknown>[])
        .filter((sale) => {
          const billDate = String(sale.bill_date ?? "").slice(0, 10);
          return billDate >= from && billDate <= to;
        })
        .map(saleToDayBookRow);
    } catch {
      return [];
    }
  }, []);

  const loadLocalSalesRows = useCallback((forDate: string): DayBookRow[] => {
    return loadLocalSalesRowsRange(forDate, forDate);
  }, [loadLocalSalesRowsRange]);

  const loadLocalPurchaseRowsRange = useCallback((from: string, to: string): DayBookRow[] => {
    const local = localStorage.getItem("kaniyamparambil_purchases");
    if (!local) return [];
    try {
      return (JSON.parse(local) as Record<string, unknown>[])
        .filter((purchase) => {
          const entryDate = String(purchase.entry_date ?? purchase.invoice_date ?? "").slice(0, 10);
          return entryDate >= from && entryDate <= to;
        })
        .map(purchaseToDayBookRow);
    } catch {
      return [];
    }
  }, []);

  const loadLocalPurchaseRows = useCallback((forDate: string): DayBookRow[] => {
    return loadLocalPurchaseRowsRange(forDate, forDate);
  }, [loadLocalPurchaseRowsRange]);

  const fetchDayBook = useCallback(async (forDate: string) => {
    try {
      setLoading(true);

      let manual: ManualEntry[] = [];
      let usingLocal = false;

      try {
        manual = await fetchManualEntries(forDate);
        setDbStatus("connected");
      } catch (err) {
        console.error("Supabase daybook manual load error:", err);
        usingLocal = true;
        manual = loadLocalManualEntries(forDate);
        setDbStatus("local");
      }

      if (!usingLocal && manual.length === 0) {
        const probe = await supabase.from("daybook_entries").select("id").limit(1);
        const legacyProbe = await supabase.from("transactions").select("id").limit(1);
        if (
          (probe.error && isMissingTableError(probe.error)) &&
          (legacyProbe.error && isMissingTableError(legacyProbe.error))
        ) {
          usingLocal = true;
          manual = loadLocalManualEntries(forDate);
          setDbStatus("local");
        }
      }

      const [salesRows, purchaseRows] = usingLocal
        ? [loadLocalSalesRows(forDate), loadLocalPurchaseRows(forDate)]
        : await Promise.all([fetchSalesRows(forDate), fetchPurchaseRows(forDate)]);

      const manualRows = manual.map(manualToDayBookRow);
      const merged = mergeDayBookRows(salesRows, purchaseRows, manualRows);

      setManualEntries(manual);
      setDayBookRows(merged);
    } catch (err) {
      console.error("Failed to load day book:", err);
      setDbStatus("local");
      const manual = loadLocalManualEntries(forDate);
      setManualEntries(manual);
      setDayBookRows(mergeDayBookRows(
        loadLocalSalesRows(forDate),
        loadLocalPurchaseRows(forDate),
        manual.map(manualToDayBookRow),
      ));
    } finally {
      setLoading(false);
    }
  }, [fetchManualEntries, fetchPurchaseRows, fetchSalesRows, loadLocalManualEntries, loadLocalPurchaseRows, loadLocalSalesRows]);

  const fetchDayBookRowsForPeriod = useCallback(async (from: string, to: string): Promise<DayBookRow[]> => {
    if (dbStatus === "local") {
      return mergeDayBookRows(
        loadLocalSalesRowsRange(from, to),
        loadLocalPurchaseRowsRange(from, to),
        loadLocalManualEntriesRange(from, to).map(manualToDayBookRow),
      );
    }

    try {
      const [manual, salesRows, purchaseRows] = await Promise.all([
        fetchManualEntriesRange(from, to),
        fetchSalesRowsRange(from, to),
        fetchPurchaseRowsRange(from, to),
      ]);
      return mergeDayBookRows(salesRows, purchaseRows, manual.map(manualToDayBookRow));
    } catch (err) {
      console.error("Day book range load error:", err);
      return mergeDayBookRows(
        loadLocalSalesRowsRange(from, to),
        loadLocalPurchaseRowsRange(from, to),
        loadLocalManualEntriesRange(from, to).map(manualToDayBookRow),
      );
    }
  }, [
    dbStatus,
    fetchManualEntriesRange,
    fetchPurchaseRowsRange,
    fetchSalesRowsRange,
    loadLocalManualEntriesRange,
    loadLocalPurchaseRowsRange,
    loadLocalSalesRowsRange,
  ]);

  useEffect(() => {
    const timer = setTimeout(() => {
      fetchDayBook(selectedDate);
    }, 0);
    return () => clearTimeout(timer);
  }, [fetchDayBook, selectedDate]);

  const handleSubmitForm = async (e: React.FormEvent) => {
    e.preventDefault();
    setFormError(null);
    setSuccessMsg(null);

    if (!description.trim() || !amount) {
      setFormError("Description and Amount are required.");
      return;
    }

    const txAmount = Number(amount);
    if (isNaN(txAmount) || txAmount <= 0) {
      setFormError("Amount must be a positive number.");
      return;
    }

    const newTx: ManualEntry = {
      entry_date: date,
      description: description.trim(),
      type: type as EntryType,
      category: "General",
      amount: txAmount,
      payment_mode: paymentMode,
      source: "manual",
    };

    if (editingTransaction) {
      if (dbStatus === "connected") {
        try {
          const payload = {
            entry_date: newTx.entry_date,
            description: newTx.description,
            type: newTx.type,
            category: newTx.category,
            amount: newTx.amount,
            payment_mode: newTx.payment_mode,
            source: "manual",
          };

          let error = (await supabase.from("daybook_entries").update(payload).eq("id", editingTransaction.id)).error;
          if (error && isMissingTableError(error)) {
            error = (await supabase.from("transactions").update({
              date: newTx.entry_date,
              description: newTx.description,
              type: newTx.type,
              amount: newTx.amount,
              payment_mode: newTx.payment_mode,
            }).eq("id", editingTransaction.id)).error;
          }
          if (error) throw error;

          setSuccessMsg(`Successfully updated transaction: "${newTx.description}"!`);
          fetchDayBook(selectedDate);
          resetForm();
        } catch (err) {
          console.error("Failed to update transaction:", err);
          const errMsg = err instanceof Error ? err.message : "Could not update transaction.";
          setFormError(`Supabase error: ${errMsg}`);
        }
      } else {
        const local = localStorage.getItem(LOCAL_STORAGE_KEY);
        const allEntries = local ? (JSON.parse(local) as ManualEntry[]) : [];
        const updated = allEntries.map((tx) =>
          tx.id === editingTransaction.id ? { ...newTx, id: tx.id } : tx,
        );
        saveLocalManualEntries(updated);
        fetchDayBook(selectedDate);
        setSuccessMsg("Updated transaction in Local Storage!");
        resetForm();
      }
    } else if (dbStatus === "connected") {
      try {
        const payload = {
          entry_date: newTx.entry_date,
          description: newTx.description,
          type: newTx.type,
          category: newTx.category,
          amount: newTx.amount,
          payment_mode: newTx.payment_mode,
          source: "manual",
        };

        let error = (await supabase.from("daybook_entries").insert([payload])).error;
        if (error && isMissingTableError(error)) {
          error = (await supabase.from("transactions").insert([{
            date: newTx.entry_date,
            description: newTx.description,
            type: newTx.type,
            amount: newTx.amount,
            payment_mode: newTx.payment_mode,
          }])).error;
        }
        if (error) throw error;

        setSuccessMsg(`Successfully logged transaction: "${newTx.description}"!`);
        fetchDayBook(selectedDate);
        resetForm();
      } catch (err) {
        console.error("Failed to insert transaction:", err);
        const errMsg = err instanceof Error ? err.message : "Could not save transaction.";
        setFormError(`Supabase error: ${errMsg}`);
      }
    } else {
      const itemWithId = { ...newTx, id: generateTxId() };
      const local = localStorage.getItem(LOCAL_STORAGE_KEY);
      const allEntries = local ? (JSON.parse(local) as ManualEntry[]) : [];
      saveLocalManualEntries([itemWithId, ...allEntries]);
      fetchDayBook(selectedDate);
      setSuccessMsg("Logged transaction to Local Storage!");
      resetForm();
    }
  };

  const handleStartEdit = (rec: DayBookRow) => {
    if (!rec.editable) return;
    const manual = manualEntries.find((entry) => entry.id === rec.id);
    if (!manual) return;

    setEditingTransaction(manual);
    setDescription(manual.description);
    setType(manual.type);
    setAmount(String(manual.amount));
    setPaymentMode(manual.payment_mode);
    setDate(manual.entry_date);
    setIsFormOpen(true);
  };

  const handleDeleteTransaction = async (rec: DayBookRow) => {
    if (!rec.editable || !rec.id) return;
    if (!window.confirm("Are you sure you want to delete this ledger transaction?")) {
      return;
    }

    if (dbStatus === "connected") {
      try {
        let error = (await supabase.from("daybook_entries").delete().eq("id", rec.id)).error;
        if (error && isMissingTableError(error)) {
          error = (await supabase.from("transactions").delete().eq("id", rec.id)).error;
        }
        if (error) throw error;
        fetchDayBook(selectedDate);
      } catch (err) {
        console.error("Delete transaction failed:", err);
        const errMsg = err instanceof Error ? err.message : "Unknown error";
        alert(`Failed to delete transaction: ${errMsg}`);
      }
    } else {
      const local = localStorage.getItem(LOCAL_STORAGE_KEY);
      const allEntries = local ? (JSON.parse(local) as ManualEntry[]) : [];
      saveLocalManualEntries(allEntries.filter((tx) => tx.id !== rec.id));
      fetchDayBook(selectedDate);
    }
  };

  const clearFormFields = () => {
    setDescription("");
    setType("Income");
    setAmount("");
    setPaymentMode("Cash");
    setDate(selectedDate);
    setEditingTransaction(null);
    setFormError(null);
  };

  const closeFormModal = () => {
    clearFormFields();
    setIsFormOpen(false);
    setTimeout(() => setSuccessMsg(null), 4000);
  };

  const openFormModal = () => {
    clearFormFields();
    setDate(selectedDate);
    setIsFormOpen(true);
  };

  const resetForm = () => {
    closeFormModal();
  };

  const filteredTransactions = useMemo(() => dayBookRows.filter((tx) => {
    const matchesSearch =
      tx.description.toLowerCase().includes(searchQuery.toLowerCase()) ||
      (tx.reference_no ?? "").toLowerCase().includes(searchQuery.toLowerCase());
    const matchesType = typeFilter === "All" || tx.type === typeFilter;
    const matchesSource = sourceFilter === "All" || tx.category === sourceFilter;
    return matchesSearch && matchesType && matchesSource;
  }), [dayBookRows, searchQuery, typeFilter, sourceFilter]);

  const { totalIncome, totalExpense, netBalance, salesTotal, purchaseTotal } = useMemo(
    () => computeDayTotals(dayBookRows),
    [dayBookRows],
  );

  const totalPages = Math.ceil(filteredTransactions.length / itemsPerPage);
  const indexOfLastItem = currentPage * itemsPerPage;
  const indexOfFirstItem = indexOfLastItem - itemsPerPage;
  const currentTransactions = filteredTransactions.slice(indexOfFirstItem, indexOfLastItem);

  const openReportModal = () => {
    setReportDate(selectedDate);
    setReportMonth(selectedDate.slice(0, 7));
    setReportFrom(`${selectedDate.slice(0, 7)}-01`);
    setReportTo(selectedDate);
    setReportError(null);
    setIsReportModalOpen(true);
  };

  const resolveStatementReport = useCallback(async () => {
    if (reportMode === "current") {
      return {
        rows: filteredTransactions,
        periodLabel: formatDisplayDate(selectedDate),
        reportType: "Current Table Filter",
        filenameSuffix: `${selectedDate}_filtered`,
        typeFilter,
        sourceFilter,
        searchQuery: searchQuery || "—",
      };
    }

    if (reportMode === "day") {
      const rows = reportDate === selectedDate && !loading
        ? dayBookRows
        : await fetchDayBookRowsForPeriod(reportDate, reportDate);
      return {
        rows,
        periodLabel: formatDisplayDate(reportDate),
        reportType: "Daily Day Book Statement",
        filenameSuffix: reportDate,
        typeFilter: "All",
        sourceFilter: "All",
        searchQuery: "—",
      };
    }

    if (reportMode === "month") {
      const from = `${reportMonth}-01`;
      const to = monthEnd(reportMonth);
      const rows = await fetchDayBookRowsForPeriod(from, to);
      return {
        rows,
        periodLabel: formatMonthLabel(reportMonth),
        reportType: "Monthly Day Book Statement",
        filenameSuffix: reportMonth,
        typeFilter: "All",
        sourceFilter: "All",
        searchQuery: "—",
      };
    }

    if (reportFrom > reportTo) {
      throw new Error("From date must not be after To date.");
    }

    const rows = await fetchDayBookRowsForPeriod(reportFrom, reportTo);
    return {
      rows,
      periodLabel: `${formatReportDate(reportFrom)} to ${formatReportDate(reportTo)}`,
      reportType: "Date Range Day Book Statement",
      filenameSuffix: `${reportFrom}_to_${reportTo}`,
      typeFilter: "All",
      sourceFilter: "All",
      searchQuery: "—",
    };
  }, [
    dayBookRows,
    fetchDayBookRowsForPeriod,
    filteredTransactions,
    loading,
    reportDate,
    reportFrom,
    reportMode,
    reportMonth,
    reportTo,
    searchQuery,
    selectedDate,
    sourceFilter,
    typeFilter,
  ]);

  const buildStatementHtml = useCallback((report: Awaited<ReturnType<typeof resolveStatementReport>>, renderMode: "print" | "pdf") => {
    const totals = computeDayTotals(report.rows);
    return buildDayBookHtml(buildDayBookStatementData(report.rows, {
      periodLabel: report.periodLabel,
      reportType: report.reportType,
      typeFilter: report.typeFilter,
      sourceFilter: report.sourceFilter,
      searchQuery: report.searchQuery,
    }, totals), {
      renderMode,
      helperText: "Day book statement preview. Use Print or Save as PDF.",
    });
  }, []);

  const handlePrintStatement = async () => {
    setReportError(null);
    setReportBusy(true);
    try {
      const report = await resolveStatementReport();
      await printDayBookHtml(buildStatementHtml(report, "pdf"));
      setIsReportModalOpen(false);
    } catch (err) {
      setReportError(err instanceof Error ? err.message : "Print failed.");
    } finally {
      setReportBusy(false);
    }
  };

  const handleDownloadStatement = async () => {
    setReportError(null);
    setReportBusy(true);
    try {
      const report = await resolveStatementReport();
      await exportDayBookPdf(
        buildStatementHtml(report, "pdf"),
        `daybook_statement_${report.filenameSuffix}.pdf`,
      );
      setIsReportModalOpen(false);
    } catch (err) {
      setReportError(err instanceof Error ? err.message : "PDF download failed.");
    } finally {
      setReportBusy(false);
    }
  };

  const handlePrintTransaction = async (rec: DayBookRow) => {
    try {
      await printDayBookHtml(buildDayBookHtml(buildDayBookStatementData([rec], {
        periodLabel: formatDisplayDate(rec.date),
        reportType: "Day Book Voucher",
      }, computeDayTotals([rec])), {
        helperText: "Voucher print preview.",
        renderMode: "pdf",
        voucher: rec,
      }));
    } catch (err) {
      alert(`Print failed: ${err instanceof Error ? err.message : "Unknown error"}`);
    }
  };

  const handleDownloadTransaction = async (rec: DayBookRow) => {
    try {
      const ref = rec.reference_no || rec.id.slice(0, 12);
      await exportDayBookPdf(
        buildDayBookHtml(buildDayBookStatementData([rec], {
          periodLabel: formatDisplayDate(rec.date),
          reportType: "Day Book Voucher",
        }, computeDayTotals([rec])), {
          renderMode: "pdf",
          voucher: rec,
        }),
        `daybook_voucher_${ref}.pdf`,
      );
    } catch (err) {
      alert(`PDF download failed: ${err instanceof Error ? err.message : "Unknown error"}`);
    }
  };

  return (
    <div className="p-6 space-y-6">
      {/* ── Page Header ── */}
      <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-4">
        <div>
          <h1 className="text-page-title font-semibold text-text-primary flex items-center gap-2">
            <BookOpen className="w-6 h-6 text-amber-600" />
            Day Book (Cash Book)
          </h1>
          <p className="text-caption text-text-secondary mt-0.5">
            Daily cash book for {formatDisplayDate(selectedDate)} — sales, purchases, and manual entries.
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <div className="flex items-center gap-2 bg-white border border-border rounded-lg px-3 py-2">
            <Calendar className="w-4 h-4 text-text-secondary" />
            <input
              type="date"
              value={selectedDate}
              onChange={(e) => setSelectedDate(e.target.value)}
              className="text-xs font-mono bg-transparent outline-none"
            />
          </div>
          <button
            type="button"
            onClick={() => setSelectedDate(todayIso())}
            className="btn-secondary px-3 py-2 text-xs"
          >
            Today
          </button>
          <button
            type="button"
            onClick={openReportModal}
            disabled={loading}
            className="btn-secondary px-3 py-2 text-xs flex items-center gap-1.5"
          >
            <FileText className="w-3.5 h-3.5" />
            Day Book Statement
          </button>
          <button
            type="button"
            onClick={openFormModal}
            className="btn-primary bg-amber-600 hover:bg-amber-700 active:bg-amber-800 flex items-center gap-1.5 shadow-sm"
          >
            <Plus className="w-4 h-4" />
            Record Transaction
          </button>
        </div>
      </div>

      {/* ── DB Status Notice ── */}
      {dbStatus === "local" && (
        <div className="bg-blue-50 border border-blue-200 rounded-lg p-4 flex items-start gap-3 shadow-card">
          <Database className="w-5 h-5 text-blue-600 mt-0.5 flex-shrink-0" />
          <div>
            <h4 className="text-sm font-semibold text-blue-800">Local Mode Active</h4>
            <p className="text-xs text-blue-700 mt-0.5 leading-relaxed">
              The `daybook_entries` table was not found in your Supabase database. Manual entries are saved locally.
              Run `sql/05_daybook.sql` in your Supabase SQL Editor to sync across devices.
            </p>
            <pre className="text-[10px] font-mono bg-blue-900/5 text-blue-900 border border-blue-200 p-2.5 rounded-md mt-2 overflow-x-auto select-all max-w-full">
              {`-- Run the full file: sql/05_daybook.sql`}
            </pre>
          </div>
        </div>
      )}

      {/* ── Net Daily Balance Stats Row ── */}
      <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-5 gap-5">
        <div className="bg-white border-l-4 border-l-green-500 rounded-xl shadow-card p-5 flex items-center justify-between">
          <div>
            <span className="text-[10px] font-bold text-text-secondary uppercase tracking-wider">Total Receipts / Inflow</span>
            <h3 className="text-xl font-bold text-gray-900 mt-1 font-mono">{formatCurrency(totalIncome)}</h3>
          </div>
          <div className="w-10 h-10 rounded-full bg-green-50 flex items-center justify-center text-green-600">
            <TrendingUp className="w-5 h-5" />
          </div>
        </div>

        <div className="bg-white border-l-4 border-l-red-500 rounded-xl shadow-card p-5 flex items-center justify-between">
          <div>
            <span className="text-[10px] font-bold text-text-secondary uppercase tracking-wider">Total Payments / Outflow</span>
            <h3 className="text-xl font-bold text-gray-900 mt-1 font-mono text-red-600">{formatCurrency(totalExpense)}</h3>
          </div>
          <div className="w-10 h-10 rounded-full bg-red-50 flex items-center justify-center text-red-600">
            <TrendingDown className="w-5 h-5" />
          </div>
        </div>

        <div
          className={`bg-white border-l-4 rounded-xl shadow-card p-5 flex items-center justify-between ${
            netBalance >= 0 ? "border-l-primary" : "border-l-red-500"
          }`}
        >
          <div>
            <span className="text-[10px] font-bold text-text-secondary uppercase tracking-wider">Closing Balance (Net)</span>
            <h3 className="text-xl font-bold mt-1 font-mono text-gray-900">{formatCurrency(netBalance)}</h3>
          </div>
          <div className="w-10 h-10 rounded-full bg-blue-50 flex items-center justify-center text-primary">
            <FileSpreadsheet className="w-5 h-5" />
          </div>
        </div>

        <div className="bg-white border-l-4 border-l-emerald-600 rounded-xl shadow-card p-5">
          <span className="text-[10px] font-bold text-text-secondary uppercase tracking-wider">Sales (Day)</span>
          <h3 className="text-xl font-bold text-gray-900 mt-1 font-mono">{formatCurrency(salesTotal)}</h3>
        </div>

        <div className="bg-white border-l-4 border-l-orange-500 rounded-xl shadow-card p-5">
          <span className="text-[10px] font-bold text-text-secondary uppercase tracking-wider">Purchases (Day)</span>
          <h3 className="text-xl font-bold text-gray-900 mt-1 font-mono">{formatCurrency(purchaseTotal)}</h3>
        </div>
      </div>

      {/* ── Filters and Search ── */}
      <div className="bg-white border border-border rounded-xl shadow-card p-4 flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div className="relative flex-1 max-w-md">
          <Search className="w-4 h-4 text-text-secondary absolute left-3 top-3" />
          <input
            type="text"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder="Search by description or transaction detail..."
            className="input-enterprise pl-9"
          />
        </div>

        <div className="flex flex-wrap items-center gap-3">
          <div className="flex items-center gap-1.5 text-xs font-semibold text-text-secondary">
            <Filter className="w-3.5 h-3.5" />
            <span>Type:</span>
          </div>
          <select
            value={typeFilter}
            onChange={(e) => setTypeFilter(e.target.value)}
            className="input-enterprise bg-white cursor-pointer w-40"
          >
            <option value="All">All Transactions</option>
            <option value="Income">Receipts Only</option>
            <option value="Expense">Payments Only</option>
          </select>

          <select
            value={sourceFilter}
            onChange={(e) => setSourceFilter(e.target.value)}
            className="input-enterprise bg-white cursor-pointer w-40"
          >
            <option value="All">All Sources</option>
            <option value="Sales">Sales</option>
            <option value="Purchase">Purchase</option>
            <option value="General">Manual / General</option>
          </select>
        </div>
      </div>

      {/* ── Transaction Ledger Table ── */}
      <div className="bg-white border border-border rounded-xl shadow-card overflow-hidden">
        <div className="overflow-x-auto">
          <table className="table-enterprise w-full text-xs">
            <thead>
              <tr className="bg-gray-50 border-b border-border">
                <th className="px-4 py-3 text-center font-semibold uppercase tracking-wider text-text-secondary">Date</th>
                <th className="px-4 py-3 text-center font-semibold uppercase tracking-wider text-text-secondary">Source</th>
                <th className="px-4 py-3 text-center font-semibold uppercase tracking-wider text-text-secondary">Description / Particulars</th>
                <th className="px-4 py-3 text-center font-semibold uppercase tracking-wider text-text-secondary">Payment Channel</th>
                <th className="px-4 py-3 text-center font-semibold uppercase tracking-wider text-text-secondary">Credit / Receipts (₹)</th>
                <th className="px-4 py-3 text-center font-semibold uppercase tracking-wider text-text-secondary">Debit / Payments (₹)</th>
                <th className="px-4 py-3 text-center font-semibold uppercase tracking-wider text-text-secondary">Actions</th>
              </tr>
            </thead>
            <tbody>
              {loading ? (
                <tr>
                  <td colSpan={7} className="text-center py-12">
                    <svg className="w-6 h-6 animate-spin text-primary mx-auto mb-2" fill="none" viewBox="0 0 24 24">
                      <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                      <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
                    </svg>
                    <span className="text-xs text-text-secondary">Fetching cash ledger...</span>
                  </td>
                </tr>
              ) : filteredTransactions.length === 0 ? (
                <tr>
                  <td colSpan={7} className="text-center py-16 text-text-secondary">
                    <BookOpen className="w-8 h-8 mx-auto text-gray-300 mb-2" />
                    <p className="font-semibold text-sm">No entries for {formatDisplayDate(selectedDate)}</p>
                    <p className="text-xs text-gray-400 mt-1">Change the date filter or record a manual transaction.</p>
                  </td>
                </tr>
              ) : (
                currentTransactions.map((tx) => (
                  <tr key={tx.id} className="border-b border-border hover:bg-gray-50/50 transition-colors">
                    <td className="px-4 py-2.5 font-semibold text-text-secondary font-mono text-center">{tx.date}</td>
                    <td className="px-4 py-2.5 text-center">
                      <span className={`inline-block px-2 py-0.5 rounded text-[10px] font-bold border ${
                        tx.category === "Sales"
                          ? "bg-green-50 text-green-700 border-green-200"
                          : tx.category === "Purchase"
                            ? "bg-orange-50 text-orange-700 border-orange-200"
                            : "bg-gray-100 text-gray-700 border-gray-200"
                      }`}>
                        {tx.category}
                      </span>
                    </td>
                    <td className="px-4 py-2.5 font-medium text-gray-800 text-center truncate max-w-[240px] mx-auto" title={tx.description}>{tx.description}</td>
                    <td className="px-4 py-2.5 text-center">
                      <span className="inline-block px-2 py-0.5 rounded text-[10px] font-bold bg-gray-100 text-gray-700 border border-gray-200">
                        {tx.payment_mode}
                      </span>
                    </td>
                    <td className="px-4 py-2.5 text-center font-mono font-semibold text-green-700">
                      {tx.type === "Income" ? `+ ${formatCurrency(tx.amount)}` : "—"}
                    </td>
                    <td className="px-4 py-2.5 text-center font-mono font-semibold text-red-600">
                      {tx.type === "Expense" ? `- ${formatCurrency(tx.amount)}` : "—"}
                    </td>
                    <td className="px-4 py-2.5 text-center">
                      <div className="flex items-center justify-center gap-1.5">
                        <button
                          type="button"
                          onClick={() => setViewingTransaction(tx)}
                          className="text-slate-500 hover:text-slate-900 hover:bg-slate-100 p-1.5 rounded transition-all"
                          title="View Details"
                        >
                          <Eye className="w-3.5 h-3.5" />
                        </button>
                        <button
                          type="button"
                          onClick={() => handleStartEdit(tx)}
                          disabled={!tx.editable}
                          className="text-slate-500 hover:text-slate-900 hover:bg-slate-100 p-1.5 rounded transition-all disabled:opacity-30 disabled:cursor-not-allowed"
                          title={tx.editable ? "Edit Transaction" : "Auto entry from Sales/Purchase"}
                        >
                          <Edit className="w-3.5 h-3.5" />
                        </button>
                        <button
                          type="button"
                          onClick={() => handlePrintTransaction(tx)}
                          className="text-slate-500 hover:text-slate-900 hover:bg-slate-100 p-1.5 rounded transition-all"
                          title="Print Voucher"
                        >
                          <Printer className="w-3.5 h-3.5" />
                        </button>
                        <button
                          type="button"
                          onClick={() => handleDownloadTransaction(tx)}
                          className="text-slate-500 hover:text-slate-900 hover:bg-slate-100 p-1.5 rounded transition-all"
                          title="Download voucher PDF"
                        >
                          <Download className="w-3.5 h-3.5" />
                        </button>
                        <button
                          type="button"
                          onClick={() => handleDeleteTransaction(tx)}
                          disabled={!tx.editable}
                          className="text-red-500 hover:text-red-700 hover:bg-red-50 p-1.5 rounded transition-all disabled:opacity-30 disabled:cursor-not-allowed"
                          title={tx.editable ? "Delete transaction" : "Auto entry cannot be deleted here"}
                        >
                          <Trash2 className="w-3.5 h-3.5" />
                        </button>
                      </div>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>

        <div className="bg-gray-50 px-4 py-3 border-t border-border flex flex-col sm:flex-row items-center justify-between gap-4 text-xs text-text-secondary">
          <div className="flex items-center gap-2">
            Showing <span className="font-semibold text-text-primary">{filteredTransactions.length > 0 ? indexOfFirstItem + 1 : 0}</span> to{" "}
            <span className="font-semibold text-text-primary">{Math.min(indexOfLastItem, filteredTransactions.length)}</span> of{" "}
            <span className="font-semibold text-text-primary">{filteredTransactions.length}</span> entries
          </div>
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => setCurrentPage((prev) => Math.max(prev - 1, 1))}
              disabled={currentPage === 1}
              className="px-3 py-1.5 font-semibold rounded border border-border bg-white text-gray-700 hover:bg-gray-50 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
            >
              Previous
            </button>
            <span className="font-medium text-gray-700">
              Page {currentPage} of {totalPages || 1}
            </span>
            <button
              type="button"
              onClick={() => setCurrentPage((prev) => Math.min(prev + 1, totalPages))}
              disabled={currentPage === totalPages || totalPages === 0}
              className="px-3 py-1.5 font-semibold rounded border border-border bg-white text-gray-700 hover:bg-gray-50 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
            >
              Next
            </button>
          </div>
          <div className="flex items-center gap-5">
            <span className="text-green-700">Receipts: <b className="font-mono">{formatCurrency(totalIncome)}</b></span>
            <span className="text-red-600">Payments: <b className="font-mono">{formatCurrency(totalExpense)}</b></span>
          </div>
        </div>
      </div>

      {/* ── Log / Edit Transaction Modal ── */}
      {isFormOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/40 backdrop-blur-[2px]">
          <div
            className="absolute inset-0"
            onClick={closeFormModal}
            aria-hidden="true"
          />

          <div className="bg-white border border-slate-200 rounded-xl shadow-2xl relative max-w-3xl w-full max-h-[92vh] overflow-y-auto animate-in fade-in zoom-in-95 duration-150 z-10 flex flex-col font-sans">
            <div className="bg-amber-700 px-6 py-4 text-white rounded-t-xl flex items-center justify-between shadow-md sticky top-0 z-10">
              <div>
                <h2 className="text-sm font-bold tracking-tight">
                  {editingTransaction ? "Edit Ledger Receipt/Payment" : "Log General Ledger Receipt/Payment"}
                </h2>
                <p className="text-[10px] text-amber-100 mt-0.5">
                  {editingTransaction
                    ? `Voucher: ${editingTransaction.id || "N/A"}`
                    : "Daily petty cash, income entries, or general expenditures"}
                </p>
              </div>
              <button
                type="button"
                onClick={closeFormModal}
                className="text-amber-100 hover:text-white p-1.5 rounded-lg hover:bg-white/10 transition-colors"
                aria-label="Close modal"
              >
                <X className="w-4.5 h-4.5" />
              </button>
            </div>

            <form onSubmit={handleSubmitForm} className="p-6 space-y-4">
              {formError && (
                <div className="bg-red-50 border border-red-200 text-red-800 text-xs px-4 py-2.5 rounded-md flex items-center gap-2">
                  <AlertTriangle className="w-4 h-4 flex-shrink-0" />
                  <span>{formError}</span>
                </div>
              )}

              {successMsg && (
                <div className="bg-green-50 border border-green-200 text-green-800 text-xs px-4 py-2.5 rounded-md flex items-center gap-2">
                  <Check className="w-4 h-4 flex-shrink-0" />
                  <span>{successMsg}</span>
                </div>
              )}

              <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
                <div className="md:col-span-2">
                  <label className="form-label text-xs">Transaction Description *</label>
                  <input
                    type="text"
                    value={description}
                    onChange={(e) => setDescription(e.target.value)}
                    placeholder="e.g. Electricity bill payment, Office tea snacks"
                    className="input-enterprise"
                    required
                    autoFocus
                  />
                </div>

                <div>
                  <label className="form-label text-xs">Transaction Type</label>
                  <select
                    value={type}
                    onChange={(e) => setType(e.target.value)}
                    className="input-enterprise bg-white cursor-pointer font-semibold"
                  >
                    <option value="Income">Receipt / Income (+)</option>
                    <option value="Expense">Payment / Expenditure (-)</option>
                  </select>
                </div>

                <div>
                  <label className="form-label text-xs">Amount (₹) *</label>
                  <div className="relative">
                    <span className="absolute left-3 top-2.5 text-xs font-semibold text-text-secondary">₹</span>
                    <input
                      type="number"
                      value={amount}
                      onChange={(e) => setAmount(e.target.value)}
                      placeholder="Enter amount"
                      className="input-enterprise pl-7 font-mono font-semibold text-gray-900"
                      required
                    />
                  </div>
                </div>

                <div>
                  <label className="form-label text-xs">Payment Channel / Mode</label>
                  <select
                    value={paymentMode}
                    onChange={(e) => setPaymentMode(e.target.value)}
                    className="input-enterprise bg-white cursor-pointer"
                  >
                    <option value="Cash">Cash Ledger</option>
                    <option value="Bank">Bank Transfer</option>
                    <option value="UPI">UPI Payment</option>
                    <option value="Card">Card</option>
                    <option value="Bank Transfer">Bank Transfer (Alt)</option>
                    <option value="Credit">Credit</option>
                  </select>
                </div>

                <div>
                  <label className="form-label text-xs">Accounting Date</label>
                  <input
                    type="date"
                    value={date}
                    onChange={(e) => setDate(e.target.value)}
                    className="input-enterprise font-mono"
                    required
                  />
                </div>
              </div>

              <div className="flex items-center justify-end gap-3 pt-4 border-t border-slate-200">
                <button type="button" onClick={closeFormModal} className="btn-secondary px-5">
                  Cancel
                </button>
                <button type="button" onClick={clearFormFields} className="btn-secondary px-5">
                  Clear
                </button>
                <button type="submit" className="btn-primary bg-amber-600 hover:bg-amber-700 active:bg-amber-800 px-6 shadow-sm">
                  {editingTransaction ? "Save & Update Transaction" : "Log Ledger Transaction"}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* ── View Transaction Details Modal ── */}
      {viewingTransaction && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/40 backdrop-blur-[2px]">
          <div
            className="absolute inset-0 transition-opacity"
            onClick={() => setViewingTransaction(null)}
          />

          <div className="bg-white border border-slate-200 rounded-xl shadow-2xl relative max-w-2xl w-full animate-in fade-in zoom-in-95 duration-150 z-10 flex flex-col font-sans">
            {/* Header */}
            <div className="bg-slate-900 px-6 py-4 text-white rounded-t-xl flex items-center justify-between shadow-md">
              <div>
                <h2 className="text-sm font-bold tracking-tight">Day Book Voucher Details</h2>
                <p className="text-[10px] text-slate-300 mt-0.5">Voucher: {viewingTransaction.id || "N/A"}</p>
              </div>
              <button
                type="button"
                onClick={() => setViewingTransaction(null)}
                className="text-slate-300 hover:text-white p-1.5 rounded-lg hover:bg-white/10 transition-colors"
                aria-label="Close modal"
              >
                <X className="w-4.5 h-4.5" />
              </button>
            </div>

            {/* Content Table */}
            <div className="p-6 space-y-4">
              <div className="grid grid-cols-2 gap-x-6 gap-y-3.5 text-xs">
                <div className="border-b border-slate-100 pb-2">
                  <span className="text-[10px] font-bold text-slate-400 uppercase tracking-wider block">Voucher ID</span>
                  <span className="font-mono font-semibold text-slate-900 text-sm">{viewingTransaction.id || "—"}</span>
                </div>
                <div className="border-b border-slate-100 pb-2">
                  <span className="text-[10px] font-bold text-slate-400 uppercase tracking-wider block">Source</span>
                  <span className="font-semibold text-slate-700">{viewingTransaction.category}</span>
                </div>
                <div className="border-b border-slate-100 pb-2">
                  <span className="text-[10px] font-bold text-slate-400 uppercase tracking-wider block">Reference</span>
                  <span className="font-mono text-slate-700">{viewingTransaction.reference_no || "—"}</span>
                </div>
                <div className="border-b border-slate-100 pb-2">
                  <span className="text-[10px] font-bold text-slate-400 uppercase tracking-wider block">Transaction Date</span>
                  <span className="font-mono text-slate-700">{viewingTransaction.date}</span>
                </div>
                <div className="col-span-2 border-b border-slate-100 pb-2">
                  <span className="text-[10px] font-bold text-slate-400 uppercase tracking-wider block">Description</span>
                  <span className="font-medium text-slate-900 text-sm">{viewingTransaction.description}</span>
                </div>
                <div className="border-b border-slate-100 pb-2">
                  <span className="text-[10px] font-bold text-slate-400 uppercase tracking-wider block">Voucher Type</span>
                  <span className={`inline-flex items-center px-2 py-0.5 rounded text-[10px] font-bold mt-1 ${
                    viewingTransaction.type === 'Income' ? 'bg-green-100 text-green-800' : 'bg-red-100 text-red-800'
                  }`}>
                    {viewingTransaction.type}
                  </span>
                </div>
                <div className="border-b border-slate-100 pb-2">
                  <span className="text-[10px] font-bold text-slate-400 uppercase tracking-wider block">Payment Mode</span>
                  <span className="font-semibold text-slate-700">{viewingTransaction.payment_mode}</span>
                </div>
                <div className="border-b border-slate-100 pb-2">
                  <span className="text-[10px] font-bold text-slate-400 uppercase tracking-wider block">Amount</span>
                  <span className={`font-mono font-bold text-sm ${
                    viewingTransaction.type === 'Income' ? 'text-green-700' : 'text-red-600'
                  }`}>
                    {formatCurrency(viewingTransaction.amount)}
                  </span>
                </div>
              </div>
            </div>

            {/* Footer Buttons */}
            <div className="flex items-center justify-end gap-3 pt-4 border-t border-slate-200 bg-slate-50 p-4 rounded-b-xl">
              <button
                type="button"
                onClick={() => handleDownloadTransaction(viewingTransaction)}
                className="btn-secondary px-4 py-2 font-semibold text-xs border border-slate-300 text-slate-700 hover:bg-slate-100 transition-colors rounded flex items-center gap-1.5"
              >
                <Download className="w-3.5 h-3.5" />
                Download PDF
              </button>
              <button
                type="button"
                onClick={() => handlePrintTransaction(viewingTransaction)}
                className="btn-secondary px-4 py-2 font-semibold text-xs border border-slate-300 text-slate-700 hover:bg-slate-100 transition-colors rounded flex items-center gap-1.5"
              >
                <Printer className="w-3.5 h-3.5" />
                Print Voucher
              </button>
              <button
                type="button"
                onClick={() => setViewingTransaction(null)}
                className="btn-primary bg-slate-900 hover:bg-slate-800 active:bg-slate-950 px-6 py-2 font-bold shadow-sm text-white transition-colors rounded text-xs"
              >
                Close View
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ── Day Book Statement Modal ── */}
      {isReportModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/40 backdrop-blur-[2px]">
          <div className="absolute inset-0" onClick={() => setIsReportModalOpen(false)} />
          <div className="bg-white border border-slate-200 rounded-xl shadow-2xl relative max-w-lg w-full z-10 flex flex-col font-sans animate-in fade-in zoom-in-95 duration-150">
            <div className="bg-amber-700 px-5 py-4 text-white rounded-t-xl flex items-center justify-between">
              <div>
                <h2 className="text-sm font-bold tracking-tight flex items-center gap-2">
                  <FileText className="w-4 h-4" />
                  Download Day Book Statement
                </h2>
                <p className="text-[10px] text-amber-100 mt-0.5">Account-style PDF with receipts, payments &amp; bill totals</p>
              </div>
              <button type="button" onClick={() => setIsReportModalOpen(false)}
                className="text-amber-100 hover:text-white p-1.5 rounded-lg hover:bg-white/10">
                <X className="w-4 h-4" />
              </button>
            </div>

            <div className="p-5 space-y-4">
              {reportError && (
                <div className="bg-red-50 border border-red-200 text-red-800 text-xs px-3 py-2 rounded-md flex items-center gap-2">
                  <AlertTriangle className="w-4 h-4 flex-shrink-0" />
                  <span>{reportError}</span>
                </div>
              )}

              <div>
                <label className="form-label text-xs font-semibold text-slate-700 mb-2 block">Statement Type</label>
                <div className="space-y-2">
                  {([
                    ["day", "Selected Day", "All entries for a single calendar day"],
                    ["month", "By Month", "All entries in a calendar month"],
                    ["range", "Date Range", "Entries between two dates"],
                    ["current", "Current Table Filter", "Uses search & filters from the list"],
                  ] as const).map(([mode, title, desc]) => (
                    <label key={mode}
                      className={`flex items-start gap-3 p-3 rounded-lg border cursor-pointer transition-colors ${
                        reportMode === mode ? "border-amber-600 bg-amber-50" : "border-slate-200 hover:bg-slate-50"
                      }`}>
                      <input type="radio" name="daybookReportMode" value={mode} checked={reportMode === mode}
                        onChange={() => { setReportMode(mode); setReportError(null); }}
                        className="mt-0.5" />
                      <span>
                        <span className="text-xs font-bold text-slate-800 block">{title}</span>
                        <span className="text-[10px] text-slate-500">{desc}</span>
                      </span>
                    </label>
                  ))}
                </div>
              </div>

              {reportMode === "day" && (
                <div>
                  <label className="form-label text-xs">Book Date</label>
                  <input type="date" value={reportDate} onChange={(e) => setReportDate(e.target.value)}
                    className="input-enterprise font-mono text-xs w-full" />
                </div>
              )}

              {reportMode === "month" && (
                <div>
                  <label className="form-label text-xs">Month</label>
                  <input type="month" value={reportMonth} onChange={(e) => setReportMonth(e.target.value)}
                    className="input-enterprise font-mono text-xs w-full" />
                </div>
              )}

              {reportMode === "range" && (
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="form-label text-xs">From Date</label>
                    <input type="date" value={reportFrom} onChange={(e) => setReportFrom(e.target.value)}
                      className="input-enterprise font-mono text-xs w-full" />
                  </div>
                  <div>
                    <label className="form-label text-xs">To Date</label>
                    <input type="date" value={reportTo} min={reportFrom} onChange={(e) => setReportTo(e.target.value)}
                      className="input-enterprise font-mono text-xs w-full" />
                  </div>
                </div>
              )}

              <p className="text-[10px] text-slate-500 leading-relaxed">
                Statement includes date, source, description, reference, payment mode, cash receipts/payments, and linked bill amounts for sales and purchases — with period totals and signatory.
              </p>
            </div>

            <div className="flex items-center justify-end gap-2 px-5 py-4 border-t border-slate-200 bg-slate-50 rounded-b-xl">
              <button type="button" onClick={() => setIsReportModalOpen(false)} className="btn-secondary px-4 text-xs">
                Cancel
              </button>
              <button type="button" onClick={handlePrintStatement} disabled={reportBusy}
                className="btn-secondary px-4 text-xs flex items-center gap-1.5 disabled:opacity-50">
                <Printer className="w-3.5 h-3.5" /> Print
              </button>
              <button type="button" onClick={handleDownloadStatement} disabled={reportBusy}
                className="btn-primary bg-amber-600 hover:bg-amber-700 px-4 text-xs flex items-center gap-1.5 disabled:opacity-50">
                <Download className="w-3.5 h-3.5" /> Download PDF
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
