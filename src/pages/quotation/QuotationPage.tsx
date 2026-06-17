import { useState, useEffect, useCallback, useMemo, useRef } from "react";
import {
  FileSpreadsheet,
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
} from "lucide-react";
import html2canvas from "html2canvas";
import { jsPDF } from "jspdf";
import { supabase } from "@/lib/supabase";
import { formatCurrency } from "@/lib/utils";

// ─── Types ────────────────────────────────────────────────────────────────────

export interface QuotationItem {
  code: string;
  name: string;
  hsn_code: string;
  qty: number;
  unit: string;
  rate: number;
  amount: number;
  disc_pct: number;
  cost: number;
  sgst: number;
  cgst: number;
  line_total: number;
}

type QuotationStatus = "Pending" | "Sent" | "Approved";

export interface QuotationRecord {
  quotation_no: string;
  serial_no: string;
  quotation_date: string;
  valid_till: string;
  ref_no?: string;
  rate_type: string;
  customer_name: string;
  customer_address?: string;
  customer_gstin?: string;
  customer_phone?: string;
  items: QuotationItem[];
  remarks?: string;
  total_cost: number;
  subtotal: number;
  total_gst: number;
  f_cess: number;
  round_off: number;
  net_amount: number;
  status: QuotationStatus;
  created_at?: string;
  amount?: number;
  items_summary?: string;
}

// ─── Constants ────────────────────────────────────────────────────────────────

const LOCAL_STORAGE_KEY = "kaniyamparambil_quotations_v2";
const LEGACY_STORAGE_KEY = "kaniyamparambil_quotations";

const SEED_CUSTOMERS = [
  "CASH SALES",
  "Joy Alukkas Contractor",
  "Anish K. Nair",
  "Rajan Electricals",
  "Suresh Hardware",
  "Krishna Plumbers",
];

const RATE_TYPE_OPTIONS = [
  "Bill",
  "Retail",
  "Wholesale",
  "GST @ 5%",
  "GST @ 12%",
  "GST @ 18%",
  "GST @ 28%",
  "Exempt",
];

const QUOTATION_STATUSES: QuotationStatus[] = ["Pending", "Sent", "Approved"];

const UNITS = [
  "Nos", "Mtr", "Kg", "Ltr", "Box", "Pcs", "Set",
  "Pair", "Roll", "Bag", "Bundle", "Dozen", "Sqft", "Sqm", "Ton",
];

const QUOTATION_STATIC_DETAILS = {
  storeNameLines: ["NEW", "KANIYAMPARAMBIL", "STORES"],
  phone: "9544363171",
  email: "newkaniyamparambilstorestkdy@gmail.com",
  gstin: "32AWJPJ1371N1ZE",
  pan: "AWJPJ1371N",
  location: "THOPRAMKUDY PO, THOPRAMKUDY, KERALA",
  customerState: "Kerala",
  customerCode: "32",
  bankName: "bank details",
  accountNo: "13330100068606",
  ifsc: "FDRL0001333",
  branch: "Thopramkudy Branch",
  terms: "This is a quotation only and not a tax invoice. Prices are subject to change without notice.",
  signatureScript: "jins joseph",
  signatureRole: "Authorized Signatory",
  signatureCompany: "FOR NEW KANIYAMPARAMBIL STORES",
} as const;

type QuotationDocOptions = {
  autoPrint?: boolean;
  helperText?: string;
  renderMode?: "print" | "pdf";
};

const QUOTATION_FRAME_STYLE: Partial<CSSStyleDeclaration> = {
  position: "fixed",
  top: "0",
  left: "-20000px",
  width: "794px",
  height: "1200px",
  opacity: "0",
  pointerEvents: "none",
  border: "0",
  background: "transparent",
};

// ─── Helpers ──────────────────────────────────────────────────────────────────

function todayIso(): string {
  return new Date().toISOString().split("T")[0];
}

function addDaysIso(iso: string, days: number): string {
  const d = new Date(`${iso}T00:00:00`);
  d.setDate(d.getDate() + days);
  return d.toISOString().split("T")[0];
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
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return escapeHtml(value || "—");
  return new Intl.DateTimeFormat("en-GB", {
    day: "2-digit",
    month: "short",
    year: "numeric",
  }).format(date).replace(/ /g, "-");
}

function toWordsBelowThousand(num: number): string {
  const ones = ["", "One", "Two", "Three", "Four", "Five", "Six", "Seven", "Eight", "Nine"];
  const teens = ["Ten", "Eleven", "Twelve", "Thirteen", "Fourteen", "Fifteen", "Sixteen", "Seventeen", "Eighteen", "Nineteen"];
  const tens = ["", "", "Twenty", "Thirty", "Forty", "Fifty", "Sixty", "Seventy", "Eighty", "Ninety"];
  let n = Math.floor(num);
  const parts: string[] = [];
  if (n >= 100) { parts.push(`${ones[Math.floor(n / 100)]} Hundred`); n %= 100; }
  if (n >= 20) { parts.push(tens[Math.floor(n / 10)]); n %= 10; }
  else if (n >= 10) { parts.push(teens[n - 10]); n = 0; }
  if (n > 0) parts.push(ones[n]);
  return parts.filter(Boolean).join(" ");
}

function numberToWordsIndian(value: number): string {
  const amount = Math.max(0, Math.round(value));
  if (amount === 0) return "Rupees Zero Only";
  const units = [
    { value: 10000000, label: "Crore" },
    { value: 100000, label: "Lakh" },
    { value: 1000, label: "Thousand" },
  ];
  let remaining = amount;
  const words: string[] = [];
  units.forEach(({ value: unitValue, label }) => {
    if (remaining >= unitValue) {
      words.push(`${toWordsBelowThousand(Math.floor(remaining / unitValue))} ${label}`);
      remaining %= unitValue;
    }
  });
  if (remaining > 0) words.push(toWordsBelowThousand(remaining));
  return `Rupees ${words.join(" ").replace(/\s+/g, " ").trim()} Only`;
}

function isMissingTableError(error: { code?: string; message?: string }): boolean {
  const message = (error.message ?? "").toLowerCase();
  if (error.code === "PGRST205" || error.code === "42P01") return true;
  if (message.includes("could not find the table")) return true;
  if (message.includes("column") && message.includes("does not exist")) return false;
  return message.includes("relation") && message.includes("does not exist");
}

function getQuotationItemSummary(item: QuotationItem) {
  const quantity = Number(item.qty) || 0;
  const rate = Number(item.rate) || 0;
  const amount = quantity * rate;
  const discountPercent = Number(item.disc_pct) || 0;
  const discountAmount = amount * (discountPercent / 100);
  const taxableValue = Math.max(0, amount - discountAmount);
  const cgstRate = Number(item.cgst) || 0;
  const sgstRate = Number(item.sgst) || 0;
  const cgstAmount = taxableValue * (cgstRate / 100);
  const sgstAmount = taxableValue * (sgstRate / 100);
  const total = taxableValue + cgstAmount + sgstAmount;
  return {
    quantity, rate, amount, discountPercent, discountAmount,
    taxableValue, cgstRate, sgstRate, cgstAmount, sgstAmount, total,
  };
}

function blankItem(): QuotationItem {
  return {
    code: "", name: "", hsn_code: "", qty: 1, unit: "Nos",
    rate: 0, amount: 0, disc_pct: 0, cost: 0, sgst: 9, cgst: 9, line_total: 0,
  };
}

const GSTIN_PATTERN = /^[0-9]{2}[A-Z]{5}[0-9]{4}[A-Z]{1}[1-9A-Z]{1}Z[0-9A-Z]{1}$/;

function clampNumber(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

function sanitizeDigits(value: string, maxLength: number): string {
  return value.replace(/\D/g, "").slice(0, maxLength);
}

function sanitizeGstin(value: string): string {
  return value.replace(/[^0-9A-Za-z]/g, "").toUpperCase().slice(0, 15);
}

function sanitizeName(value: string): string {
  return value.replace(/[^0-9A-Za-z\s.&'/-]/g, "").slice(0, 120);
}

function sanitizeAddress(value: string): string {
  return value.replace(/[^\w\s.,\-#/()&'"]/g, "").slice(0, 250);
}

function sanitizeDocNo(value: string): string {
  return value.replace(/[^0-9A-Za-z\-_/]/g, "").toUpperCase().slice(0, 30);
}

function sanitizeHsn(value: string): string {
  return value.replace(/\D/g, "").slice(0, 8);
}

function sanitizeItemName(value: string): string {
  return value.replace(/[^\w\s.,\-()/&+%'"]/g, "").slice(0, 200);
}

function sanitizeRemarks(value: string): string {
  return value.slice(0, 500);
}

function sanitizeDecimalString(value: string, maxDecimals = 2): string {
  const cleaned = value.replace(/[^\d.]/g, "");
  const dotIndex = cleaned.indexOf(".");
  if (dotIndex === -1) return cleaned;
  const intPart = cleaned.slice(0, dotIndex);
  const decPart = cleaned.slice(dotIndex + 1).replace(/\./g, "").slice(0, maxDecimals);
  return decPart.length > 0 ? `${intPart}.${decPart}` : intPart + (cleaned.endsWith(".") ? "." : "");
}

function parseOptionalDecimal(raw: string, max: number, decimals = 2): number {
  const normalized = sanitizeDecimalString(raw, decimals).replace(/\.$/, "");
  if (!normalized) return 0;
  const n = parseFloat(normalized);
  if (Number.isNaN(n)) return 0;
  return clampNumber(n, 0, max);
}

function normalizeQuotation(raw: Record<string, unknown>): QuotationRecord {
  let items: QuotationItem[] = [];
  if (Array.isArray(raw.items) && raw.items.length > 0) {
    items = (raw.items as Record<string, unknown>[]).map((it) => ({
      code: String(it.code ?? ""),
      name: String(it.name ?? ""),
      hsn_code: String(it.hsn_code ?? ""),
      qty: Number(it.qty ?? 1),
      unit: String(it.unit ?? "Nos"),
      rate: Number(it.rate ?? it.mrp ?? 0),
      amount: Number(it.amount ?? 0),
      disc_pct: Number(it.disc_pct ?? 0),
      cost: Number(it.cost ?? it.purchase_rate ?? 0),
      sgst: Number(it.sgst ?? 0),
      cgst: Number(it.cgst ?? 0),
      line_total: Number(it.line_total ?? 0),
    }));
  }

  const legacyAmount = Number(raw.amount ?? 0);
  const netAmount = Number(raw.net_amount ?? 0) || legacyAmount;
  const quotationNo = String(raw.quotation_no ?? "");
  const createdAt = raw.created_at ? String(raw.created_at) : undefined;
  const quotationDate = String(raw.quotation_date ?? (createdAt ? createdAt.split("T")[0] : todayIso()));
  const validTill = String(raw.valid_till ?? addDaysIso(quotationDate, 30));
  const remarks = String(raw.remarks ?? raw.items_summary ?? "");

  const statusRaw = String(raw.status ?? "Pending");
  const status: QuotationStatus = QUOTATION_STATUSES.includes(statusRaw as QuotationStatus)
    ? (statusRaw as QuotationStatus)
    : "Pending";

  return {
    quotation_no: quotationNo,
    serial_no: String(raw.serial_no ?? quotationNo),
    quotation_date: quotationDate,
    valid_till: validTill,
    ref_no: raw.ref_no ? String(raw.ref_no) : undefined,
    rate_type: String(raw.rate_type ?? "Bill"),
    customer_name: String(raw.customer_name ?? ""),
    customer_address: raw.customer_address ? String(raw.customer_address) : undefined,
    customer_gstin: raw.customer_gstin ? String(raw.customer_gstin) : undefined,
    customer_phone: raw.customer_phone ? String(raw.customer_phone) : undefined,
    items,
    remarks: remarks || undefined,
    total_cost: Number(raw.total_cost ?? 0),
    subtotal: Number(raw.subtotal ?? netAmount),
    total_gst: Number(raw.total_gst ?? 0),
    f_cess: Number(raw.f_cess ?? 0),
    round_off: Number(raw.round_off ?? 0),
    net_amount: netAmount,
    status,
    created_at: createdAt,
    amount: legacyAmount || netAmount,
    items_summary: raw.items_summary ? String(raw.items_summary) : undefined,
  };
}

function buildQuotationHtml(rec: QuotationRecord, options: QuotationDocOptions = {}): string {
  const store = QUOTATION_STATIC_DETAILS;
  const isPdfMode = options.renderMode === "pdf";
  const companyName = store.storeNameLines.join(" ");
  const placeOfSupply = `${store.customerCode}-${store.customerState.toUpperCase()}`;
  const lineSummaries = rec.items.map(getQuotationItemSummary);
  const totalQuantity = lineSummaries.reduce((sum, item) => sum + item.quantity, 0);
  const totalAmount = lineSummaries.reduce((sum, item) => sum + item.amount, 0);
  const totalLineDiscount = lineSummaries.reduce((sum, item) => sum + item.discountAmount, 0);
  const totalTaxable = lineSummaries.reduce((sum, item) => sum + item.taxableValue, 0);
  const totalCgst = lineSummaries.reduce((sum, item) => sum + item.cgstAmount, 0);
  const totalSgst = lineSummaries.reduce((sum, item) => sum + item.sgstAmount, 0);
  const gstCessTotal = rec.total_gst + rec.f_cess;
  const amountInWords = numberToWordsIndian(rec.net_amount).replace(/^Rupees /, "INR ");

  const rowMarkup = rec.items.map((item, index) => {
    const s = lineSummaries[index];
    return `<tr>
      <td class="col-index">${index + 1}</td>
      <td class="col-item"><strong>${escapeHtml(item.name || "Unnamed Item")}</strong>${item.code ? `<span class="item-meta">Code: ${escapeHtml(item.code)}</span>` : ""}</td>
      <td class="col-hsn">${escapeHtml(item.hsn_code || "—")}</td>
      <td class="col-rate align-right">${formatCurrency(s.rate)}</td>
      <td class="col-qty align-center">${s.quantity.toFixed(2)} ${escapeHtml(item.unit || "Nos")}</td>
      <td class="col-disc align-center">${s.discountPercent.toFixed(1)}%</td>
      <td class="col-taxable align-right">${formatCurrency(s.taxableValue)}</td>
      <td class="col-gst align-right">${formatCurrency(s.cgstAmount)}<span class="gst-rate">${s.cgstRate.toFixed(1)}%</span></td>
      <td class="col-gst align-right">${formatCurrency(s.sgstAmount)}<span class="gst-rate">${s.sgstRate.toFixed(1)}%</span></td>
      <td class="col-line align-right">${formatCurrency(s.total)}</td>
    </tr>`;
  }).join("");

  return `<!DOCTYPE html>
  <html lang="en">
    <head>
      <meta charset="UTF-8" />
      <title>Quotation ${escapeHtml(rec.quotation_no)}</title>
      <style>
        * { box-sizing: border-box; }
        body { margin: 0; background: ${isPdfMode ? "#fff" : "#f3f4f6"}; font-family: Arial, Helvetica, sans-serif; color: #111; font-size: ${isPdfMode ? "8px" : "12px"}; line-height: 1.35; padding: ${isPdfMode ? "0" : "20px"}; }
        .quote-toolbar { width: ${isPdfMode ? "794px" : "860px"}; margin: 0 auto 12px; padding: 12px 16px; border: 1px solid #ccc; background: #fff; display: ${isPdfMode ? "none" : "flex"}; align-items: center; justify-content: space-between; gap: 12px; }
        .toolbar-text { margin: 0; color: #555; font-size: 12px; }
        .toolbar-actions { display: flex; gap: 8px; }
        .toolbar-btn { border: 1px solid #ccc; border-radius: 4px; padding: 8px 14px; font-family: inherit; font-size: 12px; font-weight: 600; cursor: pointer; background: #fff; }
        .toolbar-btn.primary { background: #0d9488; color: #fff; border-color: #0d9488; }
        .quote-sheet { width: ${isPdfMode ? "794px" : "860px"}; margin: 0 auto; background: #fff; border: 1px solid #000; }
        .doc-title { text-align: center; font-size: ${isPdfMode ? "13px" : "16px"}; font-weight: 700; color: #0d9488; letter-spacing: 0.06em; padding: ${isPdfMode ? "6px 8px" : "10px"}; border-bottom: 1px solid #000; }
        .doc-subtitle { text-align: center; font-size: ${isPdfMode ? "8px" : "10px"}; color: #555; padding-bottom: 4px; border-bottom: 1px solid #000; }
        .layout-table { width: 100%; border-collapse: collapse; }
        .layout-table > tbody > tr > td, .layout-table > tr > td { border: 1px solid #000; vertical-align: top; padding: ${isPdfMode ? "5px 7px" : "8px 10px"}; }
        .company-cell { width: 68%; }
        .meta-cell { width: 32%; padding: 0 !important; }
        .company-row { display: flex; align-items: flex-start; gap: ${isPdfMode ? "8px" : "12px"}; }
        .store-logo { width: ${isPdfMode ? "34px" : "44px"}; height: ${isPdfMode ? "34px" : "44px"}; flex-shrink: 0; }
        .store-logo svg { width: 100%; height: 100%; stroke: #111; fill: none; stroke-width: 1.6; }
        .company-name { font-size: ${isPdfMode ? "11px" : "14px"}; font-weight: 700; margin-bottom: 3px; }
        .company-line { margin-bottom: 2px; }
        .company-line b { font-weight: 700; }
        .meta-inner { width: 100%; border-collapse: collapse; }
        .meta-inner td { border-bottom: 1px solid #000; padding: ${isPdfMode ? "4px 7px" : "6px 10px"}; font-size: inherit; }
        .meta-inner tr:last-child td { border-bottom: none; }
        .meta-inner .meta-label { font-weight: 600; white-space: nowrap; }
        .meta-inner .meta-value { font-weight: 700; text-align: right; }
        .section-label { font-weight: 700; margin-bottom: 3px; }
        .customer-name { font-weight: 700; margin-bottom: 4px; }
        .half { width: 50%; }
        .items-table { width: 100%; border-collapse: collapse; border-top: 1px solid #000; }
        .items-table th, .items-table td { border: 1px solid #000; padding: ${isPdfMode ? "3px 4px" : "5px 6px"}; vertical-align: top; }
        .items-table thead th { background: #f0fdfa; font-weight: 700; text-align: center; font-size: ${isPdfMode ? "7px" : "10px"}; }
        .col-index { width: 20px; text-align: center; }
        .col-hsn { width: 48px; text-align: center; }
        .col-rate { width: 58px; }
        .col-qty { width: 58px; }
        .col-disc { width: 38px; }
        .col-taxable { width: 62px; }
        .col-gst { width: 58px; }
        .col-line { width: 62px; }
        .col-item strong { display: block; font-weight: 700; }
        .item-meta { display: block; margin-top: 2px; color: #444; font-size: ${isPdfMode ? "7px" : "9px"}; }
        .gst-rate { display: block; font-size: ${isPdfMode ? "6px" : "8px"}; color: #666; }
        .align-right { text-align: right; }
        .align-center { text-align: center; }
        .totals-left { width: 55%; font-weight: 600; vertical-align: middle !important; }
        .totals-right { width: 45%; padding: 0 !important; }
        .summary-mini { width: 100%; border-collapse: collapse; }
        .summary-mini td { border-bottom: 1px solid #000; padding: ${isPdfMode ? "3px 7px" : "5px 10px"}; }
        .summary-mini tr:last-child td { border-bottom: none; }
        .summary-mini .sum-label { font-weight: 600; text-align: left; }
        .summary-mini .sum-value { font-weight: 700; text-align: right; white-space: nowrap; }
        .summary-mini .total-row td { font-size: ${isPdfMode ? "10px" : "13px"}; font-weight: 700; background: #f0fdfa; }
        .words-row { border-top: 1px solid #000; border-bottom: 1px solid #000; padding: ${isPdfMode ? "5px 7px" : "8px 10px"}; font-weight: 600; }
        .remarks-block { min-height: ${isPdfMode ? "40px" : "60px"}; }
        .signatory { border-top: 1px solid #000; padding: ${isPdfMode ? "8px 7px 10px" : "12px 10px 16px"}; text-align: right; font-weight: 700; }
        .signatory .script { font-family: "Brush Script MT", "Segoe Script", cursive; font-size: ${isPdfMode ? "22px" : "32px"}; font-weight: 400; color: #0d9488; line-height: 1; margin-bottom: 4px; }
        .signatory .role { font-size: ${isPdfMode ? "8px" : "11px"}; font-weight: 600; color: #333; }
        @page { size: A4; margin: 10mm; }
        @media print { body { background: #fff; padding: 0; } .quote-toolbar { display: none; } .quote-sheet { width: 100%; border: none; } }
      </style>
    </head>
    <body>
      <div class="quote-toolbar">
        <p class="toolbar-text">${escapeHtml(options.helperText || "Use Print / Save as PDF to export this quotation.")}</p>
        <div class="toolbar-actions">
          <button class="toolbar-btn" onclick="window.close()">Close</button>
          <button class="toolbar-btn primary" onclick="window.print()">Print / Save PDF</button>
        </div>
      </div>
      <div class="quote-sheet">
        <div class="doc-title">QUOTATION</div>
        <div class="doc-subtitle">This document is a quotation and not a tax invoice</div>
        <table class="layout-table">
          <tr>
            <td class="company-cell">
              <div class="company-row">
                <div class="store-logo"><svg viewBox="0 0 24 24"><circle cx="9" cy="20" r="1.6"></circle><circle cx="17" cy="20" r="1.6"></circle><path d="M3 4h2l2.1 10.4a1 1 0 0 0 1 .8h9.7a1 1 0 0 0 1-.8L21 7H7"></path></svg></div>
                <div>
                  <div class="company-name">${escapeHtml(companyName)}</div>
                  <div class="company-line"><b>GSTIN:</b> ${escapeHtml(store.gstin)}</div>
                  <div class="company-line"><b>PAN:</b> ${escapeHtml(store.pan)}</div>
                  <div class="company-line">${escapeHtml(store.location)}</div>
                  <div class="company-line">Mobile: ${escapeHtml(store.phone)}</div>
                  <div class="company-line">Email: ${escapeHtml(store.email)}</div>
                </div>
              </div>
            </td>
            <td class="meta-cell">
              <table class="meta-inner">
                <tr><td class="meta-label">Quotation #</td><td class="meta-value">${escapeHtml(rec.quotation_no)}</td></tr>
                <tr><td class="meta-label">Serial No.</td><td class="meta-value">${escapeHtml(rec.serial_no)}</td></tr>
                <tr><td class="meta-label">Ref No.</td><td class="meta-value">${escapeHtml(rec.ref_no || "—")}</td></tr>
                <tr><td class="meta-label">Date</td><td class="meta-value">${formatDocDate(rec.quotation_date)}</td></tr>
                <tr><td class="meta-label">Valid Till</td><td class="meta-value">${formatDocDate(rec.valid_till)}</td></tr>
                <tr><td class="meta-label">Rate Type</td><td class="meta-value">${escapeHtml(rec.rate_type)}</td></tr>
                <tr><td class="meta-label">Status</td><td class="meta-value">${escapeHtml(rec.status)}</td></tr>
              </table>
            </td>
          </tr>
        </table>
        <table class="layout-table">
          <tr>
            <td class="half">
              <div class="section-label">Customer Details:</div>
              <div class="customer-name">${escapeHtml(rec.customer_name || "Walk-in Customer")}</div>
              <div>${escapeHtml(rec.customer_address || "—")}</div>
              <div>Ph: ${escapeHtml(rec.customer_phone || "—")}</div>
              <div>GSTIN: ${escapeHtml(rec.customer_gstin || "—")}</div>
              <div>Place of Supply: ${escapeHtml(placeOfSupply)}</div>
            </td>
            <td class="half">
              <div class="section-label">Quotation Summary:</div>
              <div>Total Items / Qty: ${rec.items.length} / ${totalQuantity.toFixed(2)}</div>
              <div>Gross Amount: ${formatCurrency(totalAmount)}</div>
              <div>Total Discount: ${formatCurrency(totalLineDiscount)}</div>
              <div>Taxable Value: ${formatCurrency(totalTaxable)}</div>
            </td>
          </tr>
        </table>
        <table class="items-table">
          <thead>
            <tr>
              <th>#</th><th>Item</th><th>HSN</th><th>Rate</th><th>Qty</th><th>Disc%</th>
              <th>Taxable</th><th>CGST</th><th>SGST</th><th>Line Total</th>
            </tr>
          </thead>
          <tbody>${rowMarkup}</tbody>
        </table>
        <table class="layout-table">
          <tr>
            <td class="totals-left">Total Items / Qty: ${rec.items.length} / ${totalQuantity.toFixed(2)}</td>
            <td class="totals-right">
              <table class="summary-mini">
                <tr><td class="sum-label">Amount</td><td class="sum-value">${formatCurrency(totalAmount)}</td></tr>
                <tr><td class="sum-label">Discount</td><td class="sum-value">${formatCurrency(totalLineDiscount)}</td></tr>
                <tr><td class="sum-label">Sub Total</td><td class="sum-value">${formatCurrency(rec.subtotal)}</td></tr>
                <tr><td class="sum-label">GST / Cess</td><td class="sum-value">${formatCurrency(gstCessTotal)}</td></tr>
                ${rec.round_off !== 0 ? `<tr><td class="sum-label">Round Off</td><td class="sum-value">${formatCurrency(rec.round_off)}</td></tr>` : ""}
                <tr class="total-row"><td class="sum-label">Net Amount</td><td class="sum-value">${formatCurrency(rec.net_amount)}</td></tr>
              </table>
            </td>
          </tr>
        </table>
        <div class="words-row">Total amount (in words): <b>${escapeHtml(amountInWords)}</b></div>
        <table class="layout-table">
          <tr>
            <td class="half remarks-block">
              <div class="section-label">Remarks:</div>
              <div>${escapeHtml(rec.remarks || "—")}</div>
            </td>
            <td class="half">
              <div class="section-label">Terms:</div>
              <div>${escapeHtml(store.terms)}</div>
              <div style="margin-top:6px">Bank: ${escapeHtml(store.bankName)} | A/C: ${escapeHtml(store.accountNo)} | IFSC: ${escapeHtml(store.ifsc)}</div>
            </td>
          </tr>
        </table>
        <div class="signatory">
          <div class="script">${escapeHtml(store.signatureScript)}</div>
          <div>${escapeHtml(store.signatureCompany)}</div>
          <div class="role">${escapeHtml(store.signatureRole)}</div>
        </div>
      </div>
      <script>${options.autoPrint ? "window.addEventListener('load', () => { setTimeout(() => window.print(), 250); });" : ""}</script>
    </body>
  </html>`;
}

async function waitForQuotationFrame(html: string): Promise<HTMLIFrameElement> {
  const iframe = document.createElement("iframe");
  Object.assign(iframe.style, QUOTATION_FRAME_STYLE);
  iframe.setAttribute("aria-hidden", "true");
  document.body.appendChild(iframe);
  const frameDocument = iframe.contentDocument;
  if (!frameDocument) { iframe.remove(); throw new Error("Unable to prepare the quotation document."); }
  frameDocument.open();
  frameDocument.write(html);
  frameDocument.close();
  const startedAt = Date.now();
  await new Promise<void>((resolve, reject) => {
    const checkReady = () => {
      const readyState = iframe.contentDocument?.readyState;
      if (readyState === "interactive" || readyState === "complete") { resolve(); return; }
      if (Date.now() - startedAt > 5000) { reject(new Error("Quotation preview took too long to load.")); return; }
      window.setTimeout(checkReady, 50);
    };
    checkReady();
  });
  const fontSet = iframe.contentDocument?.fonts;
  if (fontSet?.ready) { try { await fontSet.ready; } catch { /* fallback fonts */ } }
  await new Promise((resolve) => window.setTimeout(resolve, 120));
  return iframe;
}

interface InventoryItem {
  code: string; name: string; hsn_code: string; uom: string;
  company_code?: string; group?: string; sub_group?: string;
  brand?: string; type?: string; enable_batch?: string; stock_qty?: number;
}

function SearchableProductSelect({
  items, value, onChange, placeholder = "Search catalog...",
}: { items: InventoryItem[]; value: string; onChange: (item: InventoryItem) => void; placeholder?: string; }) {
  const [isOpen, setIsOpen] = useState(false);
  const [search, setSearch] = useState("");
  const [dropStyle, setDropStyle] = useState<{ top: number; left: number; width: number } | null>(null);
  const btnRef = useRef<HTMLButtonElement>(null);
  const selected = items.find((i) => i.code === value);

  const filtered = useMemo(() =>
    items.filter((i) =>
      i.name.toLowerCase().includes(search.toLowerCase()) ||
      i.code.toLowerCase().includes(search.toLowerCase())
    ), [items, search]);

  const openDrop = () => {
    if (btnRef.current) {
      const r = btnRef.current.getBoundingClientRect();
      const dropH = Math.min(260, filtered.length * 44 + 52);
      const spaceBelow = window.innerHeight - r.bottom;
      const top = spaceBelow >= dropH ? r.bottom + 4 : r.top - dropH - 4;
      setDropStyle({ top, left: r.left, width: r.width });
    }
    setIsOpen(true);
  };

  useEffect(() => {
    if (!isOpen) return;
    const recalc = () => {
      if (btnRef.current) {
        const r = btnRef.current.getBoundingClientRect();
        const dropH = Math.min(260, filtered.length * 44 + 52);
        const top = window.innerHeight - r.bottom >= dropH ? r.bottom + 4 : r.top - dropH - 4;
        setDropStyle({ top, left: r.left, width: r.width });
      }
    };
    window.addEventListener("scroll", recalc, true);
    window.addEventListener("resize", recalc);
    return () => { window.removeEventListener("scroll", recalc, true); window.removeEventListener("resize", recalc); };
  }, [isOpen, filtered.length]);

  return (
    <div className="relative w-full text-left font-sans">
      <button ref={btnRef} type="button"
        onClick={() => isOpen ? setIsOpen(false) : openDrop()}
        className="w-full flex items-center justify-between bg-white text-xs border border-slate-300 rounded py-1.5 px-2.5 focus:outline-none focus:ring-2 focus:ring-teal-500/10 focus:border-teal-600 transition-all text-slate-800 font-medium">
        <span className="truncate">{selected ? `${selected.code} - ${selected.name}` : placeholder}</span>
        <span className="ml-1 text-slate-400 text-[9px]">{isOpen ? "▲" : "▼"}</span>
      </button>
      {isOpen && dropStyle && (
        <>
          <div className="fixed inset-0 z-[60]" onClick={() => { setIsOpen(false); setSearch(""); }} />
          <div className="fixed z-[70] bg-white border border-slate-200 rounded-lg shadow-2xl overflow-hidden"
            style={{ top: dropStyle.top, left: dropStyle.left, width: dropStyle.width, maxHeight: "260px", display: "flex", flexDirection: "column" }}>
            <div className="p-2 border-b border-slate-100 bg-white flex-shrink-0">
              <input autoFocus type="text" value={search} onChange={(e) => setSearch(e.target.value)}
                placeholder="Search code / name..." onClick={(e) => e.stopPropagation()}
                className="w-full text-xs border border-slate-300 rounded px-2 py-1.5 focus:outline-none focus:ring-1 focus:ring-teal-600 focus:border-teal-600" />
            </div>
            <ul className="overflow-y-auto py-1 flex-1">
              {filtered.length === 0
                ? <li className="px-3 py-2 text-xs text-slate-500 text-center">No products found</li>
                : filtered.map((item) => (
                  <li key={item.code} onClick={() => { onChange(item); setIsOpen(false); setSearch(""); }}
                    className={`px-3 py-2 text-xs cursor-pointer hover:bg-teal-50 hover:text-teal-700 transition-colors border-b border-slate-50 last:border-0 ${item.code === value ? "bg-teal-100/50 text-teal-700 font-semibold" : "text-slate-700"}`}>
                    <div className="font-semibold">{item.code}</div>
                    <div className="text-[10px] text-slate-500 truncate mt-0.5">{item.name}</div>
                  </li>
                ))}
            </ul>
          </div>
        </>
      )}
    </div>
  );
}

export default function QuotationPage() {
  const [quotations, setQuotations] = useState<QuotationRecord[]>([]);
  const [inventory, setInventory] = useState<InventoryItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [isFormOpen, setIsFormOpen] = useState(false);
  const [dbStatus, setDbStatus] = useState<"connected" | "local">("connected");
  const [editingQuotation, setEditingQuotation] = useState<QuotationRecord | null>(null);
  const [viewingQuotation, setViewingQuotation] = useState<QuotationRecord | null>(null);

  const [searchQuery, setSearchQuery] = useState("");
  const [statusFilter, setStatusFilter] = useState("All");
  const [currentPage, setCurrentPage] = useState(1);
  const itemsPerPage = 10;

  const [purchaseItemMap, setPurchaseItemMap] = useState<Map<string, {
    rate: number; sgst: number; cgst: number;
    hsn_code: string; unit: string; s_rate: number; mrp: number;
  }>>(new Map());

  const [quotationNo, setQuotationNo] = useState("");
  const [serialNo, setSerialNo] = useState("");
  const [quotationDate, setQuotationDate] = useState(todayIso());
  const [validTill, setValidTill] = useState(addDaysIso(todayIso(), 30));
  const [refNo, setRefNo] = useState("");
  const [rateType, setRateType] = useState("Bill");
  const [customerName, setCustomerName] = useState("");
  const [isCustomCustomer, setIsCustomCustomer] = useState(false);
  const [customCustomerText, setCustomCustomerText] = useState("");
  const [customerAddress, setCustomerAddress] = useState("");
  const [customerGstin, setCustomerGstin] = useState("");
  const [customerPhone, setCustomerPhone] = useState("");
  const [gridItems, setGridItems] = useState<QuotationItem[]>([blankItem()]);
  const [remarks, setRemarks] = useState("");
  const [fCess, setFCess] = useState("");
  const [status, setStatus] = useState<QuotationStatus>("Pending");
  const [formError, setFormError] = useState<string | null>(null);
  const [successMsg, setSuccessMsg] = useState<string | null>(null);

  useEffect(() => { setTimeout(() => setCurrentPage(1), 0); }, [searchQuery, statusFilter]);

  const generateQuotationNo = useCallback(() => {
    const yr = new Date().getFullYear();
    const rnd = Math.floor(1000 + Math.random() * 9000);
    const no = `QTN-${yr}-${rnd}`;
    setQuotationNo(no);
    setSerialNo(`SRL-${yr}-${rnd}`);
  }, []);

  const loadLocalQuotations = useCallback(() => {
    const local = localStorage.getItem(LOCAL_STORAGE_KEY);
    if (local) {
      try { setQuotations((JSON.parse(local) as Record<string, unknown>[]).map(normalizeQuotation)); return; }
      catch { setQuotations([]); return; }
    }
    const legacy = localStorage.getItem(LEGACY_STORAGE_KEY);
    if (legacy) {
      try {
        const parsed = (JSON.parse(legacy) as Record<string, unknown>[]).map(normalizeQuotation);
        localStorage.setItem(LOCAL_STORAGE_KEY, JSON.stringify(parsed));
        setQuotations(parsed);
      } catch { setQuotations([]); }
    } else { setQuotations([]); }
  }, []);

  const fetchQuotations = useCallback(async () => {
    try {
      setLoading(true);
      const { data, error } = await supabase.from("quotations").select("*").order("created_at", { ascending: false });
      if (error) {
        if (isMissingTableError(error)) setDbStatus("local");
        else setDbStatus("local");
        loadLocalQuotations();
      } else if (data) {
        setQuotations((data as Record<string, unknown>[]).map(normalizeQuotation));
        setDbStatus("connected");
      }
    } catch {
      setDbStatus("local");
      loadLocalQuotations();
    } finally { setLoading(false); }
  }, [loadLocalQuotations]);

  const fetchInventory = useCallback(async () => {
    try {
      const { data, error } = await supabase.from("inventory").select("*").order("name");
      if (!error && data) { setInventory(data); return; }
    } catch { /* fall through */ }
    const local = localStorage.getItem("kaniyamparambil_inventory");
    if (local) { try { setInventory(JSON.parse(local)); } catch { setInventory([]); } }
  }, []);

  const fetchPurchaseItemMap = useCallback(async () => {
    try {
      const { data, error } = await supabase.from("purchases").select("items, created_at").order("created_at", { ascending: false });
      if (error || !data) {
        const local = localStorage.getItem("kaniyamparambil_purchases");
        if (!local) return;
        try { buildMap(JSON.parse(local) as Array<{ items: unknown[] }>); } catch { /* ignore */ }
        return;
      }
      buildMap(data as Array<{ items: unknown[] }>);
    } catch { /* ignore */ }

    function buildMap(rows: Array<{ items: unknown[] }>) {
      const map = new Map<string, { rate: number; sgst: number; cgst: number; hsn_code: string; unit: string; s_rate: number; mrp: number }>();
      for (const row of rows) {
        if (!Array.isArray(row.items)) continue;
        for (const it of row.items as Record<string, unknown>[]) {
          const code = String(it.code ?? "").trim();
          if (!code || map.has(code)) continue;
          map.set(code, {
            rate: Number(it.rate ?? 0),
            sgst: Number(it.sgst ?? 9),
            cgst: Number(it.cgst ?? 9),
            hsn_code: String(it.hsn_code ?? ""),
            unit: String(it.unit ?? "Nos"),
            s_rate: Number(it.s_rate ?? 0),
            mrp: Number(it.mrp ?? 0),
          });
        }
      }
      setPurchaseItemMap(map);
    }
  }, []);

  useEffect(() => {
    const t = setTimeout(() => {
      fetchQuotations();
      fetchInventory();
      fetchPurchaseItemMap();
      generateQuotationNo();
    }, 0);
    return () => clearTimeout(t);
  }, [fetchQuotations, fetchInventory, fetchPurchaseItemMap, generateQuotationNo]);

  const computeLineAutos = (item: QuotationItem): Partial<QuotationItem> => {
    const rateAmt = Number(item.qty) * Number(item.rate);
    const discAmt = rateAmt * ((Number(item.disc_pct) || 0) / 100);
    const taxable = Math.max(0, rateAmt - discAmt);
    const sgstAmt = taxable * ((Number(item.sgst) || 0) / 100);
    const cgstAmt = taxable * ((Number(item.cgst) || 0) / 100);
    return {
      amount: Math.round(rateAmt * 100) / 100,
      line_total: Math.round((taxable + sgstAmt + cgstAmt) * 100) / 100,
    };
  };

  const addGridRow = () => setGridItems((prev) => [...prev, blankItem()]);
  const removeGridRow = (i: number) => { if (gridItems.length > 1) setGridItems(gridItems.filter((_, idx) => idx !== i)); };

  const updateGridRow = (i: number, key: keyof QuotationItem, val: string | number) => {
    setGridItems(gridItems.map((item, idx) => {
      if (idx !== i) return item;
      const updated = { ...item, [key]: val };
      if (["qty", "rate", "disc_pct", "sgst", "cgst"].includes(key)) {
        Object.assign(updated, computeLineAutos(updated));
      }
      return updated;
    }));
  };

  const handleProductSelect = (i: number, prod: InventoryItem) => {
    const purchaseData = purchaseItemMap.get(prod.code);
    const sellRate = purchaseData?.mrp || purchaseData?.s_rate || purchaseData?.rate || 0;
    const costRate = purchaseData?.rate ?? 0;
    setGridItems(gridItems.map((item, idx) => {
      if (idx !== i) return item;
      const updated: QuotationItem = {
        ...item,
        code: prod.code,
        name: prod.name,
        hsn_code: purchaseData?.hsn_code || prod.hsn_code || "",
        unit: purchaseData?.unit || prod.uom || "Nos",
        rate: sellRate,
        cost: costRate,
        sgst: purchaseData?.sgst ?? 9,
        cgst: purchaseData?.cgst ?? 9,
      };
      Object.assign(updated, computeLineAutos(updated));
      return updated;
    }));
  };

  const calc = useMemo(() => {
    let sub = 0;
    let totalGst = 0;
    let totalCost = 0;
    gridItems.forEach((item) => {
      const rateAmt = item.qty * item.rate;
      const discAmt = rateAmt * ((item.disc_pct || 0) / 100);
      const taxable = Math.max(0, rateAmt - discAmt);
      sub += taxable;
      totalGst += taxable * (((item.sgst ?? 0) + (item.cgst ?? 0)) / 100);
      totalCost += item.qty * (item.cost || 0);
    });
    const fCessNum = Number(fCess) || 0;
    const rawTotal = sub + totalGst + fCessNum;
    const roundOff = Math.round(rawTotal) - rawTotal;
    const netAmount = rawTotal + roundOff;
    return {
      totalCost: Math.round(totalCost * 100) / 100,
      subtotal: Math.round(sub * 100) / 100,
      totalGst: Math.round(totalGst * 100) / 100,
      roundOff: Math.round(roundOff * 100) / 100,
      netAmount: Math.round(netAmount * 100) / 100,
    };
  }, [gridItems, fCess]);

  const closeFormModal = () => {
    setIsFormOpen(false);
    setEditingQuotation(null);
    setFormError(null);
    setTimeout(() => setSuccessMsg(null), 4000);
  };

  const resetForm = () => {
    setEditingQuotation(null);
    setQuotationDate(todayIso());
    setValidTill(addDaysIso(todayIso(), 30));
    setRefNo("");
    setRateType("Bill");
    setCustomerName("");
    setIsCustomCustomer(false);
    setCustomCustomerText("");
    setCustomerAddress("");
    setCustomerGstin("");
    setCustomerPhone("");
    setGridItems([blankItem()]);
    setRemarks("");
    setFCess("");
    setStatus("Pending");
    setFormError(null);
    generateQuotationNo();
    closeFormModal();
  };

  const handleStartEdit = (rec: QuotationRecord) => {
    setEditingQuotation(rec);
    setQuotationNo(rec.quotation_no);
    setSerialNo(rec.serial_no);
    setQuotationDate(rec.quotation_date);
    setValidTill(rec.valid_till);
    setRefNo(rec.ref_no ?? "");
    setRateType(rec.rate_type);
    if (SEED_CUSTOMERS.includes(rec.customer_name)) {
      setCustomerName(rec.customer_name);
      setIsCustomCustomer(false);
    } else {
      setCustomerName("CUSTOM");
      setIsCustomCustomer(true);
      setCustomCustomerText(rec.customer_name);
    }
    setCustomerAddress(rec.customer_address ?? "");
    setCustomerGstin(rec.customer_gstin ?? "");
    setCustomerPhone(rec.customer_phone ?? "");
    setGridItems(rec.items.length > 0 ? rec.items : [blankItem()]);
    setRemarks(rec.remarks ?? "");
    setFCess(String(rec.f_cess || ""));
    setStatus(rec.status);
    setIsFormOpen(true);
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setFormError(null);
    setSuccessMsg(null);

    const customerFinal = isCustomCustomer ? customCustomerText.trim() : customerName.trim();
    if (!customerFinal) { setFormError("Please select or enter a customer."); return; }
    if (customerPhone.trim() && customerPhone.trim().length !== 10) {
      setFormError("Phone must be a 10-digit mobile number.");
      return;
    }
    if (customerGstin.trim() && !GSTIN_PATTERN.test(customerGstin.trim())) {
      setFormError("Enter a valid 15-character GSTIN.");
      return;
    }
    if (validTill < quotationDate) {
      setFormError("Valid till date cannot be before quotation date.");
      return;
    }
    if (gridItems.some((i) => !i.name.trim() || i.qty <= 0 || i.rate <= 0)) {
      setFormError("All items must have a name, valid quantity, and rate.");
      return;
    }

    const itemsSummary = gridItems.map((i) => i.name).filter(Boolean).join(", ");
    const payload: QuotationRecord = {
      quotation_no: quotationNo,
      serial_no: serialNo,
      quotation_date: quotationDate,
      valid_till: validTill,
      ref_no: refNo.trim() || undefined,
      rate_type: rateType,
      customer_name: customerFinal,
      customer_address: customerAddress.trim() || undefined,
      customer_gstin: customerGstin.trim() || undefined,
      customer_phone: customerPhone.trim() || undefined,
      items: gridItems.map((i) => ({ ...i, ...computeLineAutos(i) })),
      remarks: remarks.trim() || undefined,
      total_cost: calc.totalCost,
      subtotal: calc.subtotal,
      total_gst: calc.totalGst,
      f_cess: parseOptionalDecimal(fCess, 9999999, 2),
      round_off: calc.roundOff,
      net_amount: calc.netAmount,
      status,
      amount: calc.netAmount,
      items_summary: itemsSummary || undefined,
    };

    if (dbStatus === "connected") {
      try {
        if (editingQuotation) {
          const { error } = await supabase.from("quotations").update(payload).eq("quotation_no", editingQuotation.quotation_no);
          if (error) throw error;
        } else {
          const { error } = await supabase.from("quotations").insert(payload);
          if (error) throw error;
        }
        setSuccessMsg(editingQuotation ? "Quotation updated successfully." : "Quotation saved successfully.");
        fetchQuotations();
        if (!editingQuotation) resetForm();
      } catch (err) {
        setFormError(err instanceof Error ? err.message : "Failed to save quotation.");
      }
    } else {
      const updated = editingQuotation
        ? quotations.map((q) => q.quotation_no === editingQuotation.quotation_no ? { ...payload, created_at: q.created_at } : q)
        : [{ ...payload, created_at: new Date().toISOString() }, ...quotations];
      localStorage.setItem(LOCAL_STORAGE_KEY, JSON.stringify(updated));
      setQuotations(updated);
      setSuccessMsg(editingQuotation ? "Quotation updated (local)." : "Quotation saved (local).");
      if (!editingQuotation) resetForm();
    }
  };

  const handleDelete = async (no: string) => {
    if (!window.confirm(`Delete quotation "${no}"?`)) return;
    if (dbStatus === "connected") {
      try {
        const { error } = await supabase.from("quotations").delete().eq("quotation_no", no);
        if (error) throw error;
        fetchQuotations();
      } catch (err) { alert(`Delete failed: ${err instanceof Error ? err.message : "Unknown error"}`); }
    } else {
      const updated = quotations.filter((q) => q.quotation_no !== no);
      localStorage.setItem(LOCAL_STORAGE_KEY, JSON.stringify(updated));
      setQuotations(updated);
    }
  };

  const handlePrintQuotation = async (rec: QuotationRecord) => {
    let iframe: HTMLIFrameElement | null = null;
    try {
      iframe = await waitForQuotationFrame(buildQuotationHtml(rec, { renderMode: "print" }));
      const printWindow = iframe.contentWindow;
      if (!printWindow) throw new Error("Unable to open the print dialog.");
      printWindow.focus();
      printWindow.print();
    } catch (err) {
      alert(`Print failed: ${err instanceof Error ? err.message : "Unknown error"}`);
    } finally {
      window.setTimeout(() => iframe?.remove(), 1200);
    }
  };

  const handleDownloadQuotation = async (rec: QuotationRecord) => {
    let iframe: HTMLIFrameElement | null = null;
    try {
      iframe = await waitForQuotationFrame(buildQuotationHtml(rec, { renderMode: "pdf" }));
      const quoteRoot = iframe.contentDocument?.querySelector(".quote-sheet");
      if (!(quoteRoot instanceof HTMLElement)) throw new Error("Unable to prepare quotation layout for PDF export.");
      const canvas = await html2canvas(quoteRoot, { scale: 2, useCORS: true, backgroundColor: "#ffffff" });
      const pdf = new jsPDF({ orientation: "portrait", unit: "pt", format: "a4" });
      const pageWidth = pdf.internal.pageSize.getWidth();
      const pageHeight = pdf.internal.pageSize.getHeight();
      const margin = 12;
      const maxWidth = pageWidth - margin * 2;
      const maxHeight = pageHeight - margin * 2;
      const scale = Math.min(maxWidth / canvas.width, maxHeight / canvas.height);
      pdf.addImage(canvas.toDataURL("image/png"), "PNG", margin, margin, canvas.width * scale, canvas.height * scale, undefined, "FAST");
      pdf.save(`quotation_${rec.quotation_no}.pdf`);
    } catch (err) {
      alert(`PDF download failed: ${err instanceof Error ? err.message : "Unknown error"}`);
    } finally { iframe?.remove(); }
  };

  const filteredQuotations = useMemo(() => quotations.filter((q) => {
    const qry = searchQuery.toLowerCase();
    const matchQ = q.quotation_no.toLowerCase().includes(qry)
      || q.customer_name.toLowerCase().includes(qry)
      || q.serial_no.toLowerCase().includes(qry)
      || (q.ref_no ?? "").toLowerCase().includes(qry);
    const matchS = statusFilter === "All" || q.status === statusFilter;
    return matchQ && matchS;
  }), [quotations, searchQuery, statusFilter]);

  const totalPages = Math.ceil(filteredQuotations.length / itemsPerPage);
  const currentQuotations = filteredQuotations.slice((currentPage - 1) * itemsPerPage, currentPage * itemsPerPage);

  const availableCustomers = useMemo(() =>
    Array.from(new Set([...SEED_CUSTOMERS, ...quotations.map((q) => q.customer_name)])).filter(Boolean),
    [quotations]);

  const statusBadgeClass = (s: QuotationStatus) => {
    if (s === "Approved") return "bg-green-100 text-green-800 border border-green-200";
    if (s === "Sent") return "bg-blue-100 text-blue-800 border border-blue-200";
    return "bg-amber-100 text-amber-800 border border-amber-200";
  };

  return (
    <div className="p-6 space-y-6">
      <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-4">
        <div>
          <h1 className="text-page-title font-semibold text-text-primary flex items-center gap-2">
            <FileSpreadsheet className="w-6 h-6 text-teal-600" />
            Quotations
          </h1>
          <p className="text-caption text-text-secondary mt-0.5">
            Create GST quotations, track status, and print or download PDF copies.
          </p>
        </div>
        <button type="button" onClick={() => { resetForm(); generateQuotationNo(); setIsFormOpen(true); }}
          className="btn-primary bg-teal-600 hover:bg-teal-700 active:bg-teal-800 flex items-center gap-1.5 shadow-sm">
          <Plus className="w-4 h-4" /> New Quotation
        </button>
      </div>

      {dbStatus === "local" && (
        <div className="bg-blue-50 border border-blue-200 rounded-lg p-4 flex items-start gap-3">
          <Database className="w-5 h-5 text-blue-600 mt-0.5 flex-shrink-0" />
          <div>
            <h4 className="text-sm font-semibold text-blue-800">Local Mode Active</h4>
            <p className="text-xs text-blue-700 mt-0.5">
              The <code>quotations</code> table is missing or unavailable. Run <code>sql/06_quotations.sql</code> in Supabase, or data will be stored locally.
            </p>
          </div>
        </div>
      )}

      <div className="bg-white border border-border rounded-xl shadow-card p-4 flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div className="relative flex-1 max-w-md">
          <Search className="w-4 h-4 text-text-secondary absolute left-3 top-3" />
          <input type="text" value={searchQuery} onChange={(e) => setSearchQuery(e.target.value)}
            placeholder="Search Quotation No, Serial, Customer..." className="input-enterprise pl-9" />
        </div>
        <div className="flex items-center gap-3">
          <div className="flex items-center gap-1.5 text-xs font-semibold text-text-secondary">
            <Filter className="w-3.5 h-3.5" /><span>Status:</span>
          </div>
          <select value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)}
            className="input-enterprise bg-white cursor-pointer w-40">
            <option value="All">All Status</option>
            {QUOTATION_STATUSES.map((s) => <option key={s} value={s}>{s}</option>)}
          </select>
        </div>
      </div>

      <div className="bg-white border border-border rounded-xl shadow-card overflow-hidden">
        <div className="overflow-x-auto">
          <table className="table-enterprise w-full text-xs">
            <thead>
              <tr className="bg-gray-50 border-b border-border">
                {["Quotation No.", "Serial", "Customer", "Date", "Valid Till", "Net Amount", "Status", "Actions"].map((h) => (
                  <th key={h} className="px-4 py-3 text-center font-semibold uppercase tracking-wider text-text-secondary">{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {loading ? (
                <tr><td colSpan={8} className="text-center py-12">
                  <svg className="w-6 h-6 animate-spin text-teal-600 mx-auto mb-2" fill="none" viewBox="0 0 24 24">
                    <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"/>
                    <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"/>
                  </svg>
                  <span className="text-xs text-text-secondary">Loading quotations...</span>
                </td></tr>
              ) : currentQuotations.length === 0 ? (
                <tr><td colSpan={8} className="text-center py-16 text-text-secondary">
                  <Calendar className="w-8 h-8 mx-auto text-gray-300 mb-2"/>
                  <p className="font-semibold text-sm">No quotations found</p>
                  <p className="text-xs text-gray-400 mt-1">Click &quot;New Quotation&quot; to create one.</p>
                </td></tr>
              ) : currentQuotations.map((rec) => (
                <tr key={rec.quotation_no} className="border-b border-border hover:bg-gray-50/50 transition-colors">
                  <td className="px-4 py-2.5 font-mono font-semibold text-center">{rec.quotation_no}</td>
                  <td className="px-4 py-2.5 font-mono text-center text-text-secondary">{rec.serial_no}</td>
                  <td className="px-4 py-2.5 font-medium text-center truncate max-w-[140px]" title={rec.customer_name}>{rec.customer_name}</td>
                  <td className="px-4 py-2.5 font-mono text-center text-text-secondary">{rec.quotation_date}</td>
                  <td className="px-4 py-2.5 font-mono text-center text-text-secondary">{rec.valid_till}</td>
                  <td className="px-4 py-2.5 text-center font-mono font-bold">{formatCurrency(rec.net_amount)}</td>
                  <td className="px-4 py-2.5 text-center">
                    <span className={`inline-flex items-center px-2 py-0.5 rounded text-[10px] font-bold ${statusBadgeClass(rec.status)}`}>
                      {rec.status}
                    </span>
                  </td>
                  <td className="px-4 py-2.5 text-center">
                    <div className="flex items-center justify-center gap-1.5">
                      {[
                        { icon: Eye, title: "View", fn: () => setViewingQuotation(rec) },
                        { icon: Edit, title: "Edit", fn: () => handleStartEdit(rec) },
                        { icon: Printer, title: "Print", fn: () => handlePrintQuotation(rec) },
                        { icon: Download, title: "Download PDF", fn: () => handleDownloadQuotation(rec) },
                      ].map(({ icon: Icon, title, fn }) => (
                        <button key={title} type="button" onClick={fn} title={title}
                          className="text-slate-500 hover:text-teal-700 hover:bg-teal-50 p-1.5 rounded transition-all">
                          <Icon className="w-3.5 h-3.5" />
                        </button>
                      ))}
                      <button type="button" onClick={() => handleDelete(rec.quotation_no)} title="Delete"
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
        <div className="bg-gray-50 px-4 py-3 border-t border-border flex flex-col sm:flex-row items-center justify-between gap-4 text-xs text-text-secondary">
          <span>Showing {filteredQuotations.length > 0 ? (currentPage - 1) * itemsPerPage + 1 : 0}–{Math.min(currentPage * itemsPerPage, filteredQuotations.length)} of {filteredQuotations.length}</span>
          <div className="flex items-center gap-2">
            <button type="button" onClick={() => setCurrentPage((p) => Math.max(p - 1, 1))} disabled={currentPage === 1}
              className="px-3 py-1.5 font-semibold rounded border border-border bg-white text-gray-700 hover:bg-gray-50 disabled:opacity-50 disabled:cursor-not-allowed">Previous</button>
            <span className="font-medium text-gray-700">Page {currentPage} of {totalPages || 1}</span>
            <button type="button" onClick={() => setCurrentPage((p) => Math.min(p + 1, totalPages))} disabled={currentPage >= totalPages || totalPages === 0}
              className="px-3 py-1.5 font-semibold rounded border border-border bg-white text-gray-700 hover:bg-gray-50 disabled:opacity-50 disabled:cursor-not-allowed">Next</button>
          </div>
          <div className="font-semibold text-gray-900">
            Total Value: <span className="font-mono text-teal-700 bg-teal-50 px-2 py-0.5 border border-teal-100 rounded">
              {formatCurrency(filteredQuotations.reduce((a, q) => a + q.net_amount, 0))}
            </span>
          </div>
        </div>
      </div>

      {isFormOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/40 backdrop-blur-[2px]">
          <div className="absolute inset-0" onClick={closeFormModal} aria-hidden="true" />
          <div className="bg-white border border-slate-200 rounded-xl shadow-2xl relative max-w-6xl w-full max-h-[92vh] overflow-y-auto animate-in fade-in zoom-in-95 duration-150 z-10 flex flex-col font-sans">
            <div className="bg-teal-700 px-6 py-4 text-white rounded-t-xl flex items-center justify-between shadow-md sticky top-0 z-10">
              <div>
                <h2 className="text-sm font-bold tracking-tight">{editingQuotation ? "Edit Quotation" : "New Quotation"}</h2>
                <p className="text-[10px] text-teal-100 mt-0.5">
                  {editingQuotation ? `Editing: ${editingQuotation.quotation_no}` : `Quotation No: ${quotationNo}`}
                </p>
              </div>
              <button type="button" onClick={closeFormModal} className="text-teal-100 hover:text-white p-1.5 rounded-lg hover:bg-white/10 transition-colors" aria-label="Close modal">
                <X className="w-4.5 h-4.5" />
              </button>
            </div>

            <form onSubmit={handleSubmit} className="p-6 space-y-6">
              {formError && (
                <div className="bg-red-50 border border-red-200 text-red-800 text-xs px-4 py-2.5 rounded-md flex items-center gap-2">
                  <AlertTriangle className="w-4 h-4 flex-shrink-0" /><span>{formError}</span>
                </div>
              )}
              {successMsg && (
                <div className="bg-teal-50 border border-teal-200 text-teal-800 text-xs px-4 py-2.5 rounded-md flex items-center gap-2">
                  <Check className="w-4 h-4 flex-shrink-0" /><span>{successMsg}</span>
                </div>
              )}

              <div className="bg-slate-50 border border-slate-200/80 rounded-xl p-4 space-y-4">
                <h3 className="text-xs font-bold uppercase tracking-wider text-slate-500 border-b border-slate-200 pb-1.5">1. Quotation Header</h3>
                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
                  <div className="lg:col-span-2">
                    <label className="form-label text-xs">Customer *</label>
                    {!isCustomCustomer ? (
                      <select value={customerName}
                        onChange={(e) => e.target.value === "CUSTOM" ? setIsCustomCustomer(true) : setCustomerName(e.target.value)}
                        className="input-enterprise bg-white cursor-pointer text-xs w-full" required>
                        <option value="">-- Select Customer --</option>
                        {availableCustomers.map((c) => <option key={c} value={c}>{c}</option>)}
                        <option value="CUSTOM" className="text-teal-700 font-bold">+ Add New Customer</option>
                      </select>
                    ) : (
                      <div className="flex gap-2 items-center">
                        <input type="text" value={customCustomerText}
                          onChange={(e) => setCustomCustomerText(sanitizeName(e.target.value))}
                          placeholder="Type customer name" className="input-enterprise text-xs w-full" required
                          maxLength={120} autoComplete="name" />
                        <button type="button" onClick={() => { setIsCustomCustomer(false); setCustomCustomerText(""); }}
                          className="text-[10px] text-slate-500 hover:text-slate-800 underline font-bold whitespace-nowrap">Cancel</button>
                      </div>
                    )}
                  </div>
                  <div className="lg:col-span-2">
                    <label className="form-label text-xs">Address</label>
                    <input type="text" value={customerAddress}
                      onChange={(e) => setCustomerAddress(sanitizeAddress(e.target.value))}
                      placeholder="Customer address" className="input-enterprise text-xs"
                      maxLength={250} autoComplete="street-address" />
                  </div>
                  <div>
                    <label className="form-label text-xs">GSTIN</label>
                    <input type="text" value={customerGstin}
                      onChange={(e) => setCustomerGstin(sanitizeGstin(e.target.value))}
                      placeholder="15-character GSTIN" className="input-enterprise font-mono text-xs uppercase"
                      maxLength={15} inputMode="text" autoComplete="off" spellCheck={false} />
                  </div>
                  <div>
                    <label className="form-label text-xs">Phone</label>
                    <input type="tel" value={customerPhone}
                      onChange={(e) => setCustomerPhone(sanitizeDigits(e.target.value, 10))}
                      placeholder="10-digit mobile" className="input-enterprise font-mono text-xs"
                      maxLength={10} inputMode="numeric" pattern="[0-9]{10}" autoComplete="tel" />
                  </div>
                  <div>
                    <label className="form-label text-xs">Serial No.</label>
                    <input type="text" value={serialNo}
                      onChange={(e) => setSerialNo(sanitizeDocNo(e.target.value))}
                      className="input-enterprise font-mono text-xs" required
                      maxLength={30} autoComplete="off" />
                  </div>
                  <div>
                    <label className="form-label text-xs">Quotation No. *</label>
                    <input type="text" value={quotationNo}
                      onChange={(e) => setQuotationNo(sanitizeDocNo(e.target.value))}
                      disabled={!!editingQuotation} className="input-enterprise font-mono text-xs" required
                      maxLength={30} autoComplete="off" />
                  </div>
                  <div>
                    <label className="form-label text-xs">Date *</label>
                    <input type="date" value={quotationDate}
                      onChange={(e) => {
                        const nextDate = e.target.value;
                        setQuotationDate(nextDate);
                        setValidTill((prev) => (prev < nextDate ? addDaysIso(nextDate, 30) : prev));
                      }}
                      className="input-enterprise font-mono text-xs cursor-pointer" required />
                  </div>
                  <div>
                    <label className="form-label text-xs">Valid Till *</label>
                    <input type="date" value={validTill} min={quotationDate}
                      onChange={(e) => setValidTill(e.target.value)}
                      className="input-enterprise font-mono text-xs cursor-pointer" required />
                  </div>
                  <div>
                    <label className="form-label text-xs">Ref No.</label>
                    <input type="text" value={refNo}
                      onChange={(e) => setRefNo(sanitizeDocNo(e.target.value))}
                      placeholder="Reference number" className="input-enterprise text-xs font-mono"
                      maxLength={30} autoComplete="off" />
                  </div>
                  <div>
                    <label className="form-label text-xs">Rate Type *</label>
                    <select value={rateType} onChange={(e) => setRateType(e.target.value)}
                      className="input-enterprise bg-white cursor-pointer text-xs" required>
                      {RATE_TYPE_OPTIONS.map((r) => <option key={r} value={r}>{r}</option>)}
                    </select>
                  </div>
                  <div>
                    <label className="form-label text-xs">Status</label>
                    <select value={status} onChange={(e) => setStatus(e.target.value as QuotationStatus)}
                      className="input-enterprise bg-white cursor-pointer text-xs">
                      {QUOTATION_STATUSES.map((s) => <option key={s} value={s}>{s}</option>)}
                    </select>
                  </div>
                </div>
              </div>

              <div className="border border-slate-200 rounded-xl p-4 space-y-3">
                <div className="flex items-center justify-between border-b border-slate-200 pb-2">
                  <h3 className="text-xs font-bold uppercase tracking-wider text-slate-500">2. Item Grid</h3>
                  <button type="button" onClick={addGridRow}
                    className="btn-secondary px-3 py-1 flex items-center gap-1.5 text-xs text-teal-700 border-teal-200 hover:bg-teal-50 font-bold">
                    <Plus className="w-3.5 h-3.5" /> Add Row
                  </button>
                </div>
                <div className="overflow-x-auto">
                  <table className="w-full text-[11px] border-collapse font-sans">
                    <thead>
                      <tr className="bg-slate-100/80 text-slate-700 border-b border-slate-200 text-left font-semibold">
                        <th className="p-2 w-[150px]">Code</th>
                        <th className="p-2 w-[160px]">Item Name</th>
                        <th className="p-2 w-[50px] text-center">Qty</th>
                        <th className="p-2 w-[65px] text-center">Unit</th>
                        <th className="p-2 w-[75px] text-right">Rate (₹)</th>
                        <th className="p-2 w-[75px] text-right">Amount</th>
                        <th className="p-2 w-[50px] text-center">Dis%</th>
                        <th className="p-2 w-[45px] text-center">SGST</th>
                        <th className="p-2 w-[45px] text-center">CGST</th>
                        <th className="p-2 w-[60px] text-center">HSN</th>
                        <th className="p-2 w-[65px] text-right text-slate-400">Cost</th>
                        <th className="p-2 w-[30px]"></th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-100">
                      {gridItems.map((item, idx) => (
                        <tr key={idx} className="hover:bg-slate-50/50">
                          <td className="p-1.5">
                            <SearchableProductSelect items={inventory} value={item.code}
                              onChange={(prod) => handleProductSelect(idx, prod)} placeholder="Search..." />
                          </td>
                          <td className="p-1.5">
                            <input type="text" value={item.name}
                              onChange={(e) => updateGridRow(idx, "name", sanitizeItemName(e.target.value))}
                              className="w-full border border-slate-300 rounded p-1 text-xs" required maxLength={200} />
                          </td>
                          <td className="p-1.5">
                            <input type="text" inputMode="decimal" value={item.qty === 0 ? "" : item.qty}
                              onChange={(e) => updateGridRow(idx, "qty", parseOptionalDecimal(e.target.value, 99999, 2))}
                              className="w-full text-center border border-slate-300 rounded p-1 text-xs font-mono" required />
                          </td>
                          <td className="p-1.5">
                            <select value={item.unit} onChange={(e) => updateGridRow(idx, "unit", e.target.value)}
                              className="w-full text-center border border-slate-300 rounded p-1 text-xs bg-white">
                              {UNITS.map((u) => <option key={u} value={u}>{u}</option>)}
                            </select>
                          </td>
                          <td className="p-1.5">
                            <input type="text" inputMode="decimal" value={item.rate === 0 ? "" : item.rate}
                              onChange={(e) => updateGridRow(idx, "rate", parseOptionalDecimal(e.target.value, 9999999, 2))}
                              className="w-full text-right border border-teal-400 rounded p-1 text-xs font-mono font-semibold" required />
                          </td>
                          <td className="p-1.5">
                            <input readOnly value={item.amount.toFixed(2)} tabIndex={-1}
                              className="w-full text-right border border-slate-200 rounded p-1 text-xs font-mono bg-slate-50 text-slate-600" />
                          </td>
                          <td className="p-1.5">
                            <input type="text" inputMode="decimal" value={item.disc_pct === 0 ? "" : item.disc_pct}
                              onChange={(e) => updateGridRow(idx, "disc_pct", parseOptionalDecimal(e.target.value, 100, 2))}
                              className="w-full text-center border border-slate-300 rounded p-1 text-xs font-mono" />
                          </td>
                          <td className="p-1.5">
                            <input type="text" inputMode="decimal" value={item.sgst === 0 ? "" : item.sgst}
                              onChange={(e) => updateGridRow(idx, "sgst", parseOptionalDecimal(e.target.value, 100, 2))}
                              className="w-full text-center border border-slate-300 rounded p-1 text-xs font-mono" />
                          </td>
                          <td className="p-1.5">
                            <input type="text" inputMode="decimal" value={item.cgst === 0 ? "" : item.cgst}
                              onChange={(e) => updateGridRow(idx, "cgst", parseOptionalDecimal(e.target.value, 100, 2))}
                              className="w-full text-center border border-slate-300 rounded p-1 text-xs font-mono" />
                          </td>
                          <td className="p-1.5">
                            <input type="text" value={item.hsn_code}
                              onChange={(e) => updateGridRow(idx, "hsn_code", sanitizeHsn(e.target.value))}
                              className="w-full text-center border border-slate-300 rounded p-1 text-xs font-mono"
                              maxLength={8} inputMode="numeric" />
                          </td>
                          <td className="p-1.5">
                            <input type="text" inputMode="decimal" value={item.cost === 0 ? "" : item.cost}
                              onChange={(e) => updateGridRow(idx, "cost", parseOptionalDecimal(e.target.value, 9999999, 2))}
                              className="w-full text-right border border-slate-200 rounded p-1 text-xs font-mono text-slate-500" />
                          </td>
                          <td className="p-1.5 text-center">
                            <button type="button" onClick={() => removeGridRow(idx)} title="Remove row"
                              className="text-red-400 hover:text-red-600 p-1 rounded hover:bg-red-50">
                              <Trash2 className="w-3.5 h-3.5" />
                            </button>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>

              <div className="bg-slate-50 border border-slate-200 rounded-xl p-4 space-y-4">
                <h3 className="text-xs font-bold uppercase tracking-wider text-slate-500 border-b border-slate-200 pb-1.5">3. Totals &amp; Remarks</h3>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  <div>
                    <label className="form-label text-xs">Remarks</label>
                    <textarea value={remarks} onChange={(e) => setRemarks(sanitizeRemarks(e.target.value))} rows={4}
                      placeholder="Notes, delivery terms, etc." className="input-enterprise text-xs resize-none"
                      maxLength={500} />
                  </div>
                  <div className="space-y-2 text-xs">
                    <div className="flex justify-between border-b border-slate-200 pb-1.5">
                      <span className="text-slate-500">Total Cost (internal)</span>
                      <span className="font-mono font-semibold text-slate-600">{formatCurrency(calc.totalCost)}</span>
                    </div>
                    <div className="flex justify-between border-b border-slate-200 pb-1.5">
                      <span className="text-slate-600 font-semibold">Sub Total</span>
                      <span className="font-mono font-semibold">{formatCurrency(calc.subtotal)}</span>
                    </div>
                    <div className="flex justify-between border-b border-slate-200 pb-1.5">
                      <span className="text-slate-600">GST</span>
                      <span className="font-mono text-amber-600">+{formatCurrency(calc.totalGst)}</span>
                    </div>
                    <div className="flex justify-between items-center border-b border-slate-200 pb-1.5">
                      <span className="text-slate-600">F. Cess</span>
                      <input type="text" inputMode="decimal" value={fCess}
                        onChange={(e) => setFCess(sanitizeDecimalString(e.target.value, 2))}
                        className="w-28 text-right border border-slate-300 rounded p-1 text-xs font-mono" placeholder="0.00" />
                    </div>
                    <div className="flex justify-between text-slate-400 italic">
                      <span>Round Off</span>
                      <span className="font-mono">{calc.roundOff >= 0 ? "+" : ""}{formatCurrency(calc.roundOff)}</span>
                    </div>
                    <div className="flex justify-between text-sm font-bold text-slate-900 border-t border-slate-300 pt-2">
                      <span>Net Amount</span>
                      <span className="font-mono text-teal-700">{formatCurrency(calc.netAmount)}</span>
                    </div>
                  </div>
                </div>
              </div>

              <div className="flex items-center justify-end gap-3 pt-2 border-t border-slate-200">
                <button type="button" onClick={closeFormModal} className="btn-secondary px-5">Cancel</button>
                <button type="submit" className="btn-primary bg-teal-600 hover:bg-teal-700 active:bg-teal-800 px-6 shadow-sm">
                  {editingQuotation ? "Save & Update Quotation" : "Save Quotation"}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {viewingQuotation && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/40 backdrop-blur-[2px]">
          <div className="absolute inset-0" onClick={() => setViewingQuotation(null)} />
          <div className="bg-white border border-slate-200 rounded-xl shadow-2xl relative max-w-4xl w-full z-10 flex flex-col font-sans max-h-[90vh] overflow-y-auto animate-in fade-in zoom-in-95 duration-150">
            <div className="bg-teal-800 px-6 py-4 text-white rounded-t-xl flex items-center justify-between sticky top-0 shadow-md">
              <div>
                <h2 className="text-sm font-bold tracking-tight">Quotation Details</h2>
                <p className="text-[10px] text-teal-100 mt-0.5">{viewingQuotation.quotation_no} · Serial: {viewingQuotation.serial_no}</p>
              </div>
              <button type="button" onClick={() => setViewingQuotation(null)} className="text-teal-100 hover:text-white p-1.5 rounded-lg hover:bg-white/10 transition-colors" aria-label="Close">
                <X className="w-4 h-4" />
              </button>
            </div>
            <div className="p-6 space-y-6">
              <div className="grid grid-cols-2 md:grid-cols-4 gap-x-6 gap-y-3 text-xs bg-slate-50 border border-slate-100 p-4 rounded-xl">
                {[
                  ["Quotation No.", viewingQuotation.quotation_no],
                  ["Serial", viewingQuotation.serial_no],
                  ["Date", viewingQuotation.quotation_date],
                  ["Valid Till", viewingQuotation.valid_till],
                  ["Ref No.", viewingQuotation.ref_no || "—"],
                  ["Rate Type", viewingQuotation.rate_type],
                  ["Customer", viewingQuotation.customer_name],
                  ["Phone", viewingQuotation.customer_phone || "—"],
                  ["Address", viewingQuotation.customer_address || "—"],
                  ["GSTIN", viewingQuotation.customer_gstin || "—"],
                  ["Status", viewingQuotation.status],
                ].map(([label, val]) => (
                  <div key={label}>
                    <span className="text-[10px] font-bold text-slate-400 uppercase tracking-wider block">{label}</span>
                    <span className="font-semibold text-slate-800">{val}</span>
                  </div>
                ))}
              </div>
              <div>
                <h4 className="text-xs font-bold text-slate-800 uppercase tracking-wider mb-2">Items</h4>
                <div className="border border-slate-200 rounded-xl overflow-hidden overflow-x-auto">
                  <table className="w-full text-xs text-left border-collapse min-w-[700px]">
                    <thead>
                      <tr className="bg-slate-100 border-b border-slate-200 font-semibold text-slate-700">
                        <th className="p-2">Code</th><th className="p-2">Name</th><th className="p-2 text-center">Qty</th>
                        <th className="p-2 text-center">Unit</th><th className="p-2 text-right">Rate</th><th className="p-2 text-right">Amount</th>
                        <th className="p-2 text-center">Dis%</th><th className="p-2 text-right">Line Total</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-100">
                      {viewingQuotation.items.map((item, i) => (
                        <tr key={i} className="hover:bg-slate-50/30">
                          <td className="p-2 font-mono font-semibold">{item.code || "—"}</td>
                          <td className="p-2">{item.name}</td>
                          <td className="p-2 text-center font-mono">{item.qty}</td>
                          <td className="p-2 text-center">{item.unit}</td>
                          <td className="p-2 text-right font-mono">{formatCurrency(item.rate)}</td>
                          <td className="p-2 text-right font-mono">{formatCurrency(item.amount)}</td>
                          <td className="p-2 text-center text-red-500">{item.disc_pct}%</td>
                          <td className="p-2 text-right font-mono font-semibold">{formatCurrency(item.line_total)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
              <div className="flex justify-end">
                <div className="w-72 space-y-1.5 text-xs text-slate-600 border-t border-slate-200 pt-3">
                  <div className="flex justify-between"><span>Total Cost:</span><span className="font-mono text-slate-500">{formatCurrency(viewingQuotation.total_cost)}</span></div>
                  <div className="flex justify-between font-semibold"><span>Sub Total:</span><span className="font-mono">{formatCurrency(viewingQuotation.subtotal)}</span></div>
                  <div className="flex justify-between text-amber-600"><span>GST / Cess:</span><span className="font-mono">+{formatCurrency(viewingQuotation.total_gst + viewingQuotation.f_cess)}</span></div>
                  <div className="flex justify-between text-slate-400 italic"><span>Round Off:</span><span className="font-mono">{viewingQuotation.round_off >= 0 ? "+" : ""}{formatCurrency(viewingQuotation.round_off)}</span></div>
                  <div className="flex justify-between text-sm font-bold border-t border-slate-200 pt-2"><span>Net Amount:</span><span className="font-mono text-teal-700">{formatCurrency(viewingQuotation.net_amount)}</span></div>
                </div>
              </div>
              {viewingQuotation.remarks && (
                <div className="text-xs bg-amber-50 border border-amber-100 rounded-lg p-3">
                  <span className="font-bold text-amber-800">Remarks: </span>{viewingQuotation.remarks}
                </div>
              )}
            </div>
            <div className="flex items-center justify-end gap-3 border-t border-slate-200 bg-slate-50 p-4 rounded-b-xl sticky bottom-0">
              <button type="button" onClick={() => handlePrintQuotation(viewingQuotation)}
                className="btn-secondary px-4 py-2 font-semibold text-xs border border-slate-300 text-slate-700 hover:bg-slate-100 rounded flex items-center gap-1.5">
                <Printer className="w-3.5 h-3.5" /> Print
              </button>
              <button type="button" onClick={() => handleDownloadQuotation(viewingQuotation)}
                className="btn-secondary px-4 py-2 font-semibold text-xs border border-teal-300 text-teal-700 hover:bg-teal-50 rounded flex items-center gap-1.5">
                <Download className="w-3.5 h-3.5" /> Download PDF
              </button>
              <button type="button" onClick={() => setViewingQuotation(null)}
                className="btn-primary bg-teal-600 hover:bg-teal-700 px-6 py-2 font-bold text-white rounded text-xs">
                Close
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
