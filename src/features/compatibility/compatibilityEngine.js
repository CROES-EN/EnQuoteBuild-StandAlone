// compatibilityEngine.js
//
// Deterministic compatibility validation for Auto-Drafter / Quote Draft Agent output.
// Reads ONLY from compatibilityCatalog.js and compatibilityMatrix.js (both independently
// populated from EnQuote_Enphase_Installation_Catalog.xlsx) -- has NO dependency on
// src/features/quoteDraftAgent/productCatalog.js (the "Legacy Catalog") and performs NO
// reconciliation between the two. This is intentional: the Legacy Catalog keeps driving
// pricing/matching exactly as before; this engine is a fully separate, additive signal.
//
// No LLM involved anywhere in this file -- pure, deterministic, auditable logic, same
// style as draftEngine.js.

import { COMPATIBILITY_CATALOG, findMentionedProducts, findBySku } from "./compatibilityCatalog";
import { findCompatibilityRule } from "./compatibilityMatrix";

/**
 * Scans a Quote Request's free-text fields (problemDescription, rootCause,
 * diagnosticFindings) for mentions of any catalog product -- this is the best-effort
 * "what's already installed" signal described in the design doc. Deliberately does NOT
 * guess: 0 mentions -> unknown, 1 mention -> resolved, 2+ mentions -> conflicting (never
 * silently picks one).
 */
export function identifyExistingEquipment(parsedRequest) {
  const searchText = [
    parsedRequest?.problemDescription,
    parsedRequest?.rootCause,
    parsedRequest?.diagnosticFindings
  ].filter(Boolean).join(" ");

  const mentioned = findMentionedProducts(searchText);
  // De-duplicate by SKU (the same product name could match more than once across fields).
  const uniqueBySku = Array.from(new Map(mentioned.map((p) => [p.sku, p])).values());

  if (uniqueBySku.length === 0) {
    return { status: "unknown", products: [] };
  }
  if (uniqueBySku.length > 1) {
    return { status: "conflicting", products: uniqueBySku };
  }
  return { status: "resolved", products: uniqueBySku };
}

/**
 * Identifies the proposed replacement product from a matched Draft Engine line item.
 *
 * WIRING (Part 2, Step 2): if the caller already knows the Legacy Catalog item that was
 * matched/priced for this line -- and that item carries a real `sku` field (see
 * productCatalog.js's 19 tagged entries from Step 1) -- that SKU is used DIRECTLY via
 * findBySku(), skipping the independent name-based search entirely. This guarantees the
 * compatibility check targets the EXACT SAME catalog record that was priced, rather than
 * a second, independent guess that could disagree with the first (e.g. resolve to 0 or
 * 2+ candidates on a name the pricing match handled fine).
 *
 * Falls back to the original name-based findMentionedProducts() search -- completely
 * unchanged -- whenever no pre-known SKU is supplied, or that SKU isn't found in this
 * catalog (e.g. it belongs to a Legacy Catalog item tagged with a SKU that happens not to
 * exist here, which should not happen given how Step 1 built its tags, but is handled
 * safely rather than assumed).
 */
export function identifyProposedReplacement(lineItemName, knownSku) {
  if (knownSku) {
    const bySku = findBySku(knownSku);
    if (bySku) return bySku;
  }
  const mentioned = findMentionedProducts(lineItemName);
  const uniqueBySku = Array.from(new Map(mentioned.map((p) => [p.sku, p])).values());
  if (uniqueBySku.length === 1) return uniqueBySku[0];
  return null; // 0 or 2+ matches: do not guess which one is meant
}

/**
 * Implements the Part 1 deterministic validation flow from
 * compatibility_and_schema_design.md, Section 1.3 -- reproduced here as executable logic,
 * unchanged in substance from that design.
 *
 * `knownSku` (optional, added in Part 2 Step 2): pass the Legacy Catalog item's own `sku`
 * field here when the caller already has it (see draftEngine.js's call site, which now
 * passes `lineItem.sku`) so the proposed-replacement lookup uses that exact, already-
 * matched identity instead of re-guessing from the name alone. Omit/undefined preserves
 * the original, fully independent name-based behavior exactly as before.
 *
 * Returns one of:
 *   { status: "not_evaluated", reason }
 *   { status: "review_required", reason, existingCandidates? }
 *   { status: "blocked", reason, rule }
 *   { status: "verified_compatible", confidence, rule }
 */
export function evaluateCompatibility(parsedRequest, lineItemName, knownSku) {
  const target = identifyProposedReplacement(lineItemName, knownSku);
  if (!target) {
    return { status: "not_evaluated", reason: "Proposed replacement could not be matched to a known equipment SKU in the compatibility catalog." };
  }

  const existing = identifyExistingEquipment(parsedRequest);

  if (existing.status === "unknown") {
    return { status: "not_evaluated", reason: "No existing equipment could be identified from the request's findings text -- compatibility was not checked." };
  }

  if (existing.status === "conflicting") {
    return {
      status: "review_required",
      reason: `Findings mention multiple possible existing components (${existing.products.map((p) => p.productName).join(", ")}) -- confirm which is installed before compatibility can be verified.`,
      existingCandidates: existing.products
    };
  }

  const sourceSku = existing.products[0].sku;
  const rule = findCompatibilityRule(sourceSku, target.sku);

  if (!rule) {
    // Also check the sentinel "no automatic replacement" rule for this source, since that
    // is itself a meaningful, sourced finding (e.g. legacy microinverters) even though it
    // doesn't name this specific target SKU.
    const reviewRule = findCompatibilityRule(sourceSku, "MANUAL-ENGINEERING-REVIEW");
    if (reviewRule) {
      return {
        status: "blocked",
        reason: reviewRule.restriction,
        rule: reviewRule
      };
    }
    return {
      status: "review_required",
      reason: `No verified compatibility rule exists for ${sourceSku} -> ${target.sku}.`
    };
  }

  if (rule.verificationStatus !== "Verified") {
    return {
      status: "review_required",
      reason: `A compatibility rule exists but is not yet Verified (status: ${rule.verificationStatus}).`,
      rule
    };
  }

  if (rule.compatibilityType === "Incompatible" || rule.compatibilityType === "Replacement Review Required") {
    return { status: "blocked", reason: rule.restriction, rule };
  }

  // Direct Replacement / Recommended Upgrade / Compatible / Mixed-System Compatibility,
  // Verified: treat as validated ONLY if region context is known and matches; otherwise
  // reduce to review_required rather than silently assume region match.
  const requestRegion = parsedRequest?.region || null;
  if (requestRegion && rule.region && requestRegion !== rule.region) {
    return {
      status: "review_required",
      reason: `Compatible per ${rule.sourceDocumentId}, but this request's region (${requestRegion}) does not match the rule'sregion (${rule.region}).`,
      rule
    };
  }
  if (!requestRegion) {
    return {
      status: "review_required",
      reason: `Compatible per ${rule.sourceDocumentId}, but region could not be confirmed against this request.`,
      rule
    };
  }

  return { status: "verified_compatible", confidence: rule.confidence, rule };
}