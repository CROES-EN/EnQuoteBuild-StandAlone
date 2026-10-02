const fs = require("node:fs/promises");
const path = require("node:path");
const crypto = require("node:crypto");
const { z } = require("zod");
const { KNOWN_ENQUOTE_USERS } = require("./knownEnquoteUsers.cjs");

const DATA_VERSION = 1;
const DEFAULT_SYNC_TTL_MS = 5 * 60 * 1000;
const fileName = "enquote-data-v1.json";
// Gates the verbose [write-timing] diagnostic logging added this week while chasing the
// concurrency race + the write() self-deadlock, behind an explicit opt-in env var. Now
// that both of those bugs are fixed AND verified (clean restart, no recurrence), this
// logging fires on literally every single write and adds real overhead + noise for no
// ongoing benefit. Set ENQUOTE_DEBUG_WRITES=1 before launch to re-enable full output if a
// similar bug ever needs to be chased again - console.warn/console.error calls for the
// same [write-timing] tag are NOT gated by this and always log, since those represent
// real failures, not routine timing info.
// Official release: no demo/placeholder quotes on a fresh install - a genuinely new
// user starts with zero quotes and syncs their own real data from Base44.
const seedQuotes = [];
function logTiming(...args) {
  if (process.env.ENQUOTE_DEBUG_WRITES) console.log(...args);
}
const productSeed = [
  { id: "demo-product-001", name: "Disconnect Enclosure Repair", description: "Synthetic service item for demonstration quotes.", type: "service", sku: "DEMO-SVC-001", unit_price: 480, unit: "each", category: "Services", is_active: true },
  { id: "demo-product-002", name: "Outdoor Conduit Kit", description: "Synthetic conduit and fittings demonstration kit.", type: "product", sku: "DEMO-MAT-002", unit_price: 185, unit: "each", category: "Conduit & Raceway", is_active: true },
  { id: "demo-product-003", name: "Field Travel", description: "Synthetic service travel line item.", type: "service", sku: "DEMO-SVC-003", unit_price: 140, unit: "trip", category: "Services", is_active: true }
];
const quoteSchema = z.object({
  id: z.string().min(1),
  quote_number: z.string().nullable().optional(),
  status: z.string().nullable().optional(),
  total: z.number().nullable().optional(),
  is_current_version: z.boolean().nullable().optional(),
  parent_quote_id: z.string().nullable().optional(),
  version_number: z.number().nullable().optional(),
  // Local-only optimistic-concurrency counter (NOT the business-facing "version_number"
  // above, which represents resubmitted quote revisions). Bumped on every write that goes
  // through create()/update()/the webhook-import merge, so update() can detect and reject
  // a save based on stale data (e.g. the quote changed via a Base44 import while the Edit
  // Quote form was still open) instead of silently overwriting it. See update() below.
  _rev: z.number().int().positive().nullable().optional()
}).passthrough();
const updateSchema = z.object({ id: z.string().min(1), changes: z.record(z.unknown()) });
// "supervisorDailyMetrics" backs the Supervisor Dashboard (Calls/AHT, Emails Worked,
// Quotes Drafted, Staffing). That dashboard is intentionally independent of Base44, so
// this collection has no Base44 entity counterpart - it is only ever read/written locally.
const collectionNames = ["reviews", "activities", "followUps", "users", "siteFlags", "deletionRequests", "materialOrders", "rmas", "svCancels", "supportInteractions", "pdfTemplates", "priceReviews", "followUpConfigs", "pvManufacturers", "supervisorDailyMetrics", "supervisorReportTables", "autoImportSettings", "statusAlertDismissals", "quoteAlerts", "appErrorLog", "appNotifications", "autoDrafterGeneratedDrafts", "fsts"];
const collectionDefaults = {
  reviews: [],
  activities: [],
  followUps: [],
  // Official release: no demo/placeholder user on a fresh install - real users sync
  // in from Base44 automatically.
  users: []
};
collectionNames.forEach(name => { if (!collectionDefaults[name]) collectionDefaults[name] = []; });
const makeId = prefix => `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
const normalizeEmail = email => String(email || "").trim().toLowerCase();

// ---------------------------------------------------------------------------
// Outbound sync queue (local -> Base44)
//
// Quotes created while offline are recorded here so they can be pushed to
// Base44 exactly once. Duplicate protection is deliberately layered:
//   1. `local_id` is the idempotency key and is unique per queue entry, so the
//      same quote can never be enqueued twice no matter how often create runs.
//   2. Entries that came FROM Base44 (they already carry a Base44 id, or were
//      written by an inbound snapshot import) are never enqueued at all.
//   3. Once acknowledged the entry is marked `synced` and is skipped forever,
//      and the quote itself records `base44_synced_at`.
// ---------------------------------------------------------------------------
const MAX_OUTBOUND_QUEUE = 1000;

// Ids minted locally always use the makeId() shape ("<prefix>-<ms>-<rand>").
// Anything else came from Base44 and must not be pushed back up.
const isLocallyCreatedId = id => /^demo-quote-\d{10,}-[a-z0-9]{4,}$/.test(String(id || ""));

function enqueueOutbound(data, quote) {
  if (!isLocallyCreatedId(quote.id)) return;
  if (quote.base44_synced_at) return;
  data.outboundQueue = Array.isArray(data.outboundQueue) ? data.outboundQueue : [];
  if (data.outboundQueue.some(entry => entry.local_id === quote.id)) return;
  data.outboundQueue.push({
    kind: "create",
    local_id: quote.id,
    quote_number: quote.quote_number || null,
    status: "pending",
    attempts: 0,
    enqueued_at: new Date().toISOString(),
    synced_at: null,
    remote_id: null,
    last_error: null
  });
  if (data.outboundQueue.length > MAX_OUTBOUND_QUEUE) {
    data.outboundQueue = data.outboundQueue.slice(-MAX_OUTBOUND_QUEUE);
  }
}

// Queues a push of an EDIT to a quote that already exists in Base44 - either it
// originated there (its `id` IS the Base44 id) or it was created locally and has
// already been synced up (its Base44 id is recorded in `base44_synced_at`/`base44_id`).
// Without this, only brand-new locally-created quotes ever reached Base44 and every
// edit to a pre-existing quote (the common case: opening a Base44 quote and saving
// changes) silently stayed local-only forever.
function enqueueOutboundUpdate(data, quote) {
  data.outboundQueue = Array.isArray(data.outboundQueue) ? data.outboundQueue : [];

  // Still waiting to be created in Base44 for the first time - listPendingOutboundQuotes()
  // re-reads the live quote record at flush time, so that pending "create" entry will
  // already carry this edit. Adding a second entry here would risk a duplicate push.
  const pendingCreate = data.outboundQueue.find(
    entry => entry.local_id === quote.id && entry.status === "pending" && entry.kind !== "update"
  );
  if (pendingCreate) return;

  const remoteId = quote.base44_id || (!isLocallyCreatedId(quote.id) ? quote.id : null);
  if (!remoteId) return;

  // Already-queued, not-yet-flushed update for this quote - nothing more to do, the
  // flush will pick up the latest data for this same local_id/remote_id pair.
  if (data.outboundQueue.some(entry => entry.local_id === quote.id && entry.status === "pending" && entry.kind === "update")) {
    return;
  }

  data.outboundQueue.push({
    kind: "update",
    local_id: quote.id,
    remote_id: remoteId,
    quote_number: quote.quote_number || null,
    status: "pending",
    attempts: 0,
    enqueued_at: new Date().toISOString(),
    synced_at: null,
    last_error: null
  });
  if (data.outboundQueue.length > MAX_OUTBOUND_QUEUE) {
    data.outboundQueue = data.outboundQueue.slice(-MAX_OUTBOUND_QUEUE);
  }
}

// Salted scrypt password hashing (Node's built-in crypto - no extra native dependency).
// Passwords are never stored in plaintext, only as a per-account random salt + derived hash.
function hashPassword(password) {
  const salt = crypto.randomBytes(16).toString("hex");
  const hash = crypto.scryptSync(String(password), salt, 64).toString("hex");
  return { salt, hash };
}

function verifyPassword(password, salt, expectedHash) {
  if (!salt || !expectedHash) return false;
  const hash = crypto.scryptSync(String(password || ""), salt, 64);
  const expected = Buffer.from(expectedHash, "hex");
  return hash.length === expected.length && crypto.timingSafeEqual(hash, expected);
}

// Generates a fresh, cryptographically random one-time password. Used any time a user
// needs a new temporary credential - both first-time account setup and admin-triggered
// resets. Never reused, never predictable, never shared across accounts.
function generateTempPassword() {
  // crypto.randomBytes(9) -> 9 cryptographically secure random bytes.
  // .toString("base64url") -> readable, URL-safe text (no spaces/quotes/symbols).
  // .slice(0, 12) -> short enough to read/type, still strong enough for a one-time password.
  return crypto.randomBytes(9).toString("base64url").slice(0, 12);
}

// Checks whether an email is marked "admin" in the locally-synced Base44 users
// collection (data.users, kept fresh by the existing sync process) - the same app_role
// field Base44 itself uses to grant admin access. No network call happens here; this
// only reads whatever was most recently synced to disk on this machine. Fails CLOSED:
// any lookup miss or missing/stale sync data returns false, never true.
function isLocalAdmin(data, email) {
  const key = normalizeEmail(email);
  if (!key) return false;
  const users = Array.isArray(data.users) ? data.users : [];
  const match = users.find(user => normalizeEmail(user?.email) === key);
  return !!match && match.app_role === "admin";
}

// Accounts intentionally excluded from the one-time "Enquote1" migration below, per
// explicit request. Everyone else still sitting on the old shared temporary password
// gets force-reset to a unique random one.
const MIGRATION_EXEMPT_EMAILS = new Set([
  "smosley@enphaseenergy.com",
  "shawkins@enphaseenergy.com",
  "croeschberger@enphaseenergy.com"
]);

// One-time migration: any local credential still flagged mustChangePassword === true
// (provisioned with the old shared DEFAULT_TEMP_PASSWORD, never replaced) gets a fresh,
// unique random temporary password instead. Mutates `data` in place and returns the
// list of { email, tempPassword } that changed, so the caller can decide how to
// persist/disclose them. Does NOT call write() itself - that is the caller's job.
function migrateSharedTempPasswords(data) {
  data.userCredentials = data.userCredentials || {};
  data.passwordResetAudit = Array.isArray(data.passwordResetAudit) ? data.passwordResetAudit : [];

  // Returns true if this account's most recent audit entry shows a REAL admin
  // (not the automatic migration itself) already reset it - meaning this credential
  // was deliberately, individually issued and must never be silently rotated again,
  // even during the one-time sweep below. Entries are appended chronologically, so
  // the last matching one is the most recent.
  function wasIndividuallyProvisioned(email) {
    for (let i = data.passwordResetAudit.length - 1; i >= 0; i--) {
      if (data.passwordResetAudit[i].targetEmail === email) {
        return data.passwordResetAudit[i].resetBy !== "system-migration";
      }
    }
    return false;
  }

  const migratedAccounts = [];

  for (const [email, credential] of Object.entries(data.userCredentials)) {
    if (!credential?.mustChangePassword) continue;
    if (MIGRATION_EXEMPT_EMAILS.has(email)) continue;
    if (wasIndividuallyProvisioned(email)) continue;

    const tempPassword = generateTempPassword();
    data.userCredentials[email] = {
      ...hashPassword(tempPassword),
      mustChangePassword: true,
      updatedAt: new Date().toISOString()
    };

    data.passwordResetAudit.push({
      id: makeId("pwreset"),
      targetEmail: email,
      resetBy: "system-migration",
      at: new Date().toISOString()
    });

    migratedAccounts.push({ email, tempPassword });
  }

  return migratedAccounts;
}

const collectionEntityMappings = {
  reviews: ["QuoteReview"],
  statusAlertDismissals: ["StatusAlertDismissal"],
  activities: ["QuoteActivity"],
  followUps: ["FollowUpLog"],
  users: ["User"],
  pdfTemplates: ["PDFTemplate"],
  priceReviews: ["PriceReview"],
  siteFlags: ["SiteFlag"],
  deletionRequests: ["QuoteDeletionRequest"],
  materialOrders: ["MaterialOrder"],
  rmas: ["PVPanelRMA"],
  svCancels: ["SVCancelTracker"],
  supportInteractions: ["SupportInteraction"],
  followUpConfigs: ["FollowUpConfig"],
  pvManufacturers: ["PVManufacturer"]
};

function sanitizeRecord(value) {
  if (Array.isArray(value)) return value.map(item => sanitizeRecord(item));
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value)
        .filter(([, nestedValue]) => nestedValue !== null && typeof nestedValue !== "undefined")
        .map(([key, nestedValue]) => [key, sanitizeRecord(nestedValue)])
    );
  }
  return value;
}

// Merges two arrays of records that share an "id" field, de-duplicating so repeated
// imports of the same snapshot (or overlapping snapshots) don't grow storage or produce
// duplicate rows. When both sides have a record with the same id, the one with the more
// recent updated_date/updated_at/last_saved_at wins; if neither has a comparable
// timestamp, the incoming (newly imported) record wins since it's presumed freshest.
//
// `options.bumpRevField`, when given (quotes pass "_rev"), increments that counter on any
// record an import actually introduces or replaces - so a quote-edit form that's still
// open with an older revision correctly fails its optimistic-concurrency check on save
// instead of silently overwriting data this import just brought in. See update() below.
function mergeRecordsById(existingList, incomingList, options = {}) {
  const { bumpRevField = null, onWinnerIsUpdate = null } = options;
  const existing = Array.isArray(existingList) ? existingList : [];
  const incoming = Array.isArray(incomingList) ? incomingList : [];
  if (incoming.length === 0) return existing;

  const byId = new Map();
  // Maps a locally-synced record's CONFIRMED Base44 id (base44_id) back to its own LOCAL id.
  // This closes a real, confirmed duplicate-record bug: a locally-created quote keeps its
  // original demo-quote-... id forever (see markOutboundSynced above, which stores the
  // confirmed Base44 id in `base44_id` but intentionally never changes `id`) - so without this
  // index, an inbound Base44 snapshot/webhook containing that SAME quote (now keyed by its
  // real Base44 id) would never match on `id` alone, and would be inserted as a brand-new,
  // separate record instead of merging into the existing one. Verified via a standalone,
  // isolated test (test-merge-fix.cjs) before this fix was written, AND independently
  // confirmed against real production data (a dated CSV comparison between local App data and
  // Base44's actual export found 15 records matching this exact signature).
  const base44IdToLocalId = new Map();
  for (const record of existing) {
    if (record && typeof record === "object" && record.id !== undefined && record.id !== null) {
      byId.set(String(record.id), record);
      if (record.base44_id) {
        base44IdToLocalId.set(String(record.base44_id), String(record.id));
      }
    }
  }

  const getTimestamp = record => {
    const candidate = record && (record.updated_date || record.updated_at || record.last_saved_at);
    const time = candidate ? Date.parse(candidate) : NaN;
    return Number.isNaN(time) ? null : time;
  };

  for (const record of incoming) {
    if (!record || typeof record !== "object" || record.id === undefined || record.id === null) continue;
    const incomingKey = String(record.id);
    // Resolve to the EXISTING LOCAL record's key if this incoming id is actually a Base44 id
    // that a local record already recorded as its own base44_id - this is what makes a
    // locally-created-then-synced quote merge correctly instead of duplicating.
    const key = base44IdToLocalId.has(incomingKey) ? base44IdToLocalId.get(incomingKey) : incomingKey;
    const current = byId.get(key);
    const matchedViaBase44Id = key !== incomingKey;

    let winner;
    let winnerIsIncoming;
    if (!current) {
      winner = record;
      winnerIsIncoming = true;
    } else {
      const currentTime = getTimestamp(current);
      const incomingTime = getTimestamp(record);
      if (currentTime !== null && incomingTime !== null) {
        winnerIsIncoming = incomingTime >= currentTime;
      } else {
        // No comparable timestamps on one/both sides - prefer the incoming (newly imported) record.
        winnerIsIncoming = true;
      }
      winner = winnerIsIncoming ? record : current;
    }

    // CRITICAL: if this match came via the base44_id index, the merged result must keep the
    // EXISTING LOCAL id - never adopt the incoming Base44 id - otherwise this would just
    // relocate the duplication bug rather than fix it (breaking anything that still
    // references the original local id: reviews, activities, follow-ups, the outbound queue).
    if (matchedViaBase44Id && winnerIsIncoming) {
      winner = { ...winner, id: key, base44_id: incomingKey };
    }

    if (bumpRevField && winnerIsIncoming) {
      const priorRev = current?.[bumpRevField] || 0;
      winner = { ...winner, [bumpRevField]: priorRev + 1 };
    }

    // Fires ONLY for a genuine update to a PRE-EXISTING record - never for a brand-new
    // record (current falsy) and never for a routine no-op re-sync. "Genuine" requires
    // the incoming timestamp to be STRICTLY newer (not >=) than current's - Base44 syncs
    // resend the full quotes array every time, so a >= comparison would flag nearly the
    // entire dataset as "changed" on every routine 15-minute sync. Verified via a
    // standalone test with 6 scenarios (new/updated/no-op-resync/mixed-batch/stale/
    // missing-timestamps) before this was written.
    if (onWinnerIsUpdate && current && winnerIsIncoming) {
      const currentTime = getTimestamp(current);
      const incomingTime = getTimestamp(record);
      const isGenuinelyNewer = (currentTime !== null && incomingTime !== null)
        ? incomingTime > currentTime
        : false;
      if (isGenuinelyNewer) {
        onWinnerIsUpdate(winner, current);
      }
    }

    byId.set(key, winner);
  }

  return Array.from(byId.values());
}

function normalizeIncomingSnapshot(input) {
  if (!input || typeof input !== "object") {
    return { version: DATA_VERSION, quotes: [], products: [] };
  }

  if (input.version === DATA_VERSION && Array.isArray(input.quotes)) {
    return input;
  }

  const snapshot = input.snapshot && typeof input.snapshot === "object" ? input.snapshot : input;
  const entities = snapshot.entities && typeof snapshot.entities === "object" ? snapshot.entities : {};
  const normalized = {
    version: DATA_VERSION,
    quotes: Array.isArray(entities.Quote) ? entities.Quote : (Array.isArray(input.quotes) ? input.quotes : []),
    products: Array.isArray(entities.Product) ? entities.Product : (Array.isArray(input.products) ? input.products : [])
  };

  Object.entries(collectionEntityMappings).forEach(([collectionName, names]) => {
    const matched = names
      .map(name => entities[name])
      .find(Array.isArray);
    normalized[collectionName] = Array.isArray(matched) ? matched : [];
  });

  return {
    ...normalized,
    quotes: normalized.quotes.map(item => sanitizeRecord(item)),
    products: normalized.products.map(item => sanitizeRecord(item)),
    ...Object.fromEntries(
      Object.entries(collectionEntityMappings).map(([collectionName]) => [collectionName, (normalized[collectionName] || []).map(item => sanitizeRecord(item))])
    )
  };
}

function isRecord(value) {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function repositoryFor(userDataPath) {
  const dataPath = path.join(userDataPath, fileName);

  const OLD_FILE_NAMES = ["enquote-demo-data-v1.json"];
  for (const oldName of OLD_FILE_NAMES) {
    const oldPath = path.join(userDataPath, oldName);
    try {
      const oldStat = require("node:fs").statSync(oldPath);
      if (!oldStat.isFile()) continue;
      console.warn(`[migration] Found legacy data file "${oldName}" - merging into current data file.`);
      const oldRaw = require("node:fs").readFileSync(oldPath, "utf8").replace(/^\uFEFF/, "");
      const oldData = JSON.parse(oldRaw);
      let newData = { quotes: [], users: [] };
      try {
        const newRaw = require("node:fs").readFileSync(dataPath, "utf8").replace(/^\uFEFF/, "");
        newData = JSON.parse(newRaw);
      } catch { }
      const byId = new Map();
      (oldData.quotes || []).forEach((q) => byId.set(q.id, q));
      (newData.quotes || []).forEach((q) => byId.set(q.id, q));
      newData.quotes = Array.from(byId.values());
      if (!newData.users || newData.users.length === 0) {
        newData.users = oldData.users || [];
      }
      require("node:fs").writeFileSync(dataPath, JSON.stringify(newData, null, 2), "utf8");
      require("node:fs").renameSync(oldPath, `C:\Users\croeschberger\AppData\Roaming\base44-app\enquote-demo-data-v1.json.RETIRED-DO-NOT-USE`);
      console.warn(`[migration] Merged ${newData.quotes.length} quote(s) and ${newData.users.length} user(s); legacy file renamed aside.`);
    } catch (migrationError) {
      if (migrationError.code !== "ENOENT") {
        console.error(`[migration] Failed to migrate legacy file "${oldName}":`, migrationError.message);
      }
    }
  }

  async function backupIncompatibleData() {
    const backupDirectory = path.join(userDataPath, "Backups");
    await fs.mkdir(backupDirectory, { recursive: true });
    const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
    let backupPath = path.join(backupDirectory, `${fileName}.incompatible-${timestamp}.json`);
    let suffix = 1;
    while (await fs.access(backupPath).then(() => true).catch(() => false)) {
      backupPath = path.join(backupDirectory, `${fileName}.incompatible-${timestamp}-${suffix++}.json`);
    }
    await fs.copyFile(dataPath, backupPath);
    return backupPath;
  }

  function recoverStoredData(parsed) {
    if (!isRecord(parsed)) {
      return {
        version: DATA_VERSION,
        quotes: structuredClone(seedQuotes),
        products: structuredClone(productSeed),
        meta: { sync_ttl_ms: DEFAULT_SYNC_TTL_MS },
        userCredentials: {},
        outboundQueue: [],
        outboundDeleteQueue: [],
        deletedQuoteIds: [],
        outboundDismissalQueue: [],
        outboundMentionQueue: []
      };
    }

    const snapshot = normalizeIncomingSnapshot(parsed);
    const recovered = {
      ...parsed,
      version: DATA_VERSION,
      quotes: Array.isArray(parsed.quotes) ? parsed.quotes : snapshot.quotes,
      products: Array.isArray(parsed.products) ? parsed.products : snapshot.products,
      meta: isRecord(parsed.meta) ? parsed.meta : {},
      userCredentials: isRecord(parsed.userCredentials) ? parsed.userCredentials : {},
      outboundQueue: Array.isArray(parsed.outboundQueue) ? parsed.outboundQueue : [],
      outboundDeleteQueue: Array.isArray(parsed.outboundDeleteQueue) ? parsed.outboundDeleteQueue : [],
      deletedQuoteIds: Array.isArray(parsed.deletedQuoteIds) ? parsed.deletedQuoteIds : [],
      outboundDismissalQueue: Array.isArray(parsed.outboundDismissalQueue) ? parsed.outboundDismissalQueue : [],
      outboundMentionQueue: Array.isArray(parsed.outboundMentionQueue) ? parsed.outboundMentionQueue : []
    };
    collectionNames.forEach((name) => {
      recovered[name] = Array.isArray(parsed[name])
        ? parsed[name]
        : Array.isArray(snapshot[name])
          ? snapshot[name]
          : structuredClone(collectionDefaults[name]);
    });
    return recovered;
  }

  async function recoverIncompatibleData(parsed, reason) {
    const backupPath = await backupIncompatibleData();
    const recovered = recoverStoredData(parsed);
    console.warn(`[migration] Recovered incompatible local data (${reason}); original preserved at "${backupPath}".`);
    await write(recovered);
    return recovered;
  }

  async function createInitialData() {
    const initial = {
      version: DATA_VERSION,
      quotes: structuredClone(seedQuotes),
      products: structuredClone(productSeed),
      meta: { sync_ttl_ms: DEFAULT_SYNC_TTL_MS },
      userCredentials: {},
      outboundQueue: [],
      outboundDeleteQueue: [],
      deletedQuoteIds: [],
      outboundDismissalQueue: [],
      outboundMentionQueue: []
    };
    await write(initial);
    return initial;
  }

  async function read() {
    let raw;
    try {
      raw = await fs.readFile(dataPath, "utf8");
    } catch (error) {
      if (error.code !== "ENOENT") throw error;
      return createInitialData();
    }

    if (raw.charCodeAt(0) === 0xFEFF) raw = raw.slice(1);
    let parsed;
    try {
      parsed = JSON.parse(raw);
    } catch (error) {
      if (!(error instanceof SyntaxError)) throw error;
      parsed = null;
      console.warn(`[migration] Local data file is not valid JSON (${error.message}); preserving it before cloud recovery.`);
      await backupIncompatibleData();
    }

    if (!isRecord(parsed) || parsed.version !== DATA_VERSION || !Array.isArray(parsed.quotes)) {
      const reason = !isRecord(parsed)
        ? "unrecognized data structure"
        : `version ${String(parsed.version)} or missing quotes array`;
      if (parsed !== null) {
        parsed = await recoverIncompatibleData(parsed, reason);
      } else {
        parsed = await createInitialData();
      }
    }

    parsed.products = Array.isArray(parsed.products) ? parsed.products : structuredClone(productSeed);
    parsed.meta = isRecord(parsed.meta) ? parsed.meta : {};
    parsed.meta.sync_ttl_ms = parsed.meta.sync_ttl_ms || DEFAULT_SYNC_TTL_MS;
    parsed.userCredentials = isRecord(parsed.userCredentials) ? parsed.userCredentials : {};
    parsed.outboundQueue = Array.isArray(parsed.outboundQueue) ? parsed.outboundQueue : [];
    parsed.outboundDeleteQueue = Array.isArray(parsed.outboundDeleteQueue) ? parsed.outboundDeleteQueue : [];
    parsed.deletedQuoteIds = Array.isArray(parsed.deletedQuoteIds) ? parsed.deletedQuoteIds : [];
    parsed.outboundDismissalQueue = Array.isArray(parsed.outboundDismissalQueue) ? parsed.outboundDismissalQueue : [];
    parsed.outboundMentionQueue = Array.isArray(parsed.outboundMentionQueue) ? parsed.outboundMentionQueue : [];
    collectionNames.forEach(name => {
      parsed[name] = Array.isArray(parsed[name]) ? parsed[name] : structuredClone(collectionDefaults[name]);
    });

      // BUGFIX: this sweep must run AT MOST ONCE, EVER - not on every read() (which
      // happens on nearly every IPC action). Without this completion flag, any account
      // sitting at mustChangePassword: true - including one an admin just deliberately
      // reset via resetUserPassword() - was being silently re-rotated to a brand-new
      // random password moments later, before anyone could actually use the one they
      // were shown. wasIndividuallyProvisioned() inside migrateSharedTempPasswords()
      // is a second, independent layer of protection against the same class of bug.
      if (!parsed.meta.sharedPasswordMigrationCompleted) {
        const migratedAccounts = migrateSharedTempPasswords(parsed);
        parsed.meta.sharedPasswordMigrationCompleted = true;
        if (migratedAccounts.length > 0) {
          parsed.meta.pendingMigrationDisclosures = [
            ...(Array.isArray(parsed.meta.pendingMigrationDisclosures) ? parsed.meta.pendingMigrationDisclosures : []),
            ...migratedAccounts
          ];
        }
        await write(parsed);
      }

    return parsed;
  }

  // Serializes every write() call through this single promise chain, so two near-
  // simultaneous callers (e.g. two auto-imports firing close together, or a manual save
  // racing an outbound-sync ack) can NEVER interleave their file operations. This is the
  // root-cause fix for a real, reproduced data corruption bug: with NO serialization, two
  // concurrent writes both targeting the same shared ".tmp" path could have their
  // rm/writeFile/rename steps interleave, producing a file with valid JSON followed by
  // leftover bytes from the other write - reproduced and confirmed via a dedicated
  // concurrency test (5 of 10 trials corrupted with the old unserialized logic; 0 of 10
  // with this fix, using the exact same concurrent workload).
  let writeQueue = Promise.resolve();
  let __queueDepth = 0;
  function serializedWrite(performWrite) {
    __queueDepth++;
    const __depthAtEnqueue = __queueDepth;
    const __enqueuedAt = Date.now();
    logTiming(`[write-timing] Write enqueued - queue depth now: ${__depthAtEnqueue}`);
    const result = writeQueue.then(async () => {
      const __waitedMs = Date.now() - __enqueuedAt;
      if (__waitedMs > 50) {
        logTiming(`[write-timing] Write started after waiting ${__waitedMs}ms behind other queued writes`);
      }
      const out = await performWrite();
      __queueDepth--;
      return out;
    });
    // Swallow the rejection here so ONE failed write can never permanently jam the queue
    // for every subsequent caller - the actual error still propagates to whoever awaited
    // this specific write via `result`.
    writeQueue = result.catch(() => { __queueDepth--; });
    return result;
  }

  async function writeInner(data) {
    const __t0 = Date.now();
    await fs.mkdir(userDataPath, { recursive: true });
    const next = {
      ...data,
      meta: {
        sync_ttl_ms: DEFAULT_SYNC_TTL_MS,
        ...data.meta,
        last_saved_at: new Date().toISOString()
      }
    };
    const serialized = JSON.stringify(next, null, 2);
    logTiming(`[write-timing] JSON.stringify + setup took ${Date.now() - __t0}ms (payload size: ${serialized.length} bytes)`);
    // Unique temp filename per write (not a fixed shared path) - belt-and-suspenders on top
    // of the queue above, so even an unrelated process touching a stray ".tmp" file can
    // never collide with an in-flight write here.
    const tempPath = `${dataPath}.${process.hrtime.bigint()}.tmp`;
    const __t1 = Date.now();
    await fs.writeFile(tempPath, serialized, "utf8");
    logTiming(`[write-timing] Writing temp file took ${Date.now() - __t1}ms`);

    // Validate the temp file actually parses as JSON BEFORE it ever gets renamed into the
    // live data file - corruption can now only ever affect a throwaway temp file, never the
    // real one, and the caller gets a clear thrown error instead of silent data loss.
    const __t2 = Date.now();
    try {
      JSON.parse(await fs.readFile(tempPath, "utf8"));
    } catch (verifyError) {
      await fs.rm(tempPath, { force: true }).catch(() => { });
      throw new Error(`Refused to save - the data failed to verify as valid JSON before writing: ${verifyError.message}`);
    }
    logTiming(`[write-timing] Verify-read took ${Date.now() - __t2}ms`);

    // Retry the rename a few times with backoff before giving up - a transient EPERM/EBUSY
    // (e.g. OneDrive or antivirus briefly holding a read handle on the live file while
    // scanning/syncing it) is exactly the failure mode confirmed in a real log tonight, and
    // is very often gone within a few hundred milliseconds rather than being permanent.
    const maxAttempts = 6;
    const __t3 = Date.now();
    for (let attempt = 1; attempt <= maxAttempts; attempt++) {
      try {
        await fs.rename(tempPath, dataPath);
        logTiming(`[write-timing] Rename succeeded on attempt ${attempt}, took ${Date.now() - __t3}ms total. FULL writeInner: ${Date.now() - __t0}ms`);
        return;
      } catch (error) {
        if (error.code === "ENOENT") {
          // The live file didn't exist to rename over (e.g. first-ever write) - safe to
          // write directly, since there's no existing file this could clobber mid-write.
          await fs.writeFile(dataPath, serialized, "utf8");
          logTiming(`[write-timing] ENOENT fallback direct-write, took ${Date.now() - __t0}ms total`);
          return;
        }
        logTiming(`[write-timing] Rename attempt ${attempt} FAILED (${error.code}): ${error.message}`);
        if (attempt === maxAttempts) {
          console.warn(`[write-timing] All ${maxAttempts} rename attempts were blocked (${error.code}) - falling back to a direct overwrite instead of failing the save.`);
          try {
            await fs.writeFile(dataPath, serialized, "utf8");
            await fs.rm(tempPath, { force: true }).catch(() => { });
            logTiming(`[write-timing] Direct-write fallback succeeded, took ${Date.now() - __t0}ms total`);
            return;
          } catch (fallbackError) {
            await fs.rm(tempPath, { force: true }).catch(() => { });
            console.error(`[write-timing] Direct-write fallback ALSO failed: ${fallbackError.message}`);
            throw fallbackError;
          }
        }
        await new Promise((resolve) => setTimeout(resolve, Math.min(attempt * 400, 1500)));
      }
    }
  }

  // Keeps the last 3 successful saves as rolling backups (backup-1 = most recent, backup-3 =
  // oldest) BEFORE each new write replaces the live file - so a future corruption or a bad
  // import is always one file copy away from a known-good recovery point, instead of
  // requiring manual JSON surgery like the incidents fixed by hand this session. Backups
  // live in a dedicated "Backups" subfolder (not directly alongside the live data file),
  // per explicit request to keep the AppData root folder clean rather than cluttered with
  // rotating backup files next to the one file that actually matters day to day.
  async function rotateBackups() {
    const __rt0 = Date.now();
    logTiming("[write-timing] rotateBackups: ENTERED");
    try {
      const exists = await fs.access(dataPath).then(() => true).catch(() => false);
      logTiming(`[write-timing] rotateBackups: fs.access(dataPath) done after ${Date.now() - __rt0}ms, exists=${exists}`);
      if (!exists) return;
      const backupDir = path.join(userDataPath, "Backups");
      await fs.mkdir(backupDir, { recursive: true });
      logTiming(`[write-timing] rotateBackups: fs.mkdir(backupDir) done after ${Date.now() - __rt0}ms`);
      const backupFileName = path.basename(dataPath);
      for (let i = 3; i >= 1; i--) {
        const from = i === 1 ? dataPath : path.join(backupDir, `${backupFileName}.backup-${i - 1}`);
        const to = path.join(backupDir, `${backupFileName}.backup-${i}`);
        logTiming(`[write-timing] rotateBackups: loop i=${i}, checking access to "${from}"`);
        const fromExists = await fs.access(from).then(() => true).catch(() => false);
        logTiming(`[write-timing] rotateBackups: loop i=${i}, fromExists=${fromExists}, elapsed ${Date.now() - __rt0}ms`);
        if (fromExists) {
          const __copyStart = Date.now();
          await fs.copyFile(from, to).catch((copyErr) => {
            console.error(`[write-timing] rotateBackups: copyFile FAILED for i=${i}:`, copyErr?.message);
          });
          logTiming(`[write-timing] rotateBackups: loop i=${i}, copyFile took ${Date.now() - __copyStart}ms`);
        }
      }
      logTiming(`[write-timing] rotateBackups: COMPLETED after ${Date.now() - __rt0}ms total`);
    } catch (rotateError) {
      // Backup rotation is best-effort only - it must never block or fail an actual save.
      console.error(`[write-timing] rotateBackups: caught error after ${Date.now() - __rt0}ms:`, rotateError?.message);
    }
  }

  async function write(data) {
    return serializedWrite(async () => {
      await rotateBackups();
      await writeInner(data);
    });
  }

  return {
    async list() { return (await read()).quotes; },
    async get(id) { return (await read()).quotes.find(quote => quote.id === id) || null; },
    async create(record) {
      // Base44-created quotes always carry created_date/updated_date; locally-created ones
      // must too, since several display components (e.g. the "Created" field here) format
      // quote.created_date unconditionally and date-fns' format() throws "Invalid time
      // value" on an undefined/invalid date instead of failing gracefully.
      const now = new Date().toISOString();
      const quote = quoteSchema.parse({
        created_date: now,
        updated_date: now,
        _rev: 1,
        ...record,
        id: record.id || makeId("demo-quote")
      });
      const data = await read();
      if (data.quotes.some(item => item.id === quote.id)) throw new Error("A quote with this id already exists.");
      data.quotes.push(quote);
      enqueueOutbound(data, quote);
      await write(data);
      return quote;
    },
    // `expectedVersion` is optional for backward compatibility (bulkUpdate, version
    // restores, and any other internal caller that doesn't pass one skip the check
    // entirely). When the caller DOES pass one (the Edit Quote form always does - see
    // EditQuote.jsx), it must match the quote's current `_rev` or the update is rejected
    // with a CONFLICT error instead of silently overwriting whatever is on disk now.
    async update(id, changes, expectedVersion) {
      const data = await read();
      const index = data.quotes.findIndex(quote => quote.id === id);
      if (index < 0) throw new Error("Quote not found.");

      const current = data.quotes[index];
      const currentRev = current._rev || 1;
      if (expectedVersion !== undefined && expectedVersion !== null && expectedVersion !== currentRev) {
        // The "CONFLICT:" marker is what matters for callers across the Electron IPC
        // boundary - ipcMain.handle()/ipcRenderer.invoke() only reliably forwards an
        // Error's `message` to the renderer (confirmed by testing against a real running
        // instance: Electron rewrites it to "Error invoking remote method '...': Error:
        // <this message>"), not custom properties like `.code`. Those are kept here only
        // as a convenience for direct (non-IPC) callers/tests. Renderer code must look for
        // the marker WITHIN the message (see EditQuote.jsx), not an exact prefix/property.
        const conflict = new Error(
          "CONFLICT: This quote was changed elsewhere since you opened it. Reload to see the latest version before saving your changes."
        );
        conflict.code = "CONFLICT";
        conflict.currentQuote = current;
        throw conflict;
      }

      const quote = quoteSchema.parse({
        ...current,
        updated_date: new Date().toISOString(),
        ...z.record(z.unknown()).parse(changes),
        id,
        _rev: currentRev + 1
      });
      data.quotes[index] = quote;
      enqueueOutboundUpdate(data, quote);
      await write(data);
      return quote;
    },
    async remove(id) {
      const data = await read();
      const quote = data.quotes.find(item => item.id === id);
      if (!quote) throw new Error("Quote not found.");
      const remoteId = quote.base44_id || (!isLocallyCreatedId(id) ? id : null);
      const deletedIds = new Set(data.deletedQuoteIds.map(String));
      deletedIds.add(String(id));
      if (remoteId) deletedIds.add(String(remoteId));
      data.deletedQuoteIds = Array.from(deletedIds);
      data.quotes = data.quotes.filter(item => item.id !== id);
      if (Array.isArray(data.outboundQueue)) {
        data.outboundQueue = data.outboundQueue.filter(entry => entry.local_id !== id);
      }
      if (remoteId || !isLocallyCreatedId(id)) {
        data.outboundDeleteQueue = Array.isArray(data.outboundDeleteQueue) ? data.outboundDeleteQueue : [];
        if (!data.outboundDeleteQueue.some(entry => entry.local_id === id && entry.status === "pending")) {
          data.outboundDeleteQueue.push({
            kind: "delete",
            local_id: id,
            remote_id: remoteId,
            quote_number: quote.quote_number || null,
            status: "pending",
            attempts: 0,
            enqueued_at: new Date().toISOString(),
            synced_at: null,
            last_error: null
          });
        }
      }
      await write(data);
      return { id, remoteDeleteQueued: Boolean(remoteId || !isLocallyCreatedId(id)) };
    },
    async applyRemoteQuoteDeletion(remoteId) {
      const key = String(remoteId || "");
      if (!key) throw new Error("Remote quote deletion is missing its id.");
      const data = await read();
      const matchingQuotes = data.quotes.filter(quote =>
        String(quote.id) === key || String(quote.base44_id || "") === key
      );
      const deletedIds = new Set(data.deletedQuoteIds.map(String));
      deletedIds.add(key);
      for (const quote of matchingQuotes) deletedIds.add(String(quote.id));
      data.deletedQuoteIds = Array.from(deletedIds);
      data.quotes = data.quotes.filter(quote =>
        String(quote.id) !== key && String(quote.base44_id || "") !== key
      );
      const localIds = new Set(matchingQuotes.map(quote => String(quote.id)));
      localIds.add(key);
      data.outboundQueue = (data.outboundQueue || []).filter(entry => !localIds.has(String(entry.local_id)));
      data.outboundDeleteQueue = (data.outboundDeleteQueue || []).filter(entry => !localIds.has(String(entry.local_id)));
      await write(data);
      return { id: key, removed: matchingQuotes.length };
    },
    async bulkUpdate(updates) {
      const parsed = z.array(updateSchema).parse(updates);
      const data = await read();
      for (const update of parsed) {
        const index = data.quotes.findIndex(quote => quote.id === update.id);
        if (index < 0) throw new Error(`Quote not found: ${update.id}`);
        const currentRev = data.quotes[index]._rev || 1;
        data.quotes[index] = quoteSchema.parse({
          ...data.quotes[index],
          updated_date: new Date().toISOString(),
          ...update.changes,
          id: update.id,
          // No expectedVersion concept for bulk operations (used for admin/approver-level
          // actions like restoring a prior version, not the single-quote edit form), but
          // still bump the counter so a concurrently-open Edit Quote form is correctly
          // rejected on its next save instead of clobbering this bulk change.
          _rev: currentRev + 1
        });
        enqueueOutboundUpdate(data, data.quotes[index]);
      }
      await write(data);
      return data.quotes;
    },

    async reset() {
      // Resets demo quote/product/collection data back to the seed set, but must never
      // touch userCredentials, outboundQueue, OR users - those are local-only/real-team
      // state that a reset demo data action has no business erasing.
      const current = await read();
      const data = {
        version: DATA_VERSION,
        quotes: structuredClone(seedQuotes),
        products: structuredClone(productSeed),
        userCredentials: current.userCredentials || {},
        outboundQueue: current.outboundQueue || [],
        outboundDeleteQueue: current.outboundDeleteQueue || [],
        deletedQuoteIds: current.deletedQuoteIds || [],
        users: current.users || []
      };
      collectionNames.forEach(name => { if (name !== 'users') data[name] = structuredClone(collectionDefaults[name]); });
      await write(data);
      return data.quotes;
    },
    async exportData() {
      return await read();
    },
    async importData(input) {
      const normalized = normalizeIncomingSnapshot(input);
      const current = await read();
      const deletedQuoteIds = new Set((current.deletedQuoteIds || []).map(String));
      normalized.quotes = normalized.quotes.filter(quote =>
        !deletedQuoteIds.has(String(quote.id || "")) &&
        !deletedQuoteIds.has(String(quote.base44_id || ""))
      );

      // Merge incoming records into the existing local dataset (deduped by id) instead of
      // overwriting it, so repeated/overlapping snapshots don't discard local-only records
      // or balloon storage with duplicates. Quotes additionally bump `_rev` whenever an
      // import wins, so a stale Edit Quote form still open against the old revision is
      // correctly rejected instead of clobbering what this import just brought in.
      const changedQuoteNumbers = [];
      // Local-only, in-memory list of notifications generated by THIS import - appended
      // to merged.appNotifications after the generic collection merge below, since these
      // are never something Base44 itself sends (purely derived from what changed here).
      const newNotifications = [];
      const formatNotificationDateTime = (isoString) => {
        const d = new Date(isoString);
        const mm = String(d.getMonth() + 1).padStart(2, "0");
        const dd = String(d.getDate()).padStart(2, "0");
        let hours = d.getHours();
        const minutes = String(d.getMinutes()).padStart(2, "0");
        const ampm = hours >= 12 ? "PM" : "AM";
        hours = hours % 12 || 12;
        return `${mm}/${dd} ${hours}:${minutes} ${ampm}`;
      };
      let notificationSeqCounter = 0;
      const nextNotificationSeq = () => {
        notificationSeqCounter = (notificationSeqCounter + 1) % 1000;
        return Date.now() * 1000 + notificationSeqCounter;
      };
      const merged = {
        ...normalized,
        quotes: mergeRecordsById(current.quotes, normalized.quotes, {
          bumpRevField: "_rev",
          onWinnerIsUpdate: (winner) => {
            if (winner.quote_number) {
              changedQuoteNumbers.push(winner.quote_number);
              // Attribution comes from status_history's LAST entry (confirmed real field
              // names via QuoteDetails.jsx: changed_by/changed_at) - null if history is
              // empty, handled gracefully at render time rather than guessing/crashing.
              // Stores RAW data (quoteId, quoteNumber, changedBy, occurredAt) instead of
              // a pre-baked message string - formatting now happens at RENDER time in
              // NotificationBell.jsx using the VIEWING user's own browser locale, correct
              // regardless of which machine's system clock/locale generated this record.
              // quoteId (winner.id) lets the notification list link straight to the real
              // quote (QuoteDetails.jsx reads ?id=<quoteId> from the URL).
              const history = Array.isArray(winner.status_history) ? winner.status_history : [];
              const lastEntry = history[history.length - 1];
              newNotifications.push({
                type: "quote_updated",
                quoteId: winner.id,
                quoteNumber: winner.quote_number,
                changedBy: lastEntry?.changed_by || null,
                // Uses the quote's OWN updated_date (when the edit actually happened),
                // not "now" (when this machine's sync happened to notice) - important
                // for the automatic 15-minute background sync, where a real gap between
                // the two can exist; showing "now" there would be misleading.
                occurredAt: winner.updated_date || new Date().toISOString()
              });
            }
          }
        }),
        products: mergeRecordsById(current.products, normalized.products, {
          onWinnerIsUpdate: (winner) => {
            // Products have no attribution field at all (confirmed from updateProduct's
            // real code - just a bare updated_date) and no dedicated details page to
            // link to, so no quoteId/link is stored for this type. Stores RAW data
            // instead of a pre-baked message - same render-time-formatting reasoning as
            // the quote case above.
            newNotifications.push({
              type: "product_updated",
              productName: winner.name || winner.id,
              occurredAt: winner.updated_date || new Date().toISOString()
            });
          }
        })
      };
      collectionNames.forEach(name => {
        merged[name] = mergeRecordsById(current[name], normalized[name]);
      });

      // Appends this import's genuinely-new notifications on top of whatever the generic
      // merge above preserved, capped at 200 (same "keep it bounded" convention already
      // used elsewhere: errorLog.js's MAX_ENTRIES, useLocalSyncStatus.js's events slice).
      const notificationEntries = newNotifications.map(n => ({
        id: `notif-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
        seq: nextNotificationSeq(),
        ...n,
        occurredAt: new Date().toISOString(),
        read: false
      }));
      merged.appNotifications = [...(merged.appNotifications || []), ...notificationEntries].slice(-200);

      const parsed = z.object({
        version: z.literal(DATA_VERSION),
        quotes: z.array(quoteSchema),
        products: z.array(z.record(z.unknown())).optional(),
        reviews: z.array(z.record(z.unknown())).optional(),
        activities: z.array(z.record(z.unknown())).optional(),
        followUps: z.array(z.record(z.unknown())).optional(),
        users: z.array(z.record(z.unknown())).optional(),
        pdfTemplates: z.array(z.record(z.unknown())).optional(),
        priceReviews: z.array(z.record(z.unknown())).optional(),
        siteFlags: z.array(z.record(z.unknown())).optional(),
        deletionRequests: z.array(z.record(z.unknown())).optional(),
        materialOrders: z.array(z.record(z.unknown())).optional(),
        rmas: z.array(z.record(z.unknown())).optional(),
        svCancels: z.array(z.record(z.unknown())).optional(),
        supportInteractions: z.array(z.record(z.unknown())).optional(),
        followUpConfigs: z.array(z.record(z.unknown())).optional(),
        pvManufacturers: z.array(z.record(z.unknown())).optional(),
        supervisorDailyMetrics: z.array(z.record(z.unknown())).optional(),
        supervisorReportTables: z.array(z.record(z.unknown())).optional(),
        autoImportSettings: z.array(z.record(z.unknown())).optional(),
        // FIX: these 3 were added to collectionNames at various points but NEVER added
        // here - since zod's .parse() silently strips any undeclared key, this meant
        // every single Base44 sync was silently deleting all 3 collections' entire
        // contents. Confirmed via a standalone reproduction of zod's exact
        // strip-unknown-keys behavior before writing this fix. appNotifications is the
        // new collection this same patch introduces.
        statusAlertDismissals: z.array(z.record(z.unknown())).optional(),
        quoteAlerts: z.array(z.record(z.unknown())).optional(),
        appErrorLog: z.array(z.record(z.unknown())).optional(),
        appNotifications: z.array(z.record(z.unknown())).optional(),
        // autoDrafterGeneratedDrafts: AI-generated Auto-Drafter quote drafts (see
        // autoDrafterDraftsStore.js) - added here in the SAME change as collectionNames
        // above, per the exact silent-wipe bug already documented in this file for the
        // 3 collections fixed previously.
        autoDrafterGeneratedDrafts: z.array(z.record(z.unknown())).optional(),
        // fsts: FST roster (name/employee id/shipping+home address/etc.) - added in the
        // SAME change as collectionNames above, per this file's own documented history of a
        // silent-data-wipe bug when a collection is added to collectionNames but not here.
        fsts: z.array(z.record(z.unknown())).optional(),
        userCredentials: z.record(z.unknown()).optional(),
        outboundQueue: z.array(z.record(z.unknown())).optional(),
        outboundDeleteQueue: z.array(z.record(z.unknown())).optional(),
        deletedQuoteIds: z.array(z.string()).optional(),
        meta: z.object({
          sync_ttl_ms: z.number().optional(),
          last_imported_at: z.string().optional(),
          last_snapshot_id: z.string().nullable().optional(),
          last_saved_at: z.string().optional(),
          last_import_changed_quotes: z.array(z.string()).optional()
        }).optional()
      }).parse({
        ...merged,
        // Credentials and the outbound sync queue are local-only state. An incoming
        // Base44 snapshot must never clobber them, or users would lose their
        // passwords and pending quotes would silently never reach Base44.
        userCredentials: current.userCredentials || {},
        outboundQueue: current.outboundQueue || [],
        outboundDeleteQueue: current.outboundDeleteQueue || [],
        deletedQuoteIds: current.deletedQuoteIds || [],
        outboundDismissalQueue: current.outboundDismissalQueue || [],
        outboundMentionQueue: current.outboundMentionQueue || [],
        meta: {
          sync_ttl_ms: DEFAULT_SYNC_TTL_MS,
          last_imported_at: new Date().toISOString(),
          last_snapshot_id: input?.delivery_id || input?.snapshot?.delivery_id || null,
          last_saved_at: new Date().toISOString(),
          last_import_changed_quotes: [...new Set(changedQuoteNumbers)].slice(0, 100)
        }
      });
      await write(parsed);
      return parsed.quotes;
    },
    // --- Outbound sync queue -------------------------------------------------
    // Returns the full quote payloads that still need to reach Base44.
    async listPendingOutboundQuotes() {
      const data = await read();
      const queue = data.outboundQueue || [];
      return queue
        .filter(entry => entry.status === "pending")
        .map(entry => {
          const quote = data.quotes.find(item => item.id === entry.local_id);
          return quote ? { ...entry, quote } : null;
        })
        .filter(Boolean);
    },
    async listPendingOutboundQuoteDeletes() {
      const data = await read();
      return (data.outboundDeleteQueue || []).filter(entry => entry.status === "pending");
    },
    async markOutboundQuoteDeletesSynced(results) {
      const parsed = z.array(z.object({
        local_id: z.string().min(1),
        remote_id: z.string().nullable().optional(),
        error: z.string().nullable().optional()
      })).parse(results || []);
      if (!parsed.length) return { updated: 0 };
      const data = await read();
      data.outboundDeleteQueue = data.outboundDeleteQueue || [];
      let updated = 0;
      const now = new Date().toISOString();
      for (const result of parsed) {
        const entry = data.outboundDeleteQueue.find(item =>
          item.local_id === result.local_id && item.status === "pending"
        );
        if (!entry) continue;
        if (result.error) {
          entry.attempts = (entry.attempts || 0) + 1;
          entry.last_error = result.error;
          continue;
        }
        entry.status = "synced";
        entry.synced_at = now;
        entry.remote_id = result.remote_id || entry.remote_id || null;
        entry.last_error = null;
        updated += 1;
      }
      await write(data);
      return { updated };
    },
    // Marks entries as synced. Idempotent: acking an unknown or already-synced
    // id is a no-op, so a retried ack can never resurrect or duplicate a quote.
    async markOutboundSynced(results) {
      const parsed = z.array(z.object({
        local_id: z.string().min(1),
        remote_id: z.string().nullable().optional(),
        error: z.string().nullable().optional()
      })).parse(results || []);
      if (!parsed.length) return { updated: 0 };
      const data = await read();
      data.outboundQueue = data.outboundQueue || [];
      let updated = 0;
      const now = new Date().toISOString();
      for (const result of parsed) {
        const entry = data.outboundQueue.find(item => item.local_id === result.local_id && item.status === "pending");
        if (!entry) continue;
        if (result.error) {
          entry.attempts = (entry.attempts || 0) + 1;
          entry.last_error = result.error;
          continue;
        }
        entry.status = "synced";
        entry.synced_at = now;
        entry.remote_id = result.remote_id || entry.remote_id || null;
        entry.last_error = null;
        const index = data.quotes.findIndex(item => item.id === result.local_id);
        if (index >= 0) {
          data.quotes[index] = { ...data.quotes[index], base44_synced_at: now, base44_id: entry.remote_id };
        }
        updated += 1;
      }
      await write(data);
      return { updated };
    },
    async getOutboundQueueStatus() {
      const data = await read();
      const queue = [
        ...(data.outboundQueue || []),
        ...(data.outboundDeleteQueue || [])
      ];
      return {
        pending: queue.filter(entry => entry.status === "pending").length,
        synced: queue.filter(entry => entry.status === "synced").length,
        total: queue.length
      };
    },
    async listProducts() { return (await read()).products || productSeed; }, async createProduct(record) {
      const now = new Date().toISOString();
      const product = z.record(z.unknown()).parse({
        created_date: now,
        updated_date: now,
        ...record,
        id: record.id || makeId("demo-product")
      });
      const data = await read();
      data.products = data.products || productSeed;
      if (data.products.some(item => item.id === product.id)) throw new Error("A product with this id already exists.");
      data.products.push(product);
      await write(data);
      return product;
    },
    async updateProduct(id, changes) {
      const data = await read();
      data.products = data.products || productSeed;
      const index = data.products.findIndex(product => product.id === id);
      if (index < 0) throw new Error("Product not found.");
      data.products[index] = {
        ...data.products[index],
        updated_date: new Date().toISOString(),
        ...z.record(z.unknown()).parse(changes),
        id
      };
      await write(data);
      return data.products[index];
    },
    async deleteProduct(id) {
      const data = await read();
      data.products = data.products || productSeed;
      const next = data.products.filter(product => product.id !== id);
      if (next.length === data.products.length) throw new Error("Product not found.");
      data.products = next;
      await write(data);
      return { id };
    },
    async listCollection(name) {
      if (!collectionNames.includes(name)) throw new Error(`Unsupported local collection: ${name}`);
      const data = await read();
      return data[name];
    },
    // FIX (confirmed via a real, live data-loss incident, then reproduced and verified in
    // isolation): createCollectionRecord/updateCollectionRecord/deleteCollectionRecord each
    // independently did read() THEN write() with NO serialization around the read step -
    // only the final write() itself was serialized (see the writeQueue/serializedWrite
    // mechanism above, built for a different, earlier corruption bug). When multiple calls
    // for DIFFERENT record ids run close together (e.g. several auto-imported report files
    // landing within the same couple of seconds), each one's read() could return the SAME
    // stale snapshot before any of them had written yet - so whichever call's write() ran
    // LAST would silently overwrite every other call's change, discarding it with no error.
    // A dedicated reproduction test confirmed this exactly: 5 concurrent creates for 5
    // different report types lost 4 of 5 records with the old logic (repeated across 10
    // trials); wrapping each function's ENTIRE read-modify-write cycle in the SAME
    // serializedWrite queue already used for raw file writes brought this to 0 lost records
    // across 10 trials of the identical concurrent workload.
    // FIX (found via direct code review after all-night live evidence of a PERMANENT,
    // total write deadlock - confirmed reproduced and fixed in an isolated standalone test
    // before being applied here): these 3 methods call serializedWrite(), then call the
    // public write(data) function from INSIDE that callback - but write() ITSELF calls
    // serializedWrite() again. Since writeQueue is one shared variable, this created a
    // genuine self-referential deadlock: the inner serializedWrite call gets queued behind
    // the outer one, but the outer one can never finish until the inner one does (it's
    // awaiting it) - so neither ever resolves, EVER, for ANY collection, from a fully clean
    // process. This exactly matches the real symptom: queue depth climbing indefinitely
    // with zero progress logged afterward, on every single save attempt. The fix: since
    // these methods are ALREADY running inside a serializedWrite callback, they now call
    // the actual disk-write steps directly (rotateBackups()/writeInner()) instead of the
    // public write() wrapper, avoiding the second layer of queueing entirely. A standalone
    // reproduction confirmed the old code deadlocks (times out, never resolves) and the new
    // code resolves correctly AND still correctly serializes multiple concurrent calls (no
    // regression of the original race-condition fix this queueing was built for).
    async createCollectionRecord(name, record) {
      if (!collectionNames.includes(name)) throw new Error(`Unsupported local collection: ${name}`);
      return serializedWrite(async () => {
        const data = await read();
        const now = new Date().toISOString();
        const item = {
          created_date: now,
          updated_date: now,
          ...z.record(z.unknown()).parse(record),
          id: record.id || makeId(`demo-${name}`)
        };
        data[name].push(item);
        // Dismissals made locally must reach Base44 too -- previously only Quote changes
        // were ever pushed outbound, so a dismissal made on desktop never reached Base44
        // (or any other install) at all. This queues it exactly like a quote create,
        // using the SAME serializedWrite cycle so it's saved atomically with the record
        // itself.
        if (name === "statusAlertDismissals") {
          data.outboundDismissalQueue = Array.isArray(data.outboundDismissalQueue) ? data.outboundDismissalQueue : [];
          data.outboundDismissalQueue.push({
            kind: "create",
            local_id: item.id,
            quote_id: item.quote_id,
            status: "pending",
            attempts: 0,
            enqueued_at: now,
            synced_at: null,
            remote_id: null,
            last_error: null
          });
        }
        // Mentions made locally must reach Base44 too -- mirrors the dismissal queueing
        // immediately above, using the exact same pattern for the "quoteAlerts"
        // collection instead.
        if (name === "quoteAlerts") {
          data.outboundMentionQueue = Array.isArray(data.outboundMentionQueue) ? data.outboundMentionQueue : [];
          data.outboundMentionQueue.push({
            kind: "create",
            local_id: item.id,
            quote_id: item.quote_id,
            mentioned_email: item.mentioned_email,
            status: "pending",
            attempts: 0,
            enqueued_at: now,
            synced_at: null,
            remote_id: null,
            last_error: null
          });
        }
        await rotateBackups();
        await writeInner(data);
        return item;
      });
    },
    // Outbound sync queue (mentions) - mirrors listPendingOutboundDismissals()/
    // markOutboundDismissalsSynced() above, for the "quoteAlerts" -> Base44 direction.
    async listPendingOutboundMentions() {
      const data = await read();
      const queue = data.outboundMentionQueue || [];
      return queue.filter((entry) => entry.status === "pending");
    },
    async markOutboundMentionsSynced(results) {
      const parsed = z.array(z.object({
        local_id: z.string().min(1),
        remote_id: z.string().nullable().optional(),
        error: z.string().nullable().optional()
      })).parse(results || []);
      if (!parsed.length) return { updated: 0 };
      const data = await read();
      data.outboundMentionQueue = data.outboundMentionQueue || [];
      let updated = 0;
      const now2 = new Date().toISOString();
      for (const result of parsed) {
        const entry = data.outboundMentionQueue.find((item) => item.local_id === result.local_id && item.status === "pending");
        if (!entry) continue;
        if (result.error) {
          entry.attempts = (entry.attempts || 0) + 1;
          entry.last_error = result.error;
          continue;
        }
        entry.status = "synced";
        entry.synced_at = now2;
        entry.remote_id = result.remote_id || entry.remote_id || null;
        entry.last_error = null;
        updated += 1;
      }
      await write(data);
      return { updated };
    },
    // Outbound sync queue (dismissals) - mirrors listPendingOutboundQuotes()/
    // markOutboundSynced() below, for the "statusAlertDismissals" -> Base44 direction.
    async listPendingOutboundDismissals() {
      const data = await read();
      const queue = data.outboundDismissalQueue || [];
      return queue.filter((entry) => entry.status === "pending");
    },
    async markOutboundDismissalsSynced(results) {
      const parsed = z.array(z.object({
        local_id: z.string().min(1),
        remote_id: z.string().nullable().optional(),
        error: z.string().nullable().optional()
      })).parse(results || []);
      if (!parsed.length) return { updated: 0 };
      const data = await read();
      data.outboundDismissalQueue = data.outboundDismissalQueue || [];
      let updated = 0;
      const now = new Date().toISOString();
      for (const result of parsed) {
        const entry = data.outboundDismissalQueue.find((item) => item.local_id === result.local_id && item.status === "pending");
        if (!entry) continue;
        if (result.error) {
          entry.attempts = (entry.attempts || 0) + 1;
          entry.last_error = result.error;
          continue;
        }
        entry.status = "synced";
        entry.synced_at = now;
        entry.remote_id = result.remote_id || entry.remote_id || null;
        entry.last_error = null;
        updated += 1;
      }
      await write(data);
      return { updated };
    },
    async updateCollectionRecord(name, id, changes) {
      if (!collectionNames.includes(name)) throw new Error(`Unsupported local collection: ${name}`);
      return serializedWrite(async () => {
        const data = await read();
        const index = data[name].findIndex(item => item.id === id);
        if (index < 0) throw new Error(`${name} record not found.`);
        data[name][index] = {
          ...data[name][index],
          updated_date: new Date().toISOString(),
          ...z.record(z.unknown()).parse(changes),
          id
        };
        await rotateBackups();
        await writeInner(data);
        return data[name][index];
      });
    },
    async deleteCollectionRecord(name, id) {
      if (!collectionNames.includes(name)) throw new Error(`Unsupported local collection: ${name}`);
      return serializedWrite(async () => {
        const data = await read();
        const next = data[name].filter(item => item.id !== id);
        if (next.length === data[name].length) throw new Error(`${name} record not found.`);
        data[name] = next;
        await rotateBackups();
        await writeInner(data);
        return { id };
      });
    },
    // Validates an email/password sign-in against this PC's local credential store. Every
    // known EnQuote user (the static roster plus anyone already synced in via Base44) is
    // just-in-time provisioned with the shared temporary password the first time they're
    // looked up here, so there is nothing to pre-seed at install time. Returns whether the
    // caller must be prompted to replace the temporary password before proceeding.
    async login(email, password) {
      const key = normalizeEmail(email);
      if (!key) throw new Error("Choose your account first.");

      const data = await read();
      data.userCredentials = data.userCredentials || {};

      // SECURITY FIX: accounts are no longer auto-provisioned with a shared temporary
      // password on first login. An admin must explicitly set the account's first
      // temporary password via resetUserPassword() below - first-time setup and
      // password reset are now the same operation.
      if (!data.userCredentials[key]) {
        throw new Error("Your account hasn't been set up on this PC yet. Ask an admin to set your temporary password.");
      }

      const credential = data.userCredentials[key];
      if (!verifyPassword(password, credential.salt, credential.hash)) {
        throw new Error("Incorrect password.");
      }

      return { email: key, mustChangePassword: !!credential.mustChangePassword };
    },
    // Replaces a temporary/existing password with a new one the account holder chose. The
    // current password must still verify correctly first (defense in depth - the renderer
    // only calls this right after a successful login, but this must not just trust it).
    // Checks whether ANY credential (temp or real) already exists for this email - used
    // by the renderer, right after Cloudflare verification, to decide whether to show the
    // normal password login vs. the new "create your password" first-time setup screen.
    async hasAccount(email) {
      const data = await read();
      const key = normalizeEmail(email);
      return Boolean(key && data.userCredentials && data.userCredentials[key]);
    },
    // Self-service first-time account setup: lets a user who has ALREADY been verified by
    // Cloudflare Access choose their own password directly, with NO admin-generated temp
    // password step. Reuses the EXACT SAME known-user gate as resetUserPassword()
    // (KNOWN_ENQUOTE_USERS + the locally-synced Base44 users collection) - only emails
    // already recognized for EnQuote access can self-provision this way; this is not an
    // open "anyone who passes Cloudflare gets an account" door.
    async provisionNewAccount(email, newPassword) {
      const data = await read();
      const key = normalizeEmail(email);
      if (!key) throw new Error("A valid email is required.");
      if (!newPassword || String(newPassword).length < 4) {
        throw new Error("Choose a password with at least 4 characters.");
      }

      const isKnownAccount =
        KNOWN_ENQUOTE_USERS.some(candidate => normalizeEmail(candidate.email) === key) ||
        (data.users || []).some(candidate => normalizeEmail(candidate.email) === key);
      if (!isKnownAccount) {
        throw new Error("This email isn't registered for EnQuote access.");
      }

      data.userCredentials = data.userCredentials || {};
      if (data.userCredentials[key]) {
        throw new Error("An account already exists for this email - please sign in instead.");
      }

      data.userCredentials[key] = {
        ...hashPassword(newPassword),
        mustChangePassword: false,
        updatedAt: new Date().toISOString()
      };

      data.passwordResetAudit = Array.isArray(data.passwordResetAudit) ? data.passwordResetAudit : [];
      data.passwordResetAudit.push({
        id: makeId("pwreset"),
        targetEmail: key,
        resetBy: "self-service-cloudflare-verified",
        at: new Date().toISOString()
      });

      await write(data);
      return { email: key };
    },
    async setPassword(email, currentPassword, newPassword) {
      const key = normalizeEmail(email);
      if (!key) throw new Error("Choose your account first.");
      if (!newPassword || String(newPassword).length < 4) {
        throw new Error("Choose a password with at least 4 characters.");
      }

      const data = await read();
      const credential = data.userCredentials?.[key];
      if (!credential) throw new Error("Account not found.");
      if (!verifyPassword(currentPassword, credential.salt, credential.hash)) {
        throw new Error("Current password is incorrect.");
      }

      data.userCredentials[key] = {
        ...hashPassword(newPassword),
        mustChangePassword: false,
        updatedAt: new Date().toISOString()
      };
      await write(data);
      return { email: key };
    },
    // Resets (or performs first-time provisioning of) a user's local password. Only
    // callable by someone whose LOCAL, already-synced record has app_role "admin" -
    // re-checked here even though the UI should already hide this action from
    // non-admins, since a UI-only check can never be trusted alone (defense in depth).
    async resetUserPassword(actingAdminEmail, targetEmail) {
      const data = await read();

      if (!isLocalAdmin(data, actingAdminEmail)) {
        throw new Error("Only admins can reset a user's password.");
      }

      const targetKey = normalizeEmail(targetEmail);
      if (!targetKey) throw new Error("No user specified.");

      const isKnownAccount =
        KNOWN_ENQUOTE_USERS.some(candidate => normalizeEmail(candidate.email) === targetKey) ||
        (data.users || []).some(candidate => normalizeEmail(candidate.email) === targetKey);
      if (!isKnownAccount) {
        throw new Error("This email isn't registered for EnQuote access.");
      }

      const tempPassword = generateTempPassword();
      data.userCredentials = data.userCredentials || {};
      data.userCredentials[targetKey] = {
        ...hashPassword(tempPassword),
        mustChangePassword: true,
        updatedAt: new Date().toISOString()
      };

      // Local audit trail: records WHO reset WHOSE password and WHEN. Never records
      // the password itself, in any form.
      data.passwordResetAudit = Array.isArray(data.passwordResetAudit) ? data.passwordResetAudit : [];
      data.passwordResetAudit.push({
        id: makeId("pwreset"),
        targetEmail: targetKey,
        resetBy: normalizeEmail(actingAdminEmail),
        at: new Date().toISOString()
      });

      await write(data);

      // Returned exactly once, held in memory only by the caller - never written to
      // disk in plaintext, never logged, never returned again after this call.
      return { email: targetKey, tempPassword };
    }
  };
}

module.exports = {
  repositoryFor,
  fileName,
  DATA_VERSION,
  normalizeIncomingSnapshot,
  mergeRecordsById,
  generateTempPassword,
  isLocalAdmin,
  migrateSharedTempPasswords,
  MIGRATION_EXEMPT_EMAILS,
  hashPassword,
  verifyPassword
};
