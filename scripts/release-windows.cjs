const fs = require("node:fs");
const path = require("node:path");
const https = require("node:https");
const { spawnSync } = require("node:child_process");
const readline = require("node:readline/promises");
const { stdin, stdout } = require("node:process");

const root = path.resolve(__dirname, "..");
const packagePath = path.join(root, "package.json");
const lockPath = path.join(root, "package-lock.json");
const owner = "CROES-EN";
const repository = "EnQuoteBuild-StandAlone";
const coauthor = "Co-authored-by: Copilot <223556219+Copilot@users.noreply.github.com>";

function run(command, args, options = {}) {
  const result = spawnSync(command, args, {
    cwd: options.cwd || root,
    env: options.env || process.env,
    encoding: "utf8",
    stdio: options.capture ? ["ignore", "pipe", "pipe"] : "inherit",
    shell: process.platform === "win32" && options.shell === true
  });
  if (result.error) throw result.error;
  if (result.status !== 0) {
    const details = options.capture ? `${result.stdout}${result.stderr}` : "";
    throw new Error(`${command} ${args.join(" ")} failed with exit code ${result.status}.${details ? `\n${details}` : ""}`);
  }
  return options.capture ? result.stdout.trim() : "";
}

function bumpVersion(version, bump) {
  const match = /^(\d+)\.(\d+)\.(\d+)$/.exec(version);
  if (!match) throw new Error(`Expected a stable semantic version, received "${version}".`);
  let [, major, minor, patch] = match.map(Number);
  if (bump === "major") {
    major += 1;
    minor = 0;
    patch = 0;
  } else if (bump === "minor") {
    minor += 1;
    patch = 0;
  } else {
    patch += 1;
  }
  return `${major}.${minor}.${patch}`;
}

function requestJson(method, requestPath, token, body) {
  return new Promise((resolve, reject) => {
    const payload = body == null ? null : Buffer.from(JSON.stringify(body));
    const request = https.request({
      hostname: "api.github.com",
      path: requestPath,
      method,
      headers: {
        Accept: "application/vnd.github+json",
        "X-GitHub-Api-Version": "2022-11-28",
        "User-Agent": "EnQuote-Windows-Release",
        Authorization: `Bearer ${token}`,
        ...(payload ? { "Content-Type": "application/json", "Content-Length": payload.length } : {})
      }
    }, (response) => {
      let raw = "";
      response.setEncoding("utf8");
      response.on("data", (chunk) => { raw += chunk; });
      response.on("end", () => {
        let parsed;
        try {
          parsed = raw ? JSON.parse(raw) : {};
        } catch {
          reject(new Error(`GitHub API returned non-JSON content (HTTP ${response.statusCode}).`));
          return;
        }
        if (response.statusCode < 200 || response.statusCode >= 300) {
          reject(new Error(`GitHub API ${method} failed (HTTP ${response.statusCode}): ${parsed.message || raw}`));
          return;
        }
        resolve(parsed);
      });
    });
    request.on("error", reject);
    request.setTimeout(30000, () => request.destroy(new Error("GitHub API request timed out.")));
    if (payload) request.write(payload);
    request.end();
  });
}

// Creates the release as a DRAFT, uploads each file one at a time, then publishes it. Letting
// electron-builder upload in parallel created two releases with the same tag (each upload raced
// to create it), splitting the files between them. A draft is invisible to the updater, so
// people never see a half-uploaded release.
function uploadAsset(uploadUrlTemplate, filePath, token) {
  const name = path.basename(filePath);
  const size = fs.statSync(filePath).size;
  const url = new URL(`${uploadUrlTemplate.replace(/\{\?name,label\}$/, "")}?name=${encodeURIComponent(name)}`);
  return new Promise((resolve, reject) => {
    const request = https.request({
      hostname: url.hostname,
      path: `${url.pathname}${url.search}`,
      method: "POST",
      headers: {
        Accept: "application/vnd.github+json",
        "User-Agent": "EnQuote-Windows-Release",
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/octet-stream",
        "Content-Length": size
      }
    }, (response) => {
      let raw = "";
      response.setEncoding("utf8");
      response.on("data", (chunk) => { raw += chunk; });
      response.on("end", () => {
        if (response.statusCode < 200 || response.statusCode >= 300) {
          reject(new Error(`Uploading ${name} failed (HTTP ${response.statusCode}): ${raw.slice(0, 300)}`));
          return;
        }
        resolve();
      });
    });
    request.on("error", reject);
    request.setTimeout(15 * 60 * 1000, () => request.destroy(new Error(`Uploading ${name} timed out.`)));
    fs.createReadStream(filePath).on("error", reject).pipe(request);
  });
}

async function publishToGitHub(version, notes, token) {
  const tag = `v${version}`;
  const basePath = `/repos/${owner}/${repository}`;
  const existing = await requestJson("GET", `${basePath}/releases?per_page=30`, token);
  if (existing.some((release) => release.tag_name === tag)) {
    throw new Error(`A GitHub release for ${tag} already exists. Delete it (and re-run) or choose a different version.`);
  }
  const releaseDir = path.join(root, "release");
  const files = [`EnQuote-Setup-${version}.exe.blockmap`, `EnQuote-Setup-${version}.exe`, "latest.yml"].map((name) => path.join(releaseDir, name));
  for (const file of files) {
    if (!fs.existsSync(file)) throw new Error(`Expected build output is missing: ${file}`);
  }
  const draft = await requestJson("POST", `${basePath}/releases`, token, {
    tag_name: tag, name: tag, body: `## ${tag}\n\n${notes}`, draft: true, prerelease: false
  });
  try {
    for (const file of files) {
      console.log(`Uploading ${path.basename(file)}...`);
      await uploadAsset(draft.upload_url, file, token);
    }
    // latest.yml goes up last above, so the release only becomes visible once everything is in.
    await requestJson("PATCH", `${basePath}/releases/${draft.id}`, token, { draft: false });
  } catch (error) {
    console.error(`Upload failed. The draft release ${tag} was left in place on GitHub (it is invisible to users); delete it before retrying.`);
    throw error;
  }
}

async function publishReleaseNotes(version, notes, token) {
  const tag = `v${version}`;
  const basePath = `/repos/${owner}/${repository}`;
  const release = await requestJson("GET", `${basePath}/releases/tags/${tag}`, token);
  const updated = await requestJson("PATCH", `${basePath}/releases/${release.id}`, token, {
    body: `## ${tag}\n\n${notes}`
  });

  const assetNames = new Set((updated.assets || []).map((asset) => asset.name));
  const installer = `EnQuote-Setup-${version}.exe`;
  for (const requiredAsset of [installer, `${installer}.blockmap`, "latest.yml"]) {
    if (!assetNames.has(requiredAsset)) {
      throw new Error(`Release ${tag} is missing expected updater asset "${requiredAsset}".`);
    }
  }

  const manifestUrl = `https://github.com/${owner}/${repository}/releases/download/${tag}/latest.yml`;
  const manifest = await new Promise((resolve, reject) => {
    https.get(manifestUrl, (response) => {
      if (response.statusCode !== 200) {
        response.resume();
        reject(new Error(`Could not verify the published updater manifest (HTTP ${response.statusCode}).`));
        return;
      }
      let content = "";
      response.setEncoding("utf8");
      response.on("data", (chunk) => { content += chunk; });
      response.on("end", () => resolve(content));
    }).on("error", reject);
  });
  if (!new RegExp(`^version:\\s*${version.replaceAll(".", "\\.")}\\s*$`, "m").test(manifest)) {
    throw new Error(`Published latest.yml does not report version ${version}.`);
  }
  return updated.html_url;
}

function findTestFiles(directory) {
  if (!fs.existsSync(directory)) return [];
  return fs.readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const entryPath = path.join(directory, entry.name);
    if (entry.isDirectory()) return findTestFiles(entryPath);
    return /\.(test|spec)\.cjs$/.test(entry.name) ? [entryPath] : [];
  });
}

async function main() {
  const args = new Set(process.argv.slice(2));
  const packageJson = JSON.parse(fs.readFileSync(packagePath, "utf8"));
  const packageLock = JSON.parse(fs.readFileSync(lockPath, "utf8"));
  const originalVersion = packageJson.version;

  if (args.has("--help")) {
    console.log("Run without arguments for an interactive Windows release. Use --dry-run to preview the next patch release.");
    return;
  }

  // Picks up a release whose commit and tag were already pushed but whose installer build or upload
  // failed: node scripts/release-windows.cjs --resume "release notes"
  if (args.has("--resume")) {
    const resumeNotes = process.argv.slice(2).filter((arg) => !arg.startsWith("--")).join(" ").trim();
    if (!resumeNotes) throw new Error("Pass the release notes after --resume.");
    const resumeToken = process.env.GH_TOKEN || process.env.GITHUB_TOKEN;
    if (!resumeToken) throw new Error("Set GH_TOKEN or GITHUB_TOKEN first.");
    const resumeVersion = packageJson.version;
    const tag = `v${resumeVersion}`;
    if (!run("git", ["ls-remote", "--tags", "origin", `refs/tags/${tag}`], { capture: true })) {
      throw new Error(`${tag} is not on GitHub yet - run a normal release instead of --resume.`);
    }
    if (run("git", ["status", "--porcelain"], { capture: true })) throw new Error("Working tree is not clean.");
    fs.rmSync(path.join(root, "release", "win-unpacked.tmp"), { recursive: true, force: true });
    console.log(`Resuming ${tag}: building the Windows installer...`);
    run("npx", ["electron-builder", "--win", "--publish", "never"], { shell: true });
    console.log("\nPublishing to GitHub (draft, upload, then publish)...");
    await publishToGitHub(resumeVersion, resumeNotes, resumeToken);
    const resumedUrl = await publishReleaseNotes(resumeVersion, resumeNotes, resumeToken);
    console.log(`\nRelease ${tag} is published: ${resumedUrl}`);
    return;
  }

  if (args.has("--dry-run")) {
    console.log(`Current version: ${packageJson.version}`);
    console.log(`Next patch version: ${bumpVersion(packageJson.version, "patch")}`);
    console.log(`Current branch: ${run("git", ["branch", "--show-current"], { capture: true }) || "(detached)"}`);
    console.log(`Working tree: ${run("git", ["status", "--short"], { capture: true }) ? "has changes (release is blocked until clean)" : "clean"}`);
    return;
  }

  if (packageLock.version !== packageJson.version || packageLock.packages?.[""]?.version !== packageJson.version) {
    throw new Error("package.json and package-lock.json versions are not aligned.");
  }
  if (run("git", ["status", "--porcelain"], { capture: true })) {
    throw new Error("Working tree is not clean. Commit or otherwise safely resolve all changes before releasing.");
  }
  if (run("git", ["diff", "--cached", "--name-only"], { capture: true })) {
    throw new Error("The Git index is not clean. Unstage or commit staged changes before releasing.");
  }
  const branch = run("git", ["branch", "--show-current"], { capture: true });
  if (!branch) throw new Error("Cannot release from a detached HEAD.");
  const remote = run("git", ["remote", "get-url", "origin"], { capture: true });
  if (!/github\.com[:/]CROES-EN\/EnQuoteBuild-StandAlone(?:\.git)?$/i.test(remote)) {
    throw new Error(`origin is not the expected EnQuote GitHub repository: ${remote}`);
  }
  const token = process.env.GH_TOKEN || process.env.GITHUB_TOKEN;
  if (!token) throw new Error("Set GH_TOKEN or GITHUB_TOKEN in the environment so electron-builder can publish to GitHub Releases.");

  const rl = readline.createInterface({ input: stdin, output: stdout });
  let version;
  let notes;
  let packageChanged = false;
  let releaseCommitted = false;

  try {
    const bump = (await rl.question("Version bump [patch/minor/major] or an exact version like 1.2.0 (patch): ")).trim().toLowerCase() || "patch";
    if (/^\d+\.\d+\.\d+$/.test(bump)) {
      const [a, b, c] = bump.split(".").map(Number);
      const [x, y, z] = packageJson.version.split(".").map(Number);
      if (a * 1e8 + b * 1e4 + c <= x * 1e8 + y * 1e4 + z) {
        throw new Error(`Version ${bump} must be newer than the current ${packageJson.version}.`);
      }
      version = bump;
    } else if (["patch", "minor", "major"].includes(bump)) {
      version = bumpVersion(packageJson.version, bump);
    } else {
      throw new Error(`Unknown version bump "${bump}".`);
    }
    const tag = `v${version}`;
    if (run("git", ["tag", "--list", tag], { capture: true })) {
      throw new Error(`Local tag ${tag} already exists; choose a different version bump.`);
    }
    if (run("git", ["ls-remote", "--tags", "origin", `refs/tags/${tag}`], { capture: true })) {
      throw new Error(`Remote tag ${tag} already exists; choose a different version bump.`);
    }
    notes = (await rl.question(`Release notes for v${version}: `)).trim();
    if (!notes) throw new Error("Release notes cannot be empty.");
    const confirmation = (await rl.question(`This will build, commit, tag, push, and publish v${version} from ${branch}. Continue? [y/N] `)).trim().toLowerCase();
    if (confirmation !== "y" && confirmation !== "yes") {
      console.log("Release cancelled; no files were changed.");
      return;
    }

    packageJson.version = version;
    packageLock.version = version;
    packageLock.packages[""].version = version;
    fs.writeFileSync(packagePath, `${JSON.stringify(packageJson, null, 4)}\n`);
    fs.writeFileSync(lockPath, `${JSON.stringify(packageLock, null, 4)}\n`);
    packageChanged = true;

    console.log("\nRunning application tests...");
    const appTests = findTestFiles(path.join(root, "tests"));
    if (!appTests.length) throw new Error("No application test files were found under tests/.");
    run(process.execPath, ["--test", ...appTests]);

    console.log("\nRunning Cloudflare Worker tests...");
    run("npm", ["test"], { cwd: path.join(root, "enquote-sync-worker"), shell: true });

    console.log("\nRunning typecheck...");
    run("npm", ["run", "typecheck"], { shell: true });

    console.log("\nBuilding renderer...");
    run("npm", ["run", "build"], { shell: true });

    console.log("\nSmoke-testing the build (every page must render cleanly)...");
    run(process.execPath, [path.join(__dirname, "smoke-test.cjs")]);

    console.log("\nCommitting the version bump...");
    run("git", ["add", "--", "package.json", "package-lock.json"]);
    run("git", ["commit", "-m", `Release v${version}`, "-m", coauthor]);
    packageChanged = false;
    releaseCommitted = true;

    run("git", ["tag", "-a", tag, "-m", `EnQuote ${tag}`]);
    run("git", ["push", "origin", `HEAD:${branch}`]);
    run("git", ["push", "origin", tag]);

    console.log("\nBuilding the Windows installer...");
    run("npx", ["electron-builder", "--win", "--publish", "never"], { shell: true });

    console.log("\nPublishing to GitHub (draft, upload, then publish)...");
    await publishToGitHub(version, notes, token);

    console.log("\nUpdating release notes and verifying updater assets...");
    const releaseUrl = await publishReleaseNotes(version, notes, token);
    console.log(`\nRelease v${version} is published: ${releaseUrl}`);
    console.log("Verify the in-app update on a test installation before announcing it to the team.");
  } catch (error) {
    if (packageChanged && !releaseCommitted) {
      fs.writeFileSync(packagePath, `${JSON.stringify({ ...packageJson, version: originalVersion }, null, 4)}\n`);
      fs.writeFileSync(lockPath, `${JSON.stringify({ ...packageLock, version: originalVersion, packages: {
        ...packageLock.packages,
        "": { ...packageLock.packages[""], version: originalVersion }
      } }, null, 4)}\n`);
      console.error("The version-only manifest edits were restored.");
    }
    if (releaseCommitted) {
      console.error(`Release source/tag steps may already be complete. Do not delete or recreate the tag blindly; inspect GitHub and the current tag before retrying.`);
      console.error(`If publishing failed, check GitHub for a leftover draft release for v${version} (delete it), then re-run the publish step - the installer is already built in release\\.`);
    }
    throw error;
  } finally {
    rl.close();
  }
}

main().catch((error) => {
  console.error(`\nRelease failed: ${error.message}`);
  process.exitCode = 1;
});
