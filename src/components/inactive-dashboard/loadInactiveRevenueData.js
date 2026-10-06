/** Reject failed or malformed sources rather than presenting incomplete revenue totals as zero. */
export async function loadInactiveRevenueData({getQuotes, getReviews, listLocalCollection}) {
  const sources = {
    quotes: () => getQuotes(),
    reviews: () => getReviews(),
    flags: () => listLocalCollection("siteFlags"),
    deletions: () => listLocalCollection("deletionRequests"),
    rmas: () => listLocalCollection("rmas"),
    orders: () => listLocalCollection("materialOrders")
  };
  const entries = await Promise.all(Object.entries(sources).map(async ([name, read]) => {
    try {
      const records = await read();
      if (!Array.isArray(records)) throw new Error("Expected a list of records");
      return [name, records];
    } catch (error) {
      throw new Error(`Could not load ${name}: ${error instanceof Error ? error.message : String(error)}`, {cause: error});
    }
  }));
  return Object.fromEntries(entries);
}
