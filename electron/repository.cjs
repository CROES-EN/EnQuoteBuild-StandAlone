const fs = require("node:fs/promises");
const path = require("node:path");
const crypto = require("node:crypto");
const { z } = require("zod");
const { KNOWN_ENQUOTE_USERS } = require("./knownEnquoteUsers.cjs");

const DATA_VERSION = 1;
const DEFAULT_SYNC_TTL_MS = 5 * 60 * 1000;
const DEFAULT_TEMP_PASSWORD = "Enquote1";
const fileName = "enquote-demo-data-v1.json";
const productSeed = [
  { id: "demo-product-001", name: "Disconnect Enclosure Repair", description: "Synthetic service item for demonstration quotes.", type: "service", sku: "DEMO-SVC-001", unit_price: 480, unit: "each", category: "Services", is_active: true },
  { id: "demo-product-002", name: "Outdoor Conduit Kit", description: "Synthetic conduit and fittings demonstration kit.", type: "product", sku: "DEMO-MAT-002", unit_price: 185, unit: "each", category: "Conduit & Raceway", is_active: true },
  { id: "demo-product-003", name: "Field Travel", description: "Synthetic service travel line item.", type: "service", sku: "DEMO-SVC-003", unit_price: 140, unit: "trip", category: "Services", is_active: true }
];
const quoteSchema = z.object({
  id: z.string().min(1),
  quote_number: z.string().optional(),
  status: z.string().optional(),
  total: z.number().optional(),
  is_current_version: z.boolean().optional(),
  parent_quote_id: z.string().nullable().optional(),
  version_number: z.number().optional(),
  // Local-only optimistic-concurrency counter (NOT the business-facing "version_number"
  // above, which represents resubmitted quote revisions). Bumped on every write that goes
  // through create()/update()/the webhook-import merge, so update() can detect and reject
  // a save based on stale data (e.g. the quote changed via a Base44 import while the Edit
  // Quote form was still open) instead of silently overwriting it. See update() below.
  _rev: z.number().int().positive().optional()
}).passthrough();
const updateSchema = z.object({ id: z.string().min(1), changes: z.record(z.unknown()) });
// "supervisorDailyMetrics" backs the Supervisor Dashboard (Calls/AHT, Emails Worked,
// Quotes Drafted, Staffing). That dashboard is intentionally independent of Base44, so
// this collection has no Base44 entity counterpart - it is only ever read/written locally.
const collectionNames = ["reviews", "activities", "followUps", "users", "siteFlags", "deletionRequests", "materialOrders", "rmas", "svCancels", "supportInteractions", "pdfTemplates", "priceReviews", "followUpConfigs", "pvManufacturers", "supervisorDailyMetrics"];
const collectionDefaults = {
  reviews: [],
  activities: [],
  followUps: [],
  users: [{ id: "demo-user", email: "demo.manager@example.invalid", app_role: "admin", role: "admin", name: "Demo Manager" }]
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

const seedQuotes = [
  { id: "demo-q-1001", quote_number: "DEMO-1001", site_id: "DEMO-SITE-01", case_number: "DEMO-CASE-01", status: "draft_without_internal", total: 1240, materials_total: 620, labor_total: 480, travel_total: 140, sales_tax: 0, created_by: "demo.coordinator.one", created_date: "2026-08-20T14:00:00.000Z", updated_date: "2026-08-20T14:00:00.000Z", is_current_version: true, version_number: 1, scope_of_work: "Replace damaged disconnect enclosure", homeowner_summary: "Repair solar equipment enclosure" },
  { id: "demo-q-1002", quote_number: "DEMO-1002", site_id: "DEMO-SITE-02", case_number: "DEMO-CASE-02", status: "submitted", total: 2160, materials_total: 910, labor_total: 980, travel_total: 270, sales_tax: 0, created_by: "demo.coordinator.two", created_date: "2026-08-18T14:00:00.000Z", updated_date: "2026-08-19T14:00:00.000Z", is_current_version: true, version_number: 1, scope_of_work: "Replace rooftop wiring and conduit", homeowner_summary: "Repair rooftop wiring" },
  { id: "demo-q-1003", quote_number: "DEMO-1003", site_id: "DEMO-SITE-03", case_number: "DEMO-CASE-03", status: "approved", total: 3480, materials_total: 1320, labor_total: 1740, travel_total: 420, sales_tax: 0, created_by: "demo.coordinator.three", created_date: "2026-08-12T14:00:00.000Z", updated_date: "2026-08-14T14:00:00.000Z", is_current_version: true, version_number: 1, scope_of_work: "Replace failed inverter components", homeowner_summary: "Replace inverter components" },
  { id: "demo-q-1004-v1", quote_number: "DEMO-1004", site_id: "DEMO-SITE-04", case_number: "DEMO-CASE-04", status: "rejected", total: 1920, materials_total: 700, labor_total: 980, travel_total: 240, sales_tax: 0, created_by: "demo.coordinator.one", created_date: "2026-08-05T14:00:00.000Z", updated_date: "2026-08-07T14:00:00.000Z", is_current_version: false, parent_quote_id: "demo-q-1004-v1", version_number: 1, scope_of_work: "Replace damaged combiner components", homeowner_summary: "Repair combiner" },
  { id: "demo-q-1004-v2", quote_number: "DEMO-1004", site_id: "DEMO-SITE-04", case_number: "DEMO-CASE-04", status: "quote_sent_to_ho", total: 1780, materials_total: 640, labor_total: 920, travel_total: 220, sales_tax: 0, created_by: "demo.coordinator.one", created_date: "2026-08-09T14:00:00.000Z", updated_date: "2026-08-11T14:00:00.000Z", is_current_version: true, parent_quote_id: "demo-q-1004-v1", version_number: 2, scope_of_work: "Replace damaged combiner components", homeowner_summary: "Repair combiner" },
  { id: "demo-q-1005", quote_number: "DEMO-1005", site_id: "DEMO-SITE-05", case_number: "DEMO-CASE-05", status: "invoice_paid", total: 2640, materials_total: 1060, labor_total: 1260, travel_total: 320, sales_tax: 0, created_by: "demo.coordinator.two", created_date: "2026-07-30T14:00:00.000Z", updated_date: "2026-08-03T14:00:00.000Z", is_current_version: true, version_number: 1, scope_of_work: "Replace service wiring", homeowner_summary: "Repair service wiring" },
  { id: "demo-q-1006", quote_number: "DEMO-1006", site_id: "DEMO-SITE-06", case_number: "DEMO-CASE-06", status: "scheduled", total: 3120, materials_total: 1240, labor_total: 1500, travel_total: 380, sales_tax: 0, created_by: "demo.coordinator.three", created_date: "2026-07-25T14:00:00.000Z", updated_date: "2026-08-01T14:00:00.000Z", is_current_version: true, version_number: 1, scope_of_work: "Replace damaged panel wiring", homeowner_summary: "Repair panel wiring" }
];

const collectionEntityMappings = {
  reviews: ["QuoteReview"],
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
  const { bumpRevField = null } = options;
  const existing = Array.isArray(existingList) ? existingList : [];
  const incoming = Array.isArray(incomingList) ? incomingList : [];
  if (incoming.length === 0) return existing;

  const byId = new Map();
  for (const record of existing) {
    if (record && typeof record === "object" && record.id !== undefined && record.id !== null) {
      byId.set(String(record.id), record);
    }
  }

  const getTimestamp = record => {
    const candidate = record && (record.updated_date || record.updated_at || record.last_saved_at);
    const time = candidate ? Date.parse(candidate) : NaN;
    return Number.isNaN(time) ? null : time;
  };

  for (const record of incoming) {
    if (!record || typeof record !== "object" || record.id === undefined || record.id === null) continue;
    const key = String(record.id);
    const current = byId.get(key);

    let winner;
    if (!current) {
      winner = record;
    } else {
      const currentTime = getTimestamp(current);
      const incomingTime = getTimestamp(record);
      if (currentTime !== null && incomingTime !== null) {
        winner = incomingTime >= currentTime ? record : current;
      } else {
        // No comparable timestamps on one/both sides - prefer the incoming (newly imported) record.
        winner = record;
      }
    }

    if (bumpRevField && winner === record) {
      const priorRev = current?.[bumpRevField] || 0;
      winner = { ...winner, [bumpRevField]: priorRev + 1 };
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

function repositoryFor(userDataPath) {
  const dataPath = path.join(userDataPath, fileName);

  async function read() {
    try {
      let raw = await fs.readFile(dataPath, "utf8");
      // Strip a leading UTF-8 BOM if present - JSON.parse doesn't tolerate one, and a BOM can
      // easily end up here from an external editor/tool resaving this file (e.g. Windows
      // PowerShell 5.1's `Out-File -Encoding utf8` always writes one, unlike newer tools) even
      // though this app itself never writes one (see write() below). Confirmed as the root
      // cause of a real "Failed to persist incoming snapshot ... Unexpected token '\uFEFF'"
      // outage in webhook-receiver.cjs, which reads this same file through this function.
      if (raw.charCodeAt(0) === 0xFEFF) raw = raw.slice(1);
      const parsed = JSON.parse(raw);
      if (parsed.version !== DATA_VERSION || !Array.isArray(parsed.quotes)) throw new Error("Incompatible local data file");
      parsed.products = parsed.products || structuredClone(productSeed);
      parsed.meta = parsed.meta || {};
      parsed.meta.sync_ttl_ms = parsed.meta.sync_ttl_ms || DEFAULT_SYNC_TTL_MS;
      parsed.userCredentials = parsed.userCredentials || {};
      parsed.outboundQueue = Array.isArray(parsed.outboundQueue) ? parsed.outboundQueue : [];
      collectionNames.forEach(name => { parsed[name] = parsed[name] || structuredClone(collectionDefaults[name]); });
      return parsed;
    } catch (error) {
      if (error.code !== "ENOENT") throw error;
      const initial = { version: DATA_VERSION, quotes: seedQuotes, products: productSeed, meta: { sync_ttl_ms: DEFAULT_SYNC_TTL_MS }, userCredentials: {}, outboundQueue: [] };
      await write(initial);
      return initial;
    }
  }

  async function write(data) {
    await fs.mkdir(userDataPath, { recursive: true });
    const next = {
      ...data,
      meta: {
        sync_ttl_ms: DEFAULT_SYNC_TTL_MS,
        ...data.meta,
        last_saved_at: new Date().toISOString()
      }
    };
    const tempPath = `${dataPath}.tmp`;
    await fs.rm(tempPath, { force: true });
    await fs.writeFile(tempPath, JSON.stringify(next, null, 2), "utf8");
    try {
      await fs.rename(tempPath, dataPath);
    } catch (error) {
      if (error.code === "ENOENT") {
        await fs.writeFile(dataPath, JSON.stringify(next, null, 2), "utf8");
        return;
      }
      throw error;
    }
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
      const next = data.quotes.filter(quote => quote.id !== id);
      if (next.length === data.quotes.length) throw new Error("Quote not found.");
      data.quotes = next;
      // Drop any not-yet-synced outbound queue entry for this quote too, so deleting a
      // quote before it reaches Base44 doesn't leave a permanent orphaned queue entry
      // behind (harmless - listPendingOutboundQuotes() already skips entries whose quote
      // no longer exists - but there's no reason to let it accumulate forever).
      if (Array.isArray(data.outboundQueue)) {
        data.outboundQueue = data.outboundQueue.filter(entry => entry.local_id !== id);
      }
      await write(data);
      return { id };
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
      // touch userCredentials or outboundQueue - those are local-only state (signed-in
      // passwords and quotes still waiting to reach Base44) that a demo-data reset has
      // no business erasing.
      const current = await read();
      const data = {
        version: DATA_VERSION,
        quotes: structuredClone(seedQuotes),
        products: structuredClone(productSeed),
        userCredentials: current.userCredentials || {},
        outboundQueue: current.outboundQueue || []
      };
      collectionNames.forEach(name => { data[name] = structuredClone(collectionDefaults[name]); });
      await write(data);
      return data.quotes;
    },
    async exportData() {
      return await read();
    },
    async importData(input) {
      const normalized = normalizeIncomingSnapshot(input);
      const current = await read();

      // Merge incoming records into the existing local dataset (deduped by id) instead of
      // overwriting it, so repeated/overlapping snapshots don't discard local-only records
      // or balloon storage with duplicates. Quotes additionally bump `_rev` whenever an
      // import wins, so a stale Edit Quote form still open against the old revision is
      // correctly rejected instead of clobbering what this import just brought in.
      const merged = {
        ...normalized,
        quotes: mergeRecordsById(current.quotes, normalized.quotes, { bumpRevField: "_rev" }),
        products: mergeRecordsById(current.products, normalized.products)
      };
      collectionNames.forEach(name => {
        merged[name] = mergeRecordsById(current[name], normalized[name]);
      });

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
        userCredentials: z.record(z.unknown()).optional(),
        outboundQueue: z.array(z.record(z.unknown())).optional(),
        meta: z.object({
          sync_ttl_ms: z.number().optional(),
          last_imported_at: z.string().optional(),
          last_snapshot_id: z.string().nullable().optional(),
          last_saved_at: z.string().optional()
        }).optional()
      }).parse({
        ...merged,
        // Credentials and the outbound sync queue are local-only state. An incoming
        // Base44 snapshot must never clobber them, or users would lose their
        // passwords and pending quotes would silently never reach Base44.
        userCredentials: current.userCredentials || {},
        outboundQueue: current.outboundQueue || [],
        meta: {
          sync_ttl_ms: DEFAULT_SYNC_TTL_MS,
          last_imported_at: new Date().toISOString(),
          last_snapshot_id: input?.delivery_id || input?.snapshot?.delivery_id || null,
          last_saved_at: new Date().toISOString()
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
      const queue = (await read()).outboundQueue || [];
      return {
        pending: queue.filter(entry => entry.status === "pending").length,
        synced: queue.filter(entry => entry.status === "synced").length,
        total: queue.length
      };
    },
    async listProducts() { return (await read()).products || productSeed; },    async createProduct(record) {
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
    async createCollectionRecord(name, record) {
      if (!collectionNames.includes(name)) throw new Error(`Unsupported local collection: ${name}`);
      const data = await read();
      const now = new Date().toISOString();
      const item = {
        created_date: now,
        updated_date: now,
        ...z.record(z.unknown()).parse(record),
        id: record.id || makeId(`demo-${name}`)
      };
      data[name].push(item);
      await write(data);
      return item;
    },
    async updateCollectionRecord(name, id, changes) {
      if (!collectionNames.includes(name)) throw new Error(`Unsupported local collection: ${name}`);
      const data = await read();
      const index = data[name].findIndex(item => item.id === id);
      if (index < 0) throw new Error(`${name} record not found.`);
      data[name][index] = {
        ...data[name][index],
        updated_date: new Date().toISOString(),
        ...z.record(z.unknown()).parse(changes),
        id
      };
      await write(data);
      return data[name][index];
    },
    async deleteCollectionRecord(name, id) {
      if (!collectionNames.includes(name)) throw new Error(`Unsupported local collection: ${name}`);
      const data = await read();
      const next = data[name].filter(item => item.id !== id);
      if (next.length === data[name].length) throw new Error(`${name} record not found.`);
      data[name] = next;
      await write(data);
      return { id };
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

      if (!data.userCredentials[key]) {
        const isKnownAccount =
          KNOWN_ENQUOTE_USERS.some(candidate => normalizeEmail(candidate.email) === key) ||
          (data.users || []).some(candidate => normalizeEmail(candidate.email) === key);
        if (!isKnownAccount) {
          throw new Error("This email isn't registered for EnQuote access yet. Contact an admin to be added.");
        }

        data.userCredentials[key] = {
          ...hashPassword(DEFAULT_TEMP_PASSWORD),
          mustChangePassword: true,
          updatedAt: new Date().toISOString()
        };
        await write(data);
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
    }
  };
}

module.exports = { repositoryFor, fileName, DATA_VERSION, normalizeIncomingSnapshot, mergeRecordsById };
