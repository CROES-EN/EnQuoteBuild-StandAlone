const assert = require("node:assert/strict");
const test = require("node:test");
const {
  buildSeedRecords,
  createFstRosterSync,
  importRecords,
  mergeRemote,
  reconcileWithSeed,
  recordsToPush
} = require("../../electron/fstRosterSync.cjs");

const seedFile = {
  seededAt: "2026-10-02T00:00:00.000Z",
  fsts: [
    { name: "Ann Lee", employee_id: "FS_1", phone: "111" },
    { name: "Bob Ray", employee_id: "", phone: "222" }
  ]
};
const seed = buildSeedRecords(seedFile);

test("seed records get deterministic ids", () => {
  assert.deepEqual(seed.map((r) => r.id), ["fst-fs-1", "fst-name-bob-ray"]);
});

test("reconcile seeds an empty roster and is a no-op once seeded", () => {
  const seeded = reconcileWithSeed([], seed);
  assert.equal(seeded.length, 2);
  assert.equal(reconcileWithSeed(seeded, seed), null);
});

test("reconcile adopts legacy records into the seed id instead of duplicating them", () => {
  const legacy = [{ id: "demo-fsts-1", name: "Ann Lee", employee_id: "fs_1", phone: "999", updated_date: "2026-10-02T18:00:00.000Z" }];
  const result = reconcileWithSeed(legacy, seed);
  assert.equal(result.length, 2);
  const ann = result.find((r) => r.id === "fst-fs-1");
  assert.equal(ann.phone, "999");
});

test("reconcile keeps FSTs created in the app that are not in the seed", () => {
  const result = reconcileWithSeed([{ id: "demo-fsts-9", name: "New Person", updated_date: "2026-10-03T00:00:00.000Z" }], seed);
  assert.equal(result.length, 3);
});

test("mergeRemote applies only newer remote records", () => {
  const local = [
    { id: "a", name: "local newer", updated_date: "2026-10-03T00:00:00.000Z" },
    { id: "b", name: "local older", updated_date: "2026-10-01T00:00:00.000Z" }
  ];
  const remote = [
    { id: "a", name: "remote older", updated_date: "2026-10-02T00:00:00.000Z" },
    { id: "b", name: "remote newer", updated_date: "2026-10-02T00:00:00.000Z" },
    { id: "c", name: "remote only", updated_date: "2026-10-02T00:00:00.000Z" }
  ];
  const merged = mergeRemote(local, remote);
  assert.deepEqual(merged.map((r) => r.name), ["local newer", "remote newer", "remote only"]);
  assert.equal(mergeRemote(merged, remote), null);
});

test("recordsToPush returns records the remote is missing or has older copies of", () => {
  const local = [
    { id: "a", updated_date: "2026-10-03T00:00:00.000Z" },
    { id: "b", updated_date: "2026-10-01T00:00:00.000Z" },
    { id: "c", updated_date: "2026-10-01T00:00:00.000Z" }
  ];
  const remote = [
    { id: "a", updated_date: "2026-10-02T00:00:00.000Z" },
    { id: "b", updated_date: "2026-10-02T00:00:00.000Z" }
  ];
  assert.deepEqual(recordsToPush(local, remote).map((r) => r.id), ["a", "c"]);
});

function createFakeRepository() {
  let records = [];
  let writes = 0;
  return {
    get records() { return records; },
    get writes() { return writes; },
    async mutateCollection(_name, mutator) {
      const next = mutator(structuredClone(records));
      if (!Array.isArray(next)) return { changed: false };
      records = next;
      writes += 1;
      return { changed: true };
    },
    async listCollection() { return records; }
  };
}

test("sync seeds locally in one write, pulls remote edits and pushes local ones", async () => {
  const repository = createFakeRepository();
  const calls = [];
  const remoteEdit = { ...seed[0], phone: "555", updated_date: "2026-10-05T00:00:00.000Z" };
  const fetchImpl = async (url, init = {}) => {
    calls.push({ path: new URL(url).pathname, method: init.method, body: init.body && JSON.parse(init.body) });
    const body = new URL(url).pathname === "/api/fsts" ? { ok: true, fsts: [remoteEdit] } : { ok: true };
    return { ok: true, status: 200, json: async () => body };
  };
  let notified = 0;
  const rosterSync = createFstRosterSync({
    repository,
    seedFile,
    workerUrl: "https://worker.example.com",
    getIdentity: () => ({ email: "Teammate@Example.com" }),
    getOutboundToken: () => "token",
    onLocalChange: () => { notified += 1; },
    fetchImpl
  });

  const result = await rosterSync.sync();
  assert.equal(result.remote, true);
  assert.equal(repository.records.find((r) => r.id === "fst-fs-1").phone, "555");
  const push = calls.find((c) => c.path === "/api/fsts/upsert");
  assert.equal(push.body.email, "teammate@example.com");
  assert.deepEqual(push.body.records.map((r) => r.id), ["fst-name-bob-ray"]);
  assert.equal(notified, 1);
});

test("sync still seeds locally when the remote is unreachable", async () => {
  const repository = createFakeRepository();
  const rosterSync = createFstRosterSync({
    repository,
    seedFile,
    workerUrl: "https://worker.example.com",
    getIdentity: () => ({ email: "a@example.com" }),
    getOutboundToken: () => "token",
    fetchImpl: async () => { throw new Error("offline"); },
    logger: { warn() {} }
  });

  const result = await rosterSync.sync();
  assert.equal(result.ok, true);
  assert.equal(result.remote, false);
  assert.equal(repository.records.length, 2);
});

test("importRecords updates matches, adds new people, ignores blanks and revives deleted FSTs", () => {
  const local = [
    { id: "fst-fs-1", name: "Ann Lee", employee_id: "FS_1", phone: "111", email: "ann@x.com", updated_date: "2026-10-01T00:00:00.000Z" },
    { id: "fst-fs-2", name: "Bob Ray", employee_id: "FS_2", phone: "222", is_deleted: true, updated_date: "2026-10-01T00:00:00.000Z" }
  ];
  const parsed = [
    { name: "Ann Lee", employee_id: "FS_1", phone: "999", email: "" },
    { name: "Bob Ray", employee_id: "FS_2", phone: "222" },
    { name: "Cy New", employee_id: "FS_3", phone: "333" }
  ];
  const now = "2026-10-09T00:00:00.000Z";
  const result = importRecords(local, parsed, now, () => "fst-fallback");

  assert.deepEqual([result.created, result.updated, result.unchanged], [1, 2, 0]);
  const ann = result.records.find((r) => r.id === "fst-fs-1");
  assert.equal(ann.phone, "999");
  assert.equal(ann.email, "ann@x.com");
  assert.equal(ann.updated_date, now);
  assert.equal(result.records.find((r) => r.id === "fst-fs-2").is_deleted, false);
  assert.equal(result.records.find((r) => r.id === "fst-fs-3").name, "Cy New");
});
test("reconcile fills bundled coordinates for existing records without bumping updated_date", () => {
  const geoSeed = buildSeedRecords({
    seededAt: "2026-10-02T00:00:00.000Z",
    fsts: [{ name: "Ann Lee", employee_id: "FS_1", home_address: "1 A St", home_geo: { address: "1 A St", lat: 1, lng: 2 } }]
  });
  const local = [{ id: "fst-fs-1", name: "Ann Lee", employee_id: "FS_1", home_address: "1 A St", updated_date: "2026-10-03T00:00:00.000Z" }];
  const result = reconcileWithSeed(local, geoSeed);
  assert.deepEqual(result[0].home_geo, { address: "1 A St", lat: 1, lng: 2 });
  assert.equal(result[0].updated_date, "2026-10-03T00:00:00.000Z");
  assert.equal(reconcileWithSeed(result, geoSeed), null);

  const moved = [{ ...local[0], home_address: "9 Z Ave" }];
  assert.equal(reconcileWithSeed(moved, geoSeed), null);
});
test("with no bundled seed, sync adopts legacy local records into the shared roster without duplicates", async () => {
  const repository = createFakeRepository();
  await repository.mutateCollection("fsts", () => [
    { id: "demo-fsts-1", name: "Ann Lee", employee_id: "FS_1", phone: "LOCAL-EDIT", updated_date: "2026-10-02T18:00:00.000Z" }
  ]);
  const remote = [
    { id: "fst-fs-1", name: "Ann Lee", employee_id: "FS_1", phone: "111", updated_date: "2026-10-02T00:00:00.000Z" },
    { id: "fst-fs-2", name: "Bob Ray", employee_id: "FS_2", phone: "222", updated_date: "2026-10-02T00:00:00.000Z" }
  ];
  const pushed = [];
  const fetchImpl = async (url, init = {}) => {
    const isList = new URL(url).pathname === "/api/fsts";
    if (!isList) pushed.push(...JSON.parse(init.body).records);
    return { ok: true, status: 200, json: async () => (isList ? { ok: true, fsts: remote } : { ok: true }) };
  };
  const rosterSync = createFstRosterSync({
    repository,
    seedFile: { seededAt: "2026-10-02T00:00:00.000Z", fsts: [] },
    workerUrl: "https://worker.example.com",
    getIdentity: () => ({ email: "a@example.com" }),
    getOutboundToken: () => "token",
    fetchImpl
  });

  await rosterSync.sync();
  assert.deepEqual(repository.records.map((r) => r.id).sort(), ["fst-fs-1", "fst-fs-2"]);
  assert.equal(repository.records.find((r) => r.id === "fst-fs-1").phone, "LOCAL-EDIT");
  assert.deepEqual(pushed.map((r) => r.id), ["fst-fs-1"]);
});