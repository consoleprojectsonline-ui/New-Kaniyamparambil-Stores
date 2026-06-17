import { useState, useEffect, useCallback, useMemo, useRef } from "react";
import {
  ShoppingCart,
  Plus,
  Search,
  Filter,
  Trash2,
  AlertTriangle,
  Check,
  Database,
  Calendar,
  Eye,
  Download,
  Printer,
  X,
  Edit,
  Truck,
  FileText,
} from "lucide-react";
import html2canvas from "html2canvas";
import { jsPDF } from "jspdf";
import { supabase } from "@/lib/supabase";
import { formatCurrency, formatTableDate } from "@/lib/utils";

interface InventoryItem {
  code: string;
  name: string;
  company_code: string;
  group: string;
  sub_group: string;
  brand: string;
  type: string;
  hsn_code: string;
  uom: string;
  enable_batch: string;
  stock_qty?: number;
  created_at?: string;
}

export interface PurchaseItem {
  code: string;
  name: string;
  hsn_code: string; // HSN / SAC code for GST
  qty: number;
  unit: string;
  rate: number;
  disc: number;   // trade discount amount (₹)
  sgst: number;  // SGST tax percentage
  cgst: number;  // CGST tax percentage
  s_rate?: number; // selling price
  mrp?: number;    // MRP
}

export interface PurchaseRecord {
  invoice_no: string;      // unique bill / invoice number
  serial_no?: string;      // internal serial / reference number
  supplier_name: string;
  purchase_type: string;   // e.g., "Local Purchase"
  branch_godown: string;   // e.g., "Shop", "Godown A"
  entry_date: string;      // Pur. Entry Date
  invoice_date: string;    // Invoice Date
  vehicle_no?: string;
  items: PurchaseItem[];
  expenses: number;        // freight / overheads
  subtotal: number;        // base subtotal (qty × rate) before discount/tax
  total_discount: number;  // aggregate trade discount across all items
  total_sgst: number;      // aggregate SGST
  total_cgst: number;      // aggregate CGST
  net_amount: number;      // final payable = subtotal - discount + sgst + cgst + expenses
  paid_amount: number;     // amount paid to supplier
  payment_status: string;
  created_at?: string;
}

type PaymentStatus = "Pending" | "Partial" | "Paid";

function formatGridNumberValue(value: number | undefined): string | number {
  if (value === undefined || value === null || Number.isNaN(value)) return "";
  return value;
}

function parseGridNumber(raw: string, mode: "int" | "decimal"): number {
  const trimmed = raw.trim();
  if (!trimmed) return 0;
  const parsed = mode === "int" ? parseInt(trimmed, 10) : parseFloat(trimmed);
  return Number.isFinite(parsed) ? parsed : 0;
}

const SEED_SUPPLIERS = [
  "Tata Steel Distributor",
  "Jindal Steel & Power Ltd.",
  "Supreme Industries Pvt.",
  "Havells India Ltd.",
  "Finolex Cables Ltd.",
  "Anchor Electricals",
];

const PURCHASE_TYPES = [
  "Local Purchase",
  "Interstate Purchase",
  "Import / Custom clearance",
  "Tax-Free Purchase",
  "Consignment Stock Inflow",
];

const BRANCHES_GODOWNS = [
  "Shop (Main Showroom)",
  "Central Godown A",
  "Warehouse Godown B",
  "Transit / On-Field Stock",
];

/**
 * Normalizes a raw record (from Supabase or LocalStorage) into a
 * PurchaseRecord. Handles legacy column names from the original DB schema:
 *   bill_no          -> invoice_no
 *   purchase_date    -> entry_date & invoice_date
 *   amount           -> net_amount (subtotal = same)
 *   tax_amount       -> absorbed into net_amount already
 */
function normalizePurchase(raw: Record<string, unknown>): PurchaseRecord {
  // Normalise items: migrate legacy 'gst' → sgst/cgst split
  let items: PurchaseItem[];
  if (Array.isArray(raw.items) && raw.items.length > 0) {
    items = (raw.items as Record<string, unknown>[]).map((it) => ({
      code: String(it.code ?? ""),
      name: String(it.name ?? ""),
      hsn_code: String(it.hsn_code ?? ""),
      qty: Number(it.qty ?? 1),
      unit: String(it.unit ?? "Nos"),
      rate: Number(it.rate ?? 0),
      disc: Number(it.disc ?? 0),
      // If already has sgst/cgst use them; otherwise halve legacy gst
      sgst: it.sgst !== undefined ? Number(it.sgst) : Number(it.gst ?? 0) / 2,
      cgst: it.cgst !== undefined ? Number(it.cgst) : Number(it.gst ?? 0) / 2,
      s_rate: it.s_rate !== undefined ? Number(it.s_rate) : undefined,
      mrp: it.mrp !== undefined ? Number(it.mrp) : undefined,
    }));
  } else {
    items = [{
      code: "LEGACY",
      name: "Imported record – no item detail",
      hsn_code: "",
      qty: 1,
      unit: "Nos",
      rate: Number(raw.amount ?? raw.net_amount ?? 0),
      disc: 0,
      sgst: 0,
      cgst: 0,
    }];
  }

  // Derive totals for legacy records that lack them
  let totalSgst = Number(raw.total_sgst ?? 0);
  let totalCgst = Number(raw.total_cgst ?? 0);
  if (!raw.total_sgst && !raw.total_cgst) {
    items.forEach((it) => {
      const taxable = Math.max(0, it.qty * it.rate - it.disc);
      totalSgst += taxable * (it.sgst / 100);
      totalCgst += taxable * (it.cgst / 100);
    });
  }

  return {
    invoice_no: String(raw.invoice_no ?? raw.bill_no ?? ""),
    serial_no: raw.serial_no ? String(raw.serial_no) : undefined,
    supplier_name: String(raw.supplier_name ?? ""),
    purchase_type: String(raw.purchase_type ?? "Local Purchase"),
    branch_godown: String(raw.branch_godown ?? "Shop (Main Showroom)"),
    entry_date: String(raw.entry_date ?? raw.purchase_date ?? ""),
    invoice_date: String(raw.invoice_date ?? raw.purchase_date ?? ""),
    vehicle_no: raw.vehicle_no ? String(raw.vehicle_no) : "",
    items,
    expenses: Number(raw.expenses ?? 0),
    subtotal: Number(raw.subtotal ?? raw.amount ?? 0),
    total_discount: Number(raw.total_discount ?? 0),
    total_sgst: Math.round(totalSgst * 100) / 100,
    total_cgst: Math.round(totalCgst * 100) / 100,
    net_amount: Number(raw.net_amount ?? raw.amount ?? 0),
    paid_amount: Number(raw.paid_amount ?? 0),
    payment_status: String(raw.payment_status ?? "Pending"),
    created_at: raw.created_at ? String(raw.created_at) : undefined,
  };
}

const PURCHASE_STORE_DETAILS = {
  storeName: "NEW KANIYAMPARAMBIL STORES",
  location: "THOPRAMKUDY PO, THOPRAMKUDY, KERALA",
  gstin: "32AWJPJ1371N1ZE",
  phone: "9544363171",
  signatureCompany: "FOR NEW KANIYAMPARAMBIL STORES",
  signatureRole: "Authorized Purchase Signatory",
} as const;

const PURCHASE_FRAME_STYLE: Partial<CSSStyleDeclaration> = {
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

function todayIso(): string {
  return new Date().toISOString().split("T")[0];
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function formatDocDate(value: string): string {
  const date = new Date(`${value.slice(0, 10)}T00:00:00`);
  if (Number.isNaN(date.getTime())) return escapeHtml(value || "—");
  return new Intl.DateTimeFormat("en-GB", {
    day: "2-digit",
    month: "short",
    year: "numeric",
  }).format(date).replace(/ /g, "-");
}

function formatMonthLabel(monthYm: string): string {
  const [year, month] = monthYm.split("-");
  const d = new Date(Number(year), Number(month) - 1, 1);
  if (Number.isNaN(d.getTime())) return monthYm;
  return new Intl.DateTimeFormat("en-GB", { month: "long", year: "numeric" }).format(d);
}

function getPurchaseItemLineSummary(item: PurchaseItem) {
  const taxable = Math.max(0, item.qty * item.rate - (item.disc || 0));
  const sgstAmt = taxable * ((item.sgst ?? 0) / 100);
  const cgstAmt = taxable * ((item.cgst ?? 0) / 100);
  return {
    taxable,
    sgstAmt,
    cgstAmt,
    lineTotal: taxable + sgstAmt + cgstAmt,
  };
}

type PurchaseDocOptions = {
  autoPrint?: boolean;
  helperText?: string;
  renderMode?: "print" | "pdf";
};

function buildPurchaseHtml(rec: PurchaseRecord, options: PurchaseDocOptions = {}): string {
  const store = PURCHASE_STORE_DETAILS;
  const isPdfMode = options.renderMode === "pdf";
  const balanceDue = Math.max(0, rec.net_amount - rec.paid_amount);

  const rowMarkup = rec.items.map((item, index) => {
    const s = getPurchaseItemLineSummary(item);
    return `<tr>
      <td class="col-index">${index + 1}</td>
      <td class="col-code">${escapeHtml(item.code || "—")}</td>
      <td class="col-name">${escapeHtml(item.name || "—")}</td>
      <td class="col-hsn">${escapeHtml(item.hsn_code || "—")}</td>
      <td class="col-qty align-center">${item.qty.toFixed(2)} ${escapeHtml(item.unit || "Nos")}</td>
      <td class="col-rate align-right">${escapeHtml(formatCurrency(item.rate))}</td>
      <td class="col-disc align-right">${escapeHtml(formatCurrency(item.disc || 0))}</td>
      <td class="col-gst align-center">${item.sgst ?? 0}% / ${item.cgst ?? 0}%</td>
      <td class="col-amt align-right">${escapeHtml(formatCurrency(s.lineTotal))}</td>
    </tr>`;
  }).join("");

  return `<!DOCTYPE html>
  <html lang="en">
    <head>
      <meta charset="UTF-8" />
      <title>Purchase Bill ${escapeHtml(rec.invoice_no)}</title>
      <style>
        * { box-sizing: border-box; }
        body {
          margin: 0;
          background: ${isPdfMode ? "#fff" : "#f3f4f6"};
          font-family: Arial, Helvetica, sans-serif;
          color: #111;
          font-size: ${isPdfMode ? "8px" : "12px"};
          line-height: 1.35;
          padding: ${isPdfMode ? "0" : "20px"};
        }
        .purchase-toolbar {
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
        .toolbar-btn.primary { background: #7c3aed; color: #fff; border-color: #7c3aed; }
        .purchase-sheet {
          width: ${isPdfMode ? "794px" : "860px"};
          margin: 0 auto;
          background: #fff;
          border: 1px solid #000;
        }
        .doc-title {
          text-align: center;
          font-size: ${isPdfMode ? "13px" : "16px"};
          font-weight: 700;
          color: #7c3aed;
          letter-spacing: 0.05em;
          padding: ${isPdfMode ? "7px 8px" : "10px"};
          border-bottom: 1px solid #000;
        }
        .doc-subtitle {
          text-align: center;
          font-size: ${isPdfMode ? "8px" : "10px"};
          color: #555;
          padding: ${isPdfMode ? "4px 8px" : "6px 10px"};
          border-bottom: 1px solid #000;
          background: #f5f3ff;
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
        .items-table {
          width: 100%;
          border-collapse: collapse;
        }
        .items-table th,
        .items-table td {
          border: 1px solid #000;
          padding: ${isPdfMode ? "3px 4px" : "5px 6px"};
          vertical-align: top;
        }
        .items-table thead th {
          background: #ede9fe;
          font-weight: 700;
          text-align: center;
        }
        .col-index { width: 22px; text-align: center; }
        .col-code { width: 48px; font-family: monospace; }
        .col-name { min-width: 90px; }
        .col-hsn { width: 44px; text-align: center; }
        .col-qty { width: 52px; }
        .col-rate, .col-disc, .col-amt { width: 52px; white-space: nowrap; }
        .col-gst { width: 44px; font-size: ${isPdfMode ? "7px" : "10px"}; }
        .align-right { text-align: right; }
        .align-center { text-align: center; }
        .totals-grid {
          display: grid;
          grid-template-columns: 1fr 1fr;
          border-top: 1px solid #000;
        }
        .totals-box {
          padding: ${isPdfMode ? "5px 7px" : "8px 10px"};
          border-right: 1px solid #000;
        }
        .totals-box:last-child { border-right: none; }
        .total-row {
          display: flex;
          justify-content: space-between;
          gap: 12px;
          margin-bottom: 3px;
          font-weight: 600;
        }
        .total-row.grand {
          margin-top: 4px;
          padding-top: 4px;
          border-top: 1px dashed #999;
          font-size: ${isPdfMode ? "10px" : "13px"};
          font-weight: 700;
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
        @page { size: A4 portrait; margin: 10mm; }
        @media print {
          body { background: #fff; padding: 0; }
          .purchase-toolbar { display: none; }
          .purchase-sheet { width: 100%; border: none; }
        }
      </style>
    </head>
    <body>
      <div class="purchase-toolbar">
        <p class="toolbar-text">${escapeHtml(options.helperText || "Use Print / Save as PDF from your browser.")}</p>
        <div class="toolbar-actions">
          <button class="toolbar-btn" onclick="window.close()">Close</button>
          <button class="toolbar-btn primary" onclick="window.print()">Print / Save PDF</button>
        </div>
      </div>

      <div class="purchase-sheet">
        <div class="doc-title">PURCHASE BILL / STOCK INFLOW VOUCHER</div>
        <div class="doc-subtitle">Procurement &amp; warehouse stock inflow record</div>

        <div class="meta-grid">
          <div>
            <div class="meta-label">${escapeHtml(store.storeName)}</div>
            <div class="meta-line">${escapeHtml(store.location)}</div>
            <div class="meta-line"><b>GSTIN:</b> ${escapeHtml(store.gstin)}</div>
            <div class="meta-line"><b>Phone:</b> ${escapeHtml(store.phone)}</div>
          </div>
          <div>
            <div class="meta-label">Supplier Details</div>
            <div class="meta-line"><b>Supplier:</b> ${escapeHtml(rec.supplier_name)}</div>
            <div class="meta-line"><b>Type:</b> ${escapeHtml(rec.purchase_type)}</div>
            <div class="meta-line"><b>Godown:</b> ${escapeHtml(rec.branch_godown)}</div>
            <div class="meta-line"><b>Vehicle:</b> ${escapeHtml(rec.vehicle_no || "—")}</div>
          </div>
          <div>
            <div class="meta-label">Bill Details</div>
            <div class="meta-line"><b>Invoice No:</b> ${escapeHtml(rec.invoice_no)}</div>
            <div class="meta-line"><b>Serial:</b> ${escapeHtml(rec.serial_no || "—")}</div>
            <div class="meta-line"><b>Invoice Date:</b> ${escapeHtml(formatDocDate(rec.invoice_date))}</div>
            <div class="meta-line"><b>Entry Date:</b> ${escapeHtml(formatDocDate(rec.entry_date))}</div>
          </div>
        </div>

        <table class="items-table">
          <thead>
            <tr>
              <th>#</th>
              <th>Code</th>
              <th>Item</th>
              <th>HSN</th>
              <th>Qty</th>
              <th>Rate</th>
              <th>Disc</th>
              <th>SGST/CGST</th>
              <th>Line Total</th>
            </tr>
          </thead>
          <tbody>${rowMarkup || `<tr><td colspan="9" style="text-align:center;padding:12px;">No line items</td></tr>`}</tbody>
        </table>

        <div class="totals-grid">
          <div class="totals-box">
            <div class="total-row"><span>Subtotal (Base)</span><span>${escapeHtml(formatCurrency(rec.subtotal))}</span></div>
            <div class="total-row"><span>Discount (–)</span><span>${escapeHtml(formatCurrency(rec.total_discount ?? 0))}</span></div>
            <div class="total-row"><span>Total SGST</span><span>${escapeHtml(formatCurrency(rec.total_sgst ?? 0))}</span></div>
            <div class="total-row"><span>Total CGST</span><span>${escapeHtml(formatCurrency(rec.total_cgst ?? 0))}</span></div>
          </div>
          <div class="totals-box">
            <div class="total-row"><span>Expenses (Freight)</span><span>${escapeHtml(formatCurrency(rec.expenses))}</span></div>
            <div class="total-row grand"><span>Net Amount</span><span>${escapeHtml(formatCurrency(rec.net_amount))}</span></div>
            <div class="total-row"><span>Paid</span><span>${escapeHtml(formatCurrency(rec.paid_amount))}</span></div>
            <div class="total-row"><span>Balance Due</span><span>${escapeHtml(formatCurrency(balanceDue))}</span></div>
            <div class="total-row"><span>Status</span><span>${escapeHtml(rec.payment_status)}</span></div>
          </div>
        </div>

        <div class="footer-note">
          Purchase bill generated from procurement records. Stock inflow is recorded per saved purchase bill line items.
        </div>

        <div class="signatory">
          <div>${escapeHtml(store.signatureCompany)}</div>
          <div>${escapeHtml(store.signatureRole)}</div>
        </div>
      </div>
      <script>${options.autoPrint ? "window.addEventListener('load', () => { setTimeout(() => window.print(), 250); });" : ""}</script>
    </body>
  </html>`;
}

// ─── Purchase Statement (account-style register) ────────────────────────────

type PurchaseReportMode = "full" | "date" | "month" | "range" | "current";

type PurchaseStatementMeta = {
  reportTitle: string;
  periodLabel: string;
  reportType: string;
  statusFilter: string;
  searchQuery: string;
  generatedOn: string;
  totalBills: number;
  totalNet: number;
  totalPaid: number;
  totalOutstanding: number;
};

type PurchaseStatementDocOptions = {
  helperText?: string;
  renderMode?: "print" | "pdf";
};

function purchaseEntryDate(rec: PurchaseRecord): string {
  return (rec.entry_date || rec.invoice_date || "").slice(0, 10);
}

function filterPurchasesByDate(list: PurchaseRecord[], date: string): PurchaseRecord[] {
  return list.filter((p) => purchaseEntryDate(p) === date);
}

function filterPurchasesByMonth(list: PurchaseRecord[], monthYm: string): PurchaseRecord[] {
  return list.filter((p) => purchaseEntryDate(p).slice(0, 7) === monthYm);
}

function filterPurchasesByRange(list: PurchaseRecord[], from: string, to: string): PurchaseRecord[] {
  return list.filter((p) => {
    const d = purchaseEntryDate(p);
    return d >= from && d <= to;
  });
}

function buildPurchaseStatementMeta(
  list: PurchaseRecord[],
  reportType: string,
  periodLabel: string,
  statusFilter: string,
  searchQuery: string,
): PurchaseStatementMeta {
  return {
    reportTitle: "PURCHASE STATEMENT / PROCUREMENT REGISTER",
    periodLabel,
    reportType,
    statusFilter,
    searchQuery,
    generatedOn: formatDocDate(todayIso()),
    totalBills: list.length,
    totalNet: list.reduce((sum, p) => sum + p.net_amount, 0),
    totalPaid: list.reduce((sum, p) => sum + p.paid_amount, 0),
    totalOutstanding: list.reduce((sum, p) => sum + Math.max(0, p.net_amount - p.paid_amount), 0),
  };
}

function buildPurchaseStatementHtml(
  list: PurchaseRecord[],
  meta: PurchaseStatementMeta,
  options: PurchaseStatementDocOptions = {},
): string {
  const store = PURCHASE_STORE_DETAILS;
  const isPdfMode = options.renderMode === "pdf";

  const rowMarkup = list.map((rec, index) => {
    const balance = Math.max(0, rec.net_amount - rec.paid_amount);
    const totalGst = (rec.total_sgst ?? 0) + (rec.total_cgst ?? 0);
    return `<tr>
      <td class="col-index">${index + 1}</td>
      <td class="col-date">${escapeHtml(formatDocDate(rec.entry_date))}</td>
      <td class="col-inv">${escapeHtml(rec.invoice_no)}</td>
      <td class="col-serial">${escapeHtml(rec.serial_no || "—")}</td>
      <td class="col-supplier">${escapeHtml(rec.supplier_name)}</td>
      <td class="col-godown">${escapeHtml(rec.branch_godown)}</td>
      <td class="col-items align-center">${rec.items.length}</td>
      <td class="col-amt align-right">${escapeHtml(formatCurrency(rec.subtotal))}</td>
      <td class="col-amt align-right">${escapeHtml(formatCurrency(totalGst))}</td>
      <td class="col-amt align-right">${escapeHtml(formatCurrency(rec.net_amount))}</td>
      <td class="col-amt align-right">${escapeHtml(formatCurrency(rec.paid_amount))}</td>
      <td class="col-amt align-right">${escapeHtml(formatCurrency(balance))}</td>
      <td class="col-status">${escapeHtml(rec.payment_status)}</td>
    </tr>`;
  }).join("");

  return `<!DOCTYPE html>
  <html lang="en">
    <head>
      <meta charset="UTF-8" />
      <title>${escapeHtml(meta.reportTitle)}</title>
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
        .statement-toolbar {
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
        .toolbar-btn.primary { background: #7c3aed; color: #fff; border-color: #7c3aed; }
        .purchase-statement-sheet {
          width: ${isPdfMode ? "794px" : "860px"};
          margin: 0 auto;
          background: #fff;
          border: 1px solid #000;
        }
        .doc-title {
          text-align: center;
          font-size: ${isPdfMode ? "13px" : "16px"};
          font-weight: 700;
          color: #7c3aed;
          letter-spacing: 0.05em;
          padding: ${isPdfMode ? "7px 8px" : "10px"};
          border-bottom: 1px solid #000;
        }
        .period-banner {
          text-align: center;
          font-weight: 700;
          padding: ${isPdfMode ? "5px 8px" : "8px 12px"};
          border-bottom: 1px solid #000;
          background: #ede9fe;
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
          background: #ede9fe;
          font-weight: 700;
          text-align: center;
        }
        .col-index { width: 20px; text-align: center; }
        .col-date { width: 52px; text-align: center; white-space: nowrap; }
        .col-inv { width: 56px; font-family: monospace; }
        .col-serial { width: 48px; font-family: monospace; font-size: ${isPdfMode ? "7px" : "10px"}; }
        .col-supplier { min-width: 80px; }
        .col-godown { width: 56px; font-size: ${isPdfMode ? "7px" : "10px"}; }
        .col-items { width: 28px; }
        .col-amt { width: 48px; white-space: nowrap; }
        .col-status { width: 40px; text-align: center; }
        .align-right { text-align: right; }
        .align-center { text-align: center; }
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
          .statement-toolbar { display: none; }
          .purchase-statement-sheet { width: 100%; border: none; }
        }
      </style>
    </head>
    <body>
      <div class="statement-toolbar">
        <p class="toolbar-text">${escapeHtml(options.helperText || "Use Print / Save as PDF from your browser.")}</p>
        <div class="toolbar-actions">
          <button class="toolbar-btn" onclick="window.close()">Close</button>
          <button class="toolbar-btn primary" onclick="window.print()">Print / Save PDF</button>
        </div>
      </div>

      <div class="purchase-statement-sheet">
        <div class="doc-title">${escapeHtml(meta.reportTitle)}</div>
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
            <div class="meta-line"><b>Status Filter:</b> ${escapeHtml(meta.statusFilter)}</div>
            <div class="meta-line"><b>Search:</b> ${escapeHtml(meta.searchQuery || "—")}</div>
          </div>
          <div>
            <div class="meta-label">Generated</div>
            <div class="meta-line"><b>Date:</b> ${escapeHtml(meta.generatedOn)}</div>
            <div class="meta-line"><b>Bills:</b> ${meta.totalBills}</div>
          </div>
        </div>

        <table class="statement-table">
          <thead>
            <tr>
              <th>#</th>
              <th>Entry Date</th>
              <th>Invoice No</th>
              <th>Serial</th>
              <th>Supplier</th>
              <th>Godown</th>
              <th>Items</th>
              <th>Subtotal</th>
              <th>GST</th>
              <th>Net Amt</th>
              <th>Paid</th>
              <th>Balance</th>
              <th>Status</th>
            </tr>
          </thead>
          <tbody>${rowMarkup || `<tr><td colspan="13" style="text-align:center;padding:12px;">No purchase bills for this statement period.</td></tr>`}</tbody>
        </table>

        <div class="summary-grid">
          <div class="summary-box">Total Bills<b>${meta.totalBills}</b></div>
          <div class="summary-box">Total Net Value<b>${escapeHtml(formatCurrency(meta.totalNet))}</b></div>
          <div class="summary-box">Total Paid<b>${escapeHtml(formatCurrency(meta.totalPaid))}</b></div>
          <div class="summary-box">Outstanding<b>${escapeHtml(formatCurrency(meta.totalOutstanding))}</b></div>
        </div>

        <div class="footer-note">
          Purchase statement generated from procurement records. Amounts include taxable value, GST, expenses, and payment status per saved bill.
        </div>

        <div class="signatory">
          <div>${escapeHtml(store.signatureCompany)}</div>
          <div>${escapeHtml(store.signatureRole)}</div>
        </div>
      </div>
    </body>
  </html>`;
}

async function waitForPurchaseFrame(html: string, sheetSelector = ".purchase-sheet"): Promise<HTMLIFrameElement> {
  const iframe = document.createElement("iframe");
  Object.assign(iframe.style, PURCHASE_FRAME_STYLE);
  iframe.setAttribute("aria-hidden", "true");
  document.body.appendChild(iframe);
  const frameDocument = iframe.contentDocument;
  if (!frameDocument) {
    iframe.remove();
    throw new Error("Unable to prepare the purchase document.");
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
        reject(new Error("Purchase preview took too long to load."));
        return;
      }
      window.setTimeout(checkReady, 50);
    };
    checkReady();
  });
  const sheet = iframe.contentDocument?.querySelector(sheetSelector);
  if (sheet instanceof HTMLElement) {
    iframe.style.height = `${sheet.scrollHeight + 40}px`;
  }
  await new Promise((resolve) => window.setTimeout(resolve, 120));
  return iframe;
}

async function exportPurchasePdf(
  html: string,
  filename: string,
  sheetSelector = ".purchase-sheet",
  singlePage = true,
): Promise<void> {
  let iframe: HTMLIFrameElement | null = null;
  try {
    iframe = await waitForPurchaseFrame(html, sheetSelector);
    const sheet = iframe.contentDocument?.querySelector(sheetSelector);
    if (!(sheet instanceof HTMLElement)) {
      throw new Error("Unable to prepare the purchase layout for PDF export.");
    }
    const canvas = await html2canvas(sheet, { scale: 2, useCORS: true, backgroundColor: "#ffffff" });
    const pdf = new jsPDF({ orientation: "portrait", unit: "pt", format: "a4" });
    const pageWidth = pdf.internal.pageSize.getWidth();
    const pageHeight = pdf.internal.pageSize.getHeight();
    const margin = 12;

    if (singlePage) {
      const maxWidth = pageWidth - margin * 2;
      const maxHeight = pageHeight - margin * 2;
      const scale = Math.min(maxWidth / canvas.width, maxHeight / canvas.height);
      pdf.addImage(canvas.toDataURL("image/png"), "PNG", margin, margin, canvas.width * scale, canvas.height * scale, undefined, "FAST");
    } else {
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
    }
    pdf.save(filename);
  } finally {
    iframe?.remove();
  }
}

async function printPurchaseHtml(html: string, sheetSelector = ".purchase-sheet"): Promise<void> {
  let iframe: HTMLIFrameElement | null = null;
  try {
    iframe = await waitForPurchaseFrame(html, sheetSelector);
    const printWindow = iframe.contentWindow;
    if (!printWindow) throw new Error("Unable to open the print dialog.");
    printWindow.focus();
    printWindow.print();
  } finally {
    window.setTimeout(() => iframe?.remove(), 1200);
  }
}

// Custom Searchable Dropdown for Selecting Products
// Uses a fixed-position portal pattern so the dropdown is never clipped by
// overflow-hidden / overflow-auto ancestors (modal scroll + table scroll).
function SearchableProductSelect({
  items,
  value,
  onChange,
  placeholder = "Select product...",
}: {
  items: InventoryItem[];
  value: string;
  onChange: (item: InventoryItem) => void;
  placeholder?: string;
}) {
  const [isOpen, setIsOpen] = useState(false);
  const [search, setSearch] = useState("");
  const [dropdownStyle, setDropdownStyle] = useState<{
    top: number;
    left: number;
    width: number;
  } | null>(null);

  const buttonRef = useRef<HTMLButtonElement>(null);
  const selectedItem = items.find((item) => item.code === value);

  const filtered = items.filter(
    (item) =>
      item.name.toLowerCase().includes(search.toLowerCase()) ||
      item.code.toLowerCase().includes(search.toLowerCase())
  );

  const openDropdown = () => {
    if (buttonRef.current) {
      const rect = buttonRef.current.getBoundingClientRect();
      // Check if there's room below; if not, open upward
      const spaceBelow = window.innerHeight - rect.bottom;
      const dropH = Math.min(260, filtered.length * 44 + 52);
      const top = spaceBelow >= dropH ? rect.bottom + 4 : rect.top - dropH - 4;
      setDropdownStyle({ top, left: rect.left, width: rect.width });
    }
    setIsOpen(true);
  };

  // Recalculate position on scroll/resize while open
  useEffect(() => {
    if (!isOpen) return;
    const recalc = () => {
      if (buttonRef.current) {
        const rect = buttonRef.current.getBoundingClientRect();
        const spaceBelow = window.innerHeight - rect.bottom;
        const dropH = Math.min(260, filtered.length * 44 + 52);
        const top = spaceBelow >= dropH ? rect.bottom + 4 : rect.top - dropH - 4;
        setDropdownStyle({ top, left: rect.left, width: rect.width });
      }
    };
    window.addEventListener("scroll", recalc, true);
    window.addEventListener("resize", recalc);
    return () => {
      window.removeEventListener("scroll", recalc, true);
      window.removeEventListener("resize", recalc);
    };
  }, [isOpen, filtered.length]);

  return (
    <div className="relative w-full text-left font-sans">
      <button
        ref={buttonRef}
        type="button"
        onClick={() => (isOpen ? setIsOpen(false) : openDropdown())}
        className="w-full flex items-center justify-between bg-white text-xs border border-slate-300 rounded py-1.5 px-3 focus:outline-none focus:ring-2 focus:ring-purple-500/10 focus:border-purple-600 transition-all text-slate-800 font-medium"
      >
        <span className="truncate">
          {selectedItem ? `${selectedItem.code} - ${selectedItem.name}` : placeholder}
        </span>
        <span className="ml-2 text-slate-400 text-[9px]">{isOpen ? "▲" : "▼"}</span>
      </button>

      {isOpen && dropdownStyle && (
        <>
          {/* Backdrop to close on outside click */}
          <div className="fixed inset-0 z-[60]" onClick={() => { setIsOpen(false); setSearch(""); }} />

          {/* Fixed-position dropdown — escapes all overflow contexts */}
          <div
            className="fixed z-[70] bg-white border border-slate-200 rounded-lg shadow-2xl overflow-hidden animate-in fade-in slide-in-from-top-1 duration-100"
            style={{
              top: dropdownStyle.top,
              left: dropdownStyle.left,
              width: dropdownStyle.width,
              maxHeight: "260px",
              display: "flex",
              flexDirection: "column",
            }}
          >
            {/* Search input – always visible at top */}
            <div className="p-2 border-b border-slate-100 bg-white flex-shrink-0">
              <input
                autoFocus
                type="text"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Search product code/name..."
                className="w-full text-xs border border-slate-300 rounded px-2.5 py-1.5 focus:outline-none focus:ring-1 focus:ring-purple-600 focus:border-purple-600 font-medium text-slate-800"
                onClick={(e) => e.stopPropagation()}
              />
            </div>

            {/* Scrollable list */}
            <ul className="overflow-y-auto py-1 flex-1">
              {filtered.length === 0 ? (
                <li className="px-3 py-2 text-xs text-slate-500 text-center">No products found</li>
              ) : (
                filtered.map((item) => (
                  <li
                    key={item.code}
                    onClick={() => {
                      onChange(item);
                      setIsOpen(false);
                      setSearch("");
                    }}
                    className={`px-3 py-2.5 text-xs cursor-pointer hover:bg-purple-50 hover:text-purple-700 transition-colors border-b border-slate-50 last:border-0 ${
                      item.code === value ? "bg-purple-100/50 text-purple-700 font-semibold" : "text-slate-700"
                    }`}
                  >
                    <div className="font-semibold">{item.code}</div>
                    <div className="text-[10px] text-slate-500 truncate mt-0.5">{item.name}</div>
                  </li>
                ))
              )}
            </ul>
          </div>
        </>
      )}
    </div>
  );
}

export default function PurchasePage() {
  const [purchases, setPurchases] = useState<PurchaseRecord[]>([]);
  const [inventoryItems, setInventoryItems] = useState<InventoryItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [isFormOpen, setIsFormOpen] = useState(false);
  const [dbStatus, setDbStatus] = useState<"connected" | "local">("connected");
  const [editingPurchase, setEditingPurchase] = useState<PurchaseRecord | null>(null);

  // Search & Filter state
  const [searchQuery, setSearchQuery] = useState("");
  const [statusFilter, setStatusFilter] = useState<string>("All");
  const [currentPage, setCurrentPage] = useState(1);
  const itemsPerPage = 10;

  // Reset pagination to page 1 on search or filter change
  useEffect(() => {
    const timer = setTimeout(() => {
      setCurrentPage(1);
    }, 0);
    return () => clearTimeout(timer);
  }, [searchQuery, statusFilter]);

  // Form states
  const [serialNo, setSerialNo] = useState("");  // internal serial / ref number
  const [invoiceNo, setInvoiceNo] = useState(""); // unique bill number
  const [supplierName, setSupplierName] = useState("");
  const [isCustomSupplier, setIsCustomSupplier] = useState(false);
  const [customSupplierText, setCustomSupplierText] = useState("");
  const [purchaseType, setPurchaseType] = useState("Local Purchase");
  const [branchGodown, setBranchGodown] = useState("Shop (Main Showroom)");
  const [entryDate, setEntryDate] = useState(new Date().toISOString().split("T")[0]);
  const [invoiceDate, setInvoiceDate] = useState(new Date().toISOString().split("T")[0]);
  const [vehicleNo, setVehicleNo] = useState("");
  const [expenses, setExpenses] = useState("");
  const [paidAmount, setPaidAmount] = useState("");
  const [paymentStatus, setPaymentStatus] = useState<PaymentStatus>("Pending");

  // Dynamic Item Grid
  const [gridItems, setGridItems] = useState<PurchaseItem[]>([
    { code: "", name: "", hsn_code: "", qty: 1, unit: "Nos", rate: 0, disc: 0, sgst: 9, cgst: 9 },
  ]);

  const [formError, setFormError] = useState<string | null>(null);
  const [successMsg, setSuccessMsg] = useState<string | null>(null);
  const [viewingPurchase, setViewingPurchase] = useState<PurchaseRecord | null>(null);
  const [isReportModalOpen, setIsReportModalOpen] = useState(false);
  const [reportMode, setReportMode] = useState<PurchaseReportMode>("full");
  const [reportDate, setReportDate] = useState(todayIso());
  const [reportMonth, setReportMonth] = useState(() => todayIso().slice(0, 7));
  const [reportFrom, setReportFrom] = useState(todayIso());
  const [reportTo, setReportTo] = useState(todayIso());
  const [reportError, setReportError] = useState<string | null>(null);
  const [reportBusy, setReportBusy] = useState(false);

  // Dynamic lists
  const availableSuppliers = useMemo(() => {
    const uniqueFromDB = purchases.map((p) => p.supplier_name);
    return Array.from(new Set([...SEED_SUPPLIERS, ...uniqueFromDB])).filter(Boolean);
  }, [purchases]);

  const loadLocalPurchases = useCallback(() => {
    const local = localStorage.getItem("kaniyamparambil_purchases");
    if (local) {
      try {
        const parsed = JSON.parse(local);
        setPurchases(
          Array.isArray(parsed)
            ? parsed.map((r: Record<string, unknown>) => normalizePurchase(r))
            : []
        );
      } catch {
        setPurchases([]);
      }
    } else {
      // Seed some starter purchases
      const seed: PurchaseRecord[] = [
        {
          invoice_no: "20261011",
          supplier_name: "Jindal Steel & Power Ltd.",
          purchase_type: "Local Purchase",
          branch_godown: "Central Godown A",
          entry_date: "2026-06-10",
          invoice_date: "2026-06-10",
          vehicle_no: "KL-07-CS-9902",
          items: [
            {
              code: "ITM-001",
              name: "Premium Steel Conduit Pipe 1/2\"",
              hsn_code: "",
              qty: 50,
              unit: "Mtr",
              rate: 2500,
              disc: 1250,
              sgst: 9,
              cgst: 9,
            },
          ],
          expenses: 1500,
          subtotal: 125000,
          total_discount: 1250,
          total_sgst: 11137.5,
          total_cgst: 11137.5,
          net_amount: 147575,
          paid_amount: 147575,
          payment_status: "Paid",
        },
      ];
      localStorage.setItem("kaniyamparambil_purchases", JSON.stringify(seed));
      setPurchases(seed);
    }
  }, []);

  const fetchInventory = useCallback(async () => {
    try {
      const { data, error } = await supabase
        .from("inventory")
        .select("*")
        .order("name", { ascending: true });
      if (error) {
        // Fallback local
        const local = localStorage.getItem("kaniyamparambil_inventory");
        if (local) setInventoryItems(JSON.parse(local));
      } else if (data) {
        setInventoryItems(data);
      }
    } catch {
      const local = localStorage.getItem("kaniyamparambil_inventory");
      if (local) {
        try {
          setInventoryItems(JSON.parse(local));
        } catch {
          setInventoryItems([]);
        }
      }
    }
  }, []);

  const fetchPurchases = useCallback(async () => {
    try {
      setLoading(true);
      const { data, error } = await supabase
        .from("purchases")
        .select("*")
        .order("created_at", { ascending: false });

      if (error) {
        setDbStatus("local");
        loadLocalPurchases();
      } else if (data) {
        setPurchases(
          (data as Record<string, unknown>[]).map((r) => normalizePurchase(r))
        );
        setDbStatus("connected");
      }
    } catch (err) {
      console.error("Failed to connect to Supabase database:", err);
      setDbStatus("local");
      loadLocalPurchases();
    } finally {
      setLoading(false);
    }
  }, [loadLocalPurchases]);

  useEffect(() => {
    const timer = setTimeout(() => {
      fetchPurchases();
      fetchInventory();
    }, 0);
    return () => clearTimeout(timer);
  }, [fetchPurchases, fetchInventory]);

  // Item Grid Actions
  const addGridRow = () => {
    setGridItems([
      ...gridItems,
      { code: "", name: "", hsn_code: "", qty: 1, unit: "Nos", rate: 0, disc: 0, sgst: 9, cgst: 9 },
    ]);
  };

  const removeGridRow = (index: number) => {
    if (gridItems.length === 1) return;
    setGridItems(gridItems.filter((_, idx) => idx !== index));
  };

  const updateGridRow = (
    index: number,
    key: keyof PurchaseItem,
    value: string | number
  ) => {
    const updated = gridItems.map((item, idx) => {
      if (idx === index) {
        return { ...item, [key]: value };
      }
      return item;
    });
    setGridItems(updated);
  };

  const handleProductSelect = (index: number, product: InventoryItem) => {
    const updated = gridItems.map((item, idx) => {
      if (idx === index) {
        return {
          ...item,
          code: product.code,
          name: product.name,
          hsn_code: product.hsn_code ?? "",
          unit: product.uom,
          rate: 0,
          disc: 0,
          sgst: 9,
          cgst: 9,
        };
      }
      return item;
    });
    setGridItems(updated);
  };

  // Calculations
  const calculatedTotals = useMemo(() => {
    let sub = 0;
    let totalDiscount = 0;
    let totalSgst = 0;
    let totalCgst = 0;

    gridItems.forEach((item) => {
      const lineBase = item.qty * item.rate;
      const lineDisc = Number(item.disc) || 0;
      const taxable = Math.max(0, lineBase - lineDisc);
      const lineSgst = taxable * ((item.sgst ?? 0) / 100);
      const lineCgst = taxable * ((item.cgst ?? 0) / 100);

      sub += lineBase;
      totalDiscount += lineDisc;
      totalSgst += lineSgst;
      totalCgst += lineCgst;
    });

    const extra = Number(expenses) || 0;
    const net = sub - totalDiscount + totalSgst + totalCgst + extra;

    return {
      subtotal: sub,
      discount: totalDiscount,
      totalSgst: Math.round(totalSgst * 100) / 100,
      totalCgst: Math.round(totalCgst * 100) / 100,
      netAmount: Math.round(net * 100) / 100,
    };
  }, [gridItems, expenses]);

  // Auto-populate paid amount for new bills only (do not overwrite when editing)
  useEffect(() => {
    if (!editingPurchase && calculatedTotals.netAmount > 0) {
      setPaidAmount(String(calculatedTotals.netAmount));
      setPaymentStatus("Paid");
    }
  }, [calculatedTotals.netAmount, editingPurchase]);

  const handlePaymentStatusChange = (status: PaymentStatus) => {
    setPaymentStatus(status);
    if (status === "Paid") {
      setPaidAmount(String(calculatedTotals.netAmount));
    } else if (status === "Pending") {
      setPaidAmount("0");
    }
  };

  const handlePaidAmountChange = (value: string) => {
    setPaidAmount(value);
    const paidNum = Number(value) || 0;
    const net = calculatedTotals.netAmount;
    if (net <= 0) return;
    if (paidNum >= net) setPaymentStatus("Paid");
    else if (paidNum > 0) setPaymentStatus("Partial");
    else setPaymentStatus("Pending");
  };

  // Submit Handler: Creates or Updates Purchases & Stock Quantities
  const handleSubmitForm = async (e: React.FormEvent) => {
    e.preventDefault();
    setFormError(null);
    setSuccessMsg(null);

    // Validations
    const invoiceNumClean = invoiceNo.trim();
    if (!invoiceNumClean) {
      setFormError("Invoice Number is required.");
      return;
    }

    const supplierFinal = isCustomSupplier
      ? customSupplierText.trim()
      : supplierName.trim();
    if (!supplierFinal) {
      setFormError("Please select or specify a Supplier.");
      return;
    }

    if (gridItems.some((i) => !i.code || i.qty <= 0 || i.rate <= 0)) {
      setFormError("All items in the grid must have a selected product, quantity, and rate.");
      return;
    }

    const expensesNum = Number(expenses) || 0;
    let paidNum = Number(paidAmount) || 0;
    let status: PaymentStatus = paymentStatus;

    if (paymentStatus === "Paid") {
      paidNum = calculatedTotals.netAmount;
    } else if (paymentStatus === "Pending") {
      paidNum = 0;
    } else if (paidNum <= 0 || paidNum >= calculatedTotals.netAmount) {
      setFormError("Partial payment must be greater than ₹0 and less than the net amount.");
      return;
    }

    status = paidNum >= calculatedTotals.netAmount ? "Paid" : paidNum > 0 ? "Partial" : "Pending";

    const payload: PurchaseRecord = {
      invoice_no: invoiceNumClean,
      serial_no: serialNo.trim() || undefined,
      supplier_name: supplierFinal,
      purchase_type: purchaseType,
      branch_godown: branchGodown,
      entry_date: entryDate,
      invoice_date: invoiceDate,
      vehicle_no: vehicleNo.trim() || undefined,
      items: gridItems,
      expenses: expensesNum,
      subtotal: calculatedTotals.subtotal,
      total_discount: calculatedTotals.discount,
      total_sgst: calculatedTotals.totalSgst,
      total_cgst: calculatedTotals.totalCgst,
      net_amount: calculatedTotals.netAmount,
      paid_amount: paidNum,
      payment_status: status,
    };

    if (editingPurchase) {
      // UPDATE MODE
      if (dbStatus === "connected") {
        try {
          // 1. Fetch old record to calculate stock adjustments (decrementing old quantities)
          const { data: oldPurchase } = await supabase
            .from("purchases")
            .select("items")
            .eq("invoice_no", editingPurchase.invoice_no)
            .single();

          // 2. Perform DB Updates
          const { error } = await supabase
            .from("purchases")
            .update(payload)
            .eq("invoice_no", editingPurchase.invoice_no);
          if (error) throw error;

          // 3. Stock Level Reversion (Old) & Addition (New)
          if (oldPurchase && oldPurchase.items) {
            for (const oldItem of oldPurchase.items as PurchaseItem[]) {
              const { data: cur } = await supabase
                .from("inventory")
                .select("stock_qty")
                .eq("code", oldItem.code)
                .single();
              const oldStock = cur?.stock_qty || 0;
              await supabase
                .from("inventory")
                .update({ stock_qty: Math.max(0, oldStock - oldItem.qty) })
                .eq("code", oldItem.code);
            }
          }
          for (const newItem of gridItems) {
            const { data: cur } = await supabase
              .from("inventory")
              .select("stock_qty")
              .eq("code", newItem.code)
              .single();
            const oldStock = cur?.stock_qty || 0;
            await supabase
              .from("inventory")
              .update({ stock_qty: oldStock + newItem.qty })
              .eq("code", newItem.code);
          }

          setSuccessMsg(`Successfully updated Invoice No. "${payload.invoice_no}"!`);
          fetchPurchases();
          fetchInventory();
          resetForm();
        } catch (err) {
          console.error("Supabase update error:", err);
          const errMsg = err instanceof Error ? err.message : "Failed to update bill.";
          setFormError(`Supabase error: ${errMsg}`);
        }
      } else {
        // Local path
        const updated = purchases.map((p) =>
          p.invoice_no === editingPurchase.invoice_no ? payload : p
        );
        localStorage.setItem("kaniyamparambil_purchases", JSON.stringify(updated));

        // Adjust local inventory stock counts
        const localInv = localStorage.getItem("kaniyamparambil_inventory");
        if (localInv) {
          try {
            const itemsArr = JSON.parse(localInv);
            const reverted = itemsArr.map((i: InventoryItem) => {
              const match = editingPurchase.items.find((oi) => oi.code === i.code);
              if (match) {
                return { ...i, stock_qty: Math.max(0, (i.stock_qty || 0) - match.qty) };
              }
              return i;
            });
            const updatedInv = reverted.map((i: InventoryItem) => {
              const match = gridItems.find((ni) => ni.code === i.code);
              if (match) {
                return { ...i, stock_qty: (i.stock_qty || 0) + match.qty };
              }
              return i;
            });
            localStorage.setItem("kaniyamparambil_inventory", JSON.stringify(updatedInv));
          } catch (err) {
            console.error("Failed to update local stock:", err);
          }
        }

        setPurchases(updated);
        setSuccessMsg(`Updated Invoice No. "${payload.invoice_no}" in Local Storage!`);
        fetchInventory();
        resetForm();
      }
    } else {
      // CREATE MODE
      if (purchases.some((p) => p.invoice_no === payload.invoice_no)) {
        setFormError(`Invoice No. '${payload.invoice_no}' is already registered.`);
        return;
      }

      if (dbStatus === "connected") {
        try {
          const { error } = await supabase.from("purchases").insert([payload]);
          if (error) throw error;

          // Increment stock counts
          for (const item of gridItems) {
            const { data: cur } = await supabase
              .from("inventory")
              .select("stock_qty")
              .eq("code", item.code)
              .single();
            const oldStock = cur?.stock_qty || 0;
            await supabase
              .from("inventory")
              .update({ stock_qty: oldStock + item.qty })
              .eq("code", item.code);
          }

          setSuccessMsg(`Successfully registered Invoice No. "${payload.invoice_no}"!`);
          fetchPurchases();
          fetchInventory();
          resetForm();
        } catch (err) {
          console.error("Supabase insert error:", err);
          const errMsg = err instanceof Error ? err.message : "Failed to log bill.";
          setFormError(`Supabase error: ${errMsg}`);
        }
      } else {
        // Local Storage Create
        const updated = [payload, ...purchases];
        localStorage.setItem("kaniyamparambil_purchases", JSON.stringify(updated));

        const localInv = localStorage.getItem("kaniyamparambil_inventory");
        if (localInv) {
          try {
            const itemsArr = JSON.parse(localInv);
            const updatedInv = itemsArr.map((i: InventoryItem) => {
              const match = gridItems.find((ni) => ni.code === i.code);
              if (match) {
                return { ...i, stock_qty: (i.stock_qty || 0) + match.qty };
              }
              return i;
            });
            localStorage.setItem("kaniyamparambil_inventory", JSON.stringify(updatedInv));
          } catch (err) {
            console.error("Failed to update local stock:", err);
          }
        }

        setPurchases(updated);
        setSuccessMsg(`Saved Invoice No. "${payload.invoice_no}" to Local Storage!`);
        fetchInventory();
        resetForm();
      }
    }
  };

  const handleStartEdit = (rec: PurchaseRecord) => {
    setEditingPurchase(rec);
    setSerialNo(rec.serial_no || "");
    setInvoiceNo(rec.invoice_no);

    if (SEED_SUPPLIERS.includes(rec.supplier_name)) {
      setSupplierName(rec.supplier_name);
      setIsCustomSupplier(false);
    } else {
      setSupplierName("CUSTOM_OPTION");
      setIsCustomSupplier(true);
      setCustomSupplierText(rec.supplier_name);
    }

    setPurchaseType(rec.purchase_type);
    setBranchGodown(rec.branch_godown);
    setEntryDate(rec.entry_date);
    setInvoiceDate(rec.invoice_date);
    setVehicleNo(rec.vehicle_no || "");
    setExpenses(String(rec.expenses));
    setPaidAmount(String(rec.paid_amount));
    setPaymentStatus(
      rec.payment_status === "Paid" || rec.payment_status === "Partial"
        ? rec.payment_status
        : "Pending",
    );
    setGridItems(rec.items);
    setIsFormOpen(true);
  };

  const handlePrintPurchase = async (rec: PurchaseRecord) => {
    try {
      await printPurchaseHtml(buildPurchaseHtml(rec, {
        renderMode: "pdf",
        helperText: "Purchase bill print preview.",
      }));
    } catch (err) {
      alert(`Print failed: ${err instanceof Error ? err.message : "Unknown error"}`);
    }
  };

  const handleDownloadPurchase = async (rec: PurchaseRecord) => {
    try {
      await exportPurchasePdf(
        buildPurchaseHtml(rec, { renderMode: "pdf" }),
        `purchase_bill_${rec.invoice_no}.pdf`,
      );
    } catch (err) {
      alert(`PDF download failed: ${err instanceof Error ? err.message : "Unknown error"}`);
    }
  };

  const handleDeletePurchase = async (invoiceNoToDelete: string) => {
    if (!window.confirm(`Are you sure you want to delete purchase invoice "${invoiceNoToDelete}"?`)) {
      return;
    }

    const toDelete = purchases.find((p) => p.invoice_no === invoiceNoToDelete);

    if (dbStatus === "connected") {
      try {
        const { error } = await supabase.from("purchases").delete().eq("invoice_no", invoiceNoToDelete);
        if (error) throw error;

        // Revert stock levels
        if (toDelete && toDelete.items) {
          for (const item of toDelete.items) {
            const { data: cur } = await supabase
              .from("inventory")
              .select("stock_qty")
              .eq("code", item.code)
              .single();
            const oldStock = cur?.stock_qty || 0;
            await supabase
              .from("inventory")
              .update({ stock_qty: Math.max(0, oldStock - item.qty) })
              .eq("code", item.code);
          }
        }

        fetchPurchases();
        fetchInventory();
      } catch (err) {
        console.error("Delete failed from Supabase:", err);
        const errMsg = err instanceof Error ? err.message : "Unknown error occurred.";
        alert(`Failed to delete invoice: ${errMsg}`);
      }
    } else {
      // Local revert
      const updated = purchases.filter((p) => p.invoice_no !== invoiceNoToDelete);
      localStorage.setItem("kaniyamparambil_purchases", JSON.stringify(updated));

      const localInv = localStorage.getItem("kaniyamparambil_inventory");
      if (localInv && toDelete) {
        try {
          const itemsArr = JSON.parse(localInv);
          const updatedInv = itemsArr.map((i: InventoryItem) => {
            const match = toDelete.items.find((pi) => pi.code === i.code);
            if (match) {
              return { ...i, stock_qty: Math.max(0, (i.stock_qty || 0) - match.qty) };
            }
            return i;
          });
          localStorage.setItem("kaniyamparambil_inventory", JSON.stringify(updatedInv));
        } catch (err) {
          console.error("Failed to revert local stock:", err);
        }
      }

      setPurchases(updated);
      fetchInventory();
    }
  };

  const resetForm = () => {
    setSerialNo("");
    setInvoiceNo("");
    setSupplierName("");
    setIsCustomSupplier(false);
    setCustomSupplierText("");
    setPurchaseType("Local Purchase");
    setBranchGodown("Shop (Main Showroom)");
    setEntryDate(new Date().toISOString().split("T")[0]);
    setInvoiceDate(new Date().toISOString().split("T")[0]);
    setVehicleNo("");
    setExpenses("");
    setPaidAmount("");
    setPaymentStatus("Pending");
    setGridItems([{ code: "", name: "", hsn_code: "", qty: 1, unit: "Nos", rate: 0, disc: 0, sgst: 9, cgst: 9 }]);
    setEditingPurchase(null);
    setIsFormOpen(false);
    setTimeout(() => setSuccessMsg(null), 4000);
  };

  const filteredPurchases = purchases.filter((p) => {
    const q = searchQuery.toLowerCase();
    const matchesSearch =
      (p.invoice_no ?? "").toLowerCase().includes(q) ||
      (p.supplier_name ?? "").toLowerCase().includes(q);
    const matchesStatus = statusFilter === "All" || p.payment_status === statusFilter;
    return matchesSearch && matchesStatus;
  });

  const totalPages = Math.ceil(filteredPurchases.length / itemsPerPage);
  const indexOfLastItem = currentPage * itemsPerPage;
  const indexOfFirstItem = indexOfLastItem - itemsPerPage;
  const currentPurchases = filteredPurchases.slice(indexOfFirstItem, indexOfLastItem);

  const resolvePurchaseStatementReport = (): {
    records: PurchaseRecord[];
    reportType: string;
    periodLabel: string;
    filenameSuffix: string;
  } | null => {
    const applyStatus = (list: PurchaseRecord[]) =>
      statusFilter === "All" ? list : list.filter((p) => p.payment_status === statusFilter);

    switch (reportMode) {
      case "full":
        return {
          records: applyStatus([...purchases]),
          reportType: "Complete Purchase Register",
          periodLabel: "All Bills (Full Register)",
          filenameSuffix: `full_${todayIso()}`,
        };
      case "current":
        return {
          records: [...filteredPurchases],
          reportType: "Filtered Table View",
          periodLabel: `Current filters — Status: ${statusFilter}, Search: ${searchQuery.trim() || "—"}`,
          filenameSuffix: `filtered_${todayIso()}`,
        };
      case "date": {
        const dated = applyStatus(filterPurchasesByDate(purchases, reportDate));
        return {
          records: dated,
          reportType: "Daily Purchase Statement",
          periodLabel: formatDocDate(reportDate),
          filenameSuffix: `date_${reportDate}`,
        };
      }
      case "month": {
        const monthly = applyStatus(filterPurchasesByMonth(purchases, reportMonth));
        return {
          records: monthly,
          reportType: "Monthly Purchase Statement",
          periodLabel: formatMonthLabel(reportMonth),
          filenameSuffix: `month_${reportMonth}`,
        };
      }
      case "range": {
        if (reportFrom > reportTo) {
          setReportError("From date cannot be after To date.");
          return null;
        }
        const ranged = applyStatus(filterPurchasesByRange(purchases, reportFrom, reportTo));
        return {
          records: ranged,
          reportType: "Date Range Purchase Statement",
          periodLabel: `${formatDocDate(reportFrom)} to ${formatDocDate(reportTo)}`,
          filenameSuffix: `${reportFrom}_to_${reportTo}`,
        };
      }
      default:
        return null;
    }
  };

  const buildPurchaseStatementDocument = () => {
    const report = resolvePurchaseStatementReport();
    if (!report) return null;
    if (report.records.length === 0) {
      setReportError("No purchase bills match the selected statement period.");
      return null;
    }
    setReportError(null);
    return buildPurchaseStatementHtml(
      report.records,
      buildPurchaseStatementMeta(
        report.records,
        report.reportType,
        report.periodLabel,
        statusFilter,
        searchQuery.trim(),
      ),
      { renderMode: "pdf", helperText: "Generating purchase statement PDF..." },
    );
  };

  const handlePrintStatement = async () => {
    setReportBusy(true);
    const report = resolvePurchaseStatementReport();
    if (!report) { setReportBusy(false); return; }
    const html = buildPurchaseStatementDocument();
    if (!html) { setReportBusy(false); return; }
    try {
      await printPurchaseHtml(html, ".purchase-statement-sheet");
      setIsReportModalOpen(false);
    } catch (err) {
      setReportError(err instanceof Error ? err.message : "Print failed.");
    } finally {
      setReportBusy(false);
    }
  };

  const handleDownloadStatement = async () => {
    setReportBusy(true);
    const report = resolvePurchaseStatementReport();
    if (!report) { setReportBusy(false); return; }
    const html = buildPurchaseStatementDocument();
    if (!html) { setReportBusy(false); return; }
    try {
      await exportPurchasePdf(
        html,
        `purchase_statement_${report.filenameSuffix}.pdf`,
        ".purchase-statement-sheet",
        false,
      );
      setIsReportModalOpen(false);
    } catch (err) {
      setReportError(err instanceof Error ? err.message : "PDF download failed.");
    } finally {
      setReportBusy(false);
    }
  };

  return (
    <div className="p-6 space-y-6">
      {/* ── Page Header ── */}
      <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-4">
        <div>
          <h1 className="text-page-title font-semibold text-text-primary flex items-center gap-2">
            <ShoppingCart className="w-6 h-6 text-purple-600" />
            Purchase Details
          </h1>
          <p className="text-caption text-text-secondary mt-0.5">
            Log supplier invoices, manage outstanding wholesaler bills, and track procurement expenses.
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <button
            type="button"
            onClick={() => { setReportError(null); setIsReportModalOpen(true); }}
            disabled={loading}
            className="btn-secondary px-3 py-2 text-xs flex items-center gap-1.5"
          >
            <FileText className="w-3.5 h-3.5" />
            Purchase Statement
          </button>
          <button
            onClick={() => {
              resetForm();
              setIsFormOpen(true);
            }}
            className="btn-primary bg-purple-600 hover:bg-purple-700 active:bg-purple-800 flex items-center gap-1.5 shadow-sm"
          >
            <Plus className="w-4 h-4" />
            Log New Purchase
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
              The `purchases` table was not found in your Supabase database. Records are currently stored locally.
              Run this SQL in your Supabase Editor to sync across devices:
            </p>
            <pre className="text-[10px] font-mono bg-blue-900/5 text-blue-900 border border-blue-200 p-2.5 rounded-md mt-2 overflow-x-auto select-all max-w-full">
              {`CREATE TABLE public.purchases (
  invoice_no      text PRIMARY KEY,
  serial_no       text,
  supplier_name   text NOT NULL,
  purchase_type   text NOT NULL DEFAULT 'Local Purchase',
  branch_godown   text NOT NULL DEFAULT 'Shop (Main Showroom)',
  entry_date      date NOT NULL,
  invoice_date    date NOT NULL,
  vehicle_no      text,
  items           jsonb NOT NULL DEFAULT '[]',
  expenses        numeric NOT NULL DEFAULT 0,
  subtotal        numeric NOT NULL DEFAULT 0,
  total_discount  numeric NOT NULL DEFAULT 0,
  total_sgst      numeric NOT NULL DEFAULT 0,
  total_cgst      numeric NOT NULL DEFAULT 0,
  net_amount      numeric NOT NULL DEFAULT 0,
  paid_amount     numeric NOT NULL DEFAULT 0,
  payment_status  text NOT NULL DEFAULT 'Pending',
  created_at      timestamptz DEFAULT timezone('utc', now()) NOT NULL
);`}
            </pre>
          </div>
        </div>
      )}

      {/* ── Popup Modal for Log/Edit Purchase ── */}
      {isFormOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/50 backdrop-blur-sm animate-fade-in">
          <div className="bg-white border border-slate-200 rounded-xl shadow-2xl relative max-w-5xl w-full max-h-[90vh] overflow-y-auto flex flex-col font-sans animate-in zoom-in-95 duration-150">
            {/* Header */}
            <div className="bg-slate-950 px-6 py-4 text-white flex items-center justify-between sticky top-0 z-20 shadow-md">
              <div>
                <h2 className="text-sm font-bold tracking-tight">
                  {editingPurchase ? "Edit Wholesaler/Supplier Purchase Bill" : "Log Wholesaler/Supplier Purchase Bill"}
                </h2>
                <p className="text-[10px] text-slate-300 mt-0.5">
                  {editingPurchase
                    ? `Modifying details for Invoice No: ${editingPurchase.invoice_no}`
                    : "Record incoming shipments, supplier invoices, and total billing details."}
                </p>
              </div>
              <button
                type="button"
                onClick={resetForm}
                className="text-slate-300 hover:text-white p-1.5 rounded-lg hover:bg-white/10 transition-colors"
                aria-label="Close modal"
              >
                <X className="w-4.5 h-4.5" />
              </button>
            </div>

            {/* Form Content */}
            <form onSubmit={handleSubmitForm} className="p-6 space-y-6 flex-1">
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

              {/* ── Section 1: Header (Invoice Details) ── */}
              <div className="bg-slate-50 border border-slate-200/80 rounded-xl p-4 space-y-4">
                <h3 className="text-xs font-bold uppercase tracking-wider text-slate-500 border-b border-slate-200 pb-1.5">
                  1. Invoice Header Metadata
                </h3>
                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                  {/* Supplier searchable select/combobox */}
                  <div>
                    <label className="form-label text-xs text-slate-700 font-semibold mb-1 block">Supplier / Vendor *</label>
                    <div className="flex flex-col gap-1.5">
                      {!isCustomSupplier ? (
                        <div className="flex gap-2">
                          <select
                            value={supplierName}
                            onChange={(e) => {
                              if (e.target.value === "CUSTOM_OPTION") {
                                setIsCustomSupplier(true);
                              } else {
                                setSupplierName(e.target.value);
                              }
                            }}
                            className="input-enterprise bg-white cursor-pointer w-full text-xs font-medium"
                            required
                          >
                            <option value="">-- Choose Wholesaler --</option>
                            {availableSuppliers.map((sup) => (
                              <option key={sup} value={sup}>
                                {sup}
                              </option>
                            ))}
                            <option value="CUSTOM_OPTION" className="text-purple-700 font-bold">
                              + Add New Supplier / Vendor
                            </option>
                          </select>
                        </div>
                      ) : (
                        <div className="flex gap-2 items-center">
                          <input
                            type="text"
                            value={customSupplierText}
                            onChange={(e) => setCustomSupplierText(e.target.value)}
                            placeholder="Type Vendor name (alphanumeric)"
                            className="input-enterprise w-full text-xs"
                            required
                          />
                          <button
                            type="button"
                            onClick={() => {
                              setIsCustomSupplier(false);
                              setCustomSupplierText("");
                            }}
                            className="text-[10px] text-slate-500 hover:text-slate-800 underline font-bold"
                          >
                            Cancel
                          </button>
                        </div>
                      )}
                    </div>
                  </div>

                  {/* Purchase Type */}
                  <div>
                    <label className="form-label text-xs text-slate-700 font-semibold mb-1 block">Purchase Type *</label>
                    <select
                      value={purchaseType}
                      onChange={(e) => setPurchaseType(e.target.value)}
                      className="input-enterprise bg-white cursor-pointer text-xs"
                      required
                    >
                      {PURCHASE_TYPES.map((type) => (
                        <option key={type} value={type}>
                          {type}
                        </option>
                      ))}
                    </select>
                  </div>

                  {/* Branch/Godown */}
                  <div>
                    <label className="form-label text-xs text-slate-700 font-semibold mb-1 block">Branch / Godown (Destination) *</label>
                    <select
                      value={branchGodown}
                      onChange={(e) => setBranchGodown(e.target.value)}
                      className="input-enterprise bg-white cursor-pointer text-xs"
                      required
                    >
                      {BRANCHES_GODOWNS.map((b) => (
                        <option key={b} value={b}>
                          {b}
                        </option>
                      ))}
                    </select>
                  </div>

                  {/* Serial No */}
                  <div>
                    <label className="form-label text-xs text-slate-700 font-semibold mb-1 block">Serial No. (Internal Ref)</label>
                    <input
                      type="text"
                      value={serialNo}
                      onChange={(e) => setSerialNo(e.target.value)}
                      placeholder="e.g. SR-2026-001"
                      className="input-enterprise font-mono text-xs"
                    />
                  </div>

                  {/* Invoice No */}
                  <div>
                    <label className="form-label text-xs text-slate-700 font-semibold mb-1 block">Invoice No. *</label>
                    <input
                      type="text"
                      value={invoiceNo}
                      onChange={(e) => setInvoiceNo(e.target.value)}
                      placeholder="e.g. INV-2026-001 or 290123"
                      className="input-enterprise font-mono text-xs"
                      disabled={!!editingPurchase}
                      required
                    />
                  </div>

                  {/* Pur. Entry Date */}
                  <div>
                    <label className="form-label text-xs text-slate-700 font-semibold mb-1 block">Pur. Entry Date *</label>
                    <input
                      type="date"
                      value={entryDate}
                      onChange={(e) => setEntryDate(e.target.value)}
                      className="input-enterprise font-mono text-xs cursor-pointer focus:ring-purple-600"
                      required
                    />
                  </div>

                  {/* Invoice Date */}
                  <div>
                    <label className="form-label text-xs text-slate-700 font-semibold mb-1 block">Invoice Date *</label>
                    <input
                      type="date"
                      value={invoiceDate}
                      onChange={(e) => setInvoiceDate(e.target.value)}
                      className="input-enterprise font-mono text-xs cursor-pointer focus:ring-purple-600"
                      required
                    />
                  </div>

                  {/* Vehicle No */}
                  <div>
                    <label className="form-label text-xs text-slate-700 font-semibold mb-1 block">Vehicle Number (Optional)</label>
                    <div className="relative">
                      <Truck className="w-3.5 h-3.5 absolute left-3 top-3 text-slate-400" />
                      <input
                        type="text"
                        value={vehicleNo}
                        onChange={(e) => setVehicleNo(e.target.value.toUpperCase())}
                        placeholder="e.g. KL-07-CD-1122"
                        className="input-enterprise pl-9 font-mono text-xs"
                      />
                    </div>
                  </div>
                </div>
              </div>

              {/* ── Section 2: Item Grid (Product Entry) ── */}
              <div className="border border-slate-200 rounded-xl p-4 space-y-4">
                <div className="flex items-center justify-between border-b border-slate-200 pb-2">
                  <h3 className="text-xs font-bold uppercase tracking-wider text-slate-500">
                    2. Product Entry Grid
                  </h3>
                  <button
                    type="button"
                    onClick={addGridRow}
                    className="btn-secondary px-3 py-1 flex items-center gap-1.5 text-xs text-purple-700 border-purple-200 hover:bg-purple-50 font-bold"
                  >
                    <Plus className="w-3.5 h-3.5" />
                    Add Product Row
                  </button>
                </div>

                <div className="overflow-x-auto min-h-[150px]">
                  <table className="w-full text-[11px] font-sans border-collapse">
                    <thead>
                      <tr className="bg-slate-100/80 text-slate-700 border-b border-slate-200 text-left font-semibold">
                        <th className="p-2 w-[240px]">Code / Product Description</th>
                        <th className="p-2 w-[90px] text-center">HSN Code</th>
                        <th className="p-2 w-[55px] text-center">Qty</th>
                        <th className="p-2 w-[55px] text-center">Unit</th>
                        <th className="p-2 w-[85px] text-right">Rate (₹)</th>
                        <th className="p-2 w-[85px] text-right">Amount (₹)</th>
                        <th className="p-2 w-[75px] text-right">Disc (₹)</th>
                        <th className="p-2 w-[60px] text-center">SGST%</th>
                        <th className="p-2 w-[60px] text-center">CGST%</th>
                        <th className="p-2 w-[80px] text-right">S-Rate (₹)</th>
                        <th className="p-2 w-[80px] text-right">MRP (₹)</th>
                        <th className="p-2 w-[40px] text-center">Del</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-100">
                      {gridItems.map((item, idx) => (
                        <tr key={idx} className="hover:bg-slate-50/50 transition-colors">
                          {/* Searchable Product Select */}
                          <td className="p-2">
                            <SearchableProductSelect
                              items={inventoryItems}
                              value={item.code}
                              onChange={(prod) => handleProductSelect(idx, prod)}
                              placeholder="Search catalog by name or code..."
                            />
                          </td>

                          {/* HSN Code */}
                          <td className="p-2 text-center">
                            <input
                              type="text"
                              value={item.hsn_code ?? ""}
                              onChange={(e) => updateGridRow(idx, "hsn_code", e.target.value)}
                              className="w-full text-center border border-slate-300 rounded p-1 text-xs font-mono"
                              placeholder="HSN"
                            />
                          </td>

                          {/* Qty */}
                          <td className="p-2 text-center">
                            <input
                              type="number"
                              min="0"
                              step="1"
                              inputMode="numeric"
                              value={formatGridNumberValue(item.qty)}
                              onChange={(e) => updateGridRow(idx, "qty", parseGridNumber(e.target.value, "int"))}
                              className="w-full text-center border border-slate-300 rounded p-1 font-semibold text-xs font-mono"
                              required
                            />
                          </td>

                          {/* Unit */}
                          <td className="p-2 text-center">
                            <select
                              value={item.unit}
                              onChange={(e) => updateGridRow(idx, "unit", e.target.value)}
                              className="w-full text-center border border-slate-300 rounded p-1 text-xs bg-white cursor-pointer"
                              required
                            >
                              <option value="Nos">Nos</option>
                              <option value="Mtr">Mtr</option>
                              <option value="Kg">Kg</option>
                              <option value="Ltr">Ltr</option>
                              <option value="Box">Box</option>
                              <option value="Pcs">Pcs</option>
                              <option value="Set">Set</option>
                              <option value="Pair">Pair</option>
                              <option value="Roll">Roll</option>
                              <option value="Bag">Bag</option>
                              <option value="Bundle">Bundle</option>
                              <option value="Dozen">Dozen</option>
                              <option value="Sqft">Sqft</option>
                              <option value="Sqm">Sqm</option>
                              <option value="Ton">Ton</option>
                            </select>
                          </td>

                          {/* Rate */}
                          <td className="p-2">
                            <input
                              type="number"
                              min="0"
                              step="any"
                              inputMode="decimal"
                              value={formatGridNumberValue(item.rate)}
                              onChange={(e) => updateGridRow(idx, "rate", parseGridNumber(e.target.value, "decimal"))}
                              className="w-full text-right border border-slate-300 rounded p-1 text-xs font-mono"
                              placeholder="0"
                              required
                            />
                          </td>

                          {/* Amount (auto-calculated, read-only) */}
                          <td className="p-2">
                            <input
                              type="text"
                              readOnly
                              value={(item.qty * item.rate).toFixed(2)}
                              className="w-full text-right border border-slate-200 rounded p-1 text-xs font-mono bg-slate-50 text-slate-600 cursor-not-allowed"
                              tabIndex={-1}
                            />
                          </td>

                          {/* Discount */}
                          <td className="p-2">
                            <input
                              type="number"
                              min="0"
                              step="any"
                              inputMode="decimal"
                              value={formatGridNumberValue(item.disc)}
                              onChange={(e) => updateGridRow(idx, "disc", parseGridNumber(e.target.value, "decimal"))}
                              className="w-full text-right border border-slate-300 rounded p-1 text-xs font-mono"
                              placeholder="0"
                            />
                          </td>

                          {/* SGST% — number input */}
                          <td className="p-2 text-center">
                            <input
                              type="number"
                              min="0"
                              max="50"
                              step="any"
                              inputMode="decimal"
                              value={formatGridNumberValue(item.sgst)}
                              onChange={(e) => updateGridRow(idx, "sgst", parseGridNumber(e.target.value, "decimal"))}
                              className="w-full text-center border border-slate-300 rounded p-1 text-xs font-mono"
                              placeholder="9"
                            />
                          </td>

                          {/* CGST% — number input */}
                          <td className="p-2 text-center">
                            <input
                              type="number"
                              min="0"
                              max="50"
                              step="any"
                              inputMode="decimal"
                              value={formatGridNumberValue(item.cgst)}
                              onChange={(e) => updateGridRow(idx, "cgst", parseGridNumber(e.target.value, "decimal"))}
                              className="w-full text-center border border-slate-300 rounded p-1 text-xs font-mono"
                              placeholder="9"
                            />
                          </td>

                          {/* S-Rate */}
                          <td className="p-2">
                            <input
                              type="number"
                              min="0"
                              step="any"
                              inputMode="decimal"
                              value={formatGridNumberValue(item.s_rate)}
                              onChange={(e) => updateGridRow(idx, "s_rate", parseGridNumber(e.target.value, "decimal"))}
                              className="w-full text-right border border-slate-300 rounded p-1 text-xs font-mono"
                              placeholder="Sell rate"
                            />
                          </td>

                          {/* MRP */}
                          <td className="p-2">
                            <input
                              type="number"
                              min="0"
                              step="any"
                              inputMode="decimal"
                              value={formatGridNumberValue(item.mrp)}
                              onChange={(e) => updateGridRow(idx, "mrp", parseGridNumber(e.target.value, "decimal"))}
                              className="w-full text-right border border-slate-300 rounded p-1 text-xs font-mono"
                              placeholder="MRP Price"
                            />
                          </td>

                          {/* Remove row */}
                          <td className="p-2 text-center">
                            <button
                              type="button"
                              onClick={() => removeGridRow(idx)}
                              disabled={gridItems.length === 1}
                              className="text-red-500 hover:text-red-700 hover:bg-red-50 p-1.5 rounded transition-all disabled:opacity-30"
                            >
                              <Trash2 className="w-3.5 h-3.5 mx-auto" />
                            </button>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>

              {/* ── Section 3: Financials & Finalization ── */}
              <div className="bg-slate-50 border border-slate-200/80 rounded-xl p-5 space-y-4">
                <h3 className="text-xs font-bold uppercase tracking-wider text-slate-500 border-b border-slate-200 pb-1.5">
                  3. Financials & Totaling
                </h3>
                <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-end">
                  {/* Left column inputs */}
                  <div className="lg:col-span-6 grid grid-cols-1 sm:grid-cols-2 gap-4">
                    <div>
                      <label className="form-label text-xs text-slate-700 font-semibold mb-1 block">Additional Expenses (Freight/Overheads) (₹)</label>
                      <input
                        type="number"
                        min="0"
                        value={expenses}
                        onChange={(e) => setExpenses(e.target.value)}
                        placeholder="e.g. Loading, freight"
                        className="input-enterprise font-mono text-xs w-full"
                      />
                    </div>

                    <div>
                      <label className="form-label text-xs text-slate-700 font-semibold mb-1 block">Payment Status</label>
                      <select
                        value={paymentStatus}
                        onChange={(e) => handlePaymentStatusChange(e.target.value as PaymentStatus)}
                        className="input-enterprise bg-white cursor-pointer text-xs w-full"
                      >
                        <option value="Pending">Pending</option>
                        <option value="Partial">Partial</option>
                        <option value="Paid">Paid</option>
                      </select>
                      {editingPurchase && editingPurchase.payment_status === "Pending" && paymentStatus === "Paid" && (
                        <p className="text-[10px] text-green-600 mt-1">Bill will be marked as fully paid on save.</p>
                      )}
                    </div>

                    <div className="sm:col-span-2">
                      <label className="form-label text-xs text-slate-700 font-semibold mb-1 block">
                        Paid Amount to Supplier (₹)
                        <span className="ml-1 text-[10px] text-purple-500 font-normal">
                          {paymentStatus === "Partial" ? "(enter partial amount)" : paymentStatus === "Paid" ? "(full net amount)" : "(₹0 when pending)"}
                        </span>
                      </label>
                      <input
                        type="number"
                        min="0"
                        value={paidAmount}
                        onChange={(e) => handlePaidAmountChange(e.target.value)}
                        readOnly={paymentStatus === "Paid" || paymentStatus === "Pending"}
                        placeholder="Amount paid to supplier"
                        className={`input-enterprise font-mono text-xs w-full text-green-700 font-bold ${
                          paymentStatus === "Paid" || paymentStatus === "Pending" ? "bg-slate-50" : ""
                        }`}
                      />
                    </div>
                  </div>

                  {/* Right column — live calculation breakdown */}
                  <div className="lg:col-span-6 bg-white border border-slate-200 rounded-xl p-4 space-y-2 text-xs">
                    <h4 className="text-[10px] font-bold uppercase tracking-wider text-slate-400 pb-1 border-b border-slate-100">
                      Financial Summary
                    </h4>
                    <div className="flex justify-between text-slate-500">
                      <span>SubTotal (Base Value):</span>
                      <span className="font-mono">{formatCurrency(calculatedTotals.subtotal)}</span>
                    </div>
                    <div className="flex justify-between text-red-600 border-b border-slate-100 pb-1.5">
                      <span>Discount (–):</span>
                      <span className="font-mono">–{formatCurrency(calculatedTotals.discount)}</span>
                    </div>

                    {/* SGST row */}
                    <div className="flex justify-between text-slate-500">
                      <span>Total SGST (+):</span>
                      <span className="font-mono text-amber-600">+{formatCurrency(calculatedTotals.totalSgst)}</span>
                    </div>
                    {/* CGST row */}
                    <div className="flex justify-between text-slate-500 border-b border-slate-100 pb-1.5">
                      <span>Total CGST (+):</span>
                      <span className="font-mono text-amber-600">+{formatCurrency(calculatedTotals.totalCgst)}</span>
                    </div>

                    {/* Combined tax line */}
                    <div className="flex justify-between text-slate-400 text-[10px] italic">
                      <span>Combined Tax (SGST + CGST):</span>
                      <span className="font-mono">
                        {formatCurrency(calculatedTotals.totalSgst + calculatedTotals.totalCgst)}
                      </span>
                    </div>

                    <div className="flex justify-between text-slate-500">
                      <span>Expenses (Freight/Overhead) (+):</span>
                      <span className="font-mono">+{formatCurrency(Number(expenses) || 0)}</span>
                    </div>

                    <div className="flex justify-between text-sm font-bold text-slate-900 border-t border-slate-200 pt-2">
                      <span>Net Amount:</span>
                      <span className="font-mono text-base text-purple-700">{formatCurrency(calculatedTotals.netAmount)}</span>
                    </div>

                    <div className="flex justify-between text-xs font-semibold border-t border-dashed border-slate-100 pt-1.5">
                      <span className="text-slate-500">Paid:</span>
                      <span className="font-mono text-green-700">{formatCurrency(Number(paidAmount) || 0)}</span>
                    </div>
                    <div className="flex justify-between text-xs font-semibold">
                      <span className="text-slate-500">Status:</span>
                      <span className={`font-semibold ${
                        paymentStatus === "Paid" ? "text-green-700"
                          : paymentStatus === "Partial" ? "text-blue-700"
                          : "text-orange-600"
                      }`}>
                        {paymentStatus}
                      </span>
                    </div>
                    <div className="flex justify-between text-xs font-semibold">
                      <span className="text-slate-500">Balance Due:</span>
                      <span className={`font-mono ${
                        Math.max(0, calculatedTotals.netAmount - (Number(paidAmount) || 0)) > 0
                          ? "text-red-600"
                          : "text-green-600"
                      }`}>
                        {formatCurrency(Math.max(0, calculatedTotals.netAmount - (Number(paidAmount) || 0)))}
                      </span>
                    </div>
                  </div>
                </div>
              </div>

              {/* Action Buttons */}
              <div className="flex items-center justify-end gap-3 pt-4 border-t border-slate-200 sticky bottom-0 bg-white z-10 p-2">
                <button
                  type="button"
                  onClick={resetForm}
                  className="btn-secondary px-5 py-2 hover:bg-slate-50 border border-slate-300 text-slate-700 text-xs font-semibold rounded"
                >
                  Clear & Cancel
                </button>
                <button
                  type="submit"
                  className="btn-primary bg-purple-600 hover:bg-purple-700 active:bg-purple-800 px-6 py-2 text-white text-xs font-bold rounded shadow-md"
                >
                  {editingPurchase ? "Save & Update Bill" : "Save Purchase Bill"}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* ── Filter & Search ── */}
      <div className="bg-white border border-border rounded-xl shadow-card p-4 flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div className="relative flex-1 max-w-md">
          <Search className="w-4 h-4 text-text-secondary absolute left-3 top-3" />
          <input
            type="text"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder="Search Supplier, Wholesaler or Invoice No..."
            className="input-enterprise pl-9"
          />
        </div>

        <div className="flex items-center gap-3">
          <div className="flex items-center gap-1.5 text-xs font-semibold text-text-secondary">
            <Filter className="w-3.5 h-3.5" />
            <span>Payment Status:</span>
          </div>
          <select
            value={statusFilter}
            onChange={(e) => setStatusFilter(e.target.value)}
            className="input-enterprise bg-white cursor-pointer w-40"
          >
            <option value="All">All Bills</option>
            <option value="Paid">Paid</option>
            <option value="Partial">Partial</option>
            <option value="Pending">Pending</option>
          </select>
        </div>
      </div>

      {/* ── Purchase Records Table ── */}
      <div className="bg-white border border-border rounded-xl shadow-card overflow-hidden">
        <div className="overflow-x-auto">
          <table className="table-enterprise w-full text-xs">
            <thead>
              <tr className="bg-gray-50 border-b border-border">
                <th className="px-4 py-3 text-center font-semibold uppercase tracking-wider text-text-secondary">Invoice No.</th>
                <th className="px-4 py-3 text-center font-semibold uppercase tracking-wider text-text-secondary">Supplier Name</th>
                <th className="px-4 py-3 text-center font-semibold uppercase tracking-wider text-text-secondary">Branch / Godown</th>
                <th className="px-4 py-3 text-center font-semibold uppercase tracking-wider text-text-secondary">Invoice Date</th>
                <th className="px-4 py-3 text-center font-semibold uppercase tracking-wider text-text-secondary">Total Paid (₹)</th>
                <th className="px-4 py-3 text-center font-semibold uppercase tracking-wider text-text-secondary">Net Total (₹)</th>
                <th className="px-4 py-3 text-center font-semibold uppercase tracking-wider text-text-secondary">Status</th>
                <th className="px-4 py-3 text-center font-semibold uppercase tracking-wider text-text-secondary">Actions</th>
              </tr>
            </thead>
            <tbody>
              {loading ? (
                <tr>
                  <td colSpan={8} className="text-center py-12">
                    <svg className="w-6 h-6 animate-spin text-primary mx-auto mb-2" fill="none" viewBox="0 0 24 24">
                      <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                      <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
                    </svg>
                    <span className="text-xs text-text-secondary">Fetching purchase log...</span>
                  </td>
                </tr>
              ) : filteredPurchases.length === 0 ? (
                <tr>
                  <td colSpan={8} className="text-center py-16 text-text-secondary">
                    <Calendar className="w-8 h-8 mx-auto text-gray-300 mb-2" />
                    <p className="font-semibold text-sm">No purchase bills logged</p>
                    <p className="text-xs text-gray-400 mt-1">Try logging a new bill to track expenses.</p>
                  </td>
                </tr>
              ) : (
                currentPurchases.map((rec) => (
                  <tr key={rec.invoice_no} className="border-b border-border hover:bg-gray-50/50 transition-colors">
                    <td className="px-4 py-2.5 font-semibold text-gray-900 font-mono text-center">{rec.invoice_no}</td>
                    <td className="px-4 py-2.5 font-medium text-gray-800 text-center truncate max-w-[150px] mx-auto" title={rec.supplier_name}>
                      {rec.supplier_name}
                    </td>
                    <td className="px-4 py-2.5 text-text-secondary text-center truncate max-w-[140px] mx-auto" title={rec.branch_godown}>
                      {rec.branch_godown}
                    </td>
                    <td className="px-4 py-2.5 text-text-secondary font-mono text-center">{formatTableDate(rec.invoice_date)}</td>
                    <td className="px-4 py-2.5 text-center font-mono font-semibold text-green-700">
                      {formatCurrency(rec.paid_amount)}
                    </td>
                    <td className="px-4 py-2.5 text-center font-mono font-bold text-gray-900">
                      {formatCurrency(rec.net_amount)}
                    </td>
                    <td className="px-4 py-2.5 text-center">
                      <span
                        className={`inline-flex items-center px-2 py-0.5 rounded text-[10px] font-bold ${
                          rec.payment_status === "Paid"
                            ? "bg-green-100 text-green-800 border border-green-200"
                            : rec.payment_status === "Partial"
                            ? "bg-blue-100 text-blue-800 border border-blue-200"
                            : "bg-red-100 text-red-800 border border-red-200"
                        }`}
                      >
                        {rec.payment_status}
                      </span>
                    </td>
                    <td className="px-4 py-2.5 text-center">
                      <div className="flex items-center justify-center gap-1.5">
                        <button
                          type="button"
                          onClick={() => setViewingPurchase(rec)}
                          className="text-slate-500 hover:text-slate-900 hover:bg-slate-100 p-1.5 rounded transition-all"
                          title="View Details"
                        >
                          <Eye className="w-3.5 h-3.5" />
                        </button>
                        <button
                          type="button"
                          onClick={() => handleStartEdit(rec)}
                          className="text-slate-500 hover:text-slate-900 hover:bg-slate-100 p-1.5 rounded transition-all"
                          title="Edit Bill"
                        >
                          <Edit className="w-3.5 h-3.5" />
                        </button>
                        <button
                          type="button"
                          onClick={() => handlePrintPurchase(rec)}
                          className="text-slate-500 hover:text-slate-900 hover:bg-slate-100 p-1.5 rounded transition-all"
                          title="Print Bill"
                        >
                          <Printer className="w-3.5 h-3.5" />
                        </button>
                        <button
                          type="button"
                          onClick={() => handleDownloadPurchase(rec)}
                          className="text-slate-500 hover:text-slate-900 hover:bg-slate-100 p-1.5 rounded transition-all"
                          title="Download PDF"
                        >
                          <Download className="w-3.5 h-3.5" />
                        </button>
                        <button
                          type="button"
                          onClick={() => handleDeletePurchase(rec.invoice_no)}
                          className="text-red-500 hover:text-red-700 hover:bg-red-50 p-1.5 rounded transition-all"
                          title="Delete bill"
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
            Showing <span className="font-semibold text-text-primary">{filteredPurchases.length > 0 ? indexOfFirstItem + 1 : 0}</span> to{" "}
            <span className="font-semibold text-text-primary">{Math.min(indexOfLastItem, filteredPurchases.length)}</span> of{" "}
            <span className="font-semibold text-text-primary">{filteredPurchases.length}</span> bills
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
          <div className="font-semibold text-gray-900">
            Total Purchase Volume:{" "}
            <span className="font-mono text-purple-700 bg-purple-50 px-2 py-0.5 border border-purple-100 rounded">
              {formatCurrency(filteredPurchases.reduce((acc, curr) => acc + curr.net_amount, 0))}
            </span>
          </div>
        </div>
      </div>

      {/* ── View Purchase Details Modal ── */}
      {viewingPurchase && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/40 backdrop-blur-[2px]">
          <div
            className="absolute inset-0 transition-opacity"
            onClick={() => setViewingPurchase(null)}
          />

          <div className="bg-white border border-slate-200 rounded-xl shadow-2xl relative max-w-4xl w-full animate-in fade-in zoom-in-95 duration-150 z-10 flex flex-col font-sans max-h-[90vh] overflow-y-auto">
            {/* Header */}
            <div className="bg-slate-950 px-6 py-4 text-white rounded-t-xl flex items-center justify-between shadow-md sticky top-0">
              <div>
                <h2 className="text-sm font-bold tracking-tight">Purchase Bill Specifications</h2>
                <p className="text-[10px] text-slate-300 mt-0.5">
                  Invoice: {viewingPurchase.invoice_no}
                  {viewingPurchase.serial_no && ` · Ref: ${viewingPurchase.serial_no}`}
                </p>
              </div>
              <button
                type="button"
                onClick={() => setViewingPurchase(null)}
                className="text-slate-300 hover:text-white p-1.5 rounded-lg hover:bg-white/10 transition-colors"
                aria-label="Close modal"
              >
                <X className="w-4.5 h-4.5" />
              </button>
            </div>

            {/* Content Details */}
            <div className="p-6 space-y-6">
              {/* Metadata Grid */}
              <div className="grid grid-cols-2 md:grid-cols-3 gap-x-6 gap-y-3.5 text-xs bg-slate-50 border border-slate-100 p-4 rounded-xl">
                <div>
                  <span className="text-[10px] font-bold text-slate-400 uppercase tracking-wider block">Invoice Number</span>
                  <span className="font-mono font-semibold text-slate-900">{viewingPurchase.invoice_no}</span>
                </div>
                {viewingPurchase.serial_no && (
                  <div>
                    <span className="text-[10px] font-bold text-slate-400 uppercase tracking-wider block">Serial / Ref No.</span>
                    <span className="font-mono text-slate-700">{viewingPurchase.serial_no}</span>
                  </div>
                )}
                <div>
                  <span className="text-[10px] font-bold text-slate-400 uppercase tracking-wider block">Supplier Name</span>
                  <span className="font-semibold text-slate-900">{viewingPurchase.supplier_name}</span>
                </div>
                <div>
                  <span className="text-[10px] font-bold text-slate-400 uppercase tracking-wider block">Purchase Type</span>
                  <span className="font-semibold text-slate-900">{viewingPurchase.purchase_type}</span>
                </div>
                <div>
                  <span className="text-[10px] font-bold text-slate-400 uppercase tracking-wider block">Branch / Godown</span>
                  <span className="font-semibold text-slate-900">{viewingPurchase.branch_godown}</span>
                </div>
                <div>
                  <span className="text-[10px] font-bold text-slate-400 uppercase tracking-wider block">Invoice Date</span>
                  <span className="font-mono text-slate-700">{formatTableDate(viewingPurchase.invoice_date)}</span>
                </div>
                <div>
                  <span className="text-[10px] font-bold text-slate-400 uppercase tracking-wider block">Pur. Entry Date</span>
                  <span className="font-mono text-slate-700">{formatTableDate(viewingPurchase.entry_date)}</span>
                </div>
                <div>
                  <span className="text-[10px] font-bold text-slate-400 uppercase tracking-wider block">Vehicle No</span>
                  <span className="font-mono text-slate-700">{viewingPurchase.vehicle_no || "—"}</span>
                </div>
                <div>
                  <span className="text-[10px] font-bold text-slate-400 uppercase tracking-wider block">Payment Status</span>
                  <span
                    className={`inline-flex items-center px-2 py-0.5 rounded text-[10px] font-bold mt-1 ${
                      viewingPurchase.payment_status === "Paid"
                        ? "bg-green-100 text-green-800"
                        : viewingPurchase.payment_status === "Partial"
                        ? "bg-blue-100 text-blue-800"
                        : "bg-red-100 text-red-800"
                    }`}
                  >
                    {viewingPurchase.payment_status}
                  </span>
                </div>
              </div>

              {/* Items List Table */}
              <div className="space-y-2">
                <h4 className="text-xs font-bold text-slate-800 uppercase tracking-wider">Purchased Product Details</h4>
                <div className="border border-slate-200 rounded-xl overflow-hidden">
                  <table className="w-full text-xs text-left border-collapse">
                    <thead>
                      <tr className="bg-slate-100 border-b border-slate-200 font-semibold text-slate-700">
                        <th className="p-2.5">Code</th>
                        <th className="p-2.5">Name</th>
                        <th className="p-2.5 text-center">HSN</th>
                        <th className="p-2.5 text-center">Qty</th>
                        <th className="p-2.5 text-center">Unit</th>
                        <th className="p-2.5 text-right">Rate</th>
                        <th className="p-2.5 text-right">Amount</th>
                        <th className="p-2.5 text-right">Discount</th>
                        <th className="p-2.5 text-center">SGST%</th>
                        <th className="p-2.5 text-center">CGST%</th>
                        <th className="p-2.5 text-right">SGST Amt</th>
                        <th className="p-2.5 text-right">CGST Amt</th>
                        <th className="p-2.5 text-right">Total (Incl Tax)</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-100">
                      {viewingPurchase.items?.map((item, index) => {
                        const lineBase = item.qty * item.rate;
                        const lineDisc = item.disc || 0;
                        const taxable = Math.max(0, lineBase - lineDisc);
                        const sgstAmt = taxable * ((item.sgst ?? 0) / 100);
                        const cgstAmt = taxable * ((item.cgst ?? 0) / 100);
                        const lineTotal = taxable + sgstAmt + cgstAmt;
                        return (
                          <tr key={index} className="hover:bg-slate-50/30">
                            <td className="p-2.5 font-mono font-semibold">{item.code}</td>
                            <td className="p-2.5">{item.name}</td>
                            <td className="p-2.5 text-center font-mono text-slate-500">{item.hsn_code || "—"}</td>
                            <td className="p-2.5 text-center font-mono">{item.qty}</td>
                            <td className="p-2.5 text-center">{item.unit}</td>
                            <td className="p-2.5 text-right font-mono">{formatCurrency(item.rate)}</td>
                            <td className="p-2.5 text-right font-mono text-slate-600">{formatCurrency(item.qty * item.rate)}</td>
                            <td className="p-2.5 text-right font-mono text-red-500">{formatCurrency(item.disc)}</td>
                            <td className="p-2.5 text-center font-mono text-amber-600">{item.sgst ?? 0}%</td>
                            <td className="p-2.5 text-center font-mono text-amber-600">{item.cgst ?? 0}%</td>
                            <td className="p-2.5 text-right font-mono text-amber-700">{formatCurrency(sgstAmt)}</td>
                            <td className="p-2.5 text-right font-mono text-amber-700">{formatCurrency(cgstAmt)}</td>
                            <td className="p-2.5 text-right font-mono font-semibold">{formatCurrency(lineTotal)}</td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              </div>

              {/* Totals Summary */}
              <div className="flex justify-end pt-2">
                <div className="w-80 space-y-2 border-t border-slate-200 pt-3 text-xs text-slate-600">
                  <div className="flex justify-between font-semibold text-slate-700 border-b border-slate-100 pb-1.5">
                    <span>SubTotal:</span>
                    <span className="font-mono">{formatCurrency(viewingPurchase.subtotal)}</span>
                  </div>
                  <div className="flex justify-between text-red-600">
                    <span>Discount (–):</span>
                    <span className="font-mono">–{formatCurrency(viewingPurchase.total_discount ?? 0)}</span>
                  </div>
                  <div className="flex justify-between text-amber-600">
                    <span>Total SGST:</span>
                    <span className="font-mono">+{formatCurrency(viewingPurchase.total_sgst ?? 0)}</span>
                  </div>
                  <div className="flex justify-between text-amber-600">
                    <span>Total CGST:</span>
                    <span className="font-mono">+{formatCurrency(viewingPurchase.total_cgst ?? 0)}</span>
                  </div>
                  <div className="flex justify-between text-slate-500">
                    <span>Expenses (Freight):</span>
                    <span className="font-mono">+{formatCurrency(viewingPurchase.expenses)}</span>
                  </div>
                  <div className="flex justify-between text-sm font-bold text-slate-900 border-t border-slate-200 pt-2">
                    <span>Net Amount:</span>
                    <span className="font-mono text-purple-700">{formatCurrency(viewingPurchase.net_amount)}</span>
                  </div>
                  <div className="flex justify-between text-green-700 font-semibold">
                    <span>Paid:</span>
                    <span className="font-mono">{formatCurrency(viewingPurchase.paid_amount)}</span>
                  </div>
                  <div className="flex justify-between border-t border-dashed border-slate-200 pt-2">
                    <span className="text-slate-500">Balance Due:</span>
                    <span className={`font-mono font-semibold ${
                      Math.max(0, viewingPurchase.net_amount - viewingPurchase.paid_amount) > 0
                        ? "text-red-600"
                        : "text-green-600"
                    }`}>
                      {formatCurrency(Math.max(0, viewingPurchase.net_amount - viewingPurchase.paid_amount))}
                    </span>
                  </div>
                </div>
              </div>
            </div>

            {/* Footer Buttons */}
            <div className="flex items-center justify-end gap-3 pt-4 border-t border-slate-200 bg-slate-50 p-4 rounded-b-xl sticky bottom-0">
              <button
                type="button"
                onClick={() => handleDownloadPurchase(viewingPurchase)}
                className="btn-secondary px-4 py-2 font-semibold text-xs border border-slate-300 text-slate-700 hover:bg-slate-100 transition-colors rounded flex items-center gap-1.5"
              >
                <Download className="w-3.5 h-3.5" />
                Download PDF
              </button>
              <button
                type="button"
                onClick={() => handlePrintPurchase(viewingPurchase)}
                className="btn-secondary px-4 py-2 font-semibold text-xs border border-slate-300 text-slate-700 hover:bg-slate-100 transition-colors rounded flex items-center gap-1.5"
              >
                <Printer className="w-3.5 h-3.5" />
                Print Purchase Bill
              </button>
              <button
                type="button"
                onClick={() => setViewingPurchase(null)}
                className="btn-primary bg-slate-950 hover:bg-slate-800 active:bg-slate-900 px-6 py-2 font-bold shadow-sm text-white transition-colors rounded text-xs"
              >
                Close View
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ── Purchase Statement Modal ── */}
      {isReportModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/40 backdrop-blur-[2px]">
          <div className="absolute inset-0" onClick={() => setIsReportModalOpen(false)} />
          <div className="bg-white border border-slate-200 rounded-xl shadow-2xl relative max-w-lg w-full z-10 flex flex-col font-sans animate-in fade-in zoom-in-95 duration-150">
            <div className="bg-purple-700 px-5 py-4 text-white rounded-t-xl flex items-center justify-between">
              <div>
                <h2 className="text-sm font-bold tracking-tight flex items-center gap-2">
                  <FileText className="w-4 h-4" />
                  Download Purchase Statement
                </h2>
                <p className="text-[10px] text-purple-100 mt-0.5">Account-style PDF with full purchase bill details</p>
              </div>
              <button type="button" onClick={() => setIsReportModalOpen(false)}
                className="text-purple-100 hover:text-white p-1.5 rounded-lg hover:bg-white/10">
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
                    ["full", "Full Register", "All purchase bills in the system"],
                    ["date", "By Date", "Bills entered on a specific date"],
                    ["month", "By Month", "Bills in a calendar month"],
                    ["range", "Date Range", "Bills between two dates"],
                    ["current", "Current Table Filter", "Uses search & payment status filters"],
                  ] as const).map(([mode, title, desc]) => (
                    <label key={mode}
                      className={`flex items-start gap-3 p-3 rounded-lg border cursor-pointer transition-colors ${
                        reportMode === mode ? "border-purple-600 bg-purple-50" : "border-slate-200 hover:bg-slate-50"
                      }`}>
                      <input type="radio" name="purchaseReportMode" value={mode} checked={reportMode === mode}
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

              {reportMode === "date" && (
                <div>
                  <label className="form-label text-xs">Entry Date</label>
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
                Statement includes entry date, invoice no, supplier, godown, item count, subtotal, GST, net amount, paid, balance, and status — with period totals and signatory.
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
                className="btn-primary bg-purple-600 hover:bg-purple-700 px-4 text-xs flex items-center gap-1.5 disabled:opacity-50">
                <Download className="w-3.5 h-3.5" /> Download PDF
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
