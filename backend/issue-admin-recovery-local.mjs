import { existsSync, readFileSync, writeFileSync } from "fs";
import { dirname, isAbsolute, join } from "path";
import { fileURLToPath } from "url";
import { buildAdminRecoveryRecord, generateAdminRecoveryCode } from "./admin-recovery-core.mjs";

const __dirname = dirname(fileURLToPath(import.meta.url));
const args = new Set(process.argv.slice(2));

if (String(process.env.RENDER || "").trim()) {
  console.error("REFUSED_RENDER");
  process.exit(1);
}

if (!args.has("--local-only")) {
  console.error("Usage: node issue-admin-recovery-local.mjs --local-only");
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
const admins = (db.users || []).filter((item) => item.role === "admin");
if (admins.length < 1) {
  console.error("ADMIN_MISSING");
  process.exit(1);
}
admins.sort((a, b) => Number(a.id) - Number(b.id));
const admin = admins[0];
const snapshot = {
  id: Number(admin.id),
  role: admin.role,
  balance: Number(admin.balance || 0),
  email: admin.email,
  passwordHash: admin.passwordHash,
  salt: admin.salt
};

const rawCode = generateAdminRecoveryCode();
db.adminRecovery = (db.adminRecovery || []).filter((item) => Number(item.userId) !== snapshot.id);
db.adminRecovery.push(buildAdminRecoveryRecord(snapshot.id, rawCode));
writeFileSync(dbPath, JSON.stringify(db, null, 2));

const after = JSON.parse(readFileSync(dbPath, "utf8"));
const rec = (after.adminRecovery || []).find((item) => Number(item.userId) === snapshot.id);
const adminAfter = (after.users || []).find((item) => Number(item.id) === snapshot.id);
if (!rec?.codeHash || rec.used) {
  console.error("WRITE_FAILED");
  process.exit(1);
}
if (JSON.stringify(after.adminRecovery).includes(rawCode.replace(/-/g, ""))) {
  console.error("PLAINTEXT_LEAK");
  process.exit(1);
}
if (
  adminAfter.role !== snapshot.role
  || Number(adminAfter.balance) !== snapshot.balance
  || adminAfter.passwordHash !== snapshot.passwordHash
  || adminAfter.salt !== snapshot.salt
) {
  console.error("ADMIN_DATA_CHANGED");
  process.exit(1);
}

console.log("LOCAL_ADMIN_RECOVERY_ISSUED");
console.log(`ADMIN_ID=${snapshot.id}`);
console.log("SAVE_THIS_CODE_ONCE");
console.log(rawCode);
