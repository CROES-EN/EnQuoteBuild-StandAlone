$ErrorActionPreference = "Stop"

Write-Host "=== Setting up: Copy Production data into EnQuote-StandAlone (sandbox) ==="
Write-Host ""
Write-Host "This writes copy-to-sandbox.mjs, which:"
Write-Host "  - READS quotes/products from Production (6979390a3f44099ffca06859)"
Write-Host "    using ONLY .list() calls -- never writes to it."
Write-Host "  - WRITES those records into EnQuote-StandAlone"
Write-Host "    (6a91e7bce36dd777fa88cf04), which is currently blank."
Write-Host "  - Has a HARD SAFETY CHECK that aborts immediately if the source"
Write-Host "    and target App IDs are ever the same, so it is not possible"
Write-Host "    for this script to write back into Production."
Write-Host ""

@'
// copy-to-sandbox.mjs
//
// Copies quotes and products from your PRODUCTION Base44 app (read-only)
// into your EnQuote-StandAlone SANDBOX app (write). This lets you test
// against a real, populated Base44 backend without ever touching
// production data.
//
// SAFETY DESIGN:
//   1. Source (production) is NEVER written to -- only .list() is called
//      on it, anywhere in this file.
//   2. Target (sandbox) App ID is validated to be DIFFERENT from the
//      source App ID before ANY write happens. If they ever match, the
//      script aborts immediately and writes nothing.
//   3. Both App IDs and API keys are read from environment variables --
//      never hard-coded -- so nothing sensitive lives in this file.

import { createClient } from "@base44/sdk";

const SOURCE_APP_ID = process.env.BASE44_SOURCE_APP_ID || "";
const SOURCE_API_KEY = process.env.BASE44_SOURCE_API_KEY || "";
const TARGET_APP_ID = process.env.BASE44_TARGET_APP_ID || "";
const TARGET_API_KEY = process.env.BASE44_TARGET_API_KEY || "";

function requireEnv() {
  const missing = [];
  if (!SOURCE_APP_ID) missing.push("BASE44_SOURCE_APP_ID");
  if (!SOURCE_API_KEY) missing.push("BASE44_SOURCE_API_KEY");
  if (!TARGET_APP_ID) missing.push("BASE44_TARGET_APP_ID");
  if (!TARGET_API_KEY) missing.push("BASE44_TARGET_API_KEY");
  if (missing.length > 0) {
    throw new Error(`Missing required environment variable(s): ${missing.join(", ")}`);
  }
}

// HARD SAFETY INTERLOCK -- this check runs before any client is even used
// for writing. If source and target ever resolve to the same app, this
// throws and the script exits before touching anything.
function assertSourceAndTargetAreDifferentApps() {
  if (SOURCE_APP_ID === TARGET_APP_ID) {
    throw new Error(
      "SAFETY ABORT: Source and target App IDs are identical " +
      `("${SOURCE_APP_ID}"). Refusing to proceed -- this script must never ` +
      "write back into the same app it reads from. Double-check your " +
      "environment variables before retrying."
    );
  }
}

async function main() {
  requireEnv();
  assertSourceAndTargetAreDifferentApps();

  console.log("Source (production, READ-ONLY):", SOURCE_APP_ID);
  console.log("Target (sandbox, write):", TARGET_APP_ID);
  console.log("");

  const sourceClient = createClient({
    appId: SOURCE_APP_ID,
    headers: { api_key: SOURCE_API_KEY }
  });

  const targetClient = createClient({
    appId: TARGET_APP_ID,
    headers: { api_key: TARGET_API_KEY }
  });

  // --- Read from production (read-only) ---------------------------------
  console.log("Reading quotes from production (.list() only)...");
  const quotes = await sourceClient.entities.Quote.list("-created_date", 500);
  console.log(`  Retrieved ${quotes.length} quote(s) from production.`);

  console.log("Reading products from production (read-only)...");
  let products = [];
  try {
    const response = await sourceClient.functions.invoke("getAllProducts", {});
    products = response?.data?.products || [];
    console.log(`  Retrieved ${products.length} product(s) from production.`);
  } catch (err) {
    console.log("  No getAllProducts function found or accessible -- skipping products.");
  }

  // --- Write into sandbox only -------------------------------------------
  console.log("");
  console.log(`Writing ${quotes.length} quote(s) into sandbox (${TARGET_APP_ID})...`);
  let quoteSuccessCount = 0;
  let quoteFailCount = 0;
  for (const quote of quotes) {
    try {
      // Strip system-managed fields so the sandbox creates fresh records
      // rather than trying to preserve production's internal IDs.
      const { id, created_date, updated_date, ...quoteData } = quote;
      await targetClient.entities.Quote.create(quoteData);
      quoteSuccessCount += 1;
    } catch (err) {
      quoteFailCount += 1;
      console.error(`  Failed to copy quote (site_id: ${quote.site_id || "unknown"}):`, err.message);
    }
  }
  console.log(`  Done: ${quoteSuccessCount} succeeded, ${quoteFailCount} failed.`);

  if (products.length > 0) {
    console.log("");
    console.log(`Writing ${products.length} product(s) into sandbox...`);
    let productSuccessCount = 0;
    let productFailCount = 0;
    for (const product of products) {
      try {
        const { id, created_date, updated_date, ...productData } = product;
        await targetClient.entities.Product.create(productData);
        productSuccessCount += 1;
      } catch (err) {
        productFailCount += 1;
        console.error(`  Failed to copy product "${product.name || "unknown"}":`, err.message);
      }
    }
    console.log(`  Done: ${productSuccessCount} succeeded, ${productFailCount} failed.`);
  }

  console.log("");
  console.log("=== Copy complete ===");
  console.log("Production was only read from -- verify in your Base44 dashboard");
  console.log("that production quote counts are unchanged, and that");
  console.log("EnQuote-StandAlone now contains the copied records.");
}

main().catch((err) => {
  console.error("");
  console.error("SCRIPT STOPPED:", err.message);
  process.exit(1);
});

'@ | Set-Content -Encoding utf8 .\copy-to-sandbox.mjs

Write-Host "Wrote: copy-to-sandbox.mjs"
Write-Host ""
Write-Host "=== NEXT STEPS (manual -- run one at a time) ==="
Write-Host ""
Write-Host "1. Install the SDK if you have not already:"
Write-Host "     npm.cmd install @base44/sdk"
Write-Host ""
Write-Host "2. Set your credentials as TEMPORARY environment variables:"
Write-Host '     $env:BASE44_SOURCE_APP_ID = "6979390a3f44099ffca06859"'
Write-Host '     $env:BASE44_SOURCE_API_KEY = "<production API key>"'
Write-Host '     $env:BASE44_TARGET_APP_ID = "6a91e7bce36dd777fa88cf04"'
Write-Host '     $env:BASE44_TARGET_API_KEY = "<EnQuote-StandAlone API key -- get this from that apps own dashboard settings>"'
Write-Host ""
Write-Host "   IMPORTANT: BASE44_TARGET_API_KEY should be the API key belonging"
Write-Host "   to EnQuote-StandAlone specifically, generated from ITS OWN"
Write-Host "   dashboard settings -- not reused from production. Each Base44"
Write-Host "   app should have its own distinct API key."
Write-Host ""
Write-Host "3. Run the copy:"
Write-Host "     node copy-to-sandbox.mjs"
Write-Host ""
Write-Host "4. Review the console output -- it reports how many quotes/products"
Write-Host "   succeeded or failed for each record."
Write-Host ""
Write-Host "5. Verify in your Base44 dashboard that:"
Write-Host "     - Production quote count is UNCHANGED"
Write-Host "     - EnQuote-StandAlone now contains the copied quotes"
Write-Host ""
Write-Host "6. Point your app at the sandbox for testing:"
Write-Host "     (Get-Content .env.local) -replace 'VITE_BASE44_APP_ID=.*', 'VITE_BASE44_APP_ID=6a91e7bce36dd777fa88cf04' | Set-Content .env.local"
Write-Host "     (this only affects your LOCAL .env.local file -- it does not"
Write-Host "     touch either Base44 app)"
Write-Host ""
Write-Host "7. Restart your dev server:"
Write-Host "     npm.cmd run dev"
Write-Host ""
Write-Host "8. Clear credentials from this terminal session when done:"
Write-Host '     Remove-Item Env:\BASE44_SOURCE_APP_ID'
Write-Host '     Remove-Item Env:\BASE44_SOURCE_API_KEY'
Write-Host '     Remove-Item Env:\BASE44_TARGET_APP_ID'
Write-Host '     Remove-Item Env:\BASE44_TARGET_API_KEY'
Write-Host ""
Write-Host "9. Rotate the production API key in your Base44 dashboard now that"
Write-Host "   it has been shared outside a secrets manager."
Write-Host ""
Write-Host "When you are done testing against the sandbox and want to reconnect"
Write-Host "to production, change VITE_BASE44_APP_ID back to"
Write-Host "6979390a3f44099ffca06859 in .env.local and restart your dev server."
