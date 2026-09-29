var encoder = new TextEncoder();

function toHex(bytes) {
  return [...new Uint8Array(bytes)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

function b64decode(b64) {
  const bin = atob(b64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

function timingSafeEqual(a, b) {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

async function hmacKey(secret) {
  return crypto.subtle.importKey(
    "raw",
    encoder.encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"]
  );
}

async function aesKey(secret) {
  const raw = b64decode(secret);
  if (raw.length !== 32) throw new Error(`Encryption key must be 32 bytes, got ${raw.length}`);
  return crypto.subtle.importKey("raw", raw, { name: "AES-GCM" }, false, ["decrypt"]);
}

async function verifySignature(secret, rawBody, signatureHeader) {
  if (!signatureHeader) return false;
  const provided = signatureHeader.trim().replace(/^sha256=/, "").toLowerCase();
  const key = await hmacKey(secret);
  const sig = await crypto.subtle.sign("HMAC", key, rawBody);
  return timingSafeEqual(toHex(sig), provided);
}

async function decryptPayload(secret, envelope) {
  const key = await aesKey(secret);
  const enc = envelope.encryption || envelope;
  const iv = b64decode(enc.iv);
  const ciphertext = b64decode(enc.ciphertext);
  const plain = await crypto.subtle.decrypt({ name: "AES-GCM", iv }, key, ciphertext);
  return JSON.parse(new TextDecoder().decode(plain));
}

export { verifySignature, decryptPayload };
