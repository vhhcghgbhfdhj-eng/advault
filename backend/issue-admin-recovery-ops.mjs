import { buildAdminRecoveryRecord, generateAdminRecoveryCode } from "./admin-recovery-core.mjs";

export const APP_STATE_ID = "main";

export function findFirstAdmin(db) {
  const admins = (db.users || []).filter((item) => item.role === "admin");
  if (admins.length < 1) return null;
  admins.sort((a, b) => Number(a.id) - Number(b.id));
  return admins[0];
}

export function snapshotAdmin(admin) {
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

export function hasActiveAdminRecovery(db, adminId) {
  return (db.adminRecovery || []).some((item) => (
    Number(item.userId) === Number(adminId)
    && !item.used
    && Boolean(item.codeHash)
  ));
}

export function applyAdminRecovery(db, adminId, rawCode) {
  const next = db;
  next.adminRecovery = (next.adminRecovery || []).filter((item) => Number(item.userId) !== Number(adminId));
  next.adminRecovery.push(buildAdminRecoveryRecord(adminId, rawCode));
  return next;
}

export function assertAdminUnchanged(before, adminAfter) {
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

export function assertNoPlaintext(db, rawCode) {
  const blob = JSON.stringify(db.adminRecovery || []);
  const compact = String(rawCode || "").replace(/-/g, "");
  return !blob.includes(rawCode) && !blob.includes(compact);
}

export async function runIssueProductionAdminRecovery(client) {
  if (!client) return { ok: false, error: "SUPABASE_ENV_MISSING" };

  const beforeRes = await client.from("app_state").select("payload").eq("id", APP_STATE_ID).maybeSingle();
  if (beforeRes.error || !beforeRes.data?.payload || typeof beforeRes.data.payload !== "object") {
    return { ok: false, error: "READ_FAILED" };
  }

  const db = beforeRes.data.payload;
  const admin = findFirstAdmin(db);
  if (!admin) return { ok: false, error: "ADMIN_MISSING" };
  const before = snapshotAdmin(admin);
  const beforeActive = hasActiveAdminRecovery(db, before.id);

  const rawCode = generateAdminRecoveryCode();
  applyAdminRecovery(db, before.id, rawCode);
  const adminMid = (db.users || []).find((item) => Number(item.id) === before.id);
  if (!assertAdminUnchanged(before, adminMid) || !assertNoPlaintext(db, rawCode)) {
    return { ok: false, error: "WRITE_ABORTED" };
  }

  const writeRes = await client.from("app_state").upsert(
    { id: APP_STATE_ID, payload: db },
    { onConflict: "id" }
  );
  if (writeRes.error) return { ok: false, error: "WRITE_FAILED" };

  const afterRes = await client.from("app_state").select("payload").eq("id", APP_STATE_ID).maybeSingle();
  if (afterRes.error || !afterRes.data?.payload || typeof afterRes.data.payload !== "object") {
    return { ok: false, error: "VERIFY_FAILED" };
  }
  const afterDb = afterRes.data.payload;
  const adminAfter = (afterDb.users || []).find((item) => Number(item.id) === before.id);
  const rec = (afterDb.adminRecovery || []).find((item) => Number(item.userId) === before.id && !item.used);
  const afterActive = hasActiveAdminRecovery(afterDb, before.id);
  if (!afterActive || !rec || rec.used !== false || !assertAdminUnchanged(before, adminAfter) || !assertNoPlaintext(afterDb, rawCode)) {
    return { ok: false, error: "VERIFY_FAILED" };
  }

  return {
    ok: true,
    adminId: before.id,
    beforeActive,
    afterActive,
    rawCode,
    adminRecovery: afterDb.adminRecovery
  };
}
