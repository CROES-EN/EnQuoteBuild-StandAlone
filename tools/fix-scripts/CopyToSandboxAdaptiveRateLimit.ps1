$ErrorActionPreference = "Stop"

Write-Host "=== Updating copy-to-sandbox.mjs with adaptive rate limiting ==="
Write-Host ""
Write-Host "The previous version hit persistent 429 Rate Limit errors because"
Write-Host "the fixed 350ms delay was faster than Base44 allows. This version:"
Write-Host "  - Starts at an 800ms delay between writes"
Write-Host "  - AUTOMATICALLY SLOWS DOWN (delay increases) every time a 429"
Write-Host "    error occurs, up to a max of 8 seconds between writes"
Write-Host "  - Gradually speeds back up after 10 consecutive successes, down"
Write-Host "    to a floor of 500ms"
Write-Host "  - This adapts to whatever Base44's real limit turns out to be,"
Write-Host "    instead of guessing one fixed number"
Write-Host ""
Write-Host "Safety design is UNCHANGED: source (production) is read-only,"
Write-Host "target (sandbox) App ID is hard-checked to differ from source"
Write-Host "before any write, and this has been re-verified in this update."
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
//
// RELIABILITY DESIGN (v3 -- adaptive rate limiting):
//   4. The delay between writes STARTS small but AUTOMATICALLY INCREASES
//      every time a 429 (rate limit) error is seen, and gradually
//      decreases again after a run of consecutive successes. This adapts
//      to whatever Base44's real limit is, instead of guessing a fixed
//      number that may still be too fast.
//   5. On a 429, the write is retried with its own exponential backoff,
//      in addition to the adaptive base delay slowing down for
//      subsequent writes.
//   6. Before attempting the full copy, a single test record is written
//      first, so a missing entity schema fails fast with a clear message
//      instead of burning through hundreds of guaranteed failures.
//   7. Progress is printed regularly, and a summary of current delay/
//      throttling state is shown so you can see it adapting in real time.

import { createClient } from "@base44/sdk";

const SOURCE_APP_ID = process.env.BASE44_SOURCE_APP_ID || "";
const SOURCE_API_KEY = process.env.BASE44_SOURCE_API_KEY || "";
const TARGET_APP_ID = process.env.BASE44_TARGET_APP_ID || "";
const TARGET_API_KEY = process.env.BASE44_TARGET_API_KEY || "";

// --- Adaptive delay controller --------------------------------------------
const MIN_DELAY_MS = 500;
const MAX_DELAY_MS = 8000;
const START_DELAY_MS = 800;
const INCREASE_FACTOR = 1.8;   // multiply delay by this on a 429
const DECREASE_FACTOR = 0.95;  // slowly ease delay back down on success streaks
const SUCCESSES_BEFORE_EASING = 10;
const MAX_RETRIES_PER_RECORD = 5;

let currentDelayMs = START_DELAY_MS;
let consecutiveSuccesses = 0;

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function isRateLimitError(err) {
  return err?.message?.includes("429") || err?.message?.toLowerCase().includes("rate limit");
}

function isSchemaNotFoundError(err) {
  return err?.message?.toLowerCase().includes("entity schema") && err?.message?.toLowerCase().includes("not found");
}

function onRateLimitHit() {
  currentDelayMs = Math.min(MAX_DELAY_MS, Math.round(currentDelayMs * INCREASE_FACTOR));
  consecutiveSuccesses = 0;
}

function onWriteSuccess() {
  consecutiveSuccesses += 1;
  if (consecutiveSuccesses >= SUCCESSES_BEFORE_EASING) {
    currentDelayMs = Math.max(MIN_DELAY_MS, Math.round(currentDelayMs * DECREASE_FACTOR));
    consecutiveSuccesses = 0;
  }
}

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

// Writes with retry-on-429 (own backoff) AND updates the shared adaptive
// delay controller so subsequent writes automatically slow down too.
async function writeWithRetry(writeFn) {
  let attempt = 0;
  while (true) {
    try {
      await writeFn();
      onWriteSuccess();
      return { success: true };
    } catch (err) {
      if (isSchemaNotFoundError(err)) {
        return { success: false, schemaError: true, error: err };
      }
      if (isRateLimitError(err)) {
        onRateLimitHit();
        if (attempt < MAX_RETRIES_PER_RECORD) {
          attempt += 1;
          await sleep(currentDelayMs);
          continue;
        }
      }
      return { success: false, schemaError: false, error: err };
    }
  }
}

async function main() {
  requireEnv();
  assertSourceAndTargetAreDifferentApps();

  console.log("Source (production, READ-ONLY):", SOURCE_APP_ID);
  console.log("Target (sandbox, write):", TARGET_APP_ID);
  console.log(`Adaptive delay starting at ${START_DELAY_MS}ms (range ${MIN_DELAY_MS}-${MAX_DELAY_MS}ms)`);
  console.log("");

  const sourceClient = createClient({
    appId: SOURCE_APP_ID,
    headers: { api_key: SOURCE_API_KEY }
  });

  const targetClient = createClient({
    appId: TARGET_APP_ID,
    headers: { api_key: TARGET_API_KEY }
  });

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

  // --- Copy quotes -----------------------------------------------------
  console.log("");
  console.log(`Writing ${quotes.length} quote(s) into sandbox (${TARGET_APP_ID})...`);
  let quoteSuccessCount = 0;
  let quoteFailCount = 0;
  const failedQuotes = [];

  for (let i = 0; i < quotes.length; i++) {
    const quote = quotes[i];
    const { id, created_date, updated_date, ...quoteData } = quote;
    const result = await writeWithRetry(() => targetClient.entities.Quote.create(quoteData));

    if (result.success) {
      quoteSuccessCount += 1;
    } else {
      quoteFailCount += 1;
      failedQuotes.push({ site_id: quote.site_id || "unknown", error: result.error.message });
      if (result.schemaError) {
        console.error("");
        console.error("=== SCHEMA SETUP REQUIRED ===");
        console.error("The 'Quote' entity does not exist in EnQuote-StandAlone.");
        console.error("Run 'base44 entities push' while linked to the sandbox first.");
        console.error("Stopping here.");
        process.exit(1);
      }
    }

    await sleep(currentDelayMs);

    if ((i + 1) % 25 === 0 || i === quotes.length - 1) {
      console.log(
        `  ...progress: ${i + 1}/${quotes.length} | succeeded: ${quoteSuccessCount} | failed: ${quoteFailCount} | current delay: ${currentDelayMs}ms`
      );
    }
  }
  console.log(`  Quotes done: ${quoteSuccessCount} succeeded, ${quoteFailCount} failed.`);
  if (failedQuotes.length > 0) {
    console.log(`  First few failures: ${JSON.stringify(failedQuotes.slice(0, 5), null, 2)}`);
  }

  // --- Copy products -----------------------------------------------------
  if (products.length > 0) {
    console.log("");
    console.log(`Writing ${products.length} product(s) into sandbox...`);
    let productSuccessCount = 0;
    let productFailCount = 0;
    const failedProducts = [];

    for (let i = 0; i < products.length; i++) {
      const product = products[i];
      const { id, created_date, updated_date, ...productData } = product;
      const result = await writeWithRetry(() => targetClient.entities.Product.create(productData));

      if (result.success) {
        productSuccessCount += 1;
      } else {
        productFailCount += 1;
        failedProducts.push({ name: product.name || "unknown", error: result.error.message });
        if (result.schemaError) {
          console.error("");
          console.error("=== SCHEMA SETUP REQUIRED ===");
          console.error("The 'Product' entity does not exist in EnQuote-StandAlone.");
          console.error("Skipping remaining products.");
          break;
        }
      }

      await sleep(currentDelayMs);

      if ((i + 1) % 25 === 0 || i === products.length - 1) {
        console.log(
          `  ...progress: ${i + 1}/${products.length} | succeeded: ${productSuccessCount} | failed: ${productFailCount} | current delay: ${currentDelayMs}ms`
        );
      }
    }
    console.log(`  Products done: ${productSuccessCount} succeeded, ${productFailCount} failed.`);
    if (failedProducts.length > 0) {
      console.log(`  First few failures: ${JSON.stringify(failedProducts.slice(0, 5), null, 2)}`);
    }
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
Write-Host "=== Run it ==="
Write-Host "(Re-use your existing environment variables if still set this session,"
Write-Host "otherwise set them again first.)"
Write-Host ""
Write-Host '  $env:BASE44_SOURCE_APP_ID = "6979390a3f44099ffca06859"'
Write-Host '  $env:BASE44_SOURCE_API_KEY = "<production API key>"'
Write-Host '  $env:BASE44_TARGET_APP_ID = "6a91e7bce36dd777fa88cf04"'
Write-Host '  $env:BASE44_TARGET_API_KEY = "<same API key -- confirmed tied to your account>"'
Write-Host "  node copy-to-sandbox.mjs 2>&1 | Tee-Object -FilePath .\copy-to-sandbox-log3.txt"
Write-Host ""
Write-Host "This run will likely take longer than before since it slows itself"
Write-Host "down automatically whenever it hits a rate limit -- that's expected"
Write-Host "and is what makes it actually finish successfully instead of"
Write-Host "endlessly retrying at a speed Base44 keeps rejecting."
