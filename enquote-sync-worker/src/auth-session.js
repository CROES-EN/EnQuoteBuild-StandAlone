import { jwtVerify, createRemoteJWKSet } from "jose";
import { json } from "./util.js";
import { inboxKeyForEmail, signUserToken, verifyUserToken, isAllowedEmail } from "./user-token.js";

const TEAM_DOMAIN = "https://boise-enphase-om.cloudflareaccess.com";
const POLICY_AUD = "c656512e6473639baedf21ec09682fd2e634ab018020ad16c933f8ee367880e4";

function getAllowedEmails(env) {
  const raw = env.ALLOWED_EMAILS_LIST || "";
  return new Set(raw.split(",").map((e) => e.trim().toLowerCase()).filter(Boolean));
}

const JWKS = createRemoteJWKSet(new URL(`${TEAM_DOMAIN}/cdn-cgi/access/certs`));

function getCookieValue(cookieHeader, name) {
  if (!cookieHeader) return null;
  const match = cookieHeader.match(new RegExp(`(?:^|;\\s*)${name}=([^;]+)`));
  return match ? match[1] : null;
}

async function validateAccessJwt(token) {
  if (!token) return null;
  const { payload } = await jwtVerify(token, JWKS, {
    issuer: TEAM_DOMAIN,
    audience: POLICY_AUD,
  });
  return payload;
}

// --- Password hashing (PBKDF2 via Web Crypto API) ---
const textEncoder = new TextEncoder();

function b64url(bytes) {
  let binary = "";
  for (const byte of new Uint8Array(bytes)) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}

function fromB64url(value) {
  const padded = value.replace(/-/g, "+").replace(/_/g, "/") + "=".repeat((4 - (value.length % 4)) % 4);
  const binary = atob(padded);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

function randomSalt() {
  const arr = new Uint8Array(16);
  crypto.getRandomValues(arr);
  return b64url(arr);
}

async function hashPassword(password, salt) {
  const keyMaterial = await crypto.subtle.importKey(
    "raw", textEncoder.encode(password), "PBKDF2", false, ["deriveBits"]
  );
  const hash = await crypto.subtle.deriveBits(
    { name: "PBKDF2", salt: fromB64url(salt), iterations: 100000, hash: "SHA-256" },
    keyMaterial, 256
  );
  return b64url(hash);
}

// --- Identity verification (Access JWT first, user token fallback) ---

export async function verifyRequestIdentity(request, env, verifyJwt = validateAccessJwt) {
  // 1. Try Cloudflare Access JWT
  const accessJwt =
    request.headers.get("cf-access-jwt-assertion") ||
    request.headers.get("authorization")?.replace(/^Bearer\s+/i, "") ||
    getCookieValue(request.headers.get("cookie"), "CF_Authorization");

  if (accessJwt) {
    try {
      const payload = await verifyJwt(accessJwt);
      if (payload) {
        const email = typeof payload.email === "string" ? payload.email.trim().toLowerCase() : null;
        if (email) {
          if (getAllowedEmails(env).has(email)) {
            return { ok: true, email, exp: payload.exp, iat: payload.iat, source: "access" };
          }
          return { ok: false, status: 403, reason: "email_not_allowed" };
        }
      }
    } catch {
      // Access JWT invalid — fall through to user token
    }
  }

  // 2. Fallback: self-issued user token (X-EnQuote-User header)
  const userTokens = [request.headers.get("X-EnQuote-User"),
    getCookieValue(request.headers.get("cookie"), "__Host-enquote_session")].filter(Boolean);
  for (const userToken of userTokens) {
    if (!env.USER_TOKEN_SECRET) break;
    const verified = await verifyUserToken(userToken, env.USER_TOKEN_SECRET);
    if (verified.ok) {
      if (isAllowedEmail(verified.email, env)) {
        return { ok: true, email: verified.email, exp: verified.exp, iat: undefined };
      }
      return { ok: false, status: 403, reason: "email_not_allowed" };
    }
  }

  return { ok: false, status: 401, reason: "no_token" };
}

export async function handleAuthSession(request, env, verifyJwt = validateAccessJwt) {
  const headers = { "Cache-Control": "no-store" };
  const result = await verifyRequestIdentity(request, env, verifyJwt);
  if (!result.ok) {
    return json({ authenticated: false, reason: result.reason }, result.status, headers);
  }
  if (env.USER_TOKEN_SECRET) {
    headers["Set-Cookie"] = sessionCookie(await signUserToken(result.email, env.USER_TOKEN_SECRET));
  }
  return json({ authenticated: true, email: result.email, exp: result.exp, iat: result.iat }, 200, headers);
}

function sessionCookie(token, maxAge = 30 * 24 * 60 * 60) {
  return `__Host-enquote_session=${token}; Path=/; HttpOnly; Secure; SameSite=Strict; Max-Age=${maxAge}`;
}

export function checkBrowserOrigin(request) {
  const origin = request.headers.get("Origin");
  return !origin || origin === new URL(request.url).origin;
}

export function handleLogout(request) {
  if (!checkBrowserOrigin(request)) return json({ ok: false, error: "invalid_origin" }, 403);
  return json({ ok: true }, 200, { "Cache-Control": "no-store", "Set-Cookie": sessionCookie("", 0) });
}

// --- Login: email + password against D1 ---

export async function handleLogin(request, env) {
  const headers = { "Cache-Control": "no-store" };
  if (!checkBrowserOrigin(request)) return json({ ok: false, reason: "invalid_origin" }, 403, headers);
  let body;
  try {
    body = await request.json();
    if (!body || typeof body !== "object" || Array.isArray(body)) throw new Error("invalid body");
  } catch {
    return json({ ok: false, reason: "invalid_body" }, 400, headers);
  }

  const email = String(body.email || "").trim().toLowerCase();
  const password = String(body.password || "");

  if (!email || !password) {
    return json({ ok: false, reason: "missing_credentials" }, 400, headers);
  }
  if (!isAllowedEmail(email, env)) {
    return json({ ok: false, reason: "email_not_allowed" }, 403, headers);
  }
  if (!env.USER_TOKEN_SECRET) {
    return json({ ok: false, reason: "server_misconfigured" }, 500, headers);
  }

  const bucket = Math.floor(Date.now() / 900000);
  const ip = request.headers.get("CF-Connecting-IP") || "unknown";
  const attemptKey = `${ip}:${email}:${bucket}`;
  const ipKey = `ip:${ip}:${bucket}`;
  const attempts = await env.DB.batch([attemptKey, ipKey].map(key => env.DB.prepare(`
    INSERT INTO browser_login_attempts (attempt_key, attempts, expires_at) VALUES (?, 1, ?)
    ON CONFLICT(attempt_key) DO UPDATE SET attempts = attempts + 1
    RETURNING attempts
  `).bind(key, (bucket + 1) * 900000)));
  if (Number(attempts[0]?.results?.[0]?.attempts) > 10 || Number(attempts[1]?.results?.[0]?.attempts) > 50) {
    return json({ ok: false, reason: "too_many_attempts" }, 429, { ...headers, "Retry-After": "900" });
  }
  await env.DB.prepare("DELETE FROM browser_login_attempts WHERE expires_at < ?").bind(Date.now()).run();
  if (password.length > 1024) return json({ ok: false, reason: "invalid_credentials" }, 401, headers);
  const row = await env.DB.prepare("SELECT password_hash, salt FROM user_passwords WHERE email = ?").bind(email).first();
  if (!row) {
    await hashPassword(password, b64url(new Uint8Array(16)));
    return json({ ok: false, reason: "invalid_credentials" }, 401, headers);
  }

  const computedHash = await hashPassword(password, row.salt);
  if (computedHash !== row.password_hash) {
    return json({ ok: false, reason: "invalid_credentials" }, 401, headers);
  }

  const userToken = await signUserToken(email, env.USER_TOKEN_SECRET);
  const inboxKey = await inboxKeyForEmail(email, env.USER_TOKEN_SECRET);
  headers["Set-Cookie"] = sessionCookie(userToken);
  return json({ ok: true, email, inboxKey }, 200, headers);
}

// --- Register: first-time password setup ---

export async function handleRegister(request, env, verifyJwt = validateAccessJwt) {
  const headers = { "Cache-Control": "no-store" };
  if (!checkBrowserOrigin(request)) return json({ ok: false, reason: "invalid_origin" }, 403, headers);
  // Provisioning requires proof of company identity, not merely knowledge of an allowed email.
  const accessToken = request.headers.get("cf-access-jwt-assertion") ||
    getCookieValue(request.headers.get("cookie"), "CF_Authorization");
  let verifiedEmail;
  try {
    const identity = await verifyJwt(accessToken);
    verifiedEmail = identity?.email?.trim().toLowerCase();
  } catch {
    return json({ ok: false, reason: "identity_verification_required" }, 401, headers);
  }
  if (!verifiedEmail) return json({ ok: false, reason: "identity_verification_required" }, 401, headers);
  if (!env.USER_TOKEN_SECRET) return json({ ok: false, reason: "server_misconfigured" }, 503, headers);
  let body;
  try {
    body = await request.json();
    if (!body || typeof body !== "object" || Array.isArray(body)) throw new Error("invalid body");
  } catch {
    return json({ ok: false, reason: "invalid_body" }, 400, headers);
  }

  const email = String(body.email || "").trim().toLowerCase();
  const password = String(body.password || "");
  if (email !== verifiedEmail) return json({ ok: false, reason: "identity_mismatch" }, 403, headers);

  if (!email || !password) {
    return json({ ok: false, reason: "missing_credentials" }, 400, headers);
  }
  if (password.length < 8 || password.length > 1024) {
    return json({ ok: false, reason: "password_too_short" }, 400, headers);
  }
  if (!isAllowedEmail(email, env)) {
    return json({ ok: false, reason: "email_not_allowed" }, 403, headers);
  }

  const existing = await env.DB.prepare("SELECT email FROM user_passwords WHERE email = ?").bind(email).first();
  if (existing) {
    return json({ ok: false, reason: "password_already_set" }, 409, headers);
  }

  const salt = randomSalt();
  const passwordHash = await hashPassword(password, salt);
  const now = new Date().toISOString();

  await env.DB.prepare("INSERT INTO user_passwords (email, password_hash, salt, updated_at) VALUES (?, ?, ?, ?)")
    .bind(email, passwordHash, salt, now).run();

  const userToken = await signUserToken(email, env.USER_TOKEN_SECRET);
  const inboxKey = await inboxKeyForEmail(email, env.USER_TOKEN_SECRET);
  headers["Set-Cookie"] = sessionCookie(userToken);
  return json({ ok: true, email, inboxKey }, 200, headers);

}

export async function handleSyncCredentials(request, env, verifyJwt = validateAccessJwt) {
  const headers = { "Cache-Control": "no-store" };
  const result = await verifyRequestIdentity(request, env, verifyJwt);
  if (!result.ok) {
    return json({ ok: false, reason: result.reason }, result.status, headers);
  }
  if (result.source !== "access") {
    return json({ ok: false, reason: "company_identity_required" }, 403, headers);
  }
  if (!env.OUTBOUND_TOKEN || !env.SNAPSHOT_TOKEN) {
    return json({ ok: false, reason: "server_misconfigured" }, 500, headers);
  }
  const response = {
    ok: true,
    outboundToken: env.OUTBOUND_TOKEN,
    snapshotToken: env.SNAPSHOT_TOKEN
  };
  if (env.CF_ACCESS_CLIENT_ID && env.CF_ACCESS_CLIENT_SECRET) {
    response.cfAccessClientId = env.CF_ACCESS_CLIENT_ID;
    response.cfAccessClientSecret = env.CF_ACCESS_CLIENT_SECRET;
  }
  if (env.USER_TOKEN_SECRET) {
    response.userToken = await signUserToken(result.email, env.USER_TOKEN_SECRET);
    response.inboxKey = await inboxKeyForEmail(result.email, env.USER_TOKEN_SECRET);
  }
  return json(response, 200, headers);
}
