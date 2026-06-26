import { useState } from "react";
import {
  Building2,
  MapPin,
  User,
  Landmark,
  FileText,
  Hash,
  Printer,
  Download,
  BadgeCheck,
  Loader2,
} from "lucide-react";
import { useAuthStore } from "@/stores/authStore";
import { resolveBusinessDetails } from "@/lib/businessDetails";
import { printBusinessProfile } from "@/lib/businessProfileDoc";
import { ProfileAvatar, downloadProprietorPhoto, PROPRIETOR_PHOTO_URL } from "@/components/ProfileAvatar";

function DetailRow({
  label,
  value,
  mono = false,
}: {
  label: string;
  value: string;
  mono?: boolean;
}) {
  return (
    <div className="flex flex-col items-center sm:flex-row sm:items-start gap-1 sm:gap-4 py-3 border-b border-slate-100 last:border-0 text-center sm:text-left">
      <dt className="text-[11px] font-bold uppercase tracking-wider text-slate-400 sm:w-44 shrink-0">
        {label}
      </dt>
      <dd className={`text-sm text-slate-900 font-medium break-words ${mono ? "font-mono" : ""}`}>
        {value || "—"}
      </dd>
    </div>
  );
}

function SectionCard({
  title,
  icon: Icon,
  children,
}: {
  title: string;
  icon: React.ComponentType<{ className?: string }>;
  children: React.ReactNode;
}) {
  return (
    <section className="bg-white border border-border rounded-xl shadow-card overflow-hidden w-full">
      <div className="px-5 py-3.5 border-b border-border bg-slate-50/80 flex items-center justify-center sm:justify-start gap-2">
        <Icon className="w-4 h-4 text-primary" />
        <h2 className="text-xs font-bold uppercase tracking-wider text-slate-600">{title}</h2>
      </div>
      <dl className="px-5 py-1">{children}</dl>
    </section>
  );
}

export default function BusinessDetailsPage() {
  const { user } = useAuthStore();
  const business = resolveBusinessDetails(user);
  const [printBusy, setPrintBusy] = useState(false);

  const handlePrint = async () => {
    setPrintBusy(true);
    try {
      await printBusinessProfile(business, PROPRIETOR_PHOTO_URL);
    } catch (err) {
      alert(err instanceof Error ? err.message : "Print failed.");
    } finally {
      setPrintBusy(false);
    }
  };

  const photoFilename = `${business.ownerName.replace(/\s+/g, "-").toLowerCase()}-proprietor.png`;

  return (
    <div className="min-h-full flex justify-center px-4 py-6 sm:px-6">
      <div className="w-full max-w-3xl space-y-6">
        <div className="text-center space-y-4">
          <div>
            <h1 className="text-page-title font-semibold text-text-primary flex items-center justify-center gap-2">
              <Building2 className="w-6 h-6 text-primary" />
              My Business Details
            </h1>
            <p className="text-caption text-text-secondary mt-1 max-w-xl mx-auto">
              Registered store profile used on bills, statements, and tax documents.
            </p>
          </div>
          <button
            type="button"
            onClick={() => void handlePrint()}
            disabled={printBusy}
            className="btn-secondary px-4 py-2 text-xs font-semibold inline-flex items-center gap-2"
          >
            {printBusy ? (
              <>
                <Loader2 className="w-4 h-4 animate-spin" />
                Preparing…
              </>
            ) : (
              <>
                <Printer className="w-4 h-4" />
                Print Profile
              </>
            )}
          </button>
        </div>

        <div className="bg-white border border-border rounded-2xl shadow-card overflow-hidden w-full">
          <div className="bg-gradient-to-b from-primary/10 via-primary/5 to-transparent px-6 py-8 border-b border-border">
            <div className="flex flex-col items-center text-center gap-6">
              <div className="flex flex-col items-center gap-3">
                <div className="relative">
                  <ProfileAvatar
                    className="w-36 h-44 rounded-2xl ring-4 ring-white shadow-lg"
                    alt={business.ownerName}
                  />
                  <span className="absolute -bottom-2 left-1/2 -translate-x-1/2 bg-primary text-white text-[10px] font-bold uppercase tracking-wide px-2.5 py-0.5 rounded-full shadow">
                    Proprietor
                  </span>
                </div>
                <button
                  type="button"
                  onClick={() => downloadProprietorPhoto(photoFilename)}
                  className="text-xs font-semibold text-primary hover:text-primary-600 inline-flex items-center gap-1.5 transition-colors"
                >
                  <Download className="w-3.5 h-3.5" />
                  Download Photo
                </button>
              </div>

              <div className="w-full max-w-lg">
                <p className="text-[10px] font-bold uppercase tracking-widest text-primary mb-1">
                  Registered Business
                </p>
                <h2 className="text-2xl font-bold text-slate-900 tracking-tight leading-tight">
                  {business.storeDisplayName}
                </h2>
                <p className="text-sm text-slate-600 mt-2">{business.businessType}</p>

                <div className="mt-5 grid grid-cols-1 sm:grid-cols-2 gap-4 text-sm text-left">
                  <div className="flex items-start gap-2 text-slate-700 bg-white/60 rounded-lg p-3 border border-slate-100">
                    <User className="w-4 h-4 text-slate-400 mt-0.5 shrink-0" />
                    <div>
                      <p className="text-[10px] font-bold uppercase text-slate-400">Proprietor</p>
                      <p className="font-semibold">{business.ownerName}</p>
                    </div>
                  </div>
                  <div className="flex items-start gap-2 text-slate-700 bg-white/60 rounded-lg p-3 border border-slate-100">
                    <MapPin className="w-4 h-4 text-slate-400 mt-0.5 shrink-0" />
                    <div>
                      <p className="text-[10px] font-bold uppercase text-slate-400">Address</p>
                      <p className="font-medium leading-snug">{business.address}</p>
                    </div>
                  </div>
                </div>
              </div>
            </div>
          </div>

          <div className="grid grid-cols-2 sm:grid-cols-4 divide-x divide-border border-b border-border bg-slate-50/50">
            {[
              { label: "GSTIN", value: business.gstin },
              { label: "PAN", value: business.pan },
              { label: "Phone", value: business.phone },
              { label: "Udyam No.", value: business.udyamNumber },
            ].map((item) => (
              <div key={item.label} className="px-3 py-3 text-center">
                <p className="text-[10px] font-bold uppercase tracking-wider text-slate-400">{item.label}</p>
                <p className="text-[11px] font-mono font-semibold text-slate-800 mt-0.5 break-all leading-snug">
                  {item.value}
                </p>
              </div>
            ))}
          </div>
        </div>

        <div className="grid grid-cols-1 gap-5">
          <SectionCard title="Owner & Contact" icon={User}>
            <DetailRow label="Proprietor / Owner" value={business.ownerName} />
            <DetailRow label="Phone" value={business.phone} mono />
            <DetailRow label="Email" value={business.email} />
          </SectionCard>

          <SectionCard title="Tax & Registration" icon={FileText}>
            <DetailRow label="GSTIN" value={business.gstin} mono />
            <DetailRow label="PAN" value={business.pan} mono />
            <DetailRow label="State" value={`${business.state} (${business.stateCode})`} />
          </SectionCard>

          <SectionCard title="Udyam / MSME" icon={BadgeCheck}>
            <DetailRow label="Udyam Registration No." value={business.udyamNumber} mono />
            <DetailRow label="Registration Date" value={business.udyamRegistrationDate} />
            <DetailRow label="Enterprise Type" value={business.udyamEnterpriseType} />
            <DetailRow label="Major Activity" value={business.udyamMajorActivity} />
            <DetailRow label="NIC Code" value={business.udyamNicCode} mono />
          </SectionCard>

          <SectionCard title="Store Identity" icon={Hash}>
            <DetailRow label="Store Name" value={business.storeName} />
            <DetailRow label="Business Type" value={business.businessType} />
            <DetailRow label="Address" value={business.address} />
          </SectionCard>

          <SectionCard title="Bank Details" icon={Landmark}>
            <DetailRow label="Bank" value={business.bankName} />
            <DetailRow label="Account No." value={business.accountNo} mono />
            <DetailRow label="IFSC" value={business.ifsc} mono />
            <DetailRow label="Branch" value={business.branch} />
          </SectionCard>
        </div>

        <p className="text-[11px] text-slate-400 leading-relaxed text-center max-w-lg mx-auto">
          Profile details are loaded from your account registration and store defaults. Use{" "}
          <strong className="font-semibold text-slate-500">Print Profile</strong> for a printable sheet with
          proprietor photo, GST, Udyam, and bank information.
        </p>
      </div>
    </div>
  );
}
