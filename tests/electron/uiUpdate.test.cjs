const assert = require("node:assert/strict");
const crypto = require("node:crypto");
const fs = require("node:fs/promises");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");
const zlib = require("node:zlib");
const { createUiUpdater, verifyManifest, compareAppVersions, compareUiVersions, safeRelativePath, sha256Hex } = require("../../electron/uiUpdate.cjs");
const { buildBundle, signManifest } = require("../../scripts/lib/uiBundle.cjs");

const { publicKey, privateKey } = crypto.generateKeyPairSync("ed25519");
const publicPem = publicKey.export({ type: "spki", format: "pem" });
const privatePem = privateKey.export({ type: "pkcs8", format: "pem" });
const quiet = { info() {}, warn() {}, error() {} };

async function makeDist(root, marker = "v1") {
  const dist = path.join(root, "dist");
  await fs.mkdir(path.join(dist, "assets"), { recursive: true });
  await fs.writeFile(path.join(dist, "index.html"), `<html>${marker}</html>`);
  await fs.writeFile(path.join(dist, "assets", "app.js"), `console.log("${marker}")`);
  return dist;
}

function manifestFor(bundle, overrides = {}) {
  return {
    uiVersion: "1.0.14+100",
    baseAppVersion: "1.0.14",
    minAppVersion: "1.0.14",
    bundleSha256: bundle.sha256,
    bundleSize: bundle.size,
    publishedAt: "2026-10-02T00:00:00.000Z",
    notes: "Fixes the thing",
    ...overrides
  };
}

// A fake Worker that serves one manifest envelope and one bundle.
function fakeServer({ envelope, bundleBytes }) {
  return async (url) => {
    const { pathname } = new URL(url);
    if (pathname === "/api/ui/manifest") return { ok: true, status: 200, json: async () => ({ ok: true, manifest: envelope }) };
    if (pathname === "/api/ui/bundle") return { ok: true, status: 200, arrayBuffer: async () => bundleBytes.buffer.slice(bundleBytes.byteOffset, bundleBytes.byteOffset + bundleBytes.length) };
    throw new Error(`unexpected ${pathname}`);
  };
}

async function setup({ appVersion = "1.0.14", overrides, tamper } = {}) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "enquote-ui-update-"));
  const bundle = buildBundle(await makeDist(root));
  const envelope = signManifest(manifestFor(bundle, overrides), privatePem);
  const bytes = tamper ? tamper(bundle.gz) : bundle.gz;
  const userData = path.join(root, "userData");
  const updater = createUiUpdater({
    userDataPath: userData,
    appVersion,
    publicKeyPem: publicPem,
    workerUrl: "https://worker.example",
    getToken: () => "token",
    fetchImpl: fakeServer({ envelope, bundleBytes: bytes }),
    logger: quiet
  });
  return { root, bundle, envelope, userData, updater, cleanup: () => fs.rm(root, { recursive: true, force: true }) };
}

test("version comparison", () => {
  assert.equal(compareAppVersions("1.0.14", "1.0.14"), 0);
  assert.equal(compareAppVersions("1.0.9", "1.0.14"), -1);
  assert.equal(compareUiVersions("1.0.14+200", "1.0.14+100"), 1);
  assert.throws(() => compareAppVersions("x", "1.0.0"));
});

test("a manifest signed with the right key verifies; a tampered or wrongly signed one does not", () => {
  const bundle = { sha256: "a".repeat(64), size: 10 };
  const good = signManifest(manifestFor(bundle), privatePem);
  assert.equal(verifyManifest(good, publicPem).uiVersion, "1.0.14+100");

  const tampered = { ...good, payload: good.payload.replace("1.0.14+100", "1.0.14+999") };
  assert.throws(() => verifyManifest(tampered, publicPem), /signature is invalid/);

  const other = crypto.generateKeyPairSync("ed25519").privateKey.export({ type: "pkcs8", format: "pem" });
  assert.throws(() => verifyManifest(signManifest(manifestFor(bundle), other), publicPem), /signature is invalid/);
  assert.throws(() => verifyManifest({ payload: "{}" }, publicPem), /Malformed/);
});

test("paths that could escape the update folder are rejected", () => {
  for (const bad of ["../x", "a/../../x", "/etc/passwd", "C:/x", "a\\b", "", "."]) {
    assert.throws(() => safeRelativePath(bad), /Unsafe path/, bad);
  }
  assert.equal(safeRelativePath("assets/app.js"), "assets/app.js");
});

test("downloads, verifies and unpacks an update, then uses it", async () => {
  const ctx = await setup();
  try {
    assert.equal(ctx.updater.resolveEntry(), null);
    const result = await ctx.updater.check();
    assert.equal(result.updated, true);
    assert.equal(result.notes, "Fixes the thing");

    const entry = ctx.updater.resolveEntry();
    assert.equal(entry.uiVersion, "1.0.14+100");
    assert.equal(await fs.readFile(entry.indexPath, "utf8"), "<html>v1</html>");
    assert.equal(await fs.readFile(path.join(path.dirname(entry.indexPath), "assets", "app.js"), "utf8"), 'console.log("v1")');

    assert.equal((await ctx.updater.check()).reason, "up-to-date");
  } finally {
    await ctx.cleanup();
  }
});

test("an update for a different installed app version, or needing a newer app, is ignored", async () => {
  const other = await setup({ appVersion: "1.0.15" });
  try {
    assert.equal((await other.updater.check()).reason, "different-app-version");
  } finally {
    await other.cleanup();
  }

  const tooOld = await setup({ overrides: { minAppVersion: "1.0.20" } });
  try {
    assert.equal((await tooOld.updater.check()).reason, "app-too-old");
  } finally {
    await tooOld.cleanup();
  }
});

test("a bundle that does not match the signed hash is rejected and nothing is installed", async () => {
  const ctx = await setup({ tamper: (gz) => Buffer.concat([gz.subarray(0, gz.length - 1), Buffer.from([gz[gz.length - 1] ^ 1])]) });
  try {
    const result = await ctx.updater.check();
    assert.equal(result.updated, false);
    assert.match(result.error, /size|hash/);
    assert.equal(ctx.updater.resolveEntry(), null);
  } finally {
    await ctx.cleanup();
  }
});

test("a signed bundle containing an escaping path is refused", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "enquote-ui-update-"));
  try {
    const evil = zlib.gzipSync(Buffer.from(JSON.stringify({ files: { "index.html": "eA==", "../escaped.txt": "eA==" } })));
    const bundle = { gz: evil, sha256: sha256Hex(evil), size: evil.length };
    const envelope = signManifest(manifestFor(bundle), privatePem);
    const updater = createUiUpdater({
      userDataPath: path.join(root, "userData"), appVersion: "1.0.14", publicKeyPem: publicPem, workerUrl: "https://w.example",
      getToken: () => "t", fetchImpl: fakeServer({ envelope, bundleBytes: evil }), logger: quiet
    });
    const result = await updater.check();
    assert.match(result.error, /Unsafe path/);
    await assert.rejects(fs.stat(path.join(root, "userData", "escaped.txt")));
    assert.equal(updater.resolveEntry(), null);
  } finally {
    await fs.rm(root, { recursive: true, force: true });
  }
});

test("marking an update bad falls back to the bundled UI and stops it being offered again", async () => {
  const ctx = await setup();
  try {
    await ctx.updater.check();
    ctx.updater.markBad("1.0.14+100", "test");
    assert.equal(ctx.updater.resolveEntry(), null);
    assert.equal((await ctx.updater.check()).reason, "marked-bad");
  } finally {
    await ctx.cleanup();
  }
});

test("after the installer itself updates, an older downloaded UI is not used", async () => {
  const ctx = await setup();
  try {
    await ctx.updater.check();
    const upgraded = createUiUpdater({
      userDataPath: ctx.userData, appVersion: "1.0.15", publicKeyPem: publicPem, workerUrl: "https://w.example",
      getToken: () => "t", fetchImpl: async () => { throw new Error("offline"); }, logger: quiet
    });
    assert.equal(upgraded.resolveEntry(), null);
  } finally {
    await ctx.cleanup();
  }
});

test("a half-written update (no completion marker) is never used", async () => {
  const ctx = await setup();
  try {
    await ctx.updater.check();
    await fs.rm(path.join(ctx.userData, "ui-updates", "1.0.14+100", ".complete"));
    assert.equal(ctx.updater.resolveEntry(), null);
  } finally {
    await ctx.cleanup();
  }
});

test("cleanupStale removes a downloaded UI left over from an older installer, and keeps a current one", async () => {
  const ctx = await setup();
  try {
    await ctx.updater.check();
    assert.equal(ctx.updater.cleanupStale(), false);
    assert.ok(ctx.updater.resolveEntry());

    const upgraded = createUiUpdater({
      userDataPath: ctx.userData, appVersion: "1.0.15", publicKeyPem: publicPem, workerUrl: "https://w.example",
      getToken: () => "t", fetchImpl: async () => { throw new Error("offline"); }, logger: quiet
    });
    assert.equal(upgraded.cleanupStale(), true);
    await assert.rejects(fs.stat(path.join(ctx.userData, "ui-updates")));
  } finally {
    await ctx.cleanup();
  }
});