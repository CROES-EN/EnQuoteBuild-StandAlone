const assert = require("node:assert/strict");
const http = require("node:http");
const test = require("node:test");
const { createPresenceSync } = require("../../electron/presenceSync.cjs");

test("presence sync uses the verified identity for heartbeat, list, and removal", async () => {
  const requests = [];
  const server = http.createServer((request, response) => {
    let body = "";
    request.on("data", (chunk) => { body += chunk; });
    request.on("end", () => {
      requests.push({
        method: request.method,
        url: request.url,
        authorization: request.headers.authorization,
        accessId: request.headers["cf-access-client-id"],
        body: body ? JSON.parse(body) : null
      });
      response.writeHead(200, { "Content-Type": "application/json" });
      response.end(JSON.stringify({
        ok: true,
        sessions: [{ email: "shane@enphaseenergy.com", signedInAt: "2026-10-01T12:00:00Z" }]
      }));
    });
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));

  const port = server.address().port;
  const sync = createPresenceSync({
    workerUrl: `http://127.0.0.1:${port}`,
    getIdentity: () => ({ email: "Shane@EnphaseEnergy.com" }),
    getOutboundToken: () => "outbound-test-token",
    getAccessHeaders: () => ({ "CF-Access-Client-Id": "service-client-id" }),
    getVersions: () => ({ appVersion: "1.4.0", uiVersion: "ui-20261005" }),
    sessionId: "session-test",
    logger: { warn() {} }
  });

  try {
    const heartbeat = await sync.heartbeat("Shane", "admin");
    assert.equal(heartbeat.ok, true);
    assert.equal(requests[0].url, "/api/presence/heartbeat");
    assert.equal(requests[0].authorization, "Bearer outbound-test-token");
    assert.equal(requests[0].accessId, "service-client-id");
    assert.deepEqual(requests[0].body, {
      email: "shane@enphaseenergy.com",
      name: "Shane",
      sessionId: "session-test",
      appVersion: "1.4.0",
      uiVersion: "ui-20261005",
      resolvedRole: "admin"
    });

    await sync.heartbeat();
    assert.equal(requests[1].body.name, "Shane");
    assert.equal(requests[1].body.resolvedRole, "admin");

    const list = await sync.list();
    assert.equal(list.sessions[0].email, "shane@enphaseenergy.com");
    assert.equal(requests[2].url, "/api/presence");

    const removed = await sync.remove();
    assert.equal(removed.ok, true);
    assert.equal(requests[3].url, "/api/presence/remove");
    assert.equal(requests[3].body.email, "shane@enphaseenergy.com");
  } finally {
    server.close();
  }
});
