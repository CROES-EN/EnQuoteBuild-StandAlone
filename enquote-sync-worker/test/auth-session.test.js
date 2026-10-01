import assert from "node:assert/strict";
import { test } from "node:test";
import { handleAuthSession, handleSyncCredentials } from "../src/auth-session.js";

const email = "teammate@example.com";
function makeRequest(path) {
  return new Request(`https://enquote-sync.example.workers.dev${path}`, {
    headers: { "cf-access-jwt-assertion": "test-access-token" }
  });
}

test("auth session checks the allow-list in the Worker environment", async () => {
  const response = await handleAuthSession(
    makeRequest("/auth/session"),
    { ALLOWED_EMAILS_LIST: email },
    async () => ({ email })
  );

  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), { authenticated: true, email });
});

test("sync credentials checks identity using the Worker environment", async () => {
  const env = {
    ALLOWED_EMAILS_LIST: email,
    OUTBOUND_TOKEN: "outbound-test-token",
    SNAPSHOT_TOKEN: "snapshot-test-token"
  };
  const response = await handleSyncCredentials(
    makeRequest("/auth/sync-credentials"),
    env,
    async () => ({ email })
  );

  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), {
    ok: true,
    outboundToken: env.OUTBOUND_TOKEN,
    snapshotToken: env.SNAPSHOT_TOKEN
  });
});

test("auth session rejects users missing from the Worker allow-list", async () => {
  const response = await handleAuthSession(
    makeRequest("/auth/session"),
    { ALLOWED_EMAILS_LIST: "someone-else@example.com" },
    async () => ({ email })
  );

  assert.equal(response.status, 403);
  assert.deepEqual(await response.json(), { authenticated: false, reason: "email_not_allowed" });
});
