import { json } from "./util.js";

// Hosts the signed UI update (see electron/uiUpdate.cjs). The Worker only stores and serves bytes;
// the desktop app verifies the signature itself, so a compromise here cannot ship code. Two
// channels: "stable" (everyone) and "beta" (testers) - the manifest key differs, the bundle
// store is shared and addressed by its SHA-256.
function isAuthorized(request, env) {
  return Boolean(env.OUTBOUND_TOKEN) &&
    request.headers.get("Authorization") === `Bearer ${env.OUTBOUND_TOKEN}`;
}

const manifestKey = (channel) => (channel === "beta" ? "ui:manifest:beta" : "ui:manifest:stable");

export async function handleUiManifest(request, env) {
  if (!isAuthorized(request, env)) return json({ ok: false, error: "unauthorized" }, 401);
  const channel = new URL(request.url).searchParams.get("channel") === "beta" ? "beta" : "stable";
  const manifest = await env.CACHE.get(manifestKey(channel), "json");
  return json({ ok: true, channel, manifest: manifest || null });
}

export async function handleUiBundle(request, env) {
  if (!isAuthorized(request, env)) return json({ ok: false, error: "unauthorized" }, 401);
  const sha = new URL(request.url).searchParams.get("sha") || "";
  if (!/^[0-9a-f]{64}$/.test(sha)) return json({ ok: false, error: "invalid_sha" }, 400);
  const bytes = await env.CACHE.get(`ui:bundle:${sha}`, "arrayBuffer");
  if (!bytes) return json({ ok: false, error: "not_found" }, 404);
  return new Response(bytes, { headers: { "content-type": "application/octet-stream" } });
}
