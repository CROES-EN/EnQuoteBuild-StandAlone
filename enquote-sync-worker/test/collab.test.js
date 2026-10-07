import assert from "node:assert/strict";
import { test } from "node:test";
import { createCollabD1 } from "../test-helpers/d1Shim.js";
import { handleSyncCredentials } from "../src/auth-session.js";
import {
  authenticateUser,
  inboxKeyForEmail,
  signUserToken,
  verifyUserToken
} from "../src/user-token.js";
import {
  handleTasksDelete,
  handleTasksList,
  handleTasksUpsert
} from "../src/tasks.js";
import {
  handleSopFileDownload,
  handleSopFileUpload,
  handleSopsDelete,
  handleSopsList,
  handleSopsUpsert,
  handleSopsVersions
} from "../src/sops.js";
import {
  handleChatConversationCreate,
  handleChatConversations,
  handleChatDirectory,
  handleChatInbox,
  handleChatMessageSend,
  handleChatMessages,
  handleChatRead
} from "../src/chat.js";

const SECRET = "01234567890123456789012345678901";
const OUTBOUND_TOKEN = "outbound-token";
const ALLOWED_EMAILS_LIST = "alice@example.com,bob@example.com,carol@example.com";

async function caseTagSetup() {
  const env = makeEnv();
  const result = await (await handleChatConversationCreate(await authedRequest("/api/chat/conversations", "alice@example.com", {
    method: "POST", body: { kind: "dm", with: "bob@example.com" }
  }), env)).json();
  const attachment = {
    type: "case_task", version: 1, recipient: "bob@example.com",
    caseNumber: "00123456", caseId: "500000000000001",
    note: "Please review the invoice.", dueAt: stamp(86_400_000)
  };
  const payload = {
    conversationId: result.conversation.id, clientId: crypto.randomUUID(),
    body: "Tagged you to review case 00123456.", attachments: [attachment]
  };
  const send = (body = payload, email = "alice@example.com") =>
    authedRequest("/api/chat/messages", email, { method: "POST", body }).then((req) => handleChatMessageSend(req, env));
  const tasks = (email = "bob@example.com") =>
    authedRequest("/api/tasks", email).then((req) => handleTasksList(req, env)).then((response) => response.json());
  return { env, payload, attachment, send, tasks };
}

test("case tags atomically create recipient tasks through the released chat API", async () => {
  const { env, payload, send, tasks } = await caseTagSetup();
  const result = await (await send()).json();
  assert.equal(result.message.caseTaskId, `case-tag:${payload.clientId}`);
  assert.deepEqual(result.message.attachments, [], "old desktop clients never receive unknown attachment types");
  const bobTasks = await tasks();
  assert.equal(bobTasks.tasks.length, 1);
  const task = bobTasks.tasks[0].record;
  assert.equal(task.case_number, "00123456");
  assert.equal(task.case_id, "500000000000001");
  assert.equal(task.assigned_by, "alice@example.com");
  assert.equal(task.notes, "Please review the invoice.");
  assert.equal(task.due_at, payload.attachments[0].dueAt);
  assert.equal(task.remind_at, task.due_at);
  assert.equal(task.status, "open");
  assert.equal(task.updated_date, bobTasks.tasks[0].updatedAt);
  assert.equal((await tasks("alice@example.com")).tasks.length, 0);
  assert.equal((await tasks("carol@example.com")).tasks.length, 0);
  assert.ok(env.broadcasts.some((event) => event.type === "tasks_updated"));
  assert.equal(JSON.stringify(env.broadcasts).includes("bob@example.com"), false);
  assert.equal((await (await send()).json()).message.caseTaskId, task.id);
  assert.equal((await tasks()).tasks.length, 1, "retry does not duplicate the task");
  await handleTasksDelete(await authedRequest("/api/tasks/delete", "bob@example.com", {
    method: "POST", body: { id: task.id, deletedAt: stamp(1000) }
  }), env);
  assert.equal((await send()).status, 200);
  assert.equal((await tasks()).tasks[0].deleted, true, "retry must not resurrect a removed task");
});

test("concurrent case-tag retries create one task and one message", async () => {
  const { env, payload, send, tasks } = await caseTagSetup();
  const responses = await Promise.all([send(), send()]);
  for (const response of responses) assert.equal(response.status, 200);
  assert.equal((await tasks()).tasks.length, 1);
  const messages = await (await handleChatMessages(await authedRequest(
    `/api/chat/messages?conversationId=${payload.conversationId}`, "bob@example.com"), env)).json();
  assert.equal(messages.messages.length, 1);
});

test("case tags reject invalid requests, unauthorized recipients, groups, and message-id reuse", async () => {
  const { env, payload, attachment, send, tasks } = await caseTagSetup();
  for (const patch of [
    { version: 2 }, { dueAt: "" }, { dueAt: "not-a-date" }, { dueAt: "2026-02-30T09:00:00.000Z" }, { caseNumber: "" },
    { caseNumber: "<script>" }, { caseId: "https://evil.example" }, { note: "x".repeat(2001) }
  ]) {
    assert.equal((await send({ ...payload, attachments: [{ ...attachment, ...patch }] })).status, 400);
  }
  for (const recipient of ["alice@example.com", "carol@example.com", "stranger@example.com"]) {
    assert.equal((await send({ ...payload, attachments: [{ ...attachment, recipient }] })).status, 403);
  }
  assert.equal((await send(payload, "carol@example.com")).status, 404);
  const group = await (await handleChatConversationCreate(await authedRequest("/api/chat/conversations", "alice@example.com", {
    method: "POST", body: { kind: "group", name: "Team", members: ["bob@example.com"] }
  }), env)).json();
  assert.equal((await send({ ...payload, conversationId: group.conversation.id })).status, 403);
  assert.equal((await tasks()).tasks.length, 0);
  assert.equal((await send({ ...payload, attachments: [] })).status, 200);
  assert.equal((await send()).status, 409, "ordinary messages cannot later become task requests");
  assert.equal((await tasks()).tasks.length, 0);
});

test("case tag task-write failure rolls back the message and permits a safe retry", async () => {
  const { env, payload, send, tasks } = await caseTagSetup();
  const batch = env.DB.batch;
  env.DB.batch = (statements) => batch([
    statements[0], env.DB.prepare("INSERT INTO nonexistent_case_tag_table VALUES (1)")
  ]);
  await assert.rejects(send(), /nonexistent_case_tag_table/);
  env.DB.batch = batch;
  const messages = await (await handleChatMessages(await authedRequest(
    `/api/chat/messages?conversationId=${payload.conversationId}`, "bob@example.com"), env)).json();
  assert.equal(messages.messages.length, 0);
  assert.equal((await tasks()).tasks.length, 0);
  assert.equal((await send()).status, 200);
  assert.equal((await tasks()).tasks.length, 1);
});

test("case tasks advance beyond the recipient's existing incremental sync cursor", async () => {
  const { env, payload, send } = await caseTagSetup();
  const cursor = stamp(1000);
  await env.DB.prepare(`INSERT INTO user_tasks (owner, id, updated_at, synced_at, deleted, data)
    VALUES (?, ?, ?, ?, 0, ?)`).bind("bob@example.com", "prior-task", stamp(-1000), cursor, "{}").run();
  assert.equal((await send()).status, 200);
  const result = await (await handleTasksList(await authedRequest(
    `/api/tasks?since=${encodeURIComponent(cursor)}`, "bob@example.com"), env)).json();
  assert.equal(result.tasks.length, 1);
  assert.equal(result.tasks[0].id, `case-tag:${payload.clientId}`);
  assert.ok(result.cursor > cursor);
});

function stamp(offsetMs = 0) {
  return new Date(Date.now() + offsetMs).toISOString();
}

function makeKv() {
  const data = new Map();
  return {
    async put(key, value, options = {}) {
      data.set(key, { value, metadata: options.metadata || null });
    },
    async get(key, type) {
      const item = data.get(key);
      if (!item) return null;
      if (type === "json") return typeof item.value === "string" ? JSON.parse(item.value) : item.value;
      return item.value;
    },
    async getWithMetadata(key) {
      const item = data.get(key);
      return item ? { value: item.value, metadata: item.metadata } : { value: null, metadata: null };
    },
    data
  };
}

function makeEnv() {
  const broadcasts = [];
  return {
    USER_TOKEN_SECRET: SECRET,
    OUTBOUND_TOKEN,
    ALLOWED_EMAILS_LIST,
    DB: createCollabD1(),
    CACHE: makeKv(),
    broadcasts,
    QUOTE_SYNC_ROOM: {
      idFromName: (name) => name,
      get: () => ({ fetch: async (_url, init) => { broadcasts.push(JSON.parse(init.body)); return new Response("{}"); } })
    }
  };
}

async function authedRequest(path, email, { method = "GET", body, headers = {} } = {}) {
  return new Request(`https://worker.example${path}`, {
    method,
    headers: {
      Authorization: `Bearer ${OUTBOUND_TOKEN}`,
      "X-EnQuote-User": await signUserToken(email, SECRET),
      ...(body && !(body instanceof ArrayBuffer) ? { "Content-Type": "application/json" } : {}),
      ...headers
    },
    ...(body ? { body: body instanceof ArrayBuffer ? body : JSON.stringify(body) } : {})
  });
}

test("user tokens sign, verify, expire, tamper, and authenticate with bearer token", async () => {
  const token = await signUserToken("Alice@Example.com", SECRET);
  assert.equal((await verifyUserToken(token, SECRET)).email, "alice@example.com");
  assert.equal(await inboxKeyForEmail("alice@example.com", SECRET), await inboxKeyForEmail("Alice@Example.com", SECRET));
  assert.equal((await verifyUserToken(`${token}x`, SECRET)).error, "invalid_user_token");
  assert.equal((await verifyUserToken(await signUserToken("alice@example.com", SECRET, -1), SECRET)).error, "user_token_expired");

  const env = makeEnv();
  assert.equal((await authenticateUser(await authedRequest("/api/tasks", "alice@example.com"), env)).email, "alice@example.com");
  assert.equal((await authenticateUser(new Request("https://worker/api/tasks"), env)).error.status, 401);
  const noSecret = { ...env, USER_TOKEN_SECRET: "" };
  assert.equal((await authenticateUser(await authedRequest("/api/tasks", "alice@example.com"), noSecret)).error.status, 503);
  const stranger = await authedRequest("/api/tasks", "stranger@example.com");
  assert.equal((await authenticateUser(stranger, env)).error.status, 403);
});

test("sync credentials include userToken and inboxKey only when configured", async () => {
  const env = makeEnv();
  const req = new Request("https://worker/auth/sync-credentials", { headers: { "cf-access-jwt-assertion": "jwt" } });
  const response = await handleSyncCredentials(req, { ...env, SNAPSHOT_TOKEN: "snap" }, async () => ({ email: "alice@example.com" }));
  const body = await response.json();
  assert.equal(body.ok, true);
  assert.equal(typeof body.userToken, "string");
  assert.equal(body.inboxKey, await inboxKeyForEmail("alice@example.com", SECRET));
  assert.equal((await verifyUserToken(body.userToken, SECRET)).email, "alice@example.com");
});

test("tasks are isolated per user with LWW, since cursors, tombstones, and safe broadcasts", async () => {
  const env = makeEnv();
  const oldAt = stamp(-40_000);
  const newAt = stamp(-30_000);
  let response = await handleTasksUpsert(await authedRequest("/api/tasks/upsert", "alice@example.com", {
    method: "POST", body: { id: "t1", updatedAt: oldAt, record: { id: "t1", title: "old" } }
  }), env);
  assert.deepEqual(await response.json(), { ok: true, applied: true });
  assert.deepEqual(env.broadcasts[0], { type: "tasks_updated", key: await inboxKeyForEmail("alice@example.com", SECRET) });
  assert.equal(JSON.stringify(env.broadcasts).includes("alice@example.com"), false);

  assert.equal((await (await handleTasksUpsert(await authedRequest("/api/tasks/upsert", "alice@example.com", {
    method: "POST", body: { id: "t1", updatedAt: stamp(-50_000), record: { id: "t1", title: "stale" } }
  }), env)).json()).applied, false);
  assert.equal((await (await handleTasksUpsert(await authedRequest("/api/tasks/upsert", "alice@example.com", {
    method: "POST", body: { id: "t1", updatedAt: newAt, record: { id: "t1", title: "new" } }
  }), env)).json()).applied, true);

  const bobList = await (await handleTasksList(await authedRequest("/api/tasks", "bob@example.com"), env)).json();
  assert.deepEqual(bobList.tasks, []);
  const aliceList = await (await handleTasksList(await authedRequest("/api/tasks", "alice@example.com"), env)).json();
  assert.equal(aliceList.tasks[0].record.title, "new");
  assert.deepEqual((await (await handleTasksList(await authedRequest(`/api/tasks?since=${encodeURIComponent(aliceList.cursor)}`, "alice@example.com"), env)).json()).tasks, []);

  assert.equal((await (await handleTasksDelete(await authedRequest("/api/tasks/delete", "alice@example.com", {
    method: "POST", body: { id: "t1", deletedAt: stamp(-20_000) }
  }), env)).json()).applied, true);
  const deleted = await (await handleTasksList(await authedRequest("/api/tasks?since=", "alice@example.com"), env)).json();
  assert.equal(deleted.tasks.at(-1).deleted, true);
  assert.equal(deleted.tasks.at(-1).record, null);
});

test("SOPs upsert, keep versions pruned to 50, soft delete, and restore by upsert", async () => {
  const env = makeEnv();
  for (let i = 0; i < 55; i += 1) {
    const updatedAt = stamp(-100_000 + i * 1000);
    const response = await handleSopsUpsert(await authedRequest("/api/sops/upsert", "alice@example.com", {
      method: "POST", body: { id: "s1", updatedAt, record: { id: "s1", title: `v${i}` } }
    }), env);
    assert.equal((await response.json()).applied, true);
  }
  const versions = await (await handleSopsVersions(await authedRequest("/api/sops/versions?id=s1", "bob@example.com"), env)).json();
  assert.equal(versions.versions.length, 50);
  assert.equal(versions.versions[0].record.title, "v54");
  assert.equal((await (await handleSopsDelete(await authedRequest("/api/sops/delete", "bob@example.com", {
    method: "POST", body: { id: "s1", deletedAt: stamp(-10_000) }
  }), env)).json()).applied, true);
  const list = await (await handleSopsList(await authedRequest("/api/sops", "alice@example.com"), env)).json();
  assert.equal(list.sops.at(-1).deleted, true);
  assert.equal(list.sops.at(-1).record.title, "v54");
  assert.equal((await (await handleSopsUpsert(await authedRequest("/api/sops/upsert", "alice@example.com", {
    method: "POST", body: { id: "s1", updatedAt: stamp(-5_000), record: { id: "s1", title: "restored" } }
  }), env)).json()).applied, true);
  const restored = await (await handleSopsList(await authedRequest("/api/sops", "alice@example.com"), env)).json();
  assert.equal(restored.sops.at(-1).deleted, false);
  assert.deepEqual(env.broadcasts.at(-1), { type: "sops_updated", id: "s1" });
});

test("SOP file upload dedupes, enforces size and type limits, and downloads bytes", async () => {
  const env = makeEnv();
  const bytes = new TextEncoder().encode("hello").buffer;
  const uploadReq = () => authedRequest("/api/sops/files", "alice@example.com", {
    method: "POST",
    body: bytes,
    headers: { "Content-Type": "text/plain", "X-File-Name": encodeURIComponent("note.txt") }
  });
  const uploaded = await (await handleSopFileUpload(await uploadReq(), env)).json();
  assert.equal(uploaded.ok, true);
  assert.equal(uploaded.size, 5);
  assert.equal((await handleSopFileUpload(await uploadReq(), env)).status, 200);
  assert.equal(env.CACHE.data.size, 1);
  const download = await handleSopFileDownload(await authedRequest(`/api/sops/files/${uploaded.fileId}`, "alice@example.com"), env, uploaded.fileId);
  assert.equal(download.headers.get("Content-Type"), "text/plain");
  assert.equal(new TextDecoder().decode(await download.arrayBuffer()), "hello");
  assert.equal((await handleSopFileUpload(await authedRequest("/api/sops/files", "alice@example.com", {
    method: "POST", body: bytes, headers: { "Content-Type": "application/x-msdownload", "X-File-Name": "bad.exe" }
  }), env)).status, 415);
  const tooLarge = new ArrayBuffer(20 * 1024 * 1024 + 1);
  assert.equal((await handleSopFileUpload(await authedRequest("/api/sops/files", "alice@example.com", {
    method: "POST", body: tooLarge, headers: { "Content-Type": "text/plain", "X-File-Name": "big.txt" }
  }), env)).status, 413);
});

test("chat directory, DMs, groups, idempotent messages, pagination, read state, inbox, and broadcasts", async () => {
  const env = makeEnv();
  await env.CACHE.put("users:v1", JSON.stringify({ users: [{ email: "alice@example.com", display_name: "Alice" }, { email: "bob@example.com", full_name: "Bob" }] }));
  const directory = await (await handleChatDirectory(await authedRequest("/api/chat/directory", "alice@example.com"), env)).json();
  assert.deepEqual(directory.users.map((u) => u.name), ["Alice", "Bob", "carol@example.com"]);

  const dm1 = await (await handleChatConversationCreate(await authedRequest("/api/chat/conversations", "alice@example.com", {
    method: "POST", body: { kind: "dm", with: "bob@example.com" }
  }), env)).json();
  const dm2 = await (await handleChatConversationCreate(await authedRequest("/api/chat/conversations", "bob@example.com", {
    method: "POST", body: { kind: "dm", with: "alice@example.com" }
  }), env)).json();
  assert.equal(dm1.conversation.id, dm2.conversation.id);

  assert.equal((await handleChatConversationCreate(await authedRequest("/api/chat/conversations", "alice@example.com", {
    method: "POST", body: { kind: "group", name: "Bad", members: ["nobody@example.com"] }
  }), env)).status, 400);
  const group = await (await handleChatConversationCreate(await authedRequest("/api/chat/conversations", "alice@example.com", {
    method: "POST", body: { kind: "group", name: "Team", members: ["bob@example.com"] }
  }), env)).json();
  assert.equal((await handleChatMessages(await authedRequest(`/api/chat/messages?conversationId=${group.conversation.id}`, "carol@example.com"), env)).status, 404);

  const first = await (await handleChatMessageSend(await authedRequest("/api/chat/messages", "alice@example.com", {
    method: "POST", body: { conversationId: dm1.conversation.id, clientId: crypto.randomUUID(), body: "hello bob", attachments: [] }
  }), env)).json();
  assert.equal(first.message.body, "hello bob");
  assert.equal(JSON.stringify(env.broadcasts).includes("hello bob"), false);
  assert.equal(JSON.stringify(env.broadcasts).includes("alice@example.com"), false);
  assert.equal((await (await handleChatMessageSend(await authedRequest("/api/chat/messages", "alice@example.com", {
    method: "POST", body: { conversationId: dm1.conversation.id, clientId: first.message.id, body: "changed", attachments: [] }
  }), env)).json()).message.body, "hello bob");
  const second = await (await handleChatMessageSend(await authedRequest("/api/chat/messages", "bob@example.com", {
    method: "POST", body: { conversationId: dm1.conversation.id, clientId: crypto.randomUUID(), body: "", attachments: [{ type: "quote", quoteId: "q1", label: "Quote", sublabel: "" }] }
  }), env)).json();

  const afterFirst = await (await handleChatMessages(await authedRequest(`/api/chat/messages?conversationId=${dm1.conversation.id}&after=${encodeURIComponent(first.message.createdAt)}`, "alice@example.com"), env)).json();
  assert.deepEqual(afterFirst.messages.map((m) => m.id), [second.message.id]);
  const beforeSecond = await (await handleChatMessages(await authedRequest(`/api/chat/messages?conversationId=${dm1.conversation.id}&before=${encodeURIComponent(second.message.createdAt)}&limit=1`, "alice@example.com"), env)).json();
  assert.deepEqual(beforeSecond.messages.map((m) => m.id), [first.message.id]);
  const newestPage = await (await handleChatMessages(await authedRequest(`/api/chat/messages?conversationId=${dm1.conversation.id}&limit=1`, "alice@example.com"), env)).json();
  assert.deepEqual(newestPage.messages.map((m) => m.id), [second.message.id]);
  const bothPage = await (await handleChatMessages(await authedRequest(`/api/chat/messages?conversationId=${dm1.conversation.id}`, "alice@example.com"), env)).json();
  assert.deepEqual(bothPage.messages.map((m) => m.id), [first.message.id, second.message.id]);

  // Reusing another conversation's message id must not reveal that message.
  const groupReplay = await handleChatMessageSend(await authedRequest("/api/chat/messages", "bob@example.com", {
    method: "POST", body: { conversationId: group.conversation.id, clientId: first.message.id, body: "x", attachments: [] }
  }), env);
  assert.equal(groupReplay.status, 409);
  assert.equal(JSON.stringify(await groupReplay.json()).includes("hello bob"), false);

  let convs = await (await handleChatConversations(await authedRequest("/api/chat/conversations", "alice@example.com"), env)).json();
  assert.equal(convs.conversations.find((c) => c.id === dm1.conversation.id).unread, 1);
  assert.deepEqual(await (await handleChatRead(await authedRequest("/api/chat/read", "alice@example.com", {
    method: "POST", body: { conversationId: dm1.conversation.id, at: second.message.createdAt }
  }), env)).json(), { ok: true });
  convs = await (await handleChatConversations(await authedRequest("/api/chat/conversations", "alice@example.com"), env)).json();
  assert.equal(convs.conversations.find((c) => c.id === dm1.conversation.id).unread, 0);
  const inbox = await (await handleChatInbox(await authedRequest(`/api/chat/inbox?since=${encodeURIComponent(first.message.createdAt)}`, "alice@example.com"), env)).json();
  assert.deepEqual(inbox.messages.map((m) => m.id), [second.message.id]);
  assert.equal(typeof inbox.serverTime, "string");
});
