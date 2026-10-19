// Installs Mac updates without Squirrel.Mac. Squirrel requires a Developer ID signature that
// matches the running app, which unsigned builds never have. electron-updater still downloads
// the ZIP and verifies its sha512 from latest-mac.yml; this module only swaps the app bundle.
const childProcess = require("node:child_process");
const nodeFs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

function appBundlePath(executablePath) {
  const match = /^(.*?\.app)(?:\/|$)/.exec(executablePath || "");
  return match ? match[1] : null;
}

function selfInstallBlockedReason(bundlePath, {fs = nodeFs} = {}) {
  if (!bundlePath) return "EnQuote could not locate its app bundle.";
  try {
    fs.accessSync(path.posix.dirname(bundlePath), fs.constants.W_OK);
    fs.accessSync(bundlePath, fs.constants.W_OK);
    return null;
  } catch {
    return `EnQuote cannot update itself because this Mac user cannot modify ${bundlePath}. Download the latest Mac app and replace EnQuote in Applications.`;
  }
}

const quote = value => `'${String(value).replace(/'/g, "'\\''")}'`;

function installerScript({pid, target, staged, stagingDir, relaunch}) {
  const backup = `${target}.enquote-previous`;
  return `#!/bin/bash
set -u
PID=${Number(pid)}
TARGET=${quote(target)}
STAGED=${quote(staged)}
STAGING=${quote(stagingDir)}
BACKUP=${quote(backup)}
for _ in $(seq 1 120); do kill -0 "$PID" 2>/dev/null || break; sleep 0.5; done
echo "[enquote-update] replacing $TARGET"
rm -rf "$BACKUP"
if mv "$TARGET" "$BACKUP"; then
  if ditto "$STAGED" "$TARGET" && [ -x "$TARGET/Contents/MacOS/EnQuote" ]; then
    xattr -dr com.apple.quarantine "$TARGET" 2>/dev/null || true
    codesign --verify --deep "$TARGET" 2>/dev/null || codesign --force --deep --sign - "$TARGET" || true
    rm -rf "$BACKUP"
    echo "[enquote-update] installed"
  else
    echo "[enquote-update] copy failed; restoring previous version"
    rm -rf "$TARGET"
    mv "$BACKUP" "$TARGET"
  fi
else
  echo "[enquote-update] could not move the current app aside"
fi
rm -rf "$STAGING"
${relaunch ? 'open "$TARGET"' : ""}
`;
}

// Extracts and validates the update now (while EnQuote is still running, so failures can be
// reported), then hands the bundle swap to a detached script that waits for EnQuote to exit.
function prepareMacInstall({zipPath, bundlePath, pid = process.pid, relaunch = true, logDir,
  fs = nodeFs, spawnSync = childProcess.spawnSync, spawn = childProcess.spawn, tmpdir = os.tmpdir()}) {
  if (!zipPath || !fs.existsSync(zipPath)) throw new Error("The downloaded Mac update is missing. Check for updates again.");
  const stagingDir = fs.mkdtempSync(path.join(tmpdir, "enquote-update-"));
  const extracted = spawnSync("/usr/bin/ditto", ["-x", "-k", zipPath, stagingDir], {encoding: "utf8", timeout: 180000});
  if (extracted.error || extracted.status !== 0) {
    fs.rmSync(stagingDir, {recursive: true, force: true});
    throw new Error(`Could not unpack the Mac update (${extracted.error?.message || extracted.stderr || extracted.status}).`);
  }
  const appName = fs.readdirSync(stagingDir).find(name => name.endsWith(".app"));
  const staged = appName && path.posix.join(stagingDir, appName);
  if (!staged || !fs.existsSync(path.posix.join(staged, "Contents", "MacOS", "EnQuote"))) {
    fs.rmSync(stagingDir, {recursive: true, force: true});
    throw new Error("The Mac update did not contain EnQuote.app.");
  }
  const scriptPath = path.posix.join(stagingDir, "install.sh");
  fs.writeFileSync(scriptPath, installerScript({pid, target: bundlePath, staged, stagingDir, relaunch}), {mode: 0o700});
  const logPath = path.join(logDir || tmpdir, "enquote-mac-update.log");
  const log = fs.openSync(logPath, "a");
  const child = spawn("/bin/bash", [scriptPath], {detached: true, stdio: ["ignore", log, log]});
  child.unref();
  fs.closeSync(log);
  return {scriptPath, logPath};
}

module.exports = {appBundlePath, selfInstallBlockedReason, installerScript, prepareMacInstall};
