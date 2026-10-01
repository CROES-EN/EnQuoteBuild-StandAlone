// Fetch-RealUsersFromBase44.mjs
//
// READ-ONLY script. Calls Base44's real getAllUsers function (the SAME
// endpoint base44Adapter.js's getUsers() already uses in non-local mode)
// and writes the result directly into your LOCAL desktop app's data file's
// "users" collection - a one-time fix for the confirmed gap where local/
// desktop mode never had a real sync mechanism for users (unlike quotes,
// which DO sync via entity-snapshot.js).
//
// This does NOT create/update/delete anything in Base44 - it only READS
// users from Base44 and WRITES them into your own local JSON file.
//
// Run this with: node Fetch-RealUsersFromBase44.mjs
// (from your EnQuote project root, after `npm install @base44/sdk` if you
// haven't already - same prerequisite as export-production-data.mjs)

import { createClient } from "@base44/sdk";
import fs from "fs";
import path from "path";
import os from "os";

const BASE44_APP_ID = process.env.BASE44_EXPORT_APP_ID || "";
const BASE44_API_KEY = process.env.BASE44_EXPORT_API_KEY || "";

if (!BASE44_APP_ID || !BASE44_API_KEY) {
  console.error(
    "Missing credentials. Set BASE44_EXPORT_APP_ID and BASE44_EXPORT_API_KEY\n" +
    "as environment variables before running this script, e.g.:\n\n" +
    '  $env:BASE44_EXPORT_APP_ID = "your-app-id"\n' +
    '  $env:BASE44_EXPORT_API_KEY = "your-api-key"\n' +
    "  node Fetch-RealUsersFromBase44.mjs\n"
  );
  process.exit(1);
}

const dataFilePath = path.join(os.homedir(), "AppData", "Roaming", "base44-app", "enquote-demo-data-v1.json");

async function main() {
  console.log("Connecting to Base44...");
  const base44 = createClient({ appId: BASE44_APP_ID, apiKey: BASE44_API_KEY });

  console.log("Calling getAllUsers() - the same real function base44Adapter.js uses...");
  const response = await base44.functions.invoke("getAllUsers");
  const realUsers = response?.data || [];

  if (!Array.isArray(realUsers) || realUsers.length === 0) {
    console.error("getAllUsers() returned no users - stopping without making any changes.");
    console.error("Raw response:", JSON.stringify(response, null, 2).slice(0, 500));
    process.exit(1);
  }

  console.log(`Fetched ${realUsers.length} real user(s) from Base44.`);

  if (!fs.existsSync(dataFilePath)) {
    console.error(`Local data file not found at: ${dataFilePath}`);
    console.error("Make sure EnQuote has been launched at least once on this machine.");
    process.exit(1);
  }

  const backupPath = `${dataFilePath}.bak-userfix-${Date.now()}`;
  fs.copyFileSync(dataFilePath, backupPath);
  console.log(`Backup created: ${backupPath}`);

  const raw = fs.readFileSync(dataFilePath, "utf8").replace(/^\uFEFF/, "");
  const data = JSON.parse(raw);

  const before = Array.isArray(data.users) ? data.users.length : 0;
  data.users = realUsers;

  fs.writeFileSync(dataFilePath, JSON.stringify(data, null, 2), "utf8");
  console.log(`Replaced local users collection: ${before} -> ${realUsers.length} real user(s).`);
  console.log("\nDone. Restart EnQuote (if running) to see the real user list.");
  console.log("IMPORTANT (per export-production-data.mjs's own guidance): rotate your");
  console.log("BASE44_EXPORT_API_KEY in the Base44 dashboard now that it was used outside");
  console.log("a secrets manager, and never commit real credentials to any file.");
}

main().catch((error) => {
  console.error("Failed:", error.message);
  process.exit(1);
});
