const fs = require("node:fs/promises");
const path = require("node:path");
const os = require("node:os");

function installationLocation(appPath, platform) {
  if (platform !== "darwin") return "not-macos";
  if (appPath.includes("/AppTranslocation/")) return "app-translocation";
  if (appPath.startsWith("/Volumes/")) return "mounted-disk-image";
  if (/^(\/Applications\/|\/Users\/[^/]+\/Applications\/)/.test(appPath)) return "applications-folder";
  return "other";
}

function createUpdateState({ now = () => new Date().toISOString() } = {}) {
  let state = null;
  let lastError = null;
  return {
    record(status, details = {}) {
      state = { ...details, status, at: now() };
      if (status === "error") lastError = { message: details.message, at: state.at };
    },
    get() {
      return state ? { ...state, lastError: lastError ? { ...lastError } : null } : null;
    }
  };
}

async function inspectRuntime({ app, hasIdentity, hasSyncCredentials, installerState, uiInfo }) {
  let storage;
  try {
    await fs.access(app.getPath("userData"), fs.constants.R_OK | fs.constants.W_OK);
    storage = { readableAndWritable: true };
  } catch (error) {
    storage = { readableAndWritable: false, error: error.code || error.message };
  }
  return {
    appVersion: app.getVersion(),
    platform: process.platform,
    architecture: process.arch,
    osRelease: os.release(),
    electronVersion: process.versions.electron || null,
    packaged: app.isPackaged,
    runningUnderARM64Translation: Boolean(app.runningUnderARM64Translation),
    installationLocation: installationLocation(app.getAppPath(), process.platform),
    storage,
    verifiedIdentityAvailable: Boolean(hasIdentity),
    syncCredentialsAvailable: Boolean(hasSyncCredentials),
    installerState,
    ui: uiInfo,
    macAutomaticUpdateRequirement: "Both the installed app and its replacement must be appropriately signed. This release workflow currently builds unsigned apps; use a manual replacement when automatic installation fails."
  };
}

// Reading the large-table bridge can migrate files. Inspect its fixed file directly instead.
async function inspectCareTable(userDataPath) {
  try {
    const raw = await fs.readFile(path.join(userDataPath, "large-tables", "care_subscriptions.json"), "utf8");
    const table = JSON.parse(raw);
    if (!Array.isArray(table.rows)) throw new Error("Care table rows are invalid.");
    return {
      present: true,
      rowCount: table.rows.length,
      updatedAt: table.updated_date || null,
      sharing: "Separate large-table files are local-only; Supervisor sync reads the main collections."
    };
  } catch (error) {
    if (error.code === "ENOENT") return { present: false, note: "No separate Care table; check the legacy collection summary." };
    return {
      present: null,
      error: error instanceof SyntaxError ? "Care table contains invalid JSON; the file was left unchanged." : error.code || error.message
    };
  }
}

module.exports = { installationLocation, createUpdateState, inspectRuntime, inspectCareTable };
