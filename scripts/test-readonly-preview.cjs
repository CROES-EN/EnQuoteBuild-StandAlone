const {spawnSync} = require("node:child_process");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const directory = fs.mkdtempSync(path.join(os.tmpdir(), "enquote-readonly-test-"));
const env = {...process.env, ENQUOTE_PREVIEW_TEST_DIR: directory};
delete env.ELECTRON_RUN_AS_NODE;
let result;
try {
  result = spawnSync(require("electron"), [path.join(__dirname, "../tests/electron/readonlyPreview.smoke.cjs")], {env, stdio: "inherit", timeout: 90000});
} finally {
  fs.rmSync(directory, {recursive: true, force: true, maxRetries: 5, retryDelay: 100});
}
if (result.error) throw result.error;
process.exit(result.status ?? 1);
