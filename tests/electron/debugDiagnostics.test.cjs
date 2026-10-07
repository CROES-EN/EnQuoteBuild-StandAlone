const assert = require("node:assert/strict");
const test = require("node:test");
const fs = require("node:fs/promises");
const os = require("node:os");
const path = require("node:path");
const vm = require("node:vm");
const {EventEmitter} = require("node:events");
const {installationLocation, createUpdateState, inspectRuntime, inspectCareTable} = require("../../electron/debugDiagnostics.cjs");

test("Mac installation locations distinguish DMG, translocation and Applications", () => {
  assert.equal(installationLocation("/Volumes/EnQuote/EnQuote.app/Contents/Resources/app.asar", "darwin"), "mounted-disk-image");
  assert.equal(installationLocation("/private/var/folders/a/AppTranslocation/b/d/EnQuote.app", "darwin"), "app-translocation");
  assert.equal(installationLocation("/Applications/EnQuote.app/Contents/Resources/app.asar", "darwin"), "applications-folder");
  assert.equal(installationLocation("/Users/test/Applications/EnQuote.app", "darwin"), "applications-folder");
  assert.equal(installationLocation("/Users/test/Downloads/EnQuote.app", "darwin"), "other");
  assert.equal(installationLocation("C:\\Applications\\EnQuote", "win32"), "not-macos");
});

test("installer state retains errors after subsequent activity and copies state", () => {
  const tracker = createUpdateState({now: () => "now"});
  assert.equal(tracker.get(), null);
  tracker.record("error", {message: "invalid signature"});
  tracker.record("checking");
  const snapshot = tracker.get();
  assert.equal(snapshot.status, "checking");
  assert.equal(snapshot.lastError.message, "invalid signature");
  snapshot.lastError.message = "changed";
  assert.equal(tracker.get().lastError.message, "invalid signature");
});

test("native inspection is read-only, surfaces malformed large tables and missing storage", async () => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), "enquote-debug-"));
  try {
    const app = {
      getPath: () => directory, getVersion: () => "1.3.0", getAppPath: () => "/Applications/EnQuote.app",
      isPackaged: true, runningUnderARM64Translation: true
    };
    const result = await inspectRuntime({app, hasIdentity: true, hasSyncCredentials: false, uiInfo: {uiVersion: null}});
    assert.equal(result.storage.readableAndWritable, true);
    assert.equal(result.runningUnderARM64Translation, true);
    assert.equal(result.syncCredentialsAvailable, false);
    assert.equal(JSON.stringify(result).includes(directory), false);
    assert.equal((await inspectCareTable(directory)).present, false);
    await fs.mkdir(path.join(directory, "large-tables"));
    const file = path.join(directory, "large-tables", "care_subscriptions.json");
    await fs.writeFile(file, "{broken");
    assert.equal((await inspectCareTable(directory)).present, null);
    assert.equal(await fs.readFile(file, "utf8"), "{broken");
    await fs.writeFile(file, JSON.stringify({rows: [{name: "private"}], updated_date: "now"}));
    const care = await inspectCareTable(directory);
    assert.equal(care.rowCount, 1);
    assert.equal(JSON.stringify(care).includes("private"), false);
    app.getPath = () => path.join(directory, "missing");
    assert.equal((await inspectRuntime({app})).storage.readableAndWritable, false);
  } finally {
    await fs.rm(directory, {recursive: true, force: true});
  }
});

async function mainSource() {
  return fs.readFile(path.join(__dirname, "../../electron/main.cjs"), "utf8");
}

test("real installer controller retains a failed check and respects a ready update", async () => {
  const source = await mainSource();
  const code = source.slice(source.indexOf("function configureAutoUpdater()"), source.indexOf("const UPDATE_CHECK_INTERVAL_MS"));
  const autoUpdater = new EventEmitter();
  const state = createUpdateState();
  autoUpdater.setFeedURL = () => {};
  autoUpdater.checkForUpdates = async () => {throw new Error("feed unavailable");};
  autoUpdater.downloadUpdate = async () => {};
  let installed = false;
  autoUpdater.quitAndInstall = () => {installed = true;};
  const controller = vm.runInNewContext(`${code}\nconfigureAutoUpdater()`, {
    autoUpdater, isPackaged: true, process: {env: {}}, console: {log() {}, error() {}},
    sendStatus: (status, details) => state.record(status, details),
    installerUpdateState: state, setTimeout: () => ({unref() {}})
  });
  assert.equal((await controller.checkForUpdates()).ok, false);
  assert.equal(controller.getState().status, "error");
  assert.equal(controller.getState().message, "feed unavailable");
  autoUpdater.emit("update-available", {version: "1.4.0"});
  autoUpdater.emit("update-downloaded");
  assert.equal((await controller.checkForUpdates()).reason, "restart-required");
  assert.equal(controller.getState().status, "ready");
  assert.equal(controller.getState().lastError.message, "feed unavailable");
  assert.equal(controller.installNow(), true);
  assert.equal(installed, true);
});

test("startup updater removes listeners after no-update, failure or timeout", async () => {
  const source = await mainSource();
  const code = source.slice(source.indexOf("async function runStartupUpdateCheck()"), source.indexOf("\nlet mainWindow;"));
  for (const outcome of ["update-not-available", "error", "timeout"]) {
    const updater = new EventEmitter();
    let timeout;
    updater.checkForUpdates = async () => {
      if (outcome !== "timeout") updater.emit(outcome, new Error("offline"));
    };
    const run = vm.runInNewContext(`${code}\nrunStartupUpdateCheck`, {
      isPackaged: true, autoUpdater: updater,
      updateCheckController: {beginStartupCheck() {}, endStartupCheck() {}},
      setTimeout: callback => {timeout = callback; return 1;}, clearTimeout() {},
      STARTUP_UPDATE_CHECK_TIMEOUT_MS: 10, STARTUP_UPDATE_DOWNLOAD_MAX_MS: 100,
      setStartupSplashStatus() {}, showStartupSplash() {},
      console: {error() {}}
    });
    const promise = run();
    if (outcome === "timeout") timeout();
    await promise;
    assert.equal(updater.eventNames().length, 0, outcome);
  }
});

test("Mac packaging produces unique platform/architecture filenames and retains ZIP updates", async () => {
  const pkg = JSON.parse(await fs.readFile(path.join(__dirname, "../../package.json"), "utf8"));
  assert.equal(pkg.build.artifactName, "EnQuote-Setup-${version}.${ext}");
  const names = [];
  for (const target of pkg.build.mac.target) {
    for (const arch of target.arch) {
      names.push(pkg.build.mac.artifactName.replace("${version}", pkg.version).replace("${arch}", arch).replace("${ext}", target.target));
    }
  }
  assert.equal(names.length, 4);
  assert.equal(new Set(names).size, 4);
  assert.ok(names.some(name => name.endsWith("arm64.zip")));
  assert.ok(names.some(name => name.endsWith("x64.zip")));
});
