const {spawnSync} = require("node:child_process");
const process = require("node:process");

const RELEASE_URL = "https://github.com/CROES-EN/EnQuoteBuild-StandAlone/releases/latest";

function manualUpdateReason({platform = process.platform, appPath, executablePath,
  inspectSignature = executable => {
    const result = spawnSync("/usr/bin/codesign", ["-dv", "--verbose=4", executable],
      {encoding: "utf8", timeout: 5000});
    if (result.error) throw result.error;
    if (result.status !== 0) throw new Error(`codesign exited with status ${result.status}`);
    return result.stderr;
  }} = {}) {
  if (platform !== "darwin") return null;
  if (appPath.includes("/AppTranslocation/") || appPath.startsWith("/Volumes/")) {
    return "Move EnQuote to Applications, eject its disk image, and open the Applications copy before updating.";
  }
  try {
    // codesign writes signature details to stderr, including on successful inspection.
    const details = inspectSignature(executablePath);
    if (/^Authority=Developer ID Application:/m.test(details)) return null;
  } catch (error) {
    return `Automatic Mac installation is unavailable (${error.code || error.status || "signature inspection failed"}). Download the latest Mac app and replace EnQuote in Applications.`;
  }
  return UNSIGNED_MAC_REASON;
}

const UNSIGNED_MAC_REASON = "This Mac app does not have a Developer ID signature. Download the latest Mac app and replace EnQuote in Applications.";

function waitForStartupUpdate({updater, controller, setStatus, logger = console,
  install = () => updater.quitAndInstall(true, true),
  setTimer = setTimeout, clearTimer = clearTimeout,
  checkTimeout = 10000, downloadTimeout = 600000, installTimeout = 90000}) {
  return new Promise(resolve => {
    let settled = false, timeout, installTimer;
    controller?.beginStartupCheck();
    function arm(delay, message) {
      clearTimer(timeout);
      timeout = setTimer(() => finish(message ? new Error(message) : null), delay);
    }
    function finish(error) {
      if (settled) return;
      settled = true;
      clearTimer(timeout);
      clearTimer(installTimer);
      updater.removeListener("update-available", available);
      updater.removeListener("update-not-available", finish);
      updater.removeListener("error", finish);
      updater.removeListener("update-downloaded", downloaded);
      updater.removeListener("download-progress", progress);
      controller?.endStartupCheck();
      if (error instanceof Error) {
        logger.error("[updater] Startup update could not complete:", error.message);
        controller?.installationFailed?.(error);
      }
      setStatus("Starting EnQuote\u2026");
      resolve();
    }
    function progress(value) {
      const percent = Math.round(value.percent);
      setStatus(`Downloading update\u2026 ${percent}%`, percent);
    }
    function available() {
      if (controller?.manualReason) return finish();
      arm(downloadTimeout, "Update download timed out. Continue using EnQuote and retry later.");
      setStatus("Downloading update\u2026 0%", 0);
      Promise.resolve().then(() => updater.downloadUpdate()).catch(finish);
    }
    function downloaded() {
      if (settled) return;
      // Keep error handling alive while Squirrel validates/stages the Mac update.
      arm(installTimeout, "The installer did not restart EnQuote. Download the latest installer to update manually.");
      setStatus("Installing update\u2026 EnQuote will close and reopen on its own in about a minute.");
      installTimer = setTimer(() => {
        try { install(); } catch (error) { finish(error); }
      }, 4000);
    }
    updater.once("update-available", available);
    updater.once("update-not-available", finish);
    updater.once("error", finish);
    updater.once("update-downloaded", downloaded);
    updater.on("download-progress", progress);
    arm(checkTimeout);
    Promise.resolve().then(() => updater.checkForUpdates()).catch(finish);
  });
}

module.exports = {manualUpdateReason, waitForStartupUpdate, RELEASE_URL, UNSIGNED_MAC_REASON};
