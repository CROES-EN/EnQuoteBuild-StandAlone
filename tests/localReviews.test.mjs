import test from "node:test";
import assert from "node:assert/strict";
import {localAdapter} from "../src/api/adapters/localAdapter.js";
import {loadInactiveRevenueData} from "../src/components/inactive-dashboard/loadInactiveRevenueData.js";
import {summarizeLocalInactiveData} from "../src/components/inactive-dashboard/inactiveRevenueClient.js";

test("local reviews use the real collections-only bridge for reads, filters, and writes", async () => {
  const calls = [];
  const reviews = [{id: "one", quote_id: "q1"}, {id: "two", quote_id: "q2"}];
  globalThis.window = {enquoteLocal: {collections: {
    list: async name => {calls.push(["list", name]); return reviews;},
    create: async (name, record) => {calls.push(["create", name, record]); return {...record, id: "new"};},
    update: async (name, id, changes) => {calls.push(["update", name, id, changes]); return {id, ...changes};}
  }}};
  try {
    assert.deepEqual(await localAdapter.getReviews(), reviews);
    assert.deepEqual(await localAdapter.getReviewsForQuote("q1"), [reviews[0]]);
    assert.deepEqual(await localAdapter.getReviewsForQuote("missing"), []);
    assert.equal((await localAdapter.createReview({quote_id: "q1"})).id, "new");
    assert.deepEqual(await localAdapter.updateReview("one", {notes: "Updated"}), {id: "one", notes: "Updated"});
    assert.ok(calls.every(call => call[1] === "reviews"));
    assert.deepEqual(calls[4], ["update", "reviews", "one", {notes: "Updated"}]);
  } finally {
    delete globalThis.window;
  }
});

test("inactive summary loads real local collections without a reviews resource", async () => {
  const date = "2026-10-06";
  globalThis.window = {enquoteLocal: {
    quotes: {list: async () => [{status: "on_hold", hold_date: date, total: 100}]},
    collections: {list: async name => name === "reviews" ? [{id: "review", created_date: date}] : []}
  }};
  try {
    const data = await loadInactiveRevenueData(localAdapter);
    const report = summarizeLocalInactiveData(data, {start: date, end: date});
    assert.deepEqual(report.inactive, {count: 1, revenue: 100});
    assert.equal(report.collections.rejection_reviews, 1);
  } finally {
    delete globalThis.window;
  }
});

test("local review read failures remain explicit", async () => {
  globalThis.window = {enquoteLocal: {collections: {
    list: async () => {throw new Error("Collection storage unavailable");}
  }}};
  try {
    await assert.rejects(localAdapter.getReviews(), /Collection storage unavailable/);
    await assert.rejects(localAdapter.getReviewsForQuote("q1"), /Collection storage unavailable/);
  } finally {
    delete globalThis.window;
  }
});
