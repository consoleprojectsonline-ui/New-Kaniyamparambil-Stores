import { useState, useEffect, useCallback, useMemo, useRef } from "react";
import {
  Receipt, Plus, Search, Filter, Trash2, AlertTriangle, Check,
  Database, Calendar, Eye, Download, Printer, X, Edit, User, Truck, FileText,
  ArrowUp, ArrowDown, ArrowUpDown,
} from "lucide-react";
import html2canvas from "html2canvas";
import { jsPDF } from "jspdf";
import { supabase } from "@/lib/supabase";
import { formatCurrency, formatTableDate } from "@/lib/utils";
import upiQrUrl from "@/assets/upi-qr.png";

// ─── Types ────────────────────────────────────────────────────────────────────

export interface SaleItem {
  code: string;
  name: string;
  hsn_code: string;
  qty: number;
  unit: string;
  rate: number;         // purchase/cost rate (reference only, pre-filled, read-only)
  amount: number;       // qty × mrp (auto — selling value before disc/GST)
  disc_pct: number;     // discount % on MRP
  mrp: number;          // selling price per unit (customer pays this)
  sgst: number;         // SGST %
  cgst: number;         // CGST %
  line_total: number;   // (qty×mrp − disc) + SGST amount + CGST amount (auto)
}

export interface SaleRecord {
  bill_no: string;
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

// ─── Constants ────────────────────────────────────────────────────────────────

const FORM_TYPES = ["Tax Invoice", "Retail Invoice", "Estimate", "Delivery Note", "Credit Note"];

const RATE_TP_OPTIONS = [
  { value: "Retail",      label: "Retail (MRP)" },
  { value: "Wholesale",   label: "Wholesale (TP)" },
  { value: "GST_5",       label: "GST @ 5%" },
  { value: "GST_12",      label: "GST @ 12%" },
  { value: "GST_18",      label: "GST @ 18%" },
  { value: "GST_28",      label: "GST @ 28%" },
  { value: "Exempt",      label: "GST Exempt (0%)" },
];

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

const TRAVEL_EXPENSE_LABEL = "Travel Expense";

const BRANCHES_GODOWNS = [
  "Shop (Main Showroom)",
  "Central Godown A",
  "Warehouse Godown B",
  "Transit / On-Field Stock",
];

const UNITS = [
  "Nos", "Mtr", "Kg", "Ltr", "Box", "Pcs", "Set",
  "Pair", "Roll", "Bag", "Bundle", "Dozen", "Sqft", "Sqm", "Ton",
];

const PAYMENT_MODES = ["Cash", "UPI", "Card", "Bank Transfer", "Credit"];

const SEED_CUSTOMERS = [
  "Joy Alukkas Contractor", "Anish K. Nair", "Rajan Electricals",
  "Suresh Hardware", "Krishna Plumbers",
];

const SEED_SALESMEN = ["Manager", "Sunil", "Reena", "Ajith", "Priya"];

// Manual invoice branding/details live here so they can be changed without touching the template.
const INVOICE_STATIC_DETAILS = {
  storeNameLines: ["NEW", "KANIYAMPARAMBIL", "STORES"],
  phone: "9544363171",
  email: "newkaniyamparambilstorestkdy@gmail.com",
  gstin: "32AWJPJ1371N1ZE",
  pan: "AWJPJ1371N",
  badge: "Original for Recipient",
  location: "THOPRAMKUDY PO, THOPRAMKUDY, KERALA",
  customerAddress: "KERALA",
  customerGstin: "—",
  customerState: "Kerala",
  customerCode: "32",
  transportation: "Road",
  vehicleNo: "—",
  bankName: "bank details",
  accountNo: "13330100068606",
  ifsc: "FDRL0001333",
  branch: "Thopramkudy Branch",
  terms: "Certified that the particulars given above are true and correct.",
  signatureScript: "jins joseph",
  signatureRole: "Authorized Signatory",
  signatureCompany: "FOR NEW KANIYAMPARAMBIL STORES",
} as const;

type InvoiceWindowOptions = {
  autoPrint?: boolean;
  helperText?: string;
  renderMode?: "print" | "pdf";
};

const INVOICE_FRAME_STYLE: Partial<CSSStyleDeclaration> = {
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

function resolveAssetUrl(relativeUrl: string): string {
  if (typeof window === "undefined") return relativeUrl;
  try {
    return new URL(relativeUrl, window.location.origin).href;
  } catch {
    return relativeUrl;
  }
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function formatInvoiceDate(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return escapeHtml(value || "—");
  return new Intl.DateTimeFormat("en-GB", {
    day: "2-digit",
    month: "short",
    year: "numeric",
  }).format(date).replace(/ /g, "-");
}

function formatInvoiceTime(value?: string): string {
  const date = value ? new Date(value) : new Date();
  const validDate = Number.isNaN(date.getTime()) ? new Date() : date;
  return new Intl.DateTimeFormat("en-IN", {
    hour: "numeric",
    minute: "2-digit",
    hour12: true,
  }).format(validDate);
}

function toWordsBelowThousand(num: number): string {
  const ones = ["", "One", "Two", "Three", "Four", "Five", "Six", "Seven", "Eight", "Nine"];
  const teens = ["Ten", "Eleven", "Twelve", "Thirteen", "Fourteen", "Fifteen", "Sixteen", "Seventeen", "Eighteen", "Nineteen"];
  const tens = ["", "", "Twenty", "Thirty", "Forty", "Fifty", "Sixty", "Seventy", "Eighty", "Ninety"];

  let n = Math.floor(num);
  const parts: string[] = [];

  if (n >= 100) {
    parts.push(`${ones[Math.floor(n / 100)]} Hundred`);
    n %= 100;
  }
  if (n >= 20) {
    parts.push(tens[Math.floor(n / 10)]);
    n %= 10;
  } else if (n >= 10) {
    parts.push(teens[n - 10]);
    n = 0;
  }
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
      const unitCount = Math.floor(remaining / unitValue);
      words.push(`${toWordsBelowThousand(unitCount)} ${label}`);
      remaining %= unitValue;
    }
  });

  if (remaining > 0) words.push(toWordsBelowThousand(remaining));

  return `Rupees ${words.join(" ").replace(/\s+/g, " ").trim()} Only`;
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
  const total = taxableValue + cgstAmount + sgstAmount;

  return {
    quantity,
    rate,
    amount,
    discountPercent,
    discountAmount,
    taxableValue,
    cgstRate,
    sgstRate,
    cgstAmount,
    sgstAmount,
    total,
  };
}

function buildInvoiceHtml(rec: SaleRecord, options: InvoiceWindowOptions = {}): string {
  const store = INVOICE_STATIC_DETAILS;
  const isPdfMode = options.renderMode === "pdf";
  const createdOn = rec.created_at ?? rec.bill_date;
  const invoiceTitle = rec.form_type.toUpperCase();
  const companyName = store.storeNameLines.join(" ");
  const billedAddress = rec.ship_to || store.customerAddress;
  const shippedAddress = rec.ship_to || billedAddress;
  const customerGstin = store.customerGstin.includes("â") ? "-" : store.customerGstin;
  const vehicleNo = rec.vehicle_no?.trim()
    || (store.vehicleNo.includes("â") ? "-" : store.vehicleNo);
  const placeOfSupply = `${store.customerCode}-${store.customerState.toUpperCase()}`;
  const lineSummaries = rec.items.map(getSaleItemSummary);
  const totalQuantity = lineSummaries.reduce((sum, item) => sum + item.quantity, 0);
  const totalAmount = lineSummaries.reduce((sum, item) => sum + item.amount, 0);
  const totalLineDiscount = lineSummaries.reduce((sum, item) => sum + item.discountAmount, 0);
  const totalTaxable = lineSummaries.reduce((sum, item) => sum + item.taxableValue, 0);
  const totalCgst = lineSummaries.reduce((sum, item) => sum + item.cgstAmount, 0);
  const totalSgst = lineSummaries.reduce((sum, item) => sum + item.sgstAmount, 0);
  const cgstRate = totalTaxable > 0 ? (totalCgst / totalTaxable) * 100 : 0;
  const sgstRate = totalTaxable > 0 ? (totalSgst / totalTaxable) * 100 : 0;
  const amountInWords = numberToWordsIndian(rec.grand_total).replace(/^Rupees /, "INR ");

  const rowMarkup = rec.items.map((item, index) => {
    const summary = lineSummaries[index];
    const itemExtras = isPdfMode
      ? [
          item.code ? `Code: ${escapeHtml(item.code)}` : "",
          summary.discountPercent > 0
            ? `Disc: ${summary.discountPercent.toFixed(0)}%`
            : "",
        ].filter(Boolean).join(" | ")
      : [
          item.code ? `Code: ${escapeHtml(item.code)}` : "",
          summary.discountPercent > 0
            ? `Disc: ${summary.discountPercent.toFixed(0)}% (${formatCurrency(summary.discountAmount)})`
            : "",
          `CGST ${summary.cgstRate.toFixed(1)}%: ${formatCurrency(summary.cgstAmount)}`,
          `SGST ${summary.sgstRate.toFixed(1)}%: ${formatCurrency(summary.sgstAmount)}`,
          `Line Total: ${formatCurrency(summary.total)}`,
        ].filter(Boolean).join(" | ");

    return `<tr>
      <td class="col-index">${index + 1}</td>
      <td class="col-item">
        <strong>${escapeHtml(item.name || "Unnamed Item")}</strong>
        ${itemExtras ? `<span class="item-meta">${itemExtras}</span>` : ""}
      </td>
      <td class="col-hsn">${escapeHtml(item.hsn_code || "—")}</td>
      <td class="col-rate align-right">${formatCurrency(summary.rate)}</td>
      <td class="col-qty align-center">${summary.quantity.toFixed(2)} ${escapeHtml(item.unit || "Nos")}</td>
      <td class="col-taxable align-right">${formatCurrency(summary.taxableValue)}</td>
    </tr>`;
  }).join("");

  return `<!DOCTYPE html>
  <html lang="en">
    <head>
      <meta charset="UTF-8" />
      <meta name="viewport" content="width=device-width, initial-scale=1.0" />
      <title>Invoice ${escapeHtml(rec.bill_no)}</title>
      <style>
        * { box-sizing: border-box; }

        body {
          margin: 0;
          background: ${isPdfMode ? "#fff" : "#f3f4f6"};
          font-family: Arial, Helvetica, sans-serif;
          color: #111;
          font-size: ${isPdfMode ? "8.5px" : "12px"};
          line-height: ${isPdfMode ? "1.25" : "1.35"};
          padding: ${isPdfMode ? "0" : "20px"};
        }

        .invoice-toolbar {
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

        .toolbar-btn.primary { background: #1d4ed8; color: #fff; border-color: #1d4ed8; }

        .invoice-sheet {
          width: ${isPdfMode ? "794px" : "860px"};
          margin: 0 auto;
          background: #fff;
          border: 1px solid #000;
        }

        .doc-title {
          text-align: center;
          font-size: ${isPdfMode ? "13px" : "16px"};
          font-weight: 700;
          color: #1d4ed8;
          letter-spacing: 0.04em;
          padding: ${isPdfMode ? "6px 8px" : "10px"};
          border-bottom: 1px solid #000;
        }

        .layout-table {
          width: 100%;
          border-collapse: collapse;
        }

        .layout-table > tbody > tr > td,
        .layout-table > tr > td {
          border: 1px solid #000;
          vertical-align: top;
          padding: ${isPdfMode ? "3px 6px" : "8px 10px"};
        }

        .company-cell { width: 68%; }
        .meta-cell { width: 32%; padding: 0 !important; }

        .company-row {
          display: flex;
          align-items: flex-start;
          gap: ${isPdfMode ? "8px" : "12px"};
        }

        .store-logo {
          width: ${isPdfMode ? "34px" : "44px"};
          height: ${isPdfMode ? "34px" : "44px"};
          flex-shrink: 0;
        }

        .store-logo svg {
          width: 100%;
          height: 100%;
          stroke: #111;
          fill: none;
          stroke-width: 1.6;
        }

        .company-name {
          font-size: ${isPdfMode ? "11px" : "14px"};
          font-weight: 700;
          margin-bottom: 3px;
        }

        .company-line { margin-bottom: 2px; }
        .company-line b { font-weight: 700; }

        .meta-inner {
          width: 100%;
          border-collapse: collapse;
        }

        .meta-inner td {
          border-bottom: 1px solid #000;
          padding: ${isPdfMode ? "4px 7px" : "6px 10px"};
          font-size: inherit;
        }

        .meta-inner tr:last-child td { border-bottom: none; }
        .meta-inner .meta-label { font-weight: 600; white-space: nowrap; }
        .meta-inner .meta-value { font-weight: 700; text-align: right; }

        .section-label { font-weight: 700; margin-bottom: 3px; }
        .customer-name { font-weight: 700; margin-bottom: 4px; }
        .half { width: 50%; }

        .items-table {
          width: 100%;
          border-collapse: collapse;
          border-top: 1px solid #000;
        }

        .items-table th,
        .items-table td {
          border: 1px solid #000;
          padding: ${isPdfMode ? "2px 4px" : "6px 8px"};
          vertical-align: top;
        }

        .items-table thead th {
          background: #f3f4f6;
          font-weight: 700;
          text-align: center;
        }

        .col-index { width: 24px; text-align: center; }
        .col-hsn { width: 58px; text-align: center; }
        .col-rate { width: 72px; }
        .col-qty { width: 68px; }
        .col-taxable { width: 82px; }

        .col-item strong {
          display: block;
          font-weight: 700;
        }

        .item-meta {
          display: block;
          margin-top: 1px;
          color: #444;
          font-size: ${isPdfMode ? "7px" : "10px"};
          line-height: 1.2;
        }

        .align-right { text-align: right; }
        .align-center { text-align: center; }

        .totals-left {
          width: 55%;
          font-weight: 600;
          vertical-align: middle !important;
        }

        .totals-right {
          width: 45%;
          padding: 0 !important;
        }

        .summary-mini {
          width: 100%;
          border-collapse: collapse;
        }

        .summary-mini td {
          border-bottom: 1px solid #000;
          padding: ${isPdfMode ? "2px 6px" : "5px 10px"};
        }

        .summary-mini tr:last-child td { border-bottom: none; }

        .summary-mini .sum-label {
          font-weight: 600;
          text-align: left;
        }

        .summary-mini .sum-value {
          font-weight: 700;
          text-align: right;
          white-space: nowrap;
        }

        .summary-mini .total-row td {
          font-size: ${isPdfMode ? "10px" : "13px"};
          font-weight: 700;
          background: #f9fafb;
        }

        .words-row {
          border-top: 1px solid #000;
          border-bottom: 1px solid #000;
          padding: ${isPdfMode ? "3px 6px" : "8px 10px"};
          font-weight: 600;
        }

        .words-row b { font-weight: 700; }

        .upi-cell { text-align: center; vertical-align: middle; }

        .upi-qr {
          display: inline-block;
          margin-top: 2px;
          width: ${isPdfMode ? "56px" : "96px"};
          height: ${isPdfMode ? "56px" : "96px"};
          border: 1px solid #000;
          object-fit: contain;
          background: #fff;
        }

        .invoice-footer {
          page-break-inside: avoid;
        }

        .notes-block,
        .terms-block {
          min-height: ${isPdfMode ? "0" : "72px"};
        }

        .terms-block ol {
          margin: ${isPdfMode ? "2px 0 0" : "4px 0 0"};
          padding-left: ${isPdfMode ? "14px" : "16px"};
        }

        .terms-block li { margin-bottom: ${isPdfMode ? "0" : "2px"}; }

        .signatory {
          border-top: 1px solid #000;
          padding: ${isPdfMode ? "4px 6px 5px" : "12px 10px 16px"};
          text-align: right;
          font-weight: 700;
          page-break-inside: avoid;
        }

        .signatory .script {
          font-family: "Brush Script MT", "Segoe Script", cursive;
          font-size: ${isPdfMode ? "15px" : "32px"};
          font-weight: 400;
          color: #1d4ed8;
          line-height: 1;
          margin-bottom: ${isPdfMode ? "1px" : "4px"};
        }

        .signatory .role {
          font-size: ${isPdfMode ? "7.5px" : "11px"};
          font-weight: 600;
          color: #333;
        }

        .invoice-fit-wrap {
          width: ${isPdfMode ? "794px" : "860px"};
          margin: 0 auto;
          overflow: hidden;
        }

        @page { size: A4; margin: 8mm; }

        @media print {
          body { background: #fff; padding: 0; margin: 0; }
          .invoice-toolbar { display: none; }
          .invoice-fit-wrap { width: 100%; overflow: visible; }
          .invoice-sheet { width: 100%; border: none; }
        }
      </style>
    </head>
    <body>
      <div class="invoice-toolbar">
        <p class="toolbar-text">${escapeHtml(options.helperText || "Use Print / Save as PDF from your browser to export this invoice.")}</p>
        <div class="toolbar-actions">
          <button class="toolbar-btn" onclick="window.close()">Close</button>
          <button class="toolbar-btn primary" onclick="window.print()">Print / Save PDF</button>
        </div>
      </div>

      <div class="invoice-fit-wrap">
      <div class="invoice-sheet">
        <div class="doc-title">${escapeHtml(invoiceTitle)}</div>

        <table class="layout-table">
          <tr>
            <td class="company-cell">
              <div class="company-row">
                <div class="store-logo">
                  <svg viewBox="0 0 24 24" aria-hidden="true">
                    <circle cx="9" cy="20" r="1.6"></circle>
                    <circle cx="17" cy="20" r="1.6"></circle>
                    <path d="M3 4h2l2.1 10.4a1 1 0 0 0 1 .8h9.7a1 1 0 0 0 1-.8L21 7H7"></path>
                  </svg>
                </div>
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
                <tr>
                  <td class="meta-label">Invoice #</td>
                  <td class="meta-value">${escapeHtml(rec.bill_no)}</td>
                </tr>
                <tr>
                  <td class="meta-label">Place of Supply:</td>
                  <td class="meta-value">${escapeHtml(placeOfSupply)}</td>
                </tr>
                <tr>
                  <td class="meta-label">Invoice Date:</td>
                  <td class="meta-value">${formatInvoiceDate(rec.bill_date)}</td>
                </tr>
                <tr>
                  <td class="meta-label">Time of Supply:</td>
                  <td class="meta-value">${formatInvoiceTime(createdOn)}</td>
                </tr>
                <tr>
                  <td class="meta-label">Payment Mode:</td>
                  <td class="meta-value">${escapeHtml(rec.payment_mode || "Cash")}</td>
                </tr>
              </table>
            </td>
          </tr>
        </table>

        <table class="layout-table">
          <tr>
            <td class="half">
              <div class="section-label">Customer Details:</div>
              <div class="customer-name">${escapeHtml(rec.customer_name || "Walk-in Customer")}</div>
              <div class="section-label">Billing address:</div>
              <div>${escapeHtml(billedAddress)}</div>
              <div>Ph: ${escapeHtml(rec.customer_phone || "—")}</div>
              <div>GSTIN/UID: ${escapeHtml(customerGstin)}</div>
              <div>State: ${escapeHtml(store.customerState)} (${escapeHtml(store.customerCode)})</div>
            </td>
            <td class="half">
              <div class="section-label">Shipping address:</div>
              <div>${escapeHtml(shippedAddress)}</div>
              <div style="margin-top:6px">Transportation: ${escapeHtml(store.transportation)}</div>
              <div>Vehicle No: ${escapeHtml(vehicleNo)}</div>
              <div>Branch/Godown: ${escapeHtml(rec.branch_godown || "—")}</div>
              <div>Salesman: ${escapeHtml(rec.salesman || "—")}</div>
            </td>
          </tr>
        </table>

        <table class="items-table">
          <thead>
            <tr>
              <th>#</th>
              <th>Item</th>
              <th>HSN/SAC</th>
              <th>Rate/ Item</th>
              <th>Qty</th>
              <th>Taxable Value</th>
            </tr>
          </thead>
          <tbody>${rowMarkup}</tbody>
        </table>

        <table class="layout-table">
          <tr>
            <td class="totals-left">
              Total Items / Qty : ${rec.items.length} / ${totalQuantity.toFixed(2)}
            </td>
            <td class="totals-right">
              <table class="summary-mini">
                <tr>
                  <td class="sum-label">Amount</td>
                  <td class="sum-value">${formatCurrency(totalAmount)}</td>
                </tr>
                <tr>
                  <td class="sum-label">Discount</td>
                  <td class="sum-value">${formatCurrency(totalLineDiscount)}</td>
                </tr>
                <tr>
                  <td class="sum-label">Taxable Amount</td>
                  <td class="sum-value">${formatCurrency(totalTaxable)}</td>
                </tr>
                <tr>
                  <td class="sum-label">CGST ${cgstRate.toFixed(1)}%</td>
                  <td class="sum-value">${formatCurrency(totalCgst)}</td>
                </tr>
                <tr>
                  <td class="sum-label">SGST ${sgstRate.toFixed(1)}%</td>
                  <td class="sum-value">${formatCurrency(totalSgst)}</td>
                </tr>
                <tr>
                  <td class="sum-label">Sub Total</td>
                  <td class="sum-value">${formatCurrency(rec.subtotal)}</td>
                </tr>
                ${rec.f_cess > 0 ? `<tr><td class="sum-label">F.Cess</td><td class="sum-value">${formatCurrency(rec.f_cess)}</td></tr>` : ""}
                ${rec.commission > 0 ? `<tr><td class="sum-label">Commission</td><td class="sum-value">${formatCurrency(rec.commission)}</td></tr>` : ""}
                ${rec.postage > 0 ? `<tr><td class="sum-label">${TRAVEL_EXPENSE_LABEL}</td><td class="sum-value">${formatCurrency(rec.postage)}</td></tr>` : ""}
                ${rec.discount > 0 ? `<tr><td class="sum-label">Bill Discount</td><td class="sum-value">${formatCurrency(rec.discount)}</td></tr>` : ""}
                ${rec.round_off !== 0 ? `<tr><td class="sum-label">Round Off</td><td class="sum-value">${formatCurrency(rec.round_off)}</td></tr>` : ""}
                <tr class="total-row">
                  <td class="sum-label">Total</td>
                  <td class="sum-value">${formatCurrency(rec.grand_total)}</td>
                </tr>
                <tr>
                  <td class="sum-label">Paid Amount</td>
                  <td class="sum-value">${formatCurrency(rec.payment_amount)}</td>
                </tr>
                <tr>
                  <td class="sum-label">Balance</td>
                  <td class="sum-value">${formatCurrency(rec.balance)}</td>
                </tr>
              </table>
            </td>
          </tr>
        </table>

        <div class="words-row">
          Total amount (in words): <b>${escapeHtml(amountInWords)}</b>
        </div>

        <div class="invoice-footer">
        <table class="layout-table">
          <tr>
            <td class="half">
              <div class="section-label">Bank Details</div>
              <div>Bank: ${escapeHtml(store.bankName)}</div>
              <div>Account #: ${escapeHtml(store.accountNo)}</div>
              <div>IFSC: ${escapeHtml(store.ifsc)}</div>
              <div>Branch: ${escapeHtml(store.branch)}</div>
            </td>
            <td class="half upi-cell">
              <div class="section-label">Pay using UPI:</div>
              <img class="upi-qr" src="${resolveAssetUrl(upiQrUrl)}" alt="UPI QR Code" />
            </td>
          </tr>
        </table>

        <table class="layout-table">
          <tr>
            <td class="half notes-block">
              <div class="section-label">Notes:</div>
              <div>Thank you for your business.</div>
              <div>Payment Status: ${escapeHtml(rec.payment_status || "—")}</div>
              <div>Rate Type: ${escapeHtml(rec.rate_tp || "—")}</div>
            </td>
            <td class="half terms-block">
              <div class="section-label">Terms and Conditions:</div>
              <ol>
                <li>Goods once sold will not be taken back or exchanged.</li>
                <li>We are not manufacturers; warranty if any is from the brand/company.</li>
                <li>Subject to local jurisdiction.</li>
                <li>${escapeHtml(store.terms)}</li>
              </ol>
            </td>
          </tr>
        </table>

        <div class="signatory">
          <div class="script">${escapeHtml(store.signatureScript)}</div>
          <div>${escapeHtml(store.signatureCompany)}</div>
          <div class="role">${escapeHtml(store.signatureRole)}</div>
        </div>
        </div>
      </div>
      </div>

      <script>
        function fitInvoiceToSinglePage() {
          const wrap = document.querySelector(".invoice-fit-wrap");
          const sheet = document.querySelector(".invoice-sheet");
          if (!(wrap instanceof HTMLElement) || !(sheet instanceof HTMLElement)) return;

          wrap.style.transform = "none";
          wrap.style.height = "auto";

          const pageHeightPx = 1080;
          const contentHeight = sheet.offsetHeight;
          if (contentHeight <= pageHeightPx) return;

          const scale = pageHeightPx / contentHeight;
          wrap.style.transform = "scale(" + scale + ")";
          wrap.style.transformOrigin = "top center";
          wrap.style.height = Math.ceil(contentHeight * scale) + "px";
        }

        window.addEventListener("load", () => {
          fitInvoiceToSinglePage();
          ${options.autoPrint ? "setTimeout(() => window.print(), 300);" : ""}
        });
      </script>
    </body>
  </html>`;
}

async function waitForInvoiceFrame(html: string): Promise<HTMLIFrameElement> {
  const iframe = document.createElement("iframe");
  Object.assign(iframe.style, INVOICE_FRAME_STYLE);
  iframe.setAttribute("aria-hidden", "true");
  document.body.appendChild(iframe);

  const frameDocument = iframe.contentDocument;
  if (!frameDocument) {
    iframe.remove();
    throw new Error("Unable to prepare the invoice document.");
  }

  frameDocument.open();
  frameDocument.write(html);
  frameDocument.close();

  const startedAt = Date.now();
  await new Promise<void>((resolve, reject) => {
    const checkReady = () => {
      const readyState = iframe.contentDocument?.readyState;
      if (readyState === "interactive" || readyState === "complete") {
        resolve();
        return;
      }
      if (Date.now() - startedAt > 5000) {
        reject(new Error("Invoice preview took too long to load."));
        return;
      }
      window.setTimeout(checkReady, 50);
    };

    checkReady();
  });

  const fontSet = iframe.contentDocument?.fonts;
  if (fontSet?.ready) {
    try {
      await fontSet.ready;
    } catch {
      // Continue even if web fonts fail; printing/PDF should still work with fallback fonts.
    }
  }

  const images = iframe.contentDocument?.querySelectorAll("img") ?? [];
  await Promise.all(
    Array.from(images).map(
      (img) =>
        new Promise<void>((resolve) => {
          if (img.complete) {
            resolve();
            return;
          }
          img.addEventListener("load", () => resolve(), { once: true });
          img.addEventListener("error", () => resolve(), { once: true });
        }),
    ),
  );

  await new Promise((resolve) => window.setTimeout(resolve, 120));

  const frameWindow = iframe.contentWindow as (Window & { fitInvoiceToSinglePage?: () => void }) | null;
  frameWindow?.fitInvoiceToSinglePage?.();

  const fitWrap = iframe.contentDocument?.querySelector(".invoice-fit-wrap");
  if (fitWrap instanceof HTMLElement) {
    iframe.style.height = `${fitWrap.scrollHeight + 40}px`;
  } else {
    const sheet = iframe.contentDocument?.querySelector(".invoice-sheet");
    if (sheet instanceof HTMLElement) {
      iframe.style.height = `${sheet.scrollHeight + 40}px`;
    }
  }

  await new Promise((resolve) => window.setTimeout(resolve, 80));
  return iframe;
}

// ─── Sales Statement (account-style register) ────────────────────────────────

type SalesReportMode = "full" | "date" | "month" | "range" | "current";
type SalesListDateFilter = "all" | "date" | "month" | "range";
type SalesSortKey = "bill_no" | "form_type" | "customer_name" | "bill_date" | "salesman" | "grand_total" | "payment_amount" | "payment_status";
type SortDir = "asc" | "desc";

const SALES_TABLE_COLUMNS: { key: SalesSortKey | null; label: string }[] = [
  { key: "bill_no", label: "Bill No." },
  { key: "form_type", label: "Form Type" },
  { key: "customer_name", label: "Customer" },
  { key: "bill_date", label: "Date" },
  { key: "salesman", label: "Salesman" },
  { key: "grand_total", label: "Grand Total (₹)" },
  { key: "payment_amount", label: "Payment" },
  { key: "payment_status", label: "Status" },
  { key: null, label: "Actions" },
];

const SALES_FETCH_PAGE_SIZE = 1000;

async function detectSalesDbColumns(): Promise<{ hasVehicleNo: boolean }> {
  const { error } = await supabase.from("sales").select("vehicle_no").limit(1);
  return { hasVehicleNo: !error };
}

function buildSupabaseSaleRow(payload: SaleRecord, hasVehicleNo: boolean): Record<string, unknown> {
  const row: Record<string, unknown> = { ...payload };
  if (!hasVehicleNo) delete row.vehicle_no;
  return row;
}

type SalesStatementMeta = {
  reportTitle: string;
  periodLabel: string;
  reportType: string;
  statusFilter: string;
  searchQuery: string;
  generatedOn: string;
  totalBills: number;
  totalSales: number;
  totalCollected: number;
  totalOutstanding: number;
};

type SalesStatementDocOptions = {
  helperText?: string;
  renderMode?: "print" | "pdf";
};

function todayIso(): string {
  return new Date().toISOString().split("T")[0];
}

function saleBillDate(sale: SaleRecord): string | null {
  if (!sale.bill_date) return null;
  return sale.bill_date.slice(0, 10);
}

function filterSalesByDate(salesList: SaleRecord[], date: string): SaleRecord[] {
  return salesList.filter((sale) => saleBillDate(sale) === date);
}

function filterSalesByMonth(salesList: SaleRecord[], monthYm: string): SaleRecord[] {
  return salesList.filter((sale) => saleBillDate(sale)?.slice(0, 7) === monthYm);
}

function filterSalesByRange(salesList: SaleRecord[], from: string, to: string): SaleRecord[] {
  return salesList.filter((sale) => {
    const d = saleBillDate(sale);
    if (!d) return false;
    return d >= from && d <= to;
  });
}

function compareBillNo(a: string, b: string): number {
  const parse = (value: string) => {
    const match = value.match(/^BILL-(\d+)-(\d+)$/i);
    if (match) return { year: Number(match[1]), num: Number(match[2]), raw: value };
    return { year: 0, num: 0, raw: value };
  };
  const left = parse(a);
  const right = parse(b);
  if (left.year !== right.year) return left.year - right.year;
  if (left.num !== right.num) return left.num - right.num;
  return left.raw.localeCompare(right.raw, undefined, { numeric: true, sensitivity: "base" });
}

/** Next bill number after the highest existing one (numeric, BILL-YEAR-N, or trailing digits). */
function getNextBillNo(existingBillNos: string[]): string {
  const bills = existingBillNos.map((b) => b.trim()).filter(Boolean);
  if (bills.length === 0) return "0001";

  let latest = bills[0];
  for (const billNo of bills) {
    if (compareBillNo(billNo, latest) > 0) latest = billNo;
  }

  const billPattern = latest.match(/^BILL-(\d+)-(\d+)$/i);
  if (billPattern) {
    const year = Number(billPattern[1]);
    const num = Number(billPattern[2]);
    const numWidth = billPattern[2].length;
    const currentYear = new Date().getFullYear();
    if (year === currentYear) {
      return `BILL-${currentYear}-${String(num + 1).padStart(numWidth, "0")}`;
    }
    return `BILL-${currentYear}-${String(1).padStart(numWidth, "0")}`;
  }

  const trailingDigits = latest.match(/^(.*?)(\d+)$/);
  if (trailingDigits) {
    const prefix = trailingDigits[1];
    const numStr = trailingDigits[2];
    const nextNum = Number(numStr) + 1;
    return `${prefix}${String(nextNum).padStart(numStr.length, "0")}`;
  }

  return `${latest}-1`;
}

function defaultSortDir(key: SalesSortKey): SortDir {
  return key === "bill_no" || key === "bill_date" || key === "grand_total" || key === "payment_amount"
    ? "desc"
    : "asc";
}

function compareSalesRecords(a: SaleRecord, b: SaleRecord, key: SalesSortKey): number {
  switch (key) {
    case "bill_no":
      return compareBillNo(a.bill_no, b.bill_no);
    case "form_type":
      return a.form_type.localeCompare(b.form_type, undefined, { sensitivity: "base" });
    case "customer_name":
      return a.customer_name.localeCompare(b.customer_name, undefined, { sensitivity: "base" });
    case "bill_date":
      return (saleBillDate(a) ?? "").localeCompare(saleBillDate(b) ?? "");
    case "salesman":
      return (a.salesman ?? "").localeCompare(b.salesman ?? "", undefined, { sensitivity: "base" });
    case "grand_total":
      return a.grand_total - b.grand_total;
    case "payment_amount":
      return a.payment_amount - b.payment_amount;
    case "payment_status":
      return a.payment_status.localeCompare(b.payment_status, undefined, { sensitivity: "base" });
    default:
      return 0;
  }
}

function formatMonthLabel(monthYm: string): string {
  const [year, month] = monthYm.split("-");
  const d = new Date(Number(year), Number(month) - 1, 1);
  if (Number.isNaN(d.getTime())) return monthYm;
  return new Intl.DateTimeFormat("en-GB", { month: "long", year: "numeric" }).format(d);
}

function formatStatementGeneratedOn(): string {
  return formatInvoiceDate(new Date().toISOString());
}

function buildSalesStatementMeta(
  salesList: SaleRecord[],
  reportType: string,
  periodLabel: string,
  statusFilter: string,
  searchQuery: string,
): SalesStatementMeta {
  return {
    reportTitle: "SALES STATEMENT / BILLING REGISTER",
    periodLabel,
    reportType,
    statusFilter,
    searchQuery,
    generatedOn: formatStatementGeneratedOn(),
    totalBills: salesList.length,
    totalSales: sumSaleGrandTotals(salesList),
    totalCollected: salesList.reduce((sum, s) => sum + toDbNumber(s.payment_amount), 0),
    totalOutstanding: salesList.reduce((sum, s) => sum + toDbNumber(s.balance), 0),
  };
}

function buildSalesStatementHtml(
  salesList: SaleRecord[],
  meta: SalesStatementMeta,
  options: SalesStatementDocOptions = {},
): string {
  const store = INVOICE_STATIC_DETAILS;
  const isPdfMode = options.renderMode === "pdf";
  const companyName = store.storeNameLines.join(" ");

  const rowMarkup = salesList.map((sale, index) => `
    <tr>
      <td class="col-index">${index + 1}</td>
      <td class="col-date">${escapeHtml(saleBillDate(sale) ? formatInvoiceDate(saleBillDate(sale)!) : "—")}</td>
      <td class="col-bill">${escapeHtml(sale.bill_no)}</td>
      <td class="col-customer">${escapeHtml(sale.customer_name)}</td>
      <td class="col-salesman">${escapeHtml(sale.salesman || "—")}</td>
      <td class="col-type">${escapeHtml(sale.form_type)}</td>
      <td class="col-items align-center">${sale.items.length}</td>
      <td class="col-amt align-right">${escapeHtml(formatCurrency(sale.subtotal))}</td>
      <td class="col-amt align-right">${escapeHtml(formatCurrency(sale.total_gst))}</td>
      <td class="col-amt align-right">${escapeHtml(formatCurrency(sale.grand_total))}</td>
      <td class="col-amt align-right">${escapeHtml(formatCurrency(sale.payment_amount))}</td>
      <td class="col-amt align-right">${escapeHtml(formatCurrency(sale.balance))}</td>
      <td class="col-status">${escapeHtml(sale.payment_status)}</td>
    </tr>
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
        .toolbar-btn.primary { background: #16a34a; color: #fff; border-color: #16a34a; }
        .sales-statement-sheet {
          width: ${isPdfMode ? "794px" : "860px"};
          margin: 0 auto;
          background: #fff;
          border: 1px solid #000;
        }
        .doc-title {
          text-align: center;
          font-size: ${isPdfMode ? "13px" : "16px"};
          font-weight: 700;
          color: #16a34a;
          letter-spacing: 0.05em;
          padding: ${isPdfMode ? "7px 8px" : "10px"};
          border-bottom: 1px solid #000;
        }
        .period-banner {
          text-align: center;
          font-weight: 700;
          padding: ${isPdfMode ? "5px 8px" : "8px 12px"};
          border-bottom: 1px solid #000;
          background: #dcfce7;
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
          background: #dcfce7;
          font-weight: 700;
          text-align: center;
        }
        .col-index { width: 20px; text-align: center; }
        .col-date { width: 52px; text-align: center; white-space: nowrap; }
        .col-bill { width: 62px; font-family: monospace; }
        .col-customer { min-width: 80px; }
        .col-salesman { width: 48px; }
        .col-type { width: 52px; font-size: ${isPdfMode ? "7px" : "10px"}; }
        .col-items { width: 28px; }
        .col-amt { width: 52px; white-space: nowrap; }
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
          .sales-statement-sheet { width: 100%; border: none; }
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

      <div class="sales-statement-sheet">
        <div class="doc-title">${escapeHtml(meta.reportTitle)}</div>
        <div class="period-banner">Statement Period: ${escapeHtml(meta.periodLabel)}</div>

        <div class="meta-grid">
          <div>
            <div class="meta-label">${escapeHtml(companyName)}</div>
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
              <th>Bill Date</th>
              <th>Bill No</th>
              <th>Customer</th>
              <th>Salesman</th>
              <th>Form Type</th>
              <th>Items</th>
              <th>Subtotal</th>
              <th>GST</th>
              <th>Grand Total</th>
              <th>Paid</th>
              <th>Balance</th>
              <th>Status</th>
            </tr>
          </thead>
          <tbody>${rowMarkup || `<tr><td colspan="13" style="text-align:center;padding:12px;">No sales bills for this statement period.</td></tr>`}</tbody>
        </table>

        <div class="summary-grid">
          <div class="summary-box">Total Bills<b>${meta.totalBills}</b></div>
          <div class="summary-box">Total Sales<b>${escapeHtml(formatCurrency(meta.totalSales))}</b></div>
          <div class="summary-box">Total Collected<b>${escapeHtml(formatCurrency(meta.totalCollected))}</b></div>
          <div class="summary-box">Outstanding<b>${escapeHtml(formatCurrency(meta.totalOutstanding))}</b></div>
        </div>

        <div class="footer-note">
          Sales statement generated from billing records. Amounts include taxable value, GST, and bill-level adjustments per saved invoice.
        </div>

        <div class="signatory">
          <div>${escapeHtml(store.signatureCompany)}</div>
          <div>${escapeHtml(store.signatureRole)}</div>
        </div>
      </div>
    </body>
  </html>`;
}

async function waitForSalesStatementFrame(html: string): Promise<HTMLIFrameElement> {
  const iframe = document.createElement("iframe");
  Object.assign(iframe.style, INVOICE_FRAME_STYLE);
  iframe.setAttribute("aria-hidden", "true");
  document.body.appendChild(iframe);

  const frameDocument = iframe.contentDocument;
  if (!frameDocument) {
    iframe.remove();
    throw new Error("Unable to prepare the sales statement document.");
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
        reject(new Error("Sales statement preview took too long to load."));
        return;
      }
      window.setTimeout(checkReady, 50);
    };
    checkReady();
  });

  const sheet = iframe.contentDocument?.querySelector(".sales-statement-sheet");
  if (sheet instanceof HTMLElement) {
    iframe.style.height = `${sheet.scrollHeight + 40}px`;
  }

  await new Promise((resolve) => window.setTimeout(resolve, 120));
  return iframe;
}

async function exportSalesStatementPdf(html: string, filename: string): Promise<void> {
  let iframe: HTMLIFrameElement | null = null;
  try {
    iframe = await waitForSalesStatementFrame(html);
    const sheet = iframe.contentDocument?.querySelector(".sales-statement-sheet");
    if (!(sheet instanceof HTMLElement)) {
      throw new Error("Unable to prepare the sales statement layout for PDF export.");
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

async function printSalesStatementHtml(html: string): Promise<void> {
  let iframe: HTMLIFrameElement | null = null;
  try {
    iframe = await waitForSalesStatementFrame(html);
    const printWindow = iframe.contentWindow;
    if (!printWindow) throw new Error("Unable to open the print dialog.");
    printWindow.focus();
    printWindow.print();
  } finally {
    window.setTimeout(() => iframe?.remove(), 1200);
  }
}

function toDbNumber(value: unknown): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

/** Sum of `grand_total` exactly as stored on each sales row (Supabase source of truth). */
function readSaleGrandTotal(sale: SaleRecord): number {
  return toDbNumber(sale.grand_total);
}

function sumSaleGrandTotals(salesList: SaleRecord[]): number {
  const total = salesList.reduce((sum, sale) => sum + readSaleGrandTotal(sale), 0);
  return Math.round(total * 100) / 100;
}

function normalizeSaleItem(raw: Record<string, unknown>): SaleItem {
  const gstPercent = toDbNumber(raw.gst_percent);
  const hasSplitGst = raw.sgst != null || raw.cgst != null;
  const sgst = hasSplitGst ? toDbNumber(raw.sgst) : (gstPercent > 0 ? gstPercent / 2 : 0);
  const cgst = hasSplitGst ? toDbNumber(raw.cgst) : (gstPercent > 0 ? gstPercent / 2 : 0);

  return {
    code: String(raw.code ?? ""),
    name: String(raw.name ?? ""),
    hsn_code: String(raw.hsn_code ?? ""),
    qty: toDbNumber(raw.qty) || 1,
    unit: String(raw.unit ?? "Nos"),
    rate: toDbNumber(raw.rate),
    amount: toDbNumber(raw.amount),
    disc_pct: toDbNumber(raw.disc_pct),
    mrp: toDbNumber(raw.mrp),
    sgst,
    cgst,
    line_total: toDbNumber(raw.line_total),
  };
}

function blankItem(): SaleItem {
  return { code: "", name: "", hsn_code: "", qty: 1, unit: "Nos", rate: 0,
    amount: 0, disc_pct: 0, mrp: 0, sgst: 9, cgst: 9, line_total: 0 };
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

function formatSaleGridValue(value: number | undefined): string | number {
  if (value === undefined || value === null || Number.isNaN(value)) return "";
  return value;
}

function purchaseLineFromRaw(it: Record<string, unknown>): PurchaseLineLookup | null {
  const code = normalizeItemCode(it.code);
  if (!code) return null;

  const qty = Number(it.qty ?? 0);
  const rate = Number(it.rate ?? 0);
  const amount = Number(it.amount ?? 0);
  const purchase_rate = rate > 0
    ? rate
    : (qty > 0 && amount > 0 ? amount / qty : 0);

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

function buildSalesItemPriceMap(salesList: SaleRecord[]): Map<string, number> {
  const map = new Map<string, number>();
  for (const sale of salesList) {
    for (const item of sale.items) {
      const code = normalizeItemCode(item.code);
      if (!code || map.has(code)) continue;
      const mrp = Number(item.mrp) || Number(item.rate) || 0;
      if (mrp > 0) map.set(code, mrp);
    }
  }
  return map;
}

function resolveSellingUnitPrice(purchaseData?: PurchaseLineLookup, salesMrp?: number): number {
  if (purchaseData) {
    if (purchaseData.s_rate > 0) return purchaseData.s_rate;
    if (purchaseData.mrp > 0) return purchaseData.mrp;
    if (purchaseData.purchase_rate > 0) return purchaseData.purchase_rate;
  }
  if (salesMrp && salesMrp > 0) return salesMrp;
  return 0;
}

function normalizeSale(raw: Record<string, unknown>): SaleRecord {
  let items: SaleItem[] = [];
  if (Array.isArray(raw.items) && raw.items.length > 0) {
    items = (raw.items as Record<string, unknown>[]).map(normalizeSaleItem);
  }
  const grandTotal = toDbNumber(raw.grand_total ?? raw.total_amount);
  return {
    bill_no: String(raw.bill_no ?? raw.invoice_no ?? ""),
    form_type: String(raw.form_type ?? "Tax Invoice"),
    bill_date: String(raw.bill_date ?? raw.invoice_date ?? ""),
    customer_name: String(raw.customer_name ?? ""),
    customer_phone: raw.customer_phone ? String(raw.customer_phone) : "",
    ship_to: raw.ship_to ? String(raw.ship_to) : "",
    salesman: raw.salesman ? String(raw.salesman) : "",
    vehicle_no: raw.vehicle_no ? String(raw.vehicle_no) : undefined,
    branch_godown: String(raw.branch_godown ?? "Shop (Main Showroom)"),
    rate_tp: String(raw.rate_tp ?? "Retail"),
    items,
    subtotal: toDbNumber(raw.subtotal),
    f_cess: toDbNumber(raw.f_cess),
    discount: toDbNumber(raw.discount),
    total_gst: toDbNumber(raw.total_gst ?? raw.tax_amount),
    commission: toDbNumber(raw.commission),
    postage: toDbNumber(raw.postage),
    round_off: toDbNumber(raw.round_off),
    grand_total: grandTotal,
    payment_amount: toDbNumber(raw.payment_amount ?? grandTotal),
    payment_mode: String(raw.payment_mode ?? "Cash"),
    balance: toDbNumber(raw.balance),
    payment_status: String(raw.payment_status ?? "Paid"),
    created_at: raw.created_at ? String(raw.created_at) : undefined,
  };
}

// ─── Searchable Product Select (same portal pattern as PurchasePage) ──────────

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
        className="w-full flex items-center justify-between bg-white text-xs border border-slate-300 rounded py-1.5 px-2.5 focus:outline-none focus:ring-2 focus:ring-green-500/10 focus:border-green-600 transition-all text-slate-800 font-medium">
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
                className="w-full text-xs border border-slate-300 rounded px-2 py-1.5 focus:outline-none focus:ring-1 focus:ring-green-600 focus:border-green-600" />
            </div>
            <ul className="overflow-y-auto py-1 flex-1">
              {filtered.length === 0
                ? <li className="px-3 py-2 text-xs text-slate-500 text-center">No products found</li>
                : filtered.map((item) => (
                  <li key={item.code} onClick={() => { onChange(item); setIsOpen(false); setSearch(""); }}
                    className={`px-3 py-2 text-xs cursor-pointer hover:bg-green-50 hover:text-green-700 transition-colors border-b border-slate-50 last:border-0 ${item.code === value ? "bg-green-100/50 text-green-700 font-semibold" : "text-slate-700"}`}>
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

function SearchableCustomerSelect({
  customers,
  value,
  onChange,
  onAddNew,
  placeholder = "Search customer...",
}: {
  customers: string[];
  value: string;
  onChange: (name: string) => void;
  onAddNew: () => void;
  placeholder?: string;
}) {
  const [isOpen, setIsOpen] = useState(false);
  const [search, setSearch] = useState("");
  const [dropStyle, setDropStyle] = useState<{ top: number; left: number; width: number } | null>(null);
  const btnRef = useRef<HTMLButtonElement>(null);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    const list = q
      ? customers.filter((name) => name.toLowerCase().includes(q))
      : customers;
    return [...list].sort((a, b) => a.localeCompare(b, undefined, { sensitivity: "base" }));
  }, [customers, search]);

  const openDrop = () => {
    if (btnRef.current) {
      const r = btnRef.current.getBoundingClientRect();
      const dropH = Math.min(280, filtered.length * 36 + 96);
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
        const dropH = Math.min(280, filtered.length * 36 + 96);
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
      <button
        ref={btnRef}
        type="button"
        onClick={() => isOpen ? setIsOpen(false) : openDrop()}
        className="input-enterprise w-full flex items-center justify-between bg-white cursor-pointer text-xs text-left"
      >
        <span className={`truncate ${value ? "text-slate-800 font-medium" : "text-slate-400"}`}>
          {value || placeholder}
        </span>
        <span className="ml-1 text-slate-400 text-[9px] shrink-0">{isOpen ? "▲" : "▼"}</span>
      </button>
      {isOpen && dropStyle && (
        <>
          <div className="fixed inset-0 z-[60]" onClick={() => { setIsOpen(false); setSearch(""); }} />
          <div
            className="fixed z-[70] bg-white border border-slate-200 rounded-lg shadow-2xl overflow-hidden"
            style={{ top: dropStyle.top, left: dropStyle.left, width: dropStyle.width, maxHeight: "280px", display: "flex", flexDirection: "column" }}
          >
            <div className="p-2 border-b border-slate-100 bg-white flex-shrink-0">
              <input
                autoFocus
                type="text"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Type to search customer..."
                onClick={(e) => e.stopPropagation()}
                className="w-full text-xs border border-slate-300 rounded px-2 py-1.5 focus:outline-none focus:ring-1 focus:ring-green-600 focus:border-green-600"
              />
            </div>
            <ul className="overflow-y-auto py-1 flex-1">
              {filtered.length === 0 ? (
                <li className="px-3 py-2 text-xs text-slate-500 text-center">No customers found</li>
              ) : (
                filtered.map((name) => (
                  <li
                    key={name}
                    onClick={() => { onChange(name); setIsOpen(false); setSearch(""); }}
                    className={`px-3 py-2 text-xs cursor-pointer hover:bg-green-50 hover:text-green-700 transition-colors border-b border-slate-50 last:border-0 ${
                      name === value ? "bg-green-100/50 text-green-700 font-semibold" : "text-slate-700"
                    }`}
                  >
                    {name}
                  </li>
                ))
              )}
            </ul>
            <div className="p-2 border-t border-slate-100 bg-slate-50 flex-shrink-0">
              <button
                type="button"
                onClick={() => { onAddNew(); setIsOpen(false); setSearch(""); }}
                className="w-full text-left text-xs font-bold text-green-700 hover:bg-green-50 px-2 py-1.5 rounded transition-colors"
              >
                + Add New Customer
              </button>
            </div>
          </div>
        </>
      )}
    </div>
  );
}

// ─── Main Page Component ──────────────────────────────────────────────────────

export default function SalesPage() {
  const [sales, setSales] = useState<SaleRecord[]>([]);
  const [inventory, setInventory] = useState<InventoryItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [isFormOpen, setIsFormOpen] = useState(false);
  const [dbStatus, setDbStatus] = useState<"connected" | "local">("connected");
  const [fetchError, setFetchError] = useState<string | null>(null);
  const salesDbColumnsRef = useRef({ hasVehicleNo: false });
  const [editingSale, setEditingSale] = useState<SaleRecord | null>(null);
  const [viewingSale, setViewingSale] = useState<SaleRecord | null>(null);
  const [isReportModalOpen, setIsReportModalOpen] = useState(false);
  const [reportMode, setReportMode] = useState<SalesReportMode>("full");
  const [reportDate, setReportDate] = useState(todayIso);
  const [reportMonth, setReportMonth] = useState(() => todayIso().slice(0, 7));
  const [reportFrom, setReportFrom] = useState(todayIso);
  const [reportTo, setReportTo] = useState(todayIso);
  const [reportError, setReportError] = useState<string | null>(null);

  // ── Purchase item lookup: code → latest PurchaseItem data ──
  // Used to pre-fill unit, purchase cost, selling price, sgst, cgst, hsn from latest purchase bill.
  const [purchaseItemMap, setPurchaseItemMap] = useState<Map<string, PurchaseLineLookup>>(new Map());

  const salesItemPriceMap = useMemo(() => buildSalesItemPriceMap(sales), [sales]);

  // Search & filter
  const [searchQuery, setSearchQuery] = useState("");
  const [statusFilter, setStatusFilter] = useState("All");
  const [dateFilterMode, setDateFilterMode] = useState<SalesListDateFilter>("all");
  const [filterDate, setFilterDate] = useState(todayIso);
  const [filterMonth, setFilterMonth] = useState(() => todayIso().slice(0, 7));
  const [filterFrom, setFilterFrom] = useState(() => `${todayIso().slice(0, 7)}-01`);
  const [filterTo, setFilterTo] = useState(todayIso);
  const [sortKey, setSortKey] = useState<SalesSortKey>("bill_no");
  const [sortDir, setSortDir] = useState<SortDir>("desc");
  const [currentPage, setCurrentPage] = useState(1);
  const itemsPerPage = 10;

  const handleSort = (key: SalesSortKey) => {
    if (sortKey === key) {
      setSortDir((dir) => (dir === "asc" ? "desc" : "asc"));
      return;
    }
    setSortKey(key);
    setSortDir(defaultSortDir(key));
  };

  useEffect(() => {
    setTimeout(() => setCurrentPage(1), 0);
  }, [searchQuery, statusFilter, dateFilterMode, filterDate, filterMonth, filterFrom, filterTo, sortKey, sortDir]);

  // ── Header form fields ──
  const [billNo, setBillNo] = useState("");
  const [formType, setFormType] = useState("Tax Invoice");
  const [billDate, setBillDate] = useState(new Date().toISOString().split("T")[0]);
  const [customerName, setCustomerName] = useState("");
  const [isCustomCustomer, setIsCustomCustomer] = useState(false);
  const [customCustomerText, setCustomCustomerText] = useState("");
  const [customerPhone, setCustomerPhone] = useState("");
  const [shipTo, setShipTo] = useState("");
  const [vehicleNo, setVehicleNo] = useState("");
  const [salesman, setSalesman] = useState("Manager");
  const [isCustomSalesman, setIsCustomSalesman] = useState(false);
  const [customSalesmanText, setCustomSalesmanText] = useState("");
  const [branchGodown, setBranchGodown] = useState("Shop (Main Showroom)");
  const [rateTp, setRateTp] = useState("Retail");

  // ── Item grid ──
  const [gridItems, setGridItems] = useState<SaleItem[]>([blankItem()]);

  // ── Financial footer fields ──
  const [fCess, setFCess] = useState("");
  const [discount, setDiscount] = useState("");
  const [commission, setCommission] = useState("");
  const [postage, setPostage] = useState("");
  const [paymentAmount, setPaymentAmount] = useState("");
  const [paymentMode, setPaymentMode] = useState("Cash");

  const [formError, setFormError] = useState<string | null>(null);
  const [successMsg, setSuccessMsg] = useState<string | null>(null);

  // Next bill number from highest existing bill (updates when sales list changes)
  useEffect(() => {
    if (!editingSale) {
      setBillNo(getNextBillNo(sales.map((s) => s.bill_no)));
    }
  }, [sales, editingSale]);

  // ── Load inventory ──
  const fetchInventory = useCallback(async () => {
    try {
      const { data, error } = await supabase.from("inventory").select("*").order("name");
      if (!error && data) { setInventory(data); return; }
    } catch { /* fall through */ }
    const local = localStorage.getItem("kaniyamparambil_inventory");
    if (local) { try { setInventory(JSON.parse(local)); } catch { setInventory([]); } }
  }, []);

  // ── Build purchase item lookup map ──
  // Scans all purchase bills, keeps the MOST RECENT values per item code.
  const fetchPurchaseItemMap = useCallback(async () => {
    const applyRows = (rows: Array<{ items: unknown[] }>) => {
      setPurchaseItemMap(buildPurchaseItemMap(rows));
    };

    try {
      const rows: Array<{ items: unknown[] }> = [];
      let from = 0;

      while (true) {
        const { data, error } = await supabase
          .from("purchases")
          .select("items, created_at")
          .order("created_at", { ascending: false })
          .range(from, from + PURCHASE_LOOKUP_PAGE_SIZE - 1);

        if (error) throw error;
        if (!data?.length) break;
        rows.push(...(data as Array<{ items: unknown[] }>));
        if (data.length < PURCHASE_LOOKUP_PAGE_SIZE) break;
        from += PURCHASE_LOOKUP_PAGE_SIZE;
      }

      applyRows(rows);
    } catch {
      const local = localStorage.getItem("kaniyamparambil_purchases");
      if (!local) return;
      try {
        const parsed = JSON.parse(local) as Array<{ items: unknown[] }>;
        applyRows(parsed);
      } catch { /* ignore */ }
    }
  }, []);

  const unitOptionsForRow = (unit: string): string[] => {
    if (!unit || UNITS.includes(unit)) return [...UNITS];
    return [unit, ...UNITS];
  };

  // ── Load sales ──
  const loadLocalSales = useCallback(() => {
    const local = localStorage.getItem("kaniyamparambil_sales_v2");
    if (local) {
      try { setSales((JSON.parse(local) as Record<string, unknown>[]).map(normalizeSale)); }
      catch { setSales([]); }
    } else { setSales([]); }
  }, []);

  const fetchSales = useCallback(async () => {
    try {
      setLoading(true);
      setFetchError(null);
      const rows: Record<string, unknown>[] = [];
      let from = 0;

      while (true) {
        const { data, error } = await supabase
          .from("sales")
          .select("*")
          .order("created_at", { ascending: false })
          .range(from, from + SALES_FETCH_PAGE_SIZE - 1);

        if (error) {
          setFetchError(error.message);
          setDbStatus("local");
          loadLocalSales();
          return;
        }

        if (!data?.length) break;
        rows.push(...(data as Record<string, unknown>[]));
        if (data.length < SALES_FETCH_PAGE_SIZE) break;
        from += SALES_FETCH_PAGE_SIZE;
      }

      const schema = await detectSalesDbColumns();
      salesDbColumnsRef.current = schema;

      const normalized = rows.map(normalizeSale);
      setSales(normalized);
      setDbStatus("connected");
      localStorage.setItem("kaniyamparambil_sales_v2", JSON.stringify(rows));
    } catch (err) {
      setFetchError(err instanceof Error ? err.message : "Failed to load sales from Supabase.");
      setDbStatus("local");
      loadLocalSales();
    } finally {
      setLoading(false);
    }
  }, [loadLocalSales]);

  useEffect(() => {
    const t = setTimeout(() => { fetchSales(); fetchInventory(); fetchPurchaseItemMap(); }, 0);
    return () => clearTimeout(t);
  }, [fetchSales, fetchInventory, fetchPurchaseItemMap]);

  useEffect(() => {
    if (isFormOpen) fetchPurchaseItemMap();
  }, [isFormOpen, fetchPurchaseItemMap]);

  // ── Grid helpers ──
  const addGridRow = () => setGridItems((prev) => [...prev, blankItem()]);
  const removeGridRow = (i: number) => { if (gridItems.length > 1) setGridItems(gridItems.filter((_, idx) => idx !== i)); };

  // ── Helper: compute auto fields for a row ──
  // amount   = qty × mrp
  // line_total = amount − (amount × disc%) + SGST + CGST
  const computeLineAutos = (item: SaleItem): Partial<SaleItem> => {
    const mrpAmt   = Number(item.qty)  * Number(item.mrp);
    const discAmt  = mrpAmt * ((Number(item.disc_pct) || 0) / 100);
    const taxable  = Math.max(0, mrpAmt - discAmt);
    const sgstAmt  = taxable * ((Number(item.sgst) || 0) / 100);
    const cgstAmt  = taxable * ((Number(item.cgst) || 0) / 100);
    return {
      amount:     Math.round(mrpAmt   * 100) / 100,
      line_total: Math.round((taxable + sgstAmt + cgstAmt) * 100) / 100,
    };
  };

  const updateGridRow = (i: number, key: keyof SaleItem, val: string | number) => {
    setGridItems((prev) => prev.map((item, idx) => {
      if (idx !== i) return item;
      const updated = { ...item, [key]: val };
      if (["qty", "mrp", "disc_pct", "sgst", "cgst"].includes(key)) {
        Object.assign(updated, computeLineAutos(updated));
      }
      return updated;
    }));
  };

  const handleProductSelect = (i: number, prod: InventoryItem) => {
    const code = normalizeItemCode(prod.code);
    const purchaseData = purchaseItemMap.get(code);
    const salesMrp = salesItemPriceMap.get(code);
    const unitVal = purchaseData?.unit || prod.uom || "Nos";
    const costRate = purchaseData?.purchase_rate ?? 0;
    const sellingUnitPrice = resolveSellingUnitPrice(purchaseData, salesMrp);

    setGridItems((prev) => prev.map((item, idx) => {
      if (idx !== i) return item;
      const updated: SaleItem = {
        ...item,
        code: prod.code,
        name: prod.name,
        hsn_code: purchaseData?.hsn_code || prod.hsn_code || "",
        unit: unitVal,
        rate: costRate,
        mrp: sellingUnitPrice,
        sgst: purchaseData?.sgst ?? 9,
        cgst: purchaseData?.cgst ?? 9,
      };
      return { ...updated, ...computeLineAutos(updated) };
    }));
  };

  // Back-fill unit price when purchase/sales lookups finish loading after product selection
  useEffect(() => {
    if (!isFormOpen) return;
    setGridItems((prev) => {
      let changed = false;
      const next = prev.map((item) => {
        if (!item.code || item.mrp > 0) return item;
        const code = normalizeItemCode(item.code);
        const sellingUnitPrice = resolveSellingUnitPrice(
          purchaseItemMap.get(code),
          salesItemPriceMap.get(code),
        );
        if (sellingUnitPrice <= 0) return item;
        changed = true;
        const purchaseData = purchaseItemMap.get(code);
        const updated: SaleItem = {
          ...item,
          rate: purchaseData?.purchase_rate ?? item.rate,
          mrp: sellingUnitPrice,
          sgst: purchaseData?.sgst ?? item.sgst,
          cgst: purchaseData?.cgst ?? item.cgst,
          hsn_code: purchaseData?.hsn_code || item.hsn_code,
          unit: purchaseData?.unit || item.unit,
        };
        return { ...updated, ...computeLineAutos(updated) };
      });
      return changed ? next : prev;
    });
  }, [isFormOpen, purchaseItemMap, salesItemPriceMap]);

  const handleRateTpChange = (nextRateTp: string) => {
    setRateTp(nextRateTp);
    const rates = gstRatesFromRateTp(nextRateTp);
    if (!rates) return;
    setGridItems((prev) => prev.map((item) => {
      const updated = { ...item, sgst: rates.sgst, cgst: rates.cgst };
      return { ...updated, ...computeLineAutos(updated) };
    }));
  };

  // ── Live calculations (derived from edited unit price × qty per line) ──
  const calc = useMemo(() => {
    let sub = 0;
    let totalGst = 0;
    let linesTotal = 0;
    gridItems.forEach((item) => {
      const summary = getSaleItemSummary(item);
      sub += summary.taxableValue;
      totalGst += summary.cgstAmount + summary.sgstAmount;
      linesTotal += summary.total;
    });
    const discNum   = Number(discount)   || 0;
    const fCessNum  = Number(fCess)      || 0;
    const commNum   = Number(commission) || 0;
    const postNum   = Number(postage)    || 0;
    const rawTotal = linesTotal - discNum + fCessNum + commNum + postNum;
    const rawTotalPaise = Math.round(rawTotal * 100) / 100;
    const grandTotal = Math.round(rawTotalPaise);
    const roundOff = Math.round((grandTotal - rawTotalPaise) * 100) / 100;
    return {
      subtotal: Math.round(sub * 100) / 100,
      totalGst: Math.round(totalGst * 100) / 100,
      linesTotal: Math.round(linesTotal * 100) / 100,
      roundOff,
      grandTotal,
    };
  }, [gridItems, discount, fCess, commission, postage]);

  // Auto-fill payment amount for new bills (rounded grand total)
  useEffect(() => {
    if (!editingSale && isFormOpen && calc.grandTotal > 0) {
      setPaymentAmount(String(calc.grandTotal));
    }
  }, [calc.grandTotal, editingSale, isFormOpen]);

  // ── Reset form ──
  const resetForm = () => {
    setEditingSale(null);
    setFormType("Tax Invoice");
    setBillDate(new Date().toISOString().split("T")[0]);
    setCustomerName(""); setIsCustomCustomer(false); setCustomCustomerText("");
    setCustomerPhone(""); setShipTo(""); setVehicleNo("");
    setSalesman("Manager"); setIsCustomSalesman(false); setCustomSalesmanText("");
    setBranchGodown("Shop (Main Showroom)"); setRateTp("Retail");
    setGridItems([blankItem()]);
    setFCess(""); setDiscount(""); setCommission(""); setPostage("");
    setPaymentAmount(""); setPaymentMode("Cash");
    setFormError(null);
    setIsFormOpen(false);
    setTimeout(() => setSuccessMsg(null), 4000);
  };

  // ── Start edit ──
  const handleStartEdit = (rec: SaleRecord) => {
    setEditingSale(rec);
    setBillNo(rec.bill_no);
    setFormType(rec.form_type);
    setBillDate(rec.bill_date);
    if (SEED_CUSTOMERS.includes(rec.customer_name)) { setCustomerName(rec.customer_name); setIsCustomCustomer(false); }
    else { setCustomerName("CUSTOM"); setIsCustomCustomer(true); setCustomCustomerText(rec.customer_name); }
    setCustomerPhone(rec.customer_phone ?? "");
    setShipTo(rec.ship_to ?? "");
    setVehicleNo(rec.vehicle_no ?? "");
    if (SEED_SALESMEN.includes(rec.salesman ?? "")) { setSalesman(rec.salesman ?? "Manager"); setIsCustomSalesman(false); }
    else { setSalesman("CUSTOM"); setIsCustomSalesman(true); setCustomSalesmanText(rec.salesman ?? ""); }
    setBranchGodown(rec.branch_godown);
    setRateTp(rec.rate_tp);
    setGridItems(rec.items.length > 0 ? rec.items : [blankItem()]);
    setFCess(String(rec.f_cess));
    setDiscount(String(rec.discount));
    setCommission(String(rec.commission));
    setPostage(String(rec.postage));
    setPaymentAmount(String(rec.payment_amount));
    setPaymentMode(rec.payment_mode);
    setIsFormOpen(true);
  };

  // ── Submit handler ──
  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setFormError(null); setSuccessMsg(null);

    const customerFinal = isCustomCustomer ? customCustomerText.trim() : customerName.trim();
    if (!customerFinal) { setFormError("Please select or enter a Customer."); return; }
    if (gridItems.some((i) => !i.name.trim() || i.qty <= 0 || i.mrp <= 0)) {
      setFormError("All items must have a name, valid quantity, and unit selling price."); return;
    }
    const salesmanFinal = isCustomSalesman ? customSalesmanText.trim() : salesman;
    const paidNum = Number(paymentAmount) || 0;
    const bal = Math.max(0, calc.grandTotal - paidNum);
    const status = paidNum >= calc.grandTotal ? "Paid" : paidNum > 0 ? "Partial" : "Credit";

    const itemsFinal = gridItems.map((item) => ({ ...item, ...computeLineAutos(item) }));

    const payload: SaleRecord = {
      bill_no: billNo,
      form_type: formType,
      bill_date: billDate,
      customer_name: customerFinal,
      customer_phone: customerPhone.trim() || undefined,
      ship_to: shipTo.trim() || undefined,
      salesman: salesmanFinal || undefined,
      vehicle_no: vehicleNo.trim() || undefined,
      branch_godown: branchGodown,
      rate_tp: rateTp,
      items: itemsFinal,
      subtotal: calc.subtotal,
      f_cess: Number(fCess) || 0,
      discount: Number(discount) || 0,
      total_gst: calc.totalGst,
      commission: Number(commission) || 0,
      postage: Number(postage) || 0,
      round_off: calc.roundOff,
      grand_total: calc.grandTotal,
      payment_amount: paidNum,
      payment_mode: paymentMode,
      balance: bal,
      payment_status: status,
    };

    if (editingSale) {
      if (dbStatus === "connected") {
        try {
          const row = buildSupabaseSaleRow(payload, salesDbColumnsRef.current.hasVehicleNo);
          const { error } = await supabase.from("sales").update(row).eq("bill_no", editingSale.bill_no);
          if (error) throw error;
          setSuccessMsg(`Updated Bill "${billNo}" successfully!`);
          fetchSales(); resetForm();
        } catch (err) {
          setFormError(`Supabase error: ${err instanceof Error ? err.message : "Update failed."}`);
        }
      } else {
        const updated = sales.map((s) => s.bill_no === editingSale.bill_no ? payload : s);
        localStorage.setItem("kaniyamparambil_sales_v2", JSON.stringify(updated));
        setSales(updated); setSuccessMsg(`Updated Bill "${billNo}"!`); resetForm();
      }
    } else {
      if (sales.some((s) => s.bill_no === billNo)) { setFormError(`Bill No. "${billNo}" already exists.`); return; }
      if (dbStatus === "connected") {
        try {
          const row = buildSupabaseSaleRow(payload, salesDbColumnsRef.current.hasVehicleNo);
          const { error } = await supabase.from("sales").insert([row]);
          if (error) throw error;
          setSuccessMsg(`Saved Bill "${billNo}" successfully!`);
          fetchSales(); resetForm();
        } catch (err) {
          setFormError(`Supabase error: ${err instanceof Error ? err.message : "Insert failed."}`);
        }
      } else {
        const updated = [payload, ...sales];
        localStorage.setItem("kaniyamparambil_sales_v2", JSON.stringify(updated));
        setSales(updated); setSuccessMsg(`Saved Bill "${billNo}" to Local Storage!`); resetForm();
      }
    }
  };

  // ── Delete ──
  const handleDelete = async (bn: string) => {
    if (!window.confirm(`Delete Bill "${bn}"?`)) return;
    if (dbStatus === "connected") {
      try { const { error } = await supabase.from("sales").delete().eq("bill_no", bn); if (error) throw error; fetchSales(); }
      catch (err) { alert(`Delete failed: ${err instanceof Error ? err.message : "Unknown error"}`); }
    } else {
      const updated = sales.filter((s) => s.bill_no !== bn);
      localStorage.setItem("kaniyamparambil_sales_v2", JSON.stringify(updated)); setSales(updated);
    }
  };

  const openInvoiceDocument = (rec: SaleRecord, options: InvoiceWindowOptions) => {
    const win = window.open("", "_blank", "noopener,noreferrer");
    if (!win) {
      alert("Allow popups to open the invoice preview.");
      return;
    }

    win.document.write(buildInvoiceHtml(rec, options));
    win.document.close();
  };

  // ── Print ──
  const handlePrint = (rec: SaleRecord) => {
    openInvoiceDocument(rec, {
      autoPrint: true,
      renderMode: "pdf",
      helperText: "Premium A4 invoice preview. Print directly or switch the destination to Save as PDF.",
    });
    return;

    /*
    const win = window.open("", "_blank");
    if (!win) { alert("Allow popups to print."); return; }
    const rows = rec.items.map((i) => {
      const mrpAmt  = i.qty * i.mrp;
      const discAmt = mrpAmt * ((i.disc_pct || 0) / 100);
      const taxable = Math.max(0, mrpAmt - discAmt);
      const gstAmt  = taxable * (((i.sgst ?? 0) + (i.cgst ?? 0)) / 100);
      return `<tr>
        <td>${i.code || "—"}</td><td>${i.name}</td>
        <td style="text-align:center">${i.qty}</td><td style="text-align:center">${i.unit}</td>
        <td style="text-align:right">₹${i.mrp.toFixed(2)}</td>
        <td style="text-align:right">₹${mrpAmt.toFixed(2)}</td>
        <td style="text-align:center">${i.disc_pct ?? 0}%</td>
        <td style="text-align:right">₹${gstAmt.toFixed(2)}</td>
        <td style="text-align:right">₹${(taxable + gstAmt).toFixed(2)}</td>
        <td style="text-align:right">${i.rate ? "₹" + i.rate.toFixed(2) : "—"}</td>
      </tr>`;
    }).join("");
    win.document.write(`<html><head><title>Bill - ${rec.bill_no}</title>
    <style>body{font-family:sans-serif;padding:30px;color:#1e293b}
    .hdr{display:flex;justify-content:space-between;border-bottom:2px solid #0f172a;padding-bottom:12px;margin-bottom:16px}
    .dg{display:grid;grid-template-columns:1fr 1fr;gap:10px;font-size:12px;background:#f8fafc;padding:12px;border-radius:8px;border:1px solid #e2e8f0;margin-bottom:16px}
    table{width:100%;border-collapse:collapse;font-size:11px}th,td{border:1px solid #e2e8f0;padding:6px 8px}th{background:#f1f5f9;font-weight:600}
    .tp{display:flex;justify-content:flex-end;margin-top:16px}.tp table{width:260px}
    .tp td{border:none;padding:4px 6px}.tp tr.bold td{font-weight:700;border-top:1px solid #cbd5e1}</style></head><body>
    <div class="hdr"><div><h1 style="margin:0;font-size:18px">New Kaniyamparambil Stores</h1>
    <p style="margin:4px 0 0;font-size:11px;color:#64748b">${rec.form_type}</p></div>
    <div style="text-align:right"><p style="margin:0;font-size:11px"><strong>Bill No:</strong> ${rec.bill_no}</p>
    <p style="margin:2px 0 0;font-size:11px"><strong>Date:</strong> ${rec.bill_date}</p>
    <p style="margin:2px 0 0;font-size:11px"><strong>Rate TP:</strong> ${rec.rate_tp}</p></div></div>
    <div class="dg"><div><div><strong>Customer:</strong> ${rec.customer_name}</div>
    ${rec.ship_to ? `<div><strong>Ship To:</strong> ${rec.ship_to}</div>` : ""}
    <div><strong>Phone:</strong> ${rec.customer_phone || "—"}</div></div>
    <div><div><strong>Salesman:</strong> ${rec.salesman || "—"}</div>
    <div><strong>Branch/Godown:</strong> ${rec.branch_godown}</div>
    <div><strong>Payment Mode:</strong> ${rec.payment_mode}</div></div></div>
    <table><thead><tr><th>Code</th><th>Item</th><th>Qty</th><th>Unit</th><th>MRP</th>
    <th>Amount</th><th>Disc%</th><th>GST</th><th>Total</th><th>Cost Rate</th></tr></thead>
    <tbody>${rows}</tbody></table>
    <div class="tp"><table>
    <tr><td>SubTotal:</td><td style="text-align:right">₹${rec.subtotal.toFixed(2)}</td></tr>
    <tr><td>F.Cess:</td><td style="text-align:right">₹${rec.f_cess.toFixed(2)}</td></tr>
    <tr><td>Discount (–):</td><td style="text-align:right;color:#dc2626">–₹${rec.discount.toFixed(2)}</td></tr>
    <tr><td>GST & Cess:</td><td style="text-align:right;color:#b45309">₹${rec.total_gst.toFixed(2)}</td></tr>
    <tr><td>Commission:</td><td style="text-align:right">₹${rec.commission.toFixed(2)}</td></tr>
    <tr><td>${TRAVEL_EXPENSE_LABEL}:</td><td style="text-align:right">₹${rec.postage.toFixed(2)}</td></tr>
    <tr><td>Round Off:</td><td style="text-align:right">${rec.round_off >= 0 ? "+" : ""}₹${rec.round_off.toFixed(2)}</td></tr>
    <tr class="bold"><td>Grand Total:</td><td style="text-align:right">₹${rec.grand_total.toFixed(2)}</td></tr>
    <tr><td>Payment:</td><td style="text-align:right;color:green">₹${rec.payment_amount.toFixed(2)}</td></tr>
    <tr><td>Balance:</td><td style="text-align:right;color:${rec.balance > 0 ? "#dc2626" : "green"}">₹${rec.balance.toFixed(2)}</td></tr>
    </table></div>
    <script>setTimeout(()=>{window.focus();window.print();window.close();},300);</script>
    </body></html>`);
    win.document.close();
    */
  };

  // ── Download ──
  const handleDownload = (rec: SaleRecord) => {
    openInvoiceDocument(rec, {
      autoPrint: true,
      renderMode: "pdf",
      helperText: "Choose Save as PDF in the print dialog to download this enterprise invoice layout.",
    });
    return;

    /*
    const blob = new Blob([JSON.stringify(rec, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a"); a.href = url; a.download = `bill_${rec.bill_no}.json`;
    document.body.appendChild(a); a.click(); document.body.removeChild(a); URL.revokeObjectURL(url);
    */
  };

  // ── Filtered & paginated list ──
  const handlePrintInvoice = async (rec: SaleRecord) => {
    let iframe: HTMLIFrameElement | null = null;
    try {
      iframe = await waitForInvoiceFrame(buildInvoiceHtml(rec, {
        helperText: "Premium A4 invoice preview. Print directly or switch the destination to Save as PDF.",
        renderMode: "pdf",
      }));

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

  const handleDownloadInvoice = async (rec: SaleRecord) => {
    let iframe: HTMLIFrameElement | null = null;
    try {
      iframe = await waitForInvoiceFrame(buildInvoiceHtml(rec, {
        helperText: "Generating tax invoice PDF...",
        renderMode: "pdf",
      }));

      const invoiceRoot = iframe.contentDocument?.querySelector(".invoice-fit-wrap")
        ?? iframe.contentDocument?.querySelector(".invoice-sheet");
      if (!(invoiceRoot instanceof HTMLElement)) {
        throw new Error("Unable to prepare the invoice layout for PDF export.");
      }

      const canvas = await html2canvas(invoiceRoot, {
        scale: 2,
        useCORS: true,
        backgroundColor: "#ffffff",
      });

      const pdf = new jsPDF({
        orientation: "portrait",
        unit: "pt",
        format: "a4",
      });

      const pageWidth = pdf.internal.pageSize.getWidth();
      const pageHeight = pdf.internal.pageSize.getHeight();
      const margin = 12;
      const maxWidth = pageWidth - margin * 2;
      const maxHeight = pageHeight - margin * 2;
      const scale = Math.min(maxWidth / canvas.width, maxHeight / canvas.height);
      const renderWidth = canvas.width * scale;
      const renderHeight = canvas.height * scale;

      pdf.addImage(
        canvas.toDataURL("image/png"),
        "PNG",
        margin,
        margin,
        renderWidth,
        renderHeight,
        undefined,
        "FAST",
      );

      pdf.save(`tax_invoice_${rec.bill_no}.pdf`);
    } catch (err) {
      alert(`PDF download failed: ${err instanceof Error ? err.message : "Unknown error"}`);
    } finally {
      iframe?.remove();
    }
  };

  const listDateRangeInvalid = dateFilterMode === "range" && filterFrom > filterTo;

  const listPeriodLabel = useMemo(() => {
    switch (dateFilterMode) {
      case "date":
        return formatTableDate(filterDate);
      case "month":
        return formatMonthLabel(filterMonth);
      case "range":
        return `${formatTableDate(filterFrom)} to ${formatTableDate(filterTo)}`;
      default:
        return null;
    }
  }, [dateFilterMode, filterDate, filterMonth, filterFrom, filterTo]);

  const filteredSales = useMemo(() => {
    if (listDateRangeInvalid) return [];

    let list = sales;
    switch (dateFilterMode) {
      case "date":
        list = filterSalesByDate(list, filterDate);
        break;
      case "month":
        list = filterSalesByMonth(list, filterMonth);
        break;
      case "range":
        list = filterSalesByRange(list, filterFrom, filterTo);
        break;
      default:
        break;
    }

    return list.filter((s) => {
      const q = searchQuery.toLowerCase();
      const matchQ = s.bill_no.toLowerCase().includes(q) || s.customer_name.toLowerCase().includes(q);
      const matchS = statusFilter === "All" || s.payment_status === statusFilter;
      return matchQ && matchS;
    });
  }, [
    sales,
    searchQuery,
    statusFilter,
    dateFilterMode,
    filterDate,
    filterMonth,
    filterFrom,
    filterTo,
    listDateRangeInvalid,
  ]);

  const sortedSales = useMemo(() => {
    const list = [...filteredSales];
    const multiplier = sortDir === "asc" ? 1 : -1;
    list.sort((a, b) => compareSalesRecords(a, b, sortKey) * multiplier);
    return list;
  }, [filteredSales, sortKey, sortDir]);

  const filteredSalesTotal = useMemo(
    () => sumSaleGrandTotals(filteredSales),
    [filteredSales],
  );

  const isFilteredView = dateFilterMode !== "all"
    || statusFilter !== "All"
    || searchQuery.trim().length > 0;

  const totalPages = Math.ceil(sortedSales.length / itemsPerPage);
  const currentSales = sortedSales.slice((currentPage - 1) * itemsPerPage, currentPage * itemsPerPage);

  const availableCustomers = useMemo(
    () => Array.from(new Set([...SEED_CUSTOMERS, ...sales.map((s) => s.customer_name)])).filter(Boolean),
    [sales],
  );

  const resolveSalesStatementReport = (): {
    records: SaleRecord[];
    reportType: string;
    periodLabel: string;
    filenameSuffix: string;
  } | null => {
    const applyStatus = (list: SaleRecord[]) =>
      statusFilter === "All" ? list : list.filter((s) => s.payment_status === statusFilter);

    switch (reportMode) {
      case "full":
        return {
          records: applyStatus([...sales]),
          reportType: "Complete Sales Register",
          periodLabel: "All Bills (Full Register)",
          filenameSuffix: `full_${todayIso()}`,
        };
      case "current":
        return {
          records: [...filteredSales],
          reportType: "Filtered Table View",
          periodLabel: listPeriodLabel
            ? `${listPeriodLabel} — Status: ${statusFilter}, Search: ${searchQuery.trim() || "—"}`
            : `Current filters — Status: ${statusFilter}, Search: ${searchQuery.trim() || "—"}`,
          filenameSuffix: `filtered_${todayIso()}`,
        };
      case "date": {
        const dated = applyStatus(filterSalesByDate(sales, reportDate));
        return {
          records: dated,
          reportType: "Daily Sales Statement",
          periodLabel: formatInvoiceDate(reportDate),
          filenameSuffix: `date_${reportDate}`,
        };
      }
      case "month": {
        const monthly = applyStatus(filterSalesByMonth(sales, reportMonth));
        return {
          records: monthly,
          reportType: "Monthly Sales Statement",
          periodLabel: formatMonthLabel(reportMonth),
          filenameSuffix: `month_${reportMonth}`,
        };
      }
      case "range": {
        if (reportFrom > reportTo) {
          setReportError("From date cannot be after To date.");
          return null;
        }
        const ranged = applyStatus(filterSalesByRange(sales, reportFrom, reportTo));
        return {
          records: ranged,
          reportType: "Date Range Sales Statement",
          periodLabel: `${formatInvoiceDate(reportFrom)} to ${formatInvoiceDate(reportTo)}`,
          filenameSuffix: `${reportFrom}_to_${reportTo}`,
        };
      }
      default:
        return null;
    }
  };

  const buildSalesStatementDocument = () => {
    const report = resolveSalesStatementReport();
    if (!report) return null;
    if (report.records.length === 0) {
      setReportError("No sales bills match the selected statement period.");
      return null;
    }
    setReportError(null);
    return buildSalesStatementHtml(
      report.records,
      buildSalesStatementMeta(
        report.records,
        report.reportType,
        report.periodLabel,
        statusFilter,
        searchQuery.trim(),
      ),
      { renderMode: "pdf", helperText: "Generating sales statement PDF..." },
    );
  };

  const handleDownloadSalesStatement = async () => {
    const report = resolveSalesStatementReport();
    if (!report) return;
    const html = buildSalesStatementDocument();
    if (!html) return;
    try {
      await exportSalesStatementPdf(html, `sales_statement_${report.filenameSuffix}.pdf`);
    } catch (err) {
      alert(`Statement PDF failed: ${err instanceof Error ? err.message : "Unknown error"}`);
    }
  };

  const handlePrintSalesStatement = async () => {
    const html = buildSalesStatementDocument();
    if (!html) return;
    try {
      await printSalesStatementHtml(html);
    } catch (err) {
      alert(`Print failed: ${err instanceof Error ? err.message : "Unknown error"}`);
    }
  };

  // ─────────────────────────────────────────────────────────────────────────────
  // RENDER
  // ─────────────────────────────────────────────────────────────────────────────
  return (
    <div className="p-6 space-y-6">

      {/* ── Page Header ── */}
      <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-4">
        <div>
          <h1 className="text-page-title font-semibold text-text-primary flex items-center gap-2">
            <Receipt className="w-6 h-6 text-green-600" />
            Sales &amp; Billing
          </h1>
          <p className="text-caption text-text-secondary mt-0.5">
            Generate customer bills, manage invoices, and track sales transactions.
          </p>
        </div>
        <div className="flex items-center gap-2 flex-wrap">
          <button
            type="button"
            onClick={() => { setReportError(null); setIsReportModalOpen(true); }}
            className="btn-secondary flex items-center gap-1.5 text-xs font-semibold shadow-sm"
          >
            <FileText className="w-3.5 h-3.5" />
            Sales Statement
          </button>
          <button onClick={() => { resetForm(); setIsFormOpen(true); }}
            className="btn-primary bg-green-600 hover:bg-green-700 active:bg-green-800 flex items-center gap-1.5 shadow-sm">
            <Plus className="w-4 h-4" /> New Sales Bill
          </button>
        </div>
      </div>

      {/* ── DB Status ── */}
      {dbStatus === "local" && (
        <div className="bg-blue-50 border border-blue-200 rounded-lg p-4 flex items-start gap-3">
          <Database className="w-5 h-5 text-blue-600 mt-0.5 flex-shrink-0" />
          <div>
            <h4 className="text-sm font-semibold text-blue-800">Local Mode Active</h4>
            <p className="text-xs text-blue-700 mt-0.5">
              Could not load from Supabase. Showing local backup data.
              {fetchError && (
                <> Error: <code className="text-[11px] bg-blue-100 px-1 rounded">{fetchError}</code></>
              )}
            </p>
            <p className="text-xs text-blue-700 mt-1.5">
              To add missing columns <strong>without deleting your table</strong>, run{" "}
              <code className="text-[11px] bg-blue-100 px-1 rounded">sql/04_sales_add_missing_columns.sql</code>{" "}
              (or the full <code className="text-[11px] bg-blue-100 px-1 rounded">sql/04_sales.sql</code>) in
              Supabase → SQL Editor, then refresh this page.
            </p>
            <button
              type="button"
              onClick={() => fetchSales()}
              className="mt-2 text-xs font-semibold text-blue-800 underline hover:text-blue-950"
            >
              Retry Supabase connection
            </button>
          </div>
        </div>
      )}

      {/* ── Sales Statement Modal ── */}
      {isReportModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/40 backdrop-blur-[2px]">
          <div className="absolute inset-0" onClick={() => setIsReportModalOpen(false)} />
          <div className="bg-white border border-slate-200 rounded-xl shadow-2xl relative max-w-lg w-full z-10 flex flex-col font-sans animate-in fade-in zoom-in-95 duration-150">
            <div className="bg-green-700 px-5 py-4 text-white rounded-t-xl flex items-center justify-between">
              <div>
                <h2 className="text-sm font-bold tracking-tight flex items-center gap-2">
                  <FileText className="w-4 h-4" />
                  Download Sales Statement
                </h2>
                <p className="text-[10px] text-green-100 mt-0.5">Account-style billing register PDF</p>
              </div>
              <button type="button" onClick={() => setIsReportModalOpen(false)}
                className="text-green-100 hover:text-white p-1.5 rounded-lg hover:bg-white/10">
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
                    ["full", "Full Sales Register", "All bills in the system"],
                    ["date", "By Bill Date", "Bills on a specific date"],
                    ["month", "By Month", "Bills in a calendar month"],
                    ["range", "Date Range", "Bills between two dates"],
                    ["current", "Current Table Filter", "Uses search & status filters from the list"],
                  ] as const).map(([mode, title, desc]) => (
                    <label key={mode}
                      className={`flex items-start gap-3 p-3 rounded-lg border cursor-pointer transition-colors ${
                        reportMode === mode ? "border-green-600 bg-green-50" : "border-slate-200 hover:bg-slate-50"
                      }`}>
                      <input type="radio" name="salesReportMode" value={mode} checked={reportMode === mode}
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
                  <label className="form-label text-xs">Bill Date</label>
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

              {(reportMode === "full" || reportMode === "date" || reportMode === "month" || reportMode === "range") && (
                <div>
                  <label className="form-label text-xs">Optional Payment Status Filter</label>
                  <select value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)}
                    className="input-enterprise bg-white cursor-pointer text-xs w-full">
                    <option value="All">All Bills</option>
                    <option value="Paid">Paid</option>
                    <option value="Partial">Partial</option>
                    <option value="Credit">Credit</option>
                  </select>
                </div>
              )}

              <p className="text-[10px] text-slate-500 leading-relaxed">
                Statement lists bill date, number, customer, salesman, totals, paid amount, balance, and status — with summary totals like an account statement.
              </p>
            </div>

            <div className="flex items-center justify-end gap-2 px-5 py-4 border-t border-slate-200 bg-slate-50 rounded-b-xl">
              <button type="button" onClick={() => setIsReportModalOpen(false)} className="btn-secondary px-4 text-xs">
                Cancel
              </button>
              <button type="button" onClick={handlePrintSalesStatement}
                className="btn-secondary px-4 text-xs flex items-center gap-1.5">
                <Printer className="w-3.5 h-3.5" /> Print
              </button>
              <button type="button" onClick={handleDownloadSalesStatement}
                className="btn-primary bg-green-600 hover:bg-green-700 px-4 text-xs flex items-center gap-1.5">
                <Download className="w-3.5 h-3.5" /> Download PDF
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ── Search & Filter ── */}
      <div className="bg-white border border-border rounded-xl shadow-card p-4 space-y-3">
        <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
          <div className="relative flex-1 max-w-md">
            <Search className="w-4 h-4 text-text-secondary absolute left-3 top-3" />
            <input type="text" value={searchQuery} onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="Search Bill No, Customer..." className="input-enterprise pl-9" />
          </div>
          <div className="flex items-center gap-3">
            <div className="flex items-center gap-1.5 text-xs font-semibold text-text-secondary">
              <Filter className="w-3.5 h-3.5" /><span>Status:</span>
            </div>
            <select value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)}
              className="input-enterprise bg-white cursor-pointer w-40">
              <option value="All">All Bills</option>
              <option value="Paid">Paid</option>
              <option value="Partial">Partial</option>
              <option value="Credit">Credit</option>
            </select>
          </div>
        </div>

        <div className="flex flex-col lg:flex-row lg:items-end gap-3 pt-1 border-t border-slate-100">
          <div className="flex items-center gap-1.5 text-xs font-semibold text-text-secondary shrink-0">
            <Calendar className="w-3.5 h-3.5" />
            <span>Bill Period:</span>
          </div>
          <select
            value={dateFilterMode}
            onChange={(e) => setDateFilterMode(e.target.value as SalesListDateFilter)}
            className="input-enterprise bg-white cursor-pointer text-xs w-full sm:w-44"
          >
            <option value="all">All Dates</option>
            <option value="date">By Date</option>
            <option value="month">By Month</option>
            <option value="range">Date Range</option>
          </select>

          {dateFilterMode === "date" && (
            <div className="flex-1 min-w-[140px]">
              <label className="form-label text-[10px] text-slate-500 mb-1 block">Bill Date</label>
              <input
                type="date"
                value={filterDate}
                onChange={(e) => setFilterDate(e.target.value)}
                className="input-enterprise font-mono text-xs w-full"
              />
            </div>
          )}

          {dateFilterMode === "month" && (
            <div className="flex-1 min-w-[140px]">
              <label className="form-label text-[10px] text-slate-500 mb-1 block">Month</label>
              <input
                type="month"
                value={filterMonth}
                onChange={(e) => setFilterMonth(e.target.value)}
                className="input-enterprise font-mono text-xs w-full"
              />
            </div>
          )}

          {dateFilterMode === "range" && (
            <div className="flex flex-1 flex-wrap gap-3">
              <div className="min-w-[140px] flex-1">
                <label className="form-label text-[10px] text-slate-500 mb-1 block">From Date</label>
                <input
                  type="date"
                  value={filterFrom}
                  onChange={(e) => setFilterFrom(e.target.value)}
                  className="input-enterprise font-mono text-xs w-full"
                />
              </div>
              <div className="min-w-[140px] flex-1">
                <label className="form-label text-[10px] text-slate-500 mb-1 block">To Date</label>
                <input
                  type="date"
                  value={filterTo}
                  min={filterFrom}
                  onChange={(e) => setFilterTo(e.target.value)}
                  className="input-enterprise font-mono text-xs w-full"
                />
              </div>
            </div>
          )}

          {dateFilterMode !== "all" && (
            <button
              type="button"
              onClick={() => setDateFilterMode("all")}
              className="btn-secondary px-3 py-2 text-xs whitespace-nowrap"
            >
              Clear Period
            </button>
          )}
        </div>

        {listDateRangeInvalid && (
          <p className="text-xs text-red-600 flex items-center gap-1.5">
            <AlertTriangle className="w-3.5 h-3.5 flex-shrink-0" />
            From date cannot be after To date.
          </p>
        )}

        {listPeriodLabel && !listDateRangeInvalid && (
          <p className="text-[10px] text-slate-500">
            Showing bills for period: <span className="font-semibold text-slate-700">{listPeriodLabel}</span>
          </p>
        )}
      </div>

      {/* ── Sales Table ── */}
      <div className="bg-white border border-border rounded-xl shadow-card overflow-hidden">
        <div className="overflow-x-auto">
          <table className="table-enterprise w-full text-xs">
            <thead>
              <tr className="bg-gray-50 border-b border-border">
                {SALES_TABLE_COLUMNS.map(({ key, label }) => (
                  <th key={label} className="px-4 py-3 text-center font-semibold uppercase tracking-wider text-text-secondary">
                    {key ? (
                      <button
                        type="button"
                        onClick={() => handleSort(key)}
                        className={`inline-flex items-center justify-center gap-1 w-full transition-colors ${
                          sortKey === key ? "text-slate-900" : "text-text-secondary hover:text-slate-800"
                        }`}
                        title={`Sort by ${label}`}
                      >
                        <span>{label}</span>
                        {sortKey === key ? (
                          sortDir === "asc" ? <ArrowUp className="w-3 h-3" /> : <ArrowDown className="w-3 h-3" />
                        ) : (
                          <ArrowUpDown className="w-3 h-3 opacity-35" />
                        )}
                      </button>
                    ) : (
                      label
                    )}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {loading ? (
                <tr><td colSpan={9} className="text-center py-12">
                  <svg className="w-6 h-6 animate-spin text-primary mx-auto mb-2" fill="none" viewBox="0 0 24 24">
                    <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"/>
                    <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"/>
                  </svg>
                  <span className="text-xs text-text-secondary">Loading sales records...</span>
                </td></tr>
              ) : sortedSales.length === 0 ? (
                <tr><td colSpan={9} className="text-center py-16 text-text-secondary">
                  <Calendar className="w-8 h-8 mx-auto text-gray-300 mb-2"/>
                  <p className="font-semibold text-sm">
                    {listDateRangeInvalid
                      ? "Invalid date range"
                      : listPeriodLabel
                        ? `No sales bills for ${listPeriodLabel}`
                        : "No sales bills found"}
                  </p>
                  <p className="text-xs text-gray-400 mt-1">
                    {listPeriodLabel || searchQuery || statusFilter !== "All"
                      ? "Try changing the period, status, or search filters."
                      : 'Click "New Sales Bill" to create one.'}
                  </p>
                </td></tr>
              ) : currentSales.map((rec) => (
                <tr key={rec.bill_no} className="border-b border-border hover:bg-gray-50/50 transition-colors">
                  <td className="px-4 py-2.5 font-mono font-semibold text-center">{rec.bill_no}</td>
                  <td className="px-4 py-2.5 text-center text-xs">{rec.form_type}</td>
                  <td className="px-4 py-2.5 font-medium text-center truncate max-w-[140px]" title={rec.customer_name}>{rec.customer_name}</td>
                  <td className="px-4 py-2.5 font-mono text-center text-text-secondary">{formatTableDate(rec.bill_date)}</td>
                  <td className="px-4 py-2.5 text-center text-text-secondary">{rec.salesman || "—"}</td>
                  <td className="px-4 py-2.5 text-center font-mono font-bold">{formatCurrency(rec.grand_total)}</td>
                  <td className="px-4 py-2.5 text-center font-mono text-green-700">{formatCurrency(rec.payment_amount)}</td>
                  <td className="px-4 py-2.5 text-center">
                    <span className={`inline-flex items-center px-2 py-0.5 rounded text-[10px] font-bold ${
                      rec.payment_status === "Paid" ? "bg-green-100 text-green-800 border border-green-200"
                      : rec.payment_status === "Partial" ? "bg-blue-100 text-blue-800 border border-blue-200"
                      : "bg-orange-100 text-orange-800 border border-orange-200"}`}>
                      {rec.payment_status}
                    </span>
                  </td>
                  <td className="px-4 py-2.5 text-center">
                    <div className="flex items-center justify-center gap-1.5">
                      {[
                        { icon: Eye, title: "View", fn: () => setViewingSale(rec) },
                        { icon: Edit, title: "Edit", fn: () => handleStartEdit(rec) },
                        { icon: Printer, title: "Print", fn: () => handlePrintInvoice(rec) },
                        { icon: Download, title: "Download", fn: () => handleDownloadInvoice(rec) },
                      ].map(({ icon: Icon, title, fn }) => (
                        <button key={title} type="button" onClick={fn} title={title}
                          className="text-slate-500 hover:text-slate-900 hover:bg-slate-100 p-1.5 rounded transition-all">
                          <Icon className="w-3.5 h-3.5" />
                        </button>
                      ))}
                      <button type="button" onClick={() => handleDelete(rec.bill_no)} title="Delete"
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
        {/* Pagination */}
        <div className="bg-gray-50 px-4 py-3 border-t border-border flex flex-col sm:flex-row items-center justify-between gap-4 text-xs text-text-secondary">
          <span>Showing {sortedSales.length > 0 ? (currentPage - 1) * itemsPerPage + 1 : 0}–{Math.min(currentPage * itemsPerPage, sortedSales.length)} of {sortedSales.length}</span>
          <div className="flex items-center gap-2">
            <button onClick={() => setCurrentPage((p) => Math.max(p - 1, 1))} disabled={currentPage === 1}
              className="px-3 py-1.5 font-semibold rounded border border-border bg-white text-gray-700 hover:bg-gray-50 disabled:opacity-50 disabled:cursor-not-allowed">Previous</button>
            <span className="font-medium text-gray-700">Page {currentPage} of {totalPages || 1}</span>
            <button onClick={() => setCurrentPage((p) => Math.min(p + 1, totalPages))} disabled={currentPage >= totalPages || totalPages === 0}
              className="px-3 py-1.5 font-semibold rounded border border-border bg-white text-gray-700 hover:bg-gray-50 disabled:opacity-50 disabled:cursor-not-allowed">Next</button>
          </div>
          <div className="font-semibold text-gray-900 text-right">
            <div>
              Total Sales
              {isFilteredView ? " (filtered)" : ""}:{" "}
              <span className="font-mono text-green-700 bg-green-50 px-2 py-0.5 border border-green-100 rounded">
                {formatCurrency(filteredSalesTotal)}
              </span>
            </div>
          </div>
        </div>
      </div>

      {/* ══════════════════════════════════════════════════════════════════
          NEW / EDIT SALES BILL MODAL
      ══════════════════════════════════════════════════════════════════ */}
      {isFormOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/50 backdrop-blur-sm">
          <div className="bg-white border border-slate-200 rounded-xl shadow-2xl relative max-w-6xl w-full max-h-[92vh] overflow-y-auto flex flex-col font-sans animate-in zoom-in-95 duration-150">

            {/* Modal Header */}
            <div className="bg-slate-950 px-6 py-4 text-white flex items-center justify-between sticky top-0 z-20 shadow-md">
              <div>
                <h2 className="text-sm font-bold tracking-tight">
                  {editingSale ? "Edit Sales Bill" : "New Sales Bill"}
                </h2>
                <p className="text-[10px] text-slate-300 mt-0.5">
                  {editingSale ? `Editing Bill No: ${editingSale.bill_no}` : `Bill No: ${billNo}`}
                </p>
              </div>
              <button type="button" onClick={resetForm} aria-label="Close"
                className="text-slate-300 hover:text-white p-1.5 rounded-lg hover:bg-white/10 transition-colors">
                <X className="w-4.5 h-4.5" />
              </button>
            </div>

            <form onSubmit={handleSubmit} className="p-6 space-y-6 flex-1">
              {formError && (
                <div className="bg-red-50 border border-red-200 text-red-800 text-xs px-4 py-2.5 rounded-md flex items-center gap-2">
                  <AlertTriangle className="w-4 h-4 flex-shrink-0" />{formError}
                </div>
              )}
              {successMsg && (
                <div className="bg-green-50 border border-green-200 text-green-800 text-xs px-4 py-2.5 rounded-md flex items-center gap-2">
                  <Check className="w-4 h-4 flex-shrink-0" />{successMsg}
                </div>
              )}

              {/* ── Section 1: Header ── */}
              <div className="bg-slate-50 border border-slate-200/80 rounded-xl p-4 space-y-4">
                <h3 className="text-xs font-bold uppercase tracking-wider text-slate-500 border-b border-slate-200 pb-1.5">
                  1. Bill Header
                </h3>
                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">

                  {/* Form Type */}
                  <div>
                    <label className="form-label text-xs font-semibold text-slate-700 mb-1 block">Form Type *</label>
                    <select value={formType} onChange={(e) => setFormType(e.target.value)}
                      className="input-enterprise bg-white cursor-pointer text-xs" required>
                      {FORM_TYPES.map((t) => <option key={t} value={t}>{t}</option>)}
                    </select>
                  </div>

                  {/* Bill No */}
                  <div>
                    <label className="form-label text-xs font-semibold text-slate-700 mb-1 block">Bill No. *</label>
                    <input type="text" value={billNo} onChange={(e) => setBillNo(e.target.value)}
                      disabled={!!editingSale}
                      className="input-enterprise font-mono text-xs" required />
                  </div>

                  {/* Date */}
                  <div>
                    <label className="form-label text-xs font-semibold text-slate-700 mb-1 block">Date *</label>
                    <input type="date" value={billDate} onChange={(e) => setBillDate(e.target.value)}
                      className="input-enterprise font-mono text-xs cursor-pointer" required />
                  </div>

                  {/* Branch / Godown */}
                  <div>
                    <label className="form-label text-xs font-semibold text-slate-700 mb-1 block">Br/GD (Branch/Godown) *</label>
                    <select value={branchGodown} onChange={(e) => setBranchGodown(e.target.value)}
                      className="input-enterprise bg-white cursor-pointer text-xs" required>
                      {BRANCHES_GODOWNS.map((b) => <option key={b} value={b}>{b}</option>)}
                    </select>
                  </div>

                  {/* Customer */}
                  <div className="lg:col-span-2">
                    <label className="form-label text-xs font-semibold text-slate-700 mb-1 block">Customer *</label>
                    {!isCustomCustomer ? (
                      <SearchableCustomerSelect
                        customers={availableCustomers}
                        value={customerName}
                        onChange={setCustomerName}
                        onAddNew={() => setIsCustomCustomer(true)}
                        placeholder="Search customer name..."
                      />
                    ) : (
                      <div className="flex gap-2 items-center">
                        <input type="text" value={customCustomerText} onChange={(e) => setCustomCustomerText(e.target.value)}
                          placeholder="Type new customer name" className="input-enterprise text-xs w-full" required autoFocus />
                        <button type="button" onClick={() => { setIsCustomCustomer(false); setCustomCustomerText(""); }}
                          className="text-[10px] text-slate-500 hover:text-slate-800 underline font-bold whitespace-nowrap">Cancel</button>
                      </div>
                    )}
                  </div>

                  {/* Ship To */}
                  <div className="lg:col-span-2">
                    <label className="form-label text-xs font-semibold text-slate-700 mb-1 block">
                      <span className="flex items-center gap-1"><Truck className="w-3 h-3" /> Shipd. To (Shipping Address)</span>
                    </label>
                    <input type="text" value={shipTo} onChange={(e) => setShipTo(e.target.value)}
                      placeholder="Delivery address or destination" className="input-enterprise text-xs" />
                  </div>

                  {/* Salesman */}
                  <div>
                    <label className="form-label text-xs font-semibold text-slate-700 mb-1 block">
                      <span className="flex items-center gap-1"><User className="w-3 h-3" /> Salesman</span>
                    </label>
                    {!isCustomSalesman ? (
                      <select value={salesman}
                        onChange={(e) => e.target.value === "CUSTOM" ? setIsCustomSalesman(true) : setSalesman(e.target.value)}
                        className="input-enterprise bg-white cursor-pointer text-xs">
                        {SEED_SALESMEN.map((s) => <option key={s} value={s}>{s}</option>)}
                        <option value="CUSTOM" className="text-green-700 font-bold">+ Add New</option>
                      </select>
                    ) : (
                      <div className="flex gap-2 items-center">
                        <input type="text" value={customSalesmanText} onChange={(e) => setCustomSalesmanText(e.target.value)}
                          placeholder="Salesman name" className="input-enterprise text-xs w-full" />
                        <button type="button" onClick={() => { setIsCustomSalesman(false); setCustomSalesmanText(""); }}
                          className="text-[10px] text-slate-500 hover:text-slate-800 underline font-bold whitespace-nowrap">Cancel</button>
                      </div>
                    )}
                  </div>

                  {/* Rate TP */}
                  <div>
                    <label className="form-label text-xs font-semibold text-slate-700 mb-1 block">Rate TP / Sale TP (GST Class) *</label>
                    <select value={rateTp} onChange={(e) => handleRateTpChange(e.target.value)}
                      className="input-enterprise bg-white cursor-pointer text-xs" required>
                      {RATE_TP_OPTIONS.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
                    </select>
                  </div>

                  {/* Vehicle No */}
                  <div>
                    <label className="form-label text-xs font-semibold text-slate-700 mb-1 block">
                      <span className="flex items-center gap-1"><Truck className="w-3 h-3" /> Vehicle No.</span>
                    </label>
                    <input type="text" value={vehicleNo} onChange={(e) => setVehicleNo(e.target.value.toUpperCase())}
                      placeholder="e.g. KL-07-AB-1234" className="input-enterprise font-mono text-xs uppercase" />
                  </div>

                  {/* Customer Phone */}
                  <div>
                    <label className="form-label text-xs font-semibold text-slate-700 mb-1 block">Customer Phone</label>
                    <input type="tel" value={customerPhone} onChange={(e) => setCustomerPhone(e.target.value)}
                      placeholder="10-digit mobile" className="input-enterprise font-mono text-xs" />
                  </div>
                </div>
              </div>

              {/* ── Section 2: Item Grid ── */}
              <div className="border border-slate-200 rounded-xl p-4 space-y-3">
                <div className="flex items-center justify-between border-b border-slate-200 pb-2">
                  <h3 className="text-xs font-bold uppercase tracking-wider text-slate-500">2. Item Grid</h3>
                  <button type="button" onClick={addGridRow}
                    className="btn-secondary px-3 py-1 flex items-center gap-1.5 text-xs text-green-700 border-green-200 hover:bg-green-50 font-bold">
                    <Plus className="w-3.5 h-3.5" /> Add Row
                  </button>
                </div>
                <div className="overflow-x-auto">
                  <table className="w-full text-[11px] border-collapse font-sans">
                    <thead>
                      <tr className="bg-slate-100/80 text-slate-700 border-b border-slate-200 text-left font-semibold">
                        <th className="p-2 w-[200px]">Code / Item Name</th>
                        <th className="p-2 w-[55px] text-center">Qty</th>
                        <th className="p-2 w-[70px] text-center">Unit</th>
                        <th className="p-2 w-[80px] text-right">Unit Price (₹) *</th>
                        <th className="p-2 w-[85px] text-right">Amount (₹)</th>
                        <th className="p-2 w-[60px] text-center">Dis%</th>
                        <th className="p-2 w-[55px] text-center">SGST%</th>
                        <th className="p-2 w-[55px] text-center">CGST%</th>
                        <th className="p-2 w-[80px] text-right">Line Total (₹)</th>
                        <th className="p-2 w-[80px] text-center">HSN Code</th>
                        <th className="p-2 w-[75px] text-right text-slate-400">Cost Rate</th>
                        <th className="p-2 w-[36px] text-center">Del</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-100">
                      {gridItems.map((item, idx) => (
                        <tr key={idx} className="hover:bg-slate-50/50 transition-colors">
                          {/* Code / Item select */}
                          <td className="p-1.5">
                            <SearchableProductSelect items={inventory} value={item.code}
                              onChange={(prod) => handleProductSelect(idx, prod)} placeholder="Search item..." />
                          </td>
                          {/* Qty */}
                          <td className="p-1.5">
                            <input type="number" min="1" value={item.qty}
                              onChange={(e) => updateGridRow(idx, "qty", parseFloat(e.target.value) || 0)}
                              className="w-full text-center border border-slate-300 rounded p-1 text-xs font-mono" required />
                          </td>
                          {/* Unit — auto-filled from latest purchase bill */}
                          <td className="p-1.5">
                            <select value={item.unit} onChange={(e) => updateGridRow(idx, "unit", e.target.value)}
                              className="w-full text-center border border-slate-300 rounded p-1 text-xs bg-white cursor-pointer" required
                              title={purchaseItemMap.has(item.code) ? "Unit from latest purchase entry" : "Select unit"}>
                              {unitOptionsForRow(item.unit).map((u) => <option key={u} value={u}>{u}</option>)}
                            </select>
                          </td>
                          {/* Unit price per qty — from purchase MRP / S.Rate / purchase rate */}
                          <td className="p-1.5">
                            <input type="number" min="0" step="any" inputMode="decimal"
                              value={formatSaleGridValue(item.mrp)}
                              onChange={(e) => updateGridRow(idx, "mrp", parseFloat(e.target.value) || 0)}
                              className="w-full text-right border border-green-400 rounded p-1 text-xs font-mono font-semibold focus:ring-2 focus:ring-green-500/20 focus:border-green-600"
                              placeholder="0.00" required
                              title="Selling price for one unit (auto-filled from purchase)" />
                          </td>
                          {/* Amount = qty × unit price (auto) */}
                          <td className="p-1.5">
                            <input readOnly value={item.amount.toFixed(2)} tabIndex={-1}
                              className="w-full text-right border border-slate-200 rounded p-1 text-xs font-mono bg-slate-50 text-slate-600 cursor-not-allowed"
                              title="Qty × unit price" />
                          </td>
                          {/* Disc% */}
                          <td className="p-1.5">
                            <input type="number" min="0" max="100" value={item.disc_pct || ""}
                              onChange={(e) => updateGridRow(idx, "disc_pct", parseFloat(e.target.value) || 0)}
                              className="w-full text-center border border-slate-300 rounded p-1 text-xs font-mono" placeholder="0" />
                          </td>
                          {/* SGST% */}
                          <td className="p-1.5">
                            <input type="number" min="0" max="50" step="0.5" value={item.sgst ?? 9}
                              onChange={(e) => updateGridRow(idx, "sgst", parseFloat(e.target.value) || 0)}
                              className="w-full text-center border border-slate-300 rounded p-1 text-xs font-mono" placeholder="9" />
                          </td>
                          {/* CGST% */}
                          <td className="p-1.5">
                            <input type="number" min="0" max="50" step="0.5" value={item.cgst ?? 9}
                              onChange={(e) => updateGridRow(idx, "cgst", parseFloat(e.target.value) || 0)}
                              className="w-full text-center border border-slate-300 rounded p-1 text-xs font-mono" placeholder="9" />
                          </td>
                          {/* Line total incl. GST — updates when unit price / qty / disc changes */}
                          <td className="p-1.5">
                            <input readOnly value={item.line_total.toFixed(2)} tabIndex={-1}
                              className="w-full text-right border border-green-200 rounded p-1 text-xs font-mono font-semibold bg-green-50 text-green-800 cursor-not-allowed"
                              title="Taxable + SGST + CGST for this line" />
                          </td>
                          {/* HSN Code */}
                          <td className="p-1.5">
                            <input type="text" value={item.hsn_code}
                              onChange={(e) => updateGridRow(idx, "hsn_code", e.target.value)}
                              className="w-full text-center border border-slate-300 rounded p-1 text-xs font-mono" placeholder="HSN" />
                          </td>
                          {/* Cost Rate — purchase price reference, read-only */}
                          <td className="p-1.5">
                            <input readOnly value={item.rate ? item.rate.toFixed(2) : "—"} tabIndex={-1}
                              title="Purchase cost rate (reference only)"
                              className="w-full text-right border border-slate-100 rounded p-1 text-xs font-mono bg-slate-50 text-slate-400 cursor-not-allowed" />
                          </td>
                          {/* Delete row */}
                          <td className="p-1.5 text-center">
                            <button type="button" onClick={() => removeGridRow(idx)} disabled={gridItems.length === 1}
                              className="text-red-500 hover:text-red-700 hover:bg-red-50 p-1.5 rounded transition-all disabled:opacity-30">
                              <Trash2 className="w-3.5 h-3.5 mx-auto" />
                            </button>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>

              {/* ── Section 3: Financials ── */}
              <div className="bg-slate-50 border border-slate-200/80 rounded-xl p-5 space-y-4">
                <h3 className="text-xs font-bold uppercase tracking-wider text-slate-500 border-b border-slate-200 pb-1.5">
                  3. Financial Summary
                </h3>
                <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-end">

                  {/* Left: input fields */}
                  <div className="lg:col-span-6 grid grid-cols-2 sm:grid-cols-3 gap-4">
                    <div>
                      <label className="form-label text-xs font-semibold text-slate-700 mb-1 block">F.Cess (₹)</label>
                      <input type="number" min="0" value={fCess} onChange={(e) => setFCess(e.target.value)}
                        placeholder="0.00" className="input-enterprise font-mono text-xs w-full" />
                    </div>
                    <div>
                      <label className="form-label text-xs font-semibold text-slate-700 mb-1 block">Discount (₹)</label>
                      <input type="number" min="0" value={discount} onChange={(e) => setDiscount(e.target.value)}
                        placeholder="0.00" className="input-enterprise font-mono text-xs w-full" />
                    </div>
                    <div>
                      <label className="form-label text-xs font-semibold text-slate-700 mb-1 block">Comm. (₹)</label>
                      <input type="number" min="0" value={commission} onChange={(e) => setCommission(e.target.value)}
                        placeholder="0.00" className="input-enterprise font-mono text-xs w-full" />
                    </div>
                    <div>
                      <label className="form-label text-xs font-semibold text-slate-700 mb-1 block">{TRAVEL_EXPENSE_LABEL} (₹)</label>
                      <input type="number" min="0" value={postage} onChange={(e) => setPostage(e.target.value)}
                        placeholder="Extra delivery / travel charge" className="input-enterprise font-mono text-xs w-full" />
                    </div>
                    <div>
                      <label className="form-label text-xs font-semibold text-slate-700 mb-1 block">Payment Mode</label>
                      <select value={paymentMode} onChange={(e) => setPaymentMode(e.target.value)}
                        className="input-enterprise bg-white cursor-pointer text-xs">
                        {PAYMENT_MODES.map((m) => <option key={m} value={m}>{m}</option>)}
                      </select>
                    </div>
                    <div>
                      <label className="form-label text-xs font-semibold text-slate-700 mb-1 block">
                        Payment (₹)
                        <span className="ml-1 text-[10px] text-green-500 font-normal">(auto-filled · editable)</span>
                      </label>
                      <input type="number" min="0" value={paymentAmount} onChange={(e) => setPaymentAmount(e.target.value)}
                        placeholder="Amount received" className="input-enterprise font-mono text-xs w-full text-green-700 font-bold" />
                    </div>
                  </div>

                  {/* Right: live summary panel */}
                  <div className="lg:col-span-6 bg-white border border-slate-200 rounded-xl p-4 space-y-2 text-xs">
                    <h4 className="text-[10px] font-bold uppercase tracking-wider text-slate-400 pb-1 border-b border-slate-100">Bill Summary</h4>
                    <div className="flex justify-between text-slate-600 font-semibold border-b border-slate-100 pb-1.5">
                      <span>Items Total (qty × unit price − line disc + GST):</span>
                      <span className="font-mono">{formatCurrency(calc.linesTotal)}</span>
                    </div>
                    <div className="flex justify-between text-slate-500 text-[10px]">
                      <span>Taxable subtotal:</span>
                      <span className="font-mono">{formatCurrency(calc.subtotal)}</span>
                    </div>
                    <div className="flex justify-between text-slate-500">
                      <span>F.Cess (+):</span>
                      <span className="font-mono">+{formatCurrency(Number(fCess) || 0)}</span>
                    </div>
                    <div className="flex justify-between text-red-600">
                      <span>Discount (–):</span>
                      <span className="font-mono">–{formatCurrency(Number(discount) || 0)}</span>
                    </div>
                    <div className="flex justify-between text-amber-600 border-b border-slate-100 pb-1.5">
                      <span>GST (recalculated from edited unit price):</span>
                      <span className="font-mono">+{formatCurrency(calc.totalGst)}</span>
                    </div>
                    <div className="flex justify-between text-slate-500">
                      <span>Comm. (+):</span>
                      <span className="font-mono">+{formatCurrency(Number(commission) || 0)}</span>
                    </div>
                    <div className="flex justify-between text-slate-500">
                      <span>{TRAVEL_EXPENSE_LABEL} (+):</span>
                      <span className="font-mono">+{formatCurrency(Number(postage) || 0)}</span>
                    </div>
                    <div className="flex justify-between text-slate-400 text-[10px] italic">
                      <span>Round Off:</span>
                      <span className="font-mono">{calc.roundOff >= 0 ? "+" : ""}{formatCurrency(calc.roundOff)}</span>
                    </div>
                    <div className="flex justify-between text-sm font-bold text-slate-900 border-t border-slate-200 pt-2">
                      <span>Grand Total:</span>
                      <span className="font-mono text-base text-green-700">{formatCurrency(calc.grandTotal)}</span>
                    </div>
                    <div className="flex justify-between text-xs font-semibold border-t border-dashed border-slate-100 pt-1.5">
                      <span className="text-slate-500">Payment:</span>
                      <span className="font-mono text-green-700">{formatCurrency(Number(paymentAmount) || 0)}</span>
                    </div>
                    <div className="flex justify-between text-xs font-semibold">
                      <span className="text-slate-500">Balance:</span>
                      <span className={`font-mono ${Math.max(0, calc.grandTotal - (Number(paymentAmount) || 0)) > 0 ? "text-red-600" : "text-green-600"}`}>
                        {formatCurrency(Math.max(0, calc.grandTotal - (Number(paymentAmount) || 0)))}
                      </span>
                    </div>
                  </div>
                </div>
              </div>

              {/* Action Buttons */}
              <div className="flex items-center justify-end gap-3 pt-4 border-t border-slate-200 sticky bottom-0 bg-white z-10 p-2">
                <button type="button" onClick={resetForm}
                  className="btn-secondary px-5 py-2 hover:bg-slate-50 border border-slate-300 text-slate-700 text-xs font-semibold rounded">
                  Clear &amp; Cancel
                </button>
                <button type="submit"
                  className="btn-primary bg-green-600 hover:bg-green-700 active:bg-green-800 px-6 py-2 text-white text-xs font-bold rounded shadow-md flex items-center gap-1.5">
                  <Printer className="w-4 h-4" />
                  {editingSale ? "Save &amp; Update Bill" : "Save &amp; Print Bill"}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* ══════════════════════════════════════════════════════════════════
          VIEW SALE DETAILS MODAL
      ══════════════════════════════════════════════════════════════════ */}
      {viewingSale && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/40 backdrop-blur-[2px]">
          <div className="absolute inset-0" onClick={() => setViewingSale(null)} />
          <div className="bg-white border border-slate-200 rounded-xl shadow-2xl relative max-w-4xl w-full z-10 flex flex-col font-sans max-h-[90vh] overflow-y-auto animate-in fade-in zoom-in-95 duration-150">

            {/* Header */}
            <div className="bg-slate-950 px-6 py-4 text-white rounded-t-xl flex items-center justify-between sticky top-0 shadow-md">
              <div>
                <h2 className="text-sm font-bold tracking-tight">Sales Bill Details</h2>
                <p className="text-[10px] text-slate-300 mt-0.5">Bill No: {viewingSale.bill_no}</p>
              </div>
              <button type="button" onClick={() => setViewingSale(null)} aria-label="Close"
                className="text-slate-300 hover:text-white p-1.5 rounded-lg hover:bg-white/10 transition-colors">
                <X className="w-4 h-4" />
              </button>
            </div>

            <div className="p-6 space-y-6">
              {/* Meta grid */}
              <div className="grid grid-cols-2 md:grid-cols-4 gap-x-6 gap-y-3 text-xs bg-slate-50 border border-slate-100 p-4 rounded-xl">
                {[
                  ["Bill No.", viewingSale.bill_no],
                  ["Form Type", viewingSale.form_type],
                  ["Date", formatTableDate(viewingSale.bill_date)],
                  ["Rate TP", viewingSale.rate_tp],
                  ["Customer", viewingSale.customer_name],
                  ["Phone", viewingSale.customer_phone || "—"],
                  ["Ship To", viewingSale.ship_to || "—"],
                  ["Vehicle No.", viewingSale.vehicle_no || "—"],
                  ["Salesman", viewingSale.salesman || "—"],
                  ["Branch/Godown", viewingSale.branch_godown],
                  ["Payment Mode", viewingSale.payment_mode],
                  ["Payment Status", viewingSale.payment_status],
                ].map(([label, val]) => (
                  <div key={label}>
                    <span className="text-[10px] font-bold text-slate-400 uppercase tracking-wider block">{label}</span>
                    <span className="font-semibold text-slate-800">{val}</span>
                  </div>
                ))}
              </div>

              {/* Items table */}
              <div>
                <h4 className="text-xs font-bold text-slate-800 uppercase tracking-wider mb-2">Item Details</h4>
                <div className="border border-slate-200 rounded-xl overflow-hidden">
                  <table className="w-full text-xs text-left border-collapse">
                    <thead>
                      <tr className="bg-slate-100 border-b border-slate-200 font-semibold text-slate-700">
                        <th className="p-2">Code</th>
                        <th className="p-2">Name</th>
                        <th className="p-2 text-center">Qty</th>
                        <th className="p-2 text-center">Unit</th>
                        <th className="p-2 text-right">MRP (₹)</th>
                        <th className="p-2 text-right">Amount (₹)</th>
                        <th className="p-2 text-center">Dis%</th>
                        <th className="p-2 text-center">SGST%</th>
                        <th className="p-2 text-center">CGST%</th>
                        <th className="p-2 text-center">HSN</th>
                        <th className="p-2 text-right text-slate-400">Cost Rate</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-100">
                      {viewingSale.items.map((item, i) => {
                        const mrpAmt  = item.qty * item.mrp;
                        const discAmt = mrpAmt * ((item.disc_pct || 0) / 100);
                        const taxable = Math.max(0, mrpAmt - discAmt);
                        const gst = taxable * (((item.sgst ?? 0) + (item.cgst ?? 0)) / 100);
                        return (
                          <tr key={i} className="hover:bg-slate-50/30">
                            <td className="p-2 font-mono font-semibold">{item.code || "—"}</td>
                            <td className="p-2">{item.name}</td>
                            <td className="p-2 text-center font-mono">{item.qty}</td>
                            <td className="p-2 text-center">{item.unit}</td>
                            <td className="p-2 text-right font-mono font-semibold">{formatCurrency(item.mrp)}</td>
                            <td className="p-2 text-right font-mono">{formatCurrency(mrpAmt)}</td>
                            <td className="p-2 text-center text-red-500">{item.disc_pct ?? 0}%</td>
                            <td className="p-2 text-center text-amber-600">{item.sgst ?? 0}%</td>
                            <td className="p-2 text-center text-amber-600">{item.cgst ?? 0}%</td>
                            <td className="p-2 text-center font-mono text-slate-500">{item.hsn_code || "—"}</td>
                            <td className="p-2 text-right font-mono text-slate-400">{item.rate ? formatCurrency(item.rate) : "—"}</td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              </div>

              {/* Totals */}
              <div className="flex justify-end">
                <div className="w-72 space-y-1.5 text-xs text-slate-600 border-t border-slate-200 pt-3">
                  <div className="flex justify-between font-semibold text-slate-700 border-b border-slate-100 pb-1.5">
                    <span>Subtot. &amp; F.Cess:</span>
                    <span className="font-mono">{formatCurrency(viewingSale.subtotal + viewingSale.f_cess)}</span>
                  </div>
                  <div className="flex justify-between text-red-600">
                    <span>Discount (–):</span>
                    <span className="font-mono">–{formatCurrency(viewingSale.discount)}</span>
                  </div>
                  <div className="flex justify-between text-amber-600">
                    <span>GST &amp; Cess:</span>
                    <span className="font-mono">+{formatCurrency(viewingSale.total_gst)}</span>
                  </div>
                  <div className="flex justify-between text-slate-500">
                    <span>Comm.:</span>
                    <span className="font-mono">+{formatCurrency(viewingSale.commission)}</span>
                  </div>
                  <div className="flex justify-between text-slate-500">
                    <span>{TRAVEL_EXPENSE_LABEL}:</span>
                    <span className="font-mono">+{formatCurrency(viewingSale.postage)}</span>
                  </div>
                  <div className="flex justify-between text-slate-400 text-[10px] italic">
                    <span>Round Off:</span>
                    <span className="font-mono">{viewingSale.round_off >= 0 ? "+" : ""}{formatCurrency(viewingSale.round_off)}</span>
                  </div>
                  <div className="flex justify-between text-sm font-bold text-slate-900 border-t border-slate-200 pt-2">
                    <span>Grand Total:</span>
                    <span className="font-mono text-green-700">{formatCurrency(viewingSale.grand_total)}</span>
                  </div>
                  <div className="flex justify-between text-green-700 font-semibold">
                    <span>Payment:</span>
                    <span className="font-mono">{formatCurrency(viewingSale.payment_amount)}</span>
                  </div>
                  <div className="flex justify-between border-t border-dashed border-slate-200 pt-2">
                    <span className="text-slate-500">Balance:</span>
                    <span className={`font-mono font-semibold ${viewingSale.balance > 0 ? "text-red-600" : "text-green-600"}`}>
                      {formatCurrency(viewingSale.balance)}
                    </span>
                  </div>
                </div>
              </div>
            </div>

            {/* Footer */}
            <div className="flex items-center justify-end gap-3 border-t border-slate-200 bg-slate-50 p-4 rounded-b-xl sticky bottom-0">
              <button type="button" onClick={() => handlePrintInvoice(viewingSale)}
                className="btn-secondary px-4 py-2 font-semibold text-xs border border-slate-300 text-slate-700 hover:bg-slate-100 rounded flex items-center gap-1.5">
                <Printer className="w-3.5 h-3.5" /> Print Bill
              </button>
              <button type="button" onClick={() => setViewingSale(null)}
                className="btn-primary bg-slate-950 hover:bg-slate-800 px-6 py-2 font-bold text-white rounded text-xs">
                Close
              </button>
            </div>
          </div>
        </div>
      )}

    </div>
  );
}
