import { parseISO } from "date-fns";

export const APPROVER_EMAILS = [
  "smosley@enphaseenergy.com",
  "ajennings@enphaseenergy.com",
  "tmeyer@enphaseenergy.com",
  "cmckenna@enphaseenergy.com",
];

export const INVOICER_EMAILS = [
  "clmorrow@enphaseenergy.com",
  "vseganos@enphaseenergy.com",
  "dankenman@enphaseenergy.com",
];

// Defines which alert roles each invoicer is eligible to receive.
// clmorrow = invoicer-only; vseganos & dankenman = invoicer + submitter.
export const INVOICER_ELIGIBILITY = {
  "clmorrow@enphaseenergy.com": ["invoicer"],
  "vseganos@enphaseenergy.com": ["invoicer", "submitter"],
  "dankenman@enphaseenergy.com": ["invoicer", "submitter"],
};

const COMPANY_DOMAIN = "enphaseenergy.com";
export const PRIORITY_RANK = { green: 0, yellow: 1, orange: 2, red: 3 };

// Only quotes moved to Invoice Paid on/after this date are flagged for scheduling.
// Prior quotes (the existing backlog) are exempt so they aren't retroactively
// marked as requiring attention. ~24h lookback from the 2026-07-08 cutover.
export const INVOICE_PAID_ALERT_CUTOFF = new Date("2026-07-07T00:00:00-06:00");

function getStatusDate(quote) {
  if (quote.status_history?.length > 0) {
    return parseISO(quote.status_history[quote.status_history.length - 1].changed_at);
  }
  if (quote.created_date) {
    return parseISO(quote.created_date);
  }
  return null;
}

function getHoursElapsed(date) {
  if (!date) return 0;
  return (Date.now() - date.getTime()) / (1000 * 60 * 60);
}

function buildAlert(quote, config) {
  const statusDate = getStatusDate(quote);
  const hoursInStatus = getHoursElapsed(statusDate);

  let level = null;
  if (config.isNotification) {
    level = "yellow";
  } else {
    if (config.red_hours && hoursInStatus >= config.red_hours) {
      level = "red";
    } else if (config.yellow_hours && hoursInStatus >= config.yellow_hours) {
      level = "yellow";
    }
  }

  if (!level) return null;

  let timeLabel = "";
  if (config.isNotification) {
    timeLabel = "ACTION NEEDED";
  } else if (level === "red" && config.red_hours) {
    const overdue = Math.round(hoursInStatus - config.red_hours);
    timeLabel = `${overdue} HR${overdue !== 1 ? "S" : ""} OVERDUE`;
  } else if (level === "yellow" && config.red_hours) {
    const remaining = Math.max(0, Math.round(config.red_hours - hoursInStatus));
    timeLabel = `${remaining} HR${remaining !== 1 ? "S" : ""} TO RED`;
  } else if (level === "yellow" && config.yellow_hours) {
    const elapsed = Math.round(hoursInStatus);
    timeLabel = `${elapsed} HR${elapsed !== 1 ? "S" : ""} IN STATUS`;
  }

  return {
    rule_id: config.rule_id,
    name: config.name,
    level,
    alert_role: config.alert_role,
    description: config.description,
    hoursInStatus: Math.round(hoursInStatus),
    timeLabel,
    target_statuses: config.target_statuses || [],
    isNotification: config.isNotification || false,
    statusDate,
  };
}

export function computeQuoteAlert(quote) {
  if (!quote || !quote.status) return null;
  if (quote.status === "on_hold") return null;
  if (quote.exclude_from_reporting) return null;

  const wasSubmitted = (quote.status_history || []).some(
    (e) => e.status === "submitted"
  );

  switch (quote.status) {
    case "draft_without_internal":
    case "draft_without_fst":
      if (!wasSubmitted) {
        return buildAlert(quote, {
          rule_id: "draft_to_submitted",
          name: "Submit Draft",
          alert_role: "submitter",
          yellow_hours: 72,
          red_hours: 120,
          target_statuses: ["submitted"],
          description: "Submit draft quote for approval (3–5 business days)",
        });
      }
      return buildAlert(quote, {
        rule_id: "resubmit_missing",
        name: "Resubmit Quote",
        alert_role: "submitter",
        red_hours: 24,
        target_statuses: ["submitted"],
        description: "Fix missing details and resubmit (24 hrs)",
      });

    case "submitted":
      return buildAlert(quote, {
        rule_id: "awaiting_approval",
        name: "Review Quote",
        alert_role: "approver",
        red_hours: 24,
        target_statuses: ["approved", "rejected", "draft_without_fst"],
        description: "Review and approve/reject submitted quote (24 hrs)",
      });

    case "rejected":
      return buildAlert(quote, {
        rule_id: "resubmit_rejected",
        name: "Resubmit Quote",
        alert_role: "submitter",
        red_hours: 24,
        target_statuses: ["submitted"],
        description: "Address rejection reason and resubmit (24 hrs)",
      });

    case "approved":
      return buildAlert(quote, {
        rule_id: "send_to_ho",
        name: "Send to HO",
        alert_role: "submitter",
        red_hours: 24,
        target_statuses: ["quote_sent_to_ho"],
        description: "Send approved quote to Home Office (24 hrs)",
      });

    case "quote_sent_to_ho":
      return buildAlert(quote, {
        rule_id: "awaiting_ho",
        name: "HO Decision",
        alert_role: "submitter",
        red_hours: 48,
        target_statuses: ["ho_approved_invoice_required", "ho_rejected"],
        description: "Awaiting Home Office approval/rejection (48 hrs)",
      });

    case "ho_rejected":
      if (quote.ho_rejection_reason && quote.ho_rejection_reason.trim()) {
        return null;
      }
      return buildAlert(quote, {
        rule_id: "ho_rejected_feedback",
        name: "Log HO Feedback",
        alert_role: "submitter_approver",
        red_hours: 48,
        target_statuses: [],
        description: "Log feedback for HO rejection (48 hrs)",
      });

    case "ho_approved_invoice_required":
      return buildAlert(quote, {
        rule_id: "create_invoice",
        name: "Create Invoice",
        alert_role: "invoicer",
        yellow_hours: 24,
        red_hours: 48,
        target_statuses: ["invoiced"],
        description: "Create and send invoice (24–48 hrs)",
      });

    case "invoiced":
      return buildAlert(quote, {
        rule_id: "awaiting_payment",
        name: "Follow Up Payment",
        alert_role: "submitter",
        red_hours: 48,
        target_statuses: ["invoice_paid"],
        description: "Follow up on payment every 48 hrs until received",
      });

    case "invoice_paid": {
      const paidDate = quote.invoice_paid_date
        ? parseISO(quote.invoice_paid_date)
        : getStatusDate(quote);
      if (paidDate && paidDate < INVOICE_PAID_ALERT_CUTOFF) return null;
      return buildAlert(quote, {
        rule_id: "schedule_site_visit",
        name: "Schedule Site Visit",
        alert_role: "submitter_invoicer",
        yellow_hours: 48,
        red_hours: 96,
        target_statuses: ["scheduled"],
        description: "Move to Scheduled once handed off to Scheduling (48 hrs)",
      });
    }

    case "scheduled":
      return null;

    default:
      return null;
  }
}

export function getAlertAssignees(alert, quote) {
  if (!alert) return [];
  const submitter = quote.owner_email || quote.created_by;
  const assignees = new Set();
  const roles = alert.alert_role.split("_");
  if (roles.includes("submitter") && submitter) {
    const eligibility = INVOICER_ELIGIBILITY[submitter];
    if (!eligibility || eligibility.includes("submitter")) {
      assignees.add(submitter);
    }
  }
  if (roles.includes("approver")) APPROVER_EMAILS.forEach((e) => assignees.add(e));
  if (roles.includes("invoicer")) {
    INVOICER_EMAILS.forEach((e) => {
      const eligibility = INVOICER_ELIGIBILITY[e];
      if (!eligibility || eligibility.includes("invoicer")) {
        assignees.add(e);
      }
    });
  }
  return [...assignees];
}

export function userHasAlertAccess(alert, quote, userEmail, isAdmin) {
  if (!alert) return false;
  if (isAdmin) return true;
  return getAlertAssignees(alert, quote).includes(userEmail);
}

export function getEffectiveLevel(alert, hasMention, mentionPriority) {
  const levels = [];
  if (alert?.level) levels.push(alert.level);
  if (hasMention && mentionPriority) levels.push(mentionPriority);
  if (levels.length === 0) return null;
  return levels.sort((a, b) => PRIORITY_RANK[b] - PRIORITY_RANK[a])[0];
}

export function parseMentions(text) {
  if (!text) return [];
  const regex = /@([a-zA-Z][a-zA-Z0-9._]*)/g;
  const mentions = [];
  const seen = new Set();
  let match;
  while ((match = regex.exec(text)) !== null) {
    const username = match[1].toLowerCase();
    const email = `${username}@${COMPANY_DOMAIN}`;
    if (!seen.has(email)) {
      seen.add(email);
      mentions.push({ username, email });
    }
  }
  return mentions;
}