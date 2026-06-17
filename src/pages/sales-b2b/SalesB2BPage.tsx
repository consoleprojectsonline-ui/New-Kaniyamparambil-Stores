import { useState, useEffect, useCallback, useMemo, useRef } from "react";
import {
  Building2, Plus, Search, Trash2, AlertTriangle, Check, Database, X, Edit,
  Receipt, User, Truck, Eye, FileText, Users,
} from "lucide-react";
import { supabase } from "@/lib/supabase";
import { formatCurrency, formatTableDate } from "@/lib/utils";
import type { SaleItem } from "@/pages/sales/SalesPage";

// ─── Types ────────────────────────────────────────────────────────────────────

export interface B2BBuyer {
  id: string;
  legal_name: string;
  trade_name?: string;
  gstin: string;
  pan?: string;
  contact_person?: string;
  phone?: string;
  email?: string;
  billing_address: string;
  ship_to_address?: string;
  city?: string;
  state: string;
  state_code: string;
  pincode?: string;
  business_type: string;
  notes?: string;
  is_active: boolean;
  created_at?: string;
}

export interface B2BSaleRecord {
  bill_no: string;
  buyer_id?: string;
  buyer_legal_name: string;
  buyer_trade_name?: string;
  buyer_gstin: string;
  buyer_pan?: string;
  buyer_contact_person?: string;
  buyer_phone?: string;
  buyer_email?: string;
  buyer_billing_address: string;
  buyer_ship_to?: string;
  buyer_city?: string;
  buyer_state?: string;
  buyer_state_code?: string;
  buyer_pincode?: string;
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

interface InventoryItem {
  code: string;
  name: string;
  hsn_code: string;
  uom: string;
}

// ─── Constants ────────────────────────────────────────────────────────────────

const FORM_TYPES = ["Tax Invoice", "Retail Invoice", "Delivery Note", "Credit Note"];
const BUSINESS_TYPES = ["Contractor", "Wholesaler", "Retailer", "Manufacturer", "Business", "Other"];
const BRANCHES = ["Shop (Main Showroom)", "Central Godown A", "Warehouse Godown B", "Transit / On-Field Stock"];
const RATE_TP_OPTIONS = [
  { value: "Wholesale", label: "Wholesale (TP)" },
  { value: "GST_5", label: "GST @ 5%" },
  { value: "GST_12", label: "GST @ 12%" },
  { value: "GST_18", label: "GST @ 18%" },
  { value: "GST_28", label: "GST @ 28%" },
  { value: "Exempt", label: "GST Exempt (0%)" },
];
const PAYMENT_MODES = ["Bank Transfer", "UPI", "Cheque", "Cash", "Credit"];
const UNITS = ["Nos", "Mtr", "Kg", "Ltr", "Box", "Pcs", "Set", "Pair", "Roll", "Bag", "Bundle", "Dozen"];
const SEED_SALESMEN = ["Manager", "Sunil", "Reena", "Ajith", "Priya"];
const INDIAN_STATES = [
  { name: "Kerala", code: "32" }, { name: "Tamil Nadu", code: "33" },
  { name: "Karnataka", code: "29" }, { name: "Maharashtra", code: "27" },
  { name: "Gujarat", code: "24" }, { name: "Andhra Pradesh", code: "37" },
  { name: "Telangana", code: "36" }, { name: "Delhi", code: "07" },
];
const FETCH_PAGE_SIZE = 1000;
const LOCAL_BUYERS_KEY = "kaniyamparambil_b2b_buyers";
const LOCAL_SALES_KEY = "kaniyamparambil_sales_b2b";

type PageTab = "bills" | "buyers";

// ─── Helpers ──────────────────────────────────────────────────────────────────

function toDbNumber(value: unknown): number {
  const n = Number(value);
  return Number.isFinite(n) ? n : 0;
}

function todayIso(): string {
  return new Date().toISOString().split("T")[0];
}

function blankItem(): SaleItem {
  return {
    code: "", name: "", hsn_code: "", qty: 1, unit: "Nos", rate: 0,
    amount: 0, disc_pct: 0, mrp: 0, sgst: 9, cgst: 9, line_total: 0,
  };
}

function computeLineAutos(item: SaleItem): Partial<SaleItem> {
  const mrpAmt = Number(item.qty) * Number(item.mrp);
  const discAmt = mrpAmt * ((Number(item.disc_pct) || 0) / 100);
  const taxable = Math.max(0, mrpAmt - discAmt);
  const sgstAmt = taxable * ((Number(item.sgst) || 0) / 100);
  const cgstAmt = taxable * ((Number(item.cgst) || 0) / 100);
  return {
    amount: Math.round(mrpAmt * 100) / 100,
    line_total: Math.round((taxable + sgstAmt + cgstAmt) * 100) / 100,
  };
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
  return {
    taxableValue,
    cgstAmount,
    sgstAmount,
    total: taxableValue + cgstAmount + sgstAmount,
  };
}

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

function compareBillNo(a: string, b: string): number {
  return a.localeCompare(b, undefined, { numeric: true, sensitivity: "base" });
}

function getNextB2BBillNo(existing: string[]): string {
  const bills = existing.map((b) => b.trim()).filter(Boolean);
  if (bills.length === 0) return "B2B-0001";
  const sorted = [...bills].sort(compareBillNo);
  const latest = sorted[sorted.length - 1];
  const match = latest.match(/^(B2B-)?(\d+)$/i) ?? latest.match(/^(.*?)(\d+)$/);
  if (match) {
    const prefix = match[1] || "B2B-";
    const numStr = match[2];
    const next = Number(numStr) + 1;
    return `${prefix}${String(next).padStart(numStr.length, "0")}`;
  }
  return `${latest}-1`;
}

function validateGstin(gstin: string): boolean {
  const v = gstin.trim().toUpperCase();
  return /^[0-9]{2}[A-Z]{5}[0-9]{4}[A-Z]{1}[1-9A-Z]{1}Z[0-9A-Z]{1}$/.test(v);
}

function normalizeBuyer(raw: Record<string, unknown>): B2BBuyer {
  return {
    id: String(raw.id ?? crypto.randomUUID()),
    legal_name: String(raw.legal_name ?? ""),
    trade_name: raw.trade_name ? String(raw.trade_name) : undefined,
    gstin: String(raw.gstin ?? "").toUpperCase(),
    pan: raw.pan ? String(raw.pan).toUpperCase() : undefined,
    contact_person: raw.contact_person ? String(raw.contact_person) : undefined,
    phone: raw.phone ? String(raw.phone) : undefined,
    email: raw.email ? String(raw.email) : undefined,
    billing_address: String(raw.billing_address ?? ""),
    ship_to_address: raw.ship_to_address ? String(raw.ship_to_address) : undefined,
    city: raw.city ? String(raw.city) : undefined,
    state: String(raw.state ?? "Kerala"),
    state_code: String(raw.state_code ?? "32"),
    pincode: raw.pincode ? String(raw.pincode) : undefined,
    business_type: String(raw.business_type ?? "Business"),
    notes: raw.notes ? String(raw.notes) : undefined,
    is_active: raw.is_active !== false,
    created_at: raw.created_at ? String(raw.created_at) : undefined,
  };
}

function normalizeSaleItem(raw: Record<string, unknown>): SaleItem {
  const item = blankItem();
  return {
    ...item,
    code: String(raw.code ?? ""),
    name: String(raw.name ?? ""),
    hsn_code: String(raw.hsn_code ?? ""),
    qty: toDbNumber(raw.qty) || 1,
    unit: String(raw.unit ?? raw.uom ?? "Nos"),
    rate: toDbNumber(raw.rate),
    amount: toDbNumber(raw.amount),
    disc_pct: toDbNumber(raw.disc_pct),
    mrp: toDbNumber(raw.mrp ?? raw.rate),
    sgst: toDbNumber(raw.sgst) || 9,
    cgst: toDbNumber(raw.cgst) || 9,
    line_total: toDbNumber(raw.line_total),
  };
}

function normalizeB2BSale(raw: Record<string, unknown>): B2BSaleRecord {
  let items: SaleItem[] = [];
  if (Array.isArray(raw.items)) {
    items = (raw.items as Record<string, unknown>[]).map(normalizeSaleItem);
  }
  const grandTotal = toDbNumber(raw.grand_total);
  return {
    bill_no: String(raw.bill_no ?? ""),
    buyer_id: raw.buyer_id ? String(raw.buyer_id) : undefined,
    buyer_legal_name: String(raw.buyer_legal_name ?? raw.customer_name ?? ""),
    buyer_trade_name: raw.buyer_trade_name ? String(raw.buyer_trade_name) : undefined,
    buyer_gstin: String(raw.buyer_gstin ?? "").toUpperCase(),
    buyer_pan: raw.buyer_pan ? String(raw.buyer_pan) : undefined,
    buyer_contact_person: raw.buyer_contact_person ? String(raw.buyer_contact_person) : undefined,
    buyer_phone: raw.buyer_phone ? String(raw.buyer_phone) : undefined,
    buyer_email: raw.buyer_email ? String(raw.buyer_email) : undefined,
    buyer_billing_address: String(raw.buyer_billing_address ?? ""),
    buyer_ship_to: raw.buyer_ship_to ? String(raw.buyer_ship_to) : undefined,
    buyer_city: raw.buyer_city ? String(raw.buyer_city) : undefined,
    buyer_state: raw.buyer_state ? String(raw.buyer_state) : undefined,
    buyer_state_code: raw.buyer_state_code ? String(raw.buyer_state_code) : undefined,
    buyer_pincode: raw.buyer_pincode ? String(raw.buyer_pincode) : undefined,
    form_type: String(raw.form_type ?? "Tax Invoice"),
    bill_date: String(raw.bill_date ?? ""),
    customer_name: String(raw.customer_name ?? raw.buyer_legal_name ?? ""),
    customer_phone: raw.customer_phone ? String(raw.customer_phone) : undefined,
    ship_to: raw.ship_to ? String(raw.ship_to) : undefined,
    salesman: raw.salesman ? String(raw.salesman) : undefined,
    vehicle_no: raw.vehicle_no ? String(raw.vehicle_no) : undefined,
    branch_godown: String(raw.branch_godown ?? "Shop (Main Showroom)"),
    rate_tp: String(raw.rate_tp ?? "Wholesale"),
    items,
    subtotal: toDbNumber(raw.subtotal),
    f_cess: toDbNumber(raw.f_cess),
    discount: toDbNumber(raw.discount),
    total_gst: toDbNumber(raw.total_gst),
    commission: toDbNumber(raw.commission),
    postage: toDbNumber(raw.postage),
    round_off: toDbNumber(raw.round_off),
    grand_total: grandTotal,
    payment_amount: toDbNumber(raw.payment_amount ?? grandTotal),
    payment_mode: String(raw.payment_mode ?? "Bank Transfer"),
    balance: toDbNumber(raw.balance),
    payment_status: String(raw.payment_status ?? "Credit"),
    created_at: raw.created_at ? String(raw.created_at) : undefined,
  };
}

function buyerDisplayName(b: B2BBuyer): string {
  return b.trade_name?.trim() || b.legal_name;
}

function seedBuyers(): B2BBuyer[] {
  return [
    {
      id: crypto.randomUUID(),
      legal_name: "Rajan Electricals Pvt Ltd",
      trade_name: "Rajan Electricals",
      gstin: "32AABCR1234F1Z5",
      pan: "AABCR1234F",
      contact_person: "Rajan K.",
      phone: "9847012345",
      billing_address: "Industrial Estate, Thopramkudy, Kerala",
      city: "Thopramkudy",
      state: "Kerala",
      state_code: "32",
      pincode: "685551",
      business_type: "Wholesaler",
      is_active: true,
    },
    {
      id: crypto.randomUUID(),
      legal_name: "Suresh Hardware & Contractors",
      gstin: "32AACCS5678G1Z8",
      contact_person: "Suresh Nair",
      phone: "9895012345",
      billing_address: "Main Road, Kumily, Kerala",
      city: "Kumily",
      state: "Kerala",
      state_code: "32",
      business_type: "Contractor",
      is_active: true,
    },
  ];
}

function isMissingTableError(error: { code?: string; message?: string }): boolean {
  const message = (error.message ?? "").toLowerCase();
  if (error.code === "PGRST205" || error.code === "42P01") return true;
  if (message.includes("could not find the table")) return true;
  return message.includes("relation") && message.includes("does not exist");
}

// ─── Searchable selects ───────────────────────────────────────────────────────

function SearchableBuyerSelect({
  buyers, value, onChange, placeholder = "Search GST-registered buyer...",
}: {
  buyers: B2BBuyer[];
  value: string;
  onChange: (buyer: B2BBuyer) => void;
  placeholder?: string;
}) {
  const [isOpen, setIsOpen] = useState(false);
  const [search, setSearch] = useState("");
  const [dropStyle, setDropStyle] = useState<{ top: number; left: number; width: number } | null>(null);
  const btnRef = useRef<HTMLButtonElement>(null);
  const selected = buyers.find((b) => b.id === value);

  const filtered = useMemo(() => {
    const q = search.toLowerCase();
    return buyers.filter((b) =>
      b.legal_name.toLowerCase().includes(q) ||
      (b.trade_name ?? "").toLowerCase().includes(q) ||
      b.gstin.toLowerCase().includes(q)
    );
  }, [buyers, search]);

  const openDrop = () => {
    if (btnRef.current) {
      const r = btnRef.current.getBoundingClientRect();
      const dropH = Math.min(280, filtered.length * 48 + 52);
      const top = window.innerHeight - r.bottom >= dropH ? r.bottom + 4 : r.top - dropH - 4;
      setDropStyle({ top, left: r.left, width: r.width });
    }
    setIsOpen(true);
  };

  return (
    <div className="relative w-full text-left">
      <button ref={btnRef} type="button" onClick={() => (isOpen ? setIsOpen(false) : openDrop())}
        className="w-full flex items-center justify-between bg-white text-xs border border-slate-300 rounded py-2 px-3 focus:outline-none focus:ring-2 focus:ring-primary/10 focus:border-primary">
        <span className="truncate text-left">
          {selected
            ? `${buyerDisplayName(selected)} · ${selected.gstin}`
            : placeholder}
        </span>
        <span className="ml-1 text-slate-400 text-[9px]">{isOpen ? "▲" : "▼"}</span>
      </button>
      {isOpen && dropStyle && (
        <>
          <div className="fixed inset-0 z-[60]" onClick={() => { setIsOpen(false); setSearch(""); }} />
          <div className="fixed z-[70] bg-white border border-slate-200 rounded-lg shadow-2xl overflow-hidden flex flex-col"
            style={{ top: dropStyle.top, left: dropStyle.left, width: dropStyle.width, maxHeight: 280 }}>
            <div className="p-2 border-b border-slate-100">
              <input autoFocus type="text" value={search} onChange={(e) => setSearch(e.target.value)}
                placeholder="Name or GSTIN..." className="w-full text-xs border border-slate-300 rounded px-2 py-1.5" />
            </div>
            <ul className="overflow-y-auto py-1 flex-1">
              {filtered.length === 0
                ? <li className="px-3 py-2 text-xs text-slate-500 text-center">No buyers found</li>
                : filtered.map((b) => (
                  <li key={b.id} onClick={() => { onChange(b); setIsOpen(false); setSearch(""); }}
                    className={`px-3 py-2 text-xs cursor-pointer hover:bg-violet-50 border-b border-slate-50 last:border-0 ${b.id === value ? "bg-violet-100/60 font-semibold" : ""}`}>
                    <div className="font-semibold text-slate-800">{buyerDisplayName(b)}</div>
                    <div className="text-[10px] text-slate-500 font-mono mt-0.5">{b.gstin}</div>
                  </li>
                ))}
            </ul>
          </div>
        </>
      )}
    </div>
  );
}

function SearchableProductSelect({
  items, value, onChange,
}: { items: InventoryItem[]; value: string; onChange: (item: InventoryItem) => void }) {
  const [isOpen, setIsOpen] = useState(false);
  const [search, setSearch] = useState("");
  const [dropStyle, setDropStyle] = useState<{ top: number; left: number; width: number } | null>(null);
  const btnRef = useRef<HTMLButtonElement>(null);
  const selected = items.find((i) => i.code === value);
  const filtered = useMemo(() => {
    const q = search.toLowerCase();
    return items.filter((i) =>
      (i.name ?? "").toLowerCase().includes(q) ||
      (i.code ?? "").toLowerCase().includes(q)
    );
  }, [items, search]);

  const openDrop = () => {
    if (btnRef.current) {
      const r = btnRef.current.getBoundingClientRect();
      setDropStyle({ top: r.bottom + 4, left: r.left, width: r.width });
    }
    setIsOpen(true);
  };

  return (
    <div className="relative w-full">
      <button ref={btnRef} type="button" onClick={() => (isOpen ? setIsOpen(false) : openDrop())}
        className="w-full flex items-center justify-between bg-white text-[11px] border border-slate-300 rounded py-1.5 px-2">
        <span className="truncate">{selected ? `${selected.code} - ${selected.name}` : "Search item..."}</span>
        <span className="text-slate-400 text-[9px]">{isOpen ? "▲" : "▼"}</span>
      </button>
      {isOpen && dropStyle && (
        <>
          <div className="fixed inset-0 z-[60]" onClick={() => { setIsOpen(false); setSearch(""); }} />
          <div className="fixed z-[70] bg-white border rounded-lg shadow-2xl overflow-hidden flex flex-col"
            style={{ top: dropStyle.top, left: dropStyle.left, width: dropStyle.width, maxHeight: 240 }}>
            <div className="p-2 border-b">
              <input autoFocus value={search} onChange={(e) => setSearch(e.target.value)}
                className="w-full text-xs border rounded px-2 py-1" placeholder="Code / name" />
            </div>
            <ul className="overflow-y-auto">
              {filtered.map((item) => (
                <li key={item.code} onClick={() => { onChange(item); setIsOpen(false); setSearch(""); }}
                  className="px-3 py-2 text-xs cursor-pointer hover:bg-green-50 border-b border-slate-50">
                  <div className="font-semibold">{item.code}</div>
                  <div className="text-[10px] text-slate-500 truncate">{item.name}</div>
                </li>
              ))}
            </ul>
          </div>
        </>
      )}
    </div>
  );
}

// ─── Main Page ────────────────────────────────────────────────────────────────

export default function SalesB2BPage() {
  const [activeTab, setActiveTab] = useState<PageTab>("bills");
  const [buyers, setBuyers] = useState<B2BBuyer[]>([]);
  const [bills, setBills] = useState<B2BSaleRecord[]>([]);
  const [inventory, setInventory] = useState<InventoryItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [dbStatus, setDbStatus] = useState<"connected" | "local">("connected");

  const [billSearch, setBillSearch] = useState("");
  const [buyerSearch, setBuyerSearch] = useState("");

  const [isBuyerFormOpen, setIsBuyerFormOpen] = useState(false);
  const [editingBuyer, setEditingBuyer] = useState<B2BBuyer | null>(null);
  const [isBillFormOpen, setIsBillFormOpen] = useState(false);
  const [editingBill, setEditingBill] = useState<B2BSaleRecord | null>(null);
  const [viewingBill, setViewingBill] = useState<B2BSaleRecord | null>(null);
  const [buyerToDelete, setBuyerToDelete] = useState<B2BBuyer | null>(null);

  const [formError, setFormError] = useState<string | null>(null);
  const [successMsg, setSuccessMsg] = useState<string | null>(null);

  // Buyer form fields
  const [legalName, setLegalName] = useState("");
  const [tradeName, setTradeName] = useState("");
  const [gstin, setGstin] = useState("");
  const [pan, setPan] = useState("");
  const [contactPerson, setContactPerson] = useState("");
  const [buyerPhone, setBuyerPhone] = useState("");
  const [buyerEmail, setBuyerEmail] = useState("");
  const [billingAddress, setBillingAddress] = useState("");
  const [shipToAddress, setShipToAddress] = useState("");
  const [city, setCity] = useState("");
  const [state, setState] = useState("Kerala");
  const [stateCode, setStateCode] = useState("32");
  const [pincode, setPincode] = useState("");
  const [businessType, setBusinessType] = useState("Business");
  const [buyerNotes, setBuyerNotes] = useState("");

  // Bill form fields
  const [billNo, setBillNo] = useState("");
  const [formType, setFormType] = useState("Tax Invoice");
  const [billDate, setBillDate] = useState(todayIso());
  const [selectedBuyerId, setSelectedBuyerId] = useState("");
  const [branchGodown, setBranchGodown] = useState(BRANCHES[0]);
  const [rateTp, setRateTp] = useState("Wholesale");
  const [salesman, setSalesman] = useState("Manager");
  const [vehicleNo, setVehicleNo] = useState("");
  const [shipTo, setShipTo] = useState("");
  const [gridItems, setGridItems] = useState<SaleItem[]>([blankItem()]);
  const [fCess, setFCess] = useState("");
  const [discount, setDiscount] = useState("");
  const [commission, setCommission] = useState("");
  const [postage, setPostage] = useState("");
  const [paymentAmount, setPaymentAmount] = useState("");
  const [paymentMode, setPaymentMode] = useState("Bank Transfer");

  const activeBuyers = useMemo(() => buyers.filter((b) => b.is_active), [buyers]);
  const selectedBuyer = useMemo(
    () => activeBuyers.find((b) => b.id === selectedBuyerId) ?? null,
    [activeBuyers, selectedBuyerId],
  );

  const loadLocalBuyers = useCallback(() => {
    const local = localStorage.getItem(LOCAL_BUYERS_KEY);
    if (local) {
      try {
        setBuyers((JSON.parse(local) as Record<string, unknown>[]).map(normalizeBuyer));
      } catch {
        const seed = seedBuyers();
        localStorage.setItem(LOCAL_BUYERS_KEY, JSON.stringify(seed));
        setBuyers(seed);
      }
    } else {
      const seed = seedBuyers();
      localStorage.setItem(LOCAL_BUYERS_KEY, JSON.stringify(seed));
      setBuyers(seed);
    }
  }, []);

  const loadLocalBills = useCallback(() => {
    const local = localStorage.getItem(LOCAL_SALES_KEY);
    if (local) {
      try {
        setBills((JSON.parse(local) as Record<string, unknown>[]).map(normalizeB2BSale));
      } catch {
        setBills([]);
      }
    } else {
      setBills([]);
    }
  }, []);

  const fetchBuyers = useCallback(async () => {
    try {
      const rows: Record<string, unknown>[] = [];
      let from = 0;
      while (true) {
        const { data, error } = await supabase
          .from("b2b_buyers")
          .select("*")
          .order("legal_name")
          .range(from, from + FETCH_PAGE_SIZE - 1);
        if (error) {
          if (isMissingTableError(error)) {
            setDbStatus("local");
            loadLocalBuyers();
          }
          return;
        }
        if (!data?.length) break;
        rows.push(...(data as Record<string, unknown>[]));
        if (data.length < FETCH_PAGE_SIZE) break;
        from += FETCH_PAGE_SIZE;
      }
      setBuyers(rows.map(normalizeBuyer));
      localStorage.setItem(LOCAL_BUYERS_KEY, JSON.stringify(rows));
    } catch {
      setDbStatus("local");
      loadLocalBuyers();
    }
  }, [loadLocalBuyers]);

  const fetchBills = useCallback(async () => {
    try {
      setLoading(true);
      const rows: Record<string, unknown>[] = [];
      let from = 0;
      while (true) {
        const { data, error } = await supabase
          .from("sales_b2b")
          .select("*")
          .order("created_at", { ascending: false })
          .range(from, from + FETCH_PAGE_SIZE - 1);
        if (error) {
          if (isMissingTableError(error)) {
            setDbStatus("local");
            loadLocalBills();
          }
          return;
        }
        if (!data?.length) break;
        rows.push(...(data as Record<string, unknown>[]));
        if (data.length < FETCH_PAGE_SIZE) break;
        from += FETCH_PAGE_SIZE;
      }
      setBills(rows.map(normalizeB2BSale));
      setDbStatus("connected");
      localStorage.setItem(LOCAL_SALES_KEY, JSON.stringify(rows));
    } catch {
      setDbStatus("local");
      loadLocalBills();
    } finally {
      setLoading(false);
    }
  }, [loadLocalBills]);

  const fetchInventory = useCallback(async () => {
    try {
      const { data, error } = await supabase.from("inventory").select("code, name, hsn_code, uom").order("name");
      if (!error && data) {
        setInventory(data as InventoryItem[]);
        return;
      }
    } catch { /* fall through */ }
    const local = localStorage.getItem("kaniyamparambil_inventory");
    if (local) {
      try { setInventory(JSON.parse(local)); } catch { setInventory([]); }
    }
  }, []);

  useEffect(() => {
    fetchBuyers();
    fetchBills();
    fetchInventory();
  }, [fetchBuyers, fetchBills, fetchInventory]);

  useEffect(() => {
    if (!editingBill) {
      setBillNo(getNextB2BBillNo(bills.map((b) => b.bill_no)));
    }
  }, [bills, editingBill]);

  const calc = useMemo(() => {
    let sub = 0;
    let totalGst = 0;
    let linesTotal = 0;
    gridItems.forEach((item) => {
      const s = getSaleItemSummary(item);
      sub += s.taxableValue;
      totalGst += s.cgstAmount + s.sgstAmount;
      linesTotal += s.total;
    });
    const discNum = Number(discount) || 0;
    const rawTotal = linesTotal - discNum + (Number(fCess) || 0) + (Number(commission) || 0) + (Number(postage) || 0);
    const roundOff = Math.round(rawTotal) - rawTotal;
    const grandTotal = rawTotal + roundOff;
    return {
      subtotal: Math.round(sub * 100) / 100,
      totalGst: Math.round(totalGst * 100) / 100,
      roundOff: Math.round(roundOff * 100) / 100,
      grandTotal: Math.round(grandTotal * 100) / 100,
    };
  }, [gridItems, discount, fCess, commission, postage]);

  useEffect(() => {
    if (calc.grandTotal > 0 && isBillFormOpen) setPaymentAmount(String(calc.grandTotal));
  }, [calc.grandTotal, isBillFormOpen]);

  const filteredBills = useMemo(() => {
    const q = billSearch.toLowerCase();
    return bills.filter((b) =>
      b.bill_no.toLowerCase().includes(q) ||
      b.buyer_legal_name.toLowerCase().includes(q) ||
      b.buyer_gstin.toLowerCase().includes(q)
    );
  }, [bills, billSearch]);

  const filteredBuyersList = useMemo(() => {
    const q = buyerSearch.toLowerCase();
    return buyers.filter((b) =>
      b.legal_name.toLowerCase().includes(q) ||
      (b.trade_name ?? "").toLowerCase().includes(q) ||
      b.gstin.toLowerCase().includes(q)
    );
  }, [buyers, buyerSearch]);

  const resetBuyerForm = () => {
    setEditingBuyer(null);
    setLegalName(""); setTradeName(""); setGstin(""); setPan("");
    setContactPerson(""); setBuyerPhone(""); setBuyerEmail("");
    setBillingAddress(""); setShipToAddress(""); setCity("");
    setState("Kerala"); setStateCode("32"); setPincode("");
    setBusinessType("Business"); setBuyerNotes("");
    setFormError(null);
    setIsBuyerFormOpen(false);
  };

  const openAddBuyer = () => {
    resetBuyerForm();
    setIsBuyerFormOpen(true);
  };

  const openEditBuyer = (b: B2BBuyer) => {
    setEditingBuyer(b);
    setLegalName(b.legal_name);
    setTradeName(b.trade_name ?? "");
    setGstin(b.gstin);
    setPan(b.pan ?? "");
    setContactPerson(b.contact_person ?? "");
    setBuyerPhone(b.phone ?? "");
    setBuyerEmail(b.email ?? "");
    setBillingAddress(b.billing_address);
    setShipToAddress(b.ship_to_address ?? "");
    setCity(b.city ?? "");
    setState(b.state);
    setStateCode(b.state_code);
    setPincode(b.pincode ?? "");
    setBusinessType(b.business_type);
    setBuyerNotes(b.notes ?? "");
    setFormError(null);
    setIsBuyerFormOpen(true);
  };

  const handleBuyerSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setFormError(null);
    const gst = gstin.trim().toUpperCase();
    if (!legalName.trim()) { setFormError("Legal / registered company name is required."); return; }
    if (!validateGstin(gst)) { setFormError("Enter a valid 15-character GSTIN."); return; }
    if (!billingAddress.trim()) { setFormError("Billing address is required."); return; }

    const duplicate = buyers.find(
      (b) => b.gstin.toUpperCase() === gst && b.id !== editingBuyer?.id,
    );
    if (duplicate) { setFormError(`GSTIN already registered to ${buyerDisplayName(duplicate)}.`); return; }

    const payload: B2BBuyer = {
      id: editingBuyer?.id ?? crypto.randomUUID(),
      legal_name: legalName.trim(),
      trade_name: tradeName.trim() || undefined,
      gstin: gst,
      pan: pan.trim().toUpperCase() || undefined,
      contact_person: contactPerson.trim() || undefined,
      phone: buyerPhone.trim() || undefined,
      email: buyerEmail.trim() || undefined,
      billing_address: billingAddress.trim(),
      ship_to_address: shipToAddress.trim() || undefined,
      city: city.trim() || undefined,
      state,
      state_code: stateCode,
      pincode: pincode.trim() || undefined,
      business_type: businessType,
      notes: buyerNotes.trim() || undefined,
      is_active: true,
    };

    if (dbStatus === "connected") {
      try {
        if (editingBuyer) {
          const { error } = await supabase.from("b2b_buyers").update(payload).eq("id", editingBuyer.id);
          if (error) throw error;
        } else {
          const { error } = await supabase.from("b2b_buyers").insert([payload]);
          if (error) throw error;
        }
        setSuccessMsg(editingBuyer ? "Business updated." : "Business registered.");
        fetchBuyers();
        resetBuyerForm();
      } catch (err) {
        setFormError(err instanceof Error ? err.message : "Save failed.");
      }
    } else {
      const updated = editingBuyer
        ? buyers.map((b) => (b.id === editingBuyer.id ? payload : b))
        : [payload, ...buyers];
      localStorage.setItem(LOCAL_BUYERS_KEY, JSON.stringify(updated));
      setBuyers(updated);
      setSuccessMsg(editingBuyer ? "Business updated (local)." : "Business registered (local).");
      resetBuyerForm();
    }
  };

  const handleDeleteBuyer = async () => {
    if (!buyerToDelete) return;
    const id = buyerToDelete.id;
    const removedName = buyerDisplayName(buyerToDelete);
    if (dbStatus === "connected") {
      const { error } = await supabase.from("b2b_buyers").delete().eq("id", id);
      if (error) {
        setFormError(error.message);
        setBuyerToDelete(null);
        return;
      }
      setBuyerToDelete(null);
      setSuccessMsg(`Removed "${removedName}" from registry.`);
      fetchBuyers();
    } else {
      const updated = buyers.filter((x) => x.id !== id);
      localStorage.setItem(LOCAL_BUYERS_KEY, JSON.stringify(updated));
      setBuyers(updated);
      setBuyerToDelete(null);
      setSuccessMsg(`Removed "${removedName}" from registry.`);
    }
  };

  const resetBillForm = () => {
    setEditingBill(null);
    setFormType("Tax Invoice");
    setBillDate(todayIso());
    setSelectedBuyerId("");
    setBranchGodown(BRANCHES[0]);
    setRateTp("Wholesale");
    setSalesman("Manager");
    setVehicleNo("");
    setShipTo("");
    setGridItems([blankItem()]);
    setFCess(""); setDiscount(""); setCommission(""); setPostage("");
    setPaymentAmount(""); setPaymentMode("Bank Transfer");
    setFormError(null);
    setIsBillFormOpen(false);
  };

  const openNewBill = (preselectBuyer?: B2BBuyer) => {
    if (activeBuyers.length === 0) {
      alert("Register at least one GST-registered business before generating a B2B bill.");
      setActiveTab("buyers");
      openAddBuyer();
      return;
    }
    resetBillForm();
    if (preselectBuyer) applyBuyerToBill(preselectBuyer);
    setIsBillFormOpen(true);
  };

  const applyBuyerToBill = (b: B2BBuyer) => {
    setSelectedBuyerId(b.id);
    setShipTo(b.ship_to_address ?? b.billing_address);
  };

  const updateGridRow = (idx: number, field: keyof SaleItem, value: string | number) => {
    setGridItems((prev) => prev.map((item, i) => {
      if (i !== idx) return item;
      const updated = { ...item, [field]: value };
      return { ...updated, ...computeLineAutos(updated) };
    }));
  };

  const handleProductSelect = (idx: number, prod: InventoryItem) => {
    setGridItems((prev) => prev.map((item, i) => {
      if (i !== idx) return item;
      const updated: SaleItem = {
        ...item,
        code: prod.code,
        name: prod.name,
        hsn_code: prod.hsn_code || item.hsn_code,
        unit: prod.uom || item.unit,
      };
      return { ...updated, ...computeLineAutos(updated) };
    }));
  };

  const handleRateTpChange = (next: string) => {
    setRateTp(next);
    const rates = gstRatesFromRateTp(next);
    if (!rates) return;
    setGridItems((prev) => prev.map((item) => {
      const updated = { ...item, sgst: rates.sgst, cgst: rates.cgst };
      return { ...updated, ...computeLineAutos(updated) };
    }));
  };

  const handleBillSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setFormError(null);
    if (!selectedBuyer) { setFormError("Select a GST-registered buyer."); return; }
    if (gridItems.some((i) => !i.name.trim() || i.qty <= 0 || i.mrp <= 0)) {
      setFormError("All items need name, quantity, and unit price.");
      return;
    }

    const paidNum = Number(paymentAmount) || 0;
    const bal = Math.max(0, calc.grandTotal - paidNum);
    const status = paidNum >= calc.grandTotal ? "Paid" : paidNum > 0 ? "Partial" : "Credit";
    const itemsFinal = gridItems.map((item) => ({ ...item, ...computeLineAutos(item) }));

    const payload: B2BSaleRecord = {
      bill_no: billNo,
      buyer_id: selectedBuyer.id,
      buyer_legal_name: selectedBuyer.legal_name,
      buyer_trade_name: selectedBuyer.trade_name,
      buyer_gstin: selectedBuyer.gstin,
      buyer_pan: selectedBuyer.pan,
      buyer_contact_person: selectedBuyer.contact_person,
      buyer_phone: selectedBuyer.phone,
      buyer_email: selectedBuyer.email,
      buyer_billing_address: selectedBuyer.billing_address,
      buyer_ship_to: selectedBuyer.ship_to_address,
      buyer_city: selectedBuyer.city,
      buyer_state: selectedBuyer.state,
      buyer_state_code: selectedBuyer.state_code,
      buyer_pincode: selectedBuyer.pincode,
      form_type: formType,
      bill_date: billDate,
      customer_name: selectedBuyer.legal_name,
      customer_phone: selectedBuyer.phone,
      ship_to: shipTo.trim() || selectedBuyer.ship_to_address || undefined,
      salesman: salesman || undefined,
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

    if (editingBill) {
      if (dbStatus === "connected") {
        try {
          const { error } = await supabase.from("sales_b2b").update(payload).eq("bill_no", editingBill.bill_no);
          if (error) throw error;
          setSuccessMsg(`Updated B2B bill ${billNo}.`);
          fetchBills();
          resetBillForm();
        } catch (err) {
          setFormError(err instanceof Error ? err.message : "Update failed.");
        }
      } else {
        const updated = bills.map((b) => (b.bill_no === editingBill.bill_no ? payload : b));
        localStorage.setItem(LOCAL_SALES_KEY, JSON.stringify(updated));
        setBills(updated);
        setSuccessMsg(`Updated B2B bill ${billNo} (local).`);
        resetBillForm();
      }
    } else {
      if (bills.some((b) => b.bill_no === billNo)) {
        setFormError(`Bill No. "${billNo}" already exists.`);
        return;
      }
      if (dbStatus === "connected") {
        try {
          const { error } = await supabase.from("sales_b2b").insert([payload]);
          if (error) throw error;
          setSuccessMsg(`B2B bill ${billNo} saved.`);
          fetchBills();
          resetBillForm();
        } catch (err) {
          setFormError(err instanceof Error ? err.message : "Save failed.");
        }
      } else {
        const updated = [payload, ...bills];
        localStorage.setItem(LOCAL_SALES_KEY, JSON.stringify(updated));
        setBills(updated);
        setSuccessMsg(`B2B bill ${billNo} saved (local).`);
        resetBillForm();
      }
    }
  };

  const handleDeleteBill = async (bn: string) => {
    if (!window.confirm(`Delete B2B bill "${bn}"?`)) return;
    if (dbStatus === "connected") {
      const { error } = await supabase.from("sales_b2b").delete().eq("bill_no", bn);
      if (error) { alert(error.message); return; }
      fetchBills();
    } else {
      const updated = bills.filter((b) => b.bill_no !== bn);
      localStorage.setItem(LOCAL_SALES_KEY, JSON.stringify(updated));
      setBills(updated);
    }
  };

  const handleStateChange = (stateName: string) => {
    setState(stateName);
    const found = INDIAN_STATES.find((s) => s.name === stateName);
    if (found) setStateCode(found.code);
  };

  return (
    <div className="p-6 space-y-6">
      {dbStatus === "local" && (
        <div className="bg-amber-50 border border-amber-200 rounded-lg p-4 flex items-start gap-3">
          <Database className="w-5 h-5 text-amber-600 mt-0.5 shrink-0" />
          <div>
            <h4 className="text-sm font-semibold text-amber-800">Local Mode</h4>
            <p className="text-xs text-amber-700 mt-0.5">
              B2B tables not found in Supabase. Run <code className="font-mono">sql/07_sales_b2b.sql</code> in the SQL Editor, or data is stored locally until then.
            </p>
          </div>
        </div>
      )}

      {successMsg && (
        <div className="bg-green-50 border border-green-200 text-green-800 text-xs px-4 py-2.5 rounded-md flex items-center gap-2">
          <Check className="w-4 h-4" />{successMsg}
          <button type="button" onClick={() => setSuccessMsg(null)} className="ml-auto"><X className="w-3.5 h-3.5" /></button>
        </div>
      )}

      <div className="flex flex-col lg:flex-row lg:items-center lg:justify-between gap-4">
        <div>
          <div className="flex items-center gap-2">
            <Building2 className="w-6 h-6 text-primary" />
            <h1 className="text-page-title font-semibold text-text-primary">Sales B2B</h1>
          </div>
          <p className="text-caption text-text-secondary mt-0.5">
            GST-registered business buyers · tax invoices · wholesale billing
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <button type="button" onClick={() => openNewBill()}
            className="btn-primary flex items-center gap-1.5 text-xs font-bold">
            <Receipt className="w-4 h-4" /> Generate B2B Bill
          </button>
          <button type="button" onClick={openAddBuyer}
            className="btn-secondary flex items-center gap-1.5 text-xs font-bold border-violet-200 text-violet-800 hover:bg-violet-50">
            <Plus className="w-4 h-4" /> Add Business / Company
          </button>
        </div>
      </div>

      <div className="flex gap-1 border-b border-border">
        {([
          ["bills", "B2B Bills", Receipt],
          ["buyers", "Registered Businesses", Users],
        ] as const).map(([tab, label, Icon]) => (
          <button key={tab} type="button" onClick={() => setActiveTab(tab)}
            className={`flex items-center gap-1.5 px-4 py-2.5 text-xs font-semibold border-b-2 transition-colors ${
              activeTab === tab
                ? "border-primary text-primary"
                : "border-transparent text-text-secondary hover:text-text-primary"
            }`}>
            <Icon className="w-3.5 h-3.5" />{label}
          </button>
        ))}
      </div>

      {activeTab === "bills" && (
        <div className="space-y-4">
          <div className="relative max-w-md">
            <Search className="w-4 h-4 text-text-secondary absolute left-3 top-2.5" />
            <input value={billSearch} onChange={(e) => setBillSearch(e.target.value)}
              placeholder="Search bill no, buyer, GSTIN..."
              className="input-enterprise pl-9 text-xs w-full" />
          </div>
          <div className="rounded-xl border border-border bg-white shadow-card overflow-hidden">
            <table className="w-full text-xs">
              <thead>
                <tr className="bg-slate-50 border-b border-border text-left font-semibold text-slate-600">
                  <th className="px-4 py-3">Bill No.</th>
                  <th className="px-4 py-3">Date</th>
                  <th className="px-4 py-3">Buyer (GSTIN)</th>
                  <th className="px-4 py-3 text-right">Grand Total</th>
                  <th className="px-4 py-3">Status</th>
                  <th className="px-4 py-3 text-center">Actions</th>
                </tr>
              </thead>
              <tbody>
                {loading ? (
                  <tr><td colSpan={6} className="px-4 py-8 text-center text-slate-400">Loading...</td></tr>
                ) : filteredBills.length === 0 ? (
                  <tr>
                    <td colSpan={6} className="px-4 py-10 text-center">
                      <FileText className="w-8 h-8 text-slate-300 mx-auto mb-2" />
                      <p className="text-sm text-slate-500">No B2B bills yet</p>
                      <button type="button" onClick={() => openNewBill()} className="text-primary text-xs font-semibold mt-2 hover:underline">
                        Generate first bill
                      </button>
                    </td>
                  </tr>
                ) : filteredBills.map((b) => (
                  <tr key={b.bill_no} className="border-b border-border hover:bg-slate-50/50">
                    <td className="px-4 py-2.5 font-mono font-semibold">{b.bill_no}</td>
                    <td className="px-4 py-2.5">{formatTableDate(b.bill_date)}</td>
                    <td className="px-4 py-2.5">
                      <div className="font-medium">{b.buyer_legal_name}</div>
                      <div className="text-[10px] font-mono text-slate-500">{b.buyer_gstin}</div>
                    </td>
                    <td className="px-4 py-2.5 text-right font-semibold">{formatCurrency(b.grand_total)}</td>
                    <td className="px-4 py-2.5">
                      <span className={`px-2 py-0.5 rounded text-[10px] font-bold ${
                        b.payment_status === "Paid" ? "bg-green-100 text-green-800"
                          : b.payment_status === "Partial" ? "bg-amber-100 text-amber-800"
                            : "bg-slate-100 text-slate-600"
                      }`}>{b.payment_status}</span>
                    </td>
                    <td className="px-4 py-2.5">
                      <div className="flex items-center justify-center gap-1">
                        <button type="button" onClick={() => setViewingBill(b)} className="p-1.5 rounded hover:bg-slate-100" title="View">
                          <Eye className="w-3.5 h-3.5" />
                        </button>
                        <button type="button" onClick={() => handleDeleteBill(b.bill_no)} className="p-1.5 rounded hover:bg-red-50 text-red-600" title="Delete">
                          <Trash2 className="w-3.5 h-3.5" />
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {activeTab === "buyers" && (
        <div className="space-y-4">
          <div className="relative max-w-md">
            <Search className="w-4 h-4 text-text-secondary absolute left-3 top-2.5" />
            <input value={buyerSearch} onChange={(e) => setBuyerSearch(e.target.value)}
              placeholder="Search company, trade name, GSTIN..."
              className="input-enterprise pl-9 text-xs w-full" />
          </div>
          <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
            {filteredBuyersList.length === 0 ? (
              <div className="col-span-full text-center py-12 border border-dashed rounded-xl">
                <Users className="w-8 h-8 text-slate-300 mx-auto mb-2" />
                <p className="text-sm text-slate-500">No registered businesses</p>
                <button type="button" onClick={openAddBuyer} className="text-primary text-xs font-semibold mt-2 hover:underline">
                  Add first business
                </button>
              </div>
            ) : filteredBuyersList.map((b) => (
              <div key={b.id} className="rounded-xl border border-border bg-white p-4 shadow-sm hover:shadow-md transition-shadow">
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0">
                    <h3 className="font-semibold text-slate-900 truncate">{buyerDisplayName(b)}</h3>
                    <p className="text-[10px] font-mono text-violet-700 mt-0.5">{b.gstin}</p>
                    <p className="text-[10px] text-slate-500 mt-1">{b.business_type}</p>
                  </div>
                  <div className="flex gap-1 shrink-0">
                    <button type="button" onClick={() => openEditBuyer(b)} className="p-1.5 rounded hover:bg-slate-100"><Edit className="w-3.5 h-3.5" /></button>
                    <button type="button" onClick={() => setBuyerToDelete(b)} className="p-1.5 rounded hover:bg-red-50 text-red-600"><Trash2 className="w-3.5 h-3.5" /></button>
                  </div>
                </div>
                <p className="text-xs text-slate-600 mt-2 line-clamp-2">{b.billing_address}</p>
                {b.contact_person && <p className="text-[10px] text-slate-500 mt-1">{b.contact_person} · {b.phone ?? "—"}</p>}
                <button type="button" onClick={() => openNewBill(b)}
                  className="mt-3 w-full text-[10px] font-bold text-primary border border-primary/20 rounded py-1.5 hover:bg-primary/5">
                  Generate Bill for this Buyer
                </button>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Buyer registration modal */}
      {isBuyerFormOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/50 backdrop-blur-sm">
          <div className="bg-white rounded-xl shadow-2xl max-w-2xl w-full max-h-[90vh] overflow-y-auto">
            <div className="bg-violet-950 px-6 py-4 text-white flex items-center justify-between sticky top-0 z-10">
              <div>
                <h2 className="text-sm font-bold">{editingBuyer ? "Edit Business" : "Register GST Business"}</h2>
                <p className="text-[10px] text-violet-200 mt-0.5">For buyers with valid GST registration</p>
              </div>
              <button type="button" onClick={resetBuyerForm}><X className="w-5 h-5" /></button>
            </div>
            <form onSubmit={handleBuyerSubmit} className="p-6 space-y-4">
              {formError && (
                <div className="bg-red-50 border border-red-200 text-red-800 text-xs px-3 py-2 rounded flex gap-2">
                  <AlertTriangle className="w-4 h-4 shrink-0" />{formError}
                </div>
              )}
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div className="md:col-span-2">
                  <label className="form-label text-xs">Legal / Registered Name *</label>
                  <input value={legalName} onChange={(e) => setLegalName(e.target.value)} className="input-enterprise text-xs" required />
                </div>
                <div>
                  <label className="form-label text-xs">Trade Name</label>
                  <input value={tradeName} onChange={(e) => setTradeName(e.target.value)} className="input-enterprise text-xs" placeholder="Optional display name" />
                </div>
                <div>
                  <label className="form-label text-xs">GSTIN *</label>
                  <input value={gstin} onChange={(e) => setGstin(e.target.value.toUpperCase())} maxLength={15}
                    className="input-enterprise text-xs font-mono uppercase" required placeholder="22AAAAA0000A1Z5" />
                </div>
                <div>
                  <label className="form-label text-xs">PAN</label>
                  <input value={pan} onChange={(e) => setPan(e.target.value.toUpperCase())} maxLength={10} className="input-enterprise text-xs font-mono uppercase" />
                </div>
                <div>
                  <label className="form-label text-xs">Business Type</label>
                  <select value={businessType} onChange={(e) => setBusinessType(e.target.value)} className="input-enterprise text-xs bg-white">
                    {BUSINESS_TYPES.map((t) => <option key={t} value={t}>{t}</option>)}
                  </select>
                </div>
                <div>
                  <label className="form-label text-xs">Contact Person</label>
                  <input value={contactPerson} onChange={(e) => setContactPerson(e.target.value)} className="input-enterprise text-xs" />
                </div>
                <div>
                  <label className="form-label text-xs">Phone</label>
                  <input value={buyerPhone} onChange={(e) => setBuyerPhone(e.target.value)} className="input-enterprise text-xs" />
                </div>
                <div>
                  <label className="form-label text-xs">Email</label>
                  <input type="email" value={buyerEmail} onChange={(e) => setBuyerEmail(e.target.value)} className="input-enterprise text-xs" />
                </div>
                <div className="md:col-span-2">
                  <label className="form-label text-xs">Billing Address *</label>
                  <textarea value={billingAddress} onChange={(e) => setBillingAddress(e.target.value)} rows={2} className="input-enterprise text-xs" required />
                </div>
                <div className="md:col-span-2">
                  <label className="form-label text-xs">Ship-To Address</label>
                  <textarea value={shipToAddress} onChange={(e) => setShipToAddress(e.target.value)} rows={2} className="input-enterprise text-xs" placeholder="Leave blank if same as billing" />
                </div>
                <div>
                  <label className="form-label text-xs">City</label>
                  <input value={city} onChange={(e) => setCity(e.target.value)} className="input-enterprise text-xs" />
                </div>
                <div>
                  <label className="form-label text-xs">State</label>
                  <select value={state} onChange={(e) => handleStateChange(e.target.value)} className="input-enterprise text-xs bg-white">
                    {INDIAN_STATES.map((s) => <option key={s.code} value={s.name}>{s.name}</option>)}
                  </select>
                </div>
                <div>
                  <label className="form-label text-xs">State Code</label>
                  <input value={stateCode} onChange={(e) => setStateCode(e.target.value)} className="input-enterprise text-xs font-mono" readOnly />
                </div>
                <div>
                  <label className="form-label text-xs">Pincode</label>
                  <input value={pincode} onChange={(e) => setPincode(e.target.value)} className="input-enterprise text-xs" />
                </div>
                <div className="md:col-span-2">
                  <label className="form-label text-xs">Notes</label>
                  <input value={buyerNotes} onChange={(e) => setBuyerNotes(e.target.value)} className="input-enterprise text-xs" />
                </div>
              </div>
              <div className="flex justify-end gap-2 pt-2">
                <button type="button" onClick={resetBuyerForm} className="btn-secondary text-xs">Cancel</button>
                <button type="submit" className="btn-primary text-xs font-bold">
                  {editingBuyer ? "Update Business" : "Register Business"}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* B2B bill modal */}
      {isBillFormOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/50 backdrop-blur-sm">
          <div className="bg-white rounded-xl shadow-2xl max-w-6xl w-full max-h-[92vh] overflow-y-auto flex flex-col">
            <div className="bg-slate-950 px-6 py-4 text-white flex items-center justify-between sticky top-0 z-20">
              <div>
                <h2 className="text-sm font-bold">{editingBill ? "Edit B2B Bill" : "New B2B Tax Invoice"}</h2>
                <p className="text-[10px] text-slate-300">Bill No: {billNo}</p>
              </div>
              <button type="button" onClick={resetBillForm}><X className="w-5 h-5" /></button>
            </div>
            <form onSubmit={handleBillSubmit} className="p-6 space-y-5 flex-1">
              {formError && (
                <div className="bg-red-50 border border-red-200 text-red-800 text-xs px-3 py-2 rounded flex gap-2">
                  <AlertTriangle className="w-4 h-4 shrink-0" />{formError}
                </div>
              )}

              <div className="bg-violet-50 border border-violet-100 rounded-xl p-4 space-y-3">
                <h3 className="text-xs font-bold uppercase text-violet-800">Buyer (GST Registered) *</h3>
                <SearchableBuyerSelect buyers={activeBuyers} value={selectedBuyerId}
                  onChange={applyBuyerToBill} />
                {selectedBuyer && (
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-2 text-[11px] bg-white rounded-lg border border-violet-100 p-3">
                    <div><span className="text-slate-500">Legal Name:</span> <span className="font-semibold">{selectedBuyer.legal_name}</span></div>
                    <div><span className="text-slate-500">GSTIN:</span> <span className="font-mono font-semibold">{selectedBuyer.gstin}</span></div>
                    <div className="md:col-span-2"><span className="text-slate-500">Billing:</span> {selectedBuyer.billing_address}</div>
                    {selectedBuyer.pan && <div><span className="text-slate-500">PAN:</span> {selectedBuyer.pan}</div>}
                    <div><span className="text-slate-500">State:</span> {selectedBuyer.state} ({selectedBuyer.state_code})</div>
                  </div>
                )}
              </div>

              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
                <div>
                  <label className="form-label text-xs">Form Type</label>
                  <select value={formType} onChange={(e) => setFormType(e.target.value)} className="input-enterprise text-xs bg-white">
                    {FORM_TYPES.map((t) => <option key={t} value={t}>{t}</option>)}
                  </select>
                </div>
                <div>
                  <label className="form-label text-xs">Bill No.</label>
                  <input value={billNo} onChange={(e) => setBillNo(e.target.value)} disabled={!!editingBill}
                    className="input-enterprise text-xs font-mono" required />
                </div>
                <div>
                  <label className="form-label text-xs">Date</label>
                  <input type="date" value={billDate} onChange={(e) => setBillDate(e.target.value)} className="input-enterprise text-xs" required />
                </div>
                <div>
                  <label className="form-label text-xs">Branch / Godown</label>
                  <select value={branchGodown} onChange={(e) => setBranchGodown(e.target.value)} className="input-enterprise text-xs bg-white">
                    {BRANCHES.map((b) => <option key={b} value={b}>{b}</option>)}
                  </select>
                </div>
                <div>
                  <label className="form-label text-xs">Rate / GST Class</label>
                  <select value={rateTp} onChange={(e) => handleRateTpChange(e.target.value)} className="input-enterprise text-xs bg-white">
                    {RATE_TP_OPTIONS.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
                  </select>
                </div>
                <div>
                  <label className="form-label text-xs flex items-center gap-1"><User className="w-3 h-3" /> Salesman</label>
                  <select value={salesman} onChange={(e) => setSalesman(e.target.value)} className="input-enterprise text-xs bg-white">
                    {SEED_SALESMEN.map((s) => <option key={s} value={s}>{s}</option>)}
                  </select>
                </div>
                <div>
                  <label className="form-label text-xs flex items-center gap-1"><Truck className="w-3 h-3" /> Vehicle No.</label>
                  <input value={vehicleNo} onChange={(e) => setVehicleNo(e.target.value.toUpperCase())} className="input-enterprise text-xs font-mono uppercase" />
                </div>
                <div className="lg:col-span-2">
                  <label className="form-label text-xs">Ship To</label>
                  <input value={shipTo} onChange={(e) => setShipTo(e.target.value)} className="input-enterprise text-xs" />
                </div>
              </div>

              <div className="border rounded-xl p-4 space-y-2">
                <div className="flex justify-between items-center">
                  <h3 className="text-xs font-bold uppercase text-slate-500">Items</h3>
                  <button type="button" onClick={() => setGridItems((p) => [...p, blankItem()])}
                    className="text-xs font-bold text-green-700 flex items-center gap-1"><Plus className="w-3.5 h-3.5" /> Add Row</button>
                </div>
                <div className="overflow-x-auto">
                  <table className="w-full text-[11px]">
                    <thead>
                      <tr className="bg-slate-50 text-left font-semibold">
                        <th className="p-2 w-[180px]">Item</th>
                        <th className="p-2 w-12 text-center">Qty</th>
                        <th className="p-2 w-16 text-center">Unit</th>
                        <th className="p-2 w-20 text-right">Price</th>
                        <th className="p-2 w-16 text-center">Dis%</th>
                        <th className="p-2 w-14 text-center">SGST</th>
                        <th className="p-2 w-14 text-center">CGST</th>
                        <th className="p-2 w-20 text-right">Total</th>
                        <th className="p-2 w-8" />
                      </tr>
                    </thead>
                    <tbody>
                      {gridItems.map((item, idx) => (
                        <tr key={idx} className="border-t border-slate-100">
                          <td className="p-1">
                            <SearchableProductSelect items={inventory} value={item.code}
                              onChange={(p) => handleProductSelect(idx, p)} />
                          </td>
                          <td className="p-1">
                            <input type="number" min={1} value={item.qty} onChange={(e) => updateGridRow(idx, "qty", parseFloat(e.target.value) || 0)}
                              className="w-full text-center border rounded py-1 text-[11px]" />
                          </td>
                          <td className="p-1">
                            <select value={item.unit} onChange={(e) => updateGridRow(idx, "unit", e.target.value)} className="w-full border rounded py-1 text-[11px] bg-white">
                              {UNITS.map((u) => <option key={u} value={u}>{u}</option>)}
                            </select>
                          </td>
                          <td className="p-1">
                            <input type="number" min={0} step="any" value={item.mrp || ""} onChange={(e) => updateGridRow(idx, "mrp", parseFloat(e.target.value) || 0)}
                              className="w-full text-right border rounded py-1 text-[11px]" />
                          </td>
                          <td className="p-1">
                            <input type="number" min={0} value={item.disc_pct || ""} onChange={(e) => updateGridRow(idx, "disc_pct", parseFloat(e.target.value) || 0)}
                              className="w-full text-center border rounded py-1 text-[11px]" />
                          </td>
                          <td className="p-1">
                            <input type="number" min={0} value={item.sgst} onChange={(e) => updateGridRow(idx, "sgst", parseFloat(e.target.value) || 0)}
                              className="w-full text-center border rounded py-1 text-[11px]" />
                          </td>
                          <td className="p-1">
                            <input type="number" min={0} value={item.cgst} onChange={(e) => updateGridRow(idx, "cgst", parseFloat(e.target.value) || 0)}
                              className="w-full text-center border rounded py-1 text-[11px]" />
                          </td>
                          <td className="p-1 text-right font-semibold pr-2">{formatCurrency(item.line_total)}</td>
                          <td className="p-1">
                            {gridItems.length > 1 && (
                              <button type="button" onClick={() => setGridItems((p) => p.filter((_, i) => i !== idx))} className="text-red-500 p-1">
                                <Trash2 className="w-3.5 h-3.5" />
                              </button>
                            )}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>

              <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="form-label text-xs">Discount (₹)</label>
                    <input value={discount} onChange={(e) => setDiscount(e.target.value)} className="input-enterprise text-xs" />
                  </div>
                  <div>
                    <label className="form-label text-xs">F. Cess</label>
                    <input value={fCess} onChange={(e) => setFCess(e.target.value)} className="input-enterprise text-xs" />
                  </div>
                  <div>
                    <label className="form-label text-xs">Commission</label>
                    <input value={commission} onChange={(e) => setCommission(e.target.value)} className="input-enterprise text-xs" />
                  </div>
                  <div>
                    <label className="form-label text-xs">Postage</label>
                    <input value={postage} onChange={(e) => setPostage(e.target.value)} className="input-enterprise text-xs" />
                  </div>
                </div>
                <div className="bg-slate-50 rounded-xl p-4 space-y-1 text-xs">
                  <div className="flex justify-between"><span>Subtotal</span><span>{formatCurrency(calc.subtotal)}</span></div>
                  <div className="flex justify-between"><span>Total GST</span><span>{formatCurrency(calc.totalGst)}</span></div>
                  <div className="flex justify-between"><span>Round Off</span><span>{formatCurrency(calc.roundOff)}</span></div>
                  <div className="flex justify-between font-bold text-base border-t border-slate-200 pt-2 mt-2">
                    <span>Grand Total</span><span>{formatCurrency(calc.grandTotal)}</span>
                  </div>
                  <div className="grid grid-cols-2 gap-2 pt-3">
                    <div>
                      <label className="form-label text-[10px]">Payment Amount</label>
                      <input value={paymentAmount} onChange={(e) => setPaymentAmount(e.target.value)} className="input-enterprise text-xs" />
                    </div>
                    <div>
                      <label className="form-label text-[10px]">Payment Mode</label>
                      <select value={paymentMode} onChange={(e) => setPaymentMode(e.target.value)} className="input-enterprise text-xs bg-white">
                        {PAYMENT_MODES.map((m) => <option key={m} value={m}>{m}</option>)}
                      </select>
                    </div>
                  </div>
                </div>
              </div>

              <div className="flex justify-end gap-2">
                <button type="button" onClick={resetBillForm} className="btn-secondary text-xs">Cancel</button>
                <button type="submit" className="btn-primary text-xs font-bold">
                  {editingBill ? "Update B2B Bill" : "Save B2B Bill"}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* View bill detail */}
      {viewingBill && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/50 backdrop-blur-sm">
          <div className="bg-white rounded-xl shadow-2xl max-w-2xl w-full max-h-[85vh] overflow-y-auto">
            <div className="px-6 py-4 border-b flex justify-between items-center sticky top-0 bg-white">
              <h2 className="font-bold text-sm">B2B Bill {viewingBill.bill_no}</h2>
              <button type="button" onClick={() => setViewingBill(null)}><X className="w-5 h-5" /></button>
            </div>
            <div className="p-6 space-y-4 text-xs">
              <div className="bg-violet-50 rounded-lg p-3 space-y-1">
                <p className="font-bold text-violet-900">{viewingBill.buyer_legal_name}</p>
                <p className="font-mono text-violet-700">GSTIN: {viewingBill.buyer_gstin}</p>
                <p>{viewingBill.buyer_billing_address}</p>
                {viewingBill.buyer_ship_to && <p className="text-slate-600">Ship: {viewingBill.buyer_ship_to}</p>}
              </div>
              <div className="grid grid-cols-2 gap-2">
                <div><span className="text-slate-500">Date:</span> {formatTableDate(viewingBill.bill_date)}</div>
                <div><span className="text-slate-500">Type:</span> {viewingBill.form_type}</div>
                <div><span className="text-slate-500">Grand Total:</span> <strong>{formatCurrency(viewingBill.grand_total)}</strong></div>
                <div><span className="text-slate-500">Status:</span> {viewingBill.payment_status}</div>
              </div>
              <table className="w-full border text-[11px]">
                <thead><tr className="bg-slate-50"><th className="p-2 text-left">Item</th><th className="p-2">Qty</th><th className="p-2 text-right">Total</th></tr></thead>
                <tbody>
                  {viewingBill.items.map((it, i) => (
                    <tr key={i} className="border-t">
                      <td className="p-2">{it.name}</td>
                      <td className="p-2 text-center">{it.qty} {it.unit}</td>
                      <td className="p-2 text-right">{formatCurrency(it.line_total)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      )}

      {/* Remove buyer confirmation */}
      {buyerToDelete && (
        <div className="fixed inset-0 z-[60] flex items-center justify-center p-4 bg-slate-900/50 backdrop-blur-sm">
          <div
            className="bg-white rounded-xl shadow-2xl max-w-md w-full border border-border overflow-hidden"
            role="dialog"
            aria-modal="true"
            aria-labelledby="remove-buyer-title"
          >
            <div className="px-6 py-4 border-b border-border flex items-start gap-3">
              <div className="w-10 h-10 rounded-full bg-red-100 flex items-center justify-center shrink-0">
                <AlertTriangle className="w-5 h-5 text-red-600" />
              </div>
              <div className="min-w-0">
                <h2 id="remove-buyer-title" className="text-sm font-bold text-slate-900">
                  Remove from registry?
                </h2>
                <p className="text-xs text-slate-600 mt-1 leading-relaxed">
                  Remove{" "}
                  <span className="font-semibold text-slate-900">&quot;{buyerDisplayName(buyerToDelete)}&quot;</span>{" "}
                  from the GST business registry? Existing B2B bills for this buyer will not be deleted.
                </p>
                <p className="text-[10px] font-mono text-slate-500 mt-1">{buyerToDelete.gstin}</p>
              </div>
            </div>
            <div className="px-6 py-4 flex justify-end gap-2 bg-slate-50">
              <button
                type="button"
                onClick={() => setBuyerToDelete(null)}
                className="btn-secondary text-xs"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={() => void handleDeleteBuyer()}
                className="text-xs font-bold px-4 py-2 rounded-md bg-red-600 text-white hover:bg-red-700 transition-colors"
              >
                Remove
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
