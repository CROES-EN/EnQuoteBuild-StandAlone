import test from "node:test";
import assert from "node:assert/strict";
import path from "node:path";
import {build} from "esbuild";

async function loadQuoteAttention() {
  const output = await build({
    entryPoints: [path.resolve("src/features/tasks/quoteAttention.js")], bundle: true, write: false,
    platform: "node", format: "cjs", alias: {"@": path.resolve("src")}
  });
  const module = {exports: {}};
  new Function("module", "exports", output.outputFiles[0].text)(module, module.exports);
  return module.exports;
}

function memoryStorage() {
  const values = new Map();
  return {
    getItem: key => values.has(key) ? values.get(key) : null,
    setItem: (key, value) => values.set(key, String(value)),
    removeItem: key => values.delete(key)
  };
}

const NOW = Date.parse("2026-10-10T12:00:00Z");
const quotes = [
  {id: "a", status: "quote_sent_to_ho", owner_email: "Alice@Enphaseenergy.com", status_history: [
    {status: "quote_sent_to_ho", changed_at: "2026-09-01T00:00:00Z"},
    {status: "draft_without_internal", changed_at: "2026-09-20T00:00:00Z"},
    {status: "quote_sent_to_ho", changed_at: "2026-10-05T12:00:00Z"}
  ]},
  {id: "b", status: "quote_sent_to_ho", created_by: "bob@enphaseenergy.com", updated_date: "2026-10-01T12:00:00Z"},
  {id: "c", status: "draft", owner_email: "alice@enphaseenergy.com", created_date: "2026-10-09T12:00:00Z"},
  {id: "d", status: "quote_sent_to_ho", owner_email: "alice@enphaseenergy.com", is_current_version: false},
  {id: "e", status: "", owner_email: "alice@enphaseenergy.com", updated_date: "2026-08-01T00:00:00Z"}
];

test("only current quotes in chosen statuses show, oldest in status first", async () => {
  const {selectQuotesNeedingAttention} = await loadQuoteAttention();
  const all = selectQuotesNeedingAttention(quotes, {statuses: ["quote_sent_to_ho"], scope: "all"}, "x@y.com", NOW);
  assert.deepEqual(all.map(item => item.quote.id), ["b", "a"]);
  assert.deepEqual(all.map(item => item.daysInStatus), [9, 5], "uses the latest entry into the status");
});

test("My quotes matches the owner case-insensitively and falls back to created_by", async () => {
  const {selectQuotesNeedingAttention} = await loadQuoteAttention();
  const prefs = {statuses: ["quote_sent_to_ho"], scope: "mine"};
  assert.deepEqual(selectQuotesNeedingAttention(quotes, prefs, "alice@enphaseenergy.com", NOW).map(i => i.quote.id), ["a"]);
  assert.deepEqual(selectQuotesNeedingAttention(quotes, prefs, "BOB@enphaseenergy.com", NOW).map(i => i.quote.id), ["b"]);
  assert.deepEqual(selectQuotesNeedingAttention(quotes, prefs, "", NOW), []);
});

test("blank and legacy draft statuses count as Draft without internal", async () => {
  const {selectQuotesNeedingAttention} = await loadQuoteAttention();
  const result = selectQuotesNeedingAttention(quotes, {statuses: ["draft_without_internal"]}, "alice@enphaseenergy.com", NOW);
  assert.deepEqual(result.map(i => i.quote.id), ["e", "c"]);
  assert.deepEqual(selectQuotesNeedingAttention(quotes, {statuses: []}, "alice@enphaseenergy.com", NOW), []);
});

test("settings are saved per user and drop unknown statuses", async () => {
  const {readQuoteAttentionPrefs, writeQuoteAttentionPrefs, QUOTE_ATTENTION_STATUS_OPTIONS} = await loadQuoteAttention();
  assert.ok(!QUOTE_ATTENTION_STATUS_OPTIONS.some(option => option.value === "draft"));
  const storage = memoryStorage();
  const previous = globalThis.window;
  globalThis.window = {localStorage: storage};
  try {
    storage.setItem("enquote_local_session_email", "alice@enphaseenergy.com");
    writeQuoteAttentionPrefs({statuses: ["quote_sent_to_ho", "bogus"], scope: "all"}, storage);
    storage.setItem("enquote_local_session_email", "bob@enphaseenergy.com");
    assert.deepEqual(readQuoteAttentionPrefs(storage), {statuses: [], scope: "mine"});
    storage.setItem("enquote_local_session_email", "alice@enphaseenergy.com");
    assert.deepEqual(readQuoteAttentionPrefs(storage), {statuses: ["quote_sent_to_ho"], scope: "all"});
  } finally {
    globalThis.window = previous;
  }
});
