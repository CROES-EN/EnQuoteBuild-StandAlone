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
//   1. AUTO-ADD  -- only IQ Combiner 6C -> Control Cable (Verified in BOTH the
//      dependency table AND its own dedicated Verified BOM template).
//   2. ADVISORY  -- IQ8-family microinverters -> suggested accessories, shown but
//      never auto-priced (their need is genuinely conditional per the workbook).
//   3. WARNING   -- legacy microinverters -> non-blocking compatibility reminder,
//      taken verbatim from the workbook's Compatibility_Matrix.

export const COMBINER_6C_AUTO_ADD = {
  triggerNameContains: "iq combiner 6c",
  addItem: { name: "Enphase Control Cable", defaultQuantity: 10 },
  note: "IQ Combiner 6C requires an Enphase-approved control cable to communicate with connected Generation 4 devices. Per Enphase guidance: third-party control cable may not operate reliably. Verify actual route length before finalizing quantity.",
  sourceDocument: "Combiner 6C Quick Install Guide"
};

export const IQ8_FAMILY_ADVISORY_ACCESSORIES = {
  triggerNameContains: ["iq8"],
  suggestions: [
    { name: "IQ Sealing Cap (Q-SEAL-10) (10pk)", reason: "Recommended for any unused IQ Cable connector left on the branch after replacement." },
    { name: "IQ Field Wireable (socket) Ea. SKU: Q-CONN-10F", reason: "Recommended if a connector needs to be field-repaired or re-terminated." },
    { name: "IQ Field Wireable (plug) Ea. SKU: Q-CONN-10M", reason: "Recommended if a connector needs to be field-repaired or re-terminated." },
    { name: null, reason: "IQ Disconnect Tool is recommended for safe connector disconnection during this repair, but is not currently in your product catalog -- source separately if needed.", notInCatalog: true }
  ],
  sourceDocument: "IQ8 Series Installation and Operation Manual"
};

export const LEGACY_MICROINVERTER_WARNING = {
  triggerNames: [
    "m175", "m190", "m210", "m215", "m250", "s230", "s280",
    "iq6 microinverter", "iq6+ microinverter", "iq6 plus microinverter",
    "iq7 microinverter", "iq7+ microinverter", "iq7 plus microinverter",
    "iq7a microinverter", "iq7x microinverter", "iq7pd"
  ],
  message: "This is a legacy microinverter series. Per Enphase compatibility guidance, do not auto-select a replacement -- verify trunk cable, connector, gateway, branch circuit, grid profile, and module electrical compatibility, and confirm current Enphase replacement policy before finalizing this quote.",
  sourceDocument: "Compatibility_Matrix (Replacement Review Required)"
};

function normalize(text) {
  return String(text || "").toLowerCase();
}

export function checkCombiner6CDependency(matchedItemName) {
  const lower = normalize(matchedItemName);
  if (lower.includes(COMBINER_6C_AUTO_ADD.triggerNameContains)) {
    return COMBINER_6C_AUTO_ADD;
  }
  return null;
}

export function checkIQ8AdvisoryAccessories(matchedItemName) {
  const lower = normalize(matchedItemName);
  const isIQ8Family = IQ8_FAMILY_ADVISORY_ACCESSORIES.triggerNameContains.some((t) => lower.includes(t));
  if (isIQ8Family && lower.includes("microinverter")) {
    return IQ8_FAMILY_ADVISORY_ACCESSORIES;
  }
  return null;
}

export function checkLegacyMicroinverterWarning(requestedOrMatchedName) {
  const lower = normalize(requestedOrMatchedName);
  const isLegacy = LEGACY_MICROINVERTER_WARNING.triggerNames.some((t) => {
    const pattern = new RegExp(`\\b${t.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\b`, "i");
    return pattern.test(lower);
  });
  return isLegacy ? LEGACY_MICROINVERTER_WARNING : null;
}