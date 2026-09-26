/**
 * Zero-click auto-import for the 7 EODB Dashboard / Pronto Metrics Dashboard report types
 * (5 EODB call-metric widgets + 2 email widgets) - a DELIBERATELY SEPARATE system from
 * autoImportWatcher.js/the existing "O&M Reports Inbox", per explicit design decision this
 * session: the existing watcher's own code comment confirms EODB/Incorta exports are
 * intentionally hard-blocked from it (a real, previously-confirmed data-corruption bug -
 * a Wait Time column summed instead of averaged), and that system's daily-aggregate pipeline
 * (opsMetricsStore.js) has no path into supervisorReportTables anyway, where these 7 report
 * types actually live. This module reuses the SAME proven, already-safe save path the manual
 * "Import This Report" dialog uses (saveReportTable(), from importedTableStore.js) - never a
 * new/parallel save mechanism - and the same readWorkbookFromBytes() file-reading utility
 * already proven correct for the existing watcher.
 *
 * Unlike the existing always-on inbox, this watcher is genuinely START/STOP-ABLE and
 * per-user configurable (see autoImportSettings.js) - it only runs while a specific,
 * user-chosen folder is set AND the user has turned Auto-Import on, and is wired up (see
 * Layout.jsx) to start/stop live as that setting changes, without requiring an app restart.
 *
 * Classification is filename-based, reusing the EXACT SAME recognition substrings already
 * proven in importValidation.js's FILENAME_OVERRIDE_BY_TYPE ("EODB Dashboard" / "Pronto
 * Metrics Dashboard"), plus a per-widget name match to pick the correct one of 5 EODB report
 * types or 2 email report types. Weekly/Quarterly Email Volume & AHT are deliberately NOT
 * recognized here (confirmed this session to be redundant re-aggregations of Daily data, not
 * new information) - files matching those are left untouched in the watched folder, not moved
 * or imported, exactly like a genuinely unrecognized file.
 */

import {readWorkbookFromBytes} from "@/features/supervisorDashboard/reportParsing";
import {saveReportTableWithRetry} from "@/features/supervisorDashboard/saveReportTableWithRetry";

const EODB_WIDGET_RULES = [
  { match: /total call volume/i, reportType: "eodb_total_call_volume" },
  { match: /#\s*abandoned calls/i, reportType: "eodb_abandoned_calls" },
  { match: /abandonment rate/i, reportType: "eodb_abandonment_rate" },
  { match: /daily wait time summary/i, reportType: "eodb_daily_wait_time" },
  { match: /average talk time/i, reportType: "eodb_avg_talk_time" },
  // Hourly Wait Time Summary is a SEPARATE widget from the regular EODB dashboard - broken
  // down hourly, does not share data with any other EODB report (per explicit instruction).
  // Does not conflict with the "daily wait time summary" rule above (requires the literal
  // word "daily", which this filename never contains).
  { match: /hourly wait time summary/i, reportType: "eodb_hourly_wait_time" }
];

const EMAIL_WIDGET_RULES = [
  { match: /daily email volume/i, reportType: "email_daily" },
  { match: /email raw data/i, reportType: "email_cases" }
];

/**
 * @param {string} filename
 * @returns {{ recognized: boolean, reportType: string|null, destinationSubfolder: "Calls"|"Emails"|null }}
 */
export function classifyEodbEmailFile(filename) {
  const isEodb = /eodb dashboard/i.test(filename);
  const isEmail = /pronto metrics dashboard/i.test(filename);

  if (isEodb) {
    const widgetRule = EODB_WIDGET_RULES.find((rule) => rule.match.test(filename));
    return {
      recognized: Boolean(widgetRule),
      reportType: widgetRule?.reportType ?? null,
      destinationSubfolder: "Calls"
    };
  }
  if (isEmail) {
    const widgetRule = EMAIL_WIDGET_RULES.find((rule) => rule.match.test(filename));
    return {
      recognized: Boolean(widgetRule),
      reportType: widgetRule?.reportType ?? null,
      destinationSubfolder: "Emails"
    };
  }
  return { recognized: false, reportType: null, destinationSubfolder: null };
}

function base64ToBytes(base64) {
  const binaryString = atob(base64);
  const bytes = new Uint8Array(binaryString.length);
  for (let i = 0; i < binaryString.length; i++) {
    bytes[i] = binaryString.charCodeAt(i);
  }
  return bytes;
}

/**
 * Reads a file's raw bytes into the same { columns, rows } shape ImportAsTableDialog.jsx
 * saves via saveReportTable() - always the FIRST sheet (index 0), which is confirmed (via
 * direct inspection of real EODB exports this session) to be the "Pivot" layout
 * parseEodbWidget.js's Grand-Total-row-search logic expects, not the second "Detail" sheet.
 */
// Converts a PST hour+date pair (from Hourly Wait Time Summary's "Detail" sheet) into an
// MST hour+date, by adding a flat +1 hour offset. US Pacific and Mountain time move on the
// same DST schedule, so a flat +1 hour stays correct year-round PROVIDED the source "PST"
// column is genuine DST-observing US Pacific Time (not a fixed, non-DST offset) - please
// confirm this against the Incorta export if the displayed hours ever look off by exactly
// one more hour than expected. Hour 23 PST correctly rolls into hour 0 MST of the NEXT date.
function parseFlexibleDate(value) {
  if (value instanceof Date) return value;
  if (typeof value === "number") {
    // Excel serial date (days since 1899-12-30), standard JS conversion.
    return new Date(Math.round((value - 25569) * 86400 * 1000));
  }
  if (typeof value === "string" && value.trim()) {
    const parsed = new Date(value);
    if (!Number.isNaN(parsed.getTime())) return parsed;
  }
  return null;
}

function convertPstToMst(pstHourRaw, pstDateRaw) {
  const pstHour = Number(pstHourRaw);
  const pstDate = parseFlexibleDate(pstDateRaw);
  if (!Number.isFinite(pstHour) || !pstDate) {
    return { mstHour: null, mstDate: null };
  }
  // Anchor the hour onto the date's own UTC calendar day (avoids local-timezone drift from
  // the machine running this code), then add the +1 hour PST->MST offset.
  const anchored = new Date(Date.UTC(pstDate.getUTCFullYear(), pstDate.getUTCMonth(), pstDate.getUTCDate(), pstHour));
  const mst = new Date(anchored.getTime() + 60 * 60 * 1000);
  return {
    mstHour: mst.getUTCHours(),
    mstDate: `${mst.getUTCFullYear()}-${String(mst.getUTCMonth() + 1).padStart(2, "0")}-${String(mst.getUTCDate()).padStart(2, "0")}`
  };
}

function enrichHourlyWaitTimeColumns(columns) {
  const extra = ["MST Hour", "MST Date"].filter((col) => !columns.includes(col));
  return [...columns, ...extra];
}

function enrichHourlyWaitTimeRow(row) {
  const { mstHour, mstDate } = convertPstToMst(row["PST Hours"], row["PST Date"]);
  return { ...row, "MST Hour": mstHour, "MST Date": mstDate };
}

function readFirstSheetAsColumnsAndRows(bytes, sheetIndex = 0) {
  const workbook = readWorkbookFromBytes(bytes);
  const firstSheetName = workbook.sheetNames[sheetIndex];
  if (!firstSheetName) return null;

  const rawRows = workbook.getSheetRows(firstSheetName);
  if (!Array.isArray(rawRows) || !rawRows.length) return null;

  const headerRow = rawRows[0];
  let lastMeaningfulColumn = -1;
  headerRow.forEach((value, index) => {
    if (String(value ?? "").trim() !== "") lastMeaningfulColumn = index;
  });
  if (lastMeaningfulColumn < 0) return null;

  const columns = headerRow.slice(0, lastMeaningfulColumn + 1).map((value) => String(value ?? "").trim());
  const rows = rawRows.slice(1).map((row) => {
    const record = {};
    columns.forEach((col, index) => { record[col] = row[index]; });
    return record;
  });

  return { columns, rows };
}

async function processEodbEmailInboxFile({ token, name, base64 }, { onImported, reportOutcome } = {}) {
  const classification = classifyEodbEmailFile(name);

  if (!classification.recognized) {
    // Deliberately left in place, untouched - includes genuinely unrelated files AND the
    // intentionally-unsupported Weekly/Quarterly Email widgets and unmapped EODB widgets
    // (e.g. Summary Table) - no "Needs Review" folder exists in this design, per explicit
    // request to do away with that pattern.
    reportOutcome?.(token, { handled: false });
    return;
  }

    try {
    const bytes = base64ToBytes(base64);
    // eodb_hourly_wait_time's real per-hour data lives on the SECOND sheet ("Detail") -
    // the first sheet ("Pivot") is a spreadsheet-only cross-tab view, not raw rows. Every
    // other report type continues reading sheet index 0, unchanged.
    const sheetIndex = classification.reportType === "eodb_hourly_wait_time" ? 1 : 0;
    let parsed = readFirstSheetAsColumnsAndRows(bytes, sheetIndex);
    if (parsed && classification.reportType === "eodb_hourly_wait_time") {
      parsed = { columns: enrichHourlyWaitTimeColumns(parsed.columns), rows: parsed.rows.map(enrichHourlyWaitTimeRow) };
    }
    if (!parsed || !parsed.rows.length) {
      reportOutcome?.(token, { handled: false, reason: "No usable rows found." });
      return;
    }

    await saveReportTableWithRetry(classification.reportType, {
      columns: parsed.columns,
      rows: parsed.rows,
      sourceFileName: name,
      importedAt: new Date().toISOString(),
      importMethod: "auto"
    });

    onImported?.();
    reportOutcome?.(token, { handled: true, destinationSubfolder: classification.destinationSubfolder });
  } catch (error) {
    console.error("[eodb-email-auto-import] Failed for", name, error);
    reportOutcome?.(token, { handled: false, reason: error?.message || "Unknown error." });
  }
}

/**
 * Starts watching `folderPath` for EODB/Email report files - a no-op outside Electron. Returns
 * an unsubscribe function; calling it stops watching (the caller is responsible for also
 * telling the main process to stop, via stopEodbEmailWatcher()/the IPC bridge, since this only
 * unsubscribes the renderer-side listener, not the actual fs.watch() in the main process).
 */
export function startEodbEmailAutoImportWatcher(folderPath, { onImported } = {}) {
  const bridge = globalThis.window?.enquoteLocal?.eodbEmailInbox;
  if (!bridge?.onNewFile || !folderPath) return () => {};

  const unsubscribe = bridge.onNewFile((payload) => {
    processEodbEmailInboxFile(payload, {
      onImported,
      reportOutcome: (token, outcome) => bridge.reportOutcome?.(token, outcome)
    });
  });

  bridge.configure?.(folderPath);
  // Files already sitting in the folder BEFORE this watcher started (e.g. dropped in while
  // the app was closed, or before Auto-Import was turned on) would otherwise be invisible
  // forever - fs.watch() only reports NEW changes from the moment it starts, it has no memory
  // of pre-existing files. Mirrors the same "scanNow right after subscribing" pattern the
  // original O&M Reports Inbox watcher always used for exactly this reason (confirmed via
  // real-world testing: 5 real EODB files already in the watched folder at app launch were
  // never picked up until this call was added).
  bridge.scanNow?.();
  return unsubscribe;
}

export function stopEodbEmailAutoImportWatcher() {
  return globalThis.window?.enquoteLocal?.eodbEmailInbox?.stop?.();
}