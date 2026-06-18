import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createClient } from "@supabase/supabase-js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, "..");
const env = fs.readFileSync(path.join(root, ".env"), "utf8");
const url = env.match(/VITE_SUPABASE_URL=(.+)/)?.[1]?.trim();
const key = env.match(/VITE_SUPABASE_ANON_KEY=(.+)/)?.[1]?.trim();

if (!url || !key) {
  console.error("Missing VITE_SUPABASE_URL or VITE_SUPABASE_ANON_KEY in .env");
  process.exit(1);
}

const sb = createClient(url, key);

async function probe(table, column) {
  const { error } = await sb.from(table).select(column).limit(1);
  return !error;
}

const columns = [
  ["sales", "customer_gstin"],
  ["sales", "reverse_charge"],
  ["sales", "total_igst"],
  ["sales_b2b", "reverse_charge"],
  ["sales_b2b", "total_sgst"],
  ["sales_b2b", "total_cgst"],
  ["sales_b2b", "total_igst"],
];

let missing = 0;
for (const [table, column] of columns) {
  const ok = await probe(table, column);
  console.log(ok ? "OK" : "MISSING", `${table}.${column}`);
  if (!ok) missing += 1;
}

if (missing > 0) {
  console.log(`\n${missing} column(s) missing. Run sql/12_gst_compliance_columns.sql in Supabase SQL Editor, or npm run db:gst with DATABASE_URL set.`);
  process.exit(1);
}

console.log("\nAll GST compliance columns are present.");
