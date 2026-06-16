import { useState, useEffect, useCallback } from "react";
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

  const handlePrintItem = (item: InventoryItem) => {
    const printWindow = window.open("", "_blank");
    if (!printWindow) {
      alert("Popup blocker is active. Please allow popups to print product specification sheets.");
      return;
    }
    printWindow.document.write(`
      <html>
        <head>
          <title>Print Product Sheet - ${item.code}</title>
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
            <p class="subtitle">Product Specification & Catalog Report</p>
          </div>
          <table>
            <tr><th>Item Code</th><td>${item.code}</td></tr>
            <tr><th>Product Name / Print Description</th><td>${item.name}</td></tr>
            <tr><th>Company Code Reference</th><td>${item.company_code || '—'}</td></tr>
            <tr><th>Product Group Category</th><td>${item.group}</td></tr>
            <tr><th>Sub-Group Segment</th><td>${item.sub_group || '—'}</td></tr>
            <tr><th>Brand Name</th><td>${item.brand || '—'}</td></tr>
            <tr><th>Product Compliance Type</th><td>${item.type}</td></tr>
            <tr><th>HSN Code</th><td>${item.hsn_code || '—'}</td></tr>
            <tr><th>Unit of Measurement (UOM)</th><td>${item.uom}</td></tr>
            <tr><th>Batch Tracking Enabled</th><td>${item.enable_batch === 'Y' ? 'Yes' : 'No'}</td></tr>
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

  const handleDownloadItem = (item: InventoryItem) => {
    try {
      const doc = new jsPDF();
      
      // Page Header
      doc.setFont("Helvetica", "bold");
      doc.setFontSize(18);
      doc.setTextColor(15, 23, 42); // slate-900
      doc.text("New Kaniyamparambil Stores", 14, 20);
      
      doc.setFont("Helvetica", "normal");
      doc.setFontSize(10);
      doc.setTextColor(100, 116, 139); // slate-500
      doc.text("Product Specification & Catalog Report", 14, 26);
      
      // Divider line
      doc.setDrawColor(226, 232, 240); // slate-200
      doc.line(14, 30, 196, 30);
      
      // Document fields layout
      let y = 42;
      const rowHeight = 10;
      
      const fields = [
        { label: "Item Code", value: item.code },
        { label: "Product Name / Print Name", value: item.name },
        { label: "Company Code Reference", value: item.company_code || "—" },
        { label: "Product Group Category", value: item.group },
        { label: "Sub-Group Segment", value: item.sub_group || "—" },
        { label: "Brand Name", value: item.brand || "—" },
        { label: "Product Compliance Type", value: item.type },
        { label: "HSN Code", value: item.hsn_code || "—" },
        { label: "Unit of Measurement (UOM)", value: item.uom },
        { label: "Batch Tracking Enabled", value: item.enable_batch === "Y" ? "Yes" : "No" }
      ];
      
      fields.forEach((f) => {
        // Draw label block
        doc.setFont("Helvetica", "bold");
        doc.setFontSize(10);
        doc.setTextColor(71, 85, 105); // slate-600
        doc.text(f.label, 14, y);
        
        // Draw value block
        doc.setFont("Helvetica", "normal");
        doc.setFontSize(10);
        doc.setTextColor(15, 23, 42); // slate-900
        
        const splitValue = doc.splitTextToSize(String(f.value), 110);
        doc.text(splitValue, 80, y);
        
        const linesCount = splitValue.length;
        y += rowHeight + (linesCount - 1) * 4;
        
        // Horizontal cell divider
        doc.setDrawColor(241, 245, 249); // slate-100
        doc.line(14, y - 5, 196, y - 5);
      });
      
      // Save PDF file
      doc.save(`product_${item.code}.pdf`);
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
                onClick={() => setViewingItem(null)}
                className="btn-primary bg-slate-900 hover:bg-slate-800 active:bg-slate-950 px-6 py-2 font-bold shadow-sm text-white transition-colors rounded text-xs"
              >
                Close View
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

        <div className="flex items-center gap-3">
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
