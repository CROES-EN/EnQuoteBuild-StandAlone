/**
 * Dashboard Metrics — exact replication of Base44's dashboard logic.
 *
 * Core filter: q.is_current_version !== false && !q.exclude_from_reporting
 * This reduces the full entity-snapshot dataset to only dashboard-relevant quotes.
 */

// ─── Core filter ───────────────────────────────────────────────────────────

export function getDashboardQuotes(allQuotes) {
  return allQuotes.filter(
    (q) => q.is_current_version !== false && !q.exclude_from_reporting
  );
}

// ─── Open / Closed ──────────────────────────────────────────────────────────

const CLOSED_STATUSES = ["invoice_paid", "scheduled"];

export function getOpenQuotes(dashboardQuotes) {
  return dashboardQuotes.filter((q) => !CLOSED_STATUSES.includes(q.status));
}

export function getClosedQuotes(dashboardQuotes) {
  return dashboardQuotes.filter((q) => CLOSED_STATUSES.includes(q.status));
}

// ─── Approved / Rejected ───────────────────────────────────────────────────

const APPROVED_STATUSES = [
  "approved",
  "quote_sent_to_ho",
  "ho_approved_invoice_required",
  "invoiced",
  "invoice_paid",
  "scheduled",
];

export function getApprovedQuotes(dashboardQuotes) {
  return dashboardQuotes.filter((q) => APPROVED_STATUSES.includes(q.status));
}

export function getApprovalRate(dashboardQuotes) {
  const approved = getApprovedQuotes(dashboardQuotes);
  // Denominator: all dashboard quotes where status !== "draft"
  // Since no status is literally "draft", denominator = all dashboard quotes
  const denominator = dashboardQuotes.filter((q) => q.status !== "draft").length;
  return denominator > 0 ? approved.length / denominator : 0;
}

export function getRejectedQuotes(dashboardQuotes) {
  return dashboardQuotes.filter((q) =>
    ["rejected", "ho_rejected"].includes(q.status)
  );
}

// ─── Total Value ────────────────────────────────────────────────────────────

export function getTotalValue(dashboardQuotes) {
  return dashboardQuotes.reduce((sum, q) => sum + (q.total || 0), 0);
}

export function getAvgQuoteValue(dashboardQuotes) {
  return dashboardQuotes.length > 0
    ? getTotalValue(dashboardQuotes) / dashboardQuotes.length
    : 0;
}

// ─── Attention Required ─────────────────────────────────────────────────────

const STATUS_THRESHOLDS = {
  draft_without_internal: 3,
  draft_without_fst: 3,
  submitted: 3,
  approved: 5,
  rejected: 5,
  quote_sent_to_ho: 5,
  ho_approved_invoice_required: 7,
  ho_rejected: 5,
  invoiced: 14,
  invoice_paid: 2,
  pending_materials: 10,
};

const EXCLUDED_ALERT_STATUSES = ["scheduled", "on_hold"];

// Mountain Time offset: -6 hours (MDT). Adjust for MST (-7) if needed.
const MT_OFFSET = -6 * 60 * 60 * 1000;
const INVOICE_PAID_CUTOFF = new Date("2026-07-07T00:00:00" + (-MT_OFFSET === -6 ? "-06:00" : "-07:00"));

function differenceInDays(fromDate, toDate) {
  const msPerDay = 1000 * 60 * 60 * 24;
  return Math.floor((toDate - fromDate) / msPerDay);
}

export function getAttentionQuotes(dashboardQuotes, dismissedQuoteIds = new Set()) {
  const now = new Date();
  return dashboardQuotes.filter((q) => {
    // Exclude scheduled and on_hold
    if (EXCLUDED_ALERT_STATUSES.includes(q.status)) return false;

    // Exclude dismissed quotes
    if (dismissedQuoteIds.has(q.id || q.localId)) return false;

    const threshold = STATUS_THRESHOLDS[q.status];
    if (!threshold) return false;

    // Drafts must have a prior "submitted" in status_history
    if (q.status === "draft_without_internal" || q.status === "draft_without_fst") {
      const hasSubmitted = (q.status_history || []).some((h) => h.status === "submitted");
      if (!hasSubmitted) return false;
    }

    // invoice_paid: ignore if paid date is before 2026-07-07 Mountain Time
    if (q.status === "invoice_paid") {
      const paidDateStr = q.paid_at_date || q.invoice_paid_date;
      if (paidDateStr) {
        const paidDate = new Date(paidDateStr);
        // Convert to Mountain Time for comparison
        const paidDateMT = new Date(paidDate.getTime() + MT_OFFSET);
        if (paidDateMT < INVOICE_PAID_CUTOFF) return false;
      }
    }

    // Clock starts from latest status_history entry's changed_at, or created_date
    const history = q.status_history || [];
    let statusDate;
    if (history.length > 0) {
      statusDate = new Date(history[history.length - 1].changed_at);
    } else if (q.created_date) {
      statusDate = new Date(q.created_date);
    } else {
      return false; // No way to determine age
    }

    const daysElapsed = differenceInDays(statusDate, now);
    return daysElapsed >= threshold;
  });
}

// ─── Avg. Time in Submitted Status ──────────────────────────────────────────

const RETAINED_STATUSES = [
  "submitted",
  "approved",
  "quote_sent_to_ho",
  "ho_approved_invoice_required",
  "invoiced",
  "invoice_paid",
];

function reduceHistory(statusHistory) {
  if (!statusHistory || statusHistory.length === 0) return [];

  const reduced = [];
  const seen = new Set();

  // Keep the final entry
  reduced.push(statusHistory[statusHistory.length - 1]);

  // Keep the first occurrence of each retained status
  for (const entry of statusHistory) {
    if (RETAINED_STATUSES.includes(entry.status) && !seen.has(entry.status)) {
      reduced.push(entry);
      seen.add(entry.status);
    }
  }

  // Sort chronologically
  reduced.sort((a, b) => new Date(a.changed_at) - new Date(b.changed_at));
  return reduced;
}

function differenceInHours(fromDate, toDate) {
  return Math.floor((toDate - fromDate) / (1000 * 60 * 60));
}

export function getAvgTimeInSubmitted(dashboardQuotes) {
  const durations = [];

  for (const q of dashboardQuotes) {
    const history = reduceHistory(q.status_history);

    for (let i = 0; i < history.length - 1; i++) {
      if (history[i].status === "submitted") {
        const hours = differenceInHours(
          new Date(history[i].changed_at),
          new Date(history[i + 1].changed_at)
        );
        durations.push(hours);
      }
    }
  }

  return durations.length > 0
    ? durations.reduce((a, b) => a + b, 0) / durations.length
    : 0;
}

// ─── Full Dashboard Calculation ─────────────────────────────────────────────

export function calculateDashboardMetrics(allQuotes, dismissedQuoteIds = new Set()) {
  const dashboardQuotes = getDashboardQuotes(allQuotes);
  const openQuotes = getOpenQuotes(dashboardQuotes);
  const closedQuotes = getClosedQuotes(dashboardQuotes);
  const approvedQuotes = getApprovedQuotes(dashboardQuotes);
  const rejectedQuotes = getRejectedQuotes(dashboardQuotes);
  const attentionQuotes = getAttentionQuotes(dashboardQuotes, dismissedQuoteIds);

  return {
    // Counts
    totalQuotes: dashboardQuotes.length,
    openCount: openQuotes.length,
    closedCount: closedQuotes.length,
    approvedCount: approvedQuotes.length,
    rejectedCount: rejectedQuotes.length,
    attentionCount: attentionQuotes.length,
    attentionQuotes,

    // Values
    totalValue: getTotalValue(dashboardQuotes),
    openValue: getTotalValue(openQuotes),
    closedValue: getTotalValue(closedQuotes),
    avgQuoteValue: getAvgQuoteValue(dashboardQuotes),

    // Rates
    approvalRate: getApprovalRate(dashboardQuotes),

    // SLA
    avgApprovalTime: getAvgApprovalTime(dashboardQuotes),
    avgTimeInSubmitted: getAvgTimeInSubmitted(dashboardQuotes),
    pendingApproval: dashboardQuotes.filter(
      (q) => q.status === "submitted" || q.status === "quote_sent_to_ho"
    ).length,
  };
}

// Avg Approval Time: average time from submitted to first approved-status change
function getAvgApprovalTime(dashboardQuotes) {
  const durations = [];
  const APPROVED_TRANSITIONS = new Set([
    "approved",
    "quote_sent_to_ho",
    "ho_approved_invoice_required",
    "invoiced",
    "invoice_paid",
    "scheduled",
  ]);

  for (const q of dashboardQuotes) {
    const history = q.status_history || [];
    let submittedDate = null;
    for (const entry of history) {
      if (entry.status === "submitted" && !submittedDate) {
        submittedDate = new Date(entry.changed_at);
      } else if (submittedDate && APPROVED_TRANSITIONS.has(entry.status)) {
        durations.push(differenceInHours(submittedDate, new Date(entry.changed_at)));
        break; // Only count first transition out of submitted to an approved status
      }
    }
  }

  return durations.length > 0
    ? durations.reduce((a, b) => a + b, 0) / durations.length
    : 0;
}
