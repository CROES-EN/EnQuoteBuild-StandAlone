const { Buffer } = require("node:buffer");
const crypto = require("node:crypto");
const fs = require("node:fs");
const path = require("node:path");
const zlib = require("node:zlib");

// Packs a built `dist` folder into the gzip bundle the app downloads, and signs the manifest that
// describes it. Used by scripts/publish-ui.cjs (and its tests). The private signing key never
// leaves the publisher's machine.

function listFiles(directory, base = directory) {
  return fs.readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const full = path.join(directory, entry.name);
    return entry.isDirectory() ? listFiles(full, base) : [path.relative(base, full).split(path.sep).join("/")];
  });
}

function buildBundle(distDir) {
  const files = {};
  for (const relative of listFiles(distDir)) {
    files[relative] = fs.readFileSync(path.join(distDir, ...relative.split("/"))).toString("base64");
  }
  if (!files["index.html"]) throw new Error(`${distDir} has no index.html - run the build first.`);
  const gz = zlib.gzipSync(Buffer.from(JSON.stringify({ files }), "utf8"), { level: 9 });
  return {
    gz,
    fileCount: Object.keys(files).length,
    sha256: crypto.createHash("sha256").update(gz).digest("hex"),
    size: gz.length
  };
}

function signManifest(manifest, privateKeyPem) {
  const payload = JSON.stringify(manifest);
  const signature = crypto.sign(null, Buffer.from(payload), privateKeyPem).toString("base64");
  return { payload, signature };
}

module.exports = { buildBundle, signManifest, listFiles };
