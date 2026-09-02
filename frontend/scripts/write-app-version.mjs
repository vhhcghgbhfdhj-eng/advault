import { writeFileSync } from "node:fs";

const OFFICIAL_APK_URL = "https://advault-tt-landing.onrender.com/downloads/advault-tt.apk";
const code = Number.parseInt(String(process.env.ADVAULT_VERSION_CODE || ""), 10);
const name = String(process.env.ADVAULT_VERSION_NAME || "").trim() || `1.0.${code}`;
const out = String(process.argv[2] || "").trim();

if (!Number.isInteger(code) || code < 1 || !out) {
  console.error("Usage: ADVAULT_VERSION_CODE=N ADVAULT_VERSION_NAME=1.0.N node write-app-version.mjs <path>");
  process.exit(1);
}

writeFileSync(out, `${JSON.stringify({
  latestVersion: name,
  latestBuild: code,
  apkUrl: OFFICIAL_APK_URL,
  optional: true
}, null, 2)}\n`);
console.log(`wrote ${out} latestBuild=${code} latestVersion=${name}`);
