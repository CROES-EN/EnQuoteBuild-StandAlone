// Shared FST roster for the Resource Planner.
//
// Every install ships with the same hardcoded roster (fstRosterSeed.json) so the
// roster is populated from the first launch. Edits then sync between installs through
// the Cloudflare Worker (/api/fsts): each record carries a stable id and an
// updated_date, and the newest updated_date wins per record. Deleting an FST is a soft
// delete (is_deleted: true) so it syncs like any other edit.

const { randomUUID } = require("node:crypto");

const FST_ID_PREFIX = "fst-";
const GEO_FIELDS = [["home_geo", "home_address"], ["ship_geo", "shipping_address"]];
const PUSH_BATCH_SIZE = 200;
const REQUEST_TIMEOUT_MS = 20 * 1000;

const slug = (value) => String(value ?? "").trim().toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");
const normalizeId = (value) => String(value ?? "").trim().toUpperCase();
const normalizeName = (value) => String(value ?? "").trim().toLowerCase().replace(/\s+/g, " ");
const timeOf = (record) => Date.parse(record?.updated_date) || 0;

// Deterministic id so every install derives the same id for the same seeded FST.
function fstIdFor(record) {
  const key = slug(record.employee_id) || `name-${slug(record.name)}`;
  return `${FST_ID_PREFIX}${key}`;
}

function buildSeedRecords(seedFile) {
  const stamp = seedFile.seededAt;
  return seedFile.fsts.map((fst) => ({
    ...fst,
    id: fstIdFor(fst),
    created_date: stamp,
    updated_date: stamp
  }));
}

// Adds any seed FST that's missing locally. Records that were created earlier without a
// deterministic id (e.g. a partial Excel import) are adopted into the matching seed id
// - keeping any edits - rather than duplicated. Returns the new array, or null if nothing changed.
function reconcileWithSeed(local, seedRecords) {
  const seedById = new Map(seedRecords.map((record) => [record.id, record]));
  const seedByEmployeeId = new Map(seedRecords.filter((r) => r.employee_id).map((r) => [normalizeId(r.employee_id), r]));
  const seedByName = new Map(seedRecords.map((r) => [normalizeName(r.name), r]));

  let changed = false;
  const result = new Map();
  for (const record of local) {
    let next = record;
    if (!seedById.has(record.id) && !String(record.id).startsWith(FST_ID_PREFIX)) {
      const match = (record.employee_id && seedByEmployeeId.get(normalizeId(record.employee_id))) ||
        seedByName.get(normalizeName(record.name));
      if (match) {
        next = { ...record, id: match.id };
        changed = true;
      }
    }
    const existing = result.get(next.id);
    if (existing) {
      changed = true;
      if (timeOf(next) <= timeOf(existing)) continue;
    }
    result.set(next.id, next);
  }

  // Fill in bundled map coordinates (so routing needs no first-run lookups) wherever
  // the local record has none for its current address. Doesn't touch updated_date.
  for (const [id, record] of result) {
    const seedRecord = seedById.get(id);
    if (!seedRecord) continue;
    let filled = record;
    for (const [geoField, addressField] of GEO_FIELDS) {
      const bundled = seedRecord[geoField];
      const address = record[addressField];
      if (bundled && address && bundled.address === address && record[geoField]?.address !== address) {
        filled = { ...filled, [geoField]: bundled };
      }
    }
    if (filled !== record) {
      result.set(id, filled);
      changed = true;
    }
  }

  for (const seedRecord of seedRecords) {
    if (!result.has(seedRecord.id)) {
      result.set(seedRecord.id, seedRecord);
      changed = true;
    }
  }

  return changed ? [...result.values()] : null;
}

// Newest updated_date wins. Returns the new array, or null if the remote had nothing newer.
function mergeRemote(local, remote) {
  const byId = new Map(local.map((record) => [record.id, record]));
  let changed = false;
  for (const incoming of remote) {
    if (!incoming?.id) continue;
    const current = byId.get(incoming.id);
    if (!current || timeOf(incoming) > timeOf(current)) {
      byId.set(incoming.id, incoming);
      changed = true;
    }
  }
  return changed ? [...byId.values()] : null;
}

function recordsToPush(local, remote) {
  const remoteById = new Map(remote.filter((r) => r?.id).map((record) => [record.id, record]));
  return local.filter((record) => {
    if (!record?.id || !record.updated_date) return false;
    const counterpart = remoteById.get(record.id);
    return !counterpart || timeOf(record) > timeOf(counterpart);
  });
}

const IMPORT_FIELDS = [
  "name", "employee_id", "supervisor", "email", "phone", "shipping_address", "home_address",
  "region", "home_state", "fsl_case_no"
];

// Applies rows parsed from the FST Contact List workbook to the local roster: matches by
// employee id, then name; creates the rest. Blank spreadsheet cells never wipe values that
// were entered in the app. Returns { records, created, updated, unchanged }.
function importRecords(local, parsed, nowIso, makeFallbackId) {
  const records = [...local];
  const byEmployeeId = new Map();
  const byName = new Map();
  const usedIds = new Set();
  for (const record of records) {
    usedIds.add(record.id);
    if (record.employee_id) byEmployeeId.set(normalizeId(record.employee_id), record);
    byName.set(normalizeName(record.name), record);
  }

  let created = 0;
  let updated = 0;
  let unchanged = 0;

  for (const row of parsed) {
    const match = (row.employee_id && byEmployeeId.get(normalizeId(row.employee_id))) || byName.get(normalizeName(row.name));
    if (!match) {
      const preferredId = fstIdFor(row);
      records.push({
        ...row,
        id: usedIds.has(preferredId) ? makeFallbackId() : preferredId,
        created_date: nowIso,
        updated_date: nowIso
      });
      usedIds.add(records[records.length - 1].id);
      created += 1;
      continue;
    }

    const changes = {};
    for (const field of IMPORT_FIELDS) {
      if (row[field] && row[field] !== (match[field] ?? "")) changes[field] = row[field];
    }
    if (!match.state && row.state) changes.state = row.state;
    if (!match.zip && row.zip) changes.zip = row.zip;

    if (Object.keys(changes).length === 0 && !match.is_deleted) {
      unchanged += 1;
      continue;
    }
    // A re-imported person who had been removed comes back.
    records[records.indexOf(match)] = { ...match, ...changes, is_deleted: false, updated_date: nowIso };
    updated += 1;
  }

  return { records, created, updated, unchanged };
}

function createFstRosterSync({
  repository,
  seedFile,
  workerUrl,
  getIdentity,
  getOutboundToken,
  getAccessHeaders = () => ({}),
  onLocalChange,
  fetchImpl = globalThis.fetch,
  logger = console
}) {
  const seedRecords = buildSeedRecords(seedFile);
  let inFlight = null;
  let rerunRequested = false;

  async function call(route, { method = "GET", body } = {}) {
    const response = await fetchImpl(new URL(route, workerUrl), {
      method,
      headers: {
        Authorization: `Bearer ${getOutboundToken()}`,
        ...(body ? { "Content-Type": "application/json" } : {}),
        ...getAccessHeaders()
      },
      ...(body ? { body: JSON.stringify(body) } : {}),
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS)
    });
    let parsed = null;
    try {
      parsed = await response.json();
    } catch {
      // Handled below with the status code.
    }
    if (!response.ok || !parsed?.ok) {
      throw new Error(parsed?.error || `Roster sync responded with HTTP ${response.status}.`);
    }
    return parsed;
  }

  async function runOnce() {
    const seeded = await repository.mutateCollection("fsts", (local) => reconcileWithSeed(local, seedRecords));
    let localChanged = seeded.changed;
    let result = { ok: true, remote: false };

    const email = String(getIdentity()?.email || "").trim().toLowerCase();
    if (!email || !getOutboundToken()) {
      result = { ok: true, remote: false, reason: "Cloudflare sync credentials are unavailable." };
    } else {
      try {
        const { fsts: remote = [] } = await call("/api/fsts");
        // Remote records act as the roster "seed" too: this adds FSTs we don't have yet, adopts
        // legacy local records into the shared id (no duplicates) and fills cached coordinates.
        const merged = await repository.mutateCollection("fsts", (local) => {
          const reconciled = reconcileWithSeed(local, remote.filter((record) => record?.id));
          return mergeRemote(reconciled || local, remote) || reconciled;
        });
        localChanged = localChanged || merged.changed;

        const toPush = recordsToPush(await repository.listCollection("fsts"), remote);
        for (let i = 0; i < toPush.length; i += PUSH_BATCH_SIZE) {
          await call("/api/fsts/upsert", { method: "POST", body: { email, records: toPush.slice(i, i + PUSH_BATCH_SIZE) } });
        }
        result = { ok: true, remote: true, pushed: toPush.length };
      } catch (error) {
        logger.warn("[fst-roster] Remote sync failed (local roster is unaffected):", error.message);
        result = { ok: true, remote: false, error: error.message };
      }
    }

    if (localChanged) onLocalChange?.();
    return { ...result, changed: localChanged };
  }

  // Calls made while a sync is running (e.g. an edit saved mid-sync) trigger one more
  // pass afterwards instead of being dropped.
  function sync() {
    if (inFlight) {
      rerunRequested = true;
      return inFlight;
    }
    inFlight = (async () => {
      let result;
      do {
        rerunRequested = false;
        result = await runOnce();
      } while (rerunRequested);
      return result;
    })().finally(() => { inFlight = null; });
    return inFlight;
  }

  async function importRows(parsedRows) {
    const rows = (Array.isArray(parsedRows) ? parsedRows : []).filter((row) => row && String(row.name || "").trim());
    let summary = { created: 0, updated: 0, unchanged: 0 };
    await repository.mutateCollection("fsts", (local) => {
      const result = importRecords(local, rows, new Date().toISOString(), () => `${FST_ID_PREFIX}${randomUUID()}`);
      summary = { created: result.created, updated: result.updated, unchanged: result.unchanged };
      return result.created || result.updated ? result.records : null;
    });
    if (summary.created || summary.updated) onLocalChange?.();
    return summary;
  }

  return { sync, importRows };
}

module.exports = {
  FST_ID_PREFIX,
  fstIdFor,
  buildSeedRecords,
  reconcileWithSeed,
  mergeRemote,
  recordsToPush,
  importRecords,
  createFstRosterSync
};
