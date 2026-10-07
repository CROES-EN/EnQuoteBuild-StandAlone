import test from "node:test";
import assert from "node:assert/strict";
import {performPush} from "../src/pusher.js";

const env = {BASE44_API_URL: "https://example.base44.app", BASE44_APP_ID: "test", BASE44_API_KEY: "test-key"};
const localId = "demo-quote-1791328081513-test";

test("released desktop sanitized create envelope cannot adopt a same-number quote with absent local identity", async () => {
  const previous = globalThis.fetch;
  const requests = [];
  globalThis.fetch = async (url, init) => {
    const parsed = new URL(url);
    requests.push({url: parsed, method: init.method, body: init.body ? JSON.parse(init.body) : null});
    if (init.method === "POST") return Response.json({id: "new-remote"});
    if (parsed.search) {
      const query = JSON.parse(parsed.searchParams.get("q"));
      assert.ok(Object.keys(query).length, "never search using an empty identity filter");
      if (query.quote_number) return Response.json([{id: "old-remote", quote_number: "Q-1300"}]);
      assert.equal(query.local_quote_id, localId);
      return Response.json([]);
    }
    return Response.json({id: "old-remote", quote_number: "Q-1300"});
  };
  try {
    const result = await performPush({
      entityType: "quote", action: "create", localId,
      quote: {local_quote_id: localId, quote_number: "Q-1300", site_id: "1300", total: 1350}
    }, env);
    assert.deepEqual(result, {status: "pushed", remote_id: "new-remote"});
    const post = requests.find(request => request.method === "POST");
    assert.equal(post.body.local_quote_id, localId);
    assert.equal(post.body.total, 1350);
    assert.equal(post.body.id, undefined);
  } finally {globalThis.fetch = previous;}
});

test("same-local-ID create retry adopts only after independent confirmation", async () => {
  const previous = globalThis.fetch;
  let writes = 0;
  const quote = {id: "remote", local_quote_id: localId, quote_number: "Q-1300"};
  globalThis.fetch = async (url, init) => {
    if (init.method !== "GET") writes += 1;
    return Response.json(new URL(url).search ? [quote] : quote);
  };
  try {
    assert.deepEqual(await performPush({
      entityType: "quote", action: "create", localId,
      quote: {local_quote_id: localId, quote_number: "Q-1300"}
    }, env), {status: "adopted", remote_id: "remote"});
    assert.equal(writes, 0);
  } finally {globalThis.fetch = previous;}
});

test("update preserves the released desktop local_quote_id in Base44 payload", async () => {
  const previous = globalThis.fetch;
  let payload;
  globalThis.fetch = async (_url, init) => {
    if (init.method === "PUT") payload = JSON.parse(init.body);
    return Response.json({id: "remote"});
  };
  try {
    await performPush({entityType: "quote", action: "update", localId, remoteId: "remote", quote: {local_quote_id: localId, total: 1350}}, env);
    assert.equal(payload.local_quote_id, localId);
    assert.equal(payload.id, undefined);
    assert.equal(payload.total, 1350);
  } finally {globalThis.fetch = previous;}
});

test("missing identity fails before any network request", async () => {
  const previous = globalThis.fetch;
  globalThis.fetch = () => {throw new Error("must not request");};
  try {
    await assert.rejects(performPush({entityType: "quote", action: "create", quote: {}}, env), /local quote id/);
  } finally {globalThis.fetch = previous;}
});

function mockRemote(remote) {
  const writes = [];
  globalThis.fetch = async (_url, init) => {
    if (init.method === "PUT") {
      writes.push(JSON.parse(init.body));
      return Response.json({id: remote.id});
    }
    return Response.json(remote);
  };
  return writes;
}

test("update from a different local copy is refused without writing", async () => {
  const previous = globalThis.fetch;
  const writes = mockRemote({id: "remote", local_quote_id: "demo-quote-1790972288000-owner"});
  try {
    await assert.rejects(
      performPush({entityType: "quote", action: "update", localId, remoteId: "remote", quote: {site_id: "2397768"}}, env),
      /IDENTITY_MISMATCH/
    );
    assert.equal(writes.length, 0);
  } finally {globalThis.fetch = previous;}
});

test("native Base44 quote edits keep the original creator as owner", async () => {
  const previous = globalThis.fetch;
  const writes = mockRemote({id: "remote", local_quote_id: localId});
  try {
    await performPush({entityType: "quote", action: "update", localId: "remote", remoteId: "remote", quote: {total: 10}}, env);
    assert.equal(writes[0].local_quote_id, localId);
    await performPush({entityType: "quote", action: "update", localId, remoteId: "remote", quote: {total: 11}}, env);
    assert.equal(writes.length, 2);
  } finally {globalThis.fetch = previous;}
});

test("legacy records without an owner, or owned by their own Base44 id, still accept updates", async () => {
  const previous = globalThis.fetch;
  try {
    for (const owner of [undefined, "remote"]) {
      const writes = mockRemote({id: "remote", local_quote_id: owner});
      await performPush({entityType: "quote", action: "update", localId, remoteId: "remote", quote: {total: 12}}, env);
      assert.equal(writes[0].local_quote_id, localId);
    }
  } finally {globalThis.fetch = previous;}
});
