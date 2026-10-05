import { json } from "./util.js";

const TOKEN_TTL_SECONDS = 30 * 24 * 60 * 60;
const TOKEN_PREFIX = "v1";

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

async function hmacKey(secret) {
  return crypto.subtle.importKey(
    "raw",
    textEncoder.encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign", "verify"]
  );
}

async function signBytes(secret, text) {
  return crypto.subtle.sign("HMAC", await hmacKey(secret), textEncoder.encode(text));
}

export function allowedEmails(env) {
  return String(env.ALLOWED_EMAILS_LIST || "")
    .split(",")
    .map((entry) => entry.trim().toLowerCase())
    .filter(Boolean);
}

export function isAllowedEmail(email, env) {
  return allowedEmails(env).includes(String(email || "").trim().toLowerCase());
}

export async function inboxKeyForEmail(email, secret) {
  const mac = await signBytes(secret, `inbox:${String(email).trim().toLowerCase()}`);
  return [...new Uint8Array(mac)].map((b) => b.toString(16).padStart(2, "0")).join("").slice(0, 32);
}

export async function signUserToken(email, secret, ttlSeconds = TOKEN_TTL_SECONDS) {
  const payload = {
    e: String(email).trim().toLowerCase(),
    x: Math.floor(Date.now() / 1000) + ttlSeconds
  };
  const payloadB64 = b64url(textEncoder.encode(JSON.stringify(payload)));
  const signedText = `${TOKEN_PREFIX}.${payloadB64}`;
  const sig = await signBytes(secret, signedText);
  return `${signedText}.${b64url(sig)}`;
}

export async function verifyUserToken(token, secret) {
  if (typeof token !== "string") return { ok: false, error: "invalid_user_token" };
  const parts = token.split(".");
  if (parts.length !== 3 || parts[0] !== TOKEN_PREFIX) return { ok: false, error: "invalid_user_token" };
  let sig;
  let payload;
  try {
    sig = fromB64url(parts[2]);
    payload = JSON.parse(new TextDecoder().decode(fromB64url(parts[1])));
  } catch {
    return { ok: false, error: "invalid_user_token" };
  }
  let valid = false;
  try {
    valid = await crypto.subtle.verify(
      "HMAC",
      await hmacKey(secret),
      sig,
      textEncoder.encode(`${parts[0]}.${parts[1]}`)
    );
  } catch {
    return { ok: false, error: "invalid_user_token" };
  }
  if (!valid) return { ok: false, error: "invalid_user_token" };
  const email = typeof payload.e === "string" ? payload.e.trim().toLowerCase() : "";
  const exp = Number(payload.x);
  if (!email || !Number.isFinite(exp)) return { ok: false, error: "invalid_user_token" };
  if (exp <= Math.floor(Date.now() / 1000)) return { ok: false, error: "user_token_expired" };
  return { ok: true, email, exp };
}

export async function authenticateUser(request, env) {
  if (!env.USER_TOKEN_SECRET) {
    return { error: json({ ok: false, error: "user_tokens_not_configured" }, 503) };
  }
  if (!env.OUTBOUND_TOKEN || request.headers.get("Authorization") !== `Bearer ${env.OUTBOUND_TOKEN}`) {
    return { error: json({ ok: false, error: "unauthorized" }, 401) };
  }
  const verified = await verifyUserToken(request.headers.get("X-EnQuote-User"), env.USER_TOKEN_SECRET);
  if (!verified.ok) {
    const status = verified.error === "user_token_expired" ? 401 : 401;
    return { error: json({ ok: false, error: verified.error }, status) };
  }
  if (!isAllowedEmail(verified.email, env)) {
    return { error: json({ ok: false, error: "email_not_allowed" }, 403) };
  }
  return { email: verified.email, inboxKey: await inboxKeyForEmail(verified.email, env.USER_TOKEN_SECRET) };
}
