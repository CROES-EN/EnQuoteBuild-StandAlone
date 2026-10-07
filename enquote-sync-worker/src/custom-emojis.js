import {authenticateUser} from "./user-token.js";
import {json} from "./util.js";
import {matchesImageType} from "./chat-images.js";
import {safeGiphyMediaUrl} from "./gifs.js";
import {CUSTOM_EMOJI_MAX_BYTES, CUSTOM_EMOJI_TYPES, validCustomEmojiId, validCustomEmojiName} from "../../shared/customEmojiRules.js";

const keyFor = id => `chat:custom-emoji:${id}`;

export async function getCustomEmoji(env, id) {
  if (!validCustomEmojiId(id)) return null;
  return (await env.DB.prepare("SELECT id, name, mime_type AS mimeType, size, source_gif_id AS sourceGifId FROM custom_emojis WHERE id = ?")
    .bind(id).all()).results?.[0] || null;
}

export async function handleCustomEmojisList(request, env) {
  const user = await authenticateUser(request, env);
  if (user.error) return user.error;
  const {results} = await env.DB.prepare("SELECT id, name, mime_type AS mimeType, size, source_gif_id AS sourceGifId FROM custom_emojis ORDER BY name").all();
  return json({ok: true, emojis: results || []});
}

export async function handleCustomEmojiUpload(request, env) {
  const user = await authenticateUser(request, env);
  if (user.error) return user.error;
  const name = new URL(request.url).searchParams.get("name");
  if (!validCustomEmojiName(name)) return json({ok: false, error: "invalid_emoji_name"}, 400);
  const mimeType = (request.headers.get("Content-Type") || "").split(";")[0].trim().toLowerCase();
  if (!CUSTOM_EMOJI_TYPES.includes(mimeType)) return json({ok: false, error: "unsupported_image_type"}, 415);
  if (Number(request.headers.get("Content-Length")) > CUSTOM_EMOJI_MAX_BYTES) return json({ok: false, error: "emoji_too_large"}, 413);
  const bytes = await request.arrayBuffer();
  if (!bytes.byteLength || bytes.byteLength > CUSTOM_EMOJI_MAX_BYTES) return json({ok: false, error: "emoji_too_large"}, 413);
  if (!matchesImageType(bytes, mimeType)) return json({ok: false, error: "invalid_image"}, 400);
  return storeEmoji(env, user.email, {name, bytes, mimeType});
}

async function storeEmoji(env, email, {name, bytes, mimeType, sourceGifId = null}) {
  const id = [...new Uint8Array(await crypto.subtle.digest("SHA-256", bytes))]
    .map(value => value.toString(16).padStart(2, "0")).join("");
  const existingName = (await env.DB.prepare("SELECT id FROM custom_emojis WHERE name = ?").bind(name).all()).results?.[0];
  const existing = await getCustomEmoji(env, id);
  if ((existingName && existingName.id !== id) || (existing && existing.name !== name)) {
    return json({ok: false, error: "emoji_already_exists"}, 409);
  }
  if (existing) return json({ok: true, emoji: existing});
  await env.CACHE.put(keyFor(id), bytes, {metadata: {type: mimeType}});
  await env.DB.prepare("INSERT OR IGNORE INTO custom_emojis (id, name, mime_type, size, created_by, created_at, source_gif_id) VALUES (?, ?, ?, ?, ?, ?, ?)")
    .bind(id, name, mimeType, bytes.byteLength, email, new Date().toISOString(), sourceGifId).run();
  const emoji = await getCustomEmoji(env, id);
  if (!emoji || emoji.name !== name) return json({ok: false, error: "emoji_already_exists"}, 409);
  return json({ok: true, emoji});
}

export async function handleCustomEmojiFromGif(request, env) {
  const user = await authenticateUser(request, env);
  if (user.error) return user.error;
  let body;
  try {body = await request.json();}
  catch {return json({ok: false, error: "invalid_gif_emoji"}, 400);}
  if (!validCustomEmojiName(body?.name)) return json({ok: false, error: "invalid_emoji_name"}, 400);
  if (typeof body.gifId !== "string" || !/^[a-zA-Z0-9]{1,100}$/.test(body.gifId)) {
    return json({ok: false, error: "invalid_gif_emoji"}, 400);
  }
  if (!env.GIPHY_API_KEY) return json({ok: false, error: "gifs_not_configured"}, 503);
  const url = new URL(`https://api.giphy.com/v1/gifs/${body.gifId}`);
  url.searchParams.set("api_key", env.GIPHY_API_KEY);
  const response = await fetch(url, {signal: AbortSignal.timeout(15000)});
  if (!response.ok) return json({ok: false, error: "gifs_unavailable"}, 502);
  const {data} = await response.json();
  if (data?.id !== body.gifId || !["g", "pg"].includes(data.rating)) return json({ok: false, error: "invalid_gif_emoji"}, 400);
  const rendition = [data.images?.fixed_height_small, data.images?.fixed_width_small, data.images?.downsized]
    .find(image => safeGiphyMediaUrl(image?.url) && Number(image?.size) > 0 && Number(image.size) <= CUSTOM_EMOJI_MAX_BYTES);
  if (!rendition) return json({ok: false, error: "emoji_too_large"}, 413);
  const media = await fetch(safeGiphyMediaUrl(rendition.url), {redirect: "manual", signal: AbortSignal.timeout(15000)});
  if (!media.ok || !media.body) return json({ok: false, error: "gifs_unavailable"}, 502);
  const reader = media.body.getReader();
  const chunks = [];
  let length = 0;
  for (;;) {
    const {done, value} = await reader.read();
    if (done) break;
    length += value.byteLength;
    if (length > CUSTOM_EMOJI_MAX_BYTES) {
      await reader.cancel();
      return json({ok: false, error: "emoji_too_large"}, 413);
    }
    chunks.push(value);
  }
  const bytes = new Uint8Array(length);
  let offset = 0;
  for (const chunk of chunks) {bytes.set(chunk, offset); offset += chunk.byteLength;}
  if (!matchesImageType(bytes.buffer, "image/gif")) return json({ok: false, error: "invalid_gif_emoji"}, 400);
  return storeEmoji(env, user.email, {name: body.name, bytes: bytes.buffer, mimeType: "image/gif", sourceGifId: body.gifId});
}

export async function handleCustomEmojiDownload(request, env) {
  const user = await authenticateUser(request, env);
  if (user.error) return user.error;
  const emoji = await getCustomEmoji(env, new URL(request.url).searchParams.get("id"));
  if (!emoji) return json({ok: false, error: "not_found"}, 404);
  const bytes = await env.CACHE.get(keyFor(emoji.id), "arrayBuffer");
  if (!bytes) return json({ok: false, error: "not_found"}, 404);
  return new Response(bytes, {headers: {
    "Content-Type": emoji.mimeType, "Cache-Control": "private, no-store", "X-Content-Type-Options": "nosniff"
  }});
}
