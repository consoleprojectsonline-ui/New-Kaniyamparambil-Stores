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
} from "lucide-react";
import { supabase } from "@/lib/supabase";
import { formatCurrency } from "@/lib/utils";
import html2canvas from "html2canvas";
import { jsPDF } from "jspdf";

const STORE_NAME = "New Kaniyamparambil Stores";
const DAYBOOK_FRAME_STYLE: Partial<CSSStyleDeclaration> = {
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
  payment_mode: string;
  category: EntryCategory;
  source: EntrySource;
  reference_no?: string;
  editable: boolean;
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

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

interface DayBookReportData {
  date: string;
  displayDate: string;
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
  const isPdfMode = options.renderMode === "pdf";
  const isVoucher = Boolean(options.voucher);
  const voucher = options.voucher;

  const rowMarkup = data.entries.map((entry, index) => `
    <tr>
      <td class="col-index">${index + 1}</td>
      <td class="col-source">${escapeHtml(entry.category)}</td>
      <td class="col-desc">${escapeHtml(entry.description)}</td>
      <td class="col-ref">${escapeHtml(entry.reference_no || "—")}</td>
      <td class="col-mode">${escapeHtml(entry.payment_mode)}</td>
      <td class="col-receipt align-right">${entry.type === "Income" ? escapeHtml(formatCurrency(entry.amount)) : "—"}</td>
      <td class="col-payment align-right">${entry.type === "Expense" ? escapeHtml(formatCurrency(entry.amount)) : "—"}</td>
    </tr>
  `).join("");

  const voucherBody = voucher ? `
    <table class="voucher-table">
      <tr><td class="label">Voucher ID</td><td>${escapeHtml(voucher.id)}</td></tr>
      <tr><td class="label">Date</td><td>${escapeHtml(voucher.date)}</td></tr>
      <tr><td class="label">Source</td><td>${escapeHtml(voucher.category)}</td></tr>
      <tr><td class="label">Reference</td><td>${escapeHtml(voucher.reference_no || "—")}</td></tr>
      <tr><td class="label">Description</td><td>${escapeHtml(voucher.description)}</td></tr>
      <tr><td class="label">Type</td><td>${escapeHtml(voucher.type)}</td></tr>
      <tr><td class="label">Payment Mode</td><td>${escapeHtml(voucher.payment_mode)}</td></tr>
      <tr><td class="label">Amount</td><td class="amount">${escapeHtml(formatCurrency(voucher.amount))}</td></tr>
    </table>
  ` : "";

  return `<!DOCTYPE html>
  <html lang="en">
    <head>
      <meta charset="UTF-8" />
      <title>${isVoucher ? "Day Book Voucher" : "Day Book"} ${escapeHtml(data.date)}</title>
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
          font-size: ${isPdfMode ? "14px" : "18px"};
          font-weight: 700;
          color: #b45309;
          letter-spacing: 0.06em;
          padding: ${isPdfMode ? "8px" : "12px"};
          border-bottom: 1px solid #000;
        }
        .meta-grid {
          display: grid;
          grid-template-columns: 1fr 1fr;
          border-bottom: 1px solid #000;
        }
        .meta-grid div {
          padding: ${isPdfMode ? "6px 8px" : "10px 12px"};
          border-right: 1px solid #000;
        }
        .meta-grid div:nth-child(2n) { border-right: none; }
        .meta-label { font-weight: 700; margin-bottom: 2px; }
        .entries-table {
          width: 100%;
          border-collapse: collapse;
        }
        .entries-table th,
        .entries-table td {
          border: 1px solid #000;
          padding: ${isPdfMode ? "4px 5px" : "6px 8px"};
          vertical-align: top;
        }
        .entries-table thead th {
          background: #fef3c7;
          font-weight: 700;
          text-align: center;
        }
        .col-index { width: 28px; text-align: center; }
        .col-source { width: 68px; text-align: center; }
        .col-ref { width: 72px; text-align: center; }
        .col-mode { width: 68px; text-align: center; }
        .col-receipt, .col-payment { width: 82px; }
        .align-right { text-align: right; }
        .summary-grid {
          display: grid;
          grid-template-columns: 1fr 1fr;
          border-top: 1px solid #000;
        }
        .summary-box {
          padding: ${isPdfMode ? "6px 8px" : "10px 12px"};
          border-right: 1px solid #000;
        }
        .summary-box:last-child { border-right: none; }
        .summary-row {
          display: flex;
          justify-content: space-between;
          gap: 12px;
          margin-bottom: 4px;
          font-weight: 600;
        }
        .summary-row.total {
          margin-top: 6px;
          padding-top: 6px;
          border-top: 1px dashed #999;
          font-size: ${isPdfMode ? "10px" : "13px"};
          font-weight: 700;
        }
        .voucher-meta {
          padding: ${isPdfMode ? "8px" : "12px"};
          border-bottom: 1px solid #000;
        }
        .voucher-table {
          width: 100%;
          border-collapse: collapse;
        }
        .voucher-table td {
          border: 1px solid #000;
          padding: ${isPdfMode ? "6px 8px" : "8px 10px"};
        }
        .voucher-table .label {
          width: 34%;
          font-weight: 700;
          background: #fef3c7;
        }
        .voucher-table .amount {
          font-weight: 700;
          font-size: ${isPdfMode ? "11px" : "14px"};
        }
        .footer-note {
          padding: ${isPdfMode ? "6px 8px" : "10px 12px"};
          border-top: 1px solid #000;
          font-size: ${isPdfMode ? "8px" : "10px"};
          color: #444;
        }
        @page { size: A4; margin: 10mm; }
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
        <div class="doc-title">${isVoucher ? "DAY BOOK VOUCHER" : "DAY BOOK / CASH BOOK"}</div>

        <div class="meta-grid">
          <div>
            <div class="meta-label">${escapeHtml(STORE_NAME)}</div>
            <div>Daily receipts, payments &amp; cash summary</div>
          </div>
          <div>
            <div class="meta-label">Book Date</div>
            <div>${escapeHtml(data.displayDate)}</div>
            <div style="margin-top:4px"><b>Entries:</b> ${data.entries.length}</div>
          </div>
        </div>

        ${isVoucher ? `
          <div class="voucher-meta">Single voucher copy — not a tax invoice</div>
          ${voucherBody}
        ` : `
          <table class="entries-table">
            <thead>
              <tr>
                <th>#</th>
                <th>Source</th>
                <th>Description</th>
                <th>Ref</th>
                <th>Mode</th>
                <th>Receipts (₹)</th>
                <th>Payments (₹)</th>
              </tr>
            </thead>
            <tbody>
              ${rowMarkup || `<tr><td colspan="7" style="text-align:center;padding:16px">No entries for this date</td></tr>`}
            </tbody>
          </table>

          <div class="summary-grid">
            <div class="summary-box">
              <div class="summary-row"><span>Total Receipts</span><span>${escapeHtml(formatCurrency(data.totalIncome))}</span></div>
              <div class="summary-row"><span>Sales (Day)</span><span>${escapeHtml(formatCurrency(data.salesTotal))}</span></div>
            </div>
            <div class="summary-box">
              <div class="summary-row"><span>Total Payments</span><span>${escapeHtml(formatCurrency(data.totalExpense))}</span></div>
              <div class="summary-row"><span>Purchases (Day)</span><span>${escapeHtml(formatCurrency(data.purchaseTotal))}</span></div>
            </div>
          </div>
          <div class="summary-box" style="border-top:1px solid #000;border-right:none">
            <div class="summary-row total">
              <span>Closing Balance (Net)</span>
              <span>${escapeHtml(formatCurrency(data.netBalance))}</span>
            </div>
          </div>
        `}

        <div class="footer-note">
          Generated from Day Book · ${escapeHtml(new Date().toLocaleString("en-IN"))} · Internal cash book record only
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

function buildReportData(
  date: string,
  entries: DayBookRow[],
  totals: {
    totalIncome: number;
    totalExpense: number;
    netBalance: number;
    salesTotal: number;
    purchaseTotal: number;
  },
): DayBookReportData {
  return {
    date,
    displayDate: formatDisplayDate(date),
    entries,
    ...totals,
  };
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

  const loadLocalManualEntries = useCallback((forDate: string) => {
    const local = localStorage.getItem(LOCAL_STORAGE_KEY);
    if (local) {
      try {
        const parsed = JSON.parse(local) as Record<string, unknown>[];
        return parsed.map(normalizeManualRow).filter((entry) => entry.entry_date === forDate);
      } catch {
        return [];
      }
    }
    return [];
  }, []);

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

    return (data ?? []).map((sale) => {
      const paymentAmount = Number(sale.payment_amount) || 0;
      const grandTotal = Number(sale.grand_total) || 0;
      const creditNote = sale.payment_status === "Credit" && paymentAmount === 0;

      return {
        id: `sale-${sale.bill_no}`,
        date: sale.bill_date,
        description: `Sales · ${sale.bill_no} · ${sale.customer_name}${creditNote ? " (Credit)" : ""}`,
        type: "Income" as const,
        amount: paymentAmount > 0 ? paymentAmount : grandTotal,
        payment_mode: sale.payment_mode || "Cash",
        category: "Sales" as const,
        source: "sales" as const,
        reference_no: sale.bill_no,
        editable: false,
      };
    });
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

    return (data ?? []).map((purchase) => {
      const paidAmount = Number(purchase.paid_amount) || 0;
      const netAmount = Number(purchase.net_amount) || 0;
      const pending = purchase.payment_status === "Pending" && paidAmount === 0;

      return {
        id: `purchase-${purchase.invoice_no}`,
        date: purchase.entry_date,
        description: `Purchase · ${purchase.invoice_no} · ${purchase.supplier_name}${pending ? " (Pending)" : ""}`,
        type: "Expense" as const,
        amount: paidAmount > 0 ? paidAmount : netAmount,
        payment_mode: "Bank",
        category: "Purchase" as const,
        source: "purchase" as const,
        reference_no: purchase.invoice_no,
        editable: false,
      };
    });
  }, []);

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
        ? [[], []]
        : await Promise.all([fetchSalesRows(forDate), fetchPurchaseRows(forDate)]);

      const manualRows = manual.map(manualToDayBookRow);
      const merged = [...salesRows, ...purchaseRows, ...manualRows].sort((a, b) => {
        const categoryOrder = { Sales: 0, Purchase: 1, General: 2, Other: 3 };
        const orderDiff = categoryOrder[a.category] - categoryOrder[b.category];
        if (orderDiff !== 0) return orderDiff;
        return a.description.localeCompare(b.description);
      });

      setManualEntries(manual);
      setDayBookRows(merged);
    } catch (err) {
      console.error("Failed to load day book:", err);
      setDbStatus("local");
      const manual = loadLocalManualEntries(forDate);
      setManualEntries(manual);
      setDayBookRows(manual.map(manualToDayBookRow));
    } finally {
      setLoading(false);
    }
  }, [fetchManualEntries, fetchPurchaseRows, fetchSalesRows, loadLocalManualEntries]);

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

  const totalIncome = filteredTransactions
    .filter((tx) => tx.type === "Income")
    .reduce((sum, tx) => sum + tx.amount, 0);

  const totalExpense = filteredTransactions
    .filter((tx) => tx.type === "Expense")
    .reduce((sum, tx) => sum + tx.amount, 0);

  const netBalance = totalIncome - totalExpense;

  const salesTotal = filteredTransactions
    .filter((tx) => tx.category === "Sales")
    .reduce((sum, tx) => sum + tx.amount, 0);

  const purchaseTotal = filteredTransactions
    .filter((tx) => tx.category === "Purchase")
    .reduce((sum, tx) => sum + tx.amount, 0);

  const totalPages = Math.ceil(filteredTransactions.length / itemsPerPage);
  const indexOfLastItem = currentPage * itemsPerPage;
  const indexOfFirstItem = indexOfLastItem - itemsPerPage;
  const currentTransactions = filteredTransactions.slice(indexOfFirstItem, indexOfLastItem);

  const reportTotals = useMemo(() => ({
    totalIncome,
    totalExpense,
    netBalance,
    salesTotal,
    purchaseTotal,
  }), [totalIncome, totalExpense, netBalance, salesTotal, purchaseTotal]);

  const getReportData = useCallback((entries: DayBookRow[]) =>
    buildReportData(selectedDate, entries, reportTotals),
  [selectedDate, reportTotals]);

  const handlePrintDayBook = async () => {
    try {
      await printDayBookHtml(buildDayBookHtml(getReportData(filteredTransactions), {
        helperText: "Day book print preview. Use Print or Save as PDF.",
        renderMode: "print",
      }));
    } catch (err) {
      alert(`Print failed: ${err instanceof Error ? err.message : "Unknown error"}`);
    }
  };

  const handleDownloadDayBookPdf = async () => {
    try {
      await exportDayBookPdf(
        buildDayBookHtml(getReportData(filteredTransactions), {
          renderMode: "pdf",
        }),
        `daybook_${selectedDate}.pdf`,
      );
    } catch (err) {
      alert(`PDF download failed: ${err instanceof Error ? err.message : "Unknown error"}`);
    }
  };

  const handlePrintTransaction = async (rec: DayBookRow) => {
    try {
      await printDayBookHtml(buildDayBookHtml(getReportData([rec]), {
        helperText: "Voucher print preview.",
        renderMode: "print",
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
        buildDayBookHtml(getReportData([rec]), {
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
            onClick={handlePrintDayBook}
            disabled={loading}
            className="btn-secondary px-3 py-2 text-xs flex items-center gap-1.5"
          >
            <Printer className="w-3.5 h-3.5" />
            Print Day Book
          </button>
          <button
            type="button"
            onClick={handleDownloadDayBookPdf}
            disabled={loading}
            className="btn-secondary px-3 py-2 text-xs flex items-center gap-1.5"
          >
            <Download className="w-3.5 h-3.5" />
            Download PDF
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
    </div>
  );
}
