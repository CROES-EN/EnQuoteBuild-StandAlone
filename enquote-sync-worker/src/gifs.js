import { authenticateUser } from "./user-token.js";
import { json } from "./util.js";

const LIMIT = 24;
const RATING = "pg";
const ALLOWED_GIPHY_HOST = /^(i\.giphy\.com|media[0-9]*\.giphy\.com)$/i;

function safeInt(value) {
  return Math.max(0, Number.parseInt(value || "0", 10) || 0);
}

function safeMediaUrl(value) {
  if (typeof value !== "string" || value.length > 500) return "";
  try {
    const url = new URL(value);
    if (url.protocol !== "https:" || !ALLOWED_GIPHY_HOST.test(url.hostname)) return "";
    return url.href;
  } catch {
    return "";
  }
}

function mapGif(item) {
  const fixedHeight = item?.images?.fixed_height || {};
  const preview = item?.images?.fixed_width_small || item?.images?.fixed_height_small || fixedHeight;
  const url = safeMediaUrl(fixedHeight.url);
  const previewUrl = safeMediaUrl(preview.webp || preview.url || fixedHeight.url);
  if (!url) return null;
  return {
    id: String(item.id || "").slice(0, 100),
    title: String(item.title || "GIF").slice(0, 200),
    url,
    previewUrl: previewUrl || url,
    width: Number.parseInt(fixedHeight.width || item?.images?.original?.width || "0", 10) || null,
    height: Number.parseInt(fixedHeight.height || item?.images?.original?.height || "0", 10) || null
  };
}

async function fetchGiphy(env, endpoint, { q = "", offset = 0 } = {}) {
  if (!env.GIPHY_API_KEY) return { error: json({ ok: false, error: "gifs_not_configured" }, 503) };
  const cacheKey = `giphy:${endpoint}:${q}:${offset}`;
  const cached = await env.CACHE?.get?.(cacheKey, "json");
  if (cached?.ok) return cached;
  const url = new URL(`https://api.giphy.com/v1/gifs/${endpoint}`);
  url.searchParams.set("api_key", env.GIPHY_API_KEY);
  url.searchParams.set("limit", String(LIMIT));
  url.searchParams.set("offset", String(offset));
  url.searchParams.set("rating", RATING);
  if (endpoint === "search") url.searchParams.set("q", q);
  const response = await fetch(url);
  if (!response.ok) return { error: json({ ok: false, error: "gifs_unavailable" }, 502) };
  const payload = await response.json();
  const gifs = (Array.isArray(payload?.data) ? payload.data : []).map(mapGif).filter(Boolean);
  const pagination = payload?.pagination || {};
  const count = Number(pagination.count || gifs.length) || gifs.length;
  const total = Number(pagination.total_count || 0);
  const nextOffset = total && offset + count < total ? offset + count : null;
  const result = { ok: true, gifs, nextOffset };
  await env.CACHE?.put?.(cacheKey, JSON.stringify(result), { expirationTtl: 60 * 60 });
  return result;
}

export async function handleGifsSearch(request, env) {
  const user = await authenticateUser(request, env);
  if (user.error) return user.error;
  const url = new URL(request.url);
  const q = (url.searchParams.get("q") || "").trim().slice(0, 100);
  const result = await fetchGiphy(env, "search", { q, offset: safeInt(url.searchParams.get("offset")) });
  return result.error || json(result);
}

export async function handleGifsTrending(request, env) {
  const user = await authenticateUser(request, env);
  if (user.error) return user.error;
  const url = new URL(request.url);
  const result = await fetchGiphy(env, "trending", { offset: safeInt(url.searchParams.get("offset")) });
  return result.error || json(result);
}
