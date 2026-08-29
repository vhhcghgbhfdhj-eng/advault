import { createHash, randomBytes } from "crypto";

export const ADMIN_RECOVERY_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
export const ADMIN_RECOVERY_CODE_LEN = 32;

export function normalizeAdminRecoveryCode(value) {
  return String(value || "").toUpperCase().replace(/[^A-Z0-9]/g, "");
}

export function formatAdminRecoveryCode(value) {
  const raw = normalizeAdminRecoveryCode(value);
  return raw.match(/.{1,4}/g)?.join("-") || raw;
}

export function generateAdminRecoveryCode() {
  const bytes = randomBytes(ADMIN_RECOVERY_CODE_LEN);
  let out = "";
  for (let i = 0; i < ADMIN_RECOVERY_CODE_LEN; i += 1) {
    out += ADMIN_RECOVERY_ALPHABET[bytes[i] % ADMIN_RECOVERY_ALPHABET.length];
  }
  return formatAdminRecoveryCode(out);
}

export function hashAdminRecoveryCode(value) {
  return createHash("sha256").update(normalizeAdminRecoveryCode(value)).digest("hex");
}

export function buildAdminRecoveryRecord(userId, rawCode, createdAt) {
  return {
    userId: Number(userId),
    codeHash: hashAdminRecoveryCode(rawCode),
    createdAt: createdAt || new Date().toISOString(),
    used: false
  };
}
