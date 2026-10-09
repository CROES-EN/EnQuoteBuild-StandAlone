// `npm run smoke` - builds nothing; tests the existing dist/ build. Exits non-zero on any failure.
const { spawnSync } = require("node:child_process");
const path = require("node:path");
const fs = require("node:fs");
const os = require("node:os");

const electron = require("electron");
const env = { ...process.env };
delete env.ELECTRON_RUN_AS_NODE;
const testDataDir = fs.mkdtempSync(path.join(os.tmpdir(), "enquote-smoke-"));
env.ENQUOTE_SMOKE_DATA_DIR = testDataDir;

let result;
try {
  result = spawnSync(electron, [path.join(__dirname, "smoke", "main.cjs"), ...process.argv.slice(2)], {
    stdio: "inherit",
    env,
    timeout: 5 * 60 * 1000
  });
} finally {
  try {
    fs.rmSync(testDataDir, {recursive: true, force: true, maxRetries: 5, retryDelay: 100});
  } catch (cleanupError) {
    if (!result?.error) throw cleanupError;
    console.warn(`Could not clean smoke-test data after process failure: ${cleanupError.message}`);
  }
}
if (result.error) throw result.error;
process.exit(result.status ?? 1);
