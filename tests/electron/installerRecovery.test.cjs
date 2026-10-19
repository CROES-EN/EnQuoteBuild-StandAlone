const test = require("node:test");
const assert = require("node:assert/strict");
const {EventEmitter} = require("node:events");
const {manualUpdateReason, waitForStartupUpdate} = require("../../electron/installerRecovery.cjs");

test("Mac automatic installation requires a Developer ID signature and avoids disk images or translocation", () => {
  const options = {platform: "darwin", appPath: "/Applications/EnQuote.app/Contents/Resources/app.asar",
    executablePath: "/Applications/EnQuote.app/Contents/MacOS/EnQuote"};
  assert.equal(manualUpdateReason({...options, inspectSignature: () => "Authority=Developer ID Application: Enphase (TEAM)\n"}), null);
  assert.match(manualUpdateReason({...options, inspectSignature: () => "Signature=adhoc\n"}), /Developer ID/);
  assert.match(manualUpdateReason({...options, inspectSignature: () => { throw new Error("unsigned"); }}), /unavailable/);
  for (const appPath of ["/Volumes/EnQuote/EnQuote.app", "/private/var/folders/test/AppTranslocation/test/EnQuote.app"]) {
    assert.match(manualUpdateReason({...options, appPath, inspectSignature: () => { throw new Error("must not run"); }}), /Applications/);
  }
  assert.equal(manualUpdateReason({platform: "win32"}), null);
});

function fixture({manualReason = null} = {}) {
  const updater = new EventEmitter(), timers = new Map(), errors = [], statuses = [], failures = [];
  let timerId = 0, downloads = 0, installs = 0, ended = 0;
  updater.checkForUpdates = async () => {};
  updater.downloadUpdate = async () => { downloads++; };
  updater.quitAndInstall = () => { installs++; };
  const promise = waitForStartupUpdate({
    updater, controller: {manualReason, beginStartupCheck() {}, endStartupCheck() { ended++; },
      installationFailed: error => failures.push(error.message)},
    setStatus: (...args) => statuses.push(args), logger: {error: (...args) => errors.push(args)},
    setTimer: (callback, delay) => { const id = ++timerId; timers.set(id, {callback, delay}); return id; },
    clearTimer: id => timers.delete(id)
  });
  return {updater, timers, promise, errors, statuses, failures,
    counts: () => ({downloads, installs, ended}),
    fire(delay) {
      const entry = [...timers].find(([, timer]) => timer.delay === delay);
      assert.ok(entry, `expected a ${delay}ms timer`);
      timers.delete(entry[0]);
      entry[1].callback();
    }};
}

test("unsigned Mac updates continue startup without downloading or installing", async () => {
  const f = fixture({manualReason: "Unsigned app"});
  f.updater.emit("update-available", {version: "2.0.0"});
  await f.promise;
  assert.deepEqual(f.counts(), {downloads: 0, installs: 0, ended: 1});
  assert.equal(f.timers.size, 0);
});

test("installation errors after download recover startup instead of hanging", async () => {
  const f = fixture();
  f.updater.emit("update-available", {});
  await Promise.resolve();
  f.updater.emit("update-downloaded");
  f.fire(4000);
  assert.equal(f.counts().installs, 1);
  f.updater.emit("error", new Error("Squirrel signature validation failed"));
  await f.promise;
  assert.match(f.failures[0], /signature/);
  assert.equal(f.timers.size, 0);
  assert.equal(f.updater.listenerCount("error"), 0);
});

test("an installer that never exits has a bounded recovery timeout", async () => {
  const f = fixture();
  f.updater.emit("update-downloaded");
  f.fire(4000);
  f.fire(90000);
  await f.promise;
  assert.match(f.failures[0], /did not restart/);
  assert.equal(f.counts().ended, 1);
});

test("synchronous installation failure is reported and startup continues", async () => {
  const f = fixture();
  f.updater.quitAndInstall = () => { throw new Error("Installer unavailable"); };
  f.updater.emit("update-downloaded");
  f.fire(4000);
  await f.promise;
  assert.deepEqual(f.failures, ["Installer unavailable"]);
});

test("no update and unreachable update service both allow startup", async () => {
  for (const action of ["no-update", "timeout"]) {
    const f = fixture();
    if (action === "no-update") f.updater.emit("update-not-available", {version: "1.4.1"});
    else f.fire(10000);
    await f.promise;
    assert.equal(f.errors.length, 0);
    assert.equal(f.counts().ended, 1);
  }
});

test("download phase replaces the short check timeout and recovers a stalled download", async () => {
  const f = fixture();
  f.updater.emit("update-available", {});
  await Promise.resolve();
  assert.equal([...f.timers.values()].some(timer => timer.delay === 10000), false);
  assert.equal(f.counts().downloads, 1);
  f.fire(600000);
  await f.promise;
  assert.match(f.failures[0], /download timed out/);
});
