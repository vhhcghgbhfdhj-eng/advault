import { Capacitor, CapacitorHttp } from "@capacitor/core";
import { App as CapApp } from "@capacitor/app";

export const OFFICIAL_APK_URL = "https://advault-tt-landing.onrender.com/downloads/advault-tt.apk";
export const APP_VERSION_URL = "https://advault-tt-landing.onrender.com/downloads/app-version.json";

export function parseVersionParts(value) {
  return String(value || "")
    .split(".")
    .map((part) => Number.parseInt(part, 10) || 0);
}

export function compareVersionNames(left, right) {
  const a = parseVersionParts(left);
  const b = parseVersionParts(right);
  const n = Math.max(a.length, b.length);
  for (let i = 0; i < n; i += 1) {
    const diff = (a[i] || 0) - (b[i] || 0);
    if (diff > 0) return 1;
    if (diff < 0) return -1;
  }
  return 0;
}

export function isNewerAppRelease(latest, current) {
  const latestBuild = Number(latest?.latestBuild ?? latest?.build);
  const currentBuild = Number(current?.build ?? current?.versionCode);
  if (Number.isFinite(latestBuild) && Number.isFinite(currentBuild)) {
    return latestBuild > currentBuild;
  }
  return compareVersionNames(latest?.latestVersion ?? latest?.version, current?.version) > 0;
}

function parseManifest(res) {
  const status = Number(res?.status || 0);
  let manifest = res?.data;
  if (typeof manifest === "string") {
    try { manifest = JSON.parse(manifest); } catch { return null; }
  }
  if (!manifest || typeof manifest !== "object") return null;
  if (status && (status < 200 || status >= 300)) return null;
  const build = Number(manifest.latestBuild ?? manifest.build);
  const version = manifest.latestVersion ?? manifest.version;
  if (!Number.isFinite(build) && !version) return null;
  return manifest;
}

async function fetchManifest(url) {
  const res = await fetch(url, {
    method: "GET",
    cache: "no-store",
    headers: { Accept: "application/json", "Cache-Control": "no-store", Pragma: "no-cache" }
  });
  const text = await res.text();
  let data = text;
  try { data = JSON.parse(text); } catch {}
  return { status: res.status, data };
}

async function nativeOrFetch(url) {
  try {
    const native = await CapacitorHttp.get({
      url,
      headers: {
        Accept: "application/json",
        "Cache-Control": "no-store",
        Pragma: "no-cache",
        "User-Agent": "ADVAULT-TT-Android"
      },
      connectTimeout: 12000,
      readTimeout: 12000,
      responseType: "json"
    });
    if (parseManifest(native)) return native;
  } catch {}
  return fetchManifest(url);
}

export async function checkNativeAppUpdate(adapters = {}) {
  const isNative = adapters.isNative || (() => (
    typeof Capacitor?.isNativePlatform === "function" && Capacitor.isNativePlatform()
  ));
  if (!isNative()) return null;

  const getInfo = adapters.getInfo || (() => CapApp.getInfo());
  const request = adapters.request || nativeOrFetch;
  let info = { version: "0", build: "0" };
  try {
    info = await getInfo() || info;
  } catch {}

  const stamp = Date.now();
  const urls = [
    `${APP_VERSION_URL}?t=${stamp}`,
    APP_VERSION_URL
  ];
  const apiBase = String(adapters.apiBase || "").replace(/\/$/, "");
  if (apiBase) urls.push(`${apiBase}/api/app-version?t=${stamp}`);

  let manifest = null;
  for (const url of urls) {
    try {
      manifest = parseManifest(await request(url));
    } catch {
      manifest = null;
    }
    if (manifest) break;
  }
  if (!manifest || !isNewerAppRelease(manifest, info)) return null;

  return {
    latestVersion: String(manifest.latestVersion || manifest.version || ""),
    apkUrl: String(manifest.apkUrl || OFFICIAL_APK_URL),
    optional: manifest.optional !== false
  };
}

export async function openOfficialApk(url = OFFICIAL_APK_URL) {
  const target = String(url || OFFICIAL_APK_URL);
  try {
    await CapApp.openUrl({ url: target });
  } catch {
    window.open(target, "_blank", "noopener,noreferrer");
  }
}
