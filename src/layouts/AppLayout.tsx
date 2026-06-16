import { useState, useEffect } from "react";
import { Link, useNavigate, useLocation, Routes, Route, Navigate } from "react-router-dom";
import {
  Menu,
  X,
  LayoutDashboard,
  Boxes,
  ShoppingCart,
  Receipt,
  BookOpen,
  FileSpreadsheet,
  LogOut,
  ChevronRight,
  Store,
} from "lucide-react";
import { useAuthStore } from "@/stores/authStore";
import { cn } from "@/lib/utils";

// Sub-pages placeholders
import DashboardPage from "@/pages/dashboard/DashboardPage";

// Temporary component placeholders for other screens
function PlaceholderPage({ title }: { title: string }) {
  return (
    <div className="p-6 bg-background h-full">
      <div className="bg-white rounded border border-border p-8 shadow-card">
        <h1 className="text-page-title font-semibold text-text-primary mb-2">{title}</h1>
        <p className="text-text-secondary text-sm">This module is under construction.</p>
      </div>
    </div>
  );
}

export default function AppLayout() {
  const { user, logout, loading } = useAuthStore();
  const navigate = useNavigate();
  const location = useLocation();
  const [sidebarOpen, setSidebarOpen] = useState(false);

  // Auto-close sidebar on route change (for mobile)
  useEffect(() => {
    setSidebarOpen(false);
  }, [location.pathname]);

  // Protect route
  useEffect(() => {
    if (!loading && !user) {
      navigate("/login");
    }
  }, [user, loading, navigate]);

  if (loading || !user) {
    return (
      <div className="flex items-center justify-center h-screen bg-background">
        <svg className="w-8 h-8 animate-spin text-primary" fill="none" viewBox="0 0 24 24">
          <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
          <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
        </svg>
      </div>
    );
  }

  const storeName = user?.user_metadata?.store_name || "New Kaniyamparambil Stores";

  const navigation = [
    { name: "Dashboard",        path: "/app/dashboard",  icon: LayoutDashboard },
    { name: "Inventory (Items)", path: "/app/inventory",  icon: Boxes },
    { name: "Purchase Details",  path: "/app/purchase",   icon: ShoppingCart },
    { name: "Sales (Billing)",   path: "/app/sales",      icon: Receipt },
    { name: "Day Book",          path: "/app/daybook",    icon: BookOpen },
    { name: "Quotations",        path: "/app/quotation",  icon: FileSpreadsheet },
  ];

  const handleLogout = async () => {
    await logout();
    navigate("/login");
  };

  return (
    <div className="flex w-full h-screen overflow-hidden bg-background">
      {/* ── SIDEBAR ────────────────────────────────────────────────────── */}
      <div
        className={cn(
          "fixed inset-y-0 left-0 z-40 w-[260px] bg-white border-r border-border flex flex-col justify-between transition-transform duration-200 shadow-sidebar",
          sidebarOpen ? "translate-x-0" : "-translate-x-full"
        )}
      >
        <div>
          {/* Header/Logo */}
          <div className="h-16 border-b border-border flex items-center justify-between px-5">
            <div className="flex items-center gap-2.5">
              <div className="w-7 h-7 rounded bg-primary flex items-center justify-center">
                <Store className="w-4 h-4 text-white" />
              </div>
              <span className="font-semibold text-text-primary text-sm tracking-tight truncate max-w-[170px]">
                {storeName}
              </span>
            </div>
            <button
              onClick={() => setSidebarOpen(false)}
              className="text-text-secondary hover:text-text-primary transition-colors"
            >
              <X className="w-5 h-5" />
            </button>
          </div>

          {/* Navigation Links */}
          <nav className="p-3 space-y-1">
            {navigation.map((item) => {
              const active = location.pathname === item.path;
              const Icon = item.icon;
              return (
                <Link
                  key={item.name}
                  to={item.path}
                  className={cn(
                    "nav-item flex items-center gap-3 px-3 py-2.5 text-sm rounded transition-all duration-150",
                    active
                      ? "bg-primary/5 text-primary active-nav-indicator font-semibold"
                      : "text-text-secondary hover:bg-gray-50 hover:text-text-primary"
                  )}
                >
                  <Icon className={cn("w-4.5 h-4.5", active ? "text-primary" : "text-text-secondary")} />
                  <span>{item.name}</span>
                </Link>
              );
            })}
          </nav>
        </div>

        {/* Footer info & Logout */}
        <div className="p-4 border-t border-border bg-gray-50/50">
          <div className="flex items-center gap-3 mb-4">
            <div className="w-9 h-9 rounded-full bg-primary-100 flex items-center justify-center text-primary font-semibold text-sm">
              {user.email?.[0].toUpperCase()}
            </div>
            <div className="flex-1 min-w-0">
              <p className="text-sm font-medium text-text-primary truncate">
                {user?.user_metadata?.owner_name || "Manager"}
              </p>
              <p className="text-caption text-text-secondary truncate">{user.email}</p>
            </div>
          </div>

          <button
            onClick={handleLogout}
            className="w-full flex items-center justify-center gap-2 px-3 py-2 text-sm font-medium text-red-600 bg-white border border-red-200 rounded hover:bg-red-50 active:bg-red-100 transition-all duration-150"
          >
            <LogOut className="w-4 h-4" />
            Sign Out
          </button>
        </div>
      </div>

      {/* ── BACKDROP ────────────────────────────────────────────────────── */}
      {sidebarOpen && (
        <div
          onClick={() => setSidebarOpen(false)}
          className="fixed inset-0 z-30 bg-black/20 backdrop-blur-sm"
        />
      )}

      {/* ── MAIN CONTENT CONTAINER ─────────────────────────────────────── */}
      <div className="flex-1 flex flex-col h-full overflow-hidden">
        {/* Header bar */}
        <header className="h-16 bg-white border-b border-border flex items-center justify-between px-6 sticky top-0 z-20">
          <div className="flex items-center gap-4">
            <button
              onClick={() => setSidebarOpen(!sidebarOpen)}
              className="text-text-secondary hover:text-text-primary transition-colors focus:outline-none"
              aria-label="Toggle Menu"
            >
              <Menu className="w-5 h-5" />
            </button>

            {/* Breadcrumb / Section Name */}
            <div className="flex items-center gap-1.5 text-caption text-text-secondary">
              <span>Enterprise Console</span>
              <ChevronRight className="w-3.5 h-3.5" />
              <span className="font-semibold text-text-primary">
                {navigation.find((item) => item.path === location.pathname)?.name || "System"}
              </span>
            </div>
          </div>

          {/* Right side actions */}
          <div className="flex items-center gap-4">
            <div className="w-8 h-8 rounded-full bg-primary flex items-center justify-center text-white font-medium text-xs">
              {user.email?.[0].toUpperCase()}
            </div>
          </div>
        </header>

        {/* Content body */}
        <main className="flex-1 overflow-y-auto">
          <Routes>
            <Route path="dashboard" element={<DashboardPage />} />
            <Route path="inventory" element={<PlaceholderPage title="Inventory (Items)" />} />
            <Route path="purchase"  element={<PlaceholderPage title="Purchase Details" />} />
            <Route path="sales"     element={<PlaceholderPage title="Sales & Billing" />} />
            <Route path="daybook"   element={<PlaceholderPage title="Day Book" />} />
            <Route path="quotation" element={<PlaceholderPage title="Quotation Management" />} />
            <Route path="*"         element={<Navigate to="dashboard" replace />} />
          </Routes>
        </main>
      </div>
    </div>
  );
}
