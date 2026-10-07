import {diffDays, toDateStr} from "../supervisorDashboard/dateRanges.js";
import {AGGREGATION_MODES} from "../supervisorDashboard/periodAggregation.js";

export const reviewCaseKey = value => String(value ?? "").trim().toLowerCase();

export function validateRequestReview(record) {
  if (record.kind !== "quote_request_review" || record.version !== 1 ||
      !["mark", "undo"].includes(record.action) ||
      typeof record.caseNumber !== "string" || !record.caseNumber.trim() ||
      typeof record.at !== "string" || !Number.isFinite(Date.parse(record.at)) ||
      typeof record.reviewer !== "string" || !record.reviewer.trim() ||
      typeof record.reason !== "string" || typeof record.siteId !== "string" ||
      !Array.isArray(record.markIds) || record.markIds.some(id => typeof id !== "string")) {
    throw new Error("A shared quote request review is invalid. Contact an administrator before drafting.");
  }
  return record;
}

export function assertRequestCanBeDrafted(events, caseNumber) {
  if (activeImproperRequests(events).has(reviewCaseKey(caseNumber))) {
    throw new Error("This request is marked improper. Undo the mark in Auto-Drafter before drafting.");
  }
}

export function createRequestReview({caseNumber, siteId = "", reason = "", reviewer, action = "mark", markIds = []}) {
  const number = String(caseNumber ?? "").trim();
  if (!number || number.length > 100) throw new Error("A case number is required.");
  if (!reviewer?.trim()) throw new Error("Sign in before reviewing quote requests.");
  if (!["mark", "undo"].includes(action)) throw new Error("Invalid review action.");
  if (reason.trim().length > 2000) throw new Error("The reason must be 2,000 characters or fewer.");
  if (action === "undo" && !markIds.length) throw new Error("There is no active mark to undo.");
  const at = new Date().toISOString();
  const id = `quote-request-review:${globalThis.crypto.randomUUID()}`;
  return {
    id, reportType: id, kind: "quote_request_review", version: 1,
    caseNumber: number, siteId: String(siteId ?? "").trim(),
    reason: reason.trim(), reviewer: reviewer.trim().toLowerCase(), action,
    markIds: action === "undo" ? [...new Set(markIds)] : [],
    at, created_date: at, updated_date: at
  };
}

export function activeImproperRequests(events) {
  const undone = new Set(events.filter(event => event.action === "undo").flatMap(event => event.markIds || []));
  const byCase = new Map();
  for (const event of [...events].sort((a, b) => a.at.localeCompare(b.at) || a.id.localeCompare(b.id))) {
    if (event.action !== "mark" || undone.has(event.id)) continue;
    const key = reviewCaseKey(event.caseNumber);
    const previous = byCase.get(key);
    byCase.set(key, {...event, firstMarkedAt: previous?.firstMarkedAt || event.at, activeMarkIds: [...(previous?.activeMarkIds || []), event.id]});
  }
  return byCase;
}

export function improperRequestMetric(events, range, mode = AGGREGATION_MODES.PERIOD_TOTAL) {
  const active = activeImproperRequests(events);
  const byCase = new Map();
  const byDay = new Map();
  for (const event of [...events].sort((a, b) => a.at.localeCompare(b.at) || a.id.localeCompare(b.id))) {
    if (event.action !== "mark") continue;
    const date = toDateStr(new Date(event.at));
    if ((range.start && date < range.start) || (range.end && date > range.end)) continue;
    if (mode === AGGREGATION_MODES.LATEST_DAY && date !== range.end) continue;
    const key = reviewCaseKey(event.caseNumber);
    if (!byDay.has(date)) byDay.set(date, new Set());
    byDay.get(date).add(key);
    const previous = byCase.get(key);
    byCase.set(key, {
      ...event, firstMarkedAt: previous?.firstMarkedAt || event.at,
      markingCount: (previous?.markingCount || 0) + 1,
      currentState: active.has(key) ? "Improper" : "Restored"
    });
  }
  const records = [...byCase.values()];
  let value = records.length;
  if (mode === AGGREGATION_MODES.DAILY_AVERAGE) {
    const span = diffDays(range.start, range.end);
    const days = span === null ? null : span + 1;
    if (days === null || !Number.isFinite(days) || days <= 0) throw new Error("A valid reporting period is required.");
    value = [...byDay.values()].reduce((sum, cases) => sum + cases.size, 0) / days;
  }
  return {value, records, date: mode === AGGREGATION_MODES.LATEST_DAY ? range.end : null};
}
