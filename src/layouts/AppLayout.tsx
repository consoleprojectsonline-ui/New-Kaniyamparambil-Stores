import { useState, useEffect, useRef } from "react";
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
  Store,
  Building2,
  LifeBuoy,
  CreditCard,
  ChevronDown,
} from "lucide-react";
import { useAuthStore } from "@/stores/authStore";
import { cn } from "@/lib/utils";

// Sub-pages
import DashboardPage from "@/pages/dashboard/DashboardPage";
import InventoryPage from "@/pages/inventory/InventoryPage";
import PurchasePage from "@/pages/purchase/PurchasePage";
import SalesPage from "@/pages/sales/SalesPage";
import DayBookPage from "@/pages/daybook/DayBookPage";
import QuotationPage from "@/pages/quotation/QuotationPage";
import SalesB2BPage from "@/pages/sales-b2b/SalesB2BPage";
import SupportPage from "@/pages/support/SupportPage";
import PaymentPage from "@/pages/payment/PaymentPage";
import BusinessDetailsPage from "@/pages/business/BusinessDetailsPage";
import { ProfileAvatar } from "@/components/ProfileAvatar";
import { UtilitiesLauncher } from "@/components/utilities/UtilitiesLauncher";

export default function AppLayout() {
  const { user, logout, loading } = useAuthStore();
  const navigate = useNavigate();
  const location = useLocation();
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [profileMenuOpen, setProfileMenuOpen] = useState(false);
  const profileMenuRef = useRef<HTMLDivElement>(null);

  // Auto-close sidebar on route change (for mobile)
  useEffect(() => {
    const timer = setTimeout(() => {
      setSidebarOpen(false);
    }, 0);
    return () => clearTimeout(timer);
  }, [location.pathname]);

  useEffect(() => {
    setProfileMenuOpen(false);
  }, [location.pathname]);

  useEffect(() => {
    if (!profileMenuOpen) return;
    const onPointerDown = (event: MouseEvent) => {
      if (profileMenuRef.current && !profileMenuRef.current.contains(event.target as Node)) {
        setProfileMenuOpen(false);
      }
    };
    document.addEventListener("mousedown", onPointerDown);
    return () => document.removeEventListener("mousedown", onPointerDown);
  }, [profileMenuOpen]);

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
    { name: "Dashboard",  path: "/app/dashboard",  icon: LayoutDashboard },
    { name: "Inventory",  path: "/app/inventory",  icon: Boxes },
    { name: "Sales",      path: "/app/sales",      icon: Receipt },
    { name: "Sales B2B",  path: "/app/sales-b2b",  icon: Building2 },
    { name: "Day Book",   path: "/app/daybook",    icon: BookOpen },
    { name: "Quotation",  path: "/app/quotation",  icon: FileSpreadsheet },
    { name: "Purchase",   path: "/app/purchase",   icon: ShoppingCart },
    { name: "Payment",    path: "/app/payment",    icon: CreditCard },
    { name: "Support",    path: "/app/support",    icon: LifeBuoy },
  ];

  const headerNavigation = navigation.filter((item) => item.name !== "Payment");

  const handleLogout = async () => {
    await logout();
    navigate("/login");
  };

  const sidebarBody = () => (
    <>
      <div>
        <div className="h-16 border-b border-border flex items-center justify-between px-5">
          <div className="flex items-center gap-2.5 min-w-0">
            <div className="w-8 h-8 rounded bg-primary flex items-center justify-center shrink-0">
              <Store className="w-4 h-4 text-white" />
            </div>
            <span className="font-semibold text-text-primary text-sm tracking-tight truncate">
              {storeName}
            </span>
          </div>
          <button
            onClick={() => setSidebarOpen(false)}
            className="text-text-secondary hover:text-text-primary transition-colors"
            aria-label="Close menu"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

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
                    : "text-text-secondary hover:bg-gray-50 hover:text-text-primary",
                )}
              >
                <Icon className={cn("w-5 h-5", active ? "text-primary" : "text-text-secondary")} />
                <span>{item.name}</span>
              </Link>
            );
          })}
        </nav>
      </div>

      <div className="p-4 border-t border-border bg-gray-50/50">
        <div className="flex items-center gap-3 mb-4">
          <ProfileAvatar
            className="w-9 h-9"
            alt={user?.user_metadata?.owner_name || "Proprietor"}
          />
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
    </>
  );

  return (
    <div className="flex w-full h-screen overflow-hidden bg-background">
      {/* Overlay sidebar — hidden by default, floats above all UI */}
      {sidebarOpen && (
        <div
          onClick={() => setSidebarOpen(false)}
          className="fixed inset-0 z-[90] bg-black/20 backdrop-blur-sm"
          aria-hidden="true"
        />
      )}

      <aside
        className={cn(
          "fixed inset-y-0 left-0 z-[100] w-[260px] bg-white border-r border-border flex flex-col justify-between shadow-xl transition-transform duration-200",
          sidebarOpen ? "translate-x-0" : "-translate-x-full pointer-events-none",
        )}
        aria-hidden={!sidebarOpen}
      >
        {sidebarBody()}
      </aside>

      {/* Main content — full width, unaffected by sidebar */}
      <div className="flex-1 flex flex-col h-full overflow-hidden min-w-0 w-full">
        <header className="h-14 bg-white border-b border-border grid grid-cols-[1fr_auto_1fr] items-center px-4 lg:px-6 sticky top-0 z-10 shrink-0">
          <div className="flex items-center">
            <button
              onClick={() => setSidebarOpen(true)}
              className="text-text-secondary"
              aria-label="Open menu"
            >
              <Menu className="w-5 h-5" />
            </button>
          </div>

          <nav className="flex items-center justify-center gap-5 overflow-x-auto max-w-full">
            {headerNavigation.map((item) => {
              const active = location.pathname === item.path;
              return (
                <Link
                  key={item.path}
                  to={item.path}
                  className={cn(
                    "text-xs font-medium whitespace-nowrap shrink-0",
                    active ? "text-primary" : "text-text-secondary",
                  )}
                >
                  {item.name}
                </Link>
              );
            })}
          </nav>

          <div className="relative flex items-center justify-end gap-2" ref={profileMenuRef}>
            <button
              type="button"
              onClick={() => setProfileMenuOpen((open) => !open)}
              className={cn(
                "flex items-center gap-1.5 rounded-full pl-1 pr-2 py-1 transition-colors",
                profileMenuOpen ? "bg-slate-100" : "hover:bg-slate-50",
              )}
              aria-expanded={profileMenuOpen}
              aria-haspopup="menu"
              aria-label="Account menu"
            >
              <ProfileAvatar
                className="w-8 h-8"
                alt={user?.user_metadata?.owner_name || "Proprietor"}
              />
              <ChevronDown className={cn("w-3.5 h-3.5 text-text-secondary transition-transform", profileMenuOpen && "rotate-180")} />
            </button>

            {profileMenuOpen && (
              <div
                role="menu"
                className="absolute top-full right-0 mt-2 w-56 bg-white border border-border rounded-lg shadow-lg py-1 z-20 animate-in fade-in zoom-in-95 duration-100"
              >
                <div className="px-3 py-2.5 border-b border-border flex items-center gap-2.5">
                  <ProfileAvatar className="w-9 h-9" alt={user?.user_metadata?.owner_name || "Proprietor"} />
                  <div className="min-w-0">
                    <p className="text-xs font-semibold text-text-primary truncate">
                      {user?.user_metadata?.owner_name || "Manager"}
                    </p>
                    <p className="text-[10px] text-text-secondary truncate">{user.email}</p>
                  </div>
                </div>
                <Link
                  to="/app/business"
                  role="menuitem"
                  className={cn(
                    "flex items-center gap-2 px-3 py-2.5 text-sm transition-colors",
                    location.pathname === "/app/business"
                      ? "bg-primary/5 text-primary font-medium"
                      : "text-text-secondary hover:bg-gray-50 hover:text-text-primary",
                  )}
                  onClick={() => setProfileMenuOpen(false)}
                >
                  <Building2 className="w-4 h-4" />
                  My Business Details
                </Link>
                <button
                  type="button"
                  role="menuitem"
                  onClick={() => {
                    setProfileMenuOpen(false);
                    void handleLogout();
                  }}
                  className="w-full flex items-center gap-2 px-3 py-2.5 text-sm text-red-600 hover:bg-red-50 transition-colors"
                >
                  <LogOut className="w-4 h-4" />
                  Sign Out
                </button>
              </div>
            )}
          </div>
        </header>

        {/* Content body */}
        <main className="flex-1 overflow-y-auto">
          <Routes>
            <Route path="dashboard" element={<DashboardPage />} />
            <Route path="inventory" element={<InventoryPage />} />
            <Route path="purchase"  element={<PurchasePage />} />
            <Route path="sales"     element={<SalesPage />} />
            <Route path="sales-b2b" element={<SalesB2BPage />} />
            <Route path="daybook"   element={<DayBookPage />} />
            <Route path="quotation" element={<QuotationPage />} />
            <Route path="payment"   element={<PaymentPage />} />
            <Route path="support"   element={<SupportPage />} />
            <Route path="business"  element={<BusinessDetailsPage />} />
            <Route path="*"         element={<Navigate to="dashboard" replace />} />
          </Routes>
        </main>
      </div>

      <UtilitiesLauncher />
    </div>
  );
}
