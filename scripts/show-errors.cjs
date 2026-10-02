// Shows recent error reports sent by the desktop apps:
//   node scripts/show-errors.cjs                (last 7 days)
//   node scripts/show-errors.cjs --days 1 --limit 20
const fs = require("node:fs");
const path = require("node:path");

const root = path.resolve(__dirname, "..");
const WORKER_URL = "https://enquote-sync.croeschberger.workers.dev";

function readEnv() {
  const env = {};
  for (const line of fs.readFileSync(path.join(root, ".env"), "utf8").split(/\r?\n/)) {
    const match = /^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/.exec(line);
    if (match) env[match[1]] = match[2].replace(/^["']|["']$/g, "");
  }
  return env;
}

async function main() {
  const argv = process.argv.slice(2);
  const option = (name, fallback) => { const i = argv.indexOf(name); return i >= 0 ? Number(argv[i + 1]) : fallback; };
  const days = option("--days", 7);
  const limit = option("--limit", 50);
  const env = readEnv();
  const since = new Date(Date.now() - days * 24 * 60 * 60 * 1000).toISOString();

  const response = await fetch(`${WORKER_URL}/api/errors?since=${encodeURIComponent(since)}&limit=${limit}`, {
    headers: {
      Authorization: `Bearer ${env.OUTBOUND_TOKEN}`,
      "CF-Access-Client-Id": env.CF_ACCESS_CLIENT_ID || "",
      "CF-Access-Client-Secret": env.CF_ACCESS_CLIENT_SECRET || ""
    }
  });
  const body = await response.json();
  if (!response.ok || !body.ok) throw new Error(body.error || `HTTP ${response.status}`);

  if (body.errors.length === 0) { console.log(`No error reports in the last ${days} day(s).`); return; }

  // Same error from several people is one problem: group by fingerprint.
  const groups = new Map();
  for (const error of body.errors) {
    const group = groups.get(error.fingerprint) || { ...error, users: new Set(), total: 0, versions: new Set() };
    group.users.add(error.email);
    group.total += error.occurrences;
    group.versions.add(`${error.appVersion}${error.uiVersion ? ` (ui ${error.uiVersion.split("+")[1]})` : ""}`);
    if (error.lastSeen > group.lastSeen) group.lastSeen = error.lastSeen;
    groups.set(error.fingerprint, group);
  }

  const ordered = [...groups.values()].sort((a, b) => b.lastSeen.localeCompare(a.lastSeen));
  console.log(`${ordered.length} distinct error(s), ${body.errors.length} report row(s), last ${days} day(s):\n`);
  for (const group of ordered) {
    console.log(`[${group.lastSeen.slice(0, 16).replace("T", " ")}] x${group.total}  ${group.users.size} user(s)  ${[...group.versions].join(", ")}`);
    console.log(`  ${group.source} @ ${group.page || "-"}`);
    console.log(`  ${group.message}`);
    const frame = String(group.stack || "").split("\n").slice(0, 3).map((line) => `    ${line.trim()}`).join("\n");
    if (frame.trim()) console.log(frame);
    console.log(`  users: ${[...group.users].join(", ")}\n`);
  }
}

main().catch((error) => { console.error(`Could not read error reports: ${error.message}`); process.exitCode = 1; });
