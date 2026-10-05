import { broadcastMessage } from "./realtime.js";
import { allowedEmails, authenticateUser, inboxKeyForEmail } from "./user-token.js";
import { json } from "./util.js";
import { parseRecord, validateStamp } from "./tasks.js";

function nowIso() { return new Date().toISOString(); }
function invalidId(id) { return typeof id !== "string" || !id || id.length > 100; }
function trimString(value, max) {
  return typeof value === "string" ? value.trim().slice(0, max) : "";
}
async function readBody(request) {
  try { return await request.json(); } catch { return null; }
}

async function activeMember(env, conversationId, email) {
  const row = (await env.DB.prepare(`
    SELECT conversation_id AS conversationId, last_read_at AS lastReadAt
    FROM chat_members WHERE conversation_id = ? AND email = ? AND left_at IS NULL
  `).bind(conversationId, email).all()).results?.[0];
  return row || null;
}

async function getMembers(env, conversationId) {
  const { results } = await env.DB.prepare(`
    SELECT email, last_read_at AS lastReadAt
    FROM chat_members WHERE conversation_id = ? AND left_at IS NULL ORDER BY email
  `).bind(conversationId).all();
  return results || [];
}

async function unreadFor(env, conversationId, email, lastReadAt) {
  const row = (await env.DB.prepare(`
    SELECT COUNT(*) AS count FROM chat_messages
    WHERE conversation_id = ? AND sender != ? AND created_at > ?
  `).bind(conversationId, email, lastReadAt || "").all()).results?.[0];
  return Math.min(99, Number(row?.count || 0));
}

async function conversationShape(env, row, callerEmail) {
  const members = await getMembers(env, row.id);
  const me = members.find((m) => m.email === callerEmail);
  return {
    id: row.id,
    kind: row.kind,
    name: row.name,
    createdBy: row.created_by ?? row.createdBy,
    createdAt: row.created_at ?? row.createdAt,
    lastMessageAt: row.last_message_at ?? row.lastMessageAt,
    lastMessagePreview: row.last_message_preview ?? row.lastMessagePreview,
    lastSender: row.last_sender ?? row.lastSender,
    members,
    unread: await unreadFor(env, row.id, callerEmail, me?.lastReadAt)
  };
}

async function getConversation(env, id, callerEmail) {
  const member = await activeMember(env, id, callerEmail);
  if (!member) return null;
  const row = (await env.DB.prepare(`
    SELECT id, kind, name, created_by, created_at, updated_at, last_message_at, last_message_preview, last_sender
    FROM chat_conversations WHERE id = ?
  `).bind(id).all()).results?.[0];
  return row ? conversationShape(env, row, callerEmail) : null;
}

async function notifyInbox(env, conversationId) {
  try {
    const members = await getMembers(env, conversationId);
    const keys = [];
    for (const member of members) keys.push(await inboxKeyForEmail(member.email, env.USER_TOKEN_SECRET));
    await broadcastMessage(env, { type: "inbox_updated", keys });
  } catch (error) {
    console.warn("[chat] Realtime notification failed:", error.message);
  }
}

function validateAttachments(value) {
  if (value == null) return [];
  if (!Array.isArray(value) || value.length > 10) return "invalid_attachments";
  const out = [];
  for (const item of value) {
    if (!item || typeof item !== "object" || item.type !== "quote") return "invalid_attachment_type";
    const attachment = { type: "quote" };
    for (const key of ["quoteId", "label", "sublabel"]) {
      if (typeof item[key] !== "string") return "invalid_attachment";
      const text = item[key];
      if (text.length > 200) return "invalid_attachment";
      attachment[key] = text;
    }
    out.push(attachment);
  }
  return out;
}

function messageShape(row) {
  return {
    id: row.id,
    conversationId: row.conversation_id ?? row.conversationId,
    sender: row.sender,
    body: row.body,
    attachments: parseRecord(row.attachments) || [],
    createdAt: row.created_at ?? row.createdAt
  };
}

export async function handleChatDirectory(request, env) {
  const user = await authenticateUser(request, env);
  if (user.error) return user.error;
  let cached = await env.CACHE?.get?.("users:v1", "json");
  if (typeof cached === "string") {
    try { cached = JSON.parse(cached); } catch { cached = null; }
  }
  const names = new Map();
  for (const u of cached?.users || []) {
    const email = String(u.email || "").trim().toLowerCase();
    if (email) names.set(email, u.display_name || u.full_name || u.name || email);
  }
  const users = allowedEmails(env).map((email) => ({ email, name: names.get(email) || email }))
    .sort((a, b) => a.name.localeCompare(b.name) || a.email.localeCompare(b.email));
  return json({ ok: true, users });
}

export async function handleChatConversations(request, env) {
  const user = await authenticateUser(request, env);
  if (user.error) return user.error;
  const { results } = await env.DB.prepare(`
    SELECT c.id, c.kind, c.name, c.created_by, c.created_at, c.updated_at,
           c.last_message_at, c.last_message_preview, c.last_sender
    FROM chat_conversations c
    JOIN chat_members m ON m.conversation_id = c.id
    WHERE m.email = ? AND m.left_at IS NULL
    ORDER BY COALESCE(c.last_message_at, c.updated_at, c.created_at) DESC
  `).bind(user.email).all();
  const conversations = [];
  for (const row of results || []) conversations.push(await conversationShape(env, row, user.email));
  return json({ ok: true, conversations });
}

export async function handleChatConversationCreate(request, env) {
  const user = await authenticateUser(request, env);
  if (user.error) return user.error;
  const body = await readBody(request);
  const allowed = new Set(allowedEmails(env));
  const at = nowIso();
  let id = crypto.randomUUID();
  if (body?.kind === "dm") {
    const other = String(body.with || "").trim().toLowerCase();
    if (!allowed.has(other)) return json({ ok: false, error: "unknown_member" }, 400);
    if (other === user.email) return json({ ok: false, error: "invalid_member" }, 400);
    const dmKey = [user.email, other].sort().join("|");
    const existing = (await env.DB.prepare("SELECT id FROM chat_conversations WHERE dm_key = ?").bind(dmKey).all()).results?.[0];
    if (existing) return json({ ok: true, conversation: await getConversation(env, existing.id, user.email) });
    await env.DB.batch([
      env.DB.prepare(`
        INSERT OR IGNORE INTO chat_conversations (id, kind, name, dm_key, created_by, created_at, updated_at, last_message_at, last_message_preview, last_sender)
        VALUES (?, 'dm', NULL, ?, ?, ?, ?, NULL, NULL, NULL)
      `).bind(id, dmKey, user.email, at, at),
      env.DB.prepare("INSERT OR IGNORE INTO chat_members (conversation_id, email, joined_at, last_read_at, left_at) VALUES (?, ?, ?, NULL, NULL)").bind(id, user.email, at),
      env.DB.prepare("INSERT OR IGNORE INTO chat_members (conversation_id, email, joined_at, last_read_at, left_at) VALUES (?, ?, ?, NULL, NULL)").bind(id, other, at)
    ]);
  } else if (body?.kind === "group") {
    const name = trimString(body.name, 80);
    if (!name) return json({ ok: false, error: "invalid_name" }, 400);
    const members = [...new Set([user.email, ...(Array.isArray(body.members) ? body.members : []).map((e) => String(e).trim().toLowerCase())])];
    if (members.length < 2 || members.length > 50) return json({ ok: false, error: "invalid_members" }, 400);
    if (members.some((email) => !allowed.has(email))) return json({ ok: false, error: "unknown_member" }, 400);
    const statements = [
      env.DB.prepare(`
        INSERT INTO chat_conversations (id, kind, name, dm_key, created_by, created_at, updated_at, last_message_at, last_message_preview, last_sender)
        VALUES (?, 'group', ?, NULL, ?, ?, ?, NULL, NULL, NULL)
      `).bind(id, name, user.email, at, at)
    ];
    for (const member of members) {
      statements.push(env.DB.prepare("INSERT INTO chat_members (conversation_id, email, joined_at, last_read_at, left_at) VALUES (?, ?, ?, NULL, NULL)").bind(id, member, at));
    }
    await env.DB.batch(statements);
  } else {
    return json({ ok: false, error: "invalid_kind" }, 400);
  }
  await notifyInbox(env, id);
  return json({ ok: true, conversation: await getConversation(env, id, user.email) });
}

export async function handleChatConversationUpdate(request, env) {
  const user = await authenticateUser(request, env);
  if (user.error) return user.error;
  const body = await readBody(request);
  const id = body?.id;
  if (invalidId(id)) return json({ ok: false, error: "invalid_id" }, 400);
  const current = await getConversation(env, id, user.email);
  if (!current) return json({ ok: false, error: "not_found" }, 404);
  if (current.kind !== "group") return json({ ok: false, error: "not_a_group" }, 400);
  const allowed = new Set(allowedEmails(env));
  const at = nowIso();
  const statements = [];
  if (Object.prototype.hasOwnProperty.call(body, "name")) {
    const name = trimString(body.name, 80);
    if (!name) return json({ ok: false, error: "invalid_name" }, 400);
    statements.push(env.DB.prepare("UPDATE chat_conversations SET name = ?, updated_at = ? WHERE id = ?").bind(name, at, id));
  }
  if (Array.isArray(body.addMembers)) {
    const members = [...new Set(body.addMembers.map((e) => String(e).trim().toLowerCase()))];
    if (members.some((email) => !allowed.has(email))) return json({ ok: false, error: "unknown_member" }, 400);
    const active = new Set(current.members.map((member) => member.email));
    for (const member of members) active.add(member);
    if (body.leave === true) active.delete(user.email);
    if (active.size > 50) return json({ ok: false, error: "invalid_members" }, 400);
    for (const member of members) {
      statements.push(env.DB.prepare(`
        INSERT INTO chat_members (conversation_id, email, joined_at, last_read_at, left_at)
        VALUES (?, ?, ?, NULL, NULL)
        ON CONFLICT(conversation_id, email) DO UPDATE SET left_at = NULL
      `).bind(id, member, at));
    }
  }
  if (body.leave === true) {
    statements.push(env.DB.prepare("UPDATE chat_members SET left_at = ? WHERE conversation_id = ? AND email = ?").bind(at, id, user.email));
  }
  if (statements.length) await env.DB.batch(statements);
  await notifyInbox(env, id);
  if (body.leave === true) {
    const row = (await env.DB.prepare(`
      SELECT id, kind, name, created_by, created_at, updated_at, last_message_at, last_message_preview, last_sender
      FROM chat_conversations WHERE id = ?
    `).bind(id).all()).results?.[0];
    return json({ ok: true, conversation: await conversationShape(env, row, user.email) });
  }
  return json({ ok: true, conversation: await getConversation(env, id, user.email) });
}

export async function handleChatMessages(request, env) {
  const user = await authenticateUser(request, env);
  if (user.error) return user.error;
  const url = new URL(request.url);
  const id = url.searchParams.get("conversationId") || "";
  if (invalidId(id)) return json({ ok: false, error: "invalid_id" }, 400);
  if (!await activeMember(env, id, user.email)) return json({ ok: false, error: "not_found" }, 404);
  const before = url.searchParams.get("before") || "";
  const after = url.searchParams.get("after") || "";
  const limit = Math.min(100, Math.max(1, Number(url.searchParams.get("limit") || 50) || 50));
  if ((before && validateStamp(before)) || (after && validateStamp(after))) return json({ ok: false, error: "invalid_stamp" }, 400);
  let sql = "SELECT id, conversation_id, sender, body, attachments, created_at FROM chat_messages WHERE conversation_id = ?";
  const params = [id];
  // after = newer than the cursor (oldest first); before or no cursor = the newest page before it.
  const newestFirst = !after;
  if (after) { sql += " AND created_at > ? ORDER BY created_at ASC LIMIT ?"; params.push(after, limit); }
  else { if (before) { sql += " AND created_at < ?"; params.push(before); } sql += " ORDER BY created_at DESC LIMIT ?"; params.push(limit); }
  let rows = (await env.DB.prepare(sql).bind(...params).all()).results || [];
  if (newestFirst) rows = rows.reverse();
  return json({ ok: true, messages: rows.map(messageShape) });
}

export async function handleChatMessageSend(request, env) {
  const user = await authenticateUser(request, env);
  if (user.error) return user.error;
  const body = await readBody(request);
  const conversationId = body?.conversationId;
  if (invalidId(conversationId)) return json({ ok: false, error: "invalid_id" }, 400);
  if (!await activeMember(env, conversationId, user.email)) return json({ ok: false, error: "not_found" }, 404);
  const clientId = body?.clientId;
  if (typeof clientId !== "string" || !clientId || clientId.length > 64) return json({ ok: false, error: "invalid_client_id" }, 400);
  const existing = (await env.DB.prepare("SELECT id, conversation_id, sender, body, attachments, created_at FROM chat_messages WHERE id = ?").bind(clientId).all()).results?.[0];
  if (existing) {
    // A retry of the caller's own send is idempotent; any other reuse of an id must not reveal that message.
    if (existing.conversation_id !== conversationId || existing.sender !== user.email) return json({ ok: false, error: "duplicate_client_id" }, 409);
    return json({ ok: true, message: messageShape(existing) });
  }
  const attachments = validateAttachments(body?.attachments);
  if (typeof attachments === "string") return json({ ok: false, error: attachments }, 400);
  const text = typeof body?.body === "string" ? body.body.trim() : "";
  if (text.length > 4000 || (!text && attachments.length === 0)) return json({ ok: false, error: "invalid_body" }, 400);
  const at = nowIso();
  const preview = text.slice(0, 200);
  await env.DB.batch([
    env.DB.prepare("INSERT INTO chat_messages (id, conversation_id, sender, body, attachments, created_at) VALUES (?, ?, ?, ?, ?, ?)").bind(clientId, conversationId, user.email, text, JSON.stringify(attachments), at),
    env.DB.prepare("UPDATE chat_conversations SET updated_at = ?, last_message_at = ?, last_message_preview = ?, last_sender = ? WHERE id = ?").bind(at, at, preview, user.email, conversationId),
    env.DB.prepare("UPDATE chat_members SET last_read_at = CASE WHEN last_read_at IS NULL OR last_read_at < ? THEN ? ELSE last_read_at END WHERE conversation_id = ? AND email = ?").bind(at, at, conversationId, user.email)
  ]);
  await notifyInbox(env, conversationId);
  return json({ ok: true, message: { id: clientId, conversationId, sender: user.email, body: text, attachments, createdAt: at } });
}

export async function handleChatRead(request, env) {
  const user = await authenticateUser(request, env);
  if (user.error) return user.error;
  const body = await readBody(request);
  if (invalidId(body?.conversationId)) return json({ ok: false, error: "invalid_id" }, 400);
  const stampError = validateStamp(body?.at);
  if (stampError) return json({ ok: false, error: stampError }, 400);
  if (!await activeMember(env, body.conversationId, user.email)) return json({ ok: false, error: "not_found" }, 404);
  await env.DB.batch([
    env.DB.prepare("UPDATE chat_members SET last_read_at = CASE WHEN last_read_at IS NULL OR last_read_at < ? THEN ? ELSE last_read_at END WHERE conversation_id = ? AND email = ?").bind(body.at, body.at, body.conversationId, user.email)
  ]);
  return json({ ok: true });
}

export async function handleChatInbox(request, env) {
  const user = await authenticateUser(request, env);
  if (user.error) return user.error;
  const since = new URL(request.url).searchParams.get("since") || "";
  const stampError = since ? validateStamp(since) : null;
  if (stampError) return json({ ok: false, error: stampError }, 400);
  const { results } = await env.DB.prepare(`
    SELECT msg.id, msg.conversation_id, msg.sender, msg.body, msg.attachments, msg.created_at
    FROM chat_messages msg
    JOIN chat_members m ON m.conversation_id = msg.conversation_id
    WHERE m.email = ? AND m.left_at IS NULL AND msg.sender != ? AND msg.created_at > ?
    ORDER BY msg.created_at ASC LIMIT 50
  `).bind(user.email, user.email, since).all();
  const convs = (await env.DB.prepare(`
    SELECT conversation_id AS id, last_read_at AS lastReadAt FROM chat_members
    WHERE email = ? AND left_at IS NULL
  `).bind(user.email).all()).results || [];
  let unreadTotal = 0;
  for (const c of convs) unreadTotal += await unreadFor(env, c.id, user.email, c.lastReadAt);
  return json({ ok: true, messages: (results || []).map(messageShape), unreadTotal, serverTime: nowIso() });
}
