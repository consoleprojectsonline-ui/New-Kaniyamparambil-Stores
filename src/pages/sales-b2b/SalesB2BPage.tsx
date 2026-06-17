import { Link } from "react-router-dom";
import {
  Building2,
  Receipt,
  Users,
  FileText,
  Truck,
  CreditCard,
  ArrowLeft,
  Sparkles,
} from "lucide-react";

const PLANNED_FEATURES = [
  {
    icon: Receipt,
    title: "GST Tax Invoices",
    description: "B2B bills with buyer GSTIN, HSN breakdown, and e-invoice ready formats.",
  },
  {
    icon: Users,
    title: "Business Customers",
    description: "Maintain GST-registered buyers, branches, and contact details in one place.",
  },
  {
    icon: FileText,
    title: "Bulk & Repeat Orders",
    description: "Faster billing for wholesalers, contractors, and regular trade accounts.",
  },
  {
    icon: Truck,
    title: "Delivery & Godown",
    description: "Ship-to addresses, vehicle details, and branch-wise dispatch notes.",
  },
  {
    icon: CreditCard,
    title: "Credit & Collections",
    description: "Payment terms, partial receipts, and outstanding tracking per business.",
  },
];

export default function SalesB2BPage() {
  return (
    <div className="p-6 max-w-5xl mx-auto space-y-8">
      <Link
        to="/app/dashboard"
        className="inline-flex items-center gap-1.5 text-xs font-medium text-text-secondary hover:text-primary transition-colors"
      >
        <ArrowLeft className="w-3.5 h-3.5" />
        Back to Dashboard
      </Link>

      <div className="relative overflow-hidden rounded-2xl border border-border bg-white shadow-card">
        <div
          className="absolute inset-0 opacity-[0.07]"
          style={{
            background: "linear-gradient(135deg, #0F4C81 0%, #16a34a 50%, #7c3aed 100%)",
          }}
        />
        <div className="relative px-6 py-10 sm:px-10 sm:py-12 text-center">
          <div className="inline-flex items-center justify-center w-14 h-14 rounded-2xl bg-primary/10 text-primary mb-5">
            <Building2 className="w-7 h-7" />
          </div>
          <span className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-[11px] font-bold uppercase tracking-wider bg-amber-100 text-amber-800 border border-amber-200 mb-4">
            <Sparkles className="w-3.5 h-3.5" />
            Coming Soon
          </span>
          <h1 className="text-2xl sm:text-3xl font-bold text-text-primary tracking-tight">
            Sales B2B
          </h1>
          <p className="text-sm text-text-secondary mt-3 max-w-2xl mx-auto leading-relaxed">
            A dedicated module for selling to GST-registered businesses — wholesalers, contractors,
            and trade buyers. Tax invoices, buyer GSTIN, credit terms, and bulk billing will be
            available here.
          </p>
          <p className="text-xs text-slate-400 mt-4">
            Continue using <Link to="/app/sales" className="text-primary font-semibold hover:underline">Retail Sales</Link> for walk-in and regular billing until this module launches.
          </p>
        </div>
      </div>

      <div>
        <h2 className="text-section-title font-semibold text-text-primary mb-1">Planned for launch</h2>
        <p className="text-caption text-text-secondary mb-4">
          These B2B capabilities are on the roadmap and will be added in upcoming updates.
        </p>
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
          {PLANNED_FEATURES.map(({ icon: Icon, title, description }) => (
            <div
              key={title}
              className="rounded-xl border border-dashed border-slate-200 bg-slate-50/80 p-4 opacity-90"
            >
              <div className="flex items-start gap-3">
                <div className="w-9 h-9 rounded-lg bg-white border border-slate-200 flex items-center justify-center shrink-0 text-slate-500">
                  <Icon className="w-4 h-4" />
                </div>
                <div className="min-w-0">
                  <div className="flex items-center gap-2 flex-wrap">
                    <h3 className="text-sm font-semibold text-slate-800">{title}</h3>
                    <span className="text-[9px] font-bold uppercase tracking-wide text-slate-400 bg-white px-1.5 py-0.5 rounded border border-slate-200">
                      Soon
                    </span>
                  </div>
                  <p className="text-xs text-text-secondary mt-1 leading-relaxed">{description}</p>
                </div>
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
