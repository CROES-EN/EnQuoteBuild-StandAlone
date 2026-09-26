/**
 * Shared calculations for the O&M Daily Operations Snapshot - the spec's `REQUIRED
 * CALCULATIONS`, timezone/date-window resolution, and the Data Quality & Exceptions /
 * Executive Summary derivations used by the Daily Snapshot Report tab.
 *
 * Every formula here is guarded against missing/zero inputs and returns `null` ("N/A") rather
 * than dividing by zero or fabricating a number, per the spec's "never create synthetic values"
 * rule. Individual tabs (Contact Center, Staffing, O&M Case Backlog) may keep small local
 * copies of the single formula they each display inline - this module is the canonical source
 * once more than one tab/the report needs the same formula, so it's not duplicated three times.
 *
 * Quote-specific figures (Quotes Drafted/Completed/Backlog, Quote Intake Gap) are computed in
 * `quoteOpsMetrics.js` instead, since they need live EnQuote quote data, not just the daily
 * metrics record.
 */

import {computeDelta} from "@/features/supervisorDashboard/format";

function isFiniteNumber(value) {
  return typeof value === "number" && Number.isFinite(value);
}

/** Abandon Rate = Calls Abandoned / Calls Offered, if Offered is nonzero. */
export function computeAbandonRate(callsAbandoned, callsOffered) {
  if (!isFiniteNumber(callsAbandoned) || !isFiniteNumber(callsOffered) || callsOffered === 0) return null;
  return callsAbandoned / callsOffered;
}

/** Handle Rate = Calls Handled / Calls Offered, if Offered is nonzero. */
export function computeHandleRate(callsHandled, callsOffered) {
  if (!isFiniteNumber(callsHandled) || !isFiniteNumber(callsOffered) || callsOffered === 0) return null;
  return callsHandled / callsOffered;
}

/** Staffing Availability Rate = Available Staff / Scheduled Staff, if Scheduled Staff is nonzero. */
export function computeStaffingAvailabilityRate(availableStaff, scheduledStaff) {
  if (!isFiniteNumber(availableStaff) || !isFiniteNumber(scheduledStaff) || scheduledStaff === 0) return null;
  return availableStaff / scheduledStaff;
}

/**
 * Net Backlog Change = Ending Backlog - Beginning Backlog. Generic over any backlog (O&M Case
 * Backlog, Quote Backlog, ...), not just one tab's fields.
 */
export function computeNetBacklogChange(backlogStart, backlogEnd) {
  if (!isFiniteNumber(backlogStart) || !isFiniteNumber(backlogEnd)) return null;
  return backlogEnd - backlogStart;
}

/** Expected Ending Backlog = Beginning Backlog + New Intake - Completed. */
export function computeExpectedEndingBacklog(backlogStart, newIntake, completed) {
  if (!isFiniteNumber(backlogStart) || !isFiniteNumber(newIntake) || !isFiniteNumber(completed)) return null;
  return backlogStart + newIntake - completed;
}

/** Backlog Reconciliation Variance = Actual Ending Backlog - Expected Ending Backlog. */
export function computeBacklogReconciliationVariance(actualEndingBacklog, expectedEndingBacklog) {
  if (!isFiniteNumber(actualEndingBacklog) || !isFiniteNumber(expectedEndingBacklog)) return null;
  return actualEndingBacklog - expectedEndingBacklog;
}

/**
 * OS-resolved IANA timezone (reflects Windows' own Date & Time setting under Electron/Chromium),
 * falling back to Mountain Time - the zone already hardcoded elsewhere in this feature
 * (format.js's formatTimestamp equivalent, quoteSLAExport.js) - if resolution fails.
 */
export function resolveReportingTimeZone() {
  try {
    const timeZone = Intl.DateTimeFormat().resolvedOptions().timeZone;
    if (timeZone) return { timeZone, isFallback: false };
  } catch {
    // fall through to the fixed fallback below
  }
  return { timeZone: "America/Denver", isFallback: true };
}

function toDateStr(date) {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
}

/**
 * "Prior business day" (skips Saturday/Sunday) relative to `reference`, as a "YYYY-MM-DD"
 * local-calendar string - the spec's default reporting date when none is explicitly supplied.
 */
export function getPriorBusinessDate(reference = new Date()) {
  const date = new Date(reference.getFullYear(), reference.getMonth(), reference.getDate());
  date.setDate(date.getDate() - 1);
  while (date.getDay() === 0 || date.getDay() === 6) {
    date.setDate(date.getDate() - 1);
  }
  return toDateStr(date);
}

/**
 * Given a list of { label, value } report metrics, returns the labels whose value is
 * null/undefined - the report's "Unavailable Metrics" line.
 */
export function deriveUnavailableMetrics(metricEntries) {
  return (metricEntries || [])
    .filter(entry => entry.value === null || entry.value === undefined)
    .map(entry => entry.label);
}

/**
 * Given a list of { label, value } computed variances, returns entries with a nonzero variance
 * - the report's "Reconciliation Exceptions" line.
 */
export function deriveReconciliationExceptions(varianceEntries) {
  return (varianceEntries || [])
    .filter(entry => isFiniteNumber(entry.value) && entry.value !== 0)
    .map(entry => `${entry.label}: ${entry.value > 0 ? "+" : ""}${entry.value}`);
}

/** Human-readable tab names for whichever `sources` tags are present on a daily record. */
const SOURCE_TAB_LABELS = { manual: "Manually entered", cxone: "CXONE import", salesforce: "Salesforce import", other: "Other import" };

export function deriveManualInputsUsed(record) {
  const sources = record?.sources || {};
  return Object.keys(sources)
    .filter(key => SOURCE_TAB_LABELS[key])
    .map(key => SOURCE_TAB_LABELS[key]);
}

/**
 * Auto-drafts 3-5 executive-summary bullets from the day's deltas/escalations/backlog swings.
 * Editable by the supervisor in the Daily Snapshot Report tab before export - this is a
 * starting point, not a final authored summary, and is never persisted (regenerated fresh
 * every time the report is viewed).
 */
export function draftExecutiveSummaryBullets({ current, previous, quoteOps, caseBacklogVariance }) {
  const bullets = [];
  const record = current || {};
  const prior = previous || null;

  const escalationCount = (record.new_s1 || 0) + (record.new_s2 || 0) + (record.new_s3 || 0);
  if (escalationCount > 0) {
    bullets.push(
      `${escalationCount} new escalation${escalationCount === 1 ? "" : "s"} today` +
      (record.new_s1 ? ` (${record.new_s1} S1)` : "") + " - see Blockers & Escalations for detail."
    );
  }

  if (record.leadership_action_required?.trim()) {
    bullets.push(`Leadership action requested: ${record.leadership_action_required.trim()}`);
  }

  const callsDelta = computeDelta(record.calls, prior?.calls, "higherIsBetter");
  if (callsDelta && callsDelta.trend !== "flat") {
    bullets.push(`Calls handled ${callsDelta.trend === "up" ? "up" : "down"} ${Math.abs(callsDelta.change)} vs prior day${callsDelta.percent !== null ? ` (${callsDelta.percent > 0 ? "+" : ""}${callsDelta.percent}%)` : ""}.`);
  }

  const emailsDelta = computeDelta(record.emails_worked, prior?.emails_worked, "higherIsBetter");
  if (emailsDelta && emailsDelta.trend !== "flat") {
    bullets.push(`Emails worked ${emailsDelta.trend === "up" ? "up" : "down"} ${Math.abs(emailsDelta.change)} vs prior day.`);
  }

  if (isFiniteNumber(caseBacklogVariance) && caseBacklogVariance !== 0) {
    bullets.push(`O&M case backlog reconciliation variance of ${caseBacklogVariance > 0 ? "+" : ""}${caseBacklogVariance} - see Data Quality & Exceptions.`);
  }

  const staffingDelta = computeDelta(record.staffing_present, prior?.staffing_present, "neutral");
  if (staffingDelta && staffingDelta.trend !== "flat") {
    bullets.push(`Available staff ${staffingDelta.trend === "up" ? "increased" : "decreased"} by ${Math.abs(staffingDelta.change)} vs prior day.`);
  }

  if (quoteOps && isFiniteNumber(quoteOps.quotesDrafted)) {
    bullets.push(`EnQuote drafted ${quoteOps.quotesDrafted} quote${quoteOps.quotesDrafted === 1 ? "" : "s"} and completed ${quoteOps.quotesCompleted ?? 0} today.`);
  }

  if (bullets.length === 0) {
    bullets.push("No notable day-over-day changes or new escalations to report.");
  }

  return bullets.slice(0, 5);
}
