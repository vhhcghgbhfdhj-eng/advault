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
  const currentBuild = Number(current?.build);
  if (Number.isFinite(latestBuild) && Number.isFinite(currentBuild)) {
    return latestBuild > currentBuild;
  }
  return compareVersionNames(latest?.latestVersion ?? latest?.version, current?.version) > 0;
}

export async function checkNativeAppUpdate(adapters = {}) {
  const isNative = adapters.isNative || (() => (
    typeof Capacitor?.isNativePlatform === "function" && Capacitor.isNativePlatform()
  ));
  if (!isNative()) return null;

  const getInfo = adapters.getInfo || (() => CapApp.getInfo());
  const request = adapters.request || ((url) => CapacitorHttp.get({
    url,
    headers: { Accept: "application/json", "Cache-Control": "no-cache" }
  }));

  const info = await getInfo();
  const res = await request(`${APP_VERSION_URL}?t=${Date.now()}`);
  const status = Number(res?.status || 0);
  if (status < 200 || status >= 300) return null;

  let manifest = res?.data;
  if (typeof manifest === "string") {
    try { manifest = JSON.parse(manifest); } catch { return null; }
  }
  if (!manifest || typeof manifest !== "object") return null;
  if (!isNewerAppRelease(manifest, info)) return null;

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
