import { createClient } from "@supabase/supabase-js";
import { existsSync, readFileSync, writeFileSync } from "fs";
import { dirname, isAbsolute, join } from "path";
import { fileURLToPath } from "url";
import { buildAdminRecoveryRecord, generateAdminRecoveryCode } from "./admin-recovery-core.mjs";

const __dirname = dirname(fileURLToPath(import.meta.url));
const args = new Set(process.argv.slice(2));
const APP_STATE_ID = "main";

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

function findAdmin(db) {
  const admins = (db.users || []).filter((item) => item.role === "admin");
  if (admins.length < 1) return null;
  admins.sort((a, b) => Number(a.id) - Number(b.id));
  return admins[0];
}

function snapshotAdmin(admin) {
  return {
    id: Number(admin.id),
    role: admin.role,
    balance: Number(admin.balance || 0),
    totalEarnings: Number(admin.totalEarnings || 0),
    totalWithdrawals: Number(admin.totalWithdrawals || 0),
    passwordHash: admin.passwordHash,
    salt: admin.salt
  };
}

function hasActiveAdminRecovery(db, adminId) {
  return (db.adminRecovery || []).some((item) => (
    Number(item.userId) === Number(adminId)
    && !item.used
    && Boolean(item.codeHash)
  ));
}

function applyAdminRecovery(db, adminId, rawCode) {
  const next = db;
  next.adminRecovery = (next.adminRecovery || []).filter((item) => Number(item.userId) !== Number(adminId));
  next.adminRecovery.push(buildAdminRecoveryRecord(adminId, rawCode));
  return next;
}

function assertAdminUnchanged(before, adminAfter) {
  return (
    adminAfter
    && adminAfter.role === before.role
    && Number(adminAfter.balance) === before.balance
    && Number(adminAfter.totalEarnings || 0) === before.totalEarnings
    && Number(adminAfter.totalWithdrawals || 0) === before.totalWithdrawals
    && adminAfter.passwordHash === before.passwordHash
    && adminAfter.salt === before.salt
  );
}

function assertNoPlaintext(db, rawCode) {
  const blob = JSON.stringify(db.adminRecovery || []);
  const compact = String(rawCode || "").replace(/-/g, "");
  return !blob.includes(rawCode) && !blob.includes(compact);
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

  const beforeRes = await client.from("app_state").select("payload").eq("id", APP_STATE_ID).maybeSingle();
  if (beforeRes.error || !beforeRes.data?.payload || typeof beforeRes.data.payload !== "object") {
    console.error("READ_FAILED");
    process.exit(1);
  }

  const db = beforeRes.data.payload;
  const admin = findAdmin(db);
  if (!admin) {
    console.error("ADMIN_MISSING");
    process.exit(1);
  }
  const before = snapshotAdmin(admin);
  console.log(`BEFORE_ACTIVE=${hasActiveAdminRecovery(db, before.id) ? "true" : "false"}`);

  const rawCode = generateAdminRecoveryCode();
  applyAdminRecovery(db, before.id, rawCode);
  const adminMid = (db.users || []).find((item) => Number(item.id) === before.id);
  if (!assertAdminUnchanged(before, adminMid) || !assertNoPlaintext(db, rawCode)) {
    console.error("WRITE_ABORTED");
    process.exit(1);
  }

  const writeRes = await client.from("app_state").upsert(
    { id: APP_STATE_ID, payload: db },
    { onConflict: "id" }
  );
  if (writeRes.error) {
    console.error("WRITE_FAILED");
    process.exit(1);
  }

  const afterRes = await client.from("app_state").select("payload").eq("id", APP_STATE_ID).maybeSingle();
  if (afterRes.error || !afterRes.data?.payload || typeof afterRes.data.payload !== "object") {
    console.error("VERIFY_FAILED");
    process.exit(1);
  }
  const afterDb = afterRes.data.payload;
  const adminAfter = (afterDb.users || []).find((item) => Number(item.id) === before.id);
  const rec = (afterDb.adminRecovery || []).find((item) => Number(item.userId) === before.id && !item.used);
  const afterActive = hasActiveAdminRecovery(afterDb, before.id);
  console.log(`AFTER_ACTIVE=${afterActive ? "true" : "false"}`);
  if (!afterActive || !rec || rec.used !== false || !assertAdminUnchanged(before, adminAfter) || !assertNoPlaintext(afterDb, rawCode)) {
    console.error("VERIFY_FAILED");
    process.exit(1);
  }

  printIssued(before.id, rawCode, "PRODUCTION_ADMIN_RECOVERY_ISSUED");
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
const admin = findAdmin(db);
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
