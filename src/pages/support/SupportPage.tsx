import { useState, useEffect, useCallback } from "react";
import {
  LifeBuoy,
  Bug,
  FileText,
  IndianRupee,
  PackageX,
  FileWarning,
  Lightbulb,
  Send,
  Database,
  Check,
  AlertTriangle,
  Clock,
  Loader2,
  MoreHorizontal,
  Eye,
  X,
} from "lucide-react";
import { supabase } from "@/lib/supabase";
import { useAuthStore } from "@/stores/authStore";
import { formatTableDate } from "@/lib/utils";
import { cn } from "@/lib/utils";

const LOCAL_STORAGE_KEY = "kaniyamparambil_support_requests";

type RequestKind = "issue" | "feature";
type SupportStatus = "Open" | "In Progress" | "Resolved" | "Closed";

export interface SupportRequest {
  id: string;
  request_kind: RequestKind;
  category: string;
  module: string;
  subject: string;
  description: string;
  reference_no?: string;
  priority: string;
  status: SupportStatus;
  reporter_name?: string;
  reporter_email?: string;
  created_at: string;
}

const ISSUE_CATEGORIES = [
  { value: "Bug", label: "Software Bug", icon: Bug, tone: "red" },
  { value: "Bill Issue", label: "Bill / Invoice Issue", icon: FileText, tone: "blue" },
  { value: "Amount Issue", label: "Amount / Total Mismatch", icon: IndianRupee, tone: "amber" },
  { value: "Item Missing", label: "Item Missing or Wrong", icon: PackageX, tone: "violet" },
  { value: "PDF Issue", label: "PDF / Print Issue", icon: FileWarning, tone: "cyan" },
  { value: "Other", label: "Other Issue", icon: MoreHorizontal, tone: "slate" },
] as const;

type IssueTone = (typeof ISSUE_CATEGORIES)[number]["tone"];

function issueCategoryClasses(tone: IssueTone, selected: boolean): string {
  const map: Record<IssueTone, { idle: string; active: string }> = {
    red: {
      idle: "border-red-200 bg-red-50/50 text-red-800 hover:border-red-300 hover:bg-red-50",
      active: "border-red-500 bg-red-100 text-red-900 shadow-sm ring-2 ring-red-200/80",
    },
    blue: {
      idle: "border-blue-200 bg-blue-50/50 text-blue-800 hover:border-blue-300 hover:bg-blue-50",
      active: "border-blue-500 bg-blue-100 text-blue-900 shadow-sm ring-2 ring-blue-200/80",
    },
    amber: {
      idle: "border-amber-200 bg-amber-50/50 text-amber-900 hover:border-amber-300 hover:bg-amber-50",
      active: "border-amber-500 bg-amber-100 text-amber-950 shadow-sm ring-2 ring-amber-200/80",
    },
    violet: {
      idle: "border-violet-200 bg-violet-50/50 text-violet-800 hover:border-violet-300 hover:bg-violet-50",
      active: "border-violet-500 bg-violet-100 text-violet-900 shadow-sm ring-2 ring-violet-200/80",
    },
    cyan: {
      idle: "border-cyan-200 bg-cyan-50/50 text-cyan-800 hover:border-cyan-300 hover:bg-cyan-50",
      active: "border-cyan-500 bg-cyan-100 text-cyan-900 shadow-sm ring-2 ring-cyan-200/80",
    },
    slate: {
      idle: "border-slate-200 bg-slate-50/80 text-slate-700 hover:border-slate-300 hover:bg-slate-100",
      active: "border-slate-500 bg-slate-200 text-slate-900 shadow-sm ring-2 ring-slate-300/80",
    },
  };
  return selected ? map[tone].active : map[tone].idle;
}

function issueCategoryIconClass(tone: IssueTone, selected: boolean): string {
  const map: Record<IssueTone, { idle: string; active: string }> = {
    red: { idle: "text-red-500", active: "text-red-700" },
    blue: { idle: "text-blue-500", active: "text-blue-700" },
    amber: { idle: "text-amber-600", active: "text-amber-800" },
    violet: { idle: "text-violet-500", active: "text-violet-700" },
    cyan: { idle: "text-cyan-600", active: "text-cyan-800" },
    slate: { idle: "text-slate-500", active: "text-slate-700" },
  };
  return selected ? map[tone].active : map[tone].idle;
}

const MODULES = [
  "General",
  "Dashboard",
  "Inventory",
  "Sales",
  "Sales B2B",
  "Purchase",
  "Day Book",
  "Quotation",
  "Payment",
  "Support",
] as const;

const PRIORITIES = ["Low", "Normal", "High"] as const;

const SUPPORT_STATUS_OPTIONS: { value: SupportStatus; label: string }[] = [
  { value: "Open", label: "Open" },
  { value: "In Progress", label: "In Progress" },
  { value: "Resolved", label: "Solved" },
  { value: "Closed", label: "Closed" },
];

function statusLabel(status: SupportStatus): string {
  return SUPPORT_STATUS_OPTIONS.find((o) => o.value === status)?.label ?? status;
}

function isMissingTableError(error: { code?: string; message?: string }): boolean {
  const message = (error.message ?? "").toLowerCase();
  if (error.code === "PGRST205" || error.code === "42P01") return true;
  if (message.includes("could not find the table")) return true;
  return message.includes("relation") && message.includes("does not exist");
}

function normalizeRequest(raw: Record<string, unknown>): SupportRequest {
  return {
    id: String(raw.id ?? crypto.randomUUID()),
    request_kind: raw.request_kind === "feature" ? "feature" : "issue",
    category: String(raw.category ?? "Other"),
    module: String(raw.module ?? "General"),
    subject: String(raw.subject ?? ""),
    description: String(raw.description ?? ""),
    reference_no: raw.reference_no ? String(raw.reference_no) : undefined,
    priority: String(raw.priority ?? "Normal"),
    status: (["Open", "In Progress", "Resolved", "Closed", "Solved"].includes(String(raw.status))
      ? (String(raw.status) === "Solved" ? "Resolved" : String(raw.status))
      : "Open") as SupportStatus,
    reporter_name: raw.reporter_name ? String(raw.reporter_name) : undefined,
    reporter_email: raw.reporter_email ? String(raw.reporter_email) : undefined,
    created_at: String(raw.created_at ?? new Date().toISOString()),
  };
}

function statusStyle(status: SupportStatus): string {
  switch (status) {
    case "Open":
      return "bg-blue-100 text-blue-800 border-blue-200";
    case "In Progress":
      return "bg-amber-100 text-amber-800 border-amber-200";
    case "Resolved":
      return "bg-green-100 text-green-800 border-green-200";
    case "Closed":
      return "bg-slate-100 text-slate-600 border-slate-200";
    default:
      return "bg-slate-100 text-slate-600 border-slate-200";
  }
}

function priorityStyle(priority: string): string {
  switch (priority) {
    case "High":
      return "text-red-600";
    case "Low":
      return "text-slate-400";
    default:
      return "text-slate-600";
  }
}

function issueCategoryMeta(category: string) {
  return ISSUE_CATEGORIES.find((c) => c.value === category);
}

export default function SupportPage() {
  const { user } = useAuthStore();
  const reporterName = user?.user_metadata?.owner_name || "Manager";
  const reporterEmail = user?.email ?? "";

  const [requests, setRequests] = useState<SupportRequest[]>([]);
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [dbStatus, setDbStatus] = useState<"connected" | "local">("connected");
  const [activeTab, setActiveTab] = useState<RequestKind>("issue");
  const [formError, setFormError] = useState<string | null>(null);
  const [successMsg, setSuccessMsg] = useState<string | null>(null);
  const [viewingRequest, setViewingRequest] = useState<SupportRequest | null>(null);
  const [statusUpdating, setStatusUpdating] = useState(false);
  const [statusUpdateError, setStatusUpdateError] = useState<string | null>(null);

  const [category, setCategory] = useState<string>("Bug");
  const [module, setModule] = useState<string>("General");
  const [subject, setSubject] = useState("");
  const [description, setDescription] = useState("");
  const [referenceNo, setReferenceNo] = useState("");
  const [priority, setPriority] = useState<string>("Normal");

  const loadLocal = useCallback(() => {
    try {
      const raw = localStorage.getItem(LOCAL_STORAGE_KEY);
      if (!raw) {
        setRequests([]);
        return;
      }
      setRequests((JSON.parse(raw) as Record<string, unknown>[]).map(normalizeRequest));
    } catch {
      setRequests([]);
    }
  }, []);

  const fetchRequests = useCallback(async () => {
    try {
      setLoading(true);
      const { data, error } = await supabase
        .from("support_requests")
        .select("*")
        .order("created_at", { ascending: false })
        .limit(50);

      if (error) {
        if (isMissingTableError(error)) {
          setDbStatus("local");
          loadLocal();
        } else {
          console.error("Support fetch error:", error);
          setDbStatus("local");
          loadLocal();
        }
      } else {
        setRequests((data ?? []).map((row) => normalizeRequest(row as Record<string, unknown>)));
        setDbStatus("connected");
      }
    } catch {
      setDbStatus("local");
      loadLocal();
    } finally {
      setLoading(false);
    }
  }, [loadLocal]);

  useEffect(() => {
    const timer = setTimeout(() => {
      fetchRequests();
    }, 0);
    return () => clearTimeout(timer);
  }, [fetchRequests]);

  const resetForm = () => {
    setSubject("");
    setDescription("");
    setReferenceNo("");
    setPriority("Normal");
    setCategory("Bug");
    setModule("General");
    setFormError(null);
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setFormError(null);
    setSuccessMsg(null);

    const subjectTrim = subject.trim();
    const descTrim = description.trim();
    if (!subjectTrim) {
      setFormError("Please enter a subject.");
      return;
    }
    if (descTrim.length < 10) {
      setFormError("Please describe the issue or feature in at least 10 characters.");
      return;
    }

    const payload: Omit<SupportRequest, "id" | "created_at" | "status"> & { status: SupportStatus } = {
      request_kind: activeTab,
      category: activeTab === "feature" ? "Feature Request" : category,
      module,
      subject: subjectTrim,
      description: descTrim,
      reference_no: referenceNo.trim() || undefined,
      priority,
      status: "Open",
      reporter_name: reporterName,
      reporter_email: reporterEmail,
    };

    setSubmitting(true);
    try {
      if (dbStatus === "connected") {
        const { data, error } = await supabase
          .from("support_requests")
          .insert([payload])
          .select("*")
          .single();

        if (error) {
          if (isMissingTableError(error)) {
            setDbStatus("local");
            const localRow: SupportRequest = {
              ...payload,
              id: crypto.randomUUID(),
              created_at: new Date().toISOString(),
            };
            const updated = [localRow, ...requests];
            localStorage.setItem(LOCAL_STORAGE_KEY, JSON.stringify(updated));
            setRequests(updated);
            setSuccessMsg("Saved locally — run sql/11_support_requests.sql in Supabase to sync.");
          } else {
            throw error;
          }
        } else if (data) {
          setRequests((prev) => [normalizeRequest(data as Record<string, unknown>), ...prev]);
          setSuccessMsg(
            activeTab === "feature"
              ? "Feature request submitted successfully!"
              : "Issue reported successfully — we'll review it soon.",
          );
        }
      } else {
        const localRow: SupportRequest = {
          ...payload,
          id: crypto.randomUUID(),
          created_at: new Date().toISOString(),
        };
        const updated = [localRow, ...requests];
        localStorage.setItem(LOCAL_STORAGE_KEY, JSON.stringify(updated));
        setRequests(updated);
        setSuccessMsg("Saved to local storage. Run sql/11_support_requests.sql to enable Supabase sync.");
      }
      resetForm();
      setTimeout(() => setSuccessMsg(null), 5000);
    } catch (err) {
      setFormError(err instanceof Error ? err.message : "Failed to submit. Please try again.");
    } finally {
      setSubmitting(false);
    }
  };

  const applyRequestUpdate = (updated: SupportRequest) => {
    setRequests((prev) => prev.map((r) => (r.id === updated.id ? updated : r)));
    setViewingRequest(updated);
  };

  const handleStatusChange = async (newStatus: SupportStatus) => {
    if (!viewingRequest || viewingRequest.status === newStatus) return;

    setStatusUpdating(true);
    setStatusUpdateError(null);
    const previous = viewingRequest;
    const optimistic = { ...viewingRequest, status: newStatus };
    applyRequestUpdate(optimistic);

    try {
      if (dbStatus === "connected") {
        const { data, error } = await supabase
          .from("support_requests")
          .update({ status: newStatus })
          .eq("id", viewingRequest.id)
          .select("*")
          .single();

        if (error) {
          if (isMissingTableError(error)) {
            setDbStatus("local");
            setRequests((prev) => {
              const updated = prev.map((r) =>
                r.id === viewingRequest.id ? optimistic : r,
              );
              localStorage.setItem(LOCAL_STORAGE_KEY, JSON.stringify(updated));
              return updated;
            });
          } else {
            applyRequestUpdate(previous);
            throw error;
          }
        } else if (data) {
          applyRequestUpdate(normalizeRequest(data as Record<string, unknown>));
        }
      } else {
        setRequests((prev) => {
          const updated = prev.map((r) =>
            r.id === viewingRequest.id ? optimistic : r,
          );
          localStorage.setItem(LOCAL_STORAGE_KEY, JSON.stringify(updated));
          return updated;
        });
      }
    } catch (err) {
      applyRequestUpdate(previous);
      setStatusUpdateError(
        err instanceof Error ? err.message : "Failed to update status. Please try again.",
      );
    } finally {
      setStatusUpdating(false);
    }
  };

  return (
    <div className="p-4 sm:p-6 lg:p-8 max-w-6xl mx-auto">
      <div className="mb-6">
        <div className="flex items-center gap-3 mb-1">
          <div className="inline-flex items-center justify-center w-10 h-10 rounded-xl bg-primary/10 text-primary">
            <LifeBuoy className="w-5 h-5" />
          </div>
          <div>
            <h1 className="text-page-title font-semibold text-text-primary">Support</h1>
            <p className="text-sm text-text-secondary">
              Report bugs, bill issues, or request new features — all submissions are logged for review.
            </p>
          </div>
        </div>
      </div>

      {dbStatus === "local" && (
        <div className="mb-6 bg-blue-50 border border-blue-200 rounded-lg p-4 flex items-start gap-3">
          <Database className="w-5 h-5 text-blue-600 mt-0.5 shrink-0" />
          <div>
            <h4 className="text-sm font-semibold text-blue-800">Local Mode</h4>
            <p className="text-xs text-blue-700 mt-0.5 leading-relaxed">
              The <code className="text-[10px] bg-blue-100 px-1 rounded">support_requests</code> table was not found.
              Submissions are saved locally until you run{" "}
              <code className="text-[10px] bg-blue-100 px-1 rounded">sql/11_support_requests.sql</code> in Supabase.
            </p>
          </div>
        </div>
      )}

      <div className="grid gap-6 lg:grid-cols-[1fr_380px]">
        {/* Submission form */}
        <div className="rounded-xl border border-border bg-white shadow-card overflow-hidden">
          <div className="border-b border-border bg-slate-50/80 px-5 py-3 flex gap-2">
            <button
              type="button"
              onClick={() => { setActiveTab("issue"); setFormError(null); }}
              className={cn(
                "flex items-center gap-2 px-4 py-2 rounded-lg text-xs font-semibold transition-all",
                activeTab === "issue"
                  ? "bg-white text-primary shadow-sm border border-border"
                  : "text-text-secondary hover:text-text-primary",
              )}
            >
              <Bug className="w-3.5 h-3.5" />
              Report an Issue
            </button>
            <button
              type="button"
              onClick={() => { setActiveTab("feature"); setFormError(null); }}
              className={cn(
                "flex items-center gap-2 px-4 py-2 rounded-lg text-xs font-semibold transition-all",
                activeTab === "feature"
                  ? "bg-white text-primary shadow-sm border border-border"
                  : "text-text-secondary hover:text-text-primary",
              )}
            >
              <Lightbulb className="w-3.5 h-3.5" />
              Request a Feature
            </button>
          </div>

          <form onSubmit={handleSubmit} className="p-5 space-y-4">
            {formError && (
              <div className="bg-red-50 border border-red-200 text-red-800 text-xs px-4 py-2.5 rounded-md flex items-center gap-2">
                <AlertTriangle className="w-4 h-4 shrink-0" />
                {formError}
              </div>
            )}
            {successMsg && (
              <div className="bg-green-50 border border-green-200 text-green-800 text-xs px-4 py-2.5 rounded-md flex items-center gap-2">
                <Check className="w-4 h-4 shrink-0" />
                {successMsg}
              </div>
            )}

            {activeTab === "issue" && (
              <div>
                <label className="form-label text-xs font-semibold text-slate-700 mb-2 block">
                  Issue Type *
                </label>
                <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
                  {ISSUE_CATEGORIES.map(({ value, label, icon: Icon, tone }) => {
                    const selected = category === value;
                    return (
                    <button
                      key={value}
                      type="button"
                      onClick={() => setCategory(value)}
                      className={cn(
                        "flex items-center gap-2 px-3 py-2.5 rounded-lg border text-left text-xs font-semibold transition-all",
                        issueCategoryClasses(tone, selected),
                      )}
                    >
                      <Icon className={cn("w-3.5 h-3.5 shrink-0", issueCategoryIconClass(tone, selected))} />
                      <span className="leading-tight">{label}</span>
                    </button>
                    );
                  })}
                </div>
              </div>
            )}

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div>
                <label className="form-label text-xs font-semibold text-slate-700 mb-1 block">
                  Module / Area *
                </label>
                <select
                  value={module}
                  onChange={(e) => setModule(e.target.value)}
                  className="input-enterprise bg-white cursor-pointer text-xs w-full"
                  required
                >
                  {MODULES.map((m) => (
                    <option key={m} value={m}>{m}</option>
                  ))}
                </select>
              </div>
              <div>
                <label className="form-label text-xs font-semibold text-slate-700 mb-1 block">
                  Priority
                </label>
                <select
                  value={priority}
                  onChange={(e) => setPriority(e.target.value)}
                  className="input-enterprise bg-white cursor-pointer text-xs w-full"
                >
                  {PRIORITIES.map((p) => (
                    <option key={p} value={p}>{p}</option>
                  ))}
                </select>
              </div>
            </div>

            <div>
              <label className="form-label text-xs font-semibold text-slate-700 mb-1 block">
                {activeTab === "feature" ? "Feature Title *" : "Subject *"}
              </label>
              <input
                type="text"
                value={subject}
                onChange={(e) => setSubject(e.target.value)}
                placeholder={
                  activeTab === "feature"
                    ? "e.g. Export sales register to Excel"
                    : "e.g. Purchase bill YG26-211 shows wrong total"
                }
                className="input-enterprise text-xs w-full"
                required
              />
            </div>

            {activeTab === "issue" && (
              <div>
                <label className="form-label text-xs font-semibold text-slate-700 mb-1 block">
                  Bill / Invoice / Item Reference
                  <span className="ml-1 text-[10px] font-normal text-slate-400">(optional)</span>
                </label>
                <input
                  type="text"
                  value={referenceNo}
                  onChange={(e) => setReferenceNo(e.target.value)}
                  placeholder="e.g. Bill 8241, Invoice YG26-211, item code 260"
                  className="input-enterprise font-mono text-xs w-full"
                />
              </div>
            )}

            <div>
              <label className="form-label text-xs font-semibold text-slate-700 mb-1 block">
                {activeTab === "feature" ? "Describe the feature *" : "Describe the problem *"}
              </label>
              <textarea
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                rows={5}
                placeholder={
                  activeTab === "feature"
                    ? "What should the feature do? Who will use it? Any examples..."
                    : "What happened? What did you expect? Steps to reproduce if it's a bug..."
                }
                className="input-enterprise text-xs w-full resize-y min-h-[120px]"
                required
              />
            </div>

            <div className="flex items-center justify-between pt-2 border-t border-slate-100">
              <p className="text-[10px] text-slate-400">
                Submitting as <span className="font-semibold text-slate-600">{reporterName}</span>
                {reporterEmail && <> · {reporterEmail}</>}
              </p>
              <button
                type="submit"
                disabled={submitting}
                className="btn-primary px-5 py-2.5 flex items-center gap-2 text-xs font-bold disabled:opacity-60"
              >
                {submitting ? (
                  <Loader2 className="w-4 h-4 animate-spin" />
                ) : (
                  <Send className="w-4 h-4" />
                )}
                {activeTab === "feature" ? "Submit Feature Request" : "Submit Issue Report"}
              </button>
            </div>
          </form>
        </div>

        {/* Recent submissions */}
        <div className="rounded-xl border border-border bg-white shadow-card flex flex-col max-h-[720px]">
          <div className="px-5 py-4 border-b border-border">
            <h2 className="text-sm font-semibold text-text-primary">Your Submissions</h2>
            <p className="text-[10px] text-text-secondary mt-0.5">Recent reports and feature requests</p>
          </div>

          <div className="flex-1 overflow-y-auto p-3 space-y-2">
            {loading ? (
              <div className="flex flex-col items-center justify-center py-12 text-text-secondary">
                <Loader2 className="w-6 h-6 animate-spin text-primary mb-2" />
                <span className="text-xs">Loading submissions...</span>
              </div>
            ) : requests.length === 0 ? (
              <div className="text-center py-12 px-4">
                <Clock className="w-8 h-8 mx-auto text-slate-300 mb-2" />
                <p className="text-xs font-semibold text-slate-500">No submissions yet</p>
                <p className="text-[10px] text-slate-400 mt-1">
                  Report an issue or request a feature using the form.
                </p>
              </div>
            ) : (
              requests.map((req) => (
                <div
                  key={req.id}
                  className="rounded-lg border border-slate-100 bg-slate-50/50 p-3 hover:bg-slate-50 transition-colors"
                >
                  <div className="flex items-start justify-between gap-2 mb-1.5">
                    <div className="min-w-0">
                      <p className="text-xs font-semibold text-slate-800 truncate" title={req.subject}>
                        {req.subject}
                      </p>
                      <p className="text-[10px] text-slate-500 mt-0.5">
                        {req.category} · {req.module}
                        {req.reference_no && (
                          <span className="font-mono"> · Ref: {req.reference_no}</span>
                        )}
                      </p>
                    </div>
                    <div className="flex items-center gap-1 shrink-0">
                      <button
                        type="button"
                        onClick={() => {
                          setStatusUpdateError(null);
                          setViewingRequest(req);
                        }}
                        title="View submission"
                        className="p-1 rounded-md text-slate-500 hover:text-primary hover:bg-white border border-transparent hover:border-slate-200 transition-colors"
                      >
                        <Eye className="w-3.5 h-3.5" />
                      </button>
                      <span
                        className={cn(
                          "text-[9px] font-bold uppercase tracking-wide px-2 py-0.5 rounded-full border",
                          statusStyle(req.status),
                        )}
                      >
                        {statusLabel(req.status)}
                      </span>
                    </div>
                  </div>
                  <p className="text-[10px] text-slate-600 line-clamp-2 leading-relaxed">
                    {req.description}
                  </p>
                  <div className="flex items-center justify-between mt-2 pt-2 border-t border-slate-100/80">
                    <span className="text-[10px] text-slate-400">
                      {formatTableDate(req.created_at)}
                    </span>
                    <span className={cn("text-[10px] font-semibold", priorityStyle(req.priority))}>
                      {req.priority} priority
                    </span>
                  </div>
                </div>
              ))
            )}
          </div>
        </div>
      </div>

      {viewingRequest && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/50 backdrop-blur-sm">
          <div
            className="absolute inset-0"
            onClick={() => setViewingRequest(null)}
            aria-hidden
          />
          <div className="relative bg-white rounded-xl shadow-2xl w-full max-w-lg max-h-[90vh] overflow-hidden flex flex-col animate-in fade-in zoom-in-95 duration-150">
            <div className="px-5 py-4 border-b border-border bg-slate-50/80 flex items-start justify-between gap-3 shrink-0">
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2 flex-wrap mb-1">
                  <div className="flex items-center gap-2">
                    <label htmlFor="support-status-select" className="sr-only">Status</label>
                    <select
                      id="support-status-select"
                      value={viewingRequest.status}
                      disabled={statusUpdating}
                      onChange={(e) => handleStatusChange(e.target.value as SupportStatus)}
                      className={cn(
                        "text-[10px] font-bold uppercase tracking-wide px-2 py-1 rounded-full border cursor-pointer bg-white disabled:opacity-60",
                        statusStyle(viewingRequest.status),
                      )}
                    >
                      {SUPPORT_STATUS_OPTIONS.map(({ value, label }) => (
                        <option key={value} value={value}>{label}</option>
                      ))}
                    </select>
                    {statusUpdating && (
                      <Loader2 className="w-3.5 h-3.5 animate-spin text-primary" aria-hidden />
                    )}
                  </div>
                  <span className="text-[10px] text-slate-500">
                    {viewingRequest.request_kind === "feature" ? "Feature Request" : "Issue Report"}
                  </span>
                </div>
                <h2 className="text-sm font-semibold text-text-primary leading-snug">
                  {viewingRequest.subject}
                </h2>
                {statusUpdateError && (
                  <p className="text-[10px] text-red-600 mt-1 flex items-center gap-1">
                    <AlertTriangle className="w-3 h-3 shrink-0" />
                    {statusUpdateError}
                  </p>
                )}
              </div>
              <button
                type="button"
                onClick={() => setViewingRequest(null)}
                className="p-1.5 rounded-lg text-slate-500 hover:text-slate-800 hover:bg-slate-200/80 shrink-0"
                aria-label="Close"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <div className="p-5 space-y-4 overflow-y-auto flex-1 text-xs">
              {viewingRequest.request_kind === "issue" && (() => {
                const meta = issueCategoryMeta(viewingRequest.category);
                const Icon = meta?.icon ?? MoreHorizontal;
                const tone = meta?.tone ?? "slate";
                return (
                  <div className={cn(
                    "flex items-center gap-2 px-3 py-2 rounded-lg border text-xs font-semibold w-fit",
                    issueCategoryClasses(tone, true),
                  )}>
                    <Icon className={cn("w-3.5 h-3.5", issueCategoryIconClass(tone, true))} />
                    {viewingRequest.category}
                  </div>
                );
              })()}

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <p className="text-[10px] font-semibold text-slate-500 uppercase tracking-wide mb-0.5">Module</p>
                  <p className="text-slate-800 font-medium">{viewingRequest.module}</p>
                </div>
                <div>
                  <p className="text-[10px] font-semibold text-slate-500 uppercase tracking-wide mb-0.5">Status</p>
                  <p className={cn(
                    "inline-flex text-[10px] font-bold uppercase tracking-wide px-2 py-0.5 rounded-full border w-fit",
                    statusStyle(viewingRequest.status),
                  )}>
                    {statusLabel(viewingRequest.status)}
                  </p>
                </div>
                <div>
                  <p className="text-[10px] font-semibold text-slate-500 uppercase tracking-wide mb-0.5">Priority</p>
                  <p className={cn("font-semibold", priorityStyle(viewingRequest.priority))}>
                    {viewingRequest.priority}
                  </p>
                </div>
                <div>
                  <p className="text-[10px] font-semibold text-slate-500 uppercase tracking-wide mb-0.5">Submitted</p>
                  <p className="text-slate-800">{formatTableDate(viewingRequest.created_at)}</p>
                </div>
                <div className="col-span-2">
                  <p className="text-[10px] font-semibold text-slate-500 uppercase tracking-wide mb-0.5">Type</p>
                  <p className="text-slate-800">{viewingRequest.category}</p>
                </div>
              </div>

              {viewingRequest.reference_no && (
                <div>
                  <p className="text-[10px] font-semibold text-slate-500 uppercase tracking-wide mb-0.5">
                    Bill / Reference
                  </p>
                  <p className="font-mono text-slate-800 bg-slate-50 border border-slate-200 rounded-md px-3 py-2">
                    {viewingRequest.reference_no}
                  </p>
                </div>
              )}

              <div>
                <p className="text-[10px] font-semibold text-slate-500 uppercase tracking-wide mb-1">
                  {viewingRequest.request_kind === "feature" ? "Feature Description" : "Problem Description"}
                </p>
                <p className="text-slate-700 leading-relaxed whitespace-pre-wrap bg-slate-50 border border-slate-200 rounded-lg px-3 py-3">
                  {viewingRequest.description}
                </p>
              </div>

              {(viewingRequest.reporter_name || viewingRequest.reporter_email) && (
                <div className="pt-3 border-t border-slate-100">
                  <p className="text-[10px] font-semibold text-slate-500 uppercase tracking-wide mb-0.5">Reporter</p>
                  <p className="text-slate-700">
                    {viewingRequest.reporter_name}
                    {viewingRequest.reporter_email && (
                      <span className="text-slate-500"> · {viewingRequest.reporter_email}</span>
                    )}
                  </p>
                </div>
              )}
            </div>

            <div className="px-5 py-3 border-t border-border bg-slate-50/80 flex justify-end shrink-0">
              <button
                type="button"
                onClick={() => setViewingRequest(null)}
                className="btn-secondary text-xs px-4"
              >
                Close
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
