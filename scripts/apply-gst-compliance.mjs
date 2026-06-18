/**
 * Applies sql/12_gst_compliance_columns.sql to Supabase Postgres.
 *
 * Usage:
 *   set DATABASE_URL=postgresql://postgres.[ref]:[password]@...supabase.com:5432/postgres
 *   npm run db:gst
 *
 * Or paste sql/12_gst_compliance_columns.sql into Supabase → SQL Editor.
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, "..");

function loadEnvFile() {
  const envPath = path.join(root, ".env");
  if (!fs.existsSync(envPath)) return;
  for (const line of fs.readFileSync(envPath, "utf8").split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const eq = trimmed.indexOf("=");
    if (eq === -1) continue;
    const key = trimmed.slice(0, eq).trim();
    const value = trimmed.slice(eq + 1).trim();
    if (!(key in process.env)) process.env[key] = value;
  }
}

loadEnvFile();

const databaseUrl = process.env.DATABASE_URL || process.env.SUPABASE_DB_URL;
if (!databaseUrl) {
  console.error(
    "Missing DATABASE_URL (or SUPABASE_DB_URL).\n"
    + "Get it from Supabase → Project Settings → Database → Connection string (URI).\n"
    + "Alternatively, run sql/12_gst_compliance_columns.sql in the SQL Editor.",
  );
  process.exit(1);
}

const sqlPath = path.join(root, "sql", "12_gst_compliance_columns.sql");
const sql = fs.readFileSync(sqlPath, "utf8");

let pg;
try {
  pg = await import("pg");
} catch {
  console.error("Install pg first: npm install -D pg");
  process.exit(1);
}

const client = new pg.default.Client({ connectionString: databaseUrl, ssl: { rejectUnauthorized: false } });

try {
  await client.connect();
  await client.query(sql);
  console.log("GST compliance columns applied successfully.");

  const checks = [
    ["sales", "customer_gstin"],
    ["sales", "reverse_charge"],
    ["sales", "total_igst"],
    ["sales_b2b", "reverse_charge"],
    ["sales_b2b", "total_sgst"],
    ["sales_b2b", "total_cgst"],
    ["sales_b2b", "total_igst"],
  ];
  for (const [table, column] of checks) {
    const { rows } = await client.query(
      `select 1 from information_schema.columns
       where table_schema = 'public' and table_name = $1 and column_name = $2`,
      [table, column],
    );
    console.log(rows.length ? "OK" : "MISSING", `${table}.${column}`);
  }
} catch (err) {
  console.error("Migration failed:", err instanceof Error ? err.message : err);
  process.exit(1);
} finally {
  await client.end();
}
