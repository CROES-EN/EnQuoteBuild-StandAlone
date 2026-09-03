/**
 * Local, Base44-independent storage for the Supervisor Dashboard.
 *
 * This module intentionally bypasses `@/api/dataClient` (and therefore every
 * Base44-aware adapter - base44, base44-dual, and salesforce all make real
 * network calls for `listLocalCollection`/etc.) so the Supervisor Dashboard
 * behaves identically no matter which VITE_DATA_SOURCE the rest of EnQuote is
 * running under. It talks straight to the Electron-backed local JSON store
 * when available, and falls back to browser localStorage (e.g. when preview-
 * ing the built app outside Electron) so the feature never depends on a
 * network call or a Base44 account.
 *
 * Field names/definitions follow the "O&M Daily Operations Snapshot" report
 * inventory (Incorta EODB Dashboard, Incorta O&M Scheduling Dashboard,
 * Salesforce Quote Request Cases, EnQuote Quote/QuoteActivity, NICE CXone
 * Workforce Management, and the O&M Excel trackers). This store never reads
 * from or writes back to any of those source systems/files directly - every
 * numeric field below arrives either via a one-time file import (read-only -
 * see reportParsing.js's FIELD_DEFINITIONS for exactly which fields are
 * import-mappable) or manual entry, then lives only in this local record. An
 * import only ever sums/averages the columns the user explicitly maps - it
 * never fabricates, recomputes, or infers a value for a field left unmapped.
 *
 * Daily metric record shape:
 * {
 *   id: string,                          // == date, e.g. "2026-08-31"
 *   date: string,                        // "YYYY-MM-DD"
 *
 *   // --- Contact Center (Incorta EODB Dashboard) - manual entry, and file import ---
 *   calls_offered: number | null,        // total inbound contacts presented
 *   calls: number | null,                // "Calls Handled"
 *   calls_abandoned: number | null,      // disconnected before being handled
 *   aht_seconds: number | null,          // average handle time, in seconds
 *   avg_wait_seconds: number | null,     // average wait / average speed of answer, in seconds
 *   emails_received: number | null,
 *   emails_worked: number | null,        // completed/closed/resolved email contacts
 *   email_backlog_start: number | null,  // queue snapshot - manual only, not part of file import
 *   email_backlog_end: number | null,    // queue snapshot - manual only, not part of file import
 *
 *   // --- Staffing (NICE CXone Workforce Management) - manual entry, and file import ---
 *   team_headcount: number | null,           // active employees assigned to the team, regardless of availability
 *   staffing_present: number | null,         // "Available Staff" - capacity after absences
 *   staffing_scheduled: number | null,       // "Scheduled Staff"
 *   full_day_absences: number | null,
 *   partial_day_absences: number | null,
 *   training_capacity_loss: number | null,   // meetings/training capacity loss
 *   scheduled_productive_hours: number | null,
 *   actual_productive_hours: number | null,
 *
 *   // --- Quote Operations - manual entry, and file import (sf_quotes_received only) ---
 *   // Quotes Drafted/Completed and Quote Backlog are intentionally NOT stored here - they're
 *   // computed live from EnQuote's own local Quote + status_history data (see
 *   // src/features/supervisorDashboard/quoteOpsMetrics.js) so they can never go stale. The
 *   // pre-existing `quotes_drafted` field below is the legacy manual/imported figure from the
 *   // original (pre-O&M-Snapshot) Supervisor Dashboard and still powers the unchanged Overview
 *   // tab only - it is independent of, and may not match, the live-computed figure.
 *   quotes_drafted: number | null,
 *   sf_quotes_received: number | null,   // Salesforce Quote Request Cases received
 *
 *   // --- O&M Case Backlog (O&M Scheduling Dashboard / case tracker exports) - manual entry, and file import ---
 *   case_backlog_start: number | null,   // open qualifying records at start of day
 *   case_backlog_end: number | null,     // open qualifying records at end of day
 *   new_cases_received: number | null,
 *   cases_completed: number | null,
 *
 *   // --- Enphase Care - manual entry, and file import ---
 *   care_appt_cancellations: number | null,          // canceled Care field-service appointments
 *   care_plan_cancellation_requests: number | null,  // Care plan/service cancellation requests
 *   care_cancellations_completed: number | null,
 *   care_refunds_initiated: number | null,
 *
 *   // --- Blockers & Escalations (escalations tracker + Travel Plan Tracker) ---
 *   new_s1: number | null,                      // manual entry, and file import
 *   new_s2: number | null,                       // manual entry, and file import
 *   new_s3: number | null,                       // manual entry, and file import
 *   open_critical_escalations: number | null,    // manual entry, and file import
 *   overdue_follow_ups: number | null,           // manual entry, and file import
 *   major_blockers: string,                      // manual entry only - free text
 *   leadership_action_required: string,          // manual entry only - free text
 *   travel_field_blockers: string,               // manual entry only - free text; Travel Plan
 *                                                // Tracker has no dedicated report section of
 *                                                // its own - it feeds this field.
 *
 *   notes: string,
 *   agents: Array<{ name, calls, aht_seconds, emails_worked, quotes_drafted, staffing_present, ... }>,
 *   sources: { cxone?, nice_wfm?, salesforce?, incorta?, care_tracker?, escalations_tracker?, manual?, other?: { imported_at, row_count } },
 *   created_date: string,
 *   updated_date: string,
 * }
 *
 * Every field above is optional/nullable and merged independently (see
 * `mergeDailyRecord`/`withoutBlankValues` below) - each Supervisor Dashboard tab only ever
 * saves the handful of fields it owns, so e.g. saving the Staffing tab for a date never
 * touches that same date's Contact Center or Escalations fields. The same independence applies
 * to imports: a file that only maps Staffing columns will never touch that date's Case Backlog,
 * Care, or Escalations fields either.
 */

const COLLECTION = "supervisorDailyMetrics";
const BROWSER_STORAGE_KEY = "enquote_supervisor_daily_metrics_v1";

function localBridge() {
  return globalThis.window?.enquoteLocal?.collections || null;
}

// Lets the UI show a small notice when it's not backed by the shared Electron
// data file (e.g. running via `vite dev` in a plain browser tab).
export function isElectronBacked() {
  return Boolean(localBridge());
}

function readBrowserStorage() {
  try {
    const raw = globalThis.window?.localStorage?.getItem(BROWSER_STORAGE_KEY);
    const parsed = raw ? JSON.parse(raw) : [];
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function writeBrowserStorage(records) {
  try {
    globalThis.window?.localStorage?.setItem(BROWSER_STORAGE_KEY, JSON.stringify(records));
  } catch {
    // Ignore storage failures (e.g. private-browsing quota) - in-memory state still works this session.
  }
}

function normalizeAgentKey(name) {
  return String(name ?? "").toLowerCase().trim();
}

// Merges per-agent rows by name instead of replacing the array wholesale, so importing
// CXONE (calls/AHT) and Salesforce (emails/quotes) data for the same agent on the same
// day combines into one row per agent rather than one report's data clobbering the other.
function mergeAgentRows(existingAgents = [], incomingAgents = []) {
  if (!incomingAgents || !incomingAgents.length) return existingAgents || [];
  const byName = new Map((existingAgents || []).map(agent => [normalizeAgentKey(agent.name), agent]));
  incomingAgents.forEach(agent => {
    const key = normalizeAgentKey(agent.name);
    byName.set(key, { ...(byName.get(key) || {}), ...agent });
  });
  return Array.from(byName.values());
}

// Shallow-merges a day's existing record with an incoming (imported or manually-entered)
// partial record. Fields that are null/undefined on `incoming` are dropped BEFORE merging
// (not just "absent" - report aggregation explicitly sets unmapped fields to null) so a
// CXONE import (calls/AHT) and a later Salesforce import (emails/quotes) for the same date
// each fill in only the fields they actually know about, without one wiping out data the
// other already saved for that day. A field can only be cleared by supplying a real value
// or by deleting the whole day's record.
function withoutBlankValues(record) {
  return Object.fromEntries(
    Object.entries(record || {}).filter(([, value]) => value !== null && value !== undefined)
  );
}

function mergeDailyRecord(existing, incoming) {
  return {
    ...existing,
    ...withoutBlankValues(incoming),
    agents: mergeAgentRows(existing?.agents, incoming?.agents),
    sources: { ...(existing?.sources || {}), ...(incoming?.sources || {}) }
  };
}

export async function listDailyMetrics() {
  const bridge = localBridge();
  const records = bridge ? await bridge.list(COLLECTION) : readBrowserStorage();
  return (records || []).slice().sort((a, b) => (a.date || "").localeCompare(b.date || ""));
}

export async function saveDailyMetric(partialRecord) {
  if (!partialRecord?.date) throw new Error("A date is required to save daily metrics.");

  const existing = await listDailyMetrics();
  const match = existing.find(item => item.date === partialRecord.date);
  const merged = mergeDailyRecord(match, partialRecord);
  const now = new Date().toISOString();

  const bridge = localBridge();
  if (bridge) {
    if (match) return bridge.update(COLLECTION, match.id, { ...merged, updated_date: now });
    return bridge.create(COLLECTION, { ...merged, id: partialRecord.date, created_date: now, updated_date: now });
  }

  const next = match
    ? existing.map(item => (item.date === partialRecord.date ? { ...merged, updated_date: now } : item))
    : [...existing, { ...merged, id: partialRecord.date, created_date: now, updated_date: now }];
  writeBrowserStorage(next);
  return next.find(item => item.date === partialRecord.date);
}

export async function deleteDailyMetric(id) {
  const bridge = localBridge();
  if (bridge) return bridge.delete(COLLECTION, id);

  const next = readBrowserStorage().filter(item => item.id !== id);
  writeBrowserStorage(next);
  return { id };
}
