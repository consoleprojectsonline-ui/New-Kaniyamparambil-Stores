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
} from "lucide-react";
import { supabase } from "@/lib/supabase";
import { formatCurrency } from "@/lib/utils";

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
  invoice_no: string;    // unique bill number (digits only)
  serial_no?: string;    // internal serial / reference number
  supplier_name: string;
  purchase_type: string; // e.g., "Local Purchase"
  branch_godown: string; // e.g., "Shop", "Godown A"
  entry_date: string;    // Pur. Entry Date
  invoice_date: string;  // Invoice Date
  vehicle_no?: string;
  items: PurchaseItem[];
  expenses: number;      // freight / overheads
  subtotal: number;      // base subtotal before tax
  total_sgst: number;    // aggregate SGST
  total_cgst: number;    // aggregate CGST
  net_amount: number;    // final payable
  paid_amount: number;   // amount paid to supplier
  payment_status: string;
  created_at?: string;
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
    total_sgst: Math.round(totalSgst * 100) / 100,
    total_cgst: Math.round(totalCgst * 100) / 100,
    net_amount: Number(raw.net_amount ?? raw.amount ?? 0),
    paid_amount: Number(raw.paid_amount ?? 0),
    payment_status: String(raw.payment_status ?? "Pending"),
    created_at: raw.created_at ? String(raw.created_at) : undefined,
  };
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

  // Dynamic Item Grid
  const [gridItems, setGridItems] = useState<PurchaseItem[]>([
    { code: "", name: "", hsn_code: "", qty: 1, unit: "Nos", rate: 0, disc: 0, sgst: 9, cgst: 9 },
  ]);

  const [formError, setFormError] = useState<string | null>(null);
  const [successMsg, setSuccessMsg] = useState<string | null>(null);
  const [viewingPurchase, setViewingPurchase] = useState<PurchaseRecord | null>(null);

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

  // Auto-populate Paid Amount when net amount changes (still editable for partials)
  useEffect(() => {
    if (calculatedTotals.netAmount > 0) {
      setPaidAmount(String(calculatedTotals.netAmount));
    }
  }, [calculatedTotals.netAmount]);

  // Submit Handler: Creates or Updates Purchases & Stock Quantities
  const handleSubmitForm = async (e: React.FormEvent) => {
    e.preventDefault();
    setFormError(null);
    setSuccessMsg(null);

    // Validations
    const invoiceNumClean = invoiceNo.trim();
    if (!/^\d+$/.test(invoiceNumClean)) {
      setFormError("Invoice Number must contain digits only.");
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
    const paidNum = Number(paidAmount) || 0;
    const status = paidNum >= calculatedTotals.netAmount ? "Paid" : paidNum > 0 ? "Partial" : "Pending";

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
    setGridItems(rec.items);
    setIsFormOpen(true);
  };

  const handlePrintPurchase = (rec: PurchaseRecord) => {
    const printWindow = window.open("", "_blank");
    if (!printWindow) {
      alert("Popup blocker is active. Please allow popups to print purchase bills.");
      return;
    }
    const tableRows = rec.items
      .map((i) => {
        const taxable = Math.max(0, i.qty * i.rate - (i.disc || 0));
        const sgstAmt = taxable * ((i.sgst ?? 0) / 100);
        const cgstAmt = taxable * ((i.cgst ?? 0) / 100);
        const lineTotal = taxable + sgstAmt + cgstAmt;
        return `
      <tr>
        <td>${i.code}</td>
        <td>${i.name}</td>
        <td style="text-align: center;">${i.qty}</td>
        <td style="text-align: center;">${i.unit}</td>
        <td style="text-align: right;">&#8377;${i.rate.toFixed(2)}</td>
        <td style="text-align: right;">&#8377;${(i.disc || 0).toFixed(2)}</td>
        <td style="text-align: center;">${i.sgst ?? 0}%</td>
        <td style="text-align: center;">${i.cgst ?? 0}%</td>
        <td style="text-align: right;">&#8377;${sgstAmt.toFixed(2)}</td>
        <td style="text-align: right;">&#8377;${cgstAmt.toFixed(2)}</td>
        <td style="text-align: right;">&#8377;${lineTotal.toFixed(2)}</td>
      </tr>`;
      })
      .join("");

    printWindow.document.write(`
      <html>
        <head>
          <title>Purchase Invoice - ${rec.invoice_no}</title>
          <style>
            body { font-family: 'Inter', sans-serif; padding: 30px; color: #1e293b; background-color: #ffffff; }
            .header { border-bottom: 2px solid #0f172a; padding-bottom: 12px; margin-bottom: 20px; display: flex; justify-content: space-between; }
            .title { font-size: 20px; font-weight: 700; color: #0f172a; margin: 0; }
            .subtitle { font-size: 12px; color: #64748b; margin-top: 4px; }
            .details-grid { display: grid; grid-template-cols: 1fr 1fr; gap: 15px; font-size: 12px; margin-bottom: 20px; background: #f8fafc; padding: 15px; border-radius: 8px; border: 1px solid #e2e8f0; }
            .details-grid div span { font-weight: 600; color: #475569; }
            table { width: 100%; border-collapse: collapse; margin-top: 20px; font-size: 12px; }
            th, td { border: 1px solid #e2e8f0; padding: 8px 10px; text-align: left; }
            th { background-color: #f1f5f9; font-weight: 600; color: #334155; }
            .totals-panel { display: flex; justify-content: flex-end; margin-top: 20px; font-size: 12px; }
            .totals-panel table { width: 300px; }
            .totals-panel td { padding: 6px; border: none; }
            .totals-panel tr.bold td { font-weight: 700; border-top: 1px solid #cbd5e1; font-size: 13px; color: #0f172a; }
          </style>
        </head>
        <body>
          <div class="header">
            <div>
              <h1 class="title">New Kaniyamparambil Stores</h1>
              <p class="subtitle">Procurement & Warehouse Stock Inflow Voucher</p>
            </div>
            <div style="text-align: right;">
              <h2 style="margin:0; font-size: 16px; color:#4f46e5;">Purchase Bill</h2>
              <p style="margin:4px 0 0 0; font-size:11px; font-family:monospace; color:#64748b;">No: ${rec.invoice_no}</p>
            </div>
          </div>
          <div class="details-grid">
            <div>
              <div><span>Supplier:</span> ${rec.supplier_name}</div>
              <div><span>Purchase Type:</span> ${rec.purchase_type}</div>
              <div><span>Destination Godown:</span> ${rec.branch_godown}</div>
            </div>
            <div>
              <div><span>Invoice Date:</span> ${rec.invoice_date}</div>
              <div><span>Pur. Entry Date:</span> ${rec.entry_date}</div>
              <div><span>Vehicle No:</span> ${rec.vehicle_no || "—"}</div>
            </div>
          </div>

          <table>
            <thead>
              <tr>
                <th>Code</th>
                <th>Item Description</th>
                <th style="text-align: center;">Qty</th>
                <th style="text-align: center;">Unit</th>
                <th style="text-align: right;">Rate</th>
                <th style="text-align: right;">Discount</th>
                <th style="text-align: center;">SGST%</th>
                <th style="text-align: center;">CGST%</th>
                <th style="text-align: right;">SGST Amt</th>
                <th style="text-align: right;">CGST Amt</th>
                <th style="text-align: right;">Total</th>
              </tr>
            </thead>
            <tbody>
              ${tableRows}
            </tbody>
          </table>

          <div class="totals-panel">
            <table>
              <tr>
                <td>Subtotal (Base):</td>
                <td style="text-align: right;">&#8377;${rec.subtotal.toFixed(2)}</td>
              </tr>
              <tr>
                <td>Total SGST:</td>
                <td style="text-align: right; color:#b45309;">&#8377;${(rec.total_sgst ?? 0).toFixed(2)}</td>
              </tr>
              <tr>
                <td>Total CGST:</td>
                <td style="text-align: right; color:#b45309;">&#8377;${(rec.total_cgst ?? 0).toFixed(2)}</td>
              </tr>
              <tr>
                <td>Additional Charges (Expenses):</td>
                <td style="text-align: right;">&#8377;${rec.expenses.toFixed(2)}</td>
              </tr>
              <tr class="bold">
                <td>Net Invoice Amount:</td>
                <td style="text-align: right;">&#8377;${rec.net_amount.toFixed(2)}</td>
              </tr>
              <tr>
                <td>Amount Paid:</td>
                <td style="text-align: right; color: green; font-weight:600;">&#8377;${rec.paid_amount.toFixed(2)}</td>
              </tr>
              <tr>
                <td>Payment status:</td>
                <td style="text-align: right; font-weight:700;">${rec.payment_status}</td>
              </tr>
            </table>
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

  const handleDownloadPurchase = (rec: PurchaseRecord) => {
    try {
      const jsonString = JSON.stringify(rec, null, 2);
      const blob = new Blob([jsonString], { type: "application/json" });
      const url = URL.createObjectURL(blob);
      const downloadAnchor = document.createElement("a");
      downloadAnchor.href = url;
      downloadAnchor.download = `purchase_invoice_${rec.invoice_no}.json`;
      document.body.appendChild(downloadAnchor);
      downloadAnchor.click();
      document.body.removeChild(downloadAnchor);
      URL.revokeObjectURL(url);
    } catch (err) {
      console.error("Failed to download purchase:", err);
      alert("Failed to download purchase details.");
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
            resetForm();
            setIsFormOpen(true);
          }}
          className="btn-primary bg-purple-600 hover:bg-purple-700 active:bg-purple-800 flex items-center gap-1.5 shadow-sm"
        >
          <Plus className="w-4 h-4" />
          Log New Purchase
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
  invoice_no text PRIMARY KEY,
  supplier_name text NOT NULL,
  purchase_type text NOT NULL,
  branch_godown text NOT NULL,
  entry_date date NOT NULL,
  invoice_date date NOT NULL,
  vehicle_no text,
  items jsonb NOT NULL,
  expenses numeric DEFAULT 0 NOT NULL,
  subtotal numeric NOT NULL,
  net_amount numeric NOT NULL,
  paid_amount numeric DEFAULT 0 NOT NULL,
  payment_status text NOT NULL,
  created_at timestamp with time zone DEFAULT timezone('utc'::text, now()) NOT NULL
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
                    <label className="form-label text-xs text-slate-700 font-semibold mb-1 block">Invoice No. (Numbers Only) *</label>
                    <input
                      type="text"
                      value={invoiceNo}
                      onChange={(e) => setInvoiceNo(e.target.value.replace(/\D/g, ""))}
                      placeholder="e.g. 290123"
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
                              min="1"
                              value={item.qty}
                              onChange={(e) => updateGridRow(idx, "qty", parseInt(e.target.value) || 0)}
                              className="w-full text-center border border-slate-300 rounded p-1 font-semibold text-xs font-mono"
                              required
                            />
                          </td>

                          {/* Unit */}
                          <td className="p-2 text-center">
                            <input
                              type="text"
                              value={item.unit}
                              onChange={(e) => updateGridRow(idx, "unit", e.target.value)}
                              className="w-full text-center border border-slate-300 rounded p-1 text-xs"
                              required
                            />
                          </td>

                          {/* Rate */}
                          <td className="p-2">
                            <input
                              type="number"
                              min="0"
                              value={item.rate || ""}
                              onChange={(e) => updateGridRow(idx, "rate", parseFloat(e.target.value) || 0)}
                              className="w-full text-right border border-slate-300 rounded p-1 text-xs font-mono"
                              placeholder="0.00"
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
                              value={item.disc || ""}
                              onChange={(e) => updateGridRow(idx, "disc", parseFloat(e.target.value) || 0)}
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
                              step="0.5"
                              value={item.sgst ?? 9}
                              onChange={(e) => updateGridRow(idx, "sgst", parseFloat(e.target.value) || 0)}
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
                              step="0.5"
                              value={item.cgst ?? 9}
                              onChange={(e) => updateGridRow(idx, "cgst", parseFloat(e.target.value) || 0)}
                              className="w-full text-center border border-slate-300 rounded p-1 text-xs font-mono"
                              placeholder="9"
                            />
                          </td>

                          {/* S-Rate */}
                          <td className="p-2">
                            <input
                              type="number"
                              min="0"
                              value={item.s_rate || ""}
                              onChange={(e) => updateGridRow(idx, "s_rate", parseFloat(e.target.value) || 0)}
                              className="w-full text-right border border-slate-300 rounded p-1 text-xs font-mono"
                              placeholder="Sell rate"
                            />
                          </td>

                          {/* MRP */}
                          <td className="p-2">
                            <input
                              type="number"
                              min="0"
                              value={item.mrp || ""}
                              onChange={(e) => updateGridRow(idx, "mrp", parseFloat(e.target.value) || 0)}
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
                      <label className="form-label text-xs text-slate-700 font-semibold mb-1 block">
                        Paid Amount to Supplier (₹)
                        <span className="ml-1 text-[10px] text-purple-500 font-normal">(auto-filled · editable for partial)</span>
                      </label>
                      <input
                        type="number"
                        min="0"
                        value={paidAmount}
                        onChange={(e) => setPaidAmount(e.target.value)}
                        placeholder="Auto-calculated from net amount"
                        className="input-enterprise font-mono text-xs w-full text-green-700 font-bold"
                      />
                    </div>
                  </div>

                  {/* Right column — live calculation breakdown */}
                  <div className="lg:col-span-6 bg-white border border-slate-200 rounded-xl p-4 space-y-2 text-xs">
                    <div className="flex justify-between text-slate-500">
                      <span>Subtotal (Base Value):</span>
                      <span className="font-mono">{formatCurrency(calculatedTotals.subtotal)}</span>
                    </div>
                    <div className="flex justify-between text-slate-500">
                      <span>Trade Discount (–):</span>
                      <span className="font-mono text-red-600">–{formatCurrency(calculatedTotals.discount)}</span>
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
                      <span>Freight / Extra Expenses (+):</span>
                      <span className="font-mono">+{formatCurrency(Number(expenses) || 0)}</span>
                    </div>

                    <div className="flex justify-between text-sm font-bold text-slate-900 border-t border-slate-200 pt-2">
                      <span>Net Payable Amount:</span>
                      <span className="font-mono text-base text-purple-700">{formatCurrency(calculatedTotals.netAmount)}</span>
                    </div>

                    <div className="flex justify-between text-xs font-semibold border-t border-dashed border-slate-100 pt-1.5">
                      <span className="text-slate-500">Paid to Supplier:</span>
                      <span className="font-mono text-green-700">{formatCurrency(Number(paidAmount) || 0)}</span>
                    </div>
                    <div className="flex justify-between text-xs font-semibold">
                      <span className="text-slate-500">Remaining Balance:</span>
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
                    <td className="px-4 py-2.5 text-text-secondary font-mono text-center">{rec.invoice_date}</td>
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
                          title="Download JSON Spec"
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
                  <span className="font-mono text-slate-700">{viewingPurchase.invoice_date}</span>
                </div>
                <div>
                  <span className="text-[10px] font-bold text-slate-400 uppercase tracking-wider block">Pur. Entry Date</span>
                  <span className="font-mono text-slate-700">{viewingPurchase.entry_date}</span>
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
                  <div className="flex justify-between">
                    <span>Subtotal (Base):</span>
                    <span className="font-mono">{formatCurrency(viewingPurchase.subtotal)}</span>
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
                    <span>Freight / Expenses:</span>
                    <span className="font-mono">+{formatCurrency(viewingPurchase.expenses)}</span>
                  </div>
                  <div className="flex justify-between text-sm font-bold text-slate-900 border-t border-slate-100 pt-2">
                    <span>Net Invoice Amount:</span>
                    <span className="font-mono text-purple-700">{formatCurrency(viewingPurchase.net_amount)}</span>
                  </div>
                  <div className="flex justify-between text-green-700 font-semibold">
                    <span>Paid to Supplier:</span>
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
    </div>
  );
}
