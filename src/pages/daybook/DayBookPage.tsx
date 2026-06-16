import { useState, useEffect, useCallback } from "react";
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
} from "lucide-react";

const generateTxId = () => `tx-${Date.now()}-${Math.floor(Math.random() * 1000)}`;
import { supabase } from "@/lib/supabase";
import { formatCurrency } from "@/lib/utils";

interface TransactionRecord {
  id?: string;
  description: string;
  type: string; // "Income" | "Expense"
  amount: number;
  payment_mode: string; // "Cash" | "Bank" | "UPI"
  date: string;
  created_at?: string;
}

export default function DayBookPage() {
  const [transactions, setTransactions] = useState<TransactionRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [isFormOpen, setIsFormOpen] = useState(false);
  const [dbStatus, setDbStatus] = useState<"connected" | "local">("connected");
  const [editingTransaction, setEditingTransaction] = useState<TransactionRecord | null>(null);

  // Search & Filters
  const [searchQuery, setSearchQuery] = useState("");
  const [typeFilter, setTypeFilter] = useState("All");
  const [currentPage, setCurrentPage] = useState(1);
  const itemsPerPage = 10;

  // Reset pagination to page 1 on search or filter change
  useEffect(() => {
    const timer = setTimeout(() => {
      setCurrentPage(1);
    }, 0);
    return () => clearTimeout(timer);
  }, [searchQuery, typeFilter]);

  // Form states
  const [description, setDescription] = useState("");
  const [type, setType] = useState("Income");
  const [amount, setAmount] = useState("");
  const [paymentMode, setPaymentMode] = useState("Cash");
  const [date, setDate] = useState(new Date().toISOString().split("T")[0]);

  const [formError, setFormError] = useState<string | null>(null);
  const [successMsg, setSuccessMsg] = useState<string | null>(null);

  const [viewingTransaction, setViewingTransaction] = useState<TransactionRecord | null>(null);

  const loadLocalTransactions = useCallback(() => {
    const local = localStorage.getItem("kaniyamparambil_transactions");
    if (local) {
      try {
        setTransactions(JSON.parse(local));
      } catch {
        setTransactions([]);
      }
    } else {
      // Seed some starter daily book transactions
      const seed: TransactionRecord[] = [
        {
          id: "tx-1",
          description: "Counter Retail Cash Sales",
          type: "Income",
          amount: 24500,
          payment_mode: "Cash",
          date: new Date().toISOString().split("T")[0],
        },
        {
          id: "tx-2",
          description: "Paid local logistics/freight charge",
          type: "Expense",
          amount: 1500,
          payment_mode: "Cash",
          date: new Date().toISOString().split("T")[0],
        },
        {
          id: "tx-3",
          description: "Customer Invoice #INV-1002 Settlement",
          type: "Income",
          amount: 48900,
          payment_mode: "UPI",
          date: new Date().toISOString().split("T")[0],
        },
      ];
      localStorage.setItem("kaniyamparambil_transactions", JSON.stringify(seed));
      setTransactions(seed);
    }
  }, []);

  const fetchTransactions = useCallback(async () => {
    try {
      setLoading(true);
      const { data, error } = await supabase
        .from("transactions")
        .select("*")
        .order("date", { ascending: false });

      if (error) {
        if (error.code === "PGRST116" || error.message.includes("relation") || error.message.includes("does not exist")) {
          setDbStatus("local");
          loadLocalTransactions();
        } else {
          console.error("Supabase daybook transactions load error:", error);
          setDbStatus("local");
          loadLocalTransactions();
        }
      } else if (data) {
        setTransactions(data);
        setDbStatus("connected");
      }
    } catch (err) {
      console.error("Failed to connect to Supabase database:", err);
      setDbStatus("local");
      loadLocalTransactions();
    } finally {
      setLoading(false);
    }
  }, [loadLocalTransactions]);

  useEffect(() => {
    const timer = setTimeout(() => {
      fetchTransactions();
    }, 0);
    return () => clearTimeout(timer);
  }, [fetchTransactions]);

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

    const newTx: TransactionRecord = {
      description: description.trim(),
      type,
      amount: txAmount,
      payment_mode: paymentMode,
      date,
    };

    if (editingTransaction) {
      // UPDATE MODE
      if (dbStatus === "connected") {
        try {
          const { error } = await supabase
            .from("transactions")
            .update(newTx)
            .eq("id", editingTransaction.id);
          if (error) throw error;
          setSuccessMsg(`Successfully updated transaction: "${newTx.description}"!`);
          fetchTransactions();
          resetForm();
        } catch (err) {
          console.error("Failed to update transaction:", err);
          const errMsg = err instanceof Error ? err.message : "Could not update transaction.";
          setFormError(`Supabase error: ${errMsg}`);
        }
      } else {
        const updated = transactions.map((tx) =>
          tx.id === editingTransaction.id ? { ...newTx, id: tx.id } : tx
        );
        localStorage.setItem("kaniyamparambil_transactions", JSON.stringify(updated));
        setTransactions(updated);
        setSuccessMsg(`Updated transaction in Local Storage!`);
        resetForm();
      }
    } else {
      // CREATE MODE
      if (dbStatus === "connected") {
        try {
          const { error } = await supabase.from("transactions").insert([newTx]);
          if (error) throw error;
          setSuccessMsg(`Successfully logged transaction: "${newTx.description}"!`);
          fetchTransactions();
          resetForm();
        } catch (err) {
          console.error("Failed to insert transaction:", err);
          const errMsg = err instanceof Error ? err.message : "Could not save transaction.";
          setFormError(`Supabase error: ${errMsg}`);
        }
      } else {
        // Local path
        const itemWithId = { ...newTx, id: generateTxId() };
        const updated = [itemWithId, ...transactions];
        localStorage.setItem("kaniyamparambil_transactions", JSON.stringify(updated));
        setTransactions(updated);
        setSuccessMsg(`Logged transaction to Local Storage!`);
        resetForm();
      }
    }
  };

  const handleStartEdit = (rec: TransactionRecord) => {
    setEditingTransaction(rec);
    setDescription(rec.description);
    setType(rec.type);
    setAmount(String(rec.amount));
    setPaymentMode(rec.payment_mode);
    setDate(rec.date);
    setIsFormOpen(true);
  };

  const handlePrintTransaction = (rec: TransactionRecord) => {
    const printWindow = window.open("", "_blank");
    if (!printWindow) {
      alert("Popup blocker is active. Please allow popups to print receipts.");
      return;
    }
    printWindow.document.write(`
      <html>
        <head>
          <title>Transaction Receipt - ${rec.id || 'N/A'}</title>
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
            <p class="subtitle">Daily Day Book Transaction Voucher</p>
          </div>
          <table>
            <tr><th>Voucher ID</th><td>${rec.id || '—'}</td></tr>
            <tr><th>Transaction Date</th><td>${rec.date}</td></tr>
            <tr><th>Description</th><td>${rec.description}</td></tr>
            <tr><th>Voucher Type</th><td>${rec.type}</td></tr>
            <tr><th>Payment Mode</th><td>${rec.payment_mode}</td></tr>
            <tr><th>Amount (₹)</th><td>₹${rec.amount.toFixed(2)}</td></tr>
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

  const handleDownloadTransaction = (rec: TransactionRecord) => {
    try {
      const jsonString = JSON.stringify(rec, null, 2);
      const blob = new Blob([jsonString], { type: "application/json" });
      const url = URL.createObjectURL(blob);
      const downloadAnchor = document.createElement('a');
      downloadAnchor.href = url;
      downloadAnchor.download = `transaction_${rec.id || 'record'}.json`;
      document.body.appendChild(downloadAnchor);
      downloadAnchor.click();
      document.body.removeChild(downloadAnchor);
      URL.revokeObjectURL(url);
    } catch (err) {
      console.error("Failed to download transaction:", err);
      alert("Failed to download transaction details.");
    }
  };

  const handleDeleteTransaction = async (id: string | undefined) => {
    if (!id) return;
    if (!window.confirm("Are you sure you want to delete this ledger transaction?")) {
      return;
    }

    if (dbStatus === "connected") {
      try {
        const { error } = await supabase.from("transactions").delete().eq("id", id);
        if (error) throw error;
        fetchTransactions();
      } catch (err) {
        console.error("Delete transaction failed:", err);
        const errMsg = err instanceof Error ? err.message : "Unknown error";
        alert(`Failed to delete transaction: ${errMsg}`);
      }
    } else {
      const updated = transactions.filter((tx) => tx.id !== id);
      localStorage.setItem("kaniyamparambil_transactions", JSON.stringify(updated));
      setTransactions(updated);
    }
  };

  const resetForm = () => {
    setDescription("");
    setType("Income");
    setAmount("");
    setPaymentMode("Cash");
    setEditingTransaction(null);
    setTimeout(() => setSuccessMsg(null), 4000);
  };

  // Totals calculations
  const totalIncome = transactions
    .filter((tx) => tx.type === "Income")
    .reduce((sum, tx) => sum + tx.amount, 0);

  const totalExpense = transactions
    .filter((tx) => tx.type === "Expense")
    .reduce((sum, tx) => sum + tx.amount, 0);

  const netBalance = totalIncome - totalExpense;

  const filteredTransactions = transactions.filter((tx) => {
    const matchesSearch = tx.description.toLowerCase().includes(searchQuery.toLowerCase());
    const matchesType = typeFilter === "All" || tx.type === typeFilter;
    return matchesSearch && matchesType;
  });

  const totalPages = Math.ceil(filteredTransactions.length / itemsPerPage);
  const indexOfLastItem = currentPage * itemsPerPage;
  const indexOfFirstItem = indexOfLastItem - itemsPerPage;
  const currentTransactions = filteredTransactions.slice(indexOfFirstItem, indexOfLastItem);

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
            Record daily cash receipt flow, petty expenses, banking operations, and net cash-on-hand.
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
          className="btn-primary bg-amber-600 hover:bg-amber-700 active:bg-amber-800 flex items-center gap-1.5 shadow-sm"
        >
          <Plus className="w-4 h-4" />
          {isFormOpen ? "Close Panel" : "Record Transaction"}
        </button>
      </div>

      {/* ── DB Status Notice ── */}
      {dbStatus === "local" && (
        <div className="bg-blue-50 border border-blue-200 rounded-lg p-4 flex items-start gap-3 shadow-card">
          <Database className="w-5 h-5 text-blue-600 mt-0.5 flex-shrink-0" />
          <div>
            <h4 className="text-sm font-semibold text-blue-800">Local Mode Active</h4>
            <p className="text-xs text-blue-700 mt-0.5 leading-relaxed">
              The `transactions` table was not found in your Supabase database. Day Book transactions are currently saved locally.
              Run this SQL in your Supabase Editor to sync across devices:
            </p>
            <pre className="text-[10px] font-mono bg-blue-900/5 text-blue-900 border border-blue-200 p-2.5 rounded-md mt-2 overflow-x-auto select-all max-w-full">
              {`CREATE TABLE public.transactions (
  id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  description text NOT NULL,
  type text CHECK (type IN ('Income', 'Expense')) NOT NULL,
  amount numeric NOT NULL,
  payment_mode text CHECK (payment_mode IN ('Cash', 'Bank', 'UPI')) NOT NULL,
  date date NOT NULL,
  created_at timestamp with time zone DEFAULT timezone('utc'::text, now()) NOT NULL
);`}
            </pre>
          </div>
        </div>
      )}

      {/* ── Net Daily Balance Stats Row ── */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-5">
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
      </div>

      {/* ── Log Transaction Form ── */}
      {isFormOpen && (
        <div className="bg-white border border-border rounded-xl shadow-lg p-6 animate-fade-in">
          <div className="border-b border-border pb-3 mb-5">
            <h2 className="text-base font-bold text-text-primary">
              {editingTransaction ? "Edit Ledger Receipt/Payment" : "Log General Ledger Receipt/Payment"}
            </h2>
            <p className="text-xs text-text-secondary">
              {editingTransaction
                ? `Modifying transaction details for Voucher: ${editingTransaction.id || "N/A"}`
                : "Input details for daily petty cash book, income entries, or general expenditures."}
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
                <label className="form-label text-xs">Transaction Description *</label>
                <input
                  type="text"
                  value={description}
                  onChange={(e) => setDescription(e.target.value)}
                  placeholder="e.g. Electricity bill payment, Office tea snacks"
                  className="input-enterprise"
                  required
                />
              </div>

              <div>
                <label className="form-label text-xs">Transaction Type</label>
                <select
                  value={type}
                  onChange={(e) => setType(e.target.value)}
                  className="input-enterprise bg-white cursor-pointer font-semibold"
                >
                  <option value="Income">Receipt / Income (+) </option>
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

            <div className="flex items-center justify-end gap-3 pt-4 border-t border-border">
              <button type="button" onClick={resetForm} className="btn-secondary px-5">
                Clear
              </button>
              <button type="submit" className="btn-primary bg-amber-600 hover:bg-amber-700 active:bg-amber-800 px-6 shadow-sm">
                {editingTransaction ? "Save & Update Transaction" : "Log Ledger Transaction"}
              </button>
            </div>
          </form>
        </div>
      )}

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

        <div className="flex items-center gap-3">
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
        </div>
      </div>

      {/* ── Transaction Ledger Table ── */}
      <div className="bg-white border border-border rounded-xl shadow-card overflow-hidden">
        <div className="overflow-x-auto">
          <table className="table-enterprise w-full text-xs">
            <thead>
              <tr className="bg-gray-50 border-b border-border">
                <th className="px-4 py-3 text-center font-semibold uppercase tracking-wider text-text-secondary">Date</th>
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
                  <td colSpan={6} className="text-center py-12">
                    <svg className="w-6 h-6 animate-spin text-primary mx-auto mb-2" fill="none" viewBox="0 0 24 24">
                      <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                      <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
                    </svg>
                    <span className="text-xs text-text-secondary">Fetching cash ledger...</span>
                  </td>
                </tr>
              ) : filteredTransactions.length === 0 ? (
                <tr>
                  <td colSpan={6} className="text-center py-16 text-text-secondary">
                    <BookOpen className="w-8 h-8 mx-auto text-gray-300 mb-2" />
                    <p className="font-semibold text-sm">No transaction ledger logged</p>
                    <p className="text-xs text-gray-400 mt-1">Record a daily receipt or payment above.</p>
                  </td>
                </tr>
              ) : (
                currentTransactions.map((tx) => (
                  <tr key={tx.id} className="border-b border-border hover:bg-gray-50/50 transition-colors">
                    <td className="px-4 py-2.5 font-semibold text-text-secondary font-mono text-center">{tx.date}</td>
                    <td className="px-4 py-2.5 font-medium text-gray-800 text-center truncate max-w-[200px] mx-auto" title={tx.description}>{tx.description}</td>
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
                          className="text-slate-500 hover:text-slate-900 hover:bg-slate-100 p-1.5 rounded transition-all"
                          title="Edit Transaction"
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
                          title="Download JSON Spec"
                        >
                          <Download className="w-3.5 h-3.5" />
                        </button>
                        <button
                          type="button"
                          onClick={() => handleDeleteTransaction(tx.id)}
                          className="text-red-500 hover:text-red-700 hover:bg-red-50 p-1.5 rounded transition-all"
                          title="Delete transaction"
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
