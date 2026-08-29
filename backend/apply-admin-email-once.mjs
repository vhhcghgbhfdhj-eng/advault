import { createClient } from "@supabase/supabase-js";
import { existsSync, readFileSync } from "fs";
import { join } from "path";

function loadEnv() {
  const env = {};
  const envPath = join(process.cwd(), ".env");
  if (!existsSync(envPath)) return env;
  for (const line of readFileSync(envPath, "utf8").split(/\r?\n/)) {
    const trimmed = String(line || "").trim();
    if (!trimmed || trimmed.startsWith("#") || !trimmed.includes("=")) continue;
    const idx = trimmed.indexOf("=");
    const name = trimmed.slice(0, idx).trim();
    let value = trimmed.slice(idx + 1).trim();
    if ((value.startsWith("\"") && value.endsWith("\"")) || (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1);
    }
    if (name && env[name] === undefined) env[name] = value;
  }
  return env;
}

function readNewEmail() {
  const raw = readFileSync(join(process.cwd(), ".admin-new-email"), "utf8");
  const line = raw.split(/\r?\n/).map((item) => item.trim()).find((item) => item && !item.startsWith("#"));
  return String(line || "").trim().toLowerCase();
}

const env = loadEnv();
const url = String(process.env.SUPABASE_URL || env.SUPABASE_URL || "").trim();
const key = String(process.env.SUPABASE_SECRET_KEY || env.SUPABASE_SECRET_KEY || "").trim();
const newEmail = readNewEmail();
if (!url || !key) {
  console.log(JSON.stringify({ ok: false, reason: "missing_env" }));
  process.exit(1);
}
if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(newEmail) || newEmail.endsWith(".coms")) {
  console.log(JSON.stringify({ ok: false, reason: "invalid_email_in_file" }));
  process.exit(1);
}

const client = createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });
const before = await client.from("app_state").select("payload").eq("id", "main").maybeSingle();
if (before.error || !before.data?.payload) {
  console.log(JSON.stringify({ ok: false, reason: "read_fail" }));
  process.exit(1);
}

const payload = JSON.parse(JSON.stringify(before.data.payload));
const users = payload.users || [];
const admin = users.find((user) => Number(user.id) === 1);
const other = users.find((user) => Number(user.id) === 2);
if (!admin || String(admin.role) !== "admin") {
  console.log(JSON.stringify({ ok: false, reason: "admin_missing" }));
  process.exit(1);
}
const currentEmail = String(admin.email || "").trim().toLowerCase();
if (currentEmail !== "admin@advault.tt" && currentEmail !== newEmail) {
  console.log(JSON.stringify({ ok: false, reason: "unexpected_admin_email" }));
  process.exit(1);
}
if (users.some((user) => Number(user.id) !== 1 && String(user.email || "").trim().toLowerCase() === newEmail)) {
  console.log(JSON.stringify({ ok: false, reason: "email_taken" }));
  process.exit(1);
}

const beforeAdmin = {
  balance: Number(admin.balance || 0),
  totalEarnings: Number(admin.totalEarnings || 0),
  totalWithdrawals: Number(admin.totalWithdrawals || 0)
};
const beforeOther = other ? JSON.stringify({
  id: Number(other.id),
  email: String(other.email || "").toLowerCase(),
  role: String(other.role || ""),
  balance: Number(other.balance || 0),
  totalEarnings: Number(other.totalEarnings || 0),
  totalWithdrawals: Number(other.totalWithdrawals || 0)
}) : null;

let wrote = false;
if (currentEmail !== newEmail) {
  admin.email = newEmail;
  const write = await client.from("app_state").upsert({ id: "main", payload }, { onConflict: "id" });
  if (write.error) {
    console.log(JSON.stringify({ ok: false, reason: "write_fail" }));
    process.exit(1);
  }
  wrote = true;
}

const after = await client.from("app_state").select("payload").eq("id", "main").maybeSingle();
const afterUsers = after.data?.payload?.users || [];
const afterAdmin = afterUsers.find((user) => Number(user.id) === 1);
const afterOther = afterUsers.find((user) => Number(user.id) === 2);
const afterOtherSnap = afterOther ? JSON.stringify({
  id: Number(afterOther.id),
  email: String(afterOther.email || "").toLowerCase(),
  role: String(afterOther.role || ""),
  balance: Number(afterOther.balance || 0),
  totalEarnings: Number(afterOther.totalEarnings || 0),
  totalWithdrawals: Number(afterOther.totalWithdrawals || 0)
}) : null;

console.log(JSON.stringify({
  ok: true,
  wrote,
  adminId: Number(afterAdmin?.id),
  role: afterAdmin?.role,
  balance: Number(afterAdmin?.balance || 0),
  balanceUnchanged: Number(afterAdmin?.balance || 0) === beforeAdmin.balance && Number(afterAdmin?.balance || 0) === 1119.73,
  emailUpdated: String(afterAdmin?.email || "").trim().toLowerCase() === newEmail,
  oldEmailCleared: String(afterAdmin?.email || "").trim().toLowerCase() !== "admin@advault.tt",
  user2Unchanged: beforeOther === afterOtherSnap
}));
