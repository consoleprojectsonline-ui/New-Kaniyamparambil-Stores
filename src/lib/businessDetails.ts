import type { User } from "@supabase/supabase-js";

export const DEFAULT_BUSINESS_DETAILS = {
  storeName: "New Kaniyamparambil Stores",
  storeDisplayName: "NEW KANIYAMPARAMBIL STORES",
  ownerName: "Jins Joseph",
  businessType: "Retail & Wholesale",
  gstin: "32AWJPJ1371N1ZE",
  pan: "AWJPJ1371N",
  phone: "9544363171",
  email: "newkaniyamparambilstorestkdy@gmail.com",
  address: "THOPRAMKUDY PO, THOPRAMKUDY, KERALA",
  stateCode: "32",
  state: "Kerala",
  bankName: "Federal Bank",
  accountNo: "13330100068606",
  ifsc: "FDRL0001333",
  branch: "Thopramkudy Branch",
  udyamNumber: "UDYAM-KL-03-0011336",
  udyamRegistrationDate: "2021-07-15",
  udyamEnterpriseType: "Micro Enterprise",
  udyamMajorActivity: "Trading — Retail",
  udyamNicCode: "4752",
} as const;

export interface BusinessDetails {
  storeName: string;
  storeDisplayName: string;
  ownerName: string;
  businessType: string;
  gstin: string;
  pan: string;
  phone: string;
  email: string;
  address: string;
  stateCode: string;
  state: string;
  bankName: string;
  accountNo: string;
  ifsc: string;
  branch: string;
  udyamNumber: string;
  udyamRegistrationDate: string;
  udyamEnterpriseType: string;
  udyamMajorActivity: string;
  udyamNicCode: string;
}

function formatDisplayDate(iso: string): string {
  if (!iso) return "—";
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return iso;
  return new Intl.DateTimeFormat("en-GB", {
    day: "2-digit",
    month: "short",
    year: "numeric",
  }).format(date);
}

export function resolveBusinessDetails(user: User | null): BusinessDetails {
  const meta = user?.user_metadata ?? {};
  const storeName = String(meta.store_name || DEFAULT_BUSINESS_DETAILS.storeName);
  const udyamDate = String(meta.udyam_registration_date || DEFAULT_BUSINESS_DETAILS.udyamRegistrationDate);

  return {
    storeName,
    storeDisplayName: storeName.toUpperCase(),
    ownerName: String(meta.owner_name || DEFAULT_BUSINESS_DETAILS.ownerName),
    businessType: String(meta.business_type || DEFAULT_BUSINESS_DETAILS.businessType),
    gstin: String(meta.gst_number || DEFAULT_BUSINESS_DETAILS.gstin).toUpperCase(),
    pan: String(meta.pan || DEFAULT_BUSINESS_DETAILS.pan).toUpperCase(),
    phone: String(meta.phone || DEFAULT_BUSINESS_DETAILS.phone),
    email: String(user?.email || DEFAULT_BUSINESS_DETAILS.email),
    address: String(meta.address || DEFAULT_BUSINESS_DETAILS.address),
    stateCode: String(meta.state_code || DEFAULT_BUSINESS_DETAILS.stateCode),
    state: String(meta.state || DEFAULT_BUSINESS_DETAILS.state),
    bankName: String(meta.bank_name || DEFAULT_BUSINESS_DETAILS.bankName),
    accountNo: String(meta.account_no || DEFAULT_BUSINESS_DETAILS.accountNo),
    ifsc: String(meta.ifsc || DEFAULT_BUSINESS_DETAILS.ifsc).toUpperCase(),
    branch: String(meta.bank_branch || DEFAULT_BUSINESS_DETAILS.branch),
    udyamNumber: String(meta.udyam_number || DEFAULT_BUSINESS_DETAILS.udyamNumber).toUpperCase(),
    udyamRegistrationDate: formatDisplayDate(udyamDate),
    udyamEnterpriseType: String(meta.udyam_enterprise_type || DEFAULT_BUSINESS_DETAILS.udyamEnterpriseType),
    udyamMajorActivity: String(meta.udyam_major_activity || DEFAULT_BUSINESS_DETAILS.udyamMajorActivity),
    udyamNicCode: String(meta.udyam_nic_code || DEFAULT_BUSINESS_DETAILS.udyamNicCode),
  };
}
