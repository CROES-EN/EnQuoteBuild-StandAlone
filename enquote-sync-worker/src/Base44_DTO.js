import {authenticateUser} from "./user-token.js";
import {json} from "./util.js";

const PREFIX = "retro:profile:";
const MAX_BYTES = 64 * 1024;

export async function handleRetro(request, env) {
  const user = await authenticateUser(request, env);
  if (user.error) return user.error;
  const url = new URL(request.url);
  if (request.method === "GET") {
    const email = url.searchParams.get("email")?.trim().toLowerCase();
    if (email) {
      const profile = await env.CACHE.get(PREFIX + email, "json");
      return profile ? json({ok: true, profile}) : json({ok: false, error: "Profile not found."}, 404);
    }
    const result = await env.CACHE.list({prefix: PREFIX, limit: 50, cursor: url.searchParams.get("cursor") || undefined});
    return json({
      ok: true,
      profiles: result.keys.map((key) => ({email: key.name.slice(PREFIX.length), ...key.metadata})),
      cursor: result.list_complete ? null : result.cursor
    });
  }
  if (request.method === "DELETE") {
    await env.CACHE.delete(PREFIX + user.email);
    return json({ok: true});
  }
  const raw = await request.text();
  if (new TextEncoder().encode(raw).byteLength > MAX_BYTES) return json({ok: false, error: "Profile code must be 64 KB or smaller."}, 413);
  let value;
  try { value = JSON.parse(raw); } catch { return json({ok: false, error: "Invalid profile JSON."}, 400); }
  if (!value || typeof value.name !== "string" || !value.name.trim() || value.name.length > 80 ||
      typeof value.html !== "string" || typeof value.css !== "string" ||
      typeof value.mood !== "string" || value.mood.length > 120) {
    return json({ok: false, error: "Enter a name (80 characters max), mood (120 max), HTML, and CSS."}, 400);
  }
  const profile = {email: user.email, name: value.name.trim(), mood: value.mood.trim(), html: value.html, css: value.css, updatedAt: new Date().toISOString()};
  if (value.layout !== undefined) {
    if (!["classic", "custom"].includes(value.layout) ||
        (value.appearance !== undefined && !["classic", "gothic", "imported", "imported-raw"].includes(value.appearance))) {
      return json({ok: false, error: "Choose a supported profile layout and appearance."}, 400);
    }
    profile.layout = value.layout;
    if (value.appearance !== undefined) profile.appearance = value.appearance;
    for (const field of ["tagline", "location", "about", "meet", "interests", "music", "movies", "television", "books", "heroes", "notes", "picture", "background"]) {
      if (value[field] !== undefined) {
        if (typeof value[field] !== "string" || value[field].length > 8000) {
          return json({ok: false, error: `Profile ${field} must be text of 8000 characters or fewer.`}, 400);
        }
        profile[field] = value[field];
      }
    }
  }
  await env.CACHE.put(PREFIX + user.email, JSON.stringify(profile), {
    metadata: {name: profile.name, mood: profile.mood, updatedAt: profile.updatedAt}
  });
  return json({ok: true, profile});
}
