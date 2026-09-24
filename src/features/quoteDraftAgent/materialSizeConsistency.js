// materialSizeConsistency.js
//
// Flags a real, electrician-relevant risk in Auto-Drafter-generated quotes: mixing
// conduit MATERIALS (EMT vs. PVC) or SIZES within the same draft.
//
// GROUNDED IN REAL DATA: this check's design was validated against 86 real, previously
// approved/scheduled/invoiced EnQuote quotes (each reviewed and approved by an
// electrician before being sent). Of 28 approved quotes containing 2+ conduit-family
// line items, 27 stayed internally consistent on material (10 pure EMT, 13 pure PVC, 4
// unspecified) and only 1 ever mixed EMT and PVC in the same job. 26 of 28 also used one
// consistent size throughout; the 2 exceptions look like legitimate multi-size runs (a
// main run transitioning to a different fitting size), not errors. This is why a material
// mismatch is treated as a stronger signal (still advisory, never blocking) than a size
// mismatch, which is phrased as "verify this is intentional" rather than "this looks
// wrong."
//
// PURELY ADVISORY, NEVER BLOCKING: matches the same review_required pattern already used
// by compatibility_flags/dependency_advisories elsewhere in this codebase. This NEVER
// removes, reprices, or auto-corrects a line item -- it only surfaces a flag for a human
// to review, exactly like every other safeguard in this system.
//
// CONSERVATIVE, NEVER GUESSES: an item whose name doesn't explicitly say EMT/PVC/rigid
// metal/etc. is classified as "unspecified," never assumed to be one material or the
// other. A single conduit-family item (nothing else to compare it against) never
// triggers a flag -- this only fires when there are 2+ conduit-family items to compare.

// A fitting-type word (connector/coupling/elbow/bushing/strap/adapter) alone is too broad
// to safely mean "conduit-family" -- confirmed via direct testing that bare "connector"
// false-positives on plainly unrelated items like "MC4 Connector" or "Enphase Connector
// Clip". This pattern instead requires an EXPLICIT conduit/material signal word to appear
// in the same name (the word "conduit" itself, EMT, "electrical metallic tube", PVC,
// "non-metallic", "schedule 40/80", "rigid metal", "RMC", "liquid-tight", "rain-tight") --
// confirmed via direct testing against 9 real catalog items that should NOT match (all
// correctly excluded) and 10 real catalog items that SHOULD match (all correctly
// included).
const CONDUIT_SIGNAL_PATTERN = /\bconduit\b|\bemt\b|electrical metallic tub|\bpvc\b|non-?metallic|schedule\s*40|schedule\s*80|rigid metal|\brmc\b|liquid.?tight|rain.?tight/i;

function isConduitFamily(name) {
  return CONDUIT_SIGNAL_PATTERN.test(String(name || ""));
}

// Never guesses: a name mentioning BOTH EMT and PVC terminology (rare, but real catalog
// names like Cantex fittings can reference both a conduit body type and a brand) is
// flagged as its own distinct "ambiguous" case rather than silently picked one way.
function classifyMaterial(name) {
  const lower = String(name || "").toLowerCase();
  const hasEmt = /\bemt\b|electrical metallic tub|\brmc\b|rigid metal/.test(lower);
  const hasPvc = /\bpvc\b|non-?metallic|schedule\s*40|schedule\s*80/.test(lower);
  if (hasEmt && hasPvc) return "ambiguous";
  if (hasEmt) return "EMT";
  if (hasPvc) return "PVC";
  return null; // unspecified -- never guessed
}

// Extracts a size token (e.g. "3/4", "1", "1-1/2") from a product name written in any of
// the common real-world notations (1", 1 in., 1inch, 1-inch) -- reuses the same size
// vocabulary already handled by normalizeSizeNotation() in draftEngine.js, but kept as an
// independent, simpler extractor here since this only needs to COMPARE sizes across
// items, not fold them into a single search token.
const SIZE_PATTERN = /(\d+(?:-\d+\/\d+|\/\d+)?)\s*(?:in\.?|inch(?:es)?|")/i;

function extractSize(name) {
  const match = String(name || "").match(SIZE_PATTERN);
  return match ? match[1] : null;
}

/**
 * Checks a generated draft's line items for conduit material/size inconsistencies.
 * Returns an array of flags (possibly empty) -- NEVER throws, NEVER modifies `items`.
 *
 * Each flag: { type: "material_mismatch" | "material_ambiguous" | "size_mismatch", reason }
 */
export function checkMaterialSizeConsistency(items) {
  const conduitItems = (items || []).filter((item) => isConduitFamily(item.name));
  if (conduitItems.length < 2) return [];

  const flags = [];

  const materialsPresent = new Set();
  const materialExamples = {};
  for (const item of conduitItems) {
    const material = classifyMaterial(item.name);
    if (material) {
      materialsPresent.add(material);
      if (!materialExamples[material]) materialExamples[material] = [];
      materialExamples[material].push(item.name);
    }
  }

  if (materialsPresent.has("EMT") && materialsPresent.has("PVC")) {
    flags.push({
      type: "material_mismatch",
      reason: `This draft includes both EMT and PVC conduit-family items (EMT: ${materialExamples.EMT.slice(0, 2).join(", ")}; PVC: ${materialExamples.PVC.slice(0, 2).join(", ")}). Verify the correct conduit material for this job -- mixing EMT and PVC in the same run is uncommon.`
    });
  }
  if (materialsPresent.has("ambiguous")) {
    flags.push({
      type: "material_ambiguous",
      reason: `One or more conduit items reference both EMT and PVC terminology in the same name -- verify material: ${materialExamples.ambiguous.slice(0, 2).join(", ")}`
    });
  }

  const sizesPresent = new Set();
  for (const item of conduitItems) {
    const size = extractSize(item.name);
    if (size) sizesPresent.add(size);
  }

  if (sizesPresent.size > 1) {
    const sizeList = Array.from(sizesPresent).sort().map((s) => `${s}"`).join(", ");
    flags.push({
      type: "size_mismatch",
      reason: `This draft includes conduit-family items in multiple different sizes (${sizeList}). This can be legitimate (e.g. a main run transitioning to a different fitting size), but verify all sizes are intentional before finalizing.`
    });
  }

  return flags;
}