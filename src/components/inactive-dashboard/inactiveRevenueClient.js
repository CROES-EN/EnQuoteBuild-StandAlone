const COLLECTIONS = ["rejection_reviews", "site_flags", "deletion_requests", "rmas", "material_orders"];
const REASONS = ["no_customer_response", "cost", "scheduling", "homeowner_cancelled", "homeowner_declined", "other"];

function isCount(value) {
  return Number.isInteger(value) && value >= 0;
}

export function validateInactiveSummary(data) {
  if (!data || typeof data !== "object"
    || typeof data.range?.start !== "string" || typeof data.range?.end !== "string"
    || ![data.inactive, data.boneyard].every(item => isCount(item?.count) && Number.isFinite(item?.revenue))
    || !COLLECTIONS.every(key => isCount(data.collections?.[key]))
    || !REASONS.every(key => isCount(data.decision_reasons?.[key]))) {
    throw new Error("Inactive revenue endpoint returned an invalid summary.");
  }
  return data;
}

async function invokeReport(invoke, payload) {
  const response = await invoke("getInactiveRevenueDashboard", payload);
  const data = response?.data;
  if (data?.error) throw new Error(typeof data.error === "string" ? data.error : "Inactive revenue request failed.");
  if (!data) throw new Error("Inactive revenue endpoint returned no data.");
  return data;
}

export async function fetchInactiveSummary(invoke, range) {
  return validateInactiveSummary(await invokeReport(invoke, {start: range.start, end: range.end}));
}

/** Retrieve every drill-down page; a broken cursor must fail rather than truncate or loop. */
export async function fetchInactiveDrilldown(invoke, {start, end, category, reason}) {
  const items = [];
  let offset = 0;
  let total;
  do {
    const data = await invokeReport(invoke, {start, end, category, ...(reason ? {reason} : {}), limit: 100, offset});
    const page = data.drilldown;
    if (!page || !Array.isArray(page.items) || !isCount(page.total)
      || (page.next_offset !== null && (!isCount(page.next_offset) || page.next_offset <= offset))) {
      throw new Error("Inactive revenue endpoint returned an invalid drill-down page.");
    }
    if (total !== undefined && total !== page.total) {
      throw new Error("Inactive revenue records changed while loading. Please try again.");
    }
    total = page.total;
    items.push(...page.items);
    if (items.length > total || (page.next_offset !== null && page.items.length === 0)) {
      throw new Error("Inactive revenue endpoint returned inconsistent pagination.");
    }
    offset = page.next_offset;
  } while (offset !== null);
  if (items.length !== total) throw new Error("Inactive revenue drill-down is incomplete. Please try again.");
  return items;
}

export function inactiveDateInRange(item, range, field = "created_date") {
  const date = item[field] || item.updated_date || item.created_date;
  return date && date.slice(0, 10) >= range.start && date.slice(0, 10) <= range.end;
}

export function inactiveDecisionKey(quote) {
  const text = `${quote.hold_reason || ""} ${quote.ho_rejection_reason || ""}`.toLowerCase();
  if (text.includes("no_customer_response") || text.includes("no customer response") || text.includes("no response")) return "no_customer_response";
  if (text.includes("cost") || text.includes("price") || text.includes("financ")) return "cost";
  if (text.includes("schedul")) return "scheduling";
  if (text.includes("homeowner_cancelled") || text.includes("cancel")) return "homeowner_cancelled";
  if (text.includes("homeowner_declined") || text.includes("declin")) return "homeowner_declined";
  return "other";
}

export function localInactiveQuotes(data, range) {
  return data.quotes.filter(quote => quote.is_current_version !== false
    && ["on_hold", "ho_rejected", "rejected"].includes(quote.status)
    && inactiveDateInRange(quote, range, quote.status === "on_hold" ? "hold_date" : "ho_rejected_date"));
}

export function summarizeLocalInactiveData(data, range) {
  const quotes = localInactiveQuotes(data, range);
  const boneyard = quotes.filter(quote => quote.status === "on_hold");
  const totals = records => ({
    count: records.length,
    revenue: records.reduce((sum, quote) => sum + Number(quote.total || 0), 0)
  });
  const sources = {rejection_reviews: data.reviews, site_flags: data.flags, deletion_requests: data.deletions, rmas: data.rmas, material_orders: data.orders};
  const reasons = Object.fromEntries(REASONS.map(key => [key, 0]));
  quotes.forEach(quote => { reasons[inactiveDecisionKey(quote)]++; });
  return validateInactiveSummary({
    range,
    inactive: totals(quotes),
    boneyard: totals(boneyard),
    collections: Object.fromEntries(COLLECTIONS.map(key => [key, sources[key].filter(item => inactiveDateInRange(item, range)).length])),
    decision_reasons: reasons
  });
}
