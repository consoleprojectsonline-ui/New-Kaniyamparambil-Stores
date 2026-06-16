import { useState, useEffect, useCallback, useMemo, useRef } from "react";
import {
  Receipt, Plus, Search, Filter, Trash2, AlertTriangle, Check,
  Database, Calendar, Eye, Download, Printer, X, Edit, User, Truck,
} from "lucide-react";
import { supabase } from "@/lib/supabase";
import { formatCurrency } from "@/lib/utils";

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
}

export interface SaleRecord {
  bill_no: string;
  form_type: string;
  bill_date: string;
  customer_name: string;
  customer_phone?: string;
  ship_to?: string;
  salesman?: string;
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

function blankItem(): SaleItem {
  return { code: "", name: "", hsn_code: "", qty: 1, unit: "Nos", rate: 0,
    amount: 0, disc_pct: 0, mrp: 0, sgst: 9, cgst: 9 };
}

function normalizeSale(raw: Record<string, unknown>): SaleRecord {
  let items: SaleItem[] = [];
  if (Array.isArray(raw.items) && raw.items.length > 0) {
    items = (raw.items as Record<string, unknown>[]).map((it) => ({
      code: String(it.code ?? ""),
      name: String(it.name ?? ""),
      hsn_code: String(it.hsn_code ?? ""),
      qty: Number(it.qty ?? 1),
      unit: String(it.unit ?? "Nos"),
      rate: Number(it.rate ?? 0),
      amount: Number(it.amount ?? 0),
      disc_pct: Number(it.disc_pct ?? 0),
      mrp: Number(it.mrp ?? 0),
      sgst: Number(it.sgst ?? 0),
      cgst: Number(it.cgst ?? 0),
    }));
  }
  return {
    bill_no: String(raw.bill_no ?? raw.invoice_no ?? ""),
    form_type: String(raw.form_type ?? "Tax Invoice"),
    bill_date: String(raw.bill_date ?? raw.invoice_date ?? ""),
    customer_name: String(raw.customer_name ?? ""),
    customer_phone: raw.customer_phone ? String(raw.customer_phone) : "",
    ship_to: raw.ship_to ? String(raw.ship_to) : "",
    salesman: raw.salesman ? String(raw.salesman) : "",
    branch_godown: String(raw.branch_godown ?? "Shop (Main Showroom)"),
    rate_tp: String(raw.rate_tp ?? "Retail"),
    items,
    subtotal: Number(raw.subtotal ?? raw.amount ?? 0),
    f_cess: Number(raw.f_cess ?? 0),
    discount: Number(raw.discount ?? 0),
    total_gst: Number(raw.total_gst ?? raw.tax_amount ?? 0),
    commission: Number(raw.commission ?? 0),
    postage: Number(raw.postage ?? 0),
    round_off: Number(raw.round_off ?? 0),
    grand_total: Number(raw.grand_total ?? raw.amount ?? 0),
    payment_amount: Number(raw.payment_amount ?? raw.grand_total ?? raw.amount ?? 0),
    payment_mode: String(raw.payment_mode ?? "Cash"),
    balance: Number(raw.balance ?? 0),
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

// ─── Main Page Component ──────────────────────────────────────────────────────

export default function SalesPage() {
  const [sales, setSales] = useState<SaleRecord[]>([]);
  const [inventory, setInventory] = useState<InventoryItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [isFormOpen, setIsFormOpen] = useState(false);
  const [dbStatus, setDbStatus] = useState<"connected" | "local">("connected");
  const [editingSale, setEditingSale] = useState<SaleRecord | null>(null);
  const [viewingSale, setViewingSale] = useState<SaleRecord | null>(null);

  // ── Purchase item lookup: code → latest PurchaseItem data ──
  // Used to pre-fill rate, sgst, cgst, hsn_code, unit, s_rate, mrp when selecting a product
  const [purchaseItemMap, setPurchaseItemMap] = useState<Map<string, {
    rate: number; sgst: number; cgst: number;
    hsn_code: string; unit: string; s_rate: number; mrp: number;
  }>>(new Map());

  // Search & filter
  const [searchQuery, setSearchQuery] = useState("");
  const [statusFilter, setStatusFilter] = useState("All");
  const [currentPage, setCurrentPage] = useState(1);
  const itemsPerPage = 10;

  useEffect(() => { setTimeout(() => setCurrentPage(1), 0); }, [searchQuery, statusFilter]);

  // ── Header form fields ──
  const [billNo, setBillNo] = useState("");
  const [formType, setFormType] = useState("Tax Invoice");
  const [billDate, setBillDate] = useState(new Date().toISOString().split("T")[0]);
  const [customerName, setCustomerName] = useState("");
  const [isCustomCustomer, setIsCustomCustomer] = useState(false);
  const [customCustomerText, setCustomCustomerText] = useState("");
  const [customerPhone, setCustomerPhone] = useState("");
  const [shipTo, setShipTo] = useState("");
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

  // ── Auto-generate bill number ──
  const generateBillNo = useCallback(() => {
    const yr = new Date().getFullYear();
    const rnd = Math.floor(1000 + Math.random() * 9000);
    setBillNo(`BILL-${yr}-${rnd}`);
  }, []);

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
  // Priority: s_rate > rate for selling price; also pulls sgst, cgst, hsn_code, unit, mrp.
  const fetchPurchaseItemMap = useCallback(async () => {
    try {
      const { data, error } = await supabase
        .from("purchases")
        .select("items, created_at")
        .order("created_at", { ascending: false });

      if (error || !data) {
        // Fallback: local storage
        const local = localStorage.getItem("kaniyamparambil_purchases");
        if (!local) return;
        try {
          const parsed = JSON.parse(local) as Array<{ items: unknown[]; created_at?: string }>;
          buildMap(parsed);
        } catch { /* ignore */ }
        return;
      }
      buildMap(data as Array<{ items: unknown[]; created_at?: string }>);
    } catch { /* ignore */ }

    function buildMap(rows: Array<{ items: unknown[]; created_at?: string }>) {
      // rows are already newest-first from Supabase ORDER BY
      const map = new Map<string, {
        rate: number; sgst: number; cgst: number;
        hsn_code: string; unit: string; s_rate: number; mrp: number;
      }>();
      for (const row of rows) {
        if (!Array.isArray(row.items)) continue;
        for (const it of row.items as Record<string, unknown>[]) {
          const code = String(it.code ?? "").trim();
          if (!code || map.has(code)) continue; // keep first (= newest) occurrence
          map.set(code, {
            rate:     Number(it.s_rate ?? it.rate ?? 0),   // prefer s_rate (selling price)
            sgst:     Number(it.sgst ?? 9),
            cgst:     Number(it.cgst ?? 9),
            hsn_code: String(it.hsn_code ?? ""),
            unit:     String(it.unit ?? "Nos"),
            s_rate:   Number(it.s_rate ?? 0),
            mrp:      Number(it.mrp ?? 0),
          });
        }
      }
      setPurchaseItemMap(map);
    }
  }, []);

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
      const { data, error } = await supabase.from("sales").select("*").order("created_at", { ascending: false });
      if (error) { setDbStatus("local"); loadLocalSales(); }
      else if (data) { setSales((data as Record<string, unknown>[]).map(normalizeSale)); setDbStatus("connected"); }
    } catch { setDbStatus("local"); loadLocalSales(); }
    finally { setLoading(false); }
  }, [loadLocalSales]);

  useEffect(() => {
    const t = setTimeout(() => { fetchSales(); fetchInventory(); fetchPurchaseItemMap(); generateBillNo(); }, 0);
    return () => clearTimeout(t);
  }, [fetchSales, fetchInventory, fetchPurchaseItemMap, generateBillNo]);

  // ── Grid helpers ──
  const addGridRow = () => setGridItems((prev) => [...prev, blankItem()]);
  const removeGridRow = (i: number) => { if (gridItems.length > 1) setGridItems(gridItems.filter((_, idx) => idx !== i)); };

  const updateGridRow = (i: number, key: keyof SaleItem, val: string | number) => {
    setGridItems(gridItems.map((item, idx) => {
      if (idx !== i) return item;
      const updated = { ...item, [key]: val };
      // Amount is always qty × mrp
      if (key === "qty" || key === "mrp") {
        updated.amount = Number(updated.qty) * Number(updated.mrp);
      }
      return updated;
    }));
  };

  const handleProductSelect = (i: number, prod: InventoryItem) => {
    // Look up latest purchase data for this item code
    const purchaseData = purchaseItemMap.get(prod.code);
    const mrpVal = purchaseData?.mrp ?? 0;
    setGridItems(gridItems.map((item, idx) => idx !== i ? item : {
      ...item,
      code:     prod.code,
      name:     prod.name,
      hsn_code: purchaseData?.hsn_code || prod.hsn_code || "",
      unit:     purchaseData?.unit     || prod.uom       || "Nos",
      rate:     purchaseData?.rate     ?? 0,   // cost/purchase price — reference
      mrp:      mrpVal,                         // selling price
      amount:   item.qty * mrpVal,              // qty × mrp
      sgst:     purchaseData?.sgst     ?? 9,
      cgst:     purchaseData?.cgst     ?? 9,
    }));
  };

  // ── Live calculations ──
  const calc = useMemo(() => {
    let sub = 0, totalGst = 0;
    gridItems.forEach((item) => {
      const mrpAmt  = item.qty * item.mrp;                          // qty × MRP = selling value
      const discAmt = mrpAmt * ((item.disc_pct || 0) / 100);       // discount on MRP
      const taxable = Math.max(0, mrpAmt - discAmt);               // taxable = MRP - discount
      sub      += taxable;
      totalGst += taxable * (((item.sgst ?? 0) + (item.cgst ?? 0)) / 100);
    });
    const discNum   = Number(discount)   || 0;
    const fCessNum  = Number(fCess)      || 0;
    const commNum   = Number(commission) || 0;
    const postNum   = Number(postage)    || 0;
    const rawTotal  = sub - discNum + totalGst + fCessNum + commNum + postNum;
    const roundOff  = Math.round(rawTotal) - rawTotal;
    const grandTotal = rawTotal + roundOff;
    return {
      subtotal: Math.round(sub * 100) / 100,
      totalGst: Math.round(totalGst * 100) / 100,
      roundOff: Math.round(roundOff * 100) / 100,
      grandTotal: Math.round(grandTotal * 100) / 100,
    };
  }, [gridItems, discount, fCess, commission, postage]);

  // Auto-fill payment amount
  useEffect(() => {
    if (calc.grandTotal > 0) setPaymentAmount(String(calc.grandTotal));
  }, [calc.grandTotal]);

  // ── Reset form ──
  const resetForm = () => {
    setEditingSale(null);
    setFormType("Tax Invoice");
    setBillDate(new Date().toISOString().split("T")[0]);
    setCustomerName(""); setIsCustomCustomer(false); setCustomCustomerText("");
    setCustomerPhone(""); setShipTo("");
    setSalesman("Manager"); setIsCustomSalesman(false); setCustomSalesmanText("");
    setBranchGodown("Shop (Main Showroom)"); setRateTp("Retail");
    setGridItems([blankItem()]);
    setFCess(""); setDiscount(""); setCommission(""); setPostage("");
    setPaymentAmount(""); setPaymentMode("Cash");
    setFormError(null);
    setIsFormOpen(false);
    generateBillNo();
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
    if (gridItems.some((i) => !i.name.trim() || i.qty <= 0 || i.rate <= 0)) {
      setFormError("All items must have a name, valid quantity, and rate."); return;
    }
    const salesmanFinal = isCustomSalesman ? customSalesmanText.trim() : salesman;
    const paidNum = Number(paymentAmount) || 0;
    const bal = Math.max(0, calc.grandTotal - paidNum);
    const status = paidNum >= calc.grandTotal ? "Paid" : paidNum > 0 ? "Partial" : "Credit";

    const payload: SaleRecord = {
      bill_no: billNo,
      form_type: formType,
      bill_date: billDate,
      customer_name: customerFinal,
      customer_phone: customerPhone.trim() || undefined,
      ship_to: shipTo.trim() || undefined,
      salesman: salesmanFinal || undefined,
      branch_godown: branchGodown,
      rate_tp: rateTp,
      items: gridItems,
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
          const { error } = await supabase.from("sales").update(payload).eq("bill_no", editingSale.bill_no);
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
          const { error } = await supabase.from("sales").insert([payload]);
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

  // ── Print ──
  const handlePrint = (rec: SaleRecord) => {
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
    <tr><td>Postage:</td><td style="text-align:right">₹${rec.postage.toFixed(2)}</td></tr>
    <tr><td>Round Off:</td><td style="text-align:right">${rec.round_off >= 0 ? "+" : ""}₹${rec.round_off.toFixed(2)}</td></tr>
    <tr class="bold"><td>Grand Total:</td><td style="text-align:right">₹${rec.grand_total.toFixed(2)}</td></tr>
    <tr><td>Payment:</td><td style="text-align:right;color:green">₹${rec.payment_amount.toFixed(2)}</td></tr>
    <tr><td>Balance:</td><td style="text-align:right;color:${rec.balance > 0 ? "#dc2626" : "green"}">₹${rec.balance.toFixed(2)}</td></tr>
    </table></div>
    <script>setTimeout(()=>{window.focus();window.print();window.close();},300);</script>
    </body></html>`);
    win.document.close();
  };

  // ── Download ──
  const handleDownload = (rec: SaleRecord) => {
    const blob = new Blob([JSON.stringify(rec, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a"); a.href = url; a.download = `bill_${rec.bill_no}.json`;
    document.body.appendChild(a); a.click(); document.body.removeChild(a); URL.revokeObjectURL(url);
  };

  // ── Filtered & paginated list ──
  const filteredSales = useMemo(() => sales.filter((s) => {
    const q = searchQuery.toLowerCase();
    const matchQ = s.bill_no.toLowerCase().includes(q) || s.customer_name.toLowerCase().includes(q);
    const matchS = statusFilter === "All" || s.payment_status === statusFilter;
    return matchQ && matchS;
  }), [sales, searchQuery, statusFilter]);

  const totalPages = Math.ceil(filteredSales.length / itemsPerPage);
  const currentSales = filteredSales.slice((currentPage - 1) * itemsPerPage, currentPage * itemsPerPage);

  const availableCustomers = useMemo(() =>
    Array.from(new Set([...SEED_CUSTOMERS, ...sales.map((s) => s.customer_name)])).filter(Boolean),
    [sales]);

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
        <button onClick={() => { resetForm(); setIsFormOpen(true); }}
          className="btn-primary bg-green-600 hover:bg-green-700 active:bg-green-800 flex items-center gap-1.5 shadow-sm">
          <Plus className="w-4 h-4" /> New Sales Bill
        </button>
      </div>

      {/* ── DB Status ── */}
      {dbStatus === "local" && (
        <div className="bg-blue-50 border border-blue-200 rounded-lg p-4 flex items-start gap-3">
          <Database className="w-5 h-5 text-blue-600 mt-0.5 flex-shrink-0" />
          <div>
            <h4 className="text-sm font-semibold text-blue-800">Local Mode Active</h4>
            <p className="text-xs text-blue-700 mt-0.5">
              The <code>sales</code> table is missing or has old columns. Run the SQL in{" "}
              <code>sql/04_sales.sql</code> in your Supabase Editor (use the DROP + CREATE block).
            </p>
          </div>
        </div>
      )}

      {/* ── Search & Filter ── */}
      <div className="bg-white border border-border rounded-xl shadow-card p-4 flex flex-col md:flex-row md:items-center justify-between gap-4">
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

      {/* ── Sales Table ── */}
      <div className="bg-white border border-border rounded-xl shadow-card overflow-hidden">
        <div className="overflow-x-auto">
          <table className="table-enterprise w-full text-xs">
            <thead>
              <tr className="bg-gray-50 border-b border-border">
                {["Bill No.", "Form Type", "Customer", "Date", "Salesman", "Grand Total (₹)", "Payment", "Status", "Actions"].map((h) => (
                  <th key={h} className="px-4 py-3 text-center font-semibold uppercase tracking-wider text-text-secondary">{h}</th>
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
              ) : filteredSales.length === 0 ? (
                <tr><td colSpan={9} className="text-center py-16 text-text-secondary">
                  <Calendar className="w-8 h-8 mx-auto text-gray-300 mb-2"/>
                  <p className="font-semibold text-sm">No sales bills found</p>
                  <p className="text-xs text-gray-400 mt-1">Click "New Sales Bill" to create one.</p>
                </td></tr>
              ) : currentSales.map((rec) => (
                <tr key={rec.bill_no} className="border-b border-border hover:bg-gray-50/50 transition-colors">
                  <td className="px-4 py-2.5 font-mono font-semibold text-center">{rec.bill_no}</td>
                  <td className="px-4 py-2.5 text-center text-xs">{rec.form_type}</td>
                  <td className="px-4 py-2.5 font-medium text-center truncate max-w-[140px]" title={rec.customer_name}>{rec.customer_name}</td>
                  <td className="px-4 py-2.5 font-mono text-center text-text-secondary">{rec.bill_date}</td>
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
                        { icon: Printer, title: "Print", fn: () => handlePrint(rec) },
                        { icon: Download, title: "Download", fn: () => handleDownload(rec) },
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
          <span>Showing {filteredSales.length > 0 ? (currentPage - 1) * itemsPerPage + 1 : 0}–{Math.min(currentPage * itemsPerPage, filteredSales.length)} of {filteredSales.length}</span>
          <div className="flex items-center gap-2">
            <button onClick={() => setCurrentPage((p) => Math.max(p - 1, 1))} disabled={currentPage === 1}
              className="px-3 py-1.5 font-semibold rounded border border-border bg-white text-gray-700 hover:bg-gray-50 disabled:opacity-50 disabled:cursor-not-allowed">Previous</button>
            <span className="font-medium text-gray-700">Page {currentPage} of {totalPages || 1}</span>
            <button onClick={() => setCurrentPage((p) => Math.min(p + 1, totalPages))} disabled={currentPage >= totalPages || totalPages === 0}
              className="px-3 py-1.5 font-semibold rounded border border-border bg-white text-gray-700 hover:bg-gray-50 disabled:opacity-50 disabled:cursor-not-allowed">Next</button>
          </div>
          <div className="font-semibold text-gray-900">
            Total Sales: <span className="font-mono text-green-700 bg-green-50 px-2 py-0.5 border border-green-100 rounded">
              {formatCurrency(filteredSales.reduce((a, s) => a + s.grand_total, 0))}
            </span>
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
                      <select value={customerName}
                        onChange={(e) => e.target.value === "CUSTOM" ? (setIsCustomCustomer(true)) : setCustomerName(e.target.value)}
                        className="input-enterprise bg-white cursor-pointer text-xs w-full" required>
                        <option value="">-- Select Customer --</option>
                        {availableCustomers.map((c) => <option key={c} value={c}>{c}</option>)}
                        <option value="CUSTOM" className="text-green-700 font-bold">+ Add New Customer</option>
                      </select>
                    ) : (
                      <div className="flex gap-2 items-center">
                        <input type="text" value={customCustomerText} onChange={(e) => setCustomCustomerText(e.target.value)}
                          placeholder="Type customer name" className="input-enterprise text-xs w-full" required />
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
                    <select value={rateTp} onChange={(e) => setRateTp(e.target.value)}
                      className="input-enterprise bg-white cursor-pointer text-xs" required>
                      {RATE_TP_OPTIONS.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
                    </select>
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
                        <th className="p-2 w-[80px] text-right">MRP (₹) *</th>
                        <th className="p-2 w-[85px] text-right">Amount (₹)</th>
                        <th className="p-2 w-[60px] text-center">Dis%</th>
                        <th className="p-2 w-[55px] text-center">SGST%</th>
                        <th className="p-2 w-[55px] text-center">CGST%</th>
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
                          {/* Unit */}
                          <td className="p-1.5">
                            <select value={item.unit} onChange={(e) => updateGridRow(idx, "unit", e.target.value)}
                              className="w-full text-center border border-slate-300 rounded p-1 text-xs bg-white cursor-pointer" required>
                              {UNITS.map((u) => <option key={u} value={u}>{u}</option>)}
                            </select>
                          </td>
                          {/* MRP — primary selling price, drives all calculations */}
                          <td className="p-1.5">
                            <input type="number" min="0" value={item.mrp || ""}
                              onChange={(e) => updateGridRow(idx, "mrp", parseFloat(e.target.value) || 0)}
                              className="w-full text-right border border-green-400 rounded p-1 text-xs font-mono font-semibold focus:ring-2 focus:ring-green-500/20 focus:border-green-600" placeholder="0.00" required />
                          </td>
                          {/* Amount = qty × MRP (auto, read-only) */}
                          <td className="p-1.5">
                            <input readOnly value={(item.qty * item.mrp).toFixed(2)} tabIndex={-1}
                              className="w-full text-right border border-slate-200 rounded p-1 text-xs font-mono bg-slate-50 text-slate-600 cursor-not-allowed" />
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
                      <label className="form-label text-xs font-semibold text-slate-700 mb-1 block">Postage (₹)</label>
                      <input type="number" min="0" value={postage} onChange={(e) => setPostage(e.target.value)}
                        placeholder="0.00" className="input-enterprise font-mono text-xs w-full" />
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
                      <span>Subtot. (qty × MRP − Disc):</span>
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
                      <span>GST &amp; Cess (auto from Rate TP):</span>
                      <span className="font-mono">+{formatCurrency(calc.totalGst)}</span>
                    </div>
                    <div className="flex justify-between text-slate-500">
                      <span>Comm. (+):</span>
                      <span className="font-mono">+{formatCurrency(Number(commission) || 0)}</span>
                    </div>
                    <div className="flex justify-between text-slate-500">
                      <span>Postage (+):</span>
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
                  ["Date", viewingSale.bill_date],
                  ["Rate TP", viewingSale.rate_tp],
                  ["Customer", viewingSale.customer_name],
                  ["Phone", viewingSale.customer_phone || "—"],
                  ["Ship To", viewingSale.ship_to || "—"],
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
                    <span>Postage:</span>
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
              <button type="button" onClick={() => handlePrint(viewingSale)}
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
