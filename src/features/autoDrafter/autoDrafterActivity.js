import {toDateStr} from "../supervisorDashboard/dateRanges.js";
import {isWorkedEvent} from "../quoteDashboard/quoteLifecycle.js";

// Auto-Drafter cases live outside the quotes collection, so their drafts and removals are
// folded into Quotes Created / Quotes Worked here, one synthetic "quote" per case.
const REMOVAL_LABELS = {quote_not_needed: "Quote not needed", panel_rma_filed: "Panel RMA filed", other: "Other"};

const caseKey = value => String(value ?? "").trim().toLowerCase().replace(/^#\s*/, "").replace(/^0+(?=\d)/, "");

function timestamp(value) {
  if (typeof value !== "string" || !value.trim()) return null;
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function quotesByCase(quotes) {
  const map = new Map();
  for (const quote of Array.isArray(quotes) ? quotes : []) {
    if (quote?.is_current_version === false) continue;
    const key = caseKey(quote?.case_number);
    if (key && !map.has(key)) map.set(key, quote);
  }
  return map;
}

const recordCase = record => String(record?.caseNumber ?? record?.id ?? "").trim();

export const AUTO_DRAFTER_OUTCOMES = [
  {value: "awaiting", label: "Awaiting review"},
  {value: "sent", label: "Sent to Quotes"},
  {value: "quoted", label: "Quoted in EnQuote"},
  {value: "removed", label: "Removed"}
];

/** Where an Auto-Drafter case ended up, newest decision first. */
export function autoDrafterOutcome(record, quoteIndex) {
  const caseNumber = recordCase(record);
  const removal = record?.removedFromAutoDrafter;
  const realQuote = quoteIndex?.get(caseKey(caseNumber));
  const base = {caseNumber, siteId: record?.siteId || realQuote?.site_id || "", draftReference: record?.quoteNumber || "", record};
  if (removal) {
    return {...base, outcome: "removed", label: `Removed · ${REMOVAL_LABELS[removal.reason] || "Other"}`,
      reason: removal.reason, note: removal.note || "", by: removal.removedBy || "", at: removal.removedAt || null};
  }
  if (record?.sentToQuotes) {
    return {...base, outcome: "sent", label: "Sent to Quotes", quoteNumber: record.realQuoteNumber || realQuote?.quote_number || "",
      quoteId: record.realQuoteId || realQuote?.id || "", by: realQuote?.created_by_email || realQuote?.created_by || "", at: record.sentAt || null};
  }
  if (realQuote) {
    return {...base, outcome: "quoted", label: "Quoted in EnQuote", quoteNumber: realQuote.quote_number || "", quoteId: realQuote.id || "",
      by: realQuote.created_by_email || realQuote.created_by || "", at: realQuote.created_date || null};
  }
  return {...base, outcome: "awaiting", label: "Awaiting review", by: "", at: record?.generatedAt || null};
}

export function autoDrafterOutcomes(records, quotes = []) {
  const index = quotesByCase(quotes);
  return (Array.isArray(records) ? records : [])
    .filter(record => recordCase(record) && (record.draft || record.removedFromAutoDrafter || record.sentToQuotes))
    .map(record => autoDrafterOutcome(record, index))
    .sort((a, b) => String(b.at || "").localeCompare(String(a.at || "")));
}

/**
 * Activity events for Auto-Drafter work: a generated draft counts as created (unless the case
 * already has a real quote, which is counted on its own) and removing a case counts as worked.
 */
export function autoDrafterActivityEvents(records, quotes = [], now = Date.now()) {
  const index = quotesByCase(quotes);
  const events = [];
  for (const record of Array.isArray(records) ? records : []) {
    const caseNumber = recordCase(record);
    if (!caseNumber) continue;
    const removal = record.removedFromAutoDrafter;
    const quote = {
      id: `auto-drafter:${caseNumber}`,
      quote_number: record.quoteNumber || `Case ${caseNumber}`,
      case_number: caseNumber,
      site_id: record.siteId || "",
      owner_email: removal?.removedBy || "Auto-Drafter",
      auto_drafter_case: caseNumber
    };
    const generated = timestamp(record.generatedAt);
    if (record.draft && !record.sentToQuotes && !index.has(caseKey(caseNumber)) && generated !== null && generated <= now) {
      events.push({kind: "created", at: generated, actor: "Auto-Drafter", reason: null, from: null, to: null, hours: null,
        source: "Auto-Drafter draft", quote});
    }
    const removed = timestamp(removal?.removedAt);
    if (removal && removed !== null && removed <= now) {
      const label = REMOVAL_LABELS[removal.reason] || "Other";
      events.push({kind: "auto_drafter_removed", at: removed, actor: removal.removedBy || null,
        reason: removal.note ? `${label}: ${removal.note}` : label, from: null, to: null, hours: null,
        source: "Auto-Drafter removal", quote});
    }
  }
  return events;
}

function inRange(at, range = {}) {
  const day = toDateStr(new Date(at));
  return (!range.start || day >= range.start) && (!range.end || day <= range.end);
}

/** Adds Auto-Drafter drafts and removals to a buildQuoteLifecycleReport() result. */
export function withAutoDrafterActivity(report, records, {quotes = [], range = {}, now = Date.now()} = {}) {
  if (!report) return report;
  const extra = autoDrafterActivityEvents(records, quotes, now).filter(event => inRange(event.at, range));
  if (!extra.length) return report;
  const activity = [...report.activity, ...extra].sort((a, b) => b.at - a.at);
  return {
    ...report,
    activity,
    newQuotes: activity.filter(event => event.kind === "created").length,
    workedQuotes: new Set(activity.filter(isWorkedEvent).map(event => event.quote.id)).size
  };
}
