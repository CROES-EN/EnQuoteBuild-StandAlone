import assert from "node:assert/strict";
import { test } from "node:test";
import { handleFstList, handleFstUpsert } from "../src/fsts.js";

const email = "teammate@example.com";
const env = {
  ALLOWED_EMAILS_LIST: email,
  OUTBOUND_TOKEN: "fst-test-token",
  DB: createFstDatabase()
};

function makeRequest(path, method = "GET", body, token = env.OUTBOUND_TOKEN) {
  return new Request(`https://enquote-sync.example.workers.dev${path}`, {
    method,
    headers: {
      Authorization: `Bearer ${token}`,
      ...(body ? { "Content-Type": "application/json" } : {})
    },
    ...(body ? { body: JSON.stringify(body) } : {})
  });
}

function createFstDatabase() {
  const rows = new Map();
  return {
    prepare(sql) {
      let parameters = [];
      return {
        sql,
        bind(...values) {
          parameters = values;
          return this;
        },
        apply() {
          const [id, recordJson, updatedAt] = parameters;
          const previous = rows.get(id);
          if (!previous || updatedAt > previous.updated_at) {
            rows.set(id, { record_json: recordJson, updated_at: updatedAt });
          }
        },
        async all() {
          return { results: [...rows.values()] };
        }
      };
    },
    async batch(statements) {
      statements.forEach((statement) => statement.apply());
      return [];
    }
  };
}

test("roster endpoints require the token, and writes require an allow-listed email", async () => {
  const unauthorized = await handleFstList(makeRequest("/api/fsts", "GET", undefined, "wrong"), env);
  assert.equal(unauthorized.status, 401);

  const disallowed = await handleFstUpsert(
    makeRequest("/api/fsts/upsert", "POST", { email: "other@example.com", records: [] }),
    env
  );
  assert.equal(disallowed.status, 403);
});

test("upsert stores records, the newest updated_date wins, and list returns them", async () => {
  const older = { id: "fst-1", name: "Old Name", updated_date: "2026-10-02T00:00:00.000Z" };
  const newer = { id: "fst-1", name: "New Name", updated_date: "2026-10-02T12:00:00.000Z" };

  const first = await handleFstUpsert(makeRequest("/api/fsts/upsert", "POST", { email, records: [newer] }), env);
  assert.equal(first.status, 200);
  await handleFstUpsert(makeRequest("/api/fsts/upsert", "POST", { email, records: [older] }), env);

  const list = await handleFstList(makeRequest("/api/fsts"), env);
  const fsts = (await list.json()).fsts;
  assert.equal(fsts.length, 1);
  assert.equal(fsts[0].name, "New Name");
});

test("upsert rejects records without a usable id or updated_date", async () => {
  const response = await handleFstUpsert(
    makeRequest("/api/fsts/upsert", "POST", { email, records: [{ name: "No id" }] }),
    env
  );
  assert.equal(response.status, 400);
});
