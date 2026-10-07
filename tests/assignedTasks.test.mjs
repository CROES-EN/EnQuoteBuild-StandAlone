import test from "node:test";
import assert from "node:assert/strict";
import path from "node:path";
import {build} from "esbuild";

async function load(send) {
  const result = await build({
    entryPoints: [path.resolve("src\\features\\collab\\assignedTasks.js")], bundle: true,
    write: false, platform: "node", format: "cjs",
    plugins: [{name: "task-api", setup(builder) {
      builder.onResolve({filter: /collabApi/}, () => ({path: "mock-api", external: true}));
    }}]
  });
  const module = {exports: {}};
  new Function("require", "module", "exports", result.outputFiles[0].text)(
    () => ({chatApi: {send}}), module, module.exports);
  return module.exports;
}

test("general task requests validate fields, preserve retry IDs, and require server confirmation", async () => {
  const requests = [];
  const api = await load(async request => {
    requests.push(request);
    return {assignedTaskId: `chat-task:${request.clientId}`};
  });

  const fields = {conversationId: "chat", recipient: "BOB@example.com", title: " Check invoice ", notes: " Verify total ", dueLocal: "2026-10-08T09:00"};
  const request = api.createAssignedTaskRequest(fields, "stable-id");
  assert.equal(request.attachments[0].recipient, "bob@example.com");
  assert.equal(request.attachments[0].title, "Check invoice");
  assert.equal(request.attachments[0].note, "Verify total");
  await api.sendAssignedTaskRequest(request);
  await api.sendAssignedTaskRequest(request);
  assert.equal(requests[0].clientId, requests[1].clientId);
  for (const patch of [{recipient: ""}, {title: ""}, {title: "x".repeat(201)}, {notes: "x".repeat(2001)}, {dueLocal: ""}]) {
    assert.throws(() => api.createAssignedTaskRequest({...fields, ...patch}));
  }
  const missing = await load(async () => ({}));
  await assert.rejects(missing.sendAssignedTaskRequest(request), /not confirmed/);
  const unsupported = await load(async () => {const error = new Error("Unsupported"); error.code = "invalid_attachment_type"; throw error;});
  await assert.rejects(unsupported.sendAssignedTaskRequest(request), /updated sync service/);
});

test("panel assignments preserve all task fields and require the version-two sync service", async () => {
  const api = await load(async request => ({assignedTaskId: `chat-task:${request.clientId}`}));
  const task = {type: "call", remind_at: null, quote_id: "quote-1", quote_label: "Q-001",
    site_id: "00123", case_number: "000456", case_id: null, contact_name: "Homeowner", contact_phone: "555-0100"};
  const request = api.createAssignedTaskRequest({conversationId: "dm", recipient: "bob@example.com",
    title: "Call", dueLocal: "2026-10-08T09:00", notes: "n".repeat(4000), task}, "panel-id");
  assert.equal(request.attachments[0].version, 2);
  assert.deepEqual(request.attachments[0].task, task);
  assert.equal(request.attachments[0].note.length, 4000);
  assert.ok(request.body.length <= 4000);
  await api.sendAssignedTaskRequest(request);
  const oldService = await load(async () => {const error = new Error("Invalid"); error.code = "invalid_assigned_task"; throw error;});
  await assert.rejects(oldService.sendAssignedTaskRequest(request), /deploy the task-panel update/);
});
