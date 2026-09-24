// autoDrafterCaseDrafts.js
//
// Persists a generated Quote Draft (from autoDrafterDraftEngine.js) onto its ORIGINATING
// Auto-Drafter case row, inside the SAME "quoteRequestCases" report table AutoDrafter.jsx
// already reads/writes via importedTableStore.js (getReportTable/saveReportTable).
// Deliberately does NOT create a Quote record and does NOT write to any Quotes-related
// storage -- the draft lives ONLY as extra fields on its case row here.
//
// WHY read-modify-write: importedTableStore.js's saveReportTable() replaces the ENTIRE
// table's rows in one call -- there is no per-row update in the underlying Electron bridge
// (confirmed via that file's own module-level comment: "the bridge only exposes
// list/create/update/delete -- there is no get-by-id or upsert method"). So persisting a
// single row's draft means: read the whole table, update the one matching row in memory,
// and write the whole table back -- the exact same pattern importedTableStore.js's own
// saveStaffingSnapshot() already uses internally for the same reason.

import { getReportTable, saveReportTable } from "@/features/supervisorDashboard/importedTableStore";

// Hidden fields added to a case row once a draft exists. Prefixed with "__" so they never
// collide with a real Salesforce export column, and are easy to recognize/strip if this
// data ever needs to be excluded from an export or a raw-column display.
export const DRAFT_FIELD = "__autoDraft";
export const STATUS_FIELD = "__autoDraftStatus"; // "ok" | "blocked" | "not_step1_output" | "parse_error"
export const BLOCKING_ISSUES_FIELD = "__autoDraftBlockingIssues";
export const GENERATED_AT_FIELD = "__autoDraftGeneratedAt";

/**
 * Saves a generated draft result (the object returned by autoDraftFromCaseComment() /
 * autoDraftAnyway(), wrapped with a status) onto the row identified by
 * `caseNumberCol`/`caseNumberValue` within `reportType`'s table.
 *
 * Returns the updated table record, or null if:
 *   - this report type has never been imported (no table exists yet), or
 *   - `caseNumberCol` is falsy (column not detected in this import -- there is no reliable
 *     way to identify which row to update, so nothing is written rather than guessing).
 *
 * Never throws on a "no matching row found" case -- if the row can't be found (e.g. it was
 * deleted from a re-import in the meantime), the table is written back unchanged aside from
 * refreshed metadata, and the caller can decide how to handle a stale reference.
 */
export async function saveDraftForCase(reportType, caseNumberCol, caseNumberValue, result) {
  if (!caseNumberCol) return null;

  const table = await getReportTable(reportType);
  if (!table) return null;

  const rows = (table.rows || []).map((row) => {
    if (row[caseNumberCol] !== caseNumberValue) return row;
    return {
      ...row,
      [DRAFT_FIELD]: result.draft || null,
      [STATUS_FIELD]: result.status || null,
      [BLOCKING_ISSUES_FIELD]: result.blockingIssues || [],
      [GENERATED_AT_FIELD]: new Date().toISOString()
    };
  });

  return saveReportTable(reportType, {
    columns: table.columns,
    rows,
    sourceFileName: table.sourceFileName,
    importedAt: table.importedAt,
    importMethod: table.importMethod
  });
}

/**
 * Reads back whatever draft state (if any) is already stored on a case row -- used by
 * AutoDrafterCaseTile.jsx to render a previously generated draft without regenerating it
 * on every render/reload.
 */
export function getDraftFromRow(row) {
  return {
    draft: row?.[DRAFT_FIELD] || null,
    status: row?.[STATUS_FIELD] || null,
    blockingIssues: row?.[BLOCKING_ISSUES_FIELD] || [],
    generatedAt: row?.[GENERATED_AT_FIELD] || null
  };
}
