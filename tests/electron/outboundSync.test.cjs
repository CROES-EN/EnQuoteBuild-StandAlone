const assert = require("node:assert/strict");
const http = require("node:http");
const test = require("node:test");
const { createOutboundSync } = require("../../electron/outboundSync.cjs");

async function withWorker(responseBody, run) {
  let requestPath;
  let requestBody = "";
  const server = http.createServer((request, response) => {
    requestPath = request.url;
    request.on("data", (chunk) => { requestBody += chunk; });
    request.on("end", () => {
      response.writeHead(200, { "content-type": "application/json" });
      response.end(JSON.stringify(responseBody));
    });
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const { port } = server.address();
  try {
    await run(`http://127.0.0.1:${port}`, () => ({ requestPath, requestBody: JSON.parse(requestBody) }));
  } finally {
    await new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
  }
}

function makeRepository() {
  const acknowledgements = [];
  const repository = {
    acknowledgements,
    async listPendingOutboundQuotes() {
      return [{
        local_id: "local-quote-1",
        kind: "create",
        quote_number: "Q-1",
        quote: { id: "local-quote-1", quote_number: "Q-1" }
      }];
    },
    async markOutboundSynced(results) {
      acknowledgements.push(...results);
      return { updated: results.length };
    },
    async listPendingOutboundDismissals() { return []; },
    async listPendingOutboundMentions() { return []; }
  };
  return repository;
}

test("pushes outbound quotes through the realtime Worker's enqueue route", async () => {
  await withWorker({ ok: true, status: "pushed", remote_id: "base44-1" }, async (workerUrl, getRequest) => {
    const repository = makeRepository();
    const sync = createOutboundSync({
      repository,
      config: { workerUrl, outboundToken: "test-token" },
      logger: { warn() {}, log() {} }
    });

    await sync.flush();

    const request = getRequest();
    assert.equal(request.requestPath, "/api/outbound/enqueue");
    assert.equal(request.requestBody.entityType, "quote");
    assert.deepEqual(repository.acknowledgements, [{
      local_id: "local-quote-1",
      remote_id: "base44-1"
    }]);
  });
});

test("keeps queued quotes pending until their WebSocket status arrives", async () => {
  await withWorker({ ok: false, queued: true, itemId: "worker-item-1" }, async (workerUrl) => {
    const repository = makeRepository();
    const sync = createOutboundSync({
      repository,
      config: { workerUrl, outboundToken: "test-token" },
      logger: { warn() {}, log() {} }
    });

    await sync.flush();
    assert.deepEqual(repository.acknowledgements, []);

    const result = await sync.handleRealtimeStatus({
      type: "outbound_status",
      itemId: "worker-item-1",
      entityType: "quote",
      quoteId: "local-quote-1",
      status: "pushed",
      remoteId: "base44-1",
      retried: true
    });

    assert.deepEqual(result, { updated: 1 });
    assert.deepEqual(repository.acknowledgements, [{
      local_id: "local-quote-1",
      remote_id: "base44-1"
    }]);
  });
});
