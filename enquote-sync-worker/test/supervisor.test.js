import assert from "node:assert/strict";
import { test } from "node:test";
import { createSupervisorD1 } from "../test-helpers/d1Shim.js";
import {
  handleSupervisorDelete,
  handleSupervisorIndex,
  handleSupervisorRecord,
  handleSupervisorUpsert,
  splitIntoChunks
} from "../src/supervisor.js";

const email = "manager@example.com";
const token = "supervisor-test-token";

function makeEnv() {
  const broadcasts = [];
  return {
    OUTBOUND_TOKEN: token,
    ALLOWED_EMAILS_LIST: email,
    DB: createSupervisorD1(),
    broadcasts,
    QUOTE_SYNC_ROOM: {
      idFromName: (name) => name,
      get: () => ({ fetch: async (_url, init) => { broadcasts.push(JSON.parse(init.body)); return new Response("{}"); } })
    }
  };
}

function request(path, { method = "GET", body, auth = `Bearer ${token}` } = {}) {
  return new Request(`https://worker.example${path}`, {
    method,
    headers: { ...(auth ? { Authorization: auth } : {}), ...(body ? { "Content-Type": "application/json" } : {}) },
    ...(body ? { body: JSON.stringify(body) } : {})
  });
}

const upsert = (env, id, updatedAt, record, collection = "supervisorReportTables") =>
  handleSupervisorUpsert(request("/api/supervisor/upsert", { method: "POST", body: { email, collection, id, updatedAt, record } }), env);

const fetchRecord = (env, id, collection = "supervisorReportTables") =>
  handleSupervisorRecord(request(`/api/supervisor/record?collection=${collection}&id=${id}`), env);

test("rejects unauthenticated and non-allow-listed callers", async () => {
  const env = makeEnv();
  assert.equal((await handleSupervisorIndex(request("/api/supervisor/index", { auth: null }), env)).status, 401);
  const response = await handleSupervisorUpsert(request("/api/supervisor/upsert", {
    method: "POST",
    body: { email: "stranger@example.com", collection: "supervisorReportTables", id: "x", updatedAt: "2026-10-01T00:00:00.000Z", record: {} }
  }), env);
  assert.equal(response.status, 403);
});

test("rejects unsupported collections and bad stamps", async () => {
  const env = makeEnv();
  assert.equal((await upsert(env, "x", "2026-10-01T00:00:00.000Z", {}, "quotes")).status, 400);
  assert.equal((await upsert(env, "x", "yesterday", {})).status, 400);
  assert.equal((await upsert(env, "x", "2999-01-01T00:00:00.000Z", {})).status, 400);
});

test("round-trips a record that spans multiple chunks, and lists it", async () => {
  const env = makeEnv();
  const rows = Array.from({ length: 400 }, (_, i) => ({ Case: `0000${i}`, Notes: "Ã©ðŸ˜€".repeat(500) }));
  const record = { id: "workload", reportType: "workload", rows };
  assert.ok(JSON.stringify(record).length > 250_000 * 2);

  const stamp = "2026-10-01T12:00:00.000Z";
  assert.deepEqual(await (await upsert(env, "workload", stamp, record)).json(), { ok: true, applied: true });
  assert.equal(env.broadcasts[0].type, "supervisor_updated");

  const fetched = await (await fetchRecord(env, "workload")).json();
  assert.equal(fetched.updatedAt, stamp);
  assert.deepEqual(fetched.record, record);

  const index = await (await handleSupervisorIndex(request("/api/supervisor/index"), env)).json();
  assert.deepEqual(index.records, [{ collection: "supervisorReportTables", id: "workload", updatedAt: stamp, deleted: false, updatedBy: email }]);
});

test("newer write wins, stale write is ignored, and old chunks are cleaned up", async () => {
  const env = makeEnv();
  const big = (label) => ({ label, rows: Array.from({ length: 5000 }, (_, i) => `${label}-${i}-${"x".repeat(80)}`) });
  await upsert(env, "r", "2026-10-01T12:00:00.000Z", big("old"));
  assert.equal((await (await upsert(env, "r", "2026-10-01T13:00:00.000Z", big("new"))).json()).applied, true);
  assert.equal((await (await upsert(env, "r", "2026-10-01T11:00:00.000Z", big("stale"))).json()).applied, false);
  assert.equal((await (await upsert(env, "r", "2026-10-01T13:00:00.000Z", big("same"))).json()).applied, false);

  const fetched = await (await fetchRecord(env, "r")).json();
  assert.equal(fetched.record.label, "new");
  const stored = await env.DB.prepare("SELECT DISTINCT version FROM supervisor_record_chunks WHERE id = ?").bind("r").all();
  assert.deepEqual(stored.results.map((row) => row.version), ["2026-10-01T13:00:00.000Z"]);
});

test("deletes leave a tombstone that blocks older writes but yields to newer ones", async () => {
  const env = makeEnv();
  await upsert(env, "r", "2026-10-01T12:00:00.000Z", { id: "r" });
  const del = (deletedAt) => handleSupervisorDelete(request("/api/supervisor/delete", {
    method: "POST", body: { email, collection: "supervisorReportTables", id: "r", deletedAt }
  }), env);

  assert.equal((await (await del("2026-10-01T14:00:00.000Z")).json()).applied, true);
  const tombstone = await (await fetchRecord(env, "r")).json();
  assert.deepEqual([tombstone.deleted, tombstone.record], [true, null]);
  assert.equal((await env.DB.prepare("SELECT * FROM supervisor_record_chunks").all()).results.length, 0);

  assert.equal((await (await upsert(env, "r", "2026-10-01T13:00:00.000Z", { id: "r" })).json()).applied, false);
  assert.equal((await (await upsert(env, "r", "2026-10-01T15:00:00.000Z", { id: "r", back: true })).json()).applied, true);
  assert.equal((await (await fetchRecord(env, "r")).json()).record.back, true);
  assert.equal((await fetchRecord(env, "missing")).status, 404);
});

test("splitIntoChunks never splits a surrogate pair", () => {
  const text = "aðŸ˜€".repeat(10);
  const chunks = splitIntoChunks(text, 4);
  assert.equal(chunks.join(""), text);
  for (const chunk of chunks) assert.ok(!/[\ud800-\udbff]$/.test(chunk));
});
