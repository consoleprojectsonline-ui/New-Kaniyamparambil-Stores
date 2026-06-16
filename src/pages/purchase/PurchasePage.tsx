import { useState, useEffect, useCallback } from "react";
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
} from "lucide-react";
import { supabase } from "@/lib/supabase";
import { formatCurrency } from "@/lib/utils";

interface PurchaseRecord {
  bill_no: string;
  supplier_name: string;
  purchase_date: string;
  amount: number;
  tax_amount: number;
  payment_status: string;
  created_at?: string;
}

export default function PurchasePage() {
  const [purchases, setPurchases] = useState<PurchaseRecord[]>([]);
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
  const [billNo, setBillNo] = useState("");
  const [supplierName, setSupplierName] = useState("");
  const [purchaseDate, setPurchaseDate] = useState(
    new Date().toISOString().split("T")[0]
  );
  const [amount, setAmount] = useState("");
  const [taxAmount, setTaxAmount] = useState("");
  const [paymentStatus, setPaymentStatus] = useState("Pending");

  const [formError, setFormError] = useState<string | null>(null);
  const [successMsg, setSuccessMsg] = useState<string | null>(null);

  const [viewingPurchase, setViewingPurchase] = useState<PurchaseRecord | null>(null);

  const loadLocalPurchases = useCallback(() => {
    const local = localStorage.getItem("kaniyamparambil_purchases");
    if (local) {
      try {
        setPurchases(JSON.parse(local));
      } catch {
        setPurchases([]);
      }
    } else {
      // Seed some starter purchases
      const seed: PurchaseRecord[] = [
        {
          bill_no: "BILL-2026-001",
          supplier_name: "Jindal Steel & Power Ltd.",
          purchase_date: "2026-06-10",
          amount: 125000,
          tax_amount: 22500,
          payment_status: "Paid",
        },
        {
          bill_no: "BILL-2026-002",
          supplier_name: "Supreme Industries Pvt.",
          purchase_date: "2026-06-12",
          amount: 45000,
          tax_amount: 8100,
          payment_status: "Pending",
        },
      ];
      localStorage.setItem("kaniyamparambil_purchases", JSON.stringify(seed));
      setPurchases(seed);
    }
  }, []);

  const fetchPurchases = useCallback(async () => {
    try {
      setLoading(true);
      const { data, error } = await supabase
        .from("purchases")
        .select("*")
        .order("purchase_date", { ascending: false });

      if (error) {
        if (error.code === "PGRST116" || error.message.includes("relation") || error.message.includes("does not exist")) {
          setDbStatus("local");
          loadLocalPurchases();
        } else {
          console.error("Supabase purchases load error:", error);
          setDbStatus("local");
          loadLocalPurchases();
        }
      } else if (data) {
        setPurchases(data);
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
    }, 0);
    return () => clearTimeout(timer);
  }, [fetchPurchases]);

  // Add / Edit Purchase Submit Handler
  const handleSubmitForm = async (e: React.FormEvent) => {
    e.preventDefault();
    setFormError(null);
    setSuccessMsg(null);

    if (!billNo.trim() || !supplierName.trim() || !amount) {
      setFormError("Bill Number, Supplier, and Amount are required.");
      return;
    }

    const purchaseAmt = Number(amount);
    const taxAmt = Number(taxAmount) || 0;

    if (isNaN(purchaseAmt) || purchaseAmt <= 0) {
      setFormError("Total amount must be a positive number.");
      return;
    }

    const newPurchase: PurchaseRecord = {
      bill_no: billNo.trim().toUpperCase(),
      supplier_name: supplierName.trim(),
      purchase_date: purchaseDate,
      amount: purchaseAmt,
      tax_amount: taxAmt,
      payment_status: paymentStatus,
    };

    if (editingPurchase) {
      // UPDATE MODE
      if (dbStatus === "connected") {
        try {
          const { error } = await supabase
            .from("purchases")
            .update(newPurchase)
            .eq("bill_no", editingPurchase.bill_no);
          if (error) throw error;
          setSuccessMsg(`Successfully updated Bill No. "${newPurchase.bill_no}"!`);
          fetchPurchases();
          resetForm();
        } catch (err) {
          console.error("Supabase update error:", err);
          const errMsg = err instanceof Error ? err.message : "Failed to update bill.";
          setFormError(`Supabase error: ${errMsg}`);
        }
      } else {
        // Local storage update path
        const updated = purchases.map((p) => (p.bill_no === editingPurchase.bill_no ? newPurchase : p));
        localStorage.setItem("kaniyamparambil_purchases", JSON.stringify(updated));
        setPurchases(updated);
        setSuccessMsg(`Updated Bill No. "${newPurchase.bill_no}" in Local Storage!`);
        resetForm();
      }
    } else {
      // CREATE MODE
      if (purchases.some((p) => p.bill_no === newPurchase.bill_no)) {
        setFormError(`Bill No. '${newPurchase.bill_no}' is already logged.`);
        return;
      }

      if (dbStatus === "connected") {
        try {
          const { error } = await supabase.from("purchases").insert([newPurchase]);
          if (error) throw error;
          setSuccessMsg(`Successfully registered Bill No. "${newPurchase.bill_no}"!`);
          fetchPurchases();
          resetForm();
        } catch (err) {
          console.error("Supabase insert error:", err);
          const errMsg = err instanceof Error ? err.message : "Failed to log bill.";
          setFormError(`Supabase error: ${errMsg}`);
        }
      } else {
        const updated = [newPurchase, ...purchases];
        localStorage.setItem("kaniyamparambil_purchases", JSON.stringify(updated));
        setPurchases(updated);
        setSuccessMsg(`Saved Bill No. "${newPurchase.bill_no}" to Local Storage!`);
        resetForm();
      }
    }
  };

  const handleStartEdit = (rec: PurchaseRecord) => {
    setEditingPurchase(rec);
    setBillNo(rec.bill_no);
    setSupplierName(rec.supplier_name);
    setPurchaseDate(rec.purchase_date);
    setAmount(String(rec.amount));
    setTaxAmount(String(rec.tax_amount));
    setPaymentStatus(rec.payment_status);
    setIsFormOpen(true);
  };

  const handlePrintPurchase = (rec: PurchaseRecord) => {
    const printWindow = window.open("", "_blank");
    if (!printWindow) {
      alert("Popup blocker is active. Please allow popups to print purchase bills.");
      return;
    }
    printWindow.document.write(`
      <html>
        <head>
          <title>Purchase Bill - ${rec.bill_no}</title>
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
            <p class="subtitle">Purchase Procurement Receipt Report</p>
          </div>
          <table>
            <tr><th>Bill / Invoice No.</th><td>${rec.bill_no}</td></tr>
            <tr><th>Supplier / Vendor Name</th><td>${rec.supplier_name}</td></tr>
            <tr><th>Procurement Date</th><td>${rec.purchase_date}</td></tr>
            <tr><th>Estimated Tax/GST (₹)</th><td>₹${rec.tax_amount.toFixed(2)}</td></tr>
            <tr><th>Total Purchase Amount (₹)</th><td>₹${rec.amount.toFixed(2)}</td></tr>
            <tr><th>Payment / Ledger Status</th><td>${rec.payment_status}</td></tr>
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

  const handleDownloadPurchase = (rec: PurchaseRecord) => {
    try {
      const jsonString = JSON.stringify(rec, null, 2);
      const blob = new Blob([jsonString], { type: "application/json" });
      const url = URL.createObjectURL(blob);
      const downloadAnchor = document.createElement('a');
      downloadAnchor.href = url;
      downloadAnchor.download = `purchase_${rec.bill_no}.json`;
      document.body.appendChild(downloadAnchor);
      downloadAnchor.click();
      document.body.removeChild(downloadAnchor);
      URL.revokeObjectURL(url);
    } catch (err) {
      console.error("Failed to download purchase:", err);
      alert("Failed to download purchase details.");
    }
  };

  const handleDeletePurchase = async (billNoToDelete: string) => {
    if (!window.confirm(`Are you sure you want to delete bill "${billNoToDelete}"?`)) {
      return;
    }

    if (dbStatus === "connected") {
      try {
        const { error } = await supabase.from("purchases").delete().eq("bill_no", billNoToDelete);
        if (error) throw error;
        fetchPurchases();
      } catch (err) {
        console.error("Delete failed from Supabase:", err);
        const errMsg = err instanceof Error ? err.message : "Unknown error occurred.";
        alert(`Failed to delete bill: ${errMsg}`);
      }
    } else {
      const updated = purchases.filter((p) => p.bill_no !== billNoToDelete);
      localStorage.setItem("kaniyamparambil_purchases", JSON.stringify(updated));
      setPurchases(updated);
    }
  };

  const resetForm = () => {
    setBillNo("");
    setSupplierName("");
    setAmount("");
    setTaxAmount("");
    setPaymentStatus("Pending");
    setEditingPurchase(null);
    setTimeout(() => setSuccessMsg(null), 4000);
  };

  const filteredPurchases = purchases.filter((p) => {
    const matchesSearch =
      p.bill_no.toLowerCase().includes(searchQuery.toLowerCase()) ||
      p.supplier_name.toLowerCase().includes(searchQuery.toLowerCase());
    const matchesStatus = statusFilter === "All" || p.payment_status === statusFilter;
    return matchesSearch && matchesStatus;
  });

  const totalPages = Math.ceil(filteredPurchases.length / itemsPerPage);
  const indexOfLastItem = currentPage * itemsPerPage;
  const indexOfFirstItem = indexOfLastItem - itemsPerPage;
  const currentPurchases = filteredPurchases.slice(indexOfFirstItem, indexOfLastItem);

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

        <button
          onClick={() => {
            if (isFormOpen) {
              resetForm();
              setIsFormOpen(false);
            } else {
              resetForm();
              setIsFormOpen(true);
            }
          }}
          className="btn-primary bg-purple-600 hover:bg-purple-700 active:bg-purple-800 flex items-center gap-1.5 shadow-sm"
        >
          <Plus className="w-4 h-4" />
          {isFormOpen ? "Close Panel" : "Log New Purchase"}
        </button>
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
  bill_no text PRIMARY KEY,
  supplier_name text NOT NULL,
  purchase_date date NOT NULL,
  amount numeric NOT NULL,
  tax_amount numeric DEFAULT 0 NOT NULL,
  payment_status text DEFAULT 'Pending' NOT NULL,
  created_at timestamp with time zone DEFAULT timezone('utc'::text, now()) NOT NULL
);`}
            </pre>
          </div>
        </div>
      )}

      {/* ── Form Panel ── */}
      {isFormOpen && (
        <div className="bg-white border border-border rounded-xl shadow-lg p-6 animate-fade-in">
          <div className="border-b border-border pb-3 mb-5">
            <h2 className="text-base font-bold text-text-primary">
              {editingPurchase ? "Edit Wholesaler/Supplier Purchase Bill" : "Log Wholesaler/Supplier Purchase Bill"}
            </h2>
            <p className="text-xs text-text-secondary">
              {editingPurchase
                ? `Modifying details for Bill No: ${editingPurchase.bill_no}`
                : "Record incoming shipments, supplier invoices, and total billing details."}
            </p>
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
                <label className="form-label text-xs">Supplier/Wholesaler Name *</label>
                <input
                  type="text"
                  value={supplierName}
                  onChange={(e) => setSupplierName(e.target.value)}
                  placeholder="e.g. Tata Steel Distributor"
                  className="input-enterprise"
                  required
                />
              </div>

              <div>
                <label className="form-label text-xs">Bill/Invoice Number *</label>
                <input
                  type="text"
                  value={billNo}
                  onChange={(e) => setBillNo(e.target.value)}
                  placeholder="e.g. GST-9022"
                  className="input-enterprise font-mono uppercase"
                  disabled={!!editingPurchase}
                  required
                />
              </div>

              <div>
                <label className="form-label text-xs">Purchase Date *</label>
                <input
                  type="date"
                  value={purchaseDate}
                  onChange={(e) => setPurchaseDate(e.target.value)}
                  className="input-enterprise"
                  required
                />
              </div>

              <div>
                <label className="form-label text-xs">Total Amount (₹) *</label>
                <div className="relative">
                  <span className="absolute left-3 top-2.5 text-xs font-semibold text-text-secondary">₹</span>
                  <input
                    type="number"
                    value={amount}
                    onChange={(e) => setAmount(e.target.value)}
                    placeholder="Grand Total including GST"
                    className="input-enterprise pl-7"
                    required
                  />
                </div>
              </div>

              <div>
                <label className="form-label text-xs">GST/Tax Component (₹)</label>
                <div className="relative">
                  <span className="absolute left-3 top-2.5 text-xs font-semibold text-text-secondary">₹</span>
                  <input
                    type="number"
                    value={taxAmount}
                    onChange={(e) => setTaxAmount(e.target.value)}
                    placeholder="Total GST amount (optional)"
                    className="input-enterprise pl-7"
                  />
                </div>
              </div>

              <div>
                <label className="form-label text-xs">Payment Status</label>
                <select
                  value={paymentStatus}
                  onChange={(e) => setPaymentStatus(e.target.value)}
                  className="input-enterprise bg-white cursor-pointer"
                >
                  <option value="Pending">Pending / Unpaid</option>
                  <option value="Paid">Paid / Cleared</option>
                </select>
              </div>
            </div>

            <div className="flex items-center justify-end gap-3 pt-4 border-t border-border">
              <button type="button" onClick={resetForm} className="btn-secondary px-5">
                Clear
              </button>
              <button type="submit" className="btn-primary bg-purple-600 hover:bg-purple-700 active:bg-purple-800 px-6 shadow-sm">
                {editingPurchase ? "Save & Update Bill" : "Log Purchase Bill"}
              </button>
            </div>
          </form>
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
            placeholder="Search Supplier, Wholesaler or Bill No..."
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
                <th className="px-4 py-3 text-center font-semibold uppercase tracking-wider text-text-secondary">Bill No.</th>
                <th className="px-4 py-3 text-center font-semibold uppercase tracking-wider text-text-secondary">Supplier Name</th>
                <th className="px-4 py-3 text-center font-semibold uppercase tracking-wider text-text-secondary">Purchase Date</th>
                <th className="px-4 py-3 text-center font-semibold uppercase tracking-wider text-text-secondary">Tax/GST (₹)</th>
                <th className="px-4 py-3 text-center font-semibold uppercase tracking-wider text-text-secondary">Total Amount (₹)</th>
                <th className="px-4 py-3 text-center font-semibold uppercase tracking-wider text-text-secondary">Status</th>
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
                    <span className="text-xs text-text-secondary">Fetching purchase log...</span>
                  </td>
                </tr>
              ) : filteredPurchases.length === 0 ? (
                <tr>
                  <td colSpan={7} className="text-center py-16 text-text-secondary">
                    <Calendar className="w-8 h-8 mx-auto text-gray-300 mb-2" />
                    <p className="font-semibold text-sm">No purchase bills logged</p>
                    <p className="text-xs text-gray-400 mt-1">Try logging a new bill to track expenses.</p>
                  </td>
                </tr>
              ) : (
                currentPurchases.map((rec) => (
                  <tr key={rec.bill_no} className="border-b border-border hover:bg-gray-50/50 transition-colors">
                    <td className="px-4 py-2.5 font-semibold text-gray-900 font-mono text-center">{rec.bill_no}</td>
                    <td className="px-4 py-2.5 font-medium text-gray-800 text-center truncate max-w-[150px] mx-auto" title={rec.supplier_name}>{rec.supplier_name}</td>
                    <td className="px-4 py-2.5 text-text-secondary font-mono text-center">{rec.purchase_date}</td>
                    <td className="px-4 py-2.5 text-center font-mono text-text-secondary">
                      {formatCurrency(rec.tax_amount)}
                    </td>
                    <td className="px-4 py-2.5 text-center font-mono font-semibold text-gray-900">
                      {formatCurrency(rec.amount)}
                    </td>
                    <td className="px-4 py-2.5 text-center">
                      <span
                        className={`inline-flex items-center px-2 py-0.5 rounded text-[10px] font-bold ${
                          rec.payment_status === "Paid"
                            ? "bg-green-100 text-green-800 border border-green-200"
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
                          title="Download JSON Spec"
                        >
                          <Download className="w-3.5 h-3.5" />
                        </button>
                        <button
                          type="button"
                          onClick={() => handleDeletePurchase(rec.bill_no)}
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
              {formatCurrency(filteredPurchases.reduce((acc, curr) => acc + curr.amount, 0))}
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

          <div className="bg-white border border-slate-200 rounded-xl shadow-2xl relative max-w-2xl w-full animate-in fade-in zoom-in-95 duration-150 z-10 flex flex-col font-sans">
            {/* Header */}
            <div className="bg-slate-900 px-6 py-4 text-white rounded-t-xl flex items-center justify-between shadow-md">
              <div>
                <h2 className="text-sm font-bold tracking-tight">Purchase Bill Specifications</h2>
                <p className="text-[10px] text-slate-300 mt-0.5">Bill: {viewingPurchase.bill_no}</p>
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

            {/* Content Table */}
            <div className="p-6 space-y-4">
              <div className="grid grid-cols-2 gap-x-6 gap-y-3.5 text-xs">
                <div className="border-b border-slate-100 pb-2">
                  <span className="text-[10px] font-bold text-slate-400 uppercase tracking-wider block">Bill / Invoice No.</span>
                  <span className="font-mono font-semibold text-slate-900 text-sm">{viewingPurchase.bill_no}</span>
                </div>
                <div className="border-b border-slate-100 pb-2">
                  <span className="text-[10px] font-bold text-slate-400 uppercase tracking-wider block">Procurement Date</span>
                  <span className="font-mono text-slate-700">{viewingPurchase.purchase_date}</span>
                </div>
                <div className="col-span-2 border-b border-slate-100 pb-2">
                  <span className="text-[10px] font-bold text-slate-400 uppercase tracking-wider block">Supplier / Vendor Name</span>
                  <span className="font-medium text-slate-900 text-sm">{viewingPurchase.supplier_name}</span>
                </div>
                <div className="border-b border-slate-100 pb-2">
                  <span className="text-[10px] font-bold text-slate-400 uppercase tracking-wider block">Tax/GST (₹)</span>
                  <span className="font-mono font-semibold text-slate-700">{formatCurrency(viewingPurchase.tax_amount)}</span>
                </div>
                <div className="border-b border-slate-100 pb-2">
                  <span className="text-[10px] font-bold text-slate-400 uppercase tracking-wider block">Total Bill Amount (₹)</span>
                  <span className="font-mono font-bold text-purple-700 text-sm">{formatCurrency(viewingPurchase.amount)}</span>
                </div>
                <div className="border-b border-slate-100 pb-2">
                  <span className="text-[10px] font-bold text-slate-400 uppercase tracking-wider block">Payment Status</span>
                  <span className={`inline-flex items-center px-2 py-0.5 rounded text-[10px] font-bold mt-1 ${
                    viewingPurchase.payment_status === 'Paid' ? 'bg-green-100 text-green-800' : 'bg-red-100 text-red-800'
                  }`}>
                    {viewingPurchase.payment_status}
                  </span>
                </div>
              </div>
            </div>

            {/* Footer Buttons */}
            <div className="flex items-center justify-end gap-3 pt-4 border-t border-slate-200 bg-slate-50 p-4 rounded-b-xl">
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
