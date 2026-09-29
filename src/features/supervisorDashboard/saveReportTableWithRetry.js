/**
 * Wraps saveReportTable() with automatic retry, specifically for a real, confirmed,
 * intermittent Electron IPC failure ("Error invoking remote method 'collections:create':
 * reply was never sent") that has been observed reproducibly for certain report imports,
 * even with verified-correct data, a freshly-restarted app, and no other explanation found
 * after extensive investigation (classification, payload serialization, duplicate handler
 * registration, and a real read-modify-write race condition were all checked and ruled out
 * or already fixed separately). Rather than continue chasing the exact root cause live,
 * this makes the save operation itself resilient to this specific, known symptom.
 *
 * ONLY retries when the error message matches this specific IPC symptom - any other error
 * (a real validation failure, a genuinely malformed file, etc.) fails immediately on the
 * first attempt, exactly as before, with no added delay.
 */
import {saveReportTable} from "@/features/supervisorDashboard/importedTableStore";

const RETRYABLE_ERROR_PATTERN = /reply was never sent/i;
const MAX_ATTEMPTS = 4;
const BASE_DELAY_MS = 500;

// Maps a report type to the column name that uniquely identifies each row, so
// saveReportTable()'s change-detection can tell "this row changed" apart from "this
// row was removed and a different one added" - without an entry here, a report type
// still gets the skip-if-unchanged behavior, just with less precise changed-row counts
// in the console log. Add more entries here as needed for other report types.
const REPORT_KEY_FIELDS = {
  care_subscriptions: "Subscription Id",
};

export async function saveReportTableWithRetry(reportType, payload) {
  let lastError;
  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    try {
      return await saveReportTable(reportType, payload, { keyField: REPORT_KEY_FIELDS[reportType] || null });
    } catch (error) {
      lastError = error;
      const isRetryable = RETRYABLE_ERROR_PATTERN.test(error?.message || "");
      if (!isRetryable || attempt === MAX_ATTEMPTS) throw error;
      console.warn(`[saveReportTableWithRetry] Attempt ${attempt} for "${reportType}" hit a known transient IPC error - retrying in ${BASE_DELAY_MS * attempt}ms...`, error.message);
      await new Promise((resolve) => setTimeout(resolve, BASE_DELAY_MS * attempt));
    }
  }
  throw lastError;
}