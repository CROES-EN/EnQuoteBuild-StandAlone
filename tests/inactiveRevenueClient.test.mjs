import test from "node:test";
import assert from "node:assert/strict";
import {
  fetchInactiveSummary, fetchInactiveDrilldown, summarizeLocalInactiveData
} from "../src/components/inactive-dashboard/inactiveRevenueClient.js";

const range = {start: "2026-09-01", end: "2026-10-06"};
const summary = {
  range,
  inactive: {count: 50, revenue: 120815.52953000004},
  boneyard: {count: 48, revenue: 112062.24207500003},
  collections: {rejection_reviews: 7, site_flags: 2, deletion_requests: 1, rmas: 9, material_orders: 16},
  decision_reasons: {no_customer_response: 10, cost: 2, scheduling: 2, homeowner_cancelled: 1, homeowner_declined: 1, other: 34},
  drilldown: {items: [], total: 0, next_offset: null}
};

test("summary uses the provided endpoint contract without recalculating or rounding revenue", async () => {
  const data = await fetchInactiveSummary(async (name, payload) => {
    assert.equal(name, "getInactiveRevenueDashboard");
    assert.deepEqual(payload, range);
    return {data: summary};
  }, range);
  assert.deepEqual(data, summary);
});

test("drill-down reads every page beyond 2000 records and forwards reason and dates", async () => {
  const offsets = [];
  const items = await fetchInactiveDrilldown(async (name, payload) => {
    assert.equal(name, "getInactiveRevenueDashboard");
    assert.equal(payload.limit, 100);
    assert.equal(payload.reason, "cost");
    assert.equal(payload.category, "homeowner_decisions");
    assert.equal(payload.start, range.start);
    offsets.push(payload.offset);
    const length = Math.min(100, 2051 - payload.offset);
    return {data: {drilldown: {
      items: Array.from({length}, (_, index) => ({id: payload.offset + index})),
      total: 2051,
      next_offset: payload.offset + length < 2051 ? payload.offset + length : null
    }}};
  }, {...range, category: "homeowner_decisions", reason: "cost"});
  assert.equal(items.length, 2051);
  assert.equal(items[2050].id, 2050);
  assert.equal(offsets.length, 21);
});

test("endpoint failures and incomplete results are explicit, not success-shaped fallbacks", async () => {
  await assert.rejects(fetchInactiveSummary(async () => {throw new Error("403 Forbidden");}, range), /403 Forbidden/);
  await assert.rejects(fetchInactiveSummary(async () => ({data: {error: "Not authorized"}}), range), /Not authorized/);
  await assert.rejects(fetchInactiveSummary(async () => undefined, range), /returned no data/);
  await assert.rejects(fetchInactiveSummary(async () => ({data: {...summary, collections: {}}}), range), /invalid summary/);
  const loadPage = drilldown => fetchInactiveDrilldown(async () => ({data: {drilldown}}), {...range, category: "rmas"});
  await assert.rejects(loadPage({items: [{id: 1}], total: 2, next_offset: null}), /incomplete/);
  await assert.rejects(loadPage({items: [{id: 1}], total: 2, next_offset: 0}), /invalid drill-down/);
  assert.deepEqual(await loadPage({items: [], total: 0, next_offset: null}), []);
});

test("local summary matches status, version, date fallbacks, reasons, and money rules", () => {
  const data = {
    quotes: [
      {status: "on_hold", hold_date: range.start, total: 10, hold_reason: "no response cost"},
      {status: "ho_rejected", updated_date: range.end, total: 20, ho_rejection_reason: "cost"},
      {status: "rejected", created_date: range.end, total: 5},
      {status: "on_hold", hold_date: range.start, total: 999, is_current_version: false},
      {status: "approved", created_date: range.start, total: 999},
      {status: "on_hold", hold_date: "2026-08-31", updated_date: range.end, total: 999}
    ],
    reviews: [{created_date: range.start}], flags: [], deletions: [], rmas: [], orders: []
  };
  const result = summarizeLocalInactiveData(data, range);
  assert.deepEqual(result.inactive, {count: 3, revenue: 35});
  assert.deepEqual(result.boneyard, {count: 1, revenue: 10});
  assert.equal(result.decision_reasons.no_customer_response, 1);
  assert.equal(result.decision_reasons.cost, 1);
  assert.equal(result.decision_reasons.other, 1);
  assert.equal(result.collections.rejection_reviews, 1);
});
