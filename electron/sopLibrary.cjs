// Shared SOP library. The document list is cached on disk so the library opens instantly (and
// still reads offline); edits go straight to the Worker so everyone sees one shared copy.
// Attached files are content-addressed (SHA-256), so a cached copy never goes stale.
const fs = require("node:fs");
const path = require("node:path");
const crypto = require("node:crypto");
const { createPollGate } = require("./syncCadence.cjs");

const SYNC_INTERVAL_MS = 10 * 60 * 1000;
// While realtime pushes are flowing, the timer only reaches the Worker on the slow cadence.
const CONNECTED_SYNC_INTERVAL_MS = 60 * 60 * 1000;
const MAX_FILE_BYTES = 20 * 1024 * 1024;
const FILE_CACHE_LIMIT_BYTES = 300 * 1024 * 1024;
const SHA_PATTERN = /^[a-f0-9]{64}$/;

function createSopLibrary({
  client,
  getEmail,
  storageDir,
  logger = console,
  now = () => Date.now(),
  onChanged = () => {}
}) {
  const listPath = path.join(storageDir, "enquote-sops.json");
  const filesDir = path.join(storageDir, "sop-files");
  let state = null;
  let syncing = null;
  let resyncRequested = false;
  let timer = null;
  const syncGate = createPollGate({ slowMs: CONNECTED_SYNC_INTERVAL_MS });

  function load() {
    if (state) return state;
    try {
      const parsed = JSON.parse(fs.readFileSync(listPath, "utf8"));
      state = { cursor: parsed.cursor || "", docs: parsed.docs && typeof parsed.docs === "object" ? parsed.docs : {} };
    } catch {
      state = { cursor: "", docs: {} };
    }
    return state;
  }

  function persist() {
    const temp = `${listPath}.${process.pid}.tmp`;
    try {
      fs.mkdirSync(storageDir, { recursive: true });
      fs.writeFileSync(temp, JSON.stringify(state), "utf8");
      fs.renameSync(temp, listPath);
    } catch (error) {
      logger.warn?.("[sops] Could not cache the SOP list:", error.message);
    }
  }

  function list() {
    const current = load();
    return Object.values(current.docs).map((entry) => ({
      ...entry.record,
      id: entry.id,
      deleted: Boolean(entry.deleted),
      updated_by: entry.updatedBy || entry.record?.updated_by || "",
      updated_date: entry.updatedAt
    }));
  }

  function changed() {
    try {
      onChanged(list());
    } catch (error) {
      logger.warn?.("[sops] Change listener failed:", error.message);
    }
  }

  function applyRows(current, rows) {
    let changedAny = false;
    for (const row of rows) {
      if (!row?.id) continue;
      const existing = current.docs[row.id];
      if (existing && existing.updatedAt >= row.updatedAt) continue;
      if (row.deleted && row.record == null) {
        if (current.docs[row.id]) {
          delete current.docs[row.id];
          changedAny = true;
        }
        continue;
      }
      current.docs[row.id] = {
        id: row.id,
        updatedAt: row.updatedAt,
        updatedBy: row.updatedBy || "",
        deleted: Boolean(row.deleted),
        record: row.record && typeof row.record === "object" ? row.record : existing?.record || {}
      };
      changedAny = true;
    }
    return changedAny;
  }

  async function runSync() {
    if (!client.isReady()) return { ok: false, reason: "not_connected" };
    const current = load();
    let changedAny = false;
    try {
      for (let page = 0; page < 50; page += 1) {
        const result = await client.get("/api/sops", { since: current.cursor });
        const rows = Array.isArray(result.sops) ? result.sops : [];
        if (applyRows(current, rows)) changedAny = true;
        const advanced = result.cursor && result.cursor !== current.cursor;
        if (result.cursor) current.cursor = result.cursor;
        if (!rows.length || !advanced) break;
      }
      if (changedAny) {
        persist();
        changed();
      }
      return { ok: true };
    } catch (error) {
      if (!error.offline) logger.warn?.("[sops] Sync failed:", error.message);
      return { ok: false, reason: error.code || "error", error: error.message };
    }
  }

  function sync() {
    if (syncing) {
      resyncRequested = true;
      return syncing;
    }
    syncing = (async () => {
      let result;
      do {
        resyncRequested = false;
        result = await runSync();
      } while (resyncRequested && result.ok);
      return result;
    })().finally(() => {
      syncing = null;
    });
    return syncing;
  }

  function stampAfter(previous) {
    const prevMs = Date.parse(previous || "") || 0;
    return new Date(Math.max(now(), prevMs + 1)).toISOString();
  }

  // `baseUpdatedAt` is the version the editor started from. If someone else saved in the
  // meantime the save is refused, so two people editing at once can't silently overwrite each
  // other (the other person's version is also always recoverable from version history).
  async function save(input, { baseUpdatedAt, force = false } = {}) {
    if (!input || typeof input !== "object") throw new Error("SOP details are missing.");
    const title = String(input.title || "").trim();
    if (!title) throw new Error("Give the SOP a title.");
    await sync();
    const current = load();
    const id = typeof input.id === "string" && input.id ? input.id : crypto.randomUUID();
    const existing = current.docs[id];
    if (existing && !force && baseUpdatedAt && existing.updatedAt !== baseUpdatedAt) {
      return { ok: false, reason: "conflict", latest: list().find((doc) => doc.id === id), updatedBy: existing.updatedBy };
    }
    const email = String(getEmail() || "").toLowerCase();
    const stamp = stampAfter(existing?.updatedAt);
    const { deleted: _deleted, updated_by: _ub, updated_date: _ud, ...rest } = input;
    const record = {
      category: "General",
      summary: "",
      tags: [],
      content_html: "",
      files: [],
      source_url: "",
      ...existing?.record,
      ...rest,
      id,
      title: title.slice(0, 200),
      created_by: existing?.record?.created_by || email,
      created_date: existing?.record?.created_date || stamp,
      updated_by: email,
      updated_date: stamp
    };
    const result = await client.post("/api/sops/upsert", { id, updatedAt: stamp, record });
    if (result.applied === false) {
      await sync();
      return { ok: false, reason: "conflict", latest: list().find((doc) => doc.id === id) };
    }
    applyRows(current, [{ id, updatedAt: stamp, updatedBy: email, deleted: false, record }]);
    persist();
    changed();
    return { ok: true, record: list().find((doc) => doc.id === id) };
  }

  async function remove(id) {
    const current = load();
    const existing = current.docs[id];
    if (!existing) return { ok: false, reason: "not_found" };
    const stamp = stampAfter(existing.updatedAt);
    await client.post("/api/sops/delete", { id, deletedAt: stamp });
    applyRows(current, [{ ...existing, updatedAt: stamp, updatedBy: String(getEmail() || "").toLowerCase(), deleted: true }]);
    persist();
    changed();
    return { ok: true };
  }

  async function versions(id) {
    const result = await client.get("/api/sops/versions", { id });
    return { ok: true, versions: Array.isArray(result.versions) ? result.versions : [] };
  }

  async function uploadFile({ name, type, bytes }) {
    const buffer = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes || []);
    if (!buffer.byteLength) throw new Error("The file is empty.");
    if (buffer.byteLength > MAX_FILE_BYTES) throw new Error("Files must be 20 MB or smaller.");
    const result = await client.upload("/api/sops/files", { bytes: buffer, type, name });
    // The upload is already on disk here, so opening it right away doesn't download it again.
    writeCachedFile(result.fileId, { name: result.name || name, type: result.type || type }, buffer);
    return { ok: true, file: { fileId: result.fileId, name: result.name || name, type: result.type || type, size: result.size || buffer.byteLength } };
  }

  function cachedPaths(fileId) {
    return { data: path.join(filesDir, fileId), meta: path.join(filesDir, `${fileId}.json`) };
  }

  function writeCachedFile(fileId, meta, bytes) {
    if (!SHA_PATTERN.test(String(fileId || ""))) return;
    try {
      fs.mkdirSync(filesDir, { recursive: true });
      const paths = cachedPaths(fileId);
      fs.writeFileSync(paths.data, bytes);
      fs.writeFileSync(paths.meta, JSON.stringify(meta), "utf8");
      pruneFileCache();
    } catch (error) {
      logger.warn?.("[sops] Could not cache a file:", error.message);
    }
  }

  // Keeps the on-disk file cache bounded by dropping the least recently used files.
  function pruneFileCache() {
    try {
      const entries = fs.readdirSync(filesDir)
        .filter((name) => SHA_PATTERN.test(name))
        .map((name) => {
          const stat = fs.statSync(path.join(filesDir, name));
          return { name, size: stat.size, used: stat.atimeMs || stat.mtimeMs };
        })
        .sort((a, b) => b.used - a.used);
      let total = 0;
      for (const entry of entries) {
        total += entry.size;
        if (total > FILE_CACHE_LIMIT_BYTES) {
          fs.rmSync(path.join(filesDir, entry.name), { force: true });
          fs.rmSync(path.join(filesDir, `${entry.name}.json`), { force: true });
        }
      }
    } catch {
      // Cache pruning is best-effort.
    }
  }

  async function getFile(fileId, fallbackMeta = {}) {
    if (!SHA_PATTERN.test(String(fileId || ""))) throw new Error("That file reference is not valid.");
    const paths = cachedPaths(fileId);
    try {
      const bytes = fs.readFileSync(paths.data);
      const meta = JSON.parse(fs.readFileSync(paths.meta, "utf8"));
      const touched = new Date();
      fs.utimesSync(paths.data, touched, touched);
      return { ok: true, bytes: new Uint8Array(bytes), type: meta.type || fallbackMeta.type || "", name: meta.name || fallbackMeta.name || "file" };
    } catch {
      // Not cached yet.
    }
    const downloaded = await client.download(`/api/sops/files/${fileId}`);
    const meta = { name: fallbackMeta.name || "file", type: downloaded.type || fallbackMeta.type || "" };
    // Never trust a download that doesn't match its content address.
    const actual = crypto.createHash("sha256").update(downloaded.bytes).digest("hex");
    if (actual !== fileId) throw new Error("The downloaded file was corrupted. Try again.");
    writeCachedFile(fileId, meta, downloaded.bytes);
    return { ok: true, bytes: downloaded.bytes, type: meta.type, name: meta.name };
  }

  function start() {
    stop();
    timer = setInterval(() => {
      if (!syncGate.due()) return;
      syncGate.ran();
      void sync();
    }, SYNC_INTERVAL_MS);
    timer.unref?.();
    syncGate.ran();
    void sync();
  }

  function stop() {
    if (timer) clearInterval(timer);
    timer = null;
  }

  return { list, sync, save, remove, versions, uploadFile, getFile, start, stop };
}

module.exports = { createSopLibrary, MAX_FILE_BYTES };
