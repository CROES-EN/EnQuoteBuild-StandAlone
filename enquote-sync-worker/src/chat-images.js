import {authenticateUser} from "./user-token.js";
import {json} from "./util.js";

const MAX_BYTES = 5 * 1024 * 1024;
const TYPES = new Set(["image/png", "image/jpeg", "image/webp", "image/gif"]);
const validConversation = id => typeof id === "string" && id.length > 0 && id.length <= 100;
const validFile = id => typeof id === "string" && /^[a-f0-9]{64}$/.test(id);
const keyFor = (conversationId, fileId) => `chat:image:${encodeURIComponent(conversationId)}:${fileId}`;

async function member(env, conversationId, email) {
  const result = await env.DB.prepare(
    "SELECT conversation_id FROM chat_members WHERE conversation_id = ? AND email = ? AND left_at IS NULL"
  ).bind(conversationId, email).all();
  return Boolean(result.results?.length);
}

export function matchesImageType(bytes, type) {
  const b = new Uint8Array(bytes);
  if (type === "image/png") return [137, 80, 78, 71, 13, 10, 26, 10].every((v, i) => b[i] === v);
  if (type === "image/jpeg") return b[0] === 255 && b[1] === 216 && b[2] === 255;
  const text = new TextDecoder().decode(b.slice(0, 12));
  if (type === "image/gif") return text.startsWith("GIF87a") || text.startsWith("GIF89a");
  return type === "image/webp" && text.startsWith("RIFF") && text.slice(8, 12) === "WEBP";
}

export async function handleChatImageUpload(request, env) {
  const user = await authenticateUser(request, env);
  if (user.error) return user.error;
  const conversationId = new URL(request.url).searchParams.get("conversationId");
  if (!validConversation(conversationId)) return json({ok: false, error: "invalid_id"}, 400);
  if (!await member(env, conversationId, user.email)) return json({ok: false, error: "not_found"}, 404);
  const type = (request.headers.get("Content-Type") || "").split(";")[0].trim().toLowerCase();
  if (!TYPES.has(type)) return json({ok: false, error: "unsupported_image_type"}, 415);
  if (Number(request.headers.get("Content-Length")) > MAX_BYTES) return json({ok: false, error: "image_too_large"}, 413);
  const bytes = await request.arrayBuffer();
  if (!bytes.byteLength || bytes.byteLength > MAX_BYTES) return json({ok: false, error: "image_too_large"}, 413);
  if (!matchesImageType(bytes, type)) return json({ok: false, error: "invalid_image"}, 400);
  const hash = await crypto.subtle.digest("SHA-256", bytes);
  const fileId = [...new Uint8Array(hash)].map(b => b.toString(16).padStart(2, "0")).join("");
  const key = keyFor(conversationId, fileId);
  // An identical screenshot in another conversation gets a separate, access-scoped key.
  const existing = await env.CACHE.getWithMetadata(key, "arrayBuffer");
  if (!existing?.value) await env.CACHE.put(key, bytes, {metadata: {type, size: bytes.byteLength}});
  return json({ok: true, image: {type: "image", fileId, mimeType: type, name: "Screenshot", size: bytes.byteLength}});
}

export async function validateChatImage(env, conversationId, attachment) {
  if (!validFile(attachment?.fileId) || !TYPES.has(attachment.mimeType) ||
      typeof attachment.name !== "string" || attachment.name.length > 200) return null;
  const stored = await env.CACHE.getWithMetadata(keyFor(conversationId, attachment.fileId), "arrayBuffer");
  if (!stored?.value || stored.metadata?.type !== attachment.mimeType) return null;
  return {type: "image", fileId: attachment.fileId, mimeType: stored.metadata.type,
    name: attachment.name, size: stored.metadata.size};
}

export async function handleChatImageDownload(request, env) {
  const user = await authenticateUser(request, env);
  if (user.error) return user.error;
  const params = new URL(request.url).searchParams;
  const conversationId = params.get("conversationId");
  const fileId = params.get("fileId");
  if (!validConversation(conversationId) || !validFile(fileId)) return json({ok: false, error: "invalid_id"}, 400);
  if (!await member(env, conversationId, user.email)) return json({ok: false, error: "not_found"}, 404);
  const stored = await env.CACHE.getWithMetadata(keyFor(conversationId, fileId), "arrayBuffer");
  if (!stored?.value) return json({ok: false, error: "not_found"}, 404);
  return new Response(stored.value, {headers: {
    "Content-Type": stored.metadata.type, "Cache-Control": "private, no-store",
    "X-Content-Type-Options": "nosniff"
  }});
}
