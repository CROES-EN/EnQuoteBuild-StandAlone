const { Buffer } = require("node:buffer");
const crypto = require("node:crypto");
const fs = require("node:fs/promises");
const fsSync = require("node:fs");
const path = require("node:path");
const zlib = require("node:zlib");
const { promisify } = require("node:util");

const gunzip = promisify(zlib.gunzip);

// Over-the-air updates for the app's UI (the packaged `dist` folder) without a new installer.
//
// A published update is a signed manifest plus a gzip bundle of the built UI. The app only ever
// accepts an update whose manifest is signed with the private key kept by the publisher (the
// matching public key ships inside the app), and whose bundle matches the hash in that signed
// manifest - so the hosting location is not trusted. Updates are downloaded in the background,
// stored in their own folder, and used instead of the bundled UI when they match this installed
// app version. If an update ever fails to load it is marked bad and the bundled UI takes over.

const MAX_BUNDLE_BYTES = 60 * 1024 * 1024;
const MAX_FILE_COUNT = 2000;
const COMPLETE_MARKER = ".complete";

function parseAppVersion(value) {
  const match = /^(\d+)\.(\d+)\.(\d+)$/.exec(String(value ?? "").trim());
  return match ? match.slice(1).map(Number) : null;
}

function compareNumberLists(a, b) {
  for (let i = 0; i < Math.max(a.length, b.length); i += 1) {
    const diff = (a[i] ?? 0) - (b[i] ?? 0);
    if (diff !== 0) return diff < 0 ? -1 : 1;
  }
  return 0;
}

function compareAppVersions(a, b) {
  const left = parseAppVersion(a);
  const right = parseAppVersion(b);
  if (!left || !right) throw new Error(`Invalid app version: ${!left ? a : b}`);
  return compareNumberLists(left, right);
}

// "1.0.14+1790999999" = built from app 1.0.14, publish number 1790999999 (larger is newer).
function parseUiVersion(value) {
  const match = /^(\d+)\.(\d+)\.(\d+)\+(\d+)$/.exec(String(value ?? "").trim());
  return match ? match.slice(1).map(Number) : null;
}

function compareUiVersions(a, b) {
  const left = parseUiVersion(a);
  const right = parseUiVersion(b);
  if (!left || !right) throw new Error(`Invalid UI version: ${!left ? a : b}`);
  return compareNumberLists(left, right);
}

function safeRelativePath(value) {
  const text = String(value ?? "");
  if (!text || text.length > 300 || text.includes("\\") || text.includes("\0") || text.startsWith("/") || /^[a-zA-Z]:/.test(text)) {
    throw new Error(`Unsafe path in UI bundle: ${text}`);
  }
  const normalized = path.posix.normalize(text);
  if (normalized.startsWith("..") || normalized.split("/").includes("..") || normalized === ".") {
    throw new Error(`Unsafe path in UI bundle: ${text}`);
  }
  return normalized;
}

function sha256Hex(buffer) {
  return crypto.createHash("sha256").update(buffer).digest("hex");
}

// Verifies the signed envelope { payload: "<json string>", signature: "<base64>" } and returns
// the parsed, validated manifest. Throws on a bad signature or malformed fields.
function verifyManifest(envelope, publicKeyPem) {
  if (typeof envelope?.payload !== "string" || typeof envelope?.signature !== "string") {
    throw new Error("Malformed UI update manifest.");
  }
  const valid = crypto.verify(null, Buffer.from(envelope.payload), publicKeyPem, Buffer.from(envelope.signature, "base64"));
  if (!valid) throw new Error("UI update manifest signature is invalid.");
  const manifest = JSON.parse(envelope.payload);
  if (!parseUiVersion(manifest.uiVersion) || !parseAppVersion(manifest.baseAppVersion) || !parseAppVersion(manifest.minAppVersion)) {
    throw new Error("UI update manifest has invalid versions.");
  }
  if (!/^[0-9a-f]{64}$/.test(String(manifest.bundleSha256 ?? "")) || !Number.isInteger(manifest.bundleSize) || manifest.bundleSize <= 0) {
    throw new Error("UI update manifest has an invalid bundle description.");
  }
  return manifest;
}

function createUiUpdater({
  userDataPath,
  appVersion,
  publicKeyPem,
  workerUrl,
  getToken = () => "",
  getAccessHeaders = () => ({}),
  getChannel = () => "stable",
  fetchImpl = globalThis.fetch,
  logger = console
}) {
  const root = path.join(userDataPath, "ui-updates");
  const statePath = path.join(root, "state.json");
  let checking = null;

  function readState() {
    try {
      const parsed = JSON.parse(fsSync.readFileSync(statePath, "utf8"));
      return { current: parsed.current || null, bad: Array.isArray(parsed.bad) ? parsed.bad : [] };
    } catch {
      return { current: null, bad: [] };
    }
  }

  function writeState(state) {
    fsSync.mkdirSync(root, { recursive: true });
    const temp = `${statePath}.tmp`;
    fsSync.writeFileSync(temp, JSON.stringify(state), "utf8");
    fsSync.renameSync(temp, statePath);
  }

  function entryFor(current) {
    const dir = path.join(root, current.uiVersion);
    const indexPath = path.join(dir, "index.html");
    if (!fsSync.existsSync(path.join(dir, COMPLETE_MARKER)) || !fsSync.existsSync(indexPath)) return null;
    return { indexPath, uiVersion: current.uiVersion, notes: current.notes || "" };
  }

  // The downloaded UI to load instead of the bundled one, or null. Only an update built from
  // exactly this installed app version is used, so a newer installer's own UI always wins.
  function resolveEntry() {
    const { current, bad } = readState();
    if (!current || bad.includes(current.uiVersion)) return null;
    try {
      if (compareAppVersions(current.baseAppVersion, appVersion) !== 0) return null;
    } catch {
      return null;
    }
    return entryFor(current);
  }

  // After the installer itself updates, any downloaded UI built for the old version is dead
  // weight (the new installer's own UI always wins) - remove it.
  function cleanupStale() {
    const { current } = readState();
    if (!current) return false;
    try {
      if (compareAppVersions(current.baseAppVersion, appVersion) === 0) return false;
    } catch {
      // Unreadable version: treat as stale.
    }
    fsSync.rmSync(root, { recursive: true, force: true });
    return true;
  }

  function markBad(uiVersion, reason = "") {
    const state = readState();
    if (!state.bad.includes(uiVersion)) state.bad.push(uiVersion);
    if (state.current?.uiVersion === uiVersion) state.current = null;
    writeState(state);
    logger.warn(`[ui-update] UI ${uiVersion} marked bad${reason ? ` (${reason})` : ""}; using the bundled UI.`);
  }

  async function fetchJson(route) {
    const response = await fetchImpl(new URL(route, workerUrl), {
      headers: { Authorization: `Bearer ${getToken()}`, ...getAccessHeaders() },
      signal: AbortSignal.timeout(30 * 1000)
    });
    let body = null;
    try { body = await response.json(); } catch { /* handled below */ }
    if (!response.ok || !body?.ok) throw new Error(body?.error || `UI update server responded with HTTP ${response.status}.`);
    return body;
  }

  async function downloadBundle(manifest) {
    const response = await fetchImpl(new URL(`/api/ui/bundle?sha=${manifest.bundleSha256}`, workerUrl), {
      headers: { Authorization: `Bearer ${getToken()}`, ...getAccessHeaders() },
      signal: AbortSignal.timeout(120 * 1000)
    });
    if (!response.ok) throw new Error(`UI bundle download responded with HTTP ${response.status}.`);
    const bytes = Buffer.from(await response.arrayBuffer());
    if (bytes.length > MAX_BUNDLE_BYTES || bytes.length !== manifest.bundleSize) throw new Error("UI bundle size does not match the signed manifest.");
    if (sha256Hex(bytes) !== manifest.bundleSha256) throw new Error("UI bundle hash does not match the signed manifest.");
    return bytes;
  }

  async function extract(manifest, gzBytes) {
    const bundle = JSON.parse((await gunzip(gzBytes, { maxOutputLength: 200 * 1024 * 1024 })).toString("utf8"));
    const entries = Object.entries(bundle?.files || {});
    if (entries.length === 0 || entries.length > MAX_FILE_COUNT) throw new Error("UI bundle has an unexpected number of files.");
    if (!bundle.files["index.html"]) throw new Error("UI bundle has no index.html.");

    const finalDir = path.join(root, manifest.uiVersion);
    const partial = `${finalDir}.partial-${Date.now()}`;
    await fs.rm(partial, { recursive: true, force: true });
    try {
      for (const [relative, base64] of entries) {
        const safe = safeRelativePath(relative);
        const target = path.join(partial, ...safe.split("/"));
        await fs.mkdir(path.dirname(target), { recursive: true });
        await fs.writeFile(target, Buffer.from(String(base64), "base64"));
      }
      await fs.writeFile(path.join(partial, COMPLETE_MARKER), manifest.uiVersion, "utf8");
      await fs.rm(finalDir, { recursive: true, force: true });
      await fs.rename(partial, finalDir);
    } catch (error) {
      await fs.rm(partial, { recursive: true, force: true }).catch(() => {});
      throw error;
    }
  }

  async function prune(keepVersion) {
    let names = [];
    try { names = await fs.readdir(root); } catch { return; }
    for (const name of names) {
      if (name === "state.json" || name === keepVersion) continue;
      await fs.rm(path.join(root, name), { recursive: true, force: true }).catch(() => {});
    }
  }

  async function runCheck() {
    if (!getToken()) return { updated: false, reason: "no-credentials" };
    const channel = getChannel() === "beta" ? "beta" : "stable";
    const { manifest: envelope } = await fetchJson(`/api/ui/manifest?channel=${channel}`);
    if (!envelope) return { updated: false, reason: "none-published" };

    const manifest = verifyManifest(envelope, publicKeyPem);
    if (compareAppVersions(manifest.baseAppVersion, appVersion) !== 0) return { updated: false, reason: "different-app-version" };
    if (compareAppVersions(appVersion, manifest.minAppVersion) < 0) return { updated: false, reason: "app-too-old" };

    const state = readState();
    if (state.bad.includes(manifest.uiVersion)) return { updated: false, reason: "marked-bad" };
    if (state.current && compareUiVersions(manifest.uiVersion, state.current.uiVersion) <= 0) return { updated: false, reason: "up-to-date" };

    const gzBytes = await downloadBundle(manifest);
    await extract(manifest, gzBytes);
    writeState({
      current: { uiVersion: manifest.uiVersion, baseAppVersion: manifest.baseAppVersion, notes: manifest.notes || "" },
      bad: state.bad
    });
    await prune(manifest.uiVersion);
    logger.info(`[ui-update] Downloaded UI ${manifest.uiVersion}.`);
    return { updated: true, uiVersion: manifest.uiVersion, notes: manifest.notes || "" };
  }

  function check() {
    if (checking) return checking;
    checking = runCheck()
      .catch((error) => {
        logger.warn("[ui-update] Check failed (the current UI keeps running):", error.message);
        return { updated: false, reason: "error", error: error.message };
      })
      .finally(() => { checking = null; });
    return checking;
  }

  return {
    check,
    resolveEntry,
    cleanupStale,
    markBad,
    getInfo: () => ({ appVersion, uiVersion: resolveEntry()?.uiVersion || null })
  };
}

module.exports = {
  createUiUpdater,
  verifyManifest,
  compareAppVersions,
  compareUiVersions,
  parseUiVersion,
  safeRelativePath,
  sha256Hex
};
