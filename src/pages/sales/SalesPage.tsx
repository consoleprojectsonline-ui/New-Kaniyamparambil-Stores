import { useState, useEffect, useCallback } from "react";
import {
  Receipt,
  Plus,
  Search,
  Filter,
  Trash2,
  AlertTriangle,
  Check,
  Database,
  Calendar,
  User,
  Printer,
  Eye,
  Download,
  X,
  Edit,
} from "lucide-react";
import { supabase } from "@/lib/supabase";
import { formatCurrency } from "@/lib/utils";

interface InvoiceItem {
  description: string;
  qty: number;
  rate: number;
  tax_percent: number;
}

interface SaleRecord {
  invoice_no: string;
  customer_name: string;
  customer_phone: string;
  invoice_date: string;
  amount: number;
  tax_amount: number;
  payment_status: string;
  payment_mode: string;
  items_summary?: string;
  created_at?: string;
}

export default function SalesPage() {
  const [sales, setSales] = useState<SaleRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [activeTab, setActiveTab] = useState<"billing" | "history">("billing");
  const [dbStatus, setDbStatus] = useState<"connected" | "local">("connected");
  const [editingSale, setEditingSale] = useState<SaleRecord | null>(null);

  // Filter & Search states
  const [searchQuery, setSearchQuery] = useState("");
  const [paymentModeFilter, setPaymentModeFilter] = useState("All");
  const [currentPage, setCurrentPage] = useState(1);
  const itemsPerPage = 10;

  // Reset pagination to page 1 on search or filter change
  useEffect(() => {
    const timer = setTimeout(() => {
      setCurrentPage(1);
    }, 0);
    return () => clearTimeout(timer);
  }, [searchQuery, paymentModeFilter]);

  // Billing Form state
  const [invoiceNo, setInvoiceNo] = useState("");
  const [customerName, setCustomerName] = useState("");
  const [customerPhone, setCustomerPhone] = useState("");
  const [invoiceDate, setInvoiceDate] = useState(
    new Date().toISOString().split("T")[0]
  );
  const [paymentMode, setPaymentMode] = useState("UPI");
  const [paymentStatus, setPaymentStatus] = useState("Paid");

  // Dynamic Line Items
  const [lineItems, setLineItems] = useState<InvoiceItem[]>([
    { description: "", qty: 1, rate: 0, tax_percent: 18 },
  ]);

  const [formError, setFormError] = useState<string | null>(null);
  const [successMsg, setSuccessMsg] = useState<string | null>(null);
  const [viewingSale, setViewingSale] = useState<SaleRecord | null>(null);

  const loadLocalSales = useCallback(() => {
    const local = localStorage.getItem("kaniyamparambil_sales");
    if (local) {
      try {
        setSales(JSON.parse(local));
      } catch {
        setSales([]);
      }
    } else {
      // Seed some starter sales
      const seed: SaleRecord[] = [
        {
          invoice_no: "INV-2026-1001",
          customer_name: "Joy Alukkas Contractor",
          customer_phone: "9847055221",
          invoice_date: "2026-06-15",
          amount: 84320,
          tax_amount: 12862.37,
          payment_status: "Paid",
          payment_mode: "UPI",
          items_summary: "Steel Conduit, Bend Pipes",
        },
      ];
      localStorage.setItem("kaniyamparambil_sales", JSON.stringify(seed));
      setSales(seed);
    }
  }, []);

  const fetchSales = useCallback(async () => {
    try {
      setLoading(true);
      const { data, error } = await supabase
        .from("sales")
        .select("*")
        .order("invoice_date", { ascending: false });

      if (error) {
        if (error.code === "PGRST116" || error.message.includes("relation") || error.message.includes("does not exist")) {
          setDbStatus("local");
          loadLocalSales();
        } else {
          console.error("Supabase sales load error:", error);
          setDbStatus("local");
          loadLocalSales();
        }
      } else if (data) {
        setSales(data);
        setDbStatus("connected");
      }
    } catch (err) {
      console.error("Failed to connect to Supabase database:", err);
      setDbStatus("local");
      loadLocalSales();
    } finally {
      setLoading(false);
    }
  }, [loadLocalSales]);

  const generateInvoiceNumber = useCallback(() => {
    const random = Math.floor(1000 + Math.random() * 9000);
    setInvoiceNo(`INV-${new Date().getFullYear()}-${random}`);
  }, []);

  useEffect(() => {
    const timer = setTimeout(() => {
      fetchSales();
      generateInvoiceNumber();
    }, 0);
    return () => clearTimeout(timer);
  }, [fetchSales, generateInvoiceNumber]);

  // Add Row to items
  const addRow = () => {
    setLineItems([...lineItems, { description: "", qty: 1, rate: 0, tax_percent: 18 }]);
  };

  // Remove Row
  const removeRow = (index: number) => {
    if (lineItems.length === 1) return;
    setLineItems(lineItems.filter((_, idx) => idx !== index));
  };

  const updateRow = (index: number, key: keyof InvoiceItem, value: string | number) => {
    const updated = lineItems.map((item, idx) => {
      if (idx === index) {
        return { ...item, [key]: value };
      }
      return item;
    });
    setLineItems(updated);
  };

  // Calculate Totals
  const calculateTotals = () => {
    let subtotal = 0;
    let totalTax = 0;

    lineItems.forEach((item) => {
      const lineSub = item.qty * item.rate;
      const lineTax = lineSub * (item.tax_percent / 100);
      subtotal += lineSub;
      totalTax += lineTax;
    });

    return {
      subtotal,
      tax: totalTax,
      grandTotal: subtotal + totalTax,
    };
  };

  const totals = calculateTotals();

  // Create / Edit Invoice Submission
  const handleSubmitInvoice = async (e: React.FormEvent) => {
    e.preventDefault();
    setFormError(null);
    setSuccessMsg(null);

    if (!customerName.trim()) {
      setFormError("Customer Name is required.");
      return;
    }

    if (lineItems.some((i) => !i.description.trim() || i.qty <= 0 || i.rate <= 0)) {
      setFormError("All line items must have a description, quantity, and rate.");
      return;
    }

    const itemsSummary = lineItems
      .map((i) => `${i.description} (x${i.qty})`)
      .join(", ");

    const newSale: SaleRecord = {
      invoice_no: invoiceNo,
      customer_name: customerName.trim(),
      customer_phone: customerPhone.trim(),
      invoice_date: invoiceDate,
      amount: totals.grandTotal,
      tax_amount: totals.tax,
      payment_status: paymentStatus,
      payment_mode: paymentMode,
      items_summary: itemsSummary,
    };

    if (editingSale) {
      // UPDATE MODE
      if (dbStatus === "connected") {
        try {
          const { error } = await supabase
            .from("sales")
            .update(newSale)
            .eq("invoice_no", editingSale.invoice_no);
          if (error) throw error;
          setSuccessMsg(`Successfully updated Invoice "${invoiceNo}"!`);
          fetchSales();
          resetBillingForm();
        } catch (err) {
          console.error("Failed to update sales invoice:", err);
          const errMsg = err instanceof Error ? err.message : "Could not update invoice.";
          setFormError(`Supabase error: ${errMsg}`);
        }
      } else {
        const updated = sales.map((s) => (s.invoice_no === editingSale.invoice_no ? newSale : s));
        localStorage.setItem("kaniyamparambil_sales", JSON.stringify(updated));
        setSales(updated);
        setSuccessMsg(`Updated Invoice "${invoiceNo}" in Local Storage!`);
        resetBillingForm();
      }
    } else {
      // CREATE MODE
      if (dbStatus === "connected") {
        try {
          const { error } = await supabase.from("sales").insert([newSale]);
          if (error) throw error;
          setSuccessMsg(`Successfully generated and stored Invoice "${invoiceNo}"!`);
          fetchSales();
          resetBillingForm();
        } catch (err) {
          console.error("Failed to insert sales invoice:", err);
          const errMsg = err instanceof Error ? err.message : "Could not save invoice.";
          setFormError(`Supabase error: ${errMsg}`);
        }
      } else {
        const updated = [newSale, ...sales];
        localStorage.setItem("kaniyamparambil_sales", JSON.stringify(updated));
        setSales(updated);
        setSuccessMsg(`Generated Invoice "${invoiceNo}" in Local Storage!`);
        resetBillingForm();
      }
    }
  };

  const resetBillingForm = () => {
    setCustomerName("");
    setCustomerPhone("");
    setPaymentMode("UPI");
    setPaymentStatus("Paid");
    setLineItems([{ description: "", qty: 1, rate: 0, tax_percent: 18 }]);
    setEditingSale(null);
    generateInvoiceNumber();
    setTimeout(() => setSuccessMsg(null), 4000);
  };

  const handleStartEdit = (rec: SaleRecord) => {
    setEditingSale(rec);
    setInvoiceNo(rec.invoice_no);
    setCustomerName(rec.customer_name);
    setCustomerPhone(rec.customer_phone || "");
    setInvoiceDate(rec.invoice_date);
    setPaymentMode(rec.payment_mode);
    setPaymentStatus(rec.payment_status);

    const taxable = rec.amount - rec.tax_amount;
    setLineItems([
      {
        description: rec.items_summary || "General Goods",
        qty: 1,
        rate: taxable,
        tax_percent: taxable > 0 ? Number(((rec.tax_amount / taxable) * 100).toFixed(2)) : 0,
      },
    ]);
    setActiveTab("billing");
  };

  const handlePrintInvoice = (sale: SaleRecord) => {
    const printWindow = window.open("", "_blank");
    if (!printWindow) {
      alert("Popup blocker is active. Please allow popups to print invoices.");
      return;
    }
    const formattedItems = sale.items_summary || "General Goods";
    printWindow.document.write(`
      <html>
        <head>
          <title>Invoice - ${sale.invoice_no}</title>
          <style>
            body { font-family: 'Inter', sans-serif; padding: 40px; color: #1e293b; background-color: #ffffff; }
            .header { display: flex; justify-content: space-between; border-bottom: 2px solid #e2e8f0; padding-bottom: 20px; margin-bottom: 30px; }
            .company-info { text-align: left; }
            .company-name { font-size: 22px; font-weight: 800; color: #0f172a; margin: 0; }
            .company-sub { font-size: 12px; color: #64748b; margin-top: 4px; }
            .invoice-info { text-align: right; }
            .invoice-title { font-size: 24px; font-weight: 800; color: #0f4c81; margin: 0; text-transform: uppercase; }
            .invoice-details { font-size: 12px; color: #334155; margin-top: 8px; font-family: monospace; }
            .bill-to { margin-bottom: 30px; }
            .bill-to-title { font-size: 10px; font-weight: 700; text-transform: uppercase; color: #64748b; margin-bottom: 5px; }
            .customer-name { font-size: 16px; font-weight: 700; color: #0f172a; }
            .customer-details { font-size: 12px; color: #475569; margin-top: 2px; }
            table { width: 100%; border-collapse: collapse; margin-top: 20px; margin-bottom: 30px; font-size: 13px; }
            th { background-color: #f8fafc; border-bottom: 2px solid #cbd5e1; color: #475569; font-weight: 700; text-transform: uppercase; font-size: 11px; padding: 10px 14px; text-align: left; }
            td { border-bottom: 1px solid #e2e8f0; padding: 12px 14px; color: #334155; }
            .text-right { text-align: right; }
            .totals { display: flex; justify-content: flex-end; }
            .totals-table { width: 300px; margin-top: 0; }
            .totals-table td { border-bottom: none; padding: 6px 14px; }
            .totals-table tr.grand-total td { font-size: 16px; font-weight: 800; color: #0f172a; border-top: 2px solid #0f172a; padding-top: 10px; }
            .footer { border-top: 1px solid #e2e8f0; margin-top: 50px; padding-top: 20px; text-align: center; font-size: 11px; color: #94a3b8; }
          </style>
        </head>
        <body>
          <div class="header">
            <div class="company-info">
              <h1 class="company-name">New Kaniyamparambil Stores</h1>
              <p class="company-sub">Billing & Inventory Management System</p>
            </div>
            <div class="invoice-info">
              <h2 class="invoice-title">Tax Invoice</h2>
              <div class="invoice-details">
                <div>Invoice No: <strong>${sale.invoice_no}</strong></div>
                <div>Date: <strong>${sale.invoice_date}</strong></div>
                <div>Payment Mode: <strong>${sale.payment_mode}</strong></div>
              </div>
            </div>
          </div>
          
          <div class="bill-to">
            <div class="bill-to-title">Bill To:</div>
            <div class="customer-name">${sale.customer_name}</div>
            <div class="customer-details">Phone: ${sale.customer_phone || "—"}</div>
          </div>
          
          <table>
            <thead>
              <tr>
                <th>Description</th>
                <th class="text-right" style="width: 20%">Tax (GST)</th>
                <th class="text-right" style="width: 25%">Amount</th>
              </tr>
            </thead>
            <tbody>
              <tr>
                <td>${formattedItems}</td>
                <td class="text-right">₹${sale.tax_amount.toFixed(2)}</td>
                <td class="text-right">₹${(sale.amount - sale.tax_amount).toFixed(2)}</td>
              </tr>
            </tbody>
          </table>
          
          <div class="totals">
            <table class="totals-table">
              <tr>
                <td>Subtotal (Excl. Tax)</td>
                <td class="text-right">₹${(sale.amount - sale.tax_amount).toFixed(2)}</td>
              </tr>
              <tr>
                <td>Estimated GST Tax</td>
                <td class="text-right">₹${sale.tax_amount.toFixed(2)}</td>
              </tr>
              <tr class="grand-total">
                <td>Grand Total</td>
                <td class="text-right">₹${sale.amount.toFixed(2)}</td>
              </tr>
            </table>
          </div>
          
          <div class="footer">
            <p>Thank you for your business!</p>
            <p>Generated by New Kaniyamparambil Stores Management System</p>
          </div>
          
          <script>
            setTimeout(function() {
              window.focus();
              window.print();
              window.close();
            }, 300);
          </script>
        </body>
      </html>
    `);
    printWindow.document.close();
  };

  const handleDownloadInvoice = (sale: SaleRecord) => {
    try {
      const jsonString = JSON.stringify(sale, null, 2);
      const blob = new Blob([jsonString], { type: "application/json" });
      const url = URL.createObjectURL(blob);
      const downloadAnchor = document.createElement('a');
      downloadAnchor.href = url;
      downloadAnchor.download = `invoice_${sale.invoice_no}.json`;
      document.body.appendChild(downloadAnchor);
      downloadAnchor.click();
      document.body.removeChild(downloadAnchor);
      URL.revokeObjectURL(url);
    } catch (err) {
      console.error("Failed to download invoice:", err);
      alert("Failed to download invoice file.");
    }
  };

  const handleDeleteSale = async (invNo: string) => {
    if (!window.confirm(`Are you sure you want to delete invoice "${invNo}"?`)) {
      return;
    }

    if (dbStatus === "connected") {
      try {
        const { error } = await supabase.from("sales").delete().eq("invoice_no", invNo);
        if (error) throw error;
        fetchSales();
      } catch (err) {
        console.error("Delete failed:", err);
        const errMsg = err instanceof Error ? err.message : "Unknown error occurred.";
        alert(`Failed to delete record: ${errMsg}`);
      }
    } else {
      const updated = sales.filter((s) => s.invoice_no !== invNo);
      localStorage.setItem("kaniyamparambil_sales", JSON.stringify(updated));
      setSales(updated);
    }
  };

  const filteredSales = sales.filter((s) => {
    const matchesSearch =
      s.invoice_no.toLowerCase().includes(searchQuery.toLowerCase()) ||
      s.customer_name.toLowerCase().includes(searchQuery.toLowerCase()) ||
      (s.items_summary && s.items_summary.toLowerCase().includes(searchQuery.toLowerCase()));

    const matchesMode = paymentModeFilter === "All" || s.payment_mode === paymentModeFilter;
    return matchesSearch && matchesMode;
  });

  const totalPages = Math.ceil(filteredSales.length / itemsPerPage);
  const indexOfLastItem = currentPage * itemsPerPage;
  const indexOfFirstItem = indexOfLastItem - itemsPerPage;
  const currentSales = filteredSales.slice(indexOfFirstItem, indexOfLastItem);

  return (
    <div className="p-6 space-y-6">
      {/* ── Page Header ── */}
      <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-4">
        <div>
          <h1 className="text-page-title font-semibold text-text-primary flex items-center gap-2">
            <Receipt className="w-6 h-6 text-green-600" />
            Sales & Billing
          </h1>
          <p className="text-caption text-text-secondary mt-0.5">
            Generate invoice billing statements, manage Point of Sale (POS) configurations, and track transactions.
          </p>
        </div>

        <div className="flex bg-gray-100 p-1 rounded-lg">
          <button
            onClick={() => setActiveTab("billing")}
            className={`px-4 py-1.5 text-xs font-semibold rounded-md transition-all ${
              activeTab === "billing"
                ? "bg-white text-text-primary shadow-sm"
                : "text-text-secondary hover:text-text-primary"
            }`}
          >
            Billing POS Console
          </button>
          <button
            onClick={() => setActiveTab("history")}
            className={`px-4 py-1.5 text-xs font-semibold rounded-md transition-all ${
              activeTab === "history"
                ? "bg-white text-text-primary shadow-sm"
                : "text-text-secondary hover:text-text-primary"
            }`}
          >
            Invoice History Ledger
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
              The `sales` table was not found in your Supabase database. Records are currently stored locally.
              Run this SQL in your Supabase Editor to sync across devices:
            </p>
            <pre className="text-[10px] font-mono bg-blue-900/5 text-blue-900 border border-blue-200 p-2.5 rounded-md mt-2 overflow-x-auto select-all max-w-full">
              {`CREATE TABLE public.sales (
  invoice_no text PRIMARY KEY,
  customer_name text NOT NULL,
  customer_phone text,
  invoice_date date NOT NULL,
  amount numeric NOT NULL,
  tax_amount numeric DEFAULT 0 NOT NULL,
  payment_status text DEFAULT 'Paid' NOT NULL,
  payment_mode text DEFAULT 'UPI' NOT NULL,
  items_summary text,
  created_at timestamp with time zone DEFAULT timezone('utc'::text, now()) NOT NULL
);`}
            </pre>
          </div>
        </div>
      )}

      {/* ── Tabs Content ── */}
      {activeTab === "billing" ? (
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          {/* Left panel: Item configuration */}
          <div className="lg:col-span-2 bg-white border border-border rounded-xl shadow-card p-5 space-y-6">
            <div className="border-b border-border pb-3 flex items-center justify-between">
              <div>
                <h2 className="text-sm font-bold text-text-primary">Billing Line Items</h2>
                <p className="text-xs text-text-secondary">Input products and services to generate bill invoice.</p>
              </div>
              <button
                type="button"
                onClick={addRow}
                className="btn-secondary px-3 py-1 flex items-center gap-1.5 text-xs text-primary font-bold border-primary-200"
              >
                <Plus className="w-3.5 h-3.5" />
                Add Item Row
              </button>
            </div>

            <div className="space-y-4">
              {lineItems.map((item, index) => (
                <div key={index} className="grid grid-cols-12 gap-3 items-end bg-gray-50/50 p-3 rounded-lg border border-gray-100">
                  <div className="col-span-12 md:col-span-5">
                    <label className="form-label text-[11px] font-bold text-text-secondary">Description / Product Name</label>
                    <input
                      type="text"
                      value={item.description}
                      onChange={(e) => updateRow(index, "description", e.target.value)}
                      placeholder="e.g. Steel Pipe 1.5 inch"
                      className="input-enterprise"
                    />
                  </div>

                  <div className="col-span-4 md:col-span-2">
                    <label className="form-label text-[11px] font-bold text-text-secondary">Quantity</label>
                    <input
                      type="number"
                      value={item.qty}
                      onChange={(e) => updateRow(index, "qty", parseInt(e.target.value) || 0)}
                      className="input-enterprise font-mono"
                      min="1"
                    />
                  </div>

                  <div className="col-span-4 md:col-span-2">
                    <label className="form-label text-[11px] font-bold text-text-secondary">Rate (₹)</label>
                    <input
                      type="number"
                      value={item.rate || ""}
                      onChange={(e) => updateRow(index, "rate", parseFloat(e.target.value) || 0)}
                      placeholder="Price/unit"
                      className="input-enterprise font-mono"
                    />
                  </div>

                  <div className="col-span-4 md:col-span-2">
                    <label className="form-label text-[11px] font-bold text-text-secondary">GST (%)</label>
                    <select
                      value={item.tax_percent}
                      onChange={(e) => updateRow(index, "tax_percent", parseInt(e.target.value))}
                      className="input-enterprise bg-white cursor-pointer"
                    >
                      <option value="0">0%</option>
                      <option value="5">5%</option>
                      <option value="12">12%</option>
                      <option value="18">18%</option>
                      <option value="28">28%</option>
                    </select>
                  </div>

                  <div className="col-span-12 md:col-span-1 text-center">
                    <button
                      type="button"
                      onClick={() => removeRow(index)}
                      className="text-red-500 hover:text-red-700 hover:bg-red-50 p-2 rounded transition-all disabled:opacity-30 disabled:cursor-not-allowed"
                      disabled={lineItems.length === 1}
                    >
                      <Trash2 className="w-4 h-4 mx-auto" />
                    </button>
                  </div>
                </div>
              ))}
            </div>
          </div>

          {/* Right panel: Summary & Invoice Details */}
          <div className="bg-white border border-border rounded-xl shadow-card p-5 flex flex-col justify-between h-fit space-y-6">
            <div className="space-y-5">
              <div className="border-b border-border pb-3">
                <h2 className="text-sm font-bold text-text-primary">
                  {editingSale ? "Edit Invoice & Customer Details" : "Invoice & Customer Details"}
                </h2>
                <p className="text-xs text-text-secondary">
                  {editingSale
                    ? `Modifying Invoice: ${editingSale.invoice_no}`
                    : `Invoice: ${invoiceNo}`}
                </p>
              </div>

              <form onSubmit={handleSubmitInvoice} className="space-y-4">
                {formError && (
                  <div className="bg-red-50 border border-red-200 text-red-800 text-[11px] px-3 py-2 rounded flex items-center gap-1.5">
                    <AlertTriangle className="w-3.5 h-3.5 flex-shrink-0" />
                    <span>{formError}</span>
                  </div>
                )}

                {successMsg && (
                  <div className="bg-green-50 border border-green-200 text-green-800 text-[11px] px-3 py-2 rounded flex items-center gap-1.5">
                    <Check className="w-3.5 h-3.5 flex-shrink-0" />
                    <span>{successMsg}</span>
                  </div>
                )}

                <div>
                  <label className="form-label text-xs">Customer Name *</label>
                  <div className="relative">
                    <User className="w-3.5 h-3.5 absolute left-3 top-3 text-text-secondary" />
                    <input
                      type="text"
                      value={customerName}
                      onChange={(e) => setCustomerName(e.target.value)}
                      placeholder="e.g. Anish K. Nair"
                      className="input-enterprise pl-9"
                      required
                    />
                  </div>
                </div>

                <div>
                  <label className="form-label text-xs">Customer Phone (Optional)</label>
                  <input
                    type="tel"
                    value={customerPhone}
                    onChange={(e) => setCustomerPhone(e.target.value)}
                    placeholder="10-digit mobile number"
                    className="input-enterprise font-mono"
                  />
                </div>

                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="form-label text-xs">Date</label>
                    <input
                      type="date"
                      value={invoiceDate}
                      onChange={(e) => setInvoiceDate(e.target.value)}
                      className="input-enterprise font-mono"
                    />
                  </div>

                  <div>
                    <label className="form-label text-xs">Payment Status</label>
                    <select
                      value={paymentStatus}
                      onChange={(e) => setPaymentStatus(e.target.value)}
                      className="input-enterprise bg-white cursor-pointer"
                    >
                      <option value="Paid">Paid / Settled</option>
                      <option value="Credit">Credit / Outstanding</option>
                    </select>
                  </div>
                </div>

                <div>
                  <label className="form-label text-xs">Payment Mode</label>
                  <div className="grid grid-cols-3 gap-2">
                    {["UPI", "Cash", "Card"].map((mode) => (
                      <button
                        key={mode}
                        type="button"
                        onClick={() => setPaymentMode(mode)}
                        className={`py-1.5 text-xs font-semibold border rounded transition-all ${
                          paymentMode === mode
                            ? "bg-green-50 text-green-700 border-green-300 ring-2 ring-green-100"
                            : "bg-white text-text-secondary border-border hover:bg-gray-50"
                        }`}
                      >
                        {mode}
                      </button>
                    ))}
                  </div>
                </div>

                {/* Subtotals card */}
                <div className="bg-gray-50 p-4 rounded-xl border border-gray-100 space-y-2.5">
                  <div className="flex justify-between text-xs text-text-secondary">
                    <span>Taxable Value:</span>
                    <span className="font-mono">{formatCurrency(totals.subtotal)}</span>
                  </div>
                  <div className="flex justify-between text-xs text-text-secondary border-b border-dashed border-gray-200 pb-2">
                    <span>GST Tax Amount:</span>
                    <span className="font-mono text-green-700">+{formatCurrency(totals.tax)}</span>
                  </div>
                  <div className="flex justify-between text-sm font-bold text-text-primary pt-1">
                    <span>Grand Total:</span>
                    <span className="font-mono text-base text-gray-900">{formatCurrency(totals.grandTotal)}</span>
                  </div>
                </div>

                <div className="flex flex-col gap-2">
                  <button
                    type="submit"
                    className="w-full btn-primary bg-green-600 hover:bg-green-700 active:bg-green-800 py-2.5 shadow-sm font-semibold flex items-center justify-center gap-2 text-white rounded transition-colors"
                  >
                    <Printer className="w-4 h-4" />
                    {editingSale ? "Save & Update Invoice" : "Save & Print Bill"}
                  </button>

                  {editingSale && (
                    <button
                      type="button"
                      onClick={resetBillingForm}
                      className="w-full btn-secondary py-2 border border-slate-300 text-slate-700 hover:bg-slate-100 font-semibold flex items-center justify-center gap-2 rounded transition-colors"
                    >
                      Cancel Edit / New Invoice
                    </button>
                  )}
                </div>
              </form>
            </div>
          </div>
        </div>
      ) : (
        /* History Ledger Tab */
        <div className="space-y-4">
          <div className="bg-white border border-border rounded-xl shadow-card p-4 flex flex-col md:flex-row md:items-center justify-between gap-4">
            <div className="relative flex-1 max-w-md">
              <Search className="w-4 h-4 text-text-secondary absolute left-3 top-3" />
              <input
                type="text"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                placeholder="Search Invoice #, Customer name, products..."
                className="input-enterprise pl-9"
              />
            </div>

            <div className="flex items-center gap-3">
              <div className="flex items-center gap-1.5 text-xs font-semibold text-text-secondary">
                <Filter className="w-3.5 h-3.5" />
                <span>Payment Mode:</span>
              </div>
              <select
                value={paymentModeFilter}
                onChange={(e) => setPaymentModeFilter(e.target.value)}
                className="input-enterprise bg-white cursor-pointer w-40"
              >
                <option value="All">All Modes</option>
                <option value="UPI">UPI</option>
                <option value="Cash">Cash</option>
                <option value="Card">Card</option>
              </select>
            </div>
          </div>

          <div className="bg-white border border-border rounded-xl shadow-card overflow-hidden">
            <div className="overflow-x-auto">
              <table className="table-enterprise w-full text-xs">
                <thead>
                  <tr className="bg-gray-50 border-b border-border">
                    <th className="px-4 py-3 text-center font-semibold uppercase tracking-wider text-text-secondary">Invoice No.</th>
                    <th className="px-4 py-3 text-center font-semibold uppercase tracking-wider text-text-secondary">Customer Name</th>
                    <th className="px-4 py-3 text-center font-semibold uppercase tracking-wider text-text-secondary">Phone</th>
                    <th className="px-4 py-3 text-center font-semibold uppercase tracking-wider text-text-secondary">Invoice Date</th>
                    <th className="px-4 py-3 text-center font-semibold uppercase tracking-wider text-text-secondary">Items Summary</th>
                    <th className="px-4 py-3 text-center font-semibold uppercase tracking-wider text-text-secondary">Tax Amount (₹)</th>
                    <th className="px-4 py-3 text-center font-semibold uppercase tracking-wider text-text-secondary">Total Bill (₹)</th>
                    <th className="px-4 py-3 text-center font-semibold uppercase tracking-wider text-text-secondary">Mode</th>
                    <th className="px-4 py-3 text-center font-semibold uppercase tracking-wider text-text-secondary">Status</th>
                    <th className="px-4 py-3 text-center font-semibold uppercase tracking-wider text-text-secondary">Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {loading ? (
                    <tr>
                      <td colSpan={10} className="text-center py-12">
                        <svg className="w-6 h-6 animate-spin text-primary mx-auto mb-2" fill="none" viewBox="0 0 24 24">
                          <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                          <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
                        </svg>
                        <span className="text-xs text-text-secondary">Fetching invoice ledger...</span>
                      </td>
                    </tr>
                  ) : filteredSales.length === 0 ? (
                    <tr>
                      <td colSpan={10} className="text-center py-16 text-text-secondary">
                        <Calendar className="w-8 h-8 mx-auto text-gray-300 mb-2" />
                        <p className="font-semibold text-sm">No sales invoices found</p>
                        <p className="text-xs text-gray-400 mt-1">Try generating a POS invoice.</p>
                      </td>
                    </tr>
                  ) : (
                    currentSales.map((sale) => (
                      <tr key={sale.invoice_no} className="border-b border-border hover:bg-gray-50/50 transition-colors">
                        <td className="px-4 py-2.5 font-semibold text-gray-900 font-mono text-center">{sale.invoice_no}</td>
                        <td className="px-4 py-2.5 font-medium text-gray-800 text-center truncate max-w-[150px] mx-auto" title={sale.customer_name}>{sale.customer_name}</td>
                        <td className="px-4 py-2.5 text-text-secondary font-mono text-center">{sale.customer_phone || "—"}</td>
                        <td className="px-4 py-2.5 text-text-secondary font-mono text-center">{sale.invoice_date}</td>
                        <td className="px-4 py-2.5 text-gray-600 truncate max-w-[200px] text-center mx-auto" title={sale.items_summary || "—"}>{sale.items_summary || "—"}</td>
                        <td className="px-4 py-2.5 text-center font-mono text-text-secondary">
                          {formatCurrency(sale.tax_amount)}
                        </td>
                        <td className="px-4 py-2.5 text-center font-mono font-bold text-gray-900">
                          {formatCurrency(sale.amount)}
                        </td>
                        <td className="px-4 py-2.5 text-center">
                          <span className="inline-block px-2 py-0.5 rounded text-[10px] font-bold bg-primary/5 text-primary border border-primary/10">
                            {sale.payment_mode}
                          </span>
                        </td>
                        <td className="px-4 py-2.5 text-center">
                          <span
                            className={`inline-flex items-center px-2 py-0.5 rounded text-[10px] font-bold ${
                              sale.payment_status === "Paid"
                                ? "bg-green-100 text-green-800 border border-green-200"
                                : "bg-red-100 text-red-800 border border-red-200"
                            }`}
                          >
                            {sale.payment_status}
                          </span>
                        </td>
                        <td className="px-4 py-2.5 text-center">
                          <div className="flex items-center justify-center gap-1.5">
                            <button
                              type="button"
                              onClick={() => setViewingSale(sale)}
                              className="text-slate-500 hover:text-slate-900 hover:bg-slate-100 p-1.5 rounded transition-all"
                              title="View Invoice"
                            >
                              <Eye className="w-3.5 h-3.5" />
                            </button>
                            <button
                              type="button"
                              onClick={() => handleStartEdit(sale)}
                              className="text-slate-500 hover:text-slate-900 hover:bg-slate-100 p-1.5 rounded transition-all"
                              title="Edit Invoice"
                            >
                              <Edit className="w-3.5 h-3.5" />
                            </button>
                            <button
                              type="button"
                              onClick={() => handlePrintInvoice(sale)}
                              className="text-slate-500 hover:text-slate-900 hover:bg-slate-100 p-1.5 rounded transition-all"
                              title="Print Invoice"
                              aria-label="Print Invoice"
                            >
                              <Printer className="w-3.5 h-3.5" />
                            </button>
                            <button
                              type="button"
                              onClick={() => handleDownloadInvoice(sale)}
                              className="text-slate-500 hover:text-slate-900 hover:bg-slate-100 p-1.5 rounded transition-all"
                              title="Download JSON Invoice"
                            >
                              <Download className="w-3.5 h-3.5" />
                            </button>
                            <button
                              type="button"
                              onClick={() => handleDeleteSale(sale.invoice_no)}
                              className="text-red-500 hover:text-red-700 hover:bg-red-50 p-1.5 rounded transition-all"
                              title="Delete invoice"
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
                Showing <span className="font-semibold text-text-primary">{filteredSales.length > 0 ? indexOfFirstItem + 1 : 0}</span> to{" "}
                <span className="font-semibold text-text-primary">{Math.min(indexOfLastItem, filteredSales.length)}</span> of{" "}
                <span className="font-semibold text-text-primary">{filteredSales.length}</span> invoices
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
                Total Revenue:{" "}
                <span className="font-mono text-green-700 bg-green-50 px-2 py-0.5 border border-green-100 rounded">
                  {formatCurrency(filteredSales.reduce((acc, curr) => acc + curr.amount, 0))}
                </span>
              </div>
            </div>
            </div>
          </div>
        )}

        {/* ── View Invoice Details Modal ── */}
        {viewingSale && (
          <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/40 backdrop-blur-[2px]">
            <div
              className="absolute inset-0 transition-opacity"
              onClick={() => setViewingSale(null)}
            />

            <div className="bg-white border border-slate-200 rounded-xl shadow-2xl relative max-w-2xl w-full animate-in fade-in zoom-in-95 duration-150 z-10 flex flex-col font-sans">
              {/* Header */}
              <div className="bg-slate-900 px-6 py-4 text-white rounded-t-xl flex items-center justify-between shadow-md">
                <div>
                  <h2 className="text-sm font-bold tracking-tight">Invoice Details Sheet</h2>
                  <p className="text-[10px] text-slate-300 mt-0.5">Invoice: {viewingSale.invoice_no}</p>
                </div>
                <button
                  type="button"
                  onClick={() => setViewingSale(null)}
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
                    <span className="text-[10px] font-bold text-slate-400 uppercase tracking-wider block">Invoice Number</span>
                    <span className="font-mono font-semibold text-slate-900 text-sm">{viewingSale.invoice_no}</span>
                  </div>
                  <div className="border-b border-slate-100 pb-2">
                    <span className="text-[10px] font-bold text-slate-400 uppercase tracking-wider block">Billing Date</span>
                    <span className="font-mono text-slate-700">{viewingSale.invoice_date}</span>
                  </div>
                  <div className="col-span-2 border-b border-slate-100 pb-2">
                    <span className="text-[10px] font-bold text-slate-400 uppercase tracking-wider block">Customer Name</span>
                    <span className="font-medium text-slate-900 text-sm">{viewingSale.customer_name}</span>
                  </div>
                  <div className="border-b border-slate-100 pb-2">
                    <span className="text-[10px] font-bold text-slate-400 uppercase tracking-wider block">Customer Phone</span>
                    <span className="font-mono text-slate-700">{viewingSale.customer_phone || "—"}</span>
                  </div>
                  <div className="border-b border-slate-100 pb-2">
                    <span className="text-[10px] font-bold text-slate-400 uppercase tracking-wider block">Payment Mode</span>
                    <span className="font-semibold text-slate-700">{viewingSale.payment_mode}</span>
                  </div>
                  <div className="col-span-2 border-b border-slate-100 pb-2">
                    <span className="text-[10px] font-bold text-slate-400 uppercase tracking-wider block">Items Summary</span>
                    <span className="font-medium text-slate-700">{viewingSale.items_summary || "—"}</span>
                  </div>
                  <div className="border-b border-slate-100 pb-2">
                    <span className="text-[10px] font-bold text-slate-400 uppercase tracking-wider block">Estimated Tax (GST)</span>
                    <span className="font-mono font-semibold text-slate-700">{formatCurrency(viewingSale.tax_amount)}</span>
                  </div>
                  <div className="border-b border-slate-100 pb-2">
                    <span className="text-[10px] font-bold text-slate-400 uppercase tracking-wider block">Grand Total Bill</span>
                    <span className="font-mono font-bold text-green-700 text-sm">{formatCurrency(viewingSale.amount)}</span>
                  </div>
                  <div className="border-b border-slate-100 pb-2">
                    <span className="text-[10px] font-bold text-slate-400 uppercase tracking-wider block">Payment Status</span>
                    <span className={`inline-flex items-center px-2 py-0.5 rounded text-[10px] font-bold mt-1 ${
                      viewingSale.payment_status === 'Paid' ? 'bg-green-100 text-green-800' : 'bg-red-100 text-red-800'
                    }`}>
                      {viewingSale.payment_status}
                    </span>
                  </div>
                </div>
              </div>

              {/* Footer Buttons */}
              <div className="flex items-center justify-end gap-3 pt-4 border-t border-slate-200 bg-slate-50 p-4 rounded-b-xl">
                <button
                  type="button"
                  onClick={() => handlePrintInvoice(viewingSale)}
                  className="btn-secondary px-4 py-2 font-semibold text-xs border border-slate-300 text-slate-700 hover:bg-slate-100 transition-colors rounded flex items-center gap-1.5"
                >
                  <Printer className="w-3.5 h-3.5" />
                  Print Invoice
                </button>
                <button
                  type="button"
                  onClick={() => setViewingSale(null)}
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
