import { useState, useEffect, useCallback } from "react";
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
  Send,
  Eye,
  Download,
  Printer,
  X,
  Edit,
} from "lucide-react";
import { supabase } from "@/lib/supabase";
import { formatCurrency } from "@/lib/utils";

interface QuotationRecord {
  quotation_no: string;
  customer_name: string;
  customer_phone: string;
  valid_till: string;
  amount: number;
  status: string; // "Pending" | "Sent" | "Approved"
  items_summary?: string;
  created_at?: string;
}

export default function QuotationPage() {
  const [quotations, setQuotations] = useState<QuotationRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [isFormOpen, setIsFormOpen] = useState(false);
  const [dbStatus, setDbStatus] = useState<"connected" | "local">("connected");
  const [editingQuotation, setEditingQuotation] = useState<QuotationRecord | null>(null);

  // Search & Filter state
  const [searchQuery, setSearchQuery] = useState("");
  const [statusFilter, setStatusFilter] = useState("All");
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
  const [quotationNo, setQuotationNo] = useState("");
  const [customerName, setCustomerName] = useState("");
  const [customerPhone, setCustomerPhone] = useState("");
  const [validTill, setValidTill] = useState("");
  const [amount, setAmount] = useState("");
  const [itemsSummary, setItemsSummary] = useState("");
  const [status, setStatus] = useState("Pending");

  const [formError, setFormError] = useState<string | null>(null);
  const [successMsg, setSuccessMsg] = useState<string | null>(null);

  const [viewingQuotation, setViewingQuotation] = useState<QuotationRecord | null>(null);

  const loadLocalQuotations = useCallback(() => {
    const local = localStorage.getItem("kaniyamparambil_quotations");
    if (local) {
      try {
        setQuotations(JSON.parse(local));
      } catch {
        setQuotations([]);
      }
    } else {
      // Seed some starter quotations
      const seed: QuotationRecord[] = [
        {
          quotation_no: "QTN-2026-3021",
          customer_name: "Trivandrum Metro Projects",
          customer_phone: "9447012345",
          valid_till: "2026-07-30",
          amount: 540000,
          status: "Pending",
          items_summary: "Bulk Steel Conduit Pipes, PVC Bends, Cables",
        },
      ];
      localStorage.setItem("kaniyamparambil_quotations", JSON.stringify(seed));
      setQuotations(seed);
    }
  }, []);

  const fetchQuotations = useCallback(async () => {
    try {
      setLoading(true);
      const { data, error } = await supabase
        .from("quotations")
        .select("*")
        .order("created_at", { ascending: false });

      if (error) {
        if (error.code === "PGRST116" || error.message.includes("relation") || error.message.includes("does not exist")) {
          setDbStatus("local");
          loadLocalQuotations();
        } else {
          console.error("Supabase quotations load error:", error);
          setDbStatus("local");
          loadLocalQuotations();
        }
      } else if (data) {
        setQuotations(data);
        setDbStatus("connected");
      }
    } catch (err) {
      console.error("Failed to connect to Supabase database:", err);
      setDbStatus("local");
      loadLocalQuotations();
    } finally {
      setLoading(false);
    }
  }, [loadLocalQuotations]);

  const generateQuotationNumber = useCallback(() => {
    const random = Math.floor(1000 + Math.random() * 9000);
    setQuotationNo(`QTN-${new Date().getFullYear()}-${random}`);
  }, []);

  const setDefaultDate = useCallback(() => {
    const nextMonth = new Date();
    nextMonth.setMonth(nextMonth.getMonth() + 1);
    setValidTill(nextMonth.toISOString().split("T")[0]);
  }, []);

  useEffect(() => {
    const timer = setTimeout(() => {
      fetchQuotations();
      generateQuotationNumber();
      setDefaultDate();
    }, 0);
    return () => clearTimeout(timer);
  }, [fetchQuotations, generateQuotationNumber, setDefaultDate]);

  // Add / Edit Quotation Submit Handler
  const handleSubmitForm = async (e: React.FormEvent) => {
    e.preventDefault();
    setFormError(null);
    setSuccessMsg(null);

    if (!customerName.trim() || !amount || !validTill) {
      setFormError("Customer Name, Estimate Amount, and Validity Date are required.");
      return;
    }

    const estAmount = Number(amount);
    if (isNaN(estAmount) || estAmount <= 0) {
      setFormError("Estimate amount must be a positive number.");
      return;
    }

    const newQuotation: QuotationRecord = {
      quotation_no: quotationNo,
      customer_name: customerName.trim(),
      customer_phone: customerPhone.trim(),
      valid_till: validTill,
      amount: estAmount,
      status: status,
      items_summary: itemsSummary.trim(),
    };

    if (editingQuotation) {
      // UPDATE MODE
      if (dbStatus === "connected") {
        try {
          const { error } = await supabase
            .from("quotations")
            .update(newQuotation)
            .eq("quotation_no", editingQuotation.quotation_no);
          if (error) throw error;
          setSuccessMsg(`Successfully updated Quotation "${quotationNo}"!`);
          fetchQuotations();
          resetForm();
        } catch (err) {
          console.error("Failed to update quotation:", err);
          const errMsg = err instanceof Error ? err.message : "Could not update quotation.";
          setFormError(`Supabase error: ${errMsg}`);
        }
      } else {
        // Local storage update path
        const updated = quotations.map((q) => (q.quotation_no === editingQuotation.quotation_no ? newQuotation : q));
        localStorage.setItem("kaniyamparambil_quotations", JSON.stringify(updated));
        setQuotations(updated);
        setSuccessMsg(`Updated Quotation "${quotationNo}" in Local Storage!`);
        resetForm();
      }
    } else {
      // CREATE MODE
      if (quotations.some((q) => q.quotation_no === newQuotation.quotation_no)) {
        setFormError(`Quotation No. '${newQuotation.quotation_no}' already exists.`);
        return;
      }

      if (dbStatus === "connected") {
        try {
          const { error } = await supabase.from("quotations").insert([newQuotation]);
          if (error) throw error;
          setSuccessMsg(`Successfully created Quotation "${quotationNo}"!`);
          fetchQuotations();
          resetForm();
        } catch (err) {
          console.error("Failed to insert quotation:", err);
          const errMsg = err instanceof Error ? err.message : "Could not save quotation.";
          setFormError(`Supabase error: ${errMsg}`);
        }
      } else {
        const updated = [newQuotation, ...quotations];
        localStorage.setItem("kaniyamparambil_quotations", JSON.stringify(updated));
        setQuotations(updated);
        setSuccessMsg(`Saved Quotation "${quotationNo}" to Local Storage!`);
        resetForm();
      }
    }
  };

  const handleStartEdit = (rec: QuotationRecord) => {
    setEditingQuotation(rec);
    setQuotationNo(rec.quotation_no);
    setCustomerName(rec.customer_name);
    setCustomerPhone(rec.customer_phone || "");
    setValidTill(rec.valid_till);
    setAmount(String(rec.amount));
    setItemsSummary(rec.items_summary || "");
    setStatus(rec.status);
    setIsFormOpen(true);
  };

  const resetForm = () => {
    setCustomerName("");
    setCustomerPhone("");
    setAmount("");
    setItemsSummary("");
    setStatus("Pending");
    setEditingQuotation(null);
    generateQuotationNumber();
    setDefaultDate();
    setTimeout(() => setSuccessMsg(null), 4000);
  };

  const handlePrintQuotation = (rec: QuotationRecord) => {
    const printWindow = window.open("", "_blank");
    if (!printWindow) {
      alert("Popup blocker is active. Please allow popups to print quotations.");
      return;
    }
    const formattedItems = rec.items_summary || "General Goods Estimation";
    printWindow.document.write(`
      <html>
        <head>
          <title>Quotation - ${rec.quotation_no}</title>
          <style>
            body { font-family: 'Inter', sans-serif; padding: 40px; color: #1e293b; background-color: #ffffff; }
            .header { border-bottom: 2px solid #0f172a; padding-bottom: 12px; margin-bottom: 24px; }
            .title { font-size: 20px; font-weight: 700; color: #0f172a; margin: 0; }
            .subtitle { font-size: 12px; color: #64748b; margin-top: 4px; }
            table { width: 100%; border-collapse: collapse; margin-top: 20px; font-size: 13px; }
            th, td { border: 1px solid #e2e8f0; padding: 10px 14px; text-align: left; }
            th { background-color: #f8fafc; font-weight: 600; color: #475569; width: 35%; }
            td { color: #0f172a; font-weight: 500; }
          </style>
        </head>
        <body>
          <div class="header">
            <h1 class="title">New Kaniyamparambil Stores</h1>
            <p class="subtitle">Estimate / Price Quotation Sheet</p>
          </div>
          <table>
            <tr><th>Quotation No.</th><td>${rec.quotation_no}</td></tr>
            <tr><th>Customer / Wholesaler</th><td>${rec.customer_name}</td></tr>
            <tr><th>Contact Phone</th><td>${rec.customer_phone || "—"}</td></tr>
            <tr><th>Valid Till Date</th><td>${rec.valid_till}</td></tr>
            <tr><th>Estimated Scope / Items</th><td>${formattedItems}</td></tr>
            <tr><th>Estimated Amount (₹)</th><td>₹${rec.amount.toFixed(2)}</td></tr>
            <tr><th>Status</th><td>${rec.status}</td></tr>
          </table>
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

  const handleDownloadQuotation = (rec: QuotationRecord) => {
    try {
      const jsonString = JSON.stringify(rec, null, 2);
      const blob = new Blob([jsonString], { type: "application/json" });
      const url = URL.createObjectURL(blob);
      const downloadAnchor = document.createElement('a');
      downloadAnchor.href = url;
      downloadAnchor.download = `quotation_${rec.quotation_no}.json`;
      document.body.appendChild(downloadAnchor);
      downloadAnchor.click();
      document.body.removeChild(downloadAnchor);
      URL.revokeObjectURL(url);
    } catch (err) {
      console.error("Failed to download quotation:", err);
      alert("Failed to download quotation details.");
    }
  };

  const handleDeleteQuotation = async (qNo: string) => {
    if (!window.confirm(`Are you sure you want to delete quotation "${qNo}"?`)) {
      return;
    }

    if (dbStatus === "connected") {
      try {
        const { error } = await supabase.from("quotations").delete().eq("quotation_no", qNo);
        if (error) throw error;
        fetchQuotations();
      } catch (err) {
        console.error("Delete failed:", err);
        const errMsg = err instanceof Error ? err.message : "Unknown error occurred.";
        alert(`Failed to delete record: ${errMsg}`);
      }
    } else {
      const updated = quotations.filter((q) => q.quotation_no !== qNo);
      localStorage.setItem("kaniyamparambil_quotations", JSON.stringify(updated));
      setQuotations(updated);
    }
  };

  const filteredQuotations = quotations.filter((q) => {
    const matchesSearch =
      q.quotation_no.toLowerCase().includes(searchQuery.toLowerCase()) ||
      q.customer_name.toLowerCase().includes(searchQuery.toLowerCase()) ||
      (q.items_summary && q.items_summary.toLowerCase().includes(searchQuery.toLowerCase()));

    const matchesStatus = statusFilter === "All" || q.status === statusFilter;
    return matchesSearch && matchesStatus;
  });

  const totalPages = Math.ceil(filteredQuotations.length / itemsPerPage);
  const indexOfLastItem = currentPage * itemsPerPage;
  const indexOfFirstItem = indexOfLastItem - itemsPerPage;
  const currentQuotations = filteredQuotations.slice(indexOfFirstItem, indexOfLastItem);

  return (
    <div className="p-6 space-y-6">
      {/* ── Page Header ── */}
      <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-4">
        <div>
          <h1 className="text-page-title font-semibold text-text-primary flex items-center gap-2">
            <FileSpreadsheet className="w-6 h-6 text-teal-600" />
            Quotations
          </h1>
          <p className="text-caption text-text-secondary mt-0.5">
            Prepare pricing estimates, dispatch quotations to high-value customers, and track pending approvals.
          </p>
        </div>

        <button
          onClick={() => {
            if (!isFormOpen) {
              resetForm();
            }
            setIsFormOpen(!isFormOpen);
          }}
          className="btn-primary bg-teal-600 hover:bg-teal-700 active:bg-teal-800 flex items-center gap-1.5 shadow-sm"
        >
          <Plus className="w-4 h-4" />
          {isFormOpen ? "Close Panel" : "Prepare Quotation"}
        </button>
      </div>

      {/* ── DB Status Notice ── */}
      {dbStatus === "local" && (
        <div className="bg-blue-50 border border-blue-200 rounded-lg p-4 flex items-start gap-3 shadow-card">
          <Database className="w-5 h-5 text-blue-600 mt-0.5 flex-shrink-0" />
          <div>
            <h4 className="text-sm font-semibold text-blue-800">Local Mode Active</h4>
            <p className="text-xs text-blue-700 mt-0.5 leading-relaxed">
              The `quotations` table was not found in your Supabase database. Estimations are saved locally.
              Run this SQL in your Supabase Editor to sync across devices:
            </p>
            <pre className="text-[10px] font-mono bg-blue-900/5 text-blue-900 border border-blue-200 p-2.5 rounded-md mt-2 overflow-x-auto select-all max-w-full">
              {`CREATE TABLE public.quotations (
  quotation_no text PRIMARY KEY,
  customer_name text NOT NULL,
  customer_phone text,
  valid_till date NOT NULL,
  amount numeric NOT NULL,
  status text DEFAULT 'Pending' NOT NULL,
  items_summary text,
  created_at timestamp with time zone DEFAULT timezone('utc'::text, now()) NOT NULL
);`}
            </pre>
          </div>
        </div>
      )}

      {/* ── Quotation Generation Form ── */}
      {isFormOpen && (
        <div className="bg-white border border-border rounded-xl shadow-lg p-6 animate-fade-in">
          <div className="border-b border-border pb-3 mb-5">
            <h2 className="text-base font-bold text-text-primary">
              {editingQuotation ? `Edit Estimate / Quotation: ${editingQuotation.quotation_no}` : "New Estimate / Quotation"}
            </h2>
            <p className="text-xs text-text-secondary">Provide customer details and project specifications for billing estimate.</p>
          </div>

          <form onSubmit={handleSubmitForm} className="space-y-4">
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

            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-5">
              <div>
                <label className="form-label text-xs">Customer/Business Name *</label>
                <input
                  type="text"
                  value={customerName}
                  onChange={(e) => setCustomerName(e.target.value)}
                  placeholder="e.g. Skyline Builders Corp"
                  className="input-enterprise"
                  required
                />
              </div>

              <div>
                <label className="form-label text-xs">Quotation Number</label>
                <input
                  type="text"
                  value={quotationNo}
                  disabled
                  className="input-enterprise bg-gray-100 text-gray-500 font-mono"
                />
              </div>

              <div>
                <label className="form-label text-xs">Validity Until *</label>
                <input
                  type="date"
                  value={validTill}
                  onChange={(e) => setValidTill(e.target.value)}
                  className="input-enterprise font-mono"
                  required
                />
              </div>

              <div>
                <label className="form-label text-xs">Estimated Price (₹) *</label>
                <div className="relative">
                  <span className="absolute left-3 top-2.5 text-xs font-semibold text-text-secondary">₹</span>
                  <input
                    type="number"
                    value={amount}
                    onChange={(e) => setAmount(e.target.value)}
                    placeholder="Grand total estimation"
                    className="input-enterprise pl-7 font-mono font-semibold"
                    required
                  />
                </div>
              </div>

              <div>
                <label className="form-label text-xs">Status</label>
                <select
                  value={status}
                  onChange={(e) => setStatus(e.target.value)}
                  className="input-enterprise bg-white cursor-pointer"
                >
                  <option value="Pending">Pending Review</option>
                  <option value="Sent">Dispatched / Sent</option>
                  <option value="Approved">Approved by Customer</option>
                </select>
              </div>

              <div>
                <label className="form-label text-xs">Customer Phone</label>
                <input
                  type="tel"
                  value={customerPhone}
                  onChange={(e) => setCustomerPhone(e.target.value)}
                  placeholder="Contact number"
                  className="input-enterprise font-mono"
                />
              </div>
            </div>

            <div>
              <label className="form-label text-xs">Items Description / Quotation Scope</label>
              <textarea
                value={itemsSummary}
                onChange={(e) => setItemsSummary(e.target.value)}
                placeholder="List items or brief project scopes included..."
                className="input-enterprise h-20 resize-none py-2"
              />
            </div>

            <div className="flex items-center justify-end gap-3 pt-4 border-t border-border">
              <button type="button" onClick={resetForm} className="btn-secondary px-5">
                Clear
              </button>
              <button type="submit" className="btn-primary bg-teal-600 hover:bg-teal-700 active:bg-teal-800 px-6 shadow-sm">
                {editingQuotation ? "Save & Update Estimate" : "Save Quotation"}
              </button>
            </div>
          </form>
        </div>
      )}

      {/* ── Filters & Search ── */}
      <div className="bg-white border border-border rounded-xl shadow-card p-4 flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div className="relative flex-1 max-w-md">
          <Search className="w-4 h-4 text-text-secondary absolute left-3 top-3" />
          <input
            type="text"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder="Search Quotation No, Customer, items..."
            className="input-enterprise pl-9"
          />
        </div>

        <div className="flex items-center gap-3">
          <div className="flex items-center gap-1.5 text-xs font-semibold text-text-secondary">
            <Filter className="w-3.5 h-3.5" />
            <span>Quotation Status:</span>
          </div>
          <select
            value={statusFilter}
            onChange={(e) => setStatusFilter(e.target.value)}
            className="input-enterprise bg-white cursor-pointer w-40"
          >
            <option value="All">All Estimates</option>
            <option value="Pending">Pending</option>
            <option value="Sent">Sent</option>
            <option value="Approved">Approved</option>
          </select>
        </div>
      </div>

      {/* ── Quotation Ledger Table ── */}
      <div className="bg-white border border-border rounded-xl shadow-card overflow-hidden">
        <div className="overflow-x-auto">
          <table className="table-enterprise w-full text-xs">
            <thead>
              <tr className="bg-gray-50 border-b border-border">
                <th className="px-4 py-3 text-center font-semibold uppercase tracking-wider text-text-secondary">Quotation No.</th>
                <th className="px-4 py-3 text-center font-semibold uppercase tracking-wider text-text-secondary">Customer / Wholesaler</th>
                <th className="px-4 py-3 text-center font-semibold uppercase tracking-wider text-text-secondary">Phone</th>
                <th className="px-4 py-3 text-center font-semibold uppercase tracking-wider text-text-secondary">Validity Date</th>
                <th className="px-4 py-3 text-center font-semibold uppercase tracking-wider text-text-secondary">Scope Summary</th>
                <th className="px-4 py-3 text-center font-semibold uppercase tracking-wider text-text-secondary">Estimated Total (₹)</th>
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
                    <span className="text-xs text-text-secondary">Fetching quotation book...</span>
                  </td>
                </tr>
              ) : filteredQuotations.length === 0 ? (
                <tr>
                  <td colSpan={8} className="text-center py-16 text-text-secondary">
                    <Calendar className="w-8 h-8 mx-auto text-gray-300 mb-2" />
                    <p className="font-semibold text-sm">No quotations found</p>
                    <p className="text-xs text-gray-400 mt-1">Prepare an estimate to high-value orders.</p>
                  </td>
                </tr>
              ) : (
                currentQuotations.map((q) => (
                  <tr key={q.quotation_no} className="border-b border-border hover:bg-gray-50/50 transition-colors">
                    <td className="px-4 py-2.5 font-semibold text-gray-900 font-mono text-center">{q.quotation_no}</td>
                    <td className="px-4 py-2.5 font-medium text-gray-800 text-center truncate max-w-[150px] mx-auto" title={q.customer_name}>{q.customer_name}</td>
                    <td className="px-4 py-2.5 text-text-secondary font-mono text-center">{q.customer_phone || "—"}</td>
                    <td className="px-4 py-2.5 text-text-secondary font-mono text-center">{q.valid_till}</td>
                    <td className="px-4 py-2.5 text-gray-600 truncate max-w-[220px] text-center mx-auto" title={q.items_summary || "—"}>{q.items_summary || "—"}</td>
                    <td className="px-4 py-2.5 text-center font-mono font-bold text-gray-900">
                      {formatCurrency(q.amount)}
                    </td>
                    <td className="px-4 py-2.5 text-center">
                      <span
                        className={`inline-flex items-center px-2 py-0.5 rounded text-[10px] font-bold ${
                          q.status === "Approved"
                            ? "bg-green-100 text-green-800 border border-green-200"
                            : q.status === "Sent"
                            ? "bg-blue-100 text-blue-800 border border-blue-200"
                            : "bg-amber-100 text-amber-800 border border-amber-200"
                        }`}
                      >
                        {q.status}
                      </span>
                    </td>
                    <td className="px-4 py-2.5 text-center">
                      <div className="flex items-center justify-center gap-1.5">
                        <button
                          type="button"
                          onClick={() => setViewingQuotation(q)}
                          className="text-slate-500 hover:text-slate-900 hover:bg-slate-100 p-1.5 rounded transition-all"
                          title="View Details"
                        >
                          <Eye className="w-3.5 h-3.5" />
                        </button>
                        <button
                          type="button"
                          onClick={() => handlePrintQuotation(q)}
                          className="text-slate-500 hover:text-slate-900 hover:bg-slate-100 p-1.5 rounded transition-all"
                          title="Print Estimate"
                        >
                          <Printer className="w-3.5 h-3.5" />
                        </button>
                        <button
                          type="button"
                          onClick={() => handleStartEdit(q)}
                          className="text-slate-500 hover:text-slate-900 hover:bg-slate-100 p-1.5 rounded transition-all"
                          title="Edit Estimate"
                        >
                          <Edit className="w-3.5 h-3.5" />
                        </button>
                        <button
                          type="button"
                          onClick={() => handleDownloadQuotation(q)}
                          className="text-slate-500 hover:text-slate-900 hover:bg-slate-100 p-1.5 rounded transition-all"
                          title="Download JSON Spec"
                        >
                          <Download className="w-3.5 h-3.5" />
                        </button>
                        <button
                          type="button"
                          onClick={() => alert(`Quotation QNo: ${q.quotation_no} Dispatched successfully!`)}
                          className="text-gray-500 hover:text-teal-600 hover:bg-teal-50 p-1.5 rounded transition-all"
                          title="Send / Dispatch"
                        >
                          <Send className="w-3.5 h-3.5" />
                        </button>
                        <button
                          type="button"
                          onClick={() => handleDeleteQuotation(q.quotation_no)}
                          className="text-red-500 hover:text-red-700 hover:bg-red-50 p-1.5 rounded transition-all"
                          title="Delete estimate"
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
            Showing <span className="font-semibold text-text-primary">{filteredQuotations.length > 0 ? indexOfFirstItem + 1 : 0}</span> to{" "}
            <span className="font-semibold text-text-primary">{Math.min(indexOfLastItem, filteredQuotations.length)}</span> of{" "}
            <span className="font-semibold text-text-primary">{filteredQuotations.length}</span> estimates
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
            Total Quotations Value:{" "}
            <span className="font-mono text-teal-700 bg-teal-50 px-2 py-0.5 border border-teal-100 rounded">
              {formatCurrency(filteredQuotations.reduce((acc, curr) => acc + curr.amount, 0))}
            </span>
          </div>
        </div>
      </div>

      {/* ── View Quotation Details Modal ── */}
      {viewingQuotation && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/40 backdrop-blur-[2px]">
          <div
            className="absolute inset-0 transition-opacity"
            onClick={() => setViewingQuotation(null)}
          />

          <div className="bg-white border border-slate-200 rounded-xl shadow-2xl relative max-w-2xl w-full animate-in fade-in zoom-in-95 duration-150 z-10 flex flex-col font-sans">
            {/* Header */}
            <div className="bg-slate-900 px-6 py-4 text-white rounded-t-xl flex items-center justify-between shadow-md">
              <div>
                <h2 className="text-sm font-bold tracking-tight">Price Quotation Estimate</h2>
                <p className="text-[10px] text-slate-300 mt-0.5">Quote: {viewingQuotation.quotation_no}</p>
              </div>
              <button
                type="button"
                onClick={() => setViewingQuotation(null)}
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
                  <span className="text-[10px] font-bold text-slate-400 uppercase tracking-wider block">Quotation Number</span>
                  <span className="font-mono font-semibold text-slate-900 text-sm">{viewingQuotation.quotation_no}</span>
                </div>
                <div className="border-b border-slate-100 pb-2">
                  <span className="text-[10px] font-bold text-slate-400 uppercase tracking-wider block">Validity Date</span>
                  <span className="font-mono text-slate-700">{viewingQuotation.valid_till}</span>
                </div>
                <div className="col-span-2 border-b border-slate-100 pb-2">
                  <span className="text-[10px] font-bold text-slate-400 uppercase tracking-wider block">Customer Name</span>
                  <span className="font-medium text-slate-900 text-sm">{viewingQuotation.customer_name}</span>
                </div>
                <div className="border-b border-slate-100 pb-2">
                  <span className="text-[10px] font-bold text-slate-400 uppercase tracking-wider block">Contact Phone</span>
                  <span className="font-mono text-slate-700">{viewingQuotation.customer_phone || "—"}</span>
                </div>
                <div className="border-b border-slate-100 pb-2">
                  <span className="text-[10px] font-bold text-slate-400 uppercase tracking-wider block">Status</span>
                  <span className={`inline-flex items-center px-2 py-0.5 rounded text-[10px] font-bold mt-1 ${
                    viewingQuotation.status === 'Approved' ? 'bg-green-100 text-green-800' : 'bg-blue-100 text-blue-800'
                  }`}>
                    {viewingQuotation.status}
                  </span>
                </div>
                <div className="col-span-2 border-b border-slate-100 pb-2">
                  <span className="text-[10px] font-bold text-slate-400 uppercase tracking-wider block">Estimated Scope</span>
                  <span className="font-medium text-slate-700">{viewingQuotation.items_summary || "—"}</span>
                </div>
                <div className="border-b border-slate-100 pb-2">
                  <span className="text-[10px] font-bold text-slate-400 uppercase tracking-wider block">Estimated Amount</span>
                  <span className="font-mono font-bold text-teal-700 text-sm">{formatCurrency(viewingQuotation.amount)}</span>
                </div>
              </div>
            </div>

            {/* Footer Buttons */}
            <div className="flex items-center justify-end gap-3 pt-4 border-t border-slate-200 bg-slate-50 p-4 rounded-b-xl">
              <button
                type="button"
                onClick={() => handlePrintQuotation(viewingQuotation)}
                className="btn-secondary px-4 py-2 font-semibold text-xs border border-slate-300 text-slate-700 hover:bg-slate-100 transition-colors rounded flex items-center gap-1.5"
              >
                <Printer className="w-3.5 h-3.5" />
                Print Estimate
              </button>
              <button
                type="button"
                onClick={() => setViewingQuotation(null)}
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
