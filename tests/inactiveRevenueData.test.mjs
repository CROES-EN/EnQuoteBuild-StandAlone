import test from "node:test";
import assert from "node:assert/strict";
import {loadInactiveRevenueData} from "../src/components/inactive-dashboard/loadInactiveRevenueData.js";

function readers(overrides = {}) {
  return {
    getQuotes: async () => [{id: "quote", status: "on_hold", total: 100}],
    getReviews: async () => [{id: "review"}],
    listLocalCollection: async name => [{id: name}],
    ...overrides
  };
}

test("inactive report returns all six collections with existing local names", async () => {
  const data = await loadInactiveRevenueData(readers());
  assert.deepEqual(Object.keys(data), ["quotes", "reviews", "flags", "deletions", "rmas", "orders"]);
  assert.equal(data.quotes[0].total, 100);
  assert.equal(data.reviews[0].id, "review");
  assert.equal(data.deletions[0].id, "deletionRequests");
  assert.equal(data.rmas[0].id, "rmas");
});

test("failed and malformed requests reject explicitly instead of producing zero totals", async () => {
  await assert.rejects(loadInactiveRevenueData(readers({
    getReviews: async () => { throw new Error("Access denied"); }
  })), /Could not load reviews: Access denied/);
  await assert.rejects(loadInactiveRevenueData(readers({
    listLocalCollection: async name => {
      if (name === "rmas") throw new Error("Unavailable");
      return [];
    }
  })), /Could not load rmas: Unavailable/);
  await assert.rejects(loadInactiveRevenueData(readers({
    getQuotes: async () => undefined
  })), /Could not load quotes: Expected a list of records/);
  const empty = await loadInactiveRevenueData({
    getQuotes: async () => [],
    getReviews: async () => [],
    listLocalCollection: async () => []
  });
  assert.ok(Object.values(empty).every(records => records.length === 0));
});
