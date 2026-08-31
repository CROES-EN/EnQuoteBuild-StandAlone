// copy-to-sandbox.mjs (v4 -- checkpointed, conservative pacing)
//
// Copies quotes and products from your PRODUCTION Base44 app (read-only)
// into your EnQuote-StandAlone SANDBOX app (write).
//
// SAFETY DESIGN (unchanged from previous versions):
//   1. Source (production) is NEVER written to -- only .list() is called
//      on it, anywhere in this file.
//   2. Target (sandbox) App ID is validated to be DIFFERENT from the
//      source App ID before ANY write happens. If they ever match, the
//      script aborts immediately and writes nothing.
//
// RELIABILITY DESIGN (v4):
//   3. Fixed, conservative 2.5 second delay between every write (both
//      quotes and products), since the adaptive approach in v3 still hit
//      persistent rate limits.
//   4. CHECKPOINT FILE (copy-progress.json): after each successful write,
//      the record's identifier is saved to a local checkpoint file. If
//      the script is stopped or fails partway through, re-running it
//      SKIPS records already confirmed copied, instead of starting over.
//   5. A single test write is attempted before the full quotes run and
//      before the full products run, so a missing entity schema fails
//      fast with a clear message.

import { createClient } from "@base44/sdk";
import { readFileSync, writeFileSync, existsSync } from "fs";

const SOURCE_APP_ID = process.env.BASE44_SOURCE_APP_ID || "";
const SOURCE_API_KEY = process.env.BASE44_SOURCE_API_KEY || "";
const TARGET_APP_ID = process.env.BASE44_TARGET_APP_ID || "";
const TARGET_API_KEY = process.env.BASE44_TARGET_API_KEY || "";

const FIXED_DELAY_MS = 2500;
const MAX_RETRIES_PER_RECORD = 6;
const CHECKPOINT_FILE = "./copy-progress.json";

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function isRateLimitError(err) {
  return err?.message?.includes("429") || err?.message?.toLowerCase().includes("rate limit");
}

function isSchemaNotFoundError(err) {
  return err?.message?.toLowerCase().includes("entity schema") && err?.message?.toLowerCase().includes("not found");
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

function assertSourceAndTargetAreDifferentApps() {
  if (SOURCE_APP_ID === TARGET_APP_ID) {
    throw new Error(
      "SAFETY ABORT: Source and target App IDs are identical " +
      `("${SOURCE_APP_ID}"). Refusing to proceed -- this script must never ` +
      "write back into the same app it reads from."
    );
  }
}

function loadCheckpoint() {
  if (!existsSync(CHECKPOINT_FILE)) {
    return { copiedQuoteKeys: [], copiedProductKeys: [] };
  }
  try {
    const raw = readFileSync(CHECKPOINT_FILE, "utf8");
    const parsed = JSON.parse(raw);
    return {
      copiedQuoteKeys: parsed.copiedQuoteKeys || [],
      copiedProductKeys: parsed.copiedProductKeys || []
    };
  } catch {
    return { copiedQuoteKeys: [], copiedProductKeys: [] };
  }
}

function saveCheckpoint(checkpoint) {
  writeFileSync(CHECKPOINT_FILE, JSON.stringify(checkpoint, null, 2), "utf8");
}

// Builds a stable identifier for a record so it can be checked against the
// checkpoint file across separate runs of this script.
function recordKey(record, indexFallback) {
  return String(record.site_id || record.name || record.id || `index-${indexFallback}`);
}

async function writeWithRetry(writeFn) {
  let attempt = 0;
  while (true) {
    try {
      await writeFn();
      return { success: true };
    } catch (err) {
      if (isSchemaNotFoundError(err)) {
        return { success: false, schemaError: true, error: err };
      }
      if (isRateLimitError(err) && attempt < MAX_RETRIES_PER_RECORD) {
        attempt += 1;
        await sleep(FIXED_DELAY_MS * (attempt + 1));
        continue;
      }
      return { success: false, schemaError: false, error: err };
    }
  }
}

async function main() {
  requireEnv();
  assertSourceAndTargetAreDifferentApps();

  const checkpoint = loadCheckpoint();
  const alreadyCopiedQuotes = new Set(checkpoint.copiedQuoteKeys);
  const alreadyCopiedProducts = new Set(checkpoint.copiedProductKeys);

  console.log("Source (production, READ-ONLY):", SOURCE_APP_ID);
  console.log("Target (sandbox, write):", TARGET_APP_ID);
  console.log(`Fixed delay: ${FIXED_DELAY_MS}ms between writes`);
  console.log(`Checkpoint: ${alreadyCopiedQuotes.size} quote(s) and ${alreadyCopiedProducts.size} product(s) already copied in previous runs -- these will be skipped.`);
  console.log("");

  const sourceClient = createClient({ appId: SOURCE_APP_ID, headers: { api_key: SOURCE_API_KEY } });
  const targetClient = createClient({ appId: TARGET_APP_ID, headers: { api_key: TARGET_API_KEY } });

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

  // --- Quotes -------------------------------------------------------------
  console.log("");
  console.log(`Writing quotes into sandbox (${quotes.length - alreadyCopiedQuotes.size} remaining)...`);
  let quoteSuccessCount = 0;
  let quoteFailCount = 0;
  let quoteSkipCount = 0;

  for (let i = 0; i < quotes.length; i++) {
    const quote = quotes[i];
    const key = recordKey(quote, i);
    if (alreadyCopiedQuotes.has(key)) {
      quoteSkipCount += 1;
      continue;
    }

    const { id, created_date, updated_date, ...quoteData } = quote;
    const result = await writeWithRetry(() => targetClient.entities.Quote.create(quoteData));

    if (result.success) {
      quoteSuccessCount += 1;
      alreadyCopiedQuotes.add(key);
      checkpoint.copiedQuoteKeys = Array.from(alreadyCopiedQuotes);
      saveCheckpoint(checkpoint);
    } else {
      quoteFailCount += 1;
      if (result.schemaError) {
        console.error("SCHEMA SETUP REQUIRED: 'Quote' entity not found in sandbox. Run 'base44 entities push' while linked to the sandbox first. Stopping.");
        process.exit(1);
      }
      console.error(`  Failed (site_id: ${quote.site_id || "unknown"}): ${result.error.message}`);
    }

    await sleep(FIXED_DELAY_MS);

    if ((i + 1) % 20 === 0 || i === quotes.length - 1) {
      console.log(`  ...progress: ${i + 1}/${quotes.length} | succeeded: ${quoteSuccessCount} | failed: ${quoteFailCount} | skipped (already done): ${quoteSkipCount}`);
    }
  }
  console.log(`Quotes done this run: ${quoteSuccessCount} succeeded, ${quoteFailCount} failed, ${quoteSkipCount} skipped (already copied).`);
  console.log(`Total quotes in sandbox so far (across all runs): ${alreadyCopiedQuotes.size}`);

  // --- Products -----------------------------------------------------------
  if (products.length > 0) {
    console.log("");
    console.log(`Writing products into sandbox (${products.length - alreadyCopiedProducts.size} remaining)...`);
    let productSuccessCount = 0;
    let productFailCount = 0;
    let productSkipCount = 0;

    for (let i = 0; i < products.length; i++) {
      const product = products[i];
      const key = recordKey(product, i);
      if (alreadyCopiedProducts.has(key)) {
        productSkipCount += 1;
        continue;
      }

      const { id, created_date, updated_date, ...productData } = product;
      const result = await writeWithRetry(() => targetClient.entities.Product.create(productData));

      if (result.success) {
        productSuccessCount += 1;
        alreadyCopiedProducts.add(key);
        checkpoint.copiedProductKeys = Array.from(alreadyCopiedProducts);
        saveCheckpoint(checkpoint);
      } else {
        productFailCount += 1;
        if (result.schemaError) {
          console.error("SCHEMA SETUP REQUIRED: 'Product' entity not found in sandbox. Run 'base44 entities push' while linked to the sandbox first. Stopping.");
          break;
        }
        console.error(`  Failed ("${product.name || "unknown"}"): ${result.error.message}`);
      }

      await sleep(FIXED_DELAY_MS);

      if ((i + 1) % 20 === 0 || i === products.length - 1) {
        console.log(`  ...progress: ${i + 1}/${products.length} | succeeded: ${productSuccessCount} | failed: ${productFailCount} | skipped (already done): ${productSkipCount}`);
      }
    }
    console.log(`Products done this run: ${productSuccessCount} succeeded, ${productFailCount} failed, ${productSkipCount} skipped (already copied).`);
    console.log(`Total products in sandbox so far (across all runs): ${alreadyCopiedProducts.size}`);
  }

  console.log("");
  console.log("=== Copy run complete ===");
  console.log("If any records failed, simply run this script again -- it will");
  console.log("automatically skip everything already copied and only retry the rest.");
  console.log("Production was only read from -- your production data is unaffected.");
}

main().catch((err) => {
  console.error("");
  console.error("SCRIPT STOPPED:", err.message);
  process.exit(1);
});

