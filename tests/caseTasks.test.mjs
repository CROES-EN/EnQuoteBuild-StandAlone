import test from "node:test";
import assert from "node:assert/strict";
import path from "node:path";
import {createRequire} from "node:module";
import {build} from "esbuild";

const require = createRequire(import.meta.url);
const output = await build({
  entryPoints: [path.join("src", "features", "collab", "caseTasks.js")],
  bundle: true, write: false, platform: "node", format: "cjs", packages: "external",
  alias: {"@": path.resolve("src")}
});
const module = {exports: {}};
new Function("require", "module", "exports", output.outputFiles[0].text)(require, module, module.exports);
const {createCaseTaskRequest, sendCaseTaskRequest} = module.exports;
const details = {
  row: {"Case Number": "00123456", "Case ID": "500000000000001"},
  recipient: "BOB@example.com", note: " Review invoice ", dueLocal: "2026-10-07T09:00"
};

test("case task request uses a versioned attachment, preserves case numbers, and converts local due time", () => {
  const request = createCaseTaskRequest(details, "request-1");
  assert.equal(request.clientId, "request-1");
  assert.equal(request.attachment.version, 1);
  assert.equal(request.attachment.type, "case_task");
  assert.equal(request.attachment.caseNumber, "00123456");
  assert.equal(request.attachment.caseId, "500000000000001");
  assert.equal(request.attachment.recipient, "bob@example.com");
  assert.equal(request.attachment.note, "Review invoice");
  assert.equal(request.attachment.dueAt, new Date(details.dueLocal).toISOString());
  assert.match(request.body, /case 00123456/);
  assert.match(request.body, /Review invoice/);
});

test("case task requests require a recipient, a valid case, and a due date", () => {
  for (const patch of [
    {recipient: ""}, {dueLocal: ""}, {dueLocal: "invalid"},
    {row: {"Case Number": ""}}, {row: {"Case Number": "NaN"}}, {note: "x".repeat(2001)}
  ]) {
    assert.throws(() => createCaseTaskRequest({...details, ...patch}));
  }
  const request = createCaseTaskRequest({...details, row: {"Case Number": 123456, "Case ID": "invalid"}});
  assert.equal(request.attachment.caseNumber, "123456");
  assert.equal(request.attachment.caseId, "", "bad imported IDs use the standard case-search fallback");
});

test("delivery retries reuse the same released bridge payload and require explicit task confirmation", async () => {
  const original = globalThis.window;
  const calls = [];
  let mode = "success";
  globalThis.window = {enquoteLocal: {chat: {
    openDm: async (email) => { calls.push({email}); return {ok: true, conversation: {id: "dm-1"}}; },
    send: async (payload) => {
      calls.push(payload);
      if (mode === "old-worker") return {ok: false, error: "invalid_attachment_type"};
      return {ok: true, message: mode === "unconfirmed" ? {id: payload.clientId} : {caseTaskId: `case-tag:${payload.clientId}`}};
    }
  }}};
  try {
    const request = createCaseTaskRequest(details, "stable-id");
    await sendCaseTaskRequest(request);
    await sendCaseTaskRequest(request);
    assert.deepEqual(calls[1], calls[3]);
    assert.equal(calls[1].conversationId, "dm-1");
    assert.equal(calls[1].clientId, "stable-id");
    assert.deepEqual(calls[1].attachments, [request.attachment]);
    mode = "unconfirmed";
    await assert.rejects(sendCaseTaskRequest(request), /did not confirm task creation/);
    mode = "old-worker";
    await assert.rejects(sendCaseTaskRequest(request), /requires the backend update/);
  } finally {
    if (original === undefined) delete globalThis.window;
    else globalThis.window = original;
  }
});
