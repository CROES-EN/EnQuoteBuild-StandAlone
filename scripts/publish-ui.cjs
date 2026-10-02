// Publishes a UI-only hotfix to every installed copy of the CURRENT release, with no new installer.
//
//   node scripts/publish-ui.cjs --notes "Fixes the Workload filter"            (stable: everyone)
//   node scripts/publish-ui.cjs --notes "..." --channel beta                   (testers only)
//   node scripts/publish-ui.cjs --promote                                      (beta -> stable)
//   node scripts/publish-ui.cjs --withdraw [--channel beta]                    (stop offering updates)
//
// Safe by construction: it refuses unless main-process files are identical to the released tag
// (a UI that needs newer main-process code needs a full release), builds, runs the smoke test on
// the build, signs the manifest with the private key in _private/, and verifies what it uploaded.
// People get the update within ~15 minutes (or on next launch) and choose when to reload.
const crypto = require("node:crypto");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { spawnSync } = require("node:child_process");
const { buildBundle, signManifest } = require("./lib/uiBundle.cjs");
const { verifyManifest } = require("../electron/uiUpdate.cjs");

const root = path.resolve(__dirname, "..");
const workerDir = path.join(root, "enquote-sync-worker");
const WORKER_URL = "https://enquote-sync.croeschberger.workers.dev";
const PRIVATE_KEY_PATH = path.join(root, "_private", "ui-signing-key.pem");
const PUBLIC_KEY_PATH = path.join(root, "electron", "uiUpdatePublicKey.pem");

function parseArgs(argv) {
  const args = { channel: "stable", notes: "", promote: false, withdraw: false, skipBuild: false, skipSmoke: false };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === "--channel") args.channel = argv[++i];
    else if (arg === "--notes") args.notes = argv[++i] || "";
    else if (arg === "--promote") args.promote = true;
    else if (arg === "--withdraw") args.withdraw = true;
    else if (arg === "--skip-build") args.skipBuild = true;
    else if (arg === "--skip-smoke") args.skipSmoke = true;
    else throw new Error(`Unknown argument: ${arg}`);
  }
  if (!["stable", "beta"].includes(args.channel)) throw new Error('--channel must be "stable" or "beta".');
  return args;
}

function run(command, commandArgs, options = {}) {
  const result = spawnSync(command, commandArgs, {
    cwd: options.cwd || root,
    encoding: "utf8",
    stdio: options.capture ? ["ignore", "pipe", "pipe"] : "inherit",
    shell: options.shell === true
  });
  if (result.error) throw result.error;
  if (result.status !== 0) {
    throw new Error(`${command} ${commandArgs.join(" ")} failed (exit ${result.status}).${options.capture ? `\n${result.stdout}${result.stderr}` : ""}`);
  }
  return options.capture ? result.stdout.trim() : "";
}

function readEnv() {
  const env = {};
  for (const line of fs.readFileSync(path.join(root, ".env"), "utf8").split(/\r?\n/)) {
    const match = /^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/.exec(line);
    if (match) env[match[1]] = match[2].replace(/^["']|["']$/g, "");
  }
  return env;
}

function kvNamespaceId() {
  const text = fs.readFileSync(path.join(workerDir, "wrangler.jsonc"), "utf8");
  const match = /"kv_namespaces"[\s\S]*?"id"\s*:\s*"([0-9a-f]{32})"/.exec(text);
  if (!match) throw new Error("Could not find the KV namespace id in wrangler.jsonc.");
  return match[1];
}

function kvPut(key, filePath) {
  run("npx", ["wrangler", "kv", "key", "put", key, `--namespace-id=${kvNamespaceId()}`, `--path=${filePath}`, "--remote"], { cwd: workerDir, shell: true });
}

function kvDelete(key) {
  run("npx", ["wrangler", "kv", "key", "delete", key, `--namespace-id=${kvNamespaceId()}`, "--remote"], { cwd: workerDir, shell: true });
}

async function fetchManifest(env, channel) {
  const response = await fetch(`${WORKER_URL}/api/ui/manifest?channel=${channel}`, {
    headers: {
      Authorization: `Bearer ${env.OUTBOUND_TOKEN}`,
      "CF-Access-Client-Id": env.CF_ACCESS_CLIENT_ID || "",
      "CF-Access-Client-Secret": env.CF_ACCESS_CLIENT_SECRET || ""
    }
  });
  const body = await response.json();
  if (!response.ok || !body.ok) throw new Error(`Could not read the ${channel} manifest: ${body.error || response.status}`);
  return body.manifest;
}

function writeTemp(name, content) {
  const file = path.join(os.tmpdir(), `enquote-ui-${process.pid}-${name}`);
  fs.writeFileSync(file, content);
  return file;
}

function assertReleasedAndMainUnchanged(version) {
  const tag = `v${version}`;
  if (!run("git", ["ls-remote", "--tags", "origin", `refs/tags/${tag}`], { capture: true })) {
    throw new Error(`${tag} has not been released. UI updates only apply on top of a released version - ship a full release first.`);
  }
  run("git", ["fetch", "--quiet", "origin", `refs/tags/${tag}:refs/tags/${tag}`, "--no-tags"], { capture: true });
  const changed = run("git", ["diff", "--name-only", tag, "--", "electron", "package.json"], { capture: true })
    .split(/\r?\n/).filter(Boolean)
    // Dev-only files that are not part of what the installed app runs.
    .filter((file) => !file.endsWith(".test.cjs"));
  if (changed.length > 0) {
    throw new Error(`Main-process files changed since ${tag}, so a UI-only update could break installed copies:\n  ${changed.join("\n  ")}\nShip a full release instead.`);
  }
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const env = readEnv();
  const version = JSON.parse(fs.readFileSync(path.join(root, "package.json"), "utf8")).version;
  const publicKeyPem = fs.readFileSync(PUBLIC_KEY_PATH, "utf8");

  if (args.withdraw) {
    kvDelete(`ui:manifest:${args.channel}`);
    console.log(`Withdrew the ${args.channel} UI update. Installed copies keep the UI they already have.`);
    return;
  }

  if (args.promote) {
    const beta = await fetchManifest(env, "beta");
    if (!beta) throw new Error("There is no beta update to promote.");
    verifyManifest(beta, publicKeyPem);
    kvPut("ui:manifest:stable", writeTemp("promote.json", JSON.stringify(beta)));
    console.log(`Promoted beta ${JSON.parse(beta.payload).uiVersion} to stable.`);
    return;
  }

  if (!args.notes.trim()) throw new Error('Describe the fix: --notes "what changed" (shown to people in the update banner).');
  if (!fs.existsSync(PRIVATE_KEY_PATH)) throw new Error(`Signing key not found at ${PRIVATE_KEY_PATH}.`);

  assertReleasedAndMainUnchanged(version);

  if (!args.skipBuild) {
    console.log("Building the UI...");
    run("npm", ["run", "build"], { shell: true });
  }
  if (!args.skipSmoke) {
    console.log("Smoke-testing the build...");
    run(process.execPath, [path.join(__dirname, "smoke-test.cjs")]);
  }

  const bundle = buildBundle(path.join(root, "dist"));
  const uiVersion = `${version}+${Math.floor(Date.now() / 1000)}`;
  const manifest = {
    uiVersion,
    baseAppVersion: version,
    minAppVersion: version,
    bundleSha256: bundle.sha256,
    bundleSize: bundle.size,
    publishedAt: new Date().toISOString(),
    notes: args.notes.trim().slice(0, 400),
    commit: run("git", ["rev-parse", "--short", "HEAD"], { capture: true })
  };
  const envelope = signManifest(manifest, fs.readFileSync(PRIVATE_KEY_PATH, "utf8"));
  verifyManifest(envelope, publicKeyPem);

  console.log(`Uploading ${bundle.fileCount} files (${(bundle.size / 1e6).toFixed(2)} MB compressed) as ${uiVersion} to ${args.channel}...`);
  kvPut(`ui:bundle:${bundle.sha256}`, writeTemp("bundle.gz", bundle.gz));
  kvPut(`ui:manifest:${args.channel}`, writeTemp("manifest.json", JSON.stringify(envelope)));

  const published = await fetchManifest(env, args.channel);
  const check = verifyManifest(published, publicKeyPem);
  if (check.uiVersion !== uiVersion) throw new Error("The published manifest does not match what was uploaded.");
  const download = await fetch(`${WORKER_URL}/api/ui/bundle?sha=${bundle.sha256}`, {
    headers: { Authorization: `Bearer ${env.OUTBOUND_TOKEN}`, "CF-Access-Client-Id": env.CF_ACCESS_CLIENT_ID || "", "CF-Access-Client-Secret": env.CF_ACCESS_CLIENT_SECRET || "" }
  });
  const downloaded = Buffer.from(await download.arrayBuffer());
  if (crypto.createHash("sha256").update(downloaded).digest("hex") !== bundle.sha256) throw new Error("The uploaded bundle does not download back intact.");

  console.log(`\nPublished UI ${uiVersion} to the ${args.channel} channel and verified the download.`);
  console.log(args.channel === "beta"
    ? 'Testers opt in by putting "beta" in ui-channel.txt in their app data folder. Run with --promote to release it to everyone.'
    : "Installed copies of " + version + " will offer a reload within about 15 minutes, or apply it on next launch.");
}

main().catch((error) => {
  console.error(`\nPublish failed: ${error.message}`);
  process.exitCode = 1;
});
