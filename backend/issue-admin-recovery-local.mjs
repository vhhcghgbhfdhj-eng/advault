import { createClient } from "@supabase/supabase-js";
import { existsSync, readFileSync, writeFileSync } from "fs";
import { dirname, isAbsolute, join } from "path";
import { fileURLToPath } from "url";
import { generateAdminRecoveryCode } from "./admin-recovery-core.mjs";
import {
  applyAdminRecovery,
  assertAdminUnchanged,
  assertNoPlaintext,
  findFirstAdmin,
  hasActiveAdminRecovery,
  runIssueProductionAdminRecovery,
  snapshotAdmin
} from "./issue-admin-recovery-ops.mjs";

const __dirname = dirname(fileURLToPath(import.meta.url));
const args = new Set(process.argv.slice(2));

function loadBackendDotEnv() {
  const envPath = join(__dirname, ".env");
  const parsed = {};
  if (!existsSync(envPath)) return parsed;
  String(readFileSync(envPath, "utf8")).split(/\r?\n/).forEach((line) => {
    const trimmed = String(line || "").trim();
    if (!trimmed || trimmed.startsWith("#")) return;
    const idx = trimmed.indexOf("=");
    if (idx < 1) return;
    const name = trimmed.slice(0, idx).trim();
    let value = trimmed.slice(idx + 1).trim();
    if ((value.startsWith("\"") && value.endsWith("\"")) || (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1);
    }
    if (name) parsed[name] = value;
  });
  return parsed;
}

function printIssued(adminId, rawCode, label) {
  console.log(label);
  console.log(`ADMIN_ID=${adminId}`);
  console.log("SAVE_THIS_CODE_ONCE");
  console.log(rawCode);
}

if (args.has("--production") && args.has("--local-only")) {
  console.error("REFUSED_AMBIGUOUS_MODE");
  process.exit(1);
}

if (args.has("--production")) {
  const envFile = loadBackendDotEnv();
  const supabaseUrl = String(process.env.SUPABASE_URL || envFile.SUPABASE_URL || "").trim();
  const supabaseKey = String(process.env.SUPABASE_SECRET_KEY || envFile.SUPABASE_SECRET_KEY || "").trim();
  if (!supabaseUrl || !supabaseKey) {
    console.error("SUPABASE_ENV_MISSING");
    process.exit(1);
  }

  const client = createClient(supabaseUrl, supabaseKey, {
    auth: { persistSession: false, autoRefreshToken: false }
  });

  const issued = await runIssueProductionAdminRecovery(client);
  if (!issued.ok) {
    console.error(issued.error || "ISSUE_FAILED");
    process.exit(1);
  }
  console.log(`BEFORE_ACTIVE=${issued.beforeActive ? "true" : "false"}`);
  console.log(`AFTER_ACTIVE=${issued.afterActive ? "true" : "false"}`);
  printIssued(issued.adminId, issued.rawCode, "PRODUCTION_ADMIN_RECOVERY_ISSUED");
  process.exit(0);
}

if (String(process.env.RENDER || "").trim()) {
  console.error("REFUSED_RENDER");
  process.exit(1);
}

if (!args.has("--local-only")) {
  console.error("Usage: node issue-admin-recovery-local.mjs --local-only | --production");
  process.exit(1);
}

const override = String(process.env.ADVAULT_DB_PATH || "").trim();
const dbPath = override
  ? (isAbsolute(override) ? override : join(__dirname, override))
  : join(__dirname, "data.json");

if (!existsSync(dbPath)) {
  console.error("DB_MISSING");
  process.exit(1);
}

const db = JSON.parse(readFileSync(dbPath, "utf8"));
const admin = findFirstAdmin(db);
if (!admin) {
  console.error("ADMIN_MISSING");
  process.exit(1);
}
const snapshot = snapshotAdmin(admin);
console.log(`BEFORE_ACTIVE=${hasActiveAdminRecovery(db, snapshot.id) ? "true" : "false"}`);

const rawCode = generateAdminRecoveryCode();
applyAdminRecovery(db, snapshot.id, rawCode);
writeFileSync(dbPath, JSON.stringify(db, null, 2));

const after = JSON.parse(readFileSync(dbPath, "utf8"));
const rec = (after.adminRecovery || []).find((item) => Number(item.userId) === snapshot.id);
const adminAfter = (after.users || []).find((item) => Number(item.id) === snapshot.id);
const afterActive = hasActiveAdminRecovery(after, snapshot.id);
console.log(`AFTER_ACTIVE=${afterActive ? "true" : "false"}`);
if (!afterActive || !rec?.codeHash || rec.used || !assertNoPlaintext(after, rawCode) || !assertAdminUnchanged(snapshot, adminAfter)) {
  console.error("WRITE_FAILED");
  process.exit(1);
}

printIssued(snapshot.id, rawCode, "LOCAL_ADMIN_RECOVERY_ISSUED");
