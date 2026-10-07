import assert from "node:assert/strict";
import test from "node:test";
import {sessionTelemetry} from "../src/features/admin/sessionTelemetry.js";

test("Heather's missing app telemetry is not treated as a version or role mismatch", () => {
  const telemetry = sessionTelemetry({appVersion: "", uiVersion: "", resolvedRole: "", effectiveRole: "admin"});
  assert.equal(telemetry.app, "Not reported");
  assert.equal(telemetry.ui, "Bundled or not reported");
  assert.equal(telemetry.effectiveRole, "admin");
  assert.equal(telemetry.missing, true);
  assert.equal(telemetry.mismatch, false);
});

test("real role mismatches are distinct from a bundled UI", () => {
  const telemetry = sessionTelemetry({appVersion: "1.3.0", uiVersion: "", resolvedRole: "submitter", effectiveRole: "admin"});
  assert.equal(telemetry.app, "1.3.0");
  assert.equal(telemetry.missing, false);
  assert.equal(telemetry.mismatch, true);
});
