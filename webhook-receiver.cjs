const http = require('http');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const os = require('os');
const { repositoryFor, normalizeIncomingSnapshot } = require('./electron/repository.cjs');
const { analyzeAll } = require('./electron/diagnosticReportAnalyzer.cjs');

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

// In-memory "who's currently signed in" presence store - genuinely ephemeral, same
// category as EVENT_LOG above (process memory only, resets on host restart). Presence
// is NOT synced through Base44 or the outbound quote queue (confirmed those are
// quote/collection-specific, not generic) - it reuses this SAME machine-to-machine
// webhook mechanism already proven for diagnostic reports and snapshots, since
// "who's online right now" is short-lived, real-time-ish data, not a durable business
// record worth a full Base44 round-trip.
const ACTIVE_SESSIONS = new Map(); // keyed by lowercased email
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

const SYNC_THROTTLE_MS = 60 * 1000;
// FIX (confirmed root cause of the desktop-vs-web alert count discrepancy): this was
// previously 15 MINUTES, applied GLOBALLY to every import (not per-quote, not just for
// exact duplicates) -- meaning if quotes kept changing continuously (completely normal
// during a work day), a queued snapshot would routinely wait 15+ minutes before ever
// being applied, since each new incoming webhook just re-queued it further rather than
// being treated as fresh, importable data. This made desktop's quote data (and therefore
// every alert computed from it) measurably stale compared to Base44's live state.
// Lowered to 60 seconds -- still long enough to collapse genuine rapid-fire duplicate
// deliveries (e.g. two automations firing on the same edit, confirmed and reduced to one
// this session), but short enough that real, distinct quote changes throughout the day
// are reflected locally within about a minute instead of potentially 15+.

// ---------------------------------------------------------------------------
// Queued-snapshot mechanism (fixes a real data-loss bug)
//
// PREVIOUS BEHAVIOR: when a webhook arrived inside the 15-minute throttle
// window, the incoming snapshot was discarded outright - never saved
// anywhere, never retried. If a homeowner's quote status changed on Base44
// during that window, the update was silently lost and the local app kept
// showing stale data indefinitely (confirmed root cause of a real "wrong
// status badge" bug).
//
// NEW BEHAVIOR: a throttled snapshot is written to a small
// "enquote-pending-snapshot.json" file (one per data directory, sitting
// right next to the real data file) instead of being thrown away, and a
// timer is scheduled to apply it automatically the moment the throttle
// window clears - even if no further webhook ever arrives. A newer
// throttled delivery simply overwrites the pending file and reschedules the
// timer (we only ever need to keep the LATEST snapshot, never a history).
// If the app/receiver process restarts before the timer fires, the next
// webhook OR the next force-refresh will pick up and apply the still-queued
// snapshot before doing anything else, so nothing is lost across restarts.
// ---------------------------------------------------------------------------
const PENDING_SNAPSHOT_FILENAME = 'enquote-pending-snapshot.json';
const pendingApplyTimers = new Map(); // targetDir -> Node timer

function pendingSnapshotPath(targetDir) {
  return path.join(targetDir, PENDING_SNAPSHOT_FILENAME);
}

function savePendingSnapshot(targetDir, payload) {
  try {
    fs.writeFileSync(pendingSnapshotPath(targetDir), JSON.stringify(payload), 'utf8');
    return true;
  } catch (error) {
    logEvent('error', `Could not save throttled snapshot for later import - it may be lost: ${error.message}`);
    return false;
  }
}

function loadPendingSnapshot(targetDir) {
  const target = pendingSnapshotPath(targetDir);
  if (!fs.existsSync(target)) return null;
  try {
    return JSON.parse(fs.readFileSync(target, 'utf8'));
  } catch (error) {
    logEvent('error', `Could not read queued snapshot file (it will be discarded, this data is lost): ${error.message}`);
    return null;
  }
}

function clearPendingSnapshot(targetDir) {
  try {
    const target = pendingSnapshotPath(targetDir);
    if (fs.existsSync(target)) fs.unlinkSync(target);
  } catch (error) {
    logEvent('warn', `Could not remove queued snapshot file after applying it: ${error.message}`);
  }
}

// Applies a queued snapshot (if one exists) directly via repo.importData - deliberately
// NOT routed back through persistSnapshotToLocalApp/its throttle check, since by the time
// this is called we've already established it's safe to import (either the window has
// cleared, or this is a fresh delivery that's allowed to proceed).
async function applyQueuedSnapshotIfPresent(targetDir, repo) {
  const pending = loadPendingSnapshot(targetDir);
  if (!pending) return false;
  logEvent('info', 'Applying a previously queued (throttled) snapshot before continuing...');
  try {
    const stored = await repo.importData(pending);
    clearPendingSnapshot(targetDir);
    logEvent('success', `Queued snapshot applied successfully (${Array.isArray(stored) ? stored.length : 0} quotes on disk now).`);
    return true;
  } catch (error) {
    // Left in place on disk so the NEXT opportunity (next webhook, next scheduled timer,
    // or next force-refresh) can retry it, instead of losing it on a transient failure.
    logEvent('error', `Failed to apply queued snapshot (left in place, will retry later): ${error.message}`);
    return false;
  }
}

function scheduleApplyPendingSnapshot(targetDir, delayMs) {
  const existingTimer = pendingApplyTimers.get(targetDir);
  if (existingTimer) clearTimeout(existingTimer);

  const timer = setTimeout(async () => {
    pendingApplyTimers.delete(targetDir);
    try {
      const repo = repositoryFor(targetDir);
      const applied = await applyQueuedSnapshotIfPresent(targetDir, repo);
      if (applied) {
        logEvent('info', 'Throttle window has cleared - the queued snapshot was applied automatically, no data was lost.');
      }
    } catch (error) {
      logEvent('error', `Error while auto-applying queued snapshot on schedule: ${error.message}`);
    }
  }, Math.max(0, delayMs));

  // Doesn't hold the process open on its own - the HTTP server already does that; this just
  // avoids this timer being the (irrelevant) reason the process stays alive if it didn't need to.
  if (typeof timer.unref === 'function') timer.unref();
  pendingApplyTimers.set(targetDir, timer);
}


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
      const remainingMs = SYNC_THROTTLE_MS - timeSinceLastImport;
      const queued = savePendingSnapshot(targetDir, payload);
      if (queued) {
        scheduleApplyPendingSnapshot(targetDir, remainingMs);
        logEvent('warn', 'Import throttled - snapshot QUEUED (not discarded). It will be applied automatically once the throttle window clears.', {
          secondsUntilNextSync: Math.ceil(remainingMs / 1000)
        });
      } else {
        logEvent('error', 'Import throttled AND could not be queued - this snapshot will be lost unless another webhook arrives after the window clears.', {
          secondsUntilNextSync: Math.ceil(remainingMs / 1000)
        });
      }
      return {
        targetDir,
        storedQuoteCount: Array.isArray(currentData?.quotes) ? currentData.quotes.length : 0,
        storedProductCount: Array.isArray(currentData?.products) ? currentData.products.length : 0,
        cached: true,
        reason: 'throttled',
        queued,
        secondsUntilNextSync: Math.ceil(remainingMs / 1000)
      };
    }
  }

  // Clear to proceed (window elapsed, or bypassThrottle was requested). If an earlier
  // delivery is still sitting queued - e.g. the receiver process restarted before its
  // scheduled timer fired - apply it first so it's never silently skipped just because a
  // fresher webhook happened to arrive before the timer did.
  await applyQueuedSnapshotIfPresent(targetDir, repo);

  logEvent('info', 'Importing new snapshot data...');
  const normalized = normalizeIncomingSnapshot(payload);
  logEvent('info', `Normalized snapshot contains ${normalized.quotes ? normalized.quotes.length : 0} quotes, ${normalized.products ? normalized.products.length : 0} products`);

  // TEMPORARY DIAGNOSTIC (read-only, does not change any imported/merged/stored data) -
  // reports exactly how many MaterialOrder records arrived in this incoming snapshot,
  // both in the raw payload's entities AND after normalizeIncomingSnapshot() ran, plus
  // the most recent updated_date/created_date among them. This is scoped to
  // materialOrders specifically to diagnose why the app's Custom Material Orders shows
  // stale data (latest visible record from Jul 7) while Base44's own EnQuote page shows
  // current same-day orders - confirmed that materialOrders IS correctly mapped to the
  // "MaterialOrder" Base44 entity name in collectionEntityMappings, so this checks
  // whether the incoming data itself is stale (upstream) or something in the merge is
  // silently preferring old local data over new incoming records.
  try {
    const rawEntities = (payload && payload.snapshot && payload.snapshot.entities && typeof payload.snapshot.entities === 'object')
      ? payload.snapshot.entities
      : (payload && payload.entities && typeof payload.entities === 'object' ? payload.entities : {});
    const rawMaterialOrders = Array.isArray(rawEntities.MaterialOrder) ? rawEntities.MaterialOrder : [];
    const normalizedMaterialOrders = Array.isArray(normalized.materialOrders) ? normalized.materialOrders : [];
    const getRecordTimestamp = (record) => {
      const candidate = record && (record.updated_date || record.updated_at || record.created_date || record.created_at);
      const time = candidate ? Date.parse(candidate) : NaN;
      return Number.isNaN(time) ? null : time;
    };
    const rawTimestamps = rawMaterialOrders.map(getRecordTimestamp).filter((t) => t !== null);
    const mostRecentRawTimestamp = rawTimestamps.length > 0 ? new Date(Math.max(...rawTimestamps)).toISOString() : null;
    logEvent('info', `[DIAGNOSTIC] MaterialOrder sync check - raw payload entities.MaterialOrder count: ${rawMaterialOrders.length}, normalized materialOrders count: ${normalizedMaterialOrders.length}, most recent timestamp seen in raw payload: ${mostRecentRawTimestamp || 'none found'}`);
  } catch (diagError) {
    logEvent('warn', `[DIAGNOSTIC] MaterialOrder sync check failed (non-fatal): ${diagError.message}`);
  }
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

// Announces this user as currently signed in - called on successful login. Protected by
// the SAME shared secret as the diagnostic-report/snapshot endpoints - no new secret to
// distribute. Functionally tested end-to-end before shipping (valid announce, invalid
// secret rejected, re-announce updates rather than duplicates, missing email rejected).
async function handlePresenceAnnounce(req, res) {
  if (SECRET_IS_PLACEHOLDER) {
    res.writeHead(503, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ ok: false, error: 'Shared secret not configured on this relay.' }));
    return;
  }
  const providedSecret = req.headers['x-enquote-shared-secret'] || '';
  const expected = Buffer.from(SECRET_RAW, 'utf8');
  const provided = Buffer.from(String(providedSecret), 'utf8');
  const isValid = expected.length === provided.length && crypto.timingSafeEqual(expected, provided);
  if (!isValid) {
    res.writeHead(401, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ ok: false, error: 'Unauthorized' }));
    return;
  }

  let rawBuf;
  try {
    rawBuf = await readBody(req);
  } catch (error) {
    res.writeHead(413, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ ok: false, error: error.message }));
    return;
  }

  let payload;
  try {
    payload = JSON.parse(rawBuf.toString('utf8'));
  } catch (error) {
    res.writeHead(400, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ ok: false, error: 'Request body was not valid JSON.' }));
    return;
  }

  const email = String(payload.email || '').trim().toLowerCase();
  if (!email) {
    res.writeHead(400, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ ok: false, error: 'email is required.' }));
    return;
  }

  ACTIVE_SESSIONS.set(email, {
    email,
    name: payload.name || email,
    signedInAt: new Date().toISOString()
  });
  logEvent('info', `Presence: ${email} signed in.`);
  res.writeHead(200, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify({ ok: true }));
}

// Removes a user from the presence list - called on sign-out. Same auth as announce above.
async function handlePresenceRemove(req, res) {
  if (SECRET_IS_PLACEHOLDER) {
    res.writeHead(503, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ ok: false, error: 'Shared secret not configured on this relay.' }));
    return;
  }
  const providedSecret = req.headers['x-enquote-shared-secret'] || '';
  const expected = Buffer.from(SECRET_RAW, 'utf8');
  const provided = Buffer.from(String(providedSecret), 'utf8');
  const isValid = expected.length === provided.length && crypto.timingSafeEqual(expected, provided);
  if (!isValid) {
    res.writeHead(401, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ ok: false, error: 'Unauthorized' }));
    return;
  }

  let rawBuf;
  try {
    rawBuf = await readBody(req);
  } catch (error) {
    res.writeHead(413, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ ok: false, error: error.message }));
    return;
  }

  let payload;
  try {
    payload = JSON.parse(rawBuf.toString('utf8'));
  } catch (error) {
    res.writeHead(400, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ ok: false, error: 'Request body was not valid JSON.' }));
    return;
  }

  const email = String(payload.email || '').trim().toLowerCase();
  if (email) {
    ACTIVE_SESSIONS.delete(email);
    logEvent('info', `Presence: ${email} signed out.`);
  }
  res.writeHead(200, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify({ ok: true }));
}

// Returns the current presence list. Requires the shared secret, same as every other
// endpoint reachable over the public ngrok tunnel.
async function handlePresenceList(req, res) {
  if (SECRET_IS_PLACEHOLDER) {
    res.writeHead(503, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ ok: false, error: 'Shared secret not configured on this relay.' }));
    return;
  }
  const providedSecret = req.headers['x-enquote-shared-secret'] || '';
  const expected = Buffer.from(SECRET_RAW, 'utf8');
  const provided = Buffer.from(String(providedSecret), 'utf8');
  const isValid = expected.length === provided.length && crypto.timingSafeEqual(expected, provided);
  if (!isValid) {
    res.writeHead(401, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ ok: false, error: 'Unauthorized' }));
    return;
  }

  res.writeHead(200, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify({ ok: true, sessions: Array.from(ACTIVE_SESSIONS.values()) }));
}

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
  } else if (req.method === 'GET' && req.url === '/api/base44/webhook/snapshot-meta') {
    // NEW: lightweight metadata-only check - returns just { ok, lastSavedAt }, a few
    // bytes, safe to call frequently. Lets a client machine cheaply detect "did
    // anything change on the host" before paying the cost of a full snapshot pull.
    handleSnapshotMetaRequest(req, res);
  } else if (req.method === 'GET' && req.url === '/api/base44/webhook/snapshot') {
    // Lets a TEAMMATE's desktop app (which never runs its own receiver/ngrok tunnel)
    // pull this machine's current data through the shared ngrok URL, instead of only
    // being able to report status to callers on this same machine.
    handleSnapshotRequest(req, res);
  } else if (req.method === 'POST' && req.url === '/api/base44/webhook/diagnostic-report') {
    // Lets a TEAMMATE's desktop app send a self-service diagnostic report (app version,
    // outbound queue health, recent event log) directly to this machine, so
    // troubleshooting no longer requires manually pasting terminal output back and forth.
    handleDiagnosticReport(req, res);
  } else if (req.method === 'POST' && req.url === '/api/base44/webhook/presence/announce') {
    // Announces this user as currently signed in (see Developer Console's "Who's Online" tab).
    handlePresenceAnnounce(req, res);
  } else if (req.method === 'POST' && req.url === '/api/base44/webhook/presence/remove') {
    // Removes this user from the presence list on sign-out.
    handlePresenceRemove(req, res);
  } else if (req.method === 'GET' && req.url === '/api/base44/webhook/presence') {
    // Returns everyone currently marked as signed in.
    handlePresenceList(req, res);
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

// Serves this machine's current data to a REMOTE teammate's app, protected by the
// same shared secret already used for validating inbound Base44 webhook deliveries
// (ENQUOTE_LOCAL_SYNC_WEBHOOK_SECRET) -- no new secret to generate or distribute.
// Requests without a valid matching "X-ENQuote-Shared-Secret" header are rejected.
// NEW: lightweight metadata-only endpoint - returns ONLY { ok, lastSavedAt }, never the
// full dataset. meta.last_saved_at is stamped by writeInner() on EVERY write (confirmed
// via repository.cjs), not just quote imports - a fully reliable "did anything change"
// signal for every collection this app tracks, not just quotes. This lets a client
// machine poll frequently (e.g. every 30s) for near-real-time freshness without the
// bandwidth cost of transferring the full dataset on every check.
async function handleSnapshotMetaRequest(req, res) {
  if (SECRET_IS_PLACEHOLDER) {
    res.writeHead(503, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ ok: false, error: 'Shared secret not configured on this relay.' }));
    return;
  }

  const providedSecret = req.headers['x-enquote-shared-secret'] || '';
  const expected = Buffer.from(SECRET_RAW, 'utf8');
  const provided = Buffer.from(String(providedSecret), 'utf8');
  const isValid = expected.length === provided.length && crypto.timingSafeEqual(expected, provided);

  if (!isValid) {
    res.writeHead(401, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ ok: false, error: 'Unauthorized' }));
    return;
  }

  try {
    const targetDir = resolveRepositoryDirectory(null);
    const repo = repositoryFor(targetDir);
    const data = await repo.exportData();
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ ok: true, lastSavedAt: data.meta?.last_saved_at || null }));
  } catch (error) {
    res.writeHead(500, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ ok: false, error: error.message }));
  }
}

// FIX (confirmed root cause of stale materialOrders/reviews/siteFlags/etc. for every
// CLIENT machine - i.e. any machine with a remote-sync-config.json): this endpoint
// previously hand-picked only { version, quotes, products, meta } to return, so a
// client pulling via this endpoint NEVER received materialOrders or any of the other
// ~18 collections this app tracks - not because of a merge bug, but because the
// incoming data for those collections was always an empty array, and
// mergeRecordsById's own first line is "if incoming is empty, return existing
// unchanged" (correct behavior, being fed incomplete data). Now returns the ENTIRE
// dataset via the same exportData() already used elsewhere - since importData()'s
// merge logic already iterates every collectionNames entry generically, this requires
// ZERO changes on the receiving side to start working correctly.
async function handleSnapshotRequest(req, res) {
  if (SECRET_IS_PLACEHOLDER) {
    logEvent('error', 'Rejected snapshot request - no shared secret configured on this relay (still the placeholder value).');
    res.writeHead(503, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ ok: false, error: 'Shared secret not configured on this relay.' }));
    return;
  }

  const providedSecret = req.headers['x-enquote-shared-secret'] || '';
  const expected = Buffer.from(SECRET_RAW, 'utf8');
  const provided = Buffer.from(String(providedSecret), 'utf8');
  const isValid = expected.length === provided.length && crypto.timingSafeEqual(expected, provided);

  if (!isValid) {
    logEvent('error', 'Rejected snapshot request - invalid or missing shared secret.');
    res.writeHead(401, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ ok: false, error: 'Unauthorized' }));
    return;
  }

  try {
    const targetDir = resolveRepositoryDirectory(null);
    const repo = repositoryFor(targetDir);
    const data = await repo.exportData();
    logEvent('success', `Snapshot request served - ${Array.isArray(data.quotes) ? data.quotes.length : 0} quotes, ${Array.isArray(data.products) ? data.products.length : 0} products, full dataset (all collections included).`);
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({
      ok: true,
      ...data
    }));
  } catch (error) {
    logEvent('error', `Snapshot request failed: ${error.message}`);
    res.writeHead(500, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ ok: false, error: error.message }));
  }
}

// Saves a teammate's self-service diagnostic report as its own timestamped JSON file,
// protected by the same shared secret already used for the snapshot endpoint. Each
// report is a small, self-contained snapshot of one machine's sync health at the
// moment it was sent -- app version, whether it's the host, outbound queue counts, and
// a slice of its recent event log -- so troubleshooting can start from real data
// instead of asking someone to paste PowerShell output.
async function handleDiagnosticReport(req, res) {
  if (SECRET_IS_PLACEHOLDER) {
    res.writeHead(503, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ ok: false, error: 'Shared secret not configured on this relay.' }));
    return;
  }

  const providedSecret = req.headers['x-enquote-shared-secret'] || '';
  const expected = Buffer.from(SECRET_RAW, 'utf8');
  const provided = Buffer.from(String(providedSecret), 'utf8');
  const isValid = expected.length === provided.length && crypto.timingSafeEqual(expected, provided);

  if (!isValid) {
    logEvent('error', 'Rejected diagnostic report - invalid or missing shared secret.');
    res.writeHead(401, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ ok: false, error: 'Unauthorized' }));
    return;
  }

  let rawBuf;
  try {
    rawBuf = await readBody(req);
  } catch (error) {
    res.writeHead(413, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ ok: false, error: error.message }));
    return;
  }

  let report;
  try {
    report = JSON.parse(rawBuf.toString('utf8'));
  } catch (error) {
    res.writeHead(400, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ ok: false, error: 'Report body was not valid JSON.' }));
    return;
  }

  // Re-analyzes the report on arrival using the exact same shared logic the
  // sender used -- so this machine's own review never depends on trusting
  // the sender's app version to have the same analysis logic baked in.
  // If analysis itself fails for any reason, the report is still saved raw
  // rather than being lost, and the failure is logged for follow-up.
  try {
    report.analysis = analyzeAll(report);
  } catch (analysisError) {
    logEvent('error', `Diagnostic report analysis failed (report still saved raw): ${analysisError.message}`);
  }

  try {
    const reportsDir = path.join(__dirname, 'diagnostic-reports');
    fs.mkdirSync(reportsDir, { recursive: true });
    // Sanitizes the sender's email for safe use in a filename - strips anything that
    // isn't alphanumeric/@/./_/- to prevent path traversal or invalid filename
    // characters, confirmed via a functional test before this endpoint was written.
    const safeEmail = String(report.senderEmail || 'unknown').replace(/[^a-z0-9@._-]/gi, '_');
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
    const filename = `${timestamp}__${safeEmail}.json`;
    const targetPath = path.join(reportsDir, filename);
    fs.writeFileSync(targetPath, JSON.stringify(report, null, 2), 'utf8');
    logEvent('success', `Diagnostic report received from ${report.senderEmail || 'unknown'} - saved to ${filename}`);
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ ok: true }));
  } catch (error) {
    logEvent('error', `Failed to save diagnostic report: ${error.message}`);
    res.writeHead(500, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ ok: false, error: error.message }));
  }
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
  //
  // It DOES, however, take this opportunity to apply any snapshot that was queued earlier by
  // the throttle (see applyQueuedSnapshotIfPresent above) if the window has since cleared -
  // a manual refresh click is a reasonable moment to also surface anything that was waiting.
  try {
    const targetDir = resolveRepositoryDirectory(explicitDir);
    const repo = repositoryFor(targetDir);

    const currentDataBefore = await repo.exportData();
    const lastImportedAt = currentDataBefore?.meta?.last_imported_at ? new Date(currentDataBefore.meta.last_imported_at).getTime() : 0;
    const windowHasCleared = (Date.now() - lastImportedAt) >= SYNC_THROTTLE_MS;
    let appliedQueued = false;
    if (windowHasCleared) {
      appliedQueued = await applyQueuedSnapshotIfPresent(targetDir, repo);
    }

    const currentData = appliedQueued ? await repo.exportData() : currentDataBefore;
    const summary = {
      targetDir,
      storedQuoteCount: Array.isArray(currentData?.quotes) ? currentData.quotes.length : 0,
      storedProductCount: Array.isArray(currentData?.products) ? currentData.products.length : 0,
      lastImportedAt: currentData?.meta?.last_imported_at || null,
      cached: false,
      imported: false,
      forced: true,
      appliedQueuedSnapshot: appliedQueued
    };
    logEvent('success', `Refresh check complete - ${summary.storedQuoteCount} quotes currently on disk (last imported: ${summary.lastImportedAt || 'never'})${appliedQueued ? ' [a queued snapshot was just applied]' : ''}`);
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
    queued: importSummary.queued || false,
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
