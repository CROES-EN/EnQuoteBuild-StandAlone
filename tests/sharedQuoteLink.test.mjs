import test from "node:test";
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import {resolveSharedQuote, canonicalSharedQuotePath, SharedQuoteAmbiguityError} from "../src/features/collab/sharedQuoteLink.js";
import {appLinkUrl, APP_LINK_QUERY, quoteDetailsPath, quoteReferenceFromLabel} from "../shared/appLinkRules.js";

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

test("task and standard message links recover sender-local IDs using their existing labels", async () => {
  for (const label of ["Q-5240439513", "Q-1922268842", "AI-123", "Quote Q-5240439513"]) {
    const stored = {...quote, quote_number: quoteReferenceFromLabel(label)};
    const path = new URL(quoteDetailsPath("sender/id & value", label), "https://local.invalid");
    assert.equal(path.searchParams.get("id"), "sender/id & value");
    assert.equal(path.searchParams.get("quoteNumber"), stored.quote_number);
    const resolved = await resolveSharedQuote(path.searchParams.get("id"), path.searchParams.get("quoteNumber"), {
      getQuoteById: async () => null,
      getQuotes: async () => Array.from({length: 3000}, (_, i) => ({id: `other-${i}`, quote_number: `Q-other-${i}`})).concat(stored)
    });
    assert.equal(resolved, stored, "searches every stored quote, not a recent or visible page");
  }
});

test("lookup includes older versions, normalizes references, and supports numeric synchronized IDs", async () => {
  const old = {...quote, quote_number: " q-123 ", is_current_version: false};
  const all = {...api, getQuoteById: async () => null, getQuotes: async () => [old]};
  assert.equal(await resolveSharedQuote("missing", "Q-123", all), old);
  assert.equal(await resolveSharedQuote("Q-123", null, all), old);
  assert.equal(await resolveSharedQuote("123", null, {...all, getQuotes: async () => [{...old, id: 123}]}).then(q => q.id), 123);
  await assert.rejects(resolveSharedQuote("missing", "Q-123", {...all, getQuotes: async () => [old, {...old, id:"another", quote_number:"Q-123"}]}), /multiple records/);
  assert.equal(new URL(quoteDetailsPath("draft", "Draft (Site 123)"), "https://local.invalid").searchParams.has("quoteNumber"), false);
});

test("bare-reference selector attachments use the same fallback as tasks and messages", () => {
  const url = new URL(appLinkUrl({type:"app_link", label:"Q-1922268842", path:"/QuoteDetails?id=sender",
    target:{kind:"page"}}), "https://local.invalid");
  assert.equal(url.searchParams.get("quoteNumber"), "Q-1922268842");
});

test("task badges and message attachments wire their persisted labels into the shared lookup", () => {
  for (const [file, expression] of [
    ["Tasks.jsx", "quoteDetailsPath(task.quote_id, task.quote_label)"],
    ["Messages.jsx", "quoteDetailsPath(attachment.quoteId, attachment.label)"]
  ]) {
    const source = readFileSync(new URL(`../src/pages/${file}`, import.meta.url), "utf8");
    assert.ok(source.includes(`to={${expression}}`), file);
  }
});

test("Q-5240439513 resolves its sole current version rather than rejecting its history", async () => {
  const current = {...quote, id:"current", quote_number:"Q-5240439513", parent_quote_id:"root",
    is_current_version:true, version_number:2};
  const older = {...current, id:"root", parent_quote_id:null, is_current_version:false, version_number:1};
  const versions = {...api, getQuoteById:async () => null, getQuotes:async () => [older, current]};
  assert.equal(await resolveSharedQuote("sender", current.quote_number, versions), current);
  assert.equal(await resolveSharedQuote("sender", current.quote_number, {...versions, getQuotes:async () => [current, older]}), current);
  assert.equal(await resolveSharedQuote("sender", current.quote_number, {...versions,
    getQuotes:async () => [older, {...current, is_current_version:undefined}]}).then(q => q.id), current.id);
  assert.equal(await resolveSharedQuote(older.id, current.quote_number, {...versions,
    getQuoteById:async () => older}), older, "exact version links still open the requested historical record");
});

test("conflicting current versions expose explicit choices instead of guessing or blocking navigation", async () => {
  const first = {...quote, is_current_version:true, version_number:1};
  const second = {...first, id:"second", version_number:2};
  const older = {...first, id:"older", is_current_version:false};
  const ambiguous = {...api, getQuoteById:async () => null, getQuotes:async () => [older, first, second]};
  await assert.rejects(resolveSharedQuote("sender", quote.quote_number, ambiguous), error => {
    assert.ok(error instanceof SharedQuoteAmbiguityError);
    assert.deepEqual(error.candidates, [first, second]);
    const target = {kind:"record",value:"quote:sender:status"};
    const selected = new URL(canonicalSharedQuotePath("/QuoteDetails",
      `?${new URLSearchParams({id:"sender",[APP_LINK_QUERY]:JSON.stringify(target)})}`, "sender", second), "https://local.invalid");
    assert.equal(selected.searchParams.get("id"), "second");
    assert.equal(JSON.parse(selected.searchParams.get(APP_LINK_QUERY)).value, "quote:second:status");
    return true;
  });
  await assert.rejects(resolveSharedQuote("sender", quote.quote_number, {...ambiguous,
    getQuotes:async () => [older, {...older,id:"other-old"}]}), error => {
    assert.equal(error.candidates.length, 2, "historical records remain selectable when no current version exists");
    return true;
  });
});
