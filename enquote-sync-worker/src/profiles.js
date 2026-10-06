import { broadcastMessage } from "./realtime.js";
import { authenticateUser } from "./user-token.js";
import { json } from "./util.js";
import {AVATAR_TYPES, MAX_AVATAR_BYTES, gifAvatarError} from "../../shared/avatarRules.js";

async function sha256Hex(bytes) {
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

async function notifyProfiles(env) {
  try {
    await broadcastMessage(env, { type: "profiles_updated" });
  } catch (error) {
    console.warn("[profiles] Realtime notification failed:", error.message);
  }
}

export async function handleProfilesList(request, env) {
  const user = await authenticateUser(request, env);
  if (user.error) return user.error;
  const { results } = await env.DB.prepare(`
    SELECT email, avatar_id AS avatarId, updated_at AS updatedAt
    FROM user_profiles
    ORDER BY email
  `).all();
  return json({ ok: true, profiles: (results || []).map((row) => ({
    email: String(row.email || "").toLowerCase(),
    avatarId: row.avatarId || null,
    updatedAt: row.updatedAt || null
  })) });
}

export async function handleProfileAvatarUpload(request, env) {
  const user = await authenticateUser(request, env);
  if (user.error) return user.error;
  const type = (request.headers.get("Content-Type") || "").split(";")[0].trim().toLowerCase();
  if (!AVATAR_TYPES.has(type)) return json({ ok: false, error: "unsupported_type" }, 415);
  const bytes = await request.arrayBuffer();
  if (bytes.byteLength > MAX_AVATAR_BYTES) return json({ ok: false, error: "file_too_large" }, 413);
  if (type === "image/gif") {
    const error = gifAvatarError(new Uint8Array(bytes));
    if (error) return json({ok: false, error}, 400);
  }
  const avatarId = await sha256Hex(bytes);
  const key = `profile:avatar:${avatarId}`;
  const existing = await env.CACHE.getWithMetadata(key, "arrayBuffer");
  if (!existing?.value) await env.CACHE.put(key, bytes, { metadata: { type } });
  const at = new Date().toISOString();
  await env.DB.prepare(`
    INSERT INTO user_profiles (email, avatar_id, updated_at)
    VALUES (?, ?, ?)
    ON CONFLICT(email) DO UPDATE SET avatar_id = excluded.avatar_id, updated_at = excluded.updated_at
  `).bind(user.email, avatarId, at).run();
  await notifyProfiles(env);
  return json({ ok: true, avatarId });
}

export async function handleProfileAvatarRemove(request, env) {
  const user = await authenticateUser(request, env);
  if (user.error) return user.error;
  await env.DB.prepare("DELETE FROM user_profiles WHERE email = ?").bind(user.email).run();
  await notifyProfiles(env);
  return json({ ok: true });
}

export async function handleProfileAvatarDownload(request, env, sha) {
  const user = await authenticateUser(request, env);
  if (user.error) return user.error;
  if (!/^[a-f0-9]{64}$/i.test(sha)) return json({ ok: false, error: "invalid_avatar_id" }, 400);
  const result = await env.CACHE.getWithMetadata(`profile:avatar:${sha}`, "arrayBuffer");
  if (!result?.value) return json({ ok: false, error: "not_found" }, 404);
  return new Response(result.value, {
    status: 200,
    headers: {
      "Content-Type": result.metadata?.type || "application/octet-stream",
      "Cache-Control": "private, max-age=31536000, immutable"
    }
  });
}
