import { useState, useEffect, useCallback, useMemo, useRef } from "react";
import {
  Building2, Plus, Search, Trash2, AlertTriangle, Check, Database, X, Edit,
  Receipt, User, Truck, Eye, FileText, Users, Printer, Download,
} from "lucide-react";
import html2canvas from "html2canvas";
import { jsPDF } from "jspdf";
import { WhatsAppIcon } from "@/components/WhatsAppIcon";
import { WhatsAppShareModal, type WhatsAppShareConfig } from "@/components/WhatsAppShareModal";
import { renderElementToPdfBlob } from "@/lib/htmlToPdfBlob";
import { supabase } from "@/lib/supabase";
import { formatCurrency, formatTableDate, numberToWordsIndian, isSampleGstin, reverseChargeLabel, validateGstin } from "@/lib/utils";
import {
  buildPurchaseGstMaps,
  inventoryLookupKey,
  isGstApplicable,
  normalizeProductName,
  resolveLineGstRates,
} from "@/lib/itemGst";
import type { SaleItem } from "@/pages/sales/SalesPage";

// ─── Types ────────────────────────────────────────────────────────────────────

export interface B2BBuyer {
  id: string;
  legal_name: string;
  trade_name?: string;
  gstin: string;
  pan?: string;
  contact_person?: string;
  phone?: string;
  email?: string;
  billing_address: string;
  ship_to_address?: string;
  city?: string;
  state: string;
  state_code: string;
  pincode?: string;
  business_type: string;
  notes?: string;
  is_active: boolean;
  created_at?: string;
}

export interface B2BSaleRecord {
  bill_no: string;
  buyer_id?: string;
  buyer_legal_name: string;
  buyer_trade_name?: string;
  buyer_gstin: string;
  buyer_pan?: string;
  buyer_contact_person?: string;
  buyer_phone?: string;
  buyer_email?: string;
  buyer_billing_address: string;
  buyer_ship_to?: string;
  buyer_city?: string;
  buyer_state?: string;
  buyer_state_code?: string;
  buyer_pincode?: string;
  form_type: string;
  bill_date: string;
  customer_name: string;
  customer_phone?: string;
  ship_to?: string;
  salesman?: string;
  vehicle_no?: string;
  branch_godown: string;
  rate_tp: string;
  items: SaleItem[];
  subtotal: number;
  f_cess: number;
  discount: number;
  total_gst: number;
  total_sgst?: number;
  total_cgst?: number;
  total_igst?: number;
  reverse_charge?: boolean;
  commission: number;
  postage: number;
  round_off: number;
  grand_total: number;
  payment_amount: number;
  payment_mode: string;
  balance: number;
  payment_status: string;
  created_at?: string;
}

interface InventoryItem {
  code: string;
  name: string;
  hsn_code: string;
  uom: string;
  gst_applicable?: boolean;
}

// ─── Constants ────────────────────────────────────────────────────────────────

const FORM_TYPES = ["Tax Invoice", "Retail Invoice", "Delivery Note", "Credit Note"];
const BUSINESS_TYPES = ["Contractor", "Wholesaler", "Retailer", "Manufacturer", "Business", "Other"];
const BRANCHES = ["Shop (Main Showroom)", "Central Godown A", "Warehouse Godown B", "Transit / On-Field Stock"];
const RATE_TP_OPTIONS = [
  { value: "Wholesale", label: "Wholesale (TP)" },
  { value: "GST_5", label: "GST @ 5%" },
  { value: "GST_12", label: "GST @ 12%" },
  { value: "GST_18", label: "GST @ 18%" },
  { value: "GST_28", label: "GST @ 28%" },
  { value: "Exempt", label: "GST Exempt (0%)" },
];
const PAYMENT_MODES = ["Bank Transfer", "UPI", "Cheque", "Cash", "Credit"];
const UNITS = ["Nos", "Mtr", "Kg", "Ltr", "Box", "Pcs", "Set", "Pair", "Roll", "Bag", "Bundle", "Dozen"];
const SEED_SALESMEN = ["Manager", "Sunil", "Reena", "Ajith", "Priya"];
const INDIAN_STATES = [
  { name: "Kerala", code: "32" }, { name: "Tamil Nadu", code: "33" },
  { name: "Karnataka", code: "29" }, { name: "Maharashtra", code: "27" },
  { name: "Gujarat", code: "24" }, { name: "Andhra Pradesh", code: "37" },
  { name: "Telangana", code: "36" }, { name: "Delhi", code: "07" },
];
const FETCH_PAGE_SIZE = 1000;
const LOCAL_BUYERS_KEY = "kaniyamparambil_b2b_buyers";
const LOCAL_SALES_KEY = "kaniyamparambil_sales_b2b";

const B2B_STORE_DETAILS = {
  storeName: "NEW KANIYAMPARAMBIL STORES",
  location: "THOPRAMKUDY PO, THOPRAMKUDY, KERALA",
  gstin: "32AWJPJ1371N1ZE",
  sellerStateCode: "32",
  phone: "9544363171",
  email: "newkaniyamparambilstorestkdy@gmail.com",
  signatureCompany: "FOR NEW KANIYAMPARAMBIL STORES",
  signatureRole: "Authorized Signatory",
} as const;

const SELLER_STATE_CODE = B2B_STORE_DETAILS.sellerStateCode;

function isInterStateB2B(rec: Pick<B2BSaleRecord, "buyer_state_code">): boolean {
  return (rec.buyer_state_code ?? SELLER_STATE_CODE) !== SELLER_STATE_CODE;
}

const B2B_FRAME_STYLE: Partial<CSSStyleDeclaration> = {
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

type PageTab = "bills" | "buyers";

// ─── Helpers ──────────────────────────────────────────────────────────────────

function toDbNumber(value: unknown): number {
  const n = Number(value);
  return Number.isFinite(n) ? n : 0;
}

function todayIso(): string {
  return new Date().toISOString().split("T")[0];
}

function blankItem(): SaleItem {
  return {
    code: "", name: "", hsn_code: "", qty: 1, unit: "Nos", rate: 0,
    amount: 0, disc_pct: 0, mrp: 0, sgst: 9, cgst: 9, line_total: 0,
  };
}

function computeLineAutos(item: SaleItem): Partial<SaleItem> {
  const mrpAmt = Number(item.qty) * Number(item.mrp);
  const discAmt = mrpAmt * ((Number(item.disc_pct) || 0) / 100);
  const taxable = Math.max(0, mrpAmt - discAmt);
  const sgstAmt = taxable * ((Number(item.sgst) || 0) / 100);
  const cgstAmt = taxable * ((Number(item.cgst) || 0) / 100);
  return {
    amount: Math.round(mrpAmt * 100) / 100,
    line_total: Math.round((taxable + sgstAmt + cgstAmt) * 100) / 100,
  };
}

function getSaleItemSummary(item: SaleItem) {
  const quantity = Number(item.qty) || 0;
  const rate = Number(item.mrp) || 0;
  const amount = quantity * rate;
  const discountPercent = Number(item.disc_pct) || 0;
  const discountAmount = amount * (discountPercent / 100);
  const taxableValue = Math.max(0, amount - discountAmount);
  const cgstRate = Number(item.cgst) || 0;
  const sgstRate = Number(item.sgst) || 0;
  const cgstAmount = taxableValue * (cgstRate / 100);
  const sgstAmount = taxableValue * (sgstRate / 100);
  return {
    quantity,
    rate,
    amount,
    taxableValue,
    cgstRate,
    sgstRate,
    cgstAmount,
    sgstAmount,
    total: taxableValue + cgstAmount + sgstAmount,
  };
}

function getBillGstTotals(items: SaleItem[], interState = false) {
  let totalTaxable = 0;
  let totalCgst = 0;
  let totalSgst = 0;
  items.forEach((item) => {
    const s = getSaleItemSummary(item);
    totalTaxable += s.taxableValue;
    totalCgst += s.cgstAmount;
    totalSgst += s.sgstAmount;
  });
  const totalGst = totalCgst + totalSgst;
  const cgstRate = totalTaxable > 0 ? (totalCgst / totalTaxable) * 100 : 0;
  const sgstRate = totalTaxable > 0 ? (totalSgst / totalTaxable) * 100 : 0;
  const igstRate = interState && totalTaxable > 0 ? (totalGst / totalTaxable) * 100 : 0;
  return {
    totalTaxable: Math.round(totalTaxable * 100) / 100,
    totalCgst: Math.round(totalCgst * 100) / 100,
    totalSgst: Math.round(totalSgst * 100) / 100,
    totalGst: Math.round(totalGst * 100) / 100,
    totalIgst: interState ? Math.round(totalGst * 100) / 100 : 0,
    cgstRate,
    sgstRate,
    igstRate,
    interState,
  };
}

function gstRatesFromRateTp(rateTp: string): { sgst: number; cgst: number } | null {
  const map: Record<string, { sgst: number; cgst: number }> = {
    GST_5: { sgst: 2.5, cgst: 2.5 },
    GST_12: { sgst: 6, cgst: 6 },
    GST_18: { sgst: 9, cgst: 9 },
    GST_28: { sgst: 14, cgst: 14 },
    Exempt: { sgst: 0, cgst: 0 },
  };
  return map[rateTp] ?? null;
}

type PurchaseLineLookup = {
  purchase_rate: number;
  sgst: number;
  cgst: number;
  hsn_code: string;
  unit: string;
  s_rate: number;
  mrp: number;
};

const PURCHASE_LOOKUP_PAGE_SIZE = 1000;

function normalizeItemCode(code: unknown): string {
  return String(code ?? "").trim();
}

function formatGridNumberValue(value: number | undefined): string | number {
  if (value === undefined || value === null || Number.isNaN(value)) return "";
  return value;
}

function unitOptionsForRow(unit: string): string[] {
  const u = unit?.trim() || "Nos";
  return UNITS.includes(u as (typeof UNITS)[number]) ? [...UNITS] : [u, ...UNITS];
}

function purchaseLineFromRaw(it: Record<string, unknown>): PurchaseLineLookup | null {
  const code = normalizeItemCode(it.code);
  if (!code) return null;

  const qty = Number(it.qty ?? 0);
  const rate = Number(it.rate ?? 0);
  const amount = Number(it.amount ?? 0);
  const purchase_rate = rate > 0 ? rate : (qty > 0 && amount > 0 ? amount / qty : 0);

  const gstPercent = Number(it.gst_percent ?? 0);
  const hasSplitGst = it.sgst != null || it.cgst != null;
  const sgst = hasSplitGst ? Number(it.sgst ?? 0) : (gstPercent > 0 ? gstPercent / 2 : 9);
  const cgst = hasSplitGst ? Number(it.cgst ?? 0) : (gstPercent > 0 ? gstPercent / 2 : 9);

  return {
    purchase_rate: Math.round(purchase_rate * 100) / 100,
    sgst,
    cgst,
    hsn_code: String(it.hsn_code ?? ""),
    unit: String(it.unit ?? it.uom ?? "Nos"),
    s_rate: Number(it.s_rate ?? 0),
    mrp: Number(it.mrp ?? 0),
  };
}

function buildPurchaseItemMap(rows: Array<{ items: unknown[] }>): Map<string, PurchaseLineLookup> {
  const map = new Map<string, PurchaseLineLookup>();
  for (const row of rows) {
    if (!Array.isArray(row.items)) continue;
    for (const raw of row.items as Record<string, unknown>[]) {
      const parsed = purchaseLineFromRaw(raw);
      if (!parsed) continue;
      const code = normalizeItemCode(raw.code);
      if (!map.has(code)) map.set(code, parsed);
    }
  }
  return map;
}

function buildItemPriceMapFromBills(billList: B2BSaleRecord[]): Map<string, number> {
  const map = new Map<string, number>();
  for (const bill of billList) {
    for (const item of bill.items) {
      const code = normalizeItemCode(item.code);
      if (!code || map.has(code)) continue;
      const price = Number(item.mrp) || Number(item.rate) || 0;
      if (price > 0) map.set(code, price);
    }
  }
  return map;
}

function buildItemPriceMapFromSalesRows(rows: Array<{ items: unknown[] }>): Map<string, number> {
  const map = new Map<string, number>();
  for (const row of rows) {
    if (!Array.isArray(row.items)) continue;
    for (const raw of row.items as Record<string, unknown>[]) {
      const code = normalizeItemCode(raw.code);
      if (!code || map.has(code)) continue;
      const mrp = Number(raw.mrp ?? raw.rate ?? 0);
      if (mrp > 0) map.set(code, mrp);
    }
  }
  return map;
}

function resolveSellingUnitPrice(purchaseData?: PurchaseLineLookup, priorPrice?: number): number {
  if (purchaseData) {
    if (purchaseData.s_rate > 0) return purchaseData.s_rate;
    if (purchaseData.mrp > 0) return purchaseData.mrp;
    if (purchaseData.purchase_rate > 0) return purchaseData.purchase_rate;
  }
  if (priorPrice && priorPrice > 0) return priorPrice;
  return 0;
}

function compareBillNo(a: string, b: string): number {
  return a.localeCompare(b, undefined, { numeric: true, sensitivity: "base" });
}

function getNextB2BBillNo(existing: string[]): string {
  const bills = existing.map((b) => b.trim()).filter(Boolean);
  if (bills.length === 0) return "B2B-0001";
  const sorted = [...bills].sort(compareBillNo);
  const latest = sorted[sorted.length - 1];
  const match = latest.match(/^(B2B-)?(\d+)$/i) ?? latest.match(/^(.*?)(\d+)$/);
  if (match) {
    const prefix = match[1] || "B2B-";
    const numStr = match[2];
    const next = Number(numStr) + 1;
    return `${prefix}${String(next).padStart(numStr.length, "0")}`;
  }
  return `${latest}-1`;
}

function normalizeBuyer(raw: Record<string, unknown>): B2BBuyer {
  return {
    id: String(raw.id ?? crypto.randomUUID()),
    legal_name: String(raw.legal_name ?? ""),
    trade_name: raw.trade_name ? String(raw.trade_name) : undefined,
    gstin: String(raw.gstin ?? "").toUpperCase(),
    pan: raw.pan ? String(raw.pan).toUpperCase() : undefined,
    contact_person: raw.contact_person ? String(raw.contact_person) : undefined,
    phone: raw.phone ? String(raw.phone) : undefined,
    email: raw.email ? String(raw.email) : undefined,
    billing_address: String(raw.billing_address ?? ""),
    ship_to_address: raw.ship_to_address ? String(raw.ship_to_address) : undefined,
    city: raw.city ? String(raw.city) : undefined,
    state: String(raw.state ?? "Kerala"),
    state_code: String(raw.state_code ?? "32"),
    pincode: raw.pincode ? String(raw.pincode) : undefined,
    business_type: String(raw.business_type ?? "Business"),
    notes: raw.notes ? String(raw.notes) : undefined,
    is_active: raw.is_active !== false,
    created_at: raw.created_at ? String(raw.created_at) : undefined,
  };
}

function normalizeSaleItem(raw: Record<string, unknown>): SaleItem {
  const gstPercent = toDbNumber(raw.gst_percent);
  const hasSplitGst = raw.sgst != null || raw.cgst != null;
  const sgst = hasSplitGst ? toDbNumber(raw.sgst) : (gstPercent > 0 ? gstPercent / 2 : 9);
  const cgst = hasSplitGst ? toDbNumber(raw.cgst) : (gstPercent > 0 ? gstPercent / 2 : 9);
  const item: SaleItem = {
    code: String(raw.code ?? ""),
    name: String(raw.name ?? ""),
    hsn_code: String(raw.hsn_code ?? ""),
    qty: toDbNumber(raw.qty) || 1,
    unit: String(raw.unit ?? raw.uom ?? "Nos"),
    rate: toDbNumber(raw.rate),
    amount: toDbNumber(raw.amount),
    disc_pct: toDbNumber(raw.disc_pct),
    mrp: toDbNumber(raw.mrp ?? raw.rate),
    sgst,
    cgst,
    line_total: toDbNumber(raw.line_total),
  };
  const autos = computeLineAutos(item);
  return { ...item, ...autos, line_total: toDbNumber(raw.line_total) || autos.line_total || 0 };
}

function enrichB2BBill(rec: B2BSaleRecord): B2BSaleRecord {
  const items = (rec.items ?? []).map((it) => {
    const normalized = normalizeSaleItem(it as unknown as Record<string, unknown>);
    return { ...normalized, ...computeLineAutos(normalized) };
  });
  return { ...rec, items };
}

function buyerFromBill(rec: B2BSaleRecord): B2BBuyer {
  return {
    id: rec.buyer_id ?? `snapshot-${rec.bill_no}`,
    legal_name: rec.buyer_legal_name,
    trade_name: rec.buyer_trade_name,
    gstin: rec.buyer_gstin,
    pan: rec.buyer_pan,
    contact_person: rec.buyer_contact_person,
    phone: rec.buyer_phone ?? rec.customer_phone,
    email: rec.buyer_email,
    billing_address: rec.buyer_billing_address,
    ship_to_address: rec.buyer_ship_to ?? rec.ship_to,
    city: rec.buyer_city,
    state: rec.buyer_state ?? "Kerala",
    state_code: rec.buyer_state_code ?? "32",
    pincode: rec.buyer_pincode,
    business_type: "Business",
    is_active: true,
  };
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
  return formatTableDate(value);
}

type B2BDocOptions = {
  renderMode?: "print" | "pdf";
  helperText?: string;
};

function buildB2BInvoiceHtml(rec: B2BSaleRecord, options: B2BDocOptions = {}): string {
  const store = B2B_STORE_DETAILS;
  const bill = enrichB2BBill(rec);
  const isPdfMode = options.renderMode === "pdf";
  const shipAddress = bill.ship_to || bill.buyer_ship_to || bill.buyer_billing_address;
  const placeOfSupply = `${bill.buyer_state_code ?? "32"}-${(bill.buyer_state ?? "Kerala").toUpperCase()}`;
  const interState = isInterStateB2B(bill);
  const gstTotals = getBillGstTotals(bill.items, interState);
  const amountInWords = numberToWordsIndian(bill.grand_total).replace(/^Rupees /, "INR ");
  const reverseCharge = reverseChargeLabel(bill.reverse_charge);

  const rowMarkup = bill.items.map((item, index) => {
    const summary = getSaleItemSummary(item);
    const igstRate = summary.sgstRate + summary.cgstRate;
    const igstAmount = summary.sgstAmount + summary.cgstAmount;
    const taxCells = interState
      ? `<td class="col-gst align-right">${igstRate}%<br/>${escapeHtml(formatCurrency(igstAmount))}</td>`
      : `<td class="col-gst align-right">${summary.sgstRate}%<br/>${escapeHtml(formatCurrency(summary.sgstAmount))}</td>
      <td class="col-gst align-right">${summary.cgstRate}%<br/>${escapeHtml(formatCurrency(summary.cgstAmount))}</td>`;
    return `<tr>
      <td class="col-index">${index + 1}</td>
      <td class="col-item">
        <strong>${escapeHtml(item.name || "—")}</strong>
        ${item.code ? `<span class="item-meta">Code: ${escapeHtml(item.code)}</span>` : ""}
      </td>
      <td class="col-hsn">${escapeHtml(item.hsn_code || "—")}</td>
      <td class="col-qty align-center">${summary.quantity} ${escapeHtml(item.unit || "Nos")}</td>
      <td class="col-rate align-right">${escapeHtml(formatCurrency(summary.rate))}</td>
      <td class="col-disc align-center">${item.disc_pct ? `${item.disc_pct}%` : "—"}</td>
      <td class="col-taxable align-right">${escapeHtml(formatCurrency(summary.taxableValue))}</td>
      ${taxCells}
      <td class="col-amt align-right">${escapeHtml(formatCurrency(summary.total))}</td>
    </tr>`;
  }).join("");

  const taxHeader = interState
    ? "<th>IGST</th>"
    : "<th>SGST</th><th>CGST</th>";

  const taxTotalRows = interState
    ? `<div class="total-row"><span>IGST ${gstTotals.igstRate.toFixed(1)}%</span><span>${escapeHtml(formatCurrency(gstTotals.totalIgst))}</span></div>`
    : `<div class="total-row"><span>CGST ${gstTotals.cgstRate.toFixed(1)}%</span><span>${escapeHtml(formatCurrency(gstTotals.totalCgst))}</span></div>
      <div class="total-row"><span>SGST ${gstTotals.sgstRate.toFixed(1)}%</span><span>${escapeHtml(formatCurrency(gstTotals.totalSgst))}</span></div>`;

  return `<!DOCTYPE html>
  <html lang="en">
    <head>
      <meta charset="UTF-8" />
      <title>B2B Tax Invoice ${escapeHtml(bill.bill_no)}</title>
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
        .b2b-toolbar {
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
        .b2b-sheet {
          width: ${isPdfMode ? "794px" : "860px"};
          margin: 0 auto;
          background: #fff;
          border: 1px solid #000;
        }
        .doc-title {
          text-align: center;
          font-size: ${isPdfMode ? "14px" : "18px"};
          font-weight: 700;
          color: #5b21b6;
          letter-spacing: 0.05em;
          padding: ${isPdfMode ? "8px" : "12px"};
          border-bottom: 1px solid #000;
        }
        .doc-subtitle {
          text-align: center;
          font-size: ${isPdfMode ? "8px" : "10px"};
          color: #555;
          padding: 6px 10px;
          border-bottom: 1px solid #000;
          background: #f5f3ff;
        }
        .meta-grid {
          display: grid;
          grid-template-columns: 1fr 1fr;
          border-bottom: 1px solid #000;
        }
        .meta-grid > div {
          padding: 8px 10px;
          border-right: 1px solid #000;
          vertical-align: top;
        }
        .meta-grid > div:last-child { border-right: 0; }
        .meta-label { font-weight: 700; font-size: ${isPdfMode ? "7px" : "9px"}; text-transform: uppercase; color: #555; margin-bottom: 3px; }
        .items-table { width: 100%; border-collapse: collapse; }
        .items-table th, .items-table td { border: 1px solid #000; padding: ${isPdfMode ? "4px 5px" : "6px 8px"}; }
        .items-table th { background: #f5f3ff; font-size: ${isPdfMode ? "7px" : "9px"}; text-transform: uppercase; }
        .col-index { width: 24px; text-align: center; }
        .col-item { min-width: 140px; }
        .col-hsn { width: 56px; text-align: center; }
        .col-qty { width: 56px; }
        .col-rate, .col-amt, .col-taxable { width: 58px; }
        .col-disc { width: 40px; }
        .col-gst { width: 52px; font-size: ${isPdfMode ? "6.5px" : "9px"}; }
        .align-right { text-align: right; }
        .align-center { text-align: center; }
        .item-meta { display: block; font-size: ${isPdfMode ? "6.5px" : "9px"}; color: #666; margin-top: 2px; }
        .totals-wrap { display: flex; justify-content: flex-end; border-top: 1px solid #000; }
        .totals { width: 280px; border-left: 1px solid #000; }
        .total-row { display: flex; justify-content: space-between; padding: 5px 10px; border-bottom: 1px solid #ddd; }
        .total-row.grand { font-weight: 700; font-size: ${isPdfMode ? "9px" : "12px"}; background: #f5f3ff; }
        .footer { padding: 10px; border-top: 1px solid #000; font-size: ${isPdfMode ? "7px" : "10px"}; }
        @media print {
          body { background: #fff; padding: 0; }
          .b2b-toolbar { display: none !important; }
        }
      </style>
    </head>
    <body>
      <div class="b2b-toolbar">
        <p class="toolbar-text">${escapeHtml(options.helperText ?? "B2B tax invoice preview")}</p>
      </div>
      <div class="b2b-sheet">
        <div class="doc-title">${escapeHtml(bill.form_type.toUpperCase())} · B2B</div>
        <div class="doc-subtitle">${escapeHtml(store.storeName)} · GSTIN: ${escapeHtml(store.gstin)} · ${escapeHtml(store.location)}</div>
        <div class="meta-grid">
          <div>
            <div class="meta-label">Seller</div>
            <div><strong>${escapeHtml(store.storeName)}</strong></div>
            <div>GSTIN: ${escapeHtml(store.gstin)}</div>
            <div>Ph: ${escapeHtml(store.phone)}</div>
          </div>
          <div>
            <div class="meta-label">Buyer (GST Registered)</div>
            <div><strong>${escapeHtml(bill.buyer_legal_name)}</strong></div>
            ${bill.buyer_trade_name ? `<div>Trade: ${escapeHtml(bill.buyer_trade_name)}</div>` : ""}
            <div>GSTIN: ${escapeHtml(bill.buyer_gstin)}</div>
            ${bill.buyer_pan ? `<div>PAN: ${escapeHtml(bill.buyer_pan)}</div>` : ""}
            <div>${escapeHtml(bill.buyer_billing_address)}</div>
            <div>Place of Supply: ${escapeHtml(placeOfSupply)}</div>
            <div>Reverse Charge: ${escapeHtml(reverseCharge)}</div>
          </div>
        </div>
        <div class="meta-grid" style="grid-template-columns: 1fr 1fr 1fr 1fr 1fr;">
          <div><div class="meta-label">Bill No.</div>${escapeHtml(bill.bill_no)}</div>
          <div><div class="meta-label">Date</div>${escapeHtml(formatDocDate(bill.bill_date))}</div>
          <div><div class="meta-label">Ship To</div>${escapeHtml(shipAddress)}</div>
          <div><div class="meta-label">Supply Type</div>${interState ? "Inter-State (IGST)" : "Intra-State (CGST+SGST)"}</div>
          <div style="border-right:0"><div class="meta-label">Payment</div>${escapeHtml(bill.payment_mode)} · ${escapeHtml(bill.payment_status)}</div>
        </div>
        <table class="items-table">
          <thead>
            <tr>
              <th>#</th><th>Description</th><th>HSN</th><th>Qty</th><th>Rate</th><th>Disc</th><th>Taxable</th>${taxHeader}<th>Amount</th>
            </tr>
          </thead>
          <tbody>${rowMarkup}</tbody>
        </table>
        <div class="totals-wrap">
          <div class="totals">
            <div class="total-row"><span>Taxable Subtotal</span><span>${escapeHtml(formatCurrency(gstTotals.totalTaxable || bill.subtotal))}</span></div>
            ${bill.discount > 0 ? `<div class="total-row"><span>Discount</span><span>−${escapeHtml(formatCurrency(bill.discount))}</span></div>` : ""}
            ${taxTotalRows}
            <div class="total-row"><span>Total GST</span><span>${escapeHtml(formatCurrency(gstTotals.totalGst || bill.total_gst))}</span></div>
            ${bill.f_cess > 0 ? `<div class="total-row"><span>F. Cess</span><span>${escapeHtml(formatCurrency(bill.f_cess))}</span></div>` : ""}
            ${bill.commission > 0 ? `<div class="total-row"><span>Commission</span><span>${escapeHtml(formatCurrency(bill.commission))}</span></div>` : ""}
            ${bill.postage > 0 ? `<div class="total-row"><span>Postage</span><span>${escapeHtml(formatCurrency(bill.postage))}</span></div>` : ""}
            ${bill.round_off !== 0 ? `<div class="total-row"><span>Round Off</span><span>${escapeHtml(formatCurrency(bill.round_off))}</span></div>` : ""}
            <div class="total-row grand"><span>Grand Total</span><span>${escapeHtml(formatCurrency(bill.grand_total))}</span></div>
            <div class="total-row"><span>Payment Received</span><span>${escapeHtml(formatCurrency(bill.payment_amount))}</span></div>
            <div class="total-row"><span>Balance</span><span>${escapeHtml(formatCurrency(bill.balance))}</span></div>
          </div>
        </div>
        <div class="words-row" style="border-top:1px solid #000;padding:8px 10px;font-size:${isPdfMode ? "8px" : "11px"};">
          Total amount (in words): <b>${escapeHtml(amountInWords)}</b>
        </div>
        <div class="footer">
          <div>${escapeHtml(store.signatureCompany)}</div>
          <div>${escapeHtml(store.signatureRole)}</div>
        </div>
      </div>
    </body>
  </html>`;
}

// ─── B2B Statement & Buyer Profile ───────────────────────────────────────────

type B2BReportMode = "full" | "date" | "month" | "range" | "current";
type BuyerPrintMode = "individual" | "group" | "conditions";
type BuyerPrintGroupScope = "all" | "active" | "selected";

type B2BStatementMeta = {
  reportTitle: string;
  periodLabel: string;
  reportType: string;
  statusFilter: string;
  generatedOn: string;
  totalBills: number;
  totalTaxable: number;
  totalSgst: number;
  totalCgst: number;
  totalIgst: number;
  totalGst: number;
  totalSales: number;
  totalCollected: number;
  totalOutstanding: number;
};

function b2bBillDate(bill: B2BSaleRecord): string | null {
  if (!bill.bill_date) return null;
  return bill.bill_date.slice(0, 10);
}

function filterB2BBillsByBuyer(billList: B2BSaleRecord[], buyer: B2BBuyer): B2BSaleRecord[] {
  const gstin = buyer.gstin.toUpperCase();
  return billList.filter(
    (b) => b.buyer_id === buyer.id || b.buyer_gstin.toUpperCase() === gstin,
  );
}

function filterB2BBillsByDate(billList: B2BSaleRecord[], date: string): B2BSaleRecord[] {
  return billList.filter((b) => b2bBillDate(b) === date);
}

function filterB2BBillsByMonth(billList: B2BSaleRecord[], monthYm: string): B2BSaleRecord[] {
  return billList.filter((b) => b2bBillDate(b)?.slice(0, 7) === monthYm);
}

function filterB2BBillsByRange(billList: B2BSaleRecord[], from: string, to: string): B2BSaleRecord[] {
  return billList.filter((b) => {
    const d = b2bBillDate(b);
    if (!d) return false;
    return d >= from && d <= to;
  });
}

function formatB2BMonthLabel(monthYm: string): string {
  const [year, month] = monthYm.split("-").map(Number);
  if (!year || !month) return monthYm;
  return new Date(year, month - 1, 1).toLocaleDateString("en-IN", { month: "long", year: "numeric" });
}

function formatB2BGeneratedOn(): string {
  return formatTableDate(new Date().toISOString());
}

function resolveRegistryBuyer(buyerId: string, buyerList: B2BBuyer[]): B2BBuyer | null {
  return buyerList.find((b) => b.id === buyerId) ?? null;
}

function buildB2BBuyerDetailsLines(buyer: B2BBuyer): string {
  const placeOfSupply = `${buyer.state_code}-${buyer.state.toUpperCase()}`;
  const shipTo = buyer.ship_to_address?.trim() || "Same as billing address";
  const lines = [
    `<div class="buyer-name"><strong>${escapeHtml(buyer.legal_name)}</strong></div>`,
    buyer.trade_name?.trim()
      ? `<div class="buyer-line"><b>Trade Name:</b> ${escapeHtml(buyer.trade_name)}</div>`
      : "",
    `<div class="buyer-line"><b>GSTIN:</b> ${escapeHtml(buyer.gstin)}</div>`,
    buyer.pan?.trim()
      ? `<div class="buyer-line"><b>PAN:</b> ${escapeHtml(buyer.pan)}</div>`
      : "",
    `<div class="buyer-line"><b>Business Type:</b> ${escapeHtml(buyer.business_type)}</div>`,
    buyer.contact_person?.trim()
      ? `<div class="buyer-line"><b>Contact:</b> ${escapeHtml(buyer.contact_person)}</div>`
      : "",
    buyer.phone?.trim() || buyer.email?.trim()
      ? `<div class="buyer-line"><b>Phone / Email:</b> ${escapeHtml([buyer.phone, buyer.email].filter(Boolean).join(" · "))}</div>`
      : "",
    `<div class="buyer-line"><b>Billing Address:</b> ${escapeHtml(buyer.billing_address)}</div>`,
    `<div class="buyer-line"><b>Ship-To:</b> ${escapeHtml(shipTo)}</div>`,
    buyer.city?.trim() || buyer.pincode?.trim()
      ? `<div class="buyer-line"><b>City / Pin:</b> ${escapeHtml([buyer.city, buyer.pincode].filter(Boolean).join(" · "))}</div>`
      : "",
    `<div class="buyer-line"><b>State:</b> ${escapeHtml(buyer.state)} (${escapeHtml(buyer.state_code)})</div>`,
    `<div class="buyer-line"><b>Place of Supply:</b> ${escapeHtml(placeOfSupply)}</div>`,
    buyer.notes?.trim()
      ? `<div class="buyer-line"><b>Notes:</b> ${escapeHtml(buyer.notes)}</div>`
      : "",
  ];
  return lines.filter(Boolean).join("");
}

function buildB2BStatementMeta(
  billList: B2BSaleRecord[],
  reportType: string,
  periodLabel: string,
  statusFilter: string,
): B2BStatementMeta {
  let totalTaxable = 0;
  let totalSgst = 0;
  let totalCgst = 0;
  let totalIgst = 0;
  billList.forEach((bill) => {
    const interState = isInterStateB2B(bill);
    const gst = getBillGstTotals(bill.items, interState);
    totalTaxable += gst.totalTaxable || bill.subtotal;
    if (interState) {
      totalIgst += gst.totalIgst;
    } else {
      totalSgst += gst.totalSgst;
      totalCgst += gst.totalCgst;
    }
  });
  return {
    reportTitle: "B2B ACCOUNT STATEMENT / BILLING REGISTER",
    periodLabel,
    reportType,
    statusFilter,
    generatedOn: formatB2BGeneratedOn(),
    totalBills: billList.length,
    totalTaxable: Math.round(totalTaxable * 100) / 100,
    totalSgst: Math.round(totalSgst * 100) / 100,
    totalCgst: Math.round(totalCgst * 100) / 100,
    totalIgst: Math.round(totalIgst * 100) / 100,
    totalGst: Math.round((totalSgst + totalCgst + totalIgst) * 100) / 100,
    totalSales: billList.reduce((sum, b) => sum + b.grand_total, 0),
    totalCollected: billList.reduce((sum, b) => sum + b.payment_amount, 0),
    totalOutstanding: billList.reduce((sum, b) => sum + b.balance, 0),
  };
}

function buildB2BStatementHtml(
  billList: B2BSaleRecord[],
  buyer: B2BBuyer,
  meta: B2BStatementMeta,
  options: B2BDocOptions = {},
): string {
  const store = B2B_STORE_DETAILS;
  const isPdfMode = options.renderMode === "pdf";

  const rowMarkup = billList.map((bill, index) => {
    const interState = isInterStateB2B(bill);
    const gst = getBillGstTotals(bill.items, interState);
    return `<tr>
      <td class="col-index">${index + 1}</td>
      <td class="col-date">${escapeHtml(b2bBillDate(bill) ? formatTableDate(b2bBillDate(bill)!) : "—")}</td>
      <td class="col-bill">${escapeHtml(bill.bill_no)}</td>
      <td class="col-type">${escapeHtml(bill.form_type)}</td>
      <td class="col-items align-center">${bill.items.length}</td>
      <td class="col-amt align-right">${escapeHtml(formatCurrency(gst.totalTaxable || bill.subtotal))}</td>
      <td class="col-amt align-right">${interState ? "—" : escapeHtml(formatCurrency(gst.totalSgst))}</td>
      <td class="col-amt align-right">${interState ? "—" : escapeHtml(formatCurrency(gst.totalCgst))}</td>
      <td class="col-amt align-right">${interState ? escapeHtml(formatCurrency(gst.totalIgst)) : "—"}</td>
      <td class="col-amt align-right">${escapeHtml(formatCurrency(bill.grand_total))}</td>
      <td class="col-amt align-right">${escapeHtml(formatCurrency(bill.payment_amount))}</td>
      <td class="col-amt align-right">${escapeHtml(formatCurrency(bill.balance))}</td>
      <td class="col-status">${escapeHtml(bill.payment_status)}</td>
    </tr>`;
  }).join("");

  return `<!DOCTYPE html>
  <html lang="en">
    <head>
      <meta charset="UTF-8" />
      <title>${escapeHtml(meta.reportTitle)} — ${escapeHtml(buyerDisplayName(buyer))}</title>
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
        .b2b-toolbar {
          width: ${isPdfMode ? "794px" : "860px"};
          margin: 0 auto 12px;
          padding: 12px 16px;
          border: 1px solid #ccc;
          background: #fff;
          display: ${isPdfMode ? "none" : "flex"};
          align-items: center;
          justify-content: space-between;
        }
        .toolbar-text { margin: 0; color: #555; font-size: 12px; }
        .b2b-statement-sheet {
          width: ${isPdfMode ? "794px" : "860px"};
          margin: 0 auto;
          background: #fff;
          border: 1px solid #000;
        }
        .doc-title {
          text-align: center;
          font-size: ${isPdfMode ? "13px" : "16px"};
          font-weight: 700;
          color: #5b21b6;
          letter-spacing: 0.05em;
          padding: ${isPdfMode ? "7px 8px" : "10px"};
          border-bottom: 1px solid #000;
        }
        .period-banner {
          text-align: center;
          font-weight: 700;
          padding: ${isPdfMode ? "5px 8px" : "8px 12px"};
          border-bottom: 1px solid #000;
          background: #f5f3ff;
          font-size: ${isPdfMode ? "9px" : "12px"};
        }
        .meta-grid {
          display: grid;
          grid-template-columns: 1fr 1fr;
          border-bottom: 1px solid #000;
        }
        .meta-grid > div {
          padding: ${isPdfMode ? "5px 7px" : "8px 10px"};
          border-right: 1px solid #000;
          vertical-align: top;
        }
        .meta-grid > div:last-child { border-right: none; }
        .meta-label {
          font-weight: 700;
          margin-bottom: 3px;
          font-size: ${isPdfMode ? "7.5px" : "10px"};
          text-transform: uppercase;
          color: #5b21b6;
        }
        .meta-line, .buyer-line { margin-bottom: 1px; }
        .buyer-name { font-size: ${isPdfMode ? "9px" : "12px"}; margin-bottom: 4px; }
        .buyer-block {
          border-bottom: 1px solid #000;
          padding: ${isPdfMode ? "6px 8px" : "10px 12px"};
          background: #faf5ff;
        }
        .statement-table { width: 100%; border-collapse: collapse; }
        .statement-table th, .statement-table td {
          border: 1px solid #000;
          padding: ${isPdfMode ? "2px 3px" : "4px 5px"};
          vertical-align: top;
        }
        .statement-table thead th {
          background: #f5f3ff;
          font-weight: 700;
          text-align: center;
        }
        .col-index { width: 20px; text-align: center; }
        .col-date { width: 52px; text-align: center; white-space: nowrap; }
        .col-bill { width: 58px; font-family: monospace; }
        .col-type { width: 48px; font-size: ${isPdfMode ? "7px" : "10px"}; }
        .col-items { width: 28px; }
        .col-amt { width: 48px; white-space: nowrap; }
        .col-status { width: 40px; text-align: center; }
        .align-right { text-align: right; }
        .align-center { text-align: center; }
        .summary-grid {
          display: grid;
          grid-template-columns: repeat(4, 1fr);
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
          .b2b-toolbar { display: none !important; }
          .b2b-statement-sheet { width: 100%; border: none; }
        }
      </style>
    </head>
    <body>
      <div class="b2b-toolbar">
        <p class="toolbar-text">${escapeHtml(options.helperText ?? "B2B account statement preview")}</p>
      </div>
      <div class="b2b-statement-sheet">
        <div class="doc-title">${escapeHtml(meta.reportTitle)}</div>
        <div class="period-banner">Statement Period: ${escapeHtml(meta.periodLabel)}</div>
        <div class="meta-grid">
          <div>
            <div class="meta-label">Seller</div>
            <div class="meta-line"><strong>${escapeHtml(store.storeName)}</strong></div>
            <div class="meta-line">${escapeHtml(store.location)}</div>
            <div class="meta-line"><b>GSTIN:</b> ${escapeHtml(store.gstin)}</div>
            <div class="meta-line"><b>Phone:</b> ${escapeHtml(store.phone)}</div>
            <div class="meta-line"><b>Email:</b> ${escapeHtml(store.email)}</div>
          </div>
          <div>
            <div class="meta-label">Report Details</div>
            <div class="meta-line"><b>Type:</b> ${escapeHtml(meta.reportType)}</div>
            <div class="meta-line"><b>Status Filter:</b> ${escapeHtml(meta.statusFilter)}</div>
            <div class="meta-line"><b>Generated:</b> ${escapeHtml(meta.generatedOn)}</div>
            <div class="meta-line"><b>Bills:</b> ${meta.totalBills}</div>
          </div>
        </div>
        <div class="buyer-block">
          <div class="meta-label">Registered Business (Buyer)</div>
          ${buildB2BBuyerDetailsLines(buyer)}
        </div>
        <table class="statement-table">
          <thead>
            <tr>
              <th>#</th>
              <th>Bill Date</th>
              <th>Bill No</th>
              <th>Type</th>
              <th>Items</th>
              <th>Taxable</th>
              <th>SGST</th>
              <th>CGST</th>
              <th>IGST</th>
              <th>Grand Total</th>
              <th>Paid</th>
              <th>Balance</th>
              <th>Status</th>
            </tr>
          </thead>
          <tbody>${rowMarkup || `<tr><td colspan="13" style="text-align:center;padding:12px;">No B2B bills for this statement period.</td></tr>`}</tbody>
        </table>
        <div class="summary-grid">
          <div class="summary-box">Total Bills<b>${meta.totalBills}</b></div>
          <div class="summary-box">Total Taxable<b>${escapeHtml(formatCurrency(meta.totalTaxable))}</b></div>
          <div class="summary-box">Total SGST<b>${escapeHtml(formatCurrency(meta.totalSgst))}</b></div>
          <div class="summary-box">Total CGST<b>${escapeHtml(formatCurrency(meta.totalCgst))}</b></div>
          <div class="summary-box">Total IGST<b>${escapeHtml(formatCurrency(meta.totalIgst))}</b></div>
        </div>
        <div class="summary-grid" style="border-top:0;">
          <div class="summary-box">Total GST<b>${escapeHtml(formatCurrency(meta.totalGst))}</b></div>
          <div class="summary-box">Grand Total<b>${escapeHtml(formatCurrency(meta.totalSales))}</b></div>
          <div class="summary-box">Total Collected<b>${escapeHtml(formatCurrency(meta.totalCollected))}</b></div>
          <div class="summary-box">Outstanding<b>${escapeHtml(formatCurrency(meta.totalOutstanding))}</b></div>
        </div>
        <div class="footer-note">
          B2B account statement for ${escapeHtml(buyerDisplayName(buyer))} (${escapeHtml(buyer.gstin)}).
          Amounts include SGST/CGST for intra-state and IGST for inter-state supplies per saved tax invoices.
        </div>
        <div class="signatory">
          <div>${escapeHtml(store.signatureCompany)}</div>
          <div>${escapeHtml(store.signatureRole)}</div>
        </div>
      </div>
    </body>
  </html>`;
}

type BuyersDirectoryMeta = {
  reportTitle: string;
  scopeLabel: string;
  reportType: string;
  generatedOn: string;
  totalBusinesses: number;
};

function buyerMatchesSearch(buyer: B2BBuyer, query: string): boolean {
  const q = query.trim().toLowerCase();
  if (!q) return true;
  return (
    buyer.legal_name.toLowerCase().includes(q)
    || (buyer.trade_name ?? "").toLowerCase().includes(q)
    || buyer.gstin.toLowerCase().includes(q)
    || (buyer.city ?? "").toLowerCase().includes(q)
    || buyer.state.toLowerCase().includes(q)
  );
}

function buyerHasBills(buyer: B2BBuyer, billList: B2BSaleRecord[]): boolean {
  const gstin = buyer.gstin.toUpperCase();
  return billList.some(
    (b) => b.buyer_id === buyer.id || b.buyer_gstin.toUpperCase() === gstin,
  );
}

function buildB2BBuyersDirectoryHtml(
  buyerList: B2BBuyer[],
  meta: BuyersDirectoryMeta,
  options: B2BDocOptions = {},
): string {
  const store = B2B_STORE_DETAILS;
  const isPdfMode = options.renderMode === "pdf";

  const summaryRows = buyerList.map((buyer, index) => `
    <tr>
      <td class="col-index">${index + 1}</td>
      <td class="col-name">${escapeHtml(buyer.legal_name)}</td>
      <td class="col-trade">${escapeHtml(buyer.trade_name?.trim() || "—")}</td>
      <td class="col-gstin">${escapeHtml(buyer.gstin)}</td>
      <td class="col-type">${escapeHtml(buyer.business_type)}</td>
      <td class="col-state">${escapeHtml(buyer.state)}</td>
      <td class="col-phone">${escapeHtml(buyer.phone?.trim() || "—")}</td>
      <td class="col-status">${buyer.is_active ? "Active" : "Inactive"}</td>
    </tr>
  `).join("");

  const detailBlocks = buyerList.map((buyer, index) => `
    <div class="buyer-detail-block">
      <div class="buyer-detail-head">
        <span class="buyer-detail-index">#${index + 1}</span>
        <strong>${escapeHtml(buyerDisplayName(buyer))}</strong>
        <span class="buyer-detail-gstin">${escapeHtml(buyer.gstin)}</span>
      </div>
      ${buildB2BBuyerDetailsLines(buyer)}
    </div>
  `).join("");

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
          font-size: ${isPdfMode ? "8px" : "11px"};
          line-height: 1.35;
          padding: ${isPdfMode ? "0" : "20px"};
        }
        .b2b-toolbar {
          width: ${isPdfMode ? "794px" : "860px"};
          margin: 0 auto 12px;
          padding: 12px 16px;
          border: 1px solid #ccc;
          background: #fff;
          display: ${isPdfMode ? "none" : "flex"};
        }
        .toolbar-text { margin: 0; color: #555; font-size: 12px; }
        .b2b-buyers-directory-sheet {
          width: ${isPdfMode ? "794px" : "860px"};
          margin: 0 auto;
          background: #fff;
          border: 1px solid #000;
        }
        .doc-title {
          text-align: center;
          font-size: ${isPdfMode ? "13px" : "16px"};
          font-weight: 700;
          color: #5b21b6;
          padding: ${isPdfMode ? "7px 8px" : "10px"};
          border-bottom: 1px solid #000;
        }
        .period-banner {
          text-align: center;
          font-weight: 700;
          padding: ${isPdfMode ? "5px 8px" : "8px 12px"};
          border-bottom: 1px solid #000;
          background: #f5f3ff;
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
        .meta-label {
          font-weight: 700;
          font-size: ${isPdfMode ? "7.5px" : "10px"};
          text-transform: uppercase;
          color: #5b21b6;
          margin-bottom: 3px;
        }
        .meta-line { margin-bottom: 1px; }
        .directory-table { width: 100%; border-collapse: collapse; }
        .directory-table th, .directory-table td {
          border: 1px solid #000;
          padding: ${isPdfMode ? "2px 3px" : "4px 5px"};
          vertical-align: top;
        }
        .directory-table thead th {
          background: #f5f3ff;
          font-weight: 700;
          text-align: center;
        }
        .col-index { width: 22px; text-align: center; }
        .col-name { min-width: 90px; }
        .col-trade { width: 70px; }
        .col-gstin { width: 78px; font-family: monospace; font-size: ${isPdfMode ? "7px" : "10px"}; }
        .col-type { width: 52px; }
        .col-state { width: 48px; }
        .col-phone { width: 58px; }
        .col-status { width: 40px; text-align: center; }
        .details-title {
          font-weight: 700;
          text-transform: uppercase;
          font-size: ${isPdfMode ? "8px" : "10px"};
          color: #5b21b6;
          padding: ${isPdfMode ? "5px 8px" : "8px 10px"};
          border-top: 1px solid #000;
          border-bottom: 1px solid #000;
          background: #faf5ff;
        }
        .buyer-detail-block {
          border-bottom: 1px solid #000;
          padding: ${isPdfMode ? "6px 8px" : "10px 12px"};
          page-break-inside: avoid;
        }
        .buyer-detail-head {
          display: flex;
          flex-wrap: wrap;
          align-items: baseline;
          gap: 6px;
          margin-bottom: 4px;
          font-size: ${isPdfMode ? "9px" : "12px"};
        }
        .buyer-detail-index { color: #5b21b6; font-weight: 700; }
        .buyer-detail-gstin { font-family: monospace; font-size: ${isPdfMode ? "8px" : "10px"}; color: #444; }
        .buyer-line { margin-bottom: 2px; }
        .buyer-name { margin-bottom: 4px; }
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
        @page { size: A4; margin: 8mm; }
        @media print {
          body { background: #fff; padding: 0; }
          .b2b-toolbar { display: none !important; }
          .b2b-buyers-directory-sheet { width: 100%; border: none; }
        }
      </style>
    </head>
    <body>
      <div class="b2b-toolbar">
        <p class="toolbar-text">${escapeHtml(options.helperText ?? "Registered businesses directory")}</p>
      </div>
      <div class="b2b-buyers-directory-sheet">
        <div class="doc-title">${escapeHtml(meta.reportTitle)}</div>
        <div class="period-banner">${escapeHtml(meta.scopeLabel)}</div>
        <div class="meta-grid">
          <div>
            <div class="meta-label">Issued By</div>
            <div class="meta-line"><strong>${escapeHtml(store.storeName)}</strong></div>
            <div class="meta-line">${escapeHtml(store.location)}</div>
            <div class="meta-line"><b>GSTIN:</b> ${escapeHtml(store.gstin)}</div>
          </div>
          <div>
            <div class="meta-label">Report</div>
            <div class="meta-line"><b>Type:</b> ${escapeHtml(meta.reportType)}</div>
            <div class="meta-line"><b>Businesses:</b> ${meta.totalBusinesses}</div>
          </div>
          <div>
            <div class="meta-label">Generated</div>
            <div class="meta-line"><b>Date:</b> ${escapeHtml(meta.generatedOn)}</div>
          </div>
        </div>
        <table class="directory-table">
          <thead>
            <tr>
              <th>#</th>
              <th>Legal Name</th>
              <th>Trade Name</th>
              <th>GSTIN</th>
              <th>Type</th>
              <th>State</th>
              <th>Phone</th>
              <th>Status</th>
            </tr>
          </thead>
          <tbody>${summaryRows}</tbody>
        </table>
        <div class="details-title">Full Business Details</div>
        ${detailBlocks}
        <div class="footer-note">
          Registered GST business directory generated from B2B buyer records.
          Each entry includes legal name, GSTIN, PAN, addresses, contact, and place of supply.
        </div>
        <div class="signatory">
          <div>${escapeHtml(store.signatureCompany)}</div>
          <div>${escapeHtml(store.signatureRole)}</div>
        </div>
      </div>
    </body>
  </html>`;
}

function buildB2BBuyerProfileHtml(buyer: B2BBuyer, options: B2BDocOptions = {}): string {
  const store = B2B_STORE_DETAILS;
  const isPdfMode = options.renderMode === "pdf";

  return `<!DOCTYPE html>
  <html lang="en">
    <head>
      <meta charset="UTF-8" />
      <title>Registered Business — ${escapeHtml(buyerDisplayName(buyer))}</title>
      <style>
        * { box-sizing: border-box; }
        body {
          margin: 0;
          background: ${isPdfMode ? "#fff" : "#f3f4f6"};
          font-family: Arial, Helvetica, sans-serif;
          color: #111;
          font-size: ${isPdfMode ? "9px" : "12px"};
          line-height: 1.4;
          padding: ${isPdfMode ? "0" : "20px"};
        }
        .b2b-toolbar {
          width: ${isPdfMode ? "794px" : "860px"};
          margin: 0 auto 12px;
          padding: 12px 16px;
          border: 1px solid #ccc;
          background: #fff;
          display: ${isPdfMode ? "none" : "flex"};
        }
        .toolbar-text { margin: 0; color: #555; font-size: 12px; }
        .b2b-buyer-profile-sheet {
          width: ${isPdfMode ? "794px" : "860px"};
          margin: 0 auto;
          background: #fff;
          border: 1px solid #000;
        }
        .doc-title {
          text-align: center;
          font-size: ${isPdfMode ? "14px" : "18px"};
          font-weight: 700;
          color: #5b21b6;
          padding: ${isPdfMode ? "8px" : "12px"};
          border-bottom: 1px solid #000;
        }
        .meta-grid {
          display: grid;
          grid-template-columns: 1fr 1fr;
          border-bottom: 1px solid #000;
        }
        .meta-grid > div {
          padding: ${isPdfMode ? "8px 10px" : "12px 14px"};
          border-right: 1px solid #000;
        }
        .meta-grid > div:last-child { border-right: none; }
        .meta-label {
          font-weight: 700;
          font-size: ${isPdfMode ? "8px" : "10px"};
          text-transform: uppercase;
          color: #5b21b6;
          margin-bottom: 6px;
        }
        .buyer-line { margin-bottom: 4px; }
        .buyer-name { font-size: ${isPdfMode ? "11px" : "14px"}; margin-bottom: 8px; }
        .footer {
          border-top: 1px solid #000;
          padding: ${isPdfMode ? "8px 10px" : "12px 14px"};
          text-align: right;
          font-weight: 700;
        }
        @media print {
          body { background: #fff; padding: 0; }
          .b2b-toolbar { display: none !important; }
        }
      </style>
    </head>
    <body>
      <div class="b2b-toolbar">
        <p class="toolbar-text">${escapeHtml(options.helperText ?? "Registered business profile")}</p>
      </div>
      <div class="b2b-buyer-profile-sheet">
        <div class="doc-title">REGISTERED BUSINESS PROFILE · B2B</div>
        <div class="meta-grid">
          <div>
            <div class="meta-label">Issued By (Seller)</div>
            <div><strong>${escapeHtml(store.storeName)}</strong></div>
            <div>${escapeHtml(store.location)}</div>
            <div><b>GSTIN:</b> ${escapeHtml(store.gstin)}</div>
            <div><b>Phone:</b> ${escapeHtml(store.phone)}</div>
            <div><b>Email:</b> ${escapeHtml(store.email)}</div>
            <div style="margin-top:8px"><b>Generated:</b> ${escapeHtml(formatB2BGeneratedOn())}</div>
          </div>
          <div>
            <div class="meta-label">Registered Business Details</div>
            ${buildB2BBuyerDetailsLines(buyer)}
          </div>
        </div>
        <div class="footer">
          <div>${escapeHtml(store.signatureCompany)}</div>
          <div>${escapeHtml(store.signatureRole)}</div>
        </div>
      </div>
    </body>
  </html>`;
}

async function waitForB2BFrame(html: string, sheetSelector = ".b2b-sheet"): Promise<HTMLIFrameElement> {
  const iframe = document.createElement("iframe");
  Object.assign(iframe.style, B2B_FRAME_STYLE);
  iframe.setAttribute("aria-hidden", "true");
  document.body.appendChild(iframe);
  const frameDocument = iframe.contentDocument;
  if (!frameDocument) {
    iframe.remove();
    throw new Error("Unable to prepare the B2B document.");
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
        reject(new Error("B2B document preview took too long to load."));
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

async function exportB2BDocPdf(
  html: string,
  filename: string,
  sheetSelector: string,
  multiPage = false,
): Promise<void> {
  let iframe: HTMLIFrameElement | null = null;
  try {
    iframe = await waitForB2BFrame(html, sheetSelector);
    const sheet = iframe.contentDocument?.querySelector(sheetSelector);
    if (!(sheet instanceof HTMLElement)) {
      throw new Error("Unable to prepare the B2B document layout for PDF export.");
    }
    const canvas = await html2canvas(sheet, { scale: 2, useCORS: true, backgroundColor: "#ffffff" });
    const pdf = new jsPDF({ orientation: "portrait", unit: "pt", format: "a4" });
    const pageWidth = pdf.internal.pageSize.getWidth();
    const pageHeight = pdf.internal.pageSize.getHeight();
    const margin = 12;
    const imgWidth = pageWidth - margin * 2;
    const imgHeight = (canvas.height * imgWidth) / canvas.width;
    const imgData = canvas.toDataURL("image/png");

    if (multiPage) {
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
    } else {
      const maxHeight = pageHeight - margin * 2;
      const scale = Math.min(imgWidth / canvas.width, maxHeight / canvas.height);
      pdf.addImage(
        imgData,
        "PNG",
        margin,
        margin,
        canvas.width * scale,
        canvas.height * scale,
        undefined,
        "FAST",
      );
    }
    pdf.save(filename);
  } finally {
    iframe?.remove();
  }
}

async function exportB2BPdf(html: string, filename: string): Promise<void> {
  await exportB2BDocPdf(html, filename, ".b2b-sheet", false);
}

async function printB2BHtml(html: string, sheetSelector = ".b2b-sheet"): Promise<void> {
  let iframe: HTMLIFrameElement | null = null;
  try {
    iframe = await waitForB2BFrame(html, sheetSelector);
    const printWindow = iframe.contentWindow;
    if (!printWindow) throw new Error("Unable to open the print dialog.");
    printWindow.focus();
    printWindow.print();
  } finally {
    window.setTimeout(() => iframe?.remove(), 1200);
  }
}

async function detectB2BDbColumns(): Promise<{
  hasReverseCharge: boolean;
  hasTotalSgst: boolean;
  hasTotalCgst: boolean;
  hasTotalIgst: boolean;
}> {
  const probe = async (column: string) => {
    const { error } = await supabase.from("sales_b2b").select(column).limit(1);
    return !error;
  };
  const [hasReverseCharge, hasTotalSgst, hasTotalCgst, hasTotalIgst] = await Promise.all([
    probe("reverse_charge"),
    probe("total_sgst"),
    probe("total_cgst"),
    probe("total_igst"),
  ]);
  return { hasReverseCharge, hasTotalSgst, hasTotalCgst, hasTotalIgst };
}

const OPTIONAL_B2B_DB_COLUMNS = [
  "reverse_charge",
  "total_sgst",
  "total_cgst",
  "total_igst",
] as const;

function buildSupabaseB2BRow(
  payload: B2BSaleRecord,
  schema: Awaited<ReturnType<typeof detectB2BDbColumns>>,
): Record<string, unknown> {
  const row: Record<string, unknown> = { ...payload };
  const availability: Record<(typeof OPTIONAL_B2B_DB_COLUMNS)[number], boolean> = {
    reverse_charge: schema.hasReverseCharge,
    total_sgst: schema.hasTotalSgst,
    total_cgst: schema.hasTotalCgst,
    total_igst: schema.hasTotalIgst,
  };
  for (const column of OPTIONAL_B2B_DB_COLUMNS) {
    if (!availability[column]) delete row[column];
  }
  return row;
}

function normalizeB2BSale(raw: Record<string, unknown>): B2BSaleRecord {
  let items: SaleItem[] = [];
  if (Array.isArray(raw.items)) {
    items = (raw.items as Record<string, unknown>[]).map(normalizeSaleItem);
  }
  const grandTotal = toDbNumber(raw.grand_total);
  const base: B2BSaleRecord = {
    bill_no: String(raw.bill_no ?? ""),
    buyer_id: raw.buyer_id ? String(raw.buyer_id) : undefined,
    buyer_legal_name: String(raw.buyer_legal_name ?? raw.customer_name ?? ""),
    buyer_trade_name: raw.buyer_trade_name ? String(raw.buyer_trade_name) : undefined,
    buyer_gstin: String(raw.buyer_gstin ?? "").toUpperCase(),
    buyer_pan: raw.buyer_pan ? String(raw.buyer_pan) : undefined,
    buyer_contact_person: raw.buyer_contact_person ? String(raw.buyer_contact_person) : undefined,
    buyer_phone: raw.buyer_phone ? String(raw.buyer_phone) : undefined,
    buyer_email: raw.buyer_email ? String(raw.buyer_email) : undefined,
    buyer_billing_address: String(raw.buyer_billing_address ?? ""),
    buyer_ship_to: raw.buyer_ship_to ? String(raw.buyer_ship_to) : undefined,
    buyer_city: raw.buyer_city ? String(raw.buyer_city) : undefined,
    buyer_state: raw.buyer_state ? String(raw.buyer_state) : undefined,
    buyer_state_code: raw.buyer_state_code ? String(raw.buyer_state_code) : undefined,
    buyer_pincode: raw.buyer_pincode ? String(raw.buyer_pincode) : undefined,
    form_type: String(raw.form_type ?? "Tax Invoice"),
    bill_date: String(raw.bill_date ?? ""),
    customer_name: String(raw.customer_name ?? raw.buyer_legal_name ?? ""),
    customer_phone: raw.customer_phone ? String(raw.customer_phone) : undefined,
    ship_to: raw.ship_to ? String(raw.ship_to) : undefined,
    salesman: raw.salesman ? String(raw.salesman) : undefined,
    vehicle_no: raw.vehicle_no ? String(raw.vehicle_no) : undefined,
    branch_godown: String(raw.branch_godown ?? "Shop (Main Showroom)"),
    rate_tp: String(raw.rate_tp ?? "Wholesale"),
    items,
    subtotal: toDbNumber(raw.subtotal),
    f_cess: toDbNumber(raw.f_cess),
    discount: toDbNumber(raw.discount),
    total_gst: toDbNumber(raw.total_gst),
    commission: toDbNumber(raw.commission),
    postage: toDbNumber(raw.postage),
    round_off: toDbNumber(raw.round_off),
    grand_total: grandTotal,
    payment_amount: toDbNumber(raw.payment_amount ?? grandTotal),
    payment_mode: String(raw.payment_mode ?? "Bank Transfer"),
    balance: toDbNumber(raw.balance),
    payment_status: String(raw.payment_status ?? "Credit"),
    created_at: raw.created_at ? String(raw.created_at) : undefined,
  };
  const interState = isInterStateB2B(base);
  const gstFromItems = getBillGstTotals(base.items, interState);
  const withGst: B2BSaleRecord = {
    ...base,
    total_sgst: toDbNumber(raw.total_sgst) || gstFromItems.totalSgst,
    total_cgst: toDbNumber(raw.total_cgst) || gstFromItems.totalCgst,
    total_igst: toDbNumber(raw.total_igst) || (interState ? gstFromItems.totalIgst : 0),
    reverse_charge: raw.reverse_charge === true || raw.reverse_charge === "true",
  };
  return enrichB2BBill(withGst);
}

function buyerDisplayName(b: B2BBuyer): string {
  return b.trade_name?.trim() || b.legal_name;
}

function SampleGstinBadge({ gstin }: { gstin: string }) {
  if (!isSampleGstin(gstin)) return null;
  return (
    <span className="inline-flex items-center text-[9px] font-bold uppercase text-sky-700 bg-sky-50 border border-sky-200 px-1.5 py-0.5 rounded">
      Sample GSTIN
    </span>
  );
}

function seedBuyers(): B2BBuyer[] {
  return [
    {
      id: crypto.randomUUID(),
      legal_name: "Rajan Electricals Pvt Ltd",
      trade_name: "Rajan Electricals",
      gstin: "32AABCR1234F1Z5",
      pan: "AABCR1234F",
      contact_person: "Rajan K.",
      phone: "9847012345",
      billing_address: "Industrial Estate, Thopramkudy, Kerala",
      city: "Thopramkudy",
      state: "Kerala",
      state_code: "32",
      pincode: "685551",
      business_type: "Wholesaler",
      is_active: true,
    },
    {
      id: crypto.randomUUID(),
      legal_name: "Suresh Hardware & Contractors",
      gstin: "32AACCS5678G1Z8",
      contact_person: "Suresh Nair",
      phone: "9895012345",
      billing_address: "Main Road, Kumily, Kerala",
      city: "Kumily",
      state: "Kerala",
      state_code: "32",
      business_type: "Contractor",
      is_active: true,
    },
  ];
}

function isMissingTableError(error: { code?: string; message?: string }): boolean {
  const message = (error.message ?? "").toLowerCase();
  if (error.code === "PGRST205" || error.code === "42P01") return true;
  if (message.includes("could not find the table")) return true;
  return message.includes("relation") && message.includes("does not exist");
}

// ─── Searchable selects ───────────────────────────────────────────────────────

function SearchableBuyerSelect({
  buyers, value, onChange, placeholder = "Search GST-registered buyer...",
}: {
  buyers: B2BBuyer[];
  value: string;
  onChange: (buyer: B2BBuyer) => void;
  placeholder?: string;
}) {
  const [isOpen, setIsOpen] = useState(false);
  const [search, setSearch] = useState("");
  const [dropStyle, setDropStyle] = useState<{ top: number; left: number; width: number } | null>(null);
  const btnRef = useRef<HTMLButtonElement>(null);
  const selected = buyers.find((b) => b.id === value);

  const filtered = useMemo(() => {
    const q = search.toLowerCase();
    return buyers.filter((b) =>
      b.legal_name.toLowerCase().includes(q) ||
      (b.trade_name ?? "").toLowerCase().includes(q) ||
      b.gstin.toLowerCase().includes(q)
    );
  }, [buyers, search]);

  const openDrop = () => {
    if (btnRef.current) {
      const r = btnRef.current.getBoundingClientRect();
      const dropH = Math.min(280, filtered.length * 48 + 52);
      const top = window.innerHeight - r.bottom >= dropH ? r.bottom + 4 : r.top - dropH - 4;
      setDropStyle({ top, left: r.left, width: r.width });
    }
    setIsOpen(true);
  };

  return (
    <div className="relative w-full text-left">
      <button ref={btnRef} type="button" onClick={() => (isOpen ? setIsOpen(false) : openDrop())}
        className="w-full flex items-center justify-between bg-white text-xs border border-slate-300 rounded py-2 px-3 focus:outline-none focus:ring-2 focus:ring-primary/10 focus:border-primary">
        <span className="truncate text-left">
          {selected
            ? `${buyerDisplayName(selected)} · ${selected.gstin}`
            : placeholder}
        </span>
        <span className="ml-1 text-slate-400 text-[9px]">{isOpen ? "▲" : "▼"}</span>
      </button>
      {isOpen && dropStyle && (
        <>
          <div className="fixed inset-0 z-[60]" onClick={() => { setIsOpen(false); setSearch(""); }} />
          <div className="fixed z-[70] bg-white border border-slate-200 rounded-lg shadow-2xl overflow-hidden flex flex-col"
            style={{ top: dropStyle.top, left: dropStyle.left, width: dropStyle.width, maxHeight: 280 }}>
            <div className="p-2 border-b border-slate-100">
              <input autoFocus type="text" value={search} onChange={(e) => setSearch(e.target.value)}
                placeholder="Name or GSTIN..." className="w-full text-xs border border-slate-300 rounded px-2 py-1.5" />
            </div>
            <ul className="overflow-y-auto py-1 flex-1">
              {filtered.length === 0
                ? <li className="px-3 py-2 text-xs text-slate-500 text-center">No buyers found</li>
                : filtered.map((b) => (
                  <li key={b.id} onClick={() => { onChange(b); setIsOpen(false); setSearch(""); }}
                    className={`px-3 py-2 text-xs cursor-pointer hover:bg-violet-50 border-b border-slate-50 last:border-0 ${b.id === value ? "bg-violet-100/60 font-semibold" : ""}`}>
                    <div className="font-semibold text-slate-800">{buyerDisplayName(b)}</div>
                    <div className="text-[10px] text-slate-500 font-mono mt-0.5 flex items-center gap-1.5 flex-wrap">
                      <span>{b.gstin}</span>
                      <SampleGstinBadge gstin={b.gstin} />
                    </div>
                  </li>
                ))}
            </ul>
          </div>
        </>
      )}
    </div>
  );
}

function SearchableProductSelect({
  items, value, onChange,
}: { items: InventoryItem[]; value: string; onChange: (item: InventoryItem) => void }) {
  const [isOpen, setIsOpen] = useState(false);
  const [search, setSearch] = useState("");
  const [dropStyle, setDropStyle] = useState<{ top: number; left: number; width: number } | null>(null);
  const btnRef = useRef<HTMLButtonElement>(null);
  const selected = items.find((i) => normalizeItemCode(i.code) === normalizeItemCode(value));
  const filtered = useMemo(() => {
    const q = search.toLowerCase();
    return items.filter((i) =>
      String(i.name ?? "").toLowerCase().includes(q) ||
      String(i.code ?? "").toLowerCase().includes(q)
    );
  }, [items, search]);

  const openDrop = () => {
    if (btnRef.current) {
      const r = btnRef.current.getBoundingClientRect();
      setDropStyle({ top: r.bottom + 4, left: r.left, width: r.width });
    }
    setIsOpen(true);
  };

  return (
    <div className="relative w-full">
      <button ref={btnRef} type="button" onClick={() => (isOpen ? setIsOpen(false) : openDrop())}
        className="w-full flex items-center justify-between bg-white text-[11px] border border-slate-300 rounded py-1.5 px-2">
        <span className="truncate">{selected ? `${selected.code} - ${selected.name}` : "Search item..."}</span>
        <span className="text-slate-400 text-[9px]">{isOpen ? "▲" : "▼"}</span>
      </button>
      {isOpen && dropStyle && (
        <>
          <div className="fixed inset-0 z-[60]" onClick={() => { setIsOpen(false); setSearch(""); }} />
          <div className="fixed z-[70] bg-white border rounded-lg shadow-2xl overflow-hidden flex flex-col"
            style={{ top: dropStyle.top, left: dropStyle.left, width: dropStyle.width, maxHeight: 240 }}>
            <div className="p-2 border-b">
              <input autoFocus value={search} onChange={(e) => setSearch(e.target.value)}
                className="w-full text-xs border rounded px-2 py-1" placeholder="Code / name" />
            </div>
            <ul className="overflow-y-auto">
              {filtered.map((item) => (
                <li key={item.code} onClick={() => { onChange(item); setIsOpen(false); setSearch(""); }}
                  className="px-3 py-2 text-xs cursor-pointer hover:bg-green-50 border-b border-slate-50">
                  <div className="font-semibold">{item.code}</div>
                  <div className="text-[10px] text-slate-500 truncate">{item.name}</div>
                </li>
              ))}
            </ul>
          </div>
        </>
      )}
    </div>
  );
}

// ─── Main Page ────────────────────────────────────────────────────────────────

export default function SalesB2BPage() {
  const [activeTab, setActiveTab] = useState<PageTab>("bills");
  const [buyers, setBuyers] = useState<B2BBuyer[]>([]);
  const [bills, setBills] = useState<B2BSaleRecord[]>([]);
  const [inventory, setInventory] = useState<InventoryItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [dbStatus, setDbStatus] = useState<"connected" | "local">("connected");

  const [billSearch, setBillSearch] = useState("");
  const [buyerSearch, setBuyerSearch] = useState("");

  const [isBuyerFormOpen, setIsBuyerFormOpen] = useState(false);
  const [editingBuyer, setEditingBuyer] = useState<B2BBuyer | null>(null);
  const [isBillFormOpen, setIsBillFormOpen] = useState(false);
  const [editingBill, setEditingBill] = useState<B2BSaleRecord | null>(null);
  const [viewingBill, setViewingBill] = useState<B2BSaleRecord | null>(null);
  const [whatsappShare, setWhatsappShare] = useState<WhatsAppShareConfig | null>(null);
  const [buyerToDelete, setBuyerToDelete] = useState<B2BBuyer | null>(null);
  const [sampleGstinBuyer, setSampleGstinBuyer] = useState<B2BBuyer | null>(null);

  const [isStatementModalOpen, setIsStatementModalOpen] = useState(false);
  const [statementBuyerId, setStatementBuyerId] = useState("");
  const [statementMode, setStatementMode] = useState<B2BReportMode>("full");
  const [statementDate, setStatementDate] = useState(todayIso());
  const [statementMonth, setStatementMonth] = useState(() => todayIso().slice(0, 7));
  const [statementFrom, setStatementFrom] = useState(() => `${todayIso().slice(0, 7)}-01`);
  const [statementTo, setStatementTo] = useState(todayIso());
  const [statementStatusFilter, setStatementStatusFilter] = useState("All");
  const [statementError, setStatementError] = useState<string | null>(null);

  const [isBuyerPrintModalOpen, setIsBuyerPrintModalOpen] = useState(false);
  const [buyerPrintMode, setBuyerPrintMode] = useState<BuyerPrintMode>("individual");
  const [buyerPrintIndividualId, setBuyerPrintIndividualId] = useState("");
  const [buyerPrintGroupScope, setBuyerPrintGroupScope] = useState<BuyerPrintGroupScope>("active");
  const [buyerPrintSelectedIds, setBuyerPrintSelectedIds] = useState<string[]>([]);
  const [buyerPrintBusinessType, setBuyerPrintBusinessType] = useState("All");
  const [buyerPrintStateFilter, setBuyerPrintStateFilter] = useState("All");
  const [buyerPrintActiveFilter, setBuyerPrintActiveFilter] = useState<"all" | "active" | "inactive">("all");
  const [buyerPrintBillFilter, setBuyerPrintBillFilter] = useState<"all" | "with_bills" | "without_bills">("all");
  const [buyerPrintUseSearch, setBuyerPrintUseSearch] = useState(true);
  const [buyerPrintError, setBuyerPrintError] = useState<string | null>(null);

  const [formError, setFormError] = useState<string | null>(null);
  const [successMsg, setSuccessMsg] = useState<string | null>(null);

  // Buyer form fields
  const [legalName, setLegalName] = useState("");
  const [tradeName, setTradeName] = useState("");
  const [gstin, setGstin] = useState("");
  const [pan, setPan] = useState("");
  const [contactPerson, setContactPerson] = useState("");
  const [buyerPhone, setBuyerPhone] = useState("");
  const [buyerEmail, setBuyerEmail] = useState("");
  const [billingAddress, setBillingAddress] = useState("");
  const [shipToAddress, setShipToAddress] = useState("");
  const [city, setCity] = useState("");
  const [state, setState] = useState("Kerala");
  const [stateCode, setStateCode] = useState("32");
  const [pincode, setPincode] = useState("");
  const [businessType, setBusinessType] = useState("Business");
  const [buyerNotes, setBuyerNotes] = useState("");

  // Bill form fields
  const [billNo, setBillNo] = useState("");
  const [formType, setFormType] = useState("Tax Invoice");
  const [billDate, setBillDate] = useState(todayIso());
  const [selectedBuyerId, setSelectedBuyerId] = useState("");
  const [branchGodown, setBranchGodown] = useState(BRANCHES[0]);
  const [rateTp, setRateTp] = useState("Wholesale");
  const [salesman, setSalesman] = useState("Manager");
  const [vehicleNo, setVehicleNo] = useState("");
  const [shipTo, setShipTo] = useState("");
  const [gridItems, setGridItems] = useState<SaleItem[]>([blankItem()]);
  const [fCess, setFCess] = useState("");
  const [discount, setDiscount] = useState("");
  const [commission, setCommission] = useState("");
  const [postage, setPostage] = useState("");
  const [paymentAmount, setPaymentAmount] = useState("");
  const [paymentMode, setPaymentMode] = useState("Bank Transfer");
  const [reverseCharge, setReverseCharge] = useState(false);
  const b2bDbColumnsRef = useRef<Awaited<ReturnType<typeof detectB2BDbColumns>>>({
    hasReverseCharge: false,
    hasTotalSgst: false,
    hasTotalCgst: false,
    hasTotalIgst: false,
  });
  const [purchaseItemMap, setPurchaseItemMap] = useState<Map<string, PurchaseLineLookup>>(new Map());
  const [purchaseGstMaps, setPurchaseGstMaps] = useState(() => buildPurchaseGstMaps([]));
  const [retailPriceMap, setRetailPriceMap] = useState<Map<string, number>>(new Map());

  const b2bItemPriceMap = useMemo(() => buildItemPriceMapFromBills(bills), [bills]);

  const activeBuyers = useMemo(() => buyers.filter((b) => b.is_active), [buyers]);

  const buyersForBillForm = useMemo(() => {
    const list = [...activeBuyers];
    if (editingBill) {
      const found = list.some(
        (b) => b.id === editingBill.buyer_id
          || b.gstin.toUpperCase() === editingBill.buyer_gstin.toUpperCase(),
      );
      if (!found) list.unshift(buyerFromBill(editingBill));
    }
    return list;
  }, [activeBuyers, editingBill]);

  const selectedBuyer = useMemo(
    () => buyersForBillForm.find((b) => b.id === selectedBuyerId) ?? null,
    [buyersForBillForm, selectedBuyerId],
  );

  const loadLocalBuyers = useCallback(() => {
    const local = localStorage.getItem(LOCAL_BUYERS_KEY);
    if (local) {
      try {
        setBuyers((JSON.parse(local) as Record<string, unknown>[]).map(normalizeBuyer));
      } catch {
        const seed = seedBuyers();
        localStorage.setItem(LOCAL_BUYERS_KEY, JSON.stringify(seed));
        setBuyers(seed);
      }
    } else {
      const seed = seedBuyers();
      localStorage.setItem(LOCAL_BUYERS_KEY, JSON.stringify(seed));
      setBuyers(seed);
    }
  }, []);

  const loadLocalBills = useCallback(() => {
    const local = localStorage.getItem(LOCAL_SALES_KEY);
    if (local) {
      try {
        setBills((JSON.parse(local) as Record<string, unknown>[]).map(normalizeB2BSale));
      } catch {
        setBills([]);
      }
    } else {
      setBills([]);
    }
  }, []);

  const fetchBuyers = useCallback(async () => {
    try {
      const rows: Record<string, unknown>[] = [];
      let from = 0;
      while (true) {
        const { data, error } = await supabase
          .from("b2b_buyers")
          .select("*")
          .order("legal_name")
          .range(from, from + FETCH_PAGE_SIZE - 1);
        if (error) {
          if (isMissingTableError(error)) {
            setDbStatus("local");
            loadLocalBuyers();
          }
          return;
        }
        if (!data?.length) break;
        rows.push(...(data as Record<string, unknown>[]));
        if (data.length < FETCH_PAGE_SIZE) break;
        from += FETCH_PAGE_SIZE;
      }
      setBuyers(rows.map(normalizeBuyer));
      localStorage.setItem(LOCAL_BUYERS_KEY, JSON.stringify(rows));
    } catch {
      setDbStatus("local");
      loadLocalBuyers();
    }
  }, [loadLocalBuyers]);

  const fetchBills = useCallback(async () => {
    try {
      setLoading(true);
      const rows: Record<string, unknown>[] = [];
      let from = 0;
      while (true) {
        const { data, error } = await supabase
          .from("sales_b2b")
          .select("*")
          .order("created_at", { ascending: false })
          .range(from, from + FETCH_PAGE_SIZE - 1);
        if (error) {
          if (isMissingTableError(error)) {
            setDbStatus("local");
            loadLocalBills();
          }
          return;
        }
        if (!data?.length) break;
        rows.push(...(data as Record<string, unknown>[]));
        if (data.length < FETCH_PAGE_SIZE) break;
        from += FETCH_PAGE_SIZE;
      }
      const schema = await detectB2BDbColumns();
      b2bDbColumnsRef.current = schema;
      setBills(rows.map(normalizeB2BSale));
      setDbStatus("connected");
      localStorage.setItem(LOCAL_SALES_KEY, JSON.stringify(rows));
    } catch {
      setDbStatus("local");
      loadLocalBills();
    } finally {
      setLoading(false);
    }
  }, [loadLocalBills]);

  const fetchInventory = useCallback(async () => {
    try {
      const { data, error } = await supabase.from("inventory").select("code, name, hsn_code, uom").order("name");
      if (!error && data) {
        setInventory(data as InventoryItem[]);
        return;
      }
    } catch { /* fall through */ }
    const local = localStorage.getItem("kaniyamparambil_inventory");
    if (local) {
      try { setInventory(JSON.parse(local)); } catch { setInventory([]); }
    }
  }, []);

  const fetchProductLookups = useCallback(async () => {
    try {
      const purchaseRows: Array<{ items: unknown[] }> = [];
      let from = 0;
      while (true) {
        const { data, error } = await supabase
          .from("purchases")
          .select("items, created_at")
          .order("created_at", { ascending: false })
          .range(from, from + PURCHASE_LOOKUP_PAGE_SIZE - 1);
        if (error) throw error;
        if (!data?.length) break;
        purchaseRows.push(...(data as Array<{ items: unknown[] }>));
        if (data.length < PURCHASE_LOOKUP_PAGE_SIZE) break;
        from += PURCHASE_LOOKUP_PAGE_SIZE;
      }
      setPurchaseItemMap(buildPurchaseItemMap(purchaseRows));
      setPurchaseGstMaps(buildPurchaseGstMaps(purchaseRows));

      const salesRows: Array<{ items: unknown[] }> = [];
      from = 0;
      while (true) {
        const { data, error } = await supabase
          .from("sales")
          .select("items, created_at")
          .order("created_at", { ascending: false })
          .range(from, from + PURCHASE_LOOKUP_PAGE_SIZE - 1);
        if (error) break;
        if (!data?.length) break;
        salesRows.push(...(data as Array<{ items: unknown[] }>));
        if (data.length < PURCHASE_LOOKUP_PAGE_SIZE) break;
        from += PURCHASE_LOOKUP_PAGE_SIZE;
      }
      if (salesRows.length > 0) {
        setRetailPriceMap(buildItemPriceMapFromSalesRows(salesRows));
      }
    } catch {
      const localPurchases = localStorage.getItem("kaniyamparambil_purchases");
      if (localPurchases) {
        try {
          setPurchaseItemMap(buildPurchaseItemMap(JSON.parse(localPurchases) as Array<{ items: unknown[] }>));
          setPurchaseGstMaps(buildPurchaseGstMaps(JSON.parse(localPurchases) as Array<{ items: unknown[] }>));
        } catch { /* ignore */ }
      }
      const localSales = localStorage.getItem("kaniyamparambil_sales_v2");
      if (localSales) {
        try {
          setRetailPriceMap(buildItemPriceMapFromSalesRows(JSON.parse(localSales) as Array<{ items: unknown[] }>));
        } catch { /* ignore */ }
      }
    }
  }, []);

  useEffect(() => {
    fetchBuyers();
    fetchBills();
    fetchInventory();
    fetchProductLookups();
  }, [fetchBuyers, fetchBills, fetchInventory, fetchProductLookups]);

  useEffect(() => {
    if (isBillFormOpen) fetchProductLookups();
  }, [isBillFormOpen, fetchProductLookups]);

  useEffect(() => {
    if (!editingBill) {
      setBillNo(getNextB2BBillNo(bills.map((b) => b.bill_no)));
    }
  }, [bills, editingBill]);

  const billInterState = useMemo(
    () => (selectedBuyer ? isInterStateB2B({ buyer_state_code: selectedBuyer.state_code }) : false),
    [selectedBuyer],
  );

  const calc = useMemo(() => {
    let sub = 0;
    let totalCgst = 0;
    let totalSgst = 0;
    let linesTotal = 0;
    gridItems.forEach((item) => {
      const s = getSaleItemSummary(item);
      sub += s.taxableValue;
      totalCgst += s.cgstAmount;
      totalSgst += s.sgstAmount;
      linesTotal += s.total;
    });
    const discNum = Number(discount) || 0;
    const rawTotal = linesTotal - discNum + (Number(fCess) || 0) + (Number(commission) || 0) + (Number(postage) || 0);
    const roundOff = Math.round(rawTotal) - rawTotal;
    const grandTotal = rawTotal + roundOff;
    const totalGst = totalCgst + totalSgst;
    const cgstRate = sub > 0 ? (totalCgst / sub) * 100 : 0;
    const sgstRate = sub > 0 ? (totalSgst / sub) * 100 : 0;
    const igstRate = billInterState && sub > 0 ? (totalGst / sub) * 100 : 0;
    return {
      subtotal: Math.round(sub * 100) / 100,
      totalCgst: Math.round(totalCgst * 100) / 100,
      totalSgst: Math.round(totalSgst * 100) / 100,
      totalIgst: billInterState ? Math.round(totalGst * 100) / 100 : 0,
      totalGst: Math.round(totalGst * 100) / 100,
      cgstRate,
      sgstRate,
      igstRate,
      interState: billInterState,
      roundOff: Math.round(roundOff * 100) / 100,
      grandTotal: Math.round(grandTotal * 100) / 100,
    };
  }, [gridItems, discount, fCess, commission, postage, billInterState]);

  useEffect(() => {
    if (calc.grandTotal > 0 && isBillFormOpen) setPaymentAmount(String(calc.grandTotal));
  }, [calc.grandTotal, isBillFormOpen]);

  const filteredBills = useMemo(() => {
    const q = billSearch.toLowerCase();
    return bills.filter((b) =>
      b.bill_no.toLowerCase().includes(q) ||
      b.buyer_legal_name.toLowerCase().includes(q) ||
      b.buyer_gstin.toLowerCase().includes(q)
    );
  }, [bills, billSearch]);

  const filteredBuyersList = useMemo(() => {
    const q = buyerSearch.toLowerCase();
    return buyers.filter((b) =>
      b.legal_name.toLowerCase().includes(q) ||
      (b.trade_name ?? "").toLowerCase().includes(q) ||
      b.gstin.toLowerCase().includes(q)
    );
  }, [buyers, buyerSearch]);

  const viewingBillGst = useMemo(() => {
    if (!viewingBill) return null;
    const interState = isInterStateB2B(viewingBill);
    return { ...getBillGstTotals(viewingBill.items, interState), interState };
  }, [viewingBill]);

  const resetBuyerForm = () => {
    setEditingBuyer(null);
    setLegalName(""); setTradeName(""); setGstin(""); setPan("");
    setContactPerson(""); setBuyerPhone(""); setBuyerEmail("");
    setBillingAddress(""); setShipToAddress(""); setCity("");
    setState("Kerala"); setStateCode("32"); setPincode("");
    setBusinessType("Business"); setBuyerNotes("");
    setFormError(null);
    setIsBuyerFormOpen(false);
  };

  const openAddBuyer = () => {
    resetBuyerForm();
    setIsBuyerFormOpen(true);
  };

  const openEditBuyer = (b: B2BBuyer) => {
    setEditingBuyer(b);
    setLegalName(b.legal_name);
    setTradeName(b.trade_name ?? "");
    setGstin(b.gstin);
    setPan(b.pan ?? "");
    setContactPerson(b.contact_person ?? "");
    setBuyerPhone(b.phone ?? "");
    setBuyerEmail(b.email ?? "");
    setBillingAddress(b.billing_address);
    setShipToAddress(b.ship_to_address ?? "");
    setCity(b.city ?? "");
    setState(b.state);
    setStateCode(b.state_code);
    setPincode(b.pincode ?? "");
    setBusinessType(b.business_type);
    setBuyerNotes(b.notes ?? "");
    setFormError(null);
    setIsBuyerFormOpen(true);
  };

  const handleBuyerSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setFormError(null);
    const gst = gstin.trim().toUpperCase();
    if (!legalName.trim()) { setFormError("Legal / registered company name is required."); return; }
    if (!validateGstin(gst)) { setFormError("Enter a valid GSTIN (or sample format e.g. 32TESTMR0018A1Z8)."); return; }
    if (!billingAddress.trim()) { setFormError("Billing address is required."); return; }

    const duplicate = buyers.find(
      (b) => b.gstin.toUpperCase() === gst && b.id !== editingBuyer?.id,
    );
    if (duplicate) { setFormError(`GSTIN already registered to ${buyerDisplayName(duplicate)}.`); return; }

    const payload: B2BBuyer = {
      id: editingBuyer?.id ?? crypto.randomUUID(),
      legal_name: legalName.trim(),
      trade_name: tradeName.trim() || undefined,
      gstin: gst,
      pan: pan.trim().toUpperCase() || undefined,
      contact_person: contactPerson.trim() || undefined,
      phone: buyerPhone.trim() || undefined,
      email: buyerEmail.trim() || undefined,
      billing_address: billingAddress.trim(),
      ship_to_address: shipToAddress.trim() || undefined,
      city: city.trim() || undefined,
      state,
      state_code: stateCode,
      pincode: pincode.trim() || undefined,
      business_type: businessType,
      notes: buyerNotes.trim() || undefined,
      is_active: true,
    };

    if (dbStatus === "connected") {
      try {
        if (editingBuyer) {
          const { error } = await supabase.from("b2b_buyers").update(payload).eq("id", editingBuyer.id);
          if (error) throw error;
        } else {
          const { error } = await supabase.from("b2b_buyers").insert([payload]);
          if (error) throw error;
        }
        setSuccessMsg(editingBuyer ? "Business updated." : "Business registered.");
        fetchBuyers();
        resetBuyerForm();
      } catch (err) {
        setFormError(err instanceof Error ? err.message : "Save failed.");
      }
    } else {
      const updated = editingBuyer
        ? buyers.map((b) => (b.id === editingBuyer.id ? payload : b))
        : [payload, ...buyers];
      localStorage.setItem(LOCAL_BUYERS_KEY, JSON.stringify(updated));
      setBuyers(updated);
      setSuccessMsg(editingBuyer ? "Business updated (local)." : "Business registered (local).");
      resetBuyerForm();
    }
  };

  const handleDeleteBuyer = async () => {
    if (!buyerToDelete) return;
    const id = buyerToDelete.id;
    const removedName = buyerDisplayName(buyerToDelete);
    if (dbStatus === "connected") {
      const { error } = await supabase.from("b2b_buyers").delete().eq("id", id);
      if (error) {
        setFormError(error.message);
        setBuyerToDelete(null);
        return;
      }
      setBuyerToDelete(null);
      setSuccessMsg(`Removed "${removedName}" from registry.`);
      fetchBuyers();
    } else {
      const updated = buyers.filter((x) => x.id !== id);
      localStorage.setItem(LOCAL_BUYERS_KEY, JSON.stringify(updated));
      setBuyers(updated);
      setBuyerToDelete(null);
      setSuccessMsg(`Removed "${removedName}" from registry.`);
    }
  };

  const resetBillForm = () => {
    setEditingBill(null);
    setFormType("Tax Invoice");
    setBillDate(todayIso());
    setSelectedBuyerId("");
    setBranchGodown(BRANCHES[0]);
    setRateTp("Wholesale");
    setSalesman("Manager");
    setVehicleNo("");
    setShipTo("");
    setGridItems([blankItem()]);
    setFCess(""); setDiscount(""); setCommission(""); setPostage("");
    setPaymentAmount(""); setPaymentMode("Bank Transfer");
    setReverseCharge(false);
    setFormError(null);
    setIsBillFormOpen(false);
  };

  const openNewBill = (preselectBuyer?: B2BBuyer) => {
    if (activeBuyers.length === 0) {
      alert("Register at least one GST-registered business before generating a B2B bill.");
      setActiveTab("buyers");
      openAddBuyer();
      return;
    }
    if (preselectBuyer && isSampleGstin(preselectBuyer.gstin)) {
      setSampleGstinBuyer(preselectBuyer);
      return;
    }
    resetBillForm();
    if (preselectBuyer) applyBuyerToBill(preselectBuyer);
    setIsBillFormOpen(true);
  };

  const handleBillBuyerSelect = (b: B2BBuyer) => {
    if (isSampleGstin(b.gstin)) {
      setSampleGstinBuyer(b);
      setSelectedBuyerId("");
      setShipTo("");
      return;
    }
    applyBuyerToBill(b);
  };

  const openEditBuyerFromSampleGstinWarning = () => {
    const buyer = sampleGstinBuyer;
    if (!buyer) return;
    setSampleGstinBuyer(null);
    resetBillForm();
    setActiveTab("buyers");
    openEditBuyer(buyer);
  };

  const applyBuyerToBill = (b: B2BBuyer) => {
    setSelectedBuyerId(b.id);
    setShipTo(b.ship_to_address ?? b.billing_address);
  };

  const updateGridRow = (idx: number, field: keyof SaleItem, value: string | number) => {
    setGridItems((prev) => prev.map((item, i) => {
      if (i !== idx) return item;
      const updated = { ...item, [field]: value };
      if (["qty", "mrp", "disc_pct", "sgst", "cgst"].includes(field)) {
        return { ...updated, ...computeLineAutos(updated) };
      }
      return updated;
    }));
  };

  const applyProductToLine = (item: SaleItem, prod: InventoryItem): SaleItem => {
    const code = normalizeItemCode(prod.code);
    const codeKey = inventoryLookupKey(code);
    const nameKey = normalizeProductName(prod.name);
    const purchaseData = purchaseItemMap.get(code);
    const priorPrice = b2bItemPriceMap.get(code) ?? retailPriceMap.get(code);
    const gst = resolveLineGstRates({
      inventoryItem: prod,
      purchaseByCode: purchaseGstMaps.byCode.get(codeKey),
      purchaseByName: purchaseGstMaps.byName.get(nameKey),
      rateTpOverride: gstRatesFromRateTp(rateTp),
    });
    const updated: SaleItem = {
      ...item,
      code: prod.code,
      name: prod.name,
      hsn_code: purchaseData?.hsn_code || prod.hsn_code || "",
      unit: purchaseData?.unit || prod.uom || "Nos",
      rate: purchaseData?.purchase_rate ?? 0,
      mrp: resolveSellingUnitPrice(purchaseData, priorPrice),
      sgst: gst.sgst,
      cgst: gst.cgst,
    };
    return { ...updated, ...computeLineAutos(updated) };
  };

  const handleProductSelect = (idx: number, prod: InventoryItem) => {
    setGridItems((prev) => prev.map((item, i) => (i === idx ? applyProductToLine(item, prod) : item)));
  };

  useEffect(() => {
    if (!isBillFormOpen) return;
    setGridItems((prev) => {
      let changed = false;
      const next = prev.map((item) => {
        if (!item.code || item.mrp > 0) return item;
        const inv = inventory.find((p) => normalizeItemCode(p.code) === normalizeItemCode(item.code));
        if (!inv) return item;
        changed = true;
        return applyProductToLine(item, inv);
      });
      return changed ? next : prev;
    });
  }, [isBillFormOpen, purchaseItemMap, purchaseGstMaps, b2bItemPriceMap, retailPriceMap, inventory, rateTp]);

  const handleRateTpChange = (next: string) => {
    setRateTp(next);
    const rates = gstRatesFromRateTp(next);
    if (!rates) return;
    setGridItems((prev) => prev.map((item) => {
      const inv = inventory.find((p) => normalizeItemCode(p.code) === normalizeItemCode(item.code));
      if (inv && !isGstApplicable(inv)) {
        const exempt = { ...item, sgst: 0, cgst: 0 };
        return { ...exempt, ...computeLineAutos(exempt) };
      }
      const updated = { ...item, sgst: rates.sgst, cgst: rates.cgst };
      return { ...updated, ...computeLineAutos(updated) };
    }));
  };

  const handleBillSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setFormError(null);
    if (!selectedBuyer) { setFormError("Select a GST-registered buyer."); return; }
    if (isSampleGstin(selectedBuyer.gstin)) {
      setSampleGstinBuyer(selectedBuyer);
      return;
    }
    if (gridItems.some((i) => !i.name.trim() || i.qty <= 0 || i.mrp <= 0)) {
      setFormError("All items need name, quantity, and unit price.");
      return;
    }

    const paidNum = Number(paymentAmount) || 0;
    const bal = Math.max(0, calc.grandTotal - paidNum);
    const status = paidNum >= calc.grandTotal ? "Paid" : paidNum > 0 ? "Partial" : "Credit";
    const itemsFinal = gridItems.map((item) => ({ ...item, ...computeLineAutos(item) }));

    const interState = isInterStateB2B({ buyer_state_code: selectedBuyer.state_code });

    const payload: B2BSaleRecord = {
      bill_no: billNo,
      buyer_id: selectedBuyer.id.startsWith("snapshot-") ? editingBill?.buyer_id : selectedBuyer.id,
      buyer_legal_name: selectedBuyer.legal_name,
      buyer_trade_name: selectedBuyer.trade_name,
      buyer_gstin: selectedBuyer.gstin,
      buyer_pan: selectedBuyer.pan,
      buyer_contact_person: selectedBuyer.contact_person,
      buyer_phone: selectedBuyer.phone,
      buyer_email: selectedBuyer.email,
      buyer_billing_address: selectedBuyer.billing_address,
      buyer_ship_to: selectedBuyer.ship_to_address,
      buyer_city: selectedBuyer.city,
      buyer_state: selectedBuyer.state,
      buyer_state_code: selectedBuyer.state_code,
      buyer_pincode: selectedBuyer.pincode,
      form_type: formType,
      bill_date: billDate,
      customer_name: selectedBuyer.legal_name,
      customer_phone: selectedBuyer.phone,
      ship_to: shipTo.trim() || selectedBuyer.ship_to_address || undefined,
      salesman: salesman || undefined,
      vehicle_no: vehicleNo.trim() || undefined,
      branch_godown: branchGodown,
      rate_tp: rateTp,
      items: itemsFinal,
      subtotal: calc.subtotal,
      f_cess: Number(fCess) || 0,
      discount: Number(discount) || 0,
      total_gst: calc.totalGst,
      total_sgst: calc.totalSgst,
      total_cgst: calc.totalCgst,
      total_igst: interState ? calc.totalIgst : 0,
      reverse_charge: reverseCharge,
      commission: Number(commission) || 0,
      postage: Number(postage) || 0,
      round_off: calc.roundOff,
      grand_total: calc.grandTotal,
      payment_amount: paidNum,
      payment_mode: paymentMode,
      balance: bal,
      payment_status: status,
    };

    if (editingBill) {
      if (dbStatus === "connected") {
        try {
          const row = buildSupabaseB2BRow(payload, b2bDbColumnsRef.current);
          const { error } = await supabase.from("sales_b2b").update(row).eq("bill_no", editingBill.bill_no);
          if (error) throw error;
          setSuccessMsg(`Updated B2B bill ${billNo}.`);
          fetchBills();
          resetBillForm();
        } catch (err) {
          setFormError(err instanceof Error ? err.message : "Update failed.");
        }
      } else {
        const updated = bills.map((b) => (b.bill_no === editingBill.bill_no ? payload : b));
        localStorage.setItem(LOCAL_SALES_KEY, JSON.stringify(updated));
        setBills(updated);
        setSuccessMsg(`Updated B2B bill ${billNo} (local).`);
        resetBillForm();
      }
    } else {
      if (bills.some((b) => b.bill_no === billNo)) {
        setFormError(`Bill No. "${billNo}" already exists.`);
        return;
      }
      if (dbStatus === "connected") {
        try {
          const row = buildSupabaseB2BRow(payload, b2bDbColumnsRef.current);
          const { error } = await supabase.from("sales_b2b").insert([row]);
          if (error) throw error;
          setSuccessMsg(`B2B bill ${billNo} saved.`);
          fetchBills();
          resetBillForm();
        } catch (err) {
          setFormError(err instanceof Error ? err.message : "Save failed.");
        }
      } else {
        const updated = [payload, ...bills];
        localStorage.setItem(LOCAL_SALES_KEY, JSON.stringify(updated));
        setBills(updated);
        setSuccessMsg(`B2B bill ${billNo} saved (local).`);
        resetBillForm();
      }
    }
  };

  const handleDeleteBill = async (bn: string) => {
    if (!window.confirm(`Delete B2B bill "${bn}"?`)) return;
    if (dbStatus === "connected") {
      const { error } = await supabase.from("sales_b2b").delete().eq("bill_no", bn);
      if (error) { alert(error.message); return; }
      fetchBills();
    } else {
      const updated = bills.filter((b) => b.bill_no !== bn);
      localStorage.setItem(LOCAL_SALES_KEY, JSON.stringify(updated));
      setBills(updated);
    }
  };

  const handleStartEdit = (rec: B2BSaleRecord) => {
    const bill = enrichB2BBill(rec);
    setEditingBill(bill);
    setBillNo(bill.bill_no);
    setFormType(bill.form_type);
    setBillDate(bill.bill_date.slice(0, 10));
    const buyer = buyers.find(
      (b) => b.id === bill.buyer_id
        || b.gstin.toUpperCase() === bill.buyer_gstin.toUpperCase(),
    );
    setSelectedBuyerId(buyer?.id ?? buyerFromBill(bill).id);
    setShipTo(bill.ship_to ?? bill.buyer_ship_to ?? buyer?.ship_to_address ?? buyer?.billing_address ?? "");
    setBranchGodown(bill.branch_godown);
    setRateTp(bill.rate_tp);
    setSalesman(bill.salesman ?? "Manager");
    setVehicleNo(bill.vehicle_no ?? "");
    setGridItems(bill.items.length > 0 ? bill.items : [blankItem()]);
    setFCess(String(bill.f_cess || ""));
    setDiscount(String(bill.discount || ""));
    setCommission(String(bill.commission || ""));
    setPostage(String(bill.postage || ""));
    setPaymentAmount(String(bill.payment_amount));
    setPaymentMode(bill.payment_mode);
    setReverseCharge(Boolean(bill.reverse_charge));
    setFormError(null);
    setViewingBill(null);
    setIsBillFormOpen(true);
  };

  const handlePrintBill = async (rec: B2BSaleRecord) => {
    try {
      await printB2BHtml(buildB2BInvoiceHtml(enrichB2BBill(rec), {
        renderMode: "pdf",
        helperText: "B2B tax invoice — print or save as PDF.",
      }));
    } catch (err) {
      alert(`Print failed: ${err instanceof Error ? err.message : "Unknown error"}`);
    }
  };

  const generateB2BBillPdfBlob = async (rec: B2BSaleRecord) => {
    let iframe: HTMLIFrameElement | null = null;
    try {
      iframe = await waitForB2BFrame(
        buildB2BInvoiceHtml(enrichB2BBill(rec), { renderMode: "pdf" }),
        ".b2b-sheet",
      );
      const sheet = iframe.contentDocument?.querySelector(".b2b-sheet");
      if (!(sheet instanceof HTMLElement)) {
        throw new Error("Unable to prepare the B2B document layout for PDF export.");
      }
      const blob = await renderElementToPdfBlob(sheet, "fit-single");
      return { blob, filename: `b2b_tax_invoice_${rec.bill_no}.pdf` };
    } finally {
      iframe?.remove();
    }
  };

  const handleDownloadBill = async (rec: B2BSaleRecord) => {
    try {
      await exportB2BPdf(
        buildB2BInvoiceHtml(enrichB2BBill(rec), { renderMode: "pdf" }),
        `b2b_tax_invoice_${rec.bill_no}.pdf`,
      );
    } catch (err) {
      alert(`PDF download failed: ${err instanceof Error ? err.message : "Unknown error"}`);
    }
  };

  const openWhatsAppShare = (rec: B2BSaleRecord) => {
    const enriched = enrichB2BBill(rec);
    const buyer = buyerFromBill(enriched);
    setWhatsappShare({
      recipientLabel: "Buyer",
      recipientName: enriched.buyer_legal_name,
      initialPhone: buyer.phone,
      documentTitle: `B2B Tax Invoice ${enriched.bill_no}`,
      defaultMessage: `Dear ${enriched.buyer_legal_name},\n\nPlease find your B2B tax invoice ${enriched.bill_no} dated ${formatTableDate(enriched.bill_date)}.\nAmount: ${formatCurrency(enriched.grand_total)}\n\n— NEW KANIYAMPARAMBIL STORES`,
      generatePdf: () => generateB2BBillPdfBlob(enriched),
    });
  };

  const openStatementModal = (prefillBuyerId?: string) => {
    setStatementError(null);
    if (prefillBuyerId) {
      setStatementBuyerId(prefillBuyerId);
    } else if (!statementBuyerId && activeBuyers.length > 0) {
      setStatementBuyerId(activeBuyers[0].id);
    }
    setIsStatementModalOpen(true);
  };

  const resolveB2BStatementReport = (): {
    records: B2BSaleRecord[];
    buyer: B2BBuyer;
    reportType: string;
    periodLabel: string;
    filenameSuffix: string;
  } | null => {
    const buyer = resolveRegistryBuyer(statementBuyerId, buyers);
    if (!buyer) {
      setStatementError("Select a registered business for the statement.");
      return null;
    }

    const buyerBills = filterB2BBillsByBuyer(bills, buyer);
    const applyStatus = (list: B2BSaleRecord[]) =>
      statementStatusFilter === "All"
        ? list
        : list.filter((b) => b.payment_status === statementStatusFilter);

    switch (statementMode) {
      case "full":
        return {
          records: applyStatus([...buyerBills]),
          buyer,
          reportType: "Complete B2B Register (Buyer)",
          periodLabel: `All Bills — ${buyerDisplayName(buyer)}`,
          filenameSuffix: `buyer_${buyer.gstin}_full_${todayIso()}`,
        };
      case "current": {
        const q = billSearch.toLowerCase();
        const filtered = buyerBills.filter((b) =>
          b.bill_no.toLowerCase().includes(q)
          || b.buyer_legal_name.toLowerCase().includes(q)
          || b.buyer_gstin.toLowerCase().includes(q),
        );
        return {
          records: applyStatus(filtered),
          buyer,
          reportType: "Current Table Filter (Buyer)",
          periodLabel: `${buyerDisplayName(buyer)} — Search: ${billSearch.trim() || "—"}`,
          filenameSuffix: `buyer_${buyer.gstin}_filtered_${todayIso()}`,
        };
      }
      case "date": {
        const dated = applyStatus(filterB2BBillsByDate(buyerBills, statementDate));
        return {
          records: dated,
          buyer,
          reportType: "Daily B2B Statement",
          periodLabel: `${formatTableDate(statementDate)} — ${buyerDisplayName(buyer)}`,
          filenameSuffix: `buyer_${buyer.gstin}_date_${statementDate}`,
        };
      }
      case "month": {
        const monthly = applyStatus(filterB2BBillsByMonth(buyerBills, statementMonth));
        return {
          records: monthly,
          buyer,
          reportType: "Monthly B2B Statement",
          periodLabel: `${formatB2BMonthLabel(statementMonth)} — ${buyerDisplayName(buyer)}`,
          filenameSuffix: `buyer_${buyer.gstin}_month_${statementMonth}`,
        };
      }
      case "range": {
        if (statementFrom > statementTo) {
          setStatementError("From date cannot be after To date.");
          return null;
        }
        const ranged = applyStatus(filterB2BBillsByRange(buyerBills, statementFrom, statementTo));
        return {
          records: ranged,
          buyer,
          reportType: "Date Range B2B Statement",
          periodLabel: `${formatTableDate(statementFrom)} to ${formatTableDate(statementTo)} — ${buyerDisplayName(buyer)}`,
          filenameSuffix: `buyer_${buyer.gstin}_${statementFrom}_to_${statementTo}`,
        };
      }
      default:
        return null;
    }
  };

  const buildB2BStatementDocument = () => {
    const report = resolveB2BStatementReport();
    if (!report) return null;
    if (report.records.length === 0) {
      setStatementError("No B2B bills match the selected business and statement period.");
      return null;
    }
    setStatementError(null);
    return buildB2BStatementHtml(
      report.records,
      report.buyer,
      buildB2BStatementMeta(
        report.records,
        report.reportType,
        report.periodLabel,
        statementStatusFilter,
      ),
      { renderMode: "pdf", helperText: "Generating B2B account statement..." },
    );
  };

  const handlePrintB2BStatement = async () => {
    const html = buildB2BStatementDocument();
    if (!html) return;
    try {
      await printB2BHtml(html, ".b2b-statement-sheet");
    } catch (err) {
      alert(`Print failed: ${err instanceof Error ? err.message : "Unknown error"}`);
    }
  };

  const handleDownloadB2BStatement = async () => {
    const report = resolveB2BStatementReport();
    if (!report) return;
    const html = buildB2BStatementDocument();
    if (!html) return;
    try {
      await exportB2BDocPdf(html, `b2b_statement_${report.filenameSuffix}.pdf`, ".b2b-statement-sheet", true);
    } catch (err) {
      alert(`Statement PDF failed: ${err instanceof Error ? err.message : "Unknown error"}`);
    }
  };

  const handleDownloadBuyerProfile = async (buyer: B2BBuyer) => {
    try {
      await exportB2BDocPdf(
        buildB2BBuyerProfileHtml(buyer, { renderMode: "pdf" }),
        `b2b_business_${buyer.gstin}.pdf`,
        ".b2b-buyer-profile-sheet",
        false,
      );
    } catch (err) {
      alert(`PDF download failed: ${err instanceof Error ? err.message : "Unknown error"}`);
    }
  };

  const openBuyerPrintModal = (prefillBuyerId?: string) => {
    setBuyerPrintError(null);
    if (prefillBuyerId) {
      setBuyerPrintMode("individual");
      setBuyerPrintIndividualId(prefillBuyerId);
    } else if (!buyerPrintIndividualId && activeBuyers.length > 0) {
      setBuyerPrintIndividualId(activeBuyers[0].id);
    }
    if (buyerPrintSelectedIds.length === 0 && activeBuyers.length > 0) {
      setBuyerPrintSelectedIds(activeBuyers.map((b) => b.id));
    }
    setIsBuyerPrintModalOpen(true);
  };

  const toggleBuyerPrintSelection = (buyerId: string) => {
    setBuyerPrintSelectedIds((prev) =>
      prev.includes(buyerId)
        ? prev.filter((id) => id !== buyerId)
        : [...prev, buyerId],
    );
  };

  const resolveBuyersForPrint = (): {
    buyers: B2BBuyer[];
    scopeLabel: string;
    reportType: string;
    filenameSuffix: string;
  } | null => {
    const sortBuyers = (list: B2BBuyer[]) =>
      [...list].sort((a, b) => a.legal_name.localeCompare(b.legal_name, undefined, { sensitivity: "base" }));

    if (buyerPrintMode === "individual") {
      const buyer = resolveRegistryBuyer(buyerPrintIndividualId, buyers);
      if (!buyer) {
        setBuyerPrintError("Select a business to print.");
        return null;
      }
      return {
        buyers: [buyer],
        scopeLabel: `Individual — ${buyerDisplayName(buyer)} (${buyer.gstin})`,
        reportType: "Individual Business Profile",
        filenameSuffix: `business_${buyer.gstin}`,
      };
    }

    if (buyerPrintMode === "group") {
      let list: B2BBuyer[];
      let scopeLabel: string;
      if (buyerPrintGroupScope === "all") {
        list = sortBuyers(buyers);
        scopeLabel = `All Registered Businesses (${list.length})`;
      } else if (buyerPrintGroupScope === "active") {
        list = sortBuyers(activeBuyers);
        scopeLabel = `All Active Businesses (${list.length})`;
      } else {
        list = sortBuyers(buyers.filter((b) => buyerPrintSelectedIds.includes(b.id)));
        scopeLabel = `Selected Group (${list.length} businesses)`;
        if (list.length === 0) {
          setBuyerPrintError("Select at least one business for group print.");
          return null;
        }
      }
      return {
        buyers: list,
        scopeLabel,
        reportType: "Business Group Directory",
        filenameSuffix: `businesses_group_${todayIso()}`,
      };
    }

    let list = sortBuyers([...buyers]);
    if (buyerPrintBusinessType !== "All") {
      list = list.filter((b) => b.business_type === buyerPrintBusinessType);
    }
    if (buyerPrintStateFilter !== "All") {
      list = list.filter((b) => b.state === buyerPrintStateFilter);
    }
    if (buyerPrintActiveFilter === "active") {
      list = list.filter((b) => b.is_active);
    } else if (buyerPrintActiveFilter === "inactive") {
      list = list.filter((b) => !b.is_active);
    }
    if (buyerPrintBillFilter === "with_bills") {
      list = list.filter((b) => buyerHasBills(b, bills));
    } else if (buyerPrintBillFilter === "without_bills") {
      list = list.filter((b) => !buyerHasBills(b, bills));
    }
    if (buyerPrintUseSearch && buyerSearch.trim()) {
      list = list.filter((b) => buyerMatchesSearch(b, buyerSearch));
    }

    const filters: string[] = [];
    if (buyerPrintBusinessType !== "All") filters.push(`Type: ${buyerPrintBusinessType}`);
    if (buyerPrintStateFilter !== "All") filters.push(`State: ${buyerPrintStateFilter}`);
    if (buyerPrintActiveFilter !== "all") {
      filters.push(buyerPrintActiveFilter === "active" ? "Active only" : "Inactive only");
    }
    if (buyerPrintBillFilter === "with_bills") filters.push("With B2B bills");
    if (buyerPrintBillFilter === "without_bills") filters.push("Without B2B bills");
    if (buyerPrintUseSearch && buyerSearch.trim()) filters.push(`Search: ${buyerSearch.trim()}`);

    return {
      buyers: list,
      scopeLabel: filters.length > 0
        ? `Filtered — ${filters.join(" · ")} (${list.length})`
        : `All Businesses by Conditions (${list.length})`,
      reportType: "Conditional Business Directory",
      filenameSuffix: `businesses_filtered_${todayIso()}`,
    };
  };

  const buildBuyerPrintDocument = (): {
    html: string;
    sheetSelector: string;
    multiPage: boolean;
  } | null => {
    const resolved = resolveBuyersForPrint();
    if (!resolved) return null;
    if (resolved.buyers.length === 0) {
      setBuyerPrintError("No businesses match the selected print options.");
      return null;
    }
    setBuyerPrintError(null);

    if (resolved.buyers.length === 1) {
      return {
        html: buildB2BBuyerProfileHtml(resolved.buyers[0], {
          renderMode: "pdf",
          helperText: "Registered business profile",
        }),
        sheetSelector: ".b2b-buyer-profile-sheet",
        multiPage: false,
      };
    }

    return {
      html: buildB2BBuyersDirectoryHtml(
        resolved.buyers,
        {
          reportTitle: "REGISTERED BUSINESSES DIRECTORY · B2B",
          scopeLabel: resolved.scopeLabel,
          reportType: resolved.reportType,
          generatedOn: formatB2BGeneratedOn(),
          totalBusinesses: resolved.buyers.length,
        },
        { renderMode: "pdf", helperText: "Generating business directory..." },
      ),
      sheetSelector: ".b2b-buyers-directory-sheet",
      multiPage: true,
    };
  };

  const handlePrintBuyersDirectory = async () => {
    const resolved = resolveBuyersForPrint();
    if (!resolved) return;
    const doc = buildBuyerPrintDocument();
    if (!doc) return;
    try {
      await printB2BHtml(doc.html, doc.sheetSelector);
    } catch (err) {
      alert(`Print failed: ${err instanceof Error ? err.message : "Unknown error"}`);
    }
  };

  const handleDownloadBuyersDirectory = async () => {
    const resolved = resolveBuyersForPrint();
    if (!resolved) return;
    const doc = buildBuyerPrintDocument();
    if (!doc) return;
    try {
      await exportB2BDocPdf(
        doc.html,
        `b2b_${resolved.filenameSuffix}.pdf`,
        doc.sheetSelector,
        doc.multiPage,
      );
    } catch (err) {
      alert(`PDF download failed: ${err instanceof Error ? err.message : "Unknown error"}`);
    }
  };

  const handleStateChange = (stateName: string) => {
    setState(stateName);
    const found = INDIAN_STATES.find((s) => s.name === stateName);
    if (found) setStateCode(found.code);
  };

  return (
    <div className="p-6 space-y-6">
      {dbStatus === "local" && (
        <div className="bg-amber-50 border border-amber-200 rounded-lg p-4 flex items-start gap-3">
          <Database className="w-5 h-5 text-amber-600 mt-0.5 shrink-0" />
          <div>
            <h4 className="text-sm font-semibold text-amber-800">Local Mode</h4>
            <p className="text-xs text-amber-700 mt-0.5">
              B2B tables not found in Supabase. Run <code className="font-mono">sql/07_sales_b2b.sql</code> in the SQL Editor, or data is stored locally until then.
            </p>
          </div>
        </div>
      )}

      {successMsg && (
        <div className="bg-green-50 border border-green-200 text-green-800 text-xs px-4 py-2.5 rounded-md flex items-center gap-2">
          <Check className="w-4 h-4" />{successMsg}
          <button type="button" onClick={() => setSuccessMsg(null)} className="ml-auto"><X className="w-3.5 h-3.5" /></button>
        </div>
      )}

      <div className="flex flex-col lg:flex-row lg:items-center lg:justify-between gap-4">
        <div>
          <div className="flex items-center gap-2">
            <Building2 className="w-6 h-6 text-primary" />
            <h1 className="text-page-title font-semibold text-text-primary">Sales B2B</h1>
          </div>
          <p className="text-caption text-text-secondary mt-0.5">
            GST-registered business buyers · tax invoices · wholesale billing
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <button type="button" onClick={() => openStatementModal()}
            className="btn-secondary flex items-center gap-1.5 text-xs font-bold border-violet-200 text-violet-800 hover:bg-violet-50">
            <FileText className="w-4 h-4" /> B2B Statement
          </button>
          <button type="button" onClick={() => openBuyerPrintModal()}
            className="btn-secondary flex items-center gap-1.5 text-xs font-bold border-violet-200 text-violet-800 hover:bg-violet-50">
            <Printer className="w-4 h-4" /> Print Businesses
          </button>
          <button type="button" onClick={() => openNewBill()}
            className="btn-primary flex items-center gap-1.5 text-xs font-bold">
            <Receipt className="w-4 h-4" /> Generate B2B Bill
          </button>
          <button type="button" onClick={openAddBuyer}
            className="btn-secondary flex items-center gap-1.5 text-xs font-bold border-violet-200 text-violet-800 hover:bg-violet-50">
            <Plus className="w-4 h-4" /> Add Business / Company
          </button>
        </div>
      </div>

      <div className="flex gap-1 border-b border-border">
        {([
          ["bills", "B2B Bills", Receipt],
          ["buyers", "Registered Businesses", Users],
        ] as const).map(([tab, label, Icon]) => (
          <button key={tab} type="button" onClick={() => setActiveTab(tab)}
            className={`flex items-center gap-1.5 px-4 py-2.5 text-xs font-semibold border-b-2 transition-colors ${
              activeTab === tab
                ? "border-primary text-primary"
                : "border-transparent text-text-secondary hover:text-text-primary"
            }`}>
            <Icon className="w-3.5 h-3.5" />{label}
          </button>
        ))}
      </div>

      {activeTab === "bills" && (
        <div className="space-y-4">
          <div className="relative max-w-md">
            <Search className="w-4 h-4 text-text-secondary absolute left-3 top-2.5" />
            <input value={billSearch} onChange={(e) => setBillSearch(e.target.value)}
              placeholder="Search bill no, buyer, GSTIN..."
              className="input-enterprise pl-9 text-xs w-full" />
          </div>
          <div className="rounded-xl border border-border bg-white shadow-card overflow-hidden">
            <table className="w-full text-xs">
              <thead>
                <tr className="bg-slate-50 border-b border-border text-left font-semibold text-slate-600">
                  <th className="px-4 py-3">Bill No.</th>
                  <th className="px-4 py-3">Date</th>
                  <th className="px-4 py-3">Buyer (GSTIN)</th>
                  <th className="px-4 py-3 text-right">Grand Total</th>
                  <th className="px-4 py-3">Status</th>
                  <th className="px-4 py-3 text-center">Actions</th>
                </tr>
              </thead>
              <tbody>
                {loading ? (
                  <tr><td colSpan={6} className="px-4 py-8 text-center text-slate-400">Loading...</td></tr>
                ) : filteredBills.length === 0 ? (
                  <tr>
                    <td colSpan={6} className="px-4 py-10 text-center">
                      <FileText className="w-8 h-8 text-slate-300 mx-auto mb-2" />
                      <p className="text-sm text-slate-500">No B2B bills yet</p>
                      <button type="button" onClick={() => openNewBill()} className="text-primary text-xs font-semibold mt-2 hover:underline">
                        Generate first bill
                      </button>
                    </td>
                  </tr>
                ) : filteredBills.map((b) => (
                  <tr key={b.bill_no} className="border-b border-border hover:bg-slate-50/50">
                    <td className="px-4 py-2.5 font-mono font-semibold">{b.bill_no}</td>
                    <td className="px-4 py-2.5">{formatTableDate(b.bill_date)}</td>
                    <td className="px-4 py-2.5">
                      <div className="font-medium">{b.buyer_legal_name}</div>
                      <div className="text-[10px] font-mono text-slate-500">{b.buyer_gstin}</div>
                    </td>
                    <td className="px-4 py-2.5 text-right font-semibold">{formatCurrency(b.grand_total)}</td>
                    <td className="px-4 py-2.5">
                      <span className={`px-2 py-0.5 rounded text-[10px] font-bold ${
                        b.payment_status === "Paid" ? "bg-green-100 text-green-800"
                          : b.payment_status === "Partial" ? "bg-amber-100 text-amber-800"
                            : "bg-slate-100 text-slate-600"
                      }`}>{b.payment_status}</span>
                    </td>
                    <td className="px-4 py-2.5">
                      <div className="flex items-center justify-center gap-1.5">
                        {[
                          { icon: Eye, title: "View", fn: () => setViewingBill(enrichB2BBill(b)) },
                          { icon: Edit, title: "Edit", fn: () => handleStartEdit(b) },
                          { icon: Printer, title: "Print", fn: () => handlePrintBill(b) },
                          { icon: Download, title: "Download", fn: () => handleDownloadBill(b) },
                        ].map(({ icon: Icon, title, fn }) => (
                          <button key={title} type="button" onClick={fn} title={title}
                            className="text-slate-500 hover:text-slate-900 hover:bg-slate-100 p-1.5 rounded transition-all">
                            <Icon className="w-3.5 h-3.5" />
                          </button>
                        ))}
                        <button
                          type="button"
                          onClick={() => openWhatsAppShare(b)}
                          title="Send via WhatsApp"
                          className="text-green-600 hover:text-green-700 hover:bg-green-50 p-1.5 rounded transition-all"
                        >
                          <WhatsAppIcon />
                        </button>
                        <button type="button" onClick={() => handleDeleteBill(b.bill_no)} title="Delete"
                          className="text-red-500 hover:text-red-700 hover:bg-red-50 p-1.5 rounded transition-all">
                          <Trash2 className="w-3.5 h-3.5" />
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {activeTab === "buyers" && (
        <div className="space-y-4">
          <div className="flex flex-col sm:flex-row gap-2 sm:items-center sm:justify-between">
            <div className="relative max-w-md flex-1">
              <Search className="w-4 h-4 text-text-secondary absolute left-3 top-2.5" />
              <input value={buyerSearch} onChange={(e) => setBuyerSearch(e.target.value)}
                placeholder="Search company, trade name, GSTIN..."
                className="input-enterprise pl-9 text-xs w-full" />
            </div>
            <button type="button" onClick={() => openBuyerPrintModal()}
              className="btn-secondary flex items-center justify-center gap-1.5 text-xs font-bold border-violet-200 text-violet-800 hover:bg-violet-50 shrink-0">
              <Printer className="w-3.5 h-3.5" /> Print Business Details
            </button>
          </div>
          <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
            {filteredBuyersList.length === 0 ? (
              <div className="col-span-full text-center py-12 border border-dashed rounded-xl">
                <Users className="w-8 h-8 text-slate-300 mx-auto mb-2" />
                <p className="text-sm text-slate-500">No registered businesses</p>
                <button type="button" onClick={openAddBuyer} className="text-primary text-xs font-semibold mt-2 hover:underline">
                  Add first business
                </button>
              </div>
            ) : filteredBuyersList.map((b) => (
              <div key={b.id} className="rounded-xl border border-border bg-white p-4 shadow-sm hover:shadow-md transition-shadow">
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0">
                    <h3 className="font-semibold text-slate-900 truncate">{buyerDisplayName(b)}</h3>
                    <p className="text-[10px] font-mono text-violet-700 mt-0.5 flex items-center gap-1.5 flex-wrap">
                      <span>{b.gstin}</span>
                      <SampleGstinBadge gstin={b.gstin} />
                    </p>
                    <p className="text-[10px] text-slate-500 mt-1">{b.business_type}</p>
                  </div>
                  <div className="flex gap-1 shrink-0">
                    <button type="button" onClick={() => openBuyerPrintModal(b.id)} title="Print business profile"
                      className="p-1.5 rounded hover:bg-slate-100 text-slate-600"><Printer className="w-3.5 h-3.5" /></button>
                    <button type="button" onClick={() => handleDownloadBuyerProfile(b)} title="Download business profile"
                      className="p-1.5 rounded hover:bg-slate-100 text-slate-600"><Download className="w-3.5 h-3.5" /></button>
                    <button type="button" onClick={() => openEditBuyer(b)} className="p-1.5 rounded hover:bg-slate-100"><Edit className="w-3.5 h-3.5" /></button>
                    <button type="button" onClick={() => setBuyerToDelete(b)} className="p-1.5 rounded hover:bg-red-50 text-red-600"><Trash2 className="w-3.5 h-3.5" /></button>
                  </div>
                </div>
                <p className="text-xs text-slate-600 mt-2 line-clamp-2">{b.billing_address}</p>
                {b.contact_person && <p className="text-[10px] text-slate-500 mt-1">{b.contact_person} · {b.phone ?? "—"}</p>}
                <button type="button" onClick={() => openNewBill(b)}
                  className="mt-3 w-full text-[10px] font-bold text-primary border border-primary/20 rounded py-1.5 hover:bg-primary/5">
                  Generate Bill for this Buyer
                </button>
                <button type="button" onClick={() => openStatementModal(b.id)}
                  className="mt-2 w-full text-[10px] font-bold text-violet-800 border border-violet-200 rounded py-1.5 hover:bg-violet-50">
                  View Bill Statement
                </button>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Buyer registration modal */}
      {isBuyerFormOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/50 backdrop-blur-sm">
          <div className="bg-white rounded-xl shadow-2xl max-w-2xl w-full max-h-[90vh] overflow-y-auto">
            <div className="bg-violet-950 px-6 py-4 text-white flex items-center justify-between sticky top-0 z-10">
              <div>
                <h2 className="text-sm font-bold">{editingBuyer ? "Edit Business" : "Register GST Business"}</h2>
                <p className="text-[10px] text-violet-200 mt-0.5">For buyers with valid GST registration</p>
              </div>
              <button type="button" onClick={resetBuyerForm}><X className="w-5 h-5" /></button>
            </div>
            <form onSubmit={handleBuyerSubmit} className="p-6 space-y-4">
              {formError && (
                <div className="bg-red-50 border border-red-200 text-red-800 text-xs px-3 py-2 rounded flex gap-2">
                  <AlertTriangle className="w-4 h-4 shrink-0" />{formError}
                </div>
              )}
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div className="md:col-span-2">
                  <label className="form-label text-xs">Legal / Registered Name *</label>
                  <input value={legalName} onChange={(e) => setLegalName(e.target.value)} className="input-enterprise text-xs" required />
                </div>
                <div>
                  <label className="form-label text-xs">Trade Name</label>
                  <input value={tradeName} onChange={(e) => setTradeName(e.target.value)} className="input-enterprise text-xs" placeholder="Optional display name" />
                </div>
                <div>
                  <label className="form-label text-xs">GSTIN *</label>
                  <input value={gstin} onChange={(e) => setGstin(e.target.value.toUpperCase())} maxLength={16}
                    placeholder="e.g. 32AABCR1234F1Z5 or 32TESTMR0018A1Z8"
                    className="input-enterprise text-xs font-mono uppercase" required />
                </div>
                <div>
                  <label className="form-label text-xs">PAN</label>
                  <input value={pan} onChange={(e) => setPan(e.target.value.toUpperCase())} maxLength={10} className="input-enterprise text-xs font-mono uppercase" />
                </div>
                <div>
                  <label className="form-label text-xs">Business Type</label>
                  <select value={businessType} onChange={(e) => setBusinessType(e.target.value)} className="input-enterprise text-xs bg-white">
                    {BUSINESS_TYPES.map((t) => <option key={t} value={t}>{t}</option>)}
                  </select>
                </div>
                <div>
                  <label className="form-label text-xs">Contact Person</label>
                  <input value={contactPerson} onChange={(e) => setContactPerson(e.target.value)} className="input-enterprise text-xs" />
                </div>
                <div>
                  <label className="form-label text-xs">Phone</label>
                  <input value={buyerPhone} onChange={(e) => setBuyerPhone(e.target.value)} className="input-enterprise text-xs" />
                </div>
                <div>
                  <label className="form-label text-xs">Email</label>
                  <input type="email" value={buyerEmail} onChange={(e) => setBuyerEmail(e.target.value)} className="input-enterprise text-xs" />
                </div>
                <div className="md:col-span-2">
                  <label className="form-label text-xs">Billing Address *</label>
                  <textarea value={billingAddress} onChange={(e) => setBillingAddress(e.target.value)} rows={2} className="input-enterprise text-xs" required />
                </div>
                <div className="md:col-span-2">
                  <label className="form-label text-xs">Ship-To Address</label>
                  <textarea value={shipToAddress} onChange={(e) => setShipToAddress(e.target.value)} rows={2} className="input-enterprise text-xs" placeholder="Leave blank if same as billing" />
                </div>
                <div>
                  <label className="form-label text-xs">City</label>
                  <input value={city} onChange={(e) => setCity(e.target.value)} className="input-enterprise text-xs" />
                </div>
                <div>
                  <label className="form-label text-xs">State</label>
                  <select value={state} onChange={(e) => handleStateChange(e.target.value)} className="input-enterprise text-xs bg-white">
                    {INDIAN_STATES.map((s) => <option key={s.code} value={s.name}>{s.name}</option>)}
                  </select>
                </div>
                <div>
                  <label className="form-label text-xs">State Code</label>
                  <input value={stateCode} onChange={(e) => setStateCode(e.target.value)} className="input-enterprise text-xs font-mono" readOnly />
                </div>
                <div>
                  <label className="form-label text-xs">Pincode</label>
                  <input value={pincode} onChange={(e) => setPincode(e.target.value)} className="input-enterprise text-xs" />
                </div>
                <div className="md:col-span-2">
                  <label className="form-label text-xs">Notes</label>
                  <input value={buyerNotes} onChange={(e) => setBuyerNotes(e.target.value)} className="input-enterprise text-xs" />
                </div>
              </div>
              <div className="flex justify-end gap-2 pt-2">
                <button type="button" onClick={resetBuyerForm} className="btn-secondary text-xs">Cancel</button>
                <button type="submit" className="btn-primary text-xs font-bold">
                  {editingBuyer ? "Update Business" : "Register Business"}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* B2B bill modal */}
      {isBillFormOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/50 backdrop-blur-sm">
          <div className="bg-white rounded-xl shadow-2xl w-[min(100rem,98vw)] max-w-none max-h-[92vh] overflow-y-auto flex flex-col">
            <div className="bg-slate-950 px-6 py-4 text-white flex items-center justify-between sticky top-0 z-20">
              <div>
                <h2 className="text-sm font-bold">{editingBill ? "Edit B2B Bill" : "New B2B Tax Invoice"}</h2>
                <p className="text-[10px] text-slate-300">Bill No: {billNo}</p>
              </div>
              <button type="button" onClick={resetBillForm}><X className="w-5 h-5" /></button>
            </div>
            <form onSubmit={handleBillSubmit} className="p-6 space-y-5 flex-1">
              {formError && (
                <div className="bg-red-50 border border-red-200 text-red-800 text-xs px-3 py-2 rounded flex gap-2">
                  <AlertTriangle className="w-4 h-4 shrink-0" />{formError}
                </div>
              )}

              <div className="bg-violet-50 border border-violet-100 rounded-xl p-4 space-y-3">
                <h3 className="text-xs font-bold uppercase text-violet-800">Buyer (GST Registered) *</h3>
                <SearchableBuyerSelect buyers={buyersForBillForm} value={selectedBuyerId}
                  onChange={handleBillBuyerSelect} />
                {selectedBuyer && (
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-2 text-[11px] bg-white rounded-lg border border-violet-100 p-3">
                    <div><span className="text-slate-500">Legal Name:</span> <span className="font-semibold">{selectedBuyer.legal_name}</span></div>
                    <div><span className="text-slate-500">GSTIN:</span>{" "}
                      <span className="font-mono font-semibold">{selectedBuyer.gstin}</span>
                      <SampleGstinBadge gstin={selectedBuyer.gstin} />
                    </div>
                    <div className="md:col-span-2"><span className="text-slate-500">Billing:</span> {selectedBuyer.billing_address}</div>
                    {selectedBuyer.pan && <div><span className="text-slate-500">PAN:</span> {selectedBuyer.pan}</div>}
                    <div><span className="text-slate-500">State:</span> {selectedBuyer.state} ({selectedBuyer.state_code})</div>
                    <div>
                      <span className="text-slate-500">Supply:</span>{" "}
                      <span className={billInterState ? "text-amber-700 font-semibold" : "text-emerald-700 font-semibold"}>
                        {billInterState ? "Inter-State (IGST)" : "Intra-State (CGST + SGST)"}
                      </span>
                    </div>
                  </div>
                )}
              </div>

              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
                <div>
                  <label className="form-label text-xs">Form Type</label>
                  <select value={formType} onChange={(e) => setFormType(e.target.value)} className="input-enterprise text-xs bg-white">
                    {FORM_TYPES.map((t) => <option key={t} value={t}>{t}</option>)}
                  </select>
                </div>
                <div>
                  <label className="form-label text-xs">Bill No.</label>
                  <input value={billNo} onChange={(e) => setBillNo(e.target.value)} disabled={!!editingBill}
                    className="input-enterprise text-xs font-mono" required />
                </div>
                <div>
                  <label className="form-label text-xs">Date</label>
                  <input type="date" value={billDate} onChange={(e) => setBillDate(e.target.value)} className="input-enterprise text-xs" required />
                </div>
                <div>
                  <label className="form-label text-xs">Branch / Godown</label>
                  <select value={branchGodown} onChange={(e) => setBranchGodown(e.target.value)} className="input-enterprise text-xs bg-white">
                    {BRANCHES.map((b) => <option key={b} value={b}>{b}</option>)}
                  </select>
                </div>
                <div>
                  <label className="form-label text-xs">Rate / GST Class</label>
                  <select value={rateTp} onChange={(e) => handleRateTpChange(e.target.value)} className="input-enterprise text-xs bg-white">
                    {RATE_TP_OPTIONS.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
                  </select>
                </div>
                <div>
                  <label className="form-label text-xs flex items-center gap-1"><User className="w-3 h-3" /> Salesman</label>
                  <select value={salesman} onChange={(e) => setSalesman(e.target.value)} className="input-enterprise text-xs bg-white">
                    {SEED_SALESMEN.map((s) => <option key={s} value={s}>{s}</option>)}
                  </select>
                </div>
                <div>
                  <label className="form-label text-xs flex items-center gap-1"><Truck className="w-3 h-3" /> Vehicle No.</label>
                  <input value={vehicleNo} onChange={(e) => setVehicleNo(e.target.value.toUpperCase())} className="input-enterprise text-xs font-mono uppercase" />
                </div>
                <div className="lg:col-span-2">
                  <label className="form-label text-xs">Ship To</label>
                  <input value={shipTo} onChange={(e) => setShipTo(e.target.value)} className="input-enterprise text-xs" />
                </div>
                <div className="flex items-end">
                  <label className="flex items-center gap-2 text-xs font-semibold text-slate-700 cursor-pointer pb-2">
                    <input type="checkbox" checked={reverseCharge}
                      onChange={(e) => setReverseCharge(e.target.checked)}
                      className="rounded border-slate-300" />
                    Reverse charge applicable
                  </label>
                </div>
              </div>

              <div className="border rounded-xl p-4 space-y-2">
                <div className="flex justify-between items-center">
                  <h3 className="text-xs font-bold uppercase text-slate-500">Items</h3>
                  <button type="button" onClick={() => setGridItems((p) => [...p, blankItem()])}
                    className="text-xs font-bold text-green-700 flex items-center gap-1"><Plus className="w-3.5 h-3.5" /> Add Row</button>
                </div>
                <div className="overflow-x-auto">
                  <table className="w-full text-[11px]">
                    <thead>
                      <tr className="bg-slate-50 text-left font-semibold">
                        <th className="p-2 w-[200px]">Item</th>
                        <th className="p-2 w-[72px] text-center">HSN</th>
                        <th className="p-2 w-12 text-center">Qty</th>
                        <th className="p-2 w-16 text-center">Unit</th>
                        <th className="p-2 w-20 text-right">Price (₹)</th>
                        <th className="p-2 w-20 text-right">Amount (₹)</th>
                        <th className="p-2 w-14 text-center">Dis%</th>
                        <th className="p-2 w-14 text-center">SGST%</th>
                        <th className="p-2 w-20 text-right">SGST (₹)</th>
                        <th className="p-2 w-14 text-center">CGST%</th>
                        <th className="p-2 w-20 text-right">CGST (₹)</th>
                        <th className="p-2 w-24 text-right">Line Total</th>
                        <th className="p-2 w-8" />
                      </tr>
                    </thead>
                    <tbody>
                      {gridItems.map((item, idx) => {
                        const lineGst = getSaleItemSummary(item);
                        return (
                        <tr key={idx} className="border-t border-slate-100">
                          <td className="p-1">
                            <SearchableProductSelect items={inventory} value={item.code}
                              onChange={(p) => handleProductSelect(idx, p)} />
                          </td>
                          <td className="p-1">
                            <input type="text" value={item.hsn_code || ""} readOnly tabIndex={-1}
                              className="w-full text-center border border-slate-200 rounded py-1 text-[10px] font-mono bg-slate-50 text-slate-600" />
                          </td>
                          <td className="p-1">
                            <input type="number" min={1} value={item.qty} onChange={(e) => updateGridRow(idx, "qty", parseFloat(e.target.value) || 0)}
                              className="w-full text-center border rounded py-1 text-[11px]" />
                          </td>
                          <td className="p-1">
                            <select value={item.unit} onChange={(e) => updateGridRow(idx, "unit", e.target.value)} className="w-full border rounded py-1 text-[11px] bg-white">
                              {unitOptionsForRow(item.unit).map((u) => <option key={u} value={u}>{u}</option>)}
                            </select>
                          </td>
                          <td className="p-1">
                            <input type="number" min={0} step="any" value={formatGridNumberValue(item.mrp)}
                              onChange={(e) => updateGridRow(idx, "mrp", parseFloat(e.target.value) || 0)}
                              className="w-full text-right border border-green-400 rounded py-1 text-[11px] font-semibold" />
                          </td>
                          <td className="p-1">
                            <input readOnly tabIndex={-1} value={(item.amount ?? 0).toFixed(2)}
                              className="w-full text-right border border-slate-200 rounded py-1 text-[11px] font-mono bg-slate-50 text-slate-600" />
                          </td>
                          <td className="p-1">
                            <input type="number" min={0} value={item.disc_pct || ""} onChange={(e) => updateGridRow(idx, "disc_pct", parseFloat(e.target.value) || 0)}
                              className="w-full text-center border rounded py-1 text-[11px]" />
                          </td>
                          <td className="p-1">
                            <input type="number" min={0} step="0.5" value={item.sgst}
                              onChange={(e) => updateGridRow(idx, "sgst", parseFloat(e.target.value) || 0)}
                              className="w-full text-center border rounded py-1 text-[11px]" />
                          </td>
                          <td className="p-1 text-right font-mono text-[10px] text-slate-600 pr-1">
                            {formatCurrency(lineGst.sgstAmount)}
                          </td>
                          <td className="p-1">
                            <input type="number" min={0} step="0.5" value={item.cgst}
                              onChange={(e) => updateGridRow(idx, "cgst", parseFloat(e.target.value) || 0)}
                              className="w-full text-center border rounded py-1 text-[11px]" />
                          </td>
                          <td className="p-1 text-right font-mono text-[10px] text-slate-600 pr-1">
                            {formatCurrency(lineGst.cgstAmount)}
                          </td>
                          <td className="p-1 text-right font-semibold font-mono text-green-800 pr-2">
                            {formatCurrency(item.line_total || 0)}
                          </td>
                          <td className="p-1">
                            {gridItems.length > 1 && (
                              <button type="button" onClick={() => setGridItems((p) => p.filter((_, i) => i !== idx))} className="text-red-500 p-1">
                                <Trash2 className="w-3.5 h-3.5" />
                              </button>
                            )}
                          </td>
                        </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              </div>

              <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="form-label text-xs">Discount (₹)</label>
                    <input value={discount} onChange={(e) => setDiscount(e.target.value)} className="input-enterprise text-xs" />
                  </div>
                  <div>
                    <label className="form-label text-xs">F. Cess</label>
                    <input value={fCess} onChange={(e) => setFCess(e.target.value)} className="input-enterprise text-xs" />
                  </div>
                  <div>
                    <label className="form-label text-xs">Commission</label>
                    <input value={commission} onChange={(e) => setCommission(e.target.value)} className="input-enterprise text-xs" />
                  </div>
                  <div>
                    <label className="form-label text-xs">Postage</label>
                    <input value={postage} onChange={(e) => setPostage(e.target.value)} className="input-enterprise text-xs" />
                  </div>
                </div>
                <div className="bg-slate-50 rounded-xl p-4 space-y-1 text-xs">
                  <div className="text-[10px] font-bold uppercase tracking-wider text-slate-400 pb-1 border-b border-slate-200 mb-1">Bill Summary</div>
                  <div className="flex justify-between font-semibold text-slate-800 border-b border-slate-200 pb-1.5">
                    <span>Amount Before Tax</span>
                    <span>{formatCurrency(calc.subtotal)}</span>
                  </div>
                  {calc.interState ? (
                    <div className="flex justify-between"><span>IGST ({calc.igstRate.toFixed(1)}%)</span><span>{formatCurrency(calc.totalIgst)}</span></div>
                  ) : (
                    <>
                      <div className="flex justify-between"><span>CGST ({calc.cgstRate.toFixed(1)}%)</span><span>{formatCurrency(calc.totalCgst)}</span></div>
                      <div className="flex justify-between"><span>SGST ({calc.sgstRate.toFixed(1)}%)</span><span>{formatCurrency(calc.totalSgst)}</span></div>
                    </>
                  )}
                  <div className="flex justify-between font-medium"><span>Total GST</span><span>{formatCurrency(calc.totalGst)}</span></div>
                  <div className="flex justify-between"><span>Round Off</span><span>{formatCurrency(calc.roundOff)}</span></div>
                  <div className="flex justify-between font-bold text-base border-t border-slate-200 pt-2 mt-2">
                    <span>Grand Total</span><span>{formatCurrency(calc.grandTotal)}</span>
                  </div>
                  <div className="grid grid-cols-2 gap-2 pt-3">
                    <div>
                      <label className="form-label text-[10px]">Payment Amount</label>
                      <input value={paymentAmount} onChange={(e) => setPaymentAmount(e.target.value)} className="input-enterprise text-xs" />
                    </div>
                    <div>
                      <label className="form-label text-[10px]">Payment Mode</label>
                      <select value={paymentMode} onChange={(e) => setPaymentMode(e.target.value)} className="input-enterprise text-xs bg-white">
                        {PAYMENT_MODES.map((m) => <option key={m} value={m}>{m}</option>)}
                      </select>
                    </div>
                  </div>
                </div>
              </div>

              <div className="flex justify-end gap-2">
                <button type="button" onClick={resetBillForm} className="btn-secondary text-xs">Cancel</button>
                <button type="submit" className="btn-primary text-xs font-bold">
                  {editingBill ? "Update B2B Bill" : "Save B2B Bill"}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* View bill detail */}
      {viewingBill && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/50 backdrop-blur-sm">
          <div className="bg-white rounded-xl shadow-2xl w-[min(100rem,98vw)] max-w-none max-h-[92vh] overflow-y-auto">
            <div className="px-6 py-4 border-b flex justify-between items-center sticky top-0 bg-white z-10">
              <h2 className="font-bold text-sm">B2B Bill {viewingBill.bill_no}</h2>
              <button type="button" onClick={() => setViewingBill(null)}><X className="w-5 h-5" /></button>
            </div>
            <div className="p-6 space-y-4 text-xs">
              <div className="bg-violet-50 rounded-lg p-3 space-y-1">
                <p className="font-bold text-violet-900">{viewingBill.buyer_legal_name}</p>
                {viewingBill.buyer_trade_name && (
                  <p className="text-violet-800">{viewingBill.buyer_trade_name}</p>
                )}
                <p className="font-mono text-violet-700">GSTIN: {viewingBill.buyer_gstin}</p>
                <p>{viewingBill.buyer_billing_address}</p>
                {(viewingBill.ship_to || viewingBill.buyer_ship_to) && (
                  <p className="text-slate-600">Ship: {viewingBill.ship_to || viewingBill.buyer_ship_to}</p>
                )}
              </div>
              <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
                <div><span className="text-slate-500">Date:</span> {formatTableDate(viewingBill.bill_date)}</div>
                <div><span className="text-slate-500">Type:</span> {viewingBill.form_type}</div>
                <div><span className="text-slate-500">Branch:</span> {viewingBill.branch_godown}</div>
                <div><span className="text-slate-500">Subtotal:</span> {formatCurrency(viewingBill.subtotal)}</div>
                {viewingBillGst && (
                  viewingBillGst.interState ? (
                    <div><span className="text-slate-500">IGST ({viewingBillGst.igstRate.toFixed(1)}%):</span> {formatCurrency(viewingBillGst.totalIgst)}</div>
                  ) : (
                    <>
                      <div><span className="text-slate-500">CGST ({viewingBillGst.cgstRate.toFixed(1)}%):</span> {formatCurrency(viewingBillGst.totalCgst)}</div>
                      <div><span className="text-slate-500">SGST ({viewingBillGst.sgstRate.toFixed(1)}%):</span> {formatCurrency(viewingBillGst.totalSgst)}</div>
                    </>
                  )
                )}
                {viewingBillGst && (
                  <div><span className="text-slate-500">Total GST:</span> {formatCurrency(viewingBillGst.totalGst || viewingBill.total_gst)}</div>
                )}
                <div><span className="text-slate-500">Reverse Charge:</span> {reverseChargeLabel(viewingBill.reverse_charge)}</div>
                <div><span className="text-slate-500">Grand Total:</span> <strong>{formatCurrency(viewingBill.grand_total)}</strong></div>
                <div><span className="text-slate-500">Paid:</span> {formatCurrency(viewingBill.payment_amount)}</div>
                <div><span className="text-slate-500">Balance:</span> {formatCurrency(viewingBill.balance)}</div>
                <div><span className="text-slate-500">Status:</span> {viewingBill.payment_status}</div>
              </div>
              <table className="w-full border text-[11px]">
                <thead>
                  <tr className="bg-slate-50">
                    <th className="p-2 text-left">Item</th>
                    <th className="p-2 text-center">HSN</th>
                    <th className="p-2 text-center">Qty</th>
                    <th className="p-2 text-right">Price</th>
                    <th className="p-2 text-right">Taxable</th>
                    <th className="p-2 text-right">SGST</th>
                    <th className="p-2 text-right">CGST</th>
                    <th className="p-2 text-right">Total</th>
                  </tr>
                </thead>
                <tbody>
                  {viewingBill.items.map((it, i) => {
                    const line = getSaleItemSummary(it);
                    return (
                    <tr key={i} className="border-t">
                      <td className="p-2">
                        <div className="font-medium">{it.name}</div>
                        {it.code && <div className="text-[10px] text-slate-500 font-mono">{it.code}</div>}
                      </td>
                      <td className="p-2 text-center font-mono">{it.hsn_code || "—"}</td>
                      <td className="p-2 text-center">{it.qty} {it.unit}</td>
                      <td className="p-2 text-right font-mono">{formatCurrency(it.mrp)}</td>
                      <td className="p-2 text-right font-mono">{formatCurrency(line.taxableValue)}</td>
                      <td className="p-2 text-right font-mono">
                        <div>{line.sgstRate}%</div>
                        <div className="text-slate-600">{formatCurrency(line.sgstAmount)}</div>
                      </td>
                      <td className="p-2 text-right font-mono">
                        <div>{line.cgstRate}%</div>
                        <div className="text-slate-600">{formatCurrency(line.cgstAmount)}</div>
                      </td>
                      <td className="p-2 text-right font-mono font-semibold">{formatCurrency(it.line_total)}</td>
                    </tr>
                    );
                  })}
                </tbody>
              </table>
              <div className="flex flex-wrap justify-end gap-2 pt-2 border-t border-slate-100">
                <button type="button" onClick={() => handleStartEdit(viewingBill)}
                  className="btn-secondary text-xs flex items-center gap-1.5">
                  <Edit className="w-3.5 h-3.5" /> Edit
                </button>
                <button type="button" onClick={() => handlePrintBill(viewingBill)}
                  className="btn-secondary text-xs flex items-center gap-1.5">
                  <Printer className="w-3.5 h-3.5" /> Print
                </button>
                <button type="button" onClick={() => handleDownloadBill(viewingBill)}
                  className="btn-secondary text-xs flex items-center gap-1.5">
                  <Download className="w-3.5 h-3.5" /> Download PDF
                </button>
                <button type="button" onClick={() => openWhatsAppShare(viewingBill)}
                  className="btn-secondary text-xs flex items-center gap-1.5 border border-green-200 text-green-700 hover:bg-green-50">
                  <WhatsAppIcon /> WhatsApp
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Print Business Details Modal */}
      {isBuyerPrintModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/40 backdrop-blur-[2px]">
          <div className="absolute inset-0" onClick={() => setIsBuyerPrintModalOpen(false)} />
          <div className="bg-white border border-slate-200 rounded-xl shadow-2xl relative max-w-lg w-full z-10 flex flex-col font-sans max-h-[92vh]">
            <div className="bg-violet-800 px-5 py-4 text-white rounded-t-xl flex items-center justify-between shrink-0">
              <div>
                <h2 className="text-sm font-bold tracking-tight flex items-center gap-2">
                  <Printer className="w-4 h-4" />
                  Print Business Details
                </h2>
                <p className="text-[10px] text-violet-200 mt-0.5">Individual, group, or filtered directory</p>
              </div>
              <button type="button" onClick={() => setIsBuyerPrintModalOpen(false)}
                className="text-violet-200 hover:text-white p-1.5 rounded-lg hover:bg-white/10">
                <X className="w-4 h-4" />
              </button>
            </div>

            <div className="p-5 space-y-4 overflow-y-auto flex-1">
              {buyerPrintError && (
                <div className="bg-red-50 border border-red-200 text-red-800 text-xs px-3 py-2 rounded-md flex items-center gap-2">
                  <AlertTriangle className="w-4 h-4 shrink-0" />
                  <span>{buyerPrintError}</span>
                </div>
              )}

              <div>
                <label className="form-label text-xs font-semibold text-slate-700 mb-2 block">Print Scope</label>
                <div className="space-y-2">
                  {([
                    ["individual", "Individual Business", "One registered business with full GST details"],
                    ["group", "Group", "All, all active, or hand-picked businesses"],
                    ["conditions", "By Conditions", "Filter by type, state, status, bills, and search"],
                  ] as const).map(([mode, title, desc]) => (
                    <label key={mode}
                      className={`flex items-start gap-3 p-3 rounded-lg border cursor-pointer transition-colors ${
                        buyerPrintMode === mode ? "border-violet-600 bg-violet-50" : "border-slate-200 hover:bg-slate-50"
                      }`}>
                      <input type="radio" name="buyerPrintMode" value={mode} checked={buyerPrintMode === mode}
                        onChange={() => { setBuyerPrintMode(mode); setBuyerPrintError(null); }}
                        className="mt-0.5" />
                      <span>
                        <span className="text-xs font-bold text-slate-800 block">{title}</span>
                        <span className="text-[10px] text-slate-500">{desc}</span>
                      </span>
                    </label>
                  ))}
                </div>
              </div>

              {buyerPrintMode === "individual" && (
                <div>
                  <label className="form-label text-xs">Select Business</label>
                  <select value={buyerPrintIndividualId}
                    onChange={(e) => { setBuyerPrintIndividualId(e.target.value); setBuyerPrintError(null); }}
                    className="input-enterprise bg-white cursor-pointer text-xs w-full">
                    <option value="">Choose business...</option>
                    {buyers.map((b) => (
                      <option key={b.id} value={b.id}>
                        {buyerDisplayName(b)} — {b.gstin}
                      </option>
                    ))}
                  </select>
                </div>
              )}

              {buyerPrintMode === "group" && (
                <div className="space-y-3">
                  <div>
                    <label className="form-label text-xs font-semibold text-slate-700 mb-2 block">Group Type</label>
                    <div className="space-y-2">
                      {([
                        ["all", "All Registered", "Every business in the registry"],
                        ["active", "All Active", "Only active businesses"],
                        ["selected", "Selected Businesses", "Pick specific businesses below"],
                      ] as const).map(([scope, title, desc]) => (
                        <label key={scope}
                          className={`flex items-start gap-3 p-2.5 rounded-lg border cursor-pointer ${
                            buyerPrintGroupScope === scope ? "border-violet-600 bg-violet-50" : "border-slate-200"
                          }`}>
                          <input type="radio" name="buyerPrintGroup" value={scope}
                            checked={buyerPrintGroupScope === scope}
                            onChange={() => { setBuyerPrintGroupScope(scope); setBuyerPrintError(null); }}
                            className="mt-0.5" />
                          <span>
                            <span className="text-xs font-bold text-slate-800 block">{title}</span>
                            <span className="text-[10px] text-slate-500">{desc}</span>
                          </span>
                        </label>
                      ))}
                    </div>
                  </div>
                  {buyerPrintGroupScope === "selected" && (
                    <div className="border border-slate-200 rounded-lg max-h-44 overflow-y-auto p-2 space-y-1">
                      {buyers.map((b) => (
                        <label key={b.id} className="flex items-center gap-2 p-1.5 rounded hover:bg-slate-50 cursor-pointer text-xs">
                          <input type="checkbox" checked={buyerPrintSelectedIds.includes(b.id)}
                            onChange={() => toggleBuyerPrintSelection(b.id)} />
                          <span className="truncate">{buyerDisplayName(b)}</span>
                          <span className="text-[10px] font-mono text-slate-500 shrink-0">{b.gstin}</span>
                        </label>
                      ))}
                    </div>
                  )}
                </div>
              )}

              {buyerPrintMode === "conditions" && (
                <div className="space-y-3">
                  <div className="grid grid-cols-2 gap-3">
                    <div>
                      <label className="form-label text-xs">Business Type</label>
                      <select value={buyerPrintBusinessType} onChange={(e) => setBuyerPrintBusinessType(e.target.value)}
                        className="input-enterprise bg-white text-xs w-full">
                        <option value="All">All Types</option>
                        {BUSINESS_TYPES.map((t) => <option key={t} value={t}>{t}</option>)}
                      </select>
                    </div>
                    <div>
                      <label className="form-label text-xs">State</label>
                      <select value={buyerPrintStateFilter} onChange={(e) => setBuyerPrintStateFilter(e.target.value)}
                        className="input-enterprise bg-white text-xs w-full">
                        <option value="All">All States</option>
                        {INDIAN_STATES.map((s) => <option key={s.code} value={s.name}>{s.name}</option>)}
                      </select>
                    </div>
                  </div>
                  <div className="grid grid-cols-2 gap-3">
                    <div>
                      <label className="form-label text-xs">Active Status</label>
                      <select value={buyerPrintActiveFilter}
                        onChange={(e) => setBuyerPrintActiveFilter(e.target.value as "all" | "active" | "inactive")}
                        className="input-enterprise bg-white text-xs w-full">
                        <option value="all">All</option>
                        <option value="active">Active only</option>
                        <option value="inactive">Inactive only</option>
                      </select>
                    </div>
                    <div>
                      <label className="form-label text-xs">B2B Bills</label>
                      <select value={buyerPrintBillFilter}
                        onChange={(e) => setBuyerPrintBillFilter(e.target.value as "all" | "with_bills" | "without_bills")}
                        className="input-enterprise bg-white text-xs w-full">
                        <option value="all">All businesses</option>
                        <option value="with_bills">With B2B bills</option>
                        <option value="without_bills">Without B2B bills</option>
                      </select>
                    </div>
                  </div>
                  <label className="flex items-center gap-2 text-xs cursor-pointer">
                    <input type="checkbox" checked={buyerPrintUseSearch}
                      onChange={(e) => setBuyerPrintUseSearch(e.target.checked)} />
                    <span>Apply current search from Registered Businesses tab{buyerSearch.trim() ? `: "${buyerSearch.trim()}"` : ""}</span>
                  </label>
                </div>
              )}

              <p className="text-[10px] text-slate-500 leading-relaxed">
                Single business prints a profile sheet. Multiple businesses print a summary table plus full GST-registered details for each entry.
              </p>
            </div>

            <div className="flex items-center justify-end gap-2 px-5 py-4 border-t border-slate-200 bg-slate-50 rounded-b-xl shrink-0">
              <button type="button" onClick={() => setIsBuyerPrintModalOpen(false)} className="btn-secondary px-4 text-xs">
                Cancel
              </button>
              <button type="button" onClick={handlePrintBuyersDirectory}
                className="btn-secondary px-4 text-xs flex items-center gap-1.5">
                <Printer className="w-3.5 h-3.5" /> Print
              </button>
              <button type="button" onClick={handleDownloadBuyersDirectory}
                className="btn-primary px-4 text-xs flex items-center gap-1.5">
                <Download className="w-3.5 h-3.5" /> Download PDF
              </button>
            </div>
          </div>
        </div>
      )}

      {/* B2B Statement Modal */}
      {isStatementModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/40 backdrop-blur-[2px]">
          <div className="absolute inset-0" onClick={() => setIsStatementModalOpen(false)} />
          <div className="bg-white border border-slate-200 rounded-xl shadow-2xl relative max-w-lg w-full z-10 flex flex-col font-sans">
            <div className="bg-violet-800 px-5 py-4 text-white rounded-t-xl flex items-center justify-between">
              <div>
                <h2 className="text-sm font-bold tracking-tight flex items-center gap-2">
                  <FileText className="w-4 h-4" />
                  B2B Bill Statement
                </h2>
                <p className="text-[10px] text-violet-200 mt-0.5">Account-style register for a registered business</p>
              </div>
              <button type="button" onClick={() => setIsStatementModalOpen(false)}
                className="text-violet-200 hover:text-white p-1.5 rounded-lg hover:bg-white/10">
                <X className="w-4 h-4" />
              </button>
            </div>

            <div className="p-5 space-y-4 max-h-[70vh] overflow-y-auto">
              {statementError && (
                <div className="bg-red-50 border border-red-200 text-red-800 text-xs px-3 py-2 rounded-md flex items-center gap-2">
                  <AlertTriangle className="w-4 h-4 shrink-0" />
                  <span>{statementError}</span>
                </div>
              )}

              <div>
                <label className="form-label text-xs font-semibold text-slate-700 mb-2 block">Registered Business *</label>
                <select value={statementBuyerId} onChange={(e) => { setStatementBuyerId(e.target.value); setStatementError(null); }}
                  className="input-enterprise bg-white cursor-pointer text-xs w-full">
                  <option value="">Select business...</option>
                  {activeBuyers.map((b) => (
                    <option key={b.id} value={b.id}>
                      {buyerDisplayName(b)} — {b.gstin}
                    </option>
                  ))}
                </select>
                {statementBuyerId && resolveRegistryBuyer(statementBuyerId, buyers) && (
                  <div className="mt-2 text-[10px] text-slate-600 bg-violet-50 border border-violet-100 rounded-lg p-2.5 space-y-0.5">
                    {(() => {
                      const b = resolveRegistryBuyer(statementBuyerId, buyers)!;
                      return (
                        <>
                          <p className="font-semibold text-violet-900">{b.legal_name}</p>
                          {b.trade_name && <p>{b.trade_name}</p>}
                          <p className="font-mono">{b.gstin}{b.pan ? ` · PAN: ${b.pan}` : ""}</p>
                          <p>{b.billing_address}</p>
                          <p>{b.city ? `${b.city}, ` : ""}{b.state} {b.pincode ?? ""}</p>
                          {(b.contact_person || b.phone) && (
                            <p>{[b.contact_person, b.phone].filter(Boolean).join(" · ")}</p>
                          )}
                        </>
                      );
                    })()}
                  </div>
                )}
              </div>

              <div>
                <label className="form-label text-xs font-semibold text-slate-700 mb-2 block">Statement Type</label>
                <div className="space-y-2">
                  {([
                    ["full", "All Bills (Buyer)", "Every B2B bill for the selected business"],
                    ["date", "By Bill Date", "Bills on a specific date"],
                    ["month", "By Month", "Bills in a calendar month"],
                    ["range", "Date Range", "Bills between two dates"],
                    ["current", "Current Table Search", "Uses the bills tab search filter for this buyer"],
                  ] as const).map(([mode, title, desc]) => (
                    <label key={mode}
                      className={`flex items-start gap-3 p-3 rounded-lg border cursor-pointer transition-colors ${
                        statementMode === mode ? "border-violet-600 bg-violet-50" : "border-slate-200 hover:bg-slate-50"
                      }`}>
                      <input type="radio" name="b2bStatementMode" value={mode} checked={statementMode === mode}
                        onChange={() => { setStatementMode(mode); setStatementError(null); }}
                        className="mt-0.5" />
                      <span>
                        <span className="text-xs font-bold text-slate-800 block">{title}</span>
                        <span className="text-[10px] text-slate-500">{desc}</span>
                      </span>
                    </label>
                  ))}
                </div>
              </div>

              {statementMode === "date" && (
                <div>
                  <label className="form-label text-xs">Bill Date</label>
                  <input type="date" value={statementDate} onChange={(e) => setStatementDate(e.target.value)}
                    className="input-enterprise font-mono text-xs w-full" />
                </div>
              )}

              {statementMode === "month" && (
                <div>
                  <label className="form-label text-xs">Month</label>
                  <input type="month" value={statementMonth} onChange={(e) => setStatementMonth(e.target.value)}
                    className="input-enterprise font-mono text-xs w-full" />
                </div>
              )}

              {statementMode === "range" && (
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="form-label text-xs">From Date</label>
                    <input type="date" value={statementFrom} onChange={(e) => setStatementFrom(e.target.value)}
                      className="input-enterprise font-mono text-xs w-full" />
                  </div>
                  <div>
                    <label className="form-label text-xs">To Date</label>
                    <input type="date" value={statementTo} min={statementFrom} onChange={(e) => setStatementTo(e.target.value)}
                      className="input-enterprise font-mono text-xs w-full" />
                  </div>
                </div>
              )}

              {statementMode !== "current" && (
                <div>
                  <label className="form-label text-xs">Payment Status Filter</label>
                  <select value={statementStatusFilter} onChange={(e) => setStatementStatusFilter(e.target.value)}
                    className="input-enterprise bg-white cursor-pointer text-xs w-full">
                    <option value="All">All Bills</option>
                    <option value="Paid">Paid</option>
                    <option value="Partial">Partial</option>
                    <option value="Credit">Credit</option>
                  </select>
                </div>
              )}

              <p className="text-[10px] text-slate-500 leading-relaxed">
                Statement prints full registered business details (GSTIN, PAN, addresses, contact) for the selected buyer,
                then lists all matching bills with taxable value, SGST, CGST, totals, paid amount, balance, and status.
              </p>
            </div>

            <div className="flex items-center justify-end gap-2 px-5 py-4 border-t border-slate-200 bg-slate-50 rounded-b-xl">
              <button type="button" onClick={() => setIsStatementModalOpen(false)} className="btn-secondary px-4 text-xs">
                Cancel
              </button>
              <button type="button" onClick={handlePrintB2BStatement}
                className="btn-secondary px-4 text-xs flex items-center gap-1.5">
                <Printer className="w-3.5 h-3.5" /> Print
              </button>
              <button type="button" onClick={handleDownloadB2BStatement}
                className="btn-primary px-4 text-xs flex items-center gap-1.5">
                <Download className="w-3.5 h-3.5" /> Download PDF
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Sample / placeholder GSTIN — cannot generate tax invoice */}
      {sampleGstinBuyer && (
        <div className="fixed inset-0 z-[70] flex items-center justify-center p-4 bg-slate-900/50 backdrop-blur-sm">
          <div
            className="bg-white rounded-xl shadow-2xl max-w-md w-full border border-border overflow-hidden"
            role="dialog"
            aria-modal="true"
            aria-labelledby="sample-gstin-title"
          >
            <div className="px-6 py-4 border-b border-border flex items-start gap-3">
              <div className="w-10 h-10 rounded-full bg-amber-100 flex items-center justify-center shrink-0">
                <AlertTriangle className="w-5 h-5 text-amber-600" />
              </div>
              <div className="min-w-0">
                <h2 id="sample-gstin-title" className="text-sm font-bold text-slate-900">
                  GSTIN is not valid for billing
                </h2>
                <p className="text-xs text-slate-600 mt-1 leading-relaxed">
                  <span className="font-semibold text-slate-900">&quot;{buyerDisplayName(sampleGstinBuyer)}&quot;</span>{" "}
                  is registered with a sample placeholder GSTIN. Update the correct 15-character GST number before
                  generating a B2B tax invoice.
                </p>
                <p className="text-[10px] font-mono text-amber-800 bg-amber-50 border border-amber-200 rounded px-2 py-1 mt-2">
                  {sampleGstinBuyer.gstin}
                </p>
              </div>
            </div>
            <div className="px-6 py-4 flex justify-end gap-2 bg-slate-50">
              <button
                type="button"
                onClick={() => setSampleGstinBuyer(null)}
                className="btn-secondary text-xs"
              >
                Close
              </button>
              <button
                type="button"
                onClick={openEditBuyerFromSampleGstinWarning}
                className="text-xs font-bold px-4 py-2 rounded-md bg-primary text-white hover:bg-primary/90 transition-colors"
              >
                Update GSTIN
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Remove buyer confirmation */}
      {buyerToDelete && (
        <div className="fixed inset-0 z-[60] flex items-center justify-center p-4 bg-slate-900/50 backdrop-blur-sm">
          <div
            className="bg-white rounded-xl shadow-2xl max-w-md w-full border border-border overflow-hidden"
            role="dialog"
            aria-modal="true"
            aria-labelledby="remove-buyer-title"
          >
            <div className="px-6 py-4 border-b border-border flex items-start gap-3">
              <div className="w-10 h-10 rounded-full bg-red-100 flex items-center justify-center shrink-0">
                <AlertTriangle className="w-5 h-5 text-red-600" />
              </div>
              <div className="min-w-0">
                <h2 id="remove-buyer-title" className="text-sm font-bold text-slate-900">
                  Remove from registry?
                </h2>
                <p className="text-xs text-slate-600 mt-1 leading-relaxed">
                  Remove{" "}
                  <span className="font-semibold text-slate-900">&quot;{buyerDisplayName(buyerToDelete)}&quot;</span>{" "}
                  from the GST business registry? Existing B2B bills for this buyer will not be deleted.
                </p>
                <p className="text-[10px] font-mono text-slate-500 mt-1">{buyerToDelete.gstin}</p>
              </div>
            </div>
            <div className="px-6 py-4 flex justify-end gap-2 bg-slate-50">
              <button
                type="button"
                onClick={() => setBuyerToDelete(null)}
                className="btn-secondary text-xs"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={() => void handleDeleteBuyer()}
                className="text-xs font-bold px-4 py-2 rounded-md bg-red-600 text-white hover:bg-red-700 transition-colors"
              >
                Remove
              </button>
            </div>
          </div>
        </div>
      )}

      <WhatsAppShareModal config={whatsappShare} onClose={() => setWhatsappShare(null)} />
    </div>
  );
}
