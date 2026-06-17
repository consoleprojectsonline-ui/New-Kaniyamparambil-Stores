import { useState, useEffect, useCallback } from "react";
import html2canvas from "html2canvas";
import { jsPDF } from "jspdf";
import {
  Boxes,
  Plus,
  Search,
  Filter,
  Trash2,
  AlertTriangle,
  FolderOpen,
  Check,
  Database,
  X,
  Eye,
  Download,
  Printer,
  Edit,
  FileText,
} from "lucide-react";
import { supabase } from "@/lib/supabase";

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

const PREDEFINED_GROUPS = [
  "Electrical",
  "Plumbing",
  "Tools",
  "Safety",
  "Hardware",
  "Others",
];

const PREDEFINED_SUBGROUPS = [
  "Conduit Pipes",
  "Fittings",
  "LED Bulbs",
  "Wires & Cables",
  "Switches & Sockets",
  "Distribution Boards",
  "PVC Pipes",
  "CPVC Fittings",
  "Ball Valves",
  "Taps & Showers",
  "Hand Tools",
  "Power Tools",
  "Drill Bits",
  "Safety Helmets",
  "Gloves & Goggles",
  "Screws & Nails",
  "Wall Plugs",
  "Adhesives",
  "Paint Brushes",
  "Abrasive Papers",
  "Fasteners",
  "Anchors",
  "Couplings",
  "Elbows & Tees",
  "Others",
];

const DEFAULT_UOMS = ["Nos", "Mtr", "Feet", "Sq. Feet", "Inch", "Kg", "Ltr"];

const INVENTORY_STORE_DETAILS = {
  storeName: "NEW KANIYAMPARAMBIL STORES",
  location: "THOPRAMKUDY PO, THOPRAMKUDY, KERALA",
  gstin: "32AWJPJ1371N1ZE",
  phone: "9544363171",
  email: "newkaniyamparambilstorestkdy@gmail.com",
} as const;

type InventoryDocOptions = {
  autoPrint?: boolean;
  helperText?: string;
  renderMode?: "print" | "pdf";
};

const INVENTORY_FRAME_STYLE: Partial<CSSStyleDeclaration> = {
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

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
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

function todayIso(): string {
  return new Date().toISOString().split("T")[0];
}

function itemRegisteredDate(item: InventoryItem): string | null {
  if (!item.created_at) return null;
  const d = new Date(item.created_at);
  if (Number.isNaN(d.getTime())) return null;
  const yr = d.getFullYear();
  const mo = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${yr}-${mo}-${day}`;
}

function filterItemsByDate(items: InventoryItem[], date: string): InventoryItem[] {
  return items.filter((item) => itemRegisteredDate(item) === date);
}

function filterItemsByMonth(items: InventoryItem[], monthYm: string): InventoryItem[] {
  return items.filter((item) => itemRegisteredDate(item)?.slice(0, 7) === monthYm);
}

function filterItemsByRange(items: InventoryItem[], from: string, to: string): InventoryItem[] {
  return items.filter((item) => {
    const d = itemRegisteredDate(item);
    if (!d) return false;
    return d >= from && d <= to;
  });
}

function formatMonthLabel(monthYm: string): string {
  const [year, month] = monthYm.split("-");
  const d = new Date(Number(year), Number(month) - 1, 1);
  if (Number.isNaN(d.getTime())) return monthYm;
  return new Intl.DateTimeFormat("en-GB", { month: "long", year: "numeric" }).format(d);
}

type InventoryReportMode = "full" | "date" | "month" | "range" | "current";

type InventoryStatementMeta = {
  reportTitle: string;
  periodLabel: string;
  reportType: string;
  groupFilter: string;
  searchQuery: string;
  generatedOn: string;
  totalStock: number;
  groupCount: number;
};

function buildInventoryStatementHtml(
  items: InventoryItem[],
  meta: InventoryStatementMeta,
  options: InventoryDocOptions = {},
): string {
  const store = INVENTORY_STORE_DETAILS;
  const isPdfMode = options.renderMode === "pdf";

  const rowMarkup = items.map((item, index) => `
    <tr>
      <td class="col-index">${index + 1}</td>
      <td class="col-date">${escapeHtml(itemRegisteredDate(item) ? formatReportDate(itemRegisteredDate(item)!) : "—")}</td>
      <td class="col-code">${escapeHtml(item.code)}</td>
      <td class="col-name">${escapeHtml(item.name)}</td>
      <td class="col-co">${escapeHtml(item.company_code || "—")}</td>
      <td class="col-group">${escapeHtml(item.group)}</td>
      <td class="col-sub">${escapeHtml(item.sub_group || "—")}</td>
      <td class="col-brand">${escapeHtml(item.brand || "—")}</td>
      <td class="col-type">${escapeHtml(item.type || "—")}</td>
      <td class="col-hsn">${escapeHtml(item.hsn_code || "—")}</td>
      <td class="col-uom">${escapeHtml(item.uom)}</td>
      <td class="col-batch">${escapeHtml(item.enable_batch)}</td>
      <td class="col-stock align-right">${escapeHtml(String(item.stock_qty ?? 0))}</td>
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
        .inventory-toolbar {
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
        .inventory-sheet {
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
          letter-spacing: 0.05em;
          padding: ${isPdfMode ? "7px 8px" : "10px"};
          border-bottom: 1px solid #000;
        }
        .period-banner {
          text-align: center;
          font-weight: 700;
          padding: ${isPdfMode ? "5px 8px" : "8px 12px"};
          border-bottom: 1px solid #000;
          background: #eff6ff;
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
          background: #dbeafe;
          font-weight: 700;
          text-align: center;
        }
        .col-index { width: 20px; text-align: center; }
        .col-date { width: 52px; text-align: center; white-space: nowrap; }
        .col-code { width: 44px; font-family: monospace; }
        .col-name { min-width: 90px; }
        .col-co { width: 44px; font-family: monospace; font-size: ${isPdfMode ? "7px" : "10px"}; }
        .col-group, .col-sub, .col-brand { width: 48px; }
        .col-type { width: 36px; text-align: center; }
        .col-hsn { width: 46px; text-align: center; font-family: monospace; }
        .col-uom { width: 30px; text-align: center; }
        .col-batch { width: 28px; text-align: center; }
        .col-stock { width: 36px; }
        .align-right { text-align: right; }
        .summary-grid {
          display: grid;
          grid-template-columns: 1fr 1fr 1fr;
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
          .inventory-toolbar { display: none; }
          .inventory-sheet { width: 100%; border: none; }
        }
      </style>
    </head>
    <body>
      <div class="inventory-toolbar">
        <p class="toolbar-text">${escapeHtml(options.helperText || "Use Print / Save as PDF from your browser.")}</p>
        <div class="toolbar-actions">
          <button class="toolbar-btn" onclick="window.close()">Close</button>
          <button class="toolbar-btn primary" onclick="window.print()">Print / Save PDF</button>
        </div>
      </div>

      <div class="inventory-sheet">
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
            <div class="meta-line"><b>Group Filter:</b> ${escapeHtml(meta.groupFilter)}</div>
            <div class="meta-line"><b>Search:</b> ${escapeHtml(meta.searchQuery || "—")}</div>
          </div>
          <div>
            <div class="meta-label">Generated</div>
            <div class="meta-line"><b>Date:</b> ${escapeHtml(meta.generatedOn)}</div>
            <div class="meta-line"><b>Items:</b> ${items.length}</div>
            <div class="meta-line"><b>Categories:</b> ${meta.groupCount}</div>
          </div>
        </div>

        <table class="statement-table">
          <thead>
            <tr>
              <th>#</th>
              <th>Reg. Date</th>
              <th>Code</th>
              <th>Product Name</th>
              <th>Co. Ref</th>
              <th>Group</th>
              <th>Sub-Group</th>
              <th>Brand</th>
              <th>Type</th>
              <th>HSN</th>
              <th>UOM</th>
              <th>Batch</th>
              <th>Stock</th>
            </tr>
          </thead>
          <tbody>${rowMarkup || `<tr><td colspan="13" style="text-align:center;padding:12px;">No inventory records for this statement period.</td></tr>`}</tbody>
        </table>

        <div class="summary-grid">
          <div class="summary-box">Total Items Listed<b>${items.length}</b></div>
          <div class="summary-box">Total Stock Quantity<b>${meta.totalStock}</b></div>
          <div class="summary-box">Product Groups<b>${meta.groupCount}</b></div>
        </div>

        <div class="footer-note">
          This inventory statement is computer-generated and lists catalog items with registration dates, classifications, and stock quantities.
          Items without a registration date are excluded from date/month/range statements.
        </div>

        <div class="signatory">
          <div>${escapeHtml(store.storeName)}</div>
          <div>Authorized Inventory Signatory</div>
        </div>
      </div>
    </body>
  </html>`;
}

function buildStatementMeta(
  items: InventoryItem[],
  reportType: string,
  periodLabel: string,
  groupFilter: string,
  searchQuery: string,
): InventoryStatementMeta {
  const totalStock = items.reduce((sum, item) => sum + (item.stock_qty ?? 0), 0);
  const groupCount = new Set(items.map((item) => item.group)).size;
  return {
    reportTitle: "INVENTORY STATEMENT / STOCK REGISTER",
    periodLabel,
    reportType,
    groupFilter,
    searchQuery,
    generatedOn: formatReportDate(),
    totalStock,
    groupCount,
  };
}

function buildInventoryItemHtml(item: InventoryItem, options: InventoryDocOptions = {}): string {
  const store = INVENTORY_STORE_DETAILS;
  const isPdfMode = options.renderMode === "pdf";
  const generatedOn = formatReportDate(item.created_at);

  const specRows = [
    { label: "Item Code", value: item.code },
    { label: "Product Name / Print Description", value: item.name },
    { label: "Company Code Reference", value: item.company_code || "—" },
    { label: "Product Group Category", value: item.group },
    { label: "Sub-Group Segment", value: item.sub_group || "—" },
    { label: "Brand Name", value: item.brand || "—" },
    { label: "Product Compliance Type", value: item.type },
    { label: "HSN Code", value: item.hsn_code || "—" },
    { label: "Unit of Measurement (UOM)", value: item.uom },
    { label: "Batch Tracking Enabled", value: item.enable_batch === "Y" ? "Yes" : "No" },
    { label: "Current Stock Qty", value: String(item.stock_qty ?? 0) },
  ];

  const rowMarkup = specRows.map((row) => `
    <tr>
      <td class="spec-label">${escapeHtml(row.label)}</td>
      <td class="spec-value">${escapeHtml(row.value)}</td>
    </tr>
  `).join("");

  return `<!DOCTYPE html>
  <html lang="en">
    <head>
      <meta charset="UTF-8" />
      <title>Product Sheet ${escapeHtml(item.code)}</title>
      <style>
        * { box-sizing: border-box; }
        body {
          margin: 0;
          background: ${isPdfMode ? "#fff" : "#f3f4f6"};
          font-family: Arial, Helvetica, sans-serif;
          color: #111;
          font-size: ${isPdfMode ? "9px" : "12px"};
          line-height: 1.35;
          padding: ${isPdfMode ? "0" : "20px"};
        }
        .inventory-toolbar {
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
        .inventory-sheet {
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
          letter-spacing: 0.05em;
          padding: ${isPdfMode ? "7px 8px" : "10px"};
          border-bottom: 1px solid #000;
        }
        .meta-grid {
          display: grid;
          grid-template-columns: 1fr 1fr;
          border-bottom: 1px solid #000;
        }
        .meta-grid > div {
          padding: ${isPdfMode ? "6px 8px" : "10px 12px"};
          border-right: 1px solid #000;
        }
        .meta-grid > div:nth-child(2n) { border-right: none; }
        .meta-label { font-weight: 700; margin-bottom: 2px; }
        .meta-line { margin-bottom: 2px; }
        .spec-table {
          width: 100%;
          border-collapse: collapse;
        }
        .spec-table td {
          border: 1px solid #000;
          padding: ${isPdfMode ? "5px 7px" : "8px 10px"};
          vertical-align: top;
        }
        .spec-label {
          width: 38%;
          font-weight: 700;
          background: #eff6ff;
        }
        .spec-value {
          font-weight: 600;
        }
        .footer-note {
          border-top: 1px solid #000;
          padding: ${isPdfMode ? "6px 8px" : "10px 12px"};
          font-size: ${isPdfMode ? "8px" : "10px"};
          color: #444;
        }
        .signatory {
          border-top: 1px solid #000;
          padding: ${isPdfMode ? "8px 8px 10px" : "12px 10px 16px"};
          text-align: right;
          font-weight: 700;
        }
        .signatory .role {
          font-size: ${isPdfMode ? "8px" : "11px"};
          font-weight: 600;
          color: #333;
        }
        @page { size: A4; margin: 10mm; }
        @media print {
          body { background: #fff; padding: 0; }
          .inventory-toolbar { display: none; }
          .inventory-sheet { width: 100%; border: none; }
        }
      </style>
    </head>
    <body>
      <div class="inventory-toolbar">
        <p class="toolbar-text">${escapeHtml(options.helperText || "Use Print / Save as PDF from your browser.")}</p>
        <div class="toolbar-actions">
          <button class="toolbar-btn" onclick="window.close()">Close</button>
          <button class="toolbar-btn primary" onclick="window.print()">Print / Save PDF</button>
        </div>
      </div>

      <div class="inventory-sheet">
        <div class="doc-title">PRODUCT SPECIFICATION SHEET</div>

        <div class="meta-grid">
          <div>
            <div class="meta-label">${escapeHtml(store.storeName)}</div>
            <div class="meta-line">${escapeHtml(store.location)}</div>
            <div class="meta-line"><b>GSTIN:</b> ${escapeHtml(store.gstin)}</div>
            <div class="meta-line"><b>Mobile:</b> ${escapeHtml(store.phone)}</div>
          </div>
          <div>
            <div class="meta-label">Catalog Reference</div>
            <div class="meta-line"><b>Item Code:</b> ${escapeHtml(item.code)}</div>
            <div class="meta-line"><b>Generated On:</b> ${escapeHtml(generatedOn)}</div>
            <div class="meta-line"><b>Report Type:</b> Single Product Sheet</div>
          </div>
        </div>

        <table class="spec-table">${rowMarkup}</table>

        <div class="footer-note">
          This document is generated from the inventory catalog for internal reference and customer quotation support.
        </div>

        <div class="signatory">
          <div>${escapeHtml(store.storeName)}</div>
          <div class="role">Authorized Catalog Signatory</div>
        </div>
      </div>

      <script>
        ${options.autoPrint ? "window.addEventListener('load', () => { setTimeout(() => window.print(), 300); });" : ""}
      </script>
    </body>
  </html>`;
}

async function waitForInventoryFrame(html: string): Promise<HTMLIFrameElement> {
  const iframe = document.createElement("iframe");
  Object.assign(iframe.style, INVENTORY_FRAME_STYLE);
  iframe.setAttribute("aria-hidden", "true");
  document.body.appendChild(iframe);

  const frameDocument = iframe.contentDocument;
  if (!frameDocument) {
    iframe.remove();
    throw new Error("Unable to prepare the inventory document.");
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
        reject(new Error("Inventory preview took too long to load."));
        return;
      }
      window.setTimeout(checkReady, 50);
    };
    checkReady();
  });

  const sheet = iframe.contentDocument?.querySelector(".inventory-sheet");
  if (sheet instanceof HTMLElement) {
    iframe.style.height = `${sheet.scrollHeight + 40}px`;
  }

  await new Promise((resolve) => window.setTimeout(resolve, 120));
  return iframe;
}

async function exportInventoryPdf(html: string, filename: string, singlePage = false): Promise<void> {
  let iframe: HTMLIFrameElement | null = null;
  try {
    iframe = await waitForInventoryFrame(html);
    const sheet = iframe.contentDocument?.querySelector(".inventory-sheet");
    if (!(sheet instanceof HTMLElement)) {
      throw new Error("Unable to prepare the inventory layout for PDF export.");
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

    if (singlePage) {
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

async function printInventoryHtml(html: string): Promise<void> {
  let iframe: HTMLIFrameElement | null = null;
  try {
    iframe = await waitForInventoryFrame(html);
    const printWindow = iframe.contentWindow;
    if (!printWindow) throw new Error("Unable to open the print dialog.");
    printWindow.focus();
    printWindow.print();
  } finally {
    window.setTimeout(() => iframe?.remove(), 1200);
  }
}

export default function InventoryPage() {
  const [items, setItems] = useState<InventoryItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [isFormOpen, setIsFormOpen] = useState(false);
  const [dbStatus, setDbStatus] = useState<"connected" | "local">("connected");
  const [editingItem, setEditingItem] = useState<InventoryItem | null>(null);

  // Search & Filter state
  const [searchQuery, setSearchQuery] = useState("");
  const [selectedGroup, setSelectedGroup] = useState<string>("All");
  const [currentPage, setCurrentPage] = useState(1);
  const itemsPerPage = 10;

  // Reset pagination to page 1 on search or group filter change
  useEffect(() => {
    const timer = setTimeout(() => {
      setCurrentPage(1);
    }, 0);
    return () => clearTimeout(timer);
  }, [searchQuery, selectedGroup]);

  // Form states
  const [code, setCode] = useState("");
  const [name, setName] = useState("");
  const [companyCode, setCompanyCode] = useState("");
  const [group, setGroup] = useState("Electrical");
  const [customGroup, setCustomGroup] = useState("");
  const [isCustomGroup, setIsCustomGroup] = useState(false);
  const [subGroup, setSubGroup] = useState("Conduit Pipes");
  const [customSubGroup, setCustomSubGroup] = useState("");
  const [isCustomSubGroup, setIsCustomSubGroup] = useState(false);
  const [brand, setBrand] = useState("");
  const [type, setType] = useState("Goods");
  const [hsnCode, setHsnCode] = useState("");
  const [uom, setUom] = useState("Nos");
  const [customUom, setCustomUom] = useState("");
  const [isCustomUom, setIsCustomUom] = useState(false);
  const [enableBatch, setEnableBatch] = useState("N");

  const [formError, setFormError] = useState<string | null>(null);
  const [successMsg, setSuccessMsg] = useState<string | null>(null);
  const [isConfirmOpen, setIsConfirmOpen] = useState(false);
  const [confirmedItem, setConfirmedItem] = useState<{ name: string; code: string } | null>(null);
  const [viewingItem, setViewingItem] = useState<InventoryItem | null>(null);
  const [isReportModalOpen, setIsReportModalOpen] = useState(false);
  const [reportMode, setReportMode] = useState<InventoryReportMode>("full");
  const [reportDate, setReportDate] = useState(todayIso);
  const [reportMonth, setReportMonth] = useState(() => todayIso().slice(0, 7));
  const [reportFrom, setReportFrom] = useState(todayIso);
  const [reportTo, setReportTo] = useState(todayIso);
  const [reportError, setReportError] = useState<string | null>(null);

  const loadLocalItems = useCallback(() => {
    const local = localStorage.getItem("kaniyamparambil_inventory");
    if (local) {
      try {
        setItems(JSON.parse(local));
      } catch {
        setItems([]);
      }
    } else {
      // Seed some starter premium catalog mock data
      const seed: InventoryItem[] = [
        {
          code: "ITM-001",
          name: "Premium Steel Conduit Pipe 1/2\"",
          company_code: "CO-STEEL-99",
          group: "Metal",
          sub_group: "Conduits",
          brand: "Jindal Steel",
          type: "Goods",
          hsn_code: "73063090",
          uom: "Mtr",
          enable_batch: "N",
        },
        {
          code: "ITM-002",
          name: "Heavy Duty PVC Bend 25mm",
          company_code: "CO-POLY-10",
          group: "Plastic",
          sub_group: "Fittings",
          brand: "Supreme",
          type: "Goods",
          hsn_code: "39174000",
          uom: "Nos",
          enable_batch: "N",
        },
        {
          code: "ITM-003",
          name: "Copper Wire 1.5 Sq. mm (Green)",
          company_code: "CO-ELECT-44",
          group: "Others",
          sub_group: "Cables",
          brand: "Finolex",
          type: "Goods",
          hsn_code: "85444990",
          uom: "Mtr",
          enable_batch: "N",
        },
      ];
      localStorage.setItem("kaniyamparambil_inventory", JSON.stringify(seed));
      setItems(seed);
    }
  }, []);

  const fetchItems = useCallback(async () => {
    try {
      setLoading(true);
      const { data, error } = await supabase
        .from("inventory")
        .select("*")
        .order("created_at", { ascending: false });

      if (error) {
        // Table not found error
        if (error.code === "PGRST116" || error.message.includes("relation") || error.message.includes("does not exist")) {
          setDbStatus("local");
          loadLocalItems();
        } else {
          console.error("Supabase load error:", error);
          setDbStatus("local");
          loadLocalItems();
        }
      } else if (data) {
        setItems(data);
        setDbStatus("connected");
      }
    } catch (err) {
      console.error("Failed to connect to Supabase database:", err);
      setDbStatus("local");
      loadLocalItems();
    } finally {
      setLoading(false);
    }
  }, [loadLocalItems]);

  useEffect(() => {
    const timer = setTimeout(() => {
      fetchItems();
    }, 0);
    return () => clearTimeout(timer);
  }, [fetchItems]);

  // Add Item
  // Add / Edit Item Submit Handler
  const handleSubmitForm = async (e: React.FormEvent) => {
    e.preventDefault();
    setFormError(null);
    setSuccessMsg(null);

    if (!code.trim() || !name.trim()) {
      setFormError("Code and Product Name are required.");
      return;
    }

    const itemGroup = isCustomGroup ? customGroup.trim() : group;
    const itemSubGroup = isCustomSubGroup ? customSubGroup.trim() : subGroup;
    const itemUom = isCustomUom ? customUom.trim() : uom;

    if (!itemGroup) {
      setFormError("Product Group is required.");
      return;
    }
    if (!itemSubGroup) {
      setFormError("Product Sub-Group is required.");
      return;
    }
    if (!itemUom) {
      setFormError("Unit of Measurement (UOM) is required.");
      return;
    }

    const newItem: InventoryItem = {
      code: code.trim(),
      name: name.trim(),
      company_code: companyCode.trim(),
      group: itemGroup,
      sub_group: itemSubGroup,
      brand: brand.trim(),
      type: type,
      hsn_code: hsnCode.trim(),
      uom: itemUom,
      enable_batch: enableBatch,
    };

    if (editingItem) {
      // UPDATE MODE
      if (dbStatus === "connected") {
        try {
          const { error } = await supabase
            .from("inventory")
            .update(newItem)
            .eq("code", editingItem.code);
          if (error) throw error;
          
          setConfirmedItem({ name: newItem.name, code: newItem.code });
          setIsConfirmOpen(true);
          fetchItems();
          resetForm();
        } catch (err) {
          console.error("Failed to update in Supabase:", err);
          const errMsg = err instanceof Error ? err.message : "Could not update item.";
          setFormError(`Supabase error: ${errMsg}`);
        }
      } else {
        // Local storage update path
        const updated = items.map((i) => (i.code === editingItem.code ? newItem : i));
        localStorage.setItem("kaniyamparambil_inventory", JSON.stringify(updated));
        setItems(updated);
        setConfirmedItem({ name: newItem.name, code: newItem.code });
        setIsConfirmOpen(true);
        resetForm();
      }
    } else {
      // CREATE MODE
      if (items.some((i) => i.code === newItem.code)) {
        setFormError(`Item code '${newItem.code}' is already registered.`);
        return;
      }

      if (dbStatus === "connected") {
        try {
          const { error } = await supabase.from("inventory").insert([newItem]);
          if (error) throw error;
          
          setConfirmedItem({ name: newItem.name, code: newItem.code });
          setIsConfirmOpen(true);
          fetchItems();
          resetForm();
        } catch (err) {
          console.error("Failed to insert into Supabase:", err);
          const errMsg = err instanceof Error ? err.message : "Could not insert item.";
          setFormError(`Supabase error: ${errMsg}`);
        }
      } else {
        const updated = [newItem, ...items];
        localStorage.setItem("kaniyamparambil_inventory", JSON.stringify(updated));
        setItems(updated);
        setConfirmedItem({ name: newItem.name, code: newItem.code });
        setIsConfirmOpen(true);
        resetForm();
      }
    }
  };

  const handleStartEdit = (item: InventoryItem) => {
    setEditingItem(item);
    setCode(item.code);
    setName(item.name);
    setCompanyCode(item.company_code || "");
    
    // Set group
    if (PREDEFINED_GROUPS.includes(item.group)) {
      setGroup(item.group);
      setIsCustomGroup(false);
    } else {
      setGroup("Others");
      setCustomGroup(item.group);
      setIsCustomGroup(true);
    }

    // Set subgroup
    if (PREDEFINED_SUBGROUPS.includes(item.sub_group)) {
      setSubGroup(item.sub_group);
      setIsCustomSubGroup(false);
    } else {
      setSubGroup("Others");
      setCustomSubGroup(item.sub_group);
      setIsCustomSubGroup(true);
    }

    setBrand(item.brand || "");
    setType(item.type);
    setHsnCode(item.hsn_code || "");

    // Set UOM
    if (DEFAULT_UOMS.includes(item.uom)) {
      setUom(item.uom);
      setIsCustomUom(false);
    } else {
      setUom("Others");
      setCustomUom(item.uom);
      setIsCustomUom(true);
    }

    setEnableBatch(item.enable_batch || "N");
    setIsFormOpen(true);
  };

  const resetForm = () => {
    setCode("");
    setName("");
    setCompanyCode("");
    setGroup("Electrical");
    setCustomGroup("");
    setIsCustomGroup(false);
    setSubGroup("Conduit Pipes");
    setCustomSubGroup("");
    setIsCustomSubGroup(false);
    setBrand("");
    setType("Goods");
    setHsnCode("");
    setUom("Nos");
    setCustomUom("");
    setIsCustomUom(false);
    setEnableBatch("N");
    setEditingItem(null);
    setTimeout(() => {
      setSuccessMsg(null);
    }, 4000);
  };

  const handleConfirmClose = () => {
    setIsConfirmOpen(false);
    setIsFormOpen(false);
    setConfirmedItem(null);
  };

  const handlePrintItem = async (item: InventoryItem) => {
    try {
      await printInventoryHtml(buildInventoryItemHtml(item, {
        renderMode: "pdf",
        helperText: "Product specification sheet preview.",
      }));
    } catch (err) {
      alert(`Print failed: ${err instanceof Error ? err.message : "Unknown error"}`);
    }
  };

  const handleDownloadItem = async (item: InventoryItem) => {
    try {
      await exportInventoryPdf(
        buildInventoryItemHtml(item, {
          renderMode: "pdf",
          helperText: "Generating product specification PDF...",
        }),
        `product_${item.code}.pdf`,
        true,
      );
    } catch (err) {
      console.error("Failed to download item PDF:", err);
      alert("Failed to download product specification PDF.");
    }
  };

  // Delete Item
  const handleDeleteItem = async (itemCode: string) => {
    if (!window.confirm(`Are you sure you want to delete item "${itemCode}"?`)) {
      return;
    }

    if (dbStatus === "connected") {
      try {
        const { error } = await supabase.from("inventory").delete().eq("code", itemCode);
        if (error) {
          throw error;
        }
        fetchItems();
      } catch (err) {
        console.error("Delete failed from Supabase:", err);
        const errMsg = err instanceof Error ? err.message : "Unknown error occurred.";
        alert(`Failed to delete from Supabase: ${errMsg}`);
      }
    } else {
      const updated = items.filter((i) => i.code !== itemCode);
      localStorage.setItem("kaniyamparambil_inventory", JSON.stringify(updated));
      setItems(updated);
    }
  };

  // Unique groups for filter dropdown
  const uniqueGroups = ["All", ...Array.from(new Set(items.map((i) => i.group)))];

  // Filtered Items
  const filteredItems = items.filter((item) => {
    const matchesSearch =
      item.code.toLowerCase().includes(searchQuery.toLowerCase()) ||
      item.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
      item.brand.toLowerCase().includes(searchQuery.toLowerCase()) ||
      item.company_code.toLowerCase().includes(searchQuery.toLowerCase());

    const matchesGroup = selectedGroup === "All" || item.group === selectedGroup;

    return matchesSearch && matchesGroup;
  });

  const totalPages = Math.ceil(filteredItems.length / itemsPerPage);
  const indexOfLastItem = currentPage * itemsPerPage;
  const indexOfFirstItem = indexOfLastItem - itemsPerPage;
  const currentItems = filteredItems.slice(indexOfFirstItem, indexOfLastItem);

  const resolveStatementReport = (): {
    items: InventoryItem[];
    reportType: string;
    periodLabel: string;
    filenameSuffix: string;
  } | null => {
    const applyGroup = (list: InventoryItem[]) =>
      selectedGroup === "All" ? list : list.filter((item) => item.group === selectedGroup);

    switch (reportMode) {
      case "full":
        return {
          items: applyGroup([...items]),
          reportType: "Complete Inventory Register",
          periodLabel: "All Items (Full Catalog)",
          filenameSuffix: `full_${todayIso()}`,
        };
      case "current":
        return {
          items: [...filteredItems],
          reportType: "Filtered Table View",
          periodLabel: `Current filters — Group: ${selectedGroup}, Search: ${searchQuery.trim() || "—"}`,
          filenameSuffix: `filtered_${todayIso()}`,
        };
      case "date": {
        const dated = applyGroup(filterItemsByDate(items, reportDate));
        return {
          items: dated,
          reportType: "Daily Registration Statement",
          periodLabel: formatReportDate(reportDate),
          filenameSuffix: `date_${reportDate}`,
        };
      }
      case "month": {
        const monthly = applyGroup(filterItemsByMonth(items, reportMonth));
        return {
          items: monthly,
          reportType: "Monthly Registration Statement",
          periodLabel: formatMonthLabel(reportMonth),
          filenameSuffix: `month_${reportMonth}`,
        };
      }
      case "range": {
        if (reportFrom > reportTo) {
          setReportError("From date cannot be after To date.");
          return null;
        }
        const ranged = applyGroup(filterItemsByRange(items, reportFrom, reportTo));
        return {
          items: ranged,
          reportType: "Date Range Statement",
          periodLabel: `${formatReportDate(reportFrom)} to ${formatReportDate(reportTo)}`,
          filenameSuffix: `${reportFrom}_to_${reportTo}`,
        };
      }
      default:
        return null;
    }
  };

  const buildStatementHtml = () => {
    const report = resolveStatementReport();
    if (!report) return null;
    if (report.items.length === 0) {
      setReportError("No inventory items match the selected statement period.");
      return null;
    }
    setReportError(null);
    return buildInventoryStatementHtml(
      report.items,
      buildStatementMeta(
        report.items,
        report.reportType,
        report.periodLabel,
        selectedGroup,
        searchQuery.trim(),
      ),
      { renderMode: "pdf", helperText: "Generating inventory statement PDF..." },
    );
  };

  const handleDownloadStatement = async () => {
    const report = resolveStatementReport();
    if (!report) return;
    const html = buildStatementHtml();
    if (!html) return;
    try {
      await exportInventoryPdf(html, `inventory_statement_${report.filenameSuffix}.pdf`, false);
    } catch (err) {
      alert(`Statement PDF failed: ${err instanceof Error ? err.message : "Unknown error"}`);
    }
  };

  const handlePrintStatement = async () => {
    const html = buildStatementHtml();
    if (!html) return;
    try {
      await printInventoryHtml(html);
    } catch (err) {
      alert(`Print failed: ${err instanceof Error ? err.message : "Unknown error"}`);
    }
  };

  return (
    <div className="p-6 space-y-6">
      {/* ── Page Header ── */}
      <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-4">
        <div>
          <h1 className="text-page-title font-semibold text-text-primary flex items-center gap-2">
            <Boxes className="w-6 h-6 text-primary" />
            Inventory (Items)
          </h1>
          <p className="text-caption text-text-secondary mt-0.5">
            Manage product catalog, HSN tax classifications, UOM definitions, and batch configurations.
          </p>
        </div>

        <div className="flex items-center gap-2 flex-wrap">
          <button
            type="button"
            onClick={() => { setReportError(null); setIsReportModalOpen(true); }}
            className="btn-secondary flex items-center gap-1.5 text-xs font-semibold shadow-sm"
          >
            <FileText className="w-3.5 h-3.5" />
            Inventory Statement
          </button>
          <button
            onClick={() => {
              if (!isFormOpen) {
                resetForm();
              }
              setIsFormOpen(!isFormOpen);
            }}
            className="btn-primary flex items-center gap-1.5 shadow-sm"
          >
            <Plus className="w-4 h-4" />
            {isFormOpen ? "Close Panel" : "Register Item"}
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
              The `inventory` table was not found in your Supabase database. Items are currently stored locally in your browser.
              To persist this database-wide, run the following SQL schema in your Supabase SQL Editor:
            </p>
            <pre className="text-[10px] font-mono bg-blue-900/5 text-blue-900 border border-blue-200 p-2.5 rounded-md mt-2 overflow-x-auto select-all max-w-full">
              {`CREATE TABLE public.inventory (
  code text PRIMARY KEY,
  name text NOT NULL,
  company_code text,
  "group" text NOT NULL,
  sub_group text,
  brand text,
  type text DEFAULT 'Goods' NOT NULL,
  hsn_code text,
  uom text NOT NULL,
  enable_batch text DEFAULT 'N' NOT NULL,
  created_at timestamp with time zone DEFAULT timezone('utc'::text, now()) NOT NULL
);`}
            </pre>
          </div>
        </div>
      )}

      {/* ── Item Generation Form (Popup Modal) ── */}
      {isFormOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 overflow-y-auto bg-slate-900/40 backdrop-blur-[2px]">
          {/* Backdrop (click away to close) */}
          <div
            className="absolute inset-0 transition-opacity"
            onClick={() => setIsFormOpen(false)}
          />

          {/* Modal Container */}
          <div className="bg-white border border-slate-200 rounded-xl shadow-2xl relative max-w-6xl w-full max-h-[90vh] overflow-y-auto animate-in fade-in zoom-in-95 duration-150 z-10 flex flex-col font-sans">
            {/* Professional White Header */}
            <div className="bg-white px-6 py-4 border-b border-slate-200 flex items-center justify-between text-slate-900 rounded-t-xl">
              <div>
                <h2 className="text-base font-bold tracking-tight text-slate-900 flex items-center gap-2">
                  <Boxes className="w-5 h-5 text-slate-600" />
                  {editingItem ? "Edit Inventory Item" : "New Inventory Item Generation"}
                </h2>
                <p className="text-xs text-slate-500 mt-0.5">
                  {editingItem ? `Updating details for item SKU: ${editingItem.code}` : "Specify product parameters, categorization, and tax classifications."}
                </p>
              </div>
              {/* Close Button */}
              <button
                type="button"
                onClick={() => setIsFormOpen(false)}
                className="text-slate-400 hover:text-slate-600 p-1.5 rounded-lg hover:bg-slate-50 transition-colors"
                aria-label="Close modal"
              >
                <X className="w-4.5 h-4.5" />
              </button>
            </div>

            <form onSubmit={handleSubmitForm} className="p-6 space-y-6">
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

              <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
                {/* Section 1: Identification */}
                <div className="bg-white p-5 rounded-xl border border-slate-200/80 shadow-sm space-y-4">
                  <h3 className="text-xs font-bold uppercase tracking-wider text-slate-500 border-b border-slate-100 pb-2">
                    1. Identification
                  </h3>

                  <div>
                    <label className="form-label text-xs text-slate-700 font-semibold mb-1 block">Code *</label>
                    <input
                      type="text"
                      value={code}
                      onChange={(e) => setCode(e.target.value.replace(/\D/g, ""))}
                      placeholder="Enter numeric item ID"
                      className="input-enterprise font-mono border-slate-300 focus:ring-2 focus:ring-blue-500/10 focus:border-blue-500 text-xs disabled:bg-slate-50 disabled:text-slate-400"
                      required
                      disabled={!!editingItem}
                    />
                    <p className="text-[10px] text-slate-400 mt-1">Unique numeric identifier for the SKU.</p>
                  </div>

                  <div>
                    <label className="form-label text-xs text-slate-700 font-semibold mb-1 block">Product Name *</label>
                    <input
                      type="text"
                      value={name}
                      onChange={(e) => setName(e.target.value)}
                      placeholder="Full product print description"
                      className="input-enterprise border-slate-300 focus:ring-2 focus:ring-blue-500/10 focus:border-blue-500 text-xs"
                      required
                    />
                  </div>

                  <div>
                    <label className="form-label text-xs text-slate-700 font-semibold mb-1 block">Company Code</label>
                    <input
                      type="text"
                      value={companyCode}
                      onChange={(e) => setCompanyCode(e.target.value.replace(/\D/g, ""))}
                      placeholder="Supplier / manufacturer ref"
                      className="input-enterprise font-mono border-slate-300 focus:ring-2 focus:ring-blue-500/10 focus:border-blue-500 text-xs"
                    />
                  </div>
                </div>

                {/* Section 2: Categorization */}
                <div className="bg-white p-5 rounded-xl border border-slate-200/80 shadow-sm space-y-4">
                  <h3 className="text-xs font-bold uppercase tracking-wider text-slate-500 border-b border-slate-100 pb-2">
                    2. Categorization
                  </h3>

                  <div>
                    <div className="flex items-center justify-between mb-1">
                      <label className="form-label text-xs text-slate-700 font-semibold mb-0 block">Product Group *</label>
                      <button
                        type="button"
                        onClick={() => setIsCustomGroup(!isCustomGroup)}
                        className="text-[10px] font-bold text-blue-600 hover:text-blue-700 transition-colors"
                      >
                        {isCustomGroup ? "Select Standard" : "+ Custom Group"}
                      </button>
                    </div>
                    {isCustomGroup ? (
                      <input
                        type="text"
                        value={customGroup}
                        onChange={(e) => setCustomGroup(e.target.value)}
                        placeholder="Enter custom category"
                        className="input-enterprise border-slate-300 focus:ring-2 focus:ring-blue-500/10 focus:border-blue-500 text-xs"
                        required
                      />
                    ) : (
                      <select
                        value={group}
                        onChange={(e) => setGroup(e.target.value)}
                        className="input-enterprise bg-white cursor-pointer py-1.5 px-3 border border-slate-300 rounded focus:ring-2 focus:ring-blue-500/10 focus:border-blue-500 text-xs font-medium text-slate-800 transition-colors"
                      >
                        {PREDEFINED_GROUPS.map((g: string) => (
                          <option key={g} value={g} className="py-1 text-slate-800 bg-white">
                            {g}
                          </option>
                        ))}
                      </select>
                    )}
                  </div>

                  <div>
                    <div className="flex items-center justify-between mb-1">
                      <label className="form-label text-xs text-slate-700 font-semibold mb-0 block">Sub-Group *</label>
                      <button
                        type="button"
                        onClick={() => setIsCustomSubGroup(!isCustomSubGroup)}
                        className="text-[10px] font-bold text-blue-600 hover:text-blue-700 transition-colors"
                      >
                        {isCustomSubGroup ? "Select Standard" : "+ Custom Sub-Group"}
                      </button>
                    </div>
                    {isCustomSubGroup ? (
                      <input
                        type="text"
                        value={customSubGroup}
                        onChange={(e) => setCustomSubGroup(e.target.value)}
                        placeholder="Enter custom sub-group"
                        className="input-enterprise border-slate-300 focus:ring-2 focus:ring-blue-500/10 focus:border-blue-500 text-xs"
                        required
                      />
                    ) : (
                      <select
                        value={subGroup}
                        onChange={(e) => setSubGroup(e.target.value)}
                        className="input-enterprise bg-white cursor-pointer py-1.5 px-3 border border-slate-300 rounded focus:ring-2 focus:ring-blue-500/10 focus:border-blue-500 text-xs font-medium text-slate-800 transition-colors"
                      >
                        {PREDEFINED_SUBGROUPS.map((sg: string) => (
                          <option key={sg} value={sg} className="py-1 text-slate-800 bg-white">
                            {sg}
                          </option>
                        ))}
                      </select>
                    )}
                  </div>

                  <div>
                    <label className="form-label text-xs text-slate-700 font-semibold mb-1 block">Brand Name (Letters Only)</label>
                    <input
                      type="text"
                      value={brand}
                      onChange={(e) => setBrand(e.target.value.replace(/[^a-zA-Z\s]/g, ""))}
                      placeholder="e.g. Havells, Supreme"
                      className="input-enterprise border-slate-300 focus:ring-2 focus:ring-blue-500/10 focus:border-blue-500 text-xs"
                    />
                  </div>
                </div>

                {/* Section 3: Compliance & Measurement */}
                <div className="bg-white p-5 rounded-xl border border-slate-200/80 shadow-sm space-y-4">
                  <h3 className="text-xs font-bold uppercase tracking-wider text-slate-500 border-b border-slate-100 pb-2">
                    3. Compliance & Measurements
                  </h3>

                  <div className="grid grid-cols-2 gap-3">
                    <div>
                      <label className="form-label text-xs text-slate-700 font-semibold mb-1 block">Type</label>
                      <input
                        type="text"
                        value={type}
                        disabled
                        className="input-enterprise bg-slate-50 text-slate-400 border-slate-200 cursor-not-allowed font-medium text-xs"
                      />
                    </div>
                    <div>
                      <label className="form-label text-xs text-slate-700 font-semibold mb-1 block">HSN Code</label>
                      <input
                        type="text"
                        value={hsnCode}
                        onChange={(e) => setHsnCode(e.target.value.replace(/\D/g, ""))}
                        placeholder="e.g. 8544"
                        className="input-enterprise font-mono border-slate-300 focus:ring-2 focus:ring-blue-500/10 focus:border-blue-500 text-xs"
                      />
                    </div>
                  </div>

                  <div>
                    <div className="flex items-center justify-between mb-1">
                      <label className="form-label text-xs text-slate-700 font-semibold mb-0 block">Unit-UOM *</label>
                      <button
                        type="button"
                        onClick={() => setIsCustomUom(!isCustomUom)}
                        className="text-[10px] font-bold text-blue-600 hover:text-blue-700 transition-colors"
                      >
                        {isCustomUom ? "Select Standard" : "+ Custom UOM"}
                      </button>
                    </div>
                    {isCustomUom ? (
                      <input
                        type="text"
                        value={customUom}
                        onChange={(e) => setCustomUom(e.target.value)}
                        placeholder="e.g. Rolls, Sheets"
                        className="input-enterprise border-slate-300 focus:ring-2 focus:ring-blue-500/10 focus:border-blue-500 text-xs"
                        required
                      />
                    ) : (
                      <select
                        value={uom}
                        onChange={(e) => setUom(e.target.value)}
                        className="input-enterprise bg-white cursor-pointer py-1.5 px-3 border border-slate-300 rounded focus:ring-2 focus:ring-blue-500/10 focus:border-blue-500 text-xs font-medium text-slate-800 transition-colors"
                      >
                        {DEFAULT_UOMS.map((u) => (
                          <option key={u} value={u} className="py-1 text-slate-800 bg-white">
                            {u}
                          </option>
                        ))}
                      </select>
                    )}
                  </div>

                  <div>
                    <label className="form-label text-xs text-slate-700 font-semibold mb-1 block">Enable Batch Tracking</label>
                    <select
                      value={enableBatch}
                      onChange={(e) => setEnableBatch(e.target.value)}
                      className="input-enterprise bg-white cursor-pointer py-1.5 px-3 border border-slate-300 rounded focus:ring-2 focus:ring-blue-500/10 focus:border-blue-500 text-xs font-medium text-slate-800 transition-colors"
                    >
                      <option value="N" className="py-1 text-slate-800 bg-white">N (Disabled)</option>
                      <option value="Y" className="py-1 text-slate-800 bg-white">Y (Enabled)</option>
                    </select>
                  </div>
                </div>
              </div>

              <div className="flex items-center justify-end gap-3 pt-4 border-t border-slate-200 bg-slate-50 -mx-6 -mb-6 p-4 rounded-b-xl">
                <button
                  type="button"
                  onClick={resetForm}
                  className="btn-secondary px-5 py-2 font-semibold text-xs border border-slate-300 text-slate-700 hover:bg-slate-100 transition-colors rounded"
                >
                  Clear Form
                </button>
                <button
                  type="submit"
                  className="btn-primary bg-slate-900 hover:bg-slate-800 active:bg-slate-950 px-6 py-2 font-bold shadow-sm text-white transition-colors rounded text-xs"
                >
                  {editingItem ? "Save & Update Item" : "Save & Register Item"}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* ── Success Confirmation Popup Modal ── */}
      {isConfirmOpen && confirmedItem && (
        <div className="fixed inset-0 z-[60] flex items-center justify-center p-4 bg-slate-900/60 backdrop-blur-[3px] animate-in fade-in duration-100">
          <div className="bg-white border border-slate-200 rounded-xl shadow-2xl p-6 max-w-md w-full relative z-10 animate-in zoom-in-95 duration-150 flex flex-col items-center text-center">
            {/* Success icon */}
            <div className="w-12 h-12 rounded-full bg-green-100 flex items-center justify-center text-green-600 mb-4">
              <Check className="w-6 h-6 stroke-[3px]" />
            </div>

            <h3 className="text-base font-bold text-slate-900">Registration Successful</h3>
            <p className="text-xs text-slate-500 mt-2 leading-relaxed">
              Product <span className="font-semibold text-slate-800">"{confirmedItem.name}"</span> with code{" "}
              <span className="font-mono font-semibold text-slate-800 bg-slate-100 px-1.5 py-0.5 rounded">{confirmedItem.code}</span> has been logged to the database catalog.
            </p>

            <div className="w-full mt-6">
              <button
                type="button"
                onClick={handleConfirmClose}
                className="w-full btn-primary bg-slate-900 hover:bg-slate-800 active:bg-slate-950 py-2.5 font-semibold text-white transition-colors rounded text-xs"
              >
                Acknowledge & Close
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ── View Item Specifications Modal ── */}
      {viewingItem && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/40 backdrop-blur-[2px]">
          <div
            className="absolute inset-0 transition-opacity"
            onClick={() => setViewingItem(null)}
          />

          <div className="bg-white border border-slate-200 rounded-xl shadow-2xl relative max-w-2xl w-full animate-in fade-in zoom-in-95 duration-150 z-10 flex flex-col font-sans">
            {/* Header */}
            <div className="bg-slate-900 px-6 py-4 text-white rounded-t-xl flex items-center justify-between shadow-md">
              <div>
                <h2 className="text-sm font-bold font-sans tracking-tight">Product Specifications Sheet</h2>
                <p className="text-[10px] text-slate-300 mt-0.5">Code: {viewingItem.code}</p>
              </div>
              <button
                type="button"
                onClick={() => setViewingItem(null)}
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
                  <span className="text-[10px] font-bold text-slate-400 uppercase tracking-wider block">Item Code</span>
                  <span className="font-mono font-semibold text-slate-900 text-sm">{viewingItem.code}</span>
                </div>
                <div className="border-b border-slate-100 pb-2">
                  <span className="text-[10px] font-bold text-slate-400 uppercase tracking-wider block">Company Reference</span>
                  <span className="font-mono text-slate-700">{viewingItem.company_code || "—"}</span>
                </div>
                <div className="col-span-2 border-b border-slate-100 pb-2">
                  <span className="text-[10px] font-bold text-slate-400 uppercase tracking-wider block">Product Description</span>
                  <span className="font-medium text-slate-900 text-sm">{viewingItem.name}</span>
                </div>
                <div className="border-b border-slate-100 pb-2">
                  <span className="text-[10px] font-bold text-slate-400 uppercase tracking-wider block">Category Group</span>
                  <span className="font-semibold text-slate-700">{viewingItem.group}</span>
                </div>
                <div className="border-b border-slate-100 pb-2">
                  <span className="text-[10px] font-bold text-slate-400 uppercase tracking-wider block">Sub-Group Segment</span>
                  <span className="font-semibold text-slate-700">{viewingItem.sub_group || "—"}</span>
                </div>
                <div className="border-b border-slate-100 pb-2">
                  <span className="text-[10px] font-bold text-slate-400 uppercase tracking-wider block">Brand Name</span>
                  <span className="font-medium text-slate-700">{viewingItem.brand || "—"}</span>
                </div>
                <div className="border-b border-slate-100 pb-2">
                  <span className="text-[10px] font-bold text-slate-400 uppercase tracking-wider block">Product Type</span>
                  <span className="font-medium text-slate-700">{viewingItem.type}</span>
                </div>
                <div className="border-b border-slate-100 pb-2">
                  <span className="text-[10px] font-bold text-slate-400 uppercase tracking-wider block">HSN Classification Code</span>
                  <span className="font-mono text-slate-700">{viewingItem.hsn_code || "—"}</span>
                </div>
                <div className="border-b border-slate-100 pb-2">
                  <span className="text-[10px] font-bold text-slate-400 uppercase tracking-wider block">Unit of Measurement</span>
                  <span className="font-semibold text-slate-900">{viewingItem.uom}</span>
                </div>
                <div className="border-b border-slate-100 pb-2">
                  <span className="text-[10px] font-bold text-slate-400 uppercase tracking-wider block">Batch Tracking Status</span>
                  <span className={`inline-flex items-center px-2 py-0.5 rounded text-[10px] font-bold mt-1 ${
                    viewingItem.enable_batch === 'Y' ? 'bg-amber-100 text-amber-800' : 'bg-slate-100 text-slate-600'
                  }`}>
                    {viewingItem.enable_batch === 'Y' ? 'Batch Enabled' : 'Batch Disabled'}
                  </span>
                </div>
              </div>
            </div>

            {/* Footer Buttons */}
            <div className="flex items-center justify-end gap-3 pt-4 border-t border-slate-200 bg-slate-50 p-4 rounded-b-xl">
              <button
                type="button"
                onClick={() => viewingItem && handlePrintItem(viewingItem)}
                className="btn-secondary px-4 py-2 font-semibold text-xs border border-slate-300 text-slate-700 hover:bg-slate-100 transition-colors rounded flex items-center gap-1.5"
              >
                <Printer className="w-3.5 h-3.5" />
                Print Spec Sheet
              </button>
              <button
                type="button"
                onClick={() => viewingItem && handleDownloadItem(viewingItem)}
                className="btn-secondary px-4 py-2 font-semibold text-xs border border-slate-300 text-slate-700 hover:bg-slate-100 transition-colors rounded flex items-center gap-1.5"
              >
                <Download className="w-3.5 h-3.5" />
                Download PDF
              </button>
              <button
                type="button"
                onClick={() => setViewingItem(null)}
                className="btn-primary bg-slate-900 hover:bg-slate-800 active:bg-slate-950 px-6 py-2 font-bold shadow-sm text-white transition-colors rounded text-xs"
              >
                Close View
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ── Inventory Statement Modal ── */}
      {isReportModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/40 backdrop-blur-[2px]">
          <div className="absolute inset-0" onClick={() => setIsReportModalOpen(false)} />
          <div className="bg-white border border-slate-200 rounded-xl shadow-2xl relative max-w-lg w-full z-10 flex flex-col font-sans animate-in fade-in zoom-in-95 duration-150">
            <div className="bg-slate-900 px-5 py-4 text-white rounded-t-xl flex items-center justify-between">
              <div>
                <h2 className="text-sm font-bold tracking-tight flex items-center gap-2">
                  <FileText className="w-4 h-4" />
                  Download Inventory Statement
                </h2>
                <p className="text-[10px] text-slate-300 mt-0.5">Account-style PDF with full item details</p>
              </div>
              <button type="button" onClick={() => setIsReportModalOpen(false)}
                className="text-slate-300 hover:text-white p-1.5 rounded-lg hover:bg-white/10">
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
                    ["full", "Full Inventory", "All registered items in the catalog"],
                    ["date", "By Date", "Items registered on a specific date"],
                    ["month", "By Month", "Items registered in a calendar month"],
                    ["range", "Date Range", "Items registered between two dates"],
                    ["current", "Current Table Filter", "Uses search & group filters from the list"],
                  ] as const).map(([mode, title, desc]) => (
                    <label key={mode}
                      className={`flex items-start gap-3 p-3 rounded-lg border cursor-pointer transition-colors ${
                        reportMode === mode ? "border-primary bg-primary/5" : "border-slate-200 hover:bg-slate-50"
                      }`}>
                      <input type="radio" name="reportMode" value={mode} checked={reportMode === mode}
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
                  <label className="form-label text-xs">Registration Date</label>
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
                  <label className="form-label text-xs">Optional Group Filter</label>
                  <select value={selectedGroup} onChange={(e) => setSelectedGroup(e.target.value)}
                    className="input-enterprise bg-white cursor-pointer text-xs w-full">
                    {uniqueGroups.map((g) => <option key={g} value={g}>{g}</option>)}
                  </select>
                </div>
              )}

              <p className="text-[10px] text-slate-500 leading-relaxed">
                Statement includes registration date, code, name, company ref, group, sub-group, brand, type, HSN, UOM, batch, and stock — with totals like an account statement.
              </p>
            </div>

            <div className="flex items-center justify-end gap-2 px-5 py-4 border-t border-slate-200 bg-slate-50 rounded-b-xl">
              <button type="button" onClick={() => setIsReportModalOpen(false)} className="btn-secondary px-4 text-xs">
                Cancel
              </button>
              <button type="button" onClick={handlePrintStatement}
                className="btn-secondary px-4 text-xs flex items-center gap-1.5">
                <Printer className="w-3.5 h-3.5" /> Print
              </button>
              <button type="button" onClick={handleDownloadStatement}
                className="btn-primary px-4 text-xs flex items-center gap-1.5">
                <Download className="w-3.5 h-3.5" /> Download PDF
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ── Table Filters and Search ── */}
      <div className="bg-white border border-border rounded-xl shadow-card p-4 flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div className="relative flex-1 max-w-md">
          <Search className="w-4 h-4 text-text-secondary absolute left-3 top-3" />
          <input
            type="text"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder="Search by Code, Name, Brand, Company Code..."
            className="input-enterprise pl-9"
          />
        </div>

        <div className="flex items-center gap-3 flex-wrap justify-end">
          <div className="flex items-center gap-1.5 text-xs font-semibold text-text-secondary">
            <Filter className="w-3.5 h-3.5" />
            <span>Filter Group:</span>
          </div>
          <select
            value={selectedGroup}
            onChange={(e) => setSelectedGroup(e.target.value)}
            className="input-enterprise bg-white cursor-pointer w-40"
          >
            {uniqueGroups.map((g) => (
              <option key={g} value={g}>
                {g}
              </option>
            ))}
          </select>
        </div>
      </div>

      {/* ── Items Dense Table ── */}
      <div className="bg-white border border-border rounded-xl shadow-card overflow-hidden">
        <div className="overflow-x-auto">
          <table className="table-enterprise w-full text-xs">
            <thead>
              <tr className="bg-gray-50 border-b border-border">
                <th className="px-4 py-3 text-center font-semibold uppercase tracking-wider text-text-secondary">Code</th>
                <th className="px-4 py-3 text-center font-semibold uppercase tracking-wider text-text-secondary">Product Name</th>
                <th className="px-4 py-3 text-center font-semibold uppercase tracking-wider text-text-secondary">Company Ref</th>
                <th className="px-4 py-3 text-center font-semibold uppercase tracking-wider text-text-secondary">Group</th>
                <th className="px-4 py-3 text-center font-semibold uppercase tracking-wider text-text-secondary">Sub-Group</th>
                <th className="px-4 py-3 text-center font-semibold uppercase tracking-wider text-text-secondary">Brand</th>
                <th className="px-4 py-3 text-center font-semibold uppercase tracking-wider text-text-secondary">Type</th>
                <th className="px-4 py-3 text-center font-semibold uppercase tracking-wider text-text-secondary">HSN Code</th>
                <th className="px-4 py-3 text-center font-semibold uppercase tracking-wider text-text-secondary">UOM</th>
                <th className="px-4 py-3 text-center font-semibold uppercase tracking-wider text-text-secondary">Batch</th>
                <th className="px-4 py-3 text-center font-semibold uppercase tracking-wider text-text-secondary">Stock Qty</th>
                <th className="px-4 py-3 text-center font-semibold uppercase tracking-wider text-text-secondary">Actions</th>
              </tr>
            </thead>
            <tbody>
              {loading ? (
                <tr>
                  <td colSpan={12} className="text-center py-12">
                    <div className="flex flex-col items-center justify-center gap-2">
                      <svg className="w-8 h-8 animate-spin text-primary" fill="none" viewBox="0 0 24 24">
                        <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                        <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
                      </svg>
                      <span className="text-xs text-text-secondary">Synchronizing database...</span>
                    </div>
                  </td>
                </tr>
              ) : filteredItems.length === 0 ? (
                <tr>
                  <td colSpan={12} className="text-center py-16 text-text-secondary">
                    <FolderOpen className="w-8 h-8 mx-auto text-gray-300 mb-2" />
                    <p className="font-semibold text-sm">No inventory items found</p>
                    <p className="text-xs text-gray-400 mt-1">Try resetting filters or registering a new item.</p>
                  </td>
                </tr>
              ) : (
                currentItems.map((item) => (
                  <tr key={item.code} className="border-b border-border hover:bg-gray-50/50 transition-colors">
                    <td className="px-4 py-2.5 font-semibold text-gray-900 font-mono text-center">{item.code}</td>
                    <td className="px-4 py-2.5 font-medium text-gray-800 text-center truncate max-w-[200px] mx-auto" title={item.name}>{item.name}</td>
                    <td className="px-4 py-2.5 text-text-secondary font-mono text-center truncate max-w-[100px] mx-auto" title={item.company_code || "—"}>{item.company_code || "—"}</td>
                    <td className="px-4 py-2.5 text-center">
                      <span className="inline-flex items-center px-2 py-0.5 rounded text-[10px] font-semibold bg-primary/5 text-primary border border-primary/10">
                        {item.group}
                      </span>
                    </td>
                    <td className="px-4 py-2.5 text-text-secondary text-center truncate max-w-[120px] mx-auto" title={item.sub_group || "—"}>{item.sub_group || "—"}</td>
                    <td className="px-4 py-2.5 text-gray-700 text-center truncate max-w-[120px] mx-auto" title={item.brand || "—"}>{item.brand || "—"}</td>
                    <td className="px-4 py-2.5 text-text-secondary text-center">{item.type}</td>
                    <td className="px-4 py-2.5 text-text-secondary font-mono text-center">{item.hsn_code || "—"}</td>
                    <td className="px-4 py-2.5 font-semibold text-gray-700 text-center">{item.uom}</td>
                    <td className="px-4 py-2.5 text-center">
                      <span
                        className={`inline-flex items-center px-2 py-0.5 rounded text-[10px] font-bold ${
                          item.enable_batch === "Y"
                            ? "bg-amber-100 text-amber-800 border border-amber-200"
                            : "bg-gray-100 text-gray-600 border border-gray-200"
                        }`}
                      >
                        {item.enable_batch}
                      </span>
                    </td>
                    <td className="px-4 py-2.5 text-center font-mono font-bold text-slate-800">
                      {item.stock_qty ?? 0}
                    </td>
                    <td className="px-4 py-2.5 text-center">
                      <div className="flex items-center justify-center gap-1.5">
                        <button
                          type="button"
                          onClick={() => setViewingItem(item)}
                          className="text-slate-500 hover:text-slate-900 hover:bg-slate-100 p-1.5 rounded transition-all"
                          title="View Details"
                        >
                          <Eye className="w-3.5 h-3.5" />
                        </button>
                        <button
                          type="button"
                          onClick={() => handlePrintItem(item)}
                          className="text-slate-500 hover:text-slate-900 hover:bg-slate-100 p-1.5 rounded transition-all"
                          title="Print Item Sheet"
                        >
                          <Printer className="w-3.5 h-3.5" />
                        </button>
                        <button
                          type="button"
                          onClick={() => handleStartEdit(item)}
                          className="text-slate-500 hover:text-slate-900 hover:bg-slate-100 p-1.5 rounded transition-all"
                          title="Edit Item"
                        >
                          <Edit className="w-3.5 h-3.5" />
                        </button>
                        <button
                          type="button"
                          onClick={() => handleDownloadItem(item)}
                          className="text-slate-500 hover:text-slate-900 hover:bg-slate-100 p-1.5 rounded transition-all"
                          title="Download PDF Catalog"
                        >
                          <Download className="w-3.5 h-3.5" />
                        </button>
                        <button
                          type="button"
                          onClick={() => handleDeleteItem(item.code)}
                          className="text-red-500 hover:text-red-700 hover:bg-red-50 p-1.5 rounded transition-all"
                          title="Delete Item"
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
        
        {/* Table summary info */}
        <div className="bg-gray-50 px-4 py-3 border-t border-border flex flex-col sm:flex-row items-center justify-between gap-4 text-xs text-text-secondary">
          <div className="flex items-center gap-2">
            Showing <span className="font-semibold text-text-primary">{filteredItems.length > 0 ? indexOfFirstItem + 1 : 0}</span> to{" "}
            <span className="font-semibold text-text-primary">{Math.min(indexOfLastItem, filteredItems.length)}</span> of{" "}
            <span className="font-semibold text-text-primary">{filteredItems.length}</span> items
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
          {dbStatus === "connected" ? (
            <div className="flex items-center gap-1.5 text-green-700 font-medium bg-green-50 px-2 py-1 rounded border border-green-200">
              <span className="w-1.5 h-1.5 rounded-full bg-green-500 animate-pulse" />
              Live SQL Database Sync Active
            </div>
          ) : (
            <div className="flex items-center gap-1.5 text-blue-700 font-medium bg-blue-50 px-2 py-1 rounded border border-blue-200">
              <span className="w-1.5 h-1.5 rounded-full bg-blue-500" />
              Local Storage Mode
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
