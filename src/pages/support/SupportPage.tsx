import { LifeBuoy } from "lucide-react";

export default function SupportPage() {
  return (
    <div className="p-6 max-w-2xl mx-auto">
      <div className="rounded-xl border border-border bg-white shadow-card p-8 text-center">
        <div className="inline-flex items-center justify-center w-12 h-12 rounded-xl bg-primary/10 text-primary mb-4">
          <LifeBuoy className="w-6 h-6" />
        </div>
        <h1 className="text-page-title font-semibold text-text-primary">Support</h1>
        <p className="text-sm text-text-secondary mt-2 leading-relaxed">
          Help desk, contact options, and store support tools will be available here in a future update.
        </p>
        <span className="inline-block mt-4 text-[11px] font-bold uppercase tracking-wider text-amber-700 bg-amber-50 border border-amber-200 px-2.5 py-1 rounded-full">
          Coming Soon
        </span>
      </div>
    </div>
  );
}
