import assert from "node:assert/strict";
import { test } from "node:test";
import { performPush } from "../src/pusher.js";

const env = {
  BASE44_API_URL: "https://example.base44.app",
  BASE44_APP_ID: "app-1",
  BASE44_API_KEY: "api-key"
};

test("deletes a Base44 quote only after verifying its remote id", async () => {
  const requests = [];
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (url, init) => {
    requests.push({ url: String(url), method: init.method });
    if (init.method === "GET") {
      return Response.json({ id: "base44-quote-1", quote_number: "Q-1" });
    }
    return new Response(null, { status: 204 });
  };

  try {
    const result = await performPush({
      entityType: "quote",
      action: "delete",
      localId: "base44-quote-1",
      remoteId: "base44-quote-1"
    }, env);

    assert.deepEqual(result, { status: "deleted", remote_id: "base44-quote-1" });
    assert.deepEqual(requests, [
      {
        url: "https://example.base44.app/api/apps/app-1/entities/Quote/base44-quote-1",
        method: "GET"
      },
      {
        url: "https://example.base44.app/api/apps/app-1/entities/Quote/base44-quote-1",
        method: "DELETE"
      }
    ]);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("refuses to delete a remote quote that does not belong to the local quote", async () => {
  const methods = [];
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (_url, init) => {
    methods.push(init.method);
    return Response.json({ id: "base44-quote-2", local_quote_id: "another-local-quote" });
  };

  try {
    await assert.rejects(
      performPush({
        entityType: "quote",
        action: "delete",
        localId: "demo-quote-1234567890123-abcd",
        remoteId: "base44-quote-2"
      }, env),
      /does not match this local quote/
    );
    assert.deepEqual(methods, ["GET"]);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("deletes a locally created quote when the confirmed remote id and quote number match", async () => {
  const methods = [];
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (_url, init) => {
    methods.push(init.method);
    if (init.method === "GET") return Response.json({ id: "base44-quote-3", quote_number: "Q-3" });
    return new Response(null, { status: 204 });
  };

  try {
    const result = await performPush({
      entityType: "quote",
      action: "delete",
      localId: "demo-quote-1234567890123-abcd",
      remoteId: "base44-quote-3",
      quoteNumber: "Q-3"
    }, env);
    assert.deepEqual(result, { status: "deleted", remote_id: "base44-quote-3" });
    assert.deepEqual(methods, ["GET", "DELETE"]);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("finds locally created quotes by local id before deleting", async () => {
  const requests = [];
  const localId = "demo-quote-1234567890123-abcd";
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (url, init) => {
    const parsedUrl = new URL(String(url));
    requests.push({ url: parsedUrl, method: init.method });
    if (parsedUrl.search) {
      assert.deepEqual(JSON.parse(parsedUrl.searchParams.get("q")), { local_quote_id: localId });
      return Response.json([{ id: "base44-created-quote", local_quote_id: localId }]);
    }
    if (init.method === "GET") {
      return Response.json({ id: "base44-created-quote", local_quote_id: localId });
    }
    return new Response(null, { status: 204 });
  };

  try {
    const result = await performPush({
      entityType: "quote",
      action: "delete",
      localId,
      quoteNumber: "Q-LOCAL"
    }, env);

    assert.deepEqual(result, { status: "deleted", remote_id: "base44-created-quote" });
    assert.deepEqual(requests.map(({ method }) => method), ["GET", "GET", "DELETE"]);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("keeps a local deletion retryable when the Base44 lookup fails", async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => new Response("unavailable", { status: 503 });

  try {
    await assert.rejects(
      performPush({
        entityType: "quote",
        action: "delete",
        localId: "demo-quote-1234567890123-abcd"
      }, env),
      error => error.retryable === true
    );
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("treats an already-missing Base44 quote as successfully deleted", async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => new Response(null, { status: 404 });

  try {
    const result = await performPush({
      entityType: "quote",
      action: "delete",
      localId: "base44-quote-gone",
      remoteId: "base44-quote-gone"
    }, env);

    assert.deepEqual(result, { status: "deleted", remote_id: "base44-quote-gone" });
  } finally {
    globalThis.fetch = originalFetch;
  }
});
