import express from "express";
import cors from "cors";
import { createClient } from "@supabase/supabase-js";
import { randomBytes, scryptSync, timingSafeEqual } from "crypto";
import { existsSync, mkdirSync, readFileSync, unlinkSync, writeFileSync } from "fs";
import { dirname, join } from "path";
import { fileURLToPath } from "url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const DB_PATH = join(__dirname, "data.json");
const UPLOADS_DIR = join(__dirname, "uploads");
if (!existsSync(UPLOADS_DIR)) mkdirSync(UPLOADS_DIR, { recursive: true });
const PORT = process.env.PORT || 3000;
const TOKEN_TTL_MS = 7 * 24 * 60 * 60 * 1000;
const MAX_REFERRALS_PER_IP_PER_DAY = 5;

const DEFAULT_REFERRAL_SETTINGS = {
  signupInviter: 15,
  signupInvited: 1,
  maxLevels: 3,
  levels: [
    { level: 1, name: "مباشر", taskRate: 0.1, vipRate: 0.1, signupBonus: 0 },
    { level: 2, name: "المستوى 2", taskRate: 0.03, vipRate: 0.03, signupBonus: 0 },
    { level: 3, name: "المستوى 3", taskRate: 0.01, vipRate: 0.01, signupBonus: 0 }
  ]
};

/*
  Database tables (persisted JSON):
  - users: wallet fields balance, totalEarnings, totalWithdrawals
  - transactions: type, amount, status, note, createdAt, balanceAfter
  - vipCancelRequests, conversations, messages, adViews
*/

const FREE_ADS_PER_DAY = 0;
const AD_REWARDS = [0.03, 0.05, 0.1, 0.2, 0.5, 1];
const AD_WATCH_DURATIONS = [15, 30, 40, 50, 60];

const VIP_PACKAGES = [
  { level: 1, name: "VIP", price: 50, adsPerDay: 20, gift: 5 },
  { level: 2, name: "VIP 1", price: 100, adsPerDay: 30, gift: 10 },
  { level: 3, name: "VIP 2", price: 200, adsPerDay: 40, gift: 20 },
  { level: 4, name: "VIP 3", price: 300, adsPerDay: 50, gift: 30 },
  { level: 5, name: "VIP 4", price: 400, adsPerDay: 60, gift: 40 }
];

const DEFAULT_AD_CREATIVE_SET = { enabled: false, images: [] };
const MAX_AD_IMAGES = 200;

function hashPassword(password, salt = randomBytes(16).toString("hex")) {
  const passwordHash = scryptSync(password, salt, 64).toString("hex");
  return { passwordHash, salt };
}

function verifyPassword(password, salt, passwordHash) {
  const hashed = scryptSync(password, salt, 64);
  const stored = Buffer.from(passwordHash, "hex");
  return hashed.length === stored.length && timingSafeEqual(hashed, stored);
}

function nowIso() {
  return new Date().toISOString();
}

function audit(event, fields = {}) {
  const safe = {};
  Object.entries(fields).forEach(([key, value]) => {
    const k = String(key).toLowerCase();
    if (k.includes("password") || k.includes("token") || k.includes("hash") || k.includes("salt")) return;
    if (k.includes("address") || k.includes("txhash") || k.includes("hash")) {
      const text = String(value || "");
      safe[key] = text.length > 8 ? `${text.slice(0, 4)}…${text.slice(-4)}` : "[redacted]";
      return;
    }
    safe[key] = value;
  });
  console.log("AUDIT", event, safe);
}

function nextId(rows) {
  return rows.reduce((max, row) => Math.max(max, row.id || 0), 0) + 1;
}

function bumpMaxId(max, value) {
  const n = numericId(value);
  return n && n > max ? n : max;
}

function allocateUserId() {
  let max = 0;
  (db.users || []).forEach((item) => { max = bumpMaxId(max, item.id); });
  (db.sessions || []).forEach((item) => { max = bumpMaxId(max, item.userId); });
  [
    db.transactions,
    db.vipRequests,
    db.vipCancelRequests,
    db.withdrawRequests,
    db.rechargeRequests,
    db.completions,
    db.adViews,
    db.conversations
  ].forEach((rows) => {
    (rows || []).forEach((item) => { max = bumpMaxId(max, item.userId); });
  });
  (db.referrals || []).forEach((item) => {
    max = bumpMaxId(max, item.inviterId);
    max = bumpMaxId(max, item.invitedId);
    max = bumpMaxId(max, item.beneficiaryId);
  });
  (db.messages || []).forEach((item) => { max = bumpMaxId(max, item.senderId); });
  const newId = max + 1;
  if (!numericId(newId) || (db.users || []).some((item) => sameId(item.id, newId))) {
    throw new Error("تعذر إنشاء معرّف المستخدم");
  }
  return newId;
}

function makeReferralCode() {
  return "TT" + randomBytes(3).toString("hex").toUpperCase();
}

function uniqueReferralCode() {
  let code = makeReferralCode();
  while (db.users.some((item) => item.referralCode === code)) {
    code = makeReferralCode();
  }
  return code;
}

function clientIp(req) {
  return String(req.headers["x-forwarded-for"] || req.socket?.remoteAddress || "")
    .split(",")[0]
    .trim();
}

function numericId(value) {
  const n = Number(value);
  return Number.isInteger(n) && n > 0 ? n : null;
}

function sameId(a, b) {
  const left = numericId(a);
  const right = numericId(b);
  return left !== null && right !== null && left === right;
}

function invitedUsers(inviterId, level = 1) {
  const id = numericId(inviterId);
  if (!id) return [];
  if (level === 1) {
    return db.users.filter((item) => sameId(item.referredBy, id) && !sameId(item.id, id));
  }
  return db.users.filter((item) => sameId((item.inviterPath || [])[level - 1], id) && !sameId(item.id, id));
}

function ownedReferralRows(userId) {
  const id = numericId(userId);
  if (!id) return [];
  return (db.referrals || []).filter((item) => {
    if (!sameId(item.inviterId, id) || !sameId(item.beneficiaryId, id)) return false;
    const invited = db.users.find((row) => sameId(row.id, item.invitedId));
    return invited && sameId(invited.referredBy, id);
  });
}

function referralPayload(user) {
  const uid = numericId(user.id);
  const settings = getReferralSettings();
  const network = settings.levels.map((cfg) => {
    const members = invitedUsers(uid, cfg.level).map((item) => ({
      id: item.id,
      name: item.name,
      email: item.email,
      vipName: getVip(item).name,
      vipStatus: getActiveVipLevel(item) > 0 ? "active" : "none",
      createdAt: item.createdAt,
      level: cfg.level
    }));
    return {
      level: cfg.level,
      name: cfg.name,
      taskRate: cfg.taskRate,
      vipRate: cfg.vipRate,
      signupBonus: cfg.signupBonus,
      count: members.length,
      members
    };
  });
  const invited = network[0]?.members || [];
  const mine = ownedReferralRows(uid);
  return {
    userId: uid,
    code: user.referralCode,
    invitedCount: invited.length,
    networkCount: network.reduce((sum, item) => sum + item.count, 0),
    earned: roundMoney(mine.reduce((sum, item) => sum + Number(item.amount || 0), 0)),
    referredBy: null,
    inviterName: null,
    rewards: {
      signupInviter: settings.signupInviter,
      signupInvited: settings.signupInvited,
      taskRate: settings.levels[0]?.taskRate || 0,
      vipRate: settings.levels[0]?.vipRate || 0,
      levels: settings.levels
    },
    network,
    invited,
    history: mine.slice(-100).reverse().map((item) => ({
      ...item,
      invitedName: db.users.find((row) => sameId(row.id, item.invitedId))?.name || "",
      typeLabel: item.type
    }))
  };
}

function getReferralSettings() {
  const stored = db.referralSettings || {};
  const levels = (stored.levels || DEFAULT_REFERRAL_SETTINGS.levels).map((item, index) => ({
    ...DEFAULT_REFERRAL_SETTINGS.levels[index],
    ...item,
    level: Number(item.level || index + 1)
  }));
  return {
    ...DEFAULT_REFERRAL_SETTINGS,
    ...stored,
    signupInviter: 15,
    levels
  };
}

function buildInviterPath(user, seen = new Set()) {
  if (!user?.referredBy) return [];
  if (seen.has(user.id)) return [];
  seen.add(user.id);
  const inviter = db.users.find((item) => item.id === user.referredBy);
  if (!inviter || inviter.id === user.id) return [];
  const settings = db.referralSettings || DEFAULT_REFERRAL_SETTINGS;
  return [inviter.id, ...buildInviterPath(inviter, seen)].slice(0, settings.maxLevels || 3);
}

function networkSummary(userId) {
  const settings = getReferralSettings();
  return settings.levels.map((cfg) => ({
    level: cfg.level,
    name: cfg.name,
    count: invitedUsers(userId, cfg.level).length,
    taskRate: cfg.taskRate,
    vipRate: cfg.vipRate,
    signupBonus: cfg.signupBonus
  }));
}

function addReferralRecord({ inviterId, invitedId, code, type, amount, beneficiaryId, note, level = 1 }) {
  const row = {
    id: nextId(db.referrals),
    inviterId,
    invitedId,
    level,
    code: code || "",
    type,
    amount: roundMoney(amount),
    beneficiaryId,
    status: "completed",
    note: note || "",
    createdAt: nowIso()
  };
  db.referrals.push(row);
  return row;
}

function payNetworkCommissions(sourceUser, { type, baseAmount, notePrefix }) {
  const settings = getReferralSettings();
  const path = sourceUser.inviterPath?.length ? sourceUser.inviterPath : buildInviterPath(sourceUser);
  path.forEach((ancestorId, index) => {
    const level = index + 1;
    if (level > settings.maxLevels) return;
    const cfg = settings.levels.find((item) => item.level === level);
    if (!cfg) return;
    const rate = type === "vip_commission" ? Number(cfg.vipRate || 0) : Number(cfg.taskRate || 0);
    const amount = roundMoney(baseAmount * rate);
    if (!(amount > 0)) return;
    const ancestor = db.users.find((item) => item.id === ancestorId);
    if (!ancestor || ancestor.id === sourceUser.id) return;
    creditWallet(ancestor, "referral", amount, `${notePrefix} · مستوى ${level}`);
    addReferralRecord({
      inviterId: ancestor.id,
      invitedId: sourceUser.id,
      code: ancestor.referralCode,
      type,
      amount,
      beneficiaryId: ancestor.id,
      note: `${notePrefix} · مستوى ${level}`,
      level
    });
  });
}

const DEFAULT_WALLET_SETTINGS = {
  currency: "USDT",
  network: "TRC20",
  companyAddress: "TADVAULTUSDTCOMPANYWALLET00001",
  minDeposit: 10,
  minWithdraw: 10,
  minInvitesForWithdraw: 0,
  minInvitesForWithdrawByUser: {},
  withdrawCooldownMs: 7 * 24 * 60 * 60 * 1000
};

function isSettled(status) {
  return status === "approved" || status === "completed";
}

function getWalletSettings() {
  const stored = db.walletSettings || {};
  return {
    ...DEFAULT_WALLET_SETTINGS,
    ...stored,
    minInvitesForWithdraw: normalizeMinInvitesForWithdraw(stored.minInvitesForWithdraw, DEFAULT_WALLET_SETTINGS.minInvitesForWithdraw),
    minInvitesForWithdrawByUser: sanitizeInviteOverrideMap(stored.minInvitesForWithdrawByUser),
    withdrawCooldownMs: normalizeWithdrawCooldownMs(stored.withdrawCooldownMs)
  };
}

function normalizeWithdrawCooldownMs(value) {
  const n = Number(value);
  if (Number.isFinite(n) && n > 0) return Math.floor(n);
  return DEFAULT_WALLET_SETTINGS.withdrawCooldownMs;
}

function lastWithdrawRequest(userId) {
  return (db.withdrawRequests || [])
    .filter((item) => sameId(item.userId, userId))
    .sort((a, b) => Date.parse(b.createdAt || 0) - Date.parse(a.createdAt || 0))[0] || null;
}

function lastEligibleWithdrawRequest(userId) {
  const last = lastWithdrawRequest(userId);
  if (!last) return null;
  const status = String(last.status || "").toLowerCase();
  if (status === "pending" || status === "approved") return last;
  return null;
}

function formatWithdrawCooldownWait(ms) {
  const totalMinutes = Math.max(1, Math.ceil(Number(ms) / 60000));
  const days = Math.floor(totalMinutes / (60 * 24));
  const hours = Math.floor((totalMinutes % (60 * 24)) / 60);
  const minutes = totalMinutes % 60;
  const parts = [];
  if (days) parts.push(`${days} يوم`);
  if (hours) parts.push(`${hours} ساعة`);
  if (!days && (minutes || !hours)) parts.push(`${minutes} دقيقة`);
  return parts.join(" و ");
}

function normalizeMinInvitesForWithdraw(value, fallback = 0) {
  const n = Number(value);
  if (!Number.isFinite(n)) return Math.max(0, Math.floor(Number(fallback) || 0));
  return Math.max(0, Math.floor(n));
}

function sanitizeInviteOverrideMap(raw) {
  const out = {};
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return out;
  Object.entries(raw).forEach(([key, value]) => {
    const id = numericId(key);
    if (!id) return;
    out[String(id)] = normalizeMinInvitesForWithdraw(value, 0);
  });
  return out;
}

function requiredInvitesForWithdraw(userId) {
  const settings = getWalletSettings();
  const id = numericId(userId);
  const map = settings.minInvitesForWithdrawByUser || {};
  if (id && Object.prototype.hasOwnProperty.call(map, String(id))) {
    return map[String(id)];
  }
  return settings.minInvitesForWithdraw;
}

function qualifiedInviteCount(userId) {
  return invitedUsers(userId, 1).length;
}

function pendingWithdrawTotal(userId) {
  const id = numericId(userId);
  if (!id) return 0;
  return roundMoney(
    db.withdrawRequests
      .filter((item) => sameId(item.userId, id) && item.status === "pending")
      .reduce((sum, item) => sum + Number(item.amount || 0), 0)
  );
}

function availableBalance(user) {
  return roundMoney((user.balance || 0) - pendingWithdrawTotal(user.id));
}

const EARNING_TYPES = new Set(["task_reward", "referral"]);

function creditWallet(user, type, amount, note) {
  return recordTransaction(user, { type, amount, status: "approved", note });
}

function recordTransaction(user, { type, amount, status = "approved", note, applyBalance = true, extra = {} }) {
  const delta = roundMoney(amount);
  if (applyBalance) user.balance = roundMoney((user.balance || 0) + delta);
  if (isSettled(status)) {
    if (delta > 0 && EARNING_TYPES.has(type)) {
      user.totalEarnings = roundMoney((user.totalEarnings || 0) + delta);
    }
    if (type === "withdraw") {
      user.totalWithdrawals = roundMoney((user.totalWithdrawals || 0) + Math.abs(delta));
    }
  }
  return addTransaction(user.id, type, delta, status, note, user.balance, extra);
}

function userTransactions(userId) {
  const id = numericId(userId);
  if (!id) return [];
  return db.transactions
    .filter((item) => sameId(item.userId, id))
    .sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt)));
}

function settlePendingTx(user, predicate, status) {
  const tx = db.transactions.find((item) => item.userId === user.id && item.status === "pending" && predicate(item));
  if (!tx) return null;
  tx.status = status;
  if (isSettled(status) && tx.type === "withdraw") {
    user.balance = roundMoney((user.balance || 0) + tx.amount);
    user.totalWithdrawals = roundMoney((user.totalWithdrawals || 0) + Math.abs(tx.amount));
  }
  if (isSettled(status) && tx.type === "deposit") {
    user.balance = roundMoney((user.balance || 0) + tx.amount);
  }
  tx.balanceAfter = roundMoney(user.balance || 0);
  return tx;
}

function userFacingNote(tx) {
  if (tx.type === "task_reward") return "مكافأة إعلان";
  if (tx.type === "vip_activation") return "طلب تفعيل VIP";
  if (tx.type === "vip_refund") {
    return String(tx.note || "").includes("إلغاء") ? "استرداد إلغاء VIP" : "استرداد قيمة VIP السابقة";
  }
  if (tx.type === "vip_gift") return "هدية تفعيل VIP";
  if (tx.type === "deposit") return "إيداع USDT";
  if (tx.type === "withdraw") return "سحب USDT";
  if (tx.type === "admin_adjust") return "تحديث الرصيد";
  return String(tx.note || "").replace(/المشرف|الإدارة|admin/gi, "").trim();
}

function getWallet(user, { publicNotes = false } = {}) {
  settleMissingVipCancelRefunds(user);
  rebuildWalletTotals(user);
  const settings = getWalletSettings();
  const id = numericId(user.id);
  const locked = pendingWithdrawTotal(id);
  const transactions = id ? userTransactions(id).map((tx) => (
    publicNotes ? { ...tx, note: userFacingNote(tx) } : tx
  )) : [];
  return {
    userId: id,
    email: user.email,
    currency: "USDT",
    balance: roundMoney(user.balance || 0),
    available: availableBalance(user),
    locked,
    totalEarnings: roundMoney(user.totalEarnings || 0),
    totalWithdrawals: roundMoney(user.totalWithdrawals || 0),
    companyAddress: settings.companyAddress,
    network: settings.network,
    minDeposit: settings.minDeposit,
    minWithdraw: settings.minWithdraw,
    minInvitesForWithdraw: settings.minInvitesForWithdraw,
    transactions,
    deposits: id ? (db.rechargeRequests || []).filter((item) => sameId(item.userId, id)).slice(-30).reverse() : [],
    withdrawals: id ? (db.withdrawRequests || []).filter((item) => sameId(item.userId, id)).slice(-30).reverse() : []
  };
}

function rebuildWalletTotals(user) {
  const settled = userTransactions(user.id).filter((item) => isSettled(item.status));
  user.totalEarnings = roundMoney(
    settled
      .filter((item) => item.amount > 0 && EARNING_TYPES.has(item.type))
      .reduce((sum, item) => sum + Number(item.amount || 0), 0)
  );
  user.totalWithdrawals = roundMoney(
    settled
      .filter((item) => item.type === "withdraw")
      .reduce((sum, item) => sum + Math.abs(Number(item.amount || 0)), 0)
  );
}

function roundMoney(value) {
  return Math.round(Number(value) * 100) / 100;
}

function getPackage(level) {
  return VIP_PACKAGES.find((item) => item.level === Number(level)) || null;
}

function defaultAdSlotSettings() {
  const out = {};
  VIP_PACKAGES.forEach((pkg) => {
    out[String(pkg.level)] = Number(pkg.adsPerDay || 0);
  });
  return out;
}

function normalizeAdSlotSettings(raw) {
  const out = defaultAdSlotSettings();
  VIP_PACKAGES.forEach((pkg) => {
    const key = String(pkg.level);
    if (raw && raw[key] != null && Number.isFinite(Number(raw[key]))) {
      out[key] = Math.max(0, Math.min(200, Math.round(Number(raw[key]))));
    }
  });
  return out;
}

function adsPerDayForLevel(level) {
  const settings = db?.adSlotSettings || defaultAdSlotSettings();
  const n = Number(settings[String(level)]);
  if (Number.isFinite(n)) return n;
  return Number(getPackage(level)?.adsPerDay || 0);
}

function vipWithAdSlots(pkg) {
  if (!pkg) return pkg;
  return { ...pkg, adsPerDay: adsPerDayForLevel(pkg.level) };
}

function vipRecordTime(item) {
  return new Date(item?.processedAt || item?.activationDate || item?.createdAt || 0).getTime();
}

function approvedVipRecord(userId) {
  const uid = numericId(userId);
  if (!uid) return null;
  const lastCancelAt = Math.max(
    0,
    ...((db.vipCancelRequests || [])
      .filter((item) => sameId(item.userId, uid) && item.status === "approved")
      .map(vipRecordTime))
  );
  return (db.vipRequests || [])
    .filter((item) => sameId(item.userId, uid) && item.status === "approved" && vipRecordTime(item) > lastCancelAt)
    .sort((a, b) => vipRecordTime(b) - vipRecordTime(a))[0] || null;
}

function syncVipFromRecords(user) {
  if (!user) return user;
  const rec = approvedVipRecord(user.id);
  if (!rec) {
    deactivateVip(user);
    return user;
  }
  user.vipLevel = Number(rec.vipLevel);
  user.vipPrice = Number(rec.price || 0);
  user.vipStatus = "active";
  user.vipActivatedAt = rec.activationDate || rec.processedAt || null;
  return user;
}

function getVip(user) {
  syncVipFromRecords(user);
  const rec = user ? approvedVipRecord(user.id) : null;
  const pkg = rec ? getPackage(rec.vipLevel) : null;
  if (pkg) return vipWithAdSlots(pkg);
  return { level: 0, name: "بدون VIP", price: 0, adsPerDay: FREE_ADS_PER_DAY, gift: 0 };
}

function getActiveVipLevel(user) {
  syncVipFromRecords(user);
  const rec = user ? approvedVipRecord(user.id) : null;
  return rec ? Number(rec.vipLevel) : 0;
}

function upgradeCost(user, pkg) {
  const currentPrice = user.vipStatus === "active" ? Number(user.vipPrice || 0) : 0;
  return roundMoney(Math.max(0, pkg.price - currentPrice));
}

function todayKey() {
  return new Date().toISOString().slice(0, 10);
}

function randomAdReward() {
  return AD_REWARDS[Math.floor(Math.random() * AD_REWARDS.length)];
}

function deactivateVip(user) {
  user.vipLevel = 0;
  user.vipPrice = 0;
  user.vipStatus = "none";
  user.vipActivatedAt = null;
  user.adsCycleAt = null;
}

function lastPaidVipAmount(userId) {
  const uid = numericId(userId);
  if (!uid) return 0;
  const rec = (db.vipRequests || [])
    .filter((item) => sameId(item.userId, uid) && item.status === "approved")
    .sort((a, b) => vipRecordTime(b) - vipRecordTime(a))[0];
  if (!rec) return 0;
  return roundMoney(Number(rec.paidAmount) || Number(rec.price) || getPackage(rec.vipLevel)?.price || 0);
}

function vipPaidAmountForCancel(request) {
  const stored = roundMoney(Number(request?.refundAmount) || Number(request?.vipPrice) || 0);
  if (stored > 0) return stored;
  const fromPurchase = lastPaidVipAmount(request?.userId);
  if (fromPurchase > 0) return fromPurchase;
  return roundMoney(getPackage(request?.vipLevel)?.price || 0);
}

function subscriptionRefundAmount(user, cancelRequest = null) {
  if (cancelRequest) return vipPaidAmountForCancel(cancelRequest);
  const rec = user ? approvedVipRecord(user.id) : null;
  const fromPurchase = lastPaidVipAmount(user?.id);
  const pkg = getPackage(rec?.vipLevel || user?.vipLevel);
  return roundMoney(fromPurchase || Number(user?.vipPrice) || Number(pkg?.price) || 0);
}

function cancelAlreadyRefunded(request) {
  const uid = numericId(request?.userId);
  if (!uid) return false;
  if (request.refundTxId) {
    return (db.transactions || []).some((tx) => sameId(tx.id, request.refundTxId) && sameId(tx.userId, uid));
  }
  return (db.transactions || []).some((tx) => sameId(tx.userId, uid) && Number(tx.cancelRequestId) === Number(request.id));
}

function applyVipCancelRefund(request) {
  const user = db.users.find((item) => sameId(item.id, request.userId));
  if (!user) return { user: null, refundTx: null, refundAmount: 0 };
  if (cancelAlreadyRefunded(request)) {
    const refundTx = (db.transactions || []).find((tx) => sameId(tx.id, request.refundTxId) || Number(tx.cancelRequestId) === Number(request.id));
    return { user, refundTx: refundTx || null, refundAmount: roundMoney(request.refundAmount || refundTx?.amount || 0), skipped: true };
  }
  const refundAmount = vipPaidAmountForCancel(request);
  if (!(refundAmount > 0)) return { user, refundTx: null, refundAmount: 0 };
  const refundTx = recordTransaction(user, {
    type: "vip_refund",
    amount: refundAmount,
    status: "completed",
    note: `استرداد إلغاء ${request.vipName || "VIP"}`,
    extra: { cancelRequestId: request.id }
  });
  request.refundAmount = refundAmount;
  request.refundTxId = refundTx.id;
  request.refundedUserId = Number(user.id);
  return { user, refundTx, refundAmount };
}

function settleMissingVipCancelRefunds(user) {
  let changed = false;
  const since = Date.parse("2026-08-20T20:20:00.000Z");
  (db.vipCancelRequests || [])
    .filter((item) => (
      sameId(item.userId, user.id)
      && item.status === "approved"
      && !cancelAlreadyRefunded(item)
      && Date.parse(item.createdAt || 0) >= since
    ))
    .forEach((item) => {
      const result = applyVipCancelRefund(item);
      if (result.refundTx && !result.skipped) changed = true;
    });
  if (changed) saveDb();
}

function userConversation(userId) {
  const uid = numericId(userId);
  if (!uid) return null;
  let conv = db.conversations.find((item) => sameId(item.userId, uid));
  if (!conv) {
    conv = { id: nextId(db.conversations), userId: uid, updatedAt: nowIso() };
    db.conversations.push(conv);
  }
  return conv;
}

const APP_STATE_ID = "main";
const UPLOADS_BUCKET = "uploads";
let supabaseClient = null;

function remoteStorageConfigured() {
  return Boolean(String(process.env.SUPABASE_URL || "").trim() && String(process.env.SUPABASE_SECRET_KEY || "").trim());
}

function getSupabaseClient() {
  if (!remoteStorageConfigured()) {
    supabaseClient = null;
    return null;
  }
  if (!supabaseClient) {
    supabaseClient = createClient(
      String(process.env.SUPABASE_URL).trim(),
      String(process.env.SUPABASE_SECRET_KEY).trim(),
      { auth: { persistSession: false, autoRefreshToken: false } }
    );
  }
  return supabaseClient;
}

function saveLocalAttachment(filename, buffer) {
  writeFileSync(join(UPLOADS_DIR, filename), buffer);
}

function unlinkLocalUpload(name) {
  const path = join(UPLOADS_DIR, name);
  if (existsSync(path)) unlinkSync(path);
}

async function saveAttachment(file) {
  const raw = String(file?.data || "");
  const match = raw.match(/^data:([^;]+);base64,(.+)$/);
  if (!match) return null;
  const mime = match[1];
  if (!mime.startsWith("image/") && !mime.startsWith("video/")) return null;
  const buffer = Buffer.from(match[2], "base64");
  if (buffer.length > 12 * 1024 * 1024) return null;
  const ext = mime.includes("png") ? ".png" : mime.includes("webm") ? ".webm" : mime.includes("mp4") ? ".mp4" : mime.includes("jpeg") || mime.includes("jpg") ? ".jpg" : mime.includes("gif") ? ".gif" : ".bin";
  const filename = `${Date.now()}-${randomBytes(4).toString("hex")}${ext}`;
  const client = getSupabaseClient();
  if (!client) {
    saveLocalAttachment(filename, buffer);
  } else {
    const { error } = await client.storage.from(UPLOADS_BUCKET).upload(filename, buffer, {
      contentType: mime,
      upsert: true
    });
    if (error) return null;
  }
  return { url: `/uploads/${filename}`, name: String(file.name || filename), mime };
}

async function unlinkUploadUrl(url) {
  const name = String(url || "").replace(/^\/uploads\//, "");
  if (!name || name.includes("..") || name.includes("/") || name.includes("\\")) return;
  const client = getSupabaseClient();
  if (!client) {
    unlinkLocalUpload(name);
    return;
  }
  const { error } = await client.storage.from(UPLOADS_BUCKET).remove([name]);
  if (error) console.error("تعذر حذف الملف من Supabase Storage:", error.message);
}

function normalizeAdCreativeSet(raw) {
  const used = new Set();
  const images = [];
  (Array.isArray(raw?.images) ? raw.images : []).forEach((item, index) => {
    if (!item?.url) return;
    const slot = Math.round(Number(item.slot || index + 1));
    if (!Number.isFinite(slot) || slot < 1 || slot > MAX_AD_IMAGES || used.has(slot)) return;
    used.add(slot);
    images.push({
      id: Number(item.id) || slot,
      slot,
      url: String(item.url),
      name: String(item.name || "")
    });
  });
  images.sort((a, b) => a.slot - b.slot);
  return { enabled: Boolean(raw?.enabled), images };
}

function getAdCreativeSet() {
  db.adCreativeSet = normalizeAdCreativeSet(db.adCreativeSet);
  return db.adCreativeSet;
}

function adCreativeForSlot(userId, slot) {
  const set = getAdCreativeSet();
  if (!set.enabled || !set.images.length) return null;
  const img = set.images.find((item) => Number(item.slot) === Number(slot));
  if (!img?.url) return null;
  return { imageUrl: img.url, imageName: img.name || "" };
}

function adCreativeRotationPreview() {
  return VIP_PACKAGES.map((pkg) => {
    const adsPerDay = adsPerDayForLevel(pkg.level);
    return {
      level: pkg.level,
      vipName: pkg.name,
      adsPerDay,
      sampleSlots: Array.from({ length: Math.min(8, Number(adsPerDay) || 0) }, (_, i) => {
        const slot = i + 1;
        const mapped = adCreativeForSlot(1, slot);
        return { slot, imageUrl: mapped?.imageUrl || null };
      })
    };
  });
}

function seed() {
  return {
    users: [],
    sessions: [],
    transactions: [],
    tasks: [
      { id: 1, title: "مشاهدة إعلان", description: "شاهد إعلاناً كاملاً واحصل على المكافأة", reward: 1, type: "ad", vipMin: 0, dailyLimit: 60, active: true },
      { id: 2, title: "إكمال مهمة يومية", description: "أكمل المهمة اليومية لتفعيل المكافأة", reward: 2, type: "task", vipMin: 0, dailyLimit: 1, active: true },
      { id: 3, title: "مشاهدة فيديو ترويجي", description: "شاهد فيديو شريكاً لمدة 15 ثانية", reward: 3, type: "ad", vipMin: 1, dailyLimit: 60, active: true },
      { id: 4, title: "تقييم العرض", description: "قيّم العرض بعد المشاهدة", reward: 4, type: "task", vipMin: 2, dailyLimit: 3, active: true }
    ],
    completions: [],
    vipPackages: VIP_PACKAGES,
    vipRequests: [],
    referrals: [],
    referralSettings: DEFAULT_REFERRAL_SETTINGS,
    walletSettings: DEFAULT_WALLET_SETTINGS,
    withdrawRequests: [],
    rechargeRequests: [],
    vipCancelRequests: [],
    conversations: [],
    messages: [],
    adViews: [],
    adWatchSessions: [],
    adCreativeSet: { ...DEFAULT_AD_CREATIVE_SET, images: [] },
    adSlotSettings: defaultAdSlotSettings()
  };
}

function migrateUser(user) {
  user.vipLevel = Number(user.vipLevel || 0);
  user.vipPrice = Number(user.vipPrice || 0);
  user.balance = Number(user.balance || 0);
  user.totalEarnings = Number(user.totalEarnings || 0);
  user.totalWithdrawals = Number(user.totalWithdrawals || 0);
  user.vipStatus = String(user.vipStatus || "none").toLowerCase();
  if (user.vipStatus !== "active" && user.vipStatus !== "pending") user.vipStatus = "none";
  if (user.vipActivatedAt === undefined) user.vipActivatedAt = null;
  if (user.referredBy === undefined) user.referredBy = null;
  if (!Array.isArray(user.inviterPath)) user.inviterPath = [];
  if (user.signupIp === undefined) user.signupIp = "";
  if (user.adsCycleAt === undefined) user.adsCycleAt = user.vipActivatedAt || null;
  return user;
}

function loadLocalDb() {
  if (!existsSync(DB_PATH)) {
    const initial = seed();
    writeFileSync(DB_PATH, JSON.stringify(initial, null, 2));
    return initial;
  }
  return JSON.parse(readFileSync(DB_PATH, "utf8"));
}

function saveLocalDb(data) {
  writeFileSync(DB_PATH, JSON.stringify(data, null, 2));
}

function normalizeDb(data) {
  const defaults = seed();
  data.vipPackages = VIP_PACKAGES;
  data.vipRequests = data.vipRequests || [];
  data.referrals = data.referrals || [];
  data.sessions = data.sessions || [];
  data.transactions = data.transactions || [];
  data.completions = data.completions || [];
  data.withdrawRequests = data.withdrawRequests || [];
  data.rechargeRequests = data.rechargeRequests || [];
  data.vipCancelRequests = data.vipCancelRequests || [];
  data.conversations = data.conversations || [];
  data.messages = data.messages || [];
  data.adViews = data.adViews || [];
  data.adWatchSessions = data.adWatchSessions || [];
  data.adCreativeSet = normalizeAdCreativeSet(data.adCreativeSet);
  data.adSlotSettings = normalizeAdSlotSettings(data.adSlotSettings);
  data.tasks = data.tasks?.length ? data.tasks : defaults.tasks;
  data.referralSettings = { ...DEFAULT_REFERRAL_SETTINGS, ...(data.referralSettings || {}), signupInviter: 15 };
  data.walletSettings = { ...DEFAULT_WALLET_SETTINGS, ...(data.walletSettings || {}) };
  data.walletSettings.minInvitesForWithdrawByUser = sanitizeInviteOverrideMap(data.walletSettings.minInvitesForWithdrawByUser);
  data.users = (data.users || []).map(migrateUser);
  return data;
}

function logBootDb(source, data, extra = {}) {
  const users = Array.isArray(data?.users) ? data.users : [];
  const adminFound = users.some((item) => String(item.email || "").trim().toLowerCase() === "admin@advault.tt");
  console.log("BOOT_DB", {
    "SUPABASE_URL": String(process.env.SUPABASE_URL || "").trim() ? "yes" : "no",
    "SUPABASE_SECRET_KEY": String(process.env.SUPABASE_SECRET_KEY || "").trim() ? "yes" : "no",
    client: extra.client ? "yes" : "no",
    source,
    fallback: extra.fallback || "none",
    users: users.length,
    admin: adminFound ? "yes" : "no"
  });
}

async function loadDb() {
  const client = getSupabaseClient();
  if (!client) {
    const local = normalizeDb(loadLocalDb());
    logBootDb("local", local, { client: false, fallback: "missing_env" });
    return local;
  }
  const { data, error } = await client.from("app_state").select("payload").eq("id", APP_STATE_ID).maybeSingle();
  if (error) {
    console.error("تعذر قراءة app_state من Supabase:", error.message);
    const local = normalizeDb(loadLocalDb());
    logBootDb("local", local, { client: true, fallback: "read_error" });
    return local;
  }
  if (data?.payload && typeof data.payload === "object") {
    const remote = normalizeDb(data.payload);
    logBootDb("supabase", remote, { client: true, fallback: "none" });
    return remote;
  }
  const local = normalizeDb(loadLocalDb());
  logBootDb("local", local, { client: true, fallback: "empty_payload" });
  return local;
}

function saveDb() {
  const client = getSupabaseClient();
  if (!client) {
    saveLocalDb(db);
    return Promise.resolve();
  }
  const payload = JSON.parse(JSON.stringify(db));
  return client.from("app_state").upsert({ id: APP_STATE_ID, payload }, { onConflict: "id" }).then(({ error }) => {
    if (error) console.error("تعذر حفظ app_state في Supabase:", error.message);
  });
}

let db = seed();

function prepareDb(data) {
  db = data;
  db.users.forEach((user) => {
    if (!user.referralCode) user.referralCode = uniqueReferralCode();
  });
  db.users.forEach((user) => {
    user.inviterPath = buildInviterPath(user);
    syncVipFromRecords(user);
    rebuildWalletTotals(user);
  });
}

function publicUser(user) {
  const vip = getVip(user);
  const activeLevel = getActiveVipLevel(user);
  return {
    id: Number(user.id),
    name: user.name,
    email: user.email,
    role: user.role,
    balance: roundMoney(user.balance || 0),
    available: availableBalance(user),
    currency: "USDT",
    totalEarnings: roundMoney(user.totalEarnings || 0),
    totalWithdrawals: roundMoney(user.totalWithdrawals || 0),
    vipLevel: activeLevel,
    vipName: activeLevel > 0 ? vip.name : "بدون VIP",
    vipPrice: activeLevel > 0 ? Number(user.vipPrice || 0) : 0,
    vipStatus: activeLevel > 0 ? "active" : "none",
    vipActivatedAt: activeLevel > 0 ? (user.vipActivatedAt || null) : null,
    adsPerDay: vip.adsPerDay,
    gift: vip.gift,
    referralCode: user.referralCode,
    referredBy: user.referredBy || null,
    inviterName: db.users.find((item) => sameId(item.id, user.referredBy))?.name || null,
    inviterCode: db.users.find((item) => sameId(item.id, user.referredBy))?.referralCode || null,
    invitedCount: invitedUsers(user.id, 1).length,
    networkCount: invitedUsers(user.id, 1).length + invitedUsers(user.id, 2).length + invitedUsers(user.id, 3).length,
    createdAt: user.createdAt
  };
}

function sessionAccount(user) {
  const wallet = getWallet(user, { publicNotes: true });
  const account = publicUser(user);
  if (!sameId(account.id, user.id) || !sameId(wallet.userId, user.id) || account.email !== user.email) {
    throw new Error("تعذر تحميل بيانات هذا الحساب");
  }
  return {
    ...account,
    balance: wallet.balance,
    available: wallet.available,
    totalEarnings: wallet.totalEarnings,
    totalWithdrawals: wallet.totalWithdrawals,
    wallet
  };
}

function issueSession(userId) {
  const id = numericId(userId);
  if (!id) throw new Error("تعذر إنشاء الجلسة");
  const token = randomBytes(24).toString("hex");
  const now = Date.now();
  db.sessions = (db.sessions || []).filter((item) => item.expiresAt > now && item.token);
  db.sessions.push({ token, userId: id, expiresAt: now + TOKEN_TTL_MS });
  return token;
}

function addTransaction(userId, type, amount, status, note, balanceAfter, extra = {}) {
  const tx = {
    id: nextId(db.transactions),
    userId: numericId(userId),
    type,
    amount: roundMoney(amount),
    status,
    note: note || "",
    createdAt: nowIso(),
    balanceAfter: roundMoney(balanceAfter ?? db.users.find((item) => sameId(item.id, userId))?.balance ?? 0)
  };
  if (extra.cancelRequestId) tx.cancelRequestId = Number(extra.cancelRequestId);
  db.transactions.push(tx);
  return tx;
}

function startOfToday() {
  const date = new Date();
  date.setHours(0, 0, 0, 0);
  return date.getTime();
}

function adsCycleStart(user) {
  return Date.parse(user?.adsCycleAt || 0) || 0;
}

function todayAdViews(user) {
  const date = todayKey();
  const start = adsCycleStart(user);
  db.adViews = db.adViews || [];
  return db.adViews.filter((item) => {
    if (!sameId(item.userId, user.id) || item.date !== date) return false;
    if (start && Date.parse(item.createdAt || 0) < start) return false;
    return true;
  });
}

function adsCompletedToday(userId) {
  const user = db.users.find((item) => sameId(item.id, userId));
  return user ? todayAdViews(user).length : 0;
}

function pickAdWatchDuration() {
  return AD_WATCH_DURATIONS[Math.floor(Math.random() * AD_WATCH_DURATIONS.length)];
}

function publicAdWatch(session) {
  const ends = Date.parse(session?.endsAt || 0);
  const remainingSec = Math.max(0, Math.ceil((ends - Date.now()) / 1000));
  return {
    sessionId: session.token,
    slot: session.slot,
    durationSec: Number(session.durationSec),
    startedAt: session.startedAt,
    endsAt: session.endsAt,
    remainingSec,
    imageUrl: session.imageUrl || null,
    imageName: session.imageName || "",
    ready: remainingSec <= 0
  };
}

function startAdWatch(user, slot) {
  db.adWatchSessions = db.adWatchSessions || [];
  const now = Date.now();
  db.adWatchSessions.forEach((item) => {
    if (sameId(item.userId, user.id) && item.slot === slot && item.status === "open") {
      item.status = "replaced";
    }
  });
  const durationSec = pickAdWatchDuration();
  const creative = adCreativeForSlot(user.id, slot);
  const session = {
    id: nextId(db.adWatchSessions),
    token: randomBytes(16).toString("hex"),
    userId: Number(user.id),
    slot: Number(slot),
    durationSec,
    imageUrl: creative?.imageUrl || null,
    imageName: creative?.imageName || "",
    startedAt: new Date(now).toISOString(),
    endsAt: new Date(now + durationSec * 1000).toISOString(),
    status: "open",
    completedAt: null
  };
  db.adWatchSessions.push(session);
  if (db.adWatchSessions.length > 400) {
    db.adWatchSessions = db.adWatchSessions.slice(-300);
  }
  saveDb();
  return session;
}

function adsPayload(user) {
  const vip = getVip(user);
  const viewed = todayAdViews(user);
  const ads = [];
  for (let slot = 1; slot <= Number(vip.adsPerDay || 0); slot += 1) {
    const done = viewed.find((item) => item.slot === slot);
    ads.push({
      slot,
      title: `إعلان ${slot}`,
      completed: Boolean(done),
      reward: done ? done.reward : null
    });
  }
  return {
    userId: Number(user.id),
    message: "Recharge to earn and grow your balance.",
    vipName: vip.name,
    adsRequired: vip.adsPerDay,
    adsCompleted: viewed.length,
    adsPerDay: vip.adsPerDay,
    adsToday: viewed.length,
    hasVip: getActiveVipLevel(user) > 0,
    adsEnabled: Boolean(getAdCreativeSet().enabled && getAdCreativeSet().images.length),
    ads
  };
}

function conversationMessages(conversationId) {
  return db.messages
    .filter((item) => item.conversationId === conversationId)
    .sort((a, b) => new Date(a.createdAt) - new Date(b.createdAt));
}

async function addSupportMessage({ conversation, senderRole, senderId, text, file }) {
  const attachment = file ? await saveAttachment(file) : null;
  const body = String(text || "").trim();
  if (!body && !attachment) return null;
  const message = {
    id: nextId(db.messages),
    conversationId: conversation.id,
    senderRole,
    senderId,
    text: body,
    attachmentUrl: attachment?.url || null,
    attachmentName: attachment?.name || null,
    attachmentMime: attachment?.mime || null,
    createdAt: nowIso()
  };
  db.messages.push(message);
  conversation.updatedAt = message.createdAt;
  conversation.lastMessage = body || (attachment?.mime?.startsWith("video/") ? "فيديو" : "صورة");
  return message;
}

function withUser(request) {
  const user = db.users.find((item) => item.id === request.userId);
  return { ...request, user: user ? publicUser(user) : null };
}

function authMiddleware(req, res, next) {
  const header = req.headers.authorization || "";
  const token = header.startsWith("Bearer ") ? header.slice(7) : "";
  if (!token) return res.status(401).json({ error: "يلزم تسجيل الدخول" });
  const session = db.sessions.find((item) => item.token === token);
  if (!session || session.expiresAt < Date.now()) {
    return res.status(401).json({ error: "الجلسة منتهية" });
  }
  const user = db.users.find((item) => sameId(item.id, session.userId));
  if (!user) return res.status(401).json({ error: "المستخدم غير موجود" });
  migrateUser(user);
  syncVipFromRecords(user);
  req.user = user;
  req.token = token;
  next();
}

function identityGuard(req, res, next) {
  const claimed = numericId(req.headers["x-account-id"]);
  if (claimed && !sameId(claimed, req.user.id)) {
    return res.status(403).json({ error: "الحساب لا يطابق الجلسة" });
  }
  next();
}

function adminMiddleware(req, res, next) {
  if (req.user.role !== "admin") return res.status(403).json({ error: "صلاحيات المشرف مطلوبة" });
  next();
}

const app = express();
app.use(cors());
app.use(express.json({ limit: "20mb" }));
app.get("/uploads/:file", async (req, res, next) => {
  if (!getSupabaseClient()) return next();
  const file = String(req.params.file || "");
  if (!file || file.includes("..") || file.includes("/") || file.includes("\\")) {
    return res.status(404).end();
  }
  const { data, error } = await getSupabaseClient().storage.from(UPLOADS_BUCKET).download(file);
  if (error || !data) return res.status(404).end();
  const buffer = Buffer.from(await data.arrayBuffer());
  const ext = file.split(".").pop()?.toLowerCase();
  const types = { png: "image/png", jpg: "image/jpeg", jpeg: "image/jpeg", gif: "image/gif", webp: "image/webp", mp4: "video/mp4", webm: "video/webm", bin: "application/octet-stream" };
  res.setHeader("Content-Type", types[ext] || "application/octet-stream");
  res.send(buffer);
});
app.use("/uploads", express.static(UPLOADS_DIR));

app.get("/", (req, res) => {
  res.json({ name: "ADVAULT TT API", status: "running" });
});

function sendJson(res, status, body) {
  if (res.headersSent) return;
  res.status(status).json(body && typeof body === "object" ? body : { error: "تعذر إتمام الطلب" });
}

function registerHandler(req, res) {
  try {
  const name = String(req.body?.name || "").trim();
  const email = String(req.body?.email || "").trim().toLowerCase();
  const password = String(req.body?.password || "");
  const ref = String(req.body?.referralCode || "").trim().toUpperCase();
  if (name.length < 2) return res.status(400).json({ error: "الاسم قصير جداً" });
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return res.status(400).json({ error: "البريد غير صالح" });
  if (password.length < 6) return res.status(400).json({ error: "كلمة المرور يجب أن تكون 6 أحرف على الأقل" });
  if (db.users.some((item) => item.email === email)) return res.status(409).json({ error: "البريد مستخدم مسبقاً" });

  let inviter = null;
  const ip = clientIp(req);
  if (ref) {
    inviter = db.users.find((item) => item.referralCode === ref) || null;
    if (!inviter) return res.status(400).json({ error: "كود الدعوة غير صحيح" });
    if (inviter.email === email) return res.status(400).json({ error: "لا يمكن استخدام كود الدعوة الخاص بك" });
    if (db.referrals.some((item) => item.type === "signup" && item.invitedId && db.users.find((user) => user.id === item.invitedId)?.email === email)) {
      return res.status(400).json({ error: "تم تسجيل هذا الحساب بكود دعوة مسبقاً" });
    }
    const isLocal = !ip || ip === "::1" || ip === "127.0.0.1" || ip === "::ffff:127.0.0.1";
    if (!isLocal) {
      const today = startOfToday();
      const ipSignupsToday = db.users.filter(
        (item) => item.signupIp === ip && item.referredBy && new Date(item.createdAt).getTime() >= today
      ).length;
      if (ipSignupsToday >= MAX_REFERRALS_PER_IP_PER_DAY) {
        return res.status(400).json({ error: "تم تجاوز حد الدعوات من نفس الشبكة اليوم" });
      }
      const sameInviterIpCount = invitedUsers(inviter.id).filter((item) => item.signupIp === ip).length;
      if (sameInviterIpCount >= 3) {
        return res.status(400).json({ error: "تم رفض الدعوة لتكرار الحسابات من نفس الشبكة" });
      }
    }
  }

  const hashed = hashPassword(password);
  let newId;
  try {
    newId = allocateUserId();
  } catch {
    return res.status(500).json({ error: "تعذر إنشاء معرّف المستخدم" });
  }
  const user = {
    id: newId,
    name,
    email,
    passwordHash: hashed.passwordHash,
    salt: hashed.salt,
    role: "user",
    balance: 0,
    totalEarnings: 0,
    totalWithdrawals: 0,
    vipLevel: 0,
    vipPrice: 0,
    vipStatus: "none",
    vipActivatedAt: null,
    referralCode: uniqueReferralCode(),
    referredBy: inviter ? inviter.id : null,
    inviterPath: [],
    signupIp: ip,
    createdAt: nowIso()
  };
  db.users.push(user);
  user.inviterPath = buildInviterPath(user);
  deactivateVip(user);
  rebuildWalletTotals(user);
  if (approvedVipRecord(user.id) || invitedUsers(user.id, 1).length || userTransactions(user.id).length) {
    return res.status(500).json({ error: "تعذر إنشاء حساب فارغ" });
  }

  if (inviter) {
    const settings = getReferralSettings();
    creditWallet(inviter, "referral", settings.signupInviter, `مكافأة دعوة مباشرة: انضمام ${user.name}`);
    addReferralRecord({
      inviterId: inviter.id,
      invitedId: user.id,
      code: ref,
      type: "signup",
      amount: settings.signupInviter,
      beneficiaryId: inviter.id,
      note: `دعوة مباشرة ${user.name}`,
      level: 1
    });
    creditWallet(user, "referral", settings.signupInvited, "هدية الانضمام عبر كود دعوة");
    addReferralRecord({
      inviterId: inviter.id,
      invitedId: user.id,
      code: ref,
      type: "signup_welcome",
      amount: settings.signupInvited,
      beneficiaryId: user.id,
      note: "هدية المدعو",
      level: 1
    });
    user.inviterPath.slice(1).forEach((ancestorId, index) => {
      const level = index + 2;
      const cfg = settings.levels.find((item) => item.level === level);
      const bonus = Number(cfg?.signupBonus || 0);
      if (!(bonus > 0)) return;
      const ancestor = db.users.find((item) => item.id === ancestorId);
      if (!ancestor) return;
      creditWallet(ancestor, "referral", bonus, `مكافأة شبكة مستوى ${level}: ${user.name}`);
      addReferralRecord({
        inviterId: ancestor.id,
        invitedId: user.id,
        code: ancestor.referralCode,
        type: "signup",
        amount: bonus,
        beneficiaryId: ancestor.id,
        note: `شبكة مستوى ${level} · ${user.name}`,
        level
      });
    });
  }

  deactivateVip(user);
  const token = issueSession(user.id);
  saveDb();
  const account = sessionAccount(user);
  if (
    Number(account.id) !== Number(user.id)
    || account.email !== email
    || Number(account.vipLevel) !== 0
    || account.vipStatus !== "none"
    || Number(account.invitedCount) !== 0
  ) {
    return res.status(500).json({ error: "تعذر تجهيز الحساب الجديد" });
  }
  if (!inviter && (Number(account.balance) !== 0 || Number(account.totalEarnings) !== 0)) {
    return sendJson(res, 500, { error: "تعذر تجهيز الحساب الجديد" });
  }
  audit("register", { userId: Number(user.id), email: user.email });
  return sendJson(res, 200, { token, user: account });
  } catch (err) {
    console.error("register failed", err?.message || err);
    return sendJson(res, 500, { error: err.message || "تعذر إنشاء الحساب" });
  }
}

app.post("/api/auth/register", registerHandler);
app.post("/api/auth/signup", registerHandler);
app.post("/api/register", registerHandler);
app.post("/register", registerHandler);

app.post("/api/auth/login", (req, res) => {
  try {
  const email = String(req.body?.email || "").trim().toLowerCase();
  const password = String(req.body?.password || "");
  const user = db.users.find((item) => item.email === email);
  if (!user || !verifyPassword(password, user.salt, user.passwordHash)) {
    return sendJson(res, 401, { error: "بيانات الدخول غير صحيحة" });
  }
  migrateUser(user);
  syncVipFromRecords(user);
  rebuildWalletTotals(user);
  const token = issueSession(user.id);
  saveDb();
  const account = sessionAccount(user);
  if (Number(account.id) !== Number(user.id) || account.email !== email) {
    return sendJson(res, 500, { error: "تعذر تجهيز جلسة الدخول" });
  }
  audit("login", { userId: Number(user.id), email: user.email, role: user.role });
  return sendJson(res, 200, { token, user: account });
  } catch (err) {
    console.error("login failed", err?.message || err);
    return sendJson(res, 500, { error: err.message || "تعذر تسجيل الدخول" });
  }
});

app.post("/api/auth/logout", (req, res) => {
  const header = req.headers.authorization || "";
  const token = header.startsWith("Bearer ") ? header.slice(7) : "";
  const session = token ? (db.sessions || []).find((item) => item.token === token) : null;
  const userId = session?.userId || null;
  if (token) db.sessions = db.sessions.filter((item) => item.token !== token);
  saveDb();
  audit("logout", { userId, sessionEnded: Boolean(session) });
  res.json({ ok: true });
});

app.post("/api/auth/change-password", authMiddleware, identityGuard, (req, res) => {
  try {
    const claimedUserId = numericId(req.body?.userId);
    if (claimedUserId && !sameId(claimedUserId, req.user.id)) {
      return sendJson(res, 403, { error: "لا يمكن تغيير كلمة مرور حساب آخر" });
    }
    const user = db.users.find((item) => sameId(item.id, req.user.id));
    if (!user) return sendJson(res, 401, { error: "المستخدم غير موجود" });
    const currentPassword = String(req.body?.currentPassword || "");
    const newPassword = String(req.body?.newPassword || "");
    const confirmPassword = String(req.body?.confirmPassword || "");
    let currentOk = false;
    try {
      currentOk = verifyPassword(currentPassword, user.salt, user.passwordHash);
    } catch {
      currentOk = false;
    }
    if (!currentOk) return sendJson(res, 400, { error: "كلمة المرور الحالية غير صحيحة" });
    if (newPassword !== confirmPassword) {
      return sendJson(res, 400, { error: "كلمة المرور الجديدة وتأكيدها غير متطابقين" });
    }
    if (newPassword.length < 6) {
      return sendJson(res, 400, { error: "كلمة المرور يجب أن تكون 6 أحرف على الأقل" });
    }
    if (currentPassword === newPassword) {
      return sendJson(res, 400, { error: "كلمة المرور الجديدة يجب أن تختلف عن الحالية" });
    }
    const hashed = hashPassword(newPassword);
    user.passwordHash = hashed.passwordHash;
    user.salt = hashed.salt;
    saveDb();
    audit("password_changed", { userId: Number(user.id) });
    return sendJson(res, 200, { ok: true });
  } catch {
    return sendJson(res, 500, { error: "تعذر تغيير كلمة المرور" });
  }
});

app.get("/api/me", authMiddleware, identityGuard, (req, res) => {
  res.json(sessionAccount(req.user));
});

app.get("/api/wallet", authMiddleware, identityGuard, (req, res) => {
  const wallet = getWallet(req.user, { publicNotes: true });
  if (Number(wallet.userId) !== Number(req.user.id)) {
    return res.status(403).json({ error: "تعذر تحميل المحفظة" });
  }
  res.json(wallet);
});

app.get("/api/admin/wallets", authMiddleware, adminMiddleware, (req, res) => {
  res.json({
    settings: getWalletSettings(),
    users: db.users.map((user) => ({ user: publicUser(user), wallet: getWallet(user) })).reverse(),
    deposits: db.rechargeRequests.map(withUser).reverse(),
    withdrawals: db.withdrawRequests.map(withUser).reverse()
  });
});

app.patch("/api/admin/wallet-settings", authMiddleware, adminMiddleware, (req, res) => {
  const current = getWalletSettings();
  const map = sanitizeInviteOverrideMap(
    req.body && Object.prototype.hasOwnProperty.call(req.body, "minInvitesForWithdrawByUser")
      ? req.body.minInvitesForWithdrawByUser
      : current.minInvitesForWithdrawByUser
  );
  const overrideUserId = numericId(req.body?.inviteOverrideUserId);
  if (overrideUserId) {
    const useGeneral = req.body?.useGeneralInviteRule === true || req.body?.useGeneralInviteRule === "true";
    if (useGeneral) delete map[String(overrideUserId)];
    else if (req.body?.minInvitesForUser !== undefined && req.body?.minInvitesForUser !== null && req.body?.minInvitesForUser !== "") {
      map[String(overrideUserId)] = normalizeMinInvitesForWithdraw(req.body.minInvitesForUser, 0);
    }
  }
  db.walletSettings = {
    currency: current.currency,
    network: String(req.body?.network || current.network).trim() || "TRC20",
    companyAddress: String(req.body?.companyAddress || current.companyAddress).trim(),
    minDeposit: roundMoney(req.body?.minDeposit ?? current.minDeposit),
    minWithdraw: roundMoney(req.body?.minWithdraw ?? current.minWithdraw),
    minInvitesForWithdraw: normalizeMinInvitesForWithdraw(req.body?.minInvitesForWithdraw, current.minInvitesForWithdraw),
    minInvitesForWithdrawByUser: map,
    withdrawCooldownMs: normalizeWithdrawCooldownMs(current.withdrawCooldownMs)
  };
  saveDb();
  res.json(getWalletSettings());
});

app.get("/api/admin/wallets/:id", authMiddleware, adminMiddleware, (req, res) => {
  const user = db.users.find((item) => item.id == req.params.id);
  if (!user) return res.status(404).json({ error: "المستخدم غير موجود" });
  res.json({ user: publicUser(user), wallet: getWallet(user) });
});

app.post("/api/wallet/withdraw", authMiddleware, identityGuard, (req, res) => {
  const settings = getWalletSettings();
  const amount = roundMoney(req.body?.amount);
  const usdtAddress = String(req.body?.usdtAddress || req.body?.details || "").trim();
  const network = String(req.body?.network || settings.network).trim();
  if (!(amount > 0)) return res.status(400).json({ error: "مبلغ USDT غير صالح" });
  if (amount < settings.minWithdraw) return res.status(400).json({ error: `الحد الأدنى للسحب ${settings.minWithdraw} USDT` });
  const requiredInvites = requiredInvitesForWithdraw(req.user.id);
  const currentInvites = qualifiedInviteCount(req.user.id);
  if (requiredInvites > 0 && currentInvites < requiredInvites) {
    return res.status(400).json({
      error: `السحب يتطلب ${requiredInvites} دعوات مؤهلة. لديك حاليًا ${currentInvites}.`
    });
  }
  if (availableBalance(req.user) < amount) return res.status(400).json({ error: "الرصيد المتاح غير كافٍ" });
  if (usdtAddress.length < 20) return res.status(400).json({ error: "أدخل عنوان محفظة USDT الخاصة بك" });

  const cooldownMs = normalizeWithdrawCooldownMs(settings.withdrawCooldownMs);
  const lastEligible = lastEligibleWithdrawRequest(req.user.id);
  if (lastEligible) {
    const started = Date.parse(lastEligible.createdAt || 0);
    const elapsed = Date.now() - started;
    if (Number.isFinite(started) && elapsed < cooldownMs) {
      const wait = formatWithdrawCooldownWait(cooldownMs - elapsed);
      return res.status(400).json({
        error: `يمكنك تقديم طلب سحب مرة واحدة كل 7 أيام. يرجى الانتظار حتى انتهاء المدة. المتبقي: ${wait}`
      });
    }
  }

  const request = {
    id: nextId(db.withdrawRequests),
    userId: req.user.id,
    amount,
    currency: "USDT",
    network,
    usdtAddress,
    status: "pending",
    createdAt: nowIso(),
    processedAt: null
  };
  db.withdrawRequests.push(request);
  recordTransaction(req.user, {
    type: "withdraw",
    amount: -amount,
    status: "pending",
    note: `سحب USDT #${request.id} إلى ${usdtAddress}`,
    applyBalance: false
  });
  saveDb();
  res.json({ request, wallet: getWallet(req.user) });
});

app.post("/api/wallet/deposit", authMiddleware, identityGuard, depositHandler);
app.post("/api/wallet/recharge", authMiddleware, identityGuard, depositHandler);

async function depositHandler(req, res) {
  const settings = getWalletSettings();
  const amount = roundMoney(req.body?.amount);
  const network = String(settings.network || "TRC20").trim() || "TRC20";
  if (!(amount > 0)) return res.status(400).json({ error: "مبلغ USDT غير صالح" });
  if (amount < settings.minDeposit) return res.status(400).json({ error: `الحد الأدنى للإيداع ${settings.minDeposit} USDT` });
  const uploaded = req.body?.file || req.body?.screenshot || null;
  const shot = uploaded ? await saveAttachment(uploaded) : null;
  if (uploaded && (!shot || !String(shot.mime || "").startsWith("image/"))) {
    return res.status(400).json({ error: "ارفع لقطة شاشة صورة للتحويل" });
  }
  const request = {
    id: nextId(db.rechargeRequests),
    userId: req.user.id,
    amount,
    currency: "USDT",
    network,
    txHash: "",
    companyAddress: settings.companyAddress,
    screenshotUrl: shot?.url || null,
    screenshotName: shot?.name || null,
    screenshotMime: shot?.mime || null,
    status: "pending",
    createdAt: nowIso(),
    processedAt: null
  };
  db.rechargeRequests.push(request);
  recordTransaction(req.user, {
    type: "deposit",
    amount,
    status: "pending",
    note: `إيداع USDT #${request.id}`,
    applyBalance: false
  });
  saveDb();
  res.json({ request, wallet: getWallet(req.user) });
}

app.get("/api/ads", authMiddleware, identityGuard, (req, res) => {
  db.adViews = db.adViews || [];
  res.json(adsPayload(req.user));
});

app.post("/api/ads/:slot/watch", authMiddleware, identityGuard, (req, res) => {
  const vip = getVip(req.user);
  if (getActiveVipLevel(req.user) <= 0 || vip.adsPerDay <= 0) {
    return res.status(403).json({ error: "فعّل باقة VIP لمشاهدة الإعلانات" });
  }
  const slot = Number(req.params.slot);
  if (slot < 1 || slot > vip.adsPerDay) return res.status(400).json({ error: "الإعلان غير متاح" });
  if (todayAdViews(req.user).some((item) => item.slot === slot)) {
    return res.status(400).json({ error: "تمت مشاهدة هذا الإعلان اليوم" });
  }
  const session = startAdWatch(req.user, slot);
  res.json(publicAdWatch(session));
});

app.post("/api/ads/:slot/complete", authMiddleware, identityGuard, (req, res) => {
  const vip = getVip(req.user);
  if (getActiveVipLevel(req.user) <= 0 || vip.adsPerDay <= 0) {
    return res.status(403).json({ error: "فعّل باقة VIP لمشاهدة الإعلانات" });
  }
  const slot = Number(req.params.slot);
  if (slot < 1 || slot > vip.adsPerDay) return res.status(400).json({ error: "الإعلان غير متاح" });
  if (todayAdViews(req.user).some((item) => item.slot === slot)) {
    return res.status(400).json({ error: "تمت مشاهدة هذا الإعلان اليوم" });
  }
  const sessionId = String(req.body?.sessionId || "");
  if (!sessionId) return res.status(400).json({ error: "ابدأ مشاهدة الإعلان أولاً" });
  db.adWatchSessions = db.adWatchSessions || [];
  const session = db.adWatchSessions.find((item) => (
    item.token === sessionId
    && sameId(item.userId, req.user.id)
    && Number(item.slot) === slot
    && item.status === "open"
  ));
  if (!session) return res.status(400).json({ error: "جلسة المشاهدة غير صالحة" });
  const readyAt = Date.parse(session.endsAt) - 400;
  if (Date.now() < readyAt) {
    return res.status(400).json({ error: "لم تنته مدة المشاهدة بعد", remainingSec: publicAdWatch(session).remainingSec });
  }
  const reward = randomAdReward();
  session.status = "completed";
  session.completedAt = nowIso();
  db.adViews.push({
    id: nextId(db.adViews),
    userId: req.user.id,
    date: todayKey(),
    slot,
    reward,
    createdAt: nowIso(),
    sessionId: session.token,
    durationSec: session.durationSec
  });
  recordTransaction(req.user, { type: "task_reward", amount: reward, note: `مكافأة إعلان ${slot}` });
  payNetworkCommissions(req.user, { type: "task_commission", baseAmount: reward, notePrefix: `عمولة إعلان من ${req.user.name}` });
  saveDb();
  res.json({ reward, wallet: getWallet(req.user) });
});

app.get("/api/tasks", authMiddleware, identityGuard, (req, res) => {
  db.adViews = db.adViews || [];
  res.json(adsPayload(req.user));
});

app.get("/api/vip", authMiddleware, identityGuard, (req, res) => {
  const uid = numericId(req.user.id);
  const pending = db.vipRequests.find((item) => sameId(item.userId, uid) && item.status === "pending") || null;
  const pendingCancel = db.vipCancelRequests.find((item) => sameId(item.userId, uid) && item.status === "pending") || null;
  const requests = db.vipRequests.filter((item) => sameId(item.userId, uid)).slice(-20).reverse();
  const cancelRequests = db.vipCancelRequests.filter((item) => sameId(item.userId, uid)).slice(-20).reverse();
  const currentLevel = getActiveVipLevel(req.user);
  const packages = VIP_PACKAGES.map((pkg) => {
    const level = Number(pkg.level);
    const isCurrent = currentLevel > 0 && level === currentLevel;
    const isLower = currentLevel > 0 && level < currentLevel;
    const canUpgrade = currentLevel > 0 && level > currentLevel;
    return {
      ...vipWithAdSlots(pkg),
      isCurrent,
      isPrevious: false,
      isLower,
      canUpgrade,
      buttonLabel: isCurrent ? "المستوى الحالي" : currentLevel > 0 ? "ترقية" : "طلب تفعيل"
    };
  });
  res.json({
    userId: uid,
    current: publicUser(req.user),
    subscription: {
      active: getActiveVipLevel(req.user) > 0,
      level: getActiveVipLevel(req.user),
      name: getVip(req.user).name,
      adsPerDay: getVip(req.user).adsPerDay,
      price: getActiveVipLevel(req.user) > 0 ? Number(req.user.vipPrice || 0) : 0,
      activatedAt: req.user.vipActivatedAt || null
    },
    activeVipLevel: getActiveVipLevel(req.user),
    packages,
    pending,
    pendingCancel,
    requests,
    cancelRequests
  });
});

app.post("/api/vip/cancel", authMiddleware, identityGuard, (req, res) => {
  if (getActiveVipLevel(req.user) <= 0) {
    return res.status(400).json({ error: "لا توجد باقة VIP مفعّلة لإلغائها" });
  }
  if (db.vipRequests.some((item) => item.userId === req.user.id && item.status === "pending")) {
    return res.status(400).json({ error: "لديك طلب قيد المراجعة" });
  }
  if (db.vipCancelRequests.some((item) => item.userId === req.user.id && item.status === "pending")) {
    return res.status(400).json({ error: "لديك طلب قيد المراجعة" });
  }
  const refundAmount = subscriptionRefundAmount(req.user);
  const request = {
    id: nextId(db.vipCancelRequests),
    userId: Number(req.user.id),
    vipLevel: getActiveVipLevel(req.user) || req.user.vipLevel,
    vipName: getVip(req.user).name,
    vipPrice: refundAmount,
    refundAmount,
    status: "pending",
    createdAt: nowIso(),
    processedAt: null,
    refundTxId: null,
    refundedUserId: null
  };
  db.vipCancelRequests.push(request);
  saveDb();
  res.json({ request, user: publicUser(req.user) });
});

app.post("/api/vip/:level/request", authMiddleware, identityGuard, (req, res) => {
  const pkg = getPackage(req.params.level);
  if (!pkg) return res.status(404).json({ error: "مستوى VIP غير موجود" });
  const currentLevel = getActiveVipLevel(req.user);
  if (pkg.level <= currentLevel) {
    return res.status(400).json({ error: "يمكنك الترقية إلى مستوى أعلى فقط" });
  }
  if (db.vipRequests.some((item) => item.userId === req.user.id && item.status === "pending")) {
    return res.status(400).json({ error: "لديك طلب قيد المراجعة" });
  }
  if (db.vipCancelRequests.some((item) => item.userId === req.user.id && item.status === "pending")) {
    return res.status(400).json({ error: "لديك طلب قيد المراجعة" });
  }

  const paidAmount = pkg.price;
  if (availableBalance(req.user) < paidAmount) return res.status(400).json({ error: "الرصيد المتاح غير كافٍ لتفعيل VIP" });

  const request = {
    id: nextId(db.vipRequests),
    userId: req.user.id,
    vipLevel: pkg.level,
    vipName: pkg.name,
    price: pkg.price,
    paidAmount,
    previousVipLevel: currentLevel,
    previousVipPrice: currentLevel > 0 ? Number(req.user.vipPrice || 0) : 0,
    previousVipName: currentLevel > 0 ? getVip(req.user).name : null,
    gift: pkg.gift,
    status: "pending",
    activationDate: null,
    createdAt: nowIso(),
    processedAt: null
  };
  db.vipRequests.push(request);
  recordTransaction(req.user, { type: "vip_activation", amount: -paidAmount, status: "pending", note: `طلب تفعيل ${pkg.name}` });
  saveDb();
  res.json({ request, user: publicUser(req.user), wallet: getWallet(req.user, { publicNotes: true }) });
});

app.get("/api/referrals", authMiddleware, identityGuard, (req, res) => {
  const payload = referralPayload(req.user);
  const inviter = db.users.find((item) => sameId(item.id, req.user.referredBy));
  payload.referredBy = inviter?.referralCode || null;
  payload.inviterName = inviter?.name || null;
  res.json(payload);
});

app.get("/api/admin/referrals", authMiddleware, adminMiddleware, (req, res) => {
  const settings = getReferralSettings();
  const signups = db.referrals.filter((item) => item.type === "signup" && item.level === 1);
  const topMap = {};
  signups.forEach((item) => {
    topMap[item.inviterId] = (topMap[item.inviterId] || 0) + 1;
  });
  const topInviters = Object.entries(topMap)
    .map(([inviterId, count]) => {
      const user = db.users.find((item) => item.id == inviterId);
      const earned = roundMoney(
        db.referrals
          .filter((item) => item.beneficiaryId == inviterId)
          .reduce((sum, item) => sum + Number(item.amount || 0), 0)
      );
      return { user: user ? publicUser(user) : null, invitedCount: count, earned, network: user ? networkSummary(user.id) : [] };
    })
    .sort((a, b) => b.invitedCount - a.invitedCount)
    .slice(0, 20);
  const placeholder = { id: 0, name: "", email: "", role: "user", balance: 0, vipLevel: 0, vipStatus: "none", referralCode: "" };
  res.json({
    settings,
    totalInvites: signups.length,
    totalPaid: roundMoney(db.referrals.reduce((sum, item) => sum + Number(item.amount || 0), 0)),
    usersWithInvites: topInviters.length,
    byLevel: settings.levels.map((cfg) => ({
      level: cfg.level,
      name: cfg.name,
      members: db.users.filter((item) => (item.inviterPath || [])[cfg.level - 1]).length,
      paid: roundMoney(
        db.referrals
          .filter((item) => item.level === cfg.level)
          .reduce((sum, item) => sum + Number(item.amount || 0), 0)
      )
    })),
    users: db.users.map((item) => publicUser(item)).reverse(),
    topInviters,
    recent: db.referrals
      .slice(-80)
      .reverse()
      .map((item) => ({
        ...item,
        inviter: publicUser(db.users.find((user) => user.id === item.inviterId) || placeholder),
        invited: publicUser(db.users.find((user) => user.id === item.invitedId) || placeholder)
      }))
  });
});

app.patch("/api/admin/referral-settings", authMiddleware, adminMiddleware, (req, res) => {
  const current = getReferralSettings();
  const signupInviter = 15;
  const signupInvited = roundMoney(req.body?.signupInvited ?? current.signupInvited);
  const maxLevels = Math.min(5, Math.max(1, Number(req.body?.maxLevels || current.maxLevels)));
  const levels = (req.body?.levels || current.levels).slice(0, maxLevels).map((item, index) => ({
    level: index + 1,
    name: String(item.name || `المستوى ${index + 1}`),
    taskRate: Math.max(0, Number(item.taskRate || 0)),
    vipRate: Math.max(0, Number(item.vipRate || 0)),
    signupBonus: Math.max(0, Number(item.signupBonus || 0))
  }));
  db.referralSettings = { signupInviter, signupInvited, maxLevels, levels };
  saveDb();
  res.json(db.referralSettings);
});

app.get("/api/admin/stats", authMiddleware, adminMiddleware, (req, res) => {
  res.json({
    users: db.users.length,
    balanceSum: roundMoney(db.users.reduce((sum, user) => sum + user.balance, 0)),
    pendingWithdrawals: db.withdrawRequests.filter((item) => item.status === "pending").length,
    pendingRecharges: db.rechargeRequests.filter((item) => item.status === "pending").length,
    pendingVip: db.vipRequests.filter((item) => item.status === "pending").length,
    pendingVipCancel: db.vipCancelRequests.filter((item) => item.status === "pending").length,
    referrals: db.referrals.filter((item) => item.type === "signup").length,
    referralPaid: roundMoney(db.referrals.reduce((sum, item) => sum + Number(item.amount || 0), 0)),
    completions: db.completions.length,
    vipUsers: db.users.filter((item) => item.vipStatus === "active" && item.vipLevel > 0).length
  });
});

app.get("/api/admin/users", authMiddleware, adminMiddleware, (req, res) => {
  res.json(db.users.map(publicUser).reverse());
});

app.post("/api/admin/users/:id/balance", authMiddleware, adminMiddleware, (req, res) => {
  const user = db.users.find((item) => item.id == req.params.id);
  if (!user) return res.status(404).json({ error: "المستخدم غير موجود" });
  const amount = roundMoney(req.body?.amount);
  const note = String(req.body?.note || "تعديل رصيد من المشرف").trim();
  if (!amount) return res.status(400).json({ error: "المبلغ غير صالح" });
  if (roundMoney((user.balance || 0) + amount) < 0) {
    return res.status(400).json({ error: "لا يمكن أن يصبح الرصيد سالباً" });
  }
  recordTransaction(user, { type: "admin_adjust", amount, note });
  saveDb();
  res.json({ user: publicUser(user), wallet: getWallet(user) });
});

app.get("/api/admin/vip-requests", authMiddleware, adminMiddleware, (req, res) => {
  res.json(db.vipRequests.map(withUser).reverse());
});

app.post("/api/admin/vip-requests/:id/approve", authMiddleware, adminMiddleware, (req, res) => {
  const request = db.vipRequests.find((item) => item.id == req.params.id);
  if (!request || request.status !== "pending") return res.status(400).json({ error: "الطلب غير قابل للمعالجة" });
  const user = db.users.find((item) => sameId(item.id, request.userId));
  if (!user) return res.status(404).json({ error: "المستخدم غير موجود" });
  const paidAmount = roundMoney(request.paidAmount || request.price || 0);
  if (!(paidAmount > 0)) return res.status(400).json({ error: "لا يمكن تفعيل VIP بدون دفع" });
  const paid = userTransactions(user.id).some((tx) => (
    tx.type === "vip_activation"
    && Number(tx.amount) < 0
    && Math.abs(Number(tx.amount)) >= paidAmount - 0.001
    && String(tx.note || "").includes(request.vipName)
  ));
  if (!paid) return res.status(400).json({ error: "لم يتم التحقق من دفع طلب VIP" });

  const activationDate = nowIso();
  request.status = "approved";
  request.activationDate = activationDate;
  request.processedAt = activationDate;

  const previousPrice = roundMoney(request.previousVipPrice || 0);
  if (previousPrice > 0) {
    recordTransaction(user, { type: "vip_refund", amount: previousPrice, note: `استرداد قيمة ${request.previousVipName || "VIP السابقة"}` });
  }
  db.vipRequests
    .filter((item) => sameId(item.userId, user.id) && item.id !== request.id && item.status === "pending")
    .forEach((item) => {
      item.status = "rejected";
      item.processedAt = activationDate;
      settlePendingTx(user, (tx) => tx.note === `طلب تفعيل ${item.vipName}` && tx.type === "vip_activation", "rejected");
      recordTransaction(user, { type: "vip_refund", amount: item.paidAmount || 0, note: `استرداد طلب ${item.vipName}` });
    });
  if (request.gift > 0) {
    recordTransaction(user, { type: "vip_gift", amount: request.gift, note: `هدية تفعيل ${request.vipName}` });
  }
  settlePendingTx(user, (item) => item.note === `طلب تفعيل ${request.vipName}` && item.type === "vip_activation", "approved");
  const isNewSubscription = !Number(request.previousVipLevel || 0);
  if (isNewSubscription) {
    user.adsCycleAt = activationDate;
  }
  payNetworkCommissions(user, {
    type: "vip_commission",
    baseAmount: Math.max(0, roundMoney(paidAmount - (request.previousVipPrice || 0))),
    notePrefix: `عمولة VIP من ${user.name} (${request.vipName})`
  });
  syncVipFromRecords(user);
  saveDb();
  audit("vip_approve", { requestId: request.id, userId: user.id, vipLevel: request.vipLevel, paidAmount });
  res.json(withUser(request));
});

app.get("/api/admin/vip-cancels", authMiddleware, adminMiddleware, (req, res) => {
  res.json(db.vipCancelRequests.map(withUser).reverse());
});

app.post("/api/admin/vip-cancels/:id/approve", authMiddleware, adminMiddleware, (req, res) => {
  const request = db.vipCancelRequests.find((item) => item.id == req.params.id);
  if (!request) return res.status(404).json({ error: "طلب الإلغاء غير موجود" });
  if (request.status === "rejected") return res.status(400).json({ error: "الطلب غير قابل للمعالجة" });
  if (request.status !== "pending" && request.status !== "approved") {
    return res.status(400).json({ error: "الطلب غير قابل للمعالجة" });
  }

  const user = db.users.find((item) => sameId(item.id, request.userId));
  if (!user) return res.status(404).json({ error: "المستخدم غير موجود" });

  const purchase = (db.vipRequests || [])
    .filter((item) => sameId(item.userId, request.userId) && item.status === "approved")
    .sort((a, b) => vipRecordTime(b) - vipRecordTime(a))[0] || null;
  const refundAmount = roundMoney(
    Number(request.refundAmount) ||
    Number(request.vipPrice) ||
    Number(purchase?.paidAmount) ||
    Number(purchase?.price) ||
    Number(getPackage(request.vipLevel || purchase?.vipLevel)?.price) ||
    0
  );

  if (request.status === "pending") {
    request.status = "approved";
    request.processedAt = nowIso();
  }

  let refundTx = null;
  if (cancelAlreadyRefunded(request)) {
    refundTx = (db.transactions || []).find((tx) => sameId(tx.id, request.refundTxId) || Number(tx.cancelRequestId) === Number(request.id)) || null;
  } else {
    if (!(refundAmount > 0)) {
      return res.status(500).json({ error: "تعذر تحديد مبلغ اشتراك VIP للاسترداد" });
    }
    const balanceBefore = roundMoney(user.balance || 0);
    user.balance = roundMoney(balanceBefore + refundAmount);
    refundTx = addTransaction(
      user.id,
      "vip_refund",
      refundAmount,
      "completed",
      `استرداد إلغاء ${request.vipName || "VIP"}`,
      user.balance,
      { cancelRequestId: request.id }
    );
    request.refundAmount = refundAmount;
    request.refundTxId = refundTx.id;
    request.refundedUserId = Number(user.id);
    console.log("VIP_CANCEL_REFUND", {
      userId: Number(user.id),
      cancelId: request.id,
      amount: refundAmount,
      balanceBefore,
      balanceAfter: user.balance,
      txId: refundTx.id
    });
    audit("vip_cancel_refund", { userId: Number(user.id), cancelId: request.id, amount: refundAmount, txId: refundTx.id });
  }

  deactivateVip(user);
  syncVipFromRecords(user);
  rebuildWalletTotals(user);
  saveDb();
  const wallet = getWallet(user, { publicNotes: true });
  if (!sameId(wallet.userId, user.id) || !sameId(user.id, request.userId)) {
    return res.status(500).json({ error: "تعذر ربط الاسترداد بالحساب الصحيح" });
  }
  if (refundTx && !sameId(refundTx.userId, user.id)) {
    return res.status(500).json({ error: "تعذر ربط الاسترداد بالحساب الصحيح" });
  }
  res.json({
    ...withUser(request),
    refundApplied: true,
    refundAmount: roundMoney(request.refundAmount || refundTx?.amount || refundAmount),
    refundTx,
    wallet,
    user: publicUser(user)
  });
});

app.post("/api/admin/vip-cancels/:id/reject", authMiddleware, adminMiddleware, (req, res) => {
  const request = db.vipCancelRequests.find((item) => item.id == req.params.id);
  if (!request || request.status !== "pending") return res.status(400).json({ error: "الطلب غير قابل للمعالجة" });
  request.status = "rejected";
  request.processedAt = nowIso();
  saveDb();
  res.json(withUser(request));
});

app.get("/api/support", authMiddleware, identityGuard, (req, res) => {
  const conversation = userConversation(req.user.id);
  if (!conversation || !sameId(conversation.userId, req.user.id)) {
    return res.status(403).json({ error: "تعذر تحميل المحادثة" });
  }
  res.json({
    userId: Number(req.user.id),
    conversation,
    messages: conversationMessages(conversation.id)
  });
});

app.post("/api/support/messages", authMiddleware, identityGuard, async (req, res) => {
  const conversation = userConversation(req.user.id);
  if (!conversation || !sameId(conversation.userId, req.user.id)) {
    return res.status(403).json({ error: "تعذر تحميل المحادثة" });
  }
  const message = await addSupportMessage({
    conversation,
    senderRole: "user",
    senderId: req.user.id,
    text: req.body?.text,
    file: req.body?.file
  });
  if (!message) return res.status(400).json({ error: "أدخل رسالة أو أرفق صورة أو فيديو" });
  saveDb();
  res.json({ conversation, message, messages: conversationMessages(conversation.id) });
});

app.get("/api/admin/support", authMiddleware, adminMiddleware, (req, res) => {
  const items = db.conversations
    .map((conversation) => {
      const user = db.users.find((item) => item.id === conversation.userId);
      return {
        ...conversation,
        user: user ? publicUser(user) : null,
        messageCount: db.messages.filter((item) => item.conversationId === conversation.id).length
      };
    })
    .sort((a, b) => new Date(b.updatedAt) - new Date(a.updatedAt));
  res.json(items);
});

app.get("/api/admin/support/:userId", authMiddleware, adminMiddleware, (req, res) => {
  const user = db.users.find((item) => item.id == req.params.userId);
  if (!user) return res.status(404).json({ error: "المستخدم غير موجود" });
  const conversation = userConversation(user.id);
  saveDb();
  res.json({ user: publicUser(user), conversation, messages: conversationMessages(conversation.id) });
});

app.post("/api/admin/support/:userId/messages", authMiddleware, adminMiddleware, async (req, res) => {
  const user = db.users.find((item) => item.id == req.params.userId);
  if (!user) return res.status(404).json({ error: "المستخدم غير موجود" });
  const conversation = userConversation(user.id);
  const message = await addSupportMessage({
    conversation,
    senderRole: "support",
    senderId: req.user.id,
    text: req.body?.text,
    file: req.body?.file
  });
  if (!message) return res.status(400).json({ error: "أدخل رسالة أو أرفق صورة أو فيديو" });
  saveDb();
  res.json({ conversation, message, messages: conversationMessages(conversation.id) });
});

app.post("/api/admin/vip-requests/:id/reject", authMiddleware, adminMiddleware, (req, res) => {
  const request = db.vipRequests.find((item) => item.id == req.params.id);
  if (!request || request.status !== "pending") return res.status(400).json({ error: "الطلب غير قابل للمعالجة" });
  const user = db.users.find((item) => item.id === request.userId);
  if (user) {
    settlePendingTx(user, (item) => item.note === `طلب تفعيل ${request.vipName}` && item.type === "vip_activation", "rejected");
    recordTransaction(user, { type: "vip_refund", amount: request.paidAmount, note: `رفض تفعيل ${request.vipName}` });
    if (user.vipStatus !== "active") {
      user.vipStatus = "none";
      user.vipLevel = 0;
      user.vipPrice = 0;
      user.vipActivatedAt = null;
    }
  }
  request.status = "rejected";
  request.processedAt = nowIso();
  saveDb();
  res.json(withUser(request));
});

app.get("/api/admin/withdrawals", authMiddleware, adminMiddleware, (req, res) => {
  res.json(db.withdrawRequests.map(withUser).reverse());
});

app.post("/api/admin/withdrawals/:id/approve", authMiddleware, adminMiddleware, (req, res) => {
  const request = db.withdrawRequests.find((item) => item.id == req.params.id);
  if (!request || request.status !== "pending") return res.status(400).json({ error: "الطلب غير قابل للمعالجة" });
  request.status = "approved";
  request.processedAt = nowIso();
  const user = db.users.find((item) => item.id === request.userId);
  if (user) {
    const settled = settlePendingTx(user, (item) => item.type === "withdraw" && String(item.note || "").includes(`#${request.id}`), "approved");
    if (!settled) {
      recordTransaction(user, { type: "withdraw", amount: -request.amount, status: "approved", note: `سحب USDT #${request.id}` });
    }
  }
  saveDb();
  audit("withdraw_approve", { requestId: request.id, userId: request.userId, amount: request.amount });
  res.json(withUser(request));
});

app.post("/api/admin/withdrawals/:id/reject", authMiddleware, adminMiddleware, (req, res) => {
  const request = db.withdrawRequests.find((item) => item.id == req.params.id);
  if (!request || request.status !== "pending") return res.status(400).json({ error: "الطلب غير قابل للمعالجة" });
  const user = db.users.find((item) => item.id === request.userId);
  if (user) settlePendingTx(user, (item) => item.type === "withdraw" && String(item.note || "").includes(`#${request.id}`), "rejected");
  request.status = "rejected";
  request.processedAt = nowIso();
  saveDb();
  res.json(withUser(request));
});

app.get("/api/admin/recharges", authMiddleware, adminMiddleware, (req, res) => {
  res.json(db.rechargeRequests.map(withUser).reverse());
});

app.post("/api/admin/recharges/:id/approve", authMiddleware, adminMiddleware, (req, res) => {
  const request = db.rechargeRequests.find((item) => item.id == req.params.id);
  if (!request || request.status !== "pending") return res.status(400).json({ error: "الطلب غير قابل للمعالجة" });
  const user = db.users.find((item) => item.id === request.userId);
  if (user) {
    const settled = settlePendingTx(user, (item) => item.type === "deposit" && String(item.note || "").includes(`#${request.id}`), "approved");
    if (!settled) {
      recordTransaction(user, { type: "deposit", amount: request.amount, status: "approved", note: `إيداع USDT #${request.id}` });
    }
  }
  request.status = "approved";
  request.processedAt = nowIso();
  saveDb();
  audit("deposit_approve", { requestId: request.id, userId: request.userId, amount: request.amount });
  res.json(withUser(request));
});

app.post("/api/admin/recharges/:id/reject", authMiddleware, adminMiddleware, (req, res) => {
  const request = db.rechargeRequests.find((item) => item.id == req.params.id);
  if (!request || request.status !== "pending") return res.status(400).json({ error: "الطلب غير قابل للمعالجة" });
  const user = db.users.find((item) => item.id === request.userId);
  if (user) settlePendingTx(user, (item) => item.type === "deposit" && String(item.note || "").includes(`#${request.id}`), "rejected");
  request.status = "rejected";
  request.processedAt = nowIso();
  saveDb();
  res.json(withUser(request));
});

app.get("/api/admin/ad-creatives", authMiddleware, adminMiddleware, (req, res) => {
  const set = getAdCreativeSet();
  res.json({
    enabled: set.enabled,
    images: set.images,
    imageCount: set.images.length,
    maxImages: MAX_AD_IMAGES,
    adsPerDayByLevel: db.adSlotSettings,
    vipAdSlots: VIP_PACKAGES.map((pkg) => ({
      level: pkg.level,
      name: pkg.name,
      adsPerDay: adsPerDayForLevel(pkg.level),
      label: `VIP ${adsPerDayForLevel(pkg.level)}`
    })),
    rotationPreview: adCreativeRotationPreview()
  });
});

app.put("/api/admin/ad-creatives", authMiddleware, adminMiddleware, async (req, res) => {
  const current = getAdCreativeSet();
  if (req.body?.adsPerDayByLevel && typeof req.body.adsPerDayByLevel === "object") {
    db.adSlotSettings = normalizeAdSlotSettings(req.body.adsPerDayByLevel);
  }
  const incoming = Array.isArray(req.body?.images) ? req.body.images.slice(0, MAX_AD_IMAGES) : [];
  const nextImages = [];
  const usedSlots = new Set();
  for (const item of incoming) {
    const slot = Math.round(Number(item?.slot || 0));
    if (!Number.isFinite(slot) || slot < 1 || slot > MAX_AD_IMAGES || usedSlots.has(slot)) continue;
    const file = item?.file;
    if (file) {
      const mimeHint = String(file.data || "").match(/^data:([^;]+);base64,/);
      if (mimeHint && !String(mimeHint[1]).startsWith("image/")) {
        return res.status(400).json({ error: "يُسمح بصور الإعلانات فقط" });
      }
      const saved = await saveAttachment(file);
      if (!saved || !String(saved.mime || "").startsWith("image/")) {
        return res.status(400).json({ error: "تعذر حفظ إحدى الصور" });
      }
      usedSlots.add(slot);
      nextImages.push({
        id: slot,
        slot,
        url: saved.url,
        name: String(file.name || saved.name || "")
      });
      continue;
    }
    const url = String(item?.url || "");
    if (!url.startsWith("/uploads/")) continue;
    usedSlots.add(slot);
    nextImages.push({
      id: slot,
      slot,
      url,
      name: String(item.name || "")
    });
  }
  const kept = new Set(nextImages.map((item) => item.url));
  for (const item of current.images) {
    if (item.url && !kept.has(item.url)) await unlinkUploadUrl(item.url);
  }
  const enabled = req.body?.enabled == null ? nextImages.length > 0 : Boolean(req.body.enabled);
  db.adCreativeSet = { enabled, images: nextImages };
  saveDb();
  const set = getAdCreativeSet();
  res.json({
    enabled: set.enabled,
    images: set.images,
    imageCount: set.images.length,
    maxImages: MAX_AD_IMAGES,
    adsPerDayByLevel: db.adSlotSettings,
    vipAdSlots: VIP_PACKAGES.map((pkg) => ({
      level: pkg.level,
      name: pkg.name,
      adsPerDay: adsPerDayForLevel(pkg.level),
      label: `VIP ${adsPerDayForLevel(pkg.level)}`
    })),
    rotationPreview: adCreativeRotationPreview()
  });
});

app.get("/api/admin/tasks", authMiddleware, adminMiddleware, (req, res) => {
  res.json(db.tasks);
});

app.post("/api/admin/tasks", authMiddleware, adminMiddleware, (req, res) => {
  const title = String(req.body?.title || "").trim();
  const description = String(req.body?.description || "").trim();
  const reward = roundMoney(req.body?.reward);
  const vipMin = Number(req.body?.vipMin || 0);
  const dailyLimit = Number(req.body?.dailyLimit || 1);
  const type = req.body?.type === "ad" ? "ad" : "task";
  if (!title || !(reward > 0)) return res.status(400).json({ error: "بيانات المهمة غير مكتملة" });
  const task = { id: nextId(db.tasks), title, description, reward, type, vipMin, dailyLimit, active: true };
  db.tasks.push(task);
  saveDb();
  res.json(task);
});

app.patch("/api/admin/tasks/:id", authMiddleware, adminMiddleware, (req, res) => {
  const task = db.tasks.find((item) => item.id == req.params.id);
  if (!task) return res.status(404).json({ error: "المهمة غير موجودة" });
  ["title", "description", "reward", "type", "vipMin", "dailyLimit", "active"].forEach((key) => {
    if (req.body[key] !== undefined) task[key] = req.body[key];
  });
  saveDb();
  res.json(task);
});

app.use((req, res) => {
  res.status(404).json({ error: "المسار غير موجود" });
});

app.use((err, req, res, next) => {
  console.error(err?.message || err);
  if (res.headersSent) return next(err);
  const status = err.status || err.statusCode || (err.type === "entity.parse.failed" ? 400 : 500);
  sendJson(res, status, { error: err.message || "طلب غير صالح" });
});

async function startServer() {
  prepareDb(await loadDb());
  await saveDb();
  const server = app.listen(PORT, "0.0.0.0");
  server.on("listening", () => {
    console.log(`ADVAULT TT backend running on port ${PORT}`);
  });
  server.on("error", (err) => {
    if (err.code === "EADDRINUSE") {
      console.error(`المنفذ ${PORT} مستخدم بالفعل. أغلق نافذة الـbackend القديمة فقط، ثم أعد npm start من ADVAULT_TT_starter\\backend`);
      return;
    }
    console.error("تعذر تشغيل الخادم:", err.message);
  });
}

startServer();
