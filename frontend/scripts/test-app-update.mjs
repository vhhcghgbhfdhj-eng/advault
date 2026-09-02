import assert from "node:assert/strict";
import {
  APP_VERSION_URL,
  OFFICIAL_APK_URL,
  compareVersionNames,
  isNewerAppRelease,
  checkNativeAppUpdate,
  formatDownloadProgress,
  openOfficialApk
} from "../src/appUpdate.mjs";

assert.equal(OFFICIAL_APK_URL, "https://advault-tt-landing.onrender.com/downloads/advault-tt.apk");
assert.equal(APP_VERSION_URL, "https://advault-tt-landing.onrender.com/downloads/app-version.json");
assert.equal(compareVersionNames("1.0.1", "1.0"), 1);
assert.equal(compareVersionNames("1.0", "1.0.1"), -1);
assert.equal(compareVersionNames("1.0", "1.0"), 0);
assert.equal(isNewerAppRelease({ latestBuild: 2, latestVersion: "1.0.1" }, { build: "1", version: "1.0" }), true);
assert.equal(isNewerAppRelease({ latestBuild: 1, latestVersion: "9.0" }, { build: "1", version: "1.0" }), false);
assert.equal(isNewerAppRelease({ latestBuild: 1, latestVersion: "1.0" }, { build: "1", version: "1.0" }), false);
assert.equal(isNewerAppRelease({ latestVersion: "1.0.1" }, { version: "1.0" }), true);

const skipped = await checkNativeAppUpdate({ isNative: () => false });
assert.equal(skipped, null);

const same = await checkNativeAppUpdate({
  isNative: () => true,
  getInfo: async () => ({ version: "1.0", build: "1" }),
  request: async () => ({ status: 200, data: { latestVersion: "1.0", latestBuild: 1, optional: true, apkUrl: OFFICIAL_APK_URL } })
});
assert.equal(same, null);

const pending = await checkNativeAppUpdate({
  isNative: () => true,
  getInfo: async () => ({ version: "1.0", build: "1" }),
  request: async () => ({ status: 200, data: { latestVersion: "1.0.1", latestBuild: 2, optional: true, apkUrl: OFFICIAL_APK_URL } })
});
assert.equal(pending.latestVersion, "1.0.1");
assert.equal(pending.apkUrl, OFFICIAL_APK_URL);
assert.equal(pending.optional, true);

const failed = await checkNativeAppUpdate({
  isNative: () => true,
  getInfo: async () => ({ version: "1.0", build: "1" }),
  request: async () => ({ status: 404, data: "" })
});
assert.equal(failed, null);

const missingInfo = await checkNativeAppUpdate({
  isNative: () => true,
  getInfo: async () => { throw new Error("plugin"); },
  request: async () => ({ status: 200, data: { latestVersion: "1.0.3", latestBuild: 3, optional: true, apkUrl: OFFICIAL_APK_URL } })
});
assert.equal(missingInfo.latestVersion, "1.0.3");

const byVersionCode = await checkNativeAppUpdate({
  isNative: () => true,
  getInfo: async () => ({ version: "1.0", versionCode: 1 }),
  request: async () => ({ status: 200, data: { latestVersion: "1.0.3", latestBuild: 3, optional: true, apkUrl: OFFICIAL_APK_URL } })
});
assert.equal(byVersionCode.latestVersion, "1.0.3");

const alreadyLatest = await checkNativeAppUpdate({
  isNative: () => true,
  getInfo: async () => ({ version: "1.0.3", build: "3" }),
  request: async () => ({ status: 200, data: { latestVersion: "1.0.3", latestBuild: 3, optional: true, apkUrl: OFFICIAL_APK_URL } })
});
assert.equal(alreadyLatest, null);

assert.equal(formatDownloadProgress(3690988, 3690988), "3.52 / 3.52 MB");
assert.equal(formatDownloadProgress(1024 * 1024, 0), "1.00 MB");

let installed = "";
let lastPhase = "";
await openOfficialApk(OFFICIAL_APK_URL, {
  isNative: () => true,
  install: async (url, onProgress) => {
    installed = url;
    onProgress?.({ received: 3512320, total: 3512320, phase: "downloading" });
    onProgress?.({ received: 3512320, total: 3512320, phase: "installing" });
    lastPhase = "installing";
  },
  onProgress: (event) => { lastPhase = event.phase; }
});
assert.equal(installed, OFFICIAL_APK_URL);
assert.equal(lastPhase, "installing");

let nativeInstallCalled = false;
await openOfficialApk(OFFICIAL_APK_URL, {
  isNative: () => true,
  installer: {
    addListener: async (_name, cb) => {
      cb({ received: 100, total: 100, phase: "downloading" });
      return { remove: async () => {} };
    },
    downloadAndInstall: async ({ url }) => {
      nativeInstallCalled = url === OFFICIAL_APK_URL;
    }
  }
});
assert.equal(nativeInstallCalled, true);

console.log("app-update checks passed");
