import assert from "node:assert/strict";
import { test } from "node:test";
import {
  buildCaseIdIndex,
  caseLinkFor,
  caseNumberKey,
  enlightenSiteUrl,
  normalizeSiteId,
  salesforceCaseSearchUrl,
  salesforceCaseUrl
} from "../src/lib/externalLinks.js";

test("builds Salesforce case and Enlighten site URLs", () => {
  assert.equal(salesforceCaseUrl("500Ps00001k7UchIAE"), "https://enphase.lightning.force.com/lightning/r/Case/500Ps00001k7UchIAE/view");
  assert.equal(salesforceCaseUrl("not-an-id"), "");
  assert.equal(enlightenSiteUrl("2272060"), "https://enlighten.enphaseenergy.com/admin/sites/2272060");
  assert.equal(enlightenSiteUrl(" 2,272,060 "), "https://enlighten.enphaseenergy.com/admin/sites/2272060");
  assert.equal(enlightenSiteUrl("2272060.0"), "https://enlighten.enphaseenergy.com/admin/sites/2272060");
  assert.equal(enlightenSiteUrl("N/A"), "");
  assert.equal(normalizeSiteId("SUB-123"), "");
});

test("matches case numbers regardless of leading zeros", () => {
  assert.equal(caseNumberKey("01234567"), "1234567");
  assert.equal(caseNumberKey("1234567"), "1234567");
  assert.equal(caseNumberKey(""), "");
  const index = buildCaseIdIndex([
    { "Case Number": "01234567", "Case ID": "500Ps00001k7UchIAE" },
    { "Case Number": "999", "Case ID": "" }
  ]);
  assert.equal(index.get("1234567"), "500Ps00001k7UchIAE");
  assert.equal(index.has("999"), false);
});

test("prefers the record page and falls back to a Salesforce search", () => {
  const index = new Map([["1234567", "500Ps00001k7UchIAE"]]);
  assert.deepEqual(caseLinkFor("1234567", { index }), { url: salesforceCaseUrl("500Ps00001k7UchIAE"), exact: true });
  assert.deepEqual(caseLinkFor("x", { caseId: "500Ps00001k7UchIAE" }), { url: salesforceCaseUrl("500Ps00001k7UchIAE"), exact: true });
  const fallback = caseLinkFor("07654321", { index });
  assert.equal(fallback.exact, false);
  assert.equal(fallback.url, salesforceCaseSearchUrl("07654321"));
  const decoded = JSON.parse(Buffer.from(fallback.url.split("#")[1], "base64").toString("utf8"));
  assert.equal(decoded.attributes.term, "07654321");
  assert.equal(caseLinkFor("", { index }), null);
  assert.equal(caseLinkFor("N/A", { index }), null);
});
