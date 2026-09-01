import assert from "node:assert/strict";
import {
  APP_VERSION_URL,
  OFFICIAL_APK_URL,
  compareVersionNames,
  isNewerAppRelease,
  checkNativeAppUpdate
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

console.log("app-update checks passed");
