import { jwtVerify, createRemoteJWKSet } from "jose";
import { json } from "./util.js";

// Confirmed directly from your Cloudflare Zero Trust dashboard this session.
const TEAM_DOMAIN = "https://boise-enphase-om.cloudflareaccess.com";
const POLICY_AUD = "c656512e6473639baedf21ec09682fd2e634ab018020ad16c933f8ee367880e4";

// Defense-in-depth allow-list - moved to a Cloudflare Worker secret
// (ALLOWED_EMAILS_LIST) so it never sits in plaintext in git. Same values,
// same check, same behavior as before - only the storage location changed.
// To update the list: npx wrangler secret put ALLOWED_EMAILS_LIST
function getAllowedEmails(env) {
  const raw = env.ALLOWED_EMAILS_LIST || "";
  return new Set(raw.split(",").map((e) => e.trim().toLowerCase()).filter(Boolean));
}

// JWKS endpoint - Access publishes its public signing keys here. createRemoteJWKSet
// caches keys internally and handles rotation automatically - no manual key management
// needed.
const JWKS = createRemoteJWKSet(new URL(`${TEAM_DOMAIN}/cdn-cgi/access/certs`));

function getCookieValue(cookieHeader, name) {
  if (!cookieHeader) return null;
  const match = cookieHeader.match(new RegExp(`(?:^|;\\s*)${name}=([^;]+)`));
  return match ? match[1] : null;
}

/**
 * Validates a Cloudflare Access JWT cryptographically against Access's own public
 * signing keys - confirms the token is genuinely signed by Access (not forged), has
 * not expired, and was issued for THIS specific app (audience check).
 */
async function validateAccessJwt(token) {
  if (!token) return null;
  const { payload } = await jwtVerify(token, JWKS, {
    issuer: TEAM_DOMAIN,
    audience: POLICY_AUD,
  });
  return payload;
}

/**
 * SHARED verification logic - the ONE place that decides "is this request genuinely
 * from a trusted, allow-listed, Cloudflare-verified user." Used by both
 * handleAuthSession (Stage 1 identity check) and handleSyncCredentials (dynamic token
 * issuance) below, so there is no risk of the two checks ever drifting apart.
 *
 * Returns { ok: true, email, exp, iat } on success, or { ok: false, status, reason }
 * on any failure - callers just need to check `.ok` and use `.status`/`.reason`
 * directly in their own response.
 */
async function verifyRequestIdentity(request, env) {
  const jwt =
    request.headers.get("cf-access-jwt-assertion") ||
    request.headers.get("authorization")?.replace(/^Bearer\s+/i, "") ||
    getCookieValue(request.headers.get("cookie"), "CF_Authorization");

  if (!jwt) {
    return { ok: false, status: 401, reason: "no_token" };
  }

  let payload;
  try {
    payload = await validateAccessJwt(jwt);
  } catch (error) {
    return { ok: false, status: 401, reason: "validation_failed", error: error.message };
  }

  if (!payload) {
    return { ok: false, status: 401, reason: "invalid_token" };
  }

  const email = typeof payload.email === "string" ? payload.email.trim().toLowerCase() : null;
  if (!email) {
    return { ok: false, status: 401, reason: "no_email_claim" };
  }

  const allowedEmails = getAllowedEmails(env);
  if (!allowedEmails.has(email)) {
    return { ok: false, status: 403, reason: "email_not_allowed" };
  }

  return { ok: true, email, exp: payload.exp, iat: payload.iat };
}

/**
 * Stage 1 identity endpoint (v1.1.4 Cloudflare Access two-stage sign-in).
 * Answers "who is this user?" - see verifyRequestIdentity for the real logic.
 */
export async function handleAuthSession(request, env) {
  const headers = { "Cache-Control": "no-store" };
  const result = await verifyRequestIdentity(request);

  if (!result.ok) {
    return json({ authenticated: false, reason: result.reason }, result.status, headers);
  }

  return json({ authenticated: true, email: result.email, exp: result.exp, iat: result.iat }, 200, headers);
}

/**
 * NEW: dynamic sync-credential issuance. Per explicit design decision - these tokens
 * must never be bundled into the installer or require manual per-machine setup. They
 * are handed out ONLY after a request proves it is from a genuinely Cloudflare-
 * verified, allow-listed user (the EXACT SAME check as /auth/session) - so a new
 * machine or a new user gets full sync capability automatically and securely, purely
 * as a consequence of being authenticated.
 *
 * Reads OUTBOUND_TOKEN and SNAPSHOT_TOKEN from the Worker's OWN environment secrets
 * (confirmed live via wrangler secret list) - never from any file shipped to a client
 * machine.
 */
export async function handleSyncCredentials(request, env) {
  const headers = { "Cache-Control": "no-store" };
  const result = await verifyRequestIdentity(request);

  if (!result.ok) {
    return json({ ok: false, reason: result.reason }, result.status, headers);
  }

  if (!env.OUTBOUND_TOKEN || !env.SNAPSHOT_TOKEN) {
    return json({ ok: false, reason: "server_misconfigured" }, 500, headers);
  }

  // CF Access service token credentials - needed by pollEntitySnapshot()'s background
  // entity-snapshot pulls to bypass the interactive Access challenge. Confirmed these
  // previously only existed as plain .env entries on one machine - now distributed the
  // SAME dynamic, Cloudflare-verified way as the other two tokens. Optional in the
  // response (not a hard failure if absent) - entity-snapshot sync simply won't work
  // without them, but outbound sync and everything else still functions.
  const response = {
    ok: true,
    outboundToken: env.OUTBOUND_TOKEN,
    snapshotToken: env.SNAPSHOT_TOKEN
  };
  if (env.CF_ACCESS_CLIENT_ID && env.CF_ACCESS_CLIENT_SECRET) {
    response.cfAccessClientId = env.CF_ACCESS_CLIENT_ID;
    response.cfAccessClientSecret = env.CF_ACCESS_CLIENT_SECRET;
  }

  return json(response, 200, headers);
}