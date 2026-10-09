const { execFile } = require("node:child_process");
const { Buffer } = require("node:buffer");
const fs = require("node:fs");
const path = require("node:path");
const process = require("node:process");
const { promisify } = require("node:util");
const { WORKBOOK_FIELDS, buildSyncPlan, recordToWorkbookRow, workbookRowToRecord } = require("./refundWorkbookSync.cjs");

const execFileAsync = promisify(execFile);
const MODULE_DIR = path.dirname(require.resolve("./refundWorkbook.cjs"));
const WORKBOOK_NAME = "EnQuote_Care_Refund_Tracker.xlsx";
const CONFIG_NAME = "refund-workbook.json";
const SYNC_STATE_NAME = "refund-workbook-sync.json";
const MAX_BUFFER = 8 * 1024 * 1024;

function insideDirectory(targetPath, directoryPath) {
  const relative = path.relative(path.resolve(directoryPath), path.resolve(targetPath));
  return relative !== "" && !relative.startsWith(`..${path.sep}`) && relative !== ".." && !path.isAbsolute(relative);
}

function createRefundWorkbook({
  storageDir,
  getEmail,
  getOneDriveEmail,
  client,
  runWorkbook,
  logger = console
}) {
  const configPath = path.join(storageDir, CONFIG_NAME);
  const syncStatePath = path.join(storageDir, SYNC_STATE_NAME);
  const scriptPath = path.join(MODULE_DIR, "refundWorkbook.ps1");
  let operationQueue = Promise.resolve();

  function queued(operation) {
    const result = operationQueue.then(operation);
    operationQueue = result.catch(() => {});
    return result;
  }

  function readConfig() {
    try {
      const config = JSON.parse(fs.readFileSync(configPath, "utf8"));
      return typeof config.path === "string" ? config : null;
    } catch (error) {
      if (error.code === "ENOENT") return null;
      throw new Error(`Could not read the refund workbook settings: ${error.message}`);
    }
  }

  function isValidConfiguredPath(targetPath) {
    const oneDrivePath = process.env.OneDriveCommercial || process.env.OneDrive;
    return Boolean(oneDrivePath && insideDirectory(targetPath, oneDrivePath) &&
      path.extname(targetPath).toLocaleLowerCase() === ".xlsx");
  }

  async function activeOneDriveEmail() {
    if (getOneDriveEmail) return String(await getOneDriveEmail() || "").trim().toLocaleLowerCase();
    let result;
    try {
      result = await execFileAsync("powershell.exe", [
        "-NoLogo",
        "-NoProfile",
        "-NonInteractive",
        "-Command",
        "$rootPath = if ($env:OneDriveCommercial) { $env:OneDriveCommercial } else { $env:OneDrive }; " +
          "$root = [IO.Path]::GetFullPath($rootPath); " +
          "$accountEmails = Get-ChildItem 'HKCU:\\Software\\Microsoft\\OneDrive\\Accounts' -ErrorAction SilentlyContinue | " +
          "ForEach-Object { $account = Get-ItemProperty $_.PSPath; " +
          "if ($account.UserFolder -and [IO.Path]::GetFullPath([string]$account.UserFolder) -ieq $root) { [string]$account.UserEmail } }; " +
          "$accountEmails | Select-Object -First 1"
      ], { windowsHide: true, timeout: 10_000 });
    } catch (error) {
      logger.error?.("[refund-workbook] Could not verify the OneDrive account:", error.message);
      throw new Error("Could not verify the signed-in OneDrive account. Sign in to OneDrive and try again.");
    }
    return result.stdout.trim().toLocaleLowerCase();
  }

  async function verifyOneDriveIdentity() {
    const expectedEmail = String(getEmail?.() || "").trim().toLocaleLowerCase();
    if (!expectedEmail) throw new Error("Sign in to EnQuote with the account that has refund-processing access.");
    const oneDriveEmail = await activeOneDriveEmail();
    if (!oneDriveEmail || oneDriveEmail !== expectedEmail) {
      throw new Error("Sign in to both EnQuote and OneDrive with the same work account that has refund-processing and workbook edit access.");
    }
    return true;
  }

  function readSyncState() {
    try {
      const state = JSON.parse(fs.readFileSync(syncStatePath, "utf8"));
      return {
        baseline: state.baseline && typeof state.baseline === "object" ? state.baseline : {},
        conflicts: Array.isArray(state.conflicts) ? state.conflicts : [],
        serverConflicts: Array.isArray(state.serverConflicts) ? state.serverConflicts : [],
        invalidRows: Array.isArray(state.invalidRows) ? state.invalidRows : [],
        lastSyncedAt: state.lastSyncedAt || null
      };
    } catch (error) {
      if (error.code === "ENOENT") return { baseline: {}, conflicts: [], serverConflicts: [], invalidRows: [], lastSyncedAt: null };
      throw new Error(`Could not read refund workbook sync state: ${error.message}`);
    }
  }

  function writeSyncState(state) {
    fs.mkdirSync(storageDir, { recursive: true });
    const temporaryPath = `${syncStatePath}.tmp`;
    fs.writeFileSync(temporaryPath, JSON.stringify(state, null, 2), "utf8");
    fs.renameSync(temporaryPath, syncStatePath);
  }

  async function run(operation, workbookPath, payload) {
    const encodedPayload = payload === undefined
      ? ""
      : Buffer.from(JSON.stringify(payload), "utf8").toString("base64");
    let result;
    try {
      result = await execFileAsync("powershell.exe", [
        "-NoLogo",
        "-NoProfile",
        "-NonInteractive",
        "-ExecutionPolicy",
        "Bypass",
        "-File",
        scriptPath,
        "-Operation",
        operation,
        "-WorkbookPath",
        workbookPath,
        "-Payload",
        encodedPayload
      ], { windowsHide: true, maxBuffer: MAX_BUFFER, timeout: 45_000 });
    } catch (error) {
      logger.error?.("[refund-workbook] Excel automation failed:", error.stderr?.trim() || error.code || "unknown error");
      const stage = error.stderr?.match(/failed during (open|update|save|publish):/)?.[1];
      if (stage === "publish") {
        throw new Error("Could not publish the Excel update to the shared tracker. The file changed, is locked, or is not writable. Newer edits were not overwritten. Wait for OneDrive, sync again, and retry.");
      }
      throw new Error(`Could not ${stage === "save" ? "save" : stage === "update" ? "update" : "open"} the synced workbook. Close it in Excel, wait for OneDrive to finish syncing, and verify edit access, then retry.`);
    }

    let response;
    try {
      response = JSON.parse(result.stdout.trim());
    } catch {
      logger.error?.("[refund-workbook] Excel automation returned an invalid result.");
      throw new Error("Excel returned an invalid response while syncing the refund workbook.");
    }
    if (!response.ok || !Array.isArray(response.rows) || !Array.isArray(response.headers)) {
      throw new Error("Excel did not return a valid refund workbook table.");
    }
    return response;
  }

  const execute = runWorkbook || run;

  async function select() {
    return status();
  }

  async function sharedConfig() {
    await verifyOneDriveIdentity();
    let config = readConfig();
    const oneDrivePath = process.env.OneDriveCommercial || process.env.OneDrive;
    const sharedPath = oneDrivePath && [
      "Care - Cancel requests",
      "Customer Financing and O&M Marketplace - Care - Cancel requests"
    ].map((folder) => path.join(oneDrivePath, folder, WORKBOOK_NAME)).find((candidate) => fs.existsSync(candidate));
    if (!sharedPath) {
      throw new Error(`Waiting for OneDrive to download ${WORKBOOK_NAME} from the shared Care - Cancel requests folder. Check that the folder shortcut is synced with your work account. EnQuote retries automatically.`);
    }
    if (!config || path.resolve(config.path) !== path.resolve(sharedPath)) {
      const inspected = await execute("read", sharedPath);
      if (inspected.tableName !== "Table2" || !inspected.headers.includes("ID")) {
        throw new Error("The shared tracker does not contain Table2 with an ID column.");
      }
      if (config) {
        writeSyncState({baseline: {}, conflicts: [], serverConflicts: [], invalidRows: [], lastSyncedAt: null});
      }
      config = {path: sharedPath, selectedAt: new Date().toISOString()};
      fs.mkdirSync(storageDir, {recursive: true});
      fs.writeFileSync(configPath, JSON.stringify(config), "utf8");
    }
    return config;
  }

  async function status() {
    let config;
    try {
      config = await sharedConfig();
    } catch (error) {
      return { ok: false, configured: false, error: error.message };
    }
    return {
      ok: true,
      configured: true,
      path: config.path,
      selectedAt: config.selectedAt || null
    };
  }

  async function read() {
    const config = await sharedConfig();
    if (!isValidConfiguredPath(config.path) || !fs.existsSync(config.path)) {
      throw new Error("The configured workbook is no longer available in this OneDrive folder.");
    }
    return execute("read", config.path);
  }

  async function write(rows, expectedPath, options = {}) {
    const config = await sharedConfig();
    if (expectedPath && path.resolve(config.path) !== path.resolve(expectedPath)) {
      throw new Error("The connected workbook changed. Reconnect the original destination before retrying.");
    }
    if (!isValidConfiguredPath(config.path) || !fs.existsSync(config.path)) {
      throw new Error("The configured workbook is no longer available in this OneDrive folder.");
    }
    if (!Array.isArray(rows)) throw new Error("The refund workbook update must contain a row list.");
    return execute("write", config.path, { rows, ...options });
  }

  async function sync() {
    if (!client) throw new Error("Refund request sync is not available.");
    const access = await client.post("/api/refund-requests/workbook-sync", {imports: [], updates: []});
    if (!access?.ok) throw new Error(access?.error || "Refund-processing access is required.");
    const [workbook, remote] = await Promise.all([
      read(),
      client.get("/api/refund-requests")
    ]);
    const state = readSyncState();
    const plan = buildSyncPlan(workbook.rows, remote.requests, state.baseline, remote.deletedExternalResponseIds);
    if (plan.invalidRows.length) {
      const nextState = { ...state, invalidRows: plan.invalidRows };
      writeSyncState(nextState);
      const details = plan.invalidRows.map((row) =>
        `table row ${row.tableRow}: ${row.reason === "missing_response_id" ? "missing ID" : `duplicate ID ${row.externalResponseId}`}`
      ).join("; ");
      throw new Error(`The workbook has invalid response IDs (${details}). Correct them before syncing.`);
    }

    let serverConflicts = [];
    let deleted = 0;
    if (plan.imports.length || plan.updates.length || plan.deletions.length) {
      const result = await client.post("/api/refund-requests/workbook-sync", {
        imports: plan.imports,
        updates: plan.updates,
        deletions: plan.deletions
      });
      serverConflicts = result.conflicts || [];
      deleted = result.deleted || 0;
    }
    const serverConflictIds = new Set(serverConflicts.map((conflict) => conflict.externalResponseId));
    const latest = await client.get("/api/refund-requests");
    const latestById = new Map(latest.requests.map((request) => [request.externalResponseId, request]));
    const importedRows = plan.imports
      .filter((record) => !serverConflictIds.has(record.externalResponseId))
      .map((record) => {
        const saved = latestById.get(record.externalResponseId);
        const existing = workbook.rows.find((row) => String(row.ID || "").trim() === record.externalResponseId) || {};
        return saved ? recordToWorkbookRow(saved, existing) : null;
      })
      .filter(Boolean);
    const safeRows = plan.writeRows.filter((row) => !serverConflictIds.has(String(row.ID)));
    const rowsToWrite = [...safeRows, ...importedRows];
    const deletedIds = new Set(latest.deletedExternalResponseIds || []);
    const deleteRows = workbook.rows.map((row) => String(row.ID || "").trim()).filter((id) => deletedIds.has(id));
    const validRows = rowsToWrite.filter((row) => !deletedIds.has(String(row.ID)));
    if (validRows.length || deleteRows.length) {
      await write(validRows, undefined, {deleteIds: deleteRows, expectedHash: workbook.sourceHash});
    }

    const blockedIds = new Set([
      ...plan.conflicts.map((conflict) => conflict.externalResponseId),
      ...serverConflictIds
    ]);
    const baseline = { ...state.baseline };
    for (const id of Object.keys(baseline)) {
      if (!latestById.has(id)) delete baseline[id];
    }
    for (const request of latest.requests) {
      if (blockedIds.has(request.externalResponseId)) continue;
      baseline[request.externalResponseId] = Object.fromEntries(WORKBOOK_FIELDS.map((field) => [field, request[field] ?? null]));
    }
    const conflicts = plan.conflicts.map((conflict) => ({
      ...conflict,
      updatedAt: latestById.get(conflict.externalResponseId)?.lastUpdatedAt || null
    }));
    const nextState = {
      baseline,
      conflicts,
      serverConflicts,
      invalidRows: [],
      lastSyncedAt: new Date().toISOString()
    };
    writeSyncState(nextState);
    return {
      ok: true,
      imported: plan.imports.length,
      updated: plan.updates.length - serverConflicts.length,
      written: validRows.length,
      deleted,
      conflicts,
      serverConflicts,
      invalidRows: []
    };
  }

  async function resolveConflict(externalResponseId, field, choice) {
    if (!client) throw new Error("Refund request sync is not available.");
    if (!["workbook", "enquote"].includes(choice)) throw new Error("Choose either the workbook or EnQuote value.");
    const state = readSyncState();
    const conflict = state.conflicts.find((item) =>
      item.externalResponseId === externalResponseId && item.field === field
    );
    if (!conflict) throw new Error("This conflict is no longer pending. Sync again to refresh it.");
    const [workbook, remote] = await Promise.all([
      read(),
      client.get("/api/refund-requests")
    ]);
    const currentRequest = remote.requests.find((request) => request.externalResponseId === externalResponseId);
    const currentRow = workbook.rows.find((row) => String(row.ID || "").trim() === externalResponseId);
    if (!currentRequest || !currentRow || currentRequest.lastUpdatedAt !== conflict.updatedAt) {
      throw new Error("The request changed since this conflict was detected. Sync again before resolving it.");
    }
    const currentWorkbookRecord = workbookRowToRecord(currentRow);
    if (!currentWorkbookRecord || currentWorkbookRecord[field] !== conflict.workbookValue) {
      throw new Error("The workbook value changed since this conflict was detected. Sync again before resolving it.");
    }
    if (choice === "workbook") {
      await client.post("/api/refund-requests/workbook-sync", {
        imports: [],
        updates: [{
          externalResponseId,
          expectedUpdatedAt: currentRequest.lastUpdatedAt,
          changes: { [field]: conflict.workbookValue }
        }]
      });
    }
    const updatedRemote = await client.get("/api/refund-requests");
    const selectedRequest = updatedRemote.requests.find((request) => request.externalResponseId === externalResponseId);
    if (!selectedRequest) throw new Error("The refund request is no longer available.");
    const workbookRecord = workbookRowToRecord(currentRow);
    await write([recordToWorkbookRow({
      ...selectedRequest,
      ...workbookRecord,
      [field]: selectedRequest[field]
    }, currentRow)]);
    return sync();
  }

  function syncStatus() {
    const state = readSyncState();
    return {
      ok: true,
      conflicts: state.conflicts,
      serverConflicts: state.serverConflicts,
      invalidRows: state.invalidRows,
      lastSyncedAt: state.lastSyncedAt
    };
  }

  return {
    select: () => queued(select), status: () => queued(status), read: () => queued(read),
    write: (rows, expectedPath, options) => queued(() => write(rows, expectedPath, options)), sync: () => queued(sync), syncStatus,
    resolveConflict: (...args) => queued(() => resolveConflict(...args))
  };
}

module.exports = { createRefundWorkbook, insideDirectory };
