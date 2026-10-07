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
  handleChatReactions,
  handleChatReactionSet,
  handleChatRead
} from "../src/chat.js";
import {handleChatImageUpload, handleChatImageDownload} from "../src/chat-images.js";
import {handleCustomEmojisList, handleCustomEmojiUpload, handleCustomEmojiDownload, handleCustomEmojiFromGif} from "../src/custom-emojis.js";

const SECRET = "01234567890123456789012345678901";
const OUTBOUND_TOKEN = "outbound-token";
const ALLOWED_EMAILS_LIST = "alice@example.com,bob@example.com,carol@example.com";

test("shared emojis enforce auth, format, size, uniqueness and work in messages and reactions", async () => {
  const env = makeEnv();
  const bytes = Uint8Array.from([137, 80, 78, 71, 13, 10, 26, 10, 1]).buffer;
  const upload = (name, data = bytes, type = "image/png") => authedRequest(`/api/chat/emojis?name=${name}`, "alice@example.com",
    {method: "POST", body: data, headers: {"Content-Type": type}}).then(request => handleCustomEmojiUpload(request, env));
  assert.equal((await handleCustomEmojisList(new Request("https://worker.example/api/chat/emojis"), env)).status, 401);
  assert.equal((await handleCustomEmojiUpload(new Request("https://worker.example/api/chat/emojis?name=team", {method: "POST", body: bytes}), env)).status, 401);
  for (const name of ["Bad", "bad%20name", "_bad", "x".repeat(33)]) assert.equal((await upload(name)).status, 400);
  assert.equal((await upload("team", bytes, "image/svg+xml")).status, 415);
  assert.equal((await upload("team", new Uint8Array([1, 2, 3]).buffer)).status, 400);
  assert.equal((await upload("team", new ArrayBuffer(512 * 1024 + 1))).status, 413);
  const first = await upload("team");
  assert.equal(first.status, 200);
  const {emoji} = await first.json();
  assert.match(emoji.id, /^[a-f0-9]{64}$/);
  assert.equal((await upload("team")).status, 200);
  assert.equal((await upload("second")).status, 409, "same image cannot silently change name");
  assert.equal((await upload("team", Uint8Array.from([...new Uint8Array(bytes), 2]).buffer)).status, 409);
  const list = await (await handleCustomEmojisList(await authedRequest("/api/chat/emojis", "carol@example.com"), env)).json();
  assert.deepEqual(list.emojis, [emoji], "catalog is shared outside conversation membership");
  const download = await handleCustomEmojiDownload(await authedRequest(`/api/chat/emojis/image?id=${emoji.id}`, "bob@example.com"), env);
  assert.deepEqual(await download.arrayBuffer(), bytes);
  assert.equal(download.headers.get("X-Content-Type-Options"), "nosniff");
  assert.equal(download.headers.get("Cache-Control"), "private, no-store");
  assert.equal((await handleCustomEmojiDownload(new Request(`https://worker.example/api/chat/emojis/image?id=${emoji.id}`), env)).status, 401);

  const conversation = (await (await handleChatConversationCreate(await authedRequest("/api/chat/conversations", "alice@example.com",
    {method: "POST", body: {kind: "dm", with: "bob@example.com"}}), env)).json()).conversation;
  const send = (attachments, sender = "alice@example.com") => authedRequest("/api/chat/messages", sender,
    {method: "POST", body: {conversationId: conversation.id, clientId: crypto.randomUUID(), attachments}})
    .then(request => handleChatMessageSend(request, env));
  const response = await send([{type: "custom_emoji", emojiId: emoji.id, name: "forged"}]);
  assert.equal(response.status, 200);
  const {message} = await response.json();
  assert.deepEqual(message.attachments, [{type: "custom_emoji", emojiId: emoji.id, name: "team"}]);
  assert.equal((await send([{type: "custom_emoji", emojiId: "a".repeat(64)}])).status, 400);
  assert.equal((await send([{type: "custom_emoji", emojiId: emoji.id}], "carol@example.com")).status, 404);
  const builtin = await send([{type: "builtin_emoji", emojiId: "heart", name: "forged"}]);
  assert.equal(builtin.status, 200);
  assert.deepEqual((await builtin.json()).message.attachments, [{type: "builtin_emoji", emojiId: "heart", name: "Love"}]);
  assert.equal((await send([{type: "builtin_emoji", emojiId: "bad"}])).status, 400);
  const react = (email, reaction, active = true) => authedRequest("/api/chat/reactions", email, {method: "POST",
    body: {conversationId: conversation.id, messageId: message.id, emoji: reaction, active}})
    .then(request => handleChatReactionSet(request, env));
  const reaction = `custom:${emoji.id}`;
  for (let i = 0; i < 2; i++) assert.equal((await react("bob@example.com", reaction)).status, 200);
  assert.equal((await react("carol@example.com", reaction)).status, 404);
  assert.equal((await react("bob@example.com", `custom:${"a".repeat(64)}`)).status, 400);
  assert.equal((await react("bob@example.com", "heart")).status, 200, "old built-in reactions remain supported");
  const history = await (await handleChatMessages(await authedRequest(`/api/chat/messages?conversationId=${conversation.id}`, "bob@example.com"), env)).json();
  assert.deepEqual(history.messages.find(item => item.id === message.id).reactions,
    [{emoji: reaction, users: ["bob@example.com"]}, {emoji: "heart", users: ["bob@example.com"]}]);
  assert.deepEqual((await (await react("bob@example.com", reaction, false)).json()).reactions[message.id],
    [{emoji: "heart", users: ["bob@example.com"]}]);
});

const ANIMATED_GIF = Uint8Array.from(Buffer.from(
  "47494638396101000100800000000000ffffff21ff0b4e45545343415045322e30030100000021f904000a0000002c000000000100010000020244010021f904000a0000002c00000000010001000002024c01003b", "hex")).buffer;

test("uploaded animated emoji GIFs retain their full animation bytes", async () => {
  const env = makeEnv();
  const uploaded = await handleCustomEmojiUpload(await authedRequest("/api/chat/emojis?name=blink", "alice@example.com",
    {method: "POST", body: ANIMATED_GIF, headers: {"Content-Type": "image/gif"}}), env);
  assert.equal(uploaded.status, 200);
  const {emoji} = await uploaded.json();
  const downloaded = await handleCustomEmojiDownload(await authedRequest(`/api/chat/emojis/image?id=${emoji.id}`, "bob@example.com"), env);
  assert.equal(downloaded.headers.get("Content-Type"), "image/gif");
  assert.deepEqual(await downloaded.arrayBuffer(), ANIMATED_GIF);
});

test("GIPHY emoji imports use a verified small GIF rendition and preserve bytes, size limits and attribution", async () => {
  const env = {...makeEnv(), GIPHY_API_KEY: "test-giphy-key"};
  const originalFetch = globalThis.fetch;
  const calls = [];
  let data = {id: "gif123", rating: "pg", images: {fixed_height_small:
    {url: "https://media.giphy.com/media/gif123/100.gif", size: String(ANIMATED_GIF.byteLength)}}};
  let mediaBytes = ANIMATED_GIF;
  let mediaStatus = 200;
  globalThis.fetch = async (url, options) => {
    calls.push({url: String(url), options});
    return String(url).startsWith("https://api.giphy.com/")
      ? Response.json({data}) : new Response(mediaBytes, {status: mediaStatus,
        ...(mediaStatus === 302 ? {headers: {Location: "https://evil.example/redirect.gif"}} : {})});
  };
  const save = (body = {name: "saved_gif", gifId: "gif123"}) => authedRequest("/api/chat/emojis/from-gif", "alice@example.com",
    {method: "POST", body}).then(request => handleCustomEmojiFromGif(request, env));
  try {
    const response = await save();
    assert.equal(response.status, 200);
    const {emoji} = await response.json();
    assert.equal(emoji.mimeType, "image/gif");
    assert.equal(emoji.sourceGifId, "gif123");
    const downloaded = await handleCustomEmojiDownload(await authedRequest(`/api/chat/emojis/image?id=${emoji.id}`, "bob@example.com"), env);
    assert.deepEqual(await downloaded.arrayBuffer(), ANIMATED_GIF);
    assert.equal(calls.length, 2);
    assert.equal(calls[1].options.redirect, "manual", "use the Workers-supported mode without following redirects");
    assert.equal(calls[1].options.headers, undefined, "user and service credentials never go to GIPHY media");
    assert.equal((await save({name: "bad", gifId: "https://evil.example"})).status, 400);
    assert.equal(calls.length, 2);
    data = {...data, images: {fixed_height_small: {url: "https://evil.example/animation.gif", size: "100"}}};
    assert.equal((await save()).status, 413);
    assert.equal(calls.length, 3, "untrusted media is never fetched");
    data = {...data, images: {fixed_height_small: {url: "https://media.giphy.com/animation.gif", size: "100"}}};
    mediaStatus = 302;
    assert.equal((await save()).status, 502, "redirect responses fail explicitly without following the destination");
    mediaStatus = 200;
    mediaBytes = new ArrayBuffer(512 * 1024 + 1);
    assert.equal((await save()).status, 413, "actual streamed bytes enforce the size limit, not GIPHY metadata");
    mediaBytes = new Uint8Array([1, 2, 3]).buffer;
    assert.equal((await save()).status, 400, "non-GIF media cannot be saved as an animated emoji");
    data = {...data, rating: "r"};
    assert.equal((await save()).status, 400);
    assert.equal((await handleCustomEmojiFromGif(new Request("https://worker.example/api/chat/emojis/from-gif", {method: "POST"}), env)).status, 401);
  } finally {globalThis.fetch = originalFetch;}
});

test("panel assignments preserve task metadata privately and reject invalid fields", async () => {
  const {payload, send, tasks} = await caseTagSetup();
  const task = {type: "call", remind_at: null, quote_id: "quote-001", quote_label: "Q-001",
    site_id: "00123", case_number: "000456", case_id: null, contact_name: "Homeowner", contact_phone: "555-0100"};
  const attachment = {type: "assigned_task", version: 2, recipient: "bob@example.com",
    title: "Call homeowner", note: "n".repeat(4000), dueAt: stamp(86400000), task};
  const request = {...payload, body: "Assigned task: Call homeowner", attachments: [attachment]};
  for (const response of await Promise.all([send(request), send(request)])) {
    assert.equal(response.status, 200);
    const result = await response.json();
    assert.equal(result.message.assignedTaskId, `chat-task:${payload.clientId}`);
    assert.deepEqual(result.message.attachments, []);
  }
  const recipientTasks = await tasks();
  assert.equal(recipientTasks.tasks.length, 1);
  const record = recipientTasks.tasks[0].record;
  for (const [field, value] of Object.entries(task)) assert.equal(record[field], value);
  assert.equal(record.notes.length, 4000);
  assert.equal(record.assigned_by, "alice@example.com");
  assert.equal((await tasks("alice@example.com")).tasks.length, 0);
  assert.equal((await tasks("carol@example.com")).tasks.length, 0);
  for (const patch of [{type: "admin"}, {remind_at: "bad"}, {site_id: 123}, {contact_phone: "x".repeat(41)}, {quote_id: {id: "q"}}]) {
    assert.equal((await send({...request, clientId: crypto.randomUUID(),
      attachments: [{...attachment, task: {...task, ...patch}}]})).status, 400);
  }
  const reminder = stamp(3600000);
  assert.equal((await send({...request, clientId: crypto.randomUUID(),
    attachments: [{...attachment, task: {...task, type: "follow_up", remind_at: reminder, owner: "carol@example.com"}}]})).status, 200);
  const second = (await tasks()).tasks.find(item => item.record.remind_at === reminder);
  assert.equal(second.record.type, "follow_up");
  assert.equal(second.record.owner, undefined, "unapproved fields cannot override task ownership");
});

test("general chat assignments create one private task in DMs or groups and retries never resurrect it", async () => {
  const {env, payload, send, tasks} = await caseTagSetup();
  const attachment = {type: "assigned_task", version: 1, recipient: "bob@example.com",
    title: "Check the invoice", note: "Please verify the total.", dueAt: stamp(86400000)};
  const request = {...payload, body: "Assigned task: Check the invoice", attachments: [attachment]};
  const responses = await Promise.all([send(request), send(request)]);
  for (const response of responses) {
    assert.equal(response.status, 200);
    const result = await response.json();
    assert.equal(result.message.assignedTaskId, `chat-task:${payload.clientId}`);
    assert.deepEqual(result.message.attachments, []);
  }
  const recipientTasks = await tasks();
  assert.equal(recipientTasks.tasks.length, 1);
  assert.equal(recipientTasks.tasks[0].record.title, attachment.title);
  assert.equal(recipientTasks.tasks[0].record.notes, attachment.note);
  assert.equal(recipientTasks.tasks[0].record.assigned_by, "alice@example.com");
  assert.equal(recipientTasks.tasks[0].record.source_message_id, payload.clientId);
  assert.equal((await tasks("alice@example.com")).tasks.length, 0);
  assert.equal((await tasks("carol@example.com")).tasks.length, 0);
  for (const patch of [{title: ""}, {title: "x".repeat(201)}, {note: "x".repeat(2001)}, {dueAt: "invalid"}, {version: 2}]) {
    assert.equal((await send({...request, clientId: crypto.randomUUID(), attachments: [{...attachment, ...patch}]})).status, 400);
  }
  assert.equal((await send({...request, clientId: crypto.randomUUID(), attachments: [{...attachment, recipient: "carol@example.com"}]})).status, 403);
  const group = await (await handleChatConversationCreate(await authedRequest("/api/chat/conversations", "alice@example.com", {
    method: "POST", body: {kind: "group", name: "Team", members: ["bob@example.com", "carol@example.com"]}
  }), env)).json();
  assert.equal((await send({...request, conversationId: group.conversation.id, clientId: crypto.randomUUID(),
    attachments: [{...attachment, recipient: "carol@example.com"}]})).status, 200);
  assert.equal((await tasks("carol@example.com")).tasks.length, 1);
  await handleTasksDelete(await authedRequest("/api/tasks/delete", "bob@example.com", {
    method: "POST", body: {id: `chat-task:${payload.clientId}`, deletedAt: stamp(1000)}
  }), env);
  assert.equal((await send(request)).status, 200);
  assert.equal((await tasks()).tasks[0].deleted, true);
});

test("internal app links survive send and history without permitting external redirects or arbitrary selectors", async () => {
  const {env, payload, send} = await caseTagSetup();
  const link = {type: "app_link", label: "Quote Q-123", path: "/QuoteDetails?id=123", target: {kind: "record", value: "quote:123"}};
  const sent = await (await send({...payload, body: "", attachments: [link]})).json();
  assert.deepEqual(sent.message.attachments, [link]);
  const history = await (await handleChatMessages(await authedRequest(`/api/chat/messages?conversationId=${payload.conversationId}`, "bob@example.com"), env)).json();
  assert.deepEqual(history.messages[0].attachments, [link]);
  for (const invalid of [
    {...link, path: "//evil.example"},
    {...link, path: "javascript:alert(1)"},
    {...link, path: "/Quotes?token=sensitive"},
    {...link, target: {kind: "selector", value: "body"}},
    {...link, label: "x".repeat(161)}
  ]) {
    assert.equal((await send({...payload, clientId: crypto.randomUUID(), body: "", attachments: [invalid]})).status, 400);
  }
});

test("message reactions are member-scoped, persistent, multi-emoji, idempotent, and do not create unread messages", async () => {
  const {env, payload, send} = await caseTagSetup();
  await send({...payload, attachments: []});
  const react = (emoji, active = true, email = "alice@example.com", patch = {}) =>
    authedRequest("/api/chat/reactions", email, {method: "POST", body: {
      conversationId: payload.conversationId, messageId: payload.clientId, emoji, active, ...patch
    }}).then(request => handleChatReactionSet(request, env));
  const read = (email = "bob@example.com", messageId = payload.clientId) =>
    authedRequest(`/api/chat/reactions?conversationId=${payload.conversationId}&messageIds=${messageId}`, email)
      .then(request => handleChatReactions(request, env)).then(response => response.json());
  const before = await (await handleChatConversations(await authedRequest("/api/chat/conversations", "bob@example.com"), env)).json();
  await react("thumbs_up");
  await react("thumbs_up");
  await react("heart");
  await react("thumbs_up", true, "bob@example.com");
  const current = (await read()).reactions[payload.clientId];
  assert.deepEqual(current, [
    {emoji: "heart", users: ["alice@example.com"]},
    {emoji: "thumbs_up", users: ["alice@example.com", "bob@example.com"]}
  ]);
  const history = await (await handleChatMessages(await authedRequest(`/api/chat/messages?conversationId=${payload.conversationId}`, "bob@example.com"), env)).json();
  assert.deepEqual(history.messages[0].reactions, current);
  await react("thumbs_up", false);
  await react("thumbs_up", false);
  assert.deepEqual((await read()).reactions[payload.clientId], [
    {emoji: "heart", users: ["alice@example.com"]}, {emoji: "thumbs_up", users: ["bob@example.com"]}
  ]);
  assert.equal((await react("heart", true, "carol@example.com")).status, 404);
  assert.equal((await react("unsupported")).status, 400);
  assert.equal((await react("heart", "yes")).status, 400);
  assert.equal((await react("heart", true, "alice@example.com", {messageId: "missing"})).status, 404);
  assert.equal((await read("carol@example.com")).ok, false);
  assert.deepEqual((await read("bob@example.com", "missing")).reactions, {});
  const after = await (await handleChatConversations(await authedRequest("/api/chat/conversations", "bob@example.com"), env)).json();
  assert.deepEqual(after, before);
  const changes = env.broadcasts.filter(event => event.type === "chat_reactions_updated");
  assert.ok(changes.length > 0);
  assert.equal(JSON.stringify(changes).includes("alice@example.com"), false);
  await env.DB.prepare("UPDATE chat_members SET left_at = ? WHERE conversation_id = ? AND email = ?")
    .bind(stamp(), payload.conversationId, "bob@example.com").run();
  assert.equal((await react("heart", true, "bob@example.com")).status, 404);
  assert.equal((await read()).ok, false);
  await env.DB.prepare("UPDATE chat_messages SET body = ?, attachments = ? WHERE id = ?")
    .bind("[removed by admin]", "[]", payload.clientId).run();
  assert.equal((await react("heart")).status, 404);
});

test("screenshots upload, send, and download only within their authorized conversation", async () => {
  const env = makeEnv();
  const conversation = await (await handleChatConversationCreate(await authedRequest("/api/chat/conversations", "alice@example.com", {
    method: "POST", body: {kind: "dm", with: "bob@example.com"}
  }), env)).json();
  const conversationId = conversation.conversation.id;
  const bytes = new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10, 0]).buffer;
  const upload = (email = "alice@example.com", type = "image/png", body = bytes) =>
    authedRequest(`/api/chat/images?conversationId=${conversationId}`, email, {
      method: "POST", body, headers: {"Content-Type": type}
    }).then(req => handleChatImageUpload(req, env));
  const result = await (await upload()).json();
  assert.equal(result.ok, true);
  assert.equal(result.image.size, bytes.byteLength);
  assert.equal((await upload()).status, 200);
  const url = `/api/chat/images?conversationId=${conversationId}&fileId=${result.image.fileId}`;
  const downloaded = await handleChatImageDownload(await authedRequest(url, "bob@example.com"), env);
  assert.equal(downloaded.status, 200);
  assert.deepEqual(await downloaded.arrayBuffer(), bytes);
  assert.equal((await handleChatImageDownload(await authedRequest(url, "carol@example.com"), env)).status, 404);
  assert.equal((await upload("carol@example.com")).status, 404);
  assert.equal((await upload("alice@example.com", "image/svg+xml")).status, 415);
  assert.equal((await upload("alice@example.com", "image/png", new Uint8Array([1, 2, 3]).buffer)).status, 400);
  assert.equal((await upload("alice@example.com", "image/png", new ArrayBuffer(5 * 1024 * 1024 + 1))).status, 413);
  const sent = await (await handleChatMessageSend(await authedRequest("/api/chat/messages", "alice@example.com", {
    method: "POST", body: {conversationId, clientId: crypto.randomUUID(), body: "", attachments: [result.image]}
  }), env)).json();
  assert.equal(sent.message.attachments[0].fileId, result.image.fileId);
  const received = await (await handleChatMessages(await authedRequest(
    `/api/chat/messages?conversationId=${conversationId}`, "bob@example.com"), env)).json();
  assert.deepEqual(received.messages[0].attachments, [result.image]);
  const other = await (await handleChatConversationCreate(await authedRequest("/api/chat/conversations", "alice@example.com", {
    method: "POST", body: {kind: "dm", with: "carol@example.com"}
  }), env)).json();
  const crossThread = await handleChatMessageSend(await authedRequest("/api/chat/messages", "alice@example.com", {
    method: "POST", body: {conversationId: other.conversation.id, clientId: crypto.randomUUID(), body: "", attachments: [result.image]}
  }), env);
  assert.equal(crossThread.status, 400);
  await env.DB.prepare("UPDATE chat_members SET left_at = ? WHERE conversation_id = ? AND email = ?")
    .bind(stamp(), conversationId, "bob@example.com").run();
  assert.equal((await handleChatImageDownload(await authedRequest(url, "bob@example.com"), env)).status, 404);
});

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

test("claimed Super Admin or viewed-user identity cannot bypass private chat membership", async () => {
  const env = makeEnv();
  const conversation = await (await handleChatConversationCreate(await authedRequest("/api/chat/conversations", "alice@example.com", {
    method: "POST", body: {kind: "dm", with: "bob@example.com"}
  }), env)).json();
  const conversationId = conversation.conversation.id;
  await handleChatMessageSend(await authedRequest("/api/chat/messages", "alice@example.com", {
    method: "POST", body: {conversationId, clientId: crypto.randomUUID(), body: "Private to Alice and Bob"}
  }), env);
  const headers = {"X-EnQuote-Role": "super_admin", "X-EnQuote-Act-As": "alice@example.com"};
  const denied = await handleChatMessages(await authedRequest(
    `/api/chat/messages?conversationId=${conversationId}&email=alice@example.com`,
    "carol@example.com", {headers}
  ), env);
  assert.equal(denied.status, 404);
  const list = await (await handleChatConversations(await authedRequest(
    "/api/chat/conversations?email=alice@example.com", "carol@example.com", {headers}
  ), env)).json();
  assert.deepEqual(list.conversations, []);
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
