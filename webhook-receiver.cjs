const http = require('http');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const os = require('os');
const { repositoryFor, normalizeIncomingSnapshot } = require('./electron/repository.cjs');

const PORT = 3001;
const ENV_PATH = path.join(__dirname, '.env');

function loadEnvFile() {
  if (!fs.existsSync(ENV_PATH)) return;
  const lines = fs.readFileSync(ENV_PATH, 'utf8').split(/\r?\n/);

  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const eqIndex = trimmed.indexOf('=');
    if (eqIndex === -1) continue;
    const key = trimmed.slice(0, eqIndex).trim();
    const value = trimmed.slice(eqIndex + 1).trim();
    if (!process.env[key]) {
      process.env[key] = value.replace(/^['"]|['"]$/g, '');
    }
  }
}

loadEnvFile();

// In-memory event log used to power the desktop app's "refresh progress" popup.
// Kept small and ephemeral (process memory only) - not written to disk beyond the
// existing webhook-events.jsonl audit trail.
const EVENT_LOG = [];
const MAX_EVENT_LOG = 300;
let EVENT_SEQ = 0;

function logEvent(level, message, meta) {
  const entry = {
    seq: ++EVENT_SEQ,
    time: new Date().toISOString(),
    level, // 'info' | 'warn' | 'error' | 'success'
    message,
    ...(meta ? { meta } : {})
  };
  EVENT_LOG.push(entry);
  if (EVENT_LOG.length > MAX_EVENT_LOG) EVENT_LOG.shift();

  const line = `[${entry.time}] ${level.toUpperCase()}: ${message}`;
  if (level === 'error') console.error(line, meta || '');
  else if (level === 'warn') console.warn(line, meta || '');
  else console.log(line, meta || '');

  return entry;
}

// Tracks the most recent import attempt (successful or not) so /status can report
// a quick summary without the caller needing to replay the whole event log.
const lastAttempt = {
  startedAt: null,
  finishedAt: null,
  ok: null,
  reason: null, // 'imported' | 'throttled' | 'invalid_signature' | 'decrypt_failed' | 'error'
  storedQuoteCount: null,
  storedProductCount: null,
  bytes: null
};

const SECRET_RAW = process.env.ENQUOTE_LOCAL_SYNC_WEBHOOK_SECRET || 'replace-with-shared-secret';
const SECRET_IS_PLACEHOLDER = SECRET_RAW === 'replace-with-shared-secret';

// Base44 (or any sender) may treat the shared secret as raw UTF-8 text, a base64 string,
// or a hex string when computing its HMAC key. Rather than guessing wrong and hard-failing
// every legitimate delivery, build every plausible candidate key and accept a signature that
// matches ANY of them. This makes validation robust to encoding differences on the sender side
// without weakening security (the secret itself is still required to be correct).
function buildSecretCandidates(raw) {
  if (!raw || raw === 'replace-with-shared-secret') return [];
  const candidates = new Map(); // dedupe by hex representation of the resulting key buffer

  const tryAdd = (label, buf) => {
    if (!buf || !buf.length) return;
    const key = buf.toString('hex');
    if (!candidates.has(key)) candidates.set(key, { label, buf });
  };

  // Raw UTF-8 bytes of the secret string itself (most common convention for "shared secret").
  tryAdd('utf8', Buffer.from(raw, 'utf8'));

  // Base64-decoded (our historical assumption / what we generate ourselves).
  try {
    const b64 = Buffer.from(raw, 'base64');
    // Only trust this decode if re-encoding round-trips (guards against silently mangling
    // a plain-text secret that merely happens to contain base64-safe characters).
    if (b64.toString('base64').replace(/=+$/, '') === raw.replace(/=+$/, '')) {
      tryAdd('base64', b64);
    }
  } catch {
    /* ignore */
  }

  // Hex-decoded, in case the secret was generated/copied as a hex string.
  if (/^[0-9a-fA-F]+$/.test(raw) && raw.length % 2 === 0) {
    try {
      tryAdd('hex', Buffer.from(raw, 'hex'));
    } catch {
      /* ignore */
    }
  }

  return Array.from(candidates.values());
}

const SECRET_CANDIDATES = buildSecretCandidates(SECRET_RAW);
// Kept for any legacy code paths that only need a truthy/placeholder check.
const SECRET = SECRET_IS_PLACEHOLDER ? SECRET_RAW : (SECRET_CANDIDATES[0] && SECRET_CANDIDATES[0].buf);

const ENCRYPTION_KEY_RAW = process.env.ENQUOTE_LOCAL_SYNC_ENCRYPTION_KEY || '';
let ENCRYPTION_KEY = null;
if (ENCRYPTION_KEY_RAW) {
  const keyBuf = Buffer.from(ENCRYPTION_KEY_RAW, 'base64');
  if (keyBuf.length === 32) {
    ENCRYPTION_KEY = keyBuf;
  } else {
    console.warn('ENQUOTE_LOCAL_SYNC_ENCRYPTION_KEY is set but is not a valid base64-encoded 32-byte key (got', keyBuf.length, 'bytes). Encrypted payloads will fail to decrypt.');
  }
}


// Accepts a few common field-name variants since the sender's exact envelope shape may vary.
function pickField(obj, names) {
  for (const name of names) {
    if (obj && obj[name] !== undefined && obj[name] !== null) return obj[name];
  }
  return undefined;
}

/**
 * Decrypts an AES-256-GCM encrypted payload envelope.
 * Base44's actual delivery shape (confirmed by inspecting live delivery diagnostics) is:
 *   { schema_version, delivery_id, sent_at, mode: "snapshot",
 *     encryption: { algorithm, encoding, iv, ciphertext } }
 * Notably there is NO separate `tag`/`authTag` field. This matches the standard WebCrypto
 * `crypto.subtle.encrypt("AES-GCM", ...)` convention (which Base44's Deno-based backend
 * function almost certainly uses) where the 16-byte GCM authentication tag is APPENDED to
 * the end of the ciphertext buffer rather than transmitted separately. Node's `crypto`
 * module (unlike WebCrypto) requires the tag split out via `setAuthTag()` before decrypting,
 * so we split it off the last 16 bytes of the decoded ciphertext here.
 * Falls back to an explicit top-level/nested tag field if one is ever present, for
 * resilience against a future envelope shape change.
 * iv/ciphertext are base64-encoded strings (or per `encoding`, if present) unless noted.
 * Returns the parsed JSON object, or throws if decryption/parsing fails.
 */
function decryptPayload(envelope) {
  if (!ENCRYPTION_KEY) {
    throw new Error('Received an encrypted payload but ENQUOTE_LOCAL_SYNC_ENCRYPTION_KEY is not configured on this relay.');
  }

  const nested = envelope && typeof envelope.encryption === 'object' && envelope.encryption !== null
    ? envelope.encryption
    : null;

  const encoding = (nested && nested.encoding) || 'base64';
  const ivB64 = pickField(envelope, ['iv', 'nonce']) || (nested && pickField(nested, ['iv', 'nonce']));
  const explicitTagB64 = pickField(envelope, ['tag', 'authTag', 'auth_tag']) || (nested && pickField(nested, ['tag', 'authTag', 'auth_tag']));
  const dataB64 = pickField(envelope, ['ciphertext', 'data', 'payload', 'encrypted_data', 'encryptedData'])
    || (nested && pickField(nested, ['ciphertext', 'data', 'payload', 'encrypted_data', 'encryptedData']));

  if (!ivB64 || !dataB64) {
    const envelopeKeys = envelope && typeof envelope === 'object' ? Object.keys(envelope) : [];
    const nestedKeys = nested ? Object.keys(nested) : null;
    logEvent('error', 'Encrypted payload is missing iv/ciphertext fields - logging shape for diagnosis.', {
      envelopeKeys,
      nestedEncryptionKeys: nestedKeys,
      algorithm: nested && nested.algorithm,
      encoding,
      mode: envelope && envelope.mode
    });
    throw new Error('Encrypted payload is missing iv/ciphertext fields.');
  }

  const iv = Buffer.from(ivB64, encoding);
  let ciphertext = Buffer.from(dataB64, encoding);
  let authTag;

  if (explicitTagB64) {
    authTag = Buffer.from(explicitTagB64, encoding);
  } else {
    // No separate tag field - assume the standard WebCrypto convention where the 16-byte
    // GCM tag is appended to the end of the ciphertext buffer.
    const GCM_TAG_LENGTH = 16;
    if (ciphertext.length <= GCM_TAG_LENGTH) {
      throw new Error(`Ciphertext too short to contain an appended GCM tag (${ciphertext.length} bytes).`);
    }
    authTag = ciphertext.subarray(ciphertext.length - GCM_TAG_LENGTH);
    ciphertext = ciphertext.subarray(0, ciphertext.length - GCM_TAG_LENGTH);
  }

  const decipher = crypto.createDecipheriv('aes-256-gcm', ENCRYPTION_KEY, iv);
  decipher.setAuthTag(authTag);
  const decrypted = Buffer.concat([decipher.update(ciphertext), decipher.final()]);

  return JSON.parse(decrypted.toString('utf8'));
}

/**
 * Given a parsed request body, returns the effective plaintext payload.
 * Detects an encrypted envelope and decrypts it; otherwise returns the body as-is.
 * Detection checks (in order): an explicit `encrypted: true` flag, iv/ciphertext fields
 * at the envelope's own top level, a `mode` field indicating encryption (e.g. "encrypted"
 * / "aes-256-gcm"), or a nested `encryption` object - Base44's real delivery shape is
 * `{ schema_version, delivery_id, sent_at, mode, encryption: {...} }` with no top-level
 * `encrypted` flag at all, which the original version of this function never recognized.
 */
function resolvePayload(body) {
  const hasNestedEncryption = body && typeof body === 'object' && body.encryption && typeof body.encryption === 'object';
  const modeIndicatesEncryption = body && typeof body.mode === 'string' && /encrypt/i.test(body.mode);
  const looksEncrypted =
    body && typeof body === 'object' &&
    (body.encrypted === true ||
      hasNestedEncryption ||
      modeIndicatesEncryption ||
      (pickField(body, ['iv', 'nonce']) && pickField(body, ['ciphertext', 'data', 'payload', 'encrypted_data', 'encryptedData'])));

  if (!looksEncrypted) return body;

  logEvent('info', 'Encrypted payload detected - decrypting with AES-256-GCM...', {
    mode: body.mode,
    hasNestedEncryption,
    nestedEncryptionKeys: hasNestedEncryption ? Object.keys(body.encryption) : null
  });
  const decrypted = decryptPayload(body);
  logEvent('info', 'Payload decrypted successfully.');
  return decrypted;
}

function resolveRepositoryDirectory(explicitDir) {
  if (explicitDir) {
    fs.mkdirSync(explicitDir, { recursive: true });
    return explicitDir;
  }

  const candidates = [
    process.env.ENQUOTE_LOCAL_DATA_PATH,
    process.env.ENQUOTE_DATA_PATH,
    // "EnQuote Demo" matches the app's productName (package.json build.productName),
    // so Electron's app.getPath("userData") resolves here. Check it before "base44-app".
    path.join(process.env.APPDATA || '', 'EnQuote Demo'),
    path.join(process.env.APPDATA || '', 'base44-app'),
    path.join(process.env.APPDATA || '', 'EnQuote'),
    path.join(process.env.LOCALAPPDATA || '', 'EnQuote Demo'),
    path.join(process.env.LOCALAPPDATA || '', 'base44-app'),
    path.join(process.env.LOCALAPPDATA || '', 'EnQuote'),
    path.join(__dirname, 'local-snapshot-data'),
    __dirname
  ].filter(Boolean);

  for (const candidate of candidates) {
    const target = path.join(candidate, 'enquote-demo-data-v1.json');
    if (fs.existsSync(target)) return candidate;
  }

  const preferred = candidates[0] || path.join(os.homedir(), 'AppData', 'Roaming', 'EnQuote Demo');
  fs.mkdirSync(preferred, { recursive: true });
  return preferred;
}

const SYNC_THROTTLE_MS = 15 * 60 * 1000;


async function persistSnapshotToLocalApp(payload, explicitDir, options = {}) {
  const targetDir = resolveRepositoryDirectory(explicitDir);
  logEvent('info', `Resolved target directory: ${targetDir}`);
  const repo = repositoryFor(targetDir);

  const currentData = await repo.exportData();
  logEvent('info', `Current data loaded: ${Array.isArray(currentData?.quotes) ? currentData.quotes.length : 0} quotes on disk`);
  const lastImportedAt = currentData?.meta?.last_imported_at ? new Date(currentData.meta.last_imported_at).getTime() : 0;
  const now = Date.now();
  const timeSinceLastImport = now - lastImportedAt;

  if (!options.bypassThrottle) {
    logEvent('info', `Time since last import: ${timeSinceLastImport}ms (threshold: ${SYNC_THROTTLE_MS}ms)`);

    if (timeSinceLastImport < SYNC_THROTTLE_MS) {
      logEvent('warn', 'Import skipped - throttle window active. Incoming snapshot was NOT saved.', {
        secondsUntilNextSync: Math.ceil((SYNC_THROTTLE_MS - timeSinceLastImport) / 1000)
      });
      return {
        targetDir,
        storedQuoteCount: Array.isArray(currentData?.quotes) ? currentData.quotes.length : 0,
        storedProductCount: Array.isArray(currentData?.products) ? currentData.products.length : 0,
        cached: true,
        reason: 'throttled',
        secondsUntilNextSync: Math.ceil((SYNC_THROTTLE_MS - timeSinceLastImport) / 1000)
      };
    }
  }

  logEvent('info', 'Importing new snapshot data...');
  const normalized = normalizeIncomingSnapshot(payload);
  logEvent('info', `Normalized snapshot contains ${normalized.quotes ? normalized.quotes.length : 0} quotes, ${normalized.products ? normalized.products.length : 0} products`);
  if (!normalized.quotes || normalized.quotes.length === 0) {
    // Diagnostic-only: log the incoming payload's shape (top-level keys, and one level deeper)
    // so we can see how it actually differs from what normalizeIncomingSnapshot() expects,
    // without dumping potentially large/sensitive data into the log.
    const topKeys = payload && typeof payload === 'object' ? Object.keys(payload) : [];
    const snapshotKeys = payload && payload.snapshot && typeof payload.snapshot === 'object' ? Object.keys(payload.snapshot) : null;
    const entitiesObj = payload && payload.snapshot && payload.snapshot.entities;
    const entitiesKeys = entitiesObj && typeof entitiesObj === 'object' ? Object.keys(entitiesObj) : (payload && payload.entities && typeof payload.entities === 'object' ? Object.keys(payload.entities) : null);
    logEvent('warn', 'Zero quotes after normalization - logging payload shape for diagnosis.', {
      topLevelKeys: topKeys,
      snapshotKeys,
      entitiesKeys
    });
  }
  const stored = await repo.importData(payload);
  logEvent('success', `Import complete - stored ${stored ? stored.length : 0} quotes`);

  return {
    targetDir,
    storedQuoteCount: Array.isArray(stored) ? stored.length : 0,
    storedProductCount: Array.isArray(normalized.products) ? normalized.products.length : 0,
    cached: false,
    reason: 'imported',
    imported: true
  };
}

function validateSignature(rawBody, providedHeader) {
  if (!providedHeader || SECRET_IS_PLACEHOLDER || SECRET_CANDIDATES.length === 0) {
    return true;
  }

  const actualRaw = providedHeader.replace(/^sha256=/i, '').trim();
  if (!actualRaw) return false;

  // Try decoding the provided signature as hex first (most common), then base64.
  const providedBuffers = [];
  if (/^[0-9a-fA-F]+$/.test(actualRaw) && actualRaw.length % 2 === 0) {
    providedBuffers.push({ enc: 'hex', buf: Buffer.from(actualRaw, 'hex') });
  }
  try {
    providedBuffers.push({ enc: 'base64', buf: Buffer.from(actualRaw, 'base64') });
  } catch {
    /* ignore */
  }

  for (const { buf: keyBuf, label: keyLabel } of SECRET_CANDIDATES) {
    const expectedHex = crypto.createHmac('sha256', keyBuf).update(rawBody).digest('hex');
    const expectedBuf = Buffer.from(expectedHex, 'hex');

    for (const { buf: providedBuf, enc: sigLabel } of providedBuffers) {
      if (providedBuf.length !== expectedBuf.length) continue;
      if (crypto.timingSafeEqual(providedBuf, expectedBuf)) {
        console.log(`Signature valid (secret encoding: ${keyLabel}, signature encoding: ${sigLabel})`);
        return true;
      }
    }
  }

  // Diagnostic-only logging (never logs the secret itself) to help debug mismatches quickly.
  const sample = crypto.createHmac('sha256', SECRET_CANDIDATES[0].buf).update(rawBody).digest('hex');
  console.warn('Signature mismatch. Provided (truncated):', actualRaw.slice(0, 12) + '...',
    '| Expected using', SECRET_CANDIDATES[0].label, 'encoding (truncated):', sample.slice(0, 12) + '...',
    '| Tried', SECRET_CANDIDATES.length, 'secret encoding(s) and', providedBuffers.length, 'signature encoding(s).');
  return false;
}

const MAX_BODY_BYTES = 100 * 1024 * 1024; // 100MB - generous ceiling for a full-database snapshot

const server = http.createServer((req, res) => {
  if (req.method === 'POST' && req.url === '/api/base44/webhook') {
    // Normal webhook endpoint (with throttle)
    handleWebhookPost(req, res);
  } else if (req.method === 'POST' && req.url === '/api/base44/webhook/refresh-now') {
    // Force refresh endpoint (bypasses throttle)
    handleForceRefresh(req, res);
  } else if (req.method === 'GET' && req.url === '/health') {
    // Health check
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({
      ok: true,
      status: 'running',
      port: PORT,
      encryptionConfigured: Boolean(ENCRYPTION_KEY),
      maxBodyBytes: MAX_BODY_BYTES
    }));
  } else if (req.method === 'GET' && req.url === '/status') {
    // Quick summary of the most recent import attempt - used by the app's refresh popup.
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ ok: true, lastAttempt }));
  } else if (req.method === 'GET' && req.url.startsWith('/events')) {
    // Full event log (optionally "since" a given seq number) - used by the app's log dropdown.
    const url = new URL(req.url, 'http://localhost');
    const since = Number(url.searchParams.get('since') || 0);
    const events = EVENT_LOG.filter(e => e.seq > since);
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ ok: true, events, latestSeq: EVENT_SEQ }));
  } else {
    res.writeHead(404, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ ok: false, error: 'Not found' }));
  }
});

// Allow large, slow uploads (full-database snapshots over ngrok) to complete without timing out.
server.requestTimeout = 0; // disable Node's default 5-minute overall request timeout
server.headersTimeout = 0;
server.setTimeout(0);

/**
 * Reads the full request body into a Buffer, enforcing MAX_BODY_BYTES.
 * Returns a promise that resolves with the Buffer, or rejects if the limit is exceeded
 * or the connection errors out before completion.
 */
function readBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let total = 0;
    req.on('data', (chunk) => {
      total += chunk.length;
      if (total > MAX_BODY_BYTES) {
        reject(new Error(`Request body exceeded ${MAX_BODY_BYTES} byte limit`));
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });
    req.on('end', () => resolve(Buffer.concat(chunks)));
    req.on('error', reject);
  });
}

async function handleForceRefresh(req, res) {
  const explicitDir = req.headers['x-enquote-data-dir'] || null;
  let rawBuf;
  try {
    rawBuf = await readBody(req);
  } catch (error) {
    logEvent('error', `Refresh request body read failed: ${error.message}`);
    res.writeHead(413, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ ok: false, error: error.message }));
    return;
  }

  logEvent('info', `Refresh button clicked - checking for latest imported data (${rawBuf.length} bytes received, ignored).`);

  // IMPORTANT: the refresh button does NOT fabricate or re-post a snapshot of the app's own
  // current data. Doing so used to call repo.importData() with a no-op copy of existing data,
  // which updated last_imported_at and reset the 15-minute throttle window - silently blocking
  // the NEXT real Base44 webhook delivery for another 15 minutes. Instead, refresh simply reports
  // whatever the webhook receiver already has stored on disk (most recent successful import),
  // and the Electron app reloads its window to pick up any changes.
  try {
    const targetDir = resolveRepositoryDirectory(explicitDir);
    const repo = repositoryFor(targetDir);
    const currentData = await repo.exportData();
    const summary = {
      targetDir,
      storedQuoteCount: Array.isArray(currentData?.quotes) ? currentData.quotes.length : 0,
      storedProductCount: Array.isArray(currentData?.products) ? currentData.products.length : 0,
      lastImportedAt: currentData?.meta?.last_imported_at || null,
      cached: false,
      imported: false,
      forced: true
    };
    logEvent('success', `Refresh check complete - ${summary.storedQuoteCount} quotes currently on disk (last imported: ${summary.lastImportedAt || 'never'})`);
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ ok: true, received: true, ...summary }));
  } catch (error) {
    logEvent('error', `Refresh check failed: ${error.message}`);
    res.writeHead(500, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ ok: false, error: error.message }));
  }
}

async function handleWebhookPost(req, res) {
  const sig =
    req.headers['x-enquote-signature'] ||
    req.headers['x-base44-signature'] ||
    req.headers['x-webhook-signature'] ||
    '';
  const explicitDir = req.headers['x-enquote-data-dir'] || null;

  let rawBuf;
  try {
    rawBuf = await readBody(req);
  } catch (error) {
    logEvent('error', `Webhook body read failed: ${error.message}`);
    res.writeHead(413, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ ok: false, error: error.message }));
    return;
  }

  lastAttempt.startedAt = new Date().toISOString();
  lastAttempt.bytes = rawBuf.length;
  logEvent('info', `Webhook delivery received: ${rawBuf.length} bytes`);

  const raw = rawBuf.toString('utf8');
  let body = {};
  try {
    body = JSON.parse(raw) || {};
  } catch {
    body = { raw };
  }

  const isValid = validateSignature(raw, String(sig));
  if (!SECRET_IS_PLACEHOLDER && !isValid) {
    logEvent('error', 'Rejected delivery - invalid HMAC signature.');
    lastAttempt.finishedAt = new Date().toISOString();
    lastAttempt.ok = false;
    lastAttempt.reason = 'invalid_signature';
    res.writeHead(401, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ ok: false, error: 'Unauthorized: invalid signature' }));
    return;
  }

  if (SECRET_IS_PLACEHOLDER) {
    logEvent('warn', 'ENQUOTE_LOCAL_SYNC_WEBHOOK_SECRET is still set to the placeholder value. Update .env before production use.');
  }

  // Log audit metadata only (not the full body) - a full-database snapshot can be huge
  // and we don't want webhook-events.jsonl to grow unbounded or duplicate the data file.
  const auditLine = JSON.stringify({
    receivedAt: new Date().toISOString(),
    bytes: rawBuf.length,
    encrypted: body && typeof body === 'object' ? Boolean(body.encrypted) : false
  }) + '\n';
  fs.appendFileSync(path.join(__dirname, 'webhook-events.jsonl'), auditLine, 'utf8');

  let payload;
  try {
    payload = resolvePayload(body);
  } catch (error) {
    logEvent('error', `Failed to decrypt incoming payload: ${error.message}`);
    lastAttempt.finishedAt = new Date().toISOString();
    lastAttempt.ok = false;
    lastAttempt.reason = 'decrypt_failed';
    res.writeHead(400, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ ok: false, error: 'Decryption failed: ' + error.message }));
    return;
  }

  let importSummary = { targetDir: null, storedQuoteCount: 0, storedProductCount: 0 };
  if (payload && typeof payload === 'object') {
    try {
      logEvent('info', `Processing payload (decrypted size approx: ${JSON.stringify(payload).length} chars)`);
      importSummary = await persistSnapshotToLocalApp(payload, explicitDir);
      lastAttempt.finishedAt = new Date().toISOString();
      lastAttempt.ok = true;
      lastAttempt.reason = importSummary.reason || (importSummary.cached ? 'throttled' : 'imported');
      lastAttempt.storedQuoteCount = importSummary.storedQuoteCount;
      lastAttempt.storedProductCount = importSummary.storedProductCount;
    } catch (error) {
      logEvent('error', `Failed to persist incoming snapshot to local app data: ${error.message}`, { stack: error.stack });
      lastAttempt.finishedAt = new Date().toISOString();
      lastAttempt.ok = false;
      lastAttempt.reason = 'error';
    }
  }

  res.writeHead(200, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify({
    ok: true,
    received: true,
    count: 1,
    imported: importSummary.imported || false,
    cached: importSummary.cached || false,
    targetDir: importSummary.targetDir,
    storedQuoteCount: importSummary.storedQuoteCount,
    storedProductCount: importSummary.storedProductCount,
    secondsUntilNextSync: importSummary.secondsUntilNextSync || 0
  }));
}

server.listen(PORT, '127.0.0.1', () => {
  logEvent('info', `Webhook receiver listening on http://localhost:${PORT}/api/base44/webhook`);
  logEvent('info', `Secret loaded: ${SECRET_IS_PLACEHOLDER ? 'placeholder' : `configured (${SECRET_CANDIDATES.length} encoding candidate(s))`}`);
  logEvent('info', `Encryption key loaded: ${ENCRYPTION_KEY ? 'configured (AES-256-GCM)' : 'not configured (payloads must be sent as plaintext)'}`);
});
