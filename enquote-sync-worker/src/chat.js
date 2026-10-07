import { broadcastMessage } from "./realtime.js";
import { allowedEmails, authenticateUser, inboxKeyForEmail } from "./user-token.js";
import { json } from "./util.js";
import { parseRecord, validateStamp } from "./tasks.js";
import {validateChatImage} from "./chat-images.js";
import {CHAT_REACTIONS} from "../../shared/chatReactionRules.js";
import {validAppLink} from "../../shared/appLinkRules.js";
import {validCustomEmojiId, customEmojiIdFromReaction} from "../../shared/customEmojiRules.js";
import {getCustomEmoji} from "./custom-emojis.js";

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
    if (!item || typeof item !== "object") return "invalid_attachment_type";
    if (item.type === "quote") {
      const attachment = { type: "quote" };
      for (const key of ["quoteId", "label", "sublabel"]) {
        if (typeof item[key] !== "string") return "invalid_attachment";
        const text = item[key];
        if (text.length > 200) return "invalid_attachment";
        attachment[key] = text;
      }
      out.push(attachment);
    } else if (item.type === "gif") {
      if (typeof item.id !== "string" || !item.id || item.id.length > 100) return "invalid_attachment";
      const url = validateGifUrl(item.url);
      const previewUrl = item.previewUrl ? validateGifUrl(item.previewUrl) : "";
      if (!url || (item.previewUrl && !previewUrl)) return "invalid_attachment";
      out.push({
        type: "gif",
        id: item.id,
        url,
        ...(previewUrl ? { previewUrl } : {}),
        ...(typeof item.title === "string" ? { title: item.title.slice(0, 200) } : {}),
        width: Number(item.width) || null,
        height: Number(item.height) || null
      });
    } else if (item.type === "builtin_emoji") {
      const reaction = CHAT_REACTIONS.find(choice => choice.id === item.emojiId);
      if (!reaction) return "invalid_custom_emoji";
      out.push({type: "builtin_emoji", emojiId: reaction.id, name: reaction.label});
    } else if (item.type === "custom_emoji") {
      if (!validCustomEmojiId(item.emojiId)) return "invalid_custom_emoji";
      out.push({type: "custom_emoji", emojiId: item.emojiId});
    } else if (item.type === "image") {
      if (typeof item.fileId !== "string" || !/^[a-f0-9]{64}$/.test(item.fileId) ||
          typeof item.name !== "string" || item.name.length > 200) return "invalid_attachment";
      out.push({type: "image", fileId: item.fileId, mimeType: item.mimeType, name: item.name});
    } else if (item.type === "app_link") {
      if (!validAppLink(item)) return "invalid_app_link";
      out.push({type: "app_link", label: item.label, path: item.path, target: {
        kind: item.target.kind,
        ...(item.target.kind === "page" ? {} : {value: item.target.value}),
        ...(item.target.kind === "text" ? {tag: item.target.tag} : {})
      }});
    } else if (item.type === "assigned_task") {
      if (value.length !== 1 || ![1, 2].includes(item.version) ||
          typeof item.recipient !== "string" || !item.recipient.trim() || item.recipient.length > 254 ||
          typeof item.title !== "string" || !item.title.trim() || item.title.trim().length > 200 ||
          typeof item.note !== "string" || item.note.length > (item.version === 2 ? 4000 : 2000) ||
          typeof item.dueAt !== "string" || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(item.dueAt) ||
          !Number.isFinite(Date.parse(item.dueAt)) || new Date(item.dueAt).toISOString() !== item.dueAt) return "invalid_assigned_task";
      let task;
      if (item.version === 2) {
        const fields = item.task;
        if (!fields || typeof fields !== "object" || Array.isArray(fields) ||
            !["call", "follow_up", "other"].includes(fields.type) ||
            !(fields.remind_at === null || (typeof fields.remind_at === "string" &&
              Number.isFinite(Date.parse(fields.remind_at)) && new Date(fields.remind_at).toISOString() === fields.remind_at))) return "invalid_assigned_task";
        task = {type: fields.type, remind_at: fields.remind_at};
        for (const [key, limit] of Object.entries({
          quote_id: 200, quote_label: 200, site_id: 100, case_number: 100,
          case_id: 100, contact_name: 120, contact_phone: 40
        })) {
          if (fields[key] !== null && (typeof fields[key] !== "string" || fields[key].length > limit)) return "invalid_assigned_task";
          task[key] = fields[key] === null ? null : fields[key].trim();
        }
      }
      out.push({type: "assigned_task", version: item.version, recipient: item.recipient.trim().toLowerCase(),
        title: item.title.trim(), note: item.note.trim(), dueAt: item.dueAt, ...(task ? {task} : {})});
    } else if (item.type === "case_task") {
      if (value.length !== 1 || item.version !== 1 ||
          typeof item.recipient !== "string" || item.recipient.length > 254 ||
          typeof item.caseNumber !== "string" || !/^\d{1,30}$/.test(item.caseNumber) ||
          typeof item.caseId !== "string" || (item.caseId && !/^500[a-zA-Z0-9]{12}(?:[a-zA-Z0-9]{3})?$/.test(item.caseId)) ||
          typeof item.note !== "string" || item.note.length > 2000 ||
          typeof item.dueAt !== "string" || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(item.dueAt) ||
          !Number.isFinite(Date.parse(item.dueAt)) ||
          new Date(item.dueAt).toISOString() !== item.dueAt) return "invalid_case_task";
      out.push({
        type: "case_task", version: 1,
        recipient: item.recipient.trim().toLowerCase(),
        caseNumber: item.caseNumber, caseId: item.caseId,
        note: item.note.trim(), dueAt: item.dueAt
      });
    } else {
      return "invalid_attachment_type";
    }
  }
  return out;
}

function validateGifUrl(value) {
  if (typeof value !== "string" || value.length > 500) return "";
  try {
    const parsed = new URL(value);
    if (parsed.protocol !== "https:") return "";
    if (!/^(i\.giphy\.com|media[0-9]*\.giphy\.com)$/i.test(parsed.hostname)) return "";
    return parsed.href;
  } catch {
    return "";
  }
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

async function reactionsForMessages(env, ids) {
  const result = Object.fromEntries(ids.map(id => [id, []]));
  if (!ids.length) return result;
  const rows = (await env.DB.prepare(`SELECT message_id, email, emoji FROM chat_reactions
    WHERE message_id IN (${ids.map(() => "?").join(",")}) ORDER BY emoji, email`).bind(...ids).all()).results || [];
  for (const row of rows) {
    const reactions = result[row.message_id];
    let reaction = reactions.find(item => item.emoji === row.emoji);
    if (!reaction) {
      reaction = {emoji: row.emoji, users: []};
      reactions.push(reaction);
    }
    reaction.users.push(row.email);
  }
  return result;
}

export async function handleChatReactions(request, env) {
  const user = await authenticateUser(request, env);
  if (user.error) return user.error;
  const url = new URL(request.url);
  const conversationId = url.searchParams.get("conversationId");
  const ids = (url.searchParams.get("messageIds") || "").split(",");
  if (invalidId(conversationId) || ids.length > 99 || ids.some(invalidId)) return json({ok: false, error: "invalid_id"}, 400);
  if (!await activeMember(env, conversationId, user.email)) return json({ok: false, error: "not_found"}, 404);
  const rows = (await env.DB.prepare(`SELECT id FROM chat_messages WHERE conversation_id = ?
    AND id IN (${ids.map(() => "?").join(",")})`).bind(conversationId, ...ids).all()).results || [];
  return json({ok: true, conversationId, reactions: await reactionsForMessages(env, rows.map(row => row.id))});
}

export async function handleChatReactionSet(request, env) {
  const user = await authenticateUser(request, env);
  if (user.error) return user.error;
  const body = await readBody(request);
  if (invalidId(body?.conversationId) || invalidId(body?.messageId) ||
      typeof body?.active !== "boolean" || (!CHAT_REACTIONS.some(item => item.id === body?.emoji) &&
        !customEmojiIdFromReaction(body?.emoji))) {
    return json({ok: false, error: "invalid_reaction"}, 400);
  }
  if (!await activeMember(env, body.conversationId, user.email)) return json({ok: false, error: "not_found"}, 404);
  const customId = customEmojiIdFromReaction(body.emoji);
  if (customId && !await getCustomEmoji(env, customId)) return json({ok: false, error: "invalid_reaction"}, 400);
  const message = (await env.DB.prepare("SELECT id, body FROM chat_messages WHERE id = ? AND conversation_id = ?")
    .bind(body.messageId, body.conversationId).all()).results?.[0];
  if (!message || message.body === "[removed by admin]") return json({ok: false, error: "not_found"}, 404);
  if (body.active) {
    await env.DB.prepare(`INSERT OR IGNORE INTO chat_reactions (message_id, email, emoji)
      SELECT ?, ?, ? FROM chat_messages WHERE id = ? AND body != ?`)
      .bind(body.messageId, user.email, body.emoji, body.messageId, "[removed by admin]").run();
  } else {
    await env.DB.prepare("DELETE FROM chat_reactions WHERE message_id = ? AND email = ? AND emoji = ?")
      .bind(body.messageId, user.email, body.emoji).run();
  }
  const reactions = await reactionsForMessages(env, [body.messageId]);
  try {
    const members = await getMembers(env, body.conversationId);
    const keys = await Promise.all(members.map(member => inboxKeyForEmail(member.email, env.USER_TOKEN_SECRET)));
    await broadcastMessage(env, {type: "chat_reactions_updated", keys, conversationId: body.conversationId, messageId: body.messageId});
  } catch (error) {
    console.warn("[chat] Reaction realtime notification failed:", error.message);
  }
  return json({ok: true, conversationId: body.conversationId, reactions});
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
  const reactions = await reactionsForMessages(env, rows.map(row => row.id));
  return json({ ok: true, messages: rows.map(row => ({...messageShape(row), reactions: reactions[row.id]})) });
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
  const attachments = validateAttachments(body?.attachments);
  if (typeof attachments === "string") return json({ ok: false, error: attachments }, 400);
  const caseTask = attachments.find((item) => item.type === "case_task" || item.type === "assigned_task");
  const assignedTask = caseTask?.type === "assigned_task";
  const taskId = caseTask ? `${assignedTask ? "chat-task" : "case-tag"}:${clientId}` : null;
  const taskResult = caseTask ? {[assignedTask ? "assignedTaskId" : "caseTaskId"]: taskId} : {};
  if (caseTask) {
    const conversation = await getConversation(env, conversationId, user.email);
    if ((!assignedTask && conversation?.kind !== "dm") || caseTask.recipient === user.email ||
        !allowedEmails(env).includes(caseTask.recipient) ||
        !conversation?.members.some((member) => member.email === caseTask.recipient)) {
      return json({ ok: false, error: "invalid_case_task_recipient" }, 403);
    }
  }
  const existing = (await env.DB.prepare("SELECT id, conversation_id, sender, body, attachments, created_at FROM chat_messages WHERE id = ?").bind(clientId).all()).results?.[0];
  if (existing) {
    // A retry of the caller's own send is idempotent; any other reuse of an id must not reveal that message.
    if (existing.conversation_id !== conversationId || existing.sender !== user.email) return json({ ok: false, error: "duplicate_client_id" }, 409);
    if (caseTask) {
      const saved = (await env.DB.prepare("SELECT id FROM user_tasks WHERE owner = ? AND id = ?")
        .bind(caseTask.recipient, taskId).all()).results?.[0];
      if (!saved) return json({ ok: false, error: "duplicate_client_id" }, 409);
    }
    return json({ ok: true, message: { ...messageShape(existing), ...taskResult } });
  }
  const text = typeof body?.body === "string" ? body.body.trim() : "";
  for (let i = 0; i < attachments.length; i++) {
    if (attachments[i].type === "custom_emoji") {
      const emoji = await getCustomEmoji(env, attachments[i].emojiId);
      if (!emoji) return json({ok: false, error: "invalid_custom_emoji"}, 400);
      attachments[i] = {type: "custom_emoji", emojiId: emoji.id, name: emoji.name,
        ...(emoji.sourceGifId ? {sourceGifId: emoji.sourceGifId} : {})};
    }
    if (attachments[i].type !== "image") continue;
    const image = await validateChatImage(env, conversationId, attachments[i]);
    if (!image) return json({ok: false, error: "invalid_image_attachment"}, 400);
    attachments[i] = image;
  }
  if (text.length > 4000 || (!text && attachments.length === 0)) return json({ ok: false, error: "invalid_body" }, 400);
  const at = nowIso();
  // Consume the request server-side; older desktop UIs only understand quote/GIF attachments.
  const storedAttachments = attachments.filter((item) => !["case_task", "assigned_task"].includes(item.type));
  // Only the request that inserts the message creates a task, including concurrent retries.
  // Advance the recipient's sync cursor even if another task was synced in this millisecond.
  const taskStatements = caseTask ? [
    env.DB.prepare(`INSERT INTO user_tasks (owner, id, updated_at, synced_at, deleted, data)
      SELECT ?, ?, ?, CASE WHEN latest >= ? THEN strftime('%Y-%m-%dT%H:%M:%fZ', latest, '+0.001 seconds') ELSE ? END, 0, ?
      FROM (SELECT MAX(synced_at) AS latest FROM user_tasks WHERE owner = ?)
      WHERE changes() = 1`).bind(caseTask.recipient, taskId, at, at, at, JSON.stringify({
      id: taskId, type: "other", title: assignedTask ? caseTask.title : `Review case ${caseTask.caseNumber}`,
      notes: caseTask.note,
      ...(!assignedTask ? {case_number: caseTask.caseNumber, case_id: caseTask.caseId} : {}),
      assigned_by: user.email, source_message_id: clientId,
      due_at: caseTask.dueAt, remind_at: caseTask.dueAt,
      ...(assignedTask && caseTask.version === 2 ? caseTask.task : {}),
      status: "open", completed_at: null, snoozed_until: null, notified_at: null,
      created_date: at, updated_date: at
    }), caseTask.recipient)
  ] : [];
  const emojiAttachment = attachments.find(item => ["custom_emoji", "builtin_emoji"].includes(item.type));
  const preview = text ? text.slice(0, 200) : (emojiAttachment ? `:${emojiAttachment.name}:` : attachments.some(item => item.type === "image") ? "Screenshot" : attachments.some((item) => item.type === "gif") ? "GIF" : attachments.some(item => item.type === "app_link") ? "EnQuote link" : "");
  await env.DB.batch([
    env.DB.prepare(`INSERT INTO chat_messages (id, conversation_id, sender, body, attachments, created_at) VALUES (?, ?, ?, ?, ?, ?)
      ${caseTask ? "ON CONFLICT(id) DO NOTHING" : ""}`).bind(clientId, conversationId, user.email, text, JSON.stringify(storedAttachments), at),
    ...taskStatements,
    env.DB.prepare(`UPDATE chat_conversations SET updated_at = ?, last_message_at = ?, last_message_preview = ?, last_sender = ? WHERE id = ?
      ${caseTask ? "AND changes() = 1" : ""}`).bind(at, at, preview, user.email, conversationId),
    env.DB.prepare(`UPDATE chat_members SET last_read_at = CASE WHEN last_read_at IS NULL OR last_read_at < ? THEN ? ELSE last_read_at END WHERE conversation_id = ? AND email = ?
      ${caseTask ? "AND changes() = 1" : ""}`).bind(at, at, conversationId, user.email)
  ]);
  let savedMessage = null;
  if (caseTask) {
    savedMessage = (await env.DB.prepare("SELECT id, conversation_id, sender, body, attachments, created_at FROM chat_messages WHERE id = ?")
      .bind(clientId).all()).results?.[0];
    const savedTask = (await env.DB.prepare("SELECT id FROM user_tasks WHERE owner = ? AND id = ?")
      .bind(caseTask.recipient, taskId).all()).results?.[0];
    if (savedMessage?.sender !== user.email || savedMessage?.conversation_id !== conversationId || !savedTask) {
      return json({ ok: false, error: "duplicate_client_id" }, 409);
    }
  }
  await notifyInbox(env, conversationId);
  if (caseTask) {
    try {
      await broadcastMessage(env, { type: "tasks_updated", key: await inboxKeyForEmail(caseTask.recipient, env.USER_TOKEN_SECRET) });
    } catch (error) {
      console.warn("[chat] Case task realtime notification failed:", error.message);
    }
  }
  return json({ ok: true, message: savedMessage ? { ...messageShape(savedMessage), ...taskResult } : {
    id: clientId, conversationId, sender: user.email, body: text, attachments: storedAttachments, createdAt: at,
    ...taskResult
  } });
}

export async function handleChatRead(request, env) {
  const user = await authenticateUser(request, env);
  if (user.error) return user.error;
  const body = await readBody(request);
  if (invalidId(body?.conversationId)) return json({ ok: false, error: "invalid_id" }, 400);
  const stampError = validateStamp(body?.at);
  if (stampError) return json({ ok: false, error: stampError }, 400);
  const member = await activeMember(env, body.conversationId, user.email);
  if (!member) return json({ ok: false, error: "not_found" }, 404);
  // Re-opening an already-read conversation needs no D1 write.
  if (member.lastReadAt && member.lastReadAt >= body.at) return json({ ok: true });
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
