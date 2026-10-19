const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const {spawnSync} = require("node:child_process");
const {appBundlePath, selfInstallBlockedReason, installerScript, prepareMacInstall} = require("../../electron/macSelfInstaller.cjs");

test("finds the app bundle from the Mac executable path", () => {
  assert.equal(appBundlePath("/Applications/EnQuote.app/Contents/MacOS/EnQuote"), "/Applications/EnQuote.app");
  assert.equal(appBundlePath("C:\\EnQuote\\EnQuote.exe"), null);
});

test("self-install requires write access to the bundle and its folder", () => {
  const writable = {constants: fs.constants, accessSync() {}};
  const readOnly = {constants: fs.constants, accessSync() { throw new Error("EACCES"); }};
  assert.equal(selfInstallBlockedReason("/Applications/EnQuote.app", {fs: writable}), null);
  assert.match(selfInstallBlockedReason("/Applications/EnQuote.app", {fs: readOnly}), /cannot modify/);
  assert.match(selfInstallBlockedReason(null, {fs: writable}), /could not locate/);
});

test("installer script waits for exit, rolls back failed copies, and quotes paths", () => {
  const script = installerScript({pid: 42, target: "/Applications/O'Brien EnQuote.app",
    staged: "/tmp/s/EnQuote.app", stagingDir: "/tmp/s", relaunch: true});
  assert.match(script, /kill -0 "\$PID"/);
  assert.match(script, /TARGET='\/Applications\/O'\\''Brien EnQuote\.app'/);
  assert.match(script, /mv "\$BACKUP" "\$TARGET"/);
  assert.match(script, /xattr -dr com\.apple\.quarantine/);
  assert.match(script, /open "\$TARGET"/);
  assert.doesNotMatch(installerScript({pid: 1, target: "/a.app", staged: "/b.app", stagingDir: "/s", relaunch: false}), /open "/);
  const bash = ["C:\\Program Files\\Git\\bin\\bash.exe", "/bin/bash"].find(candidate => fs.existsSync(candidate));
  if (bash) assert.equal(spawnSync(bash, ["-n"], {input: script}).status, 0);
});

test("prepareMacInstall rejects missing downloads and archives without EnQuote.app", t => {
  const tmpdir = fs.mkdtempSync(path.join(require("node:os").tmpdir(), "enquote-test-"));
  t.after(() => fs.rmSync(tmpdir, {recursive: true, force: true}));
  const zipPath = path.join(tmpdir, "update.zip");
  fs.writeFileSync(zipPath, "zip");
  assert.throws(() => prepareMacInstall({zipPath: path.join(tmpdir, "missing.zip"), bundlePath: "/Applications/EnQuote.app", tmpdir}), /missing/);
  const spawned = [];
  const spawn = () => { spawned.push(true); return {unref() {}}; };
  assert.throws(() => prepareMacInstall({zipPath, bundlePath: "/Applications/EnQuote.app", tmpdir, spawn,
    spawnSync: () => ({status: 0})}), /did not contain/);
  assert.throws(() => prepareMacInstall({zipPath, bundlePath: "/Applications/EnQuote.app", tmpdir, spawn,
    spawnSync: () => ({status: 1, stderr: "bad zip"})}), /bad zip/);
  assert.equal(spawned.length, 0);
  assert.deepEqual(fs.readdirSync(tmpdir), ["update.zip"]);
});

test("prepareMacInstall stages the extracted app and launches a detached installer", t => {
  const tmpdir = fs.mkdtempSync(path.join(require("node:os").tmpdir(), "enquote-test-"));
  t.after(() => fs.rmSync(tmpdir, {recursive: true, force: true}));
  const zipPath = path.join(tmpdir, "update.zip");
  fs.writeFileSync(zipPath, "zip");
  const spawnSync = (command, args) => {
    fs.mkdirSync(path.join(args[3], "EnQuote.app", "Contents", "MacOS"), {recursive: true});
    fs.writeFileSync(path.join(args[3], "EnQuote.app", "Contents", "MacOS", "EnQuote"), "");
    return {status: 0};
  };
  let launched;
  const spawn = (command, args, options) => { launched = {command, args, options}; return {unref() {}}; };
  const result = prepareMacInstall({zipPath, bundlePath: "/Applications/EnQuote.app", pid: 7, tmpdir, logDir: tmpdir, spawn, spawnSync});
  assert.equal(launched.command, "/bin/bash");
  assert.equal(launched.options.detached, true);
  const script = fs.readFileSync(result.scriptPath, "utf8");
  assert.match(script, /PID=7/);
  assert.match(script, /TARGET='\/Applications\/EnQuote\.app'/);
});
