import test from "node:test";
import assert from "node:assert/strict";
import {formatWorkloadCell} from "../src/features/supervisorDashboard/workloadCellFormatting.js";

test("workload ages display completed whole days without changing other columns", () => {
  for (const column of ["Age (Days)", "Age(Days)"]) {
    assert.equal(formatWorkloadCell(column, 12.9), "12");
    assert.equal(formatWorkloadCell(column, "0.75"), "0");
    assert.equal(formatWorkloadCell(column, "1,234.56"), "1234");
    assert.equal(formatWorkloadCell(column, 0), "0");
    assert.equal(formatWorkloadCell(column, 15), "15");
    assert.equal(formatWorkloadCell(column, null), "");
    assert.equal(formatWorkloadCell(column, ""), "");
    assert.equal(formatWorkloadCell(column, "Unknown"), "Unknown");
  }
  assert.equal(formatWorkloadCell("Case Number", "00123456"), "00123456");
  assert.equal(formatWorkloadCell("Subject", "12.9"), "12.9");
});
