const fs = require("node:fs");
const path = require("node:path");
const os = require("node:os");
const crypto = require("node:crypto");
const process = require("node:process");
const {parseCsv} = require("./refundCsv.cjs");
const {workbookRowToRecord} = require("./refundWorkbookSync.cjs");

const NAME = "Enphase_Care_Cancel_Refund_Request_Tracking.csv";
const SOURCE_FIELDS = [
  "submittedAt", "requestorName", "requestorEmail", "siteId", "subscriptionId", "customerName",
  "customerEmail", "caseNumber", "cancellationTiming", "refundChoice", "servicesCompleted",
  "customerEscalated", "refundReason", "otherReason", "additionalNotes", "refundAmountRequested", "refundType"
];

function mapSource(text, filename = NAME) {
  const rows = parseCsv(text);
  if (!rows.length) throw new Error("The refund CSV has no header.");
  const headers = rows[0];
  const required = [
    "Response ID", "Submitted at", "Responder name", "Responder email",
    "When should the Enphase Care plan be canceled?", "Is a refund also being requested?",
    "Refund amount requested", "Were any Enphase Care services completed?",
    "Is the customer escalated?", "Site ID", "Subscription ID", "Customer name",
    "Customer email address", "Case number", "Primary reason for the cancel and/or refund request",
    "Specify the cancellation/refund reason", "Detailed explanation of the refund request"
  ];
  const missing = required.filter((header) => !headers.includes(header));
  if (missing.length || new Set(headers).size !== headers.length) {
    throw new Error(`The refund CSV has missing or duplicate columns${missing.length ? `: ${missing.join(", ")}` : "."}`);
  }
  const seen = new Set();
  return rows.slice(1).map((cells, index) => {
    if (cells.length !== headers.length) throw new Error(`CSV row ${index + 2} has the wrong number of columns.`);
    const row = Object.fromEntries(headers.map((header, column) => [header, cells[column]]));
    const id = row["Response ID"].trim();
    if (!id || seen.has(id)) throw new Error(`CSV row ${index + 2} has a missing or duplicate response ID.`);
    seen.add(id);
    const amount = row["Refund amount requested"].trim();
    if (amount && (!Number.isFinite(Number(amount.replace(/[$,\s]/g, ""))) || Number(amount.replace(/[$,\s]/g, "")) < 0)) {
      throw new Error(`CSV row ${index + 2} has an invalid refund amount.`);
    }
    const choice = row["Is a refund also being requested?"].trim();
    const record = workbookRowToRecord({
      ...row,
      ID: `csv-${crypto.createHash("sha256").update(path.basename(filename).toLowerCase()).digest("hex").slice(0, 16)}-${id}`,
      "Completion time": row["Submitted at"],
      "Requester Name": row["Responder name"], "Requester Email": row["Responder email"],
      "Refund amount (USD)": amount,
      "Services completed": row["Were any Enphase Care services completed?"],
      'Add reason if the "Other" is selected': row["Specify the cancellation/refund reason"],
      "EnQuote Refund Type": choice === "Full refund" ? "Full Refund" : choice === "Partial refund" ? "Partial Refund" : null,
      Status: "Submitted"
    });
    if (!record.submittedAt) throw new Error(`CSV row ${index + 2} has an invalid submitted date.`);
    if (record.requestorEmail && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(record.requestorEmail)) {
      throw new Error(`CSV row ${index + 2} has an invalid responder email.`);
    }
    return record;
  });
}

function createRefundCsvSource({storageDir, getEmail, client, dialog, getMainWindow, onChanged = () => {}, logger = console, defaultPath}) {
  let timer = null, running = false, error = null, lastImportedAt = null;
  function configFile() {
    const email = String(getEmail() || "").trim().toLowerCase();
    if (!email) throw new Error("Sign in to EnQuote before importing the refund CSV.");
    return path.join(storageDir, `refund-source-${crypto.createHash("sha256").update(email).digest("hex")}.json`);
  }
  function configuredPath() {
    try {return JSON.parse(fs.readFileSync(configFile(), "utf8")).path;}
    catch (failure) {
      if (failure.code !== "ENOENT") throw failure;
      return defaultPath || path.join(
        process.env.OneDriveCommercial || process.env.OneDrive || path.join(os.homedir(), "OneDrive - Enphase Energy"),
        "O&M Excel Spreadsheets", NAME
      );
    }
  }
  function status() {
    const file = configuredPath();
    return {ok: true, path: file, available: fs.existsSync(file), watching: Boolean(timer), running, error, lastImportedAt};
  }
  async function select() {
    if (running) throw new Error("Wait for the current CSV import to finish.");
    const config = configFile();
    const result = await dialog.showOpenDialog(getMainWindow(), {
      title: "Select refund CSV report source", defaultPath: configuredPath(),
      properties: ["openFile"], filters: [{name: "CSV report", extensions: ["csv"]}]
    });
    if (result.canceled) return {ok: true, canceled: true};
    const file = result.filePaths[0];
    if (config !== configFile()) throw new Error("Your EnQuote account changed. Select the CSV again.");
    if (path.extname(file).toLowerCase() !== ".csv") throw new Error("Choose a CSV file.");
    read(file);
    fs.mkdirSync(storageDir, {recursive: true});
    fs.writeFileSync(`${config}.tmp`, JSON.stringify({path: file}), "utf8");
    fs.renameSync(`${config}.tmp`, config);
    error = null;
    lastImportedAt = null;
    return status();
  }
  function read(file) {
    const stat = fs.statSync(file);
    if (stat.size > 20 * 1024 * 1024) throw new Error("Refund CSV exceeds the 20 MB import limit.");
    return mapSource(fs.readFileSync(file, "utf8"), file);
  }
  async function sync() {
    if (running) throw new Error("A refund CSV import is already running.");
    running = true;
    try {
      const file = configuredPath(), account = configFile();
      const first = fs.statSync(file);
      // OneDrive can replace a file while downloading; require a stable size and timestamp.
      await new Promise((resolve) => setTimeout(resolve, 700));
      const second = fs.statSync(file);
      if (first.size !== second.size || first.mtimeMs !== second.mtimeMs) throw new Error("The CSV is still changing. Wait for OneDrive to finish and retry.");
      const records = read(file);
      const after = fs.statSync(file);
      if (after.size !== second.size || after.mtimeMs !== second.mtimeMs) throw new Error("The CSV changed during import. Retry after OneDrive finishes.");
      const remote = await client.get("/api/refund-requests");
      const existing = new Map(remote.requests.map((record) => [record.externalResponseId, record]));
      const imports = [], updates = [];
      for (const record of records) {
        const saved = existing.get(record.externalResponseId);
        if (!saved) imports.push(record);
        else {
          const changes = Object.fromEntries(SOURCE_FIELDS.filter((field) =>
            (saved[field] ?? null) !== (record[field] ?? null)
          ).map((field) => [field, record[field] ?? null]));
          if (Object.keys(changes).length) updates.push({externalResponseId: record.externalResponseId, expectedUpdatedAt: saved.lastUpdatedAt, changes});
        }
      }
      let imported = 0, updated = 0;
      while (imports.length || updates.length) {
        if (account !== configFile()) throw new Error("Your EnQuote account changed. Import stopped.");
        const result = await client.post("/api/refund-requests/workbook-sync", {
          imports: imports.splice(0, 200), updates: updates.splice(0, 200)
        });
        if (result.conflicts?.length) throw new Error("Some requests changed during CSV import. Retry to refresh those records.");
        imported += result.imported || 0;
        updated += result.updated || 0;
      }
      error = null;
      lastImportedAt = new Date().toISOString();
      onChanged(status());
      return {ok: true, imported, updated, ...status()};
    } catch (failure) {
      error = `Could not import refund CSV: ${failure.message}`;
      logger.error("[refund-csv-source]", error);
      onChanged({error, lastImportedAt});
      throw failure;
    } finally {running = false;}
  }
  function tick() {
    if (!running) sync().catch(() => {}); // sync already logs and publishes the failure.
  }
  function start() {
    if (timer) return;
    timer = setInterval(tick, 30_000);
    timer.unref?.();
    tick();
  }
  function stop() {clearInterval(timer); timer = null;}
  return {status, select, sync, start, stop};
}

module.exports = {createRefundCsvSource, mapSource};
