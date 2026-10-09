import {broadcastMessage} from "./realtime.js";
import {allowedEmails, authenticateUser, inboxKeyForEmail} from "./user-token.js";
import {json} from "./util.js";

const FOLDERS = new Set(["inbox", "sent", "saved", "junk", "trash"]);
const MAX_SUBJECT = 160;
const MAX_BODY = 10_000;
const MAX_REQUEST_BYTES = 12 * 1024;
const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

async function readBody(request) {
  const declaredLength = Number(request.headers.get("Content-Length") || 0);
  if (declaredLength > MAX_REQUEST_BYTES) return {error: "request_too_large"};
  const text = await request.text();
  if (new TextEncoder().encode(text).byteLength > MAX_REQUEST_BYTES) return {error: "request_too_large"};
  try {
    const body = JSON.parse(text);
    return body && typeof body === "object" && !Array.isArray(body) ? {body} : {error: "invalid_json"};
  } catch {
    return {error: "invalid_json"};
  }
}

function cleanText(value, max) {
  return typeof value === "string" ? value.trim().slice(0, max) : "";
}

async function notify(env, emails) {
  try {
    const keys = await Promise.all([...new Set(emails)].map((email) => inboxKeyForEmail(email, env.USER_TOKEN_SECRET)));
    await broadcastMessage(env, {type: "retro_mail_updated", keys});
  } catch (error) {
    console.warn("[retro-mail] Realtime notification failed:", error.message);
  }
}

async function readCounts(env, email) {
  const {results} = await env.DB.prepare(`
    SELECT folder, COUNT(*) AS count,
      SUM(CASE WHEN folder = 'inbox' AND read_at IS NULL THEN 1 ELSE 0 END) AS unread
    FROM retro_mail_state
    WHERE owner_email = ?
    GROUP BY folder
  `).bind(email).all();
  const counts = {inbox: 0, sent: 0, saved: 0, junk: 0, trash: 0, unread: 0};
  for (const row of results || []) {
    if (FOLDERS.has(row.folder)) counts[row.folder] = Number(row.count) || 0;
    counts.unread += Number(row.unread) || 0;
  }
  return counts;
}

export async function handleRetroMail(request, env) {
  const user = await authenticateUser(request, env);
  if (user.error) return user.error;
  const url = new URL(request.url);

  if (request.method === "GET") {
    const folder = url.searchParams.get("folder") || "inbox";
    if (folder === "contacts") {
      const {results} = await env.DB.prepare(`
        SELECT DISTINCT CASE WHEN m.sender_email = ? THEN m.recipient_email ELSE m.sender_email END AS email
        FROM retro_mail_state s
        JOIN retro_mail_messages m ON m.id = s.message_id
        WHERE s.owner_email = ?
        ORDER BY email
      `).bind(user.email, user.email).all();
      return json({ok: true, contacts: (results || []).map((row) => row.email)});
    }
    if (!FOLDERS.has(folder)) return json({ok: false, error: "invalid_folder"}, 400);
    const {results} = await env.DB.prepare(`
      SELECT m.id, m.sender_email AS sender, m.recipient_email AS recipient,
        m.subject, m.body, m.created_at AS createdAt, s.folder, s.read_at AS readAt
      FROM retro_mail_state s
      JOIN retro_mail_messages m ON m.id = s.message_id
      WHERE s.owner_email = ? AND s.folder = ?
      ORDER BY m.created_at DESC
      LIMIT 100
    `).bind(user.email, folder).all();
    return json({ok: true, folder, messages: results || [], counts: await readCounts(env, user.email)});
  }

  const parsed = await readBody(request);
  if (parsed.error) return json({ok: false, error: parsed.error}, parsed.error === "request_too_large" ? 413 : 400);
  const body = parsed.body;

  if (url.pathname.endsWith("/send") && request.method === "POST") {
    const recipient = cleanText(body.to, 254).toLowerCase();
    const subject = cleanText(body.subject, MAX_SUBJECT + 1);
    const message = typeof body.body === "string" ? body.body.trim() : "";
    if (!EMAIL_PATTERN.test(recipient) || recipient === user.email || !allowedEmails(env).includes(recipient)) {
      return json({ok: false, error: "recipient_not_allowed"}, 400);
    }
    if (!subject) return json({ok: false, error: "subject_required"}, 400);
    if (!message) return json({ok: false, error: "message_required"}, 400);
    if (subject.length > MAX_SUBJECT || message.length > MAX_BODY) return json({ok: false, error: "message_too_long"}, 400);
    const id = crypto.randomUUID();
    const createdAt = new Date().toISOString();
    await env.DB.batch([
      env.DB.prepare(`INSERT INTO retro_mail_messages (id, sender_email, recipient_email, subject, body, created_at)
        VALUES (?, ?, ?, ?, ?, ?)`).bind(id, user.email, recipient, subject, message, createdAt),
      env.DB.prepare(`INSERT INTO retro_mail_state (message_id, owner_email, folder, read_at)
        VALUES (?, ?, 'sent', ?)`).bind(id, user.email, createdAt),
      env.DB.prepare(`INSERT INTO retro_mail_state (message_id, owner_email, folder, read_at)
        VALUES (?, ?, 'inbox', NULL)`).bind(id, recipient)
    ]);
    await notify(env, [user.email, recipient]);
    return json({ok: true, message: {id, sender: user.email, recipient, subject, body: message, createdAt, folder: "sent", readAt: createdAt}}, 201);
  }

  if (url.pathname.endsWith("/state") && request.method === "POST") {
    const id = typeof body.id === "string" ? body.id : "";
    if (!/^[0-9a-f-]{36}$/i.test(id)) return json({ok: false, error: "invalid_message_id"}, 400);
    const message = (await env.DB.prepare(`
      SELECT sender_email AS sender, recipient_email AS recipient
      FROM retro_mail_messages WHERE id = ?
    `).bind(id).all()).results?.[0];
    if (!message || ![message.sender, message.recipient].includes(user.email)) return json({ok: false, error: "message_not_found"}, 404);

    if (body.action === "read") {
      if (message.recipient !== user.email) return json({ok: false, error: "message_not_found"}, 404);
      const result = await env.DB.prepare(`
        UPDATE retro_mail_state SET read_at = ?
        WHERE message_id = ? AND owner_email = ? AND folder != 'sent' AND read_at IS NULL
      `).bind(new Date().toISOString(), id, user.email).run();
      return json({ok: true, changed: Number(result.meta?.changes || 0) > 0});
    }

    const folder = body.folder;
    if (!FOLDERS.has(folder)) return json({ok: false, error: "invalid_folder"}, 400);
    if ((folder === "sent" && message.sender !== user.email) ||
        (folder !== "sent" && message.recipient !== user.email)) {
      return json({ok: false, error: "message_not_found"}, 404);
    }
    const result = await env.DB.prepare(`
      UPDATE retro_mail_state SET folder = ?
      WHERE message_id = ? AND owner_email = ?
    `).bind(folder, id, user.email).run();
    if (!Number(result.meta?.changes || 0)) return json({ok: false, error: "message_not_found"}, 404);
    await notify(env, [user.email]);
    return json({ok: true});
  }

  if (url.pathname.endsWith("/delete") && request.method === "POST") {
    const id = typeof body.id === "string" ? body.id : "";
    if (!/^[0-9a-f-]{36}$/i.test(id)) return json({ok: false, error: "invalid_message_id"}, 400);
    const state = (await env.DB.prepare(`
      SELECT folder FROM retro_mail_state WHERE message_id = ? AND owner_email = ?
    `).bind(id, user.email).all()).results?.[0];
    if (!state || state.folder !== "trash") return json({ok: false, error: "message_not_found"}, 404);
    await env.DB.prepare(`DELETE FROM retro_mail_state WHERE message_id = ? AND owner_email = ?`).bind(id, user.email).run();
    await env.DB.prepare(`DELETE FROM retro_mail_messages WHERE id = ?
      AND NOT EXISTS (SELECT 1 FROM retro_mail_state WHERE message_id = ?)`).bind(id, id).run();
    return json({ok: true});
  }

  return json({ok: false, error: "method_not_allowed"}, 405);
}
