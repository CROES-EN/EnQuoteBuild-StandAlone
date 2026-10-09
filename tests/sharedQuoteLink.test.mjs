import test from "node:test";
import assert from "node:assert/strict";
import {resolveSharedQuote, canonicalSharedQuotePath} from "../src/features/collab/sharedQuoteLink.js";
import {appLinkUrl, APP_LINK_QUERY} from "../shared/appLinkRules.js";

const quote = {id: "recipient-local", base44_id: "shared-id", quote_number: "Q-6895953751"};
const api = {
  getQuoteById: async id => id === quote.id ? quote : null,
  getQuotes: async () => [quote]
};

test("shared quotes resolve exact local IDs first, then shared IDs and unique references", async () => {
  assert.equal(await resolveSharedQuote(quote.id, quote.quote_number, {
    ...api, getQuotes: () => assert.fail("Exact IDs must not load the whole list")
  }), quote);
  assert.equal(await resolveSharedQuote("shared-id", null, api), quote);
  assert.equal(await resolveSharedQuote("sender-local", quote.quote_number, api), quote);
  assert.equal(await resolveSharedQuote(null, quote.quote_number, api), quote);
  assert.equal(await resolveSharedQuote("missing", "Q-missing", api), null);
  assert.equal(await resolveSharedQuote(null, null, {
    getQuoteById: () => assert.fail(), getQuotes: () => assert.fail()
  }), null);
});

test("old chat attachments recover the reference from whole-quote and section labels", async () => {
  for (const label of ["Quote Q-6895953751", "Quote status - Q-6895953751"]) {
    const link = {type: "app_link", label, path: "/QuoteDetails?id=sender-local",
      target: {kind: "record", value: "quote:sender-local:status"}};
    const url = new URL(appLinkUrl(link), "https://local.invalid");
    assert.equal(url.searchParams.get("quoteNumber"), quote.quote_number);
    const resolved = await resolveSharedQuote(url.searchParams.get("id"), url.searchParams.get("quoteNumber"), api);
    assert.equal(resolved, quote);
    const canonical = new URL(canonicalSharedQuotePath(url.pathname, url.search, "sender-local", resolved), url);
    assert.equal(canonical.searchParams.get("id"), quote.id, "subsequent edits must use the recipient's real ID");
    assert.deepEqual(JSON.parse(canonical.searchParams.get(APP_LINK_QUERY)),
      {kind: "record", value: "quote:recipient-local:status"});
  }
});

test("canonical routes preserve page targets, filters, and unrelated targets", () => {
  for (const target of [{kind: "page"}, {kind: "record", value: "quote:sender-local"},
    {kind: "record", value: "quote:sender-local-other:status"}]) {
    const params = new URLSearchParams({id: "sender-local", quoteNumber: quote.quote_number,
      filter: "paid", [APP_LINK_QUERY]: JSON.stringify(target)});
    const path = canonicalSharedQuotePath("/QuoteDetails", `?${params}`, "sender-local", quote);
    const result = new URL(path, "https://local.invalid").searchParams;
    assert.equal(result.get("filter"), "paid");
    assert.equal(result.get("quoteNumber"), quote.quote_number);
    assert.deepEqual(JSON.parse(result.get(APP_LINK_QUERY)), target.value === "quote:sender-local"
      ? {kind: "record", value: `quote:${quote.id}`} : target);
  }
});

test("ambiguous references never open an arbitrary quote and storage errors remain explicit", async () => {
  const duplicates = {...api, getQuotes: async () => [quote, {...quote, id: "other"}]};
  await assert.rejects(resolveSharedQuote("missing", quote.quote_number, duplicates), /multiple records/);
  await assert.rejects(resolveSharedQuote("shared-id", null, duplicates), /multiple records/);
  await assert.rejects(resolveSharedQuote("missing", quote.quote_number, {
    ...api, getQuoteById: async () => {throw new Error("Storage unavailable");}
  }), /Storage unavailable/);
  await assert.rejects(resolveSharedQuote("missing", quote.quote_number, {
    ...api, getQuotes: async () => {throw new Error("Quote list unavailable");}
  }), /Quote list unavailable/);
});

test("legacy parsing is quote-only and never overrides an explicit reference", () => {
  const link = {type: "app_link", label: "Quote Q-123", path: "/Quotes",
    target: {kind: "page"}};
  assert.equal(new URL(appLinkUrl(link), "https://local.invalid").searchParams.has("quoteNumber"), false);
  link.path = "/QuoteDetails?id=one&quoteNumber=Q-456";
  assert.equal(new URL(appLinkUrl(link), "https://local.invalid").searchParams.get("quoteNumber"), "Q-456");
});
