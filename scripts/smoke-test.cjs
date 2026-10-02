// `npm run smoke` - builds nothing; tests the existing dist/ build. Exits non-zero on any failure.
const { spawnSync } = require("node:child_process");
const path = require("node:path");

const electron = require("electron");
const env = { ...process.env };
delete env.ELECTRON_RUN_AS_NODE;

const result = spawnSync(electron, [path.join(__dirname, "smoke", "main.cjs")], {
  stdio: "inherit",
  env,
  timeout: 5 * 60 * 1000
});
if (result.error) throw result.error;
process.exit(result.status ?? 1);
