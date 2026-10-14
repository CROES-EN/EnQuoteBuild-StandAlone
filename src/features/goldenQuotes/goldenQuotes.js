import {reviewCaseKey} from "../autoDrafter/caseKey.js";

// Pure RMA and upgrade workflows are excluded; Panel/Enphase RMA + On-Demand can qualify.
export const GOLDEN_ELIGIBLE_TYPES = new Set(["panel_and_quote", "enphase_and_quote", "on_demand"]);

const APPROVED_OR_LATER = new Set([
  "approved", "quote_sent_to_ho", "ho_approved_invoice_required", "invoiced", "invoice_paid",
  "invoice_paid_materials_required", "materials_pending_shipment", "scheduled", "pending_materials", "ho_rejected"
]);

const number = value => {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? Math.round(parsed * 100) / 100 : 0;
};
const text = value => String(value ?? "").trim().toLowerCase();

// Fields an editor can change on the quote. Formatting-only differences are normalized.
export function quoteContentSignature(quote = {}) {
  return JSON.stringify({
    items: (quote.items || []).map(item => [text(item.name), number(item.quantity), number(item.unit_price)]),
    labor: [text(quote.labor_mode), number(quote.labor_hours), number(quote.flat_labor_fee), number(quote.fst_count || 1)],
    travel: [number(quote.travel_hours), number(quote.miles_traveled)],
    discount: [text(quote.discount_type), number(quote.discount_percent), number(quote.discount_flat_amount)]
  });
}

export function requestSnapshot(classification, hygiene) {
  return {
    category: classification?.type || "unclassified",
    categoryLabel: classification?.label || "Unclassified",
    hygieneFlagCount: hygiene ? (hygiene.flags || []).length : null,
    author: hygiene?.author || "",
    capturedAt: new Date().toISOString()
  };
}

function quoteFamily(rootId, quotes) {
  const root = quotes.find(quote => quote.id === rootId || quote.base44_id === rootId);
  const ids = new Set([rootId, root?.id, root?.base44_id].filter(Boolean).map(String));
  return {root, family: quotes.filter(quote => ids.has(String(quote.id)) || ids.has(String(quote.parent_quote_id || "")))};
}

const statusesOf = quote => [quote.status, ...(quote.status_history || []).map(entry => entry.status)];

export function evaluateGoldenQuote(record, quotes = []) {
  const reasons = [];
  const snapshot = record?.requestSnapshot;
  if (!record?.sentToQuotes || !record.realQuoteId) return {golden: false, reasons: ["Not sent to Quotes yet."]};
  const {root: original, family} = quoteFamily(record.realQuoteId, quotes);
  if (!original) return {golden: false, reasons: ["The sent quote could not be found."]};
  if (!snapshot || snapshot.hygieneFlagCount === null || snapshot.hygieneFlagCount === undefined) {
    reasons.push("The request's SOP check was not recorded.");
  } else if (snapshot.hygieneFlagCount > 0) {
    reasons.push(`The request had ${snapshot.hygieneFlagCount} Data Hygiene ${snapshot.hygieneFlagCount === 1 ? "flag" : "flags"}.`);
  }
  if (snapshot && !GOLDEN_ELIGIBLE_TYPES.has(snapshot.category)) reasons.push(`${snapshot.categoryLabel} quotes are not eligible.`);
  if (record.editedBeforeSend) reasons.push("The Auto-Drafter draft was edited before sending.");
  if (family.length > 1 || original.is_current_version === false) reasons.push("The quote was edited after it was sent.");
  else if (quoteContentSignature(original) !== (record.sentSignature || quoteContentSignature(record.draft))) {
    reasons.push("The quote was edited after it was sent.");
  }
  if (family.some(quote => statusesOf(quote).includes("rejected"))) reasons.push("The quote was rejected.");
  else if (!family.some(quote => statusesOf(quote).some(status => APPROVED_OR_LATER.has(status)))) reasons.push("The quote is not approved yet.");
  const current = family.find(quote => quote.is_current_version !== false && quote.id !== original.id) || original;
  return {golden: reasons.length === 0, reasons, status: current.status || "draft_without_internal"};
}

export function goldenQuoteEvaluations(records = [], quotes = []) {
  const byQuoteId = new Map();
  const byCase = new Map();
  for (const record of records) {
    if (!record?.sentToQuotes || !record.realQuoteId) continue;
    const evaluation = {...evaluateGoldenQuote(record, quotes), record};
    byQuoteId.set(String(record.realQuoteId), evaluation);
    const root = quotes.find(quote => quote.id === record.realQuoteId || quote.base44_id === record.realQuoteId);
    if (root) {
      byQuoteId.set(String(root.id), evaluation);
      if (root.base44_id) byQuoteId.set(String(root.base44_id), evaluation);
    }
    byCase.set(reviewCaseKey(record.caseNumber ?? record.id), evaluation);
  }
  return {byQuoteId, byCase};
}
