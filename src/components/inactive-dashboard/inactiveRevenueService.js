import {base44} from "@/api/base44Client";
import {getQuotes, getReviews, isBase44DataSource, listLocalCollection} from "@/api/dataClient";
import {loadInactiveRevenueData} from "./loadInactiveRevenueData";
import {
  fetchInactiveDrilldown,
  fetchInactiveSummary,
  inactiveDateInRange,
  inactiveDecisionKey,
  localInactiveQuotes,
  summarizeLocalInactiveData
} from "./inactiveRevenueClient";

const invoke = (name, payload) => base44.functions.invoke(name, payload);
const loadLocal = () => loadInactiveRevenueData({getQuotes, getReviews, listLocalCollection});

/** Base44 modes use the authenticated read-only endpoint; local modes calculate from local records. */
export async function getInactiveSummary(range) {
  if (isBase44DataSource) return fetchInactiveSummary(invoke, range);
  return summarizeLocalInactiveData(await loadLocal(), range);
}

export async function getInactiveDrilldown({start, end, category, reason}) {
  if (isBase44DataSource) return fetchInactiveDrilldown(invoke, {start, end, category, reason});
  const data = await loadLocal();
  const range = {start, end};
  if (category === "homeowner_decisions") {
    return localInactiveQuotes(data, range).filter(quote => !reason || inactiveDecisionKey(quote) === reason);
  }
  const sources = {rejection_reviews: data.reviews, site_flags: data.flags, deletion_requests: data.deletions, rmas: data.rmas, material_orders: data.orders};
  if (!Object.hasOwn(sources, category)) throw new Error(`Unknown inactive collection: ${category}`);
  return sources[category].filter(item => inactiveDateInRange(item, range));
}

export async function getBoneyardQuotes(start, end) {
  if (isBase44DataSource) {
    const quotes = await fetchInactiveDrilldown(invoke, {
      start: start || "0001-01-01", end: end || "9999-12-31", category: "homeowner_decisions"
    });
    return quotes.filter(quote => quote.status === "on_hold" && quote.is_current_version !== false);
  }
  const quotes = await getQuotes();
  return quotes.filter(quote => quote.status === "on_hold" && quote.is_current_version !== false);
}
