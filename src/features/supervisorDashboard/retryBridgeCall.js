/**
 * Wraps any window.enquoteLocal.collections bridge call (create/update/delete) with
 * automatic retry, specifically for a real, confirmed, intermittent Electron IPC failure
 * ("Error invoking remote method '...': reply was never sent") that has been observed
 * reproducibly across MULTIPLE different collections tonight (both supervisorReportTables
 * AND autoImportSettings) - confirming this is a broader IPC-layer issue, not something
 * specific to any one collection or report type.
 *
 * Deliberately generic and reusable, rather than patched into each store file individually,
 * so every current AND future collection write gets this same protection automatically.
 *
 * ONLY retries when the error message matches this specific IPC symptom - any other error
 * (a real validation failure, a genuinely malformed record, etc.) fails immediately on the
 * first attempt, with no added delay.
 */

const RETRYABLE_ERROR_PATTERN = /reply was never sent/i;
const MAX_ATTEMPTS = 4;
const BASE_DELAY_MS = 500;

/**
 * @param {string} label - a short description for logging (e.g. "collections:create
 *   (autoImportSettings)"), so retry warnings are traceable to their real source.
 * @param {() => Promise<any>} performCall - a function that performs the actual bridge call,
 *   e.g. () => bridge.create(COLLECTION, record).
 */
export async function retryBridgeCall(label, performCall) {
  let lastError;
  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    try {
      return await performCall();
    } catch (error) {
      lastError = error;
      const isRetryable = RETRYABLE_ERROR_PATTERN.test(error?.message || "");
      if (!isRetryable || attempt === MAX_ATTEMPTS) throw error;
      console.warn(`[retryBridgeCall] "${label}" hit a known transient IPC error on attempt ${attempt} - retrying in ${BASE_DELAY_MS * attempt}ms...`, error.message);
      await new Promise((resolve) => setTimeout(resolve, BASE_DELAY_MS * attempt));
    }
  }
  throw lastError;
}