// generalizedDependencyAdvisories.js
//
// Generalizes componentDependencies.js's dependency coverage to the FULL
// Product_Dependencies dataset (productDependencyMatrix.js, all real rows transcribed
// from the workbook), instead of just the 3 manually curated rules (Combiner 6C control
// cable, IQ8 accessory suggestions, legacy microinverter warning) that file already
// implements from a separate, repair-specific BOM template document.
//
// PURELY ADDITIVE / ADVISORY ONLY: this NEVER auto-adds a priced line item to a quote --
// it only surfaces additional "you may also need to verify/consider" advisories, exactly
// like componentDependencies.js's own "advisory" tier already does. The one existing
// "auto_add" rule (Combiner 6C -> Enphase Control Cable) is completely untouched and
// remains the ONLY rule that can add a priced line automatically, for the exact same
// reason it was chosen originally: it is the one dependency confirmed Verified in BOTH
// the raw Product_Dependencies table AND its own dedicated Verified repair BOM template.
// No other row in Product_Dependencies has that same double-verification, so none of
// them are promoted to auto_add here -- this module cannot add cost to a quote.
//
// COVERAGE EXPANSION: today, ONLY IQ8-family microinverters and the IQ Combiner 6C get
// any dependency advisory at all. This module extends advisory coverage to every SKU
// with real rows in productDependencyMatrix.js -- Gateways, Batteries, System
// Controllers, EVSE, and Current Transformer/metering dependencies -- none of which
// previously surfaced anything.
//
// DEDUPLICATION: rows whose childSku is already surfaced by one of the 3 existing
// hardcoded rules for a matching trigger (IQ-SEALING-CAP / IQ-DISCONNECT-TOOL for IQ8
// items; CTRL-SC3-NA-01 for Combiner 6C, which is already auto-added, not advised) are
// skipped here, so a reviewer never sees the exact same dependency mentioned twice.
//
// "Optional" requirementLevel rows are always skipped -- the workbook's own Lists sheet
// defines "Optional" as "do not add by default," and that applies equally to surfacing
// it as an advisory, not just to auto-pricing it.
//
// Resolves a Draft Engine line item's NAME to a SKU using the SAME
// findMentionedProducts() phrase-matching utility compatibilityEngine.js already uses --
// no new matching logic invented. A line item that cannot be confidently resolved to
// exactly one SKU (0 or 2+ matches) yields NO advisories here, rather than guessing --
// same "never invent, reduce confidence instead" discipline used everywhere else in this
// codebase.

import { findMentionedProducts, findBySku } from "./compatibilityCatalog";
import { findDependencies } from "./productDependencyMatrix";

// childSkus already surfaced by componentDependencies.js's own hardcoded rules -- skipped
// here to avoid showing the same dependency twice under two different advisory entries.
const ALREADY_COVERED_CHILD_SKUS = new Set([
  "IQ-SEALING-CAP",      // IQ8 accessory advisory (componentDependencies.js)
  "IQ-DISCONNECT-TOOL",  // IQ8 accessory advisory (componentDependencies.js)
  "CTRL-SC3-NA-01"       // Combiner 6C control cable (auto_add, componentDependencies.js)
]);

// Builds a single, specific, human-readable reason string from a real dependency row --
// never a generic placeholder. Includes the requirement level, the real appliesWhen
// condition (verbatim from the workbook, since this engine cannot evaluate site-specific
// conditions like module layout or connector count on its own), and a visible flag when
// the underlying row itself is not yet Verified, so a reviewer can weigh confidence
// accordingly rather than mistaking every advisory for equally solid.
function formatAdvisoryReason(row, childProductName) {
  const parts = [`${childProductName || row.childSku} (${row.relationshipType})`, row.requirementLevel];
  if (row.appliesWhen) parts.push(row.appliesWhen);
  if (row.verificationStatus && row.verificationStatus !== "Verified") {
    parts.push(`${row.verificationStatus} -- confirm before relying on this`);
  }
  let reason = parts.join(" -- ");
  if (row.notes) reason += ` ${row.notes}`;
  if (row.sourceDocumentId) reason += ` (Source: ${row.sourceDocumentId})`;
  return reason;
}

/**
 * Returns advisory-only dependency suggestions for a confidently-matched line item name,
 * drawn from the full Product_Dependencies dataset. NEVER auto-adds a priced line item.
 * Returns [] (not null, never throws) when the item can't be resolved to exactly one SKU,
 * or has no un-covered, non-Optional dependency rows.
 */
export function getGeneralizedDependencyAdvisories(matchedItemName) {
  const mentioned = findMentionedProducts(matchedItemName);
  const uniqueBySku = Array.from(new Map(mentioned.map((p) => [p.sku, p])).values());
  if (uniqueBySku.length !== 1) return [];

  const sku = uniqueBySku[0].sku;
  const rows = findDependencies(sku).filter(
    (row) => row.requirementLevel !== "Optional" && !ALREADY_COVERED_CHILD_SKUS.has(row.childSku)
  );

  return rows.map((row) => {
    const childProduct = findBySku(row.childSku);
    return {
      childSku: row.childSku,
      childProductName: childProduct?.productName || row.childSku,
      relationshipType: row.relationshipType,
      requirementLevel: row.requirementLevel,
      appliesWhen: row.appliesWhen,
      confidence: row.confidence,
      verificationStatus: row.verificationStatus,
      sourceDocumentId: row.sourceDocumentId,
      reason: formatAdvisoryReason(row, childProduct?.productName)
    };
  });
}