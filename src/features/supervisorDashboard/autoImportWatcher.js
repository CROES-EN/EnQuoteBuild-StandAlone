/**
 * Zero-click auto-import: watches a designated local folder (the "O&M Reports Inbox" - see
 * electron/main.cjs's watchReportsInbox()) for dropped report files and imports them
 * automatically using the exact same parsing/mapping/aggregation pipeline as the manual
 * "Import Report" dialog (see reportParsing.js) - no live API access exists to Incorta, NICE
 * CXONE, Salesforce, or SharePoint (no credentials or client code anywhere in this app), so
 * "automatic import" means "the app notices a file the moment it's dropped in, instead of a
 * person clicking Import Report and picking it by hand."
 *
 * Desktop-only (Electron) - there is no way for a plain browser tab to watch an arbitrary local
 * folder, so `startAutoImportWatcher` is a silent no-op outside Electron (matching this
 * feature's existing isElectronBacked() convention elsewhere).
 *
 * Safety: an import only ever proceeds automatically when column auto-mapping is confident
 * enough to trust unattended (a date - or a safe same-day fallback - plus at least one real
 * metric field). Anything less confident is left for the supervisor to import manually via the
 * existing "Import Report" dialog (which lets them see/adjust the mapping before anything is
 * saved) - this module never guesses at a mapping harder than the manual dialog already does,
 * and never fabricates a value.
 */

import { toast } from "sonner";
import {
  guessHeaderRowIndex,
  buildColumnOptions,
  autoMapColumns,
  aggregateRowsByDate,
  readWorkbookFromBytes
} from "@/features/supervisorDashboard/reportParsing";
import { saveDailyMetric } from "@/features/supervisorDashboard/opsMetricsStore";

// Best-effort filename -> source-tag guess, purely for provenance/badge labeling (see
// SOURCE_LABELS in PriorDayScorecard.jsx/MetricsHistoryTable.jsx) - never affects which fields
// get imported, only how the import is later labeled in the UI.
const SOURCE_KEYWORD_RULES = [
  { source: "nice_wfm", keywords: ["wfm", "workforce", "staffing", "schedule adherence"] },
  { source: "care_tracker", keywords: ["care", "svcancel", "cancel"] },
  { source: "escalations_tracker", keywords: ["escalat", "tracker v2", "o&m tracker", "om tracker"] },
  { source: "incorta", keywords: ["incorta", "scheduling", "case backlog", "case tracker"] },
  { source: "salesforce", keywords: ["salesforce", "sfdc", "quote request"] },
  { source: "cxone", keywords: ["cxone", "nice", "contact center", "eodb"] }
];

function guessSourceFromFilename(filename) {
  const normalized = String(filename ?? "").toLowerCase();
  const rule = SOURCE_KEYWORD_RULES.find(candidate => candidate.keywords.some(keyword => normalized.includes(keyword)));
  return rule?.source ?? "other";
}

function base64ToBytes(base64) {
  const binaryString = atob(base64);
  const bytes = new Uint8Array(binaryString.length);
  for (let i = 0; i < binaryString.length; i++) {
    bytes[i] = binaryString.charCodeAt(i);
  }
  return bytes;
}

// Tags every aggregated record's `sources[source]` entry with `auto: true` so the UI can
// eventually distinguish a hands-off auto-import from a manual upload, without changing
// anything about the imported values themselves.
function markAsAutoImported(records, source) {
  return records.map(record => ({
    ...record,
    sources: {
      ...record.sources,
      [source]: { ...record.sources?.[source], auto: true }
    }
  }));
}

async function processInboxFile({ token, name, base64 }, { onImported } = {}) {
  const bridge = globalThis.window?.enquoteLocal?.reportsInbox;
  const reportResult = (success, extra = {}) => {
    bridge?.sendImportResult?.(token, { success, ...extra });
  };

  try {
    const bytes = base64ToBytes(base64);
    const workbook = readWorkbookFromBytes(bytes);
    const firstSheet = workbook.sheetNames[0];
    if (!firstSheet) {
      toast.warning(`"${name}" has no readable sheet - moved to the inbox's Needs Review folder.`);
      reportResult(false, { reason: "no-sheet" });
      return;
    }

    const rows = workbook.getSheetRows(firstSheet);
    const headerRowIndex = guessHeaderRowIndex(rows);
    const columnOptions = buildColumnOptions(rows, headerRowIndex);
    const mapping = autoMapColumns(columnOptions);
    const source = guessSourceFromFilename(name);

    const hasDateColumn = mapping.date !== null && mapping.date !== undefined;
    const mappedMetricFields = Object.keys(mapping).filter(
      key => key !== "date" && key !== "agent" && mapping[key] !== null && mapping[key] !== undefined
    );

    // Only proceed automatically when the mapping is confident enough to trust unattended - a
    // date column (or a safe same-day fallback) AND at least one real metric field. Anything
    // less risks silently importing garbage (or nothing at all); defer to the supervisor instead.
    if (mappedMetricFields.length === 0) {
      toast.warning(`Could not confidently auto-map "${name}" - moved to the inbox's Needs Review folder. Use Import Report to map its columns manually.`);
      reportResult(false, { reason: "no-confident-mapping" });
      return;
    }

    const fallbackDate = hasDateColumn ? null : new Date().toISOString().slice(0, 10);
    const aggregation = aggregateRowsByDate({ rows, headerRowIndex, mapping, fallbackDate, source });

    if (!aggregation.records.length) {
      toast.warning(`"${name}" had no usable rows after auto-mapping - moved to the inbox's Needs Review folder.`);
      reportResult(false, { reason: "no-rows" });
      return;
    }

    const records = markAsAutoImported(aggregation.records, source);
    for (const record of records) {
      // Sequential, not Promise.all - saveDailyMetric merges against whatever's already saved
      // for that date, so concurrent saves for the SAME date within one file could race.
      // eslint-disable-next-line no-await-in-loop
      await saveDailyMetric(record);
    }

    toast.success(`Auto-imported ${records.length} day${records.length === 1 ? "" : "s"} from "${name}".`);
    onImported?.();
    reportResult(true, { recordsImported: records.length });
  } catch (error) {
    console.error("Auto-import failed for", name, error);
    toast.error(`Auto-import failed for "${name}" - moved to the inbox's Needs Review folder.`);
    reportResult(false, { reason: "exception", error: error?.message });
  }
}

/**
 * Subscribes to the main process's O&M Reports Inbox watcher. Call once from a long-lived,
 * always-mounted component (the app shell - not a page that unmounts on navigation), so a file
 * dropped in while the user is elsewhere in the app still gets processed instead of silently
 * missed because no listener was registered. Returns an unsubscribe function; safe/no-op when
 * not running inside the Electron desktop app.
 */
export function startAutoImportWatcher({ onImported } = {}) {
  const bridge = globalThis.window?.enquoteLocal?.reportsInbox;
  if (!bridge?.onNewFile) return () => {};

  const unsubscribe = bridge.onNewFile((payload) => {
    processInboxFile(payload, { onImported });
  });

  // Ask main to (re)scan the inbox now that we're ready to receive results - catches any files
  // that were already sitting there before this listener existed (app was closed when they were
  // dropped in, or this is the very first subscriber after launch).
  bridge.scanNow?.();

  return unsubscribe;
}

/** Resolves to the watched folder's absolute path, or `undefined` outside Electron. */
export function getReportsInboxPath() {
  return globalThis.window?.enquoteLocal?.reportsInbox?.getPath?.();
}

/** Reveals the watched folder in the OS file explorer; no-op outside Electron. */
export function openReportsInboxFolder() {
  return globalThis.window?.enquoteLocal?.reportsInbox?.openFolder?.();
}
