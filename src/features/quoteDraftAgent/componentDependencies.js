// componentDependencies.js
//
// Component Dependency Matrix -- built from EnQuote_Enphase_Installation_Catalog.xlsx,
// using ONLY entries confirmed Verified/High confidence, and re-scoped specifically for
// O&M REPLACEMENT quoting (not new-system installation).
//
// IMPORTANT CONTEXT: the workbook's raw Product_Dependencies table models a brand-new
// system BUILD (every microinverter "requires" a Gateway, Terminator, Cable). But its
// own repair-specific BOM template ("IQ8-Series Microinverter Replacement") does NOT
// include those, because a REPAIR assumes the site already has them. This file
// deliberately follows the repair-scoped logic, not the new-install logic, to avoid
// over-quoting equipment a site already has.
//
// Three tiers:
//   1. auto_add  -- only IQ Combiner 6C -> Control Cable (Verified in BOTH the
//      dependency table AND its own dedicated Verified BOM template).
//   2. advisory  -- IQ8-family microinverters -> suggested accessories, shown but
//      never auto-priced (their need is genuinely conditional per the workbook).
//   3. warning   -- legacy microinverters -> non-blocking compatibility reminder,
//      taken verbatim from the workbook's Compatibility_Matrix.
//
// GENERALIZATION (this revision): the three tiers above used to be three separate,
// hand-written check functions, each with its own bespoke matching logic. They are now
// ONE data table (DEPENDENCY_RULES) walked by ONE shared matcher (getDependencyMatches).
// This does not change behavior for the three existing rules at all -- it only changes
// how a FUTURE rule gets added: a new verified dependency, advisory, or warning becomes
// one new object in DEPENDENCY_RULES, not new matching code.
//
// IMPORTANT: no new dependency FACTS were added in this revision. The product catalog
// (productCatalog.js) is a flat list with no documented "requires"/"compatible with"
// relationships for non-Enphase/BOS items (conduit, breakers, wire, fittings, etc.) --
// inventing one here (e.g. "this breaker requires this load center") would violate the
// same "never guess, never fabricate a relationship without a verified source" rule this
// engine already follows everywhere else. This revision only makes the STRUCTURE ready to
// scale; new rules should still only be added once a real, sourced relationship exists
// (e.g. from a manufacturer install guide, the workbook's own dependency tables, or a
// confirmed internal correction) -- exactly how the three rules below were each sourced.

function normalize(text) {
  return String(text || "").toLowerCase();
}

function escapeRegex(str) {
  return str.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

export const DEPENDENCY_RULES = [
  {
    id: "combiner_6c_control_cable",
    tier: "auto_add",
    triggerNameContains: "iq combiner 6c",
    addItem: { name: "Enphase Control Cable", defaultQuantity: 10 },
    note: "IQ Combiner 6C requires an Enphase-approved control cable to communicate with connected Generation 4 devices. Per Enphase guidance: third-party control cable may not operate reliably. Verify actual route length before finalizing quantity.",
    sourceDocument: "Combiner 6C Quick Install Guide"
  },
  {
    id: "iq8_family_advisory",
    tier: "advisory",
    triggerNameContains: ["iq8"],
    requireAlsoContains: "microinverter",
    suggestions: [
      { name: "IQ Sealing Cap (Q-SEAL-10) (10pk)", reason: "Recommended for any unused IQ Cable connector left on the branch after replacement." },
      { name: "IQ Field Wireable (socket) Ea. SKU: Q-CONN-10F", reason: "Recommended if a connector needs to be field-repaired or re-terminated." },
      { name: "IQ Field Wireable (plug) Ea. SKU: Q-CONN-10M", reason: "Recommended if a connector needs to be field-repaired or re-terminated." },
      { name: null, reason: "IQ Disconnect Tool is recommended for safe connector disconnection during this repair, but is not currently in your product catalog -- source separately if needed.", notInCatalog: true }
    ],
    sourceDocument: "IQ8 Series Installation and Operation Manual"
  },
  {
    id: "legacy_microinverter_warning",
    tier: "warning",
    triggerNames: [
      "m175", "m190", "m210", "m215", "m250", "s230", "s280",
      "iq6 microinverter", "iq6+ microinverter", "iq6 plus microinverter",
      "iq7 microinverter", "iq7+ microinverter", "iq7 plus microinverter",
      "iq7a microinverter", "iq7x microinverter", "iq7pd"
    ],
    message: "This is a legacy microinverter series. Per Enphase compatibility guidance, do not auto-select a replacement -- verify trunk cable, connector, gateway, branch circuit, grid profile, and module electrical compatibility, and confirm current Enphase replacement policy before finalizing this quote.",
    sourceDocument: "Compatibility_Matrix (Replacement Review Required)"
  }
];

// Shared matcher for every rule shape above. A rule matches via EITHER:
//   - triggerNameContains (substring match, optionally gated by requireAlsoContains), OR
//   - triggerNames (whole-word regex match against a list of exact model/series names)
// Exactly the same two matching strategies the original three separate functions used --
// just expressed once, generically, instead of three times.
function ruleMatches(lower, rule) {
  if (rule.triggerNameContains) {
    const candidates = Array.isArray(rule.triggerNameContains)
      ? rule.triggerNameContains
      : [rule.triggerNameContains];
    const hit = candidates.some((t) => lower.includes(t));
    if (!hit) return false;
    if (rule.requireAlsoContains && !lower.includes(rule.requireAlsoContains)) return false;
    return true;
  }
  if (rule.triggerNames) {
    return rule.triggerNames.some((t) => {
      const pattern = new RegExp(`\\b${escapeRegex(t)}\\b`, "i");
      return pattern.test(lower);
    });
  }
  return false;
}

/**
 * Returns every DEPENDENCY_RULES entry (of any tier) that matches the given item name.
 * Read-only, never throws. Useful if a future caller wants to see ALL matches at once
 * (e.g. a product that is both IQ8-family AND happens to match another future rule).
 */
export function getDependencyMatches(itemName) {
  const lower = normalize(itemName);
  return DEPENDENCY_RULES.filter((rule) => ruleMatches(lower, rule));
}

// --- Backward-compatible wrappers -------------------------------------------------
// draftEngine.js imports these three functions by name and expects the exact same
// single-object-or-null return shape as before. Keeping these means draftEngine.js
// required NO changes at all for this generalization.

export function checkCombiner6CDependency(matchedItemName) {
  const match = getDependencyMatches(matchedItemName).find((r) => r.tier === "auto_add");
  return match || null;
}

export function checkIQ8AdvisoryAccessories(matchedItemName) {
  const match = getDependencyMatches(matchedItemName).find((r) => r.tier === "advisory");
  return match || null;
}

export function checkLegacyMicroinverterWarning(requestedOrMatchedName) {
  const match = getDependencyMatches(requestedOrMatchedName).find((r) => r.tier === "warning");
  return match || null;
}
