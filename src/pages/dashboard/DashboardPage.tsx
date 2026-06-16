import { Link } from "react-router-dom";
import {
  Boxes,
  ShoppingCart,
  Receipt,
  BookOpen,
  FileSpreadsheet,
  TrendingUp,
  TrendingDown,
  Plus,
  ArrowUpRight,
} from "lucide-react";
import { useAuthStore } from "@/stores/authStore";
import { formatCurrency, formatNumber, cn } from "@/lib/utils";

export default function DashboardPage() {
  const { user } = useAuthStore();
  const ownerName = user?.user_metadata?.owner_name || "Manager";

  // Executive summary metrics
  const metrics = [
    {
      title: "Today's Sales",
      value: formatCurrency(84320),
      trend: "+12.4%",
      isPositive: true,
      sparklineColor: "#16a34a",
      data: [30, 45, 35, 50, 40, 60, 55, 70, 65, 80],
      accentColor: "#16a34a",
      bgGradient: "linear-gradient(135deg, #f0fdf4 0%, #dcfce7 100%)",
      borderLeft: "4px solid #16a34a",
    },
    {
      title: "Monthly Revenue",
      value: formatCurrency(2100000),
      trend: "+8.2%",
      isPositive: true,
      sparklineColor: "#0F4C81",
      data: [120, 130, 125, 140, 155, 160, 175, 190, 185, 210],
      accentColor: "#0F4C81",
      bgGradient: "linear-gradient(135deg, #eff6ff 0%, #dbeafe 100%)",
      borderLeft: "4px solid #0F4C81",
    },
    {
      title: "Outstanding Amount",
      value: formatCurrency(420500),
      trend: "-3.1%",
      isPositive: false,
      sparklineColor: "#dc2626",
      data: [450, 440, 435, 430, 435, 428, 422, 425, 418, 420],
      accentColor: "#dc2626",
      bgGradient: "linear-gradient(135deg, #fff7f7 0%, #fee2e2 100%)",
      borderLeft: "4px solid #dc2626",
    },
    {
      title: "Total Customers",
      value: formatNumber(1428),
      trend: "+4.6%",
      isPositive: true,
      sparklineColor: "#0284c7",
      data: [110, 112, 115, 120, 125, 130, 132, 135, 140, 142],
      accentColor: "#0284c7",
      bgGradient: "linear-gradient(135deg, #f0f9ff 0%, #e0f2fe 100%)",
      borderLeft: "4px solid #0284c7",
    },
  ];

  // Module cards with rich, distinct color schemes
  const modules = [
    {
      title: "Inventory",
      subtitle: "Items & Stock",
      shortDesc: "Catalog · Pricing · Stock",
      path: "/app/inventory",
      icon: Boxes,
      actions: [
        { label: "Add Item", path: "/app/inventory" },
        { label: "Stock Adjust", path: "/app/inventory" },
      ],
      cardBg: "linear-gradient(145deg, #1e3a8a 0%, #1e40af 100%)",
      accentBar: "#3b82f6",
    },
    {
      title: "Purchases",
      subtitle: "Supplier Bills",
      shortDesc: "Goods Receipt · Expenses",
      path: "/app/purchase",
      icon: ShoppingCart,
      actions: [
        { label: "New Purchase", path: "/app/purchase" },
        { label: "Supplier Ledger", path: "/app/purchase" },
      ],
      cardBg: "linear-gradient(145deg, #4c1d95 0%, #6d28d9 100%)",
      accentBar: "#a78bfa",
    },
    {
      title: "Sales",
      subtitle: "Billing & POS",
      shortDesc: "Bills · Invoices · Returns",
      path: "/app/sales",
      icon: Receipt,
      actions: [
        { label: "Create Bill", path: "/app/sales" },
        { label: "Bill History", path: "/app/sales" },
      ],
      cardBg: "linear-gradient(145deg, #14532d 0%, #15803d 100%)",
      accentBar: "#4ade80",
    },
    {
      title: "Day Book",
      subtitle: "Daily Accounts",
      shortDesc: "Cash Flow · Petty Cash",
      path: "/app/daybook",
      icon: BookOpen,
      actions: [
        { label: "Log Transaction", path: "/app/daybook" },
        { label: "Export Sheet", path: "/app/daybook" },
      ],
      cardBg: "linear-gradient(145deg, #78350f 0%, #b45309 100%)",
      accentBar: "#fbbf24",
    },
    {
      title: "Quotation",
      subtitle: "Estimates",
      shortDesc: "High-Value · Dispatch",
      path: "/app/quotation",
      icon: FileSpreadsheet,
      actions: [
        { label: "New Quotation", path: "/app/quotation" },
        { label: "Pending Approvals", path: "/app/quotation" },
      ],
      cardBg: "linear-gradient(145deg, #134e4a 0%, #0f766e 100%)",
      accentBar: "#2dd4bf",
    },
  ];

  return (
    <div className="p-6 space-y-6">
      {/* ── Page Header ── */}
      <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-4">
        <div>
          <h1 className="text-page-title font-semibold text-text-primary">
            Welcome back, {ownerName}
          </h1>
          <p className="text-caption text-text-secondary mt-0.5">
            Enterprise overview and transaction console.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Link
            to="/app/sales"
            className="btn-primary flex items-center gap-1.5 shadow-sm"
          >
            <Plus className="w-4 h-4" />
            Generate Invoice
          </Link>
        </div>
      </div>

      {/* ── Executive Summary Metrics ── */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-5">
        {metrics.map((m) => (
          <div
            key={m.title}
            className="rounded-xl bg-white flex flex-col justify-between p-5"
            style={{
              borderLeft: m.borderLeft,
              background: m.bgGradient,
              boxShadow:
                "0 4px 6px -1px rgba(0,0,0,0.08), 0 10px 25px -5px rgba(0,0,0,0.06), 0 0 0 1px rgba(0,0,0,0.04)",
            }}
          >
            <div className="flex items-start justify-between">
              <span className="text-[11px] font-semibold text-gray-600 uppercase tracking-wider">
                {m.title}
              </span>
              <span
                className={`inline-flex items-center gap-0.5 text-caption font-semibold px-1.5 py-0.5 rounded ${
                  m.isPositive
                    ? "bg-green-100 text-green-700"
                    : "bg-red-100 text-red-700"
                }`}
              >
                {m.isPositive ? (
                  <TrendingUp className="w-3 h-3" />
                ) : (
                  <TrendingDown className="w-3 h-3" />
                )}
                {m.trend}
              </span>
            </div>
            <div className="flex items-end justify-between mt-3">
              <span className="text-2xl font-bold text-gray-900">{m.value}</span>
              {/* Micro Sparkline */}
              <div className="w-16 h-9 flex items-end">
                <svg className="w-full h-full" viewBox="0 0 100 40">
                  <polyline
                    fill="none"
                    stroke={m.sparklineColor}
                    strokeWidth="2.5"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    points={m.data
                      .map((val, idx) => `${idx * 11},${40 - val / 2.5}`)
                      .join(" ")}
                  />
                </svg>
              </div>
            </div>
          </div>
        ))}
      </div>

      {/* ── Management Modules Grid ── */}
      <div>
        <h2 className="text-section-title font-semibold text-text-primary mb-4">
          Core Operations Console
        </h2>
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-5 gap-5">
          {modules.map((mod) => {
            const Icon = mod.icon;
            return (
              <div
                key={mod.title}
                className="rounded-xl flex flex-col overflow-hidden"
                style={{
                  background: mod.cardBg,
                  boxShadow:
                    "0 8px 16px -4px rgba(0,0,0,0.25), 0 20px 40px -8px rgba(0,0,0,0.18), 0 0 0 1px rgba(255,255,255,0.08)",
                }}
              >
                {/* Card Header */}
                <div className="p-4 flex-1">
                  {/* Accent bar at top */}
                  <div
                    className="w-8 h-1 rounded-full mb-3"
                    style={{ background: mod.accentBar }}
                  />

                  {/* Icon */}
                  <div
                    className="w-10 h-10 rounded-lg flex items-center justify-center mb-3"
                    style={{ background: "rgba(255,255,255,0.15)" }}
                  >
                    <Icon className="w-5 h-5 text-white" />
                  </div>

                  {/* Title + Subtitle */}
                  <h3 className="text-base font-bold text-white leading-tight">
                    {mod.title}
                  </h3>
                  <p className="text-[11px] font-medium text-white/60 mt-0.5 mb-2">
                    {mod.subtitle}
                  </p>

                  {/* Short description */}
                  <p className="text-[11px] text-white/50 leading-tight">
                    {mod.shortDesc}
                  </p>
                </div>

                {/* Card Footer: Quick Actions */}
                <div
                  className="px-4 py-3 flex flex-col gap-1.5"
                  style={{ background: "rgba(0,0,0,0.2)", borderTop: "1px solid rgba(255,255,255,0.08)" }}
                >
                  {mod.actions.map((act) => (
                    <Link
                      key={act.label}
                      to={act.path}
                      className="flex items-center justify-between group py-0.5 text-[12px] font-semibold text-white/80 hover:text-white transition-colors duration-100"
                    >
                      <span>{act.label}</span>
                      <ArrowUpRight className="w-3 h-3 opacity-50 group-hover:opacity-100 transition-opacity" />
                    </Link>
                  ))}
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}
