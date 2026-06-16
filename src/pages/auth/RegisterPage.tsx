import { useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import {
  Building2,
  User,
  Lock,
  Eye,
  EyeOff,
  ChevronRight,
  ChevronLeft,
  Check,
  AlertCircle,
  ShieldCheck,
  ChevronDown,
} from "lucide-react";
import { cn, hashPassword } from "@/lib/utils";
import { supabase } from "@/lib/supabase";


// ─── Types ─────────────────────────────────────────────────────────────────────
interface FormData {
  // Step 1 — Business Information
  storeName:    string;
  gstNumber:    string;
  businessType: string;
  // Step 2 — Owner Information
  ownerName:  string;
  phone:      string;
  email:      string;
  // Step 3 — Security
  password:        string;
  confirmPassword: string;
}

type FieldErrors = Partial<Record<keyof FormData, string>>;

// ─── Step definitions ──────────────────────────────────────────────────────────
const STEPS = [
  { id: 1, label: "Business Information", icon: Building2 },
  { id: 2, label: "Owner Information",    icon: User },
  { id: 3, label: "Security",             icon: Lock },
] as const;

// ─── Step Indicator ────────────────────────────────────────────────────────────
function StepIndicator({
  current,
  total,
}: {
  current: number;
  total: number;
}) {
  return (
    <div className="flex items-center gap-0">
      {STEPS.map((step, idx) => {
        const done    = step.id < current;
        const active  = step.id === current;
        const Icon    = step.icon;
        const isLast  = idx === STEPS.length - 1;

        return (
          <div key={step.id} className="flex items-center">
            {/* Circle */}
            <div className="flex flex-col items-center">
              <div
                className={cn(
                  "w-8 h-8 rounded-full flex items-center justify-center border-2 transition-all duration-200 text-xs font-semibold",
                  done   && "bg-primary border-primary text-white",
                  active && "bg-white border-primary text-primary",
                  !done && !active && "bg-white border-border text-text-secondary"
                )}
              >
                {done ? (
                  <Check className="w-3.5 h-3.5" />
                ) : (
                  <Icon className="w-3.5 h-3.5" />
                )}
              </div>
              <span
                className={cn(
                  "mt-1.5 text-[11px] font-medium whitespace-nowrap",
                  active && "text-primary",
                  done   && "text-primary",
                  !done && !active && "text-text-secondary"
                )}
              >
                {step.label}
              </span>
            </div>

            {/* Connector line */}
            {!isLast && (
              <div
                className={cn(
                  "h-0.5 mx-3 mb-5 transition-all duration-300",
                  done ? "bg-primary w-16" : "bg-border w-16"
                )}
              />
            )}
          </div>
        );
      })}
      <div className="sr-only">
        Step {current} of {total}
      </div>
    </div>
  );
}

// ─── Field component ───────────────────────────────────────────────────────────
function Field({
  label,
  error,
  required,
  children,
}: {
  label: string;
  error?: string;
  required?: boolean;
  children: React.ReactNode;
}) {
  return (
    <div>
      <label className="form-label">
        {label}
        {required && <span className="text-danger ml-0.5">*</span>}
      </label>
      {children}
      {error && (
        <p className="mt-1 text-caption text-danger flex items-center gap-1">
          <AlertCircle className="w-3 h-3" />
          {error}
        </p>
      )}
    </div>
  );
}

// ─── Step 1: Business Information ──────────────────────────────────────────────
function Step1({
  data,
  errors,
  onChange,
}: {
  data: FormData;
  errors: FieldErrors;
  onChange: (field: keyof FormData, value: string) => void;
}) {
  return (
    <div className="space-y-5">
      <Field label="Store / Business Name" error={errors.storeName} required>
        <input
          type="text"
          value={data.storeName}
          onChange={(e) => onChange("storeName", e.target.value)}
          className="input-enterprise"
          placeholder="e.g. New Kaniyamparambil Stores"
          autoFocus
        />
      </Field>

      <div className="grid grid-cols-2 gap-4">
        <Field label="GST Number" error={errors.gstNumber}>
          <input
            type="text"
            value={data.gstNumber}
            onChange={(e) => onChange("gstNumber", e.target.value.toUpperCase())}
            className="input-enterprise"
            placeholder="29AABCU9603R1ZX"
            maxLength={15}
          />
        </Field>

        <Field label="Business Type" error={errors.businessType} required>
          <div className="relative">
            <select
              value={data.businessType}
              onChange={(e) => onChange("businessType", e.target.value)}
              className="input-enterprise pr-10 appearance-none cursor-pointer bg-white"
            >
              <option value="">Select type…</option>
              <option value="retail">Retail Store</option>
              <option value="wholesale">Wholesale / Distribution</option>
              <option value="supermarket">Supermarket</option>
              <option value="pharmacy">Pharmacy</option>
              <option value="electronics">Electronics</option>
              <option value="fmcg">FMCG</option>
              <option value="other">Other</option>
            </select>
            <div className="pointer-events-none absolute inset-y-0 right-0 flex items-center px-3 border-l border-border bg-gray-50 rounded-r text-text-secondary">
              <ChevronDown className="w-4 h-4" />
            </div>
          </div>
        </Field>
      </div>

      {/* Info banner */}
      <div className="flex items-start gap-2.5 p-3 bg-info-light border border-blue-200 rounded text-caption text-info">
        <ShieldCheck className="w-3.5 h-3.5 flex-shrink-0 mt-0.5" />
        <span>
          Your GST number is used to auto-fill GSTIN on invoices and enable B2B tax
          compliance reporting.
        </span>
      </div>
    </div>
  );
}

// ─── Step 2: Owner Information ─────────────────────────────────────────────────
function Step2({
  data,
  errors,
  onChange,
}: {
  data: FormData;
  errors: FieldErrors;
  onChange: (field: keyof FormData, value: string) => void;
}) {
  return (
    <div className="space-y-5">
      <Field label="Full Name" error={errors.ownerName} required>
        <input
          type="text"
          value={data.ownerName}
          onChange={(e) => onChange("ownerName", e.target.value)}
          className="input-enterprise"
          placeholder="e.g. Rajesh Kumar"
          autoFocus
        />
      </Field>

      <div className="grid grid-cols-2 gap-4">
        <Field label="Mobile Number" error={errors.phone} required>
          <div className="relative">
            <span className="absolute left-3 top-1/2 -translate-y-1/2 text-sm text-text-secondary font-medium">
              +91
            </span>
            <input
              type="tel"
              value={data.phone}
              onChange={(e) => onChange("phone", e.target.value.replace(/\D/g, "").slice(0, 10))}
              className="input-enterprise pl-10"
              placeholder="98765 43210"
            />
          </div>
        </Field>

        <Field label="Email Address" error={errors.email} required>
          <input
            type="email"
            value={data.email}
            onChange={(e) => onChange("email", e.target.value)}
            className="input-enterprise"
            placeholder="owner@store.com"
          />
        </Field>
      </div>

      <div
        className="p-4 rounded border"
        style={{ borderColor: "#E5E7EB", background: "#FAFAFA" }}
      >
        <p className="text-caption font-medium text-text-primary mb-1">
          Contact Verification
        </p>
        <p className="text-caption text-text-secondary">
          A one-time verification code will be sent to your mobile number and email
          address to confirm your identity before account activation.
        </p>
      </div>
    </div>
  );
}

// ─── Step 3: Security ──────────────────────────────────────────────────────────
function PasswordStrength({ password }: { password: string }) {
  const checks = [
    { label: "At least 8 characters",       pass: password.length >= 8 },
    { label: "Contains uppercase letter",    pass: /[A-Z]/.test(password) },
    { label: "Contains number",              pass: /\d/.test(password) },
    { label: "Contains special character",   pass: /[!@#$%^&*()_+\-=[\]{}|;':\",./<>?]/.test(password) },
  ];

  const score = checks.filter((c) => c.pass).length;
  const strengthLabel = ["", "Weak", "Fair", "Good", "Strong"][score] || "";
  const strengthColor = ["", "#DC2626", "#D97706", "#0284C7", "#15803D"][score] || "";
  const strengthWidth = `${(score / 4) * 100}%`;

  if (!password) return null;

  return (
    <div className="mt-2 space-y-2 animate-fade-in">
      {/* Progress bar */}
      <div className="flex items-center gap-2">
        <div className="flex-1 h-1.5 bg-gray-100 rounded-full overflow-hidden">
          <div
            className="h-full rounded-full transition-all duration-300"
            style={{ width: strengthWidth, background: strengthColor }}
          />
        </div>
        <span className="text-caption font-medium" style={{ color: strengthColor, minWidth: "40px" }}>
          {strengthLabel}
        </span>
      </div>

      {/* Check list */}
      <div className="grid grid-cols-2 gap-1">
        {checks.map((c) => (
          <div
            key={c.label}
            className={cn(
              "flex items-center gap-1.5 text-[11px]",
              c.pass ? "text-success" : "text-text-secondary"
            )}
          >
            <div
              className={cn(
                "w-3 h-3 rounded-full flex items-center justify-center flex-shrink-0",
                c.pass ? "bg-success" : "bg-gray-200"
              )}
            >
              {c.pass && <Check className="w-2 h-2 text-white" />}
            </div>
            {c.label}
          </div>
        ))}
      </div>
    </div>
  );
}

function Step3({
  data,
  errors,
  onChange,
}: {
  data: FormData;
  errors: FieldErrors;
  onChange: (field: keyof FormData, value: string) => void;
}) {
  const [showPw,  setShowPw]  = useState(false);
  const [showCPw, setShowCPw] = useState(false);

  return (
    <div className="space-y-5">
      <Field label="Password" error={errors.password} required>
        <div className="relative">
          <input
            type={showPw ? "text" : "password"}
            value={data.password}
            onChange={(e) => onChange("password", e.target.value)}
            className="input-enterprise pr-10"
            placeholder="Create a strong password"
            autoFocus
          />
          <button
            type="button"
            onClick={() => setShowPw(!showPw)}
            className="absolute right-3 top-1/2 -translate-y-1/2 text-text-secondary hover:text-text-primary transition-colors duration-150"
            tabIndex={-1}
          >
            {showPw ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
          </button>
        </div>
        <PasswordStrength password={data.password} />
      </Field>

      <Field label="Confirm Password" error={errors.confirmPassword} required>
        <div className="relative">
          <input
            type={showCPw ? "text" : "password"}
            value={data.confirmPassword}
            onChange={(e) => onChange("confirmPassword", e.target.value)}
            className="input-enterprise pr-10"
            placeholder="Re-enter your password"
          />
          <button
            type="button"
            onClick={() => setShowCPw(!showCPw)}
            className="absolute right-3 top-1/2 -translate-y-1/2 text-text-secondary hover:text-text-primary transition-colors duration-150"
            tabIndex={-1}
          >
            {showCPw ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
          </button>
        </div>
        {data.confirmPassword && data.password === data.confirmPassword && (
          <p className="mt-1 text-caption text-success flex items-center gap-1 animate-fade-in">
            <Check className="w-3 h-3" /> Passwords match
          </p>
        )}
      </Field>

      {/* Summary of registration */}
      <div
        className="p-4 rounded border space-y-2"
        style={{ borderColor: "#E5E7EB", background: "#FAFAFA" }}
      >
        <p className="text-caption font-semibold text-text-primary">
          Registration Summary
        </p>
        <div className="grid grid-cols-2 gap-x-4 gap-y-1 text-caption">
          <div className="text-text-secondary">Business</div>
          <div className="text-text-primary font-medium truncate">
            {data.storeName || "—"}
          </div>
          <div className="text-text-secondary">GST Number</div>
          <div className="text-text-primary font-medium">{data.gstNumber || "—"}</div>
          <div className="text-text-secondary">Owner</div>
          <div className="text-text-primary font-medium">{data.ownerName || "—"}</div>
          <div className="text-text-secondary">Email</div>
          <div className="text-text-primary font-medium truncate">{data.email || "—"}</div>
        </div>
      </div>

      <div className="flex items-start gap-2.5">
        <input
          type="checkbox"
          id="terms"
          className="mt-0.5 w-3.5 h-3.5 rounded border-border accent-primary cursor-pointer"
        />
        <label htmlFor="terms" className="text-caption text-text-secondary cursor-pointer">
          I agree to the{" "}
          <a href="#" className="text-primary hover:underline font-medium">Terms of Service</a>{" "}
          and{" "}
          <a href="#" className="text-primary hover:underline font-medium">Privacy Policy</a>
        </label>
      </div>
    </div>
  );
}

// ─── Main Register Page ────────────────────────────────────────────────────────
export default function RegisterPage() {
  const navigate = useNavigate();

  const [step, setStep] = useState(1);
  const [loading, setLoading] = useState(false);
  const [errors, setErrors]   = useState<FieldErrors>({});

  const [form, setForm] = useState<FormData>({
    storeName:       "",
    gstNumber:       "",
    businessType:    "",
    ownerName:       "",
    phone:           "",
    email:           "",
    password:        "",
    confirmPassword: "",
  });

  const handleChange = (field: keyof FormData, value: string) => {
    setForm((prev) => ({ ...prev, [field]: value }));
    setErrors((prev) => ({ ...prev, [field]: undefined }));
  };

  const validateStep = (): boolean => {
    const e: FieldErrors = {};

    if (step === 1) {
      if (!form.storeName.trim())    e.storeName    = "Store name is required";
      if (!form.businessType)        e.businessType = "Please select a business type";
      if (form.gstNumber && form.gstNumber.length !== 15)
        e.gstNumber = "GST number must be 15 characters";
    }

    if (step === 2) {
      if (!form.ownerName.trim())    e.ownerName = "Owner name is required";
      if (!form.phone || form.phone.length !== 10)
        e.phone = "Enter a valid 10-digit mobile number";
      if (!form.email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(form.email))
        e.email = "Enter a valid email address";
    }

    if (step === 3) {
      if (form.password.length < 8)   e.password = "Password must be at least 8 characters";
      if (form.password !== form.confirmPassword)
        e.confirmPassword = "Passwords do not match";
    }

    setErrors(e);
    return Object.keys(e).length === 0;
  };

  const handleNext = () => {
    if (validateStep()) setStep((s) => s + 1);
  };

  const [signUpError, setSignUpError] = useState<string | null>(null);

  const handleBack = () => {
    setErrors({});
    setStep((s) => s - 1);
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!validateStep()) return;

    setLoading(true);
    setSignUpError(null);

    try {
      const { data, error: authError } = await supabase.auth.signUp({
        email: form.email,
        password: form.password,
        options: {
          data: {
            store_name: form.storeName,
            gst_number: form.gstNumber,
            business_type: form.businessType,
            owner_name: form.ownerName,
            phone: form.phone,
          },
        },
      });

      if (authError) {
        setSignUpError(authError.message);
        setLoading(false);
        return;
      }

      // Explicitly upsert the profile in public.users table (acts as fallback if trigger isn't run)
      if (data?.user) {
        const hashedPw = await hashPassword(form.password);
        const { error: dbError } = await supabase
          .from("users")
          .upsert({
            id: data.user.id,
            email: form.email,
            gst_id: form.gstNumber,
            password: hashedPw,
          });

        if (dbError) {
          console.warn("Public profile creation error:", dbError.message);
          // Note: We don't block registration success if only the public profile upsert failed,
          // as email confirmation or triggers might still be pending, but we log/display it.
        }
      }

      setLoading(false);
      navigate("/login");
    } catch (err: any) {
      setSignUpError(err?.message || "An unexpected error occurred. Please try again.");
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen bg-background flex items-center justify-center px-4 py-10">
      <div className="w-full animate-fade-in" style={{ maxWidth: "800px" }}>

        {/* Page header */}
        <div className="flex items-center justify-between mb-6">
          <div className="flex items-center gap-3">
            <div className="w-8 h-8 rounded bg-primary flex items-center justify-center">
              <ShieldCheck className="w-4 h-4 text-white" />
            </div>
            <span className="text-sm font-semibold text-text-primary">
              New Kaniyamparambil Stores
            </span>
          </div>
          <p className="text-caption text-text-secondary">
            Already registered?{" "}
            <Link
              to="/login"
              className="text-primary font-medium hover:text-primary-600 transition-colors duration-150"
            >
              Sign In
            </Link>
          </p>
        </div>

        {/* Main card */}
        <div className="bg-white border border-border rounded-lg shadow-card overflow-hidden">
          {/* Card header with step indicator */}
          <div className="px-8 py-6 border-b border-border">
            <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
              <div>
                <h1 className="text-lg font-semibold text-text-primary">
                  Create Business Account
                </h1>
                <p className="text-caption text-text-secondary mt-0.5">
                  Set up your enterprise billing system in 3 easy steps
                </p>
              </div>
              <StepIndicator current={step} total={3} />
            </div>
          </div>

          {/* Two-column form layout */}
          <form onSubmit={handleSubmit}>
            <div className="grid grid-cols-1 lg:grid-cols-5 min-h-[420px]">

              {/* LEFT: Form fields */}
              <div className="lg:col-span-3 px-8 py-6 border-r border-border">
                {/* Step title */}
                <div className="flex items-center gap-2.5 mb-6">
                  {(() => {
                    const s    = STEPS[step - 1];
                    const Icon = s.icon;
                    return (
                      <>
                        <div className="w-7 h-7 rounded bg-primary-50 flex items-center justify-center">
                          <Icon className="w-3.5 h-3.5 text-primary" />
                        </div>
                        <div>
                          <p className="text-caption text-text-secondary">
                            Step {step} of {STEPS.length}
                          </p>
                          <h2 className="text-base font-semibold text-text-primary leading-tight">
                            {s.label}
                          </h2>
                        </div>
                      </>
                    );
                  })()}
                </div>

                {/* General signup error */}
                {signUpError && (
                  <div className="flex items-start gap-2.5 p-3 mb-5 bg-danger-light border border-red-200 rounded text-sm text-danger animate-fade-in">
                    <AlertCircle className="w-4 h-4 flex-shrink-0 mt-0.5" />
                    <span>{signUpError}</span>
                  </div>
                )}

                {/* Step content */}
                <div className="animate-fade-in" key={step}>
                  {step === 1 && (
                    <Step1 data={form} errors={errors} onChange={handleChange} />
                  )}
                  {step === 2 && (
                    <Step2 data={form} errors={errors} onChange={handleChange} />
                  )}
                  {step === 3 && (
                    <Step3 data={form} errors={errors} onChange={handleChange} />
                  )}
                </div>
              </div>

              {/* RIGHT: Progress sidebar */}
              <div
                className="lg:col-span-2 px-6 py-6"
                style={{ background: "#FAFBFC" }}
              >
                {/* Progress steps */}
                <p className="text-caption font-semibold text-text-secondary uppercase tracking-wide mb-4">
                  Registration Progress
                </p>

                <div className="space-y-3">
                  {STEPS.map((s) => {
                    const done   = s.id < step;
                    const active = s.id === step;
                    const Icon   = s.icon;

                    return (
                      <div
                        key={s.id}
                        className={cn(
                          "flex items-start gap-3 p-3 rounded border transition-all duration-150",
                          active && "bg-white border-primary-100 shadow-sm",
                          done   && "border-transparent opacity-70",
                          !active && !done && "border-transparent opacity-40"
                        )}
                      >
                        <div
                          className={cn(
                            "w-6 h-6 rounded-full flex-shrink-0 flex items-center justify-center mt-0.5",
                            done   && "bg-primary",
                            active && "bg-primary-50 border-2 border-primary",
                            !done && !active && "bg-gray-100"
                          )}
                        >
                          {done ? (
                            <Check className="w-3 h-3 text-white" />
                          ) : (
                            <Icon
                              className={cn(
                                "w-3 h-3",
                                active ? "text-primary" : "text-text-secondary"
                              )}
                            />
                          )}
                        </div>
                        <div>
                          <p
                            className={cn(
                              "text-sm font-medium",
                              (active || done) ? "text-text-primary" : "text-text-secondary"
                            )}
                          >
                            {s.label}
                          </p>
                          <p className="text-caption text-text-secondary mt-0.5">
                            {s.id === 1 && "Store name, GST, business type"}
                            {s.id === 2 && "Owner name, phone, email"}
                            {s.id === 3 && "Password & confirmation"}
                          </p>
                        </div>
                      </div>
                    );
                  })}
                </div>

                {/* Security badge */}
                <div
                  className="mt-6 p-3 rounded border flex items-start gap-2"
                  style={{ borderColor: "#E5E7EB", background: "#FFFFFF" }}
                >
                  <ShieldCheck className="w-4 h-4 text-success flex-shrink-0 mt-0.5" />
                  <div>
                    <p className="text-caption font-semibold text-text-primary">
                      Bank-level Security
                    </p>
                    <p className="text-[11px] text-text-secondary mt-0.5 leading-relaxed">
                      Your data is encrypted with AES-256 and stored on secure,
                      compliant infrastructure.
                    </p>
                  </div>
                </div>

                {/* Completion percentage */}
                <div className="mt-5">
                  <div className="flex items-center justify-between mb-1.5">
                    <span className="text-caption text-text-secondary">Profile Completion</span>
                    <span className="text-caption font-semibold text-primary">
                      {Math.round(((step - 1) / 3) * 100)}%
                    </span>
                  </div>
                  <div className="h-1.5 bg-gray-100 rounded-full overflow-hidden">
                    <div
                      className="h-full bg-primary rounded-full transition-all duration-500"
                      style={{ width: `${((step - 1) / 3) * 100}%` }}
                    />
                  </div>
                </div>
              </div>
            </div>

            {/* Card footer: navigation buttons */}
            <div className="px-8 py-4 border-t border-border flex items-center justify-between bg-gray-50">
              <div>
                {step > 1 && (
                  <button
                    type="button"
                    onClick={handleBack}
                    className="btn-secondary"
                    disabled={loading}
                  >
                    <ChevronLeft className="w-4 h-4" />
                    Back
                  </button>
                )}
              </div>

              <div className="flex items-center gap-3">
                <span className="text-caption text-text-secondary">
                  Step {step} of {STEPS.length}
                </span>

                {step < 3 ? (
                  <button
                    type="button"
                    onClick={handleNext}
                    className="btn-primary"
                  >
                    Continue
                    <ChevronRight className="w-4 h-4" />
                  </button>
                ) : (
                  <button
                    type="submit"
                    className={cn(
                      "btn-primary",
                      loading && "opacity-75 cursor-not-allowed"
                    )}
                    disabled={loading}
                  >
                    {loading ? (
                      <span className="flex items-center gap-2">
                        <svg className="w-4 h-4 animate-spin" fill="none" viewBox="0 0 24 24">
                          <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                          <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
                        </svg>
                        Creating Account…
                      </span>
                    ) : (
                      <>
                        <Check className="w-4 h-4" />
                        Create Account
                      </>
                    )}
                  </button>
                )}
              </div>
            </div>
          </form>
        </div>

        {/* Footer */}
        <p className="mt-4 text-center text-caption text-text-secondary">
          © 2026 New Kaniyamparambil Stores · Enterprise Billing System · All rights reserved
        </p>
      </div>
    </div>
  );
}
