import {
  CreditCard,
  QrCode,
  Receipt,
  Smartphone,
  ShieldCheck,
} from "lucide-react";
import upiQrUrl from "@/assets/upi-qr.png";
import { formatCurrency } from "@/lib/utils";
import { useAuthStore } from "@/stores/authStore";

const EXPENSE_PAYMENT_AMOUNT = 12_500;

export default function PaymentPage() {
  const { user } = useAuthStore();
  const storeName = user?.user_metadata?.store_name || "Kaniyamparambil Stores";

  return (
    <div className="p-4 sm:p-6 lg:p-8 max-w-5xl mx-auto">
      <div className="mb-6">
        <div className="flex items-center gap-3 mb-1">
          <div className="inline-flex items-center justify-center w-10 h-10 rounded-xl bg-primary/10 text-primary">
            <CreditCard className="w-5 h-5" />
          </div>
          <div>
            <h1 className="text-page-title font-semibold text-text-primary">Payment</h1>
            <p className="text-sm text-text-secondary">
              UPI payment for store expenses — scan the QR code below to pay.
            </p>
          </div>
        </div>
      </div>

      <div className="grid gap-6 lg:grid-cols-[1fr_320px]">
        {/* Main QR card */}
        <div className="rounded-2xl border border-border bg-white shadow-card overflow-hidden">
          <div className="bg-gradient-to-br from-primary/90 via-primary to-primary-700 px-6 py-5 text-white">
            <p className="text-[11px] font-bold uppercase tracking-widest text-white/80 mb-1">
              Expense Settlement
            </p>
            <p className="text-lg font-semibold">{storeName}</p>
            <p className="text-sm text-white/85 mt-1">
              Pay all expense dues in one UPI transfer
            </p>
          </div>

          <div className="px-6 py-8 flex flex-col items-center">
            <div className="inline-flex items-center gap-2 rounded-full bg-amber-50 border border-amber-200 px-3 py-1.5 mb-6">
              <Receipt className="w-3.5 h-3.5 text-amber-700" />
              <span className="text-[11px] font-bold uppercase tracking-wider text-amber-800">
                All Expense · Single Payment
              </span>
            </div>

            <div className="relative mb-6">
              <div className="absolute -inset-3 rounded-2xl bg-gradient-to-br from-primary/5 to-primary/10" />
              <div className="relative rounded-xl border-2 border-slate-100 bg-white p-4 shadow-sm">
                <img
                  src={upiQrUrl}
                  alt="UPI QR code for expense payment"
                  className="w-56 h-56 sm:w-64 sm:h-64 object-contain"
                />
              </div>
            </div>

            <div className="flex items-center gap-2 text-text-secondary mb-2">
              <QrCode className="w-4 h-4" />
              <span className="text-sm font-medium">Scan to Pay via UPI</span>
            </div>

            <div className="mt-1">
              <span className="text-4xl sm:text-5xl font-bold font-mono text-text-primary tracking-tight">
                {formatCurrency(EXPENSE_PAYMENT_AMOUNT)}
              </span>
            </div>
            <p className="text-xs text-text-secondary mt-2">
              Total amount for all expense payments
            </p>
          </div>

          <div className="border-t border-border bg-slate-50/80 px-6 py-4">
            <div className="flex flex-wrap items-center justify-center gap-x-6 gap-y-2 text-xs text-text-secondary">
              <span className="inline-flex items-center gap-1.5">
                <Smartphone className="w-3.5 h-3.5 text-primary" />
                Google Pay · PhonePe · Paytm
              </span>
              <span className="inline-flex items-center gap-1.5">
                <ShieldCheck className="w-3.5 h-3.5 text-green-600" />
                Secure UPI transfer
              </span>
            </div>
          </div>
        </div>

        {/* Side panel */}
        <div className="space-y-4">
          <div className="rounded-xl border border-border bg-white shadow-card p-5">
            <p className="text-[10px] font-bold uppercase tracking-wider text-text-secondary mb-3">
              Payment Summary
            </p>
            <dl className="space-y-3 text-sm">
              <div className="flex justify-between gap-4">
                <dt className="text-text-secondary">Category</dt>
                <dd className="font-semibold text-text-primary text-right">All Expense</dd>
              </div>
              <div className="flex justify-between gap-4">
                <dt className="text-text-secondary">Payment mode</dt>
                <dd className="font-semibold text-text-primary text-right">UPI</dd>
              </div>
              <div className="flex justify-between gap-4 pt-3 border-t border-border">
                <dt className="font-semibold text-text-primary">Amount due</dt>
                <dd className="font-bold font-mono text-primary text-lg">
                  {formatCurrency(EXPENSE_PAYMENT_AMOUNT)}
                </dd>
              </div>
            </dl>
          </div>

          <div className="rounded-xl border border-blue-100 bg-blue-50/60 p-5">
            <p className="text-sm font-semibold text-blue-900 mb-2">How to pay</p>
            <ol className="text-xs text-blue-800/90 space-y-2 list-decimal list-inside leading-relaxed">
              <li>Open any UPI app on your phone</li>
              <li>Tap Scan QR and point at the code</li>
              <li>Confirm the amount is {formatCurrency(EXPENSE_PAYMENT_AMOUNT)}</li>
              <li>Complete the payment for expense settlement</li>
            </ol>
          </div>

          <div className="rounded-xl border border-border bg-white shadow-card p-5">
            <p className="text-[10px] font-bold uppercase tracking-wider text-text-secondary mb-2">
              Note
            </p>
            <p className="text-xs text-text-secondary leading-relaxed">
              This QR is for settling all store expense payments. After paying, record the
              transaction in Day Book under Expense with UPI as the payment mode.
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}
