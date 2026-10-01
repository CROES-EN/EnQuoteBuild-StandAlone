const assert = require("node:assert/strict");
const test = require("node:test");
const {
  applyVerifiedQuoteCreator,
  applyVerifiedQuoteUpdate,
  requireVerifiedEmail
} = require("../../electron/quoteAttribution.cjs");

test("stamps newly created quotes with the verified Cloudflare user", () => {
  const attributed = applyVerifiedQuoteCreator({
    site_id: "test-site",
    status_history: [{ status: "submitted", changed_by: "stale@example.com" }]
  }, { email: " Shane.Mosley@EnphaseEnergy.com " });

  assert.equal(attributed.owner_email, "shane.mosley@enphaseenergy.com");
  assert.equal(attributed.status_history[0].changed_by, "shane.mosley@enphaseenergy.com");
});

test("attributes new status history entries and quote updates to the verified user", () => {
  const current = {
    status_history: [{ status: "draft", changed_by: "creator@example.com" }]
  };
  const changes = {
    status: "submitted",
    status_history: [
      current.status_history[0],
      { status: "submitted", changed_by: "stale@example.com" }
    ]
  };

  const attributed = applyVerifiedQuoteUpdate(current, changes, { email: "shane@enphaseenergy.com" });

  assert.equal(attributed.last_updated_by, "shane@enphaseenergy.com");
  assert.equal(attributed.status_history[0].changed_by, "creator@example.com");
  assert.equal(attributed.status_history[1].changed_by, "shane@enphaseenergy.com");
});

test("does not accept quote writes without a verified identity", () => {
  assert.throws(() => requireVerifiedEmail(null), /Verified Cloudflare identity is unavailable/);
  assert.throws(() => applyVerifiedQuoteCreator({ site_id: "test-site" }, null), /Verified Cloudflare identity is unavailable/);
});
