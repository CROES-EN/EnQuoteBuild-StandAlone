import test from "node:test";
import assert from "node:assert/strict";
import {sharedWorkloadCase} from "../src/features/supervisorDashboard/sharedWorkloadCase.js";

const searchFor = target => `?enquoteShareTarget=${encodeURIComponent(JSON.stringify(target))}`;

test("only valid shared Workload row targets request All Cases", () => {
  for (const value of ["workload-case:005123", "workload-case:20455986"]) {
    assert.equal(sharedWorkloadCase(searchFor({kind: "record", value})), value);
  }
  for (const target of [
    {kind: "page"}, {kind: "record", value: "quote:q1"},
    {kind: "id", value: "workload-case:123"},
    {kind: "record", value: "workload-case:"},
    {kind: "record", value: `workload-case:${"x".repeat(200)}`}
  ]) assert.equal(sharedWorkloadCase(searchFor(target)), null);
  for (const search of ["", "?tab=cases", "?enquoteShareTarget=invalid", "?enquoteShareTarget=null"]) {
    assert.equal(sharedWorkloadCase(search), null);
  }
});
