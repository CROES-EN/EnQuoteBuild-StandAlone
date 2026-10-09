import assert from "node:assert/strict";
import test from "node:test";
import {filterRefundRequests, formatRefundAmount, sortRefundRequests} from "../src/features/refundRequests/refundRequestData.js";

const requests = [
  {id: "older", submittedAt: "2026-10-01T10:00:00.000Z", status: "New", subscriptionId: "S-1", siteId: "SITE-1", customerName: "Casey", requestorName: "Riley", requestorEmail: "riley@example.com", requestorDepartment: "Care", refundType: "Full Refund", leadershipApprovalRequired: true, refundAmountRequested: 100},
  {id: "newer", submittedAt: "2026-10-08T10:00:00.000Z", status: "Approved", subscriptionId: "S-2", siteId: "SITE-2", customerName: "Jordan", requestorName: "Morgan", requestorEmail: "morgan@example.com", requestorDepartment: "Sales", refundType: "Partial Refund", leadershipApprovalRequired: false, refundAmountRequested: 25.5}
];

test("refund queue defaults to most recently submitted and searches request/customer identifiers", () => {
  assert.deepEqual(sortRefundRequests(requests).map((request) => request.id), ["newer", "older"]);
  assert.deepEqual(filterRefundRequests(requests, {
    search: "RILEY@EXAMPLE.COM", status: "", department: "", refundType: "", approvalRequired: "", submittedFrom: "", submittedThrough: ""
  }).map((request) => request.id), ["older"]);
});

test("refund queue combines status, approval, type, department and submitted date filters", () => {
  const filters = {
    search: "", status: "New", department: "Care", refundType: "Full Refund",
    approvalRequired: "yes", submittedFrom: "2026-10-01", submittedThrough: "2026-10-01"
  };
  assert.deepEqual(filterRefundRequests(requests, filters).map((request) => request.id), ["older"]);
  assert.deepEqual(filterRefundRequests(requests, {...filters, status: "Closed"}), []);
});

test("refund amounts are formatted as USD with cents", () => {
  assert.equal(formatRefundAmount(129.95), "$129.95");
});
