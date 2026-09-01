import React, { createContext, useContext, useEffect, useState } from "react";
import { createRoot } from "react-dom/client";
import { App as CapApp } from "@capacitor/app";
import { Clipboard } from "@capacitor/clipboard";
import "./style.css";
import { checkNativeAppUpdate, openOfficialApk } from "./appUpdate.mjs";
import { applyDocumentLang, displayVipName, formatDate, readLang, saveLang, translate } from "./i18n.js";

const API = import.meta.env.VITE_API_URL || (import.meta.env.PROD ? "https://advault-elsg.onrender.com" : "http://127.0.0.1:3000");
const TOKEN_KEY = "advault_token";
const ACCOUNT_KEY = "advault_user_id";
const EMAIL_KEY = "advault_user_email";

const LangContext = createContext({
  lang: "ar",
  setLang() {},
  t: (text, vars) => translate("ar", text, vars),
  locale: "ar"
});

function useLang() {
  return useContext(LangContext);
}

function LangProvider({ children }) {
  const [lang, setLangState] = useState(readLang);
  useEffect(() => { applyDocumentLang(lang); }, [lang]);
  function setLang(next) {
    setLangState(saveLang(next));
  }
  const t = (text, vars) => translate(lang, text, vars);
  return (
    <LangContext.Provider value={{ lang, setLang, t, locale: lang === "en" ? "en" : "ar" }}>
      {children}
    </LangContext.Provider>
  );
}

function money(value) {
  return `${Number(value || 0).toFixed(2)} USDT`;
}

function fileNumber(id) {
  const n = Number(id);
  if (!Number.isInteger(n) || n <= 0) return "—";
  return `#${String(n).padStart(4, "0")}`;
}

function withdrawRef(id) {
  const n = Number(id);
  if (!Number.isInteger(n) || n <= 0) return "—";
  return `WD-${String(n).padStart(6, "0")}`;
}

function depositRef(id) {
  const n = Number(id);
  if (!Number.isInteger(n) || n <= 0) return "—";
  return `DP-${String(n).padStart(6, "0")}`;
}

function userMatchesQuery(user, query) {
  const raw = String(query || "").trim().toLowerCase();
  if (!raw) return true;
  const q = raw.replace(/^#/, "");
  const id = String(user?.id || "");
  const file = fileNumber(user?.id).toLowerCase();
  const name = String(user?.name || "").toLowerCase();
  const email = String(user?.email || "").toLowerCase();
  return name.includes(raw) || email.includes(raw) || id === q || file.includes(q) || file === `#${q}`;
}

function moneyRequestMatches(item, kind, query) {
  const raw = String(query || "").trim().toLowerCase();
  if (!raw) return true;
  const compact = raw.replace(/\s/g, "");
  const q = compact.replace(/^#/, "");
  const ref = (kind === "withdraw" ? withdrawRef(item.id) : depositRef(item.id)).toLowerCase();
  const file = fileNumber(item.user?.id || item.userId).toLowerCase();
  const name = String(item.user?.name || "").toLowerCase();
  const email = String(item.user?.email || "").toLowerCase();
  const id = String(item.id);
  return ref.includes(compact)
    || ref.replace("-", "") === compact.replace("-", "")
    || file.includes(q)
    || id === q
    || name.includes(raw)
    || email.includes(raw);
}

function statusLabel(status, t = (value) => value) {
  return {
    pending: t("معلّق"),
    approved: t("مقبول"),
    completed: t("مكتمل"),
    rejected: t("مرفوض"),
    cancelled: t("ملغى"),
    canceled: t("ملغى"),
    active: t("مفعّل"),
    none: t("غير مفعّل")
  }[status] || status;
}

function statusEnglish(status) {
  return {
    pending: "Pending",
    approved: "Approved",
    completed: "Completed",
    rejected: "Rejected",
    cancelled: "Cancelled",
    canceled: "Cancelled",
    active: "Active",
    none: "Inactive"
  }[status] || "";
}

function StatusBadge({ status }) {
  const { t, lang } = useLang();
  const key = String(status || "none").toLowerCase();
  const cls = key === "canceled" ? "cancelled" : key;
  const en = statusEnglish(key);
  return (
    <span className={`badge badge-${cls}`}>
      <span>{statusLabel(key, t)}</span>
      {lang === "ar" && en ? <small>{en}</small> : null}
    </span>
  );
}

function LoadingBlock() {
  const { t } = useLang();
  return (
    <div className="loading-block" role="status">
      <div className="spinner" />
      <p className="muted">{t("جاري التحميل...")}</p>
    </div>
  );
}

function EmptyState({ title, text }) {
  return (
    <div className="empty-state">
      <strong>{title}</strong>
      {text ? <p className="muted">{text}</p> : null}
    </div>
  );
}

function PageHeader({ kicker, title, subtitle }) {
  return (
    <div className="page-header">
      {kicker ? <p className="kicker">{kicker}</p> : null}
      <h1>{title}</h1>
      {subtitle ? <p className="muted">{subtitle}</p> : null}
    </div>
  );
}

function TabIcon({ name }) {
  const props = {
    width: 20,
    height: 20,
    viewBox: "0 0 24 24",
    fill: "none",
    stroke: "currentColor",
    strokeWidth: "1.8",
    strokeLinecap: "round",
    strokeLinejoin: "round",
    "aria-hidden": "true"
  };
  if (name === "home") {
    return <svg {...props}><path d="M4 10.5 12 4l8 6.5V20a1 1 0 0 1-1 1h-5v-6H10v6H5a1 1 0 0 1-1-1z" /></svg>;
  }
  if (name === "ads") {
    return <svg {...props}><rect x="4" y="5" width="16" height="14" rx="2" /><path d="M10 9.5v5l5-2.5z" /></svg>;
  }
  if (name === "wallet") {
    return <svg {...props}><rect x="3" y="6" width="18" height="13" rx="2" /><path d="M16 12h4" /></svg>;
  }
  if (name === "vip") {
    return <svg {...props}><path d="M4 16 6.5 8l5.5 5 5.5-5L20 16H4z" /><path d="M4 16h16v2H4z" /></svg>;
  }
  if (name === "referral") {
    return <svg {...props}><circle cx="9" cy="8" r="3" /><circle cx="17" cy="9" r="2.5" /><path d="M4 19c.4-3 2.6-5 5-5s4.6 2 5 5" /><path d="M14 19c.3-2 1.6-3.5 3-3.5" /></svg>;
  }
  if (name === "support") {
    return <svg {...props}><path d="M5 16.5V8a4 4 0 0 1 4-4h6a4 4 0 0 1 4 4v5a4 4 0 0 1-4 4H9z" /><path d="M8 19h2" /></svg>;
  }
  if (name === "swap") {
    return <svg {...props}><path d="M7 7h11l-3-3" /><path d="M17 17H6l3 3" /></svg>;
  }
  if (name === "person") {
    return <svg {...props}><circle cx="12" cy="8" r="3.2" /><path d="M5 19c.6-3.2 3.2-5 7-5s6.4 1.8 7 5" /></svg>;
  }
  return <svg {...props}><path d="M12 3 4 7v5c0 5 3.4 8.4 8 9 4.6-.6 8-4 8-9V7z" /></svg>;
}

function transactionTypeLabel(type, t = (value) => value) {
  return {
    task_reward: t("مكافأة إعلان"),
    referral: t("مكافأة دعوة"),
    vip_gift: t("هدية VIP"),
    vip_activation: t("تفعيل VIP"),
    vip_refund: t("استرداد VIP"),
    deposit: t("إيداع USDT"),
    withdraw: t("سحب USDT"),
    admin_adjust: t("تحديث الرصيد")
  }[type] || type;
}

function vipCardState(pkg, activeVipLevel) {
  const level = Number(pkg.level);
  const activeLevel = Number(activeVipLevel) || 0;
  if (activeLevel > 0 && level === activeLevel) {
    return { isCurrent: true, canClick: false, label: "المستوى الحالي" };
  }
  if (activeLevel > 0) {
    return { isCurrent: false, canClick: level > activeLevel, label: "ترقية" };
  }
  return { isCurrent: false, canClick: true, label: "طلب تفعيل" };
}
function fileToPayload(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve({ name: file.name, data: reader.result });
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
}

function adImageSrc(url) {
  if (!url) return "";
  const value = String(url);
  if (value.startsWith("http://") || value.startsWith("https://") || value.startsWith("blob:")) return value;
  return `${API}${value}`;
}

function DepositScreenshot({ item }) {
  if (!item?.screenshotUrl) return null;
  return (
    <a className="deposit-shot-link" href={`${API}${item.screenshotUrl}`} target="_blank" rel="noreferrer">
      <img className="deposit-shot" src={`${API}${item.screenshotUrl}`} alt={item.screenshotName || "لقطة التحويل"} />
    </a>
  );
}

function withdrawPayoutAddress(item) {
  return String(item?.usdtAddress || item?.details || "").trim();
}

function WithdrawPayoutAddress({ item, onCopied }) {
  const { t } = useLang();
  const address = withdrawPayoutAddress(item);
  if (!address) return <p className="muted">{t("لا يوجد عنوان محفظة في هذا الطلب")}</p>;

  async function copy() {
    try {
      await navigator.clipboard.writeText(address);
      if (onCopied) onCopied(t("تم نسخ العنوان"));
    } catch {
      if (onCopied) onCopied(t("تعذر النسخ"));
    }
  }

  return (
    <div className="withdraw-payout">
      <p className="metric-label">{t("عنوان محفظة المستخدم")}</p>
      <div className="withdraw-payout-row">
        <code className="withdraw-payout-addr">{address}</code>
        <button type="button" className="ghost" onClick={copy}>{t("نسخ")}</button>
      </div>
    </div>
  );
}

function ChatMessages({ messages, selfRole = "user" }) {
  const { t, lang } = useLang();
  return (
    <div className="chat-log">
      {messages.length === 0 && <EmptyState title={t("لا توجد رسائل بعد")} text={t("ابدأ المحادثة بإرسال رسالة.")} />}
      {messages.map((item) => (
        <div className={`chat-bubble ${item.senderRole === selfRole ? "me" : "them"}`} key={item.id}>
          <small>{item.senderRole === "user" ? (selfRole === "user" ? t("أنت") : t("المستخدم")) : t("الدعم")}</small>
          {item.text && <p>{item.text}</p>}
          {item.attachmentUrl && item.attachmentMime?.startsWith("image/") && (
            <a href={`${API}${item.attachmentUrl}`} target="_blank" rel="noreferrer">
              <img src={`${API}${item.attachmentUrl}`} alt={item.attachmentName || t("صورة")} />
            </a>
          )}
          {item.attachmentUrl && item.attachmentMime?.startsWith("video/") && (
            <video src={`${API}${item.attachmentUrl}`} controls />
          )}
          <small className="muted">{formatDate(lang, item.createdAt)}</small>
        </div>
      ))}
    </div>
  );
}

async function readJson(res) {
  const text = await res.text();
  if (!text || !String(text).trim()) {
    throw new Error("الخادم لم يُرجع بيانات. شغّل الواجهة الخلفية على المنفذ 3000");
  }
  try {
    return JSON.parse(text);
  } catch {
    throw new Error("تعذر قراءة رد الخادم");
  }
}

function emptyAccount(partial = {}) {
  return {
    id: Number(partial.id) || 0,
    name: partial.name || "",
    email: partial.email || "",
    role: partial.role === "admin" ? "admin" : "user",
    balance: 0,
    available: 0,
    totalEarnings: 0,
    totalWithdrawals: 0,
    vipLevel: 0,
    vipName: "بدون VIP",
    vipStatus: "none",
    vipPrice: 0,
    vipActivatedAt: null,
    adsPerDay: 0,
    invitedCount: 0,
    referralCode: partial.referralCode || "",
    wallet: null
  };
}

function snapshotAccount(raw, wallet) {
  if (!raw || !Number(raw.id)) return null;
  const ownedWallet = wallet && Number(wallet.userId) === Number(raw.id)
    ? wallet
    : (raw.wallet && Number(raw.wallet.userId) === Number(raw.id) ? raw.wallet : null);
  const vipOn = Number(raw.vipLevel) > 0 && String(raw.vipStatus).toLowerCase() === "active";
  return {
    id: Number(raw.id),
    name: String(raw.name || ""),
    email: String(raw.email || ""),
    role: raw.role === "admin" ? "admin" : "user",
    balance: Number(ownedWallet?.balance ?? raw.balance ?? 0),
    available: Number(ownedWallet?.available ?? raw.available ?? raw.balance ?? 0),
    totalEarnings: Number(ownedWallet?.totalEarnings ?? raw.totalEarnings ?? 0),
    totalWithdrawals: Number(ownedWallet?.totalWithdrawals ?? raw.totalWithdrawals ?? 0),
    vipLevel: vipOn ? Number(raw.vipLevel) : 0,
    vipName: vipOn ? String(raw.vipName || "بدون VIP") : "بدون VIP",
    vipStatus: vipOn ? "active" : "none",
    vipPrice: vipOn ? Number(raw.vipPrice || 0) : 0,
    vipActivatedAt: vipOn ? (raw.vipActivatedAt || null) : null,
    adsPerDay: vipOn ? Number(raw.adsPerDay || 0) : 0,
    invitedCount: Number(raw.invitedCount || 0),
    referralCode: String(raw.referralCode || ""),
    wallet: ownedWallet
  };
}

function mergeAccount(me, wallet) {
  return snapshotAccount(me, wallet);
}

function BootScreen() {
  const { t, lang } = useLang();
  return (
    <div className="boot-screen" dir={lang === "en" ? "ltr" : "rtl"}>
      <div className="card">
        <div className="brand">ADVAULT <span>TT</span></div>
        <LoadingBlock />
        <p className="muted">{t("جاري استعادة الجلسة...")}</p>
      </div>
    </div>
  );
}

function resetSearchParams() {
  const href = String(window.location.href || "").replace(/&amp;/gi, "&");
  let search = "";
  let hashQuery = "";
  try {
    const url = new URL(href);
    search = String(url.search || "").replace(/^\?/, "");
    hashQuery = String(url.hash || "").replace(/^#\/?/, "").replace(/^\?/, "");
  } catch {
    search = String(window.location.search || "").replace(/^\?/, "");
    hashQuery = String(window.location.hash || "").replace(/^#\/?/, "").replace(/^\?/, "");
  }
  return new URLSearchParams([search, hashQuery].filter(Boolean).join("&").replace(/&amp;/gi, "&"));
}

function resetParam(params, name) {
  return String(params.get(name) || params.get(`amp;${name}`) || "").trim();
}

const INVITE_REF_KEY = "advault_invite_ref";
const INVITE_REF_EVENT = "advault-invite-ref";

function normalizeInviteCode(value) {
  const raw = String(value || "").trim();
  if (!raw) return "";
  try {
    const fromUrl = String(new URL(raw).searchParams.get("ref") || "").trim().toUpperCase();
    if (/^TT[A-Z0-9]{4,16}$/.test(fromUrl)) return fromUrl;
  } catch {}
  const upper = raw.toUpperCase();
  if (/^TT[A-Z0-9]{4,16}$/.test(upper)) return upper;
  const match = upper.match(/\b(TT[A-Z0-9]{4,16})\b/);
  return match ? match[1] : "";
}

function persistInviteRef(code) {
  const next = normalizeInviteCode(code);
  if (!next) return "";
  try { sessionStorage.setItem(INVITE_REF_KEY, next); } catch {}
  try { localStorage.setItem(INVITE_REF_KEY, next); } catch {}
  return next;
}

function storedInviteRef() {
  try {
    return normalizeInviteCode(sessionStorage.getItem(INVITE_REF_KEY) || localStorage.getItem(INVITE_REF_KEY) || "");
  } catch {
    return "";
  }
}

function captureInviteRefFromHref(href) {
  try {
    const url = new URL(String(href || ""), window.location.origin);
    const code = normalizeInviteCode(url.searchParams.get("ref") || url.searchParams.get("amp;ref") || "");
    if (!code) return "";
    persistInviteRef(code);
    try {
      window.history.replaceState({}, "", `/?ref=${encodeURIComponent(code)}`);
    } catch {}
    window.dispatchEvent(new Event(INVITE_REF_EVENT));
    return code;
  } catch {
    return "";
  }
}

function readInviteRef() {
  return normalizeInviteCode(resetParam(resetSearchParams(), "ref")) || storedInviteRef();
}

async function captureInviteRefFromClipboard() {
  if (readInviteRef()) return "";
  let raw = "";
  try {
    raw = String((await Clipboard.read())?.value || "");
  } catch {
    try {
      raw = await navigator.clipboard.readText();
    } catch {
      raw = "";
    }
  }
  const code = normalizeInviteCode(raw);
  if (!code) return "";
  return captureInviteRefFromHref(`https://advault-tt-landing.onrender.com/?ref=${encodeURIComponent(code)}`);
}

function listenForInviteLinks() {
  captureInviteRefFromHref(window.location.href);
  CapApp.getLaunchUrl().then((launch) => {
    if (launch?.url) captureInviteRefFromHref(launch.url);
  }).catch(() => {});
  window.setTimeout(() => {
    captureInviteRefFromClipboard().catch(() => {});
  }, 500);
  CapApp.addListener("appUrlOpen", (event) => {
    if (event?.url) captureInviteRefFromHref(event.url);
  }).catch(() => {});
}

function decodeResetPathPayload(segment) {
  try {
    const cleaned = String(segment || "").trim();
    if (!cleaned) return { email: "", code: "" };
    const padded = cleaned.replace(/-/g, "+").replace(/_/g, "/") + "=".repeat((4 - (cleaned.length % 4 || 4)) % 4);
    const binary = atob(padded);
    const bytes = Uint8Array.from(binary, (ch) => ch.charCodeAt(0));
    const text = new TextDecoder().decode(bytes);
    const split = text.indexOf("\0");
    if (split < 0) return { email: "", code: "" };
    return { email: text.slice(0, split).trim(), code: text.slice(split + 1).trim() };
  } catch {
    return { email: "", code: "" };
  }
}

function resetPathname() {
  const path = String(window.location.pathname || "").replace(/\/+$/, "") || "/";
  if (path === "/reset" || path.startsWith("/reset/")) return path;
  const hash = String(window.location.hash || "").replace(/^#/, "");
  const hashPath = (hash.startsWith("/") ? hash : `/${hash}`).split("?")[0].replace(/\/+$/, "") || "/";
  if (hashPath === "/reset" || hashPath.startsWith("/reset/")) return hashPath;
  return path;
}

function readResetPathPayload() {
  const match = resetPathname().match(/^\/reset\/([^/]+)$/);
  return match ? decodeResetPathPayload(decodeURIComponent(match[1])) : { email: "", code: "" };
}

function isPasswordResetRoute() {
  if (document.documentElement.getAttribute("data-advault-reset") === "1") return true;
  const path = resetPathname();
  if (path === "/reset" || path.startsWith("/reset/")) return true;
  const params = resetSearchParams();
  return Boolean(resetParam(params, "reset") || resetParam(params, "code"));
}

function adminRecoveryPathname() {
  const path = String(window.location.pathname || "").replace(/\/+$/, "") || "/";
  if (path === "/admin-recovery") return path;
  const hash = String(window.location.hash || "").replace(/^#/, "");
  const hashPath = (hash.startsWith("/") ? hash : `/${hash}`).split("?")[0].replace(/\/+$/, "") || "/";
  if (hashPath === "/admin-recovery") return hashPath;
  return path;
}

function isAdminRecoveryRoute() {
  if (document.documentElement.getAttribute("data-advault-admin-recovery") === "1") return true;
  return adminRecoveryPathname() === "/admin-recovery";
}

function readPasswordResetParams() {
  const fromPath = readResetPathPayload();
  const params = resetSearchParams();
  return {
    email: fromPath.email || resetParam(params, "email"),
    code: fromPath.code || resetParam(params, "code")
  };
}

function AppUpdatePrompt() {
  const { t } = useLang();
  const [update, setUpdate] = useState(null);

  useEffect(() => {
    let cancelled = false;
    checkNativeAppUpdate()
      .then((info) => {
        if (!cancelled && info) setUpdate(info);
      })
      .catch(() => {});
    return () => { cancelled = true; };
  }, []);

  if (!update) return null;

  return (
    <div className="app-update-mask" role="dialog" aria-modal="true">
      <div className="card">
        <h3>{t("يوجد تحديث جديد")}</h3>
        <p>{t("الإصدار {version}", { version: update.latestVersion })}</p>
        <button type="button" onClick={() => openOfficialApk(update.apkUrl)}>{t("تحديث الآن")}</button>
        {update.optional !== false && (
          <button type="button" className="ghost" onClick={() => setUpdate(null)}>{t("لاحقًا")}</button>
        )}
      </div>
    </div>
  );
}

function App() {
  const { t, lang } = useLang();
  const [token, setToken] = useState(localStorage.getItem(TOKEN_KEY) || "");
  const [user, setUser] = useState(null);
  const [authReady, setAuthReady] = useState(!localStorage.getItem(TOKEN_KEY));
  const [page, setPage] = useState("home");
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");

  function currentUserId() {
    return Number(localStorage.getItem(ACCOUNT_KEY) || 0);
  }

  function clearSession() {
    localStorage.removeItem(TOKEN_KEY);
    localStorage.removeItem(ACCOUNT_KEY);
    localStorage.removeItem(EMAIL_KEY);
    setToken("");
    setUser(null);
    setPage("home");
    setError("");
    setNotice("");
    setAuthReady(true);
  }

  function applyAccount(account) {
    if (!account || !Number(account.id)) return null;
    const locked = currentUserId();
    const lockedEmail = (localStorage.getItem(EMAIL_KEY) || "").toLowerCase();
    if (locked && Number(account.id) !== locked) return null;
    if (lockedEmail && String(account.email || "").toLowerCase() !== lockedEmail) return null;
    const snap = snapshotAccount(account, account.wallet);
    if (!locked) localStorage.setItem(ACCOUNT_KEY, String(snap.id));
    if (!lockedEmail && snap.email) localStorage.setItem(EMAIL_KEY, snap.email);
    setUser(snap);
    return snap;
  }

  async function refreshUser() {
    const me = await api("/api/me");
    const locked = currentUserId();
    if (locked && Number(me.id) !== locked) return null;
    const wallet = me?.wallet && Number(me.wallet.userId) === Number(me.id)
      ? me.wallet
      : await api("/api/wallet");
    if (locked && wallet?.userId && Number(wallet.userId) !== locked) return null;
    return applyAccount(snapshotAccount(me, wallet));
  }

  async function api(path, options = {}) {
    const sessionToken = localStorage.getItem(TOKEN_KEY) || token;
    let res;
    try {
      res = await fetch(`${API}${path}`, {
        ...options,
        headers: {
          "Content-Type": "application/json",
          ...(sessionToken ? { Authorization: `Bearer ${sessionToken}` } : {}),
          ...(currentUserId() ? { "X-Account-Id": String(currentUserId()) } : {}),
          ...(options.headers || {})
        }
      });
    } catch {
      throw new Error("تعذر الاتصال بالخادم. شغّل الواجهة الخلفية على المنفذ 3000");
    }
    const data = await readJson(res).catch((err) => {
      if (!res.ok) return { error: err.message };
      throw err;
    });
    if (res.status === 401 && path !== "/api/auth/login" && path !== "/api/auth/register") {
      if (localStorage.getItem(TOKEN_KEY) === sessionToken) clearSession();
      throw new Error(data.error || "يلزم تسجيل الدخول");
    }
    if (!res.ok) throw new Error(data.error || "حدث خطأ");
    return data;
  }

  useEffect(() => {
    if (isPasswordResetRoute() || isAdminRecoveryRoute()) {
      setAuthReady(true);
      return;
    }
    if (!token) {
      setUser(null);
      setAuthReady(true);
      return;
    }
    let cancelled = false;
    refreshUser()
      .then((account) => {
        if (cancelled) return;
        if (account) {
          applyAccount(account);
          setAuthReady(true);
        } else {
          clearSession();
        }
      })
      .catch(() => {
        if (!cancelled) clearSession();
      });
    return () => { cancelled = true; };
  }, [token]);

  async function loginSuccess(data) {
    const account = snapshotAccount(data.user, data.user?.wallet);
    if (!account) {
      setError("تعذر تحميل الحساب");
      return;
    }
    localStorage.setItem(TOKEN_KEY, data.token);
    localStorage.setItem(ACCOUNT_KEY, String(account.id));
    localStorage.setItem(EMAIL_KEY, account.email);
    setUser(account);
    setToken(data.token);
    setPage("home");
    setError("");
    setNotice("");
    try {
      const res = await fetch(`${API}/api/me`, {
        headers: {
          Authorization: `Bearer ${data.token}`,
          "Content-Type": "application/json",
          "X-Account-Id": String(account.id)
        }
      });
      const me = await res.json().catch(() => null);
      if (me && res.ok && Number(me.id) === account.id && String(me.email).toLowerCase() === account.email && Number(localStorage.getItem(ACCOUNT_KEY)) === account.id) {
        applyAccount(snapshotAccount(me, me.wallet));
      }
    } catch {}
    setAuthReady(true);
  }

  async function logout() {
    try { await api("/api/auth/logout", { method: "POST" }); } catch {}
    clearSession();
  }

  function go(nextPage) {
    if (!user) return;
    setError("");
    setNotice("");
    setPage(nextPage);
  }

  if (isPasswordResetRoute() || isAdminRecoveryRoute()) {
    return <Auth onSuccess={loginSuccess} />;
  }

  if (!authReady) {
    return (
      <BootScreen />
    );
  }

  if (!user || !token) {
    return <Auth onSuccess={loginSuccess} />;
  }

  const allowed = ["home", "tasks", "wallet", "vip", "referral", "support", "account"];
  if (user.role === "admin") allowed.push("admin");
  const safePage = allowed.includes(page) ? page : "home";

  return (
    <div className="app-shell" dir={lang === "en" ? "ltr" : "rtl"} key={`session-${user.id}`}>
      <header className="topbar">
        <div className="brand-mark">
          <div className="brand">ADVAULT <span>TT</span></div>
          {user.role === "admin" && <small>{t("لوحة الإدارة")}</small>}
        </div>
        <div className="topbar-end">
          <span className="topbar-name">{user.name}</span>
        </div>
      </header>
      <main className="app-main">
      {error && <div className="alert">{t(error)}</div>}
      {notice && <div className="success">{t(notice)}</div>}
      {safePage === "home" && <Home key={user.id} api={api} user={user} go={go} />}
      {safePage === "tasks" && <Tasks key={`ads-${user.id}`} api={api} user={user} onDone={refreshUser} setError={setError} setNotice={setNotice} />}
      {safePage === "wallet" && <Wallet key={`wal-${user.id}`} api={api} user={user} onDone={refreshUser} setError={setError} setNotice={setNotice} />}
      {safePage === "vip" && <Vip key={`vip-${user.id}`} api={api} user={user} onDone={refreshUser} setError={setError} setNotice={setNotice} />}
      {safePage === "referral" && <Referral key={`ref-${user.id}`} api={api} user={user} setError={setError} setNotice={setNotice} />}
      {safePage === "support" && <Support key={`sup-${user.id}`} api={api} setError={setError} setNotice={setNotice} />}
      {safePage === "account" && user.role !== "admin" && <Account key={`acc-${user.id}`} api={api} user={user} logout={logout} setError={setError} setNotice={setNotice} />}
      {safePage === "account" && user.role === "admin" && <AdminAccount key={`adm-acc-${user.id}`} api={api} user={user} logout={logout} setError={setError} setNotice={setNotice} />}
      {safePage === "admin" && user.role === "admin" && <Admin key={`adm-${user.id}`} api={api} setError={setError} setNotice={setNotice} />}
      </main>
      <nav className="nav tabbar">
        <button type="button" className={safePage === "home" ? "active" : ""} onClick={() => go("home")}><TabIcon name="home" /><span>{t("الرئيسية")}</span></button>
        <button type="button" className={safePage === "tasks" ? "active" : ""} onClick={() => go("tasks")}><TabIcon name="ads" /><span>{t("الإعلانات")}</span></button>
        <button type="button" className={safePage === "wallet" ? "active" : ""} onClick={() => go("wallet")}><TabIcon name="wallet" /><span>{t("المحفظة")}</span></button>
        <button type="button" className={safePage === "vip" ? "active" : ""} onClick={() => go("vip")}><TabIcon name="vip" /><span>VIP</span></button>
        <button type="button" className={safePage === "referral" ? "active" : ""} onClick={() => go("referral")}><TabIcon name="referral" /><span>{t("الدعوات")}</span></button>
        <button type="button" className={safePage === "account" ? "active" : ""} onClick={() => go("account")}><TabIcon name="person" /><span>{t("الحساب")}</span></button>
      </nav>
    </div>
  );
}

function Auth({ onSuccess }) {
  const { t, lang } = useLang();
  const initialReset = isPasswordResetRoute() ? readPasswordResetParams() : { email: "", code: "" };
  const [mode, setMode] = useState(isAdminRecoveryRoute() ? "admin-recovery" : isPasswordResetRoute() ? "reset" : "register");
  const [form, setForm] = useState({
    name: "",
    email: initialReset.email,
    password: "",
    confirmPassword: "",
    referralCode: isPasswordResetRoute() || isAdminRecoveryRoute() ? "" : readInviteRef(),
    resetCode: initialReset.code,
    recoveryCode: ""
  });
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");

  useEffect(() => {
    if (!isPasswordResetRoute()) return;
    const next = readPasswordResetParams();
    setMode("reset");
    setForm((current) => ({
      ...current,
      email: next.email || current.email,
      resetCode: next.code || current.resetCode
    }));
  }, []);

  useEffect(() => {
    if (isPasswordResetRoute() || isAdminRecoveryRoute()) return;
    function applyInviteRef() {
      const code = readInviteRef();
      if (!code) return;
      persistInviteRef(code);
      setMode("register");
      setForm((current) => (current.referralCode === code ? current : { ...current, referralCode: code }));
    }
    applyInviteRef();
    captureInviteRefFromClipboard().then(applyInviteRef).catch(() => applyInviteRef());
    window.addEventListener(INVITE_REF_EVENT, applyInviteRef);
    return () => window.removeEventListener(INVITE_REF_EVENT, applyInviteRef);
  }, []);

  function change(e) {
    const name = e.target.name === "advaultEmail" ? "email" : e.target.name;
    if (name === "referralCode" && storedInviteRef()) return;
    setForm({ ...form, [name]: e.target.value });
  }

  async function submit(e) {
    e.preventDefault();
    setError("");
    setNotice("");
    const email = String(form.email || "").trim().toLowerCase();
    if (mode === "admin-recovery") {
      if (form.password !== form.confirmPassword) {
        setError(t("تأكيد كلمة المرور غير مطابق"));
        return;
      }
      try {
        try {
          console.info("ADVAULT admin-recovery", String(API), "POST /api/auth/admin-recovery");
        } catch {}
        const res = await fetch(`${API}/api/auth/admin-recovery`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            email,
            recoveryCode: form.recoveryCode,
            newPassword: form.password,
            confirmPassword: form.confirmPassword
          })
        });
        const data = await readJson(res);
        if (!res.ok) throw new Error(data.error || t("تعذر استعادة حساب الأدمن"));
        setNotice(data.message || t("تم تعيين كلمة مرور الأدمن الجديدة. يمكنك تسجيل الدخول."));
        setMode("login");
        setForm({ ...form, password: "", confirmPassword: "", recoveryCode: "" });
        window.history.replaceState({}, "", "/");
        document.documentElement.removeAttribute("data-advault-admin-recovery");
      } catch (err) {
        setError(err.message);
      }
      return;
    }
    if (mode === "forgot") {
      try {
        const res = await fetch(`${API}/api/auth/forgot-password`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ email })
        });
        const data = await readJson(res);
        if (!res.ok) throw new Error(data.error || t("تعذر الدخول"));
        setNotice(data.message || t("هذا البريد مسجل. تم إرسال رابط استعادة كلمة المرور إلى بريدك."));
        setMode("reset");
      } catch (err) {
        setError(err.message);
      }
      return;
    }
    if (mode === "reset") {
      if (form.password !== form.confirmPassword) {
        setError(t("تأكيد كلمة المرور غير مطابق"));
        return;
      }
      try {
        const res = await fetch(`${API}/api/auth/reset-password`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            email,
            token: form.resetCode,
            code: form.resetCode,
            newPassword: form.password,
            confirmPassword: form.confirmPassword
          })
        });
        const data = await readJson(res);
        if (!res.ok) throw new Error(data.error || t("تعذر الدخول"));
        setNotice(data.message || t("تم تعيين كلمة المرور الجديدة. يمكنك تسجيل الدخول."));
        setMode("login");
        setForm({ ...form, password: "", confirmPassword: "", resetCode: "" });
        window.history.replaceState({}, "", "/");
        document.documentElement.removeAttribute("data-advault-reset");
      } catch (err) {
        setError(err.message);
      }
      return;
    }
    if (mode === "register" && form.password !== form.confirmPassword) {
      setError(t("تأكيد كلمة المرور غير مطابق"));
      return;
    }
    localStorage.removeItem(TOKEN_KEY);
    localStorage.removeItem(ACCOUNT_KEY);
    localStorage.removeItem(EMAIL_KEY);
    try {
      const path = mode === "login" ? "/api/auth/login" : "/api/auth/register";
      const res = await fetch(`${API}${path}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: form.name,
          email,
          password: form.password,
          ...(mode === "register" && (storedInviteRef() || String(form.referralCode || "").trim())
            ? { referralCode: storedInviteRef() || String(form.referralCode).trim() }
            : {})
        })
      });
      const data = await readJson(res);
      if (!res.ok) throw new Error(data.error || t("تعذر الدخول"));
      if (!data.user || String(data.user.email || "").toLowerCase() !== email) {
        throw new Error(t("الحساب المسترجع لا يطابق البريد المدخل"));
      }
      onSuccess(data);
    } catch (err) {
      setError(err.message);
    }
  }

  const title = mode === "login"
    ? t("تسجيل الدخول")
    : mode === "forgot"
      ? t("استعادة كلمة المرور")
      : mode === "reset"
        ? t("تعيين كلمة المرور")
        : mode === "admin-recovery"
          ? t("استعادة كلمة مرور الأدمن")
          : t("إنشاء حساب");
  const subtitle = mode === "login"
    ? t("أدخل بيانات حسابك للوصول إلى محفظتك واشتراكك.")
    : mode === "forgot"
      ? t("أدخل بريدك لإرسال رابط استعادة كلمة المرور.")
      : mode === "reset"
        ? t("أدخل الرمز المرسل إلى بريدك ثم عيّن كلمة مرور جديدة.")
        : mode === "admin-recovery"
          ? t("أدخل بريد الأدمن ورمز الاستعادة المحفوظ خارج التطبيق، ثم عيّن كلمة مرور جديدة.")
          : t("الحساب الجديد يبدأ برصيد صفر وبدون VIP أو دعوات.");

  return (
    <div className="auth-screen" dir={lang === "en" ? "ltr" : "rtl"}>
      <div className="auth-box card">
        <div className="brand">ADVAULT <span>TT</span></div>
        <h1>{title}</h1>
        <p className="muted">{subtitle}</p>
        {mode !== "forgot" && mode !== "reset" && mode !== "admin-recovery" && (
          <div className="nav">
            <button type="button" className={mode === "login" ? "active" : ""} onClick={() => { setMode("login"); setError(""); setNotice(""); }}>{t("تسجيل الدخول")}</button>
            <button type="button" className={mode === "register" ? "active" : ""} onClick={() => { setMode("register"); setError(""); setNotice(""); }}>{t("إنشاء حساب")}</button>
          </div>
        )}
        {error && <div className="alert">{t(error)}</div>}
        {notice && <div className="success">{t(notice)}</div>}
        <form onSubmit={submit} autoComplete="off">
          {mode === "register" && (
            <>
              <label>{t("الاسم")}</label>
              <input name="name" value={form.name} onChange={change} required minLength={2} />
            </>
          )}
          <label>{t("البريد")}</label>
          <input name="advaultEmail" type="email" value={form.email} onChange={change} required autoComplete="off" />
          {mode === "reset" && (
            <>
              <label>{t("رمز الاستعادة")}</label>
              <input name="resetCode" value={form.resetCode} onChange={change} required autoComplete="off" />
            </>
          )}
          {mode === "admin-recovery" && (
            <>
              <label>{t("رمز استعادة الأدمن")}</label>
              <input name="recoveryCode" value={form.recoveryCode} onChange={change} required autoComplete="off" autoCapitalize="characters" />
            </>
          )}
          {(mode === "login" || mode === "register" || mode === "reset" || mode === "admin-recovery") && (
            <>
              <label>{mode === "reset" || mode === "admin-recovery" ? t("كلمة المرور الجديدة") : t("كلمة المرور")}</label>
              <input name="password" type="password" value={form.password} onChange={change} required minLength={6} autoComplete={mode === "login" ? "current-password" : "new-password"} />
            </>
          )}
          {(mode === "register" || mode === "reset" || mode === "admin-recovery") && (
            <>
              <label>{t("تأكيد كلمة المرور")}</label>
              <input name="confirmPassword" type="password" value={form.confirmPassword} onChange={change} required minLength={6} autoComplete="new-password" />
            </>
          )}
          {mode === "register" && (
            <>
              <label>{storedInviteRef() ? t("كود الدعوة") : t("كود الدعوة (اختياري)")}</label>
              <input
                name="referralCode"
                className={storedInviteRef() ? "invite-locked" : undefined}
                value={form.referralCode}
                onChange={change}
                readOnly={Boolean(storedInviteRef())}
                autoComplete="off"
              />
              {storedInviteRef() ? <p className="muted">{t("كود الدعوة من الرابط ولا يمكن تغييره")}</p> : null}
            </>
          )}
          <div className="row">
            <button className="primary" type="submit">
              {mode === "login" ? t("دخول") : mode === "forgot" ? t("إرسال رابط الاستعادة") : mode === "reset" || mode === "admin-recovery" ? t("تعيين كلمة المرور") : t("إنشاء الحساب")}
            </button>
          </div>
        </form>
        {mode === "login" && (
          <>
            <button type="button" className="auth-forgot" onClick={() => { setMode("forgot"); setError(""); setNotice(""); setForm({ ...form, password: "" }); }}>{t("نسيت كلمة المرور؟")}</button>
            <button type="button" className="auth-forgot" onClick={() => { setMode("admin-recovery"); setError(""); setNotice(""); setForm({ ...form, password: "", confirmPassword: "", recoveryCode: "" }); }}>{t("استعادة حساب الأدمن")}</button>
          </>
        )}
        {(mode === "forgot" || mode === "reset" || mode === "admin-recovery") && (
          <button type="button" className="auth-forgot" onClick={() => { setMode("login"); setError(""); setNotice(""); }}>{t("العودة لتسجيل الدخول")}</button>
        )}
      </div>
    </div>
  );
}

function Home({ api, user, go }) {
  const { t, lang } = useLang();
  const [profile, setProfile] = useState(user);
  const [ads, setAds] = useState(null);
  const [wallet, setWallet] = useState(null);
  const [refs, setRefs] = useState(null);
  useEffect(() => {
    let cancelled = false;
    setProfile(user);
    (async () => {
      try {
        const me = await api("/api/me");
        if (cancelled || Number(me.id) !== Number(user.id)) return;
        const ownedWallet = me.wallet && Number(me.wallet.userId) === Number(user.id)
          ? me.wallet
          : await api("/api/wallet");
        if (cancelled || Number(ownedWallet.userId) !== Number(user.id)) return;
        setProfile(snapshotAccount(me, ownedWallet));
        setWallet(ownedWallet);
      } catch {}
      try {
        const adsData = await api("/api/ads");
        if (!cancelled && (!adsData.userId || Number(adsData.userId) === Number(user.id))) setAds(adsData);
      } catch {}
      try {
        const refData = await api("/api/referrals");
        if (!cancelled && Number(refData.userId) === Number(user.id)) setRefs(refData);
      } catch {}
    })();
    return () => { cancelled = true; };
  }, [user.id]);
  const view = profile && Number(profile.id) === Number(user.id) ? profile : user;
  const activity = (wallet?.transactions || []).slice(0, 6);
  const currentBalance = Number(view.balance || 0);
  const availableBalance = Number(view.available ?? wallet?.available ?? currentBalance);
  const lockedAmount = Number(wallet?.locked || 0);
  const availableEqualsBalance = Number(availableBalance.toFixed(2)) === Number(currentBalance.toFixed(2));
  const totalEarnings = Number(view.totalEarnings ?? wallet?.totalEarnings ?? 0);
  const totalWithdrawals = Number(view.totalWithdrawals ?? wallet?.totalWithdrawals ?? 0);
  const initial = String(view.name || "U").trim().charAt(0);
  void ads;
  void refs;
  return (
    <div className="home">
      <div className="home-hello">
        <div>
          <p className="muted">{t("مرحباً بك")}</p>
          <h1>{view.name}</h1>
        </div>
        <div className="home-avatar" aria-hidden="true">{initial}</div>
      </div>
      <div className="card home-balance">
        <div className="home-balance-top">
          <div>
            <p className="metric-label">{t("الرصيد الحالي")}</p>
            <div className="stat">{money(currentBalance)}</div>
            {lockedAmount > 0 ? (
              <p className="muted">{t("محجوز للسحب: {amount}", { amount: money(lockedAmount) })}</p>
            ) : !availableEqualsBalance ? (
              <p className="muted">{t("القابل للاستخدام: {amount}", { amount: money(availableBalance) })}</p>
            ) : null}
          </div>
          <span className="home-balance-icon"><TabIcon name="wallet" /></span>
        </div>
        <div className="home-balance-foot">
          <div>
            <p className="metric-label">{t("إجمالي الأرباح")}</p>
            <strong>{money(totalEarnings)}</strong>
          </div>
          <div>
            <p className="metric-label">{t("إجمالي السحب")}</p>
            <strong>{money(totalWithdrawals)}</strong>
          </div>
        </div>
      </div>
      <div className="home-actions">
        <button type="button" className="home-action" onClick={() => go("tasks")}>
          <TabIcon name="ads" /><span>{t("الإعلانات")}</span>
        </button>
        <button type="button" className="home-action home-action-vip" onClick={() => go("vip")}>
          <TabIcon name="vip" /><span>VIP</span>
        </button>
        <button type="button" className="home-action" onClick={() => go("wallet")}>
          <TabIcon name="wallet" /><span>{t("المحفظة")}</span>
        </button>
        <button type="button" className="home-action" onClick={() => go("referral")}>
          <TabIcon name="referral" /><span>{t("الدعوات")}</span>
        </button>
        <button type="button" className="home-action" onClick={() => go("wallet")}>
          <TabIcon name="swap" /><span>{t("المعاملات")}</span>
        </button>
        <button type="button" className="home-action" onClick={() => go("support")}>
          <TabIcon name="person" /><span>{t("الدعم")}</span>
        </button>
      </div>
      <div className="card dash-activity">
        <p className="metric-label">{t("آخر النشاط")}</p>
        {activity.length === 0 && (
          <EmptyState title={t("لا توجد عمليات بعد")} text={t("ستظهر هنا حركات محفظتك عند حدوثها.")} />
        )}
        {activity.map((tx) => (
          <div className="activity-row" key={tx.id}>
            <div className="activity-main">
              <strong>{transactionTypeLabel(tx.type, t)}</strong>
              <small className="muted">{formatDate(lang, tx.createdAt)}</small>
            </div>
            <b className={tx.amount >= 0 ? "ok" : "bad"}>{money(tx.amount)}</b>
            <StatusBadge status={tx.status} />
          </div>
        ))}
      </div>
    </div>
  );
}

function Tasks({ api, user, onDone, setError, setNotice }) {
  const { t } = useLang();
  const [data, setData] = useState(null);
  const [filter, setFilter] = useState("open");
  const [watch, setWatch] = useState(null);
  const [remaining, setRemaining] = useState(0);
  const [claiming, setClaiming] = useState(false);

  async function load() {
    setError("");
    try {
      const ads = await api("/api/ads");
      if (ads.userId && user?.id && Number(ads.userId) !== Number(user.id)) {
        throw new Error(t("تعذر مطابقة الإعلانات مع الحساب المسجل."));
      }
      setData(ads);
    } catch (err) { setError(err.message); }
  }

  useEffect(() => { load(); }, [user?.id]);

  useEffect(() => {
    if (!watch?.endsAt) return undefined;
    function tick() {
      const left = Math.max(0, Math.ceil((Date.parse(watch.endsAt) - Date.now()) / 1000));
      setRemaining(left);
    }
    tick();
    const id = setInterval(tick, 250);
    return () => clearInterval(id);
  }, [watch?.sessionId, watch?.endsAt]);

  async function startWatch(slot) {
    setError("");
    setNotice("");
    try {
      const session = await api(`/api/ads/${slot}/watch`, { method: "POST" });
      setWatch(session);
      setRemaining(Number(session.remainingSec || session.durationSec || 0));
    } catch (err) {
      setError(err.message);
    }
  }

  async function claimReward() {
    if (!watch?.sessionId || remaining > 0 || claiming) return;
    setError("");
    setNotice("");
    setClaiming(true);
    try {
      const result = await api(`/api/ads/${watch.slot}/complete`, {
        method: "POST",
        body: JSON.stringify({ sessionId: watch.sessionId })
      });
      setNotice(t("تم إضافة {amount}", { amount: money(result.reward) }));
      setWatch(null);
      await load();
      onDone();
    } catch (err) {
      setError(err.message);
    } finally {
      setClaiming(false);
    }
  }

  if (!data) return <LoadingBlock />;

  const required = Number(data.adsRequired || 0);
  const completed = Number(data.adsCompleted || 0);
  const remainingAds = Math.max(0, required - completed);
  const pct = required > 0 ? Math.min(100, Math.round((completed / required) * 100)) : 0;
  const ads = data.ads || [];
  const visible = ads.filter((ad) => {
    if (filter === "open") return !ad.completed;
    if (filter === "done") return ad.completed;
    return true;
  });
  const watchReady = Boolean(watch && remaining <= 0);

  return (
    <div className="ads">
      <div className="home-hello">
        <div>
          <p className="muted">{t("الإعلانات")}</p>
          <h1>{t("المهام اليومية")}</h1>
        </div>
      </div>
      <div className="card">
        <p className="metric-label">{data.vipName}</p>
        <div className="dash-ads-count">
          <div className="stat">{completed}<small> / {required}</small></div>
          <span className="muted">{t("{n} متبقي", { n: remainingAds })}</span>
        </div>
        <div className="progress"><span style={{ width: `${pct}%` }} /></div>
      </div>
      <div className="ads-tabs">
        <button type="button" className={filter === "open" ? "primary" : "ghost"} onClick={() => setFilter("open")}>{t("متاح")}</button>
        <button type="button" className={filter === "done" ? "primary" : "ghost"} onClick={() => setFilter("done")}>{t("مكتمل")}</button>
        <button type="button" className={filter === "all" ? "primary" : "ghost"} onClick={() => setFilter("all")}>{t("الكل")}</button>
      </div>
      {watch && (
        <div className="ad-watch card">
          <p className="muted">{t("مدة الإعلان: {n} ثانية", { n: watch.durationSec })}</p>
          {watch.imageUrl ? (
            <img className="ad-watch-shot" src={adImageSrc(watch.imageUrl)} alt={watch.imageName || t("الإعلانات")} />
          ) : (
            <div className="ad-watch-empty">{t("جاري عرض الإعلان")}</div>
          )}
          {watchReady ? (
            <p className="ad-watch-done">{t("تمت المشاهدة")}</p>
          ) : (
            <div className="ad-watch-count">{remaining}</div>
          )}
          {watchReady ? (
            <button type="button" className="primary" disabled={claiming} onClick={claimReward}>{t("استلام المكافأة")}</button>
          ) : (
            <button type="button" className="ghost" disabled>{t("استلام المكافأة")}</button>
          )}
          <button type="button" className="ghost" onClick={() => setWatch(null)}>{t("إغلاق")}</button>
        </div>
      )}
      {!data.hasVip && (
        <div className="card">
          <EmptyState title={t("الإعلانات مقفلة")} text={t("فعّل باقة VIP لفتح الإعلانات اليومية.")} />
        </div>
      )}
      {data.hasVip && ads.length === 0 && (
        <div className="card"><EmptyState title={t("لا توجد إعلانات اليوم")} /></div>
      )}
      {data.hasVip && ads.length > 0 && visible.length === 0 && (
        <div className="card"><EmptyState title={t("لا توجد إعلانات في هذا التبويب")} /></div>
      )}
      {visible.map((ad) => (
        <div className={`ad-row ${ad.completed ? "is-done" : ""}`} key={ad.slot}>
          <div className="ad-mid">
            <strong>{ad.title}</strong>
            {ad.completed ? <StatusBadge status="completed" /> : <span className="badge badge-pending">{t("متاح · Pending")}</span>}
          </div>
          {ad.completed ? (
            <b className="ok">+ {money(ad.reward)}</b>
          ) : (
            <button type="button" className="primary ad-watch-btn" onClick={() => startWatch(ad.slot)}>{t("مشاهدة الإعلان")}</button>
          )}
        </div>
      ))}
    </div>
  );
}

function Wallet({ api, user, onDone, setError, setNotice }) {
  const { t, lang } = useLang();
  const [data, setData] = useState(null);
  const [panel, setPanel] = useState("deposit");
  const [withdraw, setWithdraw] = useState({ amount: "", usdtAddress: "", network: "TRC20" });
  const [deposit, setDeposit] = useState({ amount: "" });
  const [depositShot, setDepositShot] = useState(null);
  const [lastDeposit, setLastDeposit] = useState(null);

  async function load() {
    try { setData(await api("/api/wallet")); } catch (err) { setError(err.message); }
  }
  useEffect(() => {
    setData(null);
    load();
  }, [user?.id]);

  async function send(path, body, message) {
    setError("");
    setNotice("");
    try {
      await api(path, { method: "POST", body: JSON.stringify(body) });
      setNotice(message);
      await load();
      onDone();
    } catch (err) {
      setError(err.message);
    }
  }

  async function copyAddress() {
    try {
      await navigator.clipboard.writeText(data.companyAddress);
      setNotice(t("تم نسخ العنوان"));
    } catch {
      setError(t("تعذر النسخ"));
    }
  }

  if (!data) return <LoadingBlock />;
  if (data.userId && user?.id && Number(data.userId) !== Number(user.id)) {
    return <p className="alert">{t("تعذر مطابقة المحفظة مع الحساب المسجل.")}</p>;
  }

  const walletBalance = Number(data?.balance ?? user.balance);
  const walletAvailable = Number(data.available);
  const availableEqualsBalance = Number(walletAvailable.toFixed(2)) === Number(walletBalance.toFixed(2));

  return (
    <div className="wallet">
      <div className="home-hello">
        <div>
          <p className="muted">{t("المحفظة")}</p>
          <h1>USDT</h1>
        </div>
      </div>
      <div className="card home-balance">
        <div className="home-balance-top">
          <div>
            <p className="metric-label">{t("الرصيد الحالي")}</p>
            <div className="stat">{money(walletBalance)}</div>
            {!availableEqualsBalance && (
              <p className="muted">{t("القابل للاستخدام: {amount}", { amount: money(walletAvailable) })}</p>
            )}
          </div>
          <span className="home-balance-icon"><TabIcon name="wallet" /></span>
        </div>
        <div className="home-balance-foot">
          <div>
            <p className="metric-label">{t("إجمالي الأرباح")}</p>
            <strong>{money(data.totalEarnings)}</strong>
          </div>
          <div>
            <p className="metric-label">{t("إجمالي السحب")}</p>
            <strong>{money(data.totalWithdrawals)}</strong>
          </div>
        </div>
      </div>
      <div className="wallet-actions">
        <button type="button" className={panel === "deposit" ? "primary" : "ghost"} onClick={() => setPanel("deposit")}>{t("إيداع")}</button>
        <button type="button" className={panel === "withdraw" ? "primary" : "ghost"} onClick={() => setPanel("withdraw")}>{t("سحب")}</button>
      </div>
      {panel === "deposit" && (
        <div className="card">
          <h2>{t("إيداع USDT")}</h2>
          <p className="muted">{t("أدخل المبلغ فقط. سيُنشأ رقم طلب إيداع تلقائيًا، ويُضاف الرصيد بعد اعتماد الأدمن.")}</p>
          <label>{t("المبلغ (USDT)")}</label>
          <input value={deposit.amount} onChange={(e) => setDeposit({ amount: e.target.value })} />
          <label>{t("رفع لقطة شاشة للتحويل")}</label>
          <input type="file" accept="image/*" onChange={(e) => setDepositShot(e.target.files?.[0] || null)} />
          <div className="row">
            <button
              type="button"
              className="primary"
              onClick={async () => {
                setError("");
                setNotice("");
                try {
                  const payload = { amount: deposit.amount };
                  if (depositShot) payload.file = await fileToPayload(depositShot);
                  const result = await api("/api/wallet/deposit", {
                    method: "POST",
                    body: JSON.stringify(payload)
                  });
                  setLastDeposit(result.request || null);
                  setDeposit({ amount: "" });
                  setDepositShot(null);
                  setNotice(t("تم إنشاء طلب الإيداع. حوّل المبلغ إلى عنوان الشركة ثم انتظر اعتماد الأدمن."));
                  await load();
                  onDone();
                } catch (err) {
                  setError(err.message);
                }
              }}
            >{t("إرسال طلب إيداع")}</button>
          </div>
          {(lastDeposit || data.companyAddress) && (
            <div className="deposit-instruct">
              {lastDeposit ? (
                <>
                  <p className="metric-label">{t("رقم طلب الإيداع")}</p>
                  <p className="address-box gold">{depositRef(lastDeposit.id)}</p>
                  <p className="muted">{t("رقم الملف")}: {fileNumber(user.id)}</p>
                  <StatusBadge status={lastDeposit.status || "pending"} />
                  <div className="wallet-details">
                    <div><span className="muted">{t("المبلغ المطلوب")}</span><b>{money(lastDeposit.amount)}</b></div>
                    <div><span className="muted">{t("العملة")}</span><b>USDT</b></div>
                    <div><span className="muted">{t("الشبكة")}</span><b>{(lastDeposit.network || data.network || "TRC20")} / TRON</b></div>
                  </div>
                </>
              ) : (
                <div className="wallet-details">
                  <div><span className="muted">{t("العملة")}</span><b>USDT</b></div>
                  <div><span className="muted">{t("الشبكة")}</span><b>{(data.network || "TRC20")} / TRON</b></div>
                </div>
              )}
              <p className="muted">{t("عنوان محفظة الشركة")}</p>
              <div className="address-box gold">{lastDeposit?.companyAddress || data.companyAddress}</div>
              <div className="row"><button type="button" className="ghost" onClick={copyAddress}>{t("نسخ العنوان")}</button></div>
              {(lastDeposit?.companyAddress || data.companyAddress) ? (
                <img
                  className="deposit-qr"
                  alt="QR"
                  src={`https://api.qrserver.com/v1/create-qr-code/?size=120x120&data=${encodeURIComponent(lastDeposit?.companyAddress || data.companyAddress)}`}
                />
              ) : null}
            </div>
          )}
        </div>
      )}
      {panel === "withdraw" && (
        <div className="card">
          <h2>{t("سحب USDT")}</h2>
          <p className="muted">{t("أدخل عنوان محفظتك والمبلغ المطلوب. سيتم مراجعة الطلب ثم تحويل المبلغ.")}</p>
          {Number(data.locked) > 0 && <p className="muted">{t("محجوز للسحب: {amount}", { amount: money(data.locked) })}</p>}
          <label>{t("المبلغ (USDT)")}</label>
          <input value={withdraw.amount} onChange={(e) => setWithdraw({ ...withdraw, amount: e.target.value })} />
          <label>{t("عنوان محفظتك USDT")}</label>
          <input value={withdraw.usdtAddress} onChange={(e) => setWithdraw({ ...withdraw, usdtAddress: e.target.value })} />
          <div className="row"><button type="button" className="primary" onClick={() => send("/api/wallet/withdraw", withdraw, t("تم إرسال طلبك وسيتم مراجعته."))}>{t("طلب سحب")}</button></div>
        </div>
      )}
      <div className="card">
        <p className="metric-label">{t("تفاصيل المحفظة")}</p>
        <div className="wallet-details">
          <div><span className="muted">{t("الشبكة")}</span><b>{data.network}</b></div>
          <div><span className="muted">{t("محجوز")}</span><b>{money(data.locked)}</b></div>
        </div>
      </div>
      <div className="card">
        <p className="metric-label">{t("سجل الإيداع")}</p>
        {(data.deposits || []).length === 0 && <EmptyState title={t("لا يوجد إيداع بعد")} />}
        {(data.deposits || []).map((item) => (
          <div className="activity-row" key={item.id}>
            <div className="activity-main">
              <strong>{money(item.amount)}</strong>
              <small className="muted">{depositRef(item.id)} · {item.network || "TRC20"} · {formatDate(lang, item.createdAt)}</small>
            </div>
            <StatusBadge status={item.status} />
          </div>
        ))}
      </div>
      <div className="card">
        <p className="metric-label">{t("سجل السحب")}</p>
        {(data.withdrawals || []).length === 0 && <EmptyState title={t("لا يوجد سحب بعد")} />}
        {(data.withdrawals || []).map((item) => (
          <div className="activity-row" key={item.id}>
            <div className="activity-main">
              <strong>{money(item.amount)}</strong>
              <small className="muted">{withdrawRef(item.id)} · {item.usdtAddress || item.details} · {formatDate(lang, item.createdAt)}</small>
            </div>
            <StatusBadge status={item.status} />
          </div>
        ))}
      </div>
      <div className="card">
        <p className="metric-label">{t("كل العمليات")}</p>
        {data.transactions.length === 0 && <EmptyState title={t("لا توجد عمليات بعد")} />}
        {(data.transactions || []).map((tx) => (
          <div className="activity-row" key={tx.id}>
            <div className="activity-main">
              <strong>{transactionTypeLabel(tx.type, t)}</strong>
              <small className="muted">{tx.note} · {formatDate(lang, tx.createdAt)}</small>
            </div>
            <b className={tx.amount >= 0 ? "ok" : "bad"}>{tx.amount >= 0 ? "+" : ""}{money(tx.amount)}</b>
            <StatusBadge status={tx.status} />
          </div>
        ))}
      </div>
    </div>
  );
}

function referralTypeLabel(type, t = (value) => value) {
  return {
    signup: t("مكافأة تسجيل"),
    signup_welcome: t("هدية المدعو"),
    task_commission: t("عمولة مهمة"),
    vip_commission: t("عمولة VIP")
  }[type] || type;
}

function Referral({ api, user, setError, setNotice }) {
  const { t, lang } = useLang();
  const empty = {
    userId: user.id,
    code: user.referralCode || "",
    invitedCount: 0,
    earned: 0,
    invited: [],
    history: [],
    network: [],
    referredBy: null,
    rewards: { signupInviter: 15 }
  };
  const [data, setData] = useState(empty);

  async function load() {
    setError("");
    setData(empty);
    try {
      const refs = await api("/api/referrals");
      if (Number(refs.userId) !== Number(user.id)) {
        throw new Error(t("تعذر مطابقة الدعوات مع الحساب المسجل."));
      }
      setData(refs);
    } catch (err) { setError(err.message); }
  }

  useEffect(() => { load(); }, [user?.id]);

  async function copyCode() {
    try {
      await navigator.clipboard.writeText(data.code);
      setNotice(t("تم نسخ كود الدعوة"));
    } catch {
      setError(t("تعذر النسخ"));
    }
  }

  async function copyLink() {
    try {
      const native = typeof window.Capacitor?.isNativePlatform === "function" && window.Capacitor.isNativePlatform();
      const origin = native ? "https://advault-tt-landing.onrender.com" : window.location.origin;
      await navigator.clipboard.writeText(`${origin}/?ref=${data.code}`);
      setNotice(t("تم نسخ رابط الدعوة"));
    } catch {
      setError(t("تعذر النسخ"));
    }
  }

  if (!data) return <LoadingBlock />;
  const owned = Number(data.userId) === Number(user.id);
  const invited = owned ? (data.invited || []) : [];
  const history = owned ? (data.history || []) : [];
  const network = owned ? (data.network || []) : [];

  return (
    <div className="referral">
      <div className="home-hello">
        <div>
          <p className="muted">{t("الدعوات")}</p>
          <h1>{t("نظام الدعوات")}</h1>
        </div>
      </div>
      <div className="card home-balance">
        <div className="home-balance-top">
          <div>
            <p className="metric-label">{t("كود الدعوة")}</p>
            <div className="stat referral-code">{data.code}</div>
            {data.referredBy && (
              <p className="muted">{t("داعيك: {name} · {code}", { name: data.inviterName, code: data.referredBy })}</p>
            )}
          </div>
          <span className="home-balance-icon"><TabIcon name="referral" /></span>
        </div>
        <div className="home-balance-foot">
          <div>
            <p className="metric-label">{t("عدد المدعوين")}</p>
            <strong>{Number(data.userId) === Number(user.id) ? data.invitedCount : 0}</strong>
          </div>
          <div>
            <p className="metric-label">{t("أرباح الدعوات")}</p>
            <strong>{money(Number(data.userId) === Number(user.id) ? data.earned : 0)}</strong>
          </div>
        </div>
      </div>
      <div className="wallet-actions">
        <button type="button" onClick={copyCode}>{t("نسخ الكود")}</button>
        <button type="button" className="ghost" onClick={copyLink}>{t("نسخ رابط الدعوة")}</button>
      </div>
      <div className="card">
        <p className="metric-label">{t("مكافأة كل دعوة جديدة")}</p>
        <div className="stat gold">{money(data.rewards?.signupInviter ?? 15)}</div>
        <p className="muted">{t("هذه قيمة المكافأة وليست رصيدك")}</p>
      </div>
      <div className="card">
        <p className="metric-label">{t("شبكة المستويات")}</p>
        {(network || []).map((layer) => (
          <div className="referral-layer" key={layer.level}>
            <p className="referral-layer-title"><b>{layer.name}</b> · {t("{count} مستخدم", { count: layer.count })}</p>
            {layer.members.length === 0 && <p className="muted">{t("لا يوجد أعضاء في هذا المستوى بعد")}</p>}
            {layer.members.map((item) => (
              <div className="activity-row" key={item.id}>
                <div className="activity-main">
                  <strong>{item.name}</strong>
                  <small className="muted">{item.email} · {displayVipName(lang, item.vipName)} · {formatDate(lang, item.createdAt)}</small>
                </div>
                <span className="badge">{t("مستوى {n}", { n: item.level })}</span>
              </div>
            ))}
          </div>
        ))}
      </div>
      <div className="card">
        <p className="metric-label">{t("المدعوون المباشرون")}</p>
        {invited.length === 0 && <EmptyState title={t("لا يوجد مدعوون بعد")} />}
        {invited.map((item) => (
          <div className="activity-row" key={item.id}>
            <div className="activity-main">
              <strong>{item.name}</strong>
              <small className="muted">{item.email} · {displayVipName(lang, item.vipName)} · {formatDate(lang, item.createdAt)}</small>
            </div>
            <StatusBadge status={item.vipStatus} />
          </div>
        ))}
      </div>
      <div className="card">
        <p className="metric-label">{t("سجل الدعوات")}</p>
        {history.length === 0 && <EmptyState title={t("لا يوجد سجل بعد")} />}
        {history.map((item) => (
          <div className="activity-row" key={item.id}>
            <div className="activity-main">
              <strong>{referralTypeLabel(item.type, t)} · {item.invitedName} · {t("مستوى {n}", { n: item.level || 1 })}</strong>
              <small className="muted">{item.note} · {formatDate(lang, item.createdAt)}</small>
            </div>
            <b className="ok">{money(item.amount)}</b>
          </div>
        ))}
      </div>
    </div>
  );
}

function Vip({ api, user, onDone, setError, setNotice }) {
  const { t, lang } = useLang();
  const [data, setData] = useState(null);

  async function load() {
    try {
      const vip = await api("/api/vip");
      if (Number(vip.userId || vip.current?.id) !== Number(user.id)) {
        throw new Error(t("تعذر مطابقة VIP مع الحساب المسجل."));
      }
      setData(vip);
    } catch (err) { setError(err.message); }
  }
  useEffect(() => {
    setData(null);
    load();
  }, [user?.id]);

  async function requestVip(level) {
    setError("");
    setNotice("");
    try {
      await api(`/api/vip/${level}/request`, { method: "POST" });
      setNotice(t("تم إرسال طلبك وسيتم مراجعته."));
      await load();
      onDone();
    } catch (err) {
      setError(err.message);
    }
  }

  async function cancelVip() {
    setError("");
    setNotice("");
    try {
      await api("/api/vip/cancel", { method: "POST" });
      setNotice(t("تم إرسال طلبك وسيتم مراجعته."));
      await load();
      onDone();
    } catch (err) {
      setError(err.message);
    }
  }

  if (!data) return <LoadingBlock />;
  const current = data.current || user || {};
  const sub = data.subscription || {};
  const busy = Boolean(data.pending || data.pendingCancel);
  const activeVipLevel = Number(sub.level ?? data.activeVipLevel ?? 0);
  const currentName = activeVipLevel > 0 ? (sub.name || current.vipName) : t("بدون VIP");

  return (
    <div className="vip">
      <div className="home-hello">
        <div>
          <p className="muted">VIP</p>
          <h1>{t("باقات الاشتراك")}</h1>
        </div>
      </div>
      <div className="card vip-hero">
        <div className="home-balance-top">
          <div>
            <p className="metric-label">{t("المستوى الحالي")}</p>
            <div className="stat">{currentName}</div>
            <p className="muted">{activeVipLevel > 0 ? t("مشترك") : t("غير مشترك")}</p>
          </div>
          <span className="home-balance-icon"><TabIcon name="vip" /></span>
        </div>
        <div className="home-balance-foot">
          <div>
            <p className="metric-label">{t("الإعلانات اليومية")}</p>
            <strong>{sub.adsPerDay ?? 0}</strong>
          </div>
          <div>
            <p className="metric-label">{t("قيمة الاشتراك")}</p>
            <strong>{activeVipLevel > 0 ? money(sub.price) : "—"}</strong>
          </div>
        </div>
        {activeVipLevel > 0 && (
          <p className="muted vip-hero-date">{t("تفعيل: {date}", { date: sub.activatedAt ? formatDate(lang, sub.activatedAt) : "—" })}</p>
        )}
        {data.pending && <p className="vip-hero-status"><StatusBadge status="pending" /> {t("طلب تفعيل قيد المراجعة")}</p>}
        {data.pendingCancel && <p className="vip-hero-status"><StatusBadge status="pending" /> {t("طلب إلغاء قيد المراجعة")}</p>}
        {activeVipLevel > 0 && !busy && (
          <div className="row">
            <button type="button" className="bad" onClick={cancelVip}>{t("طلب إلغاء VIP")}</button>
          </div>
        )}
      </div>
      <div className="vip-packages">
        {data.packages.map((pkg) => {
          const state = vipCardState(pkg, activeVipLevel);
          const locked = !state.canClick || busy;
          return (
          <div className={`card vip-card ${state.isCurrent ? "current" : ""} ${locked && !state.isCurrent ? "locked" : ""}`} key={pkg.level}>
            <div className="vip-card-top">
              <div>
                {state.isCurrent && <span className="badge badge-active vip-tag">{t("المستوى الحالي · Active")}</span>}
                {busy && !state.isCurrent && <span className="badge badge-pending vip-tag">{t("قيد المراجعة · Pending")}</span>}
                <h3>{pkg.name}</h3>
              </div>
              <div className="stat gold">{money(pkg.price)}</div>
            </div>
            <div className="vip-card-meta">
              <span>{t("إعلانات يومية")} <b>{pkg.adsPerDay}</b></span>
              <span>{t("هدية التفعيل")} <b>{money(pkg.gift)}</b></span>
            </div>
            <button type="button" className={state.isCurrent ? "ghost" : "primary"} disabled={locked} onClick={() => requestVip(pkg.level)}>
              {busy && !state.isCurrent ? t("بانتظار الموافقة") : t(state.label)}
            </button>
          </div>
          );
        })}
      </div>
      <div className="card">
        <p className="metric-label">{t("سجل الطلبات")}</p>
        {(data.requests || []).length === 0 && (data.cancelRequests || []).length === 0 && (
          <EmptyState title={t("لا توجد طلبات VIP بعد")} />
        )}
        {(data.requests || []).map((item) => (
          <div className="activity-row" key={`vip-${item.id}`}>
            <div className="activity-main">
              <strong>{item.vipName} · {money(item.price)}</strong>
              <small className="muted">{item.activationDate ? t("تفعيل: {date}", { date: formatDate(lang, item.activationDate) }) : t("تم إرسال طلبك وسيتم مراجعته.")}</small>
            </div>
            <StatusBadge status={item.status} />
          </div>
        ))}
        {(data.cancelRequests || []).map((item) => (
          <div className="activity-row" key={`cancel-${item.id}`}>
            <div className="activity-main">
              <strong>{t("إلغاء {name}", { name: item.vipName })}</strong>
              <small className="muted">{formatDate(lang, item.createdAt)}</small>
            </div>
            <StatusBadge status={item.status} />
          </div>
        ))}
      </div>
    </div>
  );
}

function AccountItemIcon({ name }) {
  const props = {
    width: 20,
    height: 20,
    viewBox: "0 0 24 24",
    fill: "none",
    stroke: "currentColor",
    strokeWidth: "1.8",
    strokeLinecap: "round",
    strokeLinejoin: "round",
    "aria-hidden": "true"
  };
  if (name === "profile") return <svg {...props}><circle cx="12" cy="8" r="3.2" /><path d="M5 19c.6-3.2 3.2-5 7-5s6.4 1.8 7 5" /></svg>;
  if (name === "password") return <svg {...props}><rect x="5" y="11" width="14" height="10" rx="2" /><path d="M8 11V8a4 4 0 0 1 8 0v3" /></svg>;
  if (name === "language") return <svg {...props}><circle cx="12" cy="12" r="9" /><path d="M3 12h18M12 3c3 3.5 3 14.5 0 18M12 3c-3 3.5-3 14.5 0 18" /></svg>;
  if (name === "bell") return <svg {...props}><path d="M6 16V10a6 6 0 1 1 12 0v6l1.5 2H4.5L6 16z" /><path d="M10 20a2 2 0 0 0 4 0" /></svg>;
  if (name === "support") return <svg {...props}><path d="M5 16.5V8a4 4 0 0 1 4-4h6a4 4 0 0 1 4 4v5a4 4 0 0 1-4 4H9z" /><path d="M8 19h2" /></svg>;
  return <svg {...props}><path d="M10 6H6a2 2 0 0 0-2 2v8a2 2 0 0 0 2 2h4" /><path d="M15 8l5 4-5 4" /><path d="M9 12h11" /></svg>;
}

function Account({ api, user, logout, setError, setNotice }) {
  const { t, lang, setLang } = useLang();
  const [me, setMe] = useState(user);
  const [panel, setPanel] = useState("menu");
  const [notifyOn, setNotifyOn] = useState(true);
  const [passwordForm, setPasswordForm] = useState({ current: "", next: "", confirm: "" });

  useEffect(() => {
    let cancelled = false;
    setMe(user);
    (async () => {
      try {
        const data = await api("/api/me");
        if (cancelled || Number(data.id) !== Number(user.id)) return;
        setMe(data);
      } catch (err) {
        setError(err.message);
      }
    })();
    return () => { cancelled = true; };
  }, [user.id]);

  const view = Number(me?.id) === Number(user.id) ? me : user;
  const initial = String(view.name || "U").trim().charAt(0);
  const registeredAt = view.createdAt ? formatDate(lang, view.createdAt) : "—";

  function back() {
    setPanel("menu");
  }

  async function changePassword(e) {
    e.preventDefault();
    setError("");
    setNotice("");
    if (passwordForm.next !== passwordForm.confirm) {
      setError(t("كلمة المرور الجديدة وتأكيدها غير متطابقين"));
      return;
    }
    try {
      await api("/api/auth/change-password", {
        method: "POST",
        body: JSON.stringify({
          currentPassword: passwordForm.current,
          newPassword: passwordForm.next,
          confirmPassword: passwordForm.confirm
        })
      });
      setPasswordForm({ current: "", next: "", confirm: "" });
      setNotice(t("تم تغيير كلمة المرور بنجاح"));
    } catch (err) {
      setError(err.message);
    }
  }

  if (panel === "support") {
    return (
      <div className="account">
        <button type="button" className="ghost account-back" onClick={back}>{t("رجوع")}</button>
        <Support api={api} setError={setError} setNotice={setNotice} />
      </div>
    );
  }

  if (panel !== "menu") {
    return (
      <div className="account">
        <button type="button" className="ghost account-back" onClick={back}>{t("رجوع")}</button>
        {panel === "profile" && (
          <div className="card account-profile">
            <div className="account-avatar" aria-hidden="true">{initial}</div>
            <h2>{view.name}</h2>
            <p className="muted">{t("تاريخ التسجيل: {date}", { date: registeredAt })}</p>
            <div className="account-rows">
              <div className="activity-row"><div className="activity-main"><span className="muted">{t("رقم الملف")}</span><strong>{fileNumber(view.id)}</strong></div></div>
              <div className="activity-row"><div className="activity-main"><span className="muted">{t("البريد")}</span><strong>{view.email}</strong></div></div>
              <div className="activity-row"><div className="activity-main"><span className="muted">{t("كود الدعوة")}</span><strong>{view.referralCode || "—"}</strong></div></div>
              <div className="activity-row"><div className="activity-main"><span className="muted">{t("حالة VIP")}</span><strong>{displayVipName(lang, view.vipName)}</strong></div><StatusBadge status={view.vipStatus} /></div>
            </div>
          </div>
        )}
        {panel === "password" && (
          <form className="card" onSubmit={changePassword}>
            <p className="metric-label">{t("تغيير كلمة المرور")}</p>
            <label>{t("كلمة المرور الحالية")}</label>
            <input type="password" autoComplete="current-password" value={passwordForm.current} onChange={(e) => setPasswordForm({ ...passwordForm, current: e.target.value })} required />
            <label>{t("كلمة المرور الجديدة")}</label>
            <input type="password" autoComplete="new-password" minLength={6} value={passwordForm.next} onChange={(e) => setPasswordForm({ ...passwordForm, next: e.target.value })} required />
            <label>{t("تأكيد كلمة المرور الجديدة")}</label>
            <input type="password" autoComplete="new-password" minLength={6} value={passwordForm.confirm} onChange={(e) => setPasswordForm({ ...passwordForm, confirm: e.target.value })} required />
            <div className="row">
              <button type="submit" className="primary">{t("تأكيد تغيير كلمة المرور")}</button>
            </div>
          </form>
        )}
        {panel === "language" && (
          <div className="account-menu">
            <p className="metric-label">{t("تغيير اللغة")}</p>
            <button type="button" className={`account-item ${lang === "ar" ? "is-current" : ""}`} onClick={() => setLang("ar")}>
              <span className="account-item-icon"><AccountItemIcon name="language" /></span>
              <span>العربية</span>
              {lang === "ar" ? <small className="ok">{t("الحالية")}</small> : <span className="account-chevron" aria-hidden="true" />}
            </button>
            <button type="button" className={`account-item ${lang === "en" ? "is-current" : ""}`} onClick={() => setLang("en")}>
              <span className="account-item-icon"><AccountItemIcon name="language" /></span>
              <span dir="ltr">English</span>
              {lang === "en" ? <small className="ok">{t("الحالية")}</small> : <span className="account-chevron" aria-hidden="true" />}
            </button>
          </div>
        )}
        {panel === "notifications" && (
          <div className="card">
            <p className="metric-label">{t("الإشعارات")}</p>
            <button type="button" className="account-item" onClick={() => setNotifyOn(!notifyOn)}>
              <span className="account-item-icon"><AccountItemIcon name="bell" /></span>
              <span>{t("تنبيهات الشاشة")}</span>
              <span className={`account-switch ${notifyOn ? "on" : ""}`} aria-hidden="true" />
            </button>
            <p className="muted">{t("واجهة فقط — التنبيهات الفعلية تبقى أعلى الشاشة من النظام الحالي.")}</p>
          </div>
        )}
      </div>
    );
  }

  return (
    <div className="account">
      <div className="home-hello">
        <div>
          <p className="muted">{t("الحساب")}</p>
          <h1>{t("حسابي")}</h1>
        </div>
      </div>
      <div className="account-hero">
        <div className="account-avatar" aria-hidden="true">{initial}</div>
        <strong>{view.name}</strong>
        <small className="muted">{registeredAt}</small>
      </div>
      <div className="account-menu">
        <button type="button" className="account-item" onClick={() => setPanel("profile")}>
          <span className="account-item-icon"><AccountItemIcon name="profile" /></span>
          <span>{t("الملف الشخصي")}</span>
          <span className="account-chevron" aria-hidden="true" />
        </button>
        <button type="button" className="account-item" onClick={() => setPanel("password")}>
          <span className="account-item-icon"><AccountItemIcon name="password" /></span>
          <span>{t("تغيير كلمة المرور")}</span>
          <span className="account-chevron" aria-hidden="true" />
        </button>
        <button type="button" className="account-item" onClick={() => setPanel("language")}>
          <span className="account-item-icon"><AccountItemIcon name="language" /></span>
          <span>{t("تغيير اللغة")}</span>
          <span className="account-chevron" aria-hidden="true" />
        </button>
        <button type="button" className="account-item" onClick={() => setPanel("notifications")}>
          <span className="account-item-icon"><AccountItemIcon name="bell" /></span>
          <span>{t("الإشعارات")}</span>
          <span className="account-chevron" aria-hidden="true" />
        </button>
        <button type="button" className="account-item" onClick={() => setPanel("support")}>
          <span className="account-item-icon"><AccountItemIcon name="support" /></span>
          <span>{t("الدعم والمساعدة")}</span>
          <span className="account-chevron" aria-hidden="true" />
        </button>
        <button type="button" className="account-item logout" onClick={logout}>
          <span className="account-item-icon"><AccountItemIcon name="logout" /></span>
          <span>{t("تسجيل الخروج")}</span>
        </button>
      </div>
    </div>
  );
}

function AdminAccount({ api, user, logout, setError, setNotice }) {
  const { setLang } = useLang();
  const [me, setMe] = useState(user);
  const [panel, setPanel] = useState("menu");
  const [adminInitialTab, setAdminInitialTab] = useState("vip");
  const [notifyOn, setNotifyOn] = useState(true);
  const [passwordForm, setPasswordForm] = useState({ current: "", next: "", confirm: "" });
  const [recoveryStatus, setRecoveryStatus] = useState({ configured: false, createdAt: null });
  const [recoveryPassword, setRecoveryPassword] = useState("");
  const [issuedRecovery, setIssuedRecovery] = useState("");

  useEffect(() => {
    setLang("ar");
  }, []);

  useEffect(() => {
    let cancelled = false;
    setMe(user);
    (async () => {
      try {
        const data = await api("/api/me");
        if (cancelled || Number(data.id) !== Number(user.id)) return;
        setMe(data);
        try {
          const recovery = await api("/api/admin/account/recovery");
          if (!cancelled) {
            setRecoveryStatus({
              configured: Boolean(recovery.configured),
              createdAt: recovery.createdAt || null
            });
          }
        } catch {}
      } catch (err) {
        setError(err.message);
      }
    })();
    return () => { cancelled = true; };
  }, [user.id]);

  const view = Number(me?.id) === Number(user.id) ? me : user;
  const initial = String(view.name || "U").trim().charAt(0);
  const registeredAt = view.createdAt ? formatDate("ar", view.createdAt) : "—";

  function back() {
    setIssuedRecovery("");
    setRecoveryPassword("");
    setPanel("menu");
  }

  async function changePassword(e) {
    e.preventDefault();
    setError("");
    setNotice("");
    if (passwordForm.next !== passwordForm.confirm) {
      setError("كلمة المرور الجديدة وتأكيدها غير متطابقين");
      return;
    }
    try {
      await api("/api/auth/change-password", {
        method: "POST",
        body: JSON.stringify({
          currentPassword: passwordForm.current,
          newPassword: passwordForm.next,
          confirmPassword: passwordForm.confirm
        })
      });
      setPasswordForm({ current: "", next: "", confirm: "" });
      setNotice("تم تغيير كلمة المرور بنجاح");
    } catch (err) {
      setError(err.message);
    }
  }

  if (panel === "support") {
    return (
      <div className="account">
        <button type="button" className="ghost account-back" onClick={back}>رجوع</button>
        <Support api={api} setError={setError} setNotice={setNotice} />
      </div>
    );
  }

  if (panel === "admin") {
    return (
      <div className="account">
        <button type="button" className="ghost account-back" onClick={back}>رجوع</button>
        <Admin api={api} setError={setError} setNotice={setNotice} initialTab={adminInitialTab} />
      </div>
    );
  }

  if (panel !== "menu") {
    return (
      <div className="account">
        <button type="button" className="ghost account-back" onClick={back}>رجوع</button>
        {panel === "profile" && (
          <div className="card account-profile">
            <div className="account-avatar" aria-hidden="true">{initial}</div>
            <h2>{view.name}</h2>
            <p className="muted">تاريخ التسجيل: {registeredAt}</p>
            <div className="account-rows">
              <div className="activity-row"><div className="activity-main"><span className="muted">رقم الملف</span><strong>{fileNumber(view.id)}</strong></div></div>
              <div className="activity-row"><div className="activity-main"><span className="muted">البريد</span><strong>{view.email}</strong></div></div>
              <div className="activity-row"><div className="activity-main"><span className="muted">الدور</span><strong>مشرف</strong></div></div>
              <div className="activity-row"><div className="activity-main"><span className="muted">كود الدعوة</span><strong>{view.referralCode || "—"}</strong></div></div>
            </div>
          </div>
        )}
        {panel === "password" && (
          <form className="card" onSubmit={changePassword}>
            <p className="metric-label">تغيير كلمة المرور</p>
            <label>كلمة المرور الحالية</label>
            <input type="password" autoComplete="current-password" value={passwordForm.current} onChange={(e) => setPasswordForm({ ...passwordForm, current: e.target.value })} required />
            <label>كلمة المرور الجديدة</label>
            <input type="password" autoComplete="new-password" minLength={6} value={passwordForm.next} onChange={(e) => setPasswordForm({ ...passwordForm, next: e.target.value })} required />
            <label>تأكيد كلمة المرور الجديدة</label>
            <input type="password" autoComplete="new-password" minLength={6} value={passwordForm.confirm} onChange={(e) => setPasswordForm({ ...passwordForm, confirm: e.target.value })} required />
            <div className="row">
              <button type="submit" className="primary">تأكيد تغيير كلمة المرور</button>
            </div>
          </form>
        )}
        {panel === "recovery" && (
          <form className="card" onSubmit={async (e) => {
            e.preventDefault();
            setError("");
            setNotice("");
            setIssuedRecovery("");
            try {
              const result = await api("/api/admin/account/recovery-code", {
                method: "POST",
                body: JSON.stringify({ currentPassword: recoveryPassword })
              });
              setRecoveryPassword("");
              setIssuedRecovery(String(result.recoveryCode || ""));
              setRecoveryStatus({ configured: true, createdAt: new Date().toISOString() });
              setNotice(result.message || "احفظ رمز استعادة الأدمن الآن خارج التطبيق. لن يظهر مرة أخرى، ويُستخدم مرة واحدة فقط.");
            } catch (err) {
              setError(err.message);
            }
          }}>
            <p className="metric-label">إدارة / إنشاء Recovery Code</p>
            <p className="muted">هذا الرمز منفصل عن استعادة المستخدمين. إنشاء رمز جديد يتطلب كلمة المرور الحالية ويلغي أي رمز سابق غير مستخدم. يظهر النص مرة واحدة فقط — احفظه خارج التطبيق.</p>
            <p className="muted">{recoveryStatus.configured ? "يوجد Recovery Code نشط. إنشاء رمز جديد يلغي الرمز السابق فورًا." : "لا يوجد Recovery Code نشط. أنشئ واحدًا الآن لاستخدامه إذا نسيت كلمة المرور."}</p>
            <label>كلمة المرور الحالية</label>
            <input type="password" autoComplete="current-password" value={recoveryPassword} onChange={(e) => setRecoveryPassword(e.target.value)} required />
            <div className="row">
              <button type="submit" className="primary">{recoveryStatus.configured ? "إنشاء Recovery Code جديد" : "إنشاء Recovery Code"}</button>
            </div>
            {issuedRecovery && (
              <div className="admin-recovery-box">
                <p className="muted">انسخ الرمز الآن واحفظه في مكان آمن خارج التطبيق. لن يُعرض مرة أخرى، وبعد استخدامه لاستعادة كلمة المرور يصبح غير صالح فورًا.</p>
                <textarea readOnly value={issuedRecovery} rows={3} className="admin-recovery-code" />
                <div className="admin-req-actions">
                  <button type="button" className="ok" onClick={async () => {
                    try {
                      await navigator.clipboard.writeText(issuedRecovery);
                      setNotice("تم نسخ رمز استعادة الأدمن");
                    } catch {
                      setError("تعذر النسخ");
                    }
                  }}>نسخ الرمز</button>
                </div>
              </div>
            )}
          </form>
        )}
        {panel === "language" && (
          <div className="account-menu">
            <p className="metric-label">تغيير اللغة</p>
            <button type="button" className="account-item is-current">
              <span className="account-item-icon"><AccountItemIcon name="language" /></span>
              <span>العربية</span>
              <small className="ok">الحالية</small>
            </button>
            <p className="muted">حساب الأدمن يعمل بالعربية فقط حاليًا.</p>
          </div>
        )}
        {panel === "notifications" && (
          <div className="card">
            <p className="metric-label">الإشعارات</p>
            <button type="button" className="account-item" onClick={() => setNotifyOn(!notifyOn)}>
              <span className="account-item-icon"><AccountItemIcon name="bell" /></span>
              <span>تنبيهات الشاشة</span>
              <span className={`account-switch ${notifyOn ? "on" : ""}`} aria-hidden="true" />
            </button>
            <p className="muted">واجهة فقط — التنبيهات الفعلية تبقى أعلى الشاشة من النظام الحالي.</p>
          </div>
        )}
      </div>
    );
  }

  return (
    <div className="account admin-account">
      <div className="admin-account-head">
        <div className="brand">ADVAULT <span>TT</span></div>
        <strong>{view.name}</strong>
        <span className="admin-badge">ADMIN</span>
      </div>
      <section className="admin-account-section" aria-label="الحساب">
        <p className="metric-label">الحساب</p>
        <div className="account-menu">
          <button type="button" className="account-item" onClick={() => setPanel("profile")}>
            <span className="account-item-icon"><AccountItemIcon name="profile" /></span>
            <span>الملف الشخصي</span>
            <span className="account-chevron" aria-hidden="true" />
          </button>
          <button type="button" className="account-item" onClick={() => setPanel("password")}>
            <span className="account-item-icon"><AccountItemIcon name="password" /></span>
            <span>تغيير كلمة المرور</span>
            <span className="account-chevron" aria-hidden="true" />
          </button>
          <button type="button" className="account-item" onClick={() => setPanel("recovery")}>
            <span className="account-item-icon"><AccountItemIcon name="password" /></span>
            <span>إدارة / إنشاء Recovery Code</span>
            <small className={recoveryStatus.configured ? "ok" : "muted"}>{recoveryStatus.configured ? "نشط" : "غير مُعد"}</small>
            <span className="account-chevron" aria-hidden="true" />
          </button>
          <button type="button" className="account-item" onClick={() => setPanel("language")}>
            <span className="account-item-icon"><AccountItemIcon name="language" /></span>
            <span>تغيير اللغة</span>
            <span className="account-chevron" aria-hidden="true" />
          </button>
          <button type="button" className="account-item" onClick={() => setPanel("notifications")}>
            <span className="account-item-icon"><AccountItemIcon name="bell" /></span>
            <span>الإشعارات</span>
            <span className="account-chevron" aria-hidden="true" />
          </button>
        </div>
      </section>
      <section className="admin-account-section" aria-label="الدعم والمساعدة">
        <div className="account-menu">
          <button type="button" className="account-item" onClick={() => setPanel("support")}>
            <span className="account-item-icon"><AccountItemIcon name="support" /></span>
            <span>الدعم والمساعدة</span>
            <span className="account-chevron" aria-hidden="true" />
          </button>
        </div>
      </section>
      <section className="admin-account-section" aria-label="تسجيل الخروج">
        <div className="account-menu">
          <button type="button" className="account-item logout" onClick={logout}>
            <span className="account-item-icon"><AccountItemIcon name="logout" /></span>
            <span>تسجيل الخروج</span>
          </button>
        </div>
      </section>
      <section className="admin-account-section" aria-label="الإدارة">
        <p className="metric-label">الإدارة</p>
        <div className="account-menu">
          <button type="button" className="account-item admin-settings" onClick={() => { setAdminInitialTab("vip"); setPanel("admin"); }}>
            <span className="account-item-icon"><TabIcon name="admin" /></span>
            <span>إعدادات الأدمن</span>
            <span className="account-chevron" aria-hidden="true" />
          </button>
          <button type="button" className="account-item" onClick={() => { setAdminInitialTab("passwordResets"); setPanel("admin"); }}>
            <span className="account-item-icon"><AccountItemIcon name="password" /></span>
            <span>طلبات إعادة تعيين كلمة المرور</span>
            <span className="account-chevron" aria-hidden="true" />
          </button>
        </div>
      </section>
    </div>
  );
}

function Support({ api, setError, setNotice }) {
  const { t } = useLang();
  const [data, setData] = useState(null);
  const [text, setText] = useState("");
  const [file, setFile] = useState(null);

  async function load() {
    try { setData(await api("/api/support")); } catch (err) { setError(err.message); }
  }

  useEffect(() => {
    load();
    const timer = setInterval(load, 5000);
    return () => clearInterval(timer);
  }, []);

  async function send(e) {
    e.preventDefault();
    setError("");
    setNotice("");
    try {
      const payload = { text };
      if (file) payload.file = await fileToPayload(file);
      await api("/api/support/messages", { method: "POST", body: JSON.stringify(payload) });
      setText("");
      setFile(null);
      await load();
    } catch (err) {
      setError(err.message);
    }
  }

  if (!data) return <LoadingBlock />;

  return (
    <div className="support">
      <div className="home-hello">
        <div>
          <p className="muted">{t("الدعم")}</p>
          <h1>{t("تواصل مع الدعم")}</h1>
        </div>
        <span className="support-hello-icon"><TabIcon name="support" /></span>
      </div>
      <div className="card support-card">
        <div className="support-meta">
          <StatusBadge status={(data.messages || []).length ? "active" : "pending"} />
          <span className="muted">{t("{n} رسالة", { n: (data.messages || []).length })}</span>
        </div>
        <ChatMessages messages={data.messages || []} />
        <form className="support-form" onSubmit={send}>
          <label>{t("رسالتك")}</label>
          <textarea value={text} onChange={(e) => setText(e.target.value)} rows={3} />
          <label>{t("صورة أو فيديو (اختياري)")}</label>
          <input type="file" accept="image/*,video/*" onChange={(e) => setFile(e.target.files?.[0] || null)} />
          <div className="row"><button className="primary" type="submit">{t("إرسال")}</button></div>
        </form>
      </div>
    </div>
  );
}

function AdminUserPicker({ users, value, onChange }) {
  const [query, setQuery] = useState("");
  const list = Array.isArray(users) ? users : [];
  const selected = list.find((item) => Number(item.id) === Number(value));
  const results = String(query || "").trim()
    ? list.filter((item) => userMatchesQuery(item, query)).slice(0, 12)
    : [];

  return (
    <div className="admin-user-picker">
      <label>بحث عن مستخدم</label>
      <input
        type="search"
        placeholder="الاسم أو البريد أو رقم الملف"
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        autoComplete="off"
        onKeyDown={(e) => { if (e.key === "Enter") e.preventDefault(); }}
      />
      {selected ? (
        <p className="admin-user-selected">
          <strong>{selected.name}</strong>
          <span>رقم الملف: {fileNumber(selected.id)}</span>
          <small>{selected.email}</small>
        </p>
      ) : null}
      {String(query || "").trim() ? (
        <div className="admin-user-results">
          {results.length === 0 && <p className="muted">لا توجد نتائج</p>}
          {results.map((item) => (
            <button
              type="button"
              key={item.id}
              className={`admin-user-hit ${Number(item.id) === Number(value) ? "is-current" : ""}`}
              onClick={() => {
                onChange(String(item.id));
                setQuery("");
              }}
            >
              <strong>{item.name}</strong>
              <span>رقم الملف: {fileNumber(item.id)}</span>
              <small>{item.email}</small>
            </button>
          ))}
        </div>
      ) : null}
    </div>
  );
}

function AdminAdCreatives({ api, setError, setNotice }) {
  const { t } = useLang();
  const [enabled, setEnabled] = useState(true);
  const [library, setLibrary] = useState({});
  const [vipSlots, setVipSlots] = useState([]);
  const [selectedLevel, setSelectedLevel] = useState("");
  const [loaded, setLoaded] = useState(false);
  const [saving, setSaving] = useState(false);

  function mapVipRows(rows) {
    return (rows || []).map((item) => ({
      level: item.level,
      name: item.name,
      adsPerDay: String(item.adsPerDay ?? "")
    }));
  }

  function mapLibrary(images) {
    const next = {};
    (images || []).forEach((item, index) => {
      const slot = Number(item.slot || index + 1);
      if (!slot || !item.url) return;
      next[slot] = {
        url: item.url,
        name: item.name || "",
        preview: adImageSrc(item.url),
        file: null
      };
    });
    return next;
  }

  async function loadSet() {
    setError("");
    try {
      const data = await api("/api/admin/ad-creatives");
      const rows = mapVipRows(data.vipAdSlots);
      setEnabled(data.enabled == null ? (data.images || []).length > 0 : Boolean(data.enabled));
      setVipSlots(rows);
      setSelectedLevel((current) => current || String(rows[0]?.level || ""));
      setLibrary(mapLibrary(data.images));
      setLoaded(true);
    } catch (err) {
      setError(err.message);
    }
  }

  useEffect(() => { loadSet(); }, []);

  async function setSlotImage(slot, file) {
    if (!file || !file.type.startsWith("image/")) return;
    const preview = URL.createObjectURL(file);
    setLibrary((prev) => ({
      ...prev,
      [slot]: { url: "", name: file.name, preview, file }
    }));
  }

  function clearSlotImage(slot) {
    setLibrary((prev) => {
      const next = { ...prev };
      delete next[slot];
      return next;
    });
  }

  async function saveSet() {
    setError("");
    setNotice("");
    setSaving(true);
    try {
      const images = [];
      for (const [slotKey, item] of Object.entries(library)) {
        const slot = Number(slotKey);
        if (!slot || !item) continue;
        if (item.file) images.push({ slot, file: await fileToPayload(item.file), name: item.name });
        else if (item.url) images.push({ slot, url: item.url, name: item.name });
      }
      const adsPerDayByLevel = {};
      vipSlots.forEach((item) => {
        adsPerDayByLevel[String(item.level)] = Number(item.adsPerDay);
      });
      const result = await api("/api/admin/ad-creatives", {
        method: "PUT",
        body: JSON.stringify({ enabled, images, adsPerDayByLevel })
      });
      setEnabled(Boolean(result.enabled));
      setVipSlots(mapVipRows(result.vipAdSlots || vipSlots));
      setLibrary(mapLibrary(result.images));
      setNotice(t("تم حفظ مجموعة الإعلانات"));
    } catch (err) {
      setError(err.message);
    } finally {
      setSaving(false);
    }
  }

  if (!loaded) return <LoadingBlock />;

  const selected = vipSlots.find((item) => String(item.level) === String(selectedLevel)) || vipSlots[0];
  const slotCount = Math.max(0, Math.min(200, Number(selected?.adsPerDay) || 0));
  const visibleSlots = Array.from({ length: slotCount }, (_, i) => i + 1);

  return (
    <div className="card admin-block ad-admin-level">
      <h2>{t("إدارة الإعلانات")}</h2>
      <label>{t("مستوى VIP")}</label>
      <select value={String(selected?.level || "")} onChange={(e) => setSelectedLevel(e.target.value)}>
        {vipSlots.map((item) => (
          <option value={String(item.level)} key={item.level}>{item.name}</option>
        ))}
      </select>
      {selected && (
        <>
          <div className="ad-admin-level-head">
            <h3>{selected.name}</h3>
            <label className="ad-admin-toggle">
              <input type="checkbox" checked={enabled} onChange={(e) => setEnabled(e.target.checked)} />
              {t("تفعيل الإعلانات")}
            </label>
          </div>
          <label>{t("عدد الإعلانات اليومية")}</label>
          <input
            type="number"
            min="0"
            max="200"
            value={selected.adsPerDay}
            onChange={(e) => {
              const value = e.target.value;
              setVipSlots((prev) => prev.map((row) => (
                Number(row.level) === Number(selected.level) ? { ...row, adsPerDay: value } : row
              )));
            }}
          />
          <div className="ad-admin-photos">
            <h3>{t("خانات الصور")}</h3>
            <p className="muted">{t("{count} خانة حسب عدد الإعلانات اليومية لهذا المستوى. الصور مشتركة بين المستويات حسب رقم الخانة.", { count: slotCount })}</p>
            <div className="ad-admin-grid">
              {visibleSlots.map((slot) => {
                const item = library[slot];
                return (
                  <article className="ad-admin-card" key={slot}>
                    <p className="ad-admin-slot-num">{t("خانة {n}", { n: slot })}</p>
                    {item?.preview ? (
                      <img src={item.preview} alt={item.name || t("معاينة")} />
                    ) : (
                      <div className="ad-admin-empty">{t("فارغة")}</div>
                    )}
                    <p>{item?.name || t("بدون صورة")}</p>
                    <div className="admin-req-actions">
                      <label className="ghost ad-admin-replace">
                        {item?.preview ? t("استبدال") : t("إضافة صورة")}
                        <input type="file" accept="image/*" hidden onChange={(e) => { setSlotImage(slot, e.target.files?.[0]); e.target.value = ""; }} />
                      </label>
                      {item?.preview ? (
                        <button type="button" className="bad" onClick={() => clearSlotImage(slot)}>{t("حذف")}</button>
                      ) : null}
                    </div>
                  </article>
                );
              })}
            </div>
          </div>
          <button type="button" className="primary" disabled={saving} onClick={saveSet}>{t("حفظ المجموعة")}</button>
        </>
      )}
    </div>
  );
}

function Admin({ api, setError, setNotice, initialTab = "vip" }) {
  const { t, lang } = useLang();
  const [tab, setTab] = useState(initialTab);
  const [stats, setStats] = useState(null);
  const [vipRequests, setVipRequests] = useState([]);
  const [vipCancels, setVipCancels] = useState([]);
  const [users, setUsers] = useState([]);
  const [supportList, setSupportList] = useState([]);
  const [supportChat, setSupportChat] = useState(null);
  const [supportText, setSupportText] = useState("");
  const [supportFile, setSupportFile] = useState(null);
  const [withdrawals, setWithdrawals] = useState([]);
  const [recharges, setRecharges] = useState([]);
  const [referrals, setReferrals] = useState(null);
  const [rewardForm, setRewardForm] = useState(null);
  const [wallets, setWallets] = useState([]);
  const [walletSettings, setWalletSettings] = useState(null);
  const [deposits, setDeposits] = useState([]);
  const [withdrawalsAdmin, setWithdrawalsAdmin] = useState([]);
  const [selectedWallet, setSelectedWallet] = useState(null);
  const [adjust, setAdjust] = useState({ userId: "", amount: "", note: "تعديل مشرف USDT" });
  const [inviteOverride, setInviteOverride] = useState({ userId: "", required: "0" });
  const [invitePanelOpen, setInvitePanelOpen] = useState(false);
  const [userQuery, setUserQuery] = useState("");
  const [supportQuery, setSupportQuery] = useState("");
  const [moneyQuery, setMoneyQuery] = useState("");
  const [moneyOpen, setMoneyOpen] = useState(null);
  const [selectedUserId, setSelectedUserId] = useState(null);
  const [userDetailRequired, setUserDetailRequired] = useState("");
  const [userActionView, setUserActionView] = useState(null);
  const [issuedReset, setIssuedReset] = useState(null);
  const [resetRequestUserId, setResetRequestUserId] = useState("");

  async function load() {
    setError("");
    try {
      setStats(await api("/api/admin/stats"));
      setVipRequests(await api("/api/admin/vip-requests"));
      setVipCancels(await api("/api/admin/vip-cancels"));
      setUsers(await api("/api/admin/users"));
      setSupportList(await api("/api/admin/support"));
      setWithdrawals(await api("/api/admin/withdrawals"));
      setRecharges(await api("/api/admin/recharges"));
      const referralData = await api("/api/admin/referrals");
      setReferrals(referralData);
      setRewardForm(referralData.settings);
      const walletData = await api("/api/admin/wallets");
      setWallets(walletData.users || []);
      setWalletSettings(walletData.settings);
      setDeposits(walletData.deposits || []);
      setWithdrawalsAdmin(walletData.withdrawals || []);
    } catch (err) {
      setError(err.message);
    }
  }

  useEffect(() => { load(); }, []);

  async function act(path) {
    setError("");
    setNotice("");
    try {
      await api(path, { method: "POST" });
      setNotice(t("تم تنفيذ العملية"));
      load();
    } catch (err) {
      setError(err.message);
    }
  }

  async function saveRewards(e) {
    e.preventDefault();
    setError("");
    setNotice("");
    try {
      await api("/api/admin/referral-settings", { method: "PATCH", body: JSON.stringify(rewardForm) });
      setNotice(t("تم حفظ إعدادات مكافآت الدعوات"));
      load();
    } catch (err) {
      setError(err.message);
    }
  }

  async function saveWalletSettings(e) {
    e.preventDefault();
    setError("");
    setNotice("");
    try {
      await api("/api/admin/wallet-settings", { method: "PATCH", body: JSON.stringify(walletSettings) });
      setNotice(t("تم حفظ عنوان محفظة الشركة"));
      load();
    } catch (err) {
      setError(err.message);
    }
  }

  async function saveUserInviteOverride(useGeneral, userId = inviteOverride.userId, required = inviteOverride.required) {
    if (!userId) return;
    setError("");
    setNotice("");
    try {
      await api("/api/admin/wallet-settings", {
        method: "PATCH",
        body: JSON.stringify({
          ...walletSettings,
          inviteOverrideUserId: userId,
          useGeneralInviteRule: useGeneral,
          minInvitesForUser: required
        })
      });
      setNotice(useGeneral ? "تم إلغاء التخصيص. عاد المستخدم للشرط العام." : "تم حفظ التخصيص بنجاح");
      if (useGeneral && Number(userId) === Number(selectedUserId)) setUserDetailRequired("");
      load();
    } catch (err) {
      setError(err.message);
    }
  }

  async function saveBalance(e) {
    e.preventDefault();
    if (!adjust.userId || !adjust.amount) return;
    setError("");
    setNotice("");
    try {
      await api(`/api/admin/users/${adjust.userId}/balance`, {
        method: "POST",
        body: JSON.stringify({ amount: Number(adjust.amount), note: adjust.note })
      });
      setNotice(t("تم تحديث المحفظة"));
      setAdjust({ ...adjust, amount: "" });
      load();
      if (selectedWallet) {
        const detail = await api(`/api/admin/wallets/${selectedWallet.user.id}`);
        setSelectedWallet(detail);
      }
    } catch (err) {
      setError(err.message);
    }
  }

  async function openWallet(id) {
    try {
      setSelectedWallet(await api(`/api/admin/wallets/${id}`));
    } catch (err) {
      setError(err.message);
    }
  }

  async function issueUserPasswordReset(person) {
    if (!person || person.role === "admin") {
      setError("استعادة حساب الأدمن تتم من مسار الأدمن المستقل");
      return;
    }
    setError("");
    setNotice("");
    try {
      const result = await api(`/api/admin/users/${person.id}/password-reset`, {
        method: "POST",
        body: JSON.stringify({ userId: Number(person.id) })
      });
      if (Number(result.userId) !== Number(person.id)) {
        setError("تعذر إنشاء رابط هذا المستخدم");
        return;
      }
      setIssuedReset({
        userId: Number(result.userId),
        code: String(result.code || ""),
        resetUrl: String(result.resetUrl || ""),
        expiresInMinutes: Number(result.expiresInMinutes || 1440)
      });
      setNotice(result.message || "تم إنشاء رابط استعادة لمرة واحدة. انسخه وأرسله للمستخدم عبر الدعم.");
    } catch (err) {
      setError(err.message);
    }
  }

  const adminUsers = (users.length ? users : wallets.map((item) => item.user)).filter(Boolean);
  const inviteMap = walletSettings?.minInvitesForWithdrawByUser || {};
  const selectedInviteUser = adminUsers.find((item) => Number(item.id) === Number(inviteOverride.userId));
  const selectedInviteCurrent = inviteOverride.userId ? inviteMap[String(inviteOverride.userId)] : undefined;
  const selectedInviteHasCustom = selectedInviteCurrent !== undefined && selectedInviteCurrent !== null;

  return (
    <div className="admin-panel stack">
      <PageHeader kicker="Admin" title={t("لوحة الإدارة")} subtitle={t("هذه اللوحة للمشرف فقط. الطلبات والأرصدة تُدار من الخادم دون تغيير منطق المالية.")} />
      <div className="nav admin-tabs">
        <button className={tab === "vip" ? "active" : ""} onClick={() => setTab("vip")}>{t("تفعيل VIP")}</button>
        <button className={tab === "vipCancel" ? "active" : ""} onClick={() => setTab("vipCancel")}>{t("إلغاء VIP")}</button>
        <button className={tab === "support" ? "active" : ""} onClick={() => setTab("support")}>{t("الدعم")}</button>
        <button className={tab === "ads" ? "active" : ""} onClick={() => setTab("ads")}>{t("الإعلانات")}</button>
        <button className={tab === "users" ? "active" : ""} onClick={() => setTab("users")}>{t("المستخدمون")}</button>
        <button className={tab === "passwordResets" ? "active" : ""} onClick={() => setTab("passwordResets")}>{t("طلبات إعادة تعيين كلمة المرور")}</button>
        <button className={tab === "referrals" ? "active" : ""} onClick={() => setTab("referrals")}>{t("الدعوات")}</button>
        <button className={tab === "wallets" ? "active" : ""} onClick={() => setTab("wallets")}>{t("المحافظ")}</button>
        <button className={tab === "money" ? "active" : ""} onClick={() => setTab("money")}>{t("المالية")}</button>
      </div>
      {stats && (
        <div className="grid">
          <div className="card"><h3>{t("المستخدمون")}</h3><div className="stat">{stats.users}</div></div>
          <div className="card"><h3>{t("VIP النشط")}</h3><div className="stat">{stats.vipUsers}</div></div>
          <div className="card"><h3>{t("طلبات VIP")}</h3><div className="stat">{stats.pendingVip}</div></div>
          <div className="card"><h3>{t("طلبات الإلغاء")}</h3><div className="stat">{stats.pendingVipCancel || 0}</div></div>
          <div className="card"><h3>{t("الدعوات")}</h3><div className="stat">{stats.referrals}</div></div>
        </div>
      )}
      {tab === "vip" && (
        <div className="card admin-block">
          <h2>{t("طلبات تفعيل VIP")}</h2>
          <div className="admin-reqs">
            {vipRequests.map((item) => (
              <article className="admin-req" key={item.id}>
                <div className="admin-req-top">
                  <strong>{item.user?.name}</strong>
                  <StatusBadge status={item.status} />
                </div>
                <p className="admin-req-meta">
                  <span>{fileNumber(item.user?.id)}</span>
                  <span>{item.vipName}</span>
                  <span>{item.user?.vipStatus === "active" ? item.user?.vipName : displayVipName(lang, "بدون VIP")}</span>
                  <span>{money(item.price)}</span>
                  <span>{item.activationDate ? formatDate(lang, item.activationDate) : "—"}</span>
                </p>
                {item.status === "pending" && (
                  <div className="admin-req-actions">
                    <button type="button" className="ok" onClick={() => act(`/api/admin/vip-requests/${item.id}/approve`)}>قبول</button>
                    <button type="button" className="bad" onClick={() => act(`/api/admin/vip-requests/${item.id}/reject`)}>رفض</button>
                  </div>
                )}
              </article>
            ))}
          </div>
        </div>
      )}
      {tab === "vipCancel" && (
        <div className="card admin-block">
          <h2>{t("طلبات إلغاء VIP")}</h2>
          <div className="admin-reqs">
            {vipCancels.map((item) => (
              <article className="admin-req" key={item.id}>
                <div className="admin-req-top">
                  <strong>{item.user?.name}</strong>
                  <StatusBadge status={item.status} />
                </div>
                <p className="admin-req-meta">
                  <span>{fileNumber(item.user?.id)}</span>
                  <span>{item.vipName}</span>
                </p>
                {item.status === "pending" && (
                  <div className="admin-req-actions">
                    <button type="button" className="ok" onClick={() => act(`/api/admin/vip-cancels/${item.id}/approve`)}>قبول الإلغاء</button>
                    <button type="button" className="bad" onClick={() => act(`/api/admin/vip-cancels/${item.id}/reject`)}>رفض</button>
                  </div>
                )}
              </article>
            ))}
          </div>
        </div>
      )}
      {tab === "ads" && (
        <AdminAdCreatives api={api} setError={setError} setNotice={setNotice} />
      )}
      {tab === "support" && (
        <div className="card" style={{ marginTop: 12 }}>
          <h2>{t("محادثات الدعم")}</h2>
          <label>بحث عن مستخدم</label>
          <input type="search" placeholder="الاسم أو البريد أو رقم الملف" value={supportQuery} onChange={(e) => setSupportQuery(e.target.value)} autoComplete="off" />
          <div className="grid">
            <div>
              {supportList.length === 0 && <EmptyState title="لا توجد محادثات بعد" />}
              {supportList.filter((item) => userMatchesQuery(item.user || { id: item.userId, name: item.user?.name, email: item.user?.email }, supportQuery)).map((item) => (
                <div className="list-item" key={item.id}>
                  <div>
                    <div>{item.user?.name || "مستخدم"} · {fileNumber(item.userId || item.user?.id)}</div>
                    <small className="muted">{item.user?.email || ""} · {item.lastMessage || "بدون رسائل"} · {item.messageCount || 0}</small>
                  </div>
                  <button className="ghost" onClick={async () => {
                    try {
                      setSupportChat(await api(`/api/admin/support/${item.userId}`));
                    } catch (err) {
                      setError(err.message);
                    }
                  }}>فتح</button>
                </div>
              ))}
            </div>
            <div>
              {!supportChat && <EmptyState title="اختر محادثة" text="افتح طلباً من القائمة للرد." />}
              {supportChat && (
                <>
                  <h3>{supportChat.user?.name} · {fileNumber(supportChat.user?.id)}</h3>
                  <p className="muted">{supportChat.user?.email}</p>
                  <ChatMessages messages={supportChat.messages || []} selfRole="support" />
                  <form onSubmit={async (e) => {
                    e.preventDefault();
                    try {
                      const payload = { text: supportText };
                      if (supportFile) payload.file = await fileToPayload(supportFile);
                      const result = await api(`/api/admin/support/${supportChat.user.id}/messages`, {
                        method: "POST",
                        body: JSON.stringify(payload)
                      });
                      setSupportChat({ ...supportChat, messages: result.messages });
                      setSupportText("");
                      setSupportFile(null);
                      setSupportList(await api("/api/admin/support"));
                    } catch (err) {
                      setError(err.message);
                    }
                  }}>
                    <textarea value={supportText} onChange={(e) => setSupportText(e.target.value)} rows={3} />
                    <input type="file" accept="image/*,video/*" onChange={(e) => setSupportFile(e.target.files?.[0] || null)} />
                    <div className="row"><button type="submit">رد</button></div>
                  </form>
                </>
              )}
            </div>
          </div>
        </div>
      )}
      {tab === "referrals" && referrals && (
        <div className="card" style={{ marginTop: 12 }}>
          <h2>إحصائيات الدعوات</h2>
          <div className="grid">
            <div className="card"><h3>إجمالي الدعوات المباشرة</h3><div className="stat">{referrals.totalInvites}</div></div>
            <div className="card"><h3>إجمالي المكافآت</h3><div className="stat">{money(referrals.totalPaid)}</div></div>
            <div className="card"><h3>أصحاب دعوات</h3><div className="stat">{referrals.usersWithInvites}</div></div>
          </div>
          <div className="grid" style={{ marginTop: 12 }}>
            {(referrals.byLevel || []).map((item) => (
              <div className="card" key={item.level}>
                <h3>{item.name}</h3>
                <div className="stat">{item.members}</div>
                <p className="muted">مدفوع: {money(item.paid)}</p>
              </div>
            ))}
          </div>
          {rewardForm && (
            <form onSubmit={saveRewards} style={{ marginTop: 16 }}>
              <h3>إدارة مكافآت الدعوات</h3>
              <label>{t("مكافأة الدعوة")}</label>
              <input type="number" step="0.01" min="0" value={rewardForm.signupInviter} onChange={(e) => setRewardForm({ ...rewardForm, signupInviter: e.target.value })} />
              <label>هدية المدعو</label>
              <input type="number" step="0.01" value={rewardForm.signupInvited} onChange={(e) => setRewardForm({ ...rewardForm, signupInvited: e.target.value })} />
              {(rewardForm.levels || []).map((item, index) => (
                <div className="grid" key={item.level} style={{ marginTop: 8 }}>
                  <div>
                    <label>{item.name} · عمولة المهام</label>
                    <input type="number" step="0.01" value={item.taskRate} onChange={(e) => {
                      const levels = [...rewardForm.levels];
                      levels[index] = { ...levels[index], taskRate: e.target.value };
                      setRewardForm({ ...rewardForm, levels });
                    }} />
                  </div>
                  <div>
                    <label>عمولة VIP</label>
                    <input type="number" step="0.01" value={item.vipRate} onChange={(e) => {
                      const levels = [...rewardForm.levels];
                      levels[index] = { ...levels[index], vipRate: e.target.value };
                      setRewardForm({ ...rewardForm, levels });
                    }} />
                  </div>
                  <div>
                    <label>مكافأة تسجيل شبكة</label>
                    <input type="number" step="0.01" value={item.signupBonus} onChange={(e) => {
                      const levels = [...rewardForm.levels];
                      levels[index] = { ...levels[index], signupBonus: e.target.value };
                      setRewardForm({ ...rewardForm, levels });
                    }} />
                  </div>
                </div>
              ))}
              <div className="row"><button type="submit">حفظ المكافآت</button></div>
            </form>
          )}
          <h3>المستخدمون والدعاة</h3>
          <div className="table-wrap"><table>
            <thead>
              <tr>
                <th>المستخدم</th>
                <th>الكود</th>
                <th>الداعي</th>
                <th>مباشر</th>
                <th>الشبكة</th>
              </tr>
            </thead>
            <tbody>
              {(referrals.users || []).map((item) => (
                <tr key={item.id}>
                  <td>{fileNumber(item.id)} {item.name}</td>
                  <td>{item.referralCode}</td>
                  <td>{item.inviterName ? `${item.inviterName} (${item.inviterCode})` : "—"}</td>
                  <td>{item.invitedCount}</td>
                  <td>{item.networkCount}</td>
                </tr>
              ))}
            </tbody>
          </table></div>
          <h3>أفضل الداعين</h3>
          {referrals.topInviters.map((item, index) => (
            <div className="list-item" key={item.user?.id || index}>
              <div>
                <div>{item.user?.name} · {item.user?.email}</div>
                <small className="muted">الكود: {item.user?.referralCode}</small>
              </div>
              <div>{item.invitedCount} مدعو · {money(item.earned)}</div>
            </div>
          ))}
          <h3>السجل</h3>
          <div className="table-wrap"><table>
            <thead>
              <tr>
                <th>الداعي</th>
                <th>المدعو</th>
                <th>المستوى</th>
                <th>النوع</th>
                <th>المبلغ</th>
                <th>التاريخ</th>
              </tr>
            </thead>
            <tbody>
              {referrals.recent.map((item) => (
                <tr key={item.id}>
                  <td>{item.inviter?.name}</td>
                  <td>{item.invited?.name}</td>
                  <td>{item.level || 1}</td>
                  <td>{referralTypeLabel(item.type, t)}</td>
                  <td>{money(item.amount)}</td>
                  <td>{formatDate(lang, item.createdAt)}</td>
                </tr>
              ))}
            </tbody>
          </table></div>
        </div>
      )}
      {tab === "wallets" && (
        <div className="card" style={{ marginTop: 12 }}>
          <h2>إدارة محفظة USDT</h2>
          <p className="muted">المحفظة داخلية فقط. لا يتم توليد عناوين عملات للمستخدمين. الإيداع والسداد الخارجي يتم يدوياً من محفظة الشركة.</p>
          {walletSettings && (
            <form onSubmit={saveWalletSettings}>
              <h3>محفظة الشركة</h3>
              <label>عنوان USDT</label>
              <input value={walletSettings.companyAddress} onChange={(e) => setWalletSettings({ ...walletSettings, companyAddress: e.target.value })} />
              <label>الشبكة</label>
              <input value={walletSettings.network} onChange={(e) => setWalletSettings({ ...walletSettings, network: e.target.value })} />
              <label>حد أدنى للإيداع</label>
              <input type="number" value={walletSettings.minDeposit} onChange={(e) => setWalletSettings({ ...walletSettings, minDeposit: e.target.value })} />
              <label>حد أدنى للسحب</label>
              <input type="number" value={walletSettings.minWithdraw} onChange={(e) => setWalletSettings({ ...walletSettings, minWithdraw: e.target.value })} />
              <label>عدد الدعوات المطلوبة للسحب</label>
              <input type="number" min="0" step="1" value={walletSettings.minInvitesForWithdraw ?? 0} onChange={(e) => setWalletSettings({ ...walletSettings, minInvitesForWithdraw: e.target.value })} />
              <p className="muted">0 = بدون شرط. 3 أو 5 أو 10 = يجب أن يملك المستخدم هذا العدد من الدعوات المؤهلة على الأقل.</p>
              <div className="row"><button type="submit">حفظ إعدادات المحفظة</button></div>
            </form>
          )}
          <div className="invite-override-box">
            <button type="button" className="account-item" onClick={() => setInvitePanelOpen(!invitePanelOpen)}>
              <span>تخصيص عدد الدعوات المطلوبة للسحب</span>
              <span className="account-chevron" aria-hidden="true" />
            </button>
            {invitePanelOpen && (
              <>
                <AdminUserPicker
                  users={adminUsers}
                  value={inviteOverride.userId}
                  onChange={(userId) => {
                    const current = inviteMap[String(userId)];
                    setInviteOverride({
                      userId: String(userId),
                      required: current === undefined || current === null ? "" : String(current)
                    });
                  }}
                />
                {inviteOverride.userId ? (
                  <>
                    <div className="admin-user-selected">
                      <strong>{selectedInviteUser?.name || "مستخدم"}</strong>
                      <small>{selectedInviteUser?.email || ""}</small>
                      <span>رقم الملف: {fileNumber(inviteOverride.userId)}</span>
                      <span>{selectedInviteHasCustom ? `الشرط الحالي: ${selectedInviteCurrent} دعوات` : "الشرط الحالي: الشرط العام"}</span>
                    </div>
                    <label>العدد الجديد</label>
                    <input type="number" min="0" step="1" value={inviteOverride.required} onChange={(e) => setInviteOverride({ ...inviteOverride, required: e.target.value })} />
                    <div className="admin-req-actions">
                      <button type="button" className="ok" onClick={() => saveUserInviteOverride(false)}>حفظ وتطبيق</button>
                      <button type="button" className="ghost" onClick={() => saveUserInviteOverride(true)}>إلغاء التخصيص</button>
                    </div>
                  </>
                ) : null}
              </>
            )}
          </div>
          <h3>طلبات إيداع USDT</h3>
          <div className="admin-reqs">
            {deposits.length === 0 && <p className="muted">لا يوجد إيداع بعد</p>}
            {deposits.map((item) => (
              <article className="admin-req" key={item.id}>
                <div className="admin-req-top">
                  <strong>{depositRef(item.id)}</strong>
                  <StatusBadge status={item.status} />
                </div>
                <p className="admin-req-meta">
                  <span>{item.user?.name}</span>
                  <span>{fileNumber(item.user?.id || item.userId)}</span>
                  <span>{money(item.amount)}</span>
                  <span>{item.network || "TRC20"}</span>
                  <span>{item.createdAt ? formatDate(lang, item.createdAt) : "—"}</span>
                </p>
                <DepositScreenshot item={item} />
                {item.status === "pending" && (
                  <div className="admin-req-actions">
                    <button type="button" className="ok" onClick={() => act(`/api/admin/recharges/${item.id}/approve`)}>تأكيد الإيداع</button>
                    <button type="button" className="bad" onClick={() => act(`/api/admin/recharges/${item.id}/reject`)}>رفض الإيداع</button>
                  </div>
                )}
              </article>
            ))}
          </div>
          <h3>سحوبات بانتظار التحويل اليدوي</h3>
          {withdrawalsAdmin.filter((item) => item.status === "pending").length === 0 && <p className="muted">لا يوجد سحب معلّق</p>}
          {withdrawalsAdmin.filter((item) => item.status === "pending").map((item) => (
            <article className="admin-req" key={item.id}>
              <div className="admin-req-top">
                <strong>{withdrawRef(item.id)}</strong>
                <span>{money(item.amount)}</span>
              </div>
              <p className="admin-req-meta">
                <span>{item.user?.name}</span>
                <span>{fileNumber(item.user?.id || item.userId)}</span>
                <span>{item.network || "TRC20"}</span>
                <span>{item.createdAt ? formatDate(lang, item.createdAt) : "—"}</span>
              </p>
              <WithdrawPayoutAddress item={item} onCopied={setNotice} />
              <div className="admin-req-actions">
                <button type="button" className="ok" onClick={() => act(`/api/admin/withdrawals/${item.id}/approve`)}>تم التحويل وخصم الرصيد</button>
                <button type="button" className="bad" onClick={() => act(`/api/admin/withdrawals/${item.id}/reject`)}>رفض</button>
              </div>
            </article>
          ))}
          <form onSubmit={saveBalance}>
            <h3>إضافة / خصم رصيد داخلي بعد التحقق</h3>
            <AdminUserPicker
              users={adminUsers}
              value={adjust.userId}
              onChange={(userId) => setAdjust({ ...adjust, userId })}
            />
            <input placeholder="المبلغ USDT (+ إضافة / - خصم)" value={adjust.amount} onChange={(e) => setAdjust({ ...adjust, amount: e.target.value })} />
            <input placeholder="ملاحظة" value={adjust.note} onChange={(e) => setAdjust({ ...adjust, note: e.target.value })} />
            <div className="row"><button type="submit">تنفيذ</button></div>
          </form>
          <h3>المحافظ الداخلية</h3>
          {wallets.map((item) => (
            <div className="list-item" key={item.user.id}>
              <div>
                <div>{item.user.name} · {fileNumber(item.user.id)}</div>
                <small className="muted">{item.user.email} · رصيد {money(item.wallet.balance)} · متاح {money(item.wallet.available)} · أرباح {money(item.wallet.totalEarnings)}</small>
              </div>
              <button className="ghost" onClick={() => openWallet(item.user.id)}>العمليات</button>
            </div>
          ))}
          {selectedWallet && (
            <div style={{ marginTop: 16 }}>
              <h3>عمليات {selectedWallet.user.name} · {fileNumber(selectedWallet.user.id)}</h3>
              {selectedWallet.wallet.transactions.map((tx) => (
                <div className="list-item" key={tx.id}>
                  <div>
                    <div>{transactionTypeLabel(tx.type)}</div>
                    <small className="muted">{tx.note} · {formatDate(lang, tx.createdAt)}</small>
                  </div>
                  <div>
                    <b className={tx.amount >= 0 ? "ok" : "bad"}>{money(tx.amount)}</b>
                    <div><StatusBadge status={tx.status} /></div>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      )}
      {tab === "users" && (
        <div className="card" style={{ marginTop: 12 }}>
          {selectedUserId ? (
            (() => {
              const person = adminUsers.find((item) => Number(item.id) === Number(selectedUserId));
              if (!person) {
                return (
                  <>
                    <button type="button" className="ghost account-back" onClick={() => setSelectedUserId(null)}>رجوع</button>
                    <EmptyState title="المستخدم غير موجود" />
                  </>
                );
              }
              const walletRow = wallets.find((item) => Number(item.user?.id) === Number(person.id));
              const wallet = walletRow?.wallet;
              const depositTotal = recharges
                .filter((item) => Number(item.userId || item.user?.id) === Number(person.id) && (item.status === "approved" || item.status === "completed"))
                .reduce((sum, item) => sum + Number(item.amount || 0), 0);
              const customInvites = inviteMap[String(person.id)];
              const hasCustom = customInvites !== undefined && customInvites !== null;
              const accountStatus = person.role === "admin" ? "مشرف" : "عضو";
              return (
                <div className="admin-user-page">
                  <button type="button" className="ghost account-back" onClick={() => { setSelectedUserId(null); setIssuedReset(null); }}>رجوع</button>
                  <div className="admin-user-selected">
                    <strong>{person.name}</strong>
                    <span>رقم الملف: {fileNumber(person.id)}
                      <button type="button" className="ghost admin-copy" onClick={async () => {
                        try {
                          await navigator.clipboard.writeText(fileNumber(person.id));
                          setNotice("تم نسخ رقم الملف " + fileNumber(person.id));
                        } catch {
                          setError("تعذر النسخ");
                        }
                      }}>نسخ</button>
                    </span>
                    <small>{person.email}</small>
                    <span>حالة الحساب: {accountStatus}</span>
                  </div>
                  {person.role !== "admin" && (
                    <article className="admin-req admin-user-reset">
                      <p className="metric-label">{t("إعادة تعيين كلمة المرور")}</p>
                      <p className="muted">{t("يولّد النظام رمزًا ورابطًا لمرة واحدة صالحين 24 ساعة. انسخهما وأرسلهما عبر الدعم. الأدمن لا يرى كلمة المرور الحالية ولا يعيّن الجديدة.")}</p>
                      <div className="admin-req-actions">
                        <button type="button" className="ok" onClick={async () => {
                          setError("");
                          setNotice("");
                          try {
                            const result = await api(`/api/admin/users/${person.id}/password-reset`, {
                              method: "POST",
                              body: JSON.stringify({ userId: Number(person.id) })
                            });
                            if (Number(result.userId) !== Number(person.id)) {
                              setError("تعذر إنشاء رابط هذا المستخدم");
                              return;
                            }
                            setIssuedReset({
                              userId: Number(result.userId),
                              code: String(result.code || ""),
                              resetUrl: String(result.resetUrl || ""),
                              expiresInMinutes: Number(result.expiresInMinutes || 1440)
                            });
                            setNotice(result.message || "تم إنشاء رابط استعادة لمرة واحدة. انسخه وأرسله للمستخدم عبر الدعم.");
                          } catch (err) {
                            setError(err.message);
                          }
                        }}>{issuedReset && Number(issuedReset.userId) === Number(person.id) ? t("إنشاء رمز استعادة جديد") : t("إعادة تعيين كلمة المرور")}</button>
                      </div>
                      {issuedReset && Number(issuedReset.userId) === Number(person.id) && (
                        <div className="admin-reset-box">
                          <p className="muted">{t("انسخ الرابط أو الرمز وأرسله للمستخدم عبر الدعم. يُستخدم مرة واحدة فقط. لا يتم إرسال بريد إلكتروني.")}</p>
                          <p className="muted">{t("صالح لمدة 24 ساعة")}</p>
                          <label>{t("رابط الاستعادة")}</label>
                          <textarea readOnly value={issuedReset.resetUrl} rows={3} />
                          <label>{t("رمز الاستعادة")}</label>
                          <input readOnly value={issuedReset.code} className="admin-recovery-code" />
                          <div className="admin-req-actions">
                            <button type="button" className="ok" onClick={async () => {
                              try {
                                await navigator.clipboard.writeText(issuedReset.resetUrl);
                                setNotice(t("تم نسخ رابط الاستعادة"));
                              } catch {
                                setError(t("تعذر النسخ"));
                              }
                            }}>{t("نسخ الرابط")}</button>
                            <button type="button" className="ghost" onClick={async () => {
                              try {
                                await navigator.clipboard.writeText(issuedReset.code);
                                setNotice(t("تم نسخ رمز الاستعادة"));
                              } catch {
                                setError(t("تعذر النسخ"));
                              }
                            }}>{t("نسخ الرمز")}</button>
                          </div>
                        </div>
                      )}
                    </article>
                  )}
                  <div className="admin-mini-grid">
                    <article className="admin-req">
                      <p className="metric-label">المحفظة</p>
                      <p className="admin-req-meta">
                        <span>الرصيد: {money(wallet?.balance ?? person.balance)}</span>
                        <span>إجمالي الإيداعات: {money(depositTotal)}</span>
                        <span>إجمالي السحوبات: {money(wallet?.totalWithdrawals ?? person.totalWithdrawals)}</span>
                      </p>
                    </article>
                    <article className="admin-req">
                      <p className="metric-label">الإحالات</p>
                      <p className="admin-req-meta">
                        <span>الدعوات: {person.invitedCount || 0}</span>
                        <span>المؤهلة: {person.invitedCount || 0}</span>
                        <span>الكود: {person.referralCode || "—"}</span>
                      </p>
                    </article>
                    <article className="admin-req">
                      <p className="metric-label">VIP</p>
                      <p className="admin-req-meta">
                        <span>{person.vipStatus === "active" ? person.vipName : displayVipName(lang, "بدون VIP")}</span>
                        <StatusBadge status={person.vipStatus} />
                      </p>
                    </article>
                    <article className="admin-req">
                      <p className="metric-label">التخصيصات</p>
                      <p className="admin-req-meta">
                        <span>{hasCustom ? `شرط السحب الخاص: ${customInvites} دعوات` : "لا يوجد تخصيص سحب"}</span>
                        <span>الشرط العام: {walletSettings?.minInvitesForWithdraw ?? 0}</span>
                        <span>{hasCustom ? "يستخدم تخصيصًا خاصًا" : "يستخدم الشرط العام"}</span>
                      </p>
                    </article>
                  </div>
                  <article className="admin-req">
                    <p className="metric-label">إجراءات المستخدم</p>
                    <p className="muted">{hasCustom ? `الشرط الحالي: ${customInvites} دعوات` : "الشرط الحالي: الشرط العام"}</p>
                    <label>تخصيص شرط السحب</label>
                    <input type="number" min="0" step="1" value={userDetailRequired} onChange={(e) => setUserDetailRequired(e.target.value)} />
                    <div className="admin-req-actions">
                      <button type="button" className="ok" onClick={() => saveUserInviteOverride(false, person.id, userDetailRequired)}>حفظ وتطبيق</button>
                      <button type="button" className="ghost" onClick={() => saveUserInviteOverride(true, person.id, userDetailRequired)}>إلغاء التخصيص</button>
                    </div>
                    <div className="admin-req-actions">
                      <button type="button" className="ghost" onClick={() => setUserActionView(userActionView === "withdraw" ? null : "withdraw")}>طلبات السحب</button>
                      <button type="button" className="ghost" onClick={() => setUserActionView(userActionView === "deposit" ? null : "deposit")}>طلبات الإيداع</button>
                      <button type="button" className="ghost" onClick={async () => {
                        const conv = supportList.find((item) => Number(item.userId || item.user?.id) === Number(person.id));
                        if (!conv) {
                          setNotice("لا توجد محادثة دعم لهذا المستخدم");
                          return;
                        }
                        try {
                          const chat = await api(`/api/admin/support/${person.id}`);
                          if (Number(chat.user?.id) !== Number(person.id)) {
                            setError("تعذر فتح محادثة هذا المستخدم");
                            return;
                          }
                          setSupportChat(chat);
                          setSupportQuery(fileNumber(person.id));
                          setTab("support");
                        } catch (err) {
                          setError(err.message);
                        }
                      }}>فتح الدعم</button>
                    </div>
                    {userActionView === "withdraw" && (
                      <div className="admin-reqs">
                        {withdrawals.filter((item) => Number(item.userId || item.user?.id) === Number(person.id)).map((item) => (
                          <div className="admin-req-meta" key={item.id}>
                            <span>{withdrawRef(item.id)}</span>
                            <span>{money(item.amount)}</span>
                            <StatusBadge status={item.status} />
                            <span>{item.network || "TRC20"}</span>
                            <span>{item.createdAt ? formatDate(lang, item.createdAt) : "—"}</span>
                            <WithdrawPayoutAddress item={item} onCopied={setNotice} />
                          </div>
                        ))}
                        {withdrawals.filter((item) => Number(item.userId || item.user?.id) === Number(person.id)).length === 0 && <p className="muted">لا يوجد سحب</p>}
                      </div>
                    )}
                    {userActionView === "deposit" && (
                      <div className="admin-reqs">
                        {recharges.filter((item) => Number(item.userId || item.user?.id) === Number(person.id)).map((item) => (
                          <div className="admin-req-meta" key={item.id}>
                            <span>{depositRef(item.id)}</span>
                            <span>{money(item.amount)}</span>
                            <StatusBadge status={item.status} />
                            <span>{item.createdAt ? formatDate(lang, item.createdAt) : "—"}</span>
                            <DepositScreenshot item={item} />
                          </div>
                        ))}
                        {recharges.filter((item) => Number(item.userId || item.user?.id) === Number(person.id)).length === 0 && <p className="muted">لا يوجد إيداع</p>}
                      </div>
                    )}
                  </article>
                </div>
              );
            })()
          ) : (
            <>
          <h2>المستخدمون</h2>
          <label>بحث عن مستخدم</label>
          <input type="search" placeholder="الاسم أو البريد أو رقم الملف" value={userQuery} onChange={(e) => setUserQuery(e.target.value)} autoComplete="off" />
          {adminUsers.filter((item) => userMatchesQuery(item, userQuery)).map((item) => (
            <div className="list-item" key={item.id}>
              <div>
                <div>{item.name} · {fileNumber(item.id)}</div>
                <small className="muted">{item.email} · {item.vipStatus === "active" ? item.vipName : displayVipName(lang, "بدون VIP")} · {t("الداعي:")} {item.inviterName || "—"} · {t("مباشر")} {item.invitedCount || 0} · {money(item.balance)}</small>
              </div>
              <div className="admin-user-list-actions">
                <button className="ghost" onClick={() => {
                  setSelectedUserId(item.id);
                  setUserActionView(null);
                  setIssuedReset(null);
                  const current = inviteMap[String(item.id)];
                  setUserDetailRequired(current !== undefined && current !== null ? String(current) : "");
                }}>فتح</button>
                {item.role !== "admin" && (
                  <button className="ok" onClick={() => {
                    setSelectedUserId(item.id);
                    setUserActionView(null);
                    setIssuedReset(null);
                    const current = inviteMap[String(item.id)];
                    setUserDetailRequired(current !== undefined && current !== null ? String(current) : "");
                  }}>{t("إعادة تعيين كلمة المرور")}</button>
                )}
              </div>
            </div>
          ))}
            </>
          )}
        </div>
      )}
      {tab === "passwordResets" && (
        <div className="card admin-block">
          <h2>{t("طلبات إعادة تعيين كلمة المرور")}</h2>
          <p className="muted">{t("اختر المستخدم ثم أصدر رمزًا ورابطًا لمرة واحدة صالحين 24 ساعة. الأدمن لا يرى كلمة المرور الحالية ولا يعيّن الجديدة. هذا المسار لا يُستخدم لحساب الأدمن.")}</p>
          <AdminUserPicker
            users={adminUsers.filter((item) => item.role !== "admin")}
            value={resetRequestUserId}
            onChange={(id) => {
              setResetRequestUserId(id);
              setIssuedReset(null);
            }}
          />
          {(() => {
            const person = adminUsers.find((item) => Number(item.id) === Number(resetRequestUserId) && item.role !== "admin");
            if (!person) return <p className="muted">{t("ابحث عن المستخدم المطلوب لإصدار استعادة كلمة المرور.")}</p>;
            return (
              <article className="admin-req admin-user-reset">
                <p className="metric-label">{t("إعادة تعيين كلمة المرور")}</p>
                <p className="admin-req-meta">
                  <span>{person.name}</span>
                  <span>{fileNumber(person.id)}</span>
                  <span>{person.email}</span>
                </p>
                <div className="admin-req-actions">
                  <button type="button" className="ok" onClick={() => issueUserPasswordReset(person)}>
                    {issuedReset && Number(issuedReset.userId) === Number(person.id) ? t("إنشاء رمز استعادة جديد") : t("إعادة تعيين كلمة المرور")}
                  </button>
                </div>
                {issuedReset && Number(issuedReset.userId) === Number(person.id) && (
                  <div className="admin-reset-box">
                    <p className="muted">{t("انسخ الرابط أو الرمز وأرسله للمستخدم عبر الدعم. يُستخدم مرة واحدة فقط. لا يتم إرسال بريد إلكتروني.")}</p>
                    <p className="muted">{t("صالح لمدة 24 ساعة")}</p>
                    <label>{t("رابط الاستعادة")}</label>
                    <textarea readOnly value={issuedReset.resetUrl} rows={3} />
                    <label>{t("رمز الاستعادة")}</label>
                    <input readOnly value={issuedReset.code} className="admin-recovery-code" />
                    <div className="admin-req-actions">
                      <button type="button" className="ok" onClick={async () => {
                        try {
                          await navigator.clipboard.writeText(issuedReset.resetUrl);
                          setNotice(t("تم نسخ رابط الاستعادة"));
                        } catch {
                          setError(t("تعذر النسخ"));
                        }
                      }}>{t("نسخ الرابط")}</button>
                      <button type="button" className="ghost" onClick={async () => {
                        try {
                          await navigator.clipboard.writeText(issuedReset.code);
                          setNotice(t("تم نسخ رمز الاستعادة"));
                        } catch {
                          setError(t("تعذر النسخ"));
                        }
                      }}>{t("نسخ الرمز")}</button>
                    </div>
                  </div>
                )}
              </article>
            );
          })()}
        </div>
      )}
      {tab === "money" && (
        <div className="admin-money">
          <div className="card admin-block">
            <label>بحث عن طلب</label>
            <input
              type="search"
              placeholder="WD-000007 أو DP-000001 أو #0002 أو الاسم أو البريد"
              value={moneyQuery}
              onChange={(e) => { setMoneyQuery(e.target.value); setMoneyOpen(null); }}
              autoComplete="off"
            />
          </div>
          {String(moneyQuery || "").trim() ? (
            <div className="card admin-block">
              <div className="admin-reqs">
                {[
                  ...withdrawals.filter((item) => moneyRequestMatches(item, "withdraw", moneyQuery)).map((item) => ({ item, kind: "withdraw" })),
                  ...recharges.filter((item) => moneyRequestMatches(item, "deposit", moneyQuery)).map((item) => ({ item, kind: "deposit" }))
                ].map(({ item, kind }) => {
                  const open = moneyOpen && moneyOpen.kind === kind && Number(moneyOpen.id) === Number(item.id);
                  return (
                    <article className="admin-req" key={`${kind}-${item.id}`}>
                      <button type="button" className="admin-req-hit" onClick={() => setMoneyOpen(open ? null : { kind, id: item.id })}>
                        <div className="admin-req-top">
                          <strong>{kind === "withdraw" ? withdrawRef(item.id) : depositRef(item.id)}</strong>
                          <StatusBadge status={item.status} />
                        </div>
                        <p className="admin-req-meta">
                          <span>{kind === "withdraw" ? "سحب" : "إيداع"}</span>
                          <span>{item.user?.name}</span>
                          <span>{fileNumber(item.user?.id || item.userId)}</span>
                          <span>{money(item.amount)}</span>
                          <span>{item.createdAt ? formatDate(lang, item.createdAt) : "—"}</span>
                        </p>
                      </button>
                      {open && (
                        <div className="admin-req-detail">
                          <p className="admin-req-meta">
                            <span>{item.network || "TRC20"}</span>
                          </p>
                          {kind === "withdraw" ? <WithdrawPayoutAddress item={item} onCopied={setNotice} /> : null}
                          {kind === "deposit" ? <DepositScreenshot item={item} /> : null}
                          {item.status === "pending" && kind === "withdraw" && (
                            <div className="admin-req-actions">
                              <button type="button" className="ok" onClick={() => act(`/api/admin/withdrawals/${item.id}/approve`)}>قبول</button>
                              <button type="button" className="bad" onClick={() => act(`/api/admin/withdrawals/${item.id}/reject`)}>رفض</button>
                            </div>
                          )}
                          {item.status === "pending" && kind === "deposit" && (
                            <div className="admin-req-actions">
                              <button type="button" className="ok" onClick={() => act(`/api/admin/recharges/${item.id}/approve`)}>تأكيد الإيداع</button>
                              <button type="button" className="bad" onClick={() => act(`/api/admin/recharges/${item.id}/reject`)}>رفض الإيداع</button>
                            </div>
                          )}
                        </div>
                      )}
                    </article>
                  );
                })}
              </div>
            </div>
          ) : (
            <>
          <div className="card admin-block">
            <h3>السحب</h3>
            <div className="admin-reqs">
            {withdrawals.map((item) => (
              <article className="admin-req" key={item.id}>
                <div className="admin-req-top">
                  <strong>{withdrawRef(item.id)}</strong>
                  <StatusBadge status={item.status} />
                </div>
                <p className="admin-req-meta">
                  <span>سحب</span>
                  <span>{item.user?.name}</span>
                  <span>{fileNumber(item.user?.id || item.userId)}</span>
                  <span>{money(item.amount)}</span>
                  <span>{item.network || "TRC20"}</span>
                  <span>{item.createdAt ? formatDate(lang, item.createdAt) : "—"}</span>
                </p>
                <WithdrawPayoutAddress item={item} onCopied={setNotice} />
                {item.status === "pending" && (
                  <div className="admin-req-actions">
                    <button type="button" className="ok" onClick={() => act(`/api/admin/withdrawals/${item.id}/approve`)}>قبول</button>
                    <button type="button" className="bad" onClick={() => act(`/api/admin/withdrawals/${item.id}/reject`)}>رفض</button>
                  </div>
                )}
              </article>
            ))}
            </div>
          </div>
          <div className="card admin-block">
            <h3>الإيداع</h3>
            <div className="admin-reqs">
            {recharges.map((item) => (
              <article className="admin-req" key={item.id}>
                <div className="admin-req-top">
                  <strong>{depositRef(item.id)}</strong>
                  <StatusBadge status={item.status} />
                </div>
                <p className="admin-req-meta">
                  <span>إيداع</span>
                  <span>{item.user?.name}</span>
                  <span>{fileNumber(item.user?.id || item.userId)}</span>
                  <span>{money(item.amount)}</span>
                  <span>{item.network || "TRC20"}</span>
                  <span>{item.createdAt ? formatDate(lang, item.createdAt) : "—"}</span>
                </p>
                <DepositScreenshot item={item} />
                {item.status === "pending" && (
                  <div className="admin-req-actions">
                    <button type="button" className="ok" onClick={() => act(`/api/admin/recharges/${item.id}/approve`)}>تأكيد الإيداع</button>
                    <button type="button" className="bad" onClick={() => act(`/api/admin/recharges/${item.id}/reject`)}>رفض الإيداع</button>
                  </div>
                )}
              </article>
            ))}
            </div>
          </div>
            </>
          )}
        </div>
      )}
    </div>
  );
}

listenForInviteLinks();
createRoot(document.getElementById("root")).render(<LangProvider><AppUpdatePrompt /><App /></LangProvider>);
