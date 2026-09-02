const APP_VERSION_URL = "https://advault-tt-landing.onrender.com/downloads/app-version.json";

let latestBuild = 1;
try {
  const res = await fetch(`${APP_VERSION_URL}?t=${Date.now()}`, {
    headers: { Accept: "application/json", "Cache-Control": "no-cache" }
  });
  if (res.ok) {
    const data = await res.json();
    const n = Number(data?.latestBuild ?? data?.build);
    if (Number.isFinite(n) && n >= 1) latestBuild = n;
  }
} catch {
  // Keep the known production baseline when the manifest cannot be read.
}

const code = latestBuild + 1;
const name = `1.0.${code}`;
process.stdout.write(`ADVAULT_VERSION_CODE=${code}\nADVAULT_VERSION_NAME=${name}\n`);
