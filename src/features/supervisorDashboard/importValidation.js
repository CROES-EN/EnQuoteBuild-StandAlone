/**
 * Import validation gate - runs BEFORE any imported rows are ever handed to
 * saveReportTable()/saveStaffingSnapshot() (i.e. before they can ever reach disk). Catches
 * the most common real mistakes at the moment of import, with a clear, specific message -
 * instead of silently storing a malformed table and only noticing later when a tile shows a
 * wrong/missing number (the failure mode this session repeatedly had to debug after the fact).
 *
 * Deliberately conservative: this REJECTS a small, well-defined set of unambiguous problems
 * (no rows, only one column, duplicate column names, or a report type's known "this column
 * must exist" check) rather than trying to guess at every possible thing that could be wrong -
 * a validation gate that's too aggressive just becomes a second source of confusing failures.
 */

// One or more of these columns must be present for a given report type - this is a "does this
// even look like the right kind of file" check, not a full schema validation. Chosen from the
// columns already confirmed present in every report type's real exports this session.
const REQUIRED_COLUMNS_BY_TYPE = {
  staffing: ["Agent Name", "Login Time"],
  email_cases: ["Case Number"],
  email_daily: ["createdDate_PST", "# Emails"],
  sfdc_quotes: ["Case Number"],
  escalations: ["Case Number"],
  audits: ["Case Number"],
  care_cases: ["Case Number"],
  om_cs_cases: ["Case Number"],
  incorta_input: ["Case Number"],
  care_subscriptions: ["Enlighten Site Id"]
};

// For these specific report types, ANY file whose name CONTAINS the given substring is
// recognized and trusted by filename alone, bypassing the column-based required-columns check
// entirely - "Incorta-O&M-Input" (imports EODB Dashboard call-metric widgets) and "Incorta -
// O&M Email Report" (imports Pronto Metrics Dashboard email-metric widgets) are BOTH known to
// legitimately accept files from MULTIPLE different Incorta widgets with different shapes
// (call-detail rows vs. aggregate/pivot summary rows, case-level vs. daily-volume rows), none
// of which necessarily share the same "Case Number"-style column the other report types rely
// on. Confirmed against every real widget filename seen this session for both report types
// (Summary Table, NICE Call - RAW DATA, Abandonment Rate, etc. for incorta_input; Email Raw
// Data, Daily/Weekly/Quarterly Email Volume & AHT for email_cases/email_daily) - all match.
// Matching is substring-based (not "starts with"), which is deliberate: EnQuote's own
// auto-import can prepend a processing timestamp to the original filename (confirmed real
// example: "2026-09-09T23-58-02-498Z_Pronto Metrics Dashboard_...csv"), and this still matches
// correctly regardless of where in the filename the recognized text falls.
const FILENAME_OVERRIDE_BY_TYPE = {
  incorta_input: "EODB Dashboard",
  email_cases: "Pronto Metrics Dashboard",
  email_daily: "Pronto Metrics Dashboard"
};

/**
 * @param {string} reportType - the report type key (e.g. "staffing", "email_cases").
 * @param {Array<{ label: string }>} columnOptions - the mapped columns for this import.
 * @param {Array<Record<string, any>>} dataRows - the parsed data rows for this import.
 * @param {string} [sourceFileName] - the original file's name, used for the filename-based
 *   recognition override above. Optional - if omitted, the filename override simply never
 *   applies and behavior falls back to the standard column-based check for every report type.
 * @returns {{ valid: boolean, errors: string[] }}
 */
export function validateImport(reportType, columnOptions, dataRows, sourceFileName) {
  const errors = [];
  const columnLabels = (columnOptions || []).map((c) => c.label);

  // --- Generic checks, apply to every report type ---
  if (!dataRows || dataRows.length === 0) {
    errors.push("No data rows were found in this file.");
  }

  if (columnLabels.length < 2) {
    errors.push(
      `Only ${columnLabels.length} column${columnLabels.length === 1 ? "" : "s"} detected - this usually means the wrong sheet/tab was selected, or the file didn't parse as expected.`
    );
  }

  const seen = new Set();
  const duplicates = new Set();
  columnLabels.forEach((label) => {
    if (seen.has(label)) duplicates.add(label);
    seen.add(label);
  });
  if (duplicates.size > 0) {
    errors.push(
      `Duplicate column name${duplicates.size === 1 ? "" : "s"} detected: ${Array.from(duplicates).join(", ")} - this can silently drop data, since only the last matching column's value would be kept per row.`
    );
  }

  // --- Report-type-specific check: does this file even look like the right kind of report? ---
  const requiredColumns = REQUIRED_COLUMNS_BY_TYPE[reportType];
  if (requiredColumns) {
    const overridePattern = FILENAME_OVERRIDE_BY_TYPE[reportType];
    const matchesKnownFilenamePattern = Boolean(
      overridePattern && sourceFileName && sourceFileName.toLowerCase().includes(overridePattern.toLowerCase())
    );

    if (!matchesKnownFilenamePattern) {
      const missing = requiredColumns.filter((col) => !columnLabels.includes(col));
      if (missing.length === requiredColumns.length) {
        // ALL of the expected columns are missing - very likely the wrong file entirely,
        // rather than just a minor column-naming difference worth tolerating.
        errors.push(
          `This doesn't look like a "${reportType}" file - expected to find a column like "${requiredColumns[0]}", but it wasn't present. Double-check you selected the right file/sheet.`
        );
      }
    }
  }

  return { valid: errors.length === 0, errors };
}
