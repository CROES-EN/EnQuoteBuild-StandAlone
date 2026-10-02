const assert = require("node:assert/strict");
const test = require("node:test");
const { createUserRolesSync, mergeUsers, SOURCE } = require("../../electron/userRolesSync.cjs");

const remoteHeather = { id: "base44-user-6", email: "hmackey@enphaseenergy.com", full_name: "Heather Mackey", app_role: "admin", additional_roles: [] };

test("adds users that are missing locally and tags them as synced", () => {
  const merged = mergeUsers([], [remoteHeather]);
  assert.equal(merged.length, 1);
  assert.equal(merged[0].app_role, "admin");
  assert.equal(merged[0].source, SOURCE);
});

test("Base44 wins for a matching email, even over a locally granted record", () => {
  const local = [{ id: "local-role-hmackey", email: "HMackey@enphaseenergy.com", app_role: "submitter" }];
  const merged = mergeUsers(local, [remoteHeather]);
  assert.equal(merged.length, 1);
  assert.equal(merged[0].app_role, "admin");
  assert.equal(merged[0].id, "base44-user-6");
});

test("removes a previously synced user who is no longer in Base44, but keeps local-only records", () => {
  const local = [
    { id: "a", email: "gone@x.com", app_role: "admin", source: SOURCE },
    { id: "b", email: "local@x.com", app_role: "admin" }
  ];
  const merged = mergeUsers(local, [remoteHeather]);
  assert.deepEqual(merged.map((u) => u.email).sort(), ["hmackey@enphaseenergy.com", "local@x.com"]);
});

test("returns null when nothing changes", () => {
  const first = mergeUsers([], [remoteHeather]);
  assert.equal(mergeUsers(first, [remoteHeather]), null);
});

function fakeRepository() {
  let users = [];
  return {
    get users() { return users; },
    async mutateCollection(_name, mutator) {
      const next = mutator(structuredClone(users));
      if (!Array.isArray(next)) return { changed: false };
      users = next;
      return { changed: true };
    }
  };
}

test("sync applies users, notifies once, and never wipes on an empty or failed response", async () => {
  const repository = fakeRepository();
  let notified = 0;
  let response = { ok: true, users: [remoteHeather] };
  const sync = createUserRolesSync({
    repository,
    workerUrl: "https://w.example",
    getOutboundToken: () => "t",
    onChanged: () => { notified += 1; },
    logger: { warn() {} },
    fetchImpl: async () => ({ ok: response.ok !== false, status: response.ok === false ? 502 : 200, json: async () => response })
  });

  assert.equal((await sync.sync()).changed, true);
  assert.equal(repository.users.length, 1);
  assert.equal(notified, 1);

  response = { ok: true, users: [] };
  assert.equal((await sync.sync()).ok, false);
  assert.equal(repository.users.length, 1);

  response = { ok: false, error: "users_unavailable" };
  assert.equal((await sync.sync()).ok, false);
  assert.equal(repository.users.length, 1);
});
