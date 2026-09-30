import { jwtVerify, createRemoteJWKSet } from "jose";
import { json } from "./util.js";

// Confirmed directly from your Cloudflare Zero Trust dashboard this session.
const TEAM_DOMAIN = "https://boise-enphase-om.cloudflareaccess.com";
const POLICY_AUD = "c656512e6473639baedf21ec09682fd2e634ab018020ad16c933f8ee367880e4";

// Defense-in-depth allow-list, mirroring the Access policy's own email list -
// REVIEW AND UPDATE THIS LIST before deploying (see the patch script's console
// output for instructions). Access's own policy already gates who can complete
// login in the first place; this is a second, app-side check on top of that.
const ALLOWED_EMAILS = new Set([
"jwood@enphaseenergy.com",
"mjb@enphaseenergy.com",
"aschilling@enphaseenergy.com",
"nchoudhary@enphaseenergy.com",
"dtorchy@enphaseenergy.com",
"cmckenna@enphaseenergy.com",
"hmackey@enphaseenergy.com",
"bkittelmann@enphaseenergy.com",
"smosley@enphaseenergy.com",
"croeschberger@enphaseenergy.com",
"mkuriakose@enphaseenergy.com",
"shawkins@enphaseenergy.com",
"clmorrow@enphaseenergy.com",
"jlasley@enphaseenergy.com",
"dudavis@enphaseenergy.com",
"abermudez@enphaseenergy.com",
"sfrederick@enphaseenergy.com",
"cwilson@enphaseenergy.com",
"vseganos@enphaseenergy.com",
"khaumann@enphaseenergy.com",
"dankenman@enphaseenergy.com",
"ajennings@enphaseenergy.com",
"mmccullough@enphaseenergy.com",
"jbarron@enphaseenergy.com",
"jcarpenetti@enphaseenergy.com",
"semani@enphaseenergy.com",
"isison@enphaseenergy.com",
"asharma@enphaseenergy.com",
]);

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
 * not expired, and was issued for THIS specific app (audience check). This is real
 * cryptographic proof, not just "a cookie happened to be present."
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
 * Stage 1 identity endpoint (v1.1.4 Cloudflare Access two-stage sign-in) - UPDATED
 * per Cloudflare's confirmed root-cause diagnosis: the original header-only check
 * (Cf-Access-Authenticated-User-Email) only works for requests that pass THROUGH
 * Access's edge with a full browser navigation context. Re-verification from
 * Electron's main process (a fresh BrowserWindow, or a direct API call) does not
 * reliably carry the CF_Binding cookie (SameSite=None) that Access's edge normally
 * requires alongside CF_Authorization - this is confirmed, documented Access
 * behavior for non-standard browser contexts, not a bug.
 *
 * THE FIX: accepts the CF_Authorization JWT itself from any of three sources (checked
 * in order), and validates it directly and cryptographically - completely bypassing
 * the browser cookie-sending/binding-cookie mechanism:
 *   1. cf-access-jwt-assertion header (set by Access edge on browser-navigated requests)
 *   2. Authorization: Bearer <jwt> header (sent explicitly by the Electron main process,
 *      after reading the JWT directly out of the persistent session's cookie jar)
 *   3. CF_Authorization cookie (fallback, for genuine in-browser requests)
 */
export async function handleAuthSession(request) {
  const jwt =
    request.headers.get("cf-access-jwt-assertion") ||
    request.headers.get("authorization")?.replace(/^Bearer\s+/i, "") ||
    getCookieValue(request.headers.get("cookie"), "CF_Authorization");

  const headers = { "Cache-Control": "no-store" };

  if (!jwt) {
    return json({ authenticated: false, reason: "no_token" }, 401, headers);
  }

  let payload;
  try {
    payload = await validateAccessJwt(jwt);
  } catch (error) {
    return json({ authenticated: false, reason: "validation_failed", error: error.message }, 401, headers);
  }

  if (!payload) {
    return json({ authenticated: false, reason: "invalid_token" }, 401, headers);
  }

  const email = typeof payload.email === "string" ? payload.email.trim().toLowerCase() : null;
  if (!email) {
    return json({ authenticated: false, reason: "no_email_claim" }, 401, headers);
  }

  if (!ALLOWED_EMAILS.has(email)) {
    return json({ authenticated: false, reason: "email_not_allowed" }, 403, headers);
  }

  return json({ authenticated: true, email, exp: payload.exp, iat: payload.iat }, 200, headers);
}