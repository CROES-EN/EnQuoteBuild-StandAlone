const fs = require("node:fs/promises");
const path = require("node:path");

// Report tables too big to live in the main data file. Every save rewrites that whole file (and
// rotates three backup copies of it), so a ~12 MB table made every unrelated save slower. These
// are stored one-per-file in their own folder instead, and are only read when asked for.
const LARGE_TABLE_IDS = ["care_subscriptions"];
const COLLECTION = "supervisorReportTables";

function createLargeTableStore({ directory, repository, ids = LARGE_TABLE_IDS, collection = COLLECTION, logger = console }) {
  const allowed = new Set(ids);
  // One operation at a time per table, so a save can never interleave with the one-time
  // migration or a delete.
  const queues = new Map();

  function assertId(id) {
    if (!allowed.has(id)) throw new Error(`Not a large report table: ${id}`);
  }

  const fileFor = (id) => path.join(directory, `${id}.json`);

  function serialize(id, task) {
    const run = (queues.get(id) || Promise.resolve()).then(task);
    queues.set(id, run.catch(() => {}));
    return run;
  }

  async function readFile(id) {
    let raw;
    try {
      raw = await fs.readFile(fileFor(id), "utf8");
    } catch (error) {
      if (error.code === "ENOENT") return null;
      throw error;
    }
    try {
      return JSON.parse(raw);
    } catch (error) {
      // Keep the unreadable file for inspection rather than overwriting it silently.
      const aside = `${fileFor(id)}.corrupt-${Date.now()}`;
      await fs.rename(fileFor(id), aside).catch(() => {});
      logger.warn(`[large-tables] ${id}.json was not valid JSON (${error.message}); moved aside to ${aside}.`);
      return null;
    }
  }

  async function writeFile(id, record) {
    await fs.mkdir(directory, { recursive: true });
    const serialized = JSON.stringify(record);
    const target = fileFor(id);
    const temp = `${target}.${Date.now()}-${Math.random().toString(36).slice(2)}.tmp`;
    await fs.writeFile(temp, serialized, "utf8");
    // Never swap in a file that doesn't parse.
    JSON.parse(await fs.readFile(temp, "utf8"));
    for (let attempt = 1; ; attempt += 1) {
      try {
        await fs.rename(temp, target);
        return;
      } catch (error) {
        if (attempt >= 5) {
          await fs.rm(temp, { force: true }).catch(() => {});
          throw error;
        }
        await new Promise((resolve) => setTimeout(resolve, attempt * 200));
      }
    }
  }

  async function findLegacyRecord(id) {
    const records = (await repository.listCollection(collection)) || [];
    return records.find((record) => record?.id === id) || null;
  }

  async function removeLegacyRecord(id) {
    try {
      await repository.deleteCollectionRecord(collection, id);
    } catch (error) {
      if (!String(error?.message || "").includes("not found")) throw error;
    }
  }

  return {
    ids: [...allowed],

    // Returns the table, or null. The first read after an upgrade moves the table out of the
    // main data file (where it used to live) into its own file, then removes it from there.
    get(id) {
      assertId(id);
      return serialize(id, async () => {
        const stored = await readFile(id);
        if (stored) return stored;
        const legacy = await findLegacyRecord(id);
        if (!legacy) return null;
        await writeFile(id, legacy);
        await removeLegacyRecord(id);
        logger.info(`[large-tables] Moved "${id}" out of the main data file (${(JSON.stringify(legacy).length / 1e6).toFixed(1)}M characters).`);
        return legacy;
      });
    },

    save(id, record) {
      assertId(id);
      if (!record || typeof record !== "object" || Array.isArray(record)) throw new Error("A report table record is required.");
      return serialize(id, async () => {
        const now = new Date().toISOString();
        const saved = { ...record, id, created_date: record.created_date || now, updated_date: now };
        await writeFile(id, saved);
        // A stale copy in the main data file must not come back through the migration above.
        if (await findLegacyRecord(id)) await removeLegacyRecord(id);
        return saved;
      });
    },

    delete(id) {
      assertId(id);
      return serialize(id, async () => {
        await fs.rm(fileFor(id), { force: true });
        if (await findLegacyRecord(id)) await removeLegacyRecord(id);
        return { ok: true };
      });
    }
  };
}

module.exports = { createLargeTableStore, LARGE_TABLE_IDS };
